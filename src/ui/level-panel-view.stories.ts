// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stories for the levels panel. Each story keeps its own level list and
 * applies the panel's actions to it, so selecting, renaming, re-banding,
 * adding and removing all work in Storybook.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { levelPanel, nextLevelBand, NO_LEVEL_ART, type Level } from '../tools/levels';
import { renderLevelPanel, type LevelPanelLabels } from './level-panel-view';

export interface LevelPanelArgs {
    readonly levels: readonly Level[];
    readonly active: string | null;
    readonly counts: Readonly<Record<string, number>>;
    /** A level whose look section starts open. */
    readonly openLook?: string;
    /** Told of each level preloaded; Storybook has no scenes to preload into. */
    readonly onPreload?: (id: string) => void;
}

const LABELS: LevelPanelLabels = {
    allLevels: 'All levels',
    addAbove: 'Add level above',
    addBelow: 'Add level below',
    preload: 'Preload',
    remove: 'Remove level',
    name: 'Level name',
    bottom: 'Floor elevation',
    top: 'Ceiling elevation',
    features: (count) => `${count} features`,
    empty: 'This scene has no levels yet. Everything drawn shows on every level until you add one.',
    removeBlocked: "Remove or move this level's features before removing it.",
    list: 'Scene levels, top to bottom',
    art: { background: 'Background image', foreground: 'Foreground image', fog: 'Fog image' },
    browse: (image) => `Browse for ${image}`,
    look: {
        title: 'Look',
        backgroundColor: 'Background colour',
        tints: { background: 'Background tint', foreground: 'Foreground tint' },
        thresholds: { background: 'Background alpha threshold', foreground: 'Foreground alpha threshold' },
        // Named as Foundry's own Level sheet names them.
        fit: 'Fit Mode',
        fits: { fill: 'Fill', contain: 'Contain', cover: 'Cover', width: 'Full Width', height: 'Full Height' },
        placement: {
            anchorX: 'Anchor X',
            anchorY: 'Anchor Y',
            offsetX: 'Offset X (px)',
            offsetY: 'Offset Y (px)',
            scaleX: 'Scale X',
            scaleY: 'Scale Y',
            rotation: 'Rotation (°)',
        },
        visibleLevels: 'Visible Levels',
    },
};

/** A stand-in for Foundry's file picker: the path it would return. */
const PICKED = 'maps/levels/picked.webp';

/** Mount an interactive panel inside a stand-in Foundry window scoped for the module's styles. */
export function mountLevelPanel(args: LevelPanelArgs): HTMLElement {
    const windowEl = document.createElement('div');
    windowEl.className = 'zephyr-cartography zc-story-window';
    const root = document.createElement('div');
    windowEl.append(root);
    let levels = [...args.levels];
    let active = args.active;
    let created = 0;
    const render = (): void => {
        renderLevelPanel(root, levelPanel(levels, active, args.counts), LABELS, {
            select: (id) => {
                active = id;
                render();
            },
            add: (position) => {
                created += 1;
                const id = `new-${created}`;
                levels = [...levels, { id, name: `Level ${levels.length + 1}`, ...nextLevelBand(levels, position), art: NO_LEVEL_ART }];
                active = id;
                render();
            },
            rename: (id, levelName) => {
                levels = levels.map((l) => (l.id === id ? { ...l, name: levelName } : l));
                render();
            },
            setBand: (id, bottom, ceiling) => {
                levels = levels.map((l) => (l.id === id ? { ...l, bottom, top: ceiling } : l));
                render();
            },
            setArt: (id, art) => {
                levels = levels.map((l) => (l.id === id ? { ...l, art } : l));
                render();
            },
            browse: (id, image) => {
                levels = levels.map((l) => (l.id === id ? { ...l, art: { ...l.art, [image]: PICKED } } : l));
                render();
            },
            preload: (id) => {
                args.onPreload?.(id);
            },
            remove: (id) => {
                levels = levels.filter((l) => l.id !== id);
                active = active === id ? null : active;
                render();
            },
        });
    };
    render();
    const look = root.querySelector<HTMLDetailsElement>(`details[data-zc-focus="look:${args.openLook ?? ''}"]`);
    if (look) {
        look.open = true;
    }
    return windowEl;
}

const RESIDENCE_LEVELS: readonly Level[] = [
    { id: 'cellar', name: 'Cellar', bottom: -10, top: 0, art: NO_LEVEL_ART },
    {
        id: 'ground',
        name: 'Ground floor',
        bottom: 0,
        top: 10,
        art: {
            ...NO_LEVEL_ART,
            background: 'maps/residence/ground.webp',
            foreground: 'maps/residence/roof.webp',
            tints: { ...NO_LEVEL_ART.tints, background: '#d8c8a8' },
            visibleLevels: ['cellar'],
        },
    },
    { id: 'upper', name: 'Upper floor', bottom: 10, top: 20, art: NO_LEVEL_ART },
];

const meta: Meta<LevelPanelArgs> = {
    title: 'Levels/Level Panel',
    excludeStories: ['mountLevelPanel'],
    render: mountLevelPanel,
    args: { levels: RESIDENCE_LEVELS, active: 'ground', counts: { ground: 12, upper: 4 } },
};

export default meta;

type Story = StoryObj<LevelPanelArgs>;

export const ThreeFloors: Story = {};

export const EditingAllLevels: Story = {
    args: { active: null },
};

export const GroundFloorLook: Story = {
    args: { openLook: 'ground' },
};

export const NoLevelsYet: Story = {
    args: { levels: [], active: null, counts: {} },
};
