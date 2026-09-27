// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Seeded randomness for generators: the same seed always gives the same map,
 * so a GM can note a seed and get the map back. Mulberry32; not for anything
 * cryptographic.
 */

/** A source of uniform numbers in [0, 1). */
export type Random = () => number;

/** Mulberry32 increment (the golden-ratio constant it is defined with). */
const MULBERRY_INCREMENT = 0x6d2b79f5;

/** 2^32, to scale a 32-bit state into [0, 1). */
const UINT32_RANGE = 4294967296;

export function seededRandom(seed: number): Random {
    let state = Math.trunc(seed) >>> 0;
    return () => {
        state = (state + MULBERRY_INCREMENT) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
    };
}

/** A whole number in [min, max], both inclusive. */
export function randomInt(random: Random, min: number, max: number): number {
    return min + Math.floor(random() * (max - min + 1));
}

/** A copy of `items` in a seeded random order: each drawn at random from those left. */
export function shuffled<T>(random: Random, items: readonly T[]): T[] {
    const pool = [...items];
    const out: T[] = [];
    while (pool.length > 0) {
        out.push(...pool.splice(Math.floor(random() * pool.length), 1));
    }
    return out;
}

/** One element of a non-empty list, or undefined for an empty one. */
export function pick<T>(random: Random, items: readonly T[]): T | undefined {
    return items[Math.floor(random() * items.length)];
}
