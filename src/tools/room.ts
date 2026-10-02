// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Rooms: the structure-mapping primitive. A room is a grid-snapped, closed
 * floor area. Its floor is a biome or a pack floor material, rendered with a
 * crisp edge because its walls cover the boundary. It can show its walls as a
 * textured band in a pack wall material. Any perimeter segment can be a door,
 * with a Foundry door type and state. Model, defensive parser and edit
 * constructors. Pure and unit-tested.
 */
import { distance, type Point } from '../geometry/spline';
import { centroid, perimeterSegments, type Segment } from '../geometry/wall';
import { parseAreaFields, type Affected } from './area-effects';
import type { BiomeKind } from './biome';
import { DOOR_ANIMATIONS, type DoorAnimationType, type DoorLook, type DoorState } from './documents';
import { NEW_FEATURE, parseFeatureCommon, type FeatureCommon } from './feature-common';
import { type GeneratedDocs, NO_DOCS, parseGeneratedDocs } from './generated-docs';
import { isPoint, isRecord, stringArray } from './guards';
import { type FloorMaterial, isFloorMaterial, parseWallMaterial, type WallMaterial } from './materials';
import type { Costed } from './terrain-cost';
import { DEFAULT_WALL_PRESET, isWallPreset, type WallPreset } from './wall-presets';

/** Default floor material for a freshly drawn room. */
export const DEFAULT_FLOOR: BiomeKind = 'dirt';

/** Bright light covers this fraction of the room light's dim radius. */
const ROOM_BRIGHT_FRACTION = 0.5;

/** A Foundry door, a secret one, or an opening: a gap in the wall with no door and no wall (an archway, a breach). */
export type RoomDoorType = 'door' | 'secret' | 'opening';

const DOOR_TYPES: readonly RoomDoorType[] = ['door', 'secret', 'opening'];
const DOOR_STATES: readonly DoorState[] = ['closed', 'open', 'locked'];

/** A door on one of the room's perimeter segments. */
export interface RoomDoor {
    readonly segment: number;
    readonly type: RoomDoorType;
    readonly state: DoorState;
    /** A `CONFIG.Wall.doorSounds` key, or null for Foundry's default. */
    readonly sound: string | null;
    /** How it animates open, or null for Foundry's default. */
    readonly animation: DoorAnimationType | null;
}

/** A door's settings, without the segment it sits on. */
export type DoorSettings = Omit<RoomDoor, 'segment'>;

/** What a new door is: an ordinary, closed door, sounding and moving as Foundry's defaults. */
export const NEW_DOOR: DoorSettings = { type: 'door', state: 'closed', sound: null, animation: null };

/** A room door's look on its wall. */
export function roomDoorLook(door: RoomDoor): DoorLook {
    return { sound: door.sound, animation: door.animation === null ? null : { type: door.animation } };
}

/**
 * A room; its `points` are the grid-snapped boundary (>= 3), its documents the
 * perimeter walls and centre light. A room whose floor is difficult to cross,
 * or that has area effects, also gets a Scene Region over its floor.
 */
export interface RoomFeature extends FeatureCommon, Costed, Affected {
    readonly type: 'room';
    /** Floor material: a biome, a pack `floor.<name>` role, or a `wall.<name>` role (the top of masonry). */
    readonly floor: FloorMaterial;
    /** Visible wall material (a pack `wall.<name>` role), or null for walls that are not drawn. */
    readonly wall: WallMaterial;
    /** What kind of walls the room has, as Foundry's Walls palette names them: solid, window, terrain… */
    readonly wallKind: WallPreset;
    /** Whether a level above gets a ceiling over the room; an open courtyard has none. */
    readonly ceiling: boolean;
    readonly doors: RoomDoor[];
    /** Perimeter segments that are windows: Foundry window walls, which let light and sight through only close by. */
    readonly windows: readonly number[];
    /**
     * Perimeter segments daylight comes in through (its windows, and doors to
     * the outside): each has a native light just outside it, shining in, cut
     * by walls (a shut door keeps it out) and lit only by day.
     */
    readonly daylight: readonly number[];
    /** Whether its centre light is on; a light switch linked to the room turns it on and off. */
    readonly lit: boolean;
}

/** What a room is made of: its floor, its drawn walls, the kind of walls they are, and whether it has a ceiling. */
export interface RoomMaterials {
    readonly floor: FloorMaterial;
    readonly wall: WallMaterial;
    readonly wallKind: WallPreset;
    readonly ceiling: boolean;
}

/** What a room is made of until the GM picks otherwise. */
export const DEFAULT_ROOM_MATERIALS: RoomMaterials = { floor: DEFAULT_FLOOR, wall: null, wallKind: DEFAULT_WALL_PRESET, ceiling: true };

/** One perimeter segment of a room, and the door on it if any. */
export interface RoomWall extends Segment {
    readonly segment: number;
    readonly door: RoomDoor | null;
}

/** Build a committed room from a boundary point stream, or null if fewer than 3 points. */
export function makeRoom(
    id: string,
    floor: FloorMaterial,
    points: readonly Point[],
    wall: WallMaterial = null,
    wallKind: WallPreset = DEFAULT_WALL_PRESET,
    ceiling = true,
): RoomFeature | null {
    if (points.length < 3) {
        return null;
    }
    return {
        type: 'room',
        id,
        floor,
        wall,
        wallKind,
        ceiling,
        points: points.map((p) => ({ x: p.x, y: p.y })),
        doors: [],
        windows: [],
        daylight: [],
        lit: true,
        ...NEW_FEATURE,
    };
}

/** The same room with its light on or off. */
export function withRoomLit(room: RoomFeature, lit: boolean): RoomFeature {
    return { ...room, lit };
}

