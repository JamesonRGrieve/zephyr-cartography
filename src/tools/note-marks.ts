// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The module's marks on a Note, read from its flags: `readable` (words read
 * on hover, drawn with no icon over the art) and `hidden` (kept from players
 * until the GM reveals it). Flags are arbitrary serialised JSON, so reading
 * them is total: anything malformed is no mark.
 */
import { MODULE_ID } from '../module-id';
import { isRecord } from './guards';

/** A mark the module sets on a Note. */
export type NoteMark = 'readable' | 'hidden';

/** Whether `flags` (a Note's) carry the module's `mark`, set to true. */
// eslint-disable-next-line no-restricted-syntax -- boundary: a document's flags are arbitrary serialised JSON
export function noteMarked(flags: unknown, mark: NoteMark): boolean {
    const own = isRecord(flags) ? flags[MODULE_ID] : undefined;
    return isRecord(own) && own[mark] === true;
}

/** Whether a Note's change (its `changed` flags) set or cleared its `hidden` mark. */
// eslint-disable-next-line no-restricted-syntax -- boundary: an update's changed flags are arbitrary serialised JSON
export function changesHidden(changedFlags: unknown): boolean {
    const own = isRecord(changedFlags) ? changedFlags[MODULE_ID] : undefined;
    return isRecord(own) && ('hidden' in own || '-=hidden' in own);
}
