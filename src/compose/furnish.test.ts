// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import type { StampRole } from '../stamps/schema';
import { type ComposedStamp, furnishRoom, ROOM_TEMPLATES, type RoomFloor } from './furnish';
import { type FixtureIntent, ROOM_PURPOSES } from './intent';
import { withPlaceholders } from './placeholders';
import type { RoleIndex, RoleStamp } from './roles';
import { TEST_ROLES } from './test-roles';

const byKey = new Map([...TEST_ROLES.values()].flat().map((s) => [s.key, s]));

const roleOf = (placed: ComposedStamp): StampRole | undefined => byKey.get(placed.stamp)?.role;

interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** The floor a placed stamp covers: its rotated footprint's bounding box (its dimensions are with its back up, so its turn comes off). */
function boxOf(placed: ComposedStamp): Box {
    const stamp: RoleStamp | undefined = byKey.get(placed.stamp);
    const radians = ((placed.rotation - (stamp?.turn ?? 0)) * Math.PI) / 180;
    // Drawn at a multiple of its art's size where fitted (a pew shrunk to a row's depth).
    const scale = placed.scale ?? 1;
    const [sw, sh] = [(stamp?.width ?? 0) * scale, (stamp?.height ?? 0) * scale];
    const w = Math.abs(sw * Math.cos(radians)) + Math.abs(sh * Math.sin(radians));
    const h = Math.abs(sw * Math.sin(radians)) + Math.abs(sh * Math.cos(radians));
    return { x: placed.x - w / 2, y: placed.y - h / 2, w, h };
}

const EPSILON = 1e-6;
const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.w - EPSILON && b.x < a.x + a.w - EPSILON && a.y < b.y + b.h - EPSILON && b.y < a.y + a.h - EPSILON;

const COMMON: RoomFloor = {
    key: 'common',
    purpose: 'common-room',
    rect: { x: 4, y: 2, w: 10, h: 7 },
    doors: [
        { side: 'bottom', at: 8 },
        { side: 'left', at: 5 },
    ],
    outer: ['top', 'bottom'],
    entrance: 'bottom',
};

function furnish(room: RoomFloor, seed = 1): ComposedStamp[] {
    return furnishRoom(room, TEST_ROLES, seededRandom(seed)).stamps;
}

/** Surfaces other pieces are set on. */
const SURFACES: readonly (StampRole | undefined)[] = ['table', 'counter', 'desk', 'workbench', 'altar'];

/**
 * Everything placed stands inside the room, nothing on the floor overlaps
 * (rugs lie beneath), what is set on a surface lies wholly on one, and every
 * door's approach is clear.
 */
function expectOrderly(room: RoomFloor, placed: readonly ComposedStamp[]): void {
    const set = placed.filter((p) => roleOf(p) === 'tabletop').map(boxOf);
    const surfaces = placed.filter((p) => SURFACES.includes(roleOf(p))).map(boxOf);
    for (const item of set) {
        const on = surfaces.some(
            (s) => item.x >= s.x - EPSILON && item.y >= s.y - EPSILON && item.x + item.w <= s.x + s.w + EPSILON && item.y + item.h <= s.y + s.h + EPSILON,
        );
        expect(on).toBe(true);
    }
    const solid = placed.filter((p) => roleOf(p) !== 'rug' && roleOf(p) !== 'tabletop').map(boxOf);
    solid.forEach((box, i) => {
        expect(box.x).toBeGreaterThanOrEqual(room.rect.x - EPSILON);
        expect(box.y).toBeGreaterThanOrEqual(room.rect.y - EPSILON);
        expect(box.x + box.w).toBeLessThanOrEqual(room.rect.x + room.rect.w + EPSILON);
        expect(box.y + box.h).toBeLessThanOrEqual(room.rect.y + room.rect.h + EPSILON);
        for (const other of solid.slice(i + 1)) {
            expect(overlap(box, other)).toBe(false);
        }
    });
    for (const door of room.doors) {
        const inside: Box =
            door.side === 'bottom'
                ? { x: door.at, y: room.rect.y + room.rect.h - 1, w: 1, h: 1 }
                : door.side === 'top'
                ? { x: door.at, y: room.rect.y, w: 1, h: 1 }
                : door.side === 'left'
                ? { x: room.rect.x, y: door.at, w: 1, h: 1 }
                : { x: room.rect.x + room.rect.w - 1, y: door.at, w: 1, h: 1 };
        expect(solid.some((box) => overlap(box, inside))).toBe(false);
    }
}

