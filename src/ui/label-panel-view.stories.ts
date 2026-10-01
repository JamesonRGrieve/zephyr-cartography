// SPDX-License-Identifier: AGPL-3.0-or-later
/** Stories for the map label panel; each keeps its own label, so the controls work in Storybook. */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { NEW_LABEL, type LabelSettings } from '../tools/label';
import { renderLabelPanel, type LabelLabels } from './label-panel-view';

export interface LabelPanelArgs {
    readonly settings: LabelSettings;
    readonly fonts: readonly string[];
}

/** Named as Foundry's own Drawing sheet names them. */
const LABELS: LabelLabels = {
    text: 'Text Label',
    fontSize: 'Font Size',
    colour: 'Text Color',
    fontFamily: 'Font Family',
    defaultFont: "Foundry's default",
    rotation: 'Rotation (°)',
    hidden: 'Hidden from players',
};

/** Mount an interactive panel inside a stand-in Foundry window scoped for the module's styles. */
export function mountLabelPanel(args: LabelPanelArgs): HTMLElement {
    const windowEl = document.createElement('div');
    windowEl.className = 'zephyr-cartography zc-story-window';
    const root = document.createElement('div');
    windowEl.append(root);
    let settings = args.settings;
    const render = (): void => {
        renderLabelPanel(root, { settings, fonts: args.fonts }, LABELS, (next) => {
            settings = next;
            render();
        });
    };
    render();
    return windowEl;
}

/** A few of the fonts Foundry ships. */
const FONTS: readonly string[] = ['Signika', 'Modesto Condensed', 'Amiri', 'Bruno Ace'];

const meta: Meta<LabelPanelArgs> = {
    title: 'Drawings/Map Label Panel',
    excludeStories: ['mountLabelPanel'],
    render: mountLabelPanel,
    args: { settings: NEW_LABEL, fonts: FONTS },
};

export default meta;

type Story = StoryObj<LabelPanelArgs>;

export const NewLabel: Story = {};

export const DistrictName: Story = {
    args: { settings: { text: 'Residence District 4', fontSize: 96, colour: '#e0c080', fontFamily: 'Modesto Condensed', rotation: -12, hidden: false } },
};

export const SecretFontGone: Story = {
    args: { settings: { ...NEW_LABEL, text: 'The Lair', fontFamily: 'Gothic Old', hidden: true } },
};
