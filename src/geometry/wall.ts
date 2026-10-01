// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Perimeter → wall-segment geometry for structure mapping. A room's boundary
 * polygon becomes the set of edge segments its walls follow (used both to render
 * textured wall ribbons and to emit Foundry WallDocuments). Pure and
 * unit-tested; the closing edge (last → first) is included.
 */
import { distanceToSegment, type Point } from './spline';

export interface Segment {
    readonly a: Point;
    readonly b: Point;
}

/** Edge segments of a closed polygon (n points → n segments, including the closing edge). */
export function perimeterSegments(points: readonly Point[]): Segment[] {
    const n = points.length;
    if (n < 2) {
        return [];
    }
    const out: Segment[] = [];
    for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        if (a && b) {
            out.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
        }
    }
    return out;
}

/** Where point `p` projects onto the line through `seg`, as a parameter (0 = a, 1 = b), and how far it is from that line. */
function project(seg: Segment, p: Point): { t: number; offset: number } {
    const dx = seg.b.x - seg.a.x;
    const dy = seg.b.y - seg.a.y;
    const span = Math.hypot(dx, dy);
    if (span === 0) {
        return { t: 0, offset: Math.hypot(p.x - seg.a.x, p.y - seg.a.y) };
    }
    const t = ((p.x - seg.a.x) * dx + (p.y - seg.a.y) * dy) / (span * span);
    const offset = Math.abs((p.x - seg.a.x) * dy - (p.y - seg.a.y) * dx) / span;
    return { t, offset };
}

function pointAt(seg: Segment, t: number): Point {
    return { x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t };
}

/** A stretch of a segment, and whether some overlay covers it. */
export interface SegmentPiece extends Segment {
    readonly covered: boolean;
}

/** The merged parameter intervals (0..1 along `seg`) that collinear overlays cover. */
function coveredIntervals(seg: Segment, overlays: readonly Segment[], tolerance: number): [number, number][] {
    const intervals: [number, number][] = [];
    for (const overlay of overlays) {
        const a = project(seg, overlay.a);
        const b = project(seg, overlay.b);
        if (a.offset > tolerance || b.offset > tolerance) {
            continue;
        }
        const from = Math.max(0, Math.min(a.t, b.t));
        const to = Math.min(1, Math.max(a.t, b.t));
        if (to > from) {
            intervals.push([from, to]);
        }
    }
    intervals.sort((p, q) => p[0] - q[0]);
    const merged: [number, number][] = [];
    for (const [from, to] of intervals) {
        const last = merged[merged.length - 1];
        if (last && from <= last[1]) {
            last[1] = Math.max(last[1], to);
        } else {
            merged.push([from, to]);
        }
    }
    return merged;
}

/**
 * `seg` split, in order, into the stretches collinear overlays cover and the
 * stretches they do not. An overlay covers where both its endpoints lie within
 * `tolerance` of the segment's line. Overlays that are not collinear leave the
 * segment one uncovered piece.
 */
export function splitSegment(seg: Segment, overlays: readonly Segment[], tolerance: number): SegmentPiece[] {
    const pieces: SegmentPiece[] = [];
    let cursor = 0;
    for (const [from, to] of coveredIntervals(seg, overlays, tolerance)) {
        if (from > cursor) {
            pieces.push({ a: pointAt(seg, cursor), b: pointAt(seg, from), covered: false });
        }
        pieces.push({ a: pointAt(seg, from), b: pointAt(seg, to), covered: true });
        cursor = to;
    }
    if (cursor < 1) {
        pieces.push({ a: pointAt(seg, cursor), b: pointAt(seg, 1), covered: false });
    }
    return pieces;
}

/** `seg` with every collinear cut removed: the uncovered stretches of {@link splitSegment}. */
export function cutSegment(seg: Segment, cuts: readonly Segment[], tolerance: number): Segment[] {
    return splitSegment(seg, cuts, tolerance)
        .filter((piece) => !piece.covered)
        .map(({ a, b }) => ({ a, b }));
}

/**
 * A band `thickness` wide centred on a segment, as a flat `[x, y, …]` quad,
 * extended by half the thickness past each end so bands of adjoining segments
 * overlap at the corners instead of leaving notches. Empty for a zero-length
 * segment.
 */
