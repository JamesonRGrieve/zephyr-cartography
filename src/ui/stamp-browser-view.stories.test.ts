// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Every stamp-browser story renders: each one is mounted with the meta args
 * merged under its own, as Storybook would. This keeps stories from rotting
 * silently between Storybook runs.
 */
import { describe, expect, it } from 'vitest';
import { INITIAL_BROWSER } from '../stamps/browser';
import { demoCatalog } from '../stamps/fixtures';
import * as stories from './stamp-browser-view.stories';

const baseArgs: stories.StampBrowserArgs = { state: INITIAL_BROWSER, catalog: demoCatalog(), onPlace: () => undefined };

function mount(story: { readonly args?: Partial<stories.StampBrowserArgs> }): HTMLElement {
    const el = stories.mountStampBrowser({ ...baseArgs, ...story.args });
    document.body.replaceChildren(el);
    return el;
}

function cardCount(el: HTMLElement): number {
    return el.querySelectorAll('[data-stamp-key]').length;
}

describe('stamp browser stories', () => {
    it('renders inside the module style scope', () => {
        expect(mount(stories.AllStamps).classList.contains('zephyr-cartography')).toBe(true);
    });

    it('shows the whole demo catalog by default', () => {
        expect(cardCount(mount(stories.AllStamps))).toBe(5);
    });

    it('narrows to the lamps', () => {
        expect(cardCount(mount(stories.FilteredByCategory))).toBe(2);
    });

    it('shows the selected door with its chosen variant pressed', () => {
        const el = mount(stories.SelectedWithVariants);
        const pressed = [...el.querySelectorAll('section button[aria-pressed="true"]')].map((b) => b.textContent);
        expect(pressed).toEqual(['breached (100×25)']);
    });

    it('scopes to city scale with the rotation shown', () => {
        const el = mount(stories.CityScaleRotated);
        expect(cardCount(el)).toBe(1);
        expect(el.textContent).toContain('90°');
    });

    it('explains an empty result and an empty catalog', () => {
        expect(mount(stories.NoMatches).textContent).toContain('No stamps match');
        const empty = mount(stories.NoPacksLoaded);
        expect(cardCount(empty)).toBe(0);
        expect(empty.textContent).toContain('0 of 0 stamps');
    });
});
