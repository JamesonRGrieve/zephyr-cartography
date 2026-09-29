// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The map pin window: opened on a pin placed or clicked with the pin tool, in
 * Foundry's Notes controls. It sets the pin's text, the journal entry and
 * page it opens (from the world's journal), its icon (with Foundry's file
 * picker) and its visibility, labelled with Foundry's own Note sheet strings.
 * The pin itself is the controller's.
 */
import type { CartographyController } from '../canvas/controller';
import { I18N } from '../i18n';
import { type JournalChoice, renderPinPanel, type PinLabels } from '../ui/pin-panel-view';
import { pickImage } from './file-picker';
import { localize } from './localize';
import { createViewWindow } from './view-window';

const PANEL_WIDTH = 360;

function labels(): PinLabels {
    return {
        text: localize('NOTE.FIELDS.text.label'),
        entry: localize('NOTE.FIELDS.entryId.label'),
        page: localize('NOTE.FIELDS.pageId.label'),
        none: localize(I18N.pins.none),
        icon: localize('NOTE.FIELDS.texture.src.label'),
        browse: localize(I18N.pins.browse),
        global: localize('NOTE.FIELDS.global.label'),
        size: localize('NOTE.FIELDS.iconSize.label'),
        readable: localize(I18N.pins.readable),
    };
}

/** The world's journal entries and their pages, as the pin panel offers them. */
function journal(): JournalChoice[] {
    return (game.journal?.contents ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name,
        pages: entry.pages.contents.map((page) => ({ id: page.id, name: page.name })),
    }));
}

export interface PinRuntime {
    /** Open the panel for a pin. */
    readonly edit: (pinId: string) => void;
}

export function registerPinRuntime(controller: () => CartographyController | null): PinRuntime {
    let pinId: string | null = null;

    const panel = createViewWindow({
        id: 'pin',
        title: () => localize(I18N.pins.title),
        width: PANEL_WIDTH,
        render: (root) => {
            const active = controller();
            const id = pinId;
            const settings = id !== null && active ? active.pinSettings(id) : null;
            if (!active || id === null || !settings) {
                root.replaceChildren();
                return;
            }
            const save = (next: typeof settings): void => {
                panel.apply(async () => active.setPinSettings(id, next));
            };
            renderPinPanel(root, { settings, journal: journal() }, labels(), {
                set: save,
                browse: () => {
                    void pickImage(settings.icon, (icon) => {
                        save({ ...settings, icon });
                    });
                },
            });
        },
    });

    return {
        edit: (id) => {
            pinId = id;
            panel.open();
            panel.refresh();
        },
    };
}