describe('furnishRoom', () => {
    it('furnishes a common room: a hearth on an outer wall, rows of seated tables, lights, storage and clutter, all orderly', () => {
        for (const seed of [1, 2, 3, 4]) {
            const placed = furnish(COMMON, seed);
            expectOrderly(COMMON, placed);
            const hearths = placed.filter((p) => roleOf(p) === 'hearth');
            expect(hearths).toHaveLength(1);
            // Its back to the top (0°) or bottom (180°) wall: the room's outer walls.
            expect([0, 180]).toContain(hearths[0]?.rotation);
            const tables = placed.filter((p) => roleOf(p) === 'table');
            expect(tables.length).toBeGreaterThanOrEqual(2);
            // Every table has seats beside it: benches at the long ones, chairs round the rest.
            for (const table of tables) {
                const near = placed.filter(
                    (p) => (roleOf(p) === 'bench' || roleOf(p) === 'seat') && Math.abs(p.x - table.x) < 1.2 && Math.abs(p.y - table.y) < 1.2,
                );
                expect(near.length).toBeGreaterThanOrEqual(1);
            }
            expect(placed.filter((p) => roleOf(p) === 'clutter').length).toBeGreaterThanOrEqual(2);
        }
    });

    it('seats a round table all round, and gives a table chairs when its bench is far longer than it', () => {
        const table: RoleStamp = {
            key: 'test:round-table',
            role: 'table',
            width: 1,
            height: 1,
            turn: 0,
            against: 'free',
            clearance: 0,
            upright: false,
            habitats: [],
            climb: null,
            borrowed: false,
            purposes: [],
            tags: [],
        };
        const pew: RoleStamp = {
            key: 'test:pew',
            role: 'bench',
            width: 2,
            height: 0.9,
            turn: 0,
            against: 'free',
            clearance: 0,
            upright: false,
            habitats: [],
            climb: null,
            borrowed: false,
            purposes: [],
            tags: [],
        };
        const roles = new Map([...TEST_ROLES, ['table', [table]], ['bench', [pew]]] as const);
        const placed = furnishRoom(COMMON, roles, seededRandom(1)).stamps;
        const tables = placed.filter((p) => p.stamp === 'test:round-table');
        expect(tables.length).toBeGreaterThanOrEqual(2);
        // Left as a room's are, not ruled: each turned its own way and a little off its row.
        expect(new Set(tables.map((t) => t.rotation)).size).toBeGreaterThan(1);
        expect(new Set(tables.map((t) => t.y.toFixed(3))).size).toBeGreaterThan(Math.ceil(tables.length / 2));
        // Chairs, not the pew, and on all four sides of each table.
        expect(placed.some((p) => p.stamp === 'test:pew')).toBe(false);
        for (const t of tables) {
            const chairs = placed.filter((p) => p.stamp === 'test:seat' && Math.abs(p.x - t.x) < 1.2 && Math.abs(p.y - t.y) < 1.2);
            const sides = new Set(
                chairs.map((c) => (Math.abs(c.x - t.x) > Math.abs(c.y - t.y) ? (c.x < t.x ? 'left' : 'right') : c.y < t.y ? 'top' : 'bottom')),
            );
            expect([...sides].sort()).toEqual(['bottom', 'left', 'right', 'top']);
        }
    });

    it('seats tables with benches drawn with depth in rows across the room, one row above each table, never turned', () => {
        // A mess hall: its tables all benched.
        const tall: RoomFloor = { ...COMMON, purpose: 'mess', rect: { x: 0, y: 0, w: 8, h: 12 }, doors: [{ side: 'bottom', at: 4 }], outer: ['top'] };
        const roles = new Map([...TEST_ROLES].map(([role, stamps]) => [role, role === 'bench' ? stamps.map((s) => ({ ...s, upright: true })) : stamps]));
        const placed = furnishRoom(tall, roles, seededRandom(1)).stamps;
        const tables = placed.filter((p) => roleOf(p) === 'table');
        const benches = placed.filter((p) => roleOf(p) === 'bench');
        expect(tables.length).toBeGreaterThanOrEqual(4);
        expect(benches.every((b) => b.rotation === 0)).toBe(true);
        // Every table has its bench just above it.
        for (const table of tables) {
            expect(benches.some((b) => Math.abs(b.x - table.x) < 1 && b.y < table.y && table.y - b.y < 1.5)).toBe(true);
        }
    });

    it('eats at long tables in a mess, never round ones, where the pack draws both', () => {
        const hall: RoomFloor = { ...COMMON, purpose: 'mess', rect: { x: 0, y: 0, w: 10, h: 10 }, doors: [{ side: 'bottom', at: 4 }], outer: ['top'] };
        const long = TEST_ROLES.get('table')?.[0];
        if (!long) {
            throw new Error('test table');
        }
        const round = { ...long, key: 'round-table', width: 1, height: 1 };
        const roles = new Map([...TEST_ROLES].map(([role, stamps]) => [role, role === 'table' ? [round, ...stamps] : stamps]));
        const tables = furnishRoom(hall, roles, seededRandom(1)).stamps.filter((p) => roleOf(p) === 'table' || p.stamp === 'round-table');
        expect(tables.length).toBeGreaterThan(0);
        expect(tables.every((t) => t.stamp !== 'round-table')).toBe(true);
    });

    it('puts a bar’s counter against an inner wall, stools before it facing it', () => {
        const bar: RoomFloor = {
            key: 'bar',
            purpose: 'bar',
            rect: { x: 0, y: 0, w: 6, h: 5 },
            doors: [{ side: 'right', at: 2 }],
            outer: ['top', 'left'],
            entrance: null,
        };
        const placed = furnish(bar);
        expectOrderly(bar, placed);
        const counter = placed.find((p) => roleOf(p) === 'counter');
        // Inner walls are the bottom (180°) and the right (90°), though the right has the door.
        expect(counter?.rotation).toBe(180);
        const stools = placed.filter((p) => roleOf(p) === 'seat');
        expect(stools.length).toBeGreaterThanOrEqual(3);
        for (const stool of stools) {
            // Before the counter (above it, the counter being on the bottom wall), facing it.
            expect(stool.y).toBeLessThan(counter?.y ?? 0);
            expect(stool.rotation).toBe(0);
        }
        // Each to a person's elbow room, never packed shoulder to shoulder by a narrow stool's art.
        const xs = stools.map((s) => s.x).sort((a, b) => a - b);
        xs.slice(1).forEach((x, i) => {
            expect(x - (xs[i] ?? 0)).toBeGreaterThanOrEqual(0.75 - EPSILON);
        });
    });

    it('never lays a rug across a stairwell: a rug over the steps reads as the stair’s', () => {
        const bedroom: RoomFloor = {
            key: 'bed',
            purpose: 'bedroom',
            rect: { x: 0, y: 0, w: 5, h: 5 },
            doors: [{ side: 'bottom', at: 2 }],
            outer: [],
            entrance: null,
        };
        const rugs = (reserved: readonly { x: number; y: number; w: number; h: number }[]): number =>
            furnishRoom(bedroom, TEST_ROLES, seededRandom(1), reserved).stamps.filter((p) => roleOf(p) === 'rug').length;
        expect(rugs([])).toBe(1);
        expect(rugs([{ x: 1.8, y: 1.5, w: 1.4, h: 2.6 }])).toBe(0);
    });

    it('lays a bedroom’s rug beneath everything, and its beds against the walls', () => {
        const bedroom: RoomFloor = {
            key: 'bed',
            purpose: 'bedroom',
            rect: { x: 0, y: 0, w: 5, h: 5 },
            doors: [{ side: 'bottom', at: 2 }],
            outer: [],
            entrance: null,
        };
        const placed = furnish(bedroom);
        expectOrderly(bedroom, placed);
        expect(roleOf(placed[0] ?? { stamp: '', x: 0, y: 0, rotation: 0 })).toBe('rug');
        const beds = placed.filter((p) => roleOf(p) === 'bed');
        expect(beds.length).toBeGreaterThanOrEqual(1);
        for (const bed of beds) {
            // Headboard (the image's left, turned a quarter to the top) against the wall it faces away from.
            const facing = (bed.rotation - 90 + 360) % 360;
            const box = boxOf(bed);
            const flush = { 0: box.y === 0, 90: box.x + box.w === 5, 180: box.y + box.h === 5, 270: box.x === 0 }[facing];
            expect(flush).toBe(true);
        }
        // A lamp and a chest even in a small room, and none of a store's crates: a guest's room, not just a bed.
        for (const role of ['light', 'chest'] as const) {
            expect(placed.some((p) => roleOf(p) === role)).toBe(true);
        }
        expect(placed.some((p) => roleOf(p) === 'storage')).toBe(false);
        // A guest room of any size has its table and chair, and something on the table.
        const guestRoom = { ...bedroom, rect: { x: 0, y: 0, w: 6, h: 6 } };
        const tabled = furnishRoom(guestRoom, TEST_ROLES, seededRandom(1)).stamps;
        expectOrderly(guestRoom, tabled);
        for (const role of ['table', 'seat', 'tabletop'] as const) {
            expect(tabled.some((p) => roleOf(p) === role)).toBe(true);
        }
        // Another setting's bed, used for want of one, is reported.
        const lentBeds = new Map([...TEST_ROLES].map(([role, list]) => [role, role === 'bed' ? list.map((s) => ({ ...s, borrowed: true })) : list]));
        expect(furnishRoom(bedroom, lentBeds, seededRandom(1)).borrowed).toEqual(['bed']);
        expect(furnishRoom(bedroom, TEST_ROLES, seededRandom(1)).borrowed).toEqual([]);
    });

    it('fills a storeroom’s walls with storage', () => {
        const store: RoomFloor = {
            key: 'store',
            purpose: 'storage',
            rect: { x: 0, y: 0, w: 5, h: 5 },
            doors: [{ side: 'left', at: 2 }],
            outer: [],
            entrance: null,
        };
        const placed = furnish(store);
        expectOrderly(store, placed);
        const storage = placed.filter((p) => roleOf(p) === 'storage');
        const inCorner = (p: ComposedStamp): boolean => (p.x < 1 || p.x > 4) && (p.y < 1 || p.y > 4);
        // Every corner holds some, and more stand along the walls between them.
        expect(storage.filter(inCorner)).toHaveLength(4);
        expect(storage.filter((p) => !inCorner(p)).length).toBeGreaterThanOrEqual(1);
    });

    it('furnishes every purpose in order, and the same way for a seed', () => {
        for (const purpose of ROOM_PURPOSES) {
            const room: RoomFloor = {
                key: purpose,
                purpose,
                rect: { x: 0, y: 0, w: 6, h: 6 },
                doors: [{ side: 'top', at: 2 }],
                outer: ['bottom'],
                entrance: null,
            };
            const placed = furnish(room, 5);
            expectOrderly(room, placed);
            expect(placed.length).toBeGreaterThan(0);
            expect(furnish(room, 5)).toEqual(placed);
        }
    });

    it('reports the roles no loaded stamp fills, but not a table’s missing seats', () => {
        const tablesOnly = new Map([['table', TEST_ROLES.get('table') ?? []]] as const);
        const result = furnishRoom(COMMON, tablesOnly, seededRandom(1));
        expect(result.missing.sort()).toEqual(['clutter', 'hearth', 'light', 'storage']);
        // Tables still stand, unseated.
        expect(result.stamps.length).toBeGreaterThan(0);
        expect(Object.keys(ROOM_TEMPLATES).sort()).toEqual([...ROOM_PURPOSES].sort());
    });
});