/** The same room in other materials. */
export function withRoomMaterials(room: RoomFeature, materials: RoomMaterials): RoomFeature {
    return { ...room, floor: materials.floor, wall: materials.wall, wallKind: materials.wallKind, ceiling: materials.ceiling };
}

/** What `room` is made of. */
export function roomMaterialsOf(room: RoomFeature): RoomMaterials {
    return { floor: room.floor, wall: room.wall, wallKind: room.wallKind, ceiling: room.ceiling };
}

/** Rebuild a room with new boundary points (edit ops), preserving floor + doors + document links, or null if < 3. */
export function withRoomPoints(room: RoomFeature, points: readonly Point[]): RoomFeature | null {
    if (points.length < 3) {
        return null;
    }
    // A closed polygon of n points has n perimeter segments; drop doors on segments that no longer exist.
    const doors = room.doors.filter((d) => d.segment < points.length);
    const onOutline = (segment: number): boolean => segment < points.length;
    return {
        ...room,
        points: points.map((p) => ({ x: p.x, y: p.y })),
        doors,
        windows: room.windows.filter(onOutline),
        daylight: room.daylight.filter(onOutline),
    };
}

/** The door on `segment`, or null. */
export function doorOn(room: RoomFeature, segment: number): RoomDoor | null {
    return room.doors.find((d) => d.segment === segment) ?? null;
}

/** Put a door with `settings` on `segment` (replacing any there), or clear it with null. */
export function withRoomDoor(room: RoomFeature, segment: number, settings: DoorSettings | null): RoomFeature {
    const others = room.doors.filter((d) => d.segment !== segment);
    return { ...room, doors: settings === null ? others : [...others, { segment, ...settings }].sort((a, b) => a.segment - b.segment) };
}

/** The room's perimeter walls, each with the door on it, if any. */
export function roomWalls(room: RoomFeature): RoomWall[] {
    return perimeterSegments(room.points).map((s, i) => ({ a: s.a, b: s.b, segment: i, door: doorOn(room, i) }));
}

/** The room's centre light: centred on the vertex average, its dim radius reaching the farthest corner. */
export function roomLight(room: RoomFeature): { readonly x: number; readonly y: number; readonly dim: number; readonly bright: number } {
    const c = centroid(room.points);
    const dim = room.points.reduce((max, p) => Math.max(max, distance(c, p)), 0);
    return { x: c.x, y: c.y, dim, bright: dim * ROOM_BRIGHT_FRACTION };
}

// eslint-disable-next-line no-restricted-syntax -- boundary: reads a room's document links, accepting the legacy flat wallIds/lightIds fields
function roomDocs(v: Record<string, unknown>): GeneratedDocs {
    if (v['docs'] !== undefined) {
        return parseGeneratedDocs(v['docs']);
    }
    return { ...NO_DOCS, walls: stringArray(v['wallIds']), lights: stringArray(v['lightIds']) };
}

// eslint-disable-next-line no-restricted-syntax -- boundary: parses a persisted list of perimeter segments, keeping each one on the outline once
function parseSegments(v: unknown, count: number): number[] {
    if (!Array.isArray(v)) {
        return [];
    }
    const valid = v.filter((s): s is number => typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < count);
    return [...new Set(valid)];
}

// eslint-disable-next-line no-restricted-syntax -- boundary: parses persisted doors; a bare segment index (the original format) is an ordinary closed door
function parseDoor(v: unknown): RoomDoor | null {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) {
        return { segment: v, ...NEW_DOOR };
    }
    if (!isRecord(v) || typeof v['segment'] !== 'number' || !Number.isInteger(v['segment']) || v['segment'] < 0) {
        return null;
    }
    const { segment, type, state, sound, animation } = v;
    return {
        segment,
        type: DOOR_TYPES.find((t) => t === type) ?? NEW_DOOR.type,
        state: DOOR_STATES.find((s) => s === state) ?? NEW_DOOR.state,
        sound: typeof sound === 'string' && sound !== '' ? sound : null,
        animation: DOOR_ANIMATIONS.find((a) => a === animation) ?? null,
    };
}

// eslint-disable-next-line no-restricted-syntax -- boundary: parses one untyped scene-flag entry, validating shape and returning a narrow RoomFeature or null
export function parseRoom(v: unknown): RoomFeature | null {
    if (!isRecord(v)) {
        return null;
    }
    if (v['type'] !== 'room' || typeof v['id'] !== 'string' || !isFloorMaterial(v['floor'])) {
        return null;
    }
    const points = Array.isArray(v['points']) ? v['points'].filter(isPoint) : [];
    if (points.length < 3) {
        return null;
    }
    const doors = Array.isArray(v['doors']) ? v['doors'].map(parseDoor).filter((d): d is RoomDoor => d !== null) : [];
    return {
        type: 'room',
        id: v['id'],
        floor: v['floor'],
        wall: parseWallMaterial(v['wall']),
        // Rooms saved before wall kinds existed have solid walls, as they always did.
        wallKind: isWallPreset(v['wallKind']) ? v['wallKind'] : DEFAULT_WALL_PRESET,
        ceiling: v['ceiling'] !== false,
        // A room saved before switches existed is lit, as it always was.
        lit: v['lit'] !== false,
        points: points.map((p) => ({ x: p.x, y: p.y })),
        doors,
        // Rooms saved before windows and daylight have neither.
        windows: parseSegments(v['windows'], points.length),
        daylight: parseSegments(v['daylight'], points.length),
        ...parseAreaFields(v),
        ...parseFeatureCommon(v),
        docs: roomDocs(v),
    };
}
