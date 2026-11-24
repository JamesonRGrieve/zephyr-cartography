// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A panel's edit laid over its feature as it stands now.
 *
 * A panel builds each edit from the settings it last drew. Edits made close together run one after another, so an
 * edit built from a stale draw would put back what the edit before it changed (2026-11-21 gate e2e: a label's text
 * typed, then its font size, came back with no text and so no Drawing). Each field the edit changed from what the
 * panel drew is taken; every other field keeps its current value. Flat settings only: a field is compared whole.
 */
export function editOver<T extends object>(current: T, rendered: T, next: T): T {
    const changed = (key: keyof T): boolean => JSON.stringify(next[key]) !== JSON.stringify(rendered[key]);
    const merged = { ...current };
    for (const key of Object.keys(next)) {
        if (isKeyOf(next, key) && changed(key)) {
            merged[key] = next[key];
        }
    }
    return merged;
}

/**
 * A panel's edit to a list (an area's behaviours) laid over the list as it stands now, entry by entry: an entry the
 * edit left as drawn keeps its current value, one it changed is laid over field by field. Edits made close together
 * each change one entry (a darkness modifier, then a toggle's target), and a whole list built from a stale draw would
 * put the first back (2026-11-24 gate e2e: the effects panel's modifier, set before a toggle, came back unset). A
 * list the edit grew or shrank, or one that changed length meanwhile, is the edit's.
 */
export function editListOver<T extends object>(current: readonly T[], rendered: readonly T[], next: readonly T[]): T[] {
    if (current.length !== next.length || rendered.length !== next.length) {
        return [...next];
    }
    return next.map((entry, i) => {
        const now = current[i];
        const drawn = rendered[i];
        if (now === undefined || drawn === undefined) {
            return entry;
        }
        return JSON.stringify(entry) === JSON.stringify(drawn) ? now : editOver(now, drawn, entry);
    });
}

/** Whether a key read off a settings object is one of its own fields. */
function isKeyOf<T extends object>(settings: T, key: string): key is Extract<keyof T, string> {
    return key in settings;
}
