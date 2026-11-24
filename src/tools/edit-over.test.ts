// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { editListOver, editOver } from './edit-over';

interface Settings {
    readonly text: string;
    readonly fontSize: number;
    readonly hidden: boolean;
    readonly entry: string | null;
}

const drawn: Settings = { text: '', fontSize: 32, hidden: false, entry: null };

describe('editOver', () => {
    it('keeps what an earlier edit changed when a later one was built from a stale draw', () => {
        // The text was typed (and written), then the font size was set from the panel as it was drawn before it.
        const current: Settings = { ...drawn, text: 'Residence District 4' };
        const next: Settings = { ...drawn, fontSize: 64 };
        expect(editOver(current, drawn, next)).toEqual({ text: 'Residence District 4', fontSize: 64, hidden: false, entry: null });
    });

    it('takes every field the edit changed, nulls included', () => {
        const current: Settings = { text: 'a', fontSize: 40, hidden: false, entry: 'j1' };
        const rendered: Settings = { text: 'a', fontSize: 40, hidden: false, entry: 'j1' };
        const next: Settings = { text: 'b', fontSize: 40, hidden: true, entry: null };
        expect(editOver(current, rendered, next)).toEqual({ text: 'b', fontSize: 40, hidden: true, entry: null });
    });

    it('changes nothing for an edit that changed nothing', () => {
        const current: Settings = { text: 'kept', fontSize: 12, hidden: true, entry: 'j2' };
        expect(editOver(current, drawn, drawn)).toEqual(current);
    });
});

interface Effect {
    readonly kind: string;
    readonly modifier: number;
    readonly enable: readonly number[];
}

describe('editListOver', () => {
    const darkness: Effect = { kind: 'darkness', modifier: 1, enable: [] };
    const toggle: Effect = { kind: 'toggle', modifier: 0, enable: [] };

    it('keeps an entry an earlier edit changed when a later edit, built from a stale draw, changed another', () => {
        // The modifier was set (and written), then the toggle's target set from the list as drawn before it.
        const current = [{ ...darkness, modifier: 0.5 }, toggle];
        const next = [darkness, { ...toggle, enable: [0] }];
        expect(editListOver(current, [darkness, toggle], next)).toEqual([
            { ...darkness, modifier: 0.5 },
            { ...toggle, enable: [0] },
        ]);
    });

    it('lays an entry the edit changed over its current fields', () => {
        const current = [{ ...darkness, enable: [3] }];
        expect(editListOver(current, [darkness], [{ ...darkness, modifier: 0.25 }])).toEqual([{ ...darkness, modifier: 0.25, enable: [3] }]);
    });

    it('takes the edit whole where it grew or shrank the list, or the list changed length meanwhile', () => {
        expect(editListOver([darkness], [darkness], [darkness, toggle])).toEqual([darkness, toggle]);
        expect(editListOver([darkness, toggle], [darkness], [toggle])).toEqual([toggle]);
    });

    it('takes the edit for an entry a list holds no value at', () => {
        const holed: Effect[] = [];
        holed.length = 1;
        expect(editListOver(holed, [darkness], [toggle])).toEqual([toggle]);
    });
});
