// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A wood's edge as line of sight sees it (operator, 2026-11-18, in play: "They can see the whole fucking map. Trees are
 * blocking visibility"): a wood hides what is in it and beyond it, never each trunk on its own. The crowns laid out of
 * doors are joined into woods; round each wood large enough to be one (a lone tree or two hides nothing) run two rings of
 * walls that limit sight and light and bar nothing: one on the canopy's edge and one a little inside it. Foundry's
 * limited walls let sight through one and stop it at the second, so a token sees into the first trees, never through
 * the wood. Glades inside a wood are ringed the same way. Nothing runs along the map's own edge. Pure and unit-tested.
 */
import type { SceneSpecInput } from '../generate/spec';
import type { Point } from '../geometry/spline';
import { traceShapes } from '../geometry/trace-shape';

type FeatureInput = SceneSpecInput['features'][number];

/** A tree's crown, in squares: where it stands and how far it spreads. */
export interface Crown {
    readonly x: number;
    readonly y: number;
    readonly r: number;
}

/** Samples per square the woods are traced at: half a square, as fine as a wall a token walks up to needs. */
const CELLS = 2;
/** Squares crowns may stand apart and still be one wood: the gap between two neighbours' leaves. */
const JOIN = 0.35;
/** Squares inside the canopy's edge the second ring runs: how far into a wood a token sees. */
const INSET = 1.5;
/** Square squares a wood must cover to hide anything; a lone tree or a pair does not. */
const MIN_WOOD = 12;
/** Squares a traced edge may stray from the canopy, for walls a GM can still pick out. */
const TOLERANCE = 0.2;
/** Squares from the map's edge a wall's two ends must lie for it to run along that edge, and be left out. */
const ON_EDGE = 0.3;

/** The walls a wood's edge carries: sight and light limited (one is seen through, two are not), the way open, sound carrying. */
const FOLIAGE = { sight: 'limited', light: 'limited', movement: false } as const;

/** The two rings of walls round every wood the crowns make on a map `width` by `height` squares, as walled lines. */
export function woodEdges(crowns: readonly Crown[], width: number, height: number, level: { readonly level?: string }): FeatureInput[] {
    if (crowns.length === 0) {
        return [];
    }
    const cols = Math.ceil(width * CELLS);
    const rows = Math.ceil(height * CELLS);
    const wood = new Uint8Array(cols * rows);
    for (const c of crowns) {
        const reach = c.r + JOIN;
        for (let y = Math.max(0, Math.floor((c.y - reach) * CELLS)); y < Math.min(rows, Math.ceil((c.y + reach) * CELLS)); y++) {
            for (let x = Math.max(0, Math.floor((c.x - reach) * CELLS)); x < Math.min(cols, Math.ceil((c.x + reach) * CELLS)); x++) {
                if (Math.hypot((x + 0.5) / CELLS - c.x, (y + 0.5) / CELLS - c.y) <= reach) {
                    wood[y * cols + x] = 1;
                }
            }
        }
    }
    const inner = eroded(wood, cols, rows, Math.round(INSET * CELLS));
    const at =
        (mask: Uint8Array) =>
        (p: Point): boolean =>
            mask[Math.floor(p.y * CELLS) * cols + Math.floor(p.x * CELLS)] === 1;
    const box = { x: 0, y: 0, w: cols / CELLS, h: rows / CELLS };
    const woods = traceShapes(at(wood), box, { cellsPerSquare: CELLS, tolerance: TOLERANCE, minArea: MIN_WOOD });
    // The inner ring only inside the woods kept: an eroded lone tree is gone already, and a wood's glades keep theirs.
    const cores = traceShapes(at(inner), box, { cellsPerSquare: CELLS, tolerance: TOLERANCE, minArea: 1 });
    const loops = [...woods, ...cores].flatMap((shape) => [shape.outline, ...shape.holes]);
    return loops.flatMap((loop) => runsOffEdge(loop, width, height)).map((points) => edgeLine(points, level));
}

/**
 * `mask` shrunk by `by` cells on every side, as `by` passes of dropping each cell with one of its four neighbours outside
 * would leave it: the cells more than `by` steps (city-block) from any cell outside, found in two sweeps. Past the map's
 * edge the wood runs on as it meets it, so a wood cut by the edge keeps its inner ring off that edge.
 */
function eroded(mask: Uint8Array, cols: number, rows: number, by: number): Uint8Array {
    const far = cols + rows;
    // A view's reads are numbers, never missing: each cell's steps to the nearest cell outside, 4 bytes a cell.
    const steps = new DataView(new ArrayBuffer(mask.length * 4));
    const stepsAt = (i: number): number => steps.getInt32(i * 4);
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            steps.setInt32(i * 4, mask[i] === 1 ? Math.min(far, x > 0 ? stepsAt(i - 1) + 1 : far, y > 0 ? stepsAt(i - cols) + 1 : far) : 0);
        }
    }
    const inner = new Uint8Array(mask.length);
    for (let y = rows - 1; y >= 0; y--) {
        for (let x = cols - 1; x >= 0; x--) {
            const i = y * cols + x;
            const here = Math.min(stepsAt(i), x < cols - 1 ? stepsAt(i + 1) + 1 : far, y < rows - 1 ? stepsAt(i + cols) + 1 : far);
            steps.setInt32(i * 4, here);
            inner[i] = here > by ? 1 : 0;
        }
    }
    return inner;
}

/** A closed loop as the runs of it off the map's edge: a wood cut by the edge is walled where it meets open ground only. */
function runsOffEdge(loop: readonly Point[], width: number, height: number): Point[][] {
    const along = ([a, b]: readonly [Point, Point]): boolean =>
        (a.x <= ON_EDGE && b.x <= ON_EDGE) ||
        (a.y <= ON_EDGE && b.y <= ON_EDGE) ||
        (a.x >= width - ON_EDGE && b.x >= width - ON_EDGE) ||
        (a.y >= height - ON_EDGE && b.y >= height - ON_EDGE);
    // Its segments, closed back to its first point.
    const segments: [Point, Point][] = [];
    [...loop, ...loop.slice(0, 1)].reduce((a, b) => {
        segments.push([a, b]);
        return b;
    });
    // Walked from just after a segment on the edge, so no run is split where the loop closes.
    const first = segments.findIndex(along);
    const walk = first < 0 ? segments : [...segments.slice(first + 1), ...segments.slice(0, first + 1)];
    const runs: Point[][] = [];
    let run: Point[] = [];
    for (const segment of walk) {
        if (along(segment)) {
            if (run.length >= 2) {
                runs.push(run);
            }
            run = [];
            continue;
        }
        if (run.length === 0) {
            run.push(segment[0]);
        }
        run.push(segment[1]);
    }
    if (run.length >= 2) {
        runs.push(run);
    }
    return runs;
}

/** A run of a wood's edge as a walled line that draws nothing: its walls alone, hidden from players and GM alike. */
function edgeLine(points: readonly Point[], level: { readonly level?: string }): FeatureInput {
    return {
        type: 'shape',
        kind: 'line',
        points: points.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 })),
        stroke: { colour: '#000000', width: 0, alpha: 0 },
        fill: null,
        hidden: true,
        walls: FOLIAGE,
        ...level,
    };
}