export function segmentBand(seg: Segment, thickness: number): number[] {
    const dx = seg.b.x - seg.a.x;
    const dy = seg.b.y - seg.a.y;
    const span = Math.hypot(dx, dy);
    if (span === 0) {
        return [];
    }
    const half = thickness / 2;
    const ux = dx / span;
    const uy = dy / span;
    const nx = -uy * half;
    const ny = ux * half;
    const a = { x: seg.a.x - ux * half, y: seg.a.y - uy * half };
    const b = { x: seg.b.x + ux * half, y: seg.b.y + uy * half };
    return [a.x + nx, a.y + ny, b.x + nx, b.y + ny, b.x - nx, b.y - ny, a.x - nx, a.y - ny];
}

/** A turn sharper than this (radians) starts a new wall run, its texture turned anew: a room's corner, a cut corner. */
const RUN_BREAK_TURN = Math.PI / 6;

/**
 * A corner turning sharper than this (radians) is bevelled, cut straight
 * across its outside, rather than drawn out to a long mitre's spike; a
 * room's square corner is still mitred.
 */
const MITRE_LIMIT_TURN = (5 * Math.PI) / 9;

/** The most a bevelled corner's inside point reaches from it, in half-thicknesses: past that its inside is left a little thin. */
const INSIDE_REACH = 2;

/** One stretch of a room's drawn wall: its band's outline `[x, y, …]`, and the direction (radians) its texture runs. */
export interface WallRun {
    readonly outline: number[];
    readonly angle: number;
}

interface Walled {
    readonly seg: Segment;
    readonly open: boolean;
    /** Unit direction along the segment. */
    readonly u: Point;
}

/** The signed turn (radians, −π…π) from direction `u` to direction `v`. */
function turnOf(u: Point, v: Point): number {
    return Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y);
}

/**
 * Where a band's two sides pass a corner: the points on its left side (along
 * its left normal) and on its right, each in order along the band. A side
 * has one point where it meets its turn on the mitre, and two where the
 * outside of a sharp corner is bevelled (the end of the wall before, then
 * the start of the wall after).
 */
interface Joint {
    readonly left: readonly Point[];
    readonly right: readonly Point[];
}

const along = (p: Point, d: Point, by: number): Point => ({ x: p.x + d.x * by, y: p.y + d.y * by });

/** How a band `half` either side passes the corner `at`, turning from direction `u` to direction `v`. */
function joint(at: Point, u: Point, v: Point, half: number): Joint {
    const nu = { x: -u.y, y: u.x };
    const nv = { x: -v.y, y: v.x };
    const span = Math.hypot(nu.x + nv.x, nu.y + nv.y);
    // A band doubling straight back has no mitre: its own normal stands for one.
    const m = span === 0 ? nu : { x: (nu.x + nv.x) / span, y: (nu.y + nv.y) / span };
    const reach = half / Math.max(m.x * nu.x + m.y * nu.y, Number.EPSILON);
    const turn = turnOf(u, v);
    if (Math.abs(turn) <= MITRE_LIMIT_TURN) {
        return { left: [along(at, m, reach)], right: [along(at, m, -reach)] };
    }
    const inside = Math.min(reach, INSIDE_REACH * half);
    // Turning towards its left, the band's left side is the corner's inside, and its right side the outside, bevelled.
    return turn > 0
        ? { left: [along(at, m, inside)], right: [along(at, nu, -half), along(at, nv, -half)] }
        : { left: [along(at, nu, half), along(at, nv, half)], right: [along(at, m, -inside)] };
}

/** A band's squared-off end at `at`, reaching `half` past it along `u` (`sign` −1 back, 1 on): its left and right corners. */
function squared(at: Point, u: Point, half: number, sign: 1 | -1): Joint {
    const x = at.x + u.x * half * sign;
    const y = at.y + u.y * half * sign;
    return { left: [{ x: x - u.y * half, y: y + u.x * half }], right: [{ x: x + u.y * half, y: y - u.x * half }] };
}

/** The last of a side's points at a joint: where the band after it starts. */
const lastOf = (side: readonly Point[]): Point[] => side.slice(-1);

/** Whether the corner between walls `a` and `b` joins them into one run, a gentle bend of a hewn or curved wall. */
const bends = (a: Walled, b: Walled): boolean => Math.abs(turnOf(a.u, b.u)) <= RUN_BREAK_TURN;

