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
import { OPPOSITE_SIDE, type Rect, type Side } from '../generate/floor-plan';
import { pick, randomInt, shuffled, type Random } from '../generate/random';
import type { StampRole } from '../stamps/schema';
import { WALL_SIDES, type FixtureIntent, type RoomPurpose } from './intent';
import { FACING_TURN, fittedTo, namedArt, namedBox, type PlacedPiece, runOf, standsAs } from './named';
import { isPlaceholder } from './placeholders';
import { isSurfaceRole } from './role-tags';
import type { RoleIndex, RoleStamp } from './roles';

/** A stamp placed by the composer: its catalog key, footprint centre in squares, and rotation in degrees. */
export type ComposedStamp = PlacedPiece;

/** A room as furnishing sees it: its floor, the doors in its walls, and which walls are the building's outside. */
export interface RoomFloor {
    readonly key: string;
    readonly purpose: RoomPurpose;
    readonly rect: Rect;
    readonly doors: readonly { readonly side: Side; readonly at: number; readonly width?: number }[];
    readonly outer: readonly Side[];
    /** The wall with the building's front door, when this room has it. */
    readonly entrance: Side | null;
    /** Named pieces asked for, placed first, each where asked; none when omitted. */
    readonly fixtures?: readonly FixtureIntent[];
    /** Its fixtures then its purpose's template, or its fixtures alone; the former when omitted. */
    readonly furnish?: 'purpose' | 'fixtures';
    /** How much grime gathers on its floor, 0 none to 1 filthy; some when omitted. */
    readonly grime?: number;
}

/** How many to place: exactly, between two bounds, one per `per` squares of the room's walls (at least one), or as many as fit. */
type Count = number | readonly [number, number] | { readonly per: number } | 'fill';

/** Squares of wall per light in a room lit along its walls, so a hall or a nave is lit end to end by night. */
const LIGHT_SPACING = 8;

/** A table's shape: long (twice its width or more, for benches) or round (about square, seated all round). */
type TableShape = 'long' | 'round';

/** Whether `stamp` is of `shape`. */
function ofShape(stamp: RoleStamp, shape: TableShape): boolean {
    const aspect = Math.max(stamp.width, stamp.height) / Math.min(stamp.width, stamp.height);
    return shape === 'round' ? aspect <= SQUARE_TABLE_ASPECT : aspect > SQUARE_TABLE_ASPECT;
}

/**
 * Which walls a wall step tries first: outer or inner ones, those far from
 * the doors, the bottom wall, or the short ones (a bed's head against one, so
 * it lies along a narrow room, not across it).
 */
type WallPreference = 'outer' | 'inner' | 'far' | 'bottom' | 'short';

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
    /** Only these walls, in this order (a fixture asked for on one wall). */
    readonly sides?: readonly Side[];
    /** Where along its wall: the wall's start (top or left end), middle, end, or `count` spread evenly along it. */
    readonly along?: Along;
    /** Exactly there, never a little off it: a named fixture, the same in every room it stands in. */
    readonly exact?: boolean;
}

/** Where along its wall a piece stands. */
type Along = 'start' | 'middle' | 'end' | 'spread';

type Step =
    | WallStep
    | {
          readonly kind: 'corner';
          readonly role: StampRole;
          readonly count: Count;
          /** Where no corner is free, against a wall instead (a guest room's armchair). */
          readonly orWall?: true;
      }
    | {
          readonly kind: 'cluster';
          readonly centre: StampRole;
          readonly around: readonly StampRole[];
          readonly count: Count;
          readonly sides: 1 | 2;
          /** Tables of this shape only, where the room has any: long ones for benches, round ones seated all round. */
          readonly shape?: TableShape;
          /** Where no table fits out on the floor, one against a wall, its seat before it (a guest room's writing table). */
          readonly orWall?: true;
      }
    | { readonly kind: 'scatter'; readonly role: StampRole; readonly count: Count }
    | { readonly kind: 'underlay'; readonly role: StampRole }
    | { readonly kind: 'rows'; readonly role: StampRole; readonly facing: StampRole }
    | { readonly kind: 'dress'; readonly role: StampRole; readonly count: Count };

/** A few long tables with benches, round ones seated all round in the floor they leave: a mix, not a grid of one kind. */
const COMMON_ROOM: readonly Step[] = [
    { kind: 'wall', role: 'hearth', count: 1, prefer: 'outer' },
    { kind: 'cluster', centre: 'table', around: ['bench', 'seat'], count: [2, 3], sides: 2, shape: 'long' },
    { kind: 'cluster', centre: 'table', around: ['seat', 'bench'], count: 'fill', sides: 2, shape: 'round' },
    { kind: 'dress', role: 'tabletop', count: [1, 3] },
    { kind: 'wall', role: 'light', count: { per: LIGHT_SPACING } },
    { kind: 'corner', role: 'storage', count: [1, 2] },
    { kind: 'wall', role: 'storage', count: [1, 3] },
    { kind: 'scatter', role: 'clutter', count: [2, 4] },
];

