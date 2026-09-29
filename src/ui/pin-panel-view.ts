// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The map pin panel: its text, the journal entry and page it opens (chosen
 * from the world's journal), its icon (typed or browsed for) and its size,
 * whether everyone sees it, and whether players read it on hover with no icon
 * drawn (a sign's words). Named with Foundry's own Note sheet strings. A pure
 * function from the pin's settings and the journal to elements; unit-tested
 * under happy-dom.
 */
import type { PinSettings } from '../tools/pin';
import { button, choice, fieldWithAction, labelledCheckbox, labelledInput, replacePreservingFocus } from './dom';

/** A journal entry a pin can open, and its pages. */
export interface JournalChoice {
    readonly id: string;
    readonly name: string;
    readonly pages: readonly { readonly id: string; readonly name: string }[];
}

export interface PinPanel {
    readonly settings: PinSettings;
    readonly journal: readonly JournalChoice[];
}

export interface PinLabels {
    readonly text: string;
    readonly entry: string;
    readonly page: string;
    /** The "opens nothing" / "the whole entry" choice. */
    readonly none: string;
    readonly icon: string;
    readonly browse: string;
    readonly global: string;
    /** The icon's size, in px; left empty, Foundry's own. */
    readonly size: string;
    readonly readable: string;
}

export interface PinHandlers {
    readonly set: (settings: PinSettings) => void;
    /** Pick the icon with Foundry's file picker. */
    readonly browse: () => void;
}

/** Select value standing for "none" (no real id is empty). */
const NONE = '';

export function renderPinPanel(root: HTMLElement, panel: PinPanel, labels: PinLabels, handlers: PinHandlers): void {
    const { settings } = panel;
    const set = (change: Partial<PinSettings>): void => {
        handlers.set({ ...settings, ...change });
    };
    // An entry no longer in the journal stays selectable, so opening the panel never silently changes the pin.
    const entries: readonly JournalChoice[] =
        settings.entry === null || panel.journal.some((e) => e.id === settings.entry)
            ? panel.journal
            : [...panel.journal, { id: settings.entry, name: settings.entry, pages: [] }];
    const pages = entries.find((e) => e.id === settings.entry)?.pages ?? [];
    const browse = button('tw-text-xs', '…', 'pin-browse', handlers.browse);
    browse.setAttribute('aria-label', labels.browse);
    browse.title = labels.browse;
    replacePreservingFocus(root, [
        labelledInput(labels.text, 'text', settings.text, 'pin-text', (text) => {
            set({ text });
            return true;
        }),
        choice(
            'zc-pin-entry',
            labels.entry,
            [[NONE, labels.none] as const, ...entries.map((e) => [e.id, e.name] as const)],
            settings.entry ?? NONE,
            (entry) => {
                // Another entry's pages are not this one's.
                set({ entry: entry === NONE ? null : entry, page: null });
            },
        ),
        choice(
            'zc-pin-page',
            labels.page,
            [[NONE, labels.none] as const, ...pages.map((p) => [p.id, p.name] as const)],
            pages.some((p) => p.id === settings.page) ? settings.page ?? NONE : NONE,
            (page) => {
                set({ page: page === NONE ? null : page });
            },
        ),
        fieldWithAction(
            labelledInput(labels.icon, 'text', settings.icon ?? '', 'pin-icon', (typed) => {
                set({ icon: typed.trim() === '' ? null : typed.trim() });
                return true;
            }),
            browse,
        ),
        labelledInput(labels.size, 'number', settings.size === null ? '' : String(settings.size), 'pin-size', (typed) => {
            if (typed.trim() === '') {
                set({ size: null });
                return true;
            }
            const size = Number(typed);
            if (!Number.isFinite(size) || size <= 0) {
                return false;
            }
            set({ size });
            return true;
        }),
        labelledCheckbox(labels.global, settings.global, 'pin-global', (everywhere) => {
            set({ global: everywhere });
        }),
        labelledCheckbox(labels.readable, settings.readable, 'pin-readable', (readable) => {
            set({ readable });
        }),
    ]);
}
