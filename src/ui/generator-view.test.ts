// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';
import * as stories from './generator-view.stories';

function mount(story: { readonly args?: Partial<stories.GeneratorArgs> }): HTMLElement {
    const base = stories.default.args;
    const el = stories.mountGeneratorPanel({
        presets: story.args?.presets ?? base?.presets ?? [],
        preset: story.args?.preset ?? base?.preset ?? '',
        intentText: story.args?.intentText ?? base?.intentText ?? '',
        form: story.args?.form ?? base?.form ?? { seed: 1, width: 24, height: 16, minRoom: 3, maxRoom: 8, entrance: true },
        specText: story.args?.specText ?? base?.specText ?? '',
        status: story.args?.status ?? base?.status ?? null,
        busy: story.args?.busy ?? base?.busy ?? false,
    });
    document.body.replaceChildren(el);
    return el;
}

function labelled<T extends HTMLElement>(root: HTMLElement, text: string, selector: string): T {
    const label = [...root.querySelectorAll('label')].find((l) => l.textContent === text);
    const control = label?.querySelector<T>(selector);
    if (!control) {
        throw new Error(`no control labelled ${text}`);
    }
    return control;
}

function buttonNamed(root: HTMLElement, text: string): HTMLButtonElement {
    const found = [...root.querySelectorAll('button')].find((b) => b.textContent === text);
    if (!found) {
        throw new Error(`no button ${text}`);
    }
    return found;
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('change'));
}

const statusLines = (root: HTMLElement): string[] => [...root.querySelectorAll('[role="status"] li')].map((li) => li.textContent);

describe('generator panel', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    it('shows the floor-plan settings as labelled inputs', () => {
        const root = mount(stories.Empty);
        expect(labelled<HTMLInputElement>(root, 'Seed', 'input').value).toBe('1');
        expect(labelled<HTMLInputElement>(root, 'Width', 'input').value).toBe('24');
        expect(labelled<HTMLInputElement>(root, 'Entrance', 'input').checked).toBe(true);
        expect(statusLines(root)).toEqual([]);
    });

    it('generates and announces the result in the live status line', () => {
        const root = mount(stories.Empty);
        buttonNamed(root, 'Generate').click();
        expect(statusLines(root)[0]).toMatch(/^Would build \d+ features\.$/);
        expect(root.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    });

    it('keeps valid settings, reverts invalid ones, and rolls new seeds', () => {
        const root = mount(stories.Empty);
        type(labelled<HTMLInputElement>(root, 'Width', 'input'), '30');
        expect(labelled<HTMLInputElement>(root, 'Width', 'input').value).toBe('30');
        const max = labelled<HTMLInputElement>(root, 'Largest room', 'input');
        type(max, '1');
        expect(max.value).toBe('8');
        buttonNamed(root, 'New seed').click();
        expect(labelled<HTMLInputElement>(root, 'Seed', 'input').value).not.toBe('1');
        const entrance = labelled<HTMLInputElement>(root, 'Entrance', 'input');
        entrance.checked = false;
        entrance.dispatchEvent(new Event('change'));
        expect(labelled<HTMLInputElement>(root, 'Entrance', 'input').checked).toBe(false);
    });

    it('builds a pasted spec, or lists why it was refused', () => {
        const root = mount(stories.WithSpec);
        buttonNamed(root, 'Build spec').click();
        expect(statusLines(root)).toEqual(['Would build 1 features.']);
        type(labelled<HTMLTextAreaElement>(root, 'Scene spec (JSON)', 'textarea'), '{"schemaVersion": 1, "features": [{"type": "region"}]}');
        buttonNamed(root, 'Build spec').click();
        expect(statusLines(root).length).toBeGreaterThan(0);
        expect(statusLines(root).every((line) => line.startsWith('features.0.'))).toBe(true);
    });

    it('starts a map intent from a preset, editable, and gives it another layout keeping the rest', () => {
        const root = mount(stories.Empty);
        const intent = (): HTMLTextAreaElement => labelled<HTMLTextAreaElement>(root, 'Map intent (JSON)', 'textarea');
        expect(JSON.parse(intent().value)).toMatchObject({ seed: 7, buildings: [{ key: 'inn' }] });
        const preset = root.querySelector<HTMLSelectElement>('#zc-generator-preset');
        if (preset) {
            preset.value = 'forest-road';
            preset.dispatchEvent(new Event('change'));
        }
        expect(JSON.parse(intent().value)).toMatchObject({ seed: 3, paths: [{ kind: 'road' }] });
        buttonNamed(root, 'Another layout').click();
        const reseeded = JSON.parse(intent().value);
        expect(reseeded).toMatchObject({ paths: [{ kind: 'road' }] });
        expect(reseeded).not.toMatchObject({ seed: 3 });
        // Text that is not an intent is left for the GM to fix.
        type(intent(), '{ not json');
        buttonNamed(root, 'Another layout').click();
        expect(intent().value).toBe('{ not json');
    });

    it('composes the edited intent, or lists why it was refused', () => {
        const root = mount(stories.Empty);
        buttonNamed(root, 'Compose').click();
        expect(statusLines(root)[0]).toMatch(/^Would build \d+ features\.$/);
        type(labelled<HTMLTextAreaElement>(root, 'Map intent (JSON)', 'textarea'), '{"schemaVersion": 1, "zones": [{"kind": "jungle"}]}');
        buttonNamed(root, 'Compose').click();
        expect(statusLines(root).every((line) => line.startsWith('zones.0.'))).toBe(true);
    });

    it('disables building while a build runs', () => {
        const root = mount(stories.Building);
        expect(buttonNamed(root, 'Compose').disabled).toBe(true);
        expect(buttonNamed(root, 'Generate').disabled).toBe(true);
        expect(buttonNamed(root, 'Build spec').disabled).toBe(true);
    });

    it('renders every story', () => {
        for (const story of [stories.Empty, stories.WithSpec, stories.Built, stories.RefusedSpec, stories.Building, stories.ComposedTavern]) {
            expect(mount(story).querySelectorAll('fieldset')).toHaveLength(3);
        }
    });
});
