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

/** Samples per square the woods are traced at. */
const CELLS = 4;
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
 * `mask` shrunk by `by` cells on every side: each pass drops a cell with any of its four neighbours outside. Past the
 * map's edge the wood runs on as it meets it, so a wood cut by the edge keeps its inner ring off that edge.
 */
function eroded(mask: Uint8Array, cols: number, rows: number, by: number): Uint8Array {
    let current = mask;
    for (let pass = 0; pass < by; pass++) {
        const was = current;
        const cell = (x: number, y: number): number => was[Math.min(rows - 1, Math.max(0, y)) * cols + Math.min(cols - 1, Math.max(0, x))] ?? 0;
        const next = new Uint8Array(was.length);
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                next[y * cols + x] = cell(x, y) && cell(x - 1, y) && cell(x + 1, y) && cell(x, y - 1) && cell(x, y + 1) ? 1 : 0;
            }
        }
        current = next;
    }
    return current;
}

/** A closed loop as the runs of it off the map's edge: a wood cut by the edge is walled where it meets open ground only. */
function runsOffEdge(loop: readonly Point[], width: number, height: number): Point[][] {
    const along = (a: Point, b: Point): boolean =>
        (a.x <= ON_EDGE && b.x <= ON_EDGE) ||
        (a.y <= ON_EDGE && b.y <= ON_EDGE) ||
        (a.x >= width - ON_EDGE && b.x >= width - ON_EDGE) ||
        (a.y >= height - ON_EDGE && b.y >= height - ON_EDGE);
    const n = loop.length;
    // Start the walk just after a segment on the edge, so no run is split where the loop closes.
    const start = loop.findIndex((p, i) => along(p, loop[(i + 1) % n] ?? p));
    const order = start < 0 ? [...loop, loop[0] ?? { x: 0, y: 0 }] : [...loop.slice(start + 1), ...loop.slice(0, start + 2)];
    const runs: Point[][] = [];
    let run: Point[] = [];
    for (let i = 0; i + 1 < order.length; i++) {
        const a = order[i];
        const b = order[i + 1];
        if (a === undefined || b === undefined) {
            continue;
        }
        if (along(a, b)) {
            if (run.length >= 2) {
                runs.push(run);
            }
            run = [];
            continue;
        }
        if (run.length === 0) {
            run.push(a);
        }
        run.push(b);
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
