// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Pure control-point edit operations over a committed feature: move or delete a
 * vertex, returning a NEW feature (features are immutable) or null when the edit
 * would violate the minimum point count (path >= 2, region >= 3). Paths keep
 * their parallel half-width array in step. Unit-tested; the controller applies
 * these and persists.
 */
import { cubicAt, type Handle, type Point, spanControls } from '../geometry/spline';
import { isAnchored, isRegion, isRoom, isStamp, isStroke, type Feature } from './feature';
import { type CartographyPath, withPathGeometry } from './path';
import { withRegionPoints } from './region';
import { withRoomPoints } from './room';
import { withShapePoints } from './shape';
import { withStrokePoints } from './stroke';

/** Move the vertex at `index` to `to`, or null if the index is out of range. */
export function movePoint(feature: Feature, index: number, to: Point): Feature | null {
    if (index < 0 || index >= feature.points.length) {
        return null;
    }
    const points = feature.points.map((p, i) => (i === index ? { x: to.x, y: to.y } : p));
    if (feature.type === 'shape') {
        // A box's one point is its centre; a polygon's or line's are its vertices.
        return withShapePoints(feature, points);
    }
    if (isStamp(feature) || isAnchored(feature)) {
        // A stamp's, a pin's or a label's one point is where it stands: moving it moves the whole thing.
        return { ...feature, points };
    }
    if (isRegion(feature)) {
        return withRegionPoints(feature, points);
    }
    if (isRoom(feature)) {
        return withRoomPoints(feature, points);
    }
    if (isStroke(feature)) {
        return withStrokePoints(feature, points);
    }
    return withPathGeometry(feature, points, feature.halfWidths, feature.handles);
}

/** Narrowest half-width (scene px) a path point can be set to, so it stays visible and pickable. */
export const MIN_HALF_WIDTH = 2;

/**
 * Set a path's half-width at control point `index` (clamped to
 * {@link MIN_HALF_WIDTH}), or null if the feature is not a path or the index
 * is out of range. Only paths vary width per point.
 */
export function setHalfWidth(feature: Feature, index: number, halfWidth: number): Feature | null {
    if (feature.type !== 'path' || index < 0 || index >= feature.points.length || !Number.isFinite(halfWidth)) {
        return null;
    }
    const width = Math.max(MIN_HALF_WIDTH, halfWidth);
    return withPathGeometry(
        feature,
        feature.points,
        feature.halfWidths.map((w, i) => (i === index ? width : w)),
        feature.handles,
    );
}

/** Delete the vertex at `index`, or null if out of range or it would drop below the minimum. */
export function deletePoint(feature: Feature, index: number): Feature | null {
    if (index < 0 || index >= feature.points.length) {
        return null;
    }
    // A stamp, a pin or a label is its one point: it is erased, not thinned.
    if (isStamp(feature) || isAnchored(feature)) {
        return null;
    }
    const points = feature.points.filter((_, i) => i !== index);
    if (feature.type === 'shape') {
        return withShapePoints(feature, points);
    }
    if (isRegion(feature)) {
        return withRegionPoints(feature, points);
    }
    if (isRoom(feature)) {
        return withRoomPoints(feature, points);
    }
    if (isStroke(feature)) {
        return withStrokePoints(feature, points);
    }
    const halfWidths = feature.halfWidths.filter((_, i) => i !== index);
    const handles = feature.handles.filter((_, i) => i !== index);
    return withPathGeometry(feature, points, halfWidths, handles);
}

/**
 * Give a path's control point `index` the out-handle `handle` (its in-handle
 * mirrors it; null makes it auto-smooth again), or null if the index is out
 * of range or the handle is not finite.
 */
export function setPathHandle(path: CartographyPath, index: number, handle: Handle): CartographyPath | null {
    if (index < 0 || index >= path.points.length || (handle !== null && !(Number.isFinite(handle.x) && Number.isFinite(handle.y)))) {
        return null;
    }
    return withPathGeometry(
        path,
        path.points,
        path.halfWidths,
        path.handles.map((h, i) => (i === index ? handle : h)),
    );
}

/**
 * Insert a control point into a path at `t` (0–1) along the span from point
 * `span` to the next, on the curve as drawn, as wide there as the path is.
 * Between two auto-smooth points it is auto-smooth too; beside a shaped one it
 * takes the curve's own direction there, so the path keeps its line. Null if
 * there is no such span.
 */
export function insertPathPoint(path: CartographyPath, span: number, t: number): CartographyPath | null {
    const controls = spanControls(path.points, path.handles, span);
    if (controls === null || !Number.isFinite(t)) {
        return null;
    }
    const along = Math.max(0, Math.min(1, t));
    const [a, c1, c2, b] = controls;
    const at = cubicAt(a, c1, c2, b, along);
    const auto = (path.handles[span] ?? null) === null && (path.handles[span + 1] ?? null) === null;
    const handle = auto ? null : bezierTangentSixth(controls, along);
    const before = path.halfWidths[span] ?? 0;
    const after = path.halfWidths[span + 1] ?? before;
    const insert = <T>(list: readonly T[], item: T): T[] => [...list.slice(0, span + 1), item, ...list.slice(span + 1)];
    return withPathGeometry(path, insert(path.points, at), insert(path.halfWidths, before + (after - before) * along), insert(path.handles, handle));
}

/**
 * A sixth of the curve's derivative at `t`: the symmetric handle that splits
 * a cubic there with its two halves' handles averaged (a third of the
 * derivative, shared t : 1 − t between them).
 */
function bezierTangentSixth([a, c1, c2, b]: readonly [Point, Point, Point, Point], t: number): Point {
    const u = 1 - t;
    const k0 = u * u;
    const k1 = 2 * u * t;
    const k2 = t * t;
    // B'(t) = 3 (u² (c1 − a) + 2ut (c2 − c1) + t² (b − c2)); half of a third of it.
    return {
        x: (k0 * (c1.x - a.x) + k1 * (c2.x - c1.x) + k2 * (b.x - c2.x)) / 2,
        y: (k0 * (c1.y - a.y) + k1 * (c2.y - c1.y) + k2 * (b.y - c2.y)) / 2,
    };
}
