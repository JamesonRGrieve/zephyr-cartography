// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The stamp browser's DOM: a pure function from a {@link BrowserView} to
 * elements, dispatching {@link BrowserAction}s and placement requests. It is
 * built from nodes and text, never from markup strings, so pack-supplied names
 * cannot inject markup. Every control is a labelled native button, input or
 * select, and focus survives a re-render. Unit-tested under happy-dom.
 */
import type { BrowserAction, BrowserView, CardEntry } from '../stamps/browser';
import { resolveVariant } from '../stamps/catalog';
import { stampDropPayload } from '../stamps/drop';
import type { Stamp } from '../stamps/schema';
import { shownImage } from '../tools/texture';
import { el, focusKey, pressable, replacePreservingFocus } from './dom';

export interface BrowserLabels {
    readonly search: string;
    readonly scale: string;
    readonly perspective: string;
    /** Legend of the setting checkboxes. */
    readonly settings: string;
    readonly any: string;
    readonly all: string;
    readonly rotate: string;
    readonly clearTags: string;
    readonly place: string;
    readonly variants: string;
    readonly empty: string;
    readonly noSelection: string;
    readonly categories: string;
    readonly stamps: string;
    /** Formats the status line: `shown` of `total` stamps. */
    readonly status: (shown: number, total: number) => string;
    /** Formats a card's accessible description. */
    readonly cardHint: string;
}

export interface BrowserHandlers {
    readonly dispatch: (action: BrowserAction) => void;
    /** Place a stamp at the centre of the current view. */
    readonly place: (key: string, variant: number) => void;
}

const SCALES: readonly Stamp['scale'][] = ['system', 'planet', 'regional', 'city', 'exterior', 'interior'];
const PERSPECTIVES: readonly Stamp['perspective'][] = ['orthographic', 'isometric', 'front', 'central'];

function labelledSelect<T extends string>(
    id: string,
    label: string,
    anyLabel: string,
    options: readonly T[],
    value: T | null,
    onChange: (v: T | null) => void,
): HTMLElement {
    const wrap = el('label', 'tw-flex tw-items-center tw-gap-1 tw-text-xs', label);
    wrap.htmlFor = id;
    const select = el('select', 'tw-text-xs');
    select.id = id;
    focusKey(select, id);
    const any = el('option', '', anyLabel);
    any.value = '';
    select.append(any);
    for (const option of options) {
        const node = el('option', '', option);
        node.value = option;
        select.append(node);
    }
    select.value = value ?? '';
    select.addEventListener('change', () => {
        onChange(options.find((o) => o === select.value) ?? null);
    });
    wrap.append(select);
    return wrap;
}

function filterBar(view: BrowserView, labels: BrowserLabels, handlers: BrowserHandlers): HTMLElement {
    const bar = el('div', 'tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-p-2');
    const searchId = 'zc-stamp-search';
    const searchLabel = el('label', 'tw-sr-only', labels.search);
    searchLabel.htmlFor = searchId;
    const search = el('input', 'tw-flex-1 tw-text-xs');
    search.id = searchId;
    search.type = 'search';
    search.placeholder = labels.search;
    search.value = view.state.query;
    focusKey(search, searchId);
    search.addEventListener('input', () => {
        handlers.dispatch({ type: 'query', query: search.value });
    });
    const rotate = el('button', 'tw-text-xs', `⟳ ${view.state.rotation}°`);
    rotate.type = 'button';
    rotate.setAttribute('aria-label', `${labels.rotate}: ${view.state.rotation}°`);
    focusKey(rotate, 'rotate');
    rotate.addEventListener('click', () => {
        handlers.dispatch({ type: 'rotate' });
    });
    bar.append(
        searchLabel,
        search,
        labelledSelect('zc-stamp-scale', labels.scale, labels.any, SCALES, view.state.scale, (scale) => {
            handlers.dispatch({ type: 'scale', scale });
        }),
        labelledSelect('zc-stamp-perspective', labels.perspective, labels.any, PERSPECTIVES, view.state.perspective, (perspective) => {
            handlers.dispatch({ type: 'perspective', perspective });
        }),
        rotate,
    );
    return bar;
}

