// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { STAMP_ROLES } from '../stamps/schema';
import { shadowStandOf } from './shadow-cast';

describe('shadowStandOf', () => {
    it('stands a tree or a structure tallest, a shelf high, furniture low, clutter scant', () => {
        expect(shadowStandOf('tree', ['oak'])).toBeGreaterThan(shadowStandOf('shelf', ['shelving']));
        expect(shadowStandOf('shelf', ['shelving'])).toBeGreaterThan(shadowStandOf('table', ['oak']));
        expect(shadowStandOf('table', ['oak'])).toBeGreaterThan(shadowStandOf('clutter', ['cup']));
        expect(shadowStandOf('clutter', ['cup'])).toBeGreaterThan(0);
    });

    it('casts nothing for what lies on the ground: a rug, a decal, a stair, a bridge, or anything tagged flat', () => {
        for (const role of ['rug', 'decal', 'stairs', 'bridge', 'door', 'crater'] as const) {
            expect(shadowStandOf(role, [])).toBe(0);
        }
        // A hole in the floor, a field, water, a floor conduit: flat whatever their role.
        expect(shadowStandOf('rock', ['rock', 'shaft'])).toBe(0);
        expect(shadowStandOf('fitting', ['floor', 'conduit'])).toBe(0);
        expect(shadowStandOf('fitting', ['cave', 'pool'])).toBe(0);
        expect(shadowStandOf(undefined, ['oak'])).toBe(0);
    });

    it('stands a chart’s building, a fitting tagged as one, as tall as a tree; any other fitting middling', () => {
        expect(shadowStandOf('fitting', ['town'])).toBe(shadowStandOf('tree', []));
        expect(shadowStandOf('fitting', ['cottage'])).toBe(shadowStandOf('tree', []));
        expect(shadowStandOf('fitting', ['anvil'])).toBeGreaterThan(0);
        expect(shadowStandOf('fitting', ['anvil'])).toBeLessThan(shadowStandOf('fitting', ['town']));
    });

    it('gives every role a share between none and a tree’s', () => {
        for (const role of STAMP_ROLES) {
            const stands = shadowStandOf(role, []);
            expect(stands).toBeGreaterThanOrEqual(0);
            expect(stands).toBeLessThanOrEqual(shadowStandOf('tree', []));
        }
    });
});
