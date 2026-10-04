// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The declarative core of document generation. `planDocuments` states which
 * native documents a feature should have, as pure data. The controller
 * realises that plan through the document sink and records the ids it gets
 * back on the feature. Nothing that creates a document decides anything, so a
 * feature is fully described by the feature itself plus its scene context
 * (the other features and the levels): the declarative-first rule.
 */
import { brushOutline, RIBBON_SAMPLES } from '../geometry/ribbon';
import { catmullRom, distanceToSegment, type Point } from '../geometry/spline';
import { cutSegment, perimeterSegments, type Segment, splitSegment } from '../geometry/wall';
import type { StampLight } from '../stamps/schema';
import { type Affected, customDisplay, displayOf, effectsOf } from './area-effects';
import { daylightLights } from './daylight';
import {
    BLOCKS_ALL,
    type DrawingDoc,
    type LightDoc,
    type NoteDoc,
    type RegionDoc,
    type SenseBlock,
    senseLevel,
    type SoundDoc,
    type TileDoc,
    type WallDoc,
    type WallThreshold,
} from './documents';
import { doorOpenings, OPENING_TOLERANCE, stampDoorState } from './doors';
import type { Feature } from './feature';
import { labelBox, labelPoint, labelSettingsOf } from './label';
import { adjacentLevel, findLevel, levelElevation, type Level } from './levels';
import type { CartographyPath } from './path';
import { MIN_NOTE_SIZE, NEW_PIN, pinPoint, pinSettingsOf } from './pin';
import { regionOutline, type RegionFeature } from './region';
import { roomDoorLook, roomLight, roomWalls, type RoomDoor, type RoomFeature } from './room';
import { shapeBox } from './shape';
import { customSpawn, spawnOf } from './spawn';
import { stableId } from './stable-id';
import { stampCentre, stampCorners, stampDoorAxis, stampPoint, type StampFeature } from './stamp';
import type { StrokeFeature } from './stroke';
import { SWITCH_BLOCKS } from './switches';
import { type Costed, movementCostOf, NORMAL_COST } from './terrain-cost';
import { type PresetWall, presetWall, type WallPreset } from './wall-presets';
import { type ZoneFeature, zonePoint } from './zone';

export interface DocumentPlan {
    readonly walls: readonly WallDoc[];
    readonly lights: readonly LightDoc[];
    readonly tiles: readonly TileDoc[];
    readonly regions: readonly RegionDoc[];
    readonly sounds: readonly SoundDoc[];
    readonly notes: readonly NoteDoc[];
    readonly drawings: readonly DrawingDoc[];
}

/** A plan with no documents. */
export const NO_PLAN: DocumentPlan = { walls: [], lights: [], tiles: [], regions: [], sounds: [], notes: [], drawings: [] };

/** What a feature's plan may depend on besides the feature itself. */
export interface PlanContext {
    readonly features: readonly Feature[];
    readonly levels: readonly Level[];
    /** Whether terrain (biome regions and brush strokes) is mirrored as Scene Regions. */
    readonly terrainRegions: boolean;
    /** Scene distance units per grid square, turning stamp heights (grid units) into elevations; 0: unknown. */
    readonly gridDistance: number;
}

const NO_CONTEXT: PlanContext = { features: [], levels: [], terrainRegions: false, gridDistance: 0 };

/** Where a feature's documents go: its level, and that level's floor elevation. */
interface Floor {
    readonly level: string | null;
    readonly elevation: number;
}

function floorOf(feature: Feature, context: PlanContext): Floor {
    return { level: feature.level, elevation: levelElevation(context.levels, feature.level) };
}

/** Plain walls along a path's smoothed centerline. */
function pathWalls(path: CartographyPath, kind: WallPreset, floor: Floor): WallDoc[] {
    const spine = catmullRom(path.points, RIBBON_SAMPLES);
    const { blocks, threshold } = presetWall(kind);
    const walls: WallDoc[] = [];
    for (let i = 1; i < spine.length; i++) {
        const a = spine[i - 1];
        const b = spine[i];
        if (a && b) {
            const wall: WallDoc = { a, b, door: 'none', doorState: 'closed', blocks, level: floor.level };
            walls.push(threshold === undefined ? wall : { ...wall, threshold });
        }
    }
    return walls;
}

/**
 * How far above its base an overhead stamp's tile hangs (a roof, a tree's
 * crown): its physical height, in scene distance units. Foundry fades or
 * cuts round a tile only over a token below its elevation, so a tile that
 * gives way to tokens must hang above them; anything else lies at its base.
 */
function overhead(stamp: StampFeature, gridDistance: number): number {
    const modes = stamp.behaviour.tile?.occlusion?.modes ?? [];
    return modes.length === 0 ? 0 : (stamp.behaviour.physical?.height ?? 0) * gridDistance;
}

