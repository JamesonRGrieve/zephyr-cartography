// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The map builder panel. Compose a whole map from a map intent (starting from
 * a preset and editing it), roll a throwaway encounter map from a checklist
 * and a seed (operator 2026-11-04), generate a floor plan from a few settings and a
 * seed, or build any scene spec pasted in as JSON. The outcome of the last
 * build, or why it was refused, is announced in a live status line. A pure
 * function from the panel state to elements; unit-tested under happy-dom.
 */
import type { GeneratorField, GeneratorForm } from '../generate/form';
import { actionRow, button, choice, el, fieldWithAction, labelledCheckbox, labelledInput, labelledTextArea, replacePreservingFocus } from './dom';

/** Lines of the scene spec box, and of the map intent box. */
const SPEC_ROWS = 6;
const INTENT_ROWS = 10;

/** A preset in the picker: its key and name. */
export interface PresetChoice {
    readonly key: string;
    readonly label: string;
}

/** How a map is composed: by the algorithm alone, or with a language model choosing stamps and critiquing the result. */
export type ComposeMode = 'algorithmic' | 'assisted';

/** A feature that can be ticked onto an encounter, and whether it is. */
interface EncounterFeatureChoice {
    readonly key: string;
    readonly label: string;
    readonly on: boolean;
}

/** The encounter to roll, as a checklist: each list's choices and the one picked, by key, and the features ticked. */
export interface EncounterPanel {
    readonly landscapes: readonly PresetChoice[];
    readonly landscape: string;
    readonly roads: readonly PresetChoice[];
    readonly road: string;
    readonly bridges: readonly PresetChoice[];
    readonly bridge: string;
    readonly features: readonly EncounterFeatureChoice[];
    readonly settings: readonly PresetChoice[];
    readonly setting: string;
    readonly sizes: readonly PresetChoice[];
    readonly size: string;
    readonly densities: readonly PresetChoice[];
    readonly density: string;
}

/** Which of an encounter's choices a picker sets. */
export type EncounterField = 'landscape' | 'road' | 'bridge' | 'setting' | 'size' | 'density';

export interface GeneratorPanel {
    readonly mode: ComposeMode;
    /** A model is set up for the AI-assisted mode. */
    readonly assistAvailable: boolean;
    /** The presets to start a map intent from, and the one picked. */
    readonly presets: readonly PresetChoice[];
    readonly preset: string;
    /** The map intent JSON being edited. */
    readonly intentText: string;
    readonly encounter: EncounterPanel;
    readonly form: GeneratorForm;
    /** The scene spec JSON being edited. */
    readonly specText: string;
    /** What the last build did, or why it could not run; null before any. */
    readonly status: readonly string[] | null;
    /** A build is in progress: the build buttons are disabled. */
    readonly busy: boolean;
}

export interface GeneratorLabels {
    readonly compose: string;
    readonly mode: string;
    readonly algorithmic: string;
    readonly assisted: string;
    /** Where to set up a model, while none is. */
    readonly assistUnavailable: string;
    readonly preset: string;
    readonly intent: string;
    readonly composeMap: string;
    /** The button giving the map intent a new seed. */
    readonly reseedMap: string;
    readonly encounter: string;
    readonly encounterLandscape: string;
    readonly encounterRoad: string;
    /** How a road crosses a river; shown while the river is ticked. */
    readonly encounterBridge: string;
    /** The heading over the features' tick boxes. */
    readonly encounterFeatures: string;
    readonly encounterSetting: string;
    readonly encounterSize: string;
    readonly encounterDensity: string;
    /** Compose the encounter as picked, with its seed. */
    readonly generateEncounter: string;
    /** Compose the same encounter again with a fresh seed: another layout of the same place. */
    readonly rerollEncounter: string;
    readonly floorPlan: string;
    readonly seed: string;
    readonly newSeed: string;
    readonly width: string;
    readonly height: string;
    readonly minRoom: string;
    readonly maxRoom: string;
    readonly entrance: string;
    readonly generate: string;
    readonly spec: string;
    readonly buildSpec: string;
}

