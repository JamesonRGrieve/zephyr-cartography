// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';
import { catalogStamps } from '../canvas/test-fakes';
import { browserView, INITIAL_BROWSER, reduceBrowser, type BrowserAction, type BrowserState } from '../stamps/browser';
import { renderBrowser, type BrowserLabels } from './stamp-browser-view';

const labels: BrowserLabels = {
    search: 'Search',
    scale: 'Scale',
    perspective: 'Perspective',
    settings: 'Settings',
    any: 'Any',
    all: 'All',
    rotate: 'Rotate',
    clearTags: 'Clear',
    place: 'Place',
    variants: 'Variants',
    empty: 'Nothing',
    noSelection: 'Pick one',
    categories: 'Categories',
    stamps: 'Stamps',
    status: (shown, total) => `${shown}/${total}`,
    cardHint: 'hint',
};

const catalog = catalogStamps([
    {
        id: 'lamp',
        name: '<b>Lamp</b>',
        category: 'Lighting',
        tags: ['lamp', 'brass', 'setting-fantasy'],
        scale: 'interior',
        perspective: 'top-down',
        variants: [
            { state: 'lit', image: 'lit.png', width: 10, height: 20 },
            { state: 'unlit', image: 'unlit.png', width: 10, height: 20 },
        ],
    },
    {
        id: 'door',
        name: 'Door',
        category: 'Doors',
        tags: ['brass', 'setting-modern'],
        scale: 'interior',
        perspective: 'top-down',
        variants: [{ state: 'shut', image: 'd.png', width: 10, height: 10 }],
    },
    {
        id: 'lamp2',
        name: 'Lamp 2',
        category: 'Lighting',
        tags: ['lamp'],
        scale: 'exterior',
        perspective: 'top-down',
        variants: [{ state: 'on', image: 'l.png', width: 10, height: 10 }],
    },
]);

interface Mounted {
    readonly root: HTMLElement;
    readonly actions: BrowserAction[];
    readonly placed: [string, number][];
    state: BrowserState;
}

function mount(initial: BrowserState = INITIAL_BROWSER): Mounted {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    const m: Mounted = { root, actions: [], placed: [], state: initial };
    const render = (): void => {
        renderBrowser(root, browserView(catalog, m.state), labels, {
            dispatch: (action) => {
                m.actions.push(action);
                m.state = reduceBrowser(m.state, action);
                render();
            },
            place: (key, variant) => {
                m.placed.push([key, variant]);
            },
        });
    };
    render();
    return m;
}

function button(root: HTMLElement, label: string): HTMLButtonElement {
    const found = [...root.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent === label);
    if (!found) {
        throw new Error(`no button ${label}`);
    }
    return found;
}

