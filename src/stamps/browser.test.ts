// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { catalogStamps } from '../canvas/test-fakes';
import { browserView, INITIAL_BROWSER, reduceBrowser, variantFor, type BrowserAction, type BrowserState } from './browser';
import { parseStampDrop, stampDropPayload } from './drop';

const variants = [
    { state: 'a', image: 'a.png', width: 10, height: 10 },
    { state: 'b', image: 'b.png', width: 10, height: 10 },
];
const catalog = catalogStamps([
    { id: 'lamp', name: 'Brass Lamp', category: 'Lighting', tags: ['lamp', 'brass'], scale: 'interior', perspective: 'top-down', variants },
    { id: 'torch', name: 'Torch', category: 'Lighting', tags: ['lamp'], scale: 'exterior', perspective: 'isometric', variants, defaultVariant: 1 },
    { id: 'door', name: 'Door', category: 'Doors', tags: ['brass'], scale: 'interior', perspective: 'top-down', variants },
]);

function apply(...actions: BrowserAction[]): BrowserState {
    return actions.reduce(reduceBrowser, INITIAL_BROWSER);
}

const keys = (state: BrowserState): string[] => browserView(catalog, state).cards.map((c) => c.stamp.key);

describe('reduceBrowser', () => {
    it('sets and clears filters', () => {
        const s = apply(
            { type: 'category', category: 'Doors' },
            { type: 'query', query: 'x' },
            { type: 'scale', scale: 'interior' },
            { type: 'perspective', perspective: 'isometric' },
        );
        expect(s).toMatchObject({ category: 'Doors', query: 'x', scale: 'interior', perspective: 'isometric' });
        expect(reduceBrowser(s, { type: 'category', category: null }).category).toBeNull();
    });

    it('toggles tags and clears them', () => {
        const s = apply({ type: 'toggleTag', tag: 'lamp' }, { type: 'toggleTag', tag: 'brass' }, { type: 'toggleTag', tag: 'lamp' });
        expect(s.tags).toEqual(['brass']);
        expect(reduceBrowser(s, { type: 'clearTags' }).tags).toEqual([]);
    });

    it('toggles settings on and off', () => {
        const s = apply(
            { type: 'toggleSetting', setting: 'fantasy' },
            { type: 'toggleSetting', setting: 'modern' },
            { type: 'toggleSetting', setting: 'fantasy' },
        );
        expect(s.settings).toEqual(['modern']);
    });

    it('selects a stamp and remembers its chosen variant', () => {
        const s = apply({ type: 'select', key: 'pack:lamp' }, { type: 'variant', key: 'pack:door', index: 1 });
        expect(s.selected).toBe('pack:door');
        expect(s.variants).toEqual({ 'pack:door': 1 });
    });

    it('cycles rotation through the quarter turns', () => {
        expect([1, 2, 3, 4].map((n) => apply(...Array.from({ length: n }, (): BrowserAction => ({ type: 'rotate' }))).rotation)).toEqual([90, 180, 270, 0]);
        expect(reduceBrowser({ ...INITIAL_BROWSER, rotation: 45 }, { type: 'rotate' }).rotation).toBe(0);
    });
});

