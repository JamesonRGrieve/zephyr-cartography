// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Composing a map from an intent, in the fixture pack's stamps: a storeroom
 * in a meadow, a road to its door, and rocky ground beside it. The composer
 * picks stamps by role (the pack's chest is storage, its boulder a rock of
 * rocky ground), and what it builds is ordinary features and native
 * documents, taken back in one undo step. `showcase.spec.ts` composes full
 * maps in the real asset pack's art.
 */
import type { Page } from '@playwright/test';
import { expect, frameScene, test } from './lib/foundry';
import { activate, MODULE_ID } from './lib/pointer';
import { panelSelector } from './lib/ux';

/** The storeroom's footprint, in squares; the default scene is 20 by 15. */
const STORE = { x: 10, y: 5, w: 5, h: 4 };

const INTENT = {
    schemaVersion: 1,
    seed: 7,
    width: 20,
    height: 15,
    ground: 'grassland',
    zones: [{ kind: 'rocky', area: { shape: 'circle', centre: { x: 4, y: 7 }, radius: 3.5 }, density: 'dense' }],
    paths: [{ kind: 'road', from: 'south', to: { building: 'store' } }],
    buildings: [
        { key: 'store', at: { x: STORE.x, y: STORE.y }, width: STORE.w, height: STORE.h, rooms: [{ key: 'goods', purpose: 'storage', entrance: true }] },
    ],
};

test('an intent composes into walls, a door, a road, storage against the walls and rocks on the rocky ground, undone in one step', async ({ world }) => {
    const outcome = await world.evaluate(async (intent) => {
        const api = game.modules?.get('zephyrex-cartography').api;
        const composed = await api?.compose(intent);
        if (composed?.ok !== true) {
            return null;
        }
        const kinds = composed.report.features.map((id) => api?.controller()?.getFeature(id)?.type);
        return { problems: composed.problems, built: composed.report.problems, paths: kinds.filter((kind) => kind === 'path').length };
    }, INTENT);
    expect(outcome?.paths).toBe(1);
    expect(outcome?.built).toEqual([]);
    // The fixture pack has no shelves, clutter, shrubs or debris: each is reported once, and nothing else.
    expect(outcome?.problems.map((p) => (p.kind === 'no-stamp' ? p.role : p.kind)).sort()).toEqual(['clutter', 'debris', 'shelf', 'shrub']);

    const docs = await world.evaluate(() => {
        const scene = canvas?.scene;
        const grid = scene?.grid.size ?? 1;
        return {
            walls: (scene?.walls.contents ?? []).map((w) => ({ door: w.door })),
            // A tile's (x, y) is its anchor, its centre here.
            tiles: (scene?.tiles.contents ?? []).map((t) => ({ x: t.x / grid, y: t.y / grid })),
        };
    });
    expect(docs.walls.some((w) => w.door === 1)).toBe(true);
    expect(docs.walls.length).toBeGreaterThanOrEqual(4);
    // Chests stand inside the storeroom, boulders out on the rocky ground to its west.
    const chests = docs.tiles.filter((t) => t.x > STORE.x && t.x < STORE.x + STORE.w && t.y > STORE.y && t.y < STORE.y + STORE.h);
    const rocks = docs.tiles.filter((t) => t.x < STORE.x - 1);
    expect(chests.length).toBeGreaterThanOrEqual(4);
    expect(rocks.length).toBeGreaterThan(0);

    await frameScene(world, 'walls');
    await expect(world.locator('#board')).toHaveScreenshot('storeroom.png');

    const left = await world.evaluate(async () => {
        await game.modules?.get('zephyrex-cartography').api.controller()?.undo();
        const scene = canvas?.scene;
        return { walls: scene?.walls.size, tiles: scene?.tiles.size };
    });
    expect(left).toEqual({ walls: 0, tiles: 0 });
});

/** A two-storey house: its footprint in squares, and its intent. */
const HOUSE = { x: 4, y: 3, w: 12, h: 9 };

