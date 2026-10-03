// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Pure triangulation of a smoothed, variable-width ribbon from a path centerline.
 * Produces flat vertex / uv / index arrays a PIXI mesh uploads verbatim — the
 * "textured road/river" geometry, with per-control-point width and arc-length
 * U coordinates so a tiling texture flows along the path.
 */
import { catmullRom, type Point } from './spline';

/** Samples per Catmull-Rom span when smoothing a path (ribbon rendering and centerline walls). */
export const RIBBON_SAMPLES = 12;

export interface RibbonGeometry {
    /** Interleaved [x, y, …] — vertex 2j is the left rail, 2j+1 the right. */
    readonly positions: number[];
    /** Interleaved [u, v, …]; u = arc-length fraction, v ∈ {0 (left), 1 (right)}. */
    readonly uvs: number[];
    /** Triangle-list indices into the vertex array. */
    readonly indices: number[];
    /** Each sample's rail pair, as points, with its arc-length fraction. */
    readonly rails: readonly Rail[];
}

/** One sample across the ribbon: its left and right rail points, and how far along the path it lies (0–1). */
interface Rail {
    readonly left: Point;
    readonly right: Point;
    readonly u: number;
}

const EMPTY: RibbonGeometry = { positions: [], uvs: [], indices: [], rails: [] };

/** Points on each half-circle end cap of a round-brush outline. */
const CAP_SEGMENTS = 12;

/** Half-width at densified sample `j`, interpolated across the control widths. */
function widthAt(halfWidths: readonly number[], j: number, samples: number): number {
    if (halfWidths.length === 0) {
        return 0;
    }
    if (samples <= 1 || halfWidths.length === 1) {
        return halfWidths[0] ?? 0;
    }
    const t = (j / (samples - 1)) * (halfWidths.length - 1);
    const lo = Math.min(Math.floor(t), halfWidths.length - 2);
    const frac = t - lo;
    const a = halfWidths[lo] ?? 0;
    const b = halfWidths[lo + 1] ?? a;
    return a + (b - a) * frac;
}

/**
 * The banks either side of a ribbon (a river's bed along its water): how wide
 * a bank is beside a ribbon `halfWidth` across, as on a straight reach. On a
 * bend the outside bank widens and the inside one narrows, as water cuts the
 * outside and silts the inside, and along the run both waver a little.
 */
export interface Banks {
    readonly width: (halfWidth: number) => number;
}

/** How strongly a bend widens its outside bank and narrows its inside one, per unit of the bend's turn over its width. */
const BEND_GAIN = 2.5;
/** A bank never narrows below, nor widens past, these shares of its straight-reach width. */
const BANK_RANGE = { min: 0.3, max: 2.4 } as const;
/** How far a bank wavers along its run, as a share of its width, and over how many half-widths each wave runs. */
const BANK_WAVER = 0.22;
const BANK_WAVES = [
    { length: 7.3, weight: 0.6, phase: 0 },
    { length: 2.9, weight: 0.4, phase: 1.7 },
] as const;
/** Samples either side over which a bend's turn is averaged, so a bank swells round a whole bend, not one sample. */
const BEND_WINDOW = 6;

/** A bank's wavering at `arc` along the run, for a ribbon `halfWidth` across: 1 ± BANK_WAVER, the two sides out of step. */
function waver(arc: number, halfWidth: number, side: 1 | -1): number {
    const scale = Math.max(halfWidth, 1);
    const wave = BANK_WAVES.reduce((sum, w) => sum + w.weight * Math.sin(arc / (w.length * scale) + w.phase + (side === 1 ? 0 : 2.1)), 0);
    return 1 + BANK_WAVER * wave;
}

/**
 * Each sample's turn over the spine (positive toward the left rail), as radians per unit of length, averaged over
 * the samples round it so a bend reads as a whole.
 */
