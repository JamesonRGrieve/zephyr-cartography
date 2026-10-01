// SPDX-License-Identifier: AGPL-3.0-or-later
/** Stories for the paint tool's panel; each keeps its own choice, so picking and resizing work in Storybook. */
import type { Meta, StoryObj } from '@storybook/html-vite';
import type { BiomeKind } from '../tools/biome';
import { parseSizePx } from '../tools/size-input';
import { DEFAULT_STRENGTH, type PaintMode, parseStrength, type SplatState } from '../tools/splat';
import { parseCostInput } from '../tools/terrain-cost';
import type { TextureSwatch } from '../tools/texture';
import { renderPaintPanel, type PaintChoice, type PaintLabels, type TextureSetChoice } from './paint-panel-view';

export interface PaintArgs {
    readonly choices: readonly PaintChoice[];
    readonly biome: BiomeKind;
    readonly textures: readonly TextureSwatch[];
    readonly texture: string | null;
    readonly sets: readonly TextureSetChoice[];
    readonly set: string;
    readonly radius: number;
    readonly movementCost: number;
    readonly mode: PaintMode;
    readonly strength: number;
    readonly splat: SplatState;
    readonly backgroundBakeable: boolean;
}

const LABELS: PaintLabels = {
    ground: 'Ground',
    texture: (shown) => `Texture: ${shown}`,
    ownTexture: "The ground's own",
    textureSet: 'Texture set',
    size: 'Brush size (px)',
    movementCost: 'Movement cost (×)',
    mode: 'Brush',
    modes: { shapes: 'Paint ground', blend: 'Blend', unblend: 'Unblend' },
    strength: 'Strength (0.05–1)',
    bake: { tile: 'Bake into a tile', background: "Bake into the level's background" },
    unbake: 'Unbake to edit',
};

/** Mount an interactive panel inside a stand-in Foundry window scoped for the module's styles. */
export function mountPaintPanel(args: PaintArgs): HTMLElement {
    const windowEl = document.createElement('div');
    windowEl.className = 'zephyr-cartography zc-story-window';
    const root = document.createElement('div');
    windowEl.append(root);
    let state = {
        biome: args.biome,
        texture: args.texture,
        set: args.set,
        radius: args.radius,
        movementCost: args.movementCost,
        mode: args.mode,
        strength: args.strength,
        splat: args.splat,
    };
    const choose = (next: Partial<typeof state>): void => {
        state = { ...state, ...next };
        render();
    };
    /** A typed-value handler: `parse` it, and apply what it gives, or refuse it. */
    const accept =
        (parse: (typed: string) => number | null, apply: (value: number) => Partial<typeof state>) =>
        (typed: string): boolean => {
            const value = parse(typed);
            if (value !== null) {
                choose(apply(value));
            }
            return value !== null;
        };
    function render(): void {
        renderPaintPanel(
            root,
            { choices: args.choices, textures: args.textures, sets: args.sets, backgroundBakeable: args.backgroundBakeable, ...state },
            LABELS,
            {
                pick: (biome) => {
                    choose({ biome });
                },
                pickTexture: (texture) => {
                    choose({ texture });
                },
                chooseSet: (set) => {
                    choose({ set });
                },
                setSize: accept(parseSizePx, (radius) => ({ radius })),
                setMovementCost: accept(parseCostInput, (movementCost) => ({ movementCost })),
                setMode: (mode) => {
                    choose({ mode });
                },
                setStrength: accept(parseStrength, (strength) => ({ strength })),
                bake: (into) => {
                    choose({ splat: into });
                },
                unbake: () => {
                    choose({ splat: 'live' });
                },
            },
        );
    }
    render();
    return windowEl;
}

/** An inline tile standing in for a pack texture. */
function tile(colour: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="${colour}"/><circle cx="8" cy="8" r="4" fill="#0003"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const TEXTURED: readonly PaintChoice[] = [
    { biome: 'water', label: 'Water', image: null, colour: '#2f5d7c' },
    { biome: 'grassland', label: 'Grassland', image: tile('#5a7b3c'), colour: '#5a7b3c' },
    { biome: 'forest', label: 'Forest', image: tile('#2f4a24'), colour: '#2f4a24' },
    { biome: 'sand', label: 'Sand', image: tile('#c2a866'), colour: '#c2a866' },
    { biome: 'lava', label: 'Lava', image: tile('#c1440e'), colour: '#c1440e' },
    { biome: 'snow', label: 'Snow', image: null, colour: '#dfe8ee' },
];

/** The active set's textures, as the panel lists them. */
const SET_TEXTURES: readonly TextureSwatch[] = [
    { role: 'floor.cobbled-street', label: 'Cobbled street', image: tile('#77716a') },
    { role: 'forest', label: 'Forest', image: tile('#2f4a24') },
    { role: 'grassland', label: 'Grassland', image: tile('#5a7b3c') },
    { role: 'floor.jungle-floor', label: 'Jungle floor', image: tile('#3f5a2a') },
    { role: 'floor.white-marble', label: 'White marble', image: null },
];

const SETS: readonly TextureSetChoice[] = [
    { key: 'assets:painted', label: 'Painted (hand-painted style)' },
    { key: 'assets:polyhaven', label: 'Poly Haven (CC0)' },
];

const meta: Meta<PaintArgs> = {
    title: 'Terrain/Paint Panel',
    excludeStories: ['mountPaintPanel'],
    render: mountPaintPanel,
    args: {
        choices: TEXTURED,
        biome: 'grassland',
        textures: SET_TEXTURES,
        texture: null,
        sets: SETS,
        set: 'assets:painted',
        radius: 25,
        movementCost: 1,
        mode: 'shapes',
        strength: DEFAULT_STRENGTH,
        splat: 'none',
        backgroundBakeable: true,
    },
};

export default meta;

type Story = StoryObj<PaintArgs>;

export const Grassland: Story = {};

export const WaterWithAWideBrush: Story = {
    args: { biome: 'water', radius: 120 },
};

export const DifficultMarsh: Story = {
    args: { biome: 'water', movementCost: 2 },
};

export const BlendingSand: Story = {
    args: { biome: 'sand', mode: 'blend', radius: 60, strength: 0.5, splat: 'live' },
};

export const BakedBlend: Story = {
    args: { biome: 'sand', mode: 'blend', splat: 'background' },
};

/** A blend on every level has no one level's background to go into. */
export const BlendOnEveryLevel: Story = {
    args: { biome: 'sand', mode: 'blend', splat: 'live', backgroundBakeable: false },
};

export const NoTextureSet: Story = {
    args: { choices: TEXTURED.map((choice) => ({ ...choice, image: null })), biome: 'sand', textures: [], sets: [], set: '' },
};

/** Grassland drawn in a cobbled street from the active set, its texture section open. */
export const CobbledGround: Story = {
    args: { texture: 'floor.cobbled-street' },
    play: ({ canvasElement }) => {
        canvasElement.querySelector('details')?.setAttribute('open', '');
    },
};
