// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { labelBox, NEW_LABEL } from '../tools/label';
import { makeHarness } from './test-fakes';

const district = { text: 'Residence District 4', fontSize: 64, colour: '#e0c080', fontFamily: 'Amiri', rotation: -10, hidden: false };

describe('map labels', () => {
    it('place a native text Drawing on the level being edited, and their settings re-sync it', async () => {
        const { c, d } = makeHarness();
        await c.addLevel('above', 'Ground');
        c.setActiveLevel('lv1');
        const id = await c.placeLabel({ x: 400, y: 200 }, district);
        expect(c.labelSettings(id)).toEqual(district);
        expect(d.drawings.flat()).toEqual([{ kind: 'text', x: 400, y: 200, ...labelBox(district), elevation: 0, level: 'lv1', ...district }]);
        expect(c.getFeature(id)?.docs.drawings).toEqual(['d0']);

        expect(await c.setLabelSettings(id, { ...district, hidden: true })).toBe(true);
        expect(d.drawings.at(-1)).toEqual([expect.objectContaining({ hidden: true })]);
        expect(d.deletedIds()).toContain('d0');
    });

    it('refuse a font size Foundry does not take, and anything that is not a label', async () => {
        const { c, d } = makeHarness();
        const id = await c.placeLabel({ x: 0, y: 0 });
        expect(c.labelSettings(id)).toEqual(NEW_LABEL);
        // No text yet, so no Drawing.
        expect(d.drawings).toEqual([]);
        expect(await c.setLabelSettings(id, { ...NEW_LABEL, fontSize: 4 })).toBe(false);
        expect(c.labelSettings('nope')).toBeNull();
        expect(await c.setLabelSettings('nope', NEW_LABEL)).toBe(false);
    });

    it('are erased with their Drawing', async () => {
        const { c, d } = makeHarness();
        await c.placeLabel({ x: 50, y: 50 }, district);
        expect(await c.erase({ x: 50, y: 50 })).toBe(true);
        expect(d.deletedIds()).toEqual(['d0']);
    });
});
