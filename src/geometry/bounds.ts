// SPDX-License-Identifier: AGPL-3.0-or-later
/** Bounding boxes of point sets. Pure. */
import type { Point } from './spline';

/** An axis-aligned box: its top-left corner and size. */
export interface Bounds {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

/** The smallest box holding `points`. */
export function boundsOf(points: readonly Point[]): Bounds {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
