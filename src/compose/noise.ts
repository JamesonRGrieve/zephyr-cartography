// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Seeded, smooth 2D value noise for composing: where trees clump, how a
 * zone's edge wanders. Values lie in [0, 1) and vary smoothly over roughly
 * `scale` squares. Pure and unit-tested.
 */
import type { Random } from '../generate/random';

/** Lattice values per side of the repeating noise table: it repeats only every 64 features. */
const TABLE_SIZE = 64;

/** Octaves summed for a field: each half the scale and half the weight of the last. */
const OCTAVES = 3;

/** A smooth field over the plane: its value at (x, y), in [0, 1). */
export type NoiseField = (x: number, y: number) => number;

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** A seeded noise field whose features are about `scale` squares across. */
export function noiseField(random: Random, scale: number): NoiseField {
    const values = Array.from({ length: TABLE_SIZE * TABLE_SIZE }, () => random());
    const at = (ix: number, iy: number): number => {
        const i = ((ix % TABLE_SIZE) + TABLE_SIZE) % TABLE_SIZE;
        const j = ((iy % TABLE_SIZE) + TABLE_SIZE) % TABLE_SIZE;
        return values[j * TABLE_SIZE + i] ?? 0;
    };
    const octave = (x: number, y: number): number => {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const tx = smooth(x - x0);
        const ty = smooth(y - y0);
        const upper = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const lower = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        return upper + (lower - upper) * ty;
    };
    return (x, y) => {
        let sum = 0;
        let weight = 1;
        let norm = 0;
        for (let o = 0; o < OCTAVES; o++) {
            const f = 2 ** o / scale;
            // Each octave samples a different part of the table, so octaves do not line up.
            sum += weight * octave(x * f + o * TABLE_SIZE * 0.37, y * f + o * TABLE_SIZE * 0.61);
            norm += weight;
            weight /= 2;
        }
        return Math.min(sum / norm, 1 - Number.EPSILON);
    };
}