/** The setting filter: one labelled checkbox per setting, applying across every category. */
function settingsBar(view: BrowserView, labels: BrowserLabels, handlers: BrowserHandlers): HTMLElement | null {
    if (view.settings.length === 0) {
        return null;
    }
    const group = el('fieldset', 'tw-flex tw-flex-wrap tw-items-center tw-gap-3 tw-px-2 tw-py-0 tw-m-0 tw-border-0');
    // One legend, seen and read: floated, it sits in the row before the boxes rather than over the group's border, in
    // the panel's own label type rather than the theme's capitals.
    group.append(el('legend', 'tw-float-left tw-p-0 tw-m-0 tw-text-xs tw-font-normal tw-normal-case tw-tracking-normal', labels.settings));
    for (const entry of view.settings) {
        const id = `zc-stamp-setting-${entry.setting}`;
        const label = el('label', 'tw-flex tw-items-center tw-gap-1 tw-text-xs');
        label.htmlFor = id;
        const box = el('input', '');
        box.type = 'checkbox';
        box.id = id;
        box.checked = entry.active;
        focusKey(box, id);
        box.addEventListener('change', () => {
            handlers.dispatch({ type: 'toggleSetting', setting: entry.setting });
        });
        label.append(box, `${entry.setting} (${entry.count})`);
        group.append(label);
    }
    return group;
}

function tagBar(view: BrowserView, labels: BrowserLabels, handlers: BrowserHandlers): HTMLElement | null {
    if (view.activeTags.length === 0) {
        return null;
    }
    const bar = el('div', 'tw-flex tw-flex-wrap tw-gap-1 tw-px-2');
    for (const tag of view.activeTags) {
        bar.append(
            pressable('tw-text-xs tw-rounded-full', `${tag} ×`, true, `active-tag:${tag}`, () => {
                handlers.dispatch({ type: 'toggleTag', tag });
            }),
        );
    }
    const clear = el('button', 'tw-text-xs', labels.clearTags);
    clear.type = 'button';
    focusKey(clear, 'clear-tags');
    clear.addEventListener('click', () => {
        handlers.dispatch({ type: 'clearTags' });
    });
    bar.append(clear);
    return bar;
}

function sidebar(view: BrowserView, labels: BrowserLabels, handlers: BrowserHandlers): HTMLElement {
    const nav = el('nav', 'tw-flex tw-flex-col tw-w-40 tw-overflow-y-auto');
    nav.setAttribute('aria-label', labels.categories);
    nav.append(
        pressable('tw-text-left tw-text-xs', `${labels.all} (${view.inScale})`, view.state.category === null, 'category:', () => {
            handlers.dispatch({ type: 'category', category: null });
        }),
    );
    for (const category of view.categories) {
        nav.append(
            pressable('tw-text-left tw-text-xs', `${category.name} (${category.count})`, category.active, `category:${category.name}`, () => {
                handlers.dispatch({ type: 'category', category: category.name });
            }),
        );
        if (category.active) {
            for (const tag of category.tags) {
                nav.append(
                    pressable('tw-text-left tw-text-xs tw-pl-4', `${tag.tag} (${tag.count})`, tag.active, `tag:${tag.tag}`, () => {
                        handlers.dispatch({ type: 'toggleTag', tag: tag.tag });
                    }),
                );
            }
        }
    }
    return nav;
}

function thumbnail(src: string, alt: string): HTMLImageElement {
    const img = el('img', 'tw-max-w-full tw-max-h-full tw-object-contain tw-pointer-events-none');
    img.src = src;
    img.alt = alt;
    img.loading = 'lazy';
    img.draggable = false;
    return img;
}