const TWO_STOREYS = {
    schemaVersion: 1,
    seed: 3,
    width: 20,
    height: 15,
    ground: 'grassland',
    buildings: [
        {
            key: 'house',
            at: { x: HOUSE.x, y: HOUSE.y },
            width: HOUSE.w,
            height: HOUSE.h,
            rooms: [
                { key: 'hall', purpose: 'hall', entrance: true, opensTo: ['store', 'office'] },
                { key: 'store', purpose: 'storage' },
                { key: 'office', purpose: 'office', size: 1.5 },
            ],
            floors: [
                {
                    name: 'Upper floor',
                    rooms: [
                        { key: 'landing', purpose: 'hall', opensTo: ['cell-1', 'cell-2'] },
                        { key: 'cell-1', purpose: 'cell' },
                        { key: 'cell-2', purpose: 'cell' },
                    ],
                },
            ],
        },
    ],
};

test('a two-storey building: native levels, outer walls stacked on the same perimeter, a stair whose region joins them, nothing upstairs over it', async ({
    world,
}) => {
    const outcome = await world.evaluate(async (intent) => {
        const composed = await game.modules?.get('zephyrex-cartography').api.compose(intent);
        return composed?.ok === true ? { problems: composed.problems, built: composed.report.problems } : null;
    }, TWO_STOREYS);
    expect(outcome?.built).toEqual([]);
    expect(outcome?.problems.every((p) => p.kind === 'no-stamp')).toBe(true);

    const found = await world.evaluate((house) => {
        const scene = canvas?.scene;
        const grid = scene?.grid.size ?? 1;
        const levels = (scene?.levels.contents ?? []).map((l) => ({ id: l.id, name: l.name }));
        const box = { x0: house.x * grid, y0: house.y * grid, x1: (house.x + house.w) * grid, y1: (house.y + house.h) * grid };
        const near = (a: number, b: number): boolean => Math.abs(a - b) < 1;
        /** Wall length lying on the footprint's outline, on each level. */
        const perimeter = Object.fromEntries(
            levels.map((level) => {
                const walled = (scene?.walls.contents ?? [])
                    .filter((w) => [...w.levels].includes(level.id))
                    .reduce((sum, w) => {
                        const [ax = 0, ay = 0, bx = 0, by = 0] = w.c;
                        const onEdge = (near(ax, bx) && (near(ax, box.x0) || near(ax, box.x1))) || (near(ay, by) && (near(ay, box.y0) || near(ay, box.y1)));
                        return onEdge ? sum + Math.hypot(bx - ax, by - ay) : sum;
                    }, 0);
                return [level.name, Math.round(walled)];
            }),
        );
        const stairRegions = (scene?.regions.contents ?? [])
            .filter((r) => r.behaviors.contents.some((b) => b.type === 'changeLevel'))
            .map((r) => ({ levels: [...r.levels].map((id) => levels.find((l) => l.id === id)?.name ?? id).sort((a, b) => a.localeCompare(b)) }));
        const stairTile = (scene?.tiles.contents ?? []).find((t) => t.texture.src?.includes('stairs') ?? false);
        const upper = levels.find((l) => l.name === 'Upper floor')?.id ?? '';
        const onStair = (scene?.tiles.contents ?? []).filter(
            (t) =>
                t !== stairTile &&
                [...t.levels].includes(upper) &&
                stairTile !== undefined &&
                Math.abs(t.x - stairTile.x) < grid &&
                Math.abs(t.y - stairTile.y) < grid,
        ).length;
        return {
            names: levels.map((l) => l.name),
            perimeter,
            stairRegions,
            stairTile: stairTile !== undefined,
            onStair,
            fullPerimeter: 2 * (box.x1 - box.x0 + box.y1 - box.y0),
        };
    }, HOUSE);
    // The scene's own floor became the ground floor; the upper floor stacks above it.
    expect(found.names).toEqual(['Ground floor', 'Upper floor']);
    // Every level walls the whole footprint's outline: upstairs walls stand on the ones below.
    expect(found.perimeter).toEqual({ 'Ground floor': found.fullPerimeter, 'Upper floor': found.fullPerimeter });
    expect(found.stairTile).toBe(true);
    expect(found.stairRegions).toEqual([{ levels: ['Ground floor', 'Upper floor'] }]);
    expect(found.onStair).toBe(0);

    await shootLevel(world, 'Ground floor', 'house-ground.png');
    await shootLevel(world, 'Upper floor', 'house-upper.png');
});

