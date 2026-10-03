// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The composer: a map intent in, an ordinary scene spec out, seeded and
 * repeatable. Ground and outdoor zones are laid first, then roads and
 * rivers, then each building: its rooms laid out by purpose and adjacency,
 * walled, doored and furnished. What it could not do (rooms that do not
 * fit, adjacency it could not give, roles no loaded stamp fills) is reported
 * as problems, never thrown. Everything is placed in grid squares from the
 * map's top-left corner. Pure and unit-tested.
 */
import type { DoorSlot, Rect, RoomBuild, RoomCorner, Side } from '../generate/floor-plan';
import { OPPOSITE_SIDE, roomSpec } from '../generate/floor-plan';
import { type Random, seededRandom } from '../generate/random';
import { SCENE_SPEC_SCHEMA_VERSION, type SceneSpecInput } from '../generate/spec';
import { boundsOf } from '../geometry/bounds';
import type { Point } from '../geometry/spline';
import type { StampRole } from '../stamps/schema';
import type { BiomeKind } from '../tools/biome';
import { DAYLIGHT_MAX_DARKNESS } from '../tools/daylight';
import { WALL_BAND_SQUARES } from '../tools/materials';
import { type Flight, flightFor, narrowestFlight, type StormDoorway, stormDoorway, wayDownOver, withStairTags } from './access';
import { curtainFeatures, moatOutlines } from './curtain';
import { districtFeatures } from './district';
import { composeExterior, type LaidPath } from './exterior';
import { type Box, type ComposedStamp, furnishRoom, type RoomFloor } from './furnish';
import { hewnFeatures } from './hewn';
import { type BuildingIntent, type FixtureIntent, type MapIntent, WALL_SIDES, type ZoneIntent } from './intent';
import { type BuildingLayout, doorsOf } from './layout';
import { type LinkPlaces, linkFeatures } from './links';
import { drawPlaceholders, isPlaceholder, missing, placeholder, withPlaceholders } from './placeholders';
import { platformFeatures } from './platform';
import { NO_PREFERENCES, narrowedIndex, type Preferences, roomPlace } from './preferences';
import { type ComposeProblem, distinctProblems } from './problems';
import { drawnAs, type RoleIndex, type RoleStamp } from './roles';
import { flawsOf, layOutStoreys, type Storeys, type Well, type Wells } from './storeys';
import { windowSlots } from './windows';

type FeatureInput = SceneSpecInput['features'][number];
type SceneSettingsInput = NonNullable<SceneSpecInput['scene']>;

/** A composed map: the spec to build, and what the composer could not do. */
export interface Composition {
    readonly spec: SceneSpecInput;
    readonly problems: readonly ComposeProblem[];
}

/** A building's footprint: where the intent puts it, else centred on the map. */
export function footprintOf(building: Pick<BuildingIntent, 'at' | 'width' | 'height'>, intent: Pick<MapIntent, 'width' | 'height'>): Rect {
    return {
        x: building.at?.x ?? Math.floor((intent.width - building.width) / 2),
        y: building.at?.y ?? Math.floor((intent.height - building.height) / 2),
        w: building.width,
        h: building.height,
    };
}

/** The sides of `rect` that are the footprint's outside walls. */
function outerSides(rect: Rect, footprint: Rect): Side[] {
    const sides: Side[] = [];
    if (rect.y === footprint.y) {
        sides.push('top');
    }
    if (rect.x + rect.w === footprint.x + footprint.w) {
        sides.push('right');
    }
    if (rect.y + rect.h === footprint.y + footprint.h) {
        sides.push('bottom');
    }
    if (rect.x === footprint.x) {
        sides.push('left');
    }
    return sides;
}

const stampFeature = (s: ComposedStamp): FeatureInput => ({
    type: 'stamp',
    stamp: s.stamp,
    x: s.x,
    y: s.y,
    rotation: s.rotation,
    ...(s.scale === undefined ? {} : { scale: s.scale }),
    ...(s.reads === undefined ? {} : { reads: s.reads }),
    ...(s.mirror === true ? { mirror: true } : {}),
    ...(s.variant === undefined ? {} : { variant: s.variant }),
});

/**
 * Lanes in a stairwell: one flight for a building of two floors; for more, a
 * switchback of two side by side, each floor's flight beside the one that
 * arrives from below, so no two flights' ways between floors overlap.
 */
const stairLanes = (floorsAbove: number): number => (floorsAbove > 1 ? 2 : 1);

/** A building's name in problems, room keys and places: its key, else its place in the intent. */
export const buildingName = (building: BuildingIntent, index: number): string => building.key ?? `building-${index + 1}`;

/** A storey's name in problems and room keys: the building's own for the ground floor, else with its floor (above) or cellar (below). */
export function storeyName(called: string, storey: number): string {
    if (storey === 0) {
        return called;
    }
    return storey > 0 ? `${called}/floor-${storey + 1}` : `${called}/cellar-${-storey}`;
}

/** What composing a storey needs: its building, name in keys and problems, footprint, stamps, the floor it keeps clear, its level, and the time of day. */
interface StoreyContext {
    readonly building: BuildingIntent;
    readonly called: string;
    readonly footprint: Rect;
    readonly stamps: RoleIndex;
    readonly random: Random;
    /** Floor left clear on every storey: the stairwell. */
    readonly reserved: readonly Box[];
    readonly onLevel: { level?: string };
    readonly night: boolean;
    readonly preferences: Preferences;
    /** Under a roof on a map out of doors: the day kept out but through windows and outer doors. */
    readonly indoors: boolean;
    /** Windows in its outer walls (above ground, where the building has them). */
    readonly windowed: boolean;
}

/**
 * A roofed room's darkness, whatever the time of day: full, above the range a
 * scene's global light shines in (Foundry drops global light wherever a
 * region leaves the darkness outside its range), so the day falls only
 * through the room's windows and outer doors, and its lamps light the rest.
 */
const KEEP_DAY_OUT = { kind: 'darkness', mode: 'override', modifier: 1 } as const;

/** Roles whose pieces give light: a room holding one needs no light of its own by night. */
const LIGHT_SOURCES: readonly StampRole[] = ['light', 'hearth'];

