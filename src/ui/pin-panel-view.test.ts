// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';
import { NEW_PIN } from '../tools/pin';
import * as stories from './pin-panel-view.stories';

function mount(story: { readonly args?: Partial<stories.PinPanelArgs> }): HTMLElement {
    const base = stories.default.args;
    const el = stories.mountPinPanel({ settings: story.args?.settings ?? base?.settings ?? NEW_PIN, journal: story.args?.journal ?? base?.journal ?? [] });
    document.body.replaceChildren(el);
    return el;
}

function select(root: HTMLElement, id: string): HTMLSelectElement {
    const found = root.querySelector<HTMLSelectElement>(`#${id}`);
    if (!found) {
        throw new Error(`no select ${id}`);
    }
    return found;
}

function input(root: HTMLElement, key: string): HTMLInputElement {
    const found = root.querySelector<HTMLInputElement>(`input[data-zc-focus="${key}"]`);
    if (!found) {
        throw new Error(`no input ${key}`);
    }
    return found;
}

function change(target: HTMLInputElement | HTMLSelectElement, value: string): void {
    target.value = value;
    target.dispatchEvent(new Event('change'));
}

describe('map pin panel', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    it('starts with no text, journal entry, page or icon, and offers the world’s entries', () => {
        const root = mount(stories.NewPin);
        expect(input(root, 'pin-text').value).toBe('');
        expect(select(root, 'zc-pin-entry').value).toBe('');
        expect([...select(root, 'zc-pin-entry').options].map((o) => o.textContent)).toEqual(['None', 'Hab District 4', 'The Sump']);
        expect([...select(root, 'zc-pin-page').options].map((o) => o.textContent)).toEqual(['None']);
        expect(root.querySelector('label[for="zc-pin-entry"]')?.textContent).toBe('Journal Entry');
    });

    it('picks an entry, then one of its pages; another entry clears the page', () => {
        const root = mount(stories.NewPin);
        change(select(root, 'zc-pin-entry'), 'je-hab');
        expect([...select(root, 'zc-pin-page').options].map((o) => o.textContent)).toEqual(['None', 'Hab-Transit Lodge', 'District 4 Chapel']);
        change(select(root, 'zc-pin-page'), 'pg-lodge');
        expect(select(root, 'zc-pin-page').value).toBe('pg-lodge');
        change(select(root, 'zc-pin-entry'), 'je-sump');
        expect(select(root, 'zc-pin-page').value).toBe('');
    });

    it('sets the text, the icon typed or browsed for, and global visibility', () => {
        const root = mount(stories.ChapelPage);
        expect(select(root, 'zc-pin-page').value).toBe('pg-chapel');
        change(input(root, 'pin-text'), 'Chapel');
        expect(input(root, 'pin-text').value).toBe('Chapel');
        change(input(root, 'pin-icon'), '  ');
        expect(input(root, 'pin-icon').value).toBe('');
        root.querySelector<HTMLButtonElement>('button[aria-label="Browse for Entry Icon"]')?.click();
        expect(input(root, 'pin-icon').value).toBe('icons/svg/tankard.svg');
        expect(input(root, 'pin-global').checked).toBe(true);
        input(root, 'pin-global').click();
        expect(input(root, 'pin-global').checked).toBe(false);
    });

    it('makes a pin words for players to read on hover, sized to the sign, or Foundry’s size left empty', () => {
        const root = mount(stories.ReadableSign);
        expect(input(root, 'pin-readable').checked).toBe(true);
        expect(input(root, 'pin-size').value).toBe('60');
        input(root, 'pin-readable').click();
        expect(input(root, 'pin-readable').checked).toBe(false);
        change(input(root, 'pin-size'), '-3');
        expect(input(root, 'pin-size').value).toBe('60');
        change(input(root, 'pin-size'), '90');
        expect(input(root, 'pin-size').value).toBe('90');
        change(input(root, 'pin-size'), '');
        expect(input(root, 'pin-size').value).toBe('');
    });

    it('keeps an entry no longer in the journal selectable rather than changing the pin', () => {
        const root = mount(stories.EntryNoLongerInTheJournal);
        expect(select(root, 'zc-pin-entry').value).toBe('je-gone');
        expect(select(root, 'zc-pin-page').value).toBe('');
    });

    it('renders every story', () => {
        for (const story of [stories.NewPin, stories.ChapelPage, stories.ReadableSign, stories.EntryNoLongerInTheJournal]) {
            expect(mount(story).querySelector('#zc-pin-entry')).not.toBeNull();
        }
    });
});
