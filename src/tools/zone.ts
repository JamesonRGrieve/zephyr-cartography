// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Zones: a Scene Region in one of Foundry's own shapes (circle, ellipse,
 * ring, cone, line or rectangle; 14.349–14.356), placed at a point. A zone is
 * an area, so it takes a movement cost, region behaviours and a display like
 * painted ground and rooms, and its region is always there. It may be
 * attached to a token (`attachment.token`, 14.356), whereupon Foundry moves
 * the region with the token and the zone follows it. Sizes are scene px, and
 * `gridBased` has Foundry measure the shape in grid units instead. Pure and
 * unit-tested.
 */
import { localPoint } from '../geometry/rectangle';
import type { Point } from '../geometry/spline';
import { type Affected, parseAreaFields } from './area-effects';
import type { RegionTarget, SubmapTravel } from './documents';
import { NEW_FEATURE, parseFeatureCommon, type FeatureCommon } from './feature-common';
import { isPoint, isRecord, numberOr, stringOrNull } from './guards';
import { parseTravel } from './submap';
import type { Costed } from './terrain-cost';
import { type CellOffset, CONE_CURVATURES, type ConeCurvature, ZONE_SHAPES, type ZoneShape, type ZoneShapeKind } from './zone-shape';

/** What the zone panel edits. */
export interface ZoneSettings {
    /** The region's name; "" for the module's own. */
    readonly name: string;
    readonly shape: ZoneShape;
    /** Degrees. */
    readonly rotation: number;
    /** Measured in grid units, conforming to the grid, rather than exactly in px. */
    readonly gridBased: boolean;
    /** The token (by id, on this scene) the region moves with; null for none. */
    readonly attachedTo: string | null;
}

/**
 * A zone that is a way to another map: its region has the fixed id `region`
 * (so the other map's way can name it before either exists) and teleports a
 * token that enters it to one of `targets`, travelling by `travel`. No
 * targets yet is a way still to be linked (a house's door on a town map with
 * no interior map), which takes no one anywhere.
 */
export interface ZoneLink {
    readonly region: string;
    readonly targets: readonly RegionTarget[];
    readonly travel: SubmapTravel;
}

/** A zone; its one point is where its shape is placed. */
export interface ZoneFeature extends FeatureCommon, ZoneSettings, Costed, Affected {
    readonly type: 'zone';
    /** A way to another map (a door, a ramp, a map's edge); absent for a plain zone. */
    readonly link?: ZoneLink;
}

/** A new zone's size (px): a circle this wide across three grid squares at Foundry's default 100 px grid. */
const NEW_ZONE_SIZE = 150;

export const NEW_ZONE: ZoneSettings = { name: '', shape: { kind: 'circle', radius: NEW_ZONE_SIZE }, rotation: 0, gridBased: false, attachedTo: null };

/** Degrees in a turn: the widest a round cone spreads. */
export const FULL_TURN = 360;

/** The widest spread a cone of each curvature can have (`ConeShapeData.validateJoint`). */
const MAX_CONE_ANGLE: Readonly<Record<ConeCurvature, number>> = { round: FULL_TURN, flat: 90, semicircle: 180 };

const RING_WIDTH_SHARE = 0.25;
const LINE_WIDTH_SHARE = 0.25;
const CONE_ANGLE = 90;
const HALF = 0.5;

export function makeZone(id: string, at: Point, settings: ZoneSettings = NEW_ZONE): ZoneFeature {
    return { type: 'zone', id, points: [{ x: at.x, y: at.y }], ...settings, ...NEW_FEATURE };
}

/** Where the zone is placed. */
export function zonePoint(zone: ZoneFeature): Point {
    return zone.points[0] ?? { x: 0, y: 0 };
}

/** What the zone panel edits of `zone`. */
export function zoneSettingsOf(zone: ZoneFeature): ZoneSettings {
    return { name: zone.name, shape: zone.shape, rotation: zone.rotation, gridBased: zone.gridBased, attachedTo: zone.attachedTo };
}