/** One storey's rooms and furniture. */
function composeStorey(layout: BuildingLayout, context: StoreyContext): { features: FeatureInput[]; problems: ComposeProblem[] } {
    const { building, called, footprint, stamps, random, reserved, onLevel, night, preferences, indoors, windowed } = context;
    const roleOf = new Map([...stamps.values()].flat().map((s) => [s.key, s.role]));
    const problems: ComposeProblem[] = layout.unmet.map(([room, other]) => ({ kind: 'not-beside', building: called, room, other }));
    const rooms: FeatureInput[] = [];
    const furniture: FeatureInput[] = [];
    // Doorways hung with door art: the art is the door (it cuts the wall and is the native door), so the room keeps its wall there.
    const hung = new Map(
        layout.doors.flatMap((d) => {
            const rect = layout.rooms.find((r) => r.key === d.room)?.rect;
            const door = rect === undefined ? null : hungDoor(d.slot, rect, stamps, building.doorTags);
            return door === null ? [] : [[d, { ...door, ...onLevel }] as const];
        }),
    );
    for (const room of layout.rooms) {
        // Furnished inside its walls' inner faces: a composed building's walls are always drawn, half their thickness into the room.
        const inset = WALL_BAND_SQUARES / 2;
        const floor: RoomFloor = {
            key: room.key,
            purpose: room.intent.purpose,
            rect: { x: room.rect.x + inset, y: room.rect.y + inset, w: room.rect.w - 2 * inset, h: room.rect.h - 2 * inset },
            doors: doorsOf(layout, room.key),
            outer: outerSides(room.rect, footprint),
            entrance: layout.doors.find((d) => d.room === room.key && d.to === null)?.slot.side ?? null,
            fixtures: room.intent.fixtures,
            furnish: room.intent.furnish,
            grime: room.intent.grime,
        };
        // A chamfered room's cut corners are masonry: nothing stands in them.
        const chamfer = room.intent.chamfer ?? 0;
        // Where another room wraps a cut corner, the corner is solid masonry between them; against the open void it stays void.
        const others = layout.rooms.filter((r) => r.key !== room.key).map((r) => r.rect);
        const enclosed = (corner: readonly Point[]): boolean => {
            const [apex] = corner;
            return (
                apex !== undefined &&
                others.some((r) => [-1, 1].some((dx) => [-1, 1].some((dy) => inRect(r, { x: apex.x + dx * NUDGE, y: apex.y + dy * NUDGE }))))
            );
        };
        const cut = chamferCorners(room.rect, chamfer, room.intent.chamferAt);
        const corners = cut.filter(enclosed);
        const furnished = furnishRoom(floor, narrowedIndex(stamps, preferences.get(roomPlace(called, room.key))), random, [...reserved, ...cut.map(boundsOf)]);
        const glows = furnished.stamps.some((s) => LIGHT_SOURCES.some((role) => roleOf.get(s.stamp) === role));
        // Its own doorways, and each neighbour's into it as an opening in its side of the wall: the door is the neighbour's to draw.
        const slots = layout.doors.flatMap((d) => {
            if (hung.has(d)) {
                return [];
            }
            if (d.room === room.key) {
                const animated = building.doorAnimation === null ? d.slot : { ...d.slot, animation: building.doorAnimation };
                // A door to the outside lets the day in while it stands open.
                return [indoors && d.to === null ? { ...animated, daylight: true } : animated];
            }
            if (d.to !== room.key) {
                return [];
            }
            // A secret door stays wall to look at from both sides; any other opens this room's side of the wall to it.
            const side = OPPOSITE_SIDE[d.slot.side];
            return [d.slot.secret === true ? { ...d.slot, side } : { ...d.slot, side, open: true, arch: true }];
        });
        rooms.push(...corners.map((points): FeatureInput => ({ type: 'region', biome: 'rock', texture: building.wall, sharp: true, points, ...onLevel })));
        const windows = windowed ? windowSlots(room.rect, outerSides(room.rect, footprint), slots, chamfer) : [];
        rooms.push({
            ...roomSpec(
                room.rect,
                [...slots, ...windows],
                { floor: room.intent.floor ?? building.floor, wall: building.wall, wallKind: building.wallKind, ceiling: true },
                chamfer,
                room.intent.chamferAt,
            ),
            key: `${called}:${room.key}`,
            // By night a room is lit by its hearth and lamps, not a flat light; one with neither keeps its own.
            lit: !(night && glows),
            // Under its roof the day never shines but through its windows and outer doors: the scene's global light is kept out.
            ...(indoors ? { effects: [KEEP_DAY_OUT] } : {}),
            ...onLevel,
        });
        furniture.push(...furnished.stamps.map((s) => ({ ...stampFeature(s), ...onLevel })));
        problems.push(...furnished.missing.flatMap((role) => missing(role, `${called}/${room.key}`, stamps.get(role)?.[0]) ?? []));
        problems.push(...furnished.boxed.map((piece) => ({ kind: 'placeholder' as const, piece, wantedIn: `${called}/${room.key}` })));
        problems.push(...furnished.crowded.map((piece) => ({ kind: 'no-room' as const, piece, wantedIn: `${called}/${room.key}` })));
        problems.push(...furnished.borrowed.map((role) => ({ kind: 'borrowed-art' as const, role, wantedIn: `${called}/${room.key}` })));
    }
    return { features: [...rooms, ...hung.values(), ...furniture], problems };
}

/** How far (squares) door art's width may differ from its doorway's and still hang there. */
const DOOR_FIT = 0.25;

/** The turn that stands a piece's back to each wall of a room. */
const BACK_TO_WALL: Readonly<Record<Side, number>> = { top: 0, right: 90, bottom: 180, left: 270 };

/**
 * Door art hung in the doorway `slot` of a room over `rect`: top-down art
 * with a door, carrying one of `tags` (any, when none), as wide as the
 * doorway give or take; laid along the wall across the doorway, scaled to
 * its width, in the variant showing its state (open where the doorway stands
 * open, else closed). None for an archway, a secret door (wall to look at)
 * or where no such art is loaded: the room then draws the doorway itself.
 */
