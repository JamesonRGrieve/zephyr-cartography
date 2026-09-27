// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Room materials. A room's floor is a biome (the terrain textures) or a
 * `floor.<name>` texture role. Its walls can be drawn as a textured band along
 * the perimeter, using a `wall.<name>` role, or not drawn at all. Packs supply
 * the roles in their texture sets; the engine offers whatever the active set
 * has. Pure and unit-tested.
 */
import { BIOMES, isBiomeKind } from './biome';

/** Texture-set role prefix for a room floor material. */
const FLOOR_PREFIX = 'floor.';

/** Texture-set role prefix for a room wall material. */
const WALL_PREFIX = 'wall.';

/** A room floor: a biome, or a `floor.<name>` role. */
export type FloorMaterial = string;

/** A room wall: a `wall.<name>` role, or null for walls that are not drawn. */
export type WallMaterial = string | null;

/** A drawn wall's thickness as a share of a grid square: a foot of masonry on a 5 ft square, centred on the wall line. */
export const WALL_BAND_SQUARES = 0.2;

// eslint-disable-next-line no-restricted-syntax -- boundary: validates a persisted floor material from scene-flag JSON
export function isFloorMaterial(v: unknown): v is FloorMaterial {
    return isBiomeKind(v) || (typeof v === 'string' && v.startsWith(FLOOR_PREFIX) && v.length > FLOOR_PREFIX.length);
}

// eslint-disable-next-line no-restricted-syntax -- boundary: validates a persisted wall material from scene-flag JSON; anything else means no drawn wall
export function parseWallMaterial(v: unknown): WallMaterial {
    return typeof v === 'string' && v.startsWith(WALL_PREFIX) && v.length > WALL_PREFIX.length ? v : null;
}

/** Floors on offer: every biome, then the active set's `floor.*` roles. */
export function floorMaterials(roles: readonly string[]): FloorMaterial[] {
    return [...BIOMES, ...roles.filter((r) => isFloorMaterial(r) && !isBiomeKind(r)).sort()];
}

/** Walls on offer: the active set's `wall.*` roles (plus "not drawn", which the UI adds). */
export function wallMaterials(roles: readonly string[]): string[] {
    return roles.filter((r) => parseWallMaterial(r) !== null).sort();
}

/** A pack material's display name: its role without the prefix, e.g. `floor.oak` → `oak`. */
export function materialName(role: string): string {
    if (role.startsWith(FLOOR_PREFIX)) {
        return role.slice(FLOOR_PREFIX.length);
    }
    return role.startsWith(WALL_PREFIX) ? role.slice(WALL_PREFIX.length) : role;
}
