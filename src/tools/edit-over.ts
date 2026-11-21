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
    for (const key of Object.keys(next) as (keyof T)[]) {
        if (changed(key)) {
            merged[key] = next[key];
        }
    }
    return merged;
}