function hungDoor(slot: DoorSlot, rect: Rect, stamps: RoleIndex, tags: readonly string[]): FeatureInput | null {
    if (slot.arch === true || slot.secret === true) {
        return null;
    }
    const width = slot.width ?? 1;
    const fits = (stamps.get('door') ?? []).filter(
        (s) =>
            !s.upright &&
            s.doorStates !== undefined &&
            !isPlaceholder(s.key) &&
            (tags.length === 0 || tags.some((t) => s.tags.includes(t))) &&
            Math.abs(s.width - width) <= DOOR_FIT,
    );
    const art = [...fits].sort((a, b) => Math.abs(a.width - width) - Math.abs(b.width - width))[0];
    if (art === undefined) {
        return null;
    }
    const mid = slot.at + width / 2;
    const centre: Readonly<Record<Side, Point>> = {
        top: { x: mid, y: rect.y },
        bottom: { x: mid, y: rect.y + rect.h },
        left: { x: rect.x, y: mid },
        right: { x: rect.x + rect.w, y: mid },
    };
    const states = art.doorStates ?? {};
    // Art's door takes its state from the variant it shows: a locked doorway whose art draws no lock keeps the room's own door, which locks.
    if (slot.locked === true && states.locked === undefined) {
        return null;
    }
    const shown = slot.locked === true ? states.locked : slot.open === true ? states.open : undefined;
    const variant = shown ?? states.closed ?? 0;
    return {
        type: 'stamp',
        stamp: art.key,
        ...centre[slot.side],
        rotation: (BACK_TO_WALL[slot.side] + art.turn) % FULL_TURN,
        variant,
        scale: (art.scale ?? 1) * (width / art.width),
    };
}

/** Degrees in a full turn. */
const FULL_TURN = 360;

/** The triangles a chamfer of `c` squares cuts from `rect`'s corners `at`, each with its apex (the rect's corner) first; none for square corners. */
function chamferCorners({ x, y, w, h }: Rect, c: number, at: readonly RoomCorner[]): Point[][] {
    if (c <= 0) {
        return [];
    }
    const triangles: Readonly<Record<RoomCorner, Point[]>> = {
        'top-left': [
            { x, y },
            { x: x + c, y },
            { x, y: y + c },
        ],
        'top-right': [
            { x: x + w, y },
            { x: x + w, y: y + c },
            { x: x + w - c, y },
        ],
        'bottom-right': [
            { x: x + w, y: y + h },
            { x: x + w - c, y: y + h },
            { x: x + w, y: y + h - c },
        ],
        'bottom-left': [
            { x, y: y + h },
            { x, y: y + h - c },
            { x: x + c, y: y + h },
        ],
    };
    return at.map((corner) => triangles[corner]);
}

/**
 * A storey above the ground over only part of the footprint (a commander's
 * office over its stair core): the rest is flat roof in `texture` over the
 * storey `below`, never a view down into its rooms; drawn first, under the
 * storey's own rooms. It follows each room below, cut corners cut, never the
 * footprint's rectangle, which would roof the void beside a tapered hull's
 * bow. None for a whole storey, or with no storey below (the ground, a
 * cellar, or one that did not fit).
 */
function roofOf(
    layout: BuildingLayout,
    below: BuildingLayout | null,
    {
        footprint,
        texture,
        onLevel,
        build,
    }: { readonly footprint: Rect; readonly texture: string; readonly onLevel: { readonly level?: string }; readonly build: RoomBuild },
): FeatureInput[] {
    if (!below || covers(layout, footprint)) {
        return [];
    }
    return below.rooms.map(
        (r): FeatureInput => ({
            type: 'region',
            biome: 'rock',
            texture,
            sharp: true,
            points: roomSpec(r.rect, [], build, r.intent.chamfer ?? 0, r.intent.chamferAt).points,
            ...onLevel,
        }),
    );
}

/** The layout of the storey under an upper `storey`; null for the ground, a cellar, or one that did not fit. */
const storeyBelow = (storeys: Storeys, storey: number): BuildingLayout | null =>
    storey === 1 ? storeys.ground : storey > 1 ? storeys.floors[storey - 2] ?? null : null;

/** Whether `layout`'s rooms, which never overlap, cover the whole of `footprint`. */
const covers = (layout: BuildingLayout, footprint: Rect): boolean =>
    layout.rooms.reduce((area, r) => area + r.rect.w * r.rect.h, 0) >= footprint.w * footprint.h;

/** Squares off a corner at which to look for a room wrapping it. */
const NUDGE = 0.01;

/** Whether `p` lies inside `r`. */
const inRect = (r: Rect, p: Point): boolean => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

/** A storey's level: its key on a map with levels, else none. */
type LevelOf = (storey: number) => { level?: string };

/** What composing a building needs from the map: its stamps, randomness, the level of each storey, the time of day and the stamps chosen for each place. */
interface MapContext {
    readonly stamps: RoleIndex;
    readonly random: Random;
    readonly levelOf: LevelOf;
    readonly night: boolean;
    readonly preferences: Preferences;
    /** The map's cellar levels: the deepest building's cellars. */
    readonly depth: number;
    /** The map is out of doors (a battlemap with ground): its buildings keep the day out but through windows and outer doors. */
    readonly outdoor: boolean;
}

/**
 * A way's flights, one on each storey but the top of its run, each in the
 * lane beside the one below; in a well lying turned, the flights turned a
 * quarter with it, their lanes down it rather than across. Over each, the
 * floor above shows the way down: `wayDown` (a ladder's well) fitted to the
 * opening, else a dark frame. A flight drawn only as a way down seen from
 * above stands in the floor above, the way between the floors, and a
 * labelled box stands where it rises from, for want of its foot's art.
 */
