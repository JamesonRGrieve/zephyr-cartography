// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Drawn shapes: a rectangle, ellipse, polygon or line on the map, realised
 * as a native Drawing, stroked and filled as the map needs (a district's
 * boundary, a patrol route, a blast zone's outline). Foundry's own Drawings
 * tools draw these by hand; a shape feature is how a scene spec or a
 * generator declares one, so it moves, undoes and erases like any feature.
 * A rectangle or ellipse stands at its centre, turned by its rotation; a
 * polygon or line is its vertices. A polygon or line can also carry walls
 * along its outline (a wood's edge that sight carries into but not through);
 * a walled shape drawn with no stroke and no fill is its walls alone, with
 * no Drawing. Pure and unit-tested.
 */
import { distanceToPolyline, pointInPolygon } from '../geometry/hit';
import { localPoint } from '../geometry/rectangle';
import type { Point } from '../geometry/spline';
import { parseCssHex } from './colour';
import { NEW_FEATURE, parseFeatureCommon, type FeatureCommon } from './feature-common';
import { isPoint, isRecord, numberOr } from './guards';

export const SHAPE_KINDS = ['rectangle', 'ellipse', 'polygon', 'line'] as const;

type ShapeKind = (typeof SHAPE_KINDS)[number];

/** What a shape is: a box by its size and rotation, or the vertices its points are. */
export type ShapeGeometry = BoxGeometry | { readonly kind: 'polygon' | 'line' };

/** A rectangle or ellipse, standing at its one point. */
export interface BoxGeometry {
    readonly kind: 'rectangle' | 'ellipse';
    readonly width: number;
    readonly height: number;
    readonly rotation: number;
}

export function isBox(geometry: ShapeGeometry): geometry is BoxGeometry {
    return geometry.kind === 'rectangle' || geometry.kind === 'ellipse';
}

/** How a shape is drawn: its outline, and its fill (null for none). */
export interface ShapeStyle {
    /** `#rrggbb`. */
    readonly strokeColour: string;
    /** Px, a whole number from 0. */
    readonly strokeWidth: number;
    readonly strokeAlpha: number;
    /** `#rrggbb`, or null for no fill. */
    readonly fillColour: string | null;
    readonly fillAlpha: number;
    /** Seen by the GM alone. */
    readonly hidden: boolean;
}

/** Foundry's own look for a new drawing, in white: an 8 px line, unfilled. */
export const DEFAULT_SHAPE_STYLE: ShapeStyle = { strokeColour: '#ffffff', strokeWidth: 8, strokeAlpha: 1, fillColour: null, fillAlpha: 0.5, hidden: false };

// The documents' sense levels, named here as well: the documents' own module reads shapes, so it cannot be read from here.
const SENSE_LEVELS = ['none', 'normal', 'limited', 'proximity', 'distance'] as const;

type SenseLevel = (typeof SENSE_LEVELS)[number];

/** How the walls along a shape's outline restrict sight and light, and whether they bar the way; sound carries. */
export interface ShapeWalls {
    readonly sight: SenseLevel;
    readonly light: SenseLevel;
    readonly movement: boolean;
}

export interface ShapeFeature extends FeatureCommon, ShapeStyle {
    readonly type: 'shape';
    readonly geometry: ShapeGeometry;
    /** Walls along a polygon's or line's outline, or null for none (a box never has them). */
    readonly walls: ShapeWalls | null;
}

/** Whether a shape draws anything: a stroke of some width or a fill. */
export function shapeDrawn(shape: ShapeStyle): boolean {
    return (shape.strokeWidth > 0 && shape.strokeAlpha > 0) || (shape.fillColour !== null && shape.fillAlpha > 0);
}

/** Fewest points each kind stands on. */
const MIN_POINTS: Readonly<Record<ShapeKind, number>> = { rectangle: 1, ellipse: 1, polygon: 3, line: 2 };

/** How near (scene px) a click must be to a line with no width to pick it. */
const LINE_HIT_PADDING = 4;

/** A shape of `geometry` on `points`, or null when they are too few for it, a box has no size, or its style is not one Foundry takes. */
export function makeShape(
    id: string,
    geometry: ShapeGeometry,
    points: readonly Point[],
    style: ShapeStyle = DEFAULT_SHAPE_STYLE,
    walls: ShapeWalls | null = null,
): ShapeFeature | null {
    if (!validGeometry(geometry) || !validStyle(style)) {
        return null;
    }
    // Only a polygon or a line has an outline to wall; walls that block nothing are none.
    const walled = walls !== null && !isBox(geometry) && (walls.sight !== 'none' || walls.light !== 'none' || walls.movement) ? walls : null;
    return withShapePoints({ type: 'shape', id, points: [], geometry, ...style, walls: walled, ...NEW_FEATURE }, points);
}

/** The same shape on other points, or null when they are too few for it (a box takes only its centre). */
export function withShapePoints(shape: ShapeFeature, points: readonly Point[]): ShapeFeature | null {
    const kept = isBox(shape.geometry) ? points.slice(0, 1) : points;
    return kept.length < MIN_POINTS[shape.geometry.kind] ? null : { ...shape, points: kept.map((p) => ({ x: p.x, y: p.y })) };
}

function validGeometry(geometry: ShapeGeometry): boolean {
    if (!isBox(geometry)) {
        return true;
    }
    return [geometry.width, geometry.height].every((size) => Number.isFinite(size) && size > 0) && Number.isFinite(geometry.rotation);
}

const unit = (alpha: number): boolean => Number.isFinite(alpha) && alpha >= 0 && alpha <= 1;

function validStyle(style: ShapeStyle): boolean {
    return (
        parseCssHex(style.strokeColour) !== null &&
        (style.fillColour === null || parseCssHex(style.fillColour) !== null) &&
        Number.isInteger(style.strokeWidth) &&
        style.strokeWidth >= 0 &&
        unit(style.strokeAlpha) &&
        unit(style.fillAlpha)
    );
}

/**
 * A shape as a Drawing lays it out: its box's centre, whole-pixel size and
 * rotation, Foundry's shape type, and a polygon's or line's points relative
 * to the box's top-left, a polygon closed by its first point again.
 */
export interface ShapeBox {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly rotation: number;
    /** `ShapeData.TYPES`: rectangle, ellipse, polygon. */
    readonly shape: 'r' | 'e' | 'p';
    readonly points: readonly number[];
}

export function shapeBox(shape: ShapeFeature): ShapeBox {
    const { geometry } = shape;
    if (isBox(geometry)) {
        const centre = shape.points[0] ?? { x: 0, y: 0 };
        const size = (px: number): number => Math.max(1, Math.round(px));
        const type = geometry.kind === 'rectangle' ? 'r' : 'e';
        return { ...centre, width: size(geometry.width), height: size(geometry.height), rotation: geometry.rotation, shape: type, points: [] };
    }
    const xs = shape.points.map((p) => p.x);
    const ys = shape.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = Math.max(1, Math.ceil(Math.max(...xs) - minX));
    const height = Math.max(1, Math.ceil(Math.max(...ys) - minY));
    const [first] = shape.points;
    const path = geometry.kind === 'polygon' && first ? [...shape.points, first] : shape.points;
    return {
        x: minX + width / 2,
        y: minY + height / 2,
        width,
        height,
        rotation: 0,
        shape: 'p',
        points: path.flatMap((p) => [p.x - minX, p.y - minY]),
    };
}

/** Whether `pt` falls on the shape: inside a box or polygon, or on a line within half its width. */
export function shapeHit(shape: ShapeFeature, pt: Point): boolean {
    const { geometry } = shape;
    if (!isBox(geometry)) {
        return geometry.kind === 'polygon'
            ? pointInPolygon(
                  pt,
                  shape.points.flatMap((p) => [p.x, p.y]),
              )
            : distanceToPolyline(pt, shape.points) <= shape.strokeWidth / 2 + LINE_HIT_PADDING;
    }
    const { x, y } = localPoint(shape.points[0] ?? { x: 0, y: 0 }, geometry.rotation, pt);
    const rx = geometry.width / 2;
    const ry = geometry.height / 2;
    return geometry.kind === 'rectangle' ? Math.abs(x) <= rx && Math.abs(y) <= ry : (x / rx) ** 2 + (y / ry) ** 2 <= 1;
}

/** A shape's style from one untyped scene-flag entry, each field valid or Foundry's default. */
// eslint-disable-next-line no-restricted-syntax -- boundary: reads a persisted shape's style from scene-flag JSON
function parseStyle(v: Record<string, unknown>): ShapeStyle {
    const colour = (field: string): string | null => {
        const value = v[field];
        return typeof value === 'string' && parseCssHex(value) !== null ? value : null;
    };
    const alpha = (field: string, fallback: number): number => {
        const value = numberOr(v[field], fallback);
        return unit(value) ? value : fallback;
    };
    const width = numberOr(v['strokeWidth'], DEFAULT_SHAPE_STYLE.strokeWidth);
    return {
        strokeColour: colour('strokeColour') ?? DEFAULT_SHAPE_STYLE.strokeColour,
        strokeWidth: Number.isInteger(width) && width >= 0 ? width : DEFAULT_SHAPE_STYLE.strokeWidth,
        strokeAlpha: alpha('strokeAlpha', DEFAULT_SHAPE_STYLE.strokeAlpha),
        fillColour: colour('fillColour'),
        fillAlpha: alpha('fillAlpha', DEFAULT_SHAPE_STYLE.fillAlpha),
        hidden: v['hidden'] === true,
    };
}

// eslint-disable-next-line no-restricted-syntax -- boundary: reads a persisted shape's geometry from scene-flag JSON
function parseGeometry(v: unknown): ShapeGeometry | null {
    if (!isRecord(v)) {
        return null;
    }
    const kind = SHAPE_KINDS.find((k) => k === v['kind']);
    if (kind === 'polygon' || kind === 'line') {
        return { kind };
    }
    return kind === undefined ? null : { kind, width: numberOr(v['width'], 0), height: numberOr(v['height'], 0), rotation: numberOr(v['rotation'], 0) };
}

// eslint-disable-next-line no-restricted-syntax -- boundary: reads a persisted shape's walls from scene-flag JSON
function parseWalls(v: unknown): ShapeWalls | null {
    if (!isRecord(v)) {
        return null;
    }
    const level = (field: string): SenseLevel => SENSE_LEVELS.find((l) => l === v[field]) ?? 'none';
    return { sight: level('sight'), light: level('light'), movement: v['movement'] === true };
}

// eslint-disable-next-line no-restricted-syntax -- boundary: parses one untyped scene-flag entry, validating shape and returning a narrow ShapeFeature or null
export function parseShape(v: unknown): ShapeFeature | null {
    if (!isRecord(v) || v['type'] !== 'shape' || typeof v['id'] !== 'string' || !Array.isArray(v['points'])) {
        return null;
    }
    const geometry = parseGeometry(v['geometry']);
    const shape = geometry && makeShape(v['id'], geometry, v['points'].filter(isPoint), parseStyle(v), parseWalls(v['walls']));
    return shape && { ...shape, ...parseFeatureCommon(v) };
}
