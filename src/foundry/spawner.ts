// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Spawning into an area: its actors' tokens, placed in its Scene Region by
 * Foundry's own `RegionDocument#spawnTokens` (14.352–14.356), which finds
 * each a free, snapped place inside. Shared by the effects panel's Spawn
 * button and the module API.
 */
import type { AreaSpawn } from '../tools/spawn';
import { isActor } from './tokens';

/** What a spawn made, and the UUIDs that named no Actor. */
export interface SpawnResult {
    readonly spawned: number;
    readonly missing: readonly string[];
}

/**
 * Spawn `spawn`'s actors into region `regionId` on the viewed scene. A region
 * on one level spawns there; one on several, or on every level, spawns on the
 * level being viewed. Foundry throws when there is no room left inside.
 */
export async function spawnInto(regionId: string, spawn: AreaSpawn): Promise<SpawnResult> {
    const scene = canvas?.scene;
    const region = scene?.regions.get(regionId);
    if (!scene || !region) {
        return { spawned: 0, missing: [] };
    }
    const missing: string[] = [];
    const tokens: TokenDocument.Implementation[] = [];
    for (const entry of spawn.actors) {
        // eslint-disable-next-line no-await-in-loop -- each actor is looked up once, in the order the GM listed them
        const actor = await foundry.utils.fromUuid(entry.uuid);
        if (!isActor(actor)) {
            missing.push(entry.uuid);
            continue;
        }
        for (let i = 0; i < entry.count; i++) {
            // eslint-disable-next-line no-await-in-loop -- one token document per spawned token, each from the actor's prototype
            tokens.push(await actor.getTokenDocument({}, { parent: scene }));
        }
    }
    if (tokens.length === 0) {
        return { spawned: 0, missing };
    }
    const viewed = canvas.level?.id ?? null;
    const level = region.levels.size === 1 || viewed === null ? undefined : viewed;
    const { placement, snap, avoidOccupied } = spawn;
    const made = await region.spawnTokens(tokens, { placement, snap, avoidOccupied, ...(level === undefined ? {} : { level }) });
    return { spawned: made.length, missing };
}