function flights(
    way: { readonly stair: RoleStamp; readonly wayDown: RoleStamp | undefined },
    well: Well,
    run: { readonly count: number; readonly lowest: number },
    levelOf: LevelOf,
): FeatureInput[] {
    const { stair, wayDown } = way;
    const { count, lowest } = run;
    const lanes = stairLanes(count);
    return Array.from({ length: count }, (_, n): FeatureInput[] => {
        const lane = (n % lanes) * stair.width + stair.width / 2;
        const [x, y] = well.turned ? [well.x + well.w / 2, well.y + lane] : [well.x + lane, well.y + well.h / 2];
        const [width, height] = well.turned ? [stair.height, stair.width] : [stair.width, stair.height];
        const turned = well.turned ? QUARTER_TURN : 0;
        const above = levelOf(lowest + n + 1);
        const rotation = (stair.turn + turned) % FULL_TURN;
        const foot = footOf(stair);
        if (foot !== null) {
            const box = placeholder('stairs', foot, width, height);
            return [
                { type: 'stamp', ...drawnAs(stair), x, y, rotation, ...above },
                { type: 'stamp', stamp: box.key, x, y, ...levelOf(lowest + n) },
            ];
        }
        // Where it comes up, the floor above is open: the way down seen from above, its own art, else a dark hatchway, framed.
        const opening: FeatureInput = wayDown
            ? {
                  type: 'stamp',
                  ...drawnAs(wayDown),
                  x,
                  y,
                  rotation: (wayDown.turn + turned) % FULL_TURN,
                  scale: (wayDown.scale ?? 1) * Math.min(stair.width / wayDown.width, stair.height / wayDown.height),
                  // The flight below is the way between the floors; this only shows it.
                  inert: true,
                  ...above,
              }
            : { type: 'shape', kind: 'rectangle', x, y, width, height, stroke: OPENING.stroke, fill: OPENING.fill, ...above };
        return [{ type: 'stamp', ...drawnAs(stair), x, y, rotation, ...levelOf(lowest + n) }, opening];
    }).flat();
}

/** Squares kept clear before each end of a stairwell: room to step off the flight at its foot, and onto it at its head. */
const STAIR_APPROACH = 1;

/**
 * A stairwell and the floor kept clear before both its ends, along the way
 * its flights climb (across a turned well): whichever end the art's foot is
 * at, nothing stands where a token steps off or onto the stair. An end
 * against a wall keeps only wall clear.
 */
export function withApproaches(well: Well): Box[] {
    const { x, y, w, h } = well;
    const ends: Box[] = well.turned
        ? [
              { x: x - STAIR_APPROACH, y, w: STAIR_APPROACH, h },
              { x: x + w, y, w: STAIR_APPROACH, h },
          ]
        : [
              { x, y: y - STAIR_APPROACH, w, h: STAIR_APPROACH },
              { x, y: y + h, w, h: STAIR_APPROACH },
          ];
    return [well, ...ends];
}

/**
 * For `stair` drawn only as a way down seen from above (a ladder's hatch),
 * not as the flight that climbs, the label of the box standing where it
 * rises from: its kind, going up (`ladder up`); null for a flight that climbs.
 */
const footOf = (stair: RoleStamp): string | null => (stair.climb?.direction === 'down' ? `${stair.climb.kind} up` : null);

/** The labelled box a building's flights of `stair` leave for want of their foot's art, in `wantedIn`. */
function footProblems(stair: RoleStamp, wantedIn: string): ComposeProblem[] {
    const foot = footOf(stair);
    return foot === null ? [] : [{ kind: 'placeholder', piece: foot, wantedIn }];
}

/** Degrees in a quarter turn. */
const QUARTER_TURN = 90;

/** How an opening in the floor above a flight is drawn: near black, framed in dark timber. */
const OPENING = {
    stroke: { colour: '#4a3220', width: 4, alpha: 1 },
    fill: { colour: '#140d08', alpha: 0.9 },
} as const;

/**
 * `building`'s storeys round wells for the flights `asked`; where they come
 * out flawed (a broad stairwell in a small stair core finds no well, a long
 * flight fits between no corridor's doorways and lands in a bedroom), laid
 * out again round the narrowest flights of the same kinds, kept where that
 * lays better.
 */
function laidOut(
    building: BuildingIntent,
    footprint: Rect,
    asked: { readonly up: Flight | null; readonly down: Flight | null },
    map: MapContext,
): { up: Flight | null; down: Flight | null; storeys: Storeys | null } {
    const lay = (ways: typeof asked): Storeys | null =>
        layOutStoreys(
            building,
            footprint,
            { up: wellFor(ways.up?.stair, building.floors.length), down: wellFor(ways.down?.stair, building.cellars.length) },
            map.random,
        );
    // A flight with no well is the worst flaw; then each room cut off from one it opens onto, and a landing in a bedroom.
    const flaws = (ways: typeof asked, laid: Storeys | null): number => {
        if (laid === null) {
            return Number.POSITIVE_INFINITY;
        }
        const unwelled = (ways.up?.stair !== undefined && laid.stairwell === null) || (ways.down?.stair !== undefined && laid.cellarWell === null);
        return (unwelled ? UNWELLED_FLAWS : 0) + flawsOf(laid);
    };
    const storeys = lay(asked);
    const flawed = flaws(asked, storeys);
    const narrow = { up: asked.up && narrowestFlight(asked.up, map.stamps), down: asked.down && narrowestFlight(asked.down, map.stamps) };
    const narrower = narrow.up?.stair !== asked.up?.stair || narrow.down?.stair !== asked.down?.stair;
    if (flawed === 0 || !narrower) {
        return { ...asked, storeys };
    }
    // A long straight flight that fits between no doorways of a corridor: the narrowest flight of its kind, where that lays better.
    const retried = lay(narrow);
    return flaws(narrow, retried) < flawed ? { ...narrow, storeys: retried } : { ...asked, storeys };
}

/** What a flight without a well counts against its storeys: more than every other flaw a layout can have. */
const UNWELLED_FLAWS = 1000;

/** The size of the well a way of `count` flights of `stair` needs, or null without one. */
const wellFor = (stair: RoleStamp | undefined, count: number): Wells['up'] =>
    stair && count > 0 ? { w: stair.width * stairLanes(count), h: stair.height } : null;