function card(entry: CardEntry, view: BrowserView, labels: BrowserLabels, handlers: BrowserHandlers): HTMLElement {
    const { stamp, variant } = entry;
    const image = resolveVariant(stamp, variant);
    const item = el('li', 'tw-list-none');
    const button = el('button', 'zc-tile tw-flex tw-flex-col tw-items-center tw-w-full tw-p-1 tw-text-xs');
    button.type = 'button';
    button.draggable = true;
    button.setAttribute('aria-pressed', String(entry.selected));
    button.setAttribute('aria-label', `${stamp.name}${stamp.variants.length > 1 ? ` (${image.state})` : ''}`);
    button.title = labels.cardHint;
    button.dataset['stampKey'] = stamp.key;
    focusKey(button, `card:${stamp.key}`);
    const frame = el('div', 'tw-flex tw-items-center tw-justify-center tw-w-20 tw-h-20');
    // Compressed art with no preview has nothing a browser can show; the card's name still says what it is.
    const shown = shownImage(image.image, image.preview);
    if (shown !== null) {
        frame.append(thumbnail(shown, ''));
    }
    button.append(frame, el('span', 'tw-truncate tw-w-full tw-text-center', stamp.name));
    button.addEventListener('click', () => {
        handlers.dispatch({ type: 'select', key: stamp.key });
    });
    button.addEventListener('dblclick', () => {
        handlers.place(stamp.key, variant);
    });
    button.addEventListener('dragstart', (dragEvent) => {
        dragEvent.dataTransfer?.setData('text/plain', stampDropPayload(stamp.key, variant, view.state.rotation));
    });
    item.append(button);
    return item;
}

function grid(view: BrowserView, labels: BrowserLabels, handlers: BrowserHandlers): HTMLElement {
    // content-start: rows pack at the top instead of stretching to fill the panel.
    const list = el('ul', 'tw-grid tw-grid-cols-4 tw-content-start tw-gap-1 tw-flex-1 tw-overflow-y-auto tw-p-0 tw-m-0');
    list.setAttribute('aria-label', labels.stamps);
    if (view.cards.length === 0) {
        list.append(el('li', 'tw-list-none tw-italic tw-text-xs', labels.empty));
        return list;
    }
    for (const entry of view.cards) {
        list.append(card(entry, view, labels, handlers));
    }
    return list;
}

function details(view: BrowserView, labels: BrowserLabels, handlers: BrowserHandlers): HTMLElement {
    const panel = el('section', 'tw-flex tw-flex-col tw-gap-1 tw-w-44 tw-overflow-y-auto tw-p-1');
    const selected = view.selected;
    if (!selected) {
        panel.append(el('p', 'tw-italic tw-text-xs', labels.noSelection));
        return panel;
    }
    const { stamp, variant } = selected;
    panel.setAttribute('aria-label', stamp.name);
    panel.append(el('h3', 'tw-text-sm tw-font-bold', stamp.name));
    const list = el('ul', 'tw-flex tw-flex-col tw-gap-1 tw-p-0 tw-m-0');
    list.setAttribute('aria-label', labels.variants);
    stamp.variants.forEach((v, index) => {
        const item = el('li', 'tw-list-none');
        const button = pressable('zc-tile tw-flex tw-items-center tw-gap-2 tw-w-full tw-text-xs', '', index === variant, `variant:${index}`, () => {
            handlers.dispatch({ type: 'variant', key: stamp.key, index });
        });
        const frame = el('span', 'tw-flex tw-items-center tw-justify-center tw-w-10 tw-h-10');
        frame.append(thumbnail(v.image, ''));
        button.append(frame, el('span', '', `${v.state} (${v.width}×${v.height})`));
        button.addEventListener('dblclick', () => {
            handlers.place(stamp.key, index);
        });
        item.append(button);
        list.append(item);
    });
    const place = el('button', 'tw-text-xs', labels.place);
    place.type = 'button';
    focusKey(place, 'place');
    place.addEventListener('click', () => {
        handlers.place(stamp.key, variant);
    });
    panel.append(list, place);
    return panel;
}

/** Replace `root`'s contents with the browser for `view`, restoring focus to the same control. */
export function renderBrowser(root: HTMLElement, view: BrowserView, labels: BrowserLabels, handlers: BrowserHandlers): void {
    const body = el('div', 'tw-flex tw-flex-1 tw-min-h-0 tw-gap-2');
    body.append(sidebar(view, labels, handlers), grid(view, labels, handlers), details(view, labels, handlers));
    const statusLine = el('p', 'tw-text-xs tw-px-2', labels.status(view.cards.length, view.total));
    statusLine.setAttribute('role', 'status');
    statusLine.setAttribute('aria-live', 'polite');
    const tags = tagBar(view, labels, handlers);
    replacePreservingFocus(
        root,
        [filterBar(view, labels, handlers), settingsBar(view, labels, handlers), tags, body, statusLine].filter((node): node is HTMLElement => node !== null),
    );
}