/** A stamp's own tile, as its unrotated top-left, rotated about its centre (the boundary anchors it for v14). */
function stampTile(stamp: StampFeature, floor: Floor, context: { readonly levels: readonly Level[]; readonly gridDistance: number }): TileDoc {
    const c = stampCentre(stamp);
    // Foundry draws a tile only on its own levels: it shows too on those that see its level below them.
    const own = floor.level;
    const seenFrom = own === null ? [] : context.levels.filter((level) => level.art.visibleLevels.includes(own)).map((level) => level.id);
    return {
        name: stamp.name,
        src: stamp.src,
        x: c.x - stamp.width / 2,
        y: c.y - stamp.height / 2,
        width: stamp.width,
        height: stamp.height,
        rotation: stamp.rotation,
        elevation: floor.elevation + stamp.elevation + overhead(stamp, context.gridDistance),
        level: floor.level,
        ...(seenFrom.length > 0 ? { seenFrom } : {}),
        featureId: stamp.id,
        ...(stamp.behaviour.tile === null || stamp.behaviour.tile === undefined ? {} : { look: stamp.behaviour.tile }),
        ...(stamp.mirror ? { mirror: true } : {}),
    };
}

/** A pack light's rendering and reach; nothing when it declares none. */
function lightTechnique(light: StampLight): Partial<Pick<LightDoc, 'technique'>> {
    const { negative, priority, coloration, luminosity, attenuation, saturation, contrast, shadows, walls, vision, darkness, hidden } = light;
    const technique = { negative, priority, coloration, luminosity, attenuation, saturation, contrast, shadows, walls, vision, darkness, hidden };
    return Object.values(technique).every((value) => value === undefined) ? {} : { technique };
}

/** A pack animation with its absent optional fields dropped rather than carried as undefined. */
function animationDoc(animation: NonNullable<StampLight['animation']>): NonNullable<LightDoc['animation']> {
    return {
        type: animation.type,
        ...(animation.speed === undefined ? {} : { speed: animation.speed }),
        ...(animation.intensity === undefined ? {} : { intensity: animation.intensity }),
    };
}

/** Where an unoffset light sits: the footprint centre. */
const CENTRE: Point = { x: 0.5, y: 0.5 };

/**
 * The stamp's light, if its current variant emits one. Radii go from grid units
 * to px. A cone turns with the stamp: at rotation 0 it faces Foundry's default
 * direction, and the stamp's rotation is added to that.
 */
function stampLight(stamp: StampFeature, floor: Floor): LightDoc | null {
    const light = stamp.behaviour.light;
    if (!light) {
        return null;
    }
    const at = stampPoint(stamp, light.offset ?? CENTRE);
    return {
        source: { kind: 'stamp', name: stamp.name },
        x: at.x,
        y: at.y,
        dim: light.dim * stamp.gridSize,
        bright: light.bright * stamp.gridSize,
        ...(light.color === undefined ? {} : { color: light.color }),
        ...(light.alpha === undefined ? {} : { alpha: light.alpha }),
        ...(light.angle === undefined ? {} : { angle: light.angle, rotation: stamp.rotation }),
        ...(light.animation === undefined ? {} : { animation: animationDoc(light.animation) }),
        ...lightTechnique(light),
        elevation: floor.elevation + stamp.elevation,
        level: floor.level,
    };
}

/** A pack threshold with its absent fields dropped rather than carried as undefined. */
function thresholdDoc(threshold: NonNullable<NonNullable<StampFeature['behaviour']['occlusion']>['threshold']>): WallThreshold {
    return {
        ...(threshold.light === undefined ? {} : { light: threshold.light }),
        ...(threshold.sight === undefined ? {} : { sight: threshold.sight }),
        ...(threshold.sound === undefined ? {} : { sound: threshold.sound }),
        ...(threshold.attenuation === undefined ? {} : { attenuation: threshold.attenuation }),
    };
}

/**
 * Walls wrapping the stamp per its occlusion: its rotated footprint (`bounds`),
 * or its traced silhouette (`alpha`, falling back to the footprint when the
 * image could not be traced). Walls that block nothing are not created.
 */
