// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The map intent's tokens as scene spec features: each on its storey's level
 * (none where the map has no levels), what it leaves out taken from its
 * actor's prototype token. Pure and unit-tested.
 */
import type { SceneSpecInput } from '../generate/spec';
import type { MapIntent } from './intent';

type FeatureInput = SceneSpecInput['features'][number];

/** The intent's tokens as spec features, each on the level `levelOf` gives its storey. */
export function tokenFeatures(intent: Pick<MapIntent, 'tokens'>, levelOf: (storey: number) => { readonly level?: string }): FeatureInput[] {
    return intent.tokens.map(
        (token): FeatureInput => ({
            type: 'token',
            x: token.at.x,
            y: token.at.y,
            actor: token.actor,
            hidden: token.hidden,
            ...(token.name === undefined ? {} : { name: token.name }),
            ...(token.disposition === undefined ? {} : { disposition: token.disposition }),
            ...(token.size === undefined ? {} : { size: token.size }),
            ...levelOf(token.storey),
        }),
    );
}
