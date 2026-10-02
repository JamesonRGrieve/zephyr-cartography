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
import { type DoorSlot, OPPOSITE_SIDE, type Rect, type Side } from '../generate/floor-plan';
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

/** Each room's doors as it sees them: its own, and the ones its neighbours opened into its walls. */
export function doorsOf(layout: BuildingLayout, key: string): DoorSlot[] {
    return layout.doors.flatMap((d) => {
        if (d.room === key) {
            return [d.slot];
        }
        return d.to === key ? [{ ...d.slot, side: OPPOSITE_SIDE[d.slot.side] }] : [];
    });
}

/** The rooms each room opens onto, both ways. */
function neighbours(rooms: readonly RoomIntent[]): Map<string, Set<string>> {
    const graph = new Map(rooms.map((r) => [r.key, new Set<string>()]));
    for (const r of rooms) {
        for (const other of [...r.opensTo, ...r.archTo, ...r.secretTo]) {
            graph.get(r.key)?.add(other);
            graph.get(other)?.add(r.key);
        }
    }
    return graph;
}

/** How two rooms the intent joins are joined: a door, a doorless archway, or a secret door that looks like wall. */
type Joint = 'door' | 'arch' | 'secret';

/** Each pair of rooms the intent asks to open onto each other, once, whichever of them names the other; an archway or a secret door where either asks for one. */
function askedPairs(rooms: readonly RoomIntent[]): [string, string, Joint][] {
    const pairs = new Map<string, [string, string, Joint]>();
    for (const room of rooms) {
        const asked: [string, Joint][] = [
            ...room.archTo.map((o): [string, Joint] => [o, 'arch']),
            ...room.secretTo.map((o): [string, Joint] => [o, 'secret']),
            ...room.opensTo.map((o): [string, Joint] => [o, 'door']),
        ];
        for (const [other, joint] of asked) {
            const id = [room.key, other].sort().join('\u0000');
            if (!pairs.has(id)) {
                pairs.set(id, [room.key, other, joint]);
            }
        }
    }
    return [...pairs.values()];
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

/** A hall opening onto at least this many rooms is laid as a corridor, the rooms along both its sides. */
const SPINE_ROOMS = 4;

/** How often, in layout tries, a corridor layout is tried: each with the rooms shuffled along it. */
const SPINE_EVERY = 8;

/** A corridor's width in squares: two abreast. */
export const CORRIDOR_WIDTH = 2;

/** `rooms` along one side of a corridor: `band` split along its length by the rooms' sizes, each at least a room wide. */
function sideRooms(band: Rect, rooms: readonly RoomIntent[], lengthwiseX: boolean): PlacedRoom[] | null {
    const span = lengthwiseX ? band.w : band.h;
    const whole = total(rooms);
    let start = 0;
    let before = 0;
    const placed = rooms.map((room, i) => {
        // Each end rounded from the running share, never from the last rounded end, so the rounding never piles onto one room.
        before += room.size;
        const end = i === rooms.length - 1 ? span : Math.round((span * before) / whole);
        const rect = lengthwiseX ? { ...band, x: band.x + start, w: end - start } : { ...band, y: band.y + start, h: end - start };
        start = end;
        return { key: room.key, intent: room, rect };
    });
    return placed.every((p) => p.rect.w >= MIN_ROOM_SIDE && p.rect.h >= MIN_ROOM_SIDE) ? placed : null;
}

/**
 * A storey laid round a corridor: the hall that opens onto most rooms (at
 * least `SPINE_ROOMS`) as a strip down the footprint's long axis, the other
 * rooms, in a seeded order, split between its two sides. Null when no hall
 * opens onto so many, or the rooms do not fit.
 */
function spine(rect: Rect, rooms: readonly RoomIntent[], random: Random, width: number): PlacedRoom[] | null {
    const graph = neighbours(rooms);
    const hall = rooms
        .filter((r) => r.purpose === 'hall' && (graph.get(r.key)?.size ?? 0) >= SPINE_ROOMS)
        .sort((x, y) => (graph.get(y.key)?.size ?? 0) - (graph.get(x.key)?.size ?? 0))[0];
    if (!hall) {
        return null;
    }
    const lengthwiseX = rect.w >= rect.h;
    const depth = lengthwiseX ? rect.h : rect.w;
    const near = Math.floor((depth - width) / 2);
    const far = depth - width - near;
    const others = shuffled(
        random,
        rooms.filter((r) => r !== hall),
    );
    const half = Math.ceil(others.length / 2);
    const bands: [Rect, Rect, Rect] = lengthwiseX
        ? [
              { ...rect, h: near },
              { ...rect, y: rect.y + near, h: width },
              { ...rect, y: rect.y + near + width, h: far },
          ]
        : [
              { ...rect, w: near },
              { ...rect, x: rect.x + near, w: width },
              { ...rect, x: rect.x + near + width, w: far },
          ];
    const [first, corridor, second] = bands;
    const oneSide = sideRooms(first, others.slice(0, half), lengthwiseX);
    const otherSide = sideRooms(second, others.slice(half), lengthwiseX);
    return oneSide && otherSide ? [...oneSide, { key: hall.key, intent: hall, rect: corridor }, ...otherSide] : null;
}

/** The rooms where the intent places every one (`rect`, from the building's corner), in scene squares; null unless all are placed. */
export function pinnedRooms(rooms: readonly RoomIntent[], footprint: Rect): PlacedRoom[] | null {
    const placed = rooms.flatMap((room) =>
        room.rect === undefined
            ? []
            : [{ key: room.key, intent: room, rect: { x: footprint.x + room.rect.x, y: footprint.y + room.rect.y, w: room.rect.w, h: room.rect.h } }],
    );
    return placed.length === rooms.length ? placed : null;
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
    return flush ? edgeSpan(room, side) : null;
}

/** The extent of `room`'s `side` wall along it. */
const edgeSpan = (room: Rect, side: Side): { from: number; to: number } =>
    side === 'top' || side === 'bottom' ? { from: room.x, to: room.x + room.w } : { from: room.y, to: room.y + room.h };

/** Squares of wall an archway leaves standing at each end of the wall it opens. */
const ARCH_PIER = 1;

/**
 * Where an archway opens the wall two rooms share (from `from` to `to`):
 * `width` squares of it centred at `at` of the wall's length (its middle
 * when null), kept a pier in from each end; where no width is asked, the
 * whole wall but a pier at each end where it is wide enough to keep them (a
 * corridor's mouth is open wall to wall).
 */
function archSpan(wall: { readonly from: number; readonly to: number }, width: number | null, at: number | null): { at: number; width: number } {
    const span = wall.to - wall.from;
    const pier = span > 2 * ARCH_PIER + 1 ? ARCH_PIER : 0;
    const most = span - 2 * pier;
    if (width === null || width >= most) {
        return { at: wall.from + pier, width: most };
    }
    const centre = wall.from + (at ?? 1 / 2) * span;
    const start = Math.round(Math.min(Math.max(centre - width / 2, wall.from + pier), wall.to - pier - width));
    return { at: start, width };
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
    const connect = (a: PlacedRoom, b: PlacedRoom, joint: Joint = 'door'): boolean => {
        const wall = sharedWall(a.rect, b.rect);
        if (!wall) {
            return false;
        }
        const span = wall.to - wall.from;
        if (joint === 'arch') {
            doors.push({
                room: a.key,
                to: b.key,
                slot: {
                    side: wall.side,
                    ...archSpan(wall, a.intent.archWidth ?? b.intent.archWidth, a.intent.archAt ?? b.intent.archAt),
                    open: true,
                    arch: true,
                },
            });
        } else {
            // Where either room asks, there along the wall they share: a row of cells with their doors alike.
            const asked = a.intent.doorAt ?? b.intent.doorAt;
            const at = asked === null ? doorAt(wall.from, wall.to, random) : wall.from + Math.round(asked * (span - 1));
            // Locked where either room is locked, else standing open where either is left open.
            const locked = a.intent.doorLocked || b.intent.doorLocked;
            const leftOpen = a.intent.doorOpen || b.intent.doorOpen;
            // A secret door is found shut: never left standing open.
            const state = joint === 'secret' ? { secret: true } : locked ? { locked: true } : leftOpen ? { open: true } : {};
            doors.push({ room: a.key, to: b.key, slot: { side: wall.side, at, ...state } });
        }
        joined.set(rootOf(a.key), rootOf(b.key));
        return true;
    };
    const byKey = new Map(rooms.map((r) => [r.key, r]));
    for (const [a, b, joint] of askedPairs(rooms.map((r) => r.intent))) {
        const from = byKey.get(a);
        const to = byKey.get(b);
        if (from && to && !connect(from, to, joint)) {
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

/**
 * The front door, in the entrance room's outer wall on the side the building
 * faces, else its nearest outer wall; `at` squares along the facing side
 * where asked and that stretch of wall is the entrance room's.
 */
/**
 * The room the front door opens into: the one marked the entrance; else the
 * first, in the intent's order, whose outer wall on the side the building
 * faces holds the door (where it is asked, there), so a vehicle's rear ramp
 * opens into its troop bay, never the cab listed first; else the first room.
 */
function doorRoom(
    rooms: readonly [RoomIntent, ...RoomIntent[]],
    placed: readonly PlacedRoom[],
    building: Pick<BuildingIntent, 'entrance' | 'frontDoorAt' | 'frontDoorWidth'>,
    footprint: Rect,
): RoomIntent {
    const marked = rooms.find((r) => r.entrance);
    if (marked) {
        return marked;
    }
    const side = SIDE_OF_EDGE[building.entrance];
    const along = building.frontDoorAt === null ? null : (side === 'top' || side === 'bottom' ? footprint.x : footprint.y) + building.frontDoorAt;
    const holds = (intent: RoomIntent): boolean => {
        const stretch = placed.find((r) => r.key === intent.key)?.rect;
        const outer = stretch && outerStretch(stretch, side, footprint);
        if (!outer || outer.to - outer.from < building.frontDoorWidth) {
            return false;
        }
        return along === null || (along >= outer.from && along + building.frontDoorWidth <= outer.to);
    };
    return rooms.find(holds) ?? rooms[0];
}

function frontDoor(
    rooms: readonly PlacedRoom[],
    entrance: RoomIntent,
    front: { readonly facing: Edge; readonly at: number | null; readonly width: number; readonly open: boolean; readonly gap: boolean },
    footprint: Rect,
    random: Random,
): PlacedDoor | null {
    const room = rooms.find((r) => r.key === entrance.key);
    if (!room) {
        return null;
    }
    const wanted = SIDE_OF_EDGE[front.facing];
    const sides: readonly Side[] = [wanted, ...(['bottom', 'right', 'left', 'top'] as const).filter((s) => s !== wanted)];
    const { width } = front;
    for (const side of sides) {
        const stretch = outerStretch(room.rect, side, footprint);
        if (stretch && stretch.to - stretch.from >= width) {
            const asked = front.at === null || side !== wanted ? null : (side === 'top' || side === 'bottom' ? footprint.x : footprint.y) + front.at;
            const at = asked !== null && asked >= stretch.from && asked + width <= stretch.to ? asked : doorAt(stretch.from, stretch.to - width + 1, random);
            return { room: room.key, to: null, slot: { side, at, ...(width > 1 ? { width } : {}), ...doorway(front) } };
        }
    }
    return null;
}

/** The building's other doorways out: each in the room whose outer wall holds it, where one does. */
function openingDoors(rooms: readonly PlacedRoom[], openings: BuildingIntent['openings'], footprint: Rect): PlacedDoor[] {
    return openings.flatMap(({ side: edge, at, width, open: leftOpen, gap, room: named }) => {
        const side = SIDE_OF_EDGE[edge];
        const along = side === 'top' || side === 'bottom' ? footprint.x + at : footprint.y + at;
        const room = rooms.find((r) => {
            // A named room's own wall on that side, wherever it stands; else the wall on the footprint's edge.
            const stretch = named === undefined ? outerStretch(r.rect, side, footprint) : r.key === named ? edgeSpan(r.rect, side) : null;
            return stretch !== null && along >= stretch.from && along + width <= stretch.to;
        });
        return room ? [{ room: room.key, to: null, slot: { side, at: along, ...(width > 1 ? { width } : {}), ...doorway({ open: leftOpen, gap }) } }] : [];
    });
}

/** A way out's doorway: a gap with no door at all (drawn as an archway, never hung), a door standing open, or a shut one. */
function doorway(way: { readonly open: boolean; readonly gap: boolean }): { readonly open?: true; readonly arch?: true } {
    if (way.gap) {
        return { open: true, arch: true };
    }
    return way.open ? { open: true } : {};
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

/** How a storey is laid out: with the building's front door (the ground floor) or none, and a test every layout must pass. */
export interface StoreyOptions {
    readonly front: boolean;
    /** A layout this refuses is never chosen, however it scores: an upper floor must hold the stairwell below. */
    readonly accept: (layout: BuildingLayout) => boolean;
    /** Squares across a corridor, where the storey is laid round one (wider where a stair climbs into it); two when omitted. */
    readonly corridor?: number;
}

const GROUND_FLOOR: StoreyOptions = { front: true, accept: () => true };

/**
 * Lay out `building`'s `rooms` (its ground floor's, unless given another
 * storey's) over `footprint` (its own origin and size, in squares); null if
 * its rooms cannot fit, or no layout passes `options.accept`.
 */
export function layOutBuilding(
    building: BuildingIntent,
    footprint: Rect,
    random: Random,
    options: StoreyOptions = GROUND_FLOOR,
    storeyRooms: readonly RoomIntent[] = building.rooms,
): BuildingLayout | null {
    const [first, ...others] = storeyRooms;
    if (first === undefined) {
        return null;
    }
    const rooms: [RoomIntent, ...RoomIntent[]] = [first, ...others];
    const pinned = pinnedRooms(rooms, footprint);
    let best: { layout: BuildingLayout; score: number } | null = null;
    for (let attempt = 0; attempt < LAYOUT_TRIES; attempt++) {
        // Rooms each placed by the intent are laid as given; else a corridor with rooms along it is tried beside the splits,
        // and wins where it meets the adjacency they cannot.
        const placed =
            pinned ??
            (attempt % SPINE_EVERY === 0
                ? spine(footprint, rooms, random, options.corridor ?? CORRIDOR_WIDTH) ?? place(footprint, roomOrder(rooms, random), random)
                : place(footprint, roomOrder(rooms, random), random));
        if (placed) {
            const { doors, unmet } = interiorDoors(placed, random);
            const front =
                options.front && building.frontDoor
                    ? frontDoor(
                          placed,
                          doorRoom(rooms, placed, building, footprint),
                          {
                              facing: building.entrance,
                              at: building.frontDoorAt,
                              width: building.frontDoorWidth,
                              open: building.frontDoorOpen,
                              gap: building.frontDoorGap,
                          },
                          footprint,
                          random,
                      )
                    : null;
            // Its other doorways out after the front door, which stays the first way out.
            const waysOut = options.front ? openingDoors(placed, building.openings, footprint) : [];
            const layout = { rooms: placed, doors: [...doors, ...(front ? [front] : []), ...waysOut], unmet };
            if (!options.accept(layout)) {
                continue;
            }
            const value = score(layout, { ...building, rooms }, footprint);
            if (best === null || value > best.score) {
                best = { layout, score: value };
            }
        }
    }
    return best?.layout ?? null;
}
