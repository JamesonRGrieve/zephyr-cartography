// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Keyholes: an outline with holes as one simple polygon, each hole joined to
 * the outline by a bridge of two coincident edges, so a fill leaves the holes
 * empty (rock left standing in a cave, the island a moat runs round). Pure.
 */
import type { Point } from './spline';

/** Two points' key, the same whichever way a segment runs between them. */
const segmentKey = (a: Point, b: Point): string => [`${a.x},${a.y}`, `${b.x},${b.y}`].sort().join('|');

/**
 * `outline` with each of `holes` cut out: from the outline's point nearest a
 * hole across to it, round the hole, and back. Holes must wind the other way
 * from the outline. With the indices of the bridges' edges, which are no
 * boundary at all.
 */
export function keyhole(outline: readonly Point[], holes: readonly (readonly Point[])[]): { points: Point[]; bridges: number[] } {
    let points = [...outline];
    const joins = new Set<string>();
    for (const hole of holes) {
        let best = { i: 0, j: 0, d: Number.POSITIVE_INFINITY };
        points.forEach((p, onOutline) => {
            hole.forEach((q, onHole) => {
                const d = Math.hypot(p.x - q.x, p.y - q.y);
                if (d < best.d) {
                    best = { i: onOutline, j: onHole, d };
                }
            });
        });
        const { i, j } = best;
        const from = points[i];
        const to = hole[j];
        if (from === undefined || to === undefined) {
            continue;
        }
        const round = [...hole.slice(j), ...hole.slice(0, j), to];
        points = [...points.slice(0, i + 1), ...round, from, ...points.slice(i + 1)];
        joins.add(segmentKey(from, to));
    }
    const bridges = points.flatMap((p, i) => {
        const q = points[(i + 1) % points.length];
        return q !== undefined && joins.has(segmentKey(p, q)) ? [i] : [];
    });
    return { points, bridges };
}
