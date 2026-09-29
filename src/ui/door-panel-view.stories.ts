// SPDX-License-Identifier: AGPL-3.0-or-later
/** Stories for the room door panel; each keeps its own door, so the controls work in Storybook. */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { type DoorSettings, NEW_DOOR } from '../tools/room';
import { renderDoorPanel, type DoorPanelLabels } from './door-panel-view';

export interface DoorPanelArgs {
    readonly door: DoorSettings;
    readonly onRemove: () => void;
}

const LABELS: DoorPanelLabels = {
    type: 'Door type',
    state: 'Door state',
    types: { door: 'Door', secret: 'Secret door', opening: 'Opening (no door, no wall)' },
    states: { closed: 'Closed', open: 'Open', locked: 'Locked' },
    sound: 'Door sound',
    // A few of Foundry's own door sounds, as Foundry names them.
    sounds: { woodBasic: 'Wood (Basic)', woodCreaky: 'Wood (Creaky)', metal: 'Metal', slidingMetal: 'Sliding Metal' },
    animation: 'Door animation',
    animations: { ascend: 'Ascend', descend: 'Descend', slide: 'Slide', swing: 'Swing', swivel: 'Swivel' },
    foundryDefault: 'Foundry default',
    remove: 'Remove door',
};

/** Mount an interactive panel inside a stand-in Foundry window scoped for the module's styles. */
export function mountDoorPanel(args: DoorPanelArgs): HTMLElement {
    const windowEl = document.createElement('div');
    windowEl.className = 'zephyrex-cartography zc-story-window';
    const root = document.createElement('div');
    windowEl.append(root);
    let door = args.door;
    const render = (): void => {
        renderDoorPanel(root, door, LABELS, {
            set: (settings) => {
                door = settings;
                render();
            },
            remove: args.onRemove,
        });
    };
    render();
    return windowEl;
}

const meta: Meta<DoorPanelArgs> = {
    title: 'Rooms/Door Panel',
    excludeStories: ['mountDoorPanel'],
    render: mountDoorPanel,
    args: { door: NEW_DOOR },
    argTypes: { onRemove: { action: 'remove' } },
};

export default meta;

type Story = StoryObj<DoorPanelArgs>;

export const ClosedDoor: Story = {};

export const LockedSecretDoor: Story = {
    args: { door: { ...NEW_DOOR, type: 'secret', state: 'locked' } },
};

export const SlidingMetalDoor: Story = {
    args: { door: { ...NEW_DOOR, sound: 'slidingMetal', animation: 'slide' } },
};
