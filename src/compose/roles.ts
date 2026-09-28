// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The stamps the composer can use, by role: every loaded stamp its pack or
 * its tags give a role (see `role-tags.ts`) and, when the intent names
 * settings, carrying one of their tags, with its footprint in grid squares
 * and how it wants to stand. Pure and unit-tested.
 */
import type { CatalogStamp } from '../stamps/catalog';
import type { StampAnchor, StampBack, StampHabitat, StampRole, StampTransitionDirection, StampTransitionKind } from '../stamps/schema';
import { ROOM_PURPOSES, type RoomPurpose } from './intent';
import { habitatsOf, placementOf, roleFromTags, suitsScale } from './role-tags';

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
    /** Drawn side-on (a tower, a tent): never turned, so it always stands as drawn. */
    readonly upright: boolean;
    /** The ground a land stamp belongs on (none said: it dresses no outdoor zone). */
    readonly habitats: readonly StampHabitat[];
    /** How it joins levels (a stair's, ladder's or storm door's transition), or null. */
    readonly climb: { readonly kind: StampTransitionKind; readonly direction: StampTransitionDirection } | null;
    /** From outside the map's settings: a way between levels its settings have none of. */
    readonly borrowed: boolean;
    /** The kinds of room its tags say it belongs in (a `medicae` bed, a `cell` bunk); none: any room. */
    readonly purposes: readonly RoomPurpose[];
}

/** The kinds of room `tags` name. */
const purposesOf = (tags: readonly string[]): RoomPurpose[] => ROOM_PURPOSES.filter((purpose) => tags.includes(purpose));

/**
 * Small pieces a room holds many of, drawn afresh one by one (crates, barrels
 * and sacks; a room's clutter; what is set on a table; lamps): their art drawn
 * with depth stays beside what is drawn straight down, for variety, standing
 * as drawn. A room's matched furniture is drawn one way only.
 */
const MIXED_ROLES: readonly StampRole[] = ['storage', 'chest', 'clutter', 'tabletop', 'light'];

/**
 * Roles a map is unplayable without (a way between levels; a bed in a guest
 * room): other settings' stamps are kept too, flagged. A bed is borrowed only
 * when the map's settings have none; ways between levels keep both, the
 * settings' own taken first (`access.ts`), as the way wanted may be one only
 * another setting draws.
 */
const BORROWED_ROLES: readonly StampRole[] = ['stairs', 'bed'];

/** The turn that brings each image edge to the top (clockwise, as Foundry turns tiles). */
const TURN_TO_TOP: Readonly<Record<StampBack, number>> = { top: 0, right: 270, bottom: 180, left: 90 };

export type RoleIndex = ReadonlyMap<StampRole, readonly RoleStamp[]>;

/**
 * Index `stamps` by role, keeping only those carrying one of `settings` when
 * any are given. Art drawn with depth (isometric, central perspective) stands
 * as drawn, never turned: turned half round it is upside down. A role with
 * any art drawn straight down (orthographic) uses only that.
 */
export function roleIndex(stamps: readonly CatalogStamp[], settings: readonly string[]): RoleIndex {
    const index = new Map<StampRole, RoleStamp[]>();
    const borrowed = new Map<StampRole, RoleStamp[]>();
    const orthographic = new Set<string>();
    for (const stamp of stamps) {
        const variant = stamp.variants[stamp.defaultVariant];
        // A pack's null says never, whatever the tags.
        const role = stamp.role === null ? undefined : stamp.role ?? roleFromTags(stamp.tags);
        const inSetting = settings.length === 0 || stamp.tags.some((tag) => settings.includes(tag));
        // A stair joins floors only if it carries a transition.
        if (role === undefined || variant === undefined || !suitsScale(role, stamp.scale) || (role === 'stairs' && stamp.transition === undefined)) {
            continue;
        }
        if (!inSetting && !BORROWED_ROLES.includes(role)) {
            continue;
        }
        const placement = placementOf(role, stamp.tags, stamp.placement);
        const flat = (variant.perspective ?? stamp.perspective) === 'orthographic';
        if (flat) {
            orthographic.add(stamp.key);
        }
        // Drawn with depth, its back is the image's top whatever the pack says, and it is never turned.
        const back = flat ? placement.back : 'top';
        const upright = placement.upright || !flat;
        const { against, clearance } = placement;
        // A back on the image's left or right runs along its height.
        const sideways = back === 'left' || back === 'right';
        const w = variant.width / stamp.referenceGridSize;
        const h = variant.height / stamp.referenceGridSize;
        const entry: RoleStamp = {
            key: stamp.key,
            role,
            width: sideways ? h : w,
            height: sideways ? w : h,
            turn: TURN_TO_TOP[back],
            against,
            clearance,
            upright,
            habitats: habitatsOf(role, stamp.tags, stamp.habitats),
            climb: stamp.transition ? { kind: stamp.transition.kind, direction: stamp.transition.direction } : null,
            borrowed: !inSetting,
            purposes: purposesOf(stamp.tags),
        };
        const into = inSetting ? index : borrowed;
        into.set(role, [...(into.get(role) ?? []), entry]);
    }
    // Art drawn straight down is preferred within the map's settings and, apart, among what is borrowed; borrowed art comes
    // last, flagged, for whoever needs a way between levels the settings lack (`access.ts` takes the settings' own first).
    // Small pieces that vary one by one keep their art drawn with depth too: it stands as drawn, never turned.
    const preferFlat = (role: StampRole, list: readonly RoleStamp[]): readonly RoleStamp[] => {
        const flat = list.filter((s) => orthographic.has(s.key));
        return flat.length > 0 && !MIXED_ROLES.includes(role) ? flat : list;
    };
    const roles = new Set([...index.keys(), ...borrowed.keys()]);
    return new Map(
        [...roles].map((role) => {
            const own = preferFlat(role, index.get(role) ?? []);
            const lent = preferFlat(role, borrowed.get(role) ?? []);
            return [role, role === 'stairs' || own.length === 0 ? [...own, ...lent] : own];
        }),
    );
}
