// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Furnishing a room by its purpose. Each purpose has a template: steps that
 * place stamps by role, in order, on a floor that remembers what is taken.
 * - `wall`: with its back (the image's top) to a wall, facing into the room,
 *   on outer or inner walls first; a counter can bring seats before it.
 * - `corner`: in the room's corners.
 * - `cluster`: a table with seats along its long sides, in orderly rows
 *   across the room's open floor, a walkway kept round each.
 * - `scatter`: small things near the walls, turned at random.
 * - `underlay`: a rug at the room's middle, beneath the furniture.
 * The approach to every door is kept clear, and nothing overlaps. One stamp
 * is chosen per role per room, so a room's chairs match. Pure and
 * unit-tested; positions are in grid squares.
 */
import type { Rect, Side } from '../generate/floor-plan';
import { pick, randomInt, shuffled, type Random } from '../generate/random';
import type { StampRole } from '../stamps/schema';
import type { RoomPurpose } from './intent';
import type { RoleIndex, RoleStamp } from './roles';

/** A stamp placed by the composer: its catalog key, footprint centre in squares, and rotation in degrees. */
export interface ComposedStamp {
    readonly stamp: string;
    readonly x: number;
    readonly y: number;
    readonly rotation: number;
}

/** A room as furnishing sees it: its floor, the doors in its walls, and which walls are the building's outside. */
export interface RoomFloor {
    readonly key: string;
    readonly purpose: RoomPurpose;
    readonly rect: Rect;
    readonly doors: readonly { readonly side: Side; readonly at: number }[];
    readonly outer: readonly Side[];
}

/** How many to place: exactly, between two bounds, or as many as fit. */
type Count = number | readonly [number, number] | 'fill';

type Step =
    | { readonly kind: 'wall'; readonly role: StampRole; readonly count: Count; readonly prefer?: 'outer' | 'inner'; readonly front?: StampRole }
    | { readonly kind: 'corner'; readonly role: StampRole; readonly count: Count }
    | { readonly kind: 'cluster'; readonly centre: StampRole; readonly around: readonly StampRole[]; readonly count: Count; readonly sides: 1 | 2 }
    | { readonly kind: 'scatter'; readonly role: StampRole; readonly count: Count }
    | { readonly kind: 'underlay'; readonly role: StampRole };

/** What each kind of room holds, in the order it is placed: the anchoring pieces first, the clutter last. */
export const ROOM_TEMPLATES: Readonly<Record<RoomPurpose, readonly Step[]>> = {
    'common-room': [
        { kind: 'wall', role: 'hearth', count: 1, prefer: 'outer' },
        { kind: 'cluster', centre: 'table', around: ['bench', 'seat'], count: 'fill', sides: 2 },
        { kind: 'wall', role: 'light', count: [1, 2] },
        { kind: 'corner', role: 'storage', count: [1, 2] },
        { kind: 'scatter', role: 'clutter', count: [2, 4] },
    ],
    'bar': [
        { kind: 'wall', role: 'counter', count: 1, prefer: 'inner', front: 'seat' },
        { kind: 'wall', role: 'shelf', count: [1, 2] },
        { kind: 'corner', role: 'storage', count: [1, 3] },
        { kind: 'scatter', role: 'clutter', count: [1, 2] },
    ],
    'kitchen': [
        { kind: 'wall', role: 'hearth', count: 1, prefer: 'outer' },
        { kind: 'wall', role: 'workbench', count: [1, 2] },
        { kind: 'wall', role: 'shelf', count: [1, 2] },
        { kind: 'corner', role: 'storage', count: [1, 3] },
        { kind: 'scatter', role: 'clutter', count: [2, 3] },
    ],
    'storage': [
        { kind: 'corner', role: 'storage', count: 4 },
        { kind: 'wall', role: 'shelf', count: [1, 3] },
        { kind: 'wall', role: 'storage', count: 'fill' },
        { kind: 'scatter', role: 'clutter', count: [1, 3] },
    ],
    'bedroom': [
        { kind: 'underlay', role: 'rug' },
        { kind: 'wall', role: 'bed', count: [1, 2], prefer: 'inner' },
        { kind: 'wall', role: 'desk', count: [0, 1] },
        { kind: 'corner', role: 'storage', count: [1, 2] },
        { kind: 'scatter', role: 'clutter', count: [0, 2] },
    ],
    'hall': [
        { kind: 'underlay', role: 'rug' },
        { kind: 'wall', role: 'bench', count: [1, 2] },
        { kind: 'wall', role: 'light', count: [1, 2] },
        { kind: 'corner', role: 'storage', count: [0, 1] },
    ],
    'office': [
        { kind: 'underlay', role: 'rug' },
        { kind: 'cluster', centre: 'desk', around: ['seat'], count: 1, sides: 1 },
        { kind: 'wall', role: 'shelf', count: [1, 3] },
        { kind: 'corner', role: 'storage', count: [0, 1] },
        { kind: 'scatter', role: 'clutter', count: [1, 2] },
    ],
    'workshop': [
        { kind: 'wall', role: 'workbench', count: [2, 3] },
        { kind: 'wall', role: 'shelf', count: [1, 2] },
        { kind: 'corner', role: 'storage', count: [1, 3] },
        { kind: 'scatter', role: 'clutter', count: [2, 4] },
    ],
    'shrine': [
        { kind: 'wall', role: 'table', count: 1, prefer: 'inner' },
        { kind: 'cluster', centre: 'bench', around: [], count: 'fill', sides: 1 },
        { kind: 'wall', role: 'light', count: 2 },
    ],
    'cell': [
        { kind: 'wall', role: 'bed', count: 1 },
        { kind: 'scatter', role: 'clutter', count: [0, 1] },
    ],
};

/** Squares kept clear inside a door: its width plus a margin either side, and how deep. */
const DOOR_CLEAR = { margin: 0.25, depth: 1.5 } as const;

/** Squares left between neighbouring pieces along a wall, and between a wall's ends and the first. */
const ALONG_GAP = 0.15;

/** Squares of walkway kept round the table clusters, and between them. */
const WALKWAY = 1;

/** Squares between a table and its seats. */
const SEAT_GAP = 0.05;

/** How far from the walls scattered things lie, in squares. */
const SCATTER_BAND = 1.2;

/** Tries per scattered piece before giving up on it. */
const SCATTER_TRIES = 40;

/** Step (squares) between the candidate spots along a wall. */
const WALL_STEP = 0.25;

/** Rotation that puts an image's top against each wall. */
const BACK_TO: Readonly<Record<Side, number>> = { top: 0, right: 90, bottom: 180, left: 270 };

const QUARTER_TURN = 90;
const FULL_TURN = 360;

/** Rotation steps for scattered pieces. */
const SCATTER_ANGLE_STEP = 15;

interface Box {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const within = (inner: Box, outer: Box): boolean =>
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** The floor as it fills up: pieces placed, and clear space (door approaches, a counter's front) nothing may stand on. */
class Floor {
    readonly placed: ComposedStamp[] = [];
    private readonly taken: Box[] = [];
    private readonly kept: Box[];

    constructor(readonly room: RoomFloor, doors: readonly Box[]) {
        this.kept = [...doors];
    }

    free(box: Box, keepClear = true): boolean {
        return within(box, this.room.rect) && !this.taken.some((t) => overlaps(t, box)) && (!keepClear || !this.kept.some((k) => overlaps(k, box)));
    }

    put(stamp: RoleStamp, box: Box, rotation: number, clear: Box | null): void {
        this.taken.push(box);
        if (clear) {
            this.kept.push(clear);
        }
        this.placed.push({ stamp: stamp.key, x: box.x + box.w / 2, y: box.y + box.h / 2, rotation: (rotation + stamp.turn) % FULL_TURN });
    }
}

/**
 * A strip `depth` deep inside `rect` along its `side`, from `t` for `along`:
 * what stands against a wall, or is kept clear inside a door.
 */
const ALONG_WALL: Readonly<Record<Side, (rect: Rect, t: number, along: number, depth: number, inset: number) => Box>> = {
    top: (rect, t, along, depth, inset) => ({ x: t, y: rect.y + inset, w: along, h: depth }),
    bottom: (rect, t, along, depth, inset) => ({ x: t, y: rect.y + rect.h - inset - depth, w: along, h: depth }),
    left: (rect, t, along, depth, inset) => ({ x: rect.x + inset, y: t, w: depth, h: along }),
    right: (rect, t, along, depth, inset) => ({ x: rect.x + rect.w - inset - depth, y: t, w: depth, h: along }),
};

/** The clear approach inside each door of a room. */
function doorApproaches(room: RoomFloor): Box[] {
    const width = 1 + 2 * DOOR_CLEAR.margin;
    return room.doors.map(({ side, at }) => ALONG_WALL[side](room.rect, at - DOOR_CLEAR.margin, width, DOOR_CLEAR.depth, 0));
}

/** How many a step asks for: a fixed number, a seeded pick between bounds, or effectively unbounded. */
function howMany(count: Count, random: Random): number {
    if (count === 'fill') {
        return Number.POSITIVE_INFINITY;
    }
    return typeof count === 'number' ? count : randomInt(random, count[0], count[1]);
}

/** A piece standing with its back to `side` at `t` along it, and the clear strip in front of it. */
function againstWall(rect: Rect, side: Side, t: number, along: number, depth: number, clearance: number): { box: Box; front: Box } {
    return { box: ALONG_WALL[side](rect, t, along, depth, 0), front: ALONG_WALL[side](rect, t, along, clearance, depth) };
}

/** A wall's extent: the room's width for the top and bottom walls, its height for the sides. */
function wallSpan(rect: Rect, side: Side): { lo: number; hi: number } {
    return side === 'top' || side === 'bottom' ? { lo: rect.x, hi: rect.x + rect.w } : { lo: rect.y, hi: rect.y + rect.h };
}

/** The room's walls, those it prefers first, each group in a seeded order. */
function wallOrder(room: RoomFloor, prefer: 'outer' | 'inner' | undefined, random: Random): Side[] {
    const sides = shuffled(random, ['top', 'right', 'bottom', 'left'] as const);
    if (prefer === undefined) {
        return sides;
    }
    const outer = sides.filter((s) => room.outer.includes(s));
    const inner = sides.filter((s) => !room.outer.includes(s));
    return prefer === 'outer' ? [...outer, ...inner] : [...inner, ...outer];
}

/** Seats in a row before a piece: facing it, spread along its front. */
function seatRow(floor: Floor, seat: RoleStamp, before: Box, side: Side): void {
    const horizontal = side === 'top' || side === 'bottom';
    const span = horizontal ? before.w : before.h;
    const n = Math.max(1, Math.floor(span / (seat.width + ALONG_GAP)));
    const rotation = (BACK_TO[side] + FULL_TURN / 2) % FULL_TURN;
    for (let i = 0; i < n; i++) {
        const centre = (horizontal ? before.x : before.y) + (span * (i + 0.5)) / n;
        const box: Box = horizontal
            ? {
                  x: centre - seat.width / 2,
                  y: side === 'top' ? before.y + before.h + SEAT_GAP : before.y - seat.height - SEAT_GAP,
                  w: seat.width,
                  h: seat.height,
              }
            : {
                  x: side === 'left' ? before.x + before.w + SEAT_GAP : before.x - seat.height - SEAT_GAP,
                  y: centre - seat.width / 2,
                  w: seat.height,
                  h: seat.width,
              };
        // Seats stand in the piece's clear front: that is what it is kept clear for.
        if (floor.free(box, false)) {
            floor.put(seat, box, rotation, null);
        }
    }
}

function placeOnWalls(floor: Floor, step: Extract<Step, { kind: 'wall' }>, stamp: RoleStamp, seat: RoleStamp | undefined, random: Random): void {
    let wanted = howMany(step.count, random);
    const { rect } = floor.room;
    for (const side of wallOrder(floor.room, step.prefer, random)) {
        const { lo, hi } = wallSpan(rect, side);
        const spots: number[] = [];
        for (let t = lo + ALONG_GAP; t + stamp.width <= hi - ALONG_GAP; t += WALL_STEP) {
            spots.push(t);
        }
        // Filling a wall goes end to end; a few pieces go nearest the wall's middle, give or take.
        const middle = (lo + hi - stamp.width) / 2;
        const order = step.count === 'fill' ? spots : [...spots].sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle) + (random() - 0.5));
        for (const t of order) {
            if (wanted <= 0) {
                return;
            }
            const { box, front } = againstWall(rect, side, t, stamp.width, stamp.height, stamp.clearance);
            // Its clear front may share floor with a door's approach: both are only floor kept open.
            if (floor.free(box) && (stamp.clearance === 0 || floor.free(front, false))) {
                floor.put(stamp, box, BACK_TO[side], stamp.clearance > 0 ? front : null);
                if (seat && step.front) {
                    seatRow(floor, seat, box, side);
                }
                wanted -= 1;
            }
        }
    }
}

function placeInCorners(floor: Floor, stamp: RoleStamp, count: Count, random: Random): void {
    const { rect } = floor.room;
    let wanted = howMany(count, random);
    const corners = shuffled(random, [
        { x: rect.x, y: rect.y, side: 'top' as const },
        { x: rect.x + rect.w - stamp.width, y: rect.y, side: 'top' as const },
        { x: rect.x + rect.w - stamp.width, y: rect.y + rect.h - stamp.height, side: 'bottom' as const },
        { x: rect.x, y: rect.y + rect.h - stamp.height, side: 'bottom' as const },
    ]);
    for (const corner of corners) {
        const box: Box = { x: corner.x, y: corner.y, w: stamp.width, h: stamp.height };
        if (wanted > 0 && floor.free(box)) {
            floor.put(stamp, box, BACK_TO[corner.side], null);
            wanted -= 1;
        }
    }
}

/** A table and its seats as one block: along x unless `turned`, with seats on one long side or both. */
/** How a table is seated: along one long side or both, or all round when it is about square (a round tavern table). */
interface Seating {
    readonly table: RoleStamp;
    readonly seat: RoleStamp | undefined;
    readonly sides: 1 | 2;
    readonly round: boolean;
}

/** A table no longer than this many times its width is seated all round. */
const SQUARE_TABLE_ASPECT = 1.3;

/** How far a bench may run past the table it serves, in squares; longer, and chairs serve it instead. */
const BENCH_OVERHANG = 0.3;

/** Whether `seat` can serve `table`: a chair always can, a bench only if it is not much longer than the table. */
function fitsBeside(seat: RoleStamp, table: RoleStamp): boolean {
    return seat.role !== 'bench' || seat.width <= Math.max(table.width, table.height) + BENCH_OVERHANG;
}

function seatingOf(table: RoleStamp, seat: RoleStamp | undefined, sides: 1 | 2): Seating {
    const long = Math.max(table.width, table.height);
    const short = Math.min(table.width, table.height);
    return { table, seat, sides, round: seat !== undefined && sides === 2 && long / short <= SQUARE_TABLE_ASPECT };
}

/** A table and its seats as one block, lengthwise along x: its size, and the table's long and short sides. */
function clusterBlock({ table, seat, sides, round }: Seating): { w: number; h: number; long: number; short: number; depth: number } {
    const long = Math.max(table.width, table.height);
    const short = Math.min(table.width, table.height);
    const depth = seat ? seat.height + SEAT_GAP : 0;
    return { w: long + (round ? 2 * depth : 0), h: short + (seat ? sides * depth : 0), long, short, depth };
}

function placeClusters(floor: Floor, step: Extract<Step, { kind: 'cluster' }>, seating: Seating, random: Random): void {
    const { rect } = floor.room;
    const block = clusterBlock(seating);
    const region: Box = { x: rect.x + WALKWAY, y: rect.y + WALKWAY, w: rect.w - 2 * WALKWAY, h: rect.h - 2 * WALKWAY };
    // Rows run along the room's long axis.
    const turned = region.h > region.w;
    const bw = turned ? block.h : block.w;
    const bh = turned ? block.w : block.h;
    const cols = Math.floor((region.w + WALKWAY) / (bw + WALKWAY));
    const rows = Math.floor((region.h + WALKWAY) / (bh + WALKWAY));
    const spareX = region.w - (cols * bw + (cols - 1) * WALKWAY);
    const spareY = region.h - (rows * bh + (rows - 1) * WALKWAY);
    let wanted = howMany(step.count, random);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = region.x + spareX / 2 + c * (bw + WALKWAY);
            const y = region.y + spareY / 2 + r * (bh + WALKWAY);
            if (wanted > 0 && placeCluster(floor, seating, { x, y, w: bw, h: bh }, turned, block)) {
                wanted -= 1;
            }
        }
    }
}

