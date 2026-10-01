// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TRAVEL } from '../tools/submap';
import * as stories from './submap-view.stories';

const base: stories.SubmapArgs = {
    stampName: 'Residence Block',
    linkedScene: null,
    scenes: [
        { id: 'vault', name: 'Vault' },
        { id: 'crypt', name: 'Crypt' },
    ],
    travel: DEFAULT_TRAVEL,
    floors: [],
    onOpen: () => undefined,
};

function mount(args: Partial<stories.SubmapArgs> = {}): HTMLElement {
    const el = stories.mountSubmapPanel({ ...base, ...args });
    document.body.replaceChildren(el);
    return el;
}

function click(root: HTMLElement, label: string): void {
    const found = [...root.querySelectorAll('button')].find((b) => b.textContent === label);
    if (!found) {
        throw new Error(`no button ${label}`);
    }
    found.click();
}

function statusText(root: HTMLElement): string {
    return root.querySelector('[role="status"]')?.textContent ?? '';
}

describe('interior panel', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    it('says an unlinked stamp leads nowhere and offers every way in: a new scene, an existing one, or floors here', () => {
        const root = mount();
        expect(root.querySelector('h3')?.textContent).toBe('Residence Block');
        expect(statusText(root)).toBe('This building does not lead anywhere yet.');
        expect(root.querySelector('label[for="zc-submap-scene"]')).not.toBeNull();
        expect([...root.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Create an interior scene', 'Link scene', 'Add floors']);
    });

    it('creates an interior', () => {
        const root = mount();
        click(root, 'Create an interior scene');
        expect(statusText(root)).toBe('Leads into Residence Block interior');
    });

    it('links the chosen existing scene, then opens and unlinks it', () => {
        let opened = 0;
        const root = mount({
            onOpen: () => {
                opened += 1;
            },
        });
        const select = root.querySelector('select');
        if (select) {
            select.value = 'crypt';
        }
        click(root, 'Link scene');
        expect(statusText(root)).toBe('Leads into Crypt');
        click(root, 'Open the interior');
        expect(opened).toBe(1);
        click(root, 'Unlink');
        expect(statusText(root)).toBe('This building does not lead anywhere yet.');
    });

    it('explains when there is nothing to link', () => {
        const root = mount({ scenes: [] });
        expect(root.textContent).toContain('There are no other scenes to link.');
        expect(root.querySelector('select')).toBeNull();
    });

    it('offers travel options once linked: where tokens arrive, Foundry’s transitions and their length, and the prompt', () => {
        expect(mount().querySelector('#zc-travel-placement')).toBeNull();
        const root = mount(stories.LinkedWithATransition.args);
        const select = (id: string): HTMLSelectElement => {
            const found = root.querySelector<HTMLSelectElement>(`#${id}`);
            if (!found) {
                throw new Error(`no select ${id}`);
            }
            return found;
        };
        expect(select('zc-travel-placement').value).toBe('center');
        expect(select('zc-travel-transition').value).toBe('swirl');
        expect([...select('zc-travel-transition').options].map((o) => o.textContent)).toEqual(['None', 'Fade', 'Swirl', 'Water Drop']);
        const change = (node: HTMLInputElement | HTMLSelectElement, value: string): void => {
            node.value = value;
            node.dispatchEvent(new Event('change'));
        };
        change(select('zc-travel-transition'), '');
        expect(select('zc-travel-transition').value).toBe('');
        const inputs = (): HTMLInputElement[] => [...root.querySelectorAll<HTMLInputElement>('fieldset input:not([type="checkbox"])')];
        expect(inputs().map((i) => i.value)).toEqual(['2000', 'Descend into {scene}?']);
        const [duration] = inputs();
        if (duration) {
            change(duration, '100');
        }
        expect(inputs()[0]?.value).toBe('2000');
    });

    it('sets whether a token snaps where it lands, and whether players see where the way leads', () => {
        const root = mount(stories.LinkedWithATransition.args);
        const box = (label: string): HTMLInputElement => {
            const found = [...root.querySelectorAll('label')].find((l) => l.textContent === label)?.querySelector('input');
            if (!found) {
                throw new Error(`no checkbox ${label}`);
            }
            return found;
        };
        expect([box('Snap').checked, box('Revealed').checked]).toEqual([true, true]);
        box('Snap').click();
        box('Revealed').click();
        expect([box('Snap').checked, box('Revealed').checked]).toEqual([false, false]);
    });

    it('offers floors in this scene instead: adds as many as asked, lists them, and removes the stairs', () => {
        const root = mount();
        expect(root.textContent).toContain('No floors in this scene.');
        expect([...root.querySelectorAll('button')].some((b) => b.textContent === 'Remove the stairs')).toBe(false);
        const count = [...root.querySelectorAll<HTMLInputElement>('input[type="number"]')].at(-1);
        if (count) {
            count.value = '2';
            count.dispatchEvent(new Event('change'));
        }
        click(root, 'Add floors');
        expect(root.textContent).toContain('Floors: Residence Block floor 1, Residence Block floor 2');
        click(root, 'Remove the stairs');
        expect(root.textContent).toContain('No floors in this scene.');
    });

    it('renders every story', () => {
        for (const story of [stories.NotLinked, stories.Linked, stories.LinkedWithATransition, stories.FloorsInThisScene, stories.NoOtherScenes]) {
            expect(mount(story.args ?? {}).querySelector('h3')).not.toBeNull();
        }
    });
});
