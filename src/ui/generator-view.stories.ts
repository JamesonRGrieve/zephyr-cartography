// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stories for the map builder panel. Each runs the real form rules and spec
 * parser, and "builds" by reporting what it would build, so the panel is
 * fully interactive in Storybook.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { composeMap } from '../compose/compose';
import { parseMapIntent } from '../compose/intent';
import { isMapPreset, MAP_PRESETS, presetText, withSeed } from '../compose/presets';
import { generateFloorPlan } from '../generate/floor-plan';
import { DEFAULT_GENERATOR_FORM, floorPlanOptions, newSeed, withGeneratorField, type GeneratorForm } from '../generate/form';
import { formatSpecIssue, parseSceneSpecJson } from '../generate/spec';
import { renderGeneratorPanel, type GeneratorLabels, type GeneratorPanel, type PresetChoice } from './generator-view';

export type GeneratorArgs = GeneratorPanel;

const LABELS: GeneratorLabels = {
    compose: 'Compose a map',
    preset: 'Start from',
    intent: 'Map intent (JSON)',
    composeMap: 'Compose',
    reseedMap: 'Another layout',
    mode: 'Compose with',
    algorithmic: 'Algorithm',
    assisted: 'AI-assisted',
    assistUnavailable: "Composing by algorithm. Set a model in the module's settings to compose AI-assisted.",
    floorPlan: 'Floor plan',
    seed: 'Seed',
    newSeed: 'New seed',
    width: 'Width',
    height: 'Height',
    minRoom: 'Smallest room',
    maxRoom: 'Largest room',
    entrance: 'Entrance',
    generate: 'Generate',
    spec: 'Scene spec (JSON)',
    buildSpec: 'Build spec',
};

/** What a build would make, as the status line reports it. */
function describeBuild(featureCount: number): string {
    return `Would build ${featureCount} features.`;
}

/** Mount an interactive panel inside a stand-in Foundry window scoped for the module's styles. */
export function mountGeneratorPanel(args: GeneratorArgs): HTMLElement {
    const windowEl = document.createElement('div');
    windowEl.className = 'zephyr-cartography zc-story-window';
    const root = document.createElement('div');
    windowEl.append(root);
    let panel: GeneratorPanel = args;
    let seeds = 0;
    const render = (): void => {
        renderGeneratorPanel(root, panel, LABELS, {
            pickMode: (mode) => {
                panel = { ...panel, mode };
                render();
            },
            pickPreset: (preset) => {
                if (isMapPreset(preset)) {
                    panel = { ...panel, preset, intentText: presetText(preset) };
                    render();
                }
            },
            setIntentText: (intentText) => {
                panel = { ...panel, intentText };
            },
            reseedIntent: () => {
                seeds += 1;
                panel = {
                    ...panel,
                    intentText:
                        withSeed(
                            panel.intentText,
                            newSeed(() => (seeds * 0.618) % 1),
                        ) ?? panel.intentText,
                };
                render();
            },
            compose: () => {
                // Stories have no packs: the map is composed without stamps, and says so.
                const parsed = parseMapIntent(JSON.parse(panel.intentText));
                const lines = parsed.ok ? [describeBuild(composeMap(parsed.intent, new Map()).spec.features.length)] : parsed.issues.map(formatSpecIssue);
                panel = { ...panel, status: lines };
                render();
            },
            setField: (field, typed) => {
                const form = withGeneratorField(panel.form, field, typed);
                if (form) {
                    panel = { ...panel, form };
                    render();
                }
                return form !== null;
            },
            setEntrance: (entrance) => {
                panel = { ...panel, form: { ...panel.form, entrance } };
                render();
            },
            newSeed: () => {
                seeds += 1;
                panel = { ...panel, form: { ...panel.form, seed: newSeed(() => (seeds * 0.618) % 1) } };
                render();
            },
            generate: () => {
                const spec = generateFloorPlan(floorPlanOptions(panel.form, { floor: 'dirt', wall: null, wallKind: 'solid', ceiling: true }));
                panel = { ...panel, status: [describeBuild(spec.features.length)] };
                render();
            },
            setSpecText: (specText) => {
                panel = { ...panel, specText };
            },
            buildSpec: () => {
                const result = parseSceneSpecJson(panel.specText);
                panel = { ...panel, status: result.ok ? [describeBuild(result.spec.features.length)] : result.issues.map(formatSpecIssue) };
                render();
            },
        });
    };
    render();
    return windowEl;
}

const FORM: GeneratorForm = DEFAULT_GENERATOR_FORM;

const SPEC = JSON.stringify({
    schemaVersion: 1,
    features: [
        {
            type: 'room',
            points: [
                { x: 0, y: 0 },
                { x: 4, y: 0 },
                { x: 4, y: 3 },
                { x: 0, y: 3 },
            ],
            doors: [{ segment: 1 }],
        },
    ],
});

const PRESETS: readonly PresetChoice[] = MAP_PRESETS.map((key) => ({ key, label: key.replaceAll('-', ' ') }));

const meta: Meta<GeneratorArgs> = {
    title: 'Builder/Generator Panel',
    excludeStories: ['mountGeneratorPanel'],
    render: mountGeneratorPanel,
    args: {
        mode: 'algorithmic',
        assistAvailable: false,
        presets: PRESETS,
        preset: 'woodland-inn',
        intentText: presetText('woodland-inn'),
        form: FORM,
        specText: '',
        status: null,
        busy: false,
    },
};

export default meta;

type Story = StoryObj<GeneratorArgs>;

export const Empty: Story = {};

export const WithSpec: Story = {
    args: { specText: SPEC },
};

export const Built: Story = {
    args: { status: ['Built 9 features.'] },
};

export const RefusedSpec: Story = {
    args: {
        specText: '{"schemaVersion": 1, "features": [{"type": "region"}]}',
        status: ['features.0.biome: Invalid option', 'features.0.points: Invalid input'],
    },
};

export const Building: Story = {
    args: { busy: true },
};

/** A tavern's rooms picked to start from, and a composed map's report. */
export const ComposedTavern: Story = {
    args: {
        preset: 'tavern',
        intentText: presetText('tavern'),
        status: ['Composed 86 features.', 'tavern/room-2: no loaded stamp is a bed.'],
    },
};

/** A model set up, and a map composed with its help: what it chose and fixed. */
export const Assisted: Story = {
    args: {
        mode: 'assisted',
        assistAvailable: true,
        preset: 'megacity-chapel',
        intentText: presetText('megacity-chapel'),
        status: [
            'Built 64 features.',
            'The model chose the stamps of 5 places.',
            'The model asked for 3 fixes; 2 were made:',
            '#41 turn: the lectern should face the pews',
            '#57 remove: a supply cache does not belong in a nave',
        ],
    },
};
