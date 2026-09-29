// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A readable Note is words on the map for players to read: a sign, a plaque,
 * graffiti. It shows its text on hover as every Note does, but draws no icon
 * of its own, so the art beneath is what players see. The GM still sees its
 * icon while on the Notes layer, to find and edit it. It extends whatever Note
 * class is configured, so another module's own override still applies to
 * every other Note. A readable Note is marked by the module's `readable` flag.
 */
import { MODULE_ID } from '../module-id';

/** Whether `flags` (a Note's) mark it as readable. */
// eslint-disable-next-line no-restricted-syntax -- boundary: a document's flags are arbitrary serialised JSON
function marksReadable(flags: Readonly<Record<string, unknown>>): boolean {
    const own = flags[MODULE_ID];
    return typeof own === 'object' && own !== null && 'readable' in own && own.readable === true;
}

/** Install the readable Note over the configured Note class; call once, at setup, after other modules' init. */
export function registerReadableNote(): void {
    const Base = CONFIG.Note.objectClass;
    class ReadableNote extends Base {
        protected override _refreshState(): void {
            super._refreshState();
            const control = this.controlIcon;
            if (control === null || !marksReadable(this.document.flags)) {
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