describe('browserView', () => {
    it('lists everything by default, with category counts and frequent tags', () => {
        const view = browserView(catalog, INITIAL_BROWSER);
        expect(view.total).toBe(3);
        expect(view.inScale).toBe(3);
        expect(keys(INITIAL_BROWSER)).toEqual(['pack:lamp', 'pack:torch', 'pack:door']);
        expect(view.categories.map((c) => [c.name, c.count])).toEqual([
            ['Doors', 1],
            ['Lighting', 2],
        ]);
        expect(view.categories[1]?.tags).toEqual([{ tag: 'lamp', count: 2, active: false }]);
        expect(view.selected).toBeNull();
    });

    it('scopes categories and counts to the scale band', () => {
        const view = browserView(catalog, apply({ type: 'scale', scale: 'exterior' }));
        expect(view.inScale).toBe(1);
        expect(view.categories.map((c) => c.name)).toEqual(['Lighting']);
        expect(view.cards.map((c) => c.stamp.id)).toEqual(['torch']);
    });

    it('applies category, perspective, tag and query filters and marks active entries', () => {
        expect(keys(apply({ type: 'category', category: 'Lighting' }))).toEqual(['pack:lamp', 'pack:torch']);
        expect(keys(apply({ type: 'perspective', perspective: 'isometric' }))).toEqual(['pack:torch']);
        expect(keys(apply({ type: 'toggleTag', tag: 'brass' }))).toEqual(['pack:lamp', 'pack:door']);
        expect(keys(apply({ type: 'query', query: 'TORCH' }))).toEqual(['pack:torch']);
        const view = browserView(catalog, apply({ type: 'category', category: 'Lighting' }, { type: 'toggleTag', tag: 'lamp' }));
        expect(view.categories.find((c) => c.name === 'Lighting')).toMatchObject({ active: true, tags: [{ tag: 'lamp', active: true }] });
        expect(view.activeTags).toEqual(['lamp']);
    });

    it('filters by setting across every category, and keeps setting tags out of category sub-tags', () => {
        const tagged = catalogStamps([
            { id: 'sword', name: 'Sword', category: 'Weapons', tags: ['blade', 'setting-fantasy'], scale: 'interior', perspective: 'top-down', variants },
            {
                id: 'rifle',
                name: 'Rifle',
                category: 'Weapons',
                tags: ['gun', 'setting-modern', 'setting-grimdark'],
                scale: 'interior',
                perspective: 'top-down',
                variants,
            },
            { id: 'rock', name: 'Rock', category: 'Structural', tags: ['stone', 'setting-generic'], scale: 'interior', perspective: 'top-down', variants },
            { id: 'box', name: 'Box', category: 'Storage', tags: ['crate'], scale: 'exterior', perspective: 'top-down', variants },
        ]);
        const view = (state: BrowserState) => browserView(tagged, state);
        const all = view(INITIAL_BROWSER);
        expect(all.settings).toEqual([
            { setting: 'fantasy', count: 1, active: false },
            { setting: 'generic', count: 1, active: false },
            { setting: 'grimdark', count: 1, active: false },
            { setting: 'modern', count: 1, active: false },
        ]);
        expect(all.categories.flatMap((c) => c.tags.map((t) => t.tag)).some((t) => t.startsWith('setting-'))).toBe(false);
        expect(all.cards).toHaveLength(4);

        // Checked settings are OR'd: a stamp shows if it suits any of them.
        const some = view(apply({ type: 'toggleSetting', setting: 'fantasy' }, { type: 'toggleSetting', setting: 'grimdark' }));
        expect(some.cards.map((c) => c.stamp.id)).toEqual(['sword', 'rifle']);
        expect(some.inScale).toBe(2);
        expect(some.categories.map((c) => [c.name, c.count])).toEqual([['Weapons', 2]]);
        expect(some.settings.filter((s) => s.active).map((s) => s.setting)).toEqual(['fantasy', 'grimdark']);

        // The setting list follows the scale band.
        expect(view(apply({ type: 'scale', scale: 'exterior' })).settings).toEqual([]);
    });

    it('shows each card at its chosen or default variant, and the selection', () => {
        const view = browserView(catalog, apply({ type: 'variant', key: 'pack:lamp', index: 1 }));
        expect(view.cards.map((c) => c.variant)).toEqual([1, 1, 0]);
        expect(view.selected?.stamp.key).toBe('pack:lamp');
        expect(view.cards[0]?.selected).toBe(true);
        const torch = catalog[1];
        expect(torch ? variantFor(INITIAL_BROWSER, torch) : null).toBe(1);
    });
});

describe('stamp drop payload', () => {
    it('round-trips through JSON and rejects anything else', () => {
        expect(parseStampDrop(JSON.parse(stampDropPayload('pack:lamp', 1, 90)))).toEqual({
            type: 'ZephyrStamp',
            stamp: 'pack:lamp',
            variant: 1,
            rotation: 90,
        });
        expect(parseStampDrop({ type: 'Actor', uuid: 'x' })).toBeNull();
        expect(parseStampDrop({ type: 'ZephyrStamp', stamp: '', variant: 0, rotation: 0 })).toBeNull();
    });
});
