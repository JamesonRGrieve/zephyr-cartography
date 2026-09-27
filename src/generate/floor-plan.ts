// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The floor-plan generator: a building of rooms packed wall to wall. The
 * footprint is split in two, again and again (binary space partitioning),
 * until the parts are room-sized; every split is then crossed by one door a
 * square wide, so every room can be reached. An optional entrance opens one
 * outer wall. The result is a scene spec in grid squares, from (0, 0).
 */
import { DEFAULT_AREA_DISPLAY } from '../tools/area-effects';
import type { FloorMaterial, WallMaterial } from '../tools/materials';
import { NEW_DOOR } from '../tools/room';
import { NO_SPAWN } from '../tools/spawn';
import { NORMAL_COST } from '../tools/terrain-cost';
import { DEFAULT_WALL_PRESET, type WallPreset } from '../tools/wall-presets';
import { pick, randomInt, seededRandom, type Random } from './random';
import { SCENE_SPEC_SCHEMA_VERSION, type RoomSpec, type SceneSpec } from './spec';

export interface FloorPlanOptions {
    readonly seed: number;
    /** Footprint, in grid squares. */
    readonly width: number;
    readonly height: number;
    /** No room is narrower than this, in squares. */
    readonly minRoom: number;
    /** Parts wider or deeper than this are always split further (when they can be). */
    readonly maxRoom: number;
    /** Open a door in one outer wall. */
    readonly entrance: boolean;
    readonly floor: FloorMaterial;
    readonly wall: WallMaterial;
    readonly wallKind: WallPreset;
    readonly ceiling: boolean;
}

export const DEFAULT_FLOOR_PLAN: FloorPlanOptions = {
    seed: 1,
    width: 24,
    height: 16,
    minRoom: 3,
    maxRoom: 8,
    entrance: true,
    floor: 'dirt',
    wall: null,
    wallKind: DEFAULT_WALL_PRESET,
    ceiling: true,
};

/** Chance that a room-sized part, which could still be split, is kept whole: variety in room size. */
const KEEP_WHOLE_CHANCE = 0.35;

/** A coin toss. */
const EVEN_CHANCE = 0.5;

/** A rectangle in grid squares: a footprint or a room. */
export interface Rect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** A one-square door on a room's side, starting `at` along it (absolute x for top/bottom, y for left/right). */
export interface DoorSlot {
    readonly side: Side;
    readonly at: number;
}

interface Split {
    readonly axis: 'x' | 'y';
    /** The cut line: x for a vertical cut, y for a horizontal one. */
    readonly line: number;
    readonly first: Part;
    readonly second: Part;
}

type Part = { readonly leaf: Rect } | { readonly split: Split };

function leaves(part: Part): Rect[] {
    return 'leaf' in part ? [part.leaf] : [...leaves(part.split.first), ...leaves(part.split.second)];
}

function partition(rect: Rect, o: FloorPlanOptions, random: Random): Part {
    const canCutX = rect.w >= 2 * o.minRoom;
    const canCutY = rect.h >= 2 * o.minRoom;
    const oversize = rect.w > o.maxRoom || rect.h > o.maxRoom;
    if ((!canCutX && !canCutY) || (!oversize && random() < KEEP_WHOLE_CHANCE)) {
        return { leaf: rect };
    }
    // Cut across the longer side, so rooms stay roughly square; a square part goes either way.
    const cutX = canCutX && (!canCutY || rect.w > rect.h || (rect.w === rect.h && random() < EVEN_CHANCE));
    const span = cutX ? rect.w : rect.h;
    const at = randomInt(random, o.minRoom, span - o.minRoom);
    const [a, b]: [Rect, Rect] = cutX
        ? [
              { ...rect, w: at },
              { ...rect, x: rect.x + at, w: rect.w - at },
          ]
        : [
              { ...rect, h: at },
              { ...rect, y: rect.y + at, h: rect.h - at },
          ];
    const first = partition(a, o, random);
    const second = partition(b, o, random);
    return { split: { axis: cutX ? 'x' : 'y', line: (cutX ? rect.x : rect.y) + at, first, second } };
}

/** The door crossing one split: between a room on each side whose walls overlap along the cut. */
function splitDoor(split: Split, random: Random): { room: Rect; slot: DoorSlot } | null {
    const vertical = split.axis === 'x';
    const before = leaves(split.first).filter((r) => (vertical ? r.x + r.w : r.y + r.h) === split.line);
    const after = leaves(split.second).filter((r) => (vertical ? r.x : r.y) === split.line);
    const pairs = before.flatMap((a) =>
        after.flatMap((b) => {
            const lo = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
            const hi = vertical ? Math.min(a.y + a.h, b.y + b.h) : Math.min(a.x + a.w, b.x + b.w);
            return hi - lo >= 1 ? [{ a, lo, hi }] : [];
        }),
    );
    const chosen = pick(random, pairs);
    if (!chosen) {
        return null;
    }
    return { room: chosen.a, slot: { side: vertical ? 'right' : 'bottom', at: randomInt(random, chosen.lo, chosen.hi - 1) } };
}

