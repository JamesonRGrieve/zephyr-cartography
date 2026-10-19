// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The pen: how roads and rivers are drawn and reshaped, as a Bezier pen
 * draws (Inkscape's, Illustrator's). A click drops an anchor; pressing and
 * dragging pulls its handles out either side of it, so the path curves
 * through it; a plain click leaves it auto-smooth (the Catmull-Rom curve
 * through its neighbours). The path shows whole while drawn, the span from
 * the last anchor to the pointer included. Pure and unit-tested: the
 * controller holds a session, the entry feeds it the pointer and the keys,
 * and draws its {@link ControlOverlay}.
 */
import { bezierSpline, distance, type Handle, nearestOnSpline, outHandle, type Point } from '../geometry/spline';

/** One placed anchor: where it is, and its handle (null: auto-smooth). */
interface PenAnchor {
    readonly point: Point;
    readonly handle: Handle;
}

/** What a press with the pen did: dropped an anchor, asked to finish the path (on its last anchor), or nothing. */
export type PenPress = 'added' | 'finish' | 'ignored';

/** A path's anchors and their handles, one each. */
export interface PenShape {
    readonly points: readonly Point[];
    readonly handles: readonly Handle[];
}

/** A corner's handle: none either side, so the path turns sharply there. */
const ZERO: Point = { x: 0, y: 0 };

export class PenSession {
    private readonly anchors: PenAnchor[] = [];
    /** The anchor whose handles the press under way is pulling out, or null between presses. */
    private placing: number | null = null;
    /** Where the pointer is: the far end of the rubber-band span. */
    private cursor: Point | null = null;

    /**
     * A press at `p`. On the last anchor (within `tolerance`) it finishes a
     * path of two or more; anywhere else it drops an anchor there, a corner
     * when `corner` is held, and starts pulling out its handles.
     */
    press(p: Point, tolerance: number, corner: boolean): PenPress {
        const last = this.anchors[this.anchors.length - 1];
        if (last && distance(last.point, p) <= tolerance) {
            return this.anchors.length >= 2 ? 'finish' : 'ignored';
        }
        this.anchors.push({ point: { x: p.x, y: p.y }, handle: corner ? ZERO : null });
        this.placing = this.anchors.length - 1;
        this.cursor = { x: p.x, y: p.y };
        return 'added';
    }

    /**
     * The pointer moved to `p`. Mid-press, the anchor's out-handle follows it
     * (its in-handle mirrored behind) once it is more than `tolerance` away;
     * back within it, the anchor is as the press left it.
     */
    move(p: Point, tolerance: number): void {
        this.cursor = { x: p.x, y: p.y };
        const index = this.placing;
        const anchor = index === null ? undefined : this.anchors[index];
        if (index === null || anchor === undefined) {
            return;
        }
        const offset = { x: p.x - anchor.point.x, y: p.y - anchor.point.y };
        if (Math.hypot(offset.x, offset.y) > tolerance) {
            this.anchors[index] = { ...anchor, handle: offset };
        }
    }

    /** The press ended: the anchor keeps the handles it was given. */
    release(): void {
        this.placing = null;
    }

    /** Take back the last anchor (Backspace); false when there is none. */
    undo(): boolean {
        if (this.anchors.length === 0) {
            return false;
        }
        this.anchors.pop();
        this.placing = null;
        return true;
    }

    get anchorCount(): number {
        return this.anchors.length;
    }

    /** The anchors placed so far: what the path is if finished now. */
    shape(): PenShape {
        return { points: this.anchors.map((a) => a.point), handles: this.anchors.map((a) => a.handle) };
    }

    /**
     * What to show of the path: the anchors placed, and, between presses, a
     * rubber-band span on to the pointer (an auto-smooth end there).
     */
    preview(): PenShape {
        const placed = this.shape();
        const last = placed.points[placed.points.length - 1];
        if (this.placing !== null || this.cursor === null || last === undefined || distance(last, this.cursor) === 0) {
            return placed;
        }
        return { points: [...placed.points, this.cursor], handles: [...placed.handles, null] };
    }

    /** The guides to draw over the path being drawn: its centreline, anchors and handles. */
    overlay(samplesPerSegment: number): ControlOverlay {
        const { points, handles } = this.preview();
        // The rubber band's end is the pointer, not an anchor.
        const anchors = this.anchors.length;
        return controlOverlay(points, handles, samplesPerSegment, this.placing ?? anchors - 1, anchors);
    }
}

/** A handle's line out of its anchor, to the end that drags it. */
interface HandleLine {
    readonly anchor: number;
    readonly side: HandleSide;
    readonly from: Point;
    readonly to: Point;
}

