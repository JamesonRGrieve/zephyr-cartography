// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Point } from './spline';
import { centroid, cutSegment, nearestSegment, perimeterSegments, segmentBand, splitSegment, wallRuns } from './wall';

describe('segmentBand', () => {
    it('builds a centred band extended past both ends', () => {
        expect(segmentBand({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, 4)).toEqual([-2, 2, 12, 2, 12, -2, -2, -2]);
    });

    it('is empty for a zero-length segment', () => {
        expect(segmentBand({ a: { x: 1, y: 1 }, b: { x: 1, y: 1 } }, 4)).toEqual([]);
    });
});

describe('wallRuns', () => {
    const square: Point[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
    ];
    const pairs = (outline: readonly number[]): [number, number][] =>
        outline.flatMap((v, i) => (i % 2 === 0 ? [[Math.round(v * 1000) / 1000, Math.round((outline[i + 1] ?? 0) * 1000) / 1000] as [number, number]] : []));

    it('draws a square room as four runs meeting on mitred corners, each turned to its wall', () => {
        const runs = wallRuns(square, new Set(), 2);
        expect(runs.map((r) => Math.round((r.angle * 180) / Math.PI))).toEqual([0, 90, 180, -90]);
        // The top wall: along its inner face (1,1) to (9,1), and back along its outer from corner (11,-1) to corner (-1,-1).
        expect(pairs(runs[0]?.outline ?? [])).toEqual([
            [1, 1],
            [9, 1],
            [11, -1],
            [-1, -1],
        ]);
    });

    it('bends one smooth band round a many-sided outline, its corners shared and never notched', () => {
        const ring: Point[] = Array.from({ length: 24 }, (_, k) => ({ x: 50 * Math.cos((k * Math.PI) / 12), y: 50 * Math.sin((k * Math.PI) / 12) }));
        const runs = wallRuns(ring, new Set(), 4);
        expect(runs).toHaveLength(1);
        // Round the ring and back: two rails of 25 points, each corner's pair 2 in and 2 out of the ring, square across it.
        const points = pairs(runs[0]?.outline ?? []);
        expect(points).toHaveLength(50);
        const radii = points.map(([x, y]) => Math.hypot(x, y));
        for (const r of radii) {
            expect(Math.min(Math.abs(r - 52), Math.abs(r - 48))).toBeLessThan(0.1);
        }
    });

    it('meets a cut corner on its mitre, so neither wall pokes past the other', () => {
        const chamfered: Point[] = [
            { x: 10, y: 0 },
            { x: 90, y: 0 },
            { x: 100, y: 10 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
            { x: 0, y: 10 },
        ];
        const runs = wallRuns(chamfered, new Set(), 4);
        expect(runs).toHaveLength(6);
        // The top wall's far end and the cut's near end are the same two points.
        const topWall = pairs(runs[0]?.outline ?? []);
        const cut = pairs(runs[1]?.outline ?? []);
        expect(new Set([topWall[1], topWall[2]].map(String))).toEqual(new Set([cut[0], cut[3]].map(String)));
    });

    it('bevels the outside of a corner too sharp to mitre, never spiking out past it', () => {
        // A narrow wedge: its tip turns about 157 degrees.
        const wedge: Point[] = [
            { x: 0, y: 0 },
            { x: 100, y: 20 },
            { x: 0, y: 40 },
        ];
        const runs = wallRuns(wedge, new Set(), 4);
        const all = runs.flatMap((r) => pairs(r.outline));
        // A mitre there would reach some 10 half-thicknesses past the tip; the bevel keeps within one of it.
        expect(Math.max(...all.map(([x]) => x))).toBeLessThanOrEqual(102.01);
        // The runs either side of the tip still meet: the wall after starts where the one before's bevel ends.
        const [upper, lower] = [pairs(runs[0]?.outline ?? []), pairs(runs[1]?.outline ?? [])];
        expect(lower.some(([x, y]) => upper.some(([tx, ty]) => Math.abs(tx - x) < 1e-6 && Math.abs(ty - y) < 1e-6))).toBe(true);
        // Wound the other way round, the tip turns the other way and is bevelled on the band's other side, as far.
        const reversed = wallRuns([...wedge].reverse(), new Set(), 4).flatMap((r) => pairs(r.outline));
        expect(Math.max(...reversed.map(([x]) => x))).toBeLessThanOrEqual(102.01);
    });

    it('passes over a doubled point, and a wall doubling straight back on itself, without breaking', () => {
        // A repeated corner is a wall of no length: the band runs on as if it were not there.
        const doubled = wallRuns([square[0] ?? { x: 0, y: 0 }, ...square], new Set(), 2);
        expect(doubled).toHaveLength(4);
        // A spur running out and straight back: still a closed band, every point a real number.
        const spur = wallRuns(
            [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 5, y: 0 },
            ],
            new Set(),
            2,
        );
        expect(spur.flatMap((r) => r.outline).every(Number.isFinite)).toBe(true);
    });

    it('breaks the band at a doorway, squaring each jamb off half the band past it', () => {
        const runs = wallRuns(square, new Set([0]), 2);
        expect(runs).toHaveLength(3);
        // The right wall starts at the doorway's jamb, a square end reaching a half band up past the corner.
        expect(pairs(runs[0]?.outline ?? [])).toContainEqual([11, -1]);
        expect(pairs(runs[2]?.outline ?? [])).toContainEqual([-1, -1]);
    });

    it('draws nothing for an outline that is all doorway, or no outline', () => {
        expect(wallRuns(square, new Set([0, 1, 2, 3]), 2)).toEqual([]);
        expect(wallRuns([], new Set(), 2)).toEqual([]);
    });
});

describe('splitSegment', () => {
    it('splits into covered and uncovered stretches in order, merging overlaps', () => {
        const seg = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
        const pieces = splitSegment(
            seg,
            [
                { a: { x: 20, y: 0 }, b: { x: 40, y: 0 } },
                { a: { x: 30, y: 0 }, b: { x: 50, y: 0 } },
            ],
            1,
        );
        expect(pieces.map((p) => [p.a.x, p.b.x, p.covered])).toEqual([
            [0, 20, false],
            [20, 50, true],
            [50, 100, false],
        ]);
    });

    it('covers the whole segment when an overlay spans it', () => {
        const seg = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
        expect(splitSegment(seg, [{ a: { x: -1, y: 0 }, b: { x: 20, y: 0 } }], 1)).toEqual([{ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, covered: true }]);
    });
});

describe('cutSegment', () => {
    const seg = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };

    it('leaves the segment whole with no collinear cuts', () => {
        expect(cutSegment(seg, [], 2)).toEqual([seg]);
        expect(cutSegment(seg, [{ a: { x: 40, y: -20 }, b: { x: 60, y: 20 } }], 2)).toEqual([seg]);
    });

    it('opens a gap where a collinear cut lies, in either direction and within tolerance', () => {
        expect(cutSegment(seg, [{ a: { x: 60, y: 1 }, b: { x: 40, y: -1 } }], 2)).toEqual([
            { a: { x: 0, y: 0 }, b: { x: 40, y: 0 } },
            { a: { x: 60, y: 0 }, b: { x: 100, y: 0 } },
        ]);
    });

    it('merges overlapping cuts and clips cuts past the ends', () => {
        const cuts = [
            { a: { x: 10, y: 0 }, b: { x: 30, y: 0 } },
            { a: { x: 20, y: 0 }, b: { x: 40, y: 0 } },
            { a: { x: 90, y: 0 }, b: { x: 150, y: 0 } },
        ];
        expect(cutSegment(seg, cuts, 1)).toEqual([
            { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
            { a: { x: 40, y: 0 }, b: { x: 90, y: 0 } },
        ]);
    });

    it('removes a segment covered entirely, and ignores a degenerate target', () => {
        expect(cutSegment(seg, [{ a: { x: -5, y: 0 }, b: { x: 105, y: 0 } }], 1)).toEqual([]);
        const point = { a: { x: 5, y: 5 }, b: { x: 5, y: 5 } };
        expect(cutSegment(point, [{ a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }], 1)).toEqual([point]);
    });
});

describe('perimeterSegments', () => {
    it('produces one segment per edge of a closed polygon, including the closing edge', () => {
        const square: Point[] = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
        ];
        const segs = perimeterSegments(square);
        expect(segs).toHaveLength(4);
        expect(segs[0]).toEqual({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
        // closing edge: last vertex back to the first
        expect(segs[3]).toEqual({ a: { x: 0, y: 10 }, b: { x: 0, y: 0 } });
    });

    it('is empty for degenerate input', () => {
        expect(perimeterSegments([])).toEqual([]);
        expect(perimeterSegments([{ x: 1, y: 1 }])).toEqual([]);
    });
});

describe('nearestSegment', () => {
    const square: Point[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
    ];

    it('finds the closest perimeter edge to a point', () => {
        // Just inside the top edge (segment 0: (0,0)→(10,0)).
        expect(nearestSegment({ x: 5, y: 1 }, square).index).toBe(0);
        // Near the right edge (segment 1: (10,0)→(10,10)).
        expect(nearestSegment({ x: 9, y: 5 }, square).index).toBe(1);
    });

    it('returns index −1 for no segments', () => {
        expect(nearestSegment({ x: 0, y: 0 }, [])).toEqual({ index: -1, distance: Number.POSITIVE_INFINITY });
    });
});

describe('centroid', () => {
    it('averages the vertices', () => {
        expect(
            centroid([
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 },
            ]),
        ).toEqual({ x: 5, y: 5 });
    });

    it('is the origin for no points', () => {
        expect(centroid([])).toEqual({ x: 0, y: 0 });
    });
});
