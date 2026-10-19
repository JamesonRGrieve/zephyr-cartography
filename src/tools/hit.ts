// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Feature-level hit test: does a scene point fall on a given feature? Regions
 * hit when the point is inside their smoothed fill; paths hit when the point is
 * within the widest half-width of their centerline. Pure — used by the
 * controller for click-to-select and the eraser.
 */
import { distanceToPolyline, pointInPolygon } from '../geometry/hit';
import { RIBBON_SAMPLES } from '../geometry/ribbon';
import { distance, type Point } from '../geometry/spline';
import { isRegion, isRoom, isStamp, isStroke, type Feature } from './feature';
import { labelCorners } from './label';
import { pathSpine } from './path';
import { PIN_HIT_RADIUS, pinPoint } from './pin';
import { regionOutline } from './region';
import { shapeHit } from './shape';
import { stampCorners } from './stamp';
import { TOKEN_HIT_RADIUS, tokenPoint } from './token';
import { zoneHit } from './zone';

/** Extra tolerance (scene px) so thin paths/strokes are still comfortably clickable. */
const PATH_HIT_PADDING = 4;

export function featureHit(feature: Feature, pt: Point): boolean {
    if (isRegion(feature)) {
        return pointInPolygon(pt, regionOutline(feature));
    }
    if (isRoom(feature)) {
        // A room is its exact polygon (terrain regions are the smoothed ones).
        return pointInPolygon(
            pt,
            feature.points.flatMap((p) => [p.x, p.y]),
        );
    }
    if (isStamp(feature)) {
        return pointInPolygon(
            pt,
            stampCorners(feature).flatMap((p) => [p.x, p.y]),
        );
    }
    if (isStroke(feature)) {
        return distanceToPolyline(pt, feature.points) <= feature.radius + PATH_HIT_PADDING;
    }
    if (feature.type === 'pin') {
        return distance(pt, pinPoint(feature)) <= PIN_HIT_RADIUS;
    }
    if (feature.type === 'token') {
        return distance(pt, tokenPoint(feature)) <= TOKEN_HIT_RADIUS;
    }
    if (feature.type === 'zone') {
        return zoneHit(feature, pt);
    }
    if (feature.type === 'shape') {
        return shapeHit(feature, pt);
    }
    if (feature.type === 'label') {
        return pointInPolygon(
            pt,
            labelCorners(feature).flatMap((p) => [p.x, p.y]),
        );
    }
    const maxHalf = feature.halfWidths.reduce((m, w) => Math.max(m, w), 0);
    // Along the curve as drawn, which its handles may bow well away from the straight line between its points.
    return distanceToPolyline(pt, pathSpine(feature, RIBBON_SAMPLES)) <= maxHalf + PATH_HIT_PADDING;
}