/** The same zone with other settings, or null when its shape is not one Foundry takes. */
export function withZoneSettings(zone: ZoneFeature, settings: ZoneSettings): ZoneFeature | null {
    return validZoneShape(settings.shape) && Number.isFinite(settings.rotation) ? { ...zone, ...settings } : null;
}

/** The zone placed at `at`, turned to `rotation` (the way its attached token has moved it). */
export function withZonePlace(zone: ZoneFeature, at: Point, rotation: number): ZoneFeature {
    return { ...zone, points: [{ x: at.x, y: at.y }], rotation };
}

/**
 * Whether Foundry takes `shape`: every size finite and positive, a ring's
 * band inside its centre, a cone's spread within its curvature's, and grid
 * spaces at least one, each once, on a grid with a size.
 */
export function validZoneShape(shape: ZoneShape): boolean {
    if (shape.kind === 'cells') {
        const keys = new Set(shape.cells.map((c) => `${c.i},${c.j}`));
        return Number.isFinite(shape.size) && shape.size > 0 && shape.cells.length > 0 && keys.size === shape.cells.length && shape.cells.every(wholeCell);
    }
    const sizes = Object.values(shapeSizes(shape));
    if (!sizes.every((size) => Number.isFinite(size) && size > 0)) {
        return false;
    }
    if (shape.kind === 'ring') {
        return shape.innerWidth <= shape.radius;
    }
    if (shape.kind === 'cone') {
        return shape.angle <= MAX_CONE_ANGLE[shape.curvature];
    }
    return true;
}

/** `shape` with its size `field` set to `value`, or null if it has no such size or Foundry would not take it. */
export function withShapeSize(shape: ZoneShape, field: string, value: number): ZoneShape | null {
    if (!(field in shapeSizes(shape))) {
        return null;
    }
    const next = { ...shape, [field]: value };
    return validZoneShape(next) ? next : null;
}

/** `shape` with every length times `factor` (a cone's angle is no length). */
export function scaledZoneShape(shape: ZoneShape, factor: number): ZoneShape {
    const s = (size: number): number => size * factor;
    switch (shape.kind) {
        case 'circle':
            return { ...shape, radius: s(shape.radius) };
        case 'ellipse':
            return { ...shape, radiusX: s(shape.radiusX), radiusY: s(shape.radiusY) };
        case 'ring':
            return { ...shape, radius: s(shape.radius), innerWidth: s(shape.innerWidth), outerWidth: s(shape.outerWidth) };
        case 'cone':
            return { ...shape, radius: s(shape.radius) };
        case 'line':
            return { ...shape, length: s(shape.length), width: s(shape.width) };
        case 'cells':
            // Grid spaces stay the spaces they are; only the cell size is a length.
            return { ...shape, size: s(shape.size) };
        case 'emanation':
            return { ...shape, radius: s(shape.radius) };
        case 'rectangle':
            break;
    }
    return { ...shape, width: s(shape.width), height: s(shape.height) };
}

/** A cone with another curvature, its spread narrowed to what that curvature allows. */
export function withCurvature(cone: Extract<ZoneShape, { kind: 'cone' }>, curvature: ConeCurvature): ZoneShape {
    return { ...cone, curvature, angle: Math.min(cone.angle, MAX_CONE_ANGLE[curvature]) };
}

function wholeCell(cell: CellOffset): boolean {
    return Number.isInteger(cell.i) && Number.isInteger(cell.j);
}

/** A block of grid spaces `rows` by `columns`, from the zone's own cell. */
export function cellBlock(rows: number, columns: number): CellOffset[] {
    return Array.from({ length: rows * columns }, (_, n) => ({ i: Math.floor(n / columns), j: n % columns }));
}

/** How many rows and columns grid spaces span. */
export function cellExtent(cells: readonly CellOffset[]): { readonly rows: number; readonly columns: number } {
    const span = (values: readonly number[]): number => (values.length === 0 ? 0 : Math.max(...values) - Math.min(...values) + 1);
    return { rows: span(cells.map((c) => c.i)), columns: span(cells.map((c) => c.j)) };
}

