// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A readable Note is words on the map for players to read: a sign, a plaque,
 * graffiti. It shows its text on hover as every Note does, but draws no icon
 * of its own, so the art beneath is what players see. The GM still sees its
 * icon while on the Notes layer, to find and edit it. It extends whatever Note
 * class is configured, so another module's own override still applies to
 * every other Note. A readable Note is marked by the module's `readable` flag.
 *
 * A Note marked `hidden` (a building's name the party has not learnt yet) is
 * never seen by players until the GM reveals it, by the "Hidden from players"
 * box this module adds to Foundry's own Note sheet.
 */
import type { CartographyController } from '../canvas/controller';
import { I18N } from '../i18n';
import { MODULE_ID } from '../module-id';
import { changesHidden, noteMarked } from '../tools/note-marks';
import { localize } from './localize';

declare global {
    interface FlagConfig {
        /** A Note's marks: drawn with no icon over the art beneath (`readable`), and hidden from players until revealed (`hidden`). */
        Note: { 'zephyr-cartography': { readable?: boolean; hidden?: boolean } };
    }
}

/** Install the readable Note over the configured Note class; call once, at setup, after other modules' init. */
export function registerReadableNote(): void {
    const Base = CONFIG.Note.objectClass;
    class ReadableNote extends Base {
        override get isVisible(): boolean {
            // Hidden until the GM reveals it: no player sees it, however near their tokens stand.
            return noteMarked(this.document.flags, 'hidden') && game.user?.isGM !== true ? false : super.isVisible;
        }

        protected override _refreshState(): void {
            super._refreshState();
            const control = this.controlIcon;
            if (control === null || !noteMarked(this.document.flags, 'readable')) {
                return;
            }
            const shown = game.user?.isGM === true && this.layer.active;
            control.bg.visible = shown;
            control.icon.visible = shown;
            control.border.visible = shown;
        }
    }
    CONFIG.Note.objectClass = ReadableNote;
}

/**
 * Reveal and hide in play: the Note sheet gains a "Hidden from players" box
 * (submitted with the sheet as the module's flag), every client redraws a Note
 * whose mark changed, and the active GM records it on the feature that owns
 * the Note, so a later re-sync keeps it as left.
 */
export function followNoteReveals(controller: () => CartographyController | null): void {
    Hooks.on('renderNoteConfig', (app, element) => {
        const note = app.document;
        const globalField = element.querySelector('[name="global"]')?.closest('.form-group');
        if (!(globalField instanceof HTMLElement) || game.user?.isGM !== true) {
            return;
        }
        const id = `${app.id}-${MODULE_ID}-hidden`;
        const group = document.createElement('div');
        group.className = 'form-group';
        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = localize(I18N.pins.hidden);
        const fields = document.createElement('div');
        fields.className = 'form-fields';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.id = id;
        box.name = `flags.${MODULE_ID}.hidden`;
        box.checked = noteMarked(note.flags, 'hidden');
        fields.append(box);
        group.append(label, fields);
        globalField.after(group);
    });
    Hooks.on('updateNote', (note, changed) => {
        if (!changesHidden(changed.flags)) {
            return;
        }
        note.object?.renderFlags.set({ refreshVisibility: true, refreshState: true });
        const active = controller();
        if (active && note.id !== null && game.users?.activeGM?.isSelf === true) {
            void active.followNoteHidden(note.id, noteMarked(note.flags, 'hidden'));
        }
    });
}
