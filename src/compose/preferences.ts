// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which stamps suit which place, as an adviser (the AI-assisted mode's
 * model) chose them: for each room or zone, for each role, the stamp keys it
 * prefers, best first. The composer draws a role's pieces in a place only
 * from its preferred stamps there, when any of them is loaded; with no
 * preference it draws from every stamp of the role, as the algorithmic mode
 * does. Pure and unit-tested.
 */
import type { StampRole } from '../stamps/schema';
import type { RoleIndex, RoleStamp } from './roles';

/** Place → role → preferred stamp keys, best first. */
export type Preferences = ReadonlyMap<string, ReadonlyMap<StampRole, readonly string[]>>;

export const NO_PREFERENCES: Preferences = new Map();

/** A room's place name: its building (and floor) and its key, as problems name it. */
export const roomPlace = (building: string, room: string): string => `${building}/${room}`;

/** An outdoor zone's place name: its place in the intent's zones. */
export const zonePlace = (index: number): string => `zone-${index + 1}`;

/** `stamps` narrowed to the preferred ones, in preference order; all of them when none preferred is among them. */
export function narrowed(stamps: readonly RoleStamp[], preferred: readonly string[] | undefined): readonly RoleStamp[] {
    const chosen = (preferred ?? []).flatMap((key) => stamps.filter((s) => s.key === key));
    return chosen.length > 0 ? chosen : stamps;
}

/** A role index narrowed, role by role, to a place's preferences. */
export function narrowedIndex(stamps: RoleIndex, place: ReadonlyMap<StampRole, readonly string[]> | undefined): RoleIndex {
    if (!place) {
        return stamps;
    }
    return new Map([...stamps].map(([role, list]) => [role, narrowed(list, place.get(role))]));
}
