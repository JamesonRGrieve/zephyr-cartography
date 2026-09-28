// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Biome/terrain regions — the Inkarnate-style landscaping feature: a closed,
 * smoothed, filled area of a single biome (water, grassland, forest, …). Model
 * + defensive parser + the smoothed fill outline. Pure and unit-tested.
 */
import { closedSpline, type Point } from '../geometry/spline';
import { parseAreaFields, type Affected } from './area-effects';
import { isBiomeKind, type BiomeKind } from './biome';
import { NEW_FEATURE, parseFeatureCommon, type FeatureCommon } from './feature-common';
import { isPoint, isRecord, stringOrNull } from './guards';
import type { Costed } from './terrain-cost';
import type { Textured } from './texture';

/** Default half-count of samples per region-boundary span. */
const REGION_SAMPLES = 10;

/**
 * A closed biome area; its `points` are the boundary control points (>= 3).
 * A `sharp` one is its exact polygon with a crisp edge (a deck, a paved yard,
 * storm doors), not a smoothed, feathered outline.
 */
export interface RegionFeature extends FeatureCommon, Costed, Affected, Textured {
    readonly type: 'region';
    readonly biome: BiomeKind;
    readonly sharp: boolean;
}

/** Build a committed region from a boundary point stream, or null if too small; `texture` null draws the biome's own. */
export function makeRegion(id: string, biome: BiomeKind, points: readonly Point[], texture: string | null, sharp = false): RegionFeature | null {
    if (points.length < 3) {
        return null;
    }
    return { type: 'region', id, biome, texture, sharp, points: points.map((p) => ({ x: p.x, y: p.y })), ...NEW_FEATURE };
}

/** Rebuild a region with new boundary points (edit ops), preserving id/biome, or null if < 3. */
export function withRegionPoints(region: RegionFeature, points: readonly Point[]): RegionFeature | null {
    if (points.length < 3) {
        return null;
    }
    return { ...region, points: points.map((p) => ({ x: p.x, y: p.y })) };
}

/** A region's closed fill polygon `[x, y, …]`: its boundary smoothed, or exactly its points when it is sharp. */
export function regionOutline({ points, sharp }: Pick<RegionFeature, 'points' | 'sharp'>): number[] {
    const boundary = sharp ? points : closedSpline(points, REGION_SAMPLES);
    const flat: number[] = [];
    for (const p of boundary) {
        flat.push(p.x, p.y);
    }
    return flat;
}

/** Defensive parser for a persisted region (scene-flag JSON is untyped). */
// eslint-disable-next-line no-restricted-syntax -- boundary: parses one untyped scene-flag entry, validating the shape and returning a narrow RegionFeature or null
export function parseRegion(v: unknown): RegionFeature | null {
    if (!isRecord(v)) {
        return null;
    }
    if (v['type'] !== 'region' || typeof v['id'] !== 'string' || !isBiomeKind(v['biome'])) {
        return null;
    }
    const points = Array.isArray(v['points']) ? v['points'].filter(isPoint) : [];
    const region = makeRegion(v['id'], v['biome'], points, stringOrNull(v['texture']), v['sharp'] === true);
    return region && { ...region, ...parseAreaFields(v), ...parseFeatureCommon(v) };
}