/** The zone's grid spaces, absolute (row, column), from the cell its point `at` is in on a grid of `size` px. */
export function absoluteCells(at: Point, shape: Extract<ZoneShape, { kind: 'cells' }>): CellOffset[] {
    const i0 = Math.floor(at.y / shape.size);
    const j0 = Math.floor(at.x / shape.size);
    return shape.cells.map((c) => ({ i: i0 + c.i, j: j0 + c.j }));
}

/** A shape's sizes by name (px, or degrees for a cone's angle); grid spaces have none but their count. */
export function shapeSizes(shape: ZoneShape): Readonly<Record<string, number>> {
    if (shape.kind === 'cells') {
        return {};
    }
    const { kind: _kind, ...rest } = shape;
    const sizes: Record<string, number> = {};
    for (const [field, value] of Object.entries(rest)) {
        if (typeof value === 'number') {
            sizes[field] = value;
        }
    }
    return sizes;
}

/** Its reach: the radius, half the diagonal, or the length, that a new shape keeps when the GM picks another kind. */
function reach(shape: ZoneShape): number {
    switch (shape.kind) {
        case 'ellipse':
            return Math.max(shape.radiusX, shape.radiusY);
        case 'line':
            return shape.length * HALF;
        case 'rectangle':
            return Math.max(shape.width, shape.height) * HALF;
        case 'cells': {
            const { rows, columns } = cellExtent(shape.cells);
            return Math.max(rows, columns) * shape.size * HALF;
        }
        case 'circle':
        case 'ring':
        case 'cone':
        case 'emanation':
            break;
    }
    return shape.radius;
}

/**
 * A shape of `kind` about as big as `from`, for when the GM picks another
 * kind; grid spaces take a square block on a grid of `cellSize` px (a circle
 * without one).
 */
export function reshapedZone(kind: ZoneShapeKind, from: ZoneShape, cellSize: number | null): ZoneShape {
    const size = reach(from);
    switch (kind) {
        case 'cells': {
            if (cellSize === null || !(cellSize > 0)) {
                break;
            }
            const side = Math.max(1, Math.round((size * 2) / cellSize));
            return { kind, size: cellSize, cells: cellBlock(side, side) };
        }
        case 'ellipse':
            return { kind, radiusX: size, radiusY: size * HALF };
        case 'ring':
            return { kind, radius: size, innerWidth: size * RING_WIDTH_SHARE, outerWidth: size * RING_WIDTH_SHARE };
        case 'cone':
            return { kind, radius: size, angle: CONE_ANGLE, curvature: 'round' };
        case 'line':
            return { kind, length: size * 2, width: size * LINE_WIDTH_SHARE };
        case 'rectangle':
            return { kind, width: size * 2, height: size * 2 };
        case 'emanation':
            return { kind, radius: size };
        case 'circle':
            break;
    }
    return { kind: 'circle', radius: size };
}

/** Whether `pt` falls in the zone, by its exact shape (grid-based shapes by their px shape). */
export function zoneHit(zone: ZoneFeature, pt: Point): boolean {
    const shape = zone.shape;
    if (shape.kind === 'cells') {
        const [here] = absoluteCells(pt, { ...shape, cells: [{ i: 0, j: 0 }] });
        return here !== undefined && absoluteCells(zonePoint(zone), shape).some((c) => c.i === here.i && c.j === here.j);
    }
    const { x, y } = localPoint(zonePoint(zone), zone.rotation, pt);
    const d = Math.hypot(x, y);
    switch (shape.kind) {
        // An emanation is picked by the circle its radius makes about the zone's point, the token's centre it follows.
        case 'circle':
        case 'emanation':
            return d <= shape.radius;
        case 'ellipse':
            return (x / shape.radiusX) ** 2 + (y / shape.radiusY) ** 2 <= 1;
        case 'ring':
            return d >= shape.radius - shape.innerWidth && d <= shape.radius + shape.outerWidth;
        case 'cone': {
            const off = Math.abs((Math.atan2(y, x) * (FULL_TURN / 2)) / Math.PI);
            return d <= shape.radius && off <= shape.angle * HALF;
        }
        case 'line':
            return x >= 0 && x <= shape.length && Math.abs(y) <= shape.width * HALF;
        case 'rectangle':
            break;
    }
    return Math.abs(x) <= shape.width * HALF && Math.abs(y) <= shape.height * HALF;
}

