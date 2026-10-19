// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
    autoHandle,
    bezierSpline,
    catmullRom,
    cubicAt,
    distance,
    nearestOnSpline,
    offsetRibbon,
    outHandle,
    pathLength,
    roundCorners,
    simplify,
    spanControls,
    type Point,
} from './spline';

describe('Bezier handles', () => {
    const bend: Point[] = [
        { x: 0, y: 0 },
        { x: 60, y: 30 },
        { x: 120, y: -10 },
        { x: 200, y: 40 },
    ];

    it('takes an auto handle a sixth of the way between an anchor’s neighbours, an end its own place', () => {
        expect(autoHandle(bend, 1)).toEqual({ x: 20, y: -10 / 6 });
        expect(autoHandle(bend, 0)).toEqual({ x: 10, y: 5 });
        expect(autoHandle(bend, 9)).toEqual({ x: 0, y: 0 });
        expect(outHandle(bend, [null, { x: 3, y: 4 }], 1)).toEqual({ x: 3, y: 4 });
    });

    it('is exactly the Catmull-Rom spline with every handle auto, or none given', () => {
        expect(bezierSpline(bend, [null, null, null, null], 12)).toEqual(catmullRom(bend, 12));
        expect(bezierSpline(bend, [], 12)).toEqual(catmullRom(bend, 12));
    });

    it('matches Catmull-Rom with auto handles spelled out, so the two forms are one curve', () => {
        const spelled = bend.map((_, i) => autoHandle(bend, i));
        const a = bezierSpline(bend, spelled, 10);
        const b = catmullRom(bend, 10);
        expect(a).toHaveLength(b.length);
        a.forEach((p, i) => {
            expect(p.x).toBeCloseTo(b[i]?.x ?? Number.NaN, 9);
            expect(p.y).toBeCloseTo(b[i]?.y ?? Number.NaN, 9);
        });
    });

    it('runs straight through corners and bows toward a pulled-out handle', () => {
        const line: Point[] = [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
        ];
        const straight = bezierSpline(
            line,
            [
                { x: 0, y: 0 },
                { x: 0, y: 0 },
            ],
            4,
        );
        expect(straight.every((p) => p.y === 0)).toBe(true);
        const bowed = bezierSpline(
            line,
            [
                { x: 0, y: 60 },
                { x: 0, y: -60 },
            ],
            4,
        );
        expect(bowed[0]).toEqual({ x: 0, y: 0 });
        expect(bowed.at(-1)).toEqual({ x: 100, y: 0 });
        // Both handles pulled the same way: an arch, three quarters as high as they reach at its middle.
        expect(bowed[2]?.y).toBeCloseTo(45, 9);
        const wave = bezierSpline(
            line,
            [
                { x: 0, y: 60 },
                { x: 0, y: 60 },
            ],
            4,
        );
        // Pulled opposite ways: an S, through the middle of the line.
        expect(wave[2]?.y).toBeCloseTo(0, 9);
        expect(wave[1]?.y ?? 0).toBeGreaterThan(10);
        expect(wave[3]?.y ?? 0).toBeLessThan(-10);
    });

    it('gives a span’s controls absolute, the next anchor’s mirrored, and none past the end', () => {
        expect(
            spanControls(
                bend,
                [
                    { x: 5, y: 0 },
                    { x: 0, y: 7 },
                ],
                0,
            ),
        ).toEqual([
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 60, y: 23 },
            { x: 60, y: 30 },
        ]);
        expect(spanControls(bend, [], 3)).toBeNull();
        expect(cubicAt({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, 0.5)).toEqual({ x: 5, y: 0 });
    });

    it('copies a degenerate input', () => {
        expect(bezierSpline([{ x: 1, y: 1 }], [{ x: 1, y: 0 }], 4)).toEqual([{ x: 1, y: 1 }]);
        expect(bezierSpline(bend, [{ x: 1, y: 0 }], 0)).toEqual(bend);
    });
});

describe('nearestOnSpline', () => {
    const line: Point[] = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
        { x: 300, y: 0 },
    ];

    it('finds the span, how far along it, and how far off the path a point lies', () => {
        const spot = nearestOnSpline(line, [], { x: 150, y: 7 }, 10);
        expect(spot?.span).toBe(1);
        expect(spot?.t).toBeCloseTo(0.5, 6);
        expect(spot?.distance).toBeCloseTo(7, 6);
        expect(nearestOnSpline(line, [], { x: -50, y: 0 }, 10)?.t).toBe(0);
    });

    it('finds nothing on a path of one point', () => {
        expect(nearestOnSpline([{ x: 0, y: 0 }], [], { x: 1, y: 1 }, 10)).toBeNull();
    });
});

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