/** Which of an anchor's two handles: the one leading on (`out`) or back (`in`, the mirror). */
export type HandleSide = 'in' | 'out';

/** The guides drawn over a path being drawn or edited: its centreline, its anchors, and the handles shown. */
export interface ControlOverlay {
    readonly spine: readonly Point[];
    readonly anchors: readonly Point[];
    readonly handles: readonly HandleLine[];
    /** The anchor picked (drawn larger), or null. */
    readonly selected: number | null;
}

/**
 * The handles shown on a path: those of every shaped anchor, and the picked
 * one's even where auto (so it can be grabbed and shaped). An end shows only
 * the handle toward the path; a corner shows none.
 */
function visibleHandles(points: readonly Point[], handles: readonly Handle[], selected: number | null, anchorCount: number): HandleLine[] {
    return points.slice(0, anchorCount).flatMap((at, i) => {
        const own = handles[i] ?? null;
        if (own === null && i !== selected) {
            return [];
        }
        const out = outHandle(points, handles, i);
        if (out.x === 0 && out.y === 0) {
            return [];
        }
        const lines: HandleLine[] = [];
        if (i > 0) {
            lines.push({ anchor: i, side: 'in', from: at, to: { x: at.x - out.x, y: at.y - out.y } });
        }
        if (i < points.length - 1) {
            lines.push({ anchor: i, side: 'out', from: at, to: { x: at.x + out.x, y: at.y + out.y } });
        }
        return lines;
    });
}

/**
 * The guides for a path through `points` shaped by `handles`: its smoothed
 * centreline, the first `anchorCount` points as anchors (all by default), and
 * the handles shown with `selected` picked.
 */
export function controlOverlay(
    points: readonly Point[],
    handles: readonly Handle[],
    samplesPerSegment: number,
    selected: number | null,
    anchorCount: number = points.length,
): ControlOverlay {
    const picked = selected !== null && selected >= 0 && selected < anchorCount ? selected : null;
    return {
        spine: points.length < 2 ? [...points] : bezierSpline(points, handles, samplesPerSegment),
        anchors: points.slice(0, anchorCount),
        handles: visibleHandles(points, handles, picked, anchorCount),
        selected: picked,
    };
}

/** What a press on a path being edited lands on: an anchor, the end of a handle, or the path between anchors. */
export type PathControl =
    | { readonly kind: 'anchor'; readonly index: number }
    | { readonly kind: 'handle'; readonly index: number; readonly side: HandleSide }
    | { readonly kind: 'span'; readonly span: number; readonly t: number };

/**
 * What a press at `pt` takes hold of on a path: an anchor within `tolerance`
 * first, then the end of a shown handle, then the path itself within `reach`
 * of its centreline; null for none.
 */
export function pickPathControl(
    shape: PenShape,
    pt: Point,
    tolerance: number,
    reach: number,
    selected: number | null,
    samplesPerSegment: number,
): PathControl | null {
    const { points, handles } = shape;
    const nearest = points.reduce<{ index: number; off: number } | null>((best, p, index) => {
        const off = distance(p, pt);
        return off <= tolerance && (best === null || off < best.off) ? { index, off } : best;
    }, null);
    if (nearest) {
        return { kind: 'anchor', index: nearest.index };
    }
    const handle = visibleHandles(points, handles, selected, points.length).find((line) => distance(line.to, pt) <= tolerance);
    if (handle) {
        return { kind: 'handle', index: handle.anchor, side: handle.side };
    }
    const spot = nearestOnSpline(points, handles, pt, samplesPerSegment);
    return spot && spot.distance <= reach ? { kind: 'span', span: spot.span, t: spot.t } : null;
}

/**
 * The out-handle a handle dragged to `to` gives its anchor `at`: the
 * offset itself for the out-handle, its mirror for the in-handle.
 */
export function handleFromDrag(at: Point, side: HandleSide, to: Point): Point {
    const offset = { x: to.x - at.x, y: to.y - at.y };
    return side === 'out' ? offset : { x: -offset.x, y: -offset.y };
}

/**
 * What a key does to a path being drawn or edited: remove (drawing, the last
 * anchor; editing, the picked one), finish the path being drawn, or cancel
 * (drawing, throw the path away; editing, let go of the path).
 */
export type PathKey = 'remove' | 'finish' | 'cancel';

/** The path keys: Backspace or Delete removes, Enter finishes, Escape cancels; null for any other. */
export function pathKey(key: string): PathKey | null {
    switch (key) {
        case 'Backspace':
        case 'Delete':
            return 'remove';
        case 'Enter':
            return 'finish';
        case 'Escape':
            return 'cancel';
        default:
            return null;
    }
}
