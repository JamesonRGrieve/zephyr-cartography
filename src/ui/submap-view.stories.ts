// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stories for the interior panel of an enterable stamp. Each story keeps its
 * own link state, so creating, linking and unlinking all work in Storybook;
 * opening the interior is logged.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import type { SubmapTravel } from '../tools/documents';
import { DEFAULT_TRAVEL } from '../tools/submap';
import { renderSubmapPanel, type SceneChoice, type SubmapLabels } from './submap-view';

export interface SubmapArgs {
    readonly stampName: string;
    readonly linkedScene: string | null;
    readonly scenes: readonly SceneChoice[];
    readonly travel: SubmapTravel;
    readonly floors: readonly string[];
    readonly onOpen: () => void;
}

const LABELS: SubmapLabels = {
    linkedTo: (scene) => `Leads into ${scene}`,
    notLinked: 'This building does not lead anywhere yet.',
    createInterior: 'Create an interior scene',
    linkExisting: 'Or link an existing scene',
    scene: 'Scene',
    link: 'Link scene',
    open: 'Open the interior',
    unlink: 'Unlink',
    noScenes: 'There are no other scenes to link.',
    travel: {
        heading: 'Travel',
        placement: 'Arrive',
        placements: { relative: 'Where they were', center: 'At the centre', random: 'Anywhere inside' },
        snap: 'Snap',
        revealed: 'Revealed',
        transition: 'Transition',
        noTransition: 'None',
        duration: 'Length (ms)',
        prompt: 'Prompt ({token}, {region}, {scene})',
    },
    floors: {
        heading: 'Or floors in this scene',
        count: 'Floors',
        add: 'Add floors',
        remove: 'Remove the stairs',
        none: 'No floors in this scene.',
        list: (floors) => `Floors: ${floors}`,
    },
};

/** Foundry's own scene transitions, as a live world lists them. */
const TRANSITIONS: readonly (readonly [string, string])[] = [
    ['fade', 'Fade'],
    ['swirl', 'Swirl'],
    ['waterDrop', 'Water Drop'],
];

/** Mount an interactive panel inside a stand-in Foundry window scoped for the module's styles. */
export function mountSubmapPanel(args: SubmapArgs): HTMLElement {
    const windowEl = document.createElement('div');
    windowEl.className = 'zephyr-cartography zc-story-window';
    const root = document.createElement('div');
    windowEl.append(root);
    let linked = args.linkedScene;
    let scenes = [...args.scenes];
    let travel = args.travel;
    let floors = [...args.floors];
    const render = (): void => {
        renderSubmapPanel(root, { stampName: args.stampName, linkedScene: linked, scenes, travel, transitions: TRANSITIONS, floors }, LABELS, {
            addFloors: (count) => {
                floors = [...floors, ...Array.from({ length: count }, (_, i) => `${args.stampName} floor ${String(floors.length + i + 1)}`)];
                render();
            },
            removeFloors: () => {
                floors = [];
                render();
            },
            setTravel: (next) => {
                travel = next;
                render();
            },
            createInterior: () => {
                linked = `${args.stampName} interior`;
                scenes = [...scenes, { id: `new-${scenes.length}`, name: linked }];
                render();
            },
            link: (sceneId) => {
                linked = scenes.find((s) => s.id === sceneId)?.name ?? null;
                render();
            },
            open: args.onOpen,
            unlink: () => {
                linked = null;
                render();
            },
        });
    };
    render();
    return windowEl;
}

const meta: Meta<SubmapArgs> = {
    title: 'Submaps/Interior Panel',
    excludeStories: ['mountSubmapPanel'],
    render: mountSubmapPanel,
    args: {
        stampName: 'Hab Block',
        linkedScene: null,
        scenes: [
            { id: 'vault', name: 'Vault' },
            { id: 'undercroft', name: 'Undercroft (imported)' },
        ],
        travel: DEFAULT_TRAVEL,
        floors: [],
    },
    argTypes: { onOpen: { action: 'open' } },
};

export default meta;

type Story = StoryObj<SubmapArgs>;

export const NotLinked: Story = {};

export const Linked: Story = {
    args: { linkedScene: 'Vault' },
};

export const LinkedWithATransition: Story = {
    args: {
        linkedScene: 'Vault',
        travel: { placement: 'center', snap: true, revealed: true, transition: 'swirl', duration: 2000, prompt: 'Descend into {scene}?' },
    },
};

export const FloorsInThisScene: Story = {
    args: { floors: ['Hab Block floor 1', 'Hab Block floor 2'] },
};

export const NoOtherScenes: Story = {
    args: { scenes: [] },
};