/** The top cellar with the storm door's own door through its wall. */
function withStormDoor(layout: BuildingLayout, doorway: StormDoorway): BuildingLayout {
    const { through } = doorway;
    const across = through.side === 'top' || through.side === 'bottom';
    // The room inside the wall at the door: the one whose edge on that side holds the door's square.
    const room = layout.rooms.find((r) => {
        const edge = { top: r.rect.y, bottom: r.rect.y + r.rect.h, left: r.rect.x, right: r.rect.x + r.rect.w }[through.side];
        const areaway = doorway.areaway;
        const wall = { top: areaway.y + areaway.h, bottom: areaway.y, left: areaway.x + areaway.w, right: areaway.x }[through.side];
        const [lo, hi] = across ? [r.rect.x, r.rect.x + r.rect.w] : [r.rect.y, r.rect.y + r.rect.h];
        return edge === wall && through.at >= lo && through.at + 1 <= hi;
    });
    return room ? { ...layout, doors: [...layout.doors, { room: room.key, to: AREAWAY, slot: through }] } : layout;
}

/** The storm door's areaway's key among a building's rooms. */
const AREAWAY = 'areaway';

/**
 * One building's storeys, rooms, furniture and flights, or a problem when
 * its ground floor's rooms cannot fit; `called` names it in its rooms' keys
 * and in problems. Floors stand above the ground floor and cellars below
 * it, each way round a well of its own; storm doors lead into the top
 * cellar from outside, through an areaway annexed to the building.
 */
function composeBuilding(
    building: BuildingIntent,
    called: string,
    footprint: Rect,
    map: MapContext,
): { features: FeatureInput[]; problems: ComposeProblem[]; ground: BuildingLayout | null; annexes: Rect[] } {
    const { stamps, random, levelOf, night, preferences, depth, outdoor } = map;
    // Windows in a building's outer walls out of doors, where it has them; cellars are below ground, with none.
    const windowedOn = (storey: number): boolean => outdoor && building.windows && storey >= 0;
    const ways = withStairTags(stamps, building.stairTags);
    // A flight must not open onto a level beneath where it climbs from: the map's cellar levels lie under every ground floor.
    const asked = {
        up: building.floors.length > 0 ? flightFor(building.floorAccess, ways, random, { wantedIn: called, below: depth > 0 }) : null,
        down:
            building.cellars.length > 0
                ? flightFor(building.cellarAccess, ways, random, { wantedIn: `${called}/cellar`, below: depth > building.cellars.length })
                : null,
    };
    const { up, down, storeys } = laidOut(building, footprint, asked, { ...map, stamps: ways });
    if (!storeys) {
        return {
            features: [],
            problems: [{ kind: 'rooms-do-not-fit', building: called, width: building.width, height: building.height }],
            ground: null,
            annexes: [],
        };
    }
    const { stairwell, cellarWell } = storeys;
    const doorway =
        building.stormDoor !== null && building.cellars.length > 0
            ? stormDoorway(building.stormDoor, footprint, stamps, random, { wantedIn: `${called}/storm-door`, below: depth > 1 })
            : null;
    const features: FeatureInput[] = [];
    const problems: ComposeProblem[] = [...(up?.problems ?? []), ...(down?.problems ?? []), ...(doorway?.problems ?? [])];
    // The ground floor keeps both wells clear, a floor the one up, a cellar the one down.
    const reservedOn = (storey: number): Box[] => [
        ...(storey >= 0 && stairwell ? withApproaches(stairwell) : []),
        ...(storey <= 0 && cellarWell ? withApproaches(cellarWell) : []),
    ];
    const storeyList: [number, BuildingLayout | null][] = [
        [0, storeys.ground],
        ...storeys.floors.map((layout, n): [number, BuildingLayout | null] => [n + 1, layout]),
        ...storeys.cellars.map((layout, n): [number, BuildingLayout | null] => [
            -(n + 1),
            layout && doorway && n === 0 ? withStormDoor(layout, doorway) : layout,
        ]),
    ];
    for (const [storey, layout] of storeyList) {
        const storeyCalled = storeyName(called, storey);
        if (!layout) {
            problems.push({ kind: 'rooms-do-not-fit', building: storeyCalled, width: building.width, height: building.height });
            continue;
        }
        const below = storeyBelow(storeys, storey);
        const build = { floor: building.floor, wall: building.wall, wallKind: building.wallKind, ceiling: true };
        features.push(...roofOf(layout, below, { footprint, texture: building.wall, onLevel: levelOf(storey), build }));
        const composed = composeStorey(layout, {
            building,
            called: storeyCalled,
            footprint,
            stamps,
            random,
            reserved: reservedOn(storey),
            onLevel: levelOf(storey),
            night,
            preferences,
            indoors: outdoor,
            windowed: windowedOn(storey),
        });
        features.push(...composed.features);
        problems.push(...composed.problems);
    }
    if (up?.stair && !stairwell) {
        problems.push({ kind: 'no-stairwell', building: called });
    }
    if (down?.stair && !cellarWell) {
        problems.push({ kind: 'no-stairwell', building: `${called}/cellar` });
    }
    // Each flight stands on the lower storey and climbs to the one above: up from the ground floor, up from each cellar.
    if (up?.stair && stairwell) {
        problems.push(...footProblems(up.stair, called));
        features.push(
            ...flights({ stair: up.stair, wayDown: wayDownOver(up.stair, stamps) }, stairwell, { count: building.floors.length, lowest: 0 }, levelOf),
        );
    }
    if (down?.stair && cellarWell) {
        problems.push(...footProblems(down.stair, `${called}/cellar`));
        features.push(
            ...flights(
                { stair: down.stair, wayDown: wayDownOver(down.stair, stamps) },
                cellarWell,
                { count: building.cellars.length, lowest: -building.cellars.length },
                levelOf,
            ),
        );
    }
    if (doorway) {
        features.push(...stormDoorFeatures(doorway, building, called, levelOf));
    }
    const porch = building.porch === null ? null : porchOf(storeys.ground, footprint, building.porch);
    if (porch) {
        const furnished = furnishRoom(porch.floor, narrowedIndex(stamps, preferences.get(roomPlace(called, PORCH))), random);
        features.push(boardsOver(porch.floor.rect, levelOf(0)), ...furnished.stamps.map((s) => ({ ...stampFeature(s), ...levelOf(0) })));
        problems.push(...furnished.missing.flatMap((role) => missing(role, `${called}/${PORCH}`, stamps.get(role)?.[0]) ?? []));
        problems.push(...furnished.boxed.map((piece) => ({ kind: 'placeholder' as const, piece, wantedIn: `${called}/${PORCH}` })));
    }
    return {
        features,
        problems,
        ground: storeys.ground,
        annexes: [...(doorway ? [doorway.areaway] : []), ...(porch ? [porch.floor.rect] : [])],
    };
}

