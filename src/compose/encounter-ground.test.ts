// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { decodePng } from '../tools/png';
import { GROUND_PX, groundWeights, paintGround } from './encounter-ground';

const PAINT = {
    width: 12,
    height: 8,
    seed: 7,
    roles: ['floor.olive-meadow', 'floor.grass-2', 'floor.rough-packed-earth-2'] as const,
    earth: [{ centre: { x: 3, y: 4 }, radius: 2 }],
};

describe('encounter ground', () => {
    it('wears the ground to earth at a rock field and lays no earth far from one', () => {
        const weigh = groundWeights(PAINT);
        expect(weigh(3, 4).earth).toBeGreaterThan(0.5);
        expect(weigh(11, 4).earth).toBe(0);
        // Patches never take the earth's share: together they never pass a whole.
        for (const [x, y] of [
            [1, 1],
            [3, 4],
            [6, 6],
            [11, 7],
        ] as const) {
            const { patch, earth } = weigh(x, y);
            expect(patch + earth).toBeLessThanOrEqual(1);
        }
    });

    it('paints a mask as a PNG data URL the size of the map, its weights summing to a whole', async () => {
        const painted = paintGround(PAINT);
        expect(painted.roles).toEqual([...PAINT.roles, null]);
        const prefix = 'data:image/png;base64,';
        expect(painted.mask.startsWith(prefix)).toBe(true);
        const mask = await decodePng(Uint8Array.from(Buffer.from(painted.mask.slice(prefix.length), 'base64')));
        expect([mask?.width, mask?.height]).toEqual([PAINT.width * GROUND_PX, PAINT.height * GROUND_PX]);
        const pixels = mask?.pixels ?? new Uint8ClampedArray(0);
        for (let i = 0; i < pixels.length; i += 4) {
            expect((pixels[i] ?? 0) + (pixels[i + 1] ?? 0) + (pixels[i + 2] ?? 0)).toBe(255);
        }
        // Seeded: the same paint, the same mask; another seed, other patches.
        expect(paintGround(PAINT).mask).toBe(painted.mask);
        expect(paintGround({ ...PAINT, seed: 8 }).mask).not.toBe(painted.mask);
    });
});
