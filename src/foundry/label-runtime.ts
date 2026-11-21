// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The map label window: opened on a label placed or clicked with the label
 * tool, in Foundry's Drawings controls. It sets the label's text, font size,
 * colour, font (from `CONFIG.fontDefinitions`), rotation and visibility,
 * labelled with Foundry's own Drawing sheet strings. The label itself is
 * the controller's.
 */
import type { CartographyController } from '../canvas/controller';
import { I18N } from '../i18n';
import { editOver } from '../tools/edit-over';
import { type LabelLabels, renderLabelPanel } from '../ui/label-panel-view';
import { localize } from './localize';
import { createViewWindow } from './view-window';

const PANEL_WIDTH = 360;

function labels(): LabelLabels {
    return {
        text: localize('DRAWING.FIELDS.text.label'),
        fontSize: localize('DRAWING.FIELDS.fontSize.label'),
        colour: localize('DRAWING.FIELDS.textColor.label'),
        fontFamily: localize('DRAWING.FIELDS.fontFamily.label'),
        defaultFont: localize(I18N.labels.defaultFont),
        rotation: localize(I18N.labels.rotation),
        hidden: localize(I18N.labels.hidden),
    };
}

export interface LabelRuntime {
    /** Open the panel for a label. */
    readonly edit: (labelId: string) => void;
}

export function registerLabelRuntime(controller: () => CartographyController | null): LabelRuntime {
    let labelId: string | null = null;

    const panel = createViewWindow({
        id: 'label',
        title: () => localize(I18N.labels.title),
        width: PANEL_WIDTH,
        render: (root) => {
            const active = controller();
            const id = labelId;
            const settings = id !== null && active ? active.labelSettings(id) : null;
            if (!active || id === null || !settings) {
                root.replaceChildren();
                return;
            }
            renderLabelPanel(root, { settings, fonts: Object.keys(CONFIG.fontDefinitions) }, labels(), (next) => {
                panel.apply(async () => {
                    // Laid over the label as it stands when the edit runs, not as the panel last drew it.
                    const current = active.labelSettings(id);
                    return active.setLabelSettings(id, current ? editOver(current, settings, next) : next);
                });
            });
        },
    });

    return {
        edit: (id) => {
            labelId = id;
            panel.open();
            panel.refresh();
        },
    };
}
