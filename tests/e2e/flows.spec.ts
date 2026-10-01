// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Whole tasks a GM does through the panels alone, with the mouse and keyboard,
 * checked by what then happens in Foundry: an ambush set up and sprung from a
 * room's effects panel, and a building given an interior and its travel set
 * from the interior panel.
 */
import { expect, test } from './lib/foundry';
import { activate, clickScene, drawShape, holdView, SQUARE, useTool } from './lib/pointer';
import { panelSelector } from './lib/ux';

test('an ambush set up in a room’s effects panel spawns its cultists there, and a mistyped line is refused', async ({ world }) => {
    // The e2e system's Actor type is not one fvtt-types knows, so the Actor is made from plain script.
    const actorUuid = await world.evaluate<string>("Actor.create({ name: 'Cultist', type: 'npc' }).then((actor) => actor.uuid)");
    await useTool(world, 'room');
    await holdView(world);
    await drawShape(world, SQUARE);
    await useTool(world, 'effects');
    await clickScene(world, { x: 450, y: 450 });
    const panel = world.locator(panelSelector('effects'));
    const actors = panel.getByLabel('Actors, one per line: a UUID, or a count then a UUID');
    // A line that is not a count and a UUID is refused, and the field keeps what it had.
    await actors.fill('lots of cultists');
    await actors.blur();
    await expect(actors).toHaveValue('');
    await actors.fill(`2 ${actorUuid}`);
    await actors.blur();
    await expect(actors).toHaveValue(`2 ${actorUuid}`);
    await panel.getByRole('button', { name: 'Spawn now' }).click();
    await expect.poll(async () => world.evaluate(() => canvas?.scene?.tokens.size ?? 0)).toBe(2);
    // Both inside the room (300–600 px square), each on its own grid square.
    const tokens = await world.evaluate(() => (canvas?.scene?.tokens.contents ?? []).map((token) => ({ x: token.x, y: token.y })));
    expect(new Set(tokens.map((t) => `${t.x},${t.y}`)).size).toBe(2);
    for (const token of tokens) {
        expect(token.x).toBeGreaterThanOrEqual(300);
        expect(token.x).toBeLessThan(600);
        expect(token.y).toBeGreaterThanOrEqual(300);
        expect(token.y).toBeLessThan(600);
    }
});

test('a building is given an interior from its panel, its travel set there, and unlinked again', async ({ world }) => {
    await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.controller()?.placeStamp({ stamp: 'zc-e2e-pack:residence', x: 600, y: 600 });
    });
    await activate(world, 'tiles', 'select');
    await world.evaluate(async () => {
        const tile = canvas?.tiles?.placeables[0];
        const hud = canvas?.hud?.tile;
        if (tile && hud) {
            tile.control();
            await hud.bind(tile);
        }
    });
    await world.getByRole('button', { name: 'Interior' }).click();
    const panel = world.locator(panelSelector('submap'));
    await panel.getByRole('button', { name: 'Create an interior scene' }).click();
    // Linked: the panel offers the way there and how tokens travel it.
    await expect(panel.getByRole('button', { name: 'Open the interior' })).toBeVisible();
    await panel.getByLabel('Revealed').check();
    await panel.getByLabel('Arrive').selectOption({ label: 'At the centre' });
    // The Teleport Token behaviour's data is typed by no fvtt-types release, so it is read from plain script.
    const entrance = async (): Promise<string> =>
        world.evaluate<string>(
            'JSON.stringify((({ placement, revealed }) => ({ placement, revealed }))(canvas.scene.regions.contents[0]?.behaviors.contents[0]?.system ?? {}))',
        );
    await expect.poll(entrance).toBe(JSON.stringify({ placement: 'center', revealed: true }));
    await panel.getByRole('button', { name: 'Unlink' }).click();
    await expect(panel.getByRole('button', { name: 'Create an interior scene' })).toBeVisible();
    await expect.poll(async () => world.evaluate(() => canvas?.scene?.regions.size ?? 0)).toBe(0);
});