/** A persisted zone shape, or null when it is not one Foundry takes. */
// eslint-disable-next-line no-restricted-syntax -- boundary: parses a persisted zone shape from scene-flag or setting JSON
export function parseZoneShape(v: unknown): ZoneShape | null {
    if (!isRecord(v)) {
        return null;
    }
    const kind = ZONE_SHAPES.find((k) => k === v['kind']);
    if (kind === undefined) {
        return null;
    }
    const size = (field: string): number => numberOr(v[field], Number.NaN);
    const shapes: Readonly<Record<ZoneShapeKind, () => ZoneShape>> = {
        circle: () => ({ kind: 'circle', radius: size('radius') }),
        ellipse: () => ({ kind: 'ellipse', radiusX: size('radiusX'), radiusY: size('radiusY') }),
        ring: () => ({ kind: 'ring', radius: size('radius'), innerWidth: size('innerWidth'), outerWidth: size('outerWidth') }),
        cone: () => ({
            kind: 'cone',
            radius: size('radius'),
            angle: size('angle'),
            curvature: CONE_CURVATURES.find((c) => c === v['curvature']) ?? 'round',
        }),
        line: () => ({ kind: 'line', length: size('length'), width: size('width') }),
        rectangle: () => ({ kind: 'rectangle', width: size('width'), height: size('height') }),
        cells: () => ({ kind: 'cells', size: size('size'), cells: parseCells(v['cells']) }),
        emanation: () => ({ kind: 'emanation', radius: size('radius') }),
    };
    const shape = shapes[kind]();
    return validZoneShape(shape) ? shape : null;
}

// eslint-disable-next-line no-restricted-syntax -- boundary: narrows persisted grid spaces from scene-flag JSON
function parseCells(v: unknown): CellOffset[] {
    return (Array.isArray(v) ? v : []).flatMap((cell) =>
        isRecord(cell) && typeof cell['i'] === 'number' && typeof cell['j'] === 'number' ? [{ i: cell['i'], j: cell['j'] }] : [],
    );
}

// eslint-disable-next-line no-restricted-syntax -- boundary: parses one untyped scene-flag entry, validating shape and returning a narrow ZoneFeature or null
export function parseZone(v: unknown): ZoneFeature | null {
    if (!isRecord(v) || v['type'] !== 'zone' || typeof v['id'] !== 'string' || !Array.isArray(v['points'])) {
        return null;
    }
    const [at] = v['points'].filter(isPoint);
    const shape = parseZoneShape(v['shape']);
    if (at === undefined || shape === null) {
        return null;
    }
    const zone = makeZone(v['id'], at, {
        name: typeof v['name'] === 'string' ? v['name'] : '',
        shape,
        rotation: numberOr(v['rotation'], 0),
        gridBased: v['gridBased'] === true,
        attachedTo: stringOrNull(v['attachedTo']),
    });
    const link = parseZoneLink(v['link']);
    return { ...zone, ...parseAreaFields(v), ...parseFeatureCommon(v), ...(link === null ? {} : { link }) };
}

/** A persisted way to another map, or null when there is none or it names no region of its own. */
// eslint-disable-next-line no-restricted-syntax -- boundary: parses a zone's persisted link from scene-flag JSON
export function parseZoneLink(v: unknown): ZoneLink | null {
    if (!isRecord(v) || typeof v['region'] !== 'string' || v['region'] === '') {
        return null;
    }
    const targets = (Array.isArray(v['targets']) ? v['targets'] : []).flatMap((t): RegionTarget[] =>
        isRecord(t) && typeof t['scene'] === 'string' && typeof t['region'] === 'string' && t['scene'] !== '' && t['region'] !== ''
            ? [{ scene: t['scene'], region: t['region'] }]
            : [],
    );
    return { region: v['region'], targets, travel: parseTravel(v['travel']) };
}