/**
 * One table with its seats in `cell`, facing it: along the side(s) of its
 * length, and at its ends too when it is seated all round.
 */
function placeCluster(
    floor: Floor,
    { table, seat, sides, round }: Seating,
    cell: Box,
    turned: boolean,
    block: { long: number; short: number; depth: number },
): boolean {
    if (!floor.free(cell)) {
        return false;
    }
    // The table's own box: past the seats at its ends when seated all round, and across the block past those on its
    // long sides (against the block's far side when seated on one side only).
    const along = round ? block.depth : 0;
    const across = sides === 2 ? block.depth : 0;
    const tableBox: Box = turned
        ? { x: cell.x + across, y: cell.y + along, w: block.short, h: block.long }
        : { x: cell.x + along, y: cell.y + across, w: block.long, h: block.short };
    // A table whose image is taller than wide is turned a quarter to lie along the block.
    const lengthwise = table.width >= table.height;
    const rotation = (turned ? QUARTER_TURN : 0) + (lengthwise ? 0 : QUARTER_TURN);
    floor.put(table, tableBox, rotation % FULL_TURN, null);
    if (seat) {
        // Each face named is the side of the table the row of seats looks from, as a wall a piece has its back to.
        const longSides: readonly Side[] = turned ? ['right', 'left'] : ['bottom', 'top'];
        const ends: readonly Side[] = turned ? ['bottom', 'top'] : ['right', 'left'];
        for (const side of [...longSides.slice(0, sides), ...(round ? ends : [])]) {
            seatRow(floor, seat, tableBox, side);
        }
    }
    return true;
}