function bends(segments: readonly Point[], samples: number): number[] {
    const turns = Array.from({ length: samples }, (_, j) => {
        const before = segments[j - 1];
        const after = segments[j];
        if (!before || !after) {
            return 0;
        }
        const lb = Math.hypot(before.x, before.y);
        const la = Math.hypot(after.x, after.y);
        if (lb === 0 || la === 0) {
            return 0;
        }
        const angle = Math.atan2(before.x * after.y - before.y * after.x, before.x * after.x + before.y * after.y);
        return angle / ((lb + la) / 2);
    });
    return turns.map((_, j) => {
        const around = turns.slice(Math.max(0, j - BEND_WINDOW), j + BEND_WINDOW + 1);
        return around.reduce((sum, t) => sum + t, 0) / around.length;
    });
}

/**
 * Build the ribbon for `centerline` control points with `halfWidths` (parallel
 * array), smoothing with `samplesPerSegment` samples per span. Degenerate input
 * (< 2 points) yields empty arrays. The ends are cut square across the path,
 * at full width. With `banks`, each rail lies its bank's width beyond the
 * half-width: wider on a bend's outside, narrower on its inside, wavering.
 */
export function buildRibbon(centerline: readonly Point[], halfWidths: readonly number[], samplesPerSegment: number, banks?: Banks): RibbonGeometry {
    if (centerline.length < 2) {
        return EMPTY;
    }
    const spine = catmullRom(centerline, Math.max(1, samplesPerSegment));
    const n = spine.length;
    if (n < 2) {
        return EMPTY;
    }

    // Each segment of the smoothed spine, as the vector along it.
    const segments: Point[] = [];
    spine.reduce((from, to) => {
        segments.push({ x: to.x - from.x, y: to.y - from.y });
        return to;
    });
    const total = segments.reduce((sum, s) => sum + Math.hypot(s.x, s.y), 0);
    const invTotal = total > 0 ? 1 / total : 0;
    const none: Point = { x: 0, y: 0 };

    const bend = banks ? bends(segments, n) : [];
    const rails: Rail[] = [];
    const along: Point[] = [];
    let arc = 0;
    spine.forEach((cur, j) => {
        // The segments either side (none past an end): together, the next point less the previous one.
        const before = segments[j - 1] ?? none;
        const after = segments[j] ?? none;
        arc += Math.hypot(before.x, before.y);
        const dx = before.x + after.x;
        const dy = before.y + after.y;
        const len = Math.hypot(dx, dy) || 1;
        const hw = widthAt(halfWidths, j, n);
        const normal = { x: -dy / len, y: dx / len };
        along.push({ x: dx / len, y: dy / len });
        // A bend toward the left rail has its outside on the right: the right bank widens, the left narrows.
        const bank = (side: 1 | -1): number => {
            if (!banks) {
                return 0;
            }
            const outward = 1 - side * BEND_GAIN * (bend[j] ?? 0) * hw;
            return banks.width(hw) * Math.min(BANK_RANGE.max, Math.max(BANK_RANGE.min, outward)) * waver(arc, hw, side);
        };
        const left = hw + bank(1);
        const right = hw + bank(-1);
        rails.push({
            left: { x: cur.x + normal.x * left, y: cur.y + normal.y * left },
            right: { x: cur.x - normal.x * right, y: cur.y - normal.y * right },
            u: arc * invTotal,
        });
    });

    unfold(rails, along);

    const indices: number[] = [];
    for (let q = 0; q < rails.length - 1; q++) {
        const l0 = q * 2;
        const r0 = l0 + 1;
        const l1 = l0 + 2;
        const r1 = l0 + 3;
        indices.push(l0, r0, l1, r0, r1, l1);
    }

    return {
        positions: rails.flatMap((rail) => [rail.left.x, rail.left.y, rail.right.x, rail.right.y]),
        uvs: rails.flatMap((rail) => [rail.u, 0, rail.u, 1]),
        indices,
        rails,
    };
}

/**
 * Rails that never fold back: where a bend is tighter than the ribbon is wide, its inner rail would step backwards
 * against the way the path runs (`along`, the path's direction at each sample) and cross itself, drawn as a sharp notch
 * in the bank; such a rail point holds where the rail last reached instead.
 */
