// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The persisted cartography path model (roads / rivers) and its defensive
 * parser. Paths are stored on the scene as a flag; scene flags are untyped
 * JSON, so `parsePaths` validates the shape and drops anything malformed rather
 * than trusting the blob.
 */
import { bezierSpline, type Handle, type Point } from '../geometry/spline';
import { NEW_FEATURE, parseFeatureCommon, type FeatureCommon } from './feature-common';
import { isPoint, isRecord, numberArray, numberOr } from './guards';
import { DEFAULT_WALL_PRESET, isWallPreset, type WallPreset } from './wall-presets';

/** Scene-flag key (under the module-id scope) holding the persisted feature blob. */
export const FLAG_KEY = 'features';

export type PathKind = 'road' | 'river';

/** What a river carries. */
export type Liquid = 'water' | 'lava' | 'poison' | 'acid';

export const LIQUIDS: readonly Liquid[] = ['water', 'lava', 'poison', 'acid'];

/**
 * How a river looks: its liquid, the liquid's shade (0xRRGGBB), and the
 * texture role of the bed laid beneath and beside it (null: no bed).
 */
export interface RiverLook {
    readonly liquid: Liquid;
    readonly shade: number;
    readonly bed: string | null;
}

/** Each liquid's look when first picked: its usual shade, on a bed that suits it. */
export const LIQUID_LOOKS: Readonly<Record<Liquid, RiverLook>> = {
    water: { liquid: 'water', shade: 0x2f5d7c, bed: 'dirt' },
    lava: { liquid: 'lava', shade: 0xff5a1e, bed: 'rock' },
    poison: { liquid: 'poison', shade: 0x5f9e2f, bed: 'marsh' },
    acid: { liquid: 'acid', shade: 0xb5e61d, bed: 'rock' },
};

export interface CartographyPath extends FeatureCommon {
    readonly type: 'path';
    readonly kind: PathKind;
    /** Half-width in scene pixels at each control point (parallel to `points`). */
    readonly halfWidths: number[];
    /**
     * Each control point's Bezier handle (parallel to `points`): the out-handle
     * the pen pulled out there, mirrored behind it, or null for an auto-smooth
     * point (the Catmull-Rom curve every path drawn before handles keeps).
     */
    readonly handles: readonly Handle[];
    /** The kind of Foundry walls along the centerline (a fence, a cliff edge, a canal wall), or null for none. */
    readonly walls: WallPreset | null;
    /** A river's look; null for a road. */
    readonly river: RiverLook | null;
    /** A road's texture role (a chart's pale dirt track); null: the texture set's own road. Null for a river. */
    readonly surface: string | null;
}

// eslint-disable-next-line no-restricted-syntax -- boundary: a persisted liquid arrives as untyped scene-flag JSON; this guard narrows it to Liquid
export function isLiquid(v: unknown): v is Liquid {
    return typeof v === 'string' && (LIQUIDS as readonly string[]).includes(v);
}

/**
 * A persisted river look, field by field over its liquid's defaults. A
 * missing look (a river from before looks) is water on its usual bed; a bed
 * saved as null stays bare.
 */
// eslint-disable-next-line no-restricted-syntax -- boundary: parses a river look from untyped scene-flag JSON
function parseRiverLook(v: unknown): RiverLook {
    if (!isRecord(v)) {
        return LIQUID_LOOKS.water;
    }
    const base = LIQUID_LOOKS[isLiquid(v['liquid']) ? v['liquid'] : 'water'];
    const bed = v['bed'];
    return {
        liquid: base.liquid,
        shade: numberOr(v['shade'], base.shade),
        bed: bed === null || typeof bed === 'string' ? bed : base.bed,
    };
}

// eslint-disable-next-line no-restricted-syntax -- boundary: a persisted path kind arrives as untyped scene-flag JSON; this guard is the validation that narrows it to PathKind
function isPathKind(v: unknown): v is PathKind {
    return v === 'road' || v === 'river';
}

