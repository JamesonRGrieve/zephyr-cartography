// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Pre-placed tokens over the live world: each names its actor by UUID, a
 * world actor's or a compendium's. A compendium's actor is brought into the
 * world on first use (`WorldCollection#importFromCompendium`) and found again
 * by its `_stats.compendiumSource` thereafter, so every token of it shares one
 * world actor. The token is the actor's prototype token, with what the map
 * sets over it.
 */
import type { TokenDoc } from '../tools/documents';
import type { TokenDisposition } from '../tools/token';
import type { IdentifiedCreateData } from './boundary';
import { tokenPlacement } from './translate';

/** Whether `found` is an Actor, as the configured implementation (a bare `instanceof` leaves its subtype `any`). */
// eslint-disable-next-line no-restricted-syntax -- boundary: fromUuid resolves any document; narrowed here
export function isActor(found: unknown): found is Actor.Implementation {
    return found instanceof Actor;
}

/** Foundry's disposition of each named one. */
function dispositionOf(disposition: TokenDisposition): CONST.TOKEN_DISPOSITIONS {
    const { SECRET, HOSTILE, NEUTRAL, FRIENDLY } = CONST.TOKEN_DISPOSITIONS;
    return { secret: SECRET, hostile: HOSTILE, neutral: NEUTRAL, friendly: FRIENDLY }[disposition];
}

/** Whether `pack` holds actors. */
function isActorPack(pack: foundry.documents.collections.CompendiumCollection.Any): pack is foundry.documents.collections.CompendiumCollection<'Actor'> {
    return pack.documentName === 'Actor';
}

/**
 * The world actor `uuid` names: the actor itself where it is the world's,
 * else the world's copy of the compendium's, brought in on first use; null
 * where it names no actor.
 */
async function worldActor(uuid: string): Promise<Actor.Implementation | null> {
    const found = await foundry.utils.fromUuid(uuid);
    if (!isActor(found)) {
        return null;
    }
    if (found.pack === null) {
        return found;
    }
    const copied = game.actors?.find((actor) => actor._stats.compendiumSource === uuid);
    if (copied) {
        return copied;
    }
    const pack = game.packs?.get(found.pack);
    if (!pack || !isActorPack(pack) || found.id === null) {
        return null;
    }
    const imported = await game.actors?.importFromCompendium(pack, found.id);
    return isActor(imported) ? imported : null;
}

/**
 * The create data of `token`, with the id `id`, on `scene`: its actor's
 * prototype token, standing where the plan puts it, with the plan's name,
 * disposition and size over the prototype's. Null where its UUID names no
 * actor, which `missing` is told of.
 */
export async function tokenCreateData(
    token: TokenDoc,
    id: string,
    scene: Scene.Implementation,
    missing: (uuid: string) => void,
): Promise<IdentifiedCreateData | null> {
    const actor = await worldActor(token.actor);
    if (!actor) {
        missing(token.actor);
        return null;
    }
    const width = token.size ?? actor.prototypeToken.width;
    const height = token.size ?? actor.prototypeToken.height;
    const made = await actor.getTokenDocument(
        {
            ...tokenPlacement(token, width, height, scene.grid.size),
            width,
            height,
            ...(token.name === null ? {} : { name: token.name }),
            ...(token.disposition === null ? {} : { disposition: dispositionOf(token.disposition) }),
        },
        { parent: scene },
    );
    return { ...made.toObject(), _id: id };
}
