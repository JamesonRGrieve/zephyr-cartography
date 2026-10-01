// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { catmullRom, distance, offsetRibbon, pathLength, roundCorners, simplify, type Point } from './spline';

describe('distance', () => {
    it('computes euclidean distance', () => {
        expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    });
});

describe('pathLength', () => {
    it('sums segment lengths', () => {
        const pts: Point[] = [
            { x: 0, y: 0 },
            { x: 3, y: 4 },
            { x: 3, y: 10 },
        ];
        expect(pathLength(pts)).toBe(11);
    });

    it('is zero for a single point', () => {
        expect(pathLength([{ x: 1, y: 1 }])).toBe(0);
    });
});

describe('simplify', () => {
    it('returns a copy for short inputs', () => {
        const pts: Point[] = [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
        ];
        expect(simplify(pts, 0.1)).toEqual(pts);
    });

    it('drops a near-collinear midpoint under epsilon', () => {
        const pts: Point[] = [
            { x: 0, y: 0 },
            { x: 5, y: 0.01 },
            { x: 10, y: 0 },
        ];
        expect(simplify(pts, 0.1)).toEqual([
            { x: 0, y: 0 },
            { x: 10, y: 0 },
        ]);
    });

    it('keeps a midpoint that deviates beyond epsilon', () => {
        const pts: Point[] = [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
            { x: 10, y: 0 },
        ];
        expect(simplify(pts, 0.1)).toHaveLength(3);
    });
});

describe('catmullRom', () => {
    it('passes through the first and last control points', () => {
        const pts: Point[] = [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
            { x: 20, y: 0 },
        ];
        const curve = catmullRom(pts, 8);
        expect(curve[0]).toEqual({ x: 0, y: 0 });
        expect(curve.at(-1)).toEqual({ x: 20, y: 0 });
        expect(curve.length).toBeGreaterThan(pts.length);
    });

    it('returns a copy for fewer than two points', () => {
        expect(catmullRom([{ x: 1, y: 1 }], 8)).toEqual([{ x: 1, y: 1 }]);
    });
});

describe('offsetRibbon', () => {
    it('offsets a horizontal centerline symmetrically', () => {
        const centerline: Point[] = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
        ];
        const { left, right } = offsetRibbon(centerline, 2);
        expect(left).toEqual([
            { x: 0, y: 2 },
            { x: 10, y: 2 },
        ]);
        expect(right).toEqual([
            { x: 0, y: -2 },
            { x: 10, y: -2 },
        ]);
    });

    it('yields empty rails for degenerate input', () => {
        expect(offsetRibbon([{ x: 0, y: 0 }], 2)).toEqual({ left: [], right: [] });
    });
});

describe('roundCorners', () => {
    const square: Point[] = [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
    ];

    it('cuts each corner, a quarter and three quarters along every edge, doubling the points each round', () => {
        const once = roundCorners(square, 1);
        expect(once).toHaveLength(8);
        expect(once.slice(0, 2)).toEqual([
            { x: 1, y: 0 },
            { x: 3, y: 0 },
        ]);
        expect(roundCorners(square, 2)).toHaveLength(16);
    });

    it('stays within the outline it rounds, never overshooting a corner', () => {
        for (const p of roundCorners(square, 3)) {
            expect(p.x >= 0 && p.x <= 4 && p.y >= 0 && p.y <= 4).toBe(true);
        }
    });

    it('leaves fewer than three points, and no rounds, as they are', () => {
        expect(roundCorners(square.slice(0, 2), 2)).toEqual(square.slice(0, 2));
        expect(roundCorners(square, 0)).toEqual(square);
    });
});
