// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Shapes traced from a test of where they are: the test sampled on a fine
 * grid over a box, the edge traced by marching squares and simplified, each
 * outer outline with the holes inside it (a tunnel network and the rock it
 * loops round, a moat and the island it rings). Pure.
 */
import type { Bounds } from './bounds';
import { pointInPolygon } from './hit';
import { simplify, type Point } from './spline';
import { traceLoops } from './trace';

/** An outer outline and the holes inside it. */
export interface TracedShape {
    readonly outline: Point[];
    readonly holes: Point[][];
}

/** How finely a shape is sampled and traced. */
export interface TraceGrain {
    /** Samples per grid square. */
    readonly cellsPerSquare: number;
    /** Squares a simplified outline may stray from the traced edge. */
    readonly tolerance: number;
    /** Loops enclosing less than this many square squares are specks, dropped. */
    readonly minArea: number;
}

/** Twice the signed area of a closed loop (screen coordinates): positive where it runs clockwise as seen. */
export function signedArea(loop: readonly Point[]): number {
    return loop.reduce((sum, p, i) => {
        const q = loop[(i + 1) % loop.length] ?? p;
        return sum + p.x * q.y - q.x * p.y;
    }, 0);
}

/** The shapes where `inside` holds within `box`, each outline with the holes it holds. */
export function traceShapes(inside: (p: Point) => boolean, box: Bounds, grain: TraceGrain): TracedShape[] {
    const { cellsPerSquare, tolerance, minArea } = grain;
    const width = Math.ceil(box.w * cellsPerSquare);
    const height = Math.ceil(box.h * cellsPerSquare);
    const toSquares = (c: number, start: number): number => start + c / cellsPerSquare;
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            data[y * width + x] = inside({ x: toSquares(x + 0.5, box.x), y: toSquares(y + 0.5, box.y) }) ? 1 : 0;
        }
    }
    // The trace keeps what is inside on one side: outer outlines wind one way, the holes inside them the other.
    const loops = traceLoops({ width, height, data }).flatMap((loop) => {
        const winding = signedArea(loop);
        const points = loop.map((p) => ({ x: toSquares(p.x, box.x), y: toSquares(p.y, box.y) }));
        const first = points[0];
        const outline = first === undefined ? [] : simplify([...points, first], tolerance).slice(0, -1);
        return outline.length < 3 || Math.abs(signedArea(outline)) / 2 < minArea ? [] : [{ outline, outer: winding > 0 }];
    });
    const holes = loops.filter((l) => !l.outer).map((l) => l.outline);
    return loops
        .filter((l) => l.outer)
        .map(({ outline }) => {
            const flat = outline.flatMap((p) => [p.x, p.y]);
            return { outline, holes: holes.filter((hole) => hole[0] !== undefined && pointInPolygon(hole[0], flat)) };
        });
}