function stampWalls(stamp: StampFeature, floor: Floor): WallDoc[] {
    const occlusion = stamp.behaviour.occlusion;
    if (!occlusion || occlusion.shape === 'none') {
        return [];
    }
    const blocks: SenseBlock = {
        sight: senseLevel(occlusion.sight),
        movement: occlusion.movement,
        light: senseLevel(occlusion.light),
        sound: senseLevel(occlusion.sound),
    };
    if (blocks.sight === 'none' && !blocks.movement && blocks.light === 'none' && blocks.sound === 'none') {
        return [];
    }
    const shape = {
        ...(occlusion.direction === undefined ? {} : { direction: occlusion.direction }),
        ...(occlusion.threshold === undefined ? {} : { threshold: thresholdDoc(occlusion.threshold) }),
    };
    const loops =
        occlusion.shape === 'alpha' && stamp.silhouette ? stamp.silhouette.map((loop) => loop.map((f) => stampPoint(stamp, f))) : [stampCorners(stamp)];
    // Its ways in (a lowered ramp, a hatch, a door drawn on the art) are gaps in its walls: nothing traps a token.
    const gaps = wayGaps(stamp);
    return loops.flatMap((loop) =>
        perimeterSegments(loop)
            .flatMap((s) => withoutGaps(s, gaps))
            .map((s) => ({ a: s.a, b: s.b, door: 'none' as const, doorState: 'closed' as const, blocks, ...shape, level: floor.level })),
    );
}

/** A circle a stamp's walls stay out of: centred on one of its ways in, as wide as it. */
interface Gap {
    readonly centre: Point;
    readonly radius: number;
}

/** The gaps a stamp's ways in leave in its walls, in scene points (its rotation and scale applied). */
export function wayGaps(stamp: StampFeature): Gap[] {
    return (stamp.behaviour.ways ?? []).map((way) => {
        const from = stampPoint(stamp, { x: way.x - way.width / 2, y: way.y });
        const to = stampPoint(stamp, { x: way.x + way.width / 2, y: way.y });
        return { centre: stampPoint(stamp, { x: way.x, y: way.y }), radius: Math.hypot(to.x - from.x, to.y - from.y) / 2 };
    });
}

/** Squares of a segment left when trimmed shorter than this are dropped: no sliver of wall stands in a gap. */
const SLIVER = 1e-6;

/** The parts of the segment from `a` to `b` outside every gap. */
export function withoutGaps(segment: { readonly a: Point; readonly b: Point }, gaps: readonly Gap[]): { a: Point; b: Point }[] {
    let pieces: { a: Point; b: Point }[] = [{ a: segment.a, b: segment.b }];
    for (const gap of gaps) {
        pieces = pieces.flatMap((piece) => {
            const d = { x: piece.b.x - piece.a.x, y: piece.b.y - piece.a.y };
            const f = { x: piece.a.x - gap.centre.x, y: piece.a.y - gap.centre.y };
            const dd = d.x * d.x + d.y * d.y;
            const fd = f.x * d.x + f.y * d.y;
            const disc = fd * fd - dd * (f.x * f.x + f.y * f.y - gap.radius * gap.radius);
            if (dd === 0 || disc <= 0) {
                return [piece];
            }
            const root = Math.sqrt(disc);
            const enter = Math.max(0, (-fd - root) / dd);
            const leave = Math.min(1, (-fd + root) / dd);
            if (enter >= leave) {
                return [piece];
            }
            const at = (t: number): Point => ({ x: piece.a.x + d.x * t, y: piece.a.y + d.y * t });
            return [...(enter > SLIVER ? [{ a: piece.a, b: at(enter) }] : []), ...(leave < 1 - SLIVER ? [{ a: at(leave), b: piece.b }] : [])];
        });
    }
    return pieces;
}

/** A door stamp's own door wall, along its axis, in the state its variant shows. */
function stampDoorWall(stamp: StampFeature, floor: Floor): WallDoc | null {
    const door = stamp.behaviour.door;
    if (!door) {
        return null;
    }
    const axis = stampDoorAxis(stamp);
    const look = { sound: door.sound ?? null, animation: door.animation ?? null };
    const wall: WallDoc = { a: axis.a, b: axis.b, door: door.type, doorState: stampDoorState(stamp), look, blocks: BLOCKS_ALL, level: floor.level };
    // A light switch's wall only carries the door control players click; it blocks nothing.
    return door.switch === true ? { ...wall, blocks: SWITCH_BLOCKS, lightSwitch: true } : wall;
}

/**
 * A transition stamp's way between floors: one native `changeLevel` region
 * over its footprint, on its own level and each level it reaches (those
 * above for `up`, below for `down`, both for `both`, as many each way as its
 * `reach`), spanning their
 * elevation bands. A token entering it on any of those levels is offered the
 * others. With no level to reach (none above/below, or the stamp is on no
 * level), nothing is planned.
 */
