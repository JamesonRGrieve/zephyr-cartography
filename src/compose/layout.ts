// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A building's layout: its rooms placed wall to wall over its footprint, each
 * about the size the intent asks, the rooms that open onto each other side
 * by side, a door on each of those shared walls, and the front door in the
 * entrance room's outer wall on the side the building faces.
 *
 * The footprint is split recursively along the room order, each cut placed
 * by the rooms' relative sizes. The order starts at the entrance and walks
 * the rooms it opens onto, so rooms that connect land near each other. Many
 * seeded orders are tried and the best layout kept: adjacency the intent
 * asks for first, then the entrance on its side, then well-proportioned
 * rooms. Every room is reachable: where asked-for doors leave a room cut
 * off, doors are added between rooms that touch. Pure and unit-tested.
 */
import type { DoorSlot, Rect, Side } from '../generate/floor-plan';
import { randomInt, shuffled, type Random } from '../generate/random';
import type { BuildingIntent, Edge, RoomIntent } from './intent';

/** The narrowest a room may be, in squares: room for a door and a person beside it. */
const MIN_ROOM_SIDE = 2;

/** Layouts tried per building; the best is kept. Each costs microseconds, and more rooms with more connections need many. */
const LAYOUT_TRIES = 240;

/** How much each asked-for adjacency, and the entrance on its side, outweigh room proportions. */
const ADJACENCY_WEIGHT = 100;
const ENTRANCE_WEIGHT = 50;

/** A room longer than this many times its width counts against a layout. */
const COMFORTABLE_ASPECT = 2;

/** Random weight added to each cut's cost, so the tries lay out differently. */
const CUT_NOISE = 0.5;

interface PlacedRoom {
    readonly key: string;
    readonly intent: RoomIntent;
    readonly rect: Rect;
}

/** A one-square door: in `room`'s wall on `slot`, into `to` (another room's key, or null for outside). */
export interface PlacedDoor {
    readonly room: string;
    readonly to: string | null;
    readonly slot: DoorSlot;
}

export interface BuildingLayout {
    readonly rooms: readonly PlacedRoom[];
    readonly doors: readonly PlacedDoor[];
    /** Asked-for adjacencies the layout could not give, as pairs of room keys. */
    readonly unmet: readonly (readonly [string, string])[];
}

const SIDE_OF_EDGE: Readonly<Record<Edge, Side>> = { north: 'top', east: 'right', south: 'bottom', west: 'left' };

/** The rooms each room opens onto, both ways. */
function neighbours(rooms: readonly RoomIntent[]): Map<string, Set<string>> {
    const graph = new Map(rooms.map((r) => [r.key, new Set<string>()]));
    for (const r of rooms) {
        for (const other of r.opensTo) {
            graph.get(r.key)?.add(other);
            graph.get(other)?.add(r.key);
        }
    }
    return graph;
}

/** Each pair of rooms the intent asks to open onto each other, once, whichever of them names the other. */
function askedPairs(rooms: readonly RoomIntent[]): [string, string][] {
    const pairs: [string, string][] = [];
    const seen = new Set<string>();
    for (const room of rooms) {
        for (const other of room.opensTo) {
            const id = [room.key, other].sort().join('\u0000');
            if (!seen.has(id)) {
                seen.add(id);
                pairs.push([room.key, other]);
            }
        }
    }
    return pairs;
}

/** The entrance room: the one marked, else the first. */
function entranceRoom(rooms: readonly [RoomIntent, ...RoomIntent[]]): RoomIntent {
    return rooms.find((r) => r.entrance) ?? rooms[0];
}

/** A walk from the entrance through the rooms it opens onto, in a seeded order; rooms it never reaches follow. */
function roomOrder(rooms: readonly [RoomIntent, ...RoomIntent[]], random: Random): RoomIntent[] {
    const graph = neighbours(rooms);
    const byKey = new Map(rooms.map((r) => [r.key, r]));
    const order: RoomIntent[] = [];
    const seen = new Set<string>();
    const queue = [entranceRoom(rooms)];
    while (order.length < rooms.length) {
        const next = queue.shift() ?? rooms.find((r) => !seen.has(r.key));
        if (next === undefined) {
            break;
        }
        if (seen.has(next.key)) {
            continue;
        }
        seen.add(next.key);
        order.push(next);
        const around = [...(graph.get(next.key) ?? [])].flatMap((key) => byKey.get(key) ?? []).filter((r) => !seen.has(r.key));
        // Shuffled, so each try walks the rooms differently.
        queue.push(...shuffled(random, around));
    }
    return order;
}

