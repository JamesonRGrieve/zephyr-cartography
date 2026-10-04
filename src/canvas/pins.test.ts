// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { NEW_PIN } from '../tools/pin';
import { catalogStamps, makeHarness } from './test-fakes';

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

    it('record a reveal made in play on their pin or stamp, without rewriting the Note', async () => {
        const inn = catalogStamps([
            {
                id: 'inn',
                name: 'Inn',
                category: 'Buildings',
                scale: 'exterior',
                perspective: 'top-down',
                variants: [{ state: 'stone', image: 'inn.png', width: 100, height: 100 }],
            },
        ]);
        const { c, d } = makeHarness(inn);
        const pin = await c.placePin({ x: 1, y: 1 }, { ...tavern, readable: true, hidden: true });
        const stamp = (await c.placeStamp({ stamp: 'pack:inn', x: 50, y: 50, reads: 'The Antler Inn', readsHidden: true })) ?? '';
        const writes = d.writes.length;
        expect(await c.followNoteHidden('n0', false)).toBe(true);
        expect(c.pinSettings(pin)?.hidden).toBe(false);
        const named = c.getFeature(stamp);
        const note = named?.docs.notes[0] ?? '';
        expect(await c.followNoteHidden(note, false)).toBe(true);
        expect(c.getFeature(stamp)).toMatchObject({ readsHidden: false });
        expect(d.writes.length).toBe(writes);
        // Already so, or no feature's Note.
        expect(await c.followNoteHidden('n0', false)).toBe(false);
        expect(await c.followNoteHidden(note, false)).toBe(false);
        expect(await c.followNoteHidden('nope', true)).toBe(false);
    });

    it('have no settings, and refuse them, for anything but a pin', async () => {
        const { c } = makeHarness();
        expect(c.pinSettings('nope')).toBeNull();
        expect(await c.setPinSettings('nope', NEW_PIN)).toBe(false);
    });
});
