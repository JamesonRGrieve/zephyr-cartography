// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stories for the stamp browser. Each story starts the real reducer from a
 * given state and stays interactive, so filters, selection and rotation all
 * work in Storybook exactly as in Foundry. Placement is logged, not performed.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { browserView, INITIAL_BROWSER, reduceBrowser, type BrowserState } from '../stamps/browser';
import type { CatalogStamp } from '../stamps/catalog';
import { demoCatalog } from '../stamps/fixtures';
import { renderBrowser, type BrowserLabels } from './stamp-browser-view';

export interface StampBrowserArgs {
    readonly state: BrowserState;
    readonly catalog: readonly CatalogStamp[];
    readonly onPlace: (key: string, variant: number) => void;
}

const LABELS: BrowserLabels = {
    search: 'Search stamps',
    scale: 'Scale',
    perspective: 'Perspective',
    settings: 'Settings',
    any: 'Any',
    all: 'All',
    rotate: 'Rotation',
    clearTags: 'Clear tags',
    place: 'Place at view centre',
    variants: 'Variants',
    empty: 'No stamps match these filters.',
    noSelection: 'Select a stamp to see its variants.',
    categories: 'Categories',
    stamps: 'Stamps',
    status: (shown, total) => `${shown} of ${total} stamps`,
    cardHint: 'Click to select for placing, double-click to place at the view centre, or drag onto the canvas.',
};

/** Mount an interactive browser inside a stand-in Foundry window scoped for the module's styles. */
export function mountStampBrowser(args: StampBrowserArgs): HTMLElement {
    const windowEl = document.createElement('div');
    windowEl.className = 'zephyr-cartography zc-story-window';
    const root = document.createElement('div');
    root.className = 'tw-flex tw-flex-col tw-h-full';
    windowEl.append(root);
    let state = args.state;
    const render = (): void => {
        renderBrowser(root, browserView(args.catalog, state), LABELS, {
            dispatch: (action) => {
                state = reduceBrowser(state, action);
                render();
            },
            place: args.onPlace,
        });
    };
    render();
    return windowEl;
}

const meta: Meta<StampBrowserArgs> = {
    title: 'Stamps/Stamp Browser',
    // The mount helper is shared with the story render test; it is not a story itself.
    excludeStories: ['mountStampBrowser'],
    render: mountStampBrowser,
    args: { state: INITIAL_BROWSER, catalog: demoCatalog() },
    argTypes: { onPlace: { action: 'place' } },
};

export default meta;

type Story = StoryObj<StampBrowserArgs>;

export const AllStamps: Story = {};

export const FilteredByCategory: Story = {
    args: { state: { ...INITIAL_BROWSER, category: 'Lighting', tags: ['lamp'] } },
};

export const FilteredBySetting: Story = {
    args: { state: { ...INITIAL_BROWSER, settings: ['modern'] } },
};

export const SelectedWithVariants: Story = {
    args: { state: { ...INITIAL_BROWSER, selected: 'demo-pack:bulkhead-door', variants: { 'demo-pack:bulkhead-door': 2 } } },
};

export const CityScaleRotated: Story = {
    args: { state: { ...INITIAL_BROWSER, scale: 'city', rotation: 90 } },
};

export const NoMatches: Story = {
    args: { state: { ...INITIAL_BROWSER, query: 'no such stamp' } },
};

export const NoPacksLoaded: Story = {
    args: { catalog: [] },
};