function placeScattered(floor: Floor, stamp: RoleStamp, count: Count, random: Random): void {
    const { rect } = floor.room;
    let wanted = howMany(count, random);
    for (let attempt = 0; attempt < SCATTER_TRIES * Math.max(1, Math.min(wanted, rect.w * rect.h)) && wanted > 0; attempt++) {
        const rotation = randomInt(random, 0, FULL_TURN / SCATTER_ANGLE_STEP - 1) * SCATTER_ANGLE_STEP;
        const radians = (rotation * Math.PI) / (FULL_TURN / 2);
        // The rotated piece's bounding box.
        const w = Math.abs(stamp.width * Math.cos(radians)) + Math.abs(stamp.height * Math.sin(radians));
        const h = Math.abs(stamp.width * Math.sin(radians)) + Math.abs(stamp.height * Math.cos(radians));
        const x = rect.x + random() * (rect.w - w);
        const y = rect.y + random() * (rect.h - h);
        const box: Box = { x, y, w, h };
        const nearWall =
            x - rect.x < SCATTER_BAND || y - rect.y < SCATTER_BAND || rect.x + rect.w - (x + w) < SCATTER_BAND || rect.y + rect.h - (y + h) < SCATTER_BAND;
        if (nearWall && floor.free(box)) {
            floor.put(stamp, box, rotation, null);
            wanted -= 1;
        }
    }
}