describe('a chapel', () => {
    /** A nave entered from the bottom: its altar belongs on the top wall, facing the way in. */
    const NAVE: RoomFloor = {
        key: 'nave',
        purpose: 'chapel',
        rect: { x: 0, y: 0, w: 9, h: 12 },
        // The front door, and a side door whose facing wall must not win over the front's.
        doors: [
            { side: 'bottom', at: 4 },
            { side: 'left', at: 2 },
        ],
        outer: ['top', 'bottom', 'left'],
        entrance: 'bottom',
    };

    it('stands its altar on the wall facing the door, and its pews in rows facing the altar with a centre aisle', () => {
        const placed = furnish(NAVE);
        expectOrderly(NAVE, placed);
        const altar = placed.find((p) => roleOf(p) === 'altar');
        const pews = placed.filter((p) => roleOf(p) === 'pew');
        // Against the top wall, back to it.
        expect(altar && boxOf(altar).y).toBeCloseTo(NAVE.rect.y);
        expect(altar?.rotation).toBe(0);
        expect(pews.length).toBeGreaterThanOrEqual(6);
        for (const pew of pews) {
            // Backs to the bottom wall: seats face up the nave, to the altar, all behind its kept front.
            expect(pew.rotation).toBe(180);
            expect(boxOf(pew).y).toBeGreaterThan((altar?.y ?? 0) + 1.5);
        }
        // Two columns either side of an aisle down the middle, clear of the door's line.
        const middle = NAVE.rect.x + NAVE.rect.w / 2;
        expect(pews.some((p) => p.x < middle)).toBe(true);
        expect(pews.some((p) => p.x > middle)).toBe(true);
        expect(pews.every((p) => Math.abs(p.x - middle) >= 0.5)).toBe(true);
    });

    it('fits pew art drawn deeper than a row to a row’s depth, as runs of pews along each column', () => {
        // The test pew is drawn 2 × 1.66: as drawn, a row of them would be two thirds of a square too deep.
        const pews = furnish(NAVE).filter((p) => roleOf(p) === 'pew');
        expect(pews.length).toBeGreaterThanOrEqual(6);
        for (const pew of pews) {
            expect(Math.min(boxOf(pew).w, boxOf(pew).h)).toBeLessThanOrEqual(1 + EPSILON);
        }
    });

    it('runs its aisle up from a door in the far wall to the altar', () => {
        const shallow: RoleIndex = new Map(
            [...TEST_ROLES].map(([role, stamps]) => [role, role === 'pew' ? stamps.map((s) => ({ ...s, height: 0.8 })) : stamps]),
        );
        const wide: RoomFloor = { ...NAVE, rect: { x: 0, y: 0, w: 12, h: 12 }, doors: [{ side: 'bottom', at: 7 }] };
        const pews = furnishRoom(wide, shallow, seededRandom(1)).stamps.filter((p) => roleOf(p) === 'pew');
        expect(pews.some((p) => p.x < 7.5)).toBe(true);
        expect(pews.some((p) => p.x > 7.5)).toBe(true);
        // Nothing stands in the aisle between the door and the altar.
        expect(pews.every((p) => boxOf(p).x + boxOf(p).w <= 7 + EPSILON || boxOf(p).x >= 8 - EPSILON)).toBe(true);
    });

    it('says so when its pews find no room at all, rather than leaving the nave empty silently', () => {
        const cramped: RoomFloor = { ...NAVE, rect: { x: 0, y: 0, w: 3, h: 3 }, doors: [{ side: 'bottom', at: 1 }] };
        expect(furnishRoom(cramped, TEST_ROLES, seededRandom(1)).crowded).toContain('pew');
        expect(furnishRoom(NAVE, TEST_ROLES, seededRandom(1)).crowded).not.toContain('pew');
    });

    it('is lit along its walls, one light to every eight squares of wall, so a great nave is lit end to end', () => {
        const great: RoomFloor = { ...NAVE, rect: { x: 0, y: 0, w: 20, h: 14 } };
        const lights = furnish(great).filter((p) => roleOf(p) === 'light');
        expect(lights.length).toBe(Math.round((2 * (20 + 14)) / 8));
        // Spread down the nave, not bunched on one wall.
        const ys = lights.map((l) => l.y);
        expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(great.rect.h / 2);
        // Lamps drawn with depth have no back, so they still line every wall, unturned.
        const drawnWithDepth = new Map(
            [...TEST_ROLES].map(([role, stamps]) => [role, role === 'light' ? stamps.map((s) => ({ ...s, upright: true })) : stamps]),
        );
        const upright = furnishRoom(great, drawnWithDepth, seededRandom(1)).stamps.filter((p) => roleOf(p) === 'light');
        expect(upright.every((l) => l.rotation === 0)).toBe(true);
        expect(new Set(upright.map((l) => (l.x < 1 ? 'left' : l.x > 19 ? 'right' : l.y < 1 ? 'top' : 'bottom'))).size).toBeGreaterThanOrEqual(3);
        const cell: RoomFloor = { ...NAVE, rect: { x: 0, y: 0, w: 2, h: 1 } };
        expect(furnish({ ...cell, purpose: 'hall', doors: [], entrance: null }).filter((p) => roleOf(p) === 'light').length).toBeLessThanOrEqual(1);
    });

    it('faces its pews to the wall farthest from the door when it has no altar', () => {
        const noAltar = new Map([...TEST_ROLES].filter(([role]) => role !== 'altar'));
        const { stamps, missing } = furnishRoom({ ...NAVE, doors: [{ side: 'left', at: 5 }], entrance: null }, noAltar, seededRandom(2));
        expect(missing).toContain('altar');
        const pews = stamps.filter((p) => roleOf(p) === 'pew');
        expect(pews.length).toBeGreaterThan(0);
        // Facing the right wall, the one across from the door: backs to the left.
        expect(pews.every((p) => p.rotation === 270)).toBe(true);
    });
});

