// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The map builder panel. Compose a whole map from a map intent (starting from
 * a preset and editing it), generate a floor plan from a few settings and a
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

export interface GeneratorPanel {
    /** The presets to start a map intent from, and the one picked. */
    readonly presets: readonly PresetChoice[];
    readonly preset: string;
    /** The map intent JSON being edited. */
    readonly intentText: string;
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
    readonly preset: string;
    readonly intent: string;
    readonly composeMap: string;
    /** The button giving the map intent a new seed. */
    readonly reseedMap: string;
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
    /** Start the map intent from a preset (replacing what is in the box). */
    readonly pickPreset: (key: string) => void;
    readonly setIntentText: (text: string) => void;
    /** Give the map intent a new seed: the same map, differently. */
    readonly reseedIntent: () => void;
    readonly compose: () => void;
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
    return section(labels.compose, [
        choice('zc-generator-preset', labels.preset, presets, panel.preset, handlers.pickPreset),
        box,
        actionRow([reseed, compose]),
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
        floorPlanSection(panel, labels, handlers),
        specSection(panel, labels, handlers),
        outcome,
    ]);
}
