// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Pure 2D path geometry for the cartography draw tool: freehand simplification,
 * Catmull-Rom smoothing, and offset-ribbon generation for textured roads/rivers.
 *
 * No Foundry / PIXI dependency — this is the unit-tested heart of the path tool.
 * All functions are pure and total; callers own rendering and persistence.
 */

export interface Point {
    readonly x: number;
    readonly y: number;
}

export interface Ribbon {
    /** Offset polyline on the left of the centerline (by travel direction). */
    readonly left: Point[];
    /** Offset polyline on the right of the centerline. */
    readonly right: Point[];
}

export function distance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Total arc length of a polyline. */
export function pathLength(points: readonly Point[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const cur = points[i];
        if (prev === undefined || cur === undefined) {
            continue;
        }
        total += distance(prev, cur);
    }
    return total;
}

/** Shortest distance from `p` to the segment `a`→`b` (clamped to the endpoints). */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
        return distance(p, a);
    }
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    const clamped = Math.max(0, Math.min(1, t));
    const projX = a.x + clamped * dx;
    const projY = a.y + clamped * dy;
    return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * Ramer–Douglas–Peucker simplification of a freehand point stream. Returns a
 * subset preserving the shape within `epsilon`. Inputs shorter than 3 points
 * are returned as a copy.
 */
export function simplify(points: readonly Point[], epsilon: number): Point[] {
    if (points.length < 3) {
        return [...points];
    }
    const first = points[0];
    const last = points[points.length - 1];
    if (first === undefined || last === undefined) {
        return [...points];
    }

    let maxDist = 0;
    let index = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const p = points[i];
        if (p === undefined) {
            continue;
        }
        const d = distanceToSegment(p, first, last);
        if (d > maxDist) {
            maxDist = d;
            index = i;
        }
    }

    if (maxDist <= epsilon) {
        return [first, last];
    }
    const left = simplify(points.slice(0, index + 1), epsilon);
    const right = simplify(points.slice(index), epsilon);
    // Drop the duplicated join vertex shared by both halves.
    return [...left.slice(0, -1), ...right];
}

function catmullRomSegment(p0: Point, p1: Point, p2: Point, p3: Point, samples: number): Point[] {
    const out: Point[] = [];
    for (let i = 0; i < samples; i++) {
        const t = i / samples;
        const t2 = t * t;
        const t3 = t2 * t;
        const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
        const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
        out.push({ x, y });
    }
    return out;
}

/**
 * Catmull-Rom spline through the control points, `samplesPerSegment` samples per
 * span (endpoints duplicated so the curve passes through the first and last).
 * Fewer than 2 control points returns a copy.
 */
export function catmullRom(points: readonly Point[], samplesPerSegment: number): Point[] {
    if (points.length < 2 || samplesPerSegment < 1) {
        return [...points];
    }
    const pts = [points[0], ...points, points[points.length - 1]];
    const curve: Point[] = [];
    for (let i = 1; i < pts.length - 2; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2];
        if (p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) {
            continue;
        }
        curve.push(...catmullRomSegment(p0, p1, p2, p3, samplesPerSegment));
    }
    const tail = points[points.length - 1];
    if (tail !== undefined) {
        curve.push(tail);
    }
    return curve;
}

/**
 * Catmull-Rom through a CLOSED loop of control points (wrapping around), for
 * smoothed biome-region boundaries. Fewer than 3 points returns a copy.
 */
export function closedSpline(points: readonly Point[], samplesPerSegment: number): Point[] {
    const n = points.length;
    if (n < 3 || samplesPerSegment < 1) {
        return [...points];
    }
    const at = (k: number): Point | undefined => points[((k % n) + n) % n];
    const out: Point[] = [];
    for (let i = 0; i < n; i++) {
        const p0 = at(i - 1);
        const p1 = at(i);
        const p2 = at(i + 1);
        const p3 = at(i + 2);
        if (p0 && p1 && p2 && p3) {
            out.push(...catmullRomSegment(p0, p1, p2, p3, samplesPerSegment));
        }
    }
    return out;
}

/**
 * A CLOSED loop with its corners cut `rounds` times (Chaikin): each edge
 * gives way to points a quarter and three quarters along it, so a jagged
 * outline rounds into a smooth one that stays within it, never overshooting
 * a sharp corner as a spline through the points would. Fewer than 3 points
 * returns a copy.
 */
export function roundCorners(points: readonly Point[], rounds: number): Point[] {
    let loop = [...points];
    for (let r = 0; r < rounds && loop.length >= 3; r++) {
        const ring = loop;
        loop = ring.flatMap((a, i) => {
            const b = ring[(i + 1) % ring.length] ?? a;
            return [
                { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
                { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 },
            ];
        });
    }
    return loop;
}

/**
 * Offset a centerline by `halfWidth` on each side using averaged vertex normals,
 * producing the two rails of a textured ribbon (road/river). Degenerate inputs
 * (< 2 points) yield empty rails.
 */
export function offsetRibbon(centerline: readonly Point[], halfWidth: number): Ribbon {
    const left: Point[] = [];
    const right: Point[] = [];
    const n = centerline.length;
    if (n < 2) {
        return { left, right };
    }
    for (let i = 0; i < n; i++) {
        const cur = centerline[i];
        const prev = centerline[i - 1] ?? cur;
        const next = centerline[i + 1] ?? cur;
        if (cur === undefined || prev === undefined || next === undefined) {
            continue;
        }
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        // Left normal of the travel direction (−dy, dx), normalised.
        const nx = -dy / len;
        const ny = dx / len;
        left.push({ x: cur.x + nx * halfWidth, y: cur.y + ny * halfWidth });
        right.push({ x: cur.x - nx * halfWidth, y: cur.y - ny * halfWidth });
    }
    return { left, right };
}