/** What each kind of room holds, in the order it is placed: the anchoring pieces first, the clutter last. */
export const ROOM_TEMPLATES: Readonly<Record<RoomPurpose, readonly Step[]>> = {
    'common-room': COMMON_ROOM,
    // A taproom: the counter stands out from an inner wall, stocked shelves behind the barkeep, stools before it; the floor
    // it leaves is a common room's, its hearth and tables, never a counter alone in an empty room.
    'bar': [{ kind: 'wall', role: 'counter', count: 1, prefer: 'inner', front: 'seat', standoff: 1.3, behind: 'shelf' }, ...COMMON_ROOM],
    // The hearth on an outer wall, work surfaces along the walls and one down the middle, food and pots on them all.
    'kitchen': [
        { kind: 'wall', role: 'hearth', count: 1, prefer: 'outer' },
        { kind: 'wall', role: 'workbench', count: [1, 2] },
        { kind: 'cluster', centre: 'workbench', around: [], count: 1, sides: 1 },
        { kind: 'dress', role: 'tabletop', count: [2, 4] },
        { kind: 'wall', role: 'shelf', count: [1, 2] },
        { kind: 'corner', role: 'storage', count: [2, 4] },
        { kind: 'wall', role: 'storage', count: [1, 2] },
        { kind: 'scatter', role: 'clutter', count: [2, 3] },
    ],
    // Stores lining the walls and stacked in rows down the floor, aisles between, a lamp to find them by.
    'storage': [
        { kind: 'corner', role: 'storage', count: 4 },
        { kind: 'wall', role: 'shelf', count: [1, 3] },
        { kind: 'wall', role: 'storage', count: 'fill' },
        { kind: 'cluster', centre: 'storage', around: [], count: 'fill', sides: 1 },
        { kind: 'wall', role: 'light', count: [0, 1] },
        { kind: 'scatter', role: 'clutter', count: [2, 5] },
    ],
    // A bed with its nightstand beside it and a chest at its foot, a dresser or wardrobe on another wall, an armchair set
    // across a corner, a table and chair with something set on it, a lamp, a guest's belongings.
    'bedroom': [
        { kind: 'underlay', role: 'rug' },
        { kind: 'wall', role: 'bed', count: 1, prefer: 'short', beside: 'nightstand', before: 'chest' },
        { kind: 'wall', role: 'dresser', count: 1, prefer: 'outer' },
        { kind: 'corner', role: 'armchair', count: 1, orWall: true },
        { kind: 'cluster', centre: 'table', around: ['seat'], count: 1, sides: 1, orWall: true },
        // A wardrobe or washstand besides, where the room has wall to spare.
        { kind: 'wall', role: 'dresser', count: [0, 1] },
        { kind: 'dress', role: 'tabletop', count: [1, 3] },
        { kind: 'wall', role: 'light', count: 1 },
        // A guest's belongings, not a store: the chest at the bed's foot, perhaps a trunk in a corner, a little clutter.
        { kind: 'corner', role: 'chest', count: [0, 1] },
        { kind: 'scatter', role: 'clutter', count: [1, 2] },
    ],
    'hall': [
        { kind: 'underlay', role: 'rug' },
        { kind: 'wall', role: 'bench', count: [1, 2] },
        { kind: 'wall', role: 'light', count: { per: LIGHT_SPACING } },
        { kind: 'corner', role: 'storage', count: [0, 2] },
        { kind: 'scatter', role: 'clutter', count: [0, 2] },
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
        // A mess (or a great hall) eats at long tables with benches down both sides, not round ones.
        { kind: 'cluster', centre: 'table', around: ['bench', 'seat'], count: 'fill', sides: 2, shape: 'long' },
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
    // Open on three sides: a lamp by the door, a bench against the building, barrels at its ends, a crate or two.
    'porch': [
        { kind: 'wall', role: 'light', count: { per: LIGHT_SPACING * 2 }, prefer: 'inner' },
        { kind: 'wall', role: 'bench', count: [2, 3], prefer: 'inner' },
        { kind: 'corner', role: 'storage', count: [2, 3] },
        { kind: 'wall', role: 'storage', count: [2, 4], prefer: 'inner' },
        { kind: 'scatter', role: 'clutter', count: [1, 3] },
    ],
};

/** Squares kept clear inside a door: its width plus a margin either side, and how deep. */
export const DOOR_CLEAR = { margin: 0.25, depth: 1.5 } as const;

/** Squares left between neighbouring pieces along a wall, and between a wall's ends and the first. */
const ALONG_GAP = 0.15;

/** Squares of walkway kept round the table clusters, and between them. */
const WALKWAY = 0.8;

/** Squares between a table and its seats. */
const SEAT_GAP = 0.05;

/** Squares along a table or a bar each seated person takes, at the least: their elbow room. */
const SEAT_PITCH = 0.75;

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

/** A piece this many times longer than it is deep has a long way round: its footprint lies one way or the other. */
const ELONGATED = 1.5;

/**
 * Roles whose pieces have no back to set against a wall (a candle stand, a
 * brazier, a pile of crates, barrels or sacks, odds and ends): drawn with
 * depth, they still stand unturned by any wall, so every wall of a store
 * takes the whole mix, not only what is drawn straight down.
 */
const BACKLESS_ROLES: readonly StampRole[] = ['light', 'storage', 'clutter'];
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
    /** Each piece put, in order: its box and the turn it stands at (its back to the wall `BACK_TO` names). */
    readonly stood: { readonly box: Box; readonly turn: number }[] = [];
    private readonly taken: Box[] = [];
    private readonly kept: Box[];

    /** `ways` is floor always kept open: door approaches and the stairwell. */
    constructor(readonly room: RoomFloor, private readonly ways: readonly Box[]) {
        this.kept = [...ways];
    }

    /** Keep `box` open floor: nothing placed after stands there. */
    keep(box: Box): void {
        this.kept.push(box);
    }

    free(box: Box, keepClear = true): boolean {
        return within(box, this.room.rect) && !this.taken.some((t) => overlaps(t, box)) && (!keepClear || !this.kept.some((k) => overlaps(k, box)));
    }

    /**
     * Whether `box` is free of every piece and of the ways in and up, though
     * it stand in a piece's kept front: where a named fixture may be put on
     * purpose (stools before a counter).
     */
    clearOfWays(box: Box): boolean {
        return this.free(box, false) && !this.inWay(box);
    }

    /** Whether `box` lies across a way in or up: a door's approach or the stairwell. */
    inWay(box: Box): boolean {
        return this.ways.some((w) => overlaps(w, box));
    }

    /** Whether `stamp` can stand turned by `rotation`: isometric art only as drawn, never turned. */
    static stands(stamp: RoleStamp, rotation: number): boolean {
        return !stamp.upright || rotation % FULL_TURN === 0;
    }

    /** Place a piece, unless it would have to be turned and cannot be; whether it was placed. */
    put(stamp: RoleStamp, box: Box, rotation: number, clear: Box | null): boolean {
        if (!Floor.stands(stamp, rotation)) {
            return false;
        }
        this.taken.push(box);
        this.stood.push({ box, turn: rotation });
        if (clear) {
            this.kept.push(clear);
        }
        this.placed.push(...composedIn(stamp, box, rotation));
        if (isSurfaceRole(stamp.role)) {
            this.surfaces.push(box);
        }
        return true;
    }

    /** Set a piece on a surface: it takes no floor, and stands on the surface when built. */
    setOn(stamp: RoleStamp, box: Box, rotation: number): void {
        this.placed.push(...composedIn(stamp, box, rotation));
    }
}

/** `stamp` centred in `box`, turned `rotation` past as it is drawn, at the size it was fitted to: the piece, or a run's modules side by side along its width. */
const composedIn = (stamp: RoleStamp, box: Box, rotation: number): ComposedStamp[] => standsAs(stamp, { x: box.x + box.w / 2, y: box.y + box.h / 2 }, rotation);

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

/** How much grime a room gathers when its intent says nothing: some. */
const DEFAULT_GRIME = 0.5;

/**
 * Grime scattered at full measure: decals per square of floor; how far out
 * from a wall one lies at most (in squares, most close in, where dirt
 * gathers); and the tries each gets to find floor clear of a doorway.
 */
const GRIME = { perSquare: 0.1, reach: 1.4, tries: 6 } as const;