function transitionRegions(stamp: StampFeature, levels: readonly Level[]): RegionDoc[] {
    const transition = stamp.behaviour.transition;
    const here = findLevel(levels, stamp.level);
    if (!transition || !here) {
        return [];
    }
    const steps = Array.from({ length: stamp.reach }, (_, n) => n + 1);
    const ends = [
        ...(transition.direction === 'down' ? [] : steps.map((n) => adjacentLevel(levels, here.id, n))),
        ...(transition.direction === 'up' ? [] : steps.map((n) => adjacentLevel(levels, here.id, -n))),
    ].filter((level): level is Level => level !== null);
    return joiningRegions(stamp, transition.kind, here, ends, transition.movement ?? []);
}

/**
 * A `changeLevel` region over a stamp's footprint joining its own level to
 * `ends`, spanning all their bands, taken by the movement actions in
 * `movement` (none: any); none when there is nowhere to go.
 */
function joiningRegions(
    stamp: StampFeature,
    kind: NonNullable<StampFeature['behaviour']['transition']>['kind'],
    here: Level,
    ends: readonly Level[],
    movement: readonly string[],
): RegionDoc[] {
    if (ends.length === 0) {
        return [];
    }
    const joined = [here, ...ends];
    return [
        {
            id: null,
            label: { kind, from: here.name, to: ends.map((end) => end.name) },
            polygon: stampCorners(stamp),
            bottom: Math.min(...joined.map((level) => level.bottom)),
            top: Math.max(...joined.map((level) => level.top)),
            level: here.id,
            spans: ends.map((end) => end.id),
            behaviour: { kind: 'changeLevel', movement },
        },
    ];
}

/**
 * A building with its floors in this scene: stairs over its footprint from
 * its own level to every one of its floors still on the scene. A building on
 * no level has no floor to climb from, and gets none.
 */
function buildingStairs(stamp: StampFeature, levels: readonly Level[]): RegionDoc[] {
    const here = findLevel(levels, stamp.level);
    const floors = stamp.floors.map((id) => findLevel(levels, id)).filter((level): level is Level => level !== null);
    return here ? joiningRegions(stamp, 'stairs', here, floors, []) : [];
}

/**
 * A linked stamp's entrances, each teleporting to the interior's exit: over
 * each of its ways in (the shuttle's two side ramps; the first keeps the
 * link's fixed id, which the exit leads back to, the rest ids derived from
 * it), or over its whole footprint where its art has none.
 */
function entranceRegions(stamp: StampFeature, levels: readonly Level[]): RegionDoc[] {
    const link = stamp.submap;
    if (!link) {
        return [];
    }
    const band = findLevel(levels, stamp.level);
    const gaps = wayGaps(stamp);
    const squares =
        gaps.length === 0
            ? [stampCorners(stamp)]
            : gaps.map(({ centre: c, radius: r }) => [
                  { x: c.x - r, y: c.y - r },
                  { x: c.x + r, y: c.y - r },
                  { x: c.x + r, y: c.y + r },
                  { x: c.x - r, y: c.y + r },
              ]);
    return squares.map((polygon, i) => ({
        id: i === 0 ? link.entryRegion : nthEntranceId(link.entryRegion, i),
        label: { kind: 'entrance', scene: link.sceneName },
        polygon,
        bottom: band?.bottom ?? null,
        top: band?.top ?? null,
        level: stamp.level,
        spans: [],
        behaviour: { kind: 'teleport', targets: [{ scene: link.scene, region: link.exitRegion }], travel: link.travel },
    }));
}

/** The id of a linked stamp's `n`th entrance after its first, derived from the first's so a re-sync keeps it. */
export const nthEntranceId = (first: string, n: number): string => stableId(`entrance:${first}:${String(n)}`);

/** A stamp's region band: its level's, or open-ended when it stands on no level. */
function levelBand(stamp: StampFeature, levels: readonly Level[]): { readonly bottom: number | null; readonly top: number | null } {
    const band = findLevel(levels, stamp.level);
    return { bottom: band?.bottom ?? null, top: band?.top ?? null };
}

/** Difficult terrain over the stamp's footprint (rubble, mud), on its level, as its variant declares. */
function stampTerrainRegion(stamp: StampFeature, levels: readonly Level[]): RegionDoc | null {
    const terrain = stamp.behaviour.terrain;
    if (!terrain || Object.keys(terrain.difficulty).length === 0) {
        return null;
    }
    return {
        id: null,
        label: { kind: 'stamp-terrain', name: stamp.name },
        polygon: stampCorners(stamp),
        ...levelBand(stamp, levels),
        level: stamp.level,
        spans: [],
        behaviour: { kind: 'terrain', difficulties: terrain.difficulty },
    };
}

/**
 * A stamp that harms what comes near (an open fire, a vat of acid, a live
 * reactor): a region over its footprint and its reach round it, warning a
 * token coming in of the harm, where the GM adds what the game system deals.
 */
