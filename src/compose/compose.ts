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
import type { DoorSlot, Rect, Side } from '../generate/floor-plan';
import { roomSpec } from '../generate/floor-plan';
import { seededRandom, type Random } from '../generate/random';
import { SCENE_SPEC_SCHEMA_VERSION, type SceneSpecInput } from '../generate/spec';
import { WALL_BAND_SQUARES } from '../tools/materials';
import { composeExterior } from './exterior';
import { type ComposedStamp, furnishRoom, type RoomFloor } from './furnish';
import type { BuildingIntent, MapIntent } from './intent';
import { type BuildingLayout, layOutBuilding } from './layout';
import { type ComposeProblem, distinctProblems } from './problems';
import type { RoleIndex } from './roles';

type FeatureInput = SceneSpecInput['features'][number];

/** A composed map: the spec to build, and what the composer could not do. */
export interface Composition {
    readonly spec: SceneSpecInput;
    readonly problems: readonly ComposeProblem[];
}

const OPPOSITE: Readonly<Record<Side, Side>> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

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

/** Each room's doors as it sees them: its own, and the ones its neighbours opened into its walls. */
function doorsOf(layout: BuildingLayout, key: string): DoorSlot[] {
    return layout.doors.flatMap((d) => {
        if (d.room === key) {
            return [d.slot];
        }
        return d.to === key ? [{ side: OPPOSITE[d.slot.side], at: d.slot.at }] : [];
    });
}

const stampFeature = (s: ComposedStamp): FeatureInput => ({ type: 'stamp', stamp: s.stamp, x: s.x, y: s.y, rotation: s.rotation });

/** One building's rooms and furniture, or a problem when its rooms cannot fit; `called` names it in its rooms' keys and in problems. */
function composeBuilding(
    building: BuildingIntent,
    called: string,
    footprint: Rect,
    stamps: RoleIndex,
    random: Random,
): { features: FeatureInput[]; problems: ComposeProblem[]; layout: BuildingLayout | null } {
    const layout = layOutBuilding(building, footprint, random);
    if (!layout) {
        return { features: [], problems: [{ kind: 'rooms-do-not-fit', building: called, width: building.width, height: building.height }], layout: null };
    }
    const problems: ComposeProblem[] = layout.unmet.map(([room, other]) => ({ kind: 'not-beside', building: called, room, other }));
    const rooms: FeatureInput[] = [];
    const furniture: FeatureInput[] = [];
    for (const room of layout.rooms) {
        const slots = layout.doors.flatMap((d) => (d.room === room.key ? [d.slot] : []));
        rooms.push({
            ...roomSpec(room.rect, slots, { floor: building.floor, wall: building.wall, wallKind: building.wallKind, ceiling: true }),
            key: `${called}:${room.key}`,
        });
        // Furnished inside its walls' inner faces: a composed building's walls are always drawn, half their thickness into the room.
        const inset = WALL_BAND_SQUARES / 2;
        const floor: RoomFloor = {
            key: room.key,
            purpose: room.intent.purpose,
            rect: { x: room.rect.x + inset, y: room.rect.y + inset, w: room.rect.w - 2 * inset, h: room.rect.h - 2 * inset },
            doors: doorsOf(layout, room.key),
            outer: outerSides(room.rect, footprint),
        };
        const furnished = furnishRoom(floor, stamps, random);
        furniture.push(...furnished.stamps.map(stampFeature));
        problems.push(...furnished.missing.map((role) => ({ kind: 'no-stamp' as const, role, wantedIn: `${called}/${room.key}` })));
    }
    return { features: [...rooms, ...furniture], problems, layout };
}

/** Compose `intent` with the stamps `stamps` offers. */
export function composeMap(intent: MapIntent, stamps: RoleIndex): Composition {
    const random = seededRandom(intent.seed);
    const composed = intent.buildings.map((building, i) => {
        const footprint = footprintOf(building, intent);
        return { building, footprint, ...composeBuilding(building, building.key ?? `building-${i + 1}`, footprint, stamps, random) };
    });
    const exterior = composeExterior(
        intent,
        composed.map(({ building, footprint, layout }) => ({ key: building.key, footprint, front: layout?.doors.find((d) => d.to === null) ?? null })),
        stamps,
        random,
    );
    // Ground first, then roads and rivers, then vegetation, then the buildings standing on it all.
    const features = [...exterior.features, ...composed.flatMap((c) => c.features)];
    return {
        spec: { schemaVersion: SCENE_SPEC_SCHEMA_VERSION, units: 'grid', features },
        problems: distinctProblems([...exterior.problems, ...composed.flatMap((c) => c.problems)]),
    };
}
