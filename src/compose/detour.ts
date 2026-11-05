// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Paths that go round what stands in their way. A road or river laid from
 * anchor to anchor knows nothing of the buildings between; where its line
 * would cross one, the stretch inside is replaced by the shorter way round
 * the building's footprint, grown by the path's clearance. The path's
 * smoothing rounds the corners off. Pure; positions are in grid squares.
 */
import type { Rect } from '../generate/floor-plan';
import type { Point } from '../geometry/spline';

/** Squares between samples when a line is checked against a footprint. */
const SAMPLE_STEP = 0.25;

/** A rect grown by `by` on every side. */
export function grown(r: Rect, by: number): Rect {
    return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

const inside = (p: Point, r: Rect): boolean => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

/** A point of the line, and whether it is one of the line's own points (not a sample between them). */
interface Sample {
    readonly p: Point;
    readonly own: boolean;
}

function sampled(line: readonly Point[]): Sample[] {
    const [first, ...rest] = line;
    if (!first) {
        return [];
    }
    const samples: Sample[] = [{ p: first, own: true }];
    rest.reduce((a, b) => {
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / SAMPLE_STEP));
        for (let i = 1; i < steps; i++) {
            samples.push({ p: { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }, own: false });
        }
        samples.push({ p: b, own: true });
        return b;
    }, first);
    return samples;
}

/** The nearest point of `r`'s edge to `p`, a point outside it. */
const onEdge = (p: Point, r: Rect): Point => ({ x: Math.min(Math.max(p.x, r.x), r.x + r.w), y: Math.min(Math.max(p.y, r.y), r.y + r.h) });

/** How far round `r`'s edge `q` lies, clockwise from the top-left corner. */
function around(q: Point, r: Rect): number {
    if (q.y === r.y) {
        return q.x - r.x;
    }
    if (q.x === r.x + r.w) {
        return r.w + (q.y - r.y);
    }
    if (q.y === r.y + r.h) {
        return r.w + r.h + (r.x + r.w - q.x);
    }
    return 2 * r.w + r.h + (r.y + r.h - q.y);
}

/** The corners met going the shorter way round `r` from edge point `from` to edge point `to`. */
function cornersBetween(from: Point, to: Point, r: Rect): Point[] {
    const perimeter = 2 * (r.w + r.h);
    const corners = [
        { at: 0, p: { x: r.x, y: r.y } },
        { at: r.w, p: { x: r.x + r.w, y: r.y } },
        { at: r.w + r.h, p: { x: r.x + r.w, y: r.y + r.h } },
        { at: 2 * r.w + r.h, p: { x: r.x, y: r.y + r.h } },
    ];
    const start = around(from, r);
    const clockwise = (around(to, r) - start + perimeter) % perimeter;
    const ahead = (at: number): number => (at - start + perimeter) % perimeter;
    if (clockwise <= perimeter / 2) {
        return corners
            .filter((c) => ahead(c.at) > 0 && ahead(c.at) < clockwise)
            .sort((a, b) => ahead(a.at) - ahead(b.at))
            .map((c) => c.p);
    }
    const behind = (at: number): number => (perimeter - ahead(at)) % perimeter;
    return corners
        .filter((c) => behind(c.at) > 0 && behind(c.at) < perimeter - clockwise)
        .sort((a, b) => behind(a.at) - behind(b.at))
        .map((c) => c.p);
}

/** A footprint a path goes round: a building's box, or open water (`round`), gone round in a curve. */
export type Block = Rect & { readonly round?: true };

/** Points along the shorter way round a block's ellipse, every this many radians. */
const ARC_STEP = Math.PI / 10;

const centreOf = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Whether `p` lies inside the ellipse fitted in `r`. */
function insideEllipse(p: Point, r: Rect): boolean {
    const c = centreOf(r);
    return ((p.x - c.x) / (r.w / 2)) ** 2 + ((p.y - c.y) / (r.h / 2)) ** 2 < 1;
}

const angleOf = (p: Point, r: Rect): number => {
    const c = centreOf(r);
    return Math.atan2((p.y - c.y) / (r.h / 2), (p.x - c.x) / (r.w / 2));
};

const onEllipse = (angle: number, r: Rect): Point => {
    const c = centreOf(r);
    return { x: c.x + (Math.cos(angle) * r.w) / 2, y: c.y + (Math.sin(angle) * r.h) / 2 };
};

/** The points going the shorter way round `r`'s ellipse from angle `from` to angle `to`, both ends included. */
function arcBetween(from: number, to: number, r: Rect): Point[] {
    const turn = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    const steps = Math.max(1, Math.ceil(Math.abs(turn) / ARC_STEP));
    return Array.from({ length: steps + 1 }, (_, i) => onEllipse(from + (turn * i) / steps, r));
}

/**
 * `line`, going round each of `blocks` it would cross: a box by its corners, open water (`round`) along the ellipse
 * fitted in its box (2026-11-05: a road stepped round a marsh's two pools in square kinks). A block holding either end
 * of the line is left alone: there is no way round it.
 */
export function detour(line: readonly Point[], blocks: readonly Block[]): Point[] {
    return blocks.reduce<Point[]>(
        (current, block) => {
            const samples = sampled(current);
            const within = (p: Point): boolean => (block.round === true ? insideEllipse(p, block) : inside(p, block));
            const first = samples.findIndex((s) => within(s.p));
            const last = samples.findLastIndex((s) => within(s.p));
            const before = samples[first - 1];
            const after = samples[last + 1];
            if (first < 0 || !before || !after) {
                return current;
            }
            // The line's own points, and the samples either side of the block, so the line reaches it as it did.
            const keep = (s: Sample): boolean => s.own || s === before || s === after;
            const head = samples
                .slice(0, first)
                .filter(keep)
                .map((s) => s.p);
            const tail = samples
                .slice(last + 1)
                .filter(keep)
                .map((s) => s.p);
            if (block.round === true) {
                return [...head, ...arcBetween(angleOf(before.p, block), angleOf(after.p, block), block), ...tail];
            }
            const enter = onEdge(before.p, block);
            const leave = onEdge(after.p, block);
            return [...head, enter, ...cornersBetween(enter, leave, block), leave, ...tail];
        },
        [...line],
    );
}