/** View the level named `levelName` and shoot it as `shot`. */
async function shootLevel(page: Page, levelName: string, shot: string): Promise<void> {
    await page.evaluate(async (named) => {
        const scene = canvas?.scene;
        const level = scene?.levels.contents.find((l) => l.name === named);
        await scene?.view({ level: level?.id ?? '' });
    }, levelName);
    await expect.poll(async () => page.evaluate(() => canvas?.ready === true)).toBe(true);
    await frameScene(page, 'walls');
    await expect(page.locator('#board')).toHaveScreenshot(shot);
}

/** An inn of six rooms in a wood, a river laid straight through where it stands. */
const INN = {
    schemaVersion: 1,
    seed: 5,
    width: 20,
    height: 15,
    ground: 'grassland',
    zones: [{ kind: 'woodland', area: { shape: 'everywhere' }, density: 'sparse' }],
    paths: [{ kind: 'river', from: { x: 9, y: -1 }, to: { x: 9, y: 16 }, meander: 0 }],
    buildings: [
        {
            key: 'inn',
            at: { x: 4, y: 3 },
            width: 11,
            height: 8,
            rooms: [
                { key: 'common', purpose: 'common-room', size: 2, entrance: true, opensTo: ['bar', 'hall'] },
                { key: 'bar', purpose: 'bar', opensTo: ['kitchen'] },
                { key: 'kitchen', purpose: 'kitchen', opensTo: ['store'] },
                { key: 'store', purpose: 'storage', size: 0.7 },
                { key: 'hall', purpose: 'hall', opensTo: ['bedroom'] },
                { key: 'bedroom', purpose: 'bedroom' },
            ],
        },
    ],
};

test('the Map builder composes an intent from a preset or pasted text, reporting what the packs lack', async ({ world }) => {
    await activate(world, MODULE_ID, 'road');
    await world.click('button[data-tool="generator"]');
    const panel = world.locator(panelSelector('generator'));
    const intent = panel.getByLabel('Map intent (JSON)');
    const report = panel.getByRole('status');

    // A preset fills the intent box with its intent.
    await panel.getByLabel('Start from').selectOption({ label: "A tavern's rooms" });
    await expect(intent).toHaveValue(/"width": 24/u);

    // Text that is not JSON, or not an intent, is refused and says why.
    await intent.fill('{');
    await panel.getByRole('button', { name: 'Compose', exact: true }).click();
    await expect(report).toContainText('not valid JSON');
    await intent.fill(JSON.stringify({ schemaVersion: 1, width: 2 }));
    await panel.getByRole('button', { name: 'Compose', exact: true }).click();
    await expect(report).toContainText('was not composed');

    await intent.fill(JSON.stringify(INN));
    await panel.getByRole('button', { name: 'Compose', exact: true }).click();
    await expect(report).toContainText('Built', { timeout: 60_000 });
    // The fixture pack has no tables or beds: each is reported where it was wanted.
    await expect(report).toContainText('inn/bedroom: no loaded stamp is a bed');
    const doors = await world.evaluate(() => (canvas?.scene?.walls.contents ?? []).filter((w) => w.door === 1).length);
    // Five connections between the rooms, and the front door.
    expect(doors).toBe(6);

    // Another layout reseeds the intent in the box, for the next compose.
    await panel.getByRole('button', { name: 'Another layout' }).click();
    await expect(intent).not.toHaveValue(/"seed": 5\b/u);
});
