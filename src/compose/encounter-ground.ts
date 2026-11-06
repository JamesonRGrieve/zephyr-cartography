// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * An encounter's open ground painted as a map artist paints it (operator 2026-10-19: "Paint open ground as map artists
 * do: splat masks, never patches"): one mask over the whole map whose channels weight the landscape's own ground, its
 * patches of another ground (longer grass, mud, bare sand), and worn earth or rock where its rocks, ruins and camps
 * stand, each broken by seeded noise. Pure and seeded, so the same checklist paints the same ground; the mask travels in
 * the intent as a PNG data URL, which the splat loader fetches like any other image.
 */
import { type Random, seededRandom } from '../generate/random';
import { encodeStoredPng } from '../tools/png';

/** Mask pixels per grid square: the blend is bilinear between them, so a few a square paint soft, even edges. */
export const GROUND_PX = 4;

/** Squares over which earth under a rock field or camp fades into the ground round it. */
const EARTH_FADE = 2.5;
/** Feature size, in squares, of the noise breaking the earth's edge, and of the ground's patches. */
const EARTH_NOISE = 3;
const PATCH_NOISE = 6;
/** The noise level the patches start at and are full by, and how much of the ground at most they take. */
const PATCH_FROM = 0.5;
const PATCH_FULL = 0.72;
const PATCH_SHARE = 0.75;
/** How much of the earth's weight its noise can take away, at most, and the most it ever weighs: worn ground, never bare. */
const EARTH_BREAK = 0.55;
const EARTH_MOST = 0.85;
/** The share of a field's radius its earth reaches before fading: its stones stand on worn ground, its edge on the grass. */
const EARTH_REACH = 0.7;
const CHANNEL_MAX = 255;
const RGBA = 4;

/** A circle of ground worn to earth or rock: a rock field, a ruin, a camp. */
export interface EarthCircle {
    readonly centre: { readonly x: number; readonly y: number };
    readonly radius: number;
}

export interface GroundPaint {
    readonly width: number;
    readonly height: number;
    readonly seed: number;
    /** The texture roles of the ground, its patches and its worn earth or rock: the mask's red, green and blue. */
    readonly roles: readonly [string, string, string];
    readonly earth: readonly EarthCircle[];
}

/** A splat as the intent takes it: its mask and its channels' roles. */
export interface PaintedGround {
    readonly mask: string;
    readonly roles: readonly [string, string, string, null];
}

/** Smooth value noise in [0, 1], its features about `scale` squares across, two octaves, seeded. */
function valueNoise(random: Random, width: number, height: number, scale: number): (x: number, y: number) => number {
    const octaves = [scale, scale / 2].map((size) => {
        const cols = Math.ceil(width / size) + 2;
        const rows = Math.ceil(height / size) + 2;
        const grid = Array.from({ length: cols * rows }, () => random());
        return { size, cols, grid };
    });
    const ease = (t: number): number => t * t * (3 - 2 * t);
    const at = (o: { size: number; cols: number; grid: number[] }, x: number, y: number): number => {
        const gx = x / o.size;
        const gy = y / o.size;
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const tx = ease(gx - ix);
        const ty = ease(gy - iy);
        const v = (cx: number, cy: number): number => o.grid[cy * o.cols + cx] ?? 0;
        const upper = v(ix, iy) * (1 - tx) + v(ix + 1, iy) * tx;
        const lower = v(ix, iy + 1) * (1 - tx) + v(ix + 1, iy + 1) * tx;
        return upper * (1 - ty) + lower * ty;
    };
    return (x, y) => octaves.reduce((sum, o, i) => sum + at(o, x, y) * (i === 0 ? 2 / 3 : 1 / 3), 0);
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Base64 of `bytes`, as a data URL carries them. */
function base64(bytes: Uint8Array): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
        const n = (a << 16) | (b << 8) | c;
        const left = bytes.length - i;
        out += alphabet[(n >> 18) & 63] ?? '';
        out += alphabet[(n >> 12) & 63] ?? '';
        out += left > 1 ? alphabet[(n >> 6) & 63] ?? '' : '=';
        out += left > 2 ? alphabet[n & 63] ?? '' : '=';
    }
    return out;
}

/** The ground's weights at a point: its patches' and its worn earth's (the landscape's own takes the rest). */
export function groundWeights(paint: GroundPaint): (x: number, y: number) => { patch: number; earth: number } {
    const random = seededRandom(paint.seed);
    const earthNoise = valueNoise(random, paint.width, paint.height, EARTH_NOISE);
    const patchNoise = valueNoise(random, paint.width, paint.height, PATCH_NOISE);
    return (x, y) => {
        const near = paint.earth.reduce((best, c) => Math.min(best, Math.hypot(x - c.centre.x, y - c.centre.y) - c.radius * EARTH_REACH), Infinity);
        // A field's worn ground solid only toward its middle, broken by noise (2026-11-06 preview: whole fields drew as
        // one brown mass over a tundra's snow).
        const earth = clamp01(1 - near / EARTH_FADE) * (EARTH_MOST - EARTH_BREAK * earthNoise(x, y));
        const patch = clamp01((patchNoise(x, y) - PATCH_FROM) / (PATCH_FULL - PATCH_FROM)) * PATCH_SHARE * (1 - earth);
        return { patch, earth };
    };
}

/** Paint the encounter's ground: a mask over the whole map, as a PNG data URL, and its channels' roles. */
export function paintGround(paint: GroundPaint): PaintedGround {
    const w = paint.width * GROUND_PX;
    const h = paint.height * GROUND_PX;
    const weigh = groundWeights(paint);
    const pixels = new Uint8ClampedArray(w * h * RGBA);
    for (let py = 0; py < h; py += 1) {
        for (let px = 0; px < w; px += 1) {
            const { patch, earth } = weigh((px + 0.5) / GROUND_PX, (py + 0.5) / GROUND_PX);
            const g = Math.round(patch * CHANNEL_MAX);
            const b = Math.round(earth * CHANNEL_MAX);
            const i = (py * w + px) * RGBA;
            // The weights always sum to a whole: what the patches and the earth leave is the landscape's own ground.
            pixels[i] = Math.max(0, CHANNEL_MAX - g - b);
            pixels[i + 1] = g;
            pixels[i + 2] = b;
            pixels[i + 3] = 0;
        }
    }
    const png = encodeStoredPng({ width: w, height: h, pixels });
    return { mask: `data:image/png;base64,${base64(png)}`, roles: [...paint.roles, null] };
}