/** A rug at the room's middle, lying along its long axis; beneath everything, so it takes no floor. */
function placeUnderlay(floor: Floor, stamp: RoleStamp): void {
    const { rect } = floor.room;
    const turned = rect.h > rect.w !== stamp.height > stamp.width;
    const w = turned ? stamp.height : stamp.width;
    const h = turned ? stamp.width : stamp.height;
    if (w <= rect.w - 1 && h <= rect.h - 1) {
        floor.placed.push({
            stamp: stamp.key,
            x: rect.x + rect.w / 2,
            y: rect.y + rect.h / 2,
            rotation: ((turned ? QUARTER_TURN : 0) + stamp.turn) % FULL_TURN,
        });
    }
}

/** The role a step is for: a cluster's table, else what it places. */
const mainRole = (step: Step): StampRole => (step.kind === 'cluster' ? step.centre : step.role);

/** Whether a room needs what a step places: a rug is a nicety, and so is anything it may have none of. */
function required(step: Step): boolean {
    if (step.kind === 'underlay') {
        return false;
    }
    const { count } = step;
    return count === 'fill' || (typeof count === 'number' ? count : count[0]) > 0;
}

/** Furnish `room` by its purpose's template; the roles it wanted that no loaded stamp has. */
export function furnishRoom(room: RoomFloor, stamps: RoleIndex, random: Random): { stamps: ComposedStamp[]; missing: StampRole[] } {
    const floor = new Floor(room, doorApproaches(room));
    const chosen = new Map<StampRole, RoleStamp | undefined>();
    const choose = (role: StampRole): RoleStamp | undefined => {
        if (!chosen.has(role)) {
            chosen.set(role, pick(random, stamps.get(role) ?? []));
        }
        return chosen.get(role);
    };
    const missing = new Set<StampRole>();
    for (const step of ROOM_TEMPLATES[room.purpose]) {
        if (required(step) && choose(mainRole(step)) === undefined) {
            missing.add(mainRole(step));
        }
        runStep(floor, step, choose, random);
    }
    // Rugs lie beneath everything: first in the drawing order.
    const rugs = new Set([...(stamps.get('rug') ?? [])].map((s) => s.key));
    const placed = [...floor.placed.filter((p) => rugs.has(p.stamp)), ...floor.placed.filter((p) => !rugs.has(p.stamp))];
    return { stamps: placed, missing: [...missing] };
}

function runStep(floor: Floor, step: Step, choose: (role: StampRole) => RoleStamp | undefined, random: Random): void {
    switch (step.kind) {
        case 'wall': {
            const stamp = choose(step.role);
            if (stamp) {
                placeOnWalls(floor, step, stamp, step.front ? choose(step.front) : undefined, random);
            }
            return;
        }
        case 'corner': {
            const stamp = choose(step.role);
            if (stamp) {
                placeInCorners(floor, stamp, step.count, random);
            }
            return;
        }
        case 'cluster': {
            const table = choose(step.centre);
            if (table) {
                // The first kind of seat the room has that suits the table: a bench far longer than it gives way to chairs.
                const seat = step.around.map(choose).find((s) => s !== undefined && fitsBeside(s, table));
                placeClusters(floor, step, seatingOf(table, seat, step.sides), random);
            }
            return;
        }
        case 'scatter': {
            const stamp = choose(step.role);
            if (stamp) {
                placeScattered(floor, stamp, step.count, random);
            }
            return;
        }
        case 'underlay': {
            const stamp = choose(step.role);
            if (stamp) {
                placeUnderlay(floor, stamp);
            }
        }
    }
}
