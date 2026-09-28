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
import type { Rect, Side } from '../generate/floor-plan';
import { roomSpec } from '../generate/floor-plan';
import { seededRandom, type Random } from '../generate/random';
import { SCENE_SPEC_SCHEMA_VERSION, type SceneSpecInput } from '../generate/spec';
import type { StampRole } from '../stamps/schema';
import { WALL_BAND_SQUARES } from '../tools/materials';
import { flightFor, type StormDoorway, stormDoorway } from './access';
import { composeExterior } from './exterior';
import { type Box, type ComposedStamp, furnishRoom, type RoomFloor } from './furnish';
import type { BuildingIntent, MapIntent } from './intent';
import { type BuildingLayout, doorsOf } from './layout';
import { NO_PREFERENCES, narrowedIndex, type Preferences, roomPlace } from './preferences';
import { type ComposeProblem, distinctProblems } from './problems';
import type { RoleIndex, RoleStamp } from './roles';
import { layOutStoreys, type Wells } from './storeys';

type FeatureInput = SceneSpecInput['features'][number];

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

const stampFeature = (s: ComposedStamp): FeatureInput => ({ type: 'stamp', stamp: s.stamp, x: s.x, y: s.y, rotation: s.rotation });

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
}

/** Roles whose pieces give light: a room holding one needs no light of its own by night. */
const LIGHT_SOURCES: readonly StampRole[] = ['light', 'hearth'];

/** One storey's rooms and furniture. */
function composeStorey(layout: BuildingLayout, context: StoreyContext): { features: FeatureInput[]; problems: ComposeProblem[] } {
    const { building, called, footprint, stamps, random, reserved, onLevel, night, preferences } = context;
    const roleOf = new Map([...stamps.values()].flat().map((s) => [s.key, s.role]));
    const problems: ComposeProblem[] = layout.unmet.map(([room, other]) => ({ kind: 'not-beside', building: called, room, other }));
    const rooms: FeatureInput[] = [];
    const furniture: FeatureInput[] = [];
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
        };
        const furnished = furnishRoom(floor, narrowedIndex(stamps, preferences.get(roomPlace(called, room.key))), random, reserved);
        const glows = furnished.stamps.some((s) => LIGHT_SOURCES.some((role) => roleOf.get(s.stamp) === role));
        const slots = layout.doors.flatMap((d) => (d.room === room.key ? [d.slot] : []));
        rooms.push({
            ...roomSpec(room.rect, slots, { floor: room.intent.floor ?? building.floor, wall: building.wall, wallKind: building.wallKind, ceiling: true }),
            key: `${called}:${room.key}`,
            // By night a room is lit by its hearth and lamps, not a flat light; one with neither keeps its own.
            lit: !(night && glows),
            ...onLevel,
        });
        furniture.push(...furnished.stamps.map((s) => ({ ...stampFeature(s), ...onLevel })));
        problems.push(...furnished.missing.map((role) => ({ kind: 'no-stamp' as const, role, wantedIn: `${called}/${room.key}` })));
        problems.push(...furnished.borrowed.map((role) => ({ kind: 'borrowed-art' as const, role, wantedIn: `${called}/${room.key}` })));
    }
    return { features: [...rooms, ...furniture], problems };
}

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
}

/** A way's flights, one on each storey but the top of its run, each in the lane beside the one below. */
function flights(stair: RoleStamp, well: Box, count: number, lowest: number, levelOf: LevelOf): FeatureInput[] {
    const lanes = stairLanes(count);
    return Array.from({ length: count }, (_, n): FeatureInput[] => {
        const x = well.x + (n % lanes) * stair.width + stair.width / 2;
        const y = well.y + well.h / 2;
        // Where it comes up, the floor above is open: a dark hatchway, framed, so the way down is seen from above.
        const opening: FeatureInput = {
            type: 'shape',
            kind: 'rectangle',
            x,
            y,
            width: stair.width,
            height: stair.height,
            stroke: OPENING.stroke,
            fill: OPENING.fill,
            ...levelOf(lowest + n + 1),
        };
        return [{ type: 'stamp', stamp: stair.key, x, y, rotation: stair.turn, ...levelOf(lowest + n) }, opening];
    }).flat();
}

/** How an opening in the floor above a flight is drawn: near black, framed in dark timber. */
const OPENING = {
    stroke: { colour: '#4a3220', width: 4, alpha: 1 },
    fill: { colour: '#140d08', alpha: 0.9 },
} as const;

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
    const { stamps, random, levelOf, night, preferences, depth } = map;
    // A flight must not open onto a level beneath where it climbs from: the map's cellar levels lie under every ground floor.
    const up = building.floors.length > 0 ? flightFor(building.floorAccess, stamps, random, { wantedIn: called, below: depth > 0 }) : null;
    const down =
        building.cellars.length > 0
            ? flightFor(building.cellarAccess, stamps, random, { wantedIn: `${called}/cellar`, below: depth > building.cellars.length })
            : null;
    const wells: Wells = { up: wellFor(up?.stair, building.floors.length), down: wellFor(down?.stair, building.cellars.length) };
    const storeys = layOutStoreys(building, footprint, wells, random);
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
    const reservedOn = (storey: number): Box[] => [...(storey >= 0 && stairwell ? [stairwell] : []), ...(storey <= 0 && cellarWell ? [cellarWell] : [])];
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
        features.push(...flights(up.stair, stairwell, building.floors.length, 0, levelOf));
    }
    if (down?.stair && cellarWell) {
        features.push(...flights(down.stair, cellarWell, building.cellars.length, -building.cellars.length, levelOf));
    }
    if (doorway) {
        features.push(...stormDoorFeatures(doorway, building, called, levelOf));
    }
    const porch = building.porch === null ? null : porchOf(storeys.ground, footprint, building.porch);
    if (porch) {
        const furnished = furnishRoom(porch.floor, narrowedIndex(stamps, preferences.get(roomPlace(called, PORCH))), random);
        features.push(boardsOver(porch.floor.rect, levelOf(0)), ...furnished.stamps.map((s) => ({ ...stampFeature(s), ...levelOf(0) })));
        problems.push(...furnished.missing.map((role) => ({ kind: 'no-stamp' as const, role, wantedIn: `${called}/${PORCH}` })));
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

const OPPOSITE_SIDE: Readonly<Record<Side, Side>> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

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
    return { floor: { key: PORCH, purpose: 'porch', rect: rects[side], doors: [{ side: wall, at: front.slot.at }], outer: unwalled, entrance: wall } };
}

