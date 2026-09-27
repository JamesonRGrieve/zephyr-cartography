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
import { pick, seededRandom, type Random } from '../generate/random';
import { SCENE_SPEC_SCHEMA_VERSION, type SceneSpecInput } from '../generate/spec';
import type { StampRole } from '../stamps/schema';
import { WALL_BAND_SQUARES } from '../tools/materials';
import { composeExterior } from './exterior';
import { type Box, type ComposedStamp, furnishRoom, type RoomFloor } from './furnish';
import type { BuildingIntent, MapIntent } from './intent';
import { type BuildingLayout, doorsOf } from './layout';
import { NO_PREFERENCES, narrowedIndex, type Preferences, roomPlace } from './preferences';
import { type ComposeProblem, distinctProblems } from './problems';
import type { RoleIndex } from './roles';
import { layOutStoreys } from './storeys';

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

/** A storey's name in problems and room keys: the building's own for the ground floor, else with its floor. */
export const storeyName = (called: string, storey: number): string => (storey === 0 ? called : `${called}/floor-${storey + 1}`);

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
    }
    return { features: [...rooms, ...furniture], problems };
}

/**
 * One building's storeys, rooms, furniture and stairs, or a problem when its
 * ground floor's rooms cannot fit; `called` names it in its rooms' keys and
 * in problems, and `levels` names each storey's level (null on a map
 * without levels).
 */
function composeBuilding(
    building: BuildingIntent,
    called: string,
    footprint: Rect,
    map: {
        readonly stamps: RoleIndex;
        readonly random: Random;
        readonly levels: readonly string[] | null;
        readonly night: boolean;
        readonly preferences: Preferences;
    },
): { features: FeatureInput[]; problems: ComposeProblem[]; ground: BuildingLayout | null } {
    const { stamps, random, levels, night, preferences } = map;
    const stair = building.floors.length > 0 ? pick(random, stamps.get('stairs') ?? []) : undefined;
    const lanes = stairLanes(building.floors.length);
    const storeys = layOutStoreys(building, footprint, stair ? { w: stair.width * lanes, h: stair.height } : null, random);
    if (!storeys) {
        return { features: [], problems: [{ kind: 'rooms-do-not-fit', building: called, width: building.width, height: building.height }], ground: null };
    }
    const onLevel = (storey: number): { level?: string } => {
        const level = levels?.[storey];
        return level === undefined ? {} : { level };
    };
    const { stairwell } = storeys;
    const reserved = stairwell ? [stairwell] : [];
    const features: FeatureInput[] = [];
    const problems: ComposeProblem[] = [];
    [storeys.ground, ...storeys.floors].forEach((layout, storey) => {
        const storeyCalled = storeyName(called, storey);
        if (!layout) {
            problems.push({ kind: 'rooms-do-not-fit', building: storeyCalled, width: building.width, height: building.height });
            return;
        }
        const composed = composeStorey(layout, {
            building,
            called: storeyCalled,
            footprint,
            stamps,
            random,
            reserved,
            onLevel: onLevel(storey),
            night,
            preferences,
        });
        features.push(...composed.features);
        problems.push(...composed.problems);
    });
    if (building.floors.length > 0 && !stair) {
        problems.push({ kind: 'no-stamp', role: 'stairs', wantedIn: called });
    } else if (stair && !stairwell) {
        problems.push({ kind: 'no-stairwell', building: called });
    }
    if (stair && stairwell) {
        // A flight on every floor but the top climbs to the one above, in the lane beside the flight below it.
        for (let storey = 0; storey < building.floors.length; storey++) {
            features.push({
                type: 'stamp',
                stamp: stair.key,
                x: stairwell.x + (storey % lanes) * stair.width + stair.width / 2,
                y: stairwell.y + stairwell.h / 2,
                rotation: stair.turn,
                ...onLevel(storey),
            });
        }
    }
    return { features, problems, ground: storeys.ground };
}

/** The scene's levels for a map whose tallest building has `storeys` floors: the scene's own floor as the ground, the rest above. */
function levelsFor(intent: MapIntent, storeys: number): { key: string; name: string; existing?: boolean }[] {
    return Array.from({ length: storeys }, (_, storey) => {
        if (storey === 0) {
            return { key: GROUND_LEVEL, name: GROUND_LEVEL_NAME, existing: true };
        }
        const named = intent.buildings.find((b) => b.floors[storey - 1]?.name !== undefined)?.floors[storey - 1]?.name;
        return { key: `floor-${storey + 1}`, name: named ?? `Floor ${storey + 1}` };
    });
}

/** A night scene: dark, and lit only by its lights, never Foundry's global light. */
const NIGHT = { darkness: 0.85, globalLight: false } as const;

/** The ground level's key and name on a map with levels. */
const GROUND_LEVEL = 'ground';
const GROUND_LEVEL_NAME = 'Ground floor';

/** Compose `intent` with the stamps `stamps` offers, drawing each place's pieces from those `preferences` chose for it (none: any). */
export function composeMap(intent: MapIntent, stamps: RoleIndex, preferences: Preferences = NO_PREFERENCES): Composition {
    const random = seededRandom(intent.seed);
    const storeys = Math.max(1, ...intent.buildings.map((b) => 1 + b.floors.length));
    // A map with a building of more than one floor puts everything on levels: outside and the ground floors on the ground level.
    const levels = storeys > 1 ? levelsFor(intent, storeys) : [];
    const keys = storeys > 1 ? levels.map((l) => l.key) : null;
    const night = intent.lighting === 'night';
    const composed = intent.buildings.map((building, i) => {
        const footprint = footprintOf(building, intent);
        return {
            building,
            footprint,
            ...composeBuilding(building, buildingName(building, i), footprint, { stamps, random, levels: keys, night, preferences }),
        };
    });
    const exterior = composeExterior(
        intent,
        composed.map(({ building, footprint, ground }) => ({ key: building.key, footprint, front: ground?.doors.find((d) => d.to === null) ?? null })),
        stamps,
        random,
        preferences,
    );
    const outside = keys ? exterior.features.map((f) => ({ ...f, level: GROUND_LEVEL })) : exterior.features;
    // Ground first, then roads and rivers, then vegetation, then the buildings standing on it all.
    const features = [...outside, ...composed.flatMap((c) => c.features)];
    return {
        spec: { schemaVersion: SCENE_SPEC_SCHEMA_VERSION, units: 'grid', levels, features, ...(night ? { scene: NIGHT } : {}) },
        problems: distinctProblems([...exterior.problems, ...composed.flatMap((c) => c.problems)]),
    };
}
