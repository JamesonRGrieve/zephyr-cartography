// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { polygonArea } from '../geometry/trace';
import { DEFAULT_FLOOR_PLAN, generateFloorPlan, roomSpec, type FloorPlanOptions } from './floor-plan';
import { parseSceneSpec, type RoomSpec } from './spec';

function rooms(o: FloorPlanOptions): RoomSpec[] {
    return generateFloorPlan(o).features.filter((f): f is RoomSpec => f.type === 'room');
}

function bounds(room: RoomSpec): { x0: number; y0: number; x1: number; y1: number } {
    const xs = room.points.map((p) => p.x);
    const ys = room.points.map((p) => p.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const SEEDS = [1, 2, 3, 17, 99, 2024];

describe('generateFloorPlan', () => {
    it('is repeatable for a seed, and varies between seeds', () => {
        expect(generateFloorPlan(DEFAULT_FLOOR_PLAN)).toEqual(generateFloorPlan(DEFAULT_FLOOR_PLAN));
        expect(generateFloorPlan({ ...DEFAULT_FLOOR_PLAN, seed: 2 })).not.toEqual(generateFloorPlan(DEFAULT_FLOOR_PLAN));
    });

    it('emits a valid scene spec in grid units', () => {
        const spec = generateFloorPlan(DEFAULT_FLOOR_PLAN);
        expect(spec.units).toBe('grid');
        expect(parseSceneSpec(spec).ok).toBe(true);
    });

    it('tiles the footprint exactly with rectangular rooms no narrower than the minimum', () => {
        for (const seed of SEEDS) {
            const o = { ...DEFAULT_FLOOR_PLAN, seed };
            const all = rooms(o);
            const area = all.reduce((sum, r) => sum + Math.abs(polygonArea(r.points)), 0);
            expect(area).toBe(o.width * o.height);
            for (const room of all) {
                const b = bounds(room);
                expect(Math.abs(polygonArea(room.points))).toBe((b.x1 - b.x0) * (b.y1 - b.y0));
                expect(b.x1 - b.x0).toBeGreaterThanOrEqual(o.minRoom);
                expect(b.y1 - b.y0).toBeGreaterThanOrEqual(o.minRoom);
                expect(b.x0).toBeGreaterThanOrEqual(0);
                expect(b.y1).toBeLessThanOrEqual(o.height);
            }
        }
    });

    it('puts one door a square wide across every split, plus the entrance', () => {
        for (const seed of SEEDS) {
            const all = rooms({ ...DEFAULT_FLOOR_PLAN, seed });
            const doors = all.flatMap((room) =>
                room.doors.map((d) => {
                    const a = room.points[d.segment];
                    const b = room.points[(d.segment + 1) % room.points.length];
                    return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
                }),
            );
            // A binary partition into n rooms has n - 1 splits.
            expect(doors).toHaveLength(all.length);
            expect(doors.every((len) => len === 1)).toBe(true);
        }
    });

    it('connects every room', () => {
        for (const seed of SEEDS) {
            const all = rooms({ ...DEFAULT_FLOOR_PLAN, seed, entrance: false });
            // Rooms are joined when one's door square lies on the other's boundary.
            const onBoundary = (room: RoomSpec, p: { x: number; y: number }): boolean => {
                const b = bounds(room);
                const inX = p.x >= b.x0 && p.x <= b.x1;
                const inY = p.y >= b.y0 && p.y <= b.y1;
                return (inX && (p.y === b.y0 || p.y === b.y1)) || (inY && (p.x === b.x0 || p.x === b.x1));
            };
            const edges = all.flatMap((room, i) =>
                room.doors.flatMap((d) => {
                    const a = room.points[d.segment];
                    const b = room.points[(d.segment + 1) % room.points.length];
                    const mid = a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
                    return mid ? all.flatMap((other, j) => (j !== i && onBoundary(other, mid) ? [[i, j] as const] : [])) : [];
                }),
            );
            const reached = new Set([0]);
            let grew = true;
            while (grew) {
                grew = false;
                for (const [a, b] of edges) {
                    if (reached.has(a) !== reached.has(b)) {
                        reached.add(a);
                        reached.add(b);
                        grew = true;
                    }
                }
            }
            expect(reached.size).toBe(all.length);
        }
    });

    it('splits oversize footprints and carries the materials onto every room', () => {
        const all = rooms({ ...DEFAULT_FLOOR_PLAN, width: 40, height: 30, maxRoom: 10, floor: 'floor.oak', wall: 'wall.brick' });
        for (const room of all) {
            const b = bounds(room);
            expect(Math.min(b.x1 - b.x0, b.y1 - b.y0)).toBeLessThanOrEqual(10);
            expect(room.floor).toBe('floor.oak');
            expect(room.wall).toBe('wall.brick');
        }
    });

    it('keeps a footprint too small to split as a single room with just its entrance', () => {
        const all = rooms({ ...DEFAULT_FLOOR_PLAN, width: 4, height: 4, minRoom: 3 });
        expect(all).toHaveLength(1);
        expect(all[0]?.doors).toHaveLength(1);
        expect(rooms({ ...DEFAULT_FLOOR_PLAN, width: 4, height: 4, minRoom: 3, entrance: false })[0]?.doors).toEqual([]);
    });
});

describe('roomSpec', () => {
    const build = { floor: 'dirt', wall: null, wallKind: 'solid', ceiling: true } as const;

    it('puts a shut door, an open one, and an archway as an opening with no door, each on its own segment', () => {
        const spec = roomSpec(
            { x: 0, y: 0, w: 10, h: 6 },
            [
                { side: 'top', at: 2 },
                { side: 'bottom', at: 4, width: 2, open: true },
                { side: 'left', at: 1, width: 4, open: true, arch: true },
            ],
            build,
        );
        const bySegment = new Map(spec.doors.map((d) => [d.segment, d]));
        const at = (x: number, y: number): number => spec.points.findIndex((p) => p.x === x && p.y === y);
        expect(bySegment.get(at(2, 0))).toMatchObject({ type: 'door', state: 'closed' });
        // The bottom runs right to left, so its doorway is entered at its far end.
        expect(bySegment.get(at(6, 6))).toMatchObject({ type: 'door', state: 'open' });
        expect(bySegment.get(at(0, 5))).toMatchObject({ type: 'opening', state: 'open' });
        expect(spec.doors).toHaveLength(3);
    });
});