// eslint-disable-next-line no-restricted-syntax -- boundary: parses one untyped scene-flag entry, validating the shape and returning a narrow CartographyPath or null
export function parsePath(v: unknown): CartographyPath | null {
    if (!isRecord(v)) {
        return null;
    }
    if (typeof v['id'] !== 'string' || !isPathKind(v['kind'])) {
        return null;
    }
    const rawPoints: readonly unknown[] = Array.isArray(v['points']) ? v['points'] : [];
    const rawHandles: readonly unknown[] = Array.isArray(v['handles']) ? v['handles'] : [];
    // A handle belongs to the point at its index, so a malformed point drops its handle with it.
    const kept = rawPoints.flatMap((p, i) => (isPoint(p) ? [{ point: { x: p.x, y: p.y }, handle: parseHandle(rawHandles[i]) }] : []));
    const points = kept.map((k) => k.point);
    if (points.length < 2) {
        return null;
    }
    // A missing/short width list is normalised to a uniform default per point.
    const rawWidths = numberArray(v['halfWidths']);
    const halfWidths = points.map((_, i) => rawWidths[i] ?? rawWidths[0] ?? DEFAULT_HALF_WIDTH);
    const river = v['kind'] === 'river' ? parseRiverLook(v['river']) : null;
    const surface = v['kind'] === 'road' && typeof v['surface'] === 'string' ? v['surface'] : null;
    return {
        type: 'path',
        id: v['id'],
        kind: v['kind'],
        points,
        halfWidths,
        handles: kept.map((k) => k.handle),
        walls: parsePathWalls(v['walls']),
        river,
        surface,
        ...parseFeatureCommon(v),
    };
}

/** A persisted handle: a finite offset, or (missing, null or malformed, as every path saved before handles) auto. */
// eslint-disable-next-line no-restricted-syntax -- boundary: narrows a persisted path handle from scene-flag JSON
function parseHandle(v: unknown): Handle {
    return isPoint(v) && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null;
}

/** The handles of `count` points: `handles` where given, auto past its end. */
function handlesFor(count: number, handles: readonly Handle[]): Handle[] {
    return Array.from({ length: count }, (_, i) => {
        const handle = handles[i] ?? null;
        return handle === null ? null : { x: handle.x, y: handle.y };
    });
}

/** A path's smoothed centerline, `samplesPerSegment` samples per span: shaped by its handles, the Catmull-Rom curve where it has none. */
export function pathSpine(path: CartographyPath, samplesPerSegment: number): Point[] {
    return bezierSpline(path.points, path.handles, samplesPerSegment);
}

/** A path's persisted walls: a wall kind, or `true` (the original format) for solid walls; anything else, none. */
// eslint-disable-next-line no-restricted-syntax -- boundary: narrows a persisted path's walls from scene-flag JSON
function parsePathWalls(v: unknown): WallPreset | null {
    if (v === true) {
        return DEFAULT_WALL_PRESET;
    }
    return isWallPreset(v) ? v : null;
}

/** Default half-width (scene px) for a freshly drawn path. */
export const DEFAULT_HALF_WIDTH = 20;

/**
 * Build a committed path from a point stream and a half-width (one for every
 * point, or one each), or null if too short. A river takes `river` as its
 * look; a road has none, whatever is passed, and takes `surface` as its
 * texture role (null: the set's own road). `handles` shape it (one per
 * point; auto where missing).
 */
export function makePath(
    id: string,
    kind: PathKind,
    points: readonly Point[],
    halfWidth: number | readonly number[],
    walls: WallPreset | null,
    river: RiverLook,
    surface: string | null = null,
    handles: readonly Handle[] = [],
): CartographyPath | null {
    if (points.length < 2) {
        return null;
    }
    return {
        type: 'path',
        id,
        kind,
        points: points.map((p) => ({ x: p.x, y: p.y })),
        halfWidths: points.map((_, i) => (typeof halfWidth === 'number' ? halfWidth : halfWidth[i] ?? halfWidth[0] ?? DEFAULT_HALF_WIDTH)),
        handles: handlesFor(points.length, handles),
        walls,
        river: kind === 'river' ? river : null,
        surface: kind === 'road' ? surface : null,
        ...NEW_FEATURE,
    };
}

/**
 * Rebuild a path with new geometry (edit ops), preserving id/kind/walls, or
 * null if invalid: fewer than two points, or widths and handles not one per point.
 */
export function withPathGeometry(
    path: CartographyPath,
    points: readonly Point[],
    halfWidths: readonly number[],
    handles: readonly Handle[],
): CartographyPath | null {
    if (points.length < 2 || points.length !== halfWidths.length || points.length !== handles.length) {
        return null;
    }
    return { ...path, points: points.map((p) => ({ x: p.x, y: p.y })), halfWidths: [...halfWidths], handles: handlesFor(points.length, handles) };
}