/** The porch's name among a building's places. */
const PORCH = 'porch';

/**
 * A porch `depth` squares deep along the front door's wall, the entrance
 * room's stretch of it, as a floor to furnish: open on its three outer
 * sides, the building's wall behind it with the front door in it.
 */
function porchOf(ground: BuildingLayout, footprint: Rect, depth: number): { floor: RoomFloor } | null {
    const front = ground.doors.find((d) => d.to === null);
    const room = front && ground.rooms.find((r) => r.key === front.room);
    if (!front || !room) {
        return null;
    }
    const { side } = front.slot;
    const along = room.rect;
    const rects: Readonly<Record<Side, Rect>> = {
        top: { x: along.x, y: footprint.y - depth, w: along.w, h: depth },
        bottom: { x: along.x, y: footprint.y + footprint.h, w: along.w, h: depth },
        left: { x: footprint.x - depth, y: along.y, w: depth, h: along.h },
        right: { x: footprint.x + footprint.w, y: along.y, w: depth, h: along.h },
    };
    const wall = OPPOSITE_SIDE[side];
    const unwalled = (['top', 'right', 'bottom', 'left'] as const).filter((s) => s !== wall);
    const rect = rects[side];
    return {
        floor: {
            key: PORCH,
            purpose: 'porch',
            rect,
            doors: [{ side: wall, at: front.slot.at }],
            outer: unwalled,
            entrance: wall,
            fixtures: porchPosts(rect, wall),
        },
    };
}

/** Squares between a porch's posts along its open front, at most; how far in from its edges they stand; how thick each is. */
const PORCH_POST_SPAN = 3;
const PORCH_POST_INSET = 0.2;
const PORCH_POST_SIZE = 0.3;

/**
 * The posts holding up a porch's roof (operator, 2026-10-02: a porch with no
 * posts): one at each outer corner of `rect` and along its open front between
 * them, no more than a span apart; `wall` is the building's side of it.
 */
function porchPosts(rect: Rect, wall: Side): FixtureIntent[] {
    const front = OPPOSITE_SIDE[wall];
    const across = front === 'top' || front === 'bottom';
    const [span, depth] = across ? [rect.w, rect.h] : [rect.h, rect.w];
    const run = span - 2 * PORCH_POST_INSET;
    const count = Math.max(2, Math.ceil(run / PORCH_POST_SPAN) + 1);
    const out = (front === 'bottom' || front === 'right' ? depth - PORCH_POST_INSET : PORCH_POST_INSET) / depth;
    return Array.from({ length: count }, (_, i) => {
        const along = (PORCH_POST_INSET + (run * i) / (count - 1)) / span;
        return {
            name: 'porch post',
            role: 'fitting',
            tags: ['post'],
            width: PORCH_POST_SIZE,
            height: PORCH_POST_SIZE,
            facing: 'bottom',
            fixed: false,
            open: [],
            count: 1,
            place: { at: across ? { x: along, y: out } : { x: out, y: along } },
        };
    });
}

/** Boards laid over `rect` on the ground, crisp-edged: a porch's deck, storm doors without their art. */
function boardsOver(rect: Rect, level: { level?: string }): FeatureInput {
    return crispRegion(rect, BOARDS, level, 'dirt');
}

/** The texture boards are drawn in outside: a porch's deck, storm doors without their art. */
const BOARDS = 'floor.wooden-planks';

/**
 * A band `depth` squares deep of the building's wall material laid round the
 * outside of its footprint, crisp-edged, broken where a doorway goes out: the
 * heavy masonry of a chapel or a bunker, its drawn walls the band's inner face.
 */
function wallBand(
    footprint: Rect,
    depth: number,
    textures: { readonly wall: string; readonly floor: string },
    doorways: readonly DoorSlot[],
    level: { level?: string },
): FeatureInput[] {
    const { x, y, w, h } = footprint;
    // Each side's strip, the corners with the top and bottom, as [start, end] along it and its box for a stretch.
    const sides: Readonly<Record<Side, { from: number; to: number; box: (a: number, b: number) => Rect }>> = {
        top: { from: x - depth, to: x + w + depth, box: (a, b) => ({ x: a, y: y - depth, w: b - a, h: depth }) },
        bottom: { from: x - depth, to: x + w + depth, box: (a, b) => ({ x: a, y: y + h, w: b - a, h: depth }) },
        left: { from: y, to: y + h, box: (a, b) => ({ x: x - depth, y: a, w: depth, h: b - a }) },
        right: { from: y, to: y + h, box: (a, b) => ({ x: x + w, y: a, w: depth, h: b - a }) },
    };
    return WALL_SIDES.flatMap((side) => {
        const { from, to, box } = sides[side];
        const gaps = doorways.filter((d) => d.side === side).map((d) => [d.at, d.at + (d.width ?? 1)] as const);
        const cuts = [from, ...gaps.flat().sort((a, b) => a - b), to];
        const stretches: Rect[] = [];
        for (let i = 0; i + 1 < cuts.length; i += 2) {
            const [a = from, b = to] = [cuts[i], cuts[i + 1]];
            if (b > a) {
                stretches.push(box(a, b));
            }
        }
        // The masonry, and each doorway's passage through it paved as the building's floor: a threshold, not a hole.
        return [...stretches.map((r) => crispRegion(r, textures.wall, level)), ...gaps.map(([a, b]) => crispRegion(box(a, b), textures.floor, level))];
    });
}