/** The outline and texture direction of one run of walls, from where it leaves its start corner to all of its end corner. */
function runBand(run: readonly Walled[], half: number, start: Joint, end: Joint): WallRun {
    const lefts: Point[] = lastOf(start.left);
    const rights: Point[] = lastOf(start.right);
    for (let i = 0; i + 1 < run.length; i++) {
        const [a, b] = [run[i], run[i + 1]];
        if (a && b) {
            const bend = joint(a.seg.b, a.u, b.u, half);
            lefts.push(...bend.left);
            rights.push(...bend.right);
        }
    }
    lefts.push(...end.left);
    rights.push(...end.right);
    // The texture runs the run's way from end to end; a run closing on itself runs its longest wall's way.
    const first = run[0]?.seg.a ?? { x: 0, y: 0 };
    const last = run[run.length - 1]?.seg.b ?? first;
    const longest = run.reduce<Walled | undefined>((best, w) => (best === undefined || spanOf(w.seg) > spanOf(best.seg) ? w : best), undefined);
    const chord = Math.hypot(last.x - first.x, last.y - first.y);
    const angle = chord > half ? Math.atan2(last.y - first.y, last.x - first.x) : Math.atan2(longest?.u.y ?? 0, longest?.u.x ?? 1);
    return { outline: [...lefts, ...rights.reverse()].flatMap((p) => [p.x, p.y]), angle };
}

const spanOf = (seg: Segment): number => Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);

/**
 * The drawn wall of a closed outline, `thickness` wide and centred on it,
 * broken at the segments `openings` names (doorways): one band per run of
 * walls, a run bending on through gentle turns (a hewn tunnel, a curve) as
 * one smooth band, and breaking at a sharp corner. Where two walls meet, their
 * bands meet on the corner's mitre, with no notch or overlap; a corner too
 * sharp to mitre is bevelled across its outside instead of spiking out, and
 * a doorway's jambs are squared off half the thickness past the wall's end.
 */
export function wallRuns(points: readonly Point[], openings: ReadonlySet<number>, thickness: number): WallRun[] {
    const half = thickness / 2;
    const walled = perimeterSegments(points).flatMap((seg, i): Walled[] => {
        const span = spanOf(seg);
        return span === 0 ? [] : [{ seg, open: openings.has(i), u: { x: (seg.b.x - seg.a.x) / span, y: (seg.b.y - seg.a.y) / span } }];
    });
    const n = walled.length;
    const at = (i: number): Walled | undefined => walled[((i % n) + n) % n];
    // A run starts after a doorway or at a corner too sharp to bend round; a closed outline with none starts at its sharpest.
    const starts = walled.flatMap((w, i) => {
        const before = at(i - 1);
        return !w.open && before !== undefined && (before.open || !bends(before, w)) ? [i] : [];
    });
    const turnInto = (i: number): number => {
        const [before, w] = [at(i - 1), at(i)];
        return before === undefined || w === undefined ? 0 : Math.abs(turnOf(before.u, w.u));
    };
    const sharpest = walled.reduce((best, _, i) => (turnInto(i) > turnInto(best) ? i : best), 0);
    // With no run starting anywhere, the outline is one unbroken wall, or all doorway.
    const firsts = starts.length > 0 ? starts : walled.some((w) => !w.open) ? [sharpest] : [];
    return firsts.map((from) => {
        const run: Walled[] = [];
        for (let i = from; run.length < n; i++) {
            const w = at(i);
            if (w === undefined || w.open || (run.length > 0 && firsts.includes(((i % n) + n) % n))) {
                break;
            }
            run.push(w);
        }
        const head = run[0];
        const tail = run[run.length - 1];
        const before = at(from - 1);
        const after = at(from + run.length);
        if (head === undefined || tail === undefined || before === undefined || after === undefined) {
            return { outline: [], angle: 0 };
        }
        // Each end meets the next run at their corner (its outside bevelled if sharp), unless it is a doorway's jamb, squared off.
        const start = before.open ? squared(head.seg.a, head.u, half, -1) : joint(head.seg.a, before.u, head.u, half);
        const end = after.open ? squared(tail.seg.b, tail.u, half, 1) : joint(tail.seg.b, tail.u, after.u, half);
        return runBand(run, half, start, end);
    });
}

/** Average of a polygon's vertices — a good-enough light-placement centre for a room. */
export function centroid(points: readonly Point[]): Point {
    if (points.length === 0) {
        return { x: 0, y: 0 };
    }
    let sx = 0;
    let sy = 0;
    for (const p of points) {
        sx += p.x;
        sy += p.y;
    }
    return { x: sx / points.length, y: sy / points.length };
}

/** Nearest perimeter segment of a closed polygon to `pt`: its index (−1 if none) and distance. */
export function nearestSegment(pt: Point, points: readonly Point[]): { index: number; distance: number } {
    const segs = perimeterSegments(points);
    let index = -1;
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (!s) {
            continue;
        }
        const d = distanceToSegment(pt, s.a, s.b);
        if (d < min) {
            min = d;
            index = i;
        }
    }
    return { index, distance: min };
}