describe('companions and what is set on surfaces', () => {
    it('stands a bar’s counter out from the wall, shelves on the wall behind it, stools before it, drink on it', () => {
        const bar: RoomFloor = {
            key: 'bar',
            purpose: 'bar',
            rect: { x: 0, y: 0, w: 8, h: 6 },
            doors: [{ side: 'bottom', at: 3 }],
            outer: ['bottom'],
            entrance: null,
        };
        const placed = furnish(bar, 2);
        expectOrderly(bar, placed);
        const counter = placed.find((p) => roleOf(p) === 'counter');
        const box = counter ? boxOf(counter) : null;
        if (!box) {
            throw new Error('no counter');
        }
        // The standoff from the wall behind it: the barkeep's floor.
        const gaps = [box.x - bar.rect.x, bar.rect.x + bar.rect.w - box.x - box.w, box.y - bar.rect.y, bar.rect.y + bar.rect.h - box.y - box.h];
        expect(gaps.some((gap) => Math.abs(gap - 1.3) < EPSILON)).toBe(true);
        // Behind it: in the strip between the counter and whichever wall it stands off.
        const { rect } = bar;
        const strips: Box[] = [
            { x: rect.x, y: box.y, w: box.x - rect.x, h: box.h },
            { x: box.x + box.w, y: box.y, w: rect.x + rect.w - box.x - box.w, h: box.h },
            { x: box.x, y: rect.y, w: box.w, h: box.y - rect.y },
            { x: box.x, y: box.y + box.h, w: box.w, h: rect.y + rect.h - box.y - box.h },
        ].filter((strip) => Math.abs(Math.min(strip.w, strip.h) - 1.3) < EPSILON);
        const shelves = placed.filter((p) => roleOf(p) === 'shelf').map(boxOf);
        expect(
            shelves.some((s) =>
                strips.some(
                    (strip) =>
                        s.x >= strip.x - EPSILON &&
                        s.y >= strip.y - EPSILON &&
                        s.x + s.w <= strip.x + strip.w + EPSILON &&
                        s.y + s.h <= strip.y + strip.h + EPSILON,
                ),
            ),
        ).toBe(true);
        expect(placed.filter((p) => roleOf(p) === 'seat').length).toBeGreaterThanOrEqual(2);
        expect(placed.filter((p) => roleOf(p) === 'tabletop').length).toBeGreaterThanOrEqual(2);
    });

    it('stands a nightstand beside each bed and a chest against a wall, never out in the floor', () => {
        const bedroom: RoomFloor = {
            key: 'bed',
            purpose: 'bedroom',
            rect: { x: 0, y: 0, w: 5, h: 5 },
            doors: [{ side: 'bottom', at: 2 }],
            outer: [],
            entrance: null,
        };
        const placed = furnish(bedroom, 3);
        expectOrderly(bedroom, placed);
        const beds = placed.filter((p) => roleOf(p) === 'bed').map(boxOf);
        const stands = placed.filter((p) => roleOf(p) === 'nightstand').map(boxOf);
        expect(beds.length).toBeGreaterThanOrEqual(1);
        const touching = (a: Box, b: Box): boolean => a.x <= b.x + b.w + 0.2 && b.x <= a.x + a.w + 0.2 && a.y <= b.y + b.h + 0.2 && b.y <= a.y + a.h + 0.2;
        for (const bed of beds) {
            expect(stands.some((s) => touching(s, bed))).toBe(true);
        }
        // A chest, a guest's own, not a store's crate: its back to a wall, not standing out at a bed's foot.
        const flush = (b: Box): boolean => b.x < EPSILON || b.y < EPSILON || Math.abs(b.x + b.w - 5) < EPSILON || Math.abs(b.y + b.h - 5) < EPSILON;
        const chests = placed.filter((p) => roleOf(p) === 'chest').map(boxOf);
        expect(chests.length).toBeGreaterThanOrEqual(1);
        expect(chests.every(flush)).toBe(true);
    });

    it('sets a meal on every table of a common room, never over its edge nor on another', () => {
        const placed = furnish(COMMON, 4);
        expectOrderly(COMMON, placed);
        const tables = placed.filter((p) => roleOf(p) === 'table').map(boxOf);
        const items = placed.filter((p) => roleOf(p) === 'tabletop').map(boxOf);
        for (const table of tables) {
            expect(items.some((i) => i.x >= table.x && i.x + i.w <= table.x + table.w && i.y >= table.y && i.y + i.h <= table.y + table.h)).toBe(true);
        }
        items.forEach((a, i) => {
            for (const b of items.slice(i + 1)) {
                expect(overlap(a, b)).toBe(false);
            }
        });
    });
});

describe('art drawn with depth', () => {
    it('is never turned, in any room, so nothing stands upside down', () => {
        const upright = new Map([...TEST_ROLES].map(([role, list]) => [role, list.map((s) => ({ ...s, upright: true, turn: 0 }))]));
        for (const purpose of ROOM_PURPOSES) {
            for (const seed of [1, 2, 3]) {
                const room: RoomFloor = {
                    key: purpose,
                    purpose,
                    rect: { x: 0, y: 0, w: 9, h: 7 },
                    doors: [{ side: 'bottom', at: 4 }],
                    outer: ['top', 'bottom'],
                    entrance: 'bottom',
                };
                const placed = furnishRoom(room, upright, seededRandom(seed)).stamps;
                expect(placed.filter((p) => p.rotation % 360 !== 0)).toEqual([]);
            }
        }
    });
});

describe('variety', () => {
    it('varies a room’s kit piece by piece, but keeps its chairs and tables a matching set', () => {
        const kit = (id: string): RoleStamp => ({
            key: `test:${id}`,
            role: 'medical',
            width: 1,
            height: 1,
            turn: 0,
            against: 'wall',
            clearance: 0,
            upright: false,
            habitats: [],
            climb: null,
            borrowed: false,
            purposes: [],
            tags: [],
        });
        const chair = (id: string): RoleStamp => ({
            key: `test:${id}`,
            role: 'seat',
            width: 0.5,
            height: 0.5,
            turn: 0,
            against: 'free',
            clearance: 0,
            upright: false,
            habitats: [],
            climb: null,
            borrowed: false,
            purposes: [],
            tags: [],
        });
        // No benches, so the common room's tables are seated with chairs.
        const roles = new Map([
            ...TEST_ROLES,
            ['medical', [kit('gurney'), kit('monitor'), kit('drip')]],
            ['seat', [chair('stool'), chair('armchair')]],
            ['bench', []],
        ] as const);
        const medicae: RoomFloor = {
            key: 'medicae',
            purpose: 'medicae',
            rect: { x: 0, y: 0, w: 10, h: 8 },
            doors: [{ side: 'left', at: 3 }],
            outer: [],
            entrance: null,
        };
        const kinds = new Set(
            furnishRoom(medicae, roles, seededRandom(3))
                .stamps.filter((p) => p.stamp !== 'test:storage' && ['test:gurney', 'test:monitor', 'test:drip'].includes(p.stamp))
                .map((p) => p.stamp),
        );
        expect(kinds.size).toBeGreaterThan(1);
        const seats = new Set(
            furnishRoom(COMMON, roles, seededRandom(3))
                .stamps.filter((p) => p.stamp === 'test:stool' || p.stamp === 'test:armchair')
                .map((p) => p.stamp),
        );
        expect(seats.size).toBe(1);
    });
});