const WALLS: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/**
 * Decals (stains, cracks, dust) laid flat on the floor, `amount` of the full
 * measure (0 none, 1 a filthy room), gathered along the walls and into the
 * corners as dirt does, the open floor left mostly clean; never in a doorway
 * or a stairwell. They lie beneath the furniture and take no floor from it.
 */
function scatterGrime(floor: Floor, decals: readonly RoleStamp[], amount: number, random: Random): void {
    const { rect } = floor.room;
    const count = Math.round(rect.w * rect.h * GRIME.perSquare * amount);
    for (let n = 0; n < count && decals.length > 0; n++) {
        for (let attempt = 0; attempt < GRIME.tries; attempt++) {
            const decal = pick(random, decals);
            const side = pick(random, WALLS);
            if (decal === undefined || side === undefined) {
                break;
            }
            const turn = decal.upright ? 0 : BACK_TO[side];
            const sideways = turn % HALF_TURN !== 0;
            const [along, depth] = sideways ? [decal.height, decal.width] : [decal.width, decal.height];
            const { lo, hi } = wallSpan(rect, side);
            // Squared, so most lie close in against the wall.
            const box = ALONG_WALL[side](rect, lo + random() * Math.max(0, hi - lo - along), along, depth, random() ** 2 * GRIME.reach);
            if (within(box, rect) && !floor.inWay(box)) {
                floor.setOn(decal, box, turn);
                break;
            }
        }
    }
}

/** The clear approach inside a door in `rect`'s wall: nothing stands there, and no stairwell opens there. */
export function doorApproach(rect: Rect, { side, at, width = 1 }: { readonly side: Side; readonly at: number; readonly width?: number }): Box {
    return ALONG_WALL[side](rect, at - DOOR_CLEAR.margin, width + 2 * DOOR_CLEAR.margin, DOOR_CLEAR.depth, 0);
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

/**
 * How far each wall is from the way in, lowest first: the wall facing the
 * front door, then one facing another door, then the other doorless walls,
 * walls with doors last.
 */
function farFromDoors(room: RoomFloor, side: Side): number {
    if (room.doors.some((d) => d.side === side)) {
        return 3;
    }
    if (room.entrance !== null && OPPOSITE_SIDE[room.entrance] === side) {
        return 0;
    }
    return room.doors.some((d) => OPPOSITE_SIDE[d.side] === side) ? 1 : 2;
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
    if (prefer === 'bottom') {
        return ['bottom', ...sides.filter((s) => s !== 'bottom')];
    }
    if (prefer === 'short') {
        const extent = (s: Side): number => (s === 'top' || s === 'bottom' ? room.rect.w : room.rect.h);
        return [...sides].sort((a, b) => extent(a) - extent(b));
    }
    const outer = sides.filter((s) => room.outer.includes(s));
    const inner = sides.filter((s) => !room.outer.includes(s));
    return prefer === 'outer' ? [...outer, ...inner] : [...inner, ...outer];
}

/** Seats in a row before a piece: facing it, spread along its front. */
function seatRow(floor: Floor, seat: RoleStamp, before: Box, side: Side): void {
    const horizontal = side === 'top' || side === 'bottom';
    const span = horizontal ? before.w : before.h;
    // A seat to each person's elbow room, however narrow its art: a small stool is no reason to pack a table with them.
    const n = Math.max(1, Math.floor(span / Math.max(seat.width + ALONG_GAP, SEAT_PITCH)));
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

/** A wall piece that brings nothing with it. */
const NO_COMPANIONS: Companions = { seat: undefined, beside: undefined, before: undefined, behind: undefined };

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
    wall: { readonly lo: number; readonly hi: number; readonly width: number; readonly quota: number; readonly along: Along; readonly exact: boolean },
    random: Random,
): number[] {
    if (count === 'fill') {
        return [...spots];
    }
    const { lo, hi, width, quota, along, exact } = wall;
    const perWall = typeof count === 'object' && 'per' in count;
    const single: Readonly<Record<Exclude<Along, 'spread'>, number>> = { start: lo + ALONG_GAP, middle: (lo + hi - width) / 2, end: hi - width - ALONG_GAP };
    const marks = along === 'spread' || perWall ? Array.from({ length: quota }, (_, i) => lo + ((i + 0.5) * (hi - lo)) / quota - width / 2) : [single[along]];
    const nearest = (t: number): number => Math.min(...marks.map((m) => Math.abs(m - t)));
    // Exact: the marks themselves first, then the nearest spots, in order; else the nearest, give or take.
    return exact ? [...marks, ...[...spots].sort((a, b) => nearest(a) - nearest(b))] : [...spots].sort((a, b) => nearest(a) - nearest(b) + (random() - 0.5));
}

/**
 * The turn that stands `stamp` against the `side` wall. Isometric art
 * stands only where it needs no turn: its back to the top wall, or, having no
 * back, unturned by any wall.
 */
const wallTurn = (stamp: RoleStamp, side: Side): number => (stamp.upright && BACKLESS_ROLES.includes(stamp.role) ? 0 : BACK_TO[side]);

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
    const turn = wallTurn(stamp, side);
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
    // The floor behind it only needs no piece on it: a door there (the proprietor's, behind a counter) is walkable floor.
    const clear = floor.free(box) && (stamp.clearance === 0 || floor.free(front, false)) && (behind === null || floor.free(behind, false));
    return clear ? { box, front, turn } : null;
}

/** Place a wall step's pieces; how many it placed. */
function placeOnWalls(floor: Floor, step: WallStep, draw: Draw, companions: Companions, random: Random): number {
    const asked = howMany(step.count, random, floor.room.rect);
    let wanted = asked;
    const { rect } = floor.room;
    const inset = step.standoff ?? 0;
    let stamp = draw();
    const along = step.along ?? 'middle';
    // Spread along one wall: `count` of them, each its share of the wall.
    const spread = along === 'spread' && typeof step.count === 'number' ? step.count : null;
    const perSpacing = typeof step.count === 'object' && 'per' in step.count ? step.count.per : null;
    for (const side of step.sides ?? wallOrder(floor.room, step.prefer, random)) {
        const { lo, hi } = wallSpan(rect, side);
        const spots: number[] = [];
        for (let t = lo + ALONG_GAP; t < hi - ALONG_GAP; t += WALL_STEP) {
            spots.push(t);
        }
        // Spaced pieces share out along every wall, each wall its share, evenly spaced along it.
        const spacing = spread === null ? perSpacing : (hi - lo) / spread;
        const quota = spread ?? (spacing === null ? Number.POSITIVE_INFINITY : Math.max(1, Math.round((hi - lo) / spacing)));
        const placedAt: number[] = [];
        const order = orderAlongWall(spots, step.count, { lo, hi, width: stamp.width, quota, along, exact: step.exact === true }, random);
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
            } else if (!Floor.stands(stamp, wallTurn(stamp, side))) {
                // Drawn isometric, it stands by no wall but the top: another piece may, rather than this wall going bare.
                stamp = draw();
            }
        }
    }
    return asked - wanted;
}

