// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import type { Point } from '../geometry/spline';
import { poissonDisc } from './scatter';

const BOUNDS = { x: 2, y: 3, w: 20, h: 12 };

const closest = (points: readonly Point[]): number => Math.min(...points.flatMap((a, i) => points.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y))));

describe('poissonDisc', () => {
    it('spreads points over the bounds, none closer than the spacing, the same way for a seed', () => {
        const points = poissonDisc(BOUNDS, 2, () => true, seededRandom(1));
        expect(closest(points)).toBeGreaterThanOrEqual(2);
        for (const p of points) {
            expect(p.x).toBeGreaterThanOrEqual(BOUNDS.x);
            expect(p.y).toBeGreaterThanOrEqual(BOUNDS.y);
            expect(p.x).toBeLessThan(BOUNDS.x + BOUNDS.w);
            expect(p.y).toBeLessThan(BOUNDS.y + BOUNDS.h);
        }
        // Close to the densest even spread: a 20 × 12 area at spacing 2 holds well over 30.
        expect(points.length).toBeGreaterThan(30);
        expect(poissonDisc(BOUNDS, 2, () => true, seededRandom(1))).toEqual(points);
    });

    it('keeps only what the area accepts, and fills both halves of an area cut in two', () => {
        // Two bands with a gap wider than the spacing between them.
        const inBands = (p: Point): boolean => p.y < 7 || p.y > 11;
        const points = poissonDisc(BOUNDS, 1.5, inBands, seededRandom(2));
        expect(points.every(inBands)).toBe(true);
        expect(points.some((p) => p.y < 7)).toBe(true);
        expect(points.some((p) => p.y > 11)).toBe(true);
    });

    it('gives nothing where nothing is accepted', () => {
        expect(poissonDisc(BOUNDS, 1, () => false, seededRandom(3))).toEqual([]);
    });
});
