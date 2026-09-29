// SPDX-License-Identifier: AGPL-3.0-or-later
/** Stories for the map pin panel; each keeps its own pin, so the controls work in Storybook. */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { NEW_PIN, type PinSettings } from '../tools/pin';
import { renderPinPanel, type JournalChoice, type PinLabels } from './pin-panel-view';

export interface PinPanelArgs {
    readonly settings: PinSettings;
    readonly journal: readonly JournalChoice[];
}

/** Named as Foundry's own Note sheet names them. */
const LABELS: PinLabels = {
    text: 'Text Label',
    entry: 'Journal Entry',
    page: 'Page',
    none: 'None',
    icon: 'Entry Icon',
    browse: 'Browse for Entry Icon',
    global: 'Globally Visible',
    size: 'Icon Size',
    readable: 'Players read it on hover (a sign; no icon drawn)',
};

/** A stand-in for Foundry's file picker: the path it would return. */
const PICKED = 'icons/svg/tankard.svg';

/** Mount an interactive panel inside a stand-in Foundry window scoped for the module's styles. */
export function mountPinPanel(args: PinPanelArgs): HTMLElement {
    const windowEl = document.createElement('div');
    windowEl.className = 'zephyrex-cartography zc-story-window';
    const root = document.createElement('div');
    windowEl.append(root);
    let settings = args.settings;
    const render = (): void => {
        renderPinPanel(root, { settings, journal: args.journal }, LABELS, {
            set: (next) => {
                settings = next;
                render();
            },
            browse: () => {
                settings = { ...settings, icon: PICKED };
                render();
            },
        });
    };
    render();
    return windowEl;
}

const JOURNAL: readonly JournalChoice[] = [
    {
        id: 'je-hab',
        name: 'Hab District 4',
        pages: [
            { id: 'pg-lodge', name: 'Hab-Transit Lodge' },
            { id: 'pg-chapel', name: 'District 4 Chapel' },
        ],
    },
    { id: 'je-sump', name: 'The Sump', pages: [{ id: 'pg-bar', name: 'The bar' }] },
];

const meta: Meta<PinPanelArgs> = {
    title: 'Notes/Map Pin Panel',
    excludeStories: ['mountPinPanel'],
    render: mountPinPanel,
    args: { settings: NEW_PIN, journal: JOURNAL },
};

export default meta;

type Story = StoryObj<PinPanelArgs>;

export const NewPin: Story = {};

export const ChapelPage: Story = {
    args: { settings: { ...NEW_PIN, text: 'District 4 Chapel', entry: 'je-hab', page: 'pg-chapel', icon: 'icons/svg/temple.svg', global: true } },
};

export const ReadableSign: Story = {
    args: { settings: { ...NEW_PIN, text: 'OPEN LATE', readable: true, size: 60 } },
};

export const EntryNoLongerInTheJournal: Story = {
    args: { settings: { ...NEW_PIN, text: 'Lost note', entry: 'je-gone', page: 'pg-gone' } },
};
