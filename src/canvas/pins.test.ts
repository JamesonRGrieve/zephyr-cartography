// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { NEW_PIN } from '../tools/pin';
import { makeHarness } from './test-fakes';

const tavern = { ...NEW_PIN, text: 'The Sump', entry: 'je1', page: 'pg2' };

describe('map pins', () => {
    it('place a native Note on the level being edited, and its settings re-sync it', async () => {
        const { c, d } = makeHarness();
        await c.addLevel('above', 'Ground');
        c.setActiveLevel('lv1');
        const id = await c.placePin({ x: 120, y: 80 }, tavern);
        expect(c.pinSettings(id)).toEqual(tavern);
        expect(d.notes.flat()).toEqual([{ x: 120, y: 80, elevation: 0, level: 'lv1', ...tavern }]);
        expect(c.getFeature(id)?.docs.notes).toEqual(['n0']);

        expect(await c.setPinSettings(id, { ...tavern, text: 'The Sump (closed)', global: true })).toBe(true);
        expect(d.notes.at(-1)).toEqual([expect.objectContaining({ text: 'The Sump (closed)', global: true })]);
        expect(d.deletedIds()).toContain('n0');
    });

    it('are removed with their Note, and undo brings both back', async () => {
        const { c, d } = makeHarness();
        const id = await c.placePin({ x: 1, y: 1 });
        expect(c.pinSettings(id)).toEqual(NEW_PIN);
        await c.remove(id);
        expect(d.deletedIds()).toEqual(['n0']);
        await c.undo();
        expect(c.getFeature(id)?.docs.notes).toEqual(['n1']);
    });

    it('have no settings, and refuse them, for anything but a pin', async () => {
        const { c } = makeHarness();
        expect(c.pinSettings('nope')).toBeNull();
        expect(await c.setPinSettings('nope', NEW_PIN)).toBe(false);
    });
});
