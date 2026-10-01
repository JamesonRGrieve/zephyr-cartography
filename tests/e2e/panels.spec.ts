// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Every panel as a GM meets it: opened the way a GM opens it (a tool, a click
 * on the canvas, a scene-control button, a Tile HUD button), in Foundry's own
 * theme, then checked for what makes it usable and kept as a screenshot, so a
 * layout that breaks in Foundry (not only in Storybook's stand-in) fails here.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './lib/foundry';
import { activate, clickScene, drawShape, holdView, MODULE_ID, SQUARE, useTool } from './lib/pointer';
import { panelProblems, panelSelector } from './lib/ux';

/** Inside the test room, clear of its walls. */
const IN_ROOM = { x: 450, y: 450 } as const;

/** Empty canvas, away from the test room. */
const OPEN_GROUND = { x: 1200, y: 900 } as const;

/**
 * Clear Foundry's notifications, which float over the top of the screen (a
 * headless browser's "no hardware acceleration" warning among them), so a
 * screenshot shows the panel and not the test machine.
 */
async function clearNotifications(page: Page): Promise<void> {
    await page.evaluate(() => {
        ui.notifications?.clear();
    });
    await expect(page.locator('#notifications .notification')).toHaveCount(0);
}

/** Check panel `panel` is usable, then that it looks as it did when last reviewed. */
async function expectUsable(page: Page, panel: string): Promise<void> {
    const shown = page.locator(panelSelector(panel));
    await expect(shown).toBeVisible();
    await clearNotifications(page);
    await expect.poll(async () => panelProblems(page, panel)).toEqual([]);
    await expect(shown).toHaveScreenshot(`${panel}-panel.png`);
}

async function drawRoom(page: Page): Promise<void> {
    await useTool(page, 'room');
    await holdView(page);
    await drawShape(page, SQUARE);
}

/** Click a module button in the module's own scene-control group (levels, generator). */
async function pressControlButton(page: Page, tool: string): Promise<void> {
    await activate(page, MODULE_ID, 'road');
    await page.click(`button[data-tool="${tool}"]`);
}

test('the paint panel is usable, as its tool opens it', async ({ world }) => {
    await useTool(world, 'paint', { panel: true });
    await expectUsable(world, 'paint');
});

test('the road and river panel is usable, as the river tool opens it', async ({ world }) => {
    await useTool(world, 'river', { panel: true });
    await expectUsable(world, 'paths');
});

test('the map pin panel is usable, as placing a pin opens it', async ({ world }) => {
    await useTool(world, 'pin', { panel: true });
    await holdView(world);
    await clickScene(world, OPEN_GROUND);
    await expectUsable(world, 'pin');
});

test('the map label panel is usable, as placing a label opens it', async ({ world }) => {
    await useTool(world, 'label', { panel: true });
    await holdView(world);
    await clickScene(world, OPEN_GROUND);
    await expectUsable(world, 'label');
});

test('the zone panel is usable, as placing a zone opens it', async ({ world }) => {
    await useTool(world, 'zone', { panel: true });
    await holdView(world);
    await clickScene(world, OPEN_GROUND);
    await expectUsable(world, 'zone');
    // Each of Foundry's shapes in turn, the zone reshaped to it keeping about the same reach.
    const shape = world.locator('#zc-zone-shape');
    for (const kind of ['ellipse', 'ring', 'cone', 'line', 'rectangle', 'cells', 'emanation', 'circle']) {
        // eslint-disable-next-line no-await-in-loop -- sequential: each reshape re-renders the panel the next one reads
        await shape.selectOption(kind);
        // eslint-disable-next-line no-await-in-loop -- see above
        await expect(world.locator('#zc-zone-shape')).toHaveValue(kind);
    }
});

test('the area effects panel is usable, as clicking a room with the effects tool opens it', async ({ world }) => {
    await drawRoom(world);
    await useTool(world, 'effects');
    await clickScene(world, IN_ROOM);
    await expectUsable(world, 'effects');
});

test('the materials panel is usable, as clicking a room with the materials tool opens it', async ({ world }) => {
    await drawRoom(world);
    await useTool(world, 'materials');
    await clickScene(world, IN_ROOM);
    await expectUsable(world, 'materials');
});

test('the door panel is usable, as clicking a door with the door tool opens it', async ({ world }) => {
    await drawRoom(world);
    await useTool(world, 'door');
    // The first click makes the wall a door; the second opens the door's panel.
    await clickScene(world, { x: 450, y: 300 });
    await expect.poll(async () => world.evaluate(() => (canvas?.scene?.walls.contents ?? []).filter((wall) => wall.door === 1).length)).toBe(1);
    await clickScene(world, { x: 450, y: 300 });
    await expectUsable(world, 'door');
});

test('the levels panel is usable with several levels, as its scene-control button opens it', async ({ world }) => {
    await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        await controller?.addLevel('above', 'Ground');
        await controller?.addLevel('above', 'Upper');
        await controller?.addLevel('below', 'Cellar');
    });
    await pressControlButton(world, 'levels');
    await expectUsable(world, 'levels');
    // Its look section opened, as a GM opens it to set a level's tints.
    await world
        .locator(`${panelSelector('levels')} summary`)
        .first()
        .click();
    await expect.poll(async () => panelProblems(world, 'levels')).toEqual([]);
    await clearNotifications(world);
    await expect(world.locator(panelSelector('levels'))).toHaveScreenshot('levels-panel-look-open.png');
});

test('the generator panel is usable, as its scene-control button opens it', async ({ world }) => {
    await pressControlButton(world, 'generator');
    await expectUsable(world, 'generator');
});

test('the stamp browser is usable, as the stamp tool opens it', async ({ world }) => {
    await useTool(world, 'stamp');
    await expectUsable(world, 'stamp-browser');
});

test('the interior panel is usable, as an enterable stamp’s Tile HUD button opens it', async ({ world }) => {
    await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.controller()?.placeStamp({ stamp: 'zc-e2e-pack:hab', x: 600, y: 600 });
    });
    await activate(world, 'tiles', 'select');
    // Foundry's own Tile HUD on the stamp's tile, as a right-click on it opens it.
    await world.evaluate(async () => {
        const tile = canvas?.tiles?.placeables[0];
        const hud = canvas?.hud?.tile;
        if (tile && hud) {
            tile.control();
            await hud.bind(tile);
        }
    });
    await world.getByRole('button', { name: 'Interior' }).click();
    await expectUsable(world, 'submap');
});
