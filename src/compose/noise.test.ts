// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import { noiseField } from './noise';

describe('noiseField', () => {
    const field = noiseField(seededRandom(1), 6);

    it('stays in [0, 1), and is the same for a seed', () => {
        const again = noiseField(seededRandom(1), 6);
        for (let i = 0; i < 400; i++) {
            const x = (i % 20) * 1.7 - 10;
            const y = Math.floor(i / 20) * 2.3 - 20;
            const v = field(x, y);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
            expect(again(x, y)).toBe(v);
        }
    });

    it('changes smoothly over less than its scale, and varies over more', () => {
        const steps = Array.from({ length: 50 }, (_, i) => Math.abs(field(i * 0.1 + 0.05, 3) - field(i * 0.1, 3)));
        expect(Math.max(...steps)).toBeLessThan(0.1);
        const far = Array.from({ length: 30 }, (_, i) => field(i * 7, 11));
        expect(Math.max(...far) - Math.min(...far)).toBeGreaterThan(0.2);
    });

    it('differs between seeds', () => {
        const other = noiseField(seededRandom(2), 6);
        expect([0, 5, 9].map((x) => other(x, x))).not.toEqual([0, 5, 9].map((x) => field(x, x)));
    });
});
