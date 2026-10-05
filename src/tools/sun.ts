// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The sun a scene's drop shadows fall from (operator, 2026-10-05: drawn
 * shadows, option B). A sun is where it stands in the sky: its compass
 * azimuth (0 north, 90 east, as a compass reads it) and its elevation above
 * the horizon, both in degrees. A piece's shadow falls straight away from
 * the sun, as long as the piece stands tall over the tangent of the sun's
 * elevation: long at dawn and dusk, short at noon, gone once the sun is
 * down. Whatever drives a scene's sun (a game system's calendar, the GM)
 * gives these two numbers; the module draws from them. Pure.
 */
import { isRecord } from './guards';

/** Where the sun stands: compass azimuth and elevation above the horizon, in degrees. */
export interface Sun {
    readonly azimuth: number;
    readonly elevation: number;
}

/**
 * The sun of a scene nothing drives: the cartographer's light, high in the
 * north-west, so shadows fall to the south-east as on a drawn map.
 */
export const DEFAULT_SUN: Sun = { azimuth: 315, elevation: 45 };

/** The lowest elevation a shadow's length is taken at: below it the shadow would run off the map. */
const LOWEST_ELEVATION = 8;

/** How dark a shadow is under a sun well up: the art beneath still reads through it. */
export const SHADOW_OPACITY = 0.38;

/** Degrees of elevation over which shadows fade in after sunrise and out before sunset. */
const TWILIGHT = 6;

const RADIANS = Math.PI / 180;

/** Which way a shadow falls, and how far for each unit a piece stands; null once the sun is down. */
export function shadowShift(sun: Sun, stands: number): { readonly x: number; readonly y: number } | null {
    if (sun.elevation <= 0 || stands <= 0) {
        return null;
    }
    const reach = stands / Math.tan(Math.max(sun.elevation, LOWEST_ELEVATION) * RADIANS);
    // Toward the sun on the map is (sin az, -cos az) (y grows south); the shadow falls the other way.
    const azimuth = sun.azimuth * RADIANS;
    return { x: -Math.sin(azimuth) * reach, y: Math.cos(azimuth) * reach };
}

/** How dark shadows are under `sun`: none at night, fading in through the twilight after sunrise. */
export function shadowOpacity(sun: Sun): number {
    if (sun.elevation <= 0) {
        return 0;
    }
    return SHADOW_OPACITY * Math.min(1, sun.elevation / TWILIGHT);
}

/** A stored sun read defensively: both numbers finite, the azimuth turned into 0–360, the elevation within ±90; else null. */
// eslint-disable-next-line no-restricted-syntax -- boundary: a scene flag holds serialised JSON of any shape
export function parseSun(value: unknown): Sun | null {
    if (!isRecord(value)) {
        return null;
    }
    const { azimuth, elevation } = value;
    if (typeof azimuth !== 'number' || typeof elevation !== 'number' || !Number.isFinite(azimuth) || !Number.isFinite(elevation)) {
        return null;
    }
    return { azimuth: ((azimuth % 360) + 360) % 360, elevation: Math.max(-90, Math.min(90, elevation)) };
}
