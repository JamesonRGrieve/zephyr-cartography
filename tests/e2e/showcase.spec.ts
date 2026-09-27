// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Real maps, composed from map intents in the real asset pack's art: the Map
 * builder's woodland inn and tavern presets, each on a scene its size, in
 * the hand-painted texture set. They are judged by eye from their
 * screenshots, whole and close up, and checked to have been composed whole
 * (no problems, every stamp drawn). The pack is not in this repo, so the
 * spec runs only where it is installed among the test modules
 * (`FOUNDRY_TEST_MODULES`); elsewhere it skips.
 */
import type { Page } from '@playwright/test';
import { parseMapIntent } from '../../src/compose/intent';
import { type MapPreset, PRESET_INTENTS } from '../../src/compose/presets';
import { expect, frameScene, freshScene, moduleActive, type SceneSize, test } from './lib/foundry';

const ASSETS = 'zephyrex-cartography-assets';
const PAINTED = `${ASSETS}:painted`;

/** Px per grid square of the showcase scenes. */
const GRID = 100;

/** Close-up zoom: past 1:1, where a blurry or stretched texture shows. */
const CLOSE_UP_SCALE = 1.5;

/** Use the pack's hand-painted texture set, and wait until it is the one in use. */
async function usePaintedSet(page: Page): Promise<void> {
    await page.evaluate(async (set) => {
        await game.settings?.set('zephyrex-cartography', 'textureSet', set);
    }, PAINTED);
    await expect.poll(async () => page.evaluate(() => game.settings?.get('zephyrex-cartography', 'textureSet'))).toBe(PAINTED);
}

/** A scene the preset's size, viewed; the preset composed on it; what went wrong, as JSON. */
async function composePreset(page: Page, preset: MapPreset, title: string): Promise<{ size: SceneSize; outcome: readonly string[] }> {
    const intent = PRESET_INTENTS[preset];
    const parsed = parseMapIntent(intent);
    const squares = parsed.ok ? parsed.intent : { width: 0, height: 0 };
    const size: SceneSize = { width: squares.width * GRID, height: squares.height * GRID, gridSize: GRID };
    await freshScene(page, title, size);
    await usePaintedSet(page);
    const outcome = await page.evaluate(async (given) => {
        const composed = await game.modules?.get('zephyrex-cartography').api.compose(given);
        if (!composed) {
            return ['no module API'];
        }
        return composed.ok
            ? [...composed.report.problems, ...composed.problems].map((p) => JSON.stringify(p))
            : composed.issues.map((i) => `${i.path}: ${i.message}`);
    }, intent);
    return { size, outcome };
}

/** Whether the scene has Tiles and the canvas draws every one with its image loaded. */
async function allTilesDrawn(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const tiles = canvas?.scene?.tiles.size ?? 0;
        const drawn = (canvas?.tiles?.placeables ?? []).filter((tile) => tile.visible && tile.mesh?.texture?.valid === true).length;
        return tiles > 0 && drawn === tiles;
    });
}

/** How long a composed map's images may take to load, in ms. */
const IMAGES_LOAD_MS = 60_000;

/** The share of the viewport a framed scene fills, leaving a margin round it. */
const FIT_MARGIN = 0.95;

/** A scale that fits a scene of `size` in the viewport. */
function fitScale(page: Page, size: SceneSize): number {
    const viewport = page.viewportSize();
    return viewport ? Math.min(viewport.width / size.width, viewport.height / size.height) * FIT_MARGIN : 1;
}

test.beforeEach(async ({ world }) => {
    test.skip(!(await moduleActive(world, ASSETS)), `${ASSETS} is not installed among the test modules`);
});

test('the woodland inn preset: an inn in a clearing, a road to its door, a stream through the woods', async ({ world }) => {
    const { size, outcome } = await composePreset(world, 'woodland-inn', 'Woodland inn');
    // Soft: whatever the packs lack is reported, and the map is still shot for review.
    expect.soft(outcome).toEqual([]);
    await expect.poll(async () => allTilesDrawn(world), { timeout: IMAGES_LOAD_MS }).toBe(true);
    await frameScene(world, null, size, fitScale(world, size));
    await expect(world.locator('#board')).toHaveScreenshot('woodland-inn.png');
    // The inn, close: its rooms, walls, doors and furniture.
    await world.evaluate(
        async ({ x, y, scale }) => {
            await canvas?.animatePan({ x, y, scale, duration: 0 });
        },
        { x: 18 * GRID, y: 13.5 * GRID, scale: CLOSE_UP_SCALE / 2 },
    );
    await expect(world.locator('#board')).toHaveScreenshot('woodland-inn-close-up.png');
});

test('the tavern preset: common room, bar, kitchen, store, hall and bedrooms, furnished', async ({ world }) => {
    const { size, outcome } = await composePreset(world, 'tavern', 'Tavern');
    expect.soft(outcome).toEqual([]);
    await expect.poll(async () => allTilesDrawn(world), { timeout: IMAGES_LOAD_MS }).toBe(true);
    await frameScene(world, 'walls', size, fitScale(world, size));
    await expect(world.locator('#board')).toHaveScreenshot('tavern.png');
    await world.evaluate(
        async ({ x, y, scale }) => {
            await canvas?.animatePan({ x, y, scale, duration: 0 });
        },
        { x: 8 * GRID, y: 6 * GRID, scale: CLOSE_UP_SCALE },
    );
    await expect(world.locator('#board')).toHaveScreenshot('tavern-close-up.png');
});