function unfold(rails: Rail[], along: readonly Point[]): void {
    for (const side of ['left', 'right'] as const) {
        let reached: Point | undefined;
        rails.forEach((rail, j) => {
            const at = rail[side];
            const way = along[j];
            if (reached && way && (at.x - reached.x) * way.x + (at.y - reached.y) * way.y < 0) {
                rails[j] = { ...rail, [side]: reached };
                return;
            }
            reached = at;
        });
    }
}

const flat = (points: readonly Point[]): number[] => points.flatMap((p) => [p.x, p.y]);

/**
 * Closed outline polygon `[x, y, …]` for a filled ribbon render: the left rail
 * forward, then the right rail reversed. Used by the colour-fill renderer (the
 * textured-mesh path reuses `positions`/`uvs`/`indices` directly).
 */
export function ribbonOutline(geo: RibbonGeometry): number[] {
    return [...flat(geo.rails.map((rail) => rail.left)), ...flat(geo.rails.map((rail) => rail.right).reverse())];
}

/**
 * The half circle closing a round-brush outline at `centre`, from its left
 * rail round through `forward` to its right rail, `forward` being the unit
 * direction the stroke leaves in there; excludes both rail points, which the
 * rails give.
 */
function capArc(centre: Point, forward: Point, radius: number): number[] {
    const left = { x: -forward.y, y: forward.x };
    const arc: number[] = [];
    for (let k = 1; k < CAP_SEGMENTS; k++) {
        const phi = (Math.PI * k) / CAP_SEGMENTS;
        arc.push(
            centre.x + radius * (left.x * Math.cos(phi) + forward.x * Math.sin(phi)),
            centre.y + radius * (left.y * Math.cos(phi) + forward.y * Math.sin(phi)),
        );
    }
    return arc;
}

/**
 * The half circle rounding off a ribbon's end, from its rail pair there: the
 * centre is midway between them, and the end faces along the path (`facing`
 * 1, the far end) or back against it (−1, the near end). An end whose rails
 * meet faces no way, and gets none.
 */
function endCap({ left, right }: Rail, facing: 1 | -1, radius: number): number[] {
    const half = Math.hypot(left.x - right.x, left.y - right.y) / 2;
    if (half === 0) {
        return [];
    }
    // The rails sit a half-width either side of the centre along the path's left normal; the path runs a right angle from it.
    const normal = { x: (left.x - right.x) / (2 * half), y: (left.y - right.y) / (2 * half) };
    const forward = { x: normal.y * facing, y: -normal.x * facing };
    return capArc({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 }, forward, radius);
}

/**
 * The closed outline `[x, y, …]` a round brush of `radius` leaves dragged along
 * `centerline` (smoothed as a ribbon): the ribbon, rounded off by a half
 * circle at each end. A brush pressed without moving (one point, or points
 * all in one place) leaves its round dab; no points leave nothing.
 */
export function brushOutline(centerline: readonly Point[], radius: number, samplesPerSegment: number): number[] {
    const [pressed] = centerline;
    if (pressed === undefined) {
        return [];
    }
    if (centerline.every((p) => p.x === pressed.x && p.y === pressed.y)) {
        // Two half circles facing apart, and the two points where they meet.
        return [
            pressed.x,
            pressed.y + radius,
            ...capArc(pressed, { x: 1, y: 0 }, radius),
            pressed.x,
            pressed.y - radius,
            ...capArc(pressed, { x: -1, y: 0 }, radius),
        ];
    }
    const geo = buildRibbon(
        centerline,
        centerline.map(() => radius),
        samplesPerSegment,
    );
    const first = geo.rails[0];
    const last = geo.rails[geo.rails.length - 1];
    if (first === undefined || last === undefined) {
        return [];
    }
    // The left rail out, round the far end, the right rail back, round the near end.
    return [
        ...flat(geo.rails.map((rail) => rail.left)),
        ...endCap(last, 1, radius),
        ...flat(geo.rails.map((rail) => rail.right).reverse()),
        ...endCap(first, -1, radius),
    ];
}
