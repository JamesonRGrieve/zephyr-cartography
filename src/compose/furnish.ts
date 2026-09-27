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
 * - `rows`: pews in rows facing a piece already on a wall (an altar), from
 *   before it to the far wall, split by a centre aisle when there is room.
 * - `dress`: what is set on every table, bar, desk and workbench the room
 *   has (a meal, tankards, papers), within its top; built, it stands on it.
 * A wall step may prefer outer walls, inner ones, or those `far` from the
 * doors (an altar faces the way in).
 * The approach to every door is kept clear, and nothing overlaps. A room's
 * chairs, tables, beds and pews match, one stamp each; its other pieces are
 * drawn afresh one by one, so they vary. Pure and unit-tested; positions are
 * in grid squares.
 */
import type { Rect, Side } from '../generate/floor-plan';
import { pick, randomInt, shuffled, type Random } from '../generate/random';
import type { StampRole } from '../stamps/schema';
import type { RoomPurpose } from './intent';
import { isSurfaceRole } from './role-tags';
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
    /** The wall with the building's front door, when this room has it. */
    readonly entrance: Side | null;
}

/** How many to place: exactly, between two bounds, one per `per` squares of the room's walls (at least one), or as many as fit. */
type Count = number | readonly [number, number] | { readonly per: number } | 'fill';

/** Squares of wall per light in a room lit along its walls, so a hall or a nave is lit end to end by night. */
const LIGHT_SPACING = 8;

/** Which walls a wall step tries first. */
type WallPreference = 'outer' | 'inner' | 'far';

/**
 * A wall step: pieces of `role` against the walls, `count` of them, walls of
 * `prefer` first, each with what goes with it:
 * - `front`: a row of seats facing it (stools at a bar);
 * - `beside`: one piece next to it along the wall (a nightstand by a bed);
 * - `before`: one piece before its front (a chest at a bed's foot);
 * - `standoff` squares out from the wall, with `behind` filling the wall
 *   behind it (a bar counter with the stocked shelves behind the barkeep).
 */
interface WallStep {
    readonly kind: 'wall';
    readonly role: StampRole;
    readonly count: Count;
    readonly prefer?: WallPreference;
    readonly front?: StampRole;
    readonly beside?: StampRole;
    readonly before?: StampRole;
    readonly standoff?: number;
    readonly behind?: StampRole;
}

type Step =
    | WallStep
    | { readonly kind: 'corner'; readonly role: StampRole; readonly count: Count }
    | { readonly kind: 'cluster'; readonly centre: StampRole; readonly around: readonly StampRole[]; readonly count: Count; readonly sides: 1 | 2 }
    | { readonly kind: 'scatter'; readonly role: StampRole; readonly count: Count }
    | { readonly kind: 'underlay'; readonly role: StampRole }
    | { readonly kind: 'rows'; readonly role: StampRole; readonly facing: StampRole }
    | { readonly kind: 'dress'; readonly role: StampRole; readonly count: Count };