function splits(part: Part): Split[] {
    return 'leaf' in part ? [] : [part.split, ...splits(part.split.first), ...splits(part.split.second)];
}

/** A door in an outer wall of a room on the edge of the footprint. */
function entranceDoor(footprint: Rect, rooms: readonly Rect[], random: Random): { room: Rect; slot: DoorSlot } | null {
    const options = rooms.flatMap((room) => {
        const sides: { room: Rect; side: Side; from: number; to: number }[] = [];
        if (room.y === footprint.y) {
            sides.push({ room, side: 'top', from: room.x, to: room.x + room.w });
        }
        if (room.x + room.w === footprint.x + footprint.w) {
            sides.push({ room, side: 'right', from: room.y, to: room.y + room.h });
        }
        if (room.y + room.h === footprint.y + footprint.h) {
            sides.push({ room, side: 'bottom', from: room.x, to: room.x + room.w });
        }
        if (room.x === footprint.x) {
            sides.push({ room, side: 'left', from: room.y, to: room.y + room.h });
        }
        return sides;
    });
    const chosen = pick(random, options);
    return chosen ? { room: chosen.room, slot: { side: chosen.side, at: randomInt(random, chosen.from, chosen.to - 1) } } : null;
}

interface Corner {
    readonly x: number;
    readonly y: number;
}

/** Points along one side, from `start` (exclusive of `end`), with an extra point at each end of every door on it. */
function sidePoints(start: Corner, end: Corner, doorsAt: readonly number[]): { points: Corner[]; doorStarts: Corner[] } {
    const horizontal = start.y === end.y;
    const forward = horizontal ? end.x > start.x : end.y > start.y;
    const along = (v: number): Corner => (horizontal ? { x: v, y: start.y } : { x: start.x, y: v });
    const from = horizontal ? start.x : start.y;
    const to = horizontal ? end.x : end.y;
    // Walking backwards, a door square [at, at + 1] is entered at at + 1.
    const entries = doorsAt.map((at) => (forward ? at : at + 1));
    const exits = doorsAt.map((at) => (forward ? at + 1 : at));
    const inside = (v: number): boolean => (forward ? v > from && v < to : v < from && v > to);
    const breaks = [...new Set([...entries, ...exits].filter(inside))].sort((a, b) => (forward ? a - b : b - a));
    return { points: [start, ...breaks.map(along)], doorStarts: entries.map(along) };
}

/** A room's polygon, clockwise from its top-left corner, with a one-square segment for each of its doors. */
/** What a room is built of: its floor, its drawn walls, their Foundry kind, and whether it has a ceiling. */
export type RoomBuild = Pick<FloorPlanOptions, 'floor' | 'wall' | 'wallKind' | 'ceiling'>;

/** A room spec over `room`, with a one-square door in each of `slots`. */
export function roomSpec(room: Rect, slots: readonly DoorSlot[], o: RoomBuild): RoomSpec {
    const corners: Corner[] = [
        { x: room.x, y: room.y },
        { x: room.x + room.w, y: room.y },
        { x: room.x + room.w, y: room.y + room.h },
        { x: room.x, y: room.y + room.h },
    ];
    const sides: readonly Side[] = ['top', 'right', 'bottom', 'left'];
    const points: Corner[] = [];
    const doorStarts: Corner[] = [];
    sides.forEach((side, i) => {
        const start = corners[i];
        const end = corners[(i + 1) % corners.length];
        if (start && end) {
            const along = sidePoints(
                start,
                end,
                slots.filter((s) => s.side === side).map((s) => s.at),
            );
            points.push(...along.points);
            doorStarts.push(...along.doorStarts);
        }
    });
    const doors = doorStarts
        .map((d) => points.findIndex((p) => p.x === d.x && p.y === d.y))
        .filter((segment) => segment >= 0)
        .map((segment) => ({ segment, ...NEW_DOOR }));
    return {
        type: 'room',
        points,
        floor: o.floor,
        wall: o.wall,
        wallKind: o.wallKind,
        ceiling: o.ceiling,
        lit: true,
        movementCost: NORMAL_COST,
        effects: [],
        display: DEFAULT_AREA_DISPLAY,
        spawn: { ...NO_SPAWN, actors: [] },
        doors,
    };
}

/** Generate a floor plan; the same options always give the same plan. */
export function generateFloorPlan(o: FloorPlanOptions): SceneSpec {
    const random = seededRandom(o.seed);
    const footprint: Rect = { x: 0, y: 0, w: o.width, h: o.height };
    const tree = partition(footprint, o, random);
    const rooms = leaves(tree);
    const doors = splits(tree).map((s) => splitDoor(s, random));
    if (o.entrance) {
        doors.push(entranceDoor(footprint, rooms, random));
    }
    const slotsOf = (room: Rect): DoorSlot[] => doors.flatMap((d) => (d?.room === room ? [d.slot] : []));
    return {
        schemaVersion: SCENE_SPEC_SCHEMA_VERSION,
        units: 'grid',
        levels: [],
        splats: [],
        features: rooms.map((room) => roomSpec(room, slotsOf(room), o)),
    };
}
