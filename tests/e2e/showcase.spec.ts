// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Real maps, composed from map intents in the real asset pack's art: the Map
 * builder's presets, fantasy (a woodland inn, a tavern), grimdark (a hive
 * outpost, a hive chapel, a manufactorum) and sci-fi (a void port), each on
 * a scene its size, in the hand-painted texture set. They are judged by eye from their
 * screenshots, whole and close up, and checked to have been composed whole
 * (no problems, every stamp drawn). The pack is not in this repo, so the
 * spec runs only where it is installed among the test modules
 * (`FOUNDRY_TEST_MODULES`); elsewhere it skips.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';
import { type MapIntent, parseMapIntent } from '../../src/compose/intent';
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

/** Where (in squares) and how close a showcase's second shot looks. */
interface CloseUp {
    readonly x: number;
    readonly y: number;
    readonly scale: number;
}

/**
 * Compose `preset`, shoot it whole as `<shot>.png` (wall lines shown for an
 * interior), then close up as `<shot>-close-up.png`.
 */
async function showcase(page: Page, preset: MapPreset, title: string, shot: string, closeUp: CloseUp, walls: boolean): Promise<void> {
    const { size, outcome } = await composePreset(page, preset, title);
    // Soft: whatever the packs lack is reported, and the map is still shot for review.
    expect.soft(outcome).toEqual([]);
    await expect.poll(async () => allTilesDrawn(page), { timeout: IMAGES_LOAD_MS }).toBe(true);
    await frameScene(page, walls ? 'walls' : null, size, fitScale(page, size));
    await expect(page.locator('#board')).toHaveScreenshot(`${shot}.png`);
    await page.evaluate(
        async ({ x, y, scale }) => {
            await canvas?.animatePan({ x, y, scale, duration: 0 });
        },
        { x: closeUp.x * GRID, y: closeUp.y * GRID, scale: closeUp.scale },
    );
    await expect(page.locator('#board')).toHaveScreenshot(`${shot}-close-up.png`);
}

test('the woodland inn preset: an inn in a clearing, a road to its door, a stream through the woods', async ({ world }) => {
    // The inn, close: its rooms, walls, doors and furniture.
    await showcase(world, 'woodland-inn', 'Woodland inn', 'woodland-inn', { x: 18, y: 13.5, scale: CLOSE_UP_SCALE / 2 }, false);
});

/** Whether the viewed level's tiles are all drawn with their images loaded. */
async function levelTilesDrawn(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const shown = (canvas?.tiles?.placeables ?? []).filter((tile) => tile.visible);
        return shown.length > 0 && shown.every((tile) => tile.mesh?.texture?.valid === true);
    });
}

/** View the level named `levelName`, shoot the scene whole as `<shot>.png` (wall lines shown) and close up as `<shot>-close-up.png`. */
async function shootLevel(page: Page, levelName: string, size: SceneSize, shot: string, closeUp: CloseUp): Promise<void> {
    await page.evaluate(async (named) => {
        const scene = canvas?.scene;
        const level = scene?.levels.contents.find((l) => l.name === named);
        await scene?.view({ level: level?.id ?? '' });
    }, levelName);
    await expect.poll(async () => page.evaluate(() => canvas?.ready === true)).toBe(true);
    await expect.poll(async () => levelTilesDrawn(page), { timeout: IMAGES_LOAD_MS }).toBe(true);
    await frameScene(page, 'walls', size, fitScale(page, size));
    await expect(page.locator('#board')).toHaveScreenshot(`${shot}.png`);
    await page.evaluate(
        async ({ x, y, scale }) => {
            await canvas?.animatePan({ x, y, scale, duration: 0 });
        },
        { x: closeUp.x * GRID, y: closeUp.y * GRID, scale: closeUp.scale },
    );
    await expect(page.locator('#board')).toHaveScreenshot(`${shot}-close-up.png`);
}

test('the roadside inn preset: guest rooms upstairs, a cellar by ladder and storm doors, a well, a lake’s river under the road’s bridge', async ({ world }) => {
    const { size, outcome } = await composePreset(world, 'roadside-inn', 'Roadside inn');
    // Soft: whatever the packs lack (or another setting lends) is reported, and every level is still shot for review.
    expect.soft(outcome).toEqual([]);
    // Every level framed alike, whole and close on the inn (its storm-door areaway included), so the floors line up shot to shot.
    const inn = { x: 37, y: 20.5, scale: CLOSE_UP_SCALE / 2.5 };
    await shootLevel(world, 'Ground floor', size, 'roadside-inn-ground', inn);
    await shootLevel(world, 'Guest rooms', size, 'roadside-inn-upper', inn);
    await shootLevel(world, 'Cellar', size, 'roadside-inn-cellar', inn);
});

test('the tavern preset: a taproom with its counter, the kitchen behind it, a store, a hall and bedrooms, furnished', async ({ world }) => {
    await showcase(world, 'tavern', 'Tavern', 'tavern', { x: 8, y: 6, scale: CLOSE_UP_SCALE }, true);
});

test('the hive outpost preset: a fortified outpost among shelled rubble, industry and a toxic runoff', async ({ world }) => {
    // The outpost, close: command, armoury, barracks, medicae, interrogation and cell.
    await showcase(world, 'hive-outpost', 'Hive outpost', 'hive-outpost', { x: 21.5, y: 14.5, scale: CLOSE_UP_SCALE / 2 }, false);
});

test('the hive chapel preset: a nave of pews facing its altar, a vestry, an ossuary and a cell', async ({ world }) => {
    await showcase(world, 'hive-chapel', 'Hive chapel', 'hive-chapel', { x: 12, y: 9, scale: CLOSE_UP_SCALE / 2 }, true);
});

