// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, moduleActive, test } from './lib/foundry';

test('a container stamp is an Item Piles pile with its pack options, and a smashed variant is not', async ({ world }) => {
    test.skip(!(await moduleActive(world, 'item-piles')), 'Item Piles is not installed in the e2e world (FOUNDRY_TEST_MODULES)');
    const placed = await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        const id = await controller?.placeStamp({ stamp: 'zc-e2e-pack:crate', x: 300, y: 300 });
        const feature = id === undefined || id === null ? null : controller?.getFeature(id);
        return { id, pile: feature?.type === 'stamp' ? feature.pile : null };
    });
    expect(placed.pile).toEqual(expect.stringMatching(/^Scene\..+\.Token\..+$/));
    const flags = await world.evaluate((pile) => {
        const token = pile === null ? null : foundry.utils.fromUuidSync(pile);
        const actor = token instanceof TokenDocument ? token.actor : null;
        // Item Piles keeps its pile data in the actor's `item-piles` flag scope.
        const data = actor === null ? null : foundry.utils.getProperty(actor, 'flags.item-piles.data');
        return typeof data === 'object' && data !== null && 'type' in data && 'closed' in data && 'distance' in data && 'openSound' in data
            ? { type: data.type, closed: data.closed, distance: data.distance, openSound: data.openSound }
            : null;
    }, placed.pile);
    // The pack's pile options, with its sound path served from the pack module.
    expect(flags).toEqual({ type: 'vault', closed: true, distance: 1, openSound: 'modules/zc-e2e-pack/sounds/silence.wav' });

    const afterSmash = await world.evaluate(async (id) => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        if (id !== undefined && id !== null) {
            await controller?.setStampVariant(id, 1);
        }
        const feature = id === undefined || id === null ? null : controller?.getFeature(id);
        return { pile: feature?.type === 'stamp' ? feature.pile : 'missing', tokens: canvas?.scene?.tokens.size };
    }, placed.id);
    expect(afterSmash).toEqual({ pile: null, tokens: 0 });
});

test("a container stamp's pile token stands on its stamp's level, never the scene's first, and goes with it from there", async ({ world }) => {
    test.skip(!(await moduleActive(world, 'item-piles')), 'Item Piles is not installed in the e2e world (FOUNDRY_TEST_MODULES)');
    const placed = await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        const ground = await controller?.addLevel('above', 'Ground');
        const upper = await controller?.addLevel('above', 'Guest rooms');
        controller?.setActiveLevel(upper ?? null);
        const id = await controller?.placeStamp({ stamp: 'zc-e2e-pack:crate', x: 300, y: 300 });
        const feature = id === undefined || id === null ? null : controller?.getFeature(id);
        const token = feature?.type === 'stamp' && feature.pile !== null ? foundry.utils.fromUuidSync(feature.pile) : null;
        return { id: id ?? '', ground: ground ?? '', upper, level: token instanceof TokenDocument ? token.level : null };
    });
    // Upstairs, as its crate is: on the floor below it would be drawn over that floor's own room.
    expect(placed.level).toBe(placed.upper);
    // Smashed while the floor below is viewed (its token not drawn there), the crate's pile still goes with it.
    const tokens = await world.evaluate(async ({ id, ground }) => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        await canvas?.scene?.view({ level: ground });
        await controller?.setStampVariant(id, 1);
        return canvas?.scene?.tokens.size;
    }, placed);
    expect(tokens).toBe(0);
});

test('a plain container stamp is a container pile with Item Piles defaults', async ({ world }) => {
    test.skip(!(await moduleActive(world, 'item-piles')), 'Item Piles is not installed in the e2e world (FOUNDRY_TEST_MODULES)');
    const pile = await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        const id = await controller?.placeStamp({ stamp: 'zc-e2e-pack:chest', x: 300, y: 300 });
        const feature = id === undefined || id === null ? null : controller?.getFeature(id);
        const token = feature?.type === 'stamp' && feature.pile !== null ? foundry.utils.fromUuidSync(feature.pile) : null;
        const actor = token instanceof TokenDocument ? token.actor : null;
        const data = actor === null ? null : foundry.utils.getProperty(actor, 'flags.item-piles.data');
        return typeof data === 'object' && data !== null && 'type' in data && 'enabled' in data && 'deleteWhenEmpty' in data
            ? { type: data.type, enabled: data.enabled, deleteWhenEmpty: data.deleteWhenEmpty }
            : null;
    });
    // Kept when emptied: a chest is furniture, not a drop.
    expect(pile).toEqual({ type: 'container', enabled: true, deleteWhenEmpty: false });
});

test('a container stamp shows its pile closed or open as its Item Piles state changes', async ({ world }) => {
    test.skip(!(await moduleActive(world, 'item-piles')), 'Item Piles is not installed in the e2e world (FOUNDRY_TEST_MODULES)');
    const placed = await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        const id = await controller?.placeStamp({ stamp: 'zc-e2e-pack:chest', x: 300, y: 300 });
        const feature = id === undefined || id === null ? null : controller?.getFeature(id);
        return { id: id ?? '', pile: feature?.type === 'stamp' ? feature.pile ?? '' : '' };
    });
    expect(placed.pile).toMatch(/^Scene\.\w+\.Token\.\w+$/u);
    const variant = async (): Promise<number | null> =>
        world.evaluate((id) => {
            const feature = game.modules?.get('zephyr-cartography').api.controller()?.getFeature(id);
            return feature?.type === 'stamp' ? feature.variant : null;
        }, placed.id);
    // Where Item Piles records a pile's state (its actor's `item-piles.data`), which its open and close calls and its
    // sheet all write; set from plain script, since fvtt-types does not know another module's flags.
    const setClosed = async (shut: boolean): Promise<void> => {
        await world.evaluate(`foundry.utils.fromUuidSync('${placed.pile}').actor.update({ 'flags.item-piles.data.closed': ${String(shut)} })`);
    };
    await setClosed(true);
    await expect.poll(variant).toBe(0);
    // Open and empty: it shows open, as the pack names no empty look.
    await setClosed(false);
    await expect.poll(variant).toBe(1);
    await setClosed(true);
    await expect.poll(variant).toBe(0);
});