/** Boards laid over `rect` on the ground, crisp-edged: a porch's deck, storm doors without their art. */
function boardsOver(rect: Rect, level: { level?: string }): FeatureInput {
    const { x, y, w, h } = rect;
    return {
        type: 'region',
        biome: 'dirt',
        texture: BOARDS,
        sharp: true,
        points: [
            { x, y },
            { x: x + w, y },
            { x: x + w, y: y + h },
            { x, y: y + h },
        ],
        ...level,
    };
}

/** The texture boards are drawn in outside: a porch's deck, storm doors without their art. */
const BOARDS = 'floor.wooden-planks';

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
        stamp: piece.stamp.key,
        x: piece.x,
        y: piece.y,
        rotation: piece.rotation,
        ...(piece.onGround ? levelOf(0) : cellar),
    };
    if (piece.onGround) {
        return [areaway, joined];
    }
    // Without storm door art, the flight stands below; on the ground the doors are boards over the areaway, so it is seen and found.
    return [areaway, joined, boardsOver(doorway.areaway, levelOf(0))];
}

/** The level key of each storey: cellars below (numbered down), the ground, floors above. */
function levelKey(storey: number): string {
    if (storey === 0) {
        return GROUND_LEVEL;
    }
    return storey > 0 ? `floor-${storey + 1}` : `cellar-${-storey}`;
}

/**
 * The scene's levels for a map whose deepest building has `depth` cellars
 * and tallest `height` floors, bottom to top: the cellars, then the scene's
 * own floor as the ground, then the floors above.
 */
function levelsFor(intent: MapIntent, depth: number, height: number): { key: string; name: string; existing?: boolean }[] {
    const cellars = Array.from({ length: depth }, (_, i) => {
        const n = depth - i;
        const named = intent.buildings.find((b) => b.cellars[n - 1]?.name !== undefined)?.cellars[n - 1]?.name;
        return { key: levelKey(-n), name: named ?? (n === 1 ? CELLAR_NAME : `${CELLAR_NAME} ${n}`) };
    });
    const floors = Array.from({ length: height }, (_, i) => {
        const named = intent.buildings.find((b) => b.floors[i]?.name !== undefined)?.floors[i]?.name;
        return { key: levelKey(i + 1), name: named ?? `Floor ${i + 2}` };
    });
    return [...cellars, { key: GROUND_LEVEL, name: GROUND_LEVEL_NAME, existing: true }, ...floors];
}

/** A cellar level's name when the intent gives none. */
const CELLAR_NAME = 'Cellar';

/** A night scene: dark, and lit only by its lights, never Foundry's global light. */
const NIGHT = { darkness: 0.85, globalLight: false } as const;

/** The ground level's key and name on a map with levels. */
const GROUND_LEVEL = 'ground';
const GROUND_LEVEL_NAME = 'Ground floor';

/** Compose `intent` with the stamps `stamps` offers, drawing each place's pieces from those `preferences` chose for it (none: any). */
export function composeMap(intent: MapIntent, stamps: RoleIndex, preferences: Preferences = NO_PREFERENCES): Composition {
    const random = seededRandom(intent.seed);
    const depth = Math.max(0, ...intent.buildings.map((b) => b.cellars.length));
    const height = Math.max(0, ...intent.buildings.map((b) => b.floors.length));
    // A map with a building of more than one storey puts everything on levels: outside and the ground floors on the ground level.
    const layered = depth + height > 0;
    const levels = layered ? levelsFor(intent, depth, height) : [];
    const levelOf: LevelOf = (storey) => (layered ? { level: levelKey(storey) } : {});
    const night = intent.lighting === 'night';
    const composed = intent.buildings.map((building, i) => {
        const footprint = footprintOf(building, intent);
        return {
            building,
            footprint,
            ...composeBuilding(building, buildingName(building, i), footprint, { stamps, random, levelOf, night, preferences, depth }),
        };
    });
    const exterior = composeExterior(
        intent,
        composed.map(({ building, footprint, ground, annexes }) => ({
            key: building.key,
            footprint,
            front: ground?.doors.find((d) => d.to === null) ?? null,
            annexes,
            yard: building.yard,
        })),
        stamps,
        random,
        preferences,
    );
    const outside = layered ? exterior.features.map((f) => ({ ...f, level: GROUND_LEVEL })) : exterior.features;
    // Ground first, then roads and rivers, then vegetation, then the buildings standing on it all.
    const features = [...outside, ...composed.flatMap((c) => c.features)];
    return {
        spec: { schemaVersion: SCENE_SPEC_SCHEMA_VERSION, units: 'grid', levels, features, ...(night ? { scene: NIGHT } : {}) },
        problems: distinctProblems([...exterior.problems, ...composed.flatMap((c) => c.problems)]),
    };
}
