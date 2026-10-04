// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Container stamps as Item Piles: a stamp whose pack marks it `container` is
 * backed by an Item Piles container token over its footprint, so players can
 * open it and loot it. Item Piles is optional; without it a container stamp
 * is just a stamp. Pure: the pile's placement from the stamp. The Item Piles
 * calls live at the boundary.
 */
import type { StampPile } from '../stamps/schema';
import type { StampFeature } from './stamp';

/** Where and how a stamp's pile token sits: over the footprint, in the stamp's image and turn. */
export interface PileSpec {
    /** Token top-left in scene px (Foundry positions a token by its unrotated top-left). */
    readonly x: number;
    readonly y: number;
    /** Token size in grid squares. */
    readonly width: number;
    readonly height: number;
    readonly rotation: number;
    readonly elevation: number;
    /** The level its stamp stands on, which the token belongs to (null: the scene's own, a stamp on every level). */
    readonly level: string | null;
    readonly src: string;
    /** The pack's pile options (type, starting state, sounds). */
    readonly pile: StampPile;
}

/** What a pile shows: open with things in it, emptied, closed, or locked. */
export const PILE_STATES = ['open', 'empty', 'closed', 'locked'] as const;

export type PileState = (typeof PILE_STATES)[number];

/**
 * A pile's state from Item Piles' own record of it (its `closed` and
 * `locked` data) and what it holds: locked first, then closed, then empty
 * when open with nothing in it.
 */
export function pileStateOf(data: { readonly closed: boolean; readonly locked: boolean }, itemCount: number): PileState {
    if (data.locked) {
        return 'locked';
    }
    if (data.closed) {
        return 'closed';
    }
    return itemCount === 0 ? 'empty' : 'open';
}

/** What a state falls back to showing when the pack names no variant for it: a locked pile looks closed, an emptied one open. */
const FALLBACK: Readonly<Partial<Record<PileState, PileState>>> = { locked: 'closed', empty: 'open' };

/** The variant label (a variant's `state`) the pack says shows a pile in `state`, if it says. */
export function pileStateLabel(states: StampPile['states'], state: PileState): string | undefined {
    const fallback = FALLBACK[state];
    return states?.[state] ?? (fallback === undefined ? undefined : states?.[fallback]);
}

/** A container stamp's pile when its pack gave no options: a plain container. */
const PLAIN_CONTAINER: StampPile = { type: 'container' };

export function pileSpec(stamp: StampFeature, floorElevation: number): PileSpec {
    const centre = stamp.points[0] ?? { x: 0, y: 0 };
    const square = stamp.gridSize > 0 ? stamp.gridSize : 1;
    return {
        x: centre.x - stamp.width / 2,
        y: centre.y - stamp.height / 2,
        width: stamp.width / square,
        height: stamp.height / square,
        rotation: stamp.rotation,
        elevation: floorElevation + stamp.elevation,
        level: stamp.level,
        src: stamp.src,
        pile: stamp.behaviour.pile ?? PLAIN_CONTAINER,
    };
}