test('the manufactorum preset: rows of machines, an overseer’s post, stores, a mess and bunks', async ({ world }) => {
    await showcase(world, 'manufactorum', 'Manufactorum', 'manufactorum', { x: 10, y: 8, scale: CLOSE_UP_SCALE / 2 }, true);
});

test('the void port preset: craft on a landing field, industry beside it, a road to the port office', async ({ world }) => {
    await showcase(world, 'void-port', 'Void port', 'void-port', { x: 20, y: 16, scale: CLOSE_UP_SCALE / 4 }, false);
});

/**
 * Review renders of any map intents, for judging a composition by eye
 * against a reference: every `*.json` intent in `SHOWCASE_INTENTS` is
 * composed on a scene its size and each of its levels shot, whole and close
 * on its buildings, into `SHOWCASE_OUT` with what the composer reported
 * (`<name>.problems.json`). They are looked at, never compared with a stored
 * screenshot; without the two directories there is nothing to render.
 */
const INTENTS_DIR = process.env['SHOWCASE_INTENTS'];
const OUT_DIR = process.env['SHOWCASE_OUT'];
const REVIEW_INTENTS = INTENTS_DIR === undefined ? [] : readdirSync(INTENTS_DIR).filter((file) => file.endsWith('.json'));

/** The scene centre and scale that frame an intent's buildings together, or its whole map when it has none. */
function buildingsView(page: Page, intent: MapIntent): CloseUp {
    const boxes = intent.buildings.map((b) => ({ x: b.at?.x ?? 0, y: b.at?.y ?? 0, w: b.width, h: b.height }));
    const bounds =
        boxes.length === 0
            ? { x: 0, y: 0, w: intent.width, h: intent.height }
            : {
                  x: Math.min(...boxes.map((b) => b.x)),
                  y: Math.min(...boxes.map((b) => b.y)),
                  w: Math.max(...boxes.map((b) => b.x + b.w)) - Math.min(...boxes.map((b) => b.x)),
                  h: Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(...boxes.map((b) => b.y)),
              };
    // A little room round them, for what stands outside their walls.
    const around = { width: (bounds.w + REVIEW_MARGIN) * GRID, height: (bounds.h + REVIEW_MARGIN) * GRID, gridSize: GRID };
    return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2, scale: fitScale(page, around) };
}

/** Squares of ground shown round the buildings in a review close-up. */
const REVIEW_MARGIN = 4;

for (const file of REVIEW_INTENTS) {
    test(`review render: ${file}`, async ({ world }) => {
        test.skip(OUT_DIR === undefined, 'SHOWCASE_OUT names no directory to write the renders to');
        const parsed = parseMapIntent(JSON.parse(readFileSync(join(INTENTS_DIR ?? '', file), 'utf8')));
        if (!parsed.ok) {
            throw new Error(`${file}: ${JSON.stringify(parsed.issues)}`);
        }
        const { intent } = parsed;
        const size: SceneSize = { width: intent.width * GRID, height: intent.height * GRID, gridSize: GRID };
        const shot = basename(file, '.json');
        await freshScene(world, shot, size);
        await usePaintedSet(world);
        const problems = await world.evaluate(async (given) => {
            const composed = await game.modules?.get('zephyrex-cartography').api.compose(given);
            if (!composed) {
                return ['no module API'];
            }
            return composed.ok ? [...composed.report.problems, ...composed.problems].map((p) => JSON.stringify(p)) : composed.issues.map((i) => i.message);
        }, intent);
        mkdirSync(OUT_DIR ?? '', { recursive: true });
        writeFileSync(join(OUT_DIR ?? '', `${shot}.problems.json`), `${JSON.stringify(problems, null, 2)}\n`);
        const levels = await world.evaluate(() => (canvas?.scene?.levels.contents ?? []).map((l) => l.name));
        const view = buildingsView(world, intent);
        // One level after another on the one canvas.
        await levels.reduce(async (previous, level) => {
            await previous;
            await shootReview(world, level, size, view, join(OUT_DIR ?? '', `${shot}.${level.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`));
        }, Promise.resolve());
    });
}

/** View the level named `level` and shoot it whole as `<path>.png` and close on its buildings as `<path>.close-up.png`, as players see it. */
async function shootReview(page: Page, level: string, size: SceneSize, view: CloseUp, path: string): Promise<void> {
    await page.evaluate(async (named) => {
        const scene = canvas?.scene;
        await scene?.view({ level: scene.levels.contents.find((l) => l.name === named)?.id ?? '' });
    }, level);
    await expect.poll(async () => page.evaluate(() => canvas?.ready === true)).toBe(true);
    // Whatever images there are, loaded; a level of placeholders alone may have none.
    const loaded = async (): Promise<boolean> =>
        page.evaluate(
            () =>
                (canvas?.tiles?.placeables ?? []).filter((t) => t.visible).every((t) => t.mesh?.texture?.valid === true) &&
                game.modules?.get('zephyrex-cartography').api.terrainImagesLoading() === 0,
        );
    await expect.poll(loaded, { timeout: IMAGES_LOAD_MS }).toBe(true);
    // As players see it: no grid over the art, no wall lines (the Walls layer is left inactive).
    await page.evaluate(async () => {
        await canvas?.scene?.update({ grid: { alpha: 0 } });
    });
    await expect.poll(async () => page.evaluate(() => canvas?.ready === true)).toBe(true);
    await frameScene(page, null, size, fitScale(page, size));
    await page.locator('#board').screenshot({ path: `${path}.png` });
    await page.evaluate(
        async ({ x, y, scale }) => {
            await canvas?.animatePan({ x, y, scale, duration: 0 });
        },
        { x: view.x * GRID, y: view.y * GRID, scale: view.scale },
    );
    await page.locator('#board').screenshot({ path: `${path}.close-up.png` });
}