function stampHazardRegion(stamp: StampFeature, levels: readonly Level[]): RegionDoc | null {
    const hazard = stamp.behaviour.hazard;
    if (!hazard) {
        return null;
    }
    const corners = stampCorners(stamp);
    const reach = hazard.reach * stamp.gridSize;
    const [xs, ys] = [corners.map((c) => c.x), corners.map((c) => c.y)];
    const [west, east, north, south] = [Math.min(...xs) - reach, Math.max(...xs) + reach, Math.min(...ys) - reach, Math.max(...ys) + reach];
    return {
        id: null,
        label: { kind: 'stamp-hazard', name: stamp.name },
        polygon: [
            { x: west, y: north },
            { x: east, y: north },
            { x: east, y: south },
            { x: west, y: south },
        ],
        ...levelBand(stamp, levels),
        level: stamp.level,
        spans: [],
        behaviour: { kind: 'hazard', hazard: hazard.kind },
    };
}

/**
 * An armed trap (a pressure plate, a spike pit): a region over its footprint
 * that pauses the game the first time a token moves in, for the GM to spring
 * it; its tile is hidden from players until then (see `behaviourOf`).
 */
function stampTrapRegion(stamp: StampFeature, levels: readonly Level[]): RegionDoc | null {
    if (stamp.behaviour.trap !== true) {
        return null;
    }
    return {
        id: null,
        label: { kind: 'stamp-trap', name: stamp.name },
        polygon: stampCorners(stamp),
        ...levelBand(stamp, levels),
        level: stamp.level,
        spans: [],
        behaviour: null,
        effects: [{ kind: 'pause', once: true }],
    };
}

/**
 * A stamp whose body tokens cannot pass (a boulder, a pillar): walls round its
 * footprint that bar movement alone (Foundry's Invisible Wall), so it hides
 * and lights nothing. What bars movement in v14 is a wall; a region
 * restriction only clips the region's own shape to walls. A stamp whose
 * occlusion walls already bar movement needs none.
 */
function stampBodyWalls(stamp: StampFeature, floor: Floor): WallDoc[] {
    const occlusion = stamp.behaviour.occlusion;
    const walled = occlusion !== null && occlusion.shape !== 'none' && occlusion.movement;
    if (stamp.behaviour.physical?.blocksMovement !== true || walled) {
        return [];
    }
    const { blocks } = presetWall('invisible');
    // Round its traced outline where it has one, and open at its ways in, as its occlusion walls are.
    const loops = stamp.silhouette ? stamp.silhouette.map((loop) => loop.map((f) => stampPoint(stamp, f))) : [stampCorners(stamp)];
    const gaps = wayGaps(stamp);
    return loops.flatMap((loop) =>
        perimeterSegments(loop)
            .flatMap((s) => withoutGaps(s, gaps))
            .map((s): WallDoc => ({ a: s.a, b: s.b, door: 'none', doorState: 'closed', blocks, level: floor.level })),
    );
}

/** A cover wall restricts nothing: a table is seen, lit, heard and climbed across; it is only graded as cover. */
const OPEN_BLOCKS: SenseBlock = { sight: 'none', movement: false, light: 'none', sound: 'none' };

/**
 * A low piece that gives cover but bars nothing (a table, a pew, rubble):
 * walls round its footprint that restrict nothing, each carrying its cover
 * grade for the game system's cover check, which grades an attack by the
 * walls it crosses. A piece walled against movement already stops those
 * rays, and needs none.
 */
function stampCoverWalls(stamp: StampFeature, floor: Floor): WallDoc[] {
    const cover = stamp.behaviour.physical?.cover;
    const occlusion = stamp.behaviour.occlusion;
    const barred = stamp.behaviour.physical?.blocksMovement === true || (occlusion !== null && occlusion.shape !== 'none' && occlusion.movement);
    if (cover === undefined || cover <= 0 || barred) {
        return [];
    }
    return perimeterSegments(stampCorners(stamp)).map((s) => ({
        a: s.a,
        b: s.b,
        door: 'none',
        doorState: 'closed',
        blocks: OPEN_BLOCKS,
        level: floor.level,
        cover,
    }));
}

/**
 * A stamp's Define Surface (a roof, a balcony, a raised floor) over its
 * footprint. Its band runs from the stamp's base up its physical height, so
 * a `top` surface is its roof; a stamp of unknown height takes its level's
 * band, putting a roof at the level's ceiling. A stamp with neither has no
 * band to put a surface on, and gets none.
 */
