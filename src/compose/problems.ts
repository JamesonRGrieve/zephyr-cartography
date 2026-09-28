// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What the composer could not do, as data: the Foundry boundary words each
 * one from the langpack. Pure.
 */
import type { StampRole, StampTransitionKind } from '../stamps/schema';

/** A way between levels a building asks for: its stairs, its ladder, or storm doors down into its cellar from outside. */
export type Access = 'stairs' | 'ladder' | 'storm-door';

export type ComposeProblem =
    /** A way between levels the map's settings have no stamp for, which it cannot do without, borrowed from another setting. */
    | { readonly kind: 'borrowed'; readonly used: StampTransitionKind; readonly wantedIn: string }
    /** A piece a room cannot do without (a guest room's bed) that the map's settings have none of, borrowed from another setting. */
    | { readonly kind: 'borrowed-art'; readonly role: StampRole; readonly wantedIn: string }
    /** A way between levels no loaded stamp gives, another kind standing in for it (a ladder for stairs, or for storm doors). */
    | { readonly kind: 'stand-in'; readonly wanted: Access; readonly used: StampTransitionKind; readonly wantedIn: string }
    /** A building whose rooms cannot fit its footprint, which is left unbuilt. */
    | { readonly kind: 'rooms-do-not-fit'; readonly building: string; readonly width: number; readonly height: number }
    /** Two rooms the intent opens onto each other that the layout could not put side by side. */
    | { readonly kind: 'not-beside'; readonly building: string; readonly room: string; readonly other: string }
    /** A role no loaded stamp fills, where it was wanted: a zone's kind, or a building's room. */
    | { readonly kind: 'no-stamp'; readonly role: StampRole; readonly wantedIn: string }
    /** A building of several floors whose floors could not agree on a place for the stair, which goes without one. */
    | { readonly kind: 'no-stairwell'; readonly building: string };

/** Each problem once, in the order first met. */
export function distinctProblems(problems: readonly ComposeProblem[]): ComposeProblem[] {
    const seen = new Set<string>();
    return problems.filter((problem) => {
        const id = JSON.stringify(problem);
        return !seen.has(id) && Boolean(seen.add(id));
    });
}