export interface GeneratorHandlers {
    readonly pickMode: (mode: ComposeMode) => void;
    /** Start the map intent from a preset (replacing what is in the box). */
    readonly pickPreset: (key: string) => void;
    readonly setIntentText: (text: string) => void;
    /** Give the map intent a new seed: the same map, differently. */
    readonly reseedIntent: () => void;
    readonly compose: () => void;
    readonly pickEncounter: (field: EncounterField, key: string) => void;
    /** Tick a feature onto the encounter, or off it. */
    readonly toggleEncounterFeature: (key: string, on: boolean) => void;
    /** Put the encounter's intent in the box and compose it. */
    readonly generateEncounter: () => void;
    /** The same, with a fresh seed. */
    readonly rerollEncounter: () => void;
    /** Apply a typed setting; false rejects it (the input reverts). */
    readonly setField: (field: GeneratorField, typed: string) => boolean;
    readonly setEntrance: (on: boolean) => void;
    readonly newSeed: () => void;
    readonly generate: () => void;
    readonly setSpecText: (text: string) => void;
    readonly buildSpec: () => void;
}

const FIELDS: readonly { readonly field: GeneratorField; readonly label: keyof GeneratorLabels }[] = [
    { field: 'width', label: 'width' },
    { field: 'height', label: 'height' },
    { field: 'minRoom', label: 'minRoom' },
    { field: 'maxRoom', label: 'maxRoom' },
];

function section(title: string, children: readonly HTMLElement[]): HTMLElement {
    const fieldset = el('fieldset', 'tw-flex tw-flex-wrap tw-items-center tw-gap-2');
    fieldset.append(el('legend', 'tw-text-xs tw-font-bold', title), ...children);
    return fieldset;
}

function floorPlanSection(panel: GeneratorPanel, labels: GeneratorLabels, handlers: GeneratorHandlers): HTMLElement {
    const { form } = panel;
    const entrance = labelledCheckbox(labels.entrance, form.entrance, 'entrance', handlers.setEntrance);
    const generate = button('tw-text-xs', labels.generate, 'generate', handlers.generate);
    generate.disabled = panel.busy;
    return section(labels.floorPlan, [
        fieldWithAction(
            labelledInput(labels.seed, 'number', String(form.seed), 'seed', (typed) => handlers.setField('seed', typed)),
            button('tw-text-xs', labels.newSeed, 'new-seed', handlers.newSeed),
        ),
        ...FIELDS.map(({ field, label }) => labelledInput(labels[label], 'number', String(form[field]), field, (typed) => handlers.setField(field, typed))),
        entrance,
        generate,
    ]);
}

/** A text box and the button that acts on its text, committing the text first even while the box still has focus. */
function textWithAction(box: HTMLElement, commit: (text: string) => void, act: () => void, label: string, key: string, busy: boolean): HTMLButtonElement {
    const action = button('tw-text-xs', label, key, () => {
        const area = box.querySelector('textarea');
        if (area) {
            commit(area.value);
        }
        act();
    });
    action.disabled = busy;
    return action;
}

function composeSection(panel: GeneratorPanel, labels: GeneratorLabels, handlers: GeneratorHandlers): HTMLElement {
    const presets = panel.presets.map((p) => [p.key, p.label] as const);
    const box = labelledTextArea(labels.intent, panel.intentText, 'intent', INTENT_ROWS, handlers.setIntentText);
    box.classList.add('zc-field-wide');
    const compose = textWithAction(box, handlers.setIntentText, handlers.compose, labels.composeMap, 'compose', panel.busy);
    const reseed = textWithAction(box, handlers.setIntentText, handlers.reseedIntent, labels.reseedMap, 'reseed-intent', false);
    // The mode is a choice once a model is set up; until then there is only the algorithm, and a hint says where to set one.
    const modes: readonly (readonly [ComposeMode, string])[] = [
        ['algorithmic', labels.algorithmic],
        ['assisted', labels.assisted],
    ];
    const mode = panel.assistAvailable
        ? choice('zc-generator-mode', labels.mode, modes, panel.mode, handlers.pickMode)
        : el('p', 'tw-italic tw-text-xs tw-w-full', labels.assistUnavailable);
    return section(labels.compose, [
        mode,
        choice('zc-generator-preset', labels.preset, presets, panel.preset, handlers.pickPreset),
        box,
        actionRow([reseed, compose]),
    ]);
}