/** A room's corner, as its right or left and bottom or top. */
interface Corner {
    readonly right: boolean;
    readonly bottom: boolean;
}

/** A room's four corners. */
const CORNERS: readonly Corner[] = [
    { right: false, bottom: false },
    { right: true, bottom: false },
    { right: true, bottom: true },
    { right: false, bottom: true },
];

/** Roles set across a corner, facing out into the room: an easy chair, not a pile of stores. */
const ACROSS_CORNER_ROLES: readonly StampRole[] = ['armchair'];

/** The turn that sets a piece's back into a corner, facing out along the diagonal (clockwise, its back up at 0). */
function acrossCorner({ right, bottom }: Corner): number {
    const eighth = FULL_TURN / 8;
    if (right) {
        return bottom ? HALF_TURN - eighth : eighth;
    }
    return bottom ? HALF_TURN + eighth : FULL_TURN - eighth;
}

/** Place pieces in the room's free corners; how many it still wanted when the corners ran out. */
function placeInCorners(floor: Floor, draw: Draw, count: Count, random: Random, only?: readonly Corner[]): number {
    const { rect } = floor.room;
    let wanted = howMany(count, random, floor.room.rect);
    // Each corner as the room's left or right and top or bottom, the piece's back to the top or bottom wall; those asked for alone.
    const corners = only ?? shuffled(random, CORNERS);
    let stamp = draw();
    for (const corner of corners) {
        // An easy chair drawn straight down sits across its corner, facing out into the room; it takes the square its
        // turned footprint spans.
        const across = !stamp.upright && ACROSS_CORNER_ROLES.includes(stamp.role);
        const span = (stamp.width + stamp.height) / Math.SQRT2;
        const [w, h] = across ? [span, span] : [stamp.width, stamp.height];
        const box: Box = {
            x: corner.right ? rect.x + rect.w - w : rect.x,
            y: corner.bottom ? rect.y + rect.h - h : rect.y,
            w,
            h,
        };
        // An isometric pile stands in any corner as drawn; one seen from above turns its back to the nearer wall.
        const square = BACK_TO[corner.bottom ? 'bottom' : 'top'];
        const rotation = stamp.upright ? 0 : across ? acrossCorner(corner) : square;
        if (wanted > 0 && floor.free(box) && floor.put(stamp, box, rotation, null)) {
            wanted -= 1;
            stamp = draw();
        }
    }
    return wanted;
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

/** How far a stack may sit off its slot's centre, in squares: rows of stores stacked by hand, not laid by rule. */
const STACK_JITTER = 0.15;

/**
 * One stack of stores drawn afresh into `cell` (sized for the bulkiest):
 * centred, a little off true, square to the rows.
 */
function placeStack(floor: Floor, piece: RoleStamp, cell: Box, turned: boolean, random: Random): boolean {
    const across = turned && !piece.upright;
    const w = across ? piece.height : piece.width;
    const h = across ? piece.width : piece.height;
    const jitter = (spare: number): number => Math.min(STACK_JITTER, spare / 2) * (2 * random() - 1);
    const box: Box = { x: cell.x + (cell.w - w) / 2 + jitter(cell.w - w), y: cell.y + (cell.h - h) / 2 + jitter(cell.h - h), w, h };
    return floor.free(cell) && floor.put(piece, box, across ? QUARTER_TURN : 0, null);
}

/** How a room's tables are seated and laid: one row of isometric seats above each, rows along the floor's length. */
function clusterLie(given: Seating, rect: Rect): { seating: Seating; region: Box; turned: boolean } {
    // Isometric seats cannot be turned: one row of them, above each table, facing down onto it as drawn.
    const seating: Seating = given.seat?.upright === true ? { ...given, sides: 1, round: false } : given;
    const region: Box = { x: rect.x + WALKWAY, y: rect.y + WALKWAY, w: rect.w - 2 * WALKWAY, h: rect.h - 2 * WALKWAY };
    // Rows run along the room's long axis; an isometric table lies as drawn, its rows along its own length, as do those
    // seated by isometric seats.
    const turned = seating.seat?.upright === true ? false : seating.table.upright ? seating.table.height > seating.table.width : region.h > region.w;
    return { seating, region, turned };
}

/** Whether a table and its seats, laid as they would be, fit within `rect`'s floor inside the walkway kept round them. */
function blockFits(rect: Rect, given: Seating): boolean {
    const { seating, region, turned } = clusterLie(given, rect);
    const block = clusterBlock(seating);
    const [w, h] = turned ? [block.h, block.w] : [block.w, block.h];
    return w <= region.w && h <= region.h;
}

/** How far a table may stand off its row, in squares: under half the walkway kept between tables, so one always remains. */
const TABLE_JITTER = 0.25;

/** Place a cluster step's tables and their seats (or stacks) across the open floor; how many it placed. */
function placeClusters(floor: Floor, step: Extract<Step, { kind: 'cluster' }>, given: Seating, random: Random, stack?: Draw): number {
    const { seating, region, turned } = clusterLie(given, floor.room.rect);
    const block = clusterBlock(seating);
    const bw = turned ? block.h : block.w;
    const bh = turned ? block.w : block.h;
    const cols = Math.floor((region.w + WALKWAY) / (bw + WALKWAY));
    const rows = Math.floor((region.h + WALKWAY) / (bh + WALKWAY));
    const spareX = region.w - (cols * bw + (cols - 1) * WALKWAY);
    const spareY = region.h - (rows * bh + (rows - 1) * WALKWAY);
    let wanted = howMany(step.count, random, floor.room.rect);
    let placed = 0;
    const placeOne = (cell: Box): boolean => {
        // Tables stand a little off their rows, as a room's are left, never ruled into a grid; true to the row where the
        // shifted spot is taken.
        const shift = (): number => TABLE_JITTER * (2 * random() - 1);
        const off = { ...cell, x: cell.x + shift(), y: cell.y + shift() };
        const done = stack
            ? placeStack(floor, stack(), cell, turned, random)
            : placeCluster(floor, seating, off, turned, block, random) || placeCluster(floor, seating, cell, turned, block, random);
        placed += done ? 1 : 0;
        return done;
    };
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = region.x + spareX / 2 + c * (bw + WALKWAY);
            const y = region.y + spareY / 2 + r * (bh + WALKWAY);
            if (wanted > 0 && placeOne({ x, y, w: bw, h: bh })) {
                wanted -= 1;
            }
        }
    }
    // Still wanting more, the floor the rows left (round a hearth, a bed, a doorway) takes them, a walkway still round each.
    const half = WALKWAY / 2;
    for (let y = region.y; y + bh <= region.y + region.h && wanted > 0; y += CLUSTER_STEP) {
        for (let x = region.x; x + bw <= region.x + region.w && wanted > 0; x += CLUSTER_STEP) {
            const walkway = { x: x - half, y: y - half, w: bw + WALKWAY, h: bh + WALKWAY };
            // The walkway round it is only floor to walk: it may run through a doorway's approach or before a hearth, as they are.
            if (floor.free(walkway, false) && placeOne({ x, y, w: bw, h: bh })) {
                wanted -= 1;
            }
        }
    }
    return placed;
}

