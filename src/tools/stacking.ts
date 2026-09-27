// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stamps stacked on stamps: a tankard on a bar, a meal on a table, papers on
 * a desk. A stamp that lies wholly on a surface stamp (a table, a bar, a
 * desk) of its level stands on it, at the surface's top: its elevation is
 * the surface's plus the surface's height. Foundry draws what is higher
 * above what is lower, so the tankard is always drawn on the bar, never
 * under it, whatever order they were placed in. Pure and unit-tested.
 */
import { pointInPolygon } from '../geometry/hit';
import { onLevel } from './levels';
import { stampCorners, type StampFeature } from './stamp';

/** Grid squares a surface stands above its floor when its pack gives it no height: a table's, about 2.5 ft at 5 ft squares. */
const SURFACE_HEIGHT_SQUARES = 0.5;

/** Scene distance units per grid square to assume when the scene has none. */
const UNKNOWN_GRID_DISTANCE = 1;

const area = (f: StampFeature): number => f.width * f.height;

/**
 * The elevation `placed` stands at when set on the highest surface among
 * `others` that holds its whole footprint on its level (and is bigger than
 * it), or null when it stands on none.
 */
export function stackedElevation(
    placed: StampFeature,
    others: readonly StampFeature[],
    isSurface: (stamp: StampFeature) => boolean,
    gridDistance: number,
): number | null {
    const corners = stampCorners(placed);
    const perSquare = gridDistance > 0 ? gridDistance : UNKNOWN_GRID_DISTANCE;
    const tops = others
        .filter((other) => other.id !== placed.id && isSurface(other) && area(other) > area(placed))
        .filter((other) => onLevel(other.level, placed.level))
        .filter((other) => {
            const outline = stampCorners(other).flatMap((p) => [p.x, p.y]);
            return corners.every((c) => pointInPolygon(c, outline));
        })
        .map((other) => other.elevation + (other.behaviour.physical?.height ?? SURFACE_HEIGHT_SQUARES) * perSquare);
    return tops.length > 0 ? Math.max(...tops) : null;
}
