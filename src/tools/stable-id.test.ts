// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { stableId } from './stable-id';

describe('stable ids', () => {
    it('are a Foundry id, the same for the same seed and different for another', () => {
        expect(stableId('scene:tavern')).toMatch(/^[A-Za-z0-9]{16}$/u);
        expect(stableId('scene:tavern')).toBe(stableId('scene:tavern'));
        expect(stableId('scene:tavern')).not.toBe(stableId('scene:town'));
    });
});
