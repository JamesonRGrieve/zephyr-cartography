// SPDX-License-Identifier: AGPL-3.0-or-later
/** Stories for the road and river panel; each keeps its own settings, so every control works in Storybook. */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { LIQUID_LOOKS, type PathKind, type RiverLook } from '../tools/path';
import { parseSizePx } from '../tools/size-input';
import type { WallPreset } from '../tools/wall-presets';
import { renderPathPanel, type BedChoice, type PathLabels } from './path-panel-view';

export interface PathArgs {
    readonly kind: PathKind;
    readonly width: number;
    readonly walls: WallPreset | null;
    readonly river: RiverLook;
    readonly beds: readonly BedChoice[];
}

const LABELS: PathLabels = {
    width: 'Width (px)',
    liquid: 'Liquid',
    liquids: { water: 'Water', lava: 'Lava', poison: 'Poison', acid: 'Acid' },
    shade: 'Shade',
    bed: 'Bed',
    noBed: 'No bed',
    walls: 'Walls',
    noWalls: 'None',
    // Named as Foundry's own Walls palette names them.
    wallKinds: { solid: 'Solid Wall', terrain: 'Terrain Wall', invisible: 'Invisible Wall', ethereal: 'Ethereal Wall', window: 'Window' },
};

/** Mount an interactive panel inside a stand-in Foundry window scoped for the module's styles. */
export function mountPathPanel(args: PathArgs): HTMLElement {
    const windowEl = document.createElement('div');
    windowEl.className = 'zephyr-cartography zc-story-window';
    const root = document.createElement('div');
    windowEl.append(root);
    let { width, river, walls } = args;
    const render = (): void => {
        renderPathPanel(root, { kind: args.kind, width, walls, river, beds: args.beds }, LABELS, {
            setWalls: (kind) => {
                walls = kind;
                render();
            },
            setWidth: (typed) => {
                const size = parseSizePx(typed);
                if (size === null) {
                    return false;
                }
                width = size;
                render();
                return true;
            },
            setRiver: (look) => {
                river = look;
                render();
            },
        });
    };
    render();
    return windowEl;
}

const BEDS: readonly BedChoice[] = [
    { role: 'dirt', label: 'Dirt' },
    { role: 'sand', label: 'Sand' },
    { role: 'rock', label: 'Rock' },
    { role: 'marsh', label: 'Marsh' },
];

const meta: Meta<PathArgs> = {
    title: 'Terrain/Road and River Panel',
    excludeStories: ['mountPathPanel'],
    render: mountPathPanel,
    args: { kind: 'river', width: 40, walls: null, river: LIQUID_LOOKS.water, beds: BEDS },
};

export default meta;

type Story = StoryObj<PathArgs>;

export const WaterOnDirt: Story = {};

export const LavaFlow: Story = {
    args: { river: LIQUID_LOOKS.lava, width: 90 },
};

export const BarePoisonWithABedTheSetLacks: Story = {
    args: { river: { ...LIQUID_LOOKS.poison, bed: 'floor.slime' } },
};

export const Road: Story = {
    args: { kind: 'road', width: 30 },
};

export const FencedRoad: Story = {
    args: { kind: 'road', width: 30, walls: 'terrain' },
};
