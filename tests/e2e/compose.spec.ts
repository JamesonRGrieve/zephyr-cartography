// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Composing a map from an intent, in the fixture pack's stamps: a storeroom
 * in a meadow, a road to its door, and rocky ground beside it. The composer
 * picks stamps by role (the pack's chest is storage, its boulder a rock of
 * rocky ground), and what it builds is ordinary features and native
 * documents, taken back in one undo step. `showcase.spec.ts` composes full
 * maps in the real asset pack's art.
 */
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
