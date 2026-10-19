// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';
import { LIQUID_LOOKS } from '../tools/path';
import * as stories from './path-panel-view.stories';

function mount(story: { readonly args?: Partial<stories.PathArgs> }): HTMLElement {
    const base = stories.default.args;
    const el = stories.mountPathPanel({
        kind: story.args?.kind ?? base?.kind ?? 'river',
        width: story.args?.width ?? base?.width ?? 40,
        walls: story.args?.walls === undefined ? base?.walls ?? null : story.args.walls,
        river: story.args?.river ?? base?.river ?? LIQUID_LOOKS.water,
        beds: story.args?.beds ?? base?.beds ?? [],
    });
    document.body.replaceChildren(el);
    return el;
}

function control<T extends HTMLElement>(root: HTMLElement, selector: string): T {
    const found = root.querySelector<T>(selector);
    if (!found) {
        throw new Error(`no control ${selector}`);
    }
    return found;
}

const liquid = (root: HTMLElement): HTMLSelectElement => control(root, '#zc-path-liquid');
const bed = (root: HTMLElement): HTMLSelectElement => control(root, '#zc-path-bed');
const shade = (root: HTMLElement): HTMLInputElement => control(root, 'input[type="color"]');
const width = (root: HTMLElement): HTMLInputElement => control(root, 'input[type="number"]');

function change(node: HTMLInputElement | HTMLSelectElement, value: string): void {
    node.value = value;
    node.dispatchEvent(new Event('change'));
}

describe('road and river panel', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    it('says how the pen draws a path and the edit tool reshapes it', () => {
        const root = mount(stories.WaterOnDirt);
        const hints = [...root.querySelectorAll('p')].map((p) => p.textContent);
        expect(hints).toHaveLength(2);
        expect(hints[0]).toMatch(/drag to curve/u);
        expect(hints[0]).toMatch(/Enter/u);
        expect(hints[1]).toMatch(/Edit tool/u);
    });

    it('shows a river’s width, liquid, shade and bed', () => {
        const root = mount(stories.WaterOnDirt);
        expect(width(root).value).toBe('40');
        expect(liquid(root).value).toBe('water');
        expect([...liquid(root).options].map((o) => o.textContent)).toEqual(['Water', 'Lava', 'Poison', 'Acid']);
        expect(shade(root).value).toBe('#2f5d7c');
        expect(bed(root).value).toBe('dirt');
        expect(bed(root).options[0]?.textContent).toBe('No bed');
    });

    it('starts a new liquid from its own shade and bed, then changes shade, bed and width', () => {
        const root = mount(stories.WaterOnDirt);
        change(liquid(root), 'lava');
        expect(shade(root).value).toBe('#ff5a1e');
        expect(bed(root).value).toBe('rock');
        change(shade(root), '#aa0000');
        change(bed(root), '');
        expect([shade(root).value, bed(root).value, liquid(root).value]).toEqual(['#aa0000', '', 'lava']);
        change(width(root), '120');
        expect(width(root).value).toBe('120');
        change(width(root), 'wide');
        expect(width(root).value).toBe('120');
    });

    it('keeps a bed the active set lacks selectable instead of silently changing it', () => {
        expect(bed(mount(stories.BarePoisonWithABedTheSetLacks)).value).toBe('floor.slime');
    });

    it('shows a road only its width and walls', () => {
        const root = mount(stories.Road);
        expect([...root.querySelectorAll('select')].map((s) => s.id)).toEqual(['zc-path-walls']);
        expect(root.querySelector('input[type="color"]')).toBeNull();
        expect(width(root).value).toBe('30');
    });

    it('offers Foundry’s wall kinds or none, showing the path’s and changing it', () => {
        const root = mount(stories.FencedRoad);
        const walls = control<HTMLSelectElement>(root, '#zc-path-walls');
        expect(walls.value).toBe('terrain');
        expect([...walls.options].map((o) => o.textContent)).toEqual(['None', 'Solid Wall', 'Terrain Wall', 'Invisible Wall', 'Ethereal Wall', 'Window']);
        change(walls, 'window');
        expect(control<HTMLSelectElement>(root, '#zc-path-walls').value).toBe('window');
        change(control<HTMLSelectElement>(root, '#zc-path-walls'), '');
        expect(control<HTMLSelectElement>(root, '#zc-path-walls').value).toBe('');
    });

    it('renders every story', () => {
        for (const story of [stories.WaterOnDirt, stories.LavaFlow, stories.BarePoisonWithABedTheSetLacks, stories.Road, stories.FencedRoad]) {
            expect(mount(story).querySelectorAll('input')).not.toHaveLength(0);
        }
    });
});
