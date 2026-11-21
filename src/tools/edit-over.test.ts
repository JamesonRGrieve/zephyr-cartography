// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { editOver } from './edit-over';

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
