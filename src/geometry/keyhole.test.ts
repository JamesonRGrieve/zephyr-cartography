// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { pointInPolygon } from './hit';
import { keyhole } from './keyhole';

/** A square from (x, y), `size` across, clockwise as seen (screen coordinates), or the other way. */
const square = (x: number, y: number, size: number, clockwise: boolean): { x: number; y: number }[] => {
    const corners = [
        { x, y },
        { x: x + size, y },
        { x: x + size, y: y + size },
        { x, y: y + size },
    ];
    return clockwise ? corners : corners.reverse();
};

const flat = (points: readonly { x: number; y: number }[]): number[] => points.flatMap((p) => [p.x, p.y]);

describe('keyhole', () => {
    it('cuts a hole out of an outline as one polygon, bridged from the outline’s nearest point, so a fill leaves it empty', () => {
        const { points, bridges } = keyhole(square(0, 0, 10, true), [square(4, 4, 2, false)]);
        // The outline's four corners, the hole's four and its first again, and the way back.
        expect(points).toHaveLength(10);
        expect(pointInPolygon({ x: 5, y: 5 }, flat(points))).toBe(false);
        expect(pointInPolygon({ x: 1, y: 1 }, flat(points))).toBe(true);
        expect(pointInPolygon({ x: 8, y: 8 }, flat(points))).toBe(true);
        // The bridge there and back is two edges over the same two points: no boundary at all.
        expect(bridges).toHaveLength(2);
        const [a, b] = bridges.map((i) => [points[i], points[(i + 1) % points.length]]);
        expect(a).toEqual(b ? [...b].reverse() : undefined);
    });

    it('leaves an outline with no holes as it is', () => {
        expect(keyhole(square(0, 0, 10, true), [])).toEqual({ points: square(0, 0, 10, true), bridges: [] });
    });
});
