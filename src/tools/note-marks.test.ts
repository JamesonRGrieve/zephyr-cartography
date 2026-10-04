// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { changesHidden, noteMarked } from './note-marks';

describe('a Note’s marks', () => {
    it('read true only where the module set them so', () => {
        const flags = { 'zephyr-cartography': { readable: true, hidden: false } };
        expect(noteMarked(flags, 'readable')).toBe(true);
        expect(noteMarked(flags, 'hidden')).toBe(false);
        expect(noteMarked({ 'zephyr-cartography': { hidden: 'yes' } }, 'hidden')).toBe(false);
        expect(noteMarked({ other: { hidden: true } }, 'hidden')).toBe(false);
        expect(noteMarked({ 'zephyr-cartography': 3 }, 'readable')).toBe(false);
        expect(noteMarked(null, 'readable')).toBe(false);
    });

    it('tell a change to the hidden mark from any other change', () => {
        expect(changesHidden({ 'zephyr-cartography': { hidden: false } })).toBe(true);
        expect(changesHidden({ 'zephyr-cartography': { '-=hidden': null } })).toBe(true);
        expect(changesHidden({ 'zephyr-cartography': { readable: true } })).toBe(false);
        expect(changesHidden({ other: { hidden: true } })).toBe(false);
        expect(changesHidden(undefined)).toBe(false);
    });
});