function encounterSection(panel: GeneratorPanel, labels: GeneratorLabels, handlers: GeneratorHandlers): HTMLElement {
    const { encounter } = panel;
    const picker = (field: EncounterField, label: string, items: readonly PresetChoice[], current: string): HTMLElement =>
        choice(
            `zc-generator-encounter-${field}`,
            label,
            items.map((i) => [i.key, i.label] as const),
            current,
            (key) => handlers.pickEncounter(field, key),
        );
    const generate = button('tw-text-xs', labels.generateEncounter, 'generate-encounter', handlers.generateEncounter);
    const reroll = button('tw-text-xs', labels.rerollEncounter, 'reroll-encounter', handlers.rerollEncounter);
    generate.disabled = panel.busy;
    reroll.disabled = panel.busy;
    // The checklist: the landscape and its ways, what stands on it, then the world, the size and the cover.
    const ticks = el('div', 'tw-flex tw-flex-wrap tw-gap-2 tw-w-full');
    ticks.setAttribute('role', 'group');
    ticks.setAttribute('aria-label', labels.encounterFeatures);
    ticks.append(
        el('span', 'tw-text-xs tw-w-full', labels.encounterFeatures),
        ...encounter.features.map((f) => labelledCheckbox(f.label, f.on, `encounter-feature-${f.key}`, (on) => handlers.toggleEncounterFeature(f.key, on))),
    );
    const riverTicked = encounter.features.some((f) => f.key === 'river' && f.on);
    const roadLaid = encounter.road !== 'none';
    return section(labels.encounter, [
        picker('landscape', labels.encounterLandscape, encounter.landscapes, encounter.landscape),
        picker('road', labels.encounterRoad, encounter.roads, encounter.road),
        ticks,
        // A bridge is asked only where a road meets a river.
        ...(riverTicked && roadLaid ? [picker('bridge', labels.encounterBridge, encounter.bridges, encounter.bridge)] : []),
        picker('setting', labels.encounterSetting, encounter.settings, encounter.setting),
        picker('size', labels.encounterSize, encounter.sizes, encounter.size),
        picker('density', labels.encounterDensity, encounter.densities, encounter.density),
        actionRow([reroll, generate]),
    ]);
}

function specSection(panel: GeneratorPanel, labels: GeneratorLabels, handlers: GeneratorHandlers): HTMLElement {
    const wrap = labelledTextArea(labels.spec, panel.specText, 'spec', SPEC_ROWS, handlers.setSpecText);
    return section(labels.spec, [wrap, textWithAction(wrap, handlers.setSpecText, handlers.buildSpec, labels.buildSpec, 'build-spec', panel.busy)]);
}

/** Replace `root`'s contents with the panel, keeping keyboard focus in place. */
export function renderGeneratorPanel(root: HTMLElement, panel: GeneratorPanel, labels: GeneratorLabels, handlers: GeneratorHandlers): void {
    const outcome = el('ul', 'tw-text-xs tw-m-0 tw-p-0 tw-list-none');
    outcome.setAttribute('role', 'status');
    outcome.setAttribute('aria-live', 'polite');
    for (const line of panel.status ?? []) {
        outcome.append(el('li', '', line));
    }
    replacePreservingFocus(root, [
        composeSection(panel, labels, handlers),
        encounterSection(panel, labels, handlers),
        floorPlanSection(panel, labels, handlers),
        specSection(panel, labels, handlers),
        outcome,
    ]);
}