describe('the grim far future’s rooms', () => {
    const room = (purpose: RoomFloor['purpose']): RoomFloor => ({
        key: purpose,
        purpose,
        rect: { x: 0, y: 0, w: 10, h: 8 },
        doors: [{ side: 'left', at: 3 }],
        outer: ['top'],
        entrance: null,
    });

    it('fills a factory with machines in rows, a medicae with gurneys, an armoury with racks, a barracks with beds', () => {
        const count = (purpose: RoomFloor['purpose'], role: StampRole): number => furnish(room(purpose)).filter((p) => roleOf(p) === role).length;
        expect(count('factory', 'machine')).toBeGreaterThanOrEqual(4);
        expect(count('medicae', 'medical')).toBeGreaterThanOrEqual(2);
        expect(count('armoury', 'rack')).toBeGreaterThanOrEqual(3);
        expect(count('barracks', 'bed')).toBeGreaterThanOrEqual(4);
        expect(count('command', 'console')).toBeGreaterThanOrEqual(2);
        expect(count('interrogation', 'restraint')).toBe(1);
        for (const purpose of ['factory', 'medicae', 'armoury', 'barracks', 'command', 'interrogation', 'mess', 'chapel'] as const) {
            expectOrderly(room(purpose), furnish(room(purpose)));
        }
    });

    const GUEST: RoomFloor = {
        key: 'guest',
        purpose: 'bedroom',
        rect: { x: 0, y: 0, w: 4, h: 4 },
        doors: [{ side: 'bottom', at: 1 }],
        outer: ['top'],
        entrance: null,
    };
    const bed = byKey.get('test:bed');
    if (!bed) {
        throw new Error('fixture bed');
    }

    it('seats a narrow room’s tables with chairs where its benches are too deep to leave the table room', () => {
        const table = byKey.get('test:table');
        const seat = byKey.get('test:seat');
        if (!table || !seat) {
            throw new Error('fixture table or seat');
        }
        // Both drawn with depth, so they sit above each table: the bench is deep, as a waiting bench is.
        const deep: RoleStamp = { ...seat, key: 'test:deep-bench', role: 'bench', width: 1.6, height: 1.4, upright: true };
        const roles = new Map<StampRole, readonly RoleStamp[]>([...TEST_ROLES, ['bench', [deep]], ['seat', [{ ...seat, upright: true }]]]);
        const mess: RoomFloor = {
            key: 'mess',
            purpose: 'mess',
            rect: { x: 0, y: 0, w: 14, h: 3.65 },
            doors: [{ side: 'right', at: 1 }],
            outer: ['top'],
            entrance: null,
        };
        const placed = furnishRoom(mess, roles, seededRandom(1)).stamps;
        expect(placed.filter((p) => p.stamp === table.key).length).toBeGreaterThanOrEqual(3);
        expect(placed.some((p) => p.stamp === 'test:deep-bench')).toBe(false);
        expect(placed.some((p) => p.stamp === seat.key)).toBe(true);
    });

    it('stands the smallest dresser the room has where the one drawn fits no wall: a dresser where a wardrobe will not go', () => {
        const dresser = TEST_ROLES.get('dresser')?.[0];
        if (!dresser) {
            throw new Error('fixture dresser');
        }
        // Far too wide for any wall of the room, and a small one beside it.
        const hulking: RoleStamp = { ...dresser, key: 'test:hulking-wardrobe', width: 9, height: 1 };
        const roles = new Map<StampRole, readonly RoleStamp[]>([...TEST_ROLES, ['dresser', [hulking, dresser]]]);
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const placed = furnishRoom(GUEST, roles, seededRandom(seed)).stamps;
            expect(placed.some((p) => p.stamp === dresser.key)).toBe(true);
            expect(placed.some((p) => p.stamp === hulking.key)).toBe(false);
        }
    });

    it('furnishes a guest room as one is lived in: a dresser against a wall, an armchair across a corner facing out', () => {
        const lived: RoomFloor = { ...GUEST, rect: { x: 0, y: 0, w: 4, h: 5 } };
        const diagonals = [45, 135, 225, 315];
        for (const seed of [1, 2, 3, 4]) {
            const placed = furnish(lived, seed);
            expectOrderly(lived, placed);
            const dressers = placed.filter((p) => roleOf(p) === 'dresser').map(boxOf);
            expect(dressers.length).toBeGreaterThanOrEqual(1);
            // Its back to a wall: flush with one of the room's sides.
            const flush = (b: Box): boolean => b.x < EPSILON || b.y < EPSILON || Math.abs(b.x + b.w - 4) < EPSILON || Math.abs(b.y + b.h - 5) < EPSILON;
            expect(dressers.every(flush)).toBe(true);
            const [chair] = placed.filter((p) => roleOf(p) === 'armchair');
            expect(diagonals).toContain(chair?.rotation);
        }
        // A room three squares wide has no floor for a table out in it: its table stands against a wall.
        const narrow: RoomFloor = { ...GUEST, rect: { x: 0, y: 0, w: 2.65, h: 4.65 } };
        const writing: RoleStamp = { ...bed, key: 'test:writing-table', role: 'table', width: 1, height: 0.6, turn: 0, against: 'free' };
        const chairs: ComposedStamp[] = [];
        for (const seed of [1, 2, 3]) {
            const placed = furnishRoom(narrow, new Map([...TEST_ROLES, ['table', [writing]]]), seededRandom(seed)).stamps;
            expect(placed.filter((p) => p.stamp === 'test:writing-table')).toHaveLength(1);
            expect(placed.some((p) => roleOf(p) === 'dresser')).toBe(true);
            chairs.push(...placed.filter((p) => roleOf(p) === 'armchair'));
        }
        // Its corners taken by the bed and the doorway, the armchair sits square against a wall instead.
        expect(chairs.some((c) => c.rotation % 90 === 0)).toBe(true);
        // A chair drawn with depth faces only down, so its table stands against the bottom wall, the chair above it, unturned.
        const seat = byKey.get('test:seat');
        if (!seat) {
            throw new Error('fixture seat');
        }
        const upright = new Map<StampRole, readonly RoleStamp[]>([...TEST_ROLES, ['table', [writing]], ['seat', [{ ...seat, upright: true }]]]);
        upright.delete('bed');
        const closet: RoomFloor = { ...GUEST, rect: { x: 0, y: 0, w: 2.65, h: 2.65 }, doors: [{ side: 'top', at: 1 }] };
        const walled = furnishRoom(closet, upright, seededRandom(1)).stamps;
        const table = walled.find((p) => p.stamp === 'test:writing-table');
        expect(table?.rotation).toBe(180);
        expect(walled.some((p) => p.stamp === 'test:seat' && p.rotation === 0 && table !== undefined && p.y < table.y)).toBe(true);
        // With no chair to be had, the table still stands against a wall, alone.
        const chairless = new Map(upright);
        for (const role of ['seat', 'armchair', 'dresser'] as const) {
            chairless.delete(role);
        }
        const alone = furnishRoom({ ...closet, doors: [{ side: 'bottom', at: 1 }] }, chairless, seededRandom(1)).stamps;
        expect(alone.filter((p) => p.stamp === 'test:writing-table')).toHaveLength(1);
        expect(alone.some((p) => p.stamp === 'test:seat')).toBe(false);
        // Without an easy chair, no plain chair pretends to be one: the corner is left for its placeholder, or empty.
        const plain = furnishRoom(lived, new Map([...TEST_ROLES].filter(([role]) => role !== 'armchair')), seededRandom(1));
        expect(plain.missing).toContain('armchair');
        expect(plain.stamps.some((p) => p.stamp === 'test:seat' && (p.x < 1 || p.x > 3) && (p.y < 1 || p.y > 4))).toBe(false);
        const boxed = furnishRoom(lived, withPlaceholders(new Map([...TEST_ROLES].filter(([role]) => role !== 'armchair'))), seededRandom(1)).stamps;
        expect(boxed.some((p) => p.stamp === 'placeholder:0.8x0.8:armchair')).toBe(true);
    });

    it('keeps pieces that name another kind of room out of a room, unless nothing else fills the role', () => {
        const medicae: RoleStamp = { ...bed, key: 'test:medicae-bed', purposes: ['medicae'] };
        const beds = (list: readonly RoleStamp[], where: RoomFloor): string[] =>
            furnishRoom(where, new Map([...TEST_ROLES, ['bed', list]]), seededRandom(1))
                .stamps.filter((p) => p.stamp.endsWith('bed'))
                .map((p) => p.stamp);
        for (const seed of [1, 2, 3]) {
            const placed = furnishRoom(GUEST, new Map([...TEST_ROLES, ['bed', [medicae, bed]]]), seededRandom(seed)).stamps;
            expect(placed.filter((p) => p.stamp.endsWith('bed')).map((p) => p.stamp)).toEqual(['test:bed']);
        }
        // A medicae bed in a guest room when it is the only bed there is; a cell takes its own bunk over a medicae bed.
        expect(beds([medicae], GUEST)).toEqual(['test:medicae-bed']);
        const bunk: RoleStamp = { ...bed, key: 'test:cell-bed', purposes: ['cell'] };
        expect(beds([medicae, bunk], { ...GUEST, purpose: 'cell' })).toEqual(['test:cell-bed']);
    });

    it('stacks a store’s rows from its large pieces, varied, and stands piles drawn with depth by any wall as drawn', () => {
        const piece = (id: string, width: number, height: number, upright = false): RoleStamp => ({
            ...bed,
            key: `test:${id}`,
            role: 'storage',
            width,
            height,
            turn: 0,
            upright,
            against: 'free',
        });
        const stores = [piece('crates', 1.2, 1.2), piece('barrels', 0.9, 1.2, true), piece('sacks', 1, 0.8, true), piece('keg', 0.3, 0.4, true)];
        const cellar: RoomFloor = {
            key: 'cellar',
            purpose: 'storage',
            rect: { x: 0, y: 0, w: 9, h: 9 },
            doors: [{ side: 'top', at: 4 }],
            outer: [],
            entrance: null,
        };
        const placed = furnishRoom(cellar, new Map([...TEST_ROLES, ['storage', stores]]), seededRandom(4)).stamps;
        // The rows: away from every wall, more than one kind, never the keg too small to read as a stack.
        const rows = placed.filter((p) => p.x > 2 && p.x < 7 && p.y > 2 && p.y < 7 && p.stamp !== 'test:seat');
        const kinds = new Set(rows.map((p) => p.stamp).filter((k) => stores.some((s) => s.key === k)));
        expect(kinds.size).toBeGreaterThan(1);
        expect(kinds.has('test:keg')).toBe(false);
        // Piles drawn with depth line the side and bottom walls too, unturned.
        const piles = placed.filter((p) => ['test:barrels', 'test:sacks', 'test:keg'].includes(p.stamp));
        expect(piles.every((p) => p.rotation === 0)).toBe(true);
        expect(piles.some((p) => p.x < 1.5 || p.x > 7.5 || p.y > 7.5)).toBe(true);
    });

    it('stands a long table in for a missing work surface, never a round one', () => {
        const round: RoleStamp = { ...bed, key: 'test:round-table', role: 'table', width: 1, height: 1, turn: 0, against: 'free' };
        const long = byKey.get('test:table');
        if (!long) {
            throw new Error('fixture table');
        }
        const kitchen: RoomFloor = { ...GUEST, key: 'kitchen', purpose: 'kitchen', rect: { x: 0, y: 0, w: 6, h: 5 } };
        const roles = new Map([...TEST_ROLES].filter(([role]) => role !== 'workbench'));
        roles.set('table', [round, long]);
        for (const seed of [1, 2, 3]) {
            const tables = furnishRoom(kitchen, roles, seededRandom(seed)).stamps.filter((p) => p.stamp.endsWith('table'));
            expect(tables.length).toBeGreaterThan(0);
            expect(tables.every((p) => p.stamp === 'test:table')).toBe(true);
        }
    });
});