/** What each kind of room holds, in the order it is placed: the anchoring pieces first, the clutter last. */
export const ROOM_TEMPLATES: Readonly<Record<RoomPurpose, readonly Step[]>> = {
    'common-room': [
        { kind: 'wall', role: 'hearth', count: 1, prefer: 'outer' },
        { kind: 'cluster', centre: 'table', around: ['bench', 'seat'], count: 'fill', sides: 2 },
        { kind: 'dress', role: 'tabletop', count: [1, 3] },
        { kind: 'wall', role: 'light', count: { per: LIGHT_SPACING } },
        { kind: 'corner', role: 'storage', count: [1, 2] },
        { kind: 'wall', role: 'storage', count: [1, 3] },
        { kind: 'scatter', role: 'clutter', count: [2, 4] },
    ],
    // The counter stands out from the wall, stocked shelves on the wall behind the barkeep, stools before it, drink on it.
    'bar': [
        { kind: 'wall', role: 'counter', count: 1, prefer: 'inner', front: 'seat', standoff: 1.3, behind: 'shelf' },
        { kind: 'dress', role: 'tabletop', count: [2, 4] },
        { kind: 'wall', role: 'shelf', count: [0, 1] },
        { kind: 'corner', role: 'storage', count: [1, 3] },
        { kind: 'wall', role: 'storage', count: [1, 3] },
        { kind: 'scatter', role: 'clutter', count: [1, 2] },
    ],
    'kitchen': [
        { kind: 'wall', role: 'hearth', count: 1, prefer: 'outer' },
        { kind: 'wall', role: 'workbench', count: [1, 2] },
        { kind: 'dress', role: 'tabletop', count: [1, 2] },
        { kind: 'wall', role: 'shelf', count: [1, 2] },
        { kind: 'corner', role: 'storage', count: [2, 4] },
        { kind: 'wall', role: 'storage', count: [1, 2] },
        { kind: 'scatter', role: 'clutter', count: [2, 3] },
    ],
    'storage': [
        { kind: 'corner', role: 'storage', count: 4 },
        { kind: 'wall', role: 'shelf', count: [1, 3] },
        { kind: 'wall', role: 'storage', count: 'fill' },
        { kind: 'scatter', role: 'clutter', count: [1, 3] },
    ],
    // A bed with its nightstand beside it and a chest at its foot, a desk to write at, something set on it.
    'bedroom': [
        { kind: 'underlay', role: 'rug' },
        { kind: 'wall', role: 'bed', count: [1, 2], prefer: 'inner', beside: 'nightstand', before: 'storage' },
        { kind: 'wall', role: 'desk', count: [0, 1] },
        { kind: 'dress', role: 'tabletop', count: [1, 2] },
        { kind: 'corner', role: 'storage', count: [0, 1] },
        { kind: 'scatter', role: 'clutter', count: [0, 2] },
    ],
    'hall': [
        { kind: 'underlay', role: 'rug' },
        { kind: 'wall', role: 'bench', count: [1, 2] },
        { kind: 'wall', role: 'light', count: { per: LIGHT_SPACING } },
        { kind: 'corner', role: 'storage', count: [0, 1] },
    ],
    'office': [
        { kind: 'underlay', role: 'rug' },
        { kind: 'cluster', centre: 'desk', around: ['seat'], count: 1, sides: 1 },
        { kind: 'dress', role: 'tabletop', count: [2, 3] },
        { kind: 'wall', role: 'shelf', count: [1, 3] },
        { kind: 'corner', role: 'storage', count: [0, 1] },
        { kind: 'scatter', role: 'clutter', count: [1, 2] },
    ],
    'workshop': [
        { kind: 'wall', role: 'workbench', count: [2, 3] },
        { kind: 'dress', role: 'tabletop', count: [0, 2] },
        { kind: 'wall', role: 'shelf', count: [1, 2] },
        { kind: 'corner', role: 'storage', count: [1, 3] },
        { kind: 'scatter', role: 'clutter', count: [2, 4] },
    ],
    'shrine': [
        { kind: 'wall', role: 'table', count: 1, prefer: 'inner' },
        { kind: 'dress', role: 'tabletop', count: [1, 2] },
        { kind: 'cluster', centre: 'bench', around: [], count: 'fill', sides: 1 },
        { kind: 'wall', role: 'light', count: 2 },
    ],
    'cell': [
        { kind: 'wall', role: 'bed', count: 1 },
        { kind: 'scatter', role: 'clutter', count: [0, 1] },
    ],
    'mess': [
        { kind: 'wall', role: 'counter', count: 1, prefer: 'inner' },
        { kind: 'cluster', centre: 'table', around: ['bench', 'seat'], count: 'fill', sides: 2 },
        { kind: 'dress', role: 'tabletop', count: [1, 3] },
        { kind: 'wall', role: 'icon', count: [0, 2] },
        { kind: 'corner', role: 'storage', count: [1, 2] },
        { kind: 'scatter', role: 'clutter', count: [2, 4] },
    ],
    'chapel': [
        { kind: 'wall', role: 'altar', count: 1, prefer: 'far' },
        { kind: 'rows', role: 'pew', facing: 'altar' },
        { kind: 'wall', role: 'lectern', count: [0, 1], prefer: 'far' },
        { kind: 'wall', role: 'icon', count: [2, 4] },
        { kind: 'wall', role: 'light', count: { per: LIGHT_SPACING } },
        { kind: 'scatter', role: 'clutter', count: [0, 2] },
    ],
    'medicae': [
        { kind: 'wall', role: 'medical', count: [2, 5] },
        { kind: 'wall', role: 'console', count: [0, 1] },
        { kind: 'wall', role: 'storage', count: [1, 2] },
        { kind: 'corner', role: 'storage', count: [0, 1] },
        { kind: 'scatter', role: 'clutter', count: [1, 3] },
    ],
    'command': [
        { kind: 'wall', role: 'console', count: [2, 4] },
        { kind: 'cluster', centre: 'table', around: ['seat'], count: 1, sides: 2 },
        { kind: 'wall', role: 'desk', count: [0, 2] },
        { kind: 'dress', role: 'tabletop', count: [1, 3] },
        { kind: 'wall', role: 'icon', count: [1, 2] },
        { kind: 'corner', role: 'storage', count: [1, 2] },
        { kind: 'scatter', role: 'clutter', count: [1, 3] },
    ],
    'armoury': [
        { kind: 'wall', role: 'rack', count: [3, 6] },
        { kind: 'corner', role: 'storage', count: [2, 4] },
        { kind: 'wall', role: 'workbench', count: [0, 1] },
        { kind: 'wall', role: 'storage', count: [1, 3] },
        { kind: 'scatter', role: 'clutter', count: [0, 2] },
    ],
    'barracks': [
        { kind: 'corner', role: 'storage', count: [1, 2] },
        { kind: 'wall', role: 'bed', count: 'fill' },
        { kind: 'wall', role: 'rack', count: [0, 1] },
        { kind: 'scatter', role: 'clutter', count: [1, 3] },
    ],
    'manufactorum': [
        { kind: 'cluster', centre: 'machine', around: [], count: 'fill', sides: 1 },
        { kind: 'wall', role: 'workbench', count: [1, 3] },
        { kind: 'wall', role: 'console', count: [0, 1] },
        { kind: 'corner', role: 'storage', count: [1, 3] },
        { kind: 'scatter', role: 'debris', count: [1, 3] },
        { kind: 'scatter', role: 'clutter', count: [1, 2] },
    ],
    'interrogation': [
        { kind: 'cluster', centre: 'restraint', around: [], count: 1, sides: 1 },
        { kind: 'wall', role: 'medical', count: [0, 1] },
        { kind: 'wall', role: 'console', count: [0, 1] },
        { kind: 'wall', role: 'light', count: 1 },
        { kind: 'scatter', role: 'debris', count: [0, 2] },
        { kind: 'scatter', role: 'clutter', count: [0, 2] },
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
const HALF_TURN = 180;

/** Roles whose pieces have no back to set against a wall (a candle stand, a brazier): drawn with depth, they still stand unturned by any wall. */
const BACKLESS_ROLES: readonly StampRole[] = ['light'];
const FULL_TURN = 360;

/** Rotation steps for scattered pieces. */
const SCATTER_ANGLE_STEP = 15;

/** A floor area in squares: what a piece takes, or what is kept clear. */
export interface Box {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The smallest box holding both. */
function spanning(a: Box, b: Box): Box {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export const within = (inner: Box, outer: Box): boolean =>
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** The floor as it fills up: pieces placed, and clear space (door approaches, a counter's front) nothing may stand on. */
class Floor {
    readonly placed: ComposedStamp[] = [];
    /** The wall each role's first piece stands against, and the floor it and its kept front take: what rows face. */
    readonly onWall = new Map<StampRole, { readonly side: Side; readonly reach: Box }>();
    /** The tops of the tables, bars and desks placed, for what is set on them. */
    readonly surfaces: Box[] = [];
    private readonly taken: Box[] = [];
    private readonly kept: Box[];

    constructor(readonly room: RoomFloor, doors: readonly Box[]) {
        this.kept = [...doors];
    }

    /** Keep `box` open floor: nothing placed after stands there. */
    keep(box: Box): void {
        this.kept.push(box);
    }

    free(box: Box, keepClear = true): boolean {
        return within(box, this.room.rect) && !this.taken.some((t) => overlaps(t, box)) && (!keepClear || !this.kept.some((k) => overlaps(k, box)));
    }

    /** Whether `stamp` can stand turned by `rotation`: art drawn with depth only as drawn, never turned. */
    static stands(stamp: RoleStamp, rotation: number): boolean {
        return !stamp.upright || rotation % FULL_TURN === 0;
    }

    /** Place a piece, unless it would have to be turned and cannot be; whether it was placed. */
    put(stamp: RoleStamp, box: Box, rotation: number, clear: Box | null): boolean {
        if (!Floor.stands(stamp, rotation)) {
            return false;
        }
        this.taken.push(box);
        if (clear) {
            this.kept.push(clear);
        }
        this.placed.push({ stamp: stamp.key, x: box.x + box.w / 2, y: box.y + box.h / 2, rotation: (rotation + stamp.turn) % FULL_TURN });
        if (isSurfaceRole(stamp.role)) {
            this.surfaces.push(box);
        }
        return true;
    }

    /** Set a piece on a surface: it takes no floor, and stands on the surface when built. */
    setOn(stamp: RoleStamp, box: Box, rotation: number): void {
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

/** The clear approach inside a door in `rect`'s wall: nothing stands there, and no stairwell opens there. */
export function doorApproach(rect: Rect, { side, at }: { readonly side: Side; readonly at: number }): Box {
    return ALONG_WALL[side](rect, at - DOOR_CLEAR.margin, 1 + 2 * DOOR_CLEAR.margin, DOOR_CLEAR.depth, 0);
}

/** The clear approach inside each door of a room. */
function doorApproaches(room: RoomFloor): Box[] {
    return room.doors.map((door) => doorApproach(room.rect, door));
}

/** How many a step asks for in `rect`: a fixed number, a seeded pick between bounds, as many as its walls' length calls for, or effectively unbounded. */
function howMany(count: Count, random: Random, rect: Rect): number {
    if (count === 'fill') {
        return Number.POSITIVE_INFINITY;
    }
    if (typeof count === 'number') {
        return count;
    }
    return 'per' in count ? Math.max(1, Math.round((2 * (rect.w + rect.h)) / count.per)) : randomInt(random, count[0], count[1]);
}

/** A wall's extent: the room's width for the top and bottom walls, its height for the sides. */
function wallSpan(rect: Rect, side: Side): { lo: number; hi: number } {
    return side === 'top' || side === 'bottom' ? { lo: rect.x, hi: rect.x + rect.w } : { lo: rect.y, hi: rect.y + rect.h };
}

const OPPOSITE: Readonly<Record<Side, Side>> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/**
 * How far each wall is from the way in, lowest first: the wall facing the
 * front door, then one facing another door, then the other doorless walls,
 * walls with doors last.
 */
function farFromDoors(room: RoomFloor, side: Side): number {
    if (room.doors.some((d) => d.side === side)) {
        return 3;
    }
    if (room.entrance !== null && OPPOSITE[room.entrance] === side) {
        return 0;
    }
    return room.doors.some((d) => OPPOSITE[d.side] === side) ? 1 : 2;
}

/** The room's walls, those it prefers first, each group in a seeded order. */
function wallOrder(room: RoomFloor, prefer: WallPreference | undefined, random: Random): Side[] {
    const sides = shuffled(random, ['top', 'right', 'bottom', 'left'] as const);
    if (prefer === undefined) {
        return sides;
    }
    if (prefer === 'far') {
        return [...sides].sort((a, b) => farFromDoors(room, a) - farFromDoors(room, b));
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

/** The next piece of a role to place: the room's one kind, or, for a role whose pieces differ, a fresh pick after each. */
type Draw = () => RoleStamp;

/** What a wall step's pieces bring with them, each drawn as it is placed. */
interface Companions {
    readonly seat: RoleStamp | undefined;
    readonly beside: Draw | undefined;
    readonly before: Draw | undefined;
    readonly behind: Draw | undefined;
}

/** Squares between a piece and what is set before it. */
const BEFORE_GAP = 0.1;

/** One companion piece in `box`, square to the wall at `side`, if the floor there is free. */
function putCompanion(floor: Floor, piece: RoleStamp, box: Box, side: Side): boolean {
    if (!floor.free(box)) {
        return false;
    }
    return floor.put(piece, box, BACK_TO[side], null);
}

/** A piece's companions: a neighbour beside it along the wall, one before it, and the wall behind it filled. */
function placeCompanions(floor: Floor, side: Side, t: number, stamp: RoleStamp, inset: number, companions: Companions): void {
    const { rect } = floor.room;
    if (companions.beside) {
        const piece = companions.beside();
        const right = ALONG_WALL[side](rect, t + stamp.width + ALONG_GAP, piece.width, piece.height, inset);
        const left = ALONG_WALL[side](rect, t - piece.width - ALONG_GAP, piece.width, piece.height, inset);
        if (!putCompanion(floor, piece, right, side)) {
            putCompanion(floor, piece, left, side);
        }
    }
    if (companions.before) {
        const piece = companions.before();
        putCompanion(
            floor,
            piece,
            ALONG_WALL[side](rect, t + (stamp.width - piece.width) / 2, piece.width, piece.height, inset + stamp.height + BEFORE_GAP),
            side,
        );
    }
    if (companions.behind && inset > 0) {
        // The wall behind a piece stood out from it, filled end to end; the floor between is left for whoever works there.
        let piece = companions.behind();
        for (let s = t; s + piece.width <= t + stamp.width; ) {
            if (piece.height < inset && putCompanion(floor, piece, ALONG_WALL[side](rect, s, piece.width, piece.height, 0), side)) {
                s += piece.width + ALONG_GAP;
                piece = companions.behind();
            } else {
                s += WALL_STEP;
            }
        }
        floor.keep(ALONG_WALL[side](rect, t, stamp.width, inset, 0));
    }
}

/**
 * The order to try a wall's `spots` in: end to end to fill it, nearest
 * `quota` evenly spaced marks for spaced pieces, else nearest the wall's
 * middle, give or take.
 */
function orderAlongWall(
    spots: readonly number[],
    count: Count,
    wall: { readonly lo: number; readonly hi: number; readonly width: number; readonly quota: number },
    random: Random,
): number[] {
    if (count === 'fill') {
        return [...spots];
    }
    const { lo, hi, width, quota } = wall;
    const marks =
        typeof count === 'object' && 'per' in count
            ? Array.from({ length: quota }, (_, i) => lo + ((i + 0.5) * (hi - lo)) / quota - width / 2)
            : [(lo + hi - width) / 2];
    const nearest = (t: number): number => Math.min(...marks.map((m) => Math.abs(m - t)));
    return [...spots].sort((a, b) => nearest(a) - nearest(b) + (random() - 0.5));
}

/**
 * Where `stamp` would stand against the `side` wall from `t` (`inset` out
 * from it, the wall ending at `hi`), its box, clear front and turn; null
 * where it does not fit, the floor is taken, or it would need a turn it
 * cannot take.
 */
function wallSpot(
    floor: Floor,
    stamp: RoleStamp,
    at: { readonly side: Side; readonly t: number; readonly hi: number; readonly inset: number },
): { box: Box; front: Box; turn: number } | null {
    const { side, t, hi, inset } = at;
    const { rect } = floor.room;
    // Art drawn with depth stands only where it needs no turn: its back to the top wall, or, having no back, unturned by any wall.
    const turn = stamp.upright && BACKLESS_ROLES.includes(stamp.role) ? 0 : BACK_TO[side];
    const sideways = (turn - BACK_TO[side]) % HALF_TURN !== 0;
    const along = sideways ? stamp.height : stamp.width;
    const depth = sideways ? stamp.width : stamp.height;
    if (t + along > hi - ALONG_GAP || !Floor.stands(stamp, turn)) {
        return null;
    }
    const box = ALONG_WALL[side](rect, t, along, depth, inset);
    const front = ALONG_WALL[side](rect, t, along, stamp.clearance, inset + depth);
    // Stood out from the wall, the floor behind it must be free too, for its companions and whoever works there.
    const behind = inset > 0 ? ALONG_WALL[side](rect, t, along, inset, 0) : null;
    // Its clear front may share floor with a door's approach: both are only floor kept open.
    const clear = floor.free(box) && (stamp.clearance === 0 || floor.free(front, false)) && (behind === null || floor.free(behind));
    return clear ? { box, front, turn } : null;
}

/** Place a wall step's pieces; how many it placed. */
function placeOnWalls(floor: Floor, step: WallStep, draw: Draw, companions: Companions, random: Random): number {
    const asked = howMany(step.count, random, floor.room.rect);
    let wanted = asked;
    const { rect } = floor.room;
    const inset = step.standoff ?? 0;
    let stamp = draw();
    const spacing = typeof step.count === 'object' && 'per' in step.count ? step.count.per : null;
    for (const side of wallOrder(floor.room, step.prefer, random)) {
        const { lo, hi } = wallSpan(rect, side);
        const spots: number[] = [];
        for (let t = lo + ALONG_GAP; t < hi - ALONG_GAP; t += WALL_STEP) {
            spots.push(t);
        }
        // Spaced pieces share out along every wall, each wall its share, evenly spaced along it.
        const quota = spacing === null ? Number.POSITIVE_INFINITY : Math.max(1, Math.round((hi - lo) / spacing));
        const placedAt: number[] = [];
        const order = orderAlongWall(spots, step.count, { lo, hi, width: stamp.width, quota }, random);
        for (const t of order) {
            if (wanted <= 0) {
                return asked;
            }
            if (placedAt.length >= quota) {
                break;
            }
            if (spacing !== null && placedAt.some((at) => Math.abs(at - t) < spacing / 2)) {
                continue;
            }
            const spot = wallSpot(floor, stamp, { side, t, hi, inset });
            if (spot) {
                const { box, front } = spot;
                floor.put(stamp, box, spot.turn, stamp.clearance > 0 ? front : null);
                if (!floor.onWall.has(stamp.role)) {
                    floor.onWall.set(stamp.role, { side, reach: spanning(box, front) });
                }
                if (companions.seat && step.front) {
                    seatRow(floor, companions.seat, box, side);
                }
                placeCompanions(floor, side, t, stamp, inset, companions);
                placedAt.push(t);
                wanted -= 1;
                stamp = draw();
            }
        }
    }
    return asked - wanted;
}

function placeInCorners(floor: Floor, draw: Draw, count: Count, random: Random): void {
    const { rect } = floor.room;
    let wanted = howMany(count, random, floor.room.rect);
    // Each corner as the room's left or right and top or bottom, the piece's back to the top or bottom wall.
    const corners = shuffled(random, [
        { right: false, bottom: false },
        { right: true, bottom: false },
        { right: true, bottom: true },
        { right: false, bottom: true },
    ]);
    let stamp = draw();
    for (const corner of corners) {
        const box: Box = {
            x: corner.right ? rect.x + rect.w - stamp.width : rect.x,
            y: corner.bottom ? rect.y + rect.h - stamp.height : rect.y,
            w: stamp.width,
            h: stamp.height,
        };
        // A pile drawn with depth stands in any corner as drawn; one drawn straight down turns its back to the nearer wall.
        const rotation = stamp.upright ? 0 : BACK_TO[corner.bottom ? 'bottom' : 'top'];
        if (wanted > 0 && floor.free(box) && floor.put(stamp, box, rotation, null)) {
            wanted -= 1;
            stamp = draw();
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

function placeClusters(floor: Floor, step: Extract<Step, { kind: 'cluster' }>, given: Seating, random: Random): void {
    const { rect } = floor.room;
    // Seats drawn with depth cannot be turned: one row of them, above each table, facing down onto it as drawn.
    const seating: Seating = given.seat?.upright === true ? { ...given, sides: 1, round: false } : given;
    const block = clusterBlock(seating);
    const region: Box = { x: rect.x + WALKWAY, y: rect.y + WALKWAY, w: rect.w - 2 * WALKWAY, h: rect.h - 2 * WALKWAY };
    // Rows run along the room's long axis; a table drawn with depth lies as drawn, its rows along its own length, as do those
    // seated by seats drawn with depth.
    const turned = seating.seat?.upright === true ? false : seating.table.upright ? seating.table.height > seating.table.width : region.h > region.w;
    const bw = turned ? block.h : block.w;
    const bh = turned ? block.w : block.h;
    const cols = Math.floor((region.w + WALKWAY) / (bw + WALKWAY));
    const rows = Math.floor((region.h + WALKWAY) / (bh + WALKWAY));
    const spareX = region.w - (cols * bw + (cols - 1) * WALKWAY);
    const spareY = region.h - (rows * bh + (rows - 1) * WALKWAY);
    let wanted = howMany(step.count, random, floor.room.rect);
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
    // Upright seats sit above the table, so it takes the block's lower part.
    const above = seat?.upright === true;
    const across = sides === 2 || above ? block.depth : 0;
    const tableBox: Box = turned
        ? { x: cell.x + across, y: cell.y + along, w: block.short, h: block.long }
        : { x: cell.x + along, y: cell.y + across, w: block.long, h: block.short };
    // A table whose image is taller than wide is turned a quarter to lie along the block; one drawn with depth lies as drawn.
    const lengthwise = table.width >= table.height;
    const rotation = table.upright ? 0 : (turned ? QUARTER_TURN : 0) + (lengthwise ? 0 : QUARTER_TURN);
    if (!floor.put(table, tableBox, rotation % FULL_TURN, null)) {
        return false;
    }
    if (seat) {
        // Each face named is the side of the table the row of seats looks from, as a wall a piece has its back to.
        const longSides: readonly Side[] = turned ? ['right', 'left'] : ['bottom', 'top'];
        const ends: readonly Side[] = turned ? ['bottom', 'top'] : ['right', 'left'];
        // Upright seats sit above the table looking down onto it: the row that looks from its bottom, unturned.
        const faces: readonly Side[] = above ? ['bottom'] : [...longSides.slice(0, sides), ...(round ? ends : [])];
        for (const side of faces) {
            seatRow(floor, seat, tableBox, side);
        }
    }
    return true;
}

function placeScattered(floor: Floor, draw: Draw, count: Count, random: Random): void {
    const { rect } = floor.room;
    let wanted = howMany(count, random, floor.room.rect);
    let stamp = draw();
    for (let attempt = 0; attempt < SCATTER_TRIES * Math.max(1, Math.min(wanted, rect.w * rect.h)) && wanted > 0; attempt++) {
        // Drawn side-on, it stands as drawn.
        const rotation = stamp.upright ? 0 : randomInt(random, 0, FULL_TURN / SCATTER_ANGLE_STEP - 1) * SCATTER_ANGLE_STEP;
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
            stamp = draw();
        }
    }
}

/** A rug at the room's middle, lying along its long axis; beneath everything, so it takes no floor. */
function placeUnderlay(floor: Floor, stamp: RoleStamp): void {
    const { rect } = floor.room;
    // Along the room's long axis, unless drawn with depth: then as drawn.
    const turned = !stamp.upright && rect.h > rect.w !== stamp.height > stamp.width;
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

/** Squares between rows of pews, and the width of the aisle between their two columns. */
const ROW_GAP = 0.3;
const AISLE = 1;

/**
 * Pews in rows facing the piece on the wall at `side` (its front `ahead`
 * squares deep kept open), filling towards the far wall with a walkway at
 * the back: two columns either side of a centre aisle where the room is
 * wide enough, else one down the middle.
 */
function placeRows(floor: Floor, pew: RoleStamp, side: Side, ahead: Box): void {
    const { rect } = floor.room;
    const horizontal = side === 'top' || side === 'bottom';
    // Along the facing wall, and away from it, in room coordinates.
    const across = horizontal ? { lo: rect.x, span: rect.w } : { lo: rect.y, span: rect.h };
    const inner = WALKWAY / 2;
    const columns = across.span - 2 * inner >= 2 * pew.width + AISLE ? 2 : 1;
    const used = columns * pew.width + (columns - 1) * AISLE;
    const starts = Array.from({ length: columns }, (_, c) => across.lo + (across.span - used) / 2 + c * (pew.width + AISLE));
    // Rows start past the piece and its kept front, and stop a walkway short of the far wall.
    const nearEdge = { top: ahead.y + ahead.h, bottom: ahead.y, left: ahead.x + ahead.w, right: ahead.x }[side];
    const farEdge = { top: rect.y + rect.h, bottom: rect.y, left: rect.x + rect.w, right: rect.x }[side];
    const depth = Math.abs(farEdge - nearEdge) - WALKWAY;
    const rows = Math.max(0, Math.floor((depth + ROW_GAP) / (pew.height + ROW_GAP)));
    // The pews' backs are to the far wall, so their seats face the piece.
    const rotation = BACK_TO[OPPOSITE[side]];
    const away = side === 'top' || side === 'left' ? 1 : -1;
    for (let r = 0; r < rows; r++) {
        const depthStart = nearEdge + away * (ROW_GAP + r * (pew.height + ROW_GAP));
        const d0 = away > 0 ? depthStart : depthStart - pew.height;
        for (const t of starts) {
            const box: Box = horizontal ? { x: t, y: d0, w: pew.width, h: pew.height } : { x: d0, y: t, w: pew.height, h: pew.width };
            if (floor.free(box)) {
                floor.put(pew, box, rotation, null);
            }
        }
    }
}

/** Squares kept between what is set on a surface and the surface's edge. */
const SURFACE_INSET = 0.05;

/** Tries per piece set on a surface before giving up on it. */
const SURFACE_TRIES = 12;

/** Pieces set on each of the room's surfaces, within its top and apart from one another. */
function placeOnSurfaces(floor: Floor, draw: Draw, count: Count, random: Random): void {
    for (const surface of floor.surfaces) {
        let wanted = howMany(count, random, floor.room.rect);
        const set: Box[] = [];
        for (let attempt = 0; attempt < SURFACE_TRIES * Math.max(1, Math.min(wanted, SURFACE_TRIES)) && wanted > 0; attempt++) {
            const piece = draw();
            // Square to the surface, or a quarter turned: a meal laid straight, not askew.
            const turned = !piece.upright && random() < QUARTER_TURN / FULL_TURN;
            const w = turned ? piece.height : piece.width;
            const h = turned ? piece.width : piece.height;
            const room = { w: surface.w - 2 * SURFACE_INSET - w, h: surface.h - 2 * SURFACE_INSET - h };
            if (room.w < 0 || room.h < 0) {
                continue;
            }
            const box: Box = { x: surface.x + SURFACE_INSET + random() * room.w, y: surface.y + SURFACE_INSET + random() * room.h, w, h };
            if (!set.some((other) => overlaps(other, box))) {
                set.push(box);
                floor.setOn(piece, box, turned ? QUARTER_TURN : 0);
                wanted -= 1;
            }
        }
    }
}

/** Every role a room of `purpose` may hold: what its template places and what comes with it. */
export function rolesOf(purpose: RoomPurpose): StampRole[] {
    const roles = ROOM_TEMPLATES[purpose].flatMap((step) => {
        if (step.kind === 'cluster') {
            return [step.centre, ...step.around];
        }
        if (step.kind === 'wall') {
            return [step.role, step.front, step.beside, step.before, step.behind].filter((role): role is StampRole => role !== undefined);
        }
        return [step.role];
    });
    return [...new Set(roles)];
}

/** The role a step is for: a cluster's table, else what it places. */
const mainRole = (step: Step): StampRole => (step.kind === 'cluster' ? step.centre : step.role);

/** Whether a room needs what a step places: a rug is a nicety, and so is anything it may have none of. */
function required(step: Step): boolean {
    if (step.kind === 'underlay') {
        return false;
    }
    if (step.kind === 'rows') {
        return true;
    }
    // A bare table is still a table: what is set on it is a nicety the packs may lack.
    if (step.kind === 'dress') {
        return false;
    }
    const { count } = step;
    if (count === 'fill' || typeof count === 'number') {
        return count === 'fill' || count > 0;
    }
    return 'per' in count || count[0] > 0;
}

/**
 * Roles whose pieces match within a room, as a set does: its chairs, its
 * tables, its beds, its pews. Every other role's pieces differ, each drawn
 * afresh, so a medicae holds gurneys and monitors, not one cart over again.
 */
const MATCHED_ROLES: readonly StampRole[] = ['table', 'seat', 'bench', 'bed', 'pew', 'rug'];

/**
 * Furnish `room` by its purpose's template, keeping `reserved` floor (a
 * stairwell) clear; the roles it wanted that no loaded stamp has.
 */
export function furnishRoom(
    room: RoomFloor,
    stamps: RoleIndex,
    random: Random,
    reserved: readonly Box[] = [],
): { stamps: ComposedStamp[]; missing: StampRole[] } {
    const floor = new Floor(room, [...doorApproaches(room), ...reserved]);
    const chosen = new Map<StampRole, RoleStamp | undefined>();
    const choose = (role: StampRole): RoleStamp | undefined => {
        if (!chosen.has(role)) {
            chosen.set(role, pick(random, stamps.get(role) ?? []));
        }
        return chosen.get(role);
    };
    const drawOf = (role: StampRole): Draw | undefined => {
        const first = choose(role);
        if (!first) {
            return undefined;
        }
        const all = stamps.get(role) ?? [];
        return MATCHED_ROLES.includes(role) ? () => first : () => pick(random, all) ?? first;
    };
    const missing = new Set<StampRole>();
    for (const step of ROOM_TEMPLATES[room.purpose]) {
        if (required(step) && choose(mainRole(step)) === undefined) {
            missing.add(mainRole(step));
        }
        runStep(floor, step, choose, drawOf, random);
    }
    // Rugs lie beneath everything: first in the drawing order.
    const rugs = new Set([...(stamps.get('rug') ?? [])].map((s) => s.key));
    const placed = [...floor.placed.filter((p) => rugs.has(p.stamp)), ...floor.placed.filter((p) => !rugs.has(p.stamp))];
    return { stamps: placed, missing: [...missing] };
}

function runStep(
    floor: Floor,
    step: Step,
    choose: (role: StampRole) => RoleStamp | undefined,
    drawOf: (role: StampRole) => Draw | undefined,
    random: Random,
): void {
    switch (step.kind) {
        case 'wall': {
            const draw = drawOf(step.role);
            const companion = (role: StampRole | undefined): Draw | undefined => (role ? drawOf(role) : undefined);
            if (draw) {
                const companions = { seat: step.front ? choose(step.front) : undefined, beside: companion(step.beside), before: companion(step.before) };
                const placed = placeOnWalls(floor, step, draw, { ...companions, behind: companion(step.behind) }, random);
                // A room too small to stand it out from the wall still gets it, against the wall.
                if (placed === 0 && step.standoff !== undefined) {
                    placeOnWalls(floor, { ...step, standoff: 0 }, draw, { ...companions, behind: undefined }, random);
                }
            }
            return;
        }
        case 'corner': {
            const draw = drawOf(step.role);
            if (draw) {
                placeInCorners(floor, draw, step.count, random);
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
            const draw = drawOf(step.role);
            if (draw) {
                placeScattered(floor, draw, step.count, random);
            }
            return;
        }
        case 'underlay': {
            const stamp = choose(step.role);
            if (stamp) {
                placeUnderlay(floor, stamp);
            }
            return;
        }
        case 'rows': {
            const stamp = choose(step.role);
            if (stamp) {
                const { side, reach } = floor.onWall.get(step.facing) ?? facingWall(floor.room, random);
                placeRows(floor, stamp, side, reach);
            }
            return;
        }
        case 'dress': {
            const draw = drawOf(step.role);
            if (draw) {
                placeOnSurfaces(floor, draw, step.count, random);
            }
        }
    }
}

/** With nothing on a wall to face, rows face the wall farthest from the way in, a walkway before it kept open. */
function facingWall(room: RoomFloor, random: Random): { side: Side; reach: Box } {
    const [side = 'top'] = wallOrder(room, 'far', random);
    const { lo, hi } = wallSpan(room.rect, side);
    return { side, reach: ALONG_WALL[side](room.rect, lo, hi - lo, WALKWAY, 0) };
}