function stampSurfaceRegion(stamp: StampFeature, levels: readonly Level[], gridDistance: number, floor: Floor): RegionDoc | null {
    const surface = stamp.behaviour.surface;
    if (!surface) {
        return null;
    }
    const height = stamp.behaviour.physical?.height;
    const base = floor.elevation + stamp.elevation;
    const band = height !== undefined && gridDistance > 0 ? { bottom: base, top: base + height * gridDistance } : levelBand(stamp, levels);
    if (band.bottom === null || band.top === null) {
        return null;
    }
    return {
        id: null,
        label: { kind: 'stamp-surface', name: stamp.name },
        polygon: stampCorners(stamp),
        ...band,
        level: stamp.level,
        spans: [],
        behaviour: { kind: 'surface', placement: surface.placement, reveal: surface.reveal },
    };
}

/** The stamp's ambient sound, if its current variant emits one. The radius goes from grid units to px. */
function stampSound(stamp: StampFeature, floor: Floor): SoundDoc | null {
    const sound = stamp.behaviour.sound;
    if (sound === null || sound === undefined) {
        return null;
    }
    const at = stampPoint(stamp, sound.offset ?? CENTRE);
    return {
        name: stamp.name,
        x: at.x,
        y: at.y,
        radius: sound.radius * stamp.gridSize,
        path: sound.path,
        volume: sound.volume,
        repeat: sound.repeat,
        walls: sound.walls,
        easing: sound.easing,
        elevation: floor.elevation + stamp.elevation,
        level: floor.level,
    };
}

function stampPlan(stamp: StampFeature, context: PlanContext): DocumentPlan {
    const floor = floorOf(stamp, context);
    const light = stampLight(stamp, floor);
    const sound = stampSound(stamp, floor);
    const door = stampDoorWall(stamp, floor);
    return {
        ...NO_PLAN,
        walls: [...(door ? [door] : []), ...stampWalls(stamp, floor), ...stampBodyWalls(stamp, floor), ...stampCoverWalls(stamp, floor)],
        tiles: [stampTile(stamp, floor, context)],
        lights: light ? [light] : [],
        regions: [
            ...transitionRegions(stamp, context.levels),
            ...buildingStairs(stamp, context.levels),
            ...entranceRegions(stamp, context.levels),
            ...[
                stampTerrainRegion(stamp, context.levels),
                stampHazardRegion(stamp, context.levels),
                stampTrapRegion(stamp, context.levels),
                stampSurfaceRegion(stamp, context.levels, context.gridDistance, floor),
            ].filter((r): r is RegionDoc => r !== null),
        ],
        sounds: sound ? [sound] : [],
        notes: stampReading(stamp, floor),
    };
}

/**
 * What players read on a stamp: a readable Note at its centre, its hover spot
 * as wide as the footprint is long, so hovering anywhere along a sign shows
 * its words (a thin sign's own depth would leave a spot too small to find).
 */
function stampReading(stamp: StampFeature, floor: Floor): NoteDoc[] {
    if (stamp.reads === null) {
        return [];
    }
    const size = Math.max(MIN_NOTE_SIZE, Math.round(Math.max(stamp.width, stamp.height)));
    const reading = { ...NEW_PIN, text: stamp.reads, readable: true, size, hidden: stamp.readsHidden };
    return [{ ...stampCentre(stamp), elevation: floor.elevation + stamp.elevation, level: floor.level, ...reading }];
}

/**
 * A room's floor, when it stands on a level with another below: a solid,
 * flat surface over the room at its level's base, on both levels, so the room
 * cannot be seen, heard, lit or walked into from beneath, and hides what is
 * below from those standing in it. A room on the lowest level, or on none,
 * stands on the ground and has no floor region.
 */
function roomFloor(room: RoomFeature, levels: readonly Level[]): RegionDoc | null {
    const here = findLevel(levels, room.level);
    const below = here ? adjacentLevel(levels, here.id, -1) : null;
    if (!here || !below) {
        return null;
    }
    return {
        id: null,
        label: { kind: 'floor', level: here.name },
        polygon: room.points,
        bottom: here.bottom,
        top: here.bottom,
        level: here.id,
        spans: [below.id],
        behaviour: { kind: 'surface', placement: 'bottom', reveal: false },
    };
}

/**
 * A room's ceiling, when it has one and another level stands above: a solid,
 * flat surface over the room at its level's top, on both levels, so nothing
 * above sees, hears, lights or drops into the room, and those in it cannot
 * see up. The room's own `ceiling` leaves it out for an open courtyard.
 */
function roomCeiling(room: RoomFeature, levels: readonly Level[]): RegionDoc | null {
    const here = room.ceiling ? findLevel(levels, room.level) : null;
    const above = here ? adjacentLevel(levels, here.id, 1) : null;
    if (!here || !above) {
        return null;
    }
    return {
        id: null,
        label: { kind: 'ceiling', level: here.name },
        polygon: room.points,
        bottom: here.top,
        top: here.top,
        level: here.id,
        spans: [above.id],
        behaviour: { kind: 'surface', placement: 'top', reveal: false },
    };
}

