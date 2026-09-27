// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What makes a panel usable, checked on the real page in Foundry's own theme:
 * it fits its window and opens tall enough to show what it holds, every
 * control is named for a screen reader and visible in full, holds what it
 * shows without spilling or cropping it, no two controls sit on each other,
 * no label is cut off, and no text is too small to read. A panel's problems
 * come back as sentences, so a failing test says what a GM would run into.
 */
import type { Page } from '@playwright/test';
import { MODULE_ID } from './pointer';

/** Smallest text a panel may show (px): Foundry's own smallest body text. */
const MIN_FONT_PX = 11;

/** Slack (px) for sub-pixel layout before a box counts as sticking out. */
const SLACK_PX = 1;

/** The window of panel `panel` (its id suffix, as `paint` or `zone`). */
export function panelSelector(panel: string): string {
    return `#${MODULE_ID}-${panel}`;
}

/** Everything wrong with panel `panel` as a GM would meet it; empty when it is usable. */
export async function panelProblems(page: Page, panel: string): Promise<string[]> {
    return page.evaluate(
        ({ selector, minFont, slack }) => {
            const found = document.querySelector(selector);
            const content = found?.querySelector('.window-content');
            if (!(content instanceof HTMLElement)) {
                return [`no open window ${selector}`];
            }
            // checkVisibility, not boxes: a closed section's fields keep stale boxes under content-visibility.
            const shown = (node: Element): node is HTMLElement =>
                node instanceof HTMLElement && node.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true });
            const outside = (inner: DOMRect, outer: DOMRect): boolean =>
                inner.left < outer.left - slack || inner.right > outer.right + slack || inner.top < outer.top - slack || inner.bottom > outer.bottom + slack;
            const nameOf = (node: HTMLElement): string => {
                const fieldLabels =
                    node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement
                        ? [...(node.labels ?? [])]
                        : [];
                const names = [
                    (node.getAttribute('aria-label') ?? '').trim(),
                    fieldLabels.map((label) => label.textContent.trim()).join(' '),
                    node.title.trim(),
                    node instanceof HTMLButtonElement ? node.textContent.trim() : '',
                ];
                return names.find((candidate) => candidate !== '') ?? '';
            };

            /** The window as a whole: no sideways scroll, and not opened shorter than the screen allowed. */
            function windowProblems(frame: HTMLElement): string[] {
                const problems: string[] = [];
                if (frame.scrollWidth > frame.clientWidth + slack) {
                    problems.push(`the panel scrolls sideways by ${frame.scrollWidth - frame.clientWidth} px`);
                }
                const hidden = frame.scrollHeight - frame.clientHeight;
                const bottom = found?.getBoundingClientRect().bottom ?? innerHeight;
                if (hidden > slack && bottom < innerHeight - 2 * hidden) {
                    problems.push(`the panel opens too short: ${hidden} px of it is hidden`);
                }
                return problems;
            }

            /** One control: named, inside the panel's sides, readable, and big enough for what it holds. */
            function controlProblems(control: HTMLElement, sides: DOMRect): string[] {
                const problems: string[] = [];
                const called = nameOf(control);
                const what = `${control.tagName.toLowerCase()} "${called === '' ? control.getAttribute('data-zc-focus') ?? '?' : called}"`;
                if (called === '') {
                    problems.push(`${what} has no name a screen reader can read`);
                }
                const box = control.getBoundingClientRect();
                // Only the sides count: a control below the fold is scrolled to, one past a side is not.
                if (box.left < sides.left - slack || box.right > sides.right + slack) {
                    problems.push(`${what} is cut off at the side of the panel`);
                }
                if (parseFloat(getComputedStyle(control).fontSize) < minFont) {
                    problems.push(`${what} has text smaller than ${minFont} px`);
                }
                // What a control holds (a stamp's picture, a swatch) must sit inside it, not spill over its neighbours or be cropped.
                const spills = [...control.querySelectorAll('*')].filter(shown).some((part) => outside(part.getBoundingClientRect(), box));
                // A text box scrolls the text typed or pasted into it by design (a whole map intent), so only other controls must fit theirs.
                const cropped = control.tagName !== 'TEXTAREA' && control.scrollHeight > control.clientHeight + slack;
                if (spills || cropped) {
                    problems.push(`${what} is too small for what it shows`);
                }
                return problems;
            }

            /** Every pair of controls that sit on each other (one inside the other is fine). */
            function overlaps(among: readonly HTMLElement[]): string[] {
                const problems: string[] = [];
                among.forEach((a, i) => {
                    const first = a.getBoundingClientRect();
                    for (const b of among.slice(i + 1)) {
                        const second = b.getBoundingClientRect();
                        const across = Math.min(first.right, second.right) - Math.max(first.left, second.left);
                        const down = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
                        if (across > slack && down > slack && !a.contains(b)) {
                            problems.push(`${nameOf(a) || '?'} and ${nameOf(b) || '?'} overlap`);
                        }
                    }
                });
                return problems;
            }

            const bounds = content.getBoundingClientRect();
            const controls = [...content.querySelectorAll('input, select, textarea, button')].filter(shown);
            const labels = [...content.querySelectorAll('.zc-field-label, legend, summary')].filter(shown);
            return [
                ...windowProblems(content),
                ...controls.flatMap((control) => controlProblems(control, bounds)),
                ...overlaps(controls),
                ...labels.filter((label) => label.scrollWidth > label.clientWidth + slack).map((label) => `the label "${label.textContent.trim()}" is cut off`),
            ];
        },
        { selector: panelSelector(panel), minFont: MIN_FONT_PX, slack: SLACK_PX },
    );
}

/** The panel's controls in the order Tab visits them from the first, until focus leaves the panel or comes round again. */
export async function tabOrder(page: Page, panel: string): Promise<string[]> {
    const selector = panelSelector(panel);
    const first = page.locator(`${selector} .window-content :is(input, select, textarea, button, summary)`).first();
    await first.focus();
    const visited: string[] = [];
    for (;;) {
        // eslint-disable-next-line no-await-in-loop -- Tab is sequential by nature
        const key = await page.evaluate((within) => {
            const active = document.activeElement;
            return active instanceof HTMLElement && document.querySelector(within)?.contains(active) === true
                ? (active.getAttribute('data-zc-focus') ?? active.id) || active.textContent.trim()
                : null;
        }, selector);
        if (key === null || visited.includes(key)) {
            return visited;
        }
        visited.push(key);
        // eslint-disable-next-line no-await-in-loop -- see above
        await page.keyboard.press('Tab');
    }
}
