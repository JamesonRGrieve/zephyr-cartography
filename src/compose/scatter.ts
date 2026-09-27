// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Poisson-disc scattering (Bridson's algorithm): points spread evenly but at
 * random, none closer than a minimum distance, the way trees stand in a
 * wood rather than on a grid or in heaps. Pure and unit-tested.
 */
import type { Rect } from '../generate/floor-plan';
import type { Random } from '../generate/random';
import type { Point } from '../geometry/spline';

/** Candidates tried round each point before it is retired (Bridson's k). */
const CANDIDATES = 30;

/**
 * Points within `bounds`, at least `spacing` apart, that `accept` keeps. The
 * spread is seeded from where `accept` first holds, so an irregular area is
 * filled through its narrow parts too.
 */
export function poissonDisc(bounds: Rect, spacing: number, accept: (p: Point) => boolean, random: Random): Point[] {
    const cell = spacing / Math.SQRT2;
    const cols = Math.max(1, Math.ceil(bounds.w / cell));
    const rows = Math.max(1, Math.ceil(bounds.h / cell));
    const grid: (Point | undefined)[] = new Array<Point | undefined>(cols * rows).fill(undefined);
    const points: Point[] = [];
    const active: Point[] = [];
    const cellOf = (p: Point): [number, number] => [Math.floor((p.x - bounds.x) / cell), Math.floor((p.y - bounds.y) / cell)];
    const fits = (p: Point): boolean => {
        if (p.x < bounds.x || p.y < bounds.y || p.x >= bounds.x + bounds.w || p.y >= bounds.y + bounds.h || !accept(p)) {
            return false;
        }
        const [cx, cy] = cellOf(p);
        for (let y = Math.max(0, cy - 2); y <= Math.min(rows - 1, cy + 2); y++) {
            for (let x = Math.max(0, cx - 2); x <= Math.min(cols - 1, cx + 2); x++) {
                const other = grid[y * cols + x];
                if (other && Math.hypot(other.x - p.x, other.y - p.y) < spacing) {
                    return false;
                }
            }
        }
        return true;
    };
    const add = (p: Point): void => {
        const [cx, cy] = cellOf(p);
        grid[cy * cols + cx] = p;
        points.push(p);
        active.push(p);
    };
    // Spread from the newest point until none has room round it.
    const grow = (): void => {
        for (let from = active.pop(); from !== undefined; from = active.pop()) {
            for (let k = 0; k < CANDIDATES; k++) {
                const angle = random() * 2 * Math.PI;
                const r = spacing * (1 + random());
                const p = { x: from.x + Math.cos(angle) * r, y: from.y + Math.sin(angle) * r };
                if (fits(p)) {
                    add(p);
                    // It stays active, to be tried again after the point it spread to.
                    active.splice(-1, 0, from);
                    break;
                }
            }
        }
    };
    // Probe the bounds for places to start, and spread from each: an area cut in two (a wood across a road) fills on both sides.
    for (let probe = 0; probe < cols * rows; probe++) {
        const p = { x: bounds.x + random() * bounds.w, y: bounds.y + random() * bounds.h };
        if (fits(p)) {
            add(p);
            grow();
        }
    }
    return points;
}