/** A named fixture with the intent's defaults, `over` what it asks. */
function fixture(over: Partial<FixtureIntent> & Pick<FixtureIntent, 'name' | 'place'>): FixtureIntent {
    return { tags: [], width: 1, height: 1, count: 1, facing: 'bottom', fixed: false, open: [], mirror: false, ...over };
}

/** A room of fixtures alone, 10 × 8 inside its walls, its one door in the middle of its bottom wall. */
const HALL: RoomFloor = {
    key: 'hall',
    purpose: 'office',
    rect: { x: 0, y: 0, w: 10, h: 8 },
    doors: [{ side: 'bottom', at: 4.5 }],
    outer: [],
    entrance: 'bottom',
    furnish: 'fixtures',
    grime: 0,
};

/** Placed boxes by their label (placeholder keys carry it). */
const labelled = (placed: readonly ComposedStamp[], label: string): ComposedStamp[] => placed.filter((p) => p.stamp.endsWith(`:${label}`));

describe('rooms furnished by purpose', () => {
    const table = TEST_ROLES.get('table')?.[0];
    const tabletop = TEST_ROLES.get('tabletop')?.[0];
    if (!table || !tabletop) {
        throw new Error('test table');
    }

    it('stands long tables drawn with depth as drawn, never turned, and sets nothing on one too big for it', () => {
        const roles = new Map([
            ...TEST_ROLES,
            ['table' as const, [{ ...table, key: 'test:trestle', upright: true, width: 2, height: 0.8 }]],
            ['tabletop' as const, [{ ...tabletop, key: 'test:banquet', width: 3, height: 3 }]],
        ]);
        const mess: RoomFloor = { ...HALL, key: 'mess', purpose: 'mess', furnish: 'purpose', fixtures: [] };
        const { stamps } = furnishRoom(mess, roles, seededRandom(1));
        const trestles = stamps.filter((s) => s.stamp === 'test:trestle');
        expect(trestles.length).toBeGreaterThan(0);
        expect(trestles.every((s) => s.rotation === 0)).toBe(true);
        expect(stamps.some((s) => s.stamp === 'test:banquet')).toBe(false);
    });

    it('seats a narrow chapel in one column of pews, its aisle beside them, lined up with a door in the far wall', () => {
        const narrow: RoomFloor = { ...HALL, key: 'chapel', purpose: 'chapel', furnish: 'purpose', fixtures: [], rect: { x: 0, y: 0, w: 4, h: 10 } };
        const pews = furnishRoom(narrow, TEST_ROLES, seededRandom(1)).stamps.filter((s) => s.stamp === 'test:pew');
        expect(pews.length).toBeGreaterThan(0);
        expect(pews.every((p) => p.x > 0 && p.x < 4)).toBe(true);
        // A wide chapel whose door is in the wall across from its altar lines its aisle up with the door.
        const wide: RoomFloor = { ...HALL, key: 'chapel', purpose: 'chapel', furnish: 'purpose', fixtures: [] };
        const rows = furnishRoom(wide, TEST_ROLES, seededRandom(1)).stamps.filter((s) => s.stamp === 'test:pew');
        expect(rows.length).toBeGreaterThan(1);
        // With its only door in a side wall, the aisle runs up the middle.
        const sideDoor: RoomFloor = { ...wide, doors: [{ side: 'left', at: 3, width: 1 }], entrance: 'left' };
        expect(furnishRoom(sideDoor, TEST_ROLES, seededRandom(1)).stamps.filter((s) => s.stamp === 'test:pew').length).toBeGreaterThan(1);
    });

    it('draws a fixture asking for art by its tags from all the art there is, whatever room its tags would keep it to', () => {
        const store: RoomFloor = { ...HALL, key: 'store', purpose: 'storage' };
        const bed = TEST_ROLES.get('bed')?.[0];
        if (!bed) {
            throw new Error('test bed');
        }
        const cot = { ...bed, key: 'test:cot', tags: ['cot'] };
        const roles = new Map([...TEST_ROLES, ['bed' as const, [cot]]]);
        const asked = fixture({ name: 'watchman’s cot', role: 'bed', tags: ['cot'], width: 1.2, height: 2, place: { at: { x: 0.5, y: 0.4 } } });
        expect(furnishRoom({ ...store, fixtures: [asked] }, roles, seededRandom(1)).stamps.some((s) => s.stamp === 'test:cot')).toBe(true);
    });
});

describe('stand-ins', () => {
    const office: RoomFloor = { ...HALL, key: 'office', purpose: 'office', furnish: 'purpose', fixtures: [] };
    const table = TEST_ROLES.get('table')?.[0];
    if (!table) {
        throw new Error('test table');
    }
    const long = { ...table, key: 'test:long-table' };
    const round = { ...table, key: 'test:round-table', width: 1, height: 1, tags: ['round'] };
    const noDesks = (tables: (typeof table)[]): typeof TEST_ROLES =>
        new Map([...[...TEST_ROLES].filter(([role]) => role !== 'desk'), ['table' as const, tables]]);

    it('gives a room with no desk art a long table to write at, never a round one where it has a long one', () => {
        const drawn = furnishRoom(office, noDesks([round, long]), seededRandom(1)).stamps.map((s) => s.stamp);
        expect(drawn).toContain('test:long-table');
        expect(drawn).not.toContain('test:round-table');
    });

    it('makes do with the only table it has, round or not, rather than leave the desk out', () => {
        const drawn = furnishRoom(office, noDesks([round]), seededRandom(1)).stamps.map((s) => s.stamp);
        expect(drawn).toContain('test:round-table');
    });
});