/** `rect` laid crisp-edged in `texture`, as ground of `biome` (stone, unless said). */
const crispRegion = ({ x, y, w, h }: Rect, texture: string, level: { level?: string }, biome: BiomeKind = 'rock'): FeatureInput => ({
    type: 'region',
    biome,
    texture,
    sharp: true,
    points: [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
    ],
    ...level,
});

/** The storm door's areaway, walled on the top cellar with its door through, and the piece that joins it to the ground. */
function stormDoorFeatures(doorway: StormDoorway, building: BuildingIntent, called: string, levelOf: LevelOf): FeatureInput[] {
    const cellar = levelOf(-1);
    const areaway: FeatureInput = {
        ...roomSpec(doorway.areaway, [doorway.door], { floor: building.floor, wall: building.wall, wallKind: building.wallKind, ceiling: true }),
        key: `${called}:${AREAWAY}`,
        lit: true,
        ...cellar,
    };
    const { piece } = doorway;
    if (!piece) {
        return [areaway];
    }
    const joined: FeatureInput = {
        type: 'stamp',
        ...drawnAs(piece.stamp),
        x: piece.x,
        y: piece.y,
        rotation: piece.rotation,
        ...(piece.onGround ? levelOf(0) : cellar),
    };
    if (piece.onGround) {
        // Below the storm doors, what climbs up to them: drawn only, the doors' own region being the way between the levels.
        const { foot } = doorway;
        const climb: FeatureInput[] = foot
            ? [{ type: 'stamp', ...drawnAs(foot.stamp), x: foot.x, y: foot.y, rotation: foot.rotation, inert: true, ...cellar }]
            : [];
        return [areaway, joined, ...climb];
    }
    // Without storm door art, the flight stands below; on the ground the doors are boards over the areaway, so it is seen and found.
    return [areaway, joined, boardsOver(doorway.areaway, levelOf(0))];
}

/** The level key of each storey: cellars below (numbered down), the ground, floors above. */
function levelKey(storey: number): string {
    if (storey === 0) {
        return GROUND_LEVEL;
    }
    return storey > 0 ? `floor-${storey + 1}` : `${CELLAR_KEY}${-storey}`;
}

/** What a cellar level's key starts with. */
const CELLAR_KEY = 'cellar-';

/** The colour round a cellar's walls on a map with no backdrop: the dark of the earth it is dug into. */
const UNDERGROUND = '#0c0c0e';

/**
 * The scene's levels for a map whose deepest building has `depth` cellars
 * and tallest `height` floors, bottom to top: the cellars, then the scene's
 * own floor as the ground, then the floors above.
 */
function levelsFor(intent: MapIntent, depth: number, height: number): { key: string; name: string; existing?: boolean; visibleLevels?: string[] }[] {
    const cellars = Array.from({ length: depth }, (_, i) => {
        const n = depth - i;
        const named = intent.buildings.find((b) => b.cellars[n - 1]?.name !== undefined)?.cellars[n - 1]?.name;
        return { key: levelKey(-n), name: named ?? (n === 1 ? CELLAR_NAME : `${CELLAR_NAME} ${n}`) };
    });
    const floors = Array.from({ length: height }, (_, i) => {
        const named = intent.buildings.find((b) => b.floors[i]?.name !== undefined)?.floors[i]?.name ?? (i === 0 ? intent.platforms[0]?.name : undefined);
        // An upper storey sees the storeys below it down to the ground: the yard, the road, the ground floor's roofs round it.
        const below = Array.from({ length: i + 1 }, (_unused, storey) => levelKey(storey));
        return { key: levelKey(i + 1), name: named ?? `Floor ${i + 2}`, visibleLevels: below };
    });
    return [...cellars, { key: GROUND_LEVEL, name: GROUND_LEVEL_NAME, existing: true }, ...floors];
}

/** A cellar level's name when the intent gives none. */
const CELLAR_NAME = 'Cellar';

/** Offset from the map's seed of the outdoors' own random stream. */
const OUTDOOR_STREAM = 0x9e3779b9;

/** Offset from the map's seed of the moats' own random stream: their banks never move with anything else. */
const MOAT_STREAM = 0x85ebca6b;

/**
 * How dark each lighting leaves the scene, never with Foundry's global
 * light: by night lit by its lights alone; dim (an interior, the underhive)
 * half dark, each room lit by its own light and its lamps, the walls cutting
 * the light as Foundry casts it. By day the scene is left as it is.
 */
const LIGHTING_SCENE = {
    day: null,
    dim: { darkness: 0.55, globalLight: false },
    night: { darkness: 0.85, globalLight: false },
} as const;

/** A map out of doors: a battlemap with ground under it (a chart, or an interior on a bare scene, is not). */
function isOutdoor(intent: MapIntent): boolean {
    return intent.scale === 'battlemap' && intent.ground !== null;
}

/**
 * The scene's lighting. Out of doors, the day lights the scene: Foundry's
 * global light shines while the darkness is a day's (up to
 * DAYLIGHT_MAX_DARKNESS), so whatever drives the scene's darkness (a game
 * system's clock) brings day and night, and roofed rooms keep it out. Indoors
 * and on charts, as `lighting` says.
 */
function sceneLighting(lighting: MapIntent['lighting'], outdoor: boolean): SceneSettingsInput | null {
    const asked = LIGHTING_SCENE[lighting];
    if (!outdoor) {
        return asked;
    }
    return { ...(asked === null ? {} : { darkness: asked.darkness }), globalLight: true, globalLightDarkness: { min: 0, max: DAYLIGHT_MAX_DARKNESS } };
}

/** The ground level's key and name on a map with levels. */
const GROUND_LEVEL = 'ground';
const GROUND_LEVEL_NAME = 'Ground floor';

