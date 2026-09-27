// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The stamps the composer can use, by role: every loaded stamp with a role
 * (and, when the intent names settings, carrying one of their tags), with its
 * footprint in grid squares and how it wants to stand. Pure and unit-tested.
 */
import type { CatalogStamp } from '../stamps/catalog';
import type { StampAnchor, StampBack, StampHabitat, StampRole } from '../stamps/schema';

/**
 * A stamp as the composer handles it: turned so its back is up. `width` runs
 * along its back and `height` is its depth, in grid squares, and `turn` is
 * the rotation (degrees) that brings the image's back edge to the top, added
 * to wherever it is placed.
 */
export interface RoleStamp {
    /** Catalog key, as a scene spec's stamp names it. */
    readonly key: string;
    readonly role: StampRole;
    readonly width: number;
    readonly height: number;
    readonly turn: number;
    readonly against: StampAnchor;
    /** Squares of open floor kept in front of it. */
    readonly clearance: number;
    /** The ground a land stamp belongs on (none said: it dresses no outdoor zone). */
    readonly habitats: readonly StampHabitat[];
}

/** The turn that brings each image edge to the top (clockwise, as Foundry turns tiles). */
const TURN_TO_TOP: Readonly<Record<StampBack, number>> = { top: 0, right: 270, bottom: 180, left: 90 };

export type RoleIndex = ReadonlyMap<StampRole, readonly RoleStamp[]>;

/** Index `stamps` by role, keeping only those carrying one of `settings` when any are given. */
export function roleIndex(stamps: readonly CatalogStamp[], settings: readonly string[]): RoleIndex {
    const index = new Map<StampRole, RoleStamp[]>();
    for (const stamp of stamps) {
        const variant = stamp.variants[stamp.defaultVariant];
        if (stamp.role === undefined || variant === undefined || (settings.length > 0 && !stamp.tags.some((tag) => settings.includes(tag)))) {
            continue;
        }
        const back = stamp.placement?.back ?? 'top';
        // A back on the image's left or right runs along its height.
        const sideways = back === 'left' || back === 'right';
        const w = variant.width / stamp.referenceGridSize;
        const h = variant.height / stamp.referenceGridSize;
        const entry: RoleStamp = {
            key: stamp.key,
            role: stamp.role,
            width: sideways ? h : w,
            height: sideways ? w : h,
            turn: TURN_TO_TOP[back],
            against: stamp.placement?.against ?? 'free',
            clearance: stamp.placement?.clearance ?? 0,
            habitats: stamp.habitats,
        };
        index.set(stamp.role, [...(index.get(stamp.role) ?? []), entry]);
    }
    return index;
}
