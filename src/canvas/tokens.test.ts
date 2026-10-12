// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseSceneSpec, type SceneSpec } from '../generate/spec';
import { realizeSpec } from './realize';
import { makeHarness } from './test-fakes';

const GRID = 100;

function spec(raw: object): SceneSpec {
    const parsed = parseSceneSpec({ schemaVersion: 1, ...raw });
    if (!parsed.ok) {
        throw new Error(JSON.stringify(parsed.issues));
    }
    return parsed.spec;
}

const guard = { type: 'token', x: 2.5, y: 3.5, actor: 'Compendium.world.npcs.Actor.guard01', name: 'Gate guard', disposition: 'hostile' };

describe('pre-placed tokens', () => {
    it('build from a spec as Tokens of their actors, centred where the spec puts them', async () => {
        const { c, d } = makeHarness();
        const report = await realizeSpec(c, spec({ features: [guard, { type: 'token', x: 0.5, y: 0.5, actor: 'Actor.innkeep', hidden: true, size: 2 }] }), {
            origin: { x: 0, y: 0 },
            gridSize: GRID,
        });
        expect(report.problems).toEqual([]);
        expect(d.tokens.flat()).toEqual([
            { x: 250, y: 350, elevation: 0, level: null, actor: guard.actor, name: 'Gate guard', hidden: false, disposition: 'hostile', size: null },
            { x: 50, y: 50, elevation: 0, level: null, actor: 'Actor.innkeep', name: null, hidden: true, disposition: null, size: 2 },
        ]);
        const [first] = report.features;
        expect(c.getFeature(first ?? '')?.docs.tokens).toEqual(['T0']);
        expect(c.featureForToken('T0')).toBe(first);
        expect(c.featureForToken('nope')).toBeNull();
    });

    it('report each one whose actor is not in the world, keeping its feature to place on a later build', async () => {
        const { c, d } = makeHarness();
        d.missingActors = ['Actor.innkeep'];
        const report = await realizeSpec(c, spec({ features: [guard, { ...guard, x: 4.5 }, { type: 'token', x: 0.5, y: 0.5, actor: 'Actor.innkeep' }] }), {
            origin: { x: 0, y: 0 },
            gridSize: GRID,
        });
        expect(report.problems).toEqual([{ index: 2, problem: 'token', actor: 'Actor.innkeep' }]);
        expect(report.features).toHaveLength(3);
        // Asked once, the controller's list is cleared: a later build reports only its own.
        expect(c.takeUnplacedTokens()).toEqual([]);
        d.missingActors = [];
        const again = await realizeSpec(c, spec({ features: [guard] }), { origin: { x: 0, y: 0 }, gridSize: GRID });
        expect(again.problems).toEqual([]);
    });

    it('are erased with their Token, and undo brings both back', async () => {
        const { c, d } = makeHarness();
        const { features } = await realizeSpec(c, spec({ features: [guard] }), { origin: { x: 0, y: 0 }, gridSize: GRID });
        const id = features[0] ?? '';
        await c.remove(id);
        expect(d.deletedIds()).toEqual(['T0']);
        await c.undo();
        expect(c.getFeature(id)?.docs.tokens).toEqual(['T1']);
    });

    it('follow play onto their feature without rewriting the Token, and a re-sync updates it in place', async () => {
        const { c, d } = makeHarness();
        await c.addLevel('above', 'Ground');
        const { features } = await realizeSpec(c, spec({ features: [guard] }), { origin: { x: 0, y: 0 }, gridSize: GRID });
        const id = features[0] ?? '';
        const writes = d.writes.length;
        expect(await c.followToken('T0', { x: 400, y: 450 }, 3, null, true)).toBe(true);
        expect(c.getFeature(id)).toMatchObject({ points: [{ x: 400, y: 450 }], lift: 3, hidden: true });
        expect(d.writes.length).toBe(writes);
        // Already so, or no feature's Token.
        expect(await c.followToken('T0', { x: 400, y: 450 }, 3, null, true)).toBe(false);
        expect(await c.followToken('nope', { x: 0, y: 0 }, 0, null, false)).toBe(false);
        // Taken to another level: its lift is above that level's floor.
        expect(await c.followToken('T0', { x: 400, y: 450 }, 3, 'lv1', true)).toBe(true);
        expect(c.getFeature(id)).toMatchObject({ level: 'lv1', lift: 3 });
        // A level edit re-syncs it: the same Token, moved in place, never deleted and made again.
        await c.addLevel('above', 'Upstairs');
        expect(d.deletedIds()).not.toContain('T0');
        expect(d.tokenUpdates.flat().at(-1)).toMatchObject({ id: 'T0', doc: { x: 400, y: 450, elevation: 3, level: 'lv1', hidden: true } });
    });
});