describe('renderBrowser', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    it('renders every stamp as a labelled card, as text not markup', () => {
        const { root } = mount();
        const cards = root.querySelectorAll('[data-stamp-key]');
        expect(cards).toHaveLength(3);
        expect(root.querySelector('b')).toBeNull();
        expect(button(root, '<b>Lamp</b> (lit)').getAttribute('aria-pressed')).toBe('false');
        expect(root.querySelector('[role="status"]')?.textContent).toBe('3/3');
        expect(root.querySelector('label[for="zc-stamp-search"]')).not.toBeNull();
    });

    it('shows compressed art by its preview, and none without one', () => {
        const gpu = catalogStamps([
            {
                id: 'crate',
                name: 'Crate',
                category: 'Storage',
                scale: 'interior',
                perspective: 'top-down',
                variants: [{ state: 'shut', image: 'crate.ktx2', preview: 'crate.webp', width: 10, height: 10 }],
            },
            {
                id: 'barrel',
                name: 'Barrel',
                category: 'Storage',
                scale: 'interior',
                perspective: 'top-down',
                variants: [{ state: 'whole', image: 'barrel.basis', width: 10, height: 10 }],
            },
        ]);
        const root = document.createElement('div');
        renderBrowser(root, browserView(gpu, INITIAL_BROWSER), labels, { dispatch: () => undefined, place: () => undefined });
        const imageOf = (label: string): string | null => button(root, label).querySelector('img')?.getAttribute('src') ?? null;
        // The pack serves its preview; the compressed barrel has none, so its card shows only its name.
        expect([imageOf('Crate'), imageOf('Barrel')]).toEqual(['modules/pack/crate.webp', null]);
    });

    it('filters by category, then shows and toggles its tags', () => {
        const m = mount();
        button(m.root, 'Lighting (2)').click();
        expect(m.root.querySelectorAll('[data-stamp-key]')).toHaveLength(2);
        expect(m.root.textContent).not.toContain('brass (1)'); // below the sub-tag frequency floor
        button(m.root, 'lamp (2)').click();
        expect(m.state.tags).toEqual(['lamp']);
        expect(button(m.root, 'lamp (2)').getAttribute('aria-pressed')).toBe('true');
        button(m.root, 'Clear').click();
        expect(m.state.tags).toEqual([]);
    });

    it('filters by setting with labelled checkboxes that apply across categories', () => {
        const m = mount();
        const box = (setting: string): HTMLInputElement => {
            const found = m.root.querySelector<HTMLInputElement>(`#zc-stamp-setting-${setting}`);
            if (!found) {
                throw new Error(`no ${setting} checkbox`);
            }
            return found;
        };
        expect(m.root.querySelector('fieldset legend')?.textContent).toBe('Settings');
        expect(m.root.querySelector('label[for="zc-stamp-setting-fantasy"]')?.textContent).toBe('fantasy (1)');
        box('fantasy').click();
        expect(m.state.settings).toEqual(['fantasy']);
        expect(box('fantasy').checked).toBe(true);
        expect(m.root.querySelectorAll('[data-stamp-key]')).toHaveLength(1);
        box('modern').click();
        expect(m.root.querySelectorAll('[data-stamp-key]')).toHaveLength(2);
        // Setting tags are never listed as a category's sub-tags.
        button(m.root, 'Lighting (1)').click();
        expect(m.root.textContent).not.toContain('setting-');
    });

    it('filters by scale and search, keeping focus and caret in the search box', () => {
        const m = mount();
        const scale = m.root.querySelector<HTMLSelectElement>('#zc-stamp-scale');
        if (!scale) {
            throw new Error('no scale select');
        }
        scale.value = 'exterior';
        scale.dispatchEvent(new Event('change'));
        expect(m.state.scale).toBe('exterior');
        expect(m.root.querySelector<HTMLSelectElement>('#zc-stamp-scale')?.value).toBe('exterior');
        const search = m.root.querySelector<HTMLInputElement>('#zc-stamp-search');
        search?.focus();
        if (search) {
            search.value = 'lam';
            search.dispatchEvent(new Event('input'));
        }
        const after = m.root.querySelector<HTMLInputElement>('#zc-stamp-search');
        expect(document.activeElement).toBe(after);
        expect(after?.value).toBe('lam');
        expect(m.root.querySelectorAll('[data-stamp-key]')).toHaveLength(1);
    });

    it('selects a card, lists its variants, and places the chosen variant', () => {
        const m = mount();
        button(m.root, '<b>Lamp</b> (lit)').click();
        expect(m.state.selected).toBe('pack:lamp');
        const unlit = [...m.root.querySelectorAll('button')].find((b) => b.textContent.startsWith('unlit'));
        unlit?.click();
        expect(m.state.variants).toEqual({ 'pack:lamp': 1 });
        button(m.root, 'Place').click();
        expect(m.placed).toEqual([['pack:lamp', 1]]);
    });

    it('places on double-click and carries a drop payload on drag', () => {
        const m = mount();
        const door = button(m.root, 'Door');
        door.dispatchEvent(new MouseEvent('dblclick'));
        expect(m.placed).toEqual([['pack:door', 0]]);
        let payload = '';
        const drag = new Event('dragstart');
        Object.defineProperty(drag, 'dataTransfer', {
            value: {
                setData: (_: string, data: string) => {
                    payload = data;
                },
            },
        });
        door.dispatchEvent(drag);
        expect(JSON.parse(payload)).toEqual({ type: 'ZephyrStamp', stamp: 'pack:door', variant: 0, rotation: 0 });
    });

    it('rotates, and says so when nothing matches or nothing is selected', () => {
        const m = mount();
        button(m.root, 'Rotate: 0°').click();
        expect(m.state.rotation).toBe(90);
        expect(m.root.textContent).toContain('Pick one');
        const perspective = m.root.querySelector<HTMLSelectElement>('#zc-stamp-perspective');
        if (perspective) {
            perspective.value = 'isometric';
            perspective.dispatchEvent(new Event('change'));
        }
        expect(m.root.textContent).toContain('Nothing');
    });
});
