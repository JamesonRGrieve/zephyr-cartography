// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Rect } from '../generate/floor-plan';
import { distanceToPolyline } from '../geometry/hit';
import type { Point } from '../geometry/spline';
import { detour, grown } from './detour';

const block: Rect = { x: 10, y: 10, w: 6, h: 4 };

/** Points every tenth of a square along `line`. */
function along(line: readonly Point[]): Point[] {
    return line.slice(1).flatMap((b, i) => {
        const a = line[i] ?? b;
        return Array.from({ length: 10 }, (_, k) => ({ x: a.x + ((b.x - a.x) * k) / 10, y: a.y + ((b.y - a.y) * k) / 10 }));
    });
}

const strictlyInside = (p: Point, r: Rect): boolean => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

describe('detour', () => {
    it('grows a rect on every side', () => {
        expect(grown(block, 1)).toEqual({ x: 9, y: 9, w: 8, h: 6 });
    });

    it('leaves a line that misses every block as it was', () => {
        const line = [
            { x: 0, y: 0 },
            { x: 30, y: 0 },
        ];
        expect(detour(line, [block])).toEqual(line);
    });

    it('takes a line crossing a block round it, never inside, keeping both ends', () => {
        const line = [
            { x: 13, y: 0 },
            { x: 12.5, y: 30 },
        ];
        const routed = detour(line, [block]);
        expect(routed[0]).toEqual(line[0]);
        expect(routed.at(-1)).toEqual(line[1]);
        expect(along(routed).some((p) => strictlyInside(p, block))).toBe(false);
    });

    it('goes the shorter way round: past the near corners, not the far ones', () => {
        // Crossing close to the left side, it goes round the left.
        const routed = detour(
            [
                { x: 11, y: 0 },
                { x: 11, y: 30 },
            ],
            [block],
        );
        expect(routed).toContainEqual({ x: 10, y: 10 });
        expect(routed).toContainEqual({ x: 10, y: 14 });
        expect(routed.some((p) => p.x === 16)).toBe(false);
    });

    it('goes round a corner it only clips', () => {
        const routed = detour(
            [
                // Crossing the top-left corner by half a square.
                { x: 8, y: 12.5 },
                { x: 12.5, y: 8 },
            ],
            [block],
        );
        expect(routed).toContainEqual({ x: 10, y: 10 });
        expect(along(routed).some((p) => strictlyInside(p, block))).toBe(false);
    });

    it('goes round every block in its way, keeping its own points outside them', () => {
        const other: Rect = { x: 10, y: 20, w: 6, h: 4 };
        const line = [
            { x: 13, y: 0 },
            { x: 13, y: 17 },
            { x: 13, y: 30 },
        ];
        const routed = detour(line, [block, other]);
        expect(along(routed).some((p) => strictlyInside(p, block) || strictlyInside(p, other))).toBe(false);
        expect(routed).toContainEqual({ x: 13, y: 17 });
    });

    it('leaves a block alone that holds an end of the line', () => {
        const line = [
            { x: 13, y: 12 },
            { x: 13, y: 30 },
        ];
        expect(detour(line, [block])).toEqual(line);
    });

    it('stays near the line it replaces', () => {
        const line = [
            { x: 13, y: 0 },
            { x: 13, y: 30 },
        ];
        const routed = detour(line, [block]);
        expect(routed.every((p) => distanceToPolyline(p, line) <= block.w / 2)).toBe(true);
    });
});