/** A stretch of room wall, as a door if `door` is set, none where it is an opening; tagged with the perimeter segment it comes from. */
function roomWallDoc(part: Segment, door: RoomDoor | null, segment: number, level: string | null, kind: PresetWall): WallDoc | null {
    if (door?.type === 'opening') {
        return null;
    }
    if (door !== null) {
        // A door is a door, whatever the walls around it are: it blocks everything while shut.
        return { a: part.a, b: part.b, door: door.type, doorState: door.state, look: roomDoorLook(door), blocks: BLOCKS_ALL, level, segment };
    }
    const wall: WallDoc = { a: part.a, b: part.b, door: 'none', doorState: 'closed', blocks: kind.blocks, level, segment };
    return kind.threshold === undefined ? wall : { ...wall, threshold: kind.threshold };
}

/** What a shared stretch is, given this room's door on it and the later room's: a door either marks, else an opening either marks, else wall. */
function stretchDoor(own: RoomDoor | null, covering: RoomDoor | null): RoomDoor | null {
    return [own, covering].find((d) => d !== null && d.type !== 'opening') ?? own ?? covering;
}

/**
 * A room's perimeter walls, sharing edges with its neighbours on the same floor
 * without doubling them:
 * - door-stamp openings are cut out (the stamps supply those door walls);
 * - a stretch shared with an earlier room is cut out, because the earlier room
 *   owns it;
 * - a stretch this room owns is a door if either room marks it as one, else
 *   left open (no wall) if either marks it an opening.
 */
function roomPlan(room: RoomFeature, context: PlanContext): DocumentPlan {
    const floor = floorOf(room, context);
    const light = roomLight(room);
    const sameFloor = context.features.filter((f) => f.level === room.level && f.id !== room.id);
    const order = new Map(context.features.map((f, i) => [f.id, i]));
    const here = order.get(room.id) ?? Number.POSITIVE_INFINITY;
    const rooms = sameFloor.filter((f): f is RoomFeature => f.type === 'room');
    const owned = rooms.filter((r) => (order.get(r.id) ?? 0) < here).flatMap((r) => perimeterSegments(r.points));
    const laterDoors = rooms.filter((r) => (order.get(r.id) ?? 0) > here).flatMap((r) => roomWalls(r).filter((w) => w.door !== null));
    const cuts = [...doorOpenings(sameFloor), ...owned];
    /** The later room's door lying over a covered stretch. */
    const coveringDoor = (part: Segment): RoomDoor | null => {
        const mid = { x: (part.a.x + part.b.x) / 2, y: (part.a.y + part.b.y) / 2 };
        return laterDoors.find((w) => distanceToSegment(mid, w.a, w.b) <= OPENING_TOLERANCE)?.door ?? null;
    };
    return {
        ...NO_PLAN,
        walls: roomWalls(room).flatMap((wall) =>
            cutSegment(wall, cuts, OPENING_TOLERANCE).flatMap((piece) =>
                splitSegment(piece, laterDoors, OPENING_TOLERANCE).flatMap((part) => {
                    const doc = roomWallDoc(
                        part,
                        stretchDoor(wall.door, part.covered ? coveringDoor(part) : null),
                        wall.segment,
                        floor.level,
                        presetWall(room.windows.includes(wall.segment) ? 'window' : room.wallKind),
                    );
                    return doc === null ? [] : [doc];
                }),
            ),
        ),
        // Its own light (switched by `lit`), and the day through its windows and outer doors, which no switch turns off.
        lights: [
            ...(room.lit && light.dim > 0 ? [{ source: { kind: 'room' } as const, ...light, elevation: floor.elevation, level: floor.level }] : []),
            ...daylightLights(room, floor),
        ],
        tiles: [],
        regions: [
            roomFloor(room, context.levels),
            roomCeiling(room, context.levels),
            needsArea(room) ? areaRegion(room, { kind: 'room' }, room.points, context.levels) : null,
        ].filter((region): region is RegionDoc => region !== null),
        sounds: [],
    };
}

