// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Pre-placed tokens (#1): a scene spec's tokens built as native Tokens of
 * their actors, a world actor's and a compendium's (brought into the world
 * once, however many tokens name it), then erased and brought back, followed
 * through play, and gone with their feature when deleted by hand. The e2e
 * system's Actor type is not one fvtt-types knows, so actors and the
 * compendium are made from plain script.
 */
import { expect, test } from './lib/foundry';

/** Every token on the scene, as the assertions read it. */
interface PlacedToken {
    readonly id: string;
    readonly name: string;
    readonly actorId: string | null;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly hidden: boolean;
    readonly disposition: number;
}

test('a spec’s tokens are Tokens of world and compendium actors, the compendium’s brought in once, and follow play', async ({ world }) => {
    const { guard, ogre } = await world.evaluate<{ guard: string; ogre: string }>(`(async () => {
        const guard = await Actor.create({ name: 'Gate guard', type: 'npc' });
        const pack = await foundry.documents.collections.CompendiumCollection.createCompendium({ type: 'Actor', label: 'E2E NPCs', name: 'e2e-npcs' });
        const original = await Actor.create({ name: 'Ogre', type: 'npc' });
        const packed = await pack.importDocument(original);
        await original.delete();
        return { guard: guard.uuid, ogre: packed.uuid };
    })()`);
    expect(ogre).toMatch(/^Compendium\.world\.e2e-npcs\.Actor\./u);

    const report = await world.evaluate<{ ok: boolean; features: string[] }>(`(async () => {
        const outcome = await game.modules.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            features: [
                { type: 'token', x: 2.5, y: 2.5, actor: ${JSON.stringify(guard)} },
                { type: 'token', x: 5.5, y: 2.5, actor: ${JSON.stringify(ogre)} },
                { type: 'token', x: 8, y: 3, actor: ${JSON.stringify(ogre)}, name: 'Ogre chief', hidden: true, disposition: 'hostile', size: 2 },
            ],
        });
        return { ok: outcome.ok, features: outcome.ok ? outcome.report.features : [] };
    })()`);
    expect(report.ok).toBe(true);
    expect(report.features).toHaveLength(3);

    const tokens = async (): Promise<PlacedToken[]> =>
        world.evaluate<PlacedToken[]>(`(canvas.scene.tokens.contents ?? []).map((t) => ({
            id: t.id, name: t.name, actorId: t.actorId, x: t.x, y: t.y, width: t.width, hidden: t.hidden, disposition: t.disposition,
        }))`);
    await expect.poll(async () => (await tokens()).length).toBe(3);
    // The compendium's ogre is in the world once, and both its tokens are of that one actor.
    const ogres = await world.evaluate<{ id: string; source: string | null }[]>(
        `game.actors.contents.filter((a) => a.name === 'Ogre').map((a) => ({ id: a.id, source: a._stats.compendiumSource }))`,
    );
    expect(ogres).toEqual([{ id: expect.any(String), source: ogre }]);
    const gridSize = await world.evaluate<number>('canvas.scene.grid.size');
    const [first, second, third] = await tokens();
    expect(first).toMatchObject({ name: 'Gate guard', x: 2 * gridSize, y: 2 * gridSize, width: 1, hidden: false });
    expect(second).toMatchObject({ name: 'Ogre', actorId: ogres[0]?.id, x: 5 * gridSize, y: 2 * gridSize });
    // What the spec sets over the prototype: a name, a size of two squares centred where asked, hidden, hostile.
    expect(third).toMatchObject({ name: 'Ogre chief', actorId: ogres[0]?.id, x: 7 * gridSize, y: 2 * gridSize, width: 2, hidden: true, disposition: -1 });

    // Erased with its feature, and back with undo.
    const guardFeature = report.features[0] ?? '';
    await world.evaluate(`game.modules.get('zephyr-cartography').api.controller().remove(${JSON.stringify(guardFeature)})`);
    await expect.poll(async () => (await tokens()).length).toBe(2);
    await world.evaluate(`game.modules.get('zephyr-cartography').api.controller().undo()`);
    await expect.poll(async () => (await tokens()).map((t) => t.name).sort()).toEqual(['Gate guard', 'Ogre', 'Ogre chief']);

    // Moved and revealed in play: its feature follows, so the Token is left where play put it.
    const ogreFeature = report.features[1] ?? '';
    await world.evaluate(`canvas.scene.tokens.find((t) => t.name === 'Ogre').update({ x: ${9 * gridSize}, y: ${6 * gridSize}, hidden: true })`);
    await expect
        .poll(async () =>
            world.evaluate(`(() => {
                const f = game.modules.get('zephyr-cartography').api.controller().getFeature(${JSON.stringify(ogreFeature)});
                return f ? { point: f.points[0], hidden: f.hidden } : null;
            })()`),
        )
        .toEqual({ point: { x: 9.5 * gridSize, y: 6.5 * gridSize }, hidden: true });

    // Deleted by hand: its feature goes too.
    await world.evaluate(`canvas.scene.tokens.find((t) => t.name === 'Ogre chief').delete()`);
    await expect
        .poll(async () => world.evaluate<number>(`canvas.scene.getFlag('zephyr-cartography', 'features').filter((f) => f.type === 'token').length`))
        .toBe(2);
});
