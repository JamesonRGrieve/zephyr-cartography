// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stories for the map builder panel. Each runs the real form rules and spec
 * parser, and "builds" by reporting what it would build, so the panel is
 * fully interactive in Storybook.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { composeMap } from '../compose/compose';
import {
    DEFAULT_ENCOUNTER,
    ENCOUNTER_BRIDGES,
    ENCOUNTER_DENSITIES,
    ENCOUNTER_FEATURES,
    ENCOUNTER_LANDSCAPES,
    ENCOUNTER_ROADS,
    ENCOUNTER_SETTINGS,
    ENCOUNTER_SIZES,
    type EncounterChoice,
    encounterIntent,
    isEncounterBridge,
    isEncounterDensity,
    isEncounterFeature,
    isEncounterLandscape,
    isEncounterRoad,
    isEncounterSetting,
    isEncounterSize,
} from '../compose/encounter';
import { parseMapIntent } from '../compose/intent';
import { isMapPreset, MAP_PRESETS, presetText, withSeed } from '../compose/presets';
import { generateFloorPlan } from '../generate/floor-plan';
import { DEFAULT_GENERATOR_FORM, floorPlanOptions, newSeed, withGeneratorField, type GeneratorForm } from '../generate/form';
import { formatSpecIssue, parseSceneSpecJson } from '../generate/spec';
import { type EncounterPanel, renderGeneratorPanel, type GeneratorLabels, type GeneratorPanel, type PresetChoice } from './generator-view';

export type GeneratorArgs = GeneratorPanel;

const LABELS: GeneratorLabels = {
    compose: 'Compose a map',
    preset: 'Start from',
    intent: 'Map intent (JSON)',
    composeMap: 'Compose',
    reseedMap: 'Another layout',
    encounter: 'Encounter map',
    encounterLandscape: 'Landscape',
    encounterRoad: 'Road',
    encounterBridge: 'Bridge',
    encounterFeatures: 'Include',
    encounterSetting: 'Setting',
    encounterSize: 'Size',
    encounterDensity: 'Cover',
    generateEncounter: 'Generate encounter',
    rerollEncounter: 'Reroll',
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

/** The checklist the panel shows, as an encounter, or null while any of it names nothing. */
function encounterOf(panel: EncounterPanel, seed: number): EncounterChoice | null {
    const { landscape, road, bridge, setting, size, density } = panel;
    const features = panel.features.filter((f) => f.on).map((f) => f.key);
    if (
        !isEncounterLandscape(landscape) ||
        !isEncounterRoad(road) ||
        !isEncounterBridge(bridge) ||
        !isEncounterSetting(setting) ||
        !isEncounterSize(size) ||
        !isEncounterDensity(density)
    ) {
        return null;
    }
    return { landscape, road, bridge, features: features.filter(isEncounterFeature), setting, size, density, seed };
}

/** The encounter as ticked, its intent as the GM would edit it, with `seed`. */
function encounterText(panel: EncounterPanel, seed: number): string {
    const encounter = encounterOf(panel, seed);
    return encounter ? JSON.stringify(encounterIntent(encounter), null, 2) : '';
}

/** Mount an interactive panel inside a stand-in Foundry window scoped for the module's styles. */
export function mountGeneratorPanel(args: GeneratorArgs): HTMLElement {
    const windowEl = document.createElement('div');
    windowEl.className = 'zephyr-cartography zc-story-window';
    const root = document.createElement('div');
    windowEl.append(root);
    let panel: GeneratorPanel = args;
    let seeds = 0;
    let encounterSeed = 1;
    // Stories have no packs: the map in the box is composed without stamps, and says so.
    const composeBox = (): void => {
        const parsed = parseMapIntent(JSON.parse(panel.intentText));
        const lines = parsed.ok ? [describeBuild(composeMap(parsed.intent, new Map()).spec.features.length)] : parsed.issues.map(formatSpecIssue);
        panel = { ...panel, status: lines };
        render();
    };
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
                composeBox();
            },
            pickEncounter: (field, key) => {
                panel = { ...panel, encounter: { ...panel.encounter, [field]: key } };
                render();
            },
            toggleEncounterFeature: (key, on) => {
                panel = { ...panel, encounter: { ...panel.encounter, features: panel.encounter.features.map((f) => (f.key === key ? { ...f, on } : f)) } };
                render();
            },
            generateEncounter: () => {
                panel = { ...panel, intentText: encounterText(panel.encounter, encounterSeed) };
                composeBox();
            },
            rerollEncounter: () => {
                seeds += 1;
                encounterSeed = newSeed(() => (seeds * 0.618) % 1);
                panel = { ...panel, intentText: encounterText(panel.encounter, encounterSeed) };
                composeBox();
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

const named = (keys: readonly string[]): readonly PresetChoice[] => keys.map((key) => ({ key, label: key }));

/** The panel showing an encounter's checklist. */
function encounterPanel(encounter: EncounterChoice): EncounterPanel {
    return {
        landscapes: named(ENCOUNTER_LANDSCAPES),
        landscape: encounter.landscape,
        roads: named(ENCOUNTER_ROADS),
        road: encounter.road,
        bridges: named(ENCOUNTER_BRIDGES),
        bridge: encounter.bridge,
        features: ENCOUNTER_FEATURES.map((key) => ({ key, label: key, on: encounter.features.includes(key) })),
        settings: named(ENCOUNTER_SETTINGS),
        setting: encounter.setting,
        sizes: named(ENCOUNTER_SIZES),
        size: encounter.size,
        densities: named(ENCOUNTER_DENSITIES),
        density: encounter.density,
    };
}

const ENCOUNTER: EncounterPanel = encounterPanel(DEFAULT_ENCOUNTER);

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
        encounter: ENCOUNTER,
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

/** A grimdark marsh ticked with a river, a lake and ruins, crossed by a road on a ford: its intent in the box and its report. */
const MARSH_FORD: EncounterChoice = {
    ...DEFAULT_ENCOUNTER,
    landscape: 'marsh',
    road: 'crossroads',
    bridge: 'ford',
    features: ['river', 'lake', 'ruins'],
    setting: 'grimdark',
    seed: 4,
};
export const EncounterMarshFord: Story = {
    args: {
        encounter: encounterPanel(MARSH_FORD),
        intentText: JSON.stringify(encounterIntent(MARSH_FORD), null, 2),
        status: ['Built 140 features.'],
    },
};