/** Squares between the spots a filling tries for another table. */
const CLUSTER_STEP = 0.5;

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
    random: Random,
): boolean {
    if (!floor.free(cell)) {
        return false;
    }
    // A round table seen from above is turned whichever way it was left, a quarter at a time so its footprint holds.
    const set = !table.upright && ofShape(table, 'round') ? QUARTER_TURN * Math.floor(random() * (FULL_TURN / QUARTER_TURN)) : 0;
    // The table's own box: past the seats at its ends when seated all round, and across the block past those on its
    // long sides (against the block's far side when seated on one side only).
    const along = round ? block.depth : 0;
    // Upright seats sit above the table, so it takes the block's lower part.
    const above = seat?.upright === true;
    const across = sides === 2 || above ? block.depth : 0;
    const tableBox: Box = turned
        ? { x: cell.x + across, y: cell.y + along, w: block.short, h: block.long }
        : { x: cell.x + along, y: cell.y + across, w: block.long, h: block.short };
    // A table whose image is taller than wide is turned a quarter to lie along the block; an isometric one lies as drawn.
    const lengthwise = table.width >= table.height;
    const rotation = table.upright ? 0 : (turned ? QUARTER_TURN : 0) + (lengthwise ? 0 : QUARTER_TURN);
    if (!floor.put(table, tableBox, (rotation + set) % FULL_TURN, null)) {
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
    // Along the room's long axis, unless isometric: then as drawn.
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

/** Squares deep a row of pews stands at most: the pew and the knees before it. */
const PEW_ROW_DEPTH = 1;

/**
 * What stands in each row across `room` squares: the pew as drawn, two
 * columns either side of an aisle where they fit; or, art drawn deeper than
 * a row (a pew with its kneeler and floor round it), that art fitted to a
 * row's depth and laid as a run of pews along each column where it is long
 * enough, so the rows still fit a small chapel and still read as pews.
 */
function rowOf(pew: RoleStamp, room: number, aisle: number): { readonly piece: RoleStamp; readonly columns: number } {
    if (pew.height <= PEW_ROW_DEPTH) {
        return { piece: pew, columns: room >= 2 * pew.width + aisle ? 2 : 1 };
    }
    const one = fittedTo(pew, pew.width, PEW_ROW_DEPTH);
    const columns = room >= 2 * one.width + aisle ? 2 : 1;
    const span = Math.min(room, (room - (columns - 1) * aisle) / columns);
    return { piece: runOf(pew, span, PEW_ROW_DEPTH) ?? fittedTo(pew, span, PEW_ROW_DEPTH), columns };
}

/**
 * Pews in rows facing the piece on the wall at `side` (its front `ahead`
 * squares deep kept open), filling towards the far wall with a walkway at
 * the back: two columns either side of a centre aisle where the room is
 * wide enough, else one down the middle. How many pews stood.
 */
function placeRows(floor: Floor, drawn: RoleStamp, side: Side, ahead: Box): number {
    const { rect } = floor.room;
    const horizontal = side === 'top' || side === 'bottom';
    // Along the facing wall, and away from it, in room coordinates.
    const across = horizontal ? { lo: rect.x, span: rect.w } : { lo: rect.y, span: rect.h };
    const inner = WALKWAY / 2;
    // The aisle runs from a door in the far wall to what the pews face, so the way in is the way up the nave, as wide as the
    // door's kept approach so the back rows stand either side of it; with no such door, a centred aisle.
    const door = floor.room.doors.find((d) => d.side === OPPOSITE_SIDE[side]);
    const aisle = door === undefined ? AISLE : Math.max(AISLE, (door.width ?? 1) + 2 * DOOR_CLEAR.margin);
    const { piece: pew, columns } = rowOf(drawn, across.span - 2 * inner, aisle);
    const used = columns * pew.width + (columns - 1) * aisle;
    const centred = across.lo + (across.span - used) / 2;
    const [first, last] = [across.lo + inner, across.lo + across.span - inner - used];
    const lo = columns === 2 && door !== undefined ? Math.min(last, Math.max(first, door.at + (door.width ?? 1) / 2 - aisle / 2 - pew.width)) : centred;
    const starts = Array.from({ length: columns }, (_, c) => lo + c * (pew.width + aisle));
    // Rows start past the piece and its kept front, and stop a walkway short of the far wall.
    const nearEdge = { top: ahead.y + ahead.h, bottom: ahead.y, left: ahead.x + ahead.w, right: ahead.x }[side];
    const farEdge = { top: rect.y + rect.h, bottom: rect.y, left: rect.x + rect.w, right: rect.x }[side];
    const depth = Math.abs(farEdge - nearEdge) - WALKWAY;
    const rows = Math.max(0, Math.floor((depth + ROW_GAP) / (pew.height + ROW_GAP)));
    // The pews' backs are to the far wall, so their seats face the piece.
    const rotation = BACK_TO[OPPOSITE_SIDE[side]];
    const away = side === 'top' || side === 'left' ? 1 : -1;
    let stood = 0;
    for (let r = 0; r < rows; r++) {
        const depthStart = nearEdge + away * (ROW_GAP + r * (pew.height + ROW_GAP));
        const d0 = away > 0 ? depthStart : depthStart - pew.height;
        for (const t of starts) {
            const box: Box = horizontal ? { x: t, y: d0, w: pew.width, h: pew.height } : { x: d0, y: t, w: pew.height, h: pew.width };
            if (floor.free(box)) {
                floor.put(pew, box, rotation, null);
                stood += 1;
            }
        }
    }
    return stood;
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
 * Pieces that serve for another's role when no stamp fills it: a kitchen's
 * work surface is a table, a desk a table to write at, a guest's chest a
 * store's. A nightstand or an easy chair has none (a barrel by a bed reads
 * as a store room, a plain chair is no easy chair): where the map composes
 * with placeholders, a labelled box shows it instead.
 */
const STAND_INS: readonly (readonly [StampRole, StampRole])[] = [
    ['workbench', 'table'],
    ['desk', 'table'],
    ['chest', 'storage'],
];

/** Roles a table stands in for as a surface to work at: only a long table serves. */
const SURFACE_STAND_INS: readonly StampRole[] = ['workbench', 'desk'];

/** `stamps` with each role no stamp fills taking its stand-in's stamps. */
function withStandIns(stamps: RoleIndex): RoleIndex {
    const filled = new Map(stamps);
    // Real art only: a genuine stand-in (a long table to work at) beats a placeholder box, and a box never stands in.
    const real = (role: StampRole): RoleStamp[] => (filled.get(role) ?? []).filter((s) => !isPlaceholder(s.key));
    for (const [role, standIn] of STAND_INS) {
        const own = real(role);
        const other = real(standIn);
        if (own.length === 0 && other.length > 0) {
            // A work surface is a long table to work along, never a round one to sit at, where there is a long one.
            const long = SURFACE_STAND_INS.includes(role) ? other.filter((s) => ofShape(s, 'long')) : [];
            filled.set(role, long.length > 0 ? long : other);
        }
    }
    return filled;
}

/**
 * `stamps` fit for a room of `purpose`: each role's pieces that name no
 * other kind of room (a guest room's bed, not a medicae bed or a cell's
 * bunk), or all of them when every one names another.
 */
function forPurpose(stamps: RoleIndex, purpose: RoomPurpose): RoleIndex {
    return new Map(
        [...stamps].map(([role, list]) => {
            const fit = list.filter((s) => s.purposes.length === 0 || s.purposes.includes(purpose));
            return [role, fit.length > 0 ? fit : list];
        }),
    );
}

/**
 * Furnish `room` by its purpose's template, keeping `reserved` floor (a
 * stairwell) clear; the roles it wanted that no loaded stamp has, and those
 * it filled with another setting's art.
 */
export function furnishRoom(
    room: RoomFloor,
    given: RoleIndex,
    random: Random,
    reserved: readonly Box[] = [],
): { stamps: ComposedStamp[]; missing: StampRole[]; borrowed: StampRole[]; boxed: string[]; crowded: string[] } {
    const stamps = withStandIns(forPurpose(given, room.purpose));
    const floor = new Floor(room, [...doorApproaches(room), ...reserved]);
    // The room's named pieces first, each where asked: in its role's art where a pack draws it, else a box with its name;
    // those with no room even for their box are left off, and said so.
    const boxed: string[] = [];
    const crowded: string[] = [];
    // Where each named fixture stood, for those placed before it.
    const named = new Map<string, Floor['stood']>();
    for (const fixture of room.fixtures ?? []) {
        const from = floor.stood.length;
        // Art asked for by its tags is what the intent named, whatever room its tags would keep it to.
        const piece = namedArt(fixture, fixture.tags.length > 0 ? given : stamps);
        const stood = piece === undefined ? 0 : placeFixture(floor, fixture, piece, named, random);
        // Art that stands nowhere it is asked (isometric, it cannot turn to a side wall) gives way to its box.
        const boxes = stood === 0 ? placeFixture(floor, fixture, namedBox(fixture), named, random) : 0;
        if (stood === 0 && boxes > 0) {
            boxed.push(fixture.name);
        }
        // Fewer than asked stood (a third server rack on a wall with room for two) is said, as none at all is.
        if (Math.max(stood, boxes) < askedCount(fixture)) {
            crowded.push(fixture.name);
        }
        named.set(fixture.name, [...(named.get(fixture.name) ?? []), ...floor.stood.slice(from)]);
    }
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
    const bulkiest = (role: StampRole): RoleStamp | undefined => [...(stamps.get(role) ?? [])].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    // One kind of each shape per room, as a matched role has one kind; a room with none of that shape takes its one kind.
    const byShape = new Map<string, RoleStamp | undefined>();
    const shaped = (role: StampRole, shape: TableShape): RoleStamp | undefined => {
        const key = `${role}:${shape}`;
        if (!byShape.has(key)) {
            const fits = (stamps.get(role) ?? []).filter((s) => ofShape(s, shape));
            byShape.set(key, fits.length > 0 ? pick(random, fits) : choose(role));
        }
        return byShape.get(key);
    };
    const missing = new Set<StampRole>();
    for (const step of room.furnish === 'fixtures' ? [] : ROOM_TEMPLATES[room.purpose]) {
        const picked = choose(mainRole(step));
        if (required(step) && (picked === undefined || isPlaceholder(picked.key))) {
            missing.add(mainRole(step));
        }
        const leftOut = (role: StampRole): void => {
            crowded.push(role);
        };
        runStep(floor, step, { choose, drawOf, bulkiest, shaped, all: (role) => stamps.get(role) ?? [], leftOut }, random);
    }
    scatterGrime(
        floor,
        (given.get('decal') ?? []).filter((s) => !isPlaceholder(s.key)),
        room.grime ?? DEFAULT_GRIME,
        random,
    );
    // Grime and rugs lie beneath everything: first in the drawing order, the grime under the rugs.
    const under = (role: StampRole): Set<string> => new Set((given.get(role) ?? []).map((s) => s.key));
    const [grime, rugs] = [under('decal'), under('rug')];
    const placed = [
        ...floor.placed.filter((p) => grime.has(p.stamp)),
        ...floor.placed.filter((p) => rugs.has(p.stamp)),
        ...floor.placed.filter((p) => !grime.has(p.stamp) && !rugs.has(p.stamp)),
    ];
    const lent = new Map([...stamps.values()].flat().flatMap((s) => (s.borrowed ? [[s.key, s.role] as const] : [])));
    const borrowed = [...new Set(placed.flatMap((p) => lent.get(p.stamp) ?? []))];
    return { stamps: placed, missing: [...missing], borrowed, boxed, crowded };
}

/** A fixture's area when it names none: the whole room. */
const WHOLE_ROOM = { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } } as const;

/** A room's corners by name. */
const NAMED_CORNERS: Readonly<Record<'top-left' | 'top-right' | 'bottom-right' | 'bottom-left', Corner>> = {
    'top-left': { right: false, bottom: false },
    'top-right': { right: true, bottom: false },
    'bottom-right': { right: true, bottom: true },
    'bottom-left': { right: false, bottom: true },
};

/**
 * Place a named fixture where it asks: against a wall, in a corner, free at
 * a point, along a line or in a grid, or in rows; how many it placed.
 */
/**
 * How many of `fixture` must stand for it to be placed as asked: its `count`
 * against a wall, in corners or along a line; at least one wherever else it
 * goes (a grid, rows or the pieces before others set their own numbers).
 */
function askedCount(fixture: FixtureIntent): number {
    const { place } = fixture;
    return 'wall' in place || 'corner' in place || 'line' in place ? fixture.count : 1;
}

function placeFixture(floor: Floor, fixture: FixtureIntent, piece: RoleStamp, named: ReadonlyMap<string, Floor['stood']>, random: Random): number {
    const draw = (): RoleStamp => piece;
    const { place } = fixture;
    if ('before' in place) {
        return (named.get(place.before) ?? []).filter((target) => placeBefore(floor, piece, target, place)).length;
    }
    if ('wall' in place) {
        const step: WallStep = {
            kind: 'wall',
            role: piece.role,
            count: fixture.count,
            along: place.along,
            exact: true,
            ...(place.wall === 'any' ? {} : { sides: [place.wall] }),
            ...(place.standoff > 0 ? { standoff: place.standoff } : {}),
        };
        return placeOnWalls(floor, step, draw, NO_COMPANIONS, random);
    }
    if ('corner' in place) {
        const left = placeInCorners(floor, draw, fixture.count, random, place.corner === 'any' ? undefined : [NAMED_CORNERS[place.corner]]);
        return fixture.count - left;
    }
    const turn = FACING_TURN[fixture.facing];
    // Isometric art is never turned: a long piece asked to face sideways would lie across its footprint.
    if (piece.upright && turn % HALF_TURN !== 0 && Math.max(fixture.width, fixture.height) > ELONGATED * Math.min(fixture.width, fixture.height)) {
        return 0;
    }
    const points = freePoints(fixture);
    if (points !== null) {
        // One of many (a grid, a line) may give a little within its share of the floor where a doorway's approach takes its spot.
        const give = points.length > 1 ? cellGive(fixture) : { x: 0, y: 0 };
        return points.filter((at) => NUDGES.some(([dx, dy]) => placeFree(floor, piece, { x: at.x + dx * give.x, y: at.y + dy * give.y }, turn, fixture.fixed)))
            .length;
    }
    if (!('rows' in place)) {
        return 0;
    }
    const { rect } = floor.room;
    const { from, to } = place.area ?? WHOLE_ROOM;
    const region: Rect = { x: rect.x + from.x * rect.w, y: rect.y + from.y * rect.h, w: (to.x - from.x) * rect.w, h: (to.y - from.y) * rect.h };
    return placeRowsOf(floor, piece, region, place);
}

/** The wall a piece standing at `turn` has its back to. */
const backSide = (turn: number): Side => WALL_SIDES.find((s) => BACK_TO[s] === ((turn % FULL_TURN) + FULL_TURN) % FULL_TURN) ?? 'top';

/**
 * One piece before `target`'s front (or at its back), `gap` out from it,
 * centred on it and facing it (an isometric piece as drawn); left out
 * where the floor there is taken or a way in. Whether it stood.
 */
function placeBefore(floor: Floor, piece: RoleStamp, target: Floor['stood'][number], { gap, behind }: { gap: number; behind: boolean }): boolean {
    const back = backSide(target.turn);
    // The side of the target it stands on; its own back to the far side, so it faces the target.
    const front = behind ? back : OPPOSITE_SIDE[back];
    const wanted = BACK_TO[front];
    const rotation = Floor.stands(piece, wanted) ? wanted : 0;
    const across = rotation % HALF_TURN !== 0;
    const w = across ? piece.height : piece.width;
    const h = across ? piece.width : piece.height;
    const { box: t } = target;
    const cx = t.x + t.w / 2 - w / 2;
    const cy = t.y + t.h / 2 - h / 2;
    const at: Readonly<Record<Side, Box>> = {
        top: { x: cx, y: t.y - gap - h, w, h },
        bottom: { x: cx, y: t.y + t.h + gap, w, h },
        left: { x: t.x - gap - w, y: cy, w, h },
        right: { x: t.x + t.w + gap, y: cy, w, h },
    };
    return floor.clearOfWays(at[front]) && floor.put(piece, at[front], rotation, null);
}

/** Where a piece of many tries to stand, in turn: its own spot, then a little off it each way (in shares of its cell's give). */
const NUDGES: readonly (readonly [number, number])[] = [
    [0, 0],
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
];

/** Share of a grid cell's or a line step's size a piece may stand off its spot. */
const CELL_GIVE = 0.25;

/** How far (fractions of the room) a piece of a grid or a line may stand off its spot: a quarter of its cell each way. */
function cellGive({ place, count }: FixtureIntent): { x: number; y: number } {
    if ('grid' in place) {
        const { from, to } = place.area ?? WHOLE_ROOM;
        return { x: ((to.x - from.x) / place.grid.columns) * CELL_GIVE, y: ((to.y - from.y) / place.grid.rows) * CELL_GIVE };
    }
    if ('line' in place) {
        const { from, to } = place.line;
        const step = 1 / Math.max(1, count - 1);
        return { x: Math.abs(to.x - from.x) * step * CELL_GIVE, y: Math.abs(to.y - from.y) * step * CELL_GIVE };
    }
    return { x: 0, y: 0 };
}

/** The points (fractions of the room) a free-standing fixture's pieces stand at: its centre, its point, along its line or over its grid; null for rows. */
function freePoints(fixture: FixtureIntent): { x: number; y: number }[] | null {
    const { place, count } = fixture;
    if ('centre' in place) {
        return [{ x: 0.5, y: 0.5 }];
    }
    if ('at' in place) {
        return [place.at];
    }
    if ('line' in place) {
        const { from, to } = place.line;
        return Array.from({ length: count }, (_, i) => {
            const t = count === 1 ? 0.5 : i / (count - 1);
            return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
        });
    }
    if ('grid' in place) {
        const { columns, rows } = place.grid;
        const { from, to } = place.area ?? WHOLE_ROOM;
        return Array.from({ length: columns * rows }, (_, i) => ({
            x: from.x + ((to.x - from.x) * ((i % columns) + 0.5)) / columns,
            y: from.y + ((to.y - from.y) * (Math.floor(i / columns) + 0.5)) / rows,
        }));
    }
    return null;
}

/**
 * One piece standing free, centred at `at` (fractions of the room), turned
 * `turn` (an isometric piece as drawn), kept wholly inside the room;
 * left out where the floor there is taken or kept clear. Whether it stood.
 */
function placeFree(floor: Floor, piece: RoleStamp, at: { readonly x: number; readonly y: number }, turn: number, fixed = false): boolean {
    const { rect } = floor.room;
    const rotation = Floor.stands(piece, turn) ? turn : 0;
    const across = rotation % HALF_TURN !== 0;
    const w = across ? piece.height : piece.width;
    const h = across ? piece.width : piece.height;
    const clamp = (v: number, lo: number, span: number, size: number): number => Math.min(Math.max(v - size / 2, lo), lo + span - size);
    const box: Box = { x: clamp(rect.x + at.x * rect.w, rect.x, rect.w, w), y: clamp(rect.y + at.y * rect.h, rect.y, rect.h, h), w, h };
    if (fixed) {
        // Exactly where the design puts it (hung above, laid flush, or blocking the way on purpose); it keeps no floor from others.
        floor.setOn(piece, box, rotation);
        return true;
    }
    return floor.clearOfWays(box) && floor.put(piece, box, rotation, null);
}

/**
 * Pieces in rows filling `rect` (the room, or part of it), piece against
 * piece in each row, an `aisle` between rows and at their ends, the rows
 * along its long axis or across it; `max` rows at most. A piece drawn with
 * depth is never turned: its rows run as it is drawn. How many it placed.
 */
function placeRowsOf(floor: Floor, piece: RoleStamp, rect: Rect, place: Extract<FixtureIntent['place'], { readonly rows: 'along' | 'across' }>): number {
    const longX = rect.w >= rect.h;
    const alongX = place.rows === 'along' ? longX : !longX;
    const rotation = alongX || piece.upright ? 0 : QUARTER_TURN;
    const [pw, ph] = rotation === 0 ? [piece.width, piece.height] : [piece.height, piece.width];
    // Along a row, and across the rows, in room terms.
    const [reach, breadth, step, depth] = alongX ? [rect.w, rect.h, pw, ph] : [rect.h, rect.w, ph, pw];
    const { aisle } = place;
    // Round the whole room, an aisle is kept along its walls too; an area given is filled to its edges.
    const margin = place.area === undefined ? aisle : 0;
    const fit = Math.floor((breadth - 2 * margin + aisle) / (depth + aisle));
    const rows = Math.min(fit, place.max ?? fit);
    const perRow = Math.floor((reach - 2 * margin) / step);
    const first = (breadth - (rows * depth + (rows - 1) * aisle)) / 2;
    const start = (reach - perRow * step) / 2;
    let placed = 0;
    for (let r = 0; r < rows; r++) {
        const b = first + r * (depth + aisle);
        const row = Array.from({ length: perRow }, (_, i): Box => {
            const a = start + i * step;
            return alongX ? { x: rect.x + a, y: rect.y + b, w: pw, h: ph } : { x: rect.x + b, y: rect.y + a, w: pw, h: ph };
        });
        // A row stands whole or not at all: rows of pews or cabinets are even, never ragged where a doorway cuts one short.
        if (row.every((box) => floor.clearOfWays(box) && Floor.stands(piece, rotation))) {
            for (const box of row) {
                floor.put(piece, box, rotation, null);
            }
            placed += row.length;
        }
    }
    return placed;
}

/** How a room's steps draw its pieces: the one kind of a matched role, a fresh pick per piece, the bulkiest kind of a role, one kind of a shape. */
interface Pieces {
    readonly choose: (role: StampRole) => RoleStamp | undefined;
    readonly drawOf: (role: StampRole) => Draw | undefined;
    readonly bulkiest: (role: StampRole) => RoleStamp | undefined;
    readonly shaped: (role: StampRole, shape: TableShape) => RoleStamp | undefined;
    /** Every piece the room may draw for a role. */
    readonly all: (role: StampRole) => readonly RoleStamp[];
    /** Say a role the room's design needs found no room at all (its pews), rather than leave it out silently. */
    readonly leftOut: (role: StampRole) => void;
}

/** A stack's least share of the bulkiest piece's floor: smaller pieces would read as clutter, not a stack. */
const STACK_SHARE = 0.5;

/**
 * A cluster step: tables and their seats across the open floor, or a store's
 * rows of stacks; where no table fits out on the floor and the step allows,
 * one against a wall, its seat before it.
 */
function runCluster(floor: Floor, step: Extract<Step, { kind: 'cluster' }>, pieces: Pieces, random: Random): void {
    const { choose, bulkiest, shaped, all } = pieces;
    // Stacked in rows with nothing round them (stores down a cellar), the bulkiest pieces, not a scatter of small ones.
    const table = step.around.length === 0 ? bulkiest(step.centre) : step.shape ? shaped(step.centre, step.shape) : choose(step.centre);
    if (!table) {
        return;
    }
    // The first kind of seat the room has that suits the table and leaves it room to stand: a bench far longer than it, or
    // too deep for the floor (a waiting bench in a narrow mess), gives way to chairs.
    const suits = step.around.map(choose).filter((s): s is RoleStamp => s !== undefined && fitsBeside(s, table));
    const seat = suits.find((s) => blockFits(floor.room.rect, seatingOf(table, s, step.sides))) ?? suits[0];
    // Stores stacked in rows vary stack by stack among the pieces near the bulkiest's size: crates, barrels, sack piles.
    const fits = all(step.centre).filter(
        (s) => s.width * s.height >= STACK_SHARE * table.width * table.height && s.width <= table.width && s.height <= table.height,
    );
    const stack = step.around.length === 0 && !MATCHED_ROLES.includes(step.centre) ? (): RoleStamp => pick(random, fits) ?? table : undefined;
    const placed = placeClusters(floor, step, seatingOf(table, seat, step.sides), random, stack);
    if (placed > 0 || step.orWall !== true) {
        return;
    }
    // An isometric seat faces only down: its table stands against the bottom wall, the seat above it.
    const prefer: WallPreference | undefined = seat?.upright === true ? 'bottom' : undefined;
    const wall: WallStep = { kind: 'wall', role: step.centre, count: 1, ...(seat ? { front: seat.role } : {}), ...(prefer ? { prefer } : {}) };
    placeOnWalls(floor, wall, () => table, { ...NO_COMPANIONS, seat }, random);
}

function runStep(floor: Floor, step: Step, pieces: Pieces, random: Random): void {
    const { choose, drawOf } = pieces;
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
                const left = placeInCorners(floor, draw, step.count, random);
                // An easy chair with no corner free sits against a wall, facing into the room.
                if (left > 0 && step.orWall === true) {
                    placeOnWalls(floor, { kind: 'wall', role: step.role, count: left }, draw, NO_COMPANIONS, random);
                }
            }
            return;
        }
        case 'cluster': {
            runCluster(floor, step, pieces, random);
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
                if (placeRows(floor, stamp, side, reach) === 0) {
                    pieces.leftOut(step.role);
                }
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
