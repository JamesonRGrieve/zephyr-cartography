// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { pointInPolygon } from './hit';
import { signedArea, traceShapes } from './trace-shape';

const GRAIN = { cellsPerSquare: 2, tolerance: 0.25, minArea: 2 } as const;
const BOX = { x: 0, y: 0, w: 20, h: 20 };
const flat = (points: readonly { x: number; y: number }[]): number[] => points.flatMap((p) => [p.x, p.y]);

describe('signedArea', () => {
    it('is twice the area, positive for a loop running clockwise as seen (y down), negative the other way', () => {
        const clockwise = [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 2 },
            { x: 0, y: 2 },
        ];
        expect(signedArea(clockwise)).toBe(16);
        expect(signedArea([...clockwise].reverse())).toBe(-16);
    });
});

describe('traceShapes', () => {
    it('traces a ring as one outline holding its hole', () => {
        const ring = (p: { x: number; y: number }): boolean => {
            const d = Math.hypot(p.x - 10, p.y - 10);
            return d > 3 && d < 7;
        };
        const shapes = traceShapes(ring, BOX, GRAIN);
        expect(shapes).toHaveLength(1);
        const [shape] = shapes;
        expect(shape?.holes).toHaveLength(1);
        expect(pointInPolygon({ x: 10, y: 5 }, flat(shape?.outline ?? []))).toBe(true);
        expect(pointInPolygon({ x: 10, y: 10 }, flat(shape?.holes[0] ?? []))).toBe(true);
    });

    it('traces apart shapes apart, and drops a speck smaller than the least area', () => {
        const blobs = (p: { x: number; y: number }): boolean =>
            Math.hypot(p.x - 5, p.y - 5) < 3 || Math.hypot(p.x - 15, p.y - 15) < 3 || Math.hypot(p.x - 15, p.y - 3) < 0.6;
        const shapes = traceShapes(blobs, BOX, GRAIN);
        expect(shapes).toHaveLength(2);
        expect(shapes.every((s) => s.holes.length === 0)).toBe(true);
        expect(traceShapes(() => false, BOX, GRAIN)).toEqual([]);
    });
});
