// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseSceneSpec } from '../generate/spec';
import { composeMap } from './compose';
import { parseMapIntent } from './intent';
import { tokenFeatures } from './tokens';

const keeper = { actor: 'Compendium.world.npcs.Actor.keeper', at: { x: 4.5, y: 6.5 }, storey: 1, hidden: true };

describe('tokenFeatures', () => {
    it('places each token on its storey’s level, leaving what it does not set to its actor', () => {
        const features = tokenFeatures(
            { tokens: [keeper, { ...keeper, storey: 0, hidden: false, name: 'The keeper', disposition: 'friendly', size: 2 }] },
            (storey) => ({
                level: `storey-${storey}`,
            }),
        );
        expect(features).toEqual([
            { type: 'token', x: 4.5, y: 6.5, actor: keeper.actor, hidden: true, level: 'storey-1' },
            { type: 'token', x: 4.5, y: 6.5, actor: keeper.actor, hidden: false, name: 'The keeper', disposition: 'friendly', size: 2, level: 'storey-0' },
        ]);
        // A map without levels puts them on none.
        expect(tokenFeatures({ tokens: [keeper] }, () => ({}))[0]).not.toHaveProperty('level');
    });

    it('are composed into the map’s spec, as a valid scene spec takes them', () => {
        const parsed = parseMapIntent({ schemaVersion: 1, seed: 1, width: 20, height: 20, tokens: [{ actor: 'Actor.watch', at: { x: 3, y: 3 } }] });
        if (!parsed.ok) {
            throw new Error(JSON.stringify(parsed.issues));
        }
        const { spec } = composeMap(parsed.intent, new Map());
        expect(spec.features.at(-1)).toEqual({ type: 'token', x: 3, y: 3, actor: 'Actor.watch', hidden: false });
        expect(parseSceneSpec(spec).ok).toBe(true);
    });

    it('refuse a token without an actor, or one of a disposition Foundry lacks', () => {
        const base = { schemaVersion: 1, seed: 1, width: 20, height: 20 };
        expect(parseMapIntent({ ...base, tokens: [{ at: { x: 1, y: 1 } }] }).ok).toBe(false);
        expect(parseMapIntent({ ...base, tokens: [{ actor: 'Actor.a', at: { x: 1, y: 1 }, disposition: 'enemy' }] }).ok).toBe(false);
    });
});