const total = (rooms: readonly RoomIntent[]): number => rooms.reduce((sum, r) => sum + r.size, 0);

/** A cut of `rect` between `first` and the rest: across x or y, at the size-weighted line, or null if a side would be too narrow. */
function cut(rect: Rect, first: readonly RoomIntent[], rest: readonly RoomIntent[], acrossX: boolean): [Rect, Rect] | null {
    const span = acrossX ? rect.w : rect.h;
    const at = Math.round((span * total(first)) / (total(first) + total(rest)));
    if (at < MIN_ROOM_SIDE || span - at < MIN_ROOM_SIDE) {
        return null;
    }
    return acrossX
        ? [
              { ...rect, w: at },
              { ...rect, x: rect.x + at, w: rect.w - at },
          ]
        : [
              { ...rect, h: at },
              { ...rect, y: rect.y + at, h: rect.h - at },
          ];
}

const aspect = (r: Rect): number => Math.max(r.w, r.h) / Math.min(r.w, r.h);

/** Place `rooms`, in order, over `rect`: split the list where the halves' rooms stay best proportioned. */
function place(rect: Rect, rooms: readonly RoomIntent[], random: Random): PlacedRoom[] | null {
    const [only, ...others] = rooms;
    if (only === undefined) {
        return [];
    }
    if (others.length === 0) {
        return rect.w >= MIN_ROOM_SIDE && rect.h >= MIN_ROOM_SIDE ? [{ key: only.key, intent: only, rect }] : null;
    }
    // Every split of the order, across either axis, with either group on either side of the cut.
    const options = rooms.slice(1).flatMap((_, i) =>
        [true, false].flatMap((acrossX) =>
            [false, true].flatMap((flipped) => {
                const before = rooms.slice(0, i + 1);
                const after = rooms.slice(i + 1);
                const [first, rest] = flipped ? [after, before] : [before, after];
                const halves = cut(rect, first, rest, acrossX);
                // Cut across the longer side, the halves as square as they can be; a little noise varies the tries.
                return halves ? [{ first, rest, halves, cost: aspect(halves[0]) + aspect(halves[1]) + random() * CUT_NOISE }] : [];
            }),
        ),
    );
    options.sort((a, b) => a.cost - b.cost);
    for (const { first, rest, halves } of options) {
        const a = place(halves[0], first, random);
        const b = a && place(halves[1], rest, random);
        if (a && b) {
            return [...a, ...b];
        }
    }
    return null;
}

/** The wall `a` and `b` share, as the side of `a` it is on and its extent along that side, or null if they do not touch. */
export function sharedWall(a: Rect, b: Rect): { side: Side; from: number; to: number } | null {
    const overlap = (lo1: number, hi1: number, lo2: number, hi2: number): [number, number] | null => {
        const from = Math.max(lo1, lo2);
        const to = Math.min(hi1, hi2);
        return to - from >= 1 ? [from, to] : null;
    };
    const across = overlap(a.y, a.y + a.h, b.y, b.y + b.h);
    const along = overlap(a.x, a.x + a.w, b.x, b.x + b.w);
    if (across && a.x + a.w === b.x) {
        return { side: 'right', from: across[0], to: across[1] };
    }
    if (across && b.x + b.w === a.x) {
        return { side: 'left', from: across[0], to: across[1] };
    }
    if (along && a.y + a.h === b.y) {
        return { side: 'bottom', from: along[0], to: along[1] };
    }
    if (along && b.y + b.h === a.y) {
        return { side: 'top', from: along[0], to: along[1] };
    }
    return null;
}

/** A door square along [from, to): away from the corners when the wall is long enough. */
function doorAt(from: number, to: number, random: Random): number {
    return to - from >= 3 ? randomInt(random, from + 1, to - 2) : randomInt(random, from, to - 1);
}

/** The stretch of `room`'s `side` that is the building's outer wall, or null. */
function outerStretch(room: Rect, side: Side, footprint: Rect): { from: number; to: number } | null {
    const flush =
        (side === 'top' && room.y === footprint.y) ||
        (side === 'bottom' && room.y + room.h === footprint.y + footprint.h) ||
        (side === 'left' && room.x === footprint.x) ||
        (side === 'right' && room.x + room.w === footprint.x + footprint.w);
    if (!flush) {
        return null;
    }
    return side === 'top' || side === 'bottom' ? { from: room.x, to: room.x + room.w } : { from: room.y, to: room.y + room.h };
}

