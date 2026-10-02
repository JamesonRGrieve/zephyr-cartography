// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A zone's shape: one of Foundry's own region shapes, sized in scene px.
 * Kept apart from the zone feature so the region documents can name it
 * without depending on zones. Types and vocabularies only.
 */

/** Foundry's region shape types a zone can take (`BaseShapeData.TYPES`); `cells` is its grid-spaces shape. */
export const ZONE_SHAPES = ['circle', 'ellipse', 'ring', 'cone', 'line', 'rectangle', 'cells', 'emanation'] as const;

export type ZoneShapeKind = (typeof ZONE_SHAPES)[number];

/** A grid cell by its row `i` and column `j`, from the cell the zone's point is in. */
export interface CellOffset {
    readonly i: number;
    readonly j: number;
}

/** A cone's far edge: an arc, a straight edge, or a half circle (`ConeShapeData` `curvature`). */
export const CONE_CURVATURES = ['round', 'flat', 'semicircle'] as const;

export type ConeCurvature = (typeof CONE_CURVATURES)[number];

/**
 * A zone's shape and size, in scene px. A circle, ellipse or ring is centred
 * on the zone's point; a cone or line starts there and points along its
 * rotation; a rectangle is centred there.
 */
export type ZoneShape =
    | { readonly kind: 'circle'; readonly radius: number }
    | { readonly kind: 'ellipse'; readonly radiusX: number; readonly radiusY: number }
    /** The band runs from `radius - innerWidth` to `radius + outerWidth`. */
    | { readonly kind: 'ring'; readonly radius: number; readonly innerWidth: number; readonly outerWidth: number }
    /** `angle` is the cone's spread, in degrees. */
    | { readonly kind: 'cone'; readonly radius: number; readonly angle: number; readonly curvature: ConeCurvature }
    | { readonly kind: 'line'; readonly length: number; readonly width: number }
    | { readonly kind: 'rectangle'; readonly width: number; readonly height: number }
    /**
     * Whole spaces of a square grid (`GridShapeData`), relative to the one
     * the zone's point is in, so moving the zone moves them by whole cells.
     * `size` is the grid's cell size (px) it was made on.
     */
    | { readonly kind: 'cells'; readonly size: number; readonly cells: readonly CellOffset[] }
    /**
     * `radius` px round the attached token's own footprint (Foundry's
     * emanation), which Foundry keeps fitted to the token as it moves; a
     * circle at the zone's point while no token is attached.
     */
    | { readonly kind: 'emanation'; readonly radius: number };
