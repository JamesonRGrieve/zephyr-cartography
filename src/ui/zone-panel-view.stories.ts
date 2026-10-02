// SPDX-License-Identifier: AGPL-3.0-or-later
/** Stories for the zone panel; each keeps its own zone, so the controls work in Storybook. */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { cellBlock, NEW_ZONE, type ZoneSettings } from '../tools/zone';
import type { ZoneShapeKind } from '../tools/zone-shape';
import { renderZonePanel, type TokenChoice, type ZoneLabels } from './zone-panel-view';

export interface ZonePanelArgs {
    readonly settings: ZoneSettings;
    readonly tokens: readonly TokenChoice[];
    readonly presets: readonly string[];
    readonly cellSize: number | null;
}

const SHAPE_NAMES: Readonly<Record<ZoneShapeKind, string>> = {
    circle: 'Circle',
    ellipse: 'Ellipse',
    ring: 'Ring',
    cone: 'Cone',
    line: 'Line',
    rectangle: 'Rectangle',
    cells: 'Grid Spaces',
    emanation: 'Emanation',
};

/** Foundry's field names for each shape's sizes, where they differ from the plain name. */
const SIZE_NAMES: Readonly<Record<string, string>> = {
    'radius': 'Radius',
    'radiusX': 'X-Radius',
    'radiusY': 'Y-Radius',
    'innerWidth': 'Inner Width',
    'outerWidth': 'Outer Width',
    'angle': 'Angle',
    'length': 'Length',
    'width': 'Width',
    'rectangle.width': 'X-Size',
    'rectangle.height': 'Y-Size',
};

/** Named as Foundry's own shape and Region sheet strings name them. */
const LABELS: ZoneLabels = {
    name: 'Name',
    shape: 'Type',
    shapes: SHAPE_NAMES,
    size: (kind, field) => SIZE_NAMES[`${kind}.${field}`] ?? SIZE_NAMES[field] ?? field,
    curvature: 'Curvature',
    curvatures: { round: 'Round', flat: 'Flat', semicircle: 'Semicircle' },
    rows: 'Rows (grid spaces)',
    columns: 'Columns (grid spaces)',
    rotation: 'Rotation',
    gridBased: 'Is Grid-Based',
    token: 'Attached Token',
    none: 'None',
    presets: {
        title: 'Hazard presets',
        preset: 'Preset',
        apply: 'Apply to this zone',
        forget: 'Forget preset',
        name: 'Preset name',
        save: 'Save this zone as a preset',
        empty: 'No presets yet: set up a zone, then save it as one.',
    },
};

const TOKENS: readonly TokenChoice[] = [
    { id: 'tokenAcolyte0001', name: 'Sister Ibnad' },
    { id: 'tokenGunDrone001', name: 'Gun drone' },
];

/** Mount an interactive panel inside a stand-in Foundry window scoped for the module's styles. */
export function mountZonePanel(args: ZonePanelArgs): HTMLElement {
    const windowEl = document.createElement('div');
    windowEl.className = 'zephyr-cartography zc-story-window';
    const root = document.createElement('div');
    windowEl.append(root);
    let settings = args.settings;
    let presets = args.presets;
    const render = (): void => {
        renderZonePanel(root, { settings, tokens: args.tokens, presets, cellSize: args.cellSize }, LABELS, {
            set: (next) => {
                settings = next;
                render();
                return true;
            },
            // A stand-in for the world's presets: applying one just names the zone after it.
            applyPreset: (presetName) => {
                settings = { ...settings, name: presetName };
                render();
            },
            savePreset: (presetName) => {
                presets = presets.includes(presetName) || presetName.trim() === '' ? presets : [...presets, presetName.trim()];
                render();
            },
            forgetPreset: (presetName) => {
                presets = presets.filter((p) => p !== presetName);
                render();
            },
        });
    };
    render();
    return windowEl;
}

const meta: Meta<ZonePanelArgs> = {
    title: 'Regions/Zone Panel',
    excludeStories: ['mountZonePanel'],
    render: mountZonePanel,
    args: { settings: NEW_ZONE, tokens: TOKENS, presets: [], cellSize: 100 },
};

export default meta;

type Story = StoryObj<ZonePanelArgs>;

export const NewZone: Story = {};

/** A flamer's cone, following the drone that carries it. */
export const FlamerCone: Story = {
    args: {
        settings: {
            name: 'Fuel wash',
            shape: { kind: 'cone', radius: 300, angle: 60, curvature: 'flat' },
            rotation: 45,
            gridBased: true,
            attachedTo: 'tokenGunDrone001',
        },
        presets: ['Fuel slick', 'Choking gas', 'Rubble'],
    },
};

export const Ring: Story = {
    args: { settings: { ...NEW_ZONE, name: 'Cordon', shape: { kind: 'ring', radius: 400, innerWidth: 50, outerWidth: 50 } } },
};

/** Difficult ground square by square: rubble over three rows of four grid spaces. */
export const RubbleSquares: Story = {
    args: { settings: { ...NEW_ZONE, name: 'Rubble', shape: { kind: 'cells', size: 100, cells: cellBlock(3, 4) } } },
};

/** On a hex grid or none, grid spaces are not offered. */
export const NoSquareGrid: Story = {
    args: { cellSize: null },
};
