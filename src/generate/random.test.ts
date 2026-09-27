// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { pick, randomInt, seededRandom, shuffled } from './random';

const draw = (seed: number, n: number): number[] => {
    const random = seededRandom(seed);
    return Array.from({ length: n }, () => random());
};

describe('seededRandom', () => {
    it('repeats for a seed and differs between seeds', () => {
        expect(draw(42, 5)).toEqual(draw(42, 5));
        expect(draw(42, 5)).not.toEqual(draw(43, 5));
    });

    it('stays in [0, 1)', () => {
        for (const v of draw(7, 1000)) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });
});

describe('randomInt and pick', () => {
    it('covers both ends of an inclusive range and nothing outside it', () => {
        const random = seededRandom(3);
        const seen = new Set(Array.from({ length: 500 }, () => randomInt(random, 2, 5)));
        expect([...seen].sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
    });

    it('picks from a list, and nothing from an empty one', () => {
        const random = seededRandom(9);
        expect(['a', 'b', 'c']).toContain(pick(random, ['a', 'b', 'c']));
        expect(pick(random, [])).toBeUndefined();
    });
});

describe('shuffled', () => {
    it('reorders a copy, keeping every item, the same way for a seed', () => {
        const items = ['a', 'b', 'c', 'd', 'e', 'f'];
        const once = shuffled(seededRandom(5), items);
        expect([...once].sort()).toEqual(items);
        expect(shuffled(seededRandom(5), items)).toEqual(once);
        expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
        // Some seed moves something.
        expect([1, 2, 3, 4].some((seed) => shuffled(seededRandom(seed), items).join() !== items.join())).toBe(true);
    });
});