/** Compose `intent` with the stamps `stamps` offers, drawing each place's pieces from those `preferences` chose for it (none: any). */
export function composeMap(intent: MapIntent, loaded: RoleIndex, preferences: Preferences = NO_PREFERENCES): Composition {
    const random = seededRandom(intent.seed);
    // A role no loaded stamp fills still stands where it is wanted, as a labelled box its size.
    const stamps = withPlaceholders(loaded);
    const depth = Math.max(0, ...intent.buildings.map((b) => b.cellars.length));
    // A raised platform stands on the level above the ground.
    const height = Math.max(intent.platforms.length > 0 ? 1 : 0, ...intent.buildings.map((b) => b.floors.length));
    // A map with a building of more than one storey puts everything on levels: outside and the ground floors on the ground level.
    const layered = depth + height > 0;
    // A backdrop is each level's colour; a map of one storey then names the scene's own floor to carry it.
    const { backdrop } = intent;
    const bare = layered ? levelsFor(intent, depth, height) : backdrop === null ? [] : [{ key: GROUND_LEVEL, name: GROUND_LEVEL_NAME, existing: true }];
    // A cellar lies in the earth: round its walls is nothing to see, never the scene's grey, whatever the map's backdrop is.
    const levels = bare.map((l) => {
        const colour = backdrop ?? (l.key.startsWith(CELLAR_KEY) ? UNDERGROUND : null);
        return colour === null ? l : { ...l, backgroundColor: colour };
    });
    const levelOf: LevelOf = (storey) => (layered ? { level: levelKey(storey) } : {});
    const night = intent.lighting === 'night';
    const outdoor = isOutdoor(intent);
    const scene = sceneLighting(intent.lighting, outdoor);
    const composed = intent.buildings.map((building, i) => {
        const footprint = footprintOf(building, intent);
        return {
            building,
            footprint,
            ...composeBuilding(building, buildingName(building, i), footprint, { stamps, random, levelOf, night, preferences, depth, outdoor }),
        };
    });
    // Raised platforms over the ground, each with its stair up from it: after the buildings, so they move nothing in them.
    const platforms = platformFeatures(intent.platforms, { stamps, random, ground: levelOf(0), above: levelOf(1), below: depth > 0 });
    // Curtain walls round baileys and camps; nothing outdoors grows or stands on their masonry.
    const curtains = intent.curtains.flatMap((c) => curtainFeatures(c, levelOf(0)));
    const masonry = curtains.flatMap((f): Rect[] => (f.type === 'room' ? [boundsOf(f.points)] : []));
    // A curtain's moat is still water like any lake: its shore dressed, nothing growing in it.
    const moatRandom = seededRandom(intent.seed + MOAT_STREAM);
    const moats = intent.curtains.flatMap((c) =>
        moatOutlines(c, moatRandom).map(
            (points): ZoneIntent => ({ kind: 'lake', area: { shape: 'polygon', points }, density: 'normal', texture: null, soft: false }),
        ),
    );
    const exterior = composeExterior(
        { ...intent, zones: [...intent.zones, ...moats] },
        [
            ...composed.map(({ building, footprint, ground, annexes }) => ({
                key: building.key,
                footprint,
                front: ground?.doors.find((d) => d.to === null) ?? null,
                annexes,
                yard: building.yard,
            })),
            ...masonry.map((footprint) => ({ key: undefined, footprint, front: null, annexes: [], yard: false })),
        ],
        stamps,
        // Its own stream from the seed: rearranging a room never replants the woods outside.
        seededRandom(intent.seed + OUTDOOR_STREAM),
        preferences,
    );
    const outside = layered ? exterior.features.map((f) => ({ ...f, level: GROUND_LEVEL })) : exterior.features;
    // Heavy masonry round a building's footprint, over the ground outside and broken at its doorways out.
    const bands = composed.flatMap(({ building, footprint, ground }) =>
        building.wallBand === null
            ? []
            : wallBand(
                  footprint,
                  building.wallBand,
                  { wall: building.wall, floor: building.floor },
                  (ground?.doors ?? []).filter((d) => d.to === null).map((d) => d.slot),
                  levelOf(0),
              ),
    );
    // Passages hewn through the rock, walled along their ragged edges.
    // And the city's blocks, walled so none is walked into, their streets dressed against the frontages.
    const districts = intent.districts.map((d) => districtFeatures(d, stamps, random, levelOf(0)));
    const hewn = [...intent.hewn.flatMap((network) => hewnFeatures(network, intent, random, levelOf(0))), ...districts.flatMap((d) => d.features)];
    const streetBoxes = districts.flatMap((d) => d.boxed.map((piece) => ({ kind: 'placeholder' as const, piece, wantedIn: 'street' })));
    // Ways to other maps: over an edge a road runs off, over a place, or just inside a building's front door. The
    // intent's own check holds every place to one on the map, so only a way into a building left unbuilt (reported as
    // its rooms not fitting) goes without its zone.
    const ways = intent.key === undefined ? [] : linkFeatures(intent.key, intent.links, linkPlaces(intent, composed, exterior.paths), levelOf(0));
    // Ground first, then roads and rivers, then vegetation, then the buildings standing on it all.
    const features = drawPlaceholders([...outside, ...hewn, ...curtains, ...bands, ...composed.flatMap((c) => c.features), ...platforms.features, ...ways]);
    return {
        spec: { schemaVersion: SCENE_SPEC_SCHEMA_VERSION, units: 'grid', levels, features, ...(scene === null ? {} : { scene }) },
        problems: distinctProblems([...exterior.problems, ...streetBoxes, ...composed.flatMap((c) => c.problems), ...platforms.problems]),
    };
}

/** Where a map's ways can stand: its buildings' front doors, the roads laid on it and its named pieces outside. */
function linkPlaces(
    intent: MapIntent,
    composed: readonly { readonly building: BuildingIntent; readonly ground: BuildingLayout | null }[],
    paths: readonly LaidPath[],
): LinkPlaces {
    const fronts = new Map(
        composed.flatMap(({ building, ground }) => {
            const front = ground?.doors.find((d) => d.to === null);
            const room = front && ground?.rooms.find((r) => r.key === front.room);
            return building.key !== undefined && front && room ? [[building.key, { slot: front.slot, room: room.rect }] as const] : [];
        }),
    );
    const fixtures = new Map(intent.fixtures.map((f) => [f.name, { x: f.at.x - f.width / 2, y: f.at.y - f.height / 2, w: f.width, h: f.height }] as const));
    return { width: intent.width, height: intent.height, fronts, paths, fixtures };
}
