// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import type { StampRole } from '../stamps/schema';
import { type ComposedStamp, furnishRoom, ROOM_TEMPLATES, type RoomFloor } from './furnish';
import { ROOM_PURPOSES } from './intent';
import type { RoleStamp } from './roles';
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
    const w = Math.abs((stamp?.width ?? 0) * Math.cos(radians)) + Math.abs((stamp?.height ?? 0) * Math.sin(radians));
    const h = Math.abs((stamp?.width ?? 0) * Math.sin(radians)) + Math.abs((stamp?.height ?? 0) * Math.cos(radians));
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
};

function furnish(room: RoomFloor, seed = 1): ComposedStamp[] {
    return furnishRoom(room, TEST_ROLES, seededRandom(seed)).stamps;
}

/** Everything placed stands inside the room, nothing overlaps (rugs lie beneath), and every door's approach is clear. */
function expectOrderly(room: RoomFloor, placed: readonly ComposedStamp[]): void {
    const solid = placed.filter((p) => roleOf(p) !== 'rug').map(boxOf);
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
            // Every table has seats (benches here) beside it.
            for (const table of tables) {
                const near = placed.filter((p) => roleOf(p) === 'bench' && Math.abs(p.x - table.x) < 1 && Math.abs(p.y - table.y) < 1);
                expect(near.length).toBeGreaterThanOrEqual(1);
            }
            expect(placed.filter((p) => roleOf(p) === 'clutter').length).toBeGreaterThanOrEqual(2);
        }
    });

    it('seats a round table all round, and gives a table chairs when its bench is far longer than it', () => {
        const table: RoleStamp = { key: 'test:round-table', role: 'table', width: 1, height: 1, turn: 0, against: 'free', clearance: 0, habitats: [] };
        const pew: RoleStamp = { key: 'test:pew', role: 'bench', width: 2, height: 0.9, turn: 0, against: 'free', clearance: 0, habitats: [] };
        const roles = new Map([...TEST_ROLES, ['table', [table]], ['bench', [pew]]] as const);
        const placed = furnishRoom(COMMON, roles, seededRandom(1)).stamps;
        const tables = placed.filter((p) => p.stamp === 'test:round-table');
        expect(tables.length).toBeGreaterThanOrEqual(2);
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

    it('puts a bar’s counter against an inner wall, stools before it facing it', () => {
        const bar: RoomFloor = { key: 'bar', purpose: 'bar', rect: { x: 0, y: 0, w: 6, h: 5 }, doors: [{ side: 'right', at: 2 }], outer: ['top', 'left'] };
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
    });

    it('lays a bedroom’s rug beneath everything, and its beds against the walls', () => {
        const bedroom: RoomFloor = { key: 'bed', purpose: 'bedroom', rect: { x: 0, y: 0, w: 5, h: 5 }, doors: [{ side: 'bottom', at: 2 }], outer: [] };
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
    });

    it('fills a storeroom’s walls with storage', () => {
        const store: RoomFloor = { key: 'store', purpose: 'storage', rect: { x: 0, y: 0, w: 5, h: 5 }, doors: [{ side: 'left', at: 2 }], outer: [] };
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
            const room: RoomFloor = { key: purpose, purpose, rect: { x: 0, y: 0, w: 6, h: 6 }, doors: [{ side: 'top', at: 2 }], outer: ['bottom'] };
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