/** The native documents `feature` should have, in its scene `context`. */
export function planDocuments(feature: Feature, context: PlanContext = NO_CONTEXT): DocumentPlan {
    if (feature.type === 'room') {
        return roomPlan(feature, context);
    }
    if (feature.type === 'stamp') {
        return stampPlan(feature, context);
    }
    if (feature.type === 'pin') {
        const { elevation, level } = floorOf(feature, context);
        return { ...NO_PLAN, notes: [{ ...pinPoint(feature), elevation, level, ...pinSettingsOf(feature) }] };
    }
    // Foundry refuses a Drawing with nothing to show, so a label has none until it has text.
    if (feature.type === 'label' && feature.text.trim() !== '') {
        const { elevation, level } = floorOf(feature, context);
        return { ...NO_PLAN, drawings: [{ kind: 'text', ...labelPoint(feature), ...labelBox(feature), elevation, level, ...labelSettingsOf(feature) }] };
    }
    if (feature.type === 'shape') {
        const { elevation, level } = floorOf(feature, context);
        const { strokeColour, strokeWidth, strokeAlpha, fillColour, fillAlpha, hidden } = feature;
        const style = { strokeColour, strokeWidth, strokeAlpha, fillColour, fillAlpha, hidden };
        return { ...NO_PLAN, drawings: [{ kind: 'shape', ...shapeBox(feature), elevation, level, style }] };
    }
    if (feature.type === 'zone') {
        return { ...NO_PLAN, regions: [zoneRegion(feature, context.levels)] };
    }
    if (feature.type === 'path' && feature.walls !== null) {
        return { ...NO_PLAN, walls: pathWalls(feature, feature.walls, floorOf(feature, context)) };
    }
    // Painted ground is mirrored as a region when the world asks for it, and always where it is difficult to cross or has effects.
    if ((feature.type === 'region' || feature.type === 'stroke') && (context.terrainRegions || needsArea(feature))) {
        return { ...NO_PLAN, regions: [terrainRegion(feature, context.levels)] };
    }
    return NO_PLAN;
}

/** Pairs of a flat `[x, y, …]` outline as points. */
function outlinePoints(flat: readonly number[]): Point[] {
    const points: Point[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
        points.push({ x: flat[i] ?? 0, y: flat[i + 1] ?? 0 });
    }
    return points;
}

/**
 * Terrain as a Scene Region over exactly what is painted (the region's fill,
 * smoothed unless sharp, or the stroke's swath), named after its biome, on its level's band.
 * Difficult ground makes walking across it cost what the GM painted it at
 * (Modify Movement Cost); otherwise it carries no behaviours, for GMs and
 * systems to attach their own (weather and so on).
 */
function terrainRegion(feature: RegionFeature | StrokeFeature, levels: readonly Level[]): RegionDoc {
    const outline = feature.type === 'region' ? regionOutline(feature) : brushOutline(feature.points, feature.radius, RIBBON_SAMPLES);
    return areaRegion(feature, { kind: 'terrain', biome: feature.biome }, outlinePoints(outline), levels);
}

/**
 * The Scene Region over an area (painted ground or a room's floor), on its
 * level's band: Modify Movement Cost for walking when the ground is
 * difficult, then the effects the GM put on it.
 */
function areaRegion(feature: Feature & Costed & Affected, label: RegionDoc['label'], polygon: readonly Point[], levels: readonly Level[]): RegionDoc {
    const band = findLevel(levels, feature.level);
    const cost = movementCostOf(feature);
    const effects = effectsOf(feature);
    const display = displayOf(feature);
    return {
        id: null,
        label,
        polygon,
        bottom: band?.bottom ?? null,
        top: band?.top ?? null,
        level: feature.level,
        spans: [],
        behaviour: cost === NORMAL_COST ? null : { kind: 'terrain', difficulties: { walk: cost } },
        ...(effects.length > 0 ? { effects } : {}),
        ...(customDisplay(display) ? { display } : {}),
    };
}

/**
 * A zone's region: always there, in its own Foundry shape, moving with its
 * token if it has one. A way to another map keeps its fixed id, so the other
 * map's way can name it, and teleports whoever enters it.
 */
function zoneRegion(zone: ZoneFeature, levels: readonly Level[]): RegionDoc {
    const { x, y } = zonePoint(zone);
    const area = areaRegion(zone, { kind: 'zone', title: zone.name }, [], levels);
    const { link } = zone;
    return {
        ...area,
        ...(link === undefined ? {} : { id: link.region, behaviour: { kind: 'teleport' as const, targets: link.targets, travel: link.travel } }),
        geometry: { ...zone.shape, x, y, rotation: zone.rotation, gridBased: zone.gridBased },
        ...(zone.attachedTo === null ? {} : { attachedTo: zone.attachedTo }),
    };
}

/** Whether an area needs its own Scene Region whatever the world's terrain setting: difficult ground, effects on it, a display of its own, or tokens to spawn into it. */
function needsArea(feature: Costed & Affected): boolean {
    return movementCostOf(feature) !== NORMAL_COST || effectsOf(feature).length > 0 || customDisplay(displayOf(feature)) || customSpawn(spawnOf(feature));
}