describe('named fixtures', () => {
    it('stands each where asked: against a wall exactly in its middle, in a corner, at a point; boxed where no art draws it', () => {
        const { stamps, boxed } = furnishRoom(
            {
                ...HALL,
                fixtures: [
                    fixture({ name: 'banner', width: 2, height: 0.3, place: { wall: 'top', along: 'middle', standoff: 0 } }),
                    fixture({ name: 'crate', place: { corner: 'top-right' } }),
                    fixture({ name: 'plinth', width: 2, height: 2, place: { at: { x: 0.5, y: 0.5 } } }),
                ],
            },
            TEST_ROLES,
            seededRandom(1),
        );
        const [banner] = labelled(stamps, 'banner');
        expect(banner).toMatchObject({ x: 5, y: 0.15 });
        expect(labelled(stamps, 'crate')[0]).toMatchObject({ x: 9.5, y: 0.5 });
        expect(labelled(stamps, 'plinth')[0]).toMatchObject({ x: 5, y: 4 });
        expect(boxed).toEqual(['banner', 'crate', 'plinth']);
    });

    it('boxes a long piece asked to face sideways whose art is drawn with depth, which would lie across its footprint', () => {
        const base = TEST_ROLES.get('desk')?.[0];
        if (!base) {
            throw new Error('test desk');
        }
        const roles: RoleIndex = new Map([...TEST_ROLES, ['desk', [{ ...base, key: 'test:deep-desk', upright: true, width: 2, height: 1 }]]]);
        const run = (facing: 'left' | 'bottom'): string[] =>
            furnishRoom(
                { ...HALL, fixtures: [fixture({ name: 'long desk', role: 'desk', width: 2, height: 1, facing, place: { at: { x: 0.5, y: 0.5 } } })] },
                roles,
                seededRandom(1),
            ).boxed;
        expect(run('left')).toEqual(['long desk']);
        expect(run('bottom')).toEqual([]);
    });

    it('leaves off, and says so, a fixture with no room where it was asked, not calling it a placeholder', () => {
        const { stamps, boxed, crowded } = furnishRoom(
            {
                ...HALL,
                fixtures: [
                    fixture({ name: 'plinth', width: 2, height: 2, place: { at: { x: 0.5, y: 0.5 } } }),
                    fixture({ name: 'statue', width: 2, height: 2, place: { at: { x: 0.5, y: 0.5 } } }),
                ],
            },
            TEST_ROLES,
            seededRandom(1),
        );
        expect(labelled(stamps, 'statue')).toHaveLength(0);
        expect(crowded).toEqual(['statue']);
        expect(boxed).toEqual(['plinth']);
    });

    it('says so when fewer of a fixture stand than asked, not only when none does', () => {
        // Six three-square cabinets asked against one wall of the hall: it holds fewer.
        const { crowded } = furnishRoom(
            { ...HALL, fixtures: [fixture({ name: 'cabinet', width: 3, height: 0.6, count: 6, place: { wall: 'top', along: 'spread', standoff: 0 } })] },
            TEST_ROLES,
            seededRandom(1),
        );
        expect(crowded).toEqual(['cabinet']);
        const { crowded: none } = furnishRoom(
            { ...HALL, fixtures: [fixture({ name: 'cabinet', width: 1, height: 0.6, count: 2, place: { wall: 'top', along: 'spread', standoff: 0 } })] },
            TEST_ROLES,
            seededRandom(1),
        );
        expect(none).toEqual([]);
    });

    it('draws a fixture in its role’s art carrying its tags, fitted to its size, the same art in every room', () => {
        const desk = fixture({ name: 'clerk desk', role: 'desk', width: 3, height: 1.6, place: { at: { x: 0.5, y: 0.3 } } });
        const first = furnishRoom({ ...HALL, fixtures: [desk] }, TEST_ROLES, seededRandom(1)).stamps;
        const second = furnishRoom({ ...HALL, fixtures: [desk] }, TEST_ROLES, seededRandom(99)).stamps;
        expect(first[0]?.stamp).toBe('test:desk');
        expect(first[0]?.stamp).toBe(second[0]?.stamp);
        expect(first[0]?.scale).toBeCloseTo(2);
    });

    it('seats a chair before a desk facing it, and another behind it', () => {
        const { stamps } = furnishRoom(
            {
                ...HALL,
                fixtures: [
                    fixture({ name: 'desk', width: 2, height: 1, place: { at: { x: 0.5, y: 0.4 } } }),
                    fixture({ name: 'visitor', width: 0.6, height: 0.6, place: { before: 'desk', gap: 0.1, behind: false } }),
                    fixture({ name: 'clerk', width: 0.6, height: 0.6, place: { before: 'desk', gap: 0.1, behind: true } }),
                ],
            },
            TEST_ROLES,
            seededRandom(1),
        );
        const [desk] = labelled(stamps, 'desk');
        const [visitor] = labelled(stamps, 'visitor');
        const [clerk] = labelled(stamps, 'clerk');
        // The desk faces down the page: its visitor below it, its clerk above, each centred on it and turned to face it.
        expect(visitor).toMatchObject({ x: desk?.x, rotation: 180 });
        expect(clerk).toMatchObject({ x: desk?.x, rotation: 0 });
        expect((visitor?.y ?? 0) - (desk?.y ?? 0)).toBeCloseTo(0.5 + 0.1 + 0.3);
        expect((desk?.y ?? 0) - (clerk?.y ?? 0)).toBeCloseTo(0.5 + 0.1 + 0.3);
    });

    it('fills an area given with whole rows only: a row a doorway would cut short is left out', () => {
        // Rows along the room's long side (across the page here), piece against piece.
        const rows = fixture({ name: 'pew', width: 2, height: 0.8, place: { rows: 'along', aisle: 0.5, area: { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } } } });
        const { stamps } = furnishRoom({ ...HALL, fixtures: [rows] }, TEST_ROLES, seededRandom(1));
        const pews = labelled(stamps, 'pew');
        const ys = [...new Set(pews.map((p) => p.y.toFixed(3)))];
        // Every row the same length, the area filled to its edges: five pews across 10 squares.
        expect(pews.length % ys.length).toBe(0);
        expect(pews.length / ys.length).toBe(5);
        // The door's approach at the bottom takes the last row whole.
        expect(Math.max(...pews.map((p) => p.y))).toBeLessThan(8 - 1.5);
    });

    it('stands pieces on any wall, off it by a standoff, in any corner, along a line, and over a whole room’s grid', () => {
        const { stamps } = furnishRoom(
            {
                ...HALL,
                fixtures: [
                    fixture({ name: 'rack', width: 2, height: 0.5, place: { wall: 'any', along: 'start', standoff: 0.5 } }),
                    fixture({ name: 'sack', place: { corner: 'any' } }),
                    fixture({ name: 'post', width: 0.5, height: 0.5, count: 1, place: { line: { from: { x: 0.2, y: 0.4 }, to: { x: 0.8, y: 0.4 } } } }),
                    fixture({ name: 'lamp', width: 0.5, height: 0.5, count: 3, place: { line: { from: { x: 0.2, y: 0.6 }, to: { x: 0.8, y: 0.6 } } } }),
                    fixture({ name: 'stool', width: 0.5, height: 0.5, place: { grid: { columns: 2, rows: 1 } } }),
                ],
            },
            TEST_ROLES,
            seededRandom(1),
        );
        // Off its wall by the standoff: its back half a square clear of whichever wall it took.
        const [rack] = labelled(stamps, 'rack');
        const clear = rack === undefined ? 0 : Math.min(rack.y - 0.25, rack.x - 0.25, 10 - rack.x - 0.25, 8 - rack.y - 0.25);
        expect(clear).toBeCloseTo(0.5);
        expect(labelled(stamps, 'sack')).toHaveLength(1);
        // A line of one stands at its middle; a line of three at both ends and the middle.
        expect(labelled(stamps, 'post')[0]).toMatchObject({ x: 5, y: 3.2 });
        expect(labelled(stamps, 'lamp').map((p) => p.x)).toEqual([2, 5, 8]);
        // A grid over the whole room: each piece in the middle of its cell.
        expect(labelled(stamps, 'stool').map((p) => [p.x, p.y])).toEqual([
            [2.5, 4],
            [7.5, 4],
        ]);
    });

    it('lays rows across a room as well as along it, no more than asked, and never turns art drawn with depth to do it', () => {
        // Clear of the doorway in the middle of the bottom wall: rows stand whole or not at all.
        const area = { from: { x: 0, y: 0 }, to: { x: 0.4, y: 0.8 } };
        const across = fixture({ name: 'cabinet', width: 1, height: 0.6, place: { rows: 'across', aisle: 1, max: 2, area } });
        const cabinets = labelled(furnishRoom({ ...HALL, fixtures: [across] }, TEST_ROLES, seededRandom(1)).stamps, 'cabinet');
        // The area is taller than wide, so rows across it run side to side: two of them, no more, each piece unturned.
        expect(cabinets.length).toBeGreaterThan(2);
        expect(new Set(cabinets.map((c) => c.y)).size).toBe(2);
        expect(cabinets.every((c) => c.rotation === 0)).toBe(true);
        // Rows along it run down it: each piece turned a quarter to lie along its row.
        const along = fixture({ name: 'locker', width: 1, height: 0.6, place: { rows: 'along', aisle: 1, max: 2, area } });
        const lockers = labelled(furnishRoom({ ...HALL, fixtures: [along] }, TEST_ROLES, seededRandom(1)).stamps, 'locker');
        expect(lockers.length).toBeGreaterThan(2);
        expect(new Set(lockers.map((c) => c.x)).size).toBe(2);
        expect(lockers.every((c) => c.rotation === 90)).toBe(true);
        const desk = TEST_ROLES.get('desk')?.[0];
        if (!desk) {
            throw new Error('test desk');
        }
        const upright = new Map([...TEST_ROLES, ['desk' as const, [{ ...desk, key: 'test:tall-desk', upright: true }]]]);
        const rows = fixture({ name: 'desk row', role: 'desk', tags: [], width: 1.5, height: 0.75, place: { rows: 'along', aisle: 1, max: 1, area } });
        const drawn = furnishRoom({ ...HALL, fixtures: [rows] }, upright, seededRandom(1)).stamps.filter((s) => s.stamp === 'test:tall-desk');
        expect(drawn.length).toBeGreaterThan(0);
        expect(drawn.every((d) => d.rotation === 0)).toBe(true);
    });

    it('lets a piece of a grid give a little within its cell rather than be lost to a doorway', () => {
        const grid = fixture({
            name: 'desk',
            width: 1,
            height: 0.6,
            place: { grid: { columns: 3, rows: 2 }, area: { from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.9 } } },
        });
        expect(labelled(furnishRoom({ ...HALL, fixtures: [grid] }, TEST_ROLES, seededRandom(1)).stamps, 'desk')).toHaveLength(6);
    });

    it('stands a fixed piece exactly where asked even across a doorway, taking no floor from others', () => {
        const { stamps } = furnishRoom(
            {
                ...HALL,
                fixtures: [
                    fixture({ name: 'rubble spill', width: 3, height: 1.5, fixed: true, place: { at: { x: 0.5, y: 0.95 } } }),
                    fixture({ name: 'crate', place: { at: { x: 0.5, y: 0.95 } } }),
                ],
            },
            TEST_ROLES,
            seededRandom(1),
        );
        expect(labelled(stamps, 'rubble spill')).toHaveLength(1);
        // The crate still keeps the door's approach clear.
        expect(labelled(stamps, 'crate')).toHaveLength(0);
    });

    it('sets a piece astride its point into the wall, where a fixed one is drawn in to stand wholly inside', () => {
        const port = (astride: boolean): FixtureIntent =>
            fixture({ name: 'firing port', width: 0.6, height: 0.4, facing: 'left', fixed: true, place: { at: { x: 0, y: 0.5 }, astride } });
        const [inWall] = labelled(furnishRoom({ ...HALL, fixtures: [port(true)] }, TEST_ROLES, seededRandom(1)).stamps, 'firing port');
        const [inside] = labelled(furnishRoom({ ...HALL, fixtures: [port(false)] }, TEST_ROLES, seededRandom(1)).stamps, 'firing port');
        // Centred on the left wall's face, half of it in the wall; or its whole depth (0.4, turned to face left) inside.
        expect(inWall?.x).toBeCloseTo(0);
        expect(inWall?.y).toBeCloseTo(4);
        expect(inside?.x).toBeCloseTo(0.2);
    });

    it('strews grime only on open floor, never half under a piece standing against a wall', () => {
        const debris = byKey.get('test:debris');
        if (!debris) {
            throw new Error('test debris');
        }
        const decal: RoleStamp = { ...debris, key: 'test:stain', role: 'decal', width: 0.8, height: 0.6 };
        const roles = new Map<StampRole, readonly RoleStamp[]>([...TEST_ROLES, ['decal', [decal]]]);
        // A long bench the whole height of the left wall, and one across most of the top: grime must keep off both.
        const benches = [
            fixture({ name: 'left bench', width: 7, height: 1, place: { wall: 'left', along: 'middle', standoff: 0 } }),
            fixture({ name: 'top bench', width: 8, height: 1, place: { wall: 'top', along: 'middle', standoff: 0 } }),
        ];
        const { stamps } = furnishRoom({ ...HALL, fixtures: benches, grime: 1 }, withPlaceholders(roles), seededRandom(5));
        const stains = stamps.filter((p) => p.stamp === 'test:stain');
        expect(stains.length).toBeGreaterThan(0);
        for (const s of stains) {
            // Clear of the left bench (x 0..1) and the top one (y 0..1), their own half-size in.
            expect(s.x - 0.4 >= 1 - 1e-9 && s.y - 0.4 >= 1 - 1e-9).toBe(true);
        }
    });

    it('strews grime along the walls, never across a doorway, beneath everything else', () => {
        const debris = byKey.get('test:debris');
        if (!debris) {
            throw new Error('test debris');
        }
        const decal: RoleStamp = { ...debris, key: 'test:stain', role: 'decal', width: 0.8, height: 0.6 };
        const roles = new Map<StampRole, readonly RoleStamp[]>([...TEST_ROLES, ['decal', [decal]]]);
        const room: RoomFloor = { ...HALL, fixtures: [fixture({ name: 'plinth', width: 2, height: 2, place: { centre: true } })], grime: 1 };
        const { stamps } = furnishRoom(room, withPlaceholders(roles), seededRandom(3));
        const stains = stamps.filter((p) => p.stamp === 'test:stain');
        expect(stains.length).toBeGreaterThan(3);
        // First in the drawing order: beneath the plinth.
        expect(stamps.findIndex((p) => p.stamp !== 'test:stain')).toBe(stains.length);
        for (const s of stains) {
            // Near a wall (within its reach and its own size).
            const nearest = Math.min(s.x, 10 - s.x, s.y, 8 - s.y);
            expect(nearest).toBeLessThanOrEqual(1.4 + 0.8);
            // Out of the door's approach (4.25..5.75 across, the bottom 1.5 squares).
            expect(s.y > 6.5 && s.x > 4.25 - 0.4 && s.x < 5.75 + 0.4).toBe(false);
        }
        // None where the room gathers no grime.
        expect(furnishRoom({ ...room, grime: 0 }, withPlaceholders(roles), seededRandom(3)).stamps.some((p) => p.stamp === 'test:stain')).toBe(false);
        // Grime drawn with depth lies as drawn against every wall, never turned.
        const drift: RoleStamp = { ...decal, key: 'test:drift', upright: true };
        const drifts = furnishRoom(room, withPlaceholders(new Map([...roles, ['decal', [drift]]])), seededRandom(3)).stamps.filter(
            (p) => p.stamp === 'test:drift',
        );
        expect(drifts.length).toBeGreaterThan(3);
        expect(drifts.every((p) => p.rotation === 0)).toBe(true);
    });
});
