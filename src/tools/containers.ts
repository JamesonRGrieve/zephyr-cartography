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
    /** Token top-left in scene px. */
    readonly x: number;
    readonly y: number;
    /**
     * Token size in grid squares: the stamp's box as it lies, turn and all. Foundry turns a token's picture but never
     * its footprint, so the token itself is never turned; its picture is hidden, the stamp's tile drawing the container.
     */
    readonly width: number;
    readonly height: number;
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

/** Places of px a pile's box keeps: past them is only floating-point noise (cos 90° is 6e-17, not 0). */
const PX_PLACES = 1e6;

const settled = (px: number): number => Math.round(px * PX_PLACES) / PX_PLACES;

export function pileSpec(stamp: StampFeature, floorElevation: number): PileSpec {
    const centre = stamp.points[0] ?? { x: 0, y: 0 };
    const square = stamp.gridSize > 0 ? stamp.gridSize : 1;
    // The stamp's box as it lies: its turned rectangle's bounds (exact for a quarter turn, which swaps its sides).
    const turn = (stamp.rotation * Math.PI) / 180;
    const [cos, sin] = [Math.abs(Math.cos(turn)), Math.abs(Math.sin(turn))];
    const width = settled(stamp.width * cos + stamp.height * sin);
    const height = settled(stamp.width * sin + stamp.height * cos);
    return {
        x: centre.x - width / 2,
        y: centre.y - height / 2,
        width: width / square,
        height: height / square,
        elevation: floorElevation + stamp.elevation,
        level: stamp.level,
        src: stamp.src,
        pile: stamp.behaviour.pile ?? PLAIN_CONTAINER,
    };
}
