// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseStampDrop, stampDropPayload } from './drop';

describe('stamp drops', () => {
    it('round-trip a card payload through JSON', () => {
        expect(parseStampDrop(JSON.parse(stampDropPayload('pack:lamp', 2, 90)))).toEqual({
            type: 'ZephyrStamp',
            stamp: 'pack:lamp',
            variant: 2,
            rotation: 90,
        });
    });

    it('reject other drops and malformed payloads', () => {
        expect(parseStampDrop({ type: 'Actor', uuid: 'Actor.x' })).toBeNull();
        expect(parseStampDrop({ type: 'ZephyrStamp', stamp: '', variant: 0, rotation: 0 })).toBeNull();
        expect(parseStampDrop({ type: 'ZephyrStamp', stamp: 'pack:lamp', variant: 1.5, rotation: 0 })).toBeNull();
        expect(parseStampDrop({ type: 'ZephyrStamp', stamp: 'pack:lamp', variant: -1, rotation: 0 })).toBeNull();
        expect(parseStampDrop(null)).toBeNull();
    });
});
