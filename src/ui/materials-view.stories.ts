// SPDX-License-Identifier: AGPL-3.0-or-later
/** Stories for the room materials panel; each keeps its own room, so the choices work in Storybook. */
import type { Meta, StoryObj } from '@storybook/html-vite';
import type { RoomMaterials } from '../tools/room';
import { renderMaterialsPanel, type MaterialChoice, type MaterialsLabels } from './materials-view';

export interface MaterialsArgs {
    readonly current: RoomMaterials;
    readonly floors: readonly MaterialChoice[];
    readonly walls: readonly MaterialChoice[];
}

const LABELS: MaterialsLabels = {
    floor: 'Floor',
    wall: 'Walls',
    noWall: 'Not drawn',
    wallKind: 'Wall kind',
    // Named as Foundry's own Walls palette names them.
    wallKinds: { solid: 'Solid Wall', terrain: 'Terrain Wall', invisible: 'Invisible Wall', ethereal: 'Ethereal Wall', window: 'Window' },
    ceiling: 'Ceiling (when a level is above)',
};

/** Mount an interactive panel inside a stand-in Foundry window scoped for the module's styles. */
export function mountMaterialsPanel(args: MaterialsArgs): HTMLElement {
    const windowEl = document.createElement('div');
    windowEl.className = 'zephyr-cartography zc-story-window';
    const root = document.createElement('div');
    windowEl.append(root);
    let current = args.current;
    const render = (): void => {
        renderMaterialsPanel(root, { current, floors: args.floors, walls: args.walls }, LABELS, (materials) => {
            current = materials;
            render();
        });
    };
    render();
    return windowEl;
}

const FLOORS: readonly MaterialChoice[] = [
    { role: 'dirt', label: 'Dirt' },
    { role: 'rock', label: 'Rock' },
    { role: 'floor.oak', label: 'oak' },
];

const meta: Meta<MaterialsArgs> = {
    title: 'Rooms/Materials Panel',
    excludeStories: ['mountMaterialsPanel'],
    render: mountMaterialsPanel,
    args: { current: { floor: 'dirt', wall: null, wallKind: 'solid', ceiling: true }, floors: FLOORS, walls: [{ role: 'wall.brick', label: 'brick' }] },
};

export default meta;

type Story = StoryObj<MaterialsArgs>;

export const DirtFloorNoWalls: Story = {};

export const OakWithBrickWalls: Story = {
    args: { current: { floor: 'floor.oak', wall: 'wall.brick', wallKind: 'solid', ceiling: true } },
};

export const GlassWalledRoom: Story = {
    args: { current: { floor: 'floor.oak', wall: null, wallKind: 'window', ceiling: true } },
};

export const OpenCourtyard: Story = {
    args: { current: { floor: 'rock', wall: 'wall.brick', wallKind: 'solid', ceiling: false } },
};

export const MaterialsMissingFromTheSet: Story = {
    args: { current: { floor: 'floor.marble', wall: 'wall.granite', wallKind: 'solid', ceiling: true }, walls: [] },
};