/** Doors: every asked-for adjacency that touches, then enough more between touching rooms that every room is reached. */
function interiorDoors(rooms: readonly PlacedRoom[], random: Random): { doors: PlacedDoor[]; unmet: [string, string][] } {
    const doors: PlacedDoor[] = [];
    const unmet: [string, string][] = [];
    const joined = new Map(rooms.map((r) => [r.key, r.key]));
    const rootOf = (key: string): string => {
        const up = joined.get(key) ?? key;
        return up === key ? key : rootOf(up);
    };
    const connect = (a: PlacedRoom, b: PlacedRoom): boolean => {
        const wall = sharedWall(a.rect, b.rect);
        if (!wall) {
            return false;
        }
        doors.push({ room: a.key, to: b.key, slot: { side: wall.side, at: doorAt(wall.from, wall.to, random) } });
        joined.set(rootOf(a.key), rootOf(b.key));
        return true;
    };
    const byKey = new Map(rooms.map((r) => [r.key, r]));
    for (const [a, b] of askedPairs(rooms.map((r) => r.intent))) {
        const from = byKey.get(a);
        const to = byKey.get(b);
        if (from && to && !connect(from, to)) {
            unmet.push([a, b]);
        }
    }
    // Rooms still cut off: join them to what they touch, the longest shared walls first.
    const touching = rooms.flatMap((a, i) =>
        rooms.slice(i + 1).flatMap((b) => {
            const wall = sharedWall(a.rect, b.rect);
            return wall ? [{ a, b, length: wall.to - wall.from }] : [];
        }),
    );
    touching.sort((x, y) => y.length - x.length);
    for (const { a, b } of touching) {
        if (rootOf(a.key) !== rootOf(b.key)) {
            connect(a, b);
        }
    }
    return { doors, unmet };
}

/** The front door, in the entrance room's outer wall on the side the building faces, else its nearest outer wall. */
function frontDoor(rooms: readonly PlacedRoom[], entrance: RoomIntent, facing: Edge, footprint: Rect, random: Random): PlacedDoor | null {
    const room = rooms.find((r) => r.key === entrance.key);
    if (!room) {
        return null;
    }
    const wanted = SIDE_OF_EDGE[facing];
    const sides: readonly Side[] = [wanted, ...(['bottom', 'right', 'left', 'top'] as const).filter((s) => s !== wanted)];
    for (const side of sides) {
        const stretch = outerStretch(room.rect, side, footprint);
        if (stretch) {
            return { room: room.key, to: null, slot: { side, at: doorAt(stretch.from, stretch.to, random) } };
        }
    }
    return null;
}

/** How good a layout is: asked-for adjacencies met, the entrance on its side, rooms well proportioned. */
function score(layout: BuildingLayout, building: BuildingIntent, footprint: Rect): number {
    const met = askedPairs(building.rooms).length - layout.unmet.length;
    const front = layout.doors.find((d) => d.to === null);
    const entranceOnSide = front?.slot.side === SIDE_OF_EDGE[building.entrance] ? 1 : 0;
    const cramped = layout.rooms.reduce((sum, r) => sum + Math.max(0, aspect(r.rect) - COMFORTABLE_ASPECT), 0);
    const sizeError = layout.rooms.reduce((sum, r) => {
        const wanted = (r.intent.size / total(building.rooms)) * footprint.w * footprint.h;
        return sum + Math.abs(r.rect.w * r.rect.h - wanted) / wanted;
    }, 0);
    return met * ADJACENCY_WEIGHT + entranceOnSide * ENTRANCE_WEIGHT - cramped - sizeError;
}

/** Lay out `building` over `footprint` (its own origin and size, in squares); null if its rooms cannot fit. */
export function layOutBuilding(building: BuildingIntent, footprint: Rect, random: Random): BuildingLayout | null {
    const [first, ...others] = building.rooms;
    if (first === undefined) {
        return null;
    }
    const rooms: [RoomIntent, ...RoomIntent[]] = [first, ...others];
    let best: { layout: BuildingLayout; score: number } | null = null;
    for (let attempt = 0; attempt < LAYOUT_TRIES; attempt++) {
        const placed = place(footprint, roomOrder(rooms, random), random);
        if (placed) {
            const { doors, unmet } = interiorDoors(placed, random);
            const front = frontDoor(placed, entranceRoom(rooms), building.entrance, footprint, random);
            const layout = { rooms: placed, doors: front ? [...doors, front] : doors, unmet };
            const value = score(layout, building, footprint);
            if (best === null || value > best.score) {
                best = { layout, score: value };
            }
        }
    }
    return best?.layout ?? null;
}
