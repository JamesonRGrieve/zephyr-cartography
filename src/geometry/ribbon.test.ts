// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { brushOutline, buildRibbon } from './ribbon';
import { catmullRom, type Point } from './spline';

describe('buildRibbon', () => {
    it('is empty for fewer than two points', () => {
        expect(buildRibbon([{ x: 0, y: 0 }], [10], 4)).toEqual({ positions: [], uvs: [], indices: [], rails: [] });
    });

    it('produces symmetric left/right rails for a straight horizontal line', () => {
        const line: Point[] = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
        ];
        const g = buildRibbon(line, [2, 2], 1);
        // vertex 0 = left rail (y = +2), vertex 1 = right rail (y = -2)
        expect(g.positions[1]).toBeCloseTo(2);
        expect(g.positions[3]).toBeCloseTo(-2);
        // uv v alternates 0 (left) / 1 (right)
        expect(g.uvs[1]).toBe(0);
        expect(g.uvs[3]).toBe(1);
    });

    it('never folds its inner rail back on a bend tighter than it is wide, so the bank keeps no notch', () => {
        // A hairpin a quarter as tight as the ribbon is wide.
        const hairpin: Point[] = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 11, y: 1 },
            { x: 10, y: 2 },
            { x: 0, y: 2 },
        ];
        const g = buildRibbon(hairpin, [4, 4, 4, 4, 4], 8);
        // The path's way at each sample: the smoothed spine's next point less its previous one.
        const spine = catmullRom(hairpin, 8);
        // Each rail point is where the last stood, or on along the path: never back against it.
        const backwards = (['left', 'right'] as const).flatMap((side) =>
            g.rails.flatMap((rail, j) => {
                const before = g.rails[j - 1]?.[side];
                const ahead = spine[j + 1] ?? spine[j];
                const behind = spine[j - 1];
                if (!before || !ahead || !behind) {
                    return [];
                }
                const step = (rail[side].x - before.x) * (ahead.x - behind.x) + (rail[side].y - before.y) * (ahead.y - behind.y);
                return step < -1e-9 ? [`${side} ${String(j)}`] : [];
            }),
        );
        expect(backwards).toEqual([]);
    });

    it('lays banks wider on the outside of a bend than its inside, and wavering, never parallel, along a straight reach', () => {
        const banks = { width: (): number => 10 };
        // A quarter turn toward the left rail (+y on screen, the left normal of a run along +x): its outside is the right.
        const bend = Array.from({ length: 13 }, (_, i) => ({ x: 100 * Math.sin((i / 12) * (Math.PI / 2)), y: 100 - 100 * Math.cos((i / 12) * (Math.PI / 2)) }));
        const g = buildRibbon(
            bend,
            bend.map(() => 20),
            4,
            banks,
        );
        const spine = catmullRom(bend, 4);
        const middle = Math.floor(g.rails.length / 2);
        const rail = g.rails[middle];
        const centre = spine[middle];
        if (!rail || !centre) {
            throw new Error('no middle sample');
        }
        const left = Math.hypot(rail.left.x - centre.x, rail.left.y - centre.y) - 20;
        const right = Math.hypot(rail.right.x - centre.x, rail.right.y - centre.y) - 20;
        expect(right).toBeGreaterThan(left * 1.5);
        // Down a straight reach the banks keep about their width, but waver: no two samples alike.
        const reach = buildRibbon(
            [
                { x: 0, y: 0 },
                { x: 400, y: 0 },
            ],
            [20, 20],
            40,
            banks,
        );
        const widths = reach.rails.map((r) => r.left.y - 20);
        expect(Math.min(...widths)).toBeGreaterThan(10 * 0.6);
        expect(Math.max(...widths)).toBeLessThan(10 * 1.4);
        expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(1);
    });

    it('emits six indices per quad', () => {
        const g = buildRibbon(
            [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 20, y: 0 },
            ],
            [2, 2, 2],
            2,
        );
        const pairs = g.positions.length / 4;
        expect(g.indices.length).toBe((pairs - 1) * 6);
    });

    it('ends square across the path at full width, a river as a road', () => {
        const line: Point[] = [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 100, y: 0 },
        ];
        const g = buildRibbon(line, [10, 10, 10], 8);
        const pairs = g.positions.length / 4;
        expect([g.positions[0], g.positions[1], g.positions[2], g.positions[3]]).toEqual([0, 10, 0, -10]);
        const last = (pairs - 1) * 4;
        expect([g.positions[last], g.positions[last + 1], g.positions[last + 2], g.positions[last + 3]]).toEqual([100, 10, 100, -10]);
    });
});

describe('brushOutline', () => {
    const line: Point[] = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
    ];
    const pointsOf = (outline: readonly number[]): Point[] =>
        Array.from({ length: outline.length / 2 }, (_, i) => ({ x: outline[i * 2] ?? 0, y: outline[i * 2 + 1] ?? 0 }));

    it('is what a round brush leaves: rounded past both ends by its radius, never wider than it', () => {
        const points = pointsOf(brushOutline(line, 10, 4));
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        expect(Math.min(...xs)).toBeCloseTo(-10);
        expect(Math.max(...xs)).toBeCloseTo(110);
        expect(Math.max(...ys.map(Math.abs))).toBeCloseTo(10);
        // Every cap point lies on its end's circle.
        const caps = points.filter((p) => p.x < 0 || p.x > 100);
        expect(caps.length).toBeGreaterThan(0);
        for (const p of caps) {
            expect(Math.hypot(p.x - (p.x < 0 ? 0 : 100), p.y)).toBeCloseTo(10);
        }
    });

    it('rounds the far end from the left rail and the near end back to it, so the outline closes without crossing', () => {
        const points = pointsOf(brushOutline(line, 10, 4));
        // Left rail first (y = +10, going right), the far cap, the right rail back (y = −10), the near cap.
        expect(points[0]).toEqual({ x: 0, y: 10 });
        const tip = points.findIndex((p) => p.x > 109);
        const back = points.findIndex((p) => p.x < -9);
        expect(tip).toBeGreaterThan(0);
        expect(back).toBeGreaterThan(tip);
    });

    it('leaves a round dab where the brush was pressed without moving', () => {
        const still: Point[] = [
            { x: 5, y: 5 },
            { x: 5, y: 5 },
        ];
        for (const stroke of [still, still.slice(0, 1)]) {
            const points = pointsOf(brushOutline(stroke, 10, 4));
            expect(points.length).toBeGreaterThan(8);
            for (const p of points) {
                expect(Math.hypot(p.x - 5, p.y - 5)).toBeCloseTo(10);
            }
            // Round the whole way: it reaches the radius on every side.
            expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(-5);
            expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(15);
        }
    });

    it('rounds no end that has no width', () => {
        // A brush of no size leaves only its centreline: no end cap reaches out.
        expect(pointsOf(brushOutline(line, 0, 4)).every((p) => p.y === 0 && p.x >= 0 && p.x <= 100)).toBe(true);
    });

    it('leaves nothing for no points', () => {
        expect(brushOutline([], 10, 4)).toEqual([]);
    });
});
