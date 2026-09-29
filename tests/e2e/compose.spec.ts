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
import { parseMapIntent, ROOM_PURPOSES } from '../../src/compose/intent';
import { MAP_PRESETS, PRESET_INTENTS } from '../../src/compose/presets';
import { expect, frameScene, freshScene, test } from './lib/foundry';
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
    // The fixture pack has no shelves, clutter, shrubs or debris: each is reported once, and nothing else. Shelves and shrubs
    // still stand, as labelled boxes; clutter and debris, scattered by the dozen, have none.
    const lacking = (p: NonNullable<typeof outcome>['problems'][number]): string =>
        p.kind === 'no-stamp' ? p.role : p.kind === 'placeholder' ? `${p.piece} (boxed)` : p.kind;
    expect(outcome?.problems.map(lacking).sort()).toEqual(['clutter', 'debris', 'shelf (boxed)', 'shrub (boxed)']);

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
    // Only what the fixture pack has no art for: left out, or standing as a labelled box.
    expect(outcome?.problems.every((p) => p.kind === 'no-stamp' || p.kind === 'placeholder')).toBe(true);

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
        const isStairs = (t: { readonly texture: { readonly src: string | null } }): boolean => t.texture.src?.includes('stairs') ?? false;
        const stairTile = (scene?.tiles.contents ?? []).find(isStairs);
        const upper = levels.find((l) => l.name === 'Upper floor')?.id ?? '';
        // The flight's steps, seen again from the floor above: drawn there, no way of their own.
        const stairsFromAbove = (scene?.tiles.contents ?? []).filter((t) => t !== stairTile && isStairs(t) && [...t.levels].includes(upper)).length;
        const onStair = (scene?.tiles.contents ?? []).filter(
            (t) =>
                !isStairs(t) &&
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
            stairsFromAbove,
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
    expect(found.stairsFromAbove).toBe(1);
    expect(found.onStair).toBe(0);

    await shootLevel(world, 'Ground floor', 'house-ground.png');
    await shootLevel(world, 'Upper floor', 'house-upper.png');
});

test('a roadside inn: its cellar a native level below the scene’s own floor, its guest rooms one above, each joined to the ground, and its storm doors’ way down', async ({
    world,
}) => {
    await freshScene(world, 'Roadside inn', { width: 4800, height: 3600, gridSize: 100 });
    // In any setting: the fixture pack's stamps are test art, which belongs to none.
    const outcome = await world.evaluate(
        async (intent) => {
            const composed = await game.modules?.get('zephyrex-cartography').api.compose(intent);
            return composed?.ok === true ? { problems: composed.problems.map((p) => p.kind), built: composed.report.problems } : null;
        },
        { ...PRESET_INTENTS['roadside-inn'], settings: [] },
    );
    expect(outcome?.built).toEqual([]);
    // No storm-door art, so a ladder stands in the areaway, and says so.
    expect(outcome?.problems).toContain('stand-in');

    const found = await world.evaluate(() => {
        const scene = canvas?.scene;
        const levels = [...(scene?.levels.contents ?? [])]
            .map((l) => ({ id: l.id, name: l.name, bottom: l.elevation.bottom ?? 0, top: l.elevation.top ?? 0 }))
            .sort((a, b) => a.bottom - b.bottom);
        const nameOf = (id: string): string => levels.find((l) => l.id === id)?.name ?? id;
        const joins = (scene?.regions.contents ?? [])
            .filter((r) => r.behaviors.contents.some((b) => b.type === 'changeLevel'))
            .map((r) =>
                [...r.levels]
                    .map(nameOf)
                    .sort((a, b) => a.localeCompare(b))
                    .join(' + '),
            )
            .sort((a, b) => a.localeCompare(b));
        // What stands on each level, by the stamp each tile is named after.
        const standing: Record<string, Record<string, number>> = {};
        for (const tile of scene?.tiles.contents ?? []) {
            const piece = tile.name ?? '';
            for (const id of tile.levels) {
                const level = (standing[nameOf(id)] ??= {});
                level[piece] = (level[piece] ?? 0) + 1;
            }
        }
        return { levels, joins, standing };
    });
    // Bottom to top: the cellar under the scene's own floor, the guest rooms over it.
    expect(found.levels.map((l) => l.name)).toEqual(['Cellar', 'Ground floor', 'Guest rooms']);
    // Every guest room lived in: a bed, a dresser, a chair to sit in; the taproom's counter and hearth below.
    const upstairs = found.standing['Guest rooms'] ?? {};
    const downstairs = found.standing['Ground floor'] ?? {};
    expect(upstairs['Bed']).toBe(8);
    expect(upstairs['Dresser'] ?? 0).toBeGreaterThanOrEqual(8);
    expect((upstairs['Armchair'] ?? 0) + (upstairs['Chair'] ?? 0)).toBeGreaterThanOrEqual(8);
    expect(downstairs['Counter']).toBe(1);
    expect(downstairs['Hearth'] ?? 0).toBeGreaterThanOrEqual(2);
    // Outside: the well, the yard's pen and cart, the road's bridge over the river.
    for (const piece of ['Well', 'Pen', 'Wagon', 'Bridge']) {
        expect(downstairs[piece] ?? 0, piece).toBeGreaterThanOrEqual(1);
    }
    const [cellar, ground, upper] = found.levels;
    expect(cellar?.top).toBe(ground?.bottom);
    expect(upper?.bottom).toBe(ground?.top);
    // The stair up to the guest rooms, the ladder down to the cellar, and the ladder standing in for the storm doors.
    expect(found.joins).toEqual(['Cellar + Ground floor', 'Cellar + Ground floor', 'Ground floor + Guest rooms']);
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

/** A hull tapered at its bow, a ladder down to its hold: its footprint in squares, and its intent. */
const HULL = { x: 5, y: 2, w: 10, h: 11 };

const LADDER_DOWN = {
    schemaVersion: 1,
    seed: 4,
    width: 20,
    height: 15,
    ground: 'grassland',
    buildings: [
        {
            key: 'hull',
            at: { x: HULL.x, y: HULL.y },
            width: HULL.w,
            height: HULL.h,
            cellarAccess: 'ladder',
            rooms: [{ key: 'deck', purpose: 'hall', entrance: true, chamfer: 3, chamferAt: ['top-left', 'top-right'] }],
            cellars: [{ name: 'Hold', rooms: [{ key: 'hold', purpose: 'storage' }] }],
        },
    ],
};

test('a hull cut at its bow alone, a ladder down to its hold: the one ladder the way between them, a dark hatchway above it', async ({ world }) => {
    const outcome = await world.evaluate(async (intent) => {
        const composed = await game.modules?.get('zephyrex-cartography').api.compose(intent);
        return composed?.ok === true ? { problems: composed.problems, built: composed.report.problems } : null;
    }, LADDER_DOWN);
    expect(outcome?.built).toEqual([]);
    expect(outcome?.problems.every((p) => p.kind === 'no-stamp' || p.kind === 'placeholder')).toBe(true);

    const found = await world.evaluate(() => {
        const scene = canvas?.scene;
        const levels = (scene?.levels.contents ?? []).map((l) => ({ id: l.id, name: l.name }));
        const ground = levels.find((l) => l.name !== 'Hold')?.id ?? '';
        // The deck's cut corners: the diagonal walls on its level.
        const diagonals = (scene?.walls.contents ?? []).filter((w) => {
            const [ax = 0, ay = 0, bx = 0, by = 0] = w.c;
            return [...w.levels].includes(ground) && ax !== bx && ay !== by;
        }).length;
        const ways = (scene?.regions.contents ?? []).filter((r) => r.behaviors.contents.some((b) => b.type === 'changeLevel')).length;
        // The fixture pack draws its ladder in its stairs' art; this building has no stair.
        const ladders = (scene?.tiles.contents ?? []).filter((t) => t.texture.src?.includes('stairs') ?? false).length;
        return { names: levels.map((l) => l.name), diagonals, ways, ladders };
    });
    expect(found.names).toContain('Hold');
    // Its two bow corners cut, its stern square.
    expect(found.diagonals).toBe(2);
    // The fixture pack has no ladder going down to show from above: the ladder stands once, the deck over it a dark frame.
    expect(found.ways).toBe(1);
    expect(found.ladders).toBe(1);
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

test('a curtain wall with its moat, a walled city district and hewn tunnels compose into native walls, water and rooms', async ({ world }) => {
    const grid = 50;
    await freshScene(world, 'Walled town', { width: 40 * grid, height: 30 * grid, gridSize: grid });
    const wall = [
        { x: 4, y: 4 },
        { x: 16, y: 4 },
        { x: 16, y: 16 },
        { x: 4, y: 16 },
    ];
    const tunnel = [
        { x: 2, y: 24 },
        { x: 20, y: 26 },
        { x: 38, y: 24 },
    ];
    const outcome = await world.evaluate(
        async (intent) => {
            const api = game.modules?.get('zephyrex-cartography').api;
            const composed = await api?.compose(intent);
            if (composed?.ok !== true) {
                return null;
            }
            const features = composed.report.features.map((id) => api?.controller()?.getFeature(id)).filter((f) => f !== null && f !== undefined);
            return {
                built: composed.report.problems,
                rooms: features.filter((f) => f.type === 'room').length,
                water: features.filter((f) => f.type === 'region' && f.biome === 'water').length,
                walls: canvas?.scene?.walls.size ?? 0,
                signs: (canvas?.scene?.notes.contents ?? []).map((note) => note.text),
            };
        },
        {
            schemaVersion: 1,
            seed: 3,
            width: 40,
            height: 30,
            ground: 'grassland',
            // Square towers, one along the east side; a gate in the south wall and a breach in the north.
            curtains: [
                {
                    points: wall,
                    towers: { round: false, at: [{ x: 16, y: 10 }] },
                    gates: [
                        { edge: 2, width: 3 },
                        { edge: 0, at: 0.3, state: 'gap' },
                    ],
                    moat: {},
                },
            ],
            // A keep in the bailey, its hall drawn to a brief: a counter butting the wall, a sign players read, benches.
            buildings: [
                {
                    key: 'keep',
                    at: { x: 7, y: 7 },
                    width: 6,
                    height: 6,
                    rooms: [
                        {
                            key: 'hall',
                            purpose: 'hall',
                            entrance: true,
                            furnish: 'fixtures',
                            fixtures: [
                                {
                                    name: 'bar counter',
                                    role: 'counter',
                                    width: 3,
                                    height: 1,
                                    facing: 'left',
                                    open: ['bottom'],
                                    place: { at: { x: 0.8, y: 0.4 } },
                                },
                                { name: 'tally board', width: 1, height: 0.2, reads: 'NO CREDIT', fixed: true, place: { wall: 'top', along: 'middle' } },
                                {
                                    name: 'bench',
                                    role: 'bench',
                                    width: 2,
                                    height: 0.5,
                                    count: 2,
                                    place: { line: { from: { x: 0.2, y: 0.3 }, to: { x: 0.2, y: 0.7 } } },
                                },
                            ],
                        },
                    ],
                },
            ],
            districts: [
                {
                    area: { x: 20, y: 2, w: 18, h: 16 },
                    frontage: 1,
                    streetPieces: [{ name: 'street chest', role: 'storage', tags: ['loot'], width: 1, height: 0.8 }],
                    roofPieces: [{ name: 'roof vent', width: 1.2, height: 1.2 }],
                },
            ],
            hewn: [{ passages: [{ points: tunnel, width: 2 }], chambers: [{ centre: { x: 20, y: 26 }, width: 6, height: 5 }] }],
        },
    );
    expect(outcome?.built).toEqual([]);
    // Four runs of wall broken by the gate, four towers and the gate's passage; the district's blocks; the tunnels.
    expect(outcome?.rooms).toBeGreaterThan(12);
    expect(outcome?.water).toBe(1);
    expect(outcome?.walls).toBeGreaterThan(40);
    // The tally board's words are a Note players read on hover.
    expect(outcome?.signs).toContain('NO CREDIT');
});

test('a building with a room of every purpose furnishes each in Foundry, into native tiles and walls, with nothing it could not build', async ({ world }) => {
    const grid = 50;
    await freshScene(world, 'Every purpose', { width: 44 * grid, height: 34 * grid, gridSize: grid });
    const rooms = ROOM_PURPOSES.map((purpose, i) => ({ key: `r${i}`, purpose, ...(i === 0 ? { entrance: true } : { opensTo: ['r0'] }) }));
    const outcome = await world.evaluate(
        async (intent) => {
            const api = game.modules?.get('zephyrex-cartography').api;
            const composed = await api?.compose(intent);
            if (composed?.ok !== true) {
                return null;
            }
            const types = composed.report.features.map((id) => api?.controller()?.getFeature(id)?.type);
            return {
                built: composed.report.problems,
                rooms: types.filter((t) => t === 'room').length,
                tiles: canvas?.scene?.tiles.size ?? 0,
                walls: canvas?.scene?.walls.size ?? 0,
            };
        },
        { schemaVersion: 1, seed: 5, width: 44, height: 34, ground: null, buildings: [{ key: 'all', width: 40, height: 30, rooms }] },
    );
    expect(outcome?.built).toEqual([]);
    expect(outcome?.rooms).toBe(ROOM_PURPOSES.length);
    expect(outcome?.tiles).toBeGreaterThan(50);
    expect(outcome?.walls).toBeGreaterThan(ROOM_PURPOSES.length * 4);
});

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
    // The fixture pack has no shelves: each room that wanted one reports it.
    await expect(report).toContainText('inn/kitchen: no loaded stamp draws the shelf, so a labelled box stands in for it');
    const doors = await world.evaluate(() => (canvas?.scene?.walls.contents ?? []).filter((w) => w.door === 1).length);
    // Five connections between the rooms, and the front door.
    expect(doors).toBe(6);

    // Another layout reseeds the intent in the box, for the next compose.
    await panel.getByRole('button', { name: 'Another layout' }).click();
    await expect(intent).not.toHaveValue(/"seed": 5\b/u);
});

test('every Map builder preset composes in Foundry into native documents, with nothing it could not build', async ({ world }) => {
    test.setTimeout(PRESETS_MS);
    const built: Record<string, { problems: readonly string[]; walls: number; tiles: number }> = {};
    // One scene after another: each preset composed on a fresh scene its size.
    await MAP_PRESETS.reduce(async (previous, preset) => {
        await previous;
        // In any setting: the fixture pack's stamps are test art, which belongs to none.
        const intent = { ...PRESET_INTENTS[preset], settings: [] };
        const parsed = parseMapIntent(intent);
        const size = parsed.ok ? { width: parsed.intent.width * GRID, height: parsed.intent.height * GRID, gridSize: GRID } : undefined;
        await freshScene(world, preset, size);
        built[preset] = await world.evaluate(async (given) => {
            const composed = await game.modules?.get('zephyrex-cartography').api.compose(given);
            const scene = canvas?.scene;
            return {
                problems: composed?.ok === true ? composed.report.problems.map((p) => JSON.stringify(p)) : ['not composed'],
                walls: scene?.walls.size ?? 0,
                tiles: scene?.tiles.size ?? 0,
            };
        }, intent);
    }, Promise.resolve());
    for (const preset of MAP_PRESETS) {
        expect(built[preset]?.problems, preset).toEqual([]);
        // Every preset has a building walled in native walls, or (the open maps) ground and paths with stamps.
        expect((built[preset]?.walls ?? 0) + (built[preset]?.tiles ?? 0), preset).toBeGreaterThan(0);
    }
});

/** Px per grid square of the preset scenes, and how long composing every preset may take, in ms. */
const GRID = 100;
const PRESETS_MS = 600_000;

/** The model's endpoint in the assisted test: never a real host, answered where the browser sends to it. */
const ADVISOR = 'https://advisor.invalid/v1';

test('AI-assisted, the Map builder asks the model to choose stamps and critique the layout, and makes the fixes it may', async ({ world }) => {
    await world.evaluate(async (endpoint) => {
        await game.settings?.set('zephyrex-cartography', 'assistEndpoint', endpoint);
        await game.settings?.set('zephyrex-cartography', 'assistModel', 'test-model');
        await game.settings?.set('zephyrex-cartography', 'assistKey', 'test-key');
    }, ADVISOR);
    // The model: its first answer chooses nothing, wrapped in prose; its second turns the first piece the critique lists.
    const asked: { authorization: string | undefined; sent: string }[] = [];
    await world.route(`${ADVISOR}/chat/completions`, async (route) => {
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization' };
        if (route.request().method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: cors });
            return;
        }
        const sent = route.request().postData() ?? '';
        asked.push({ authorization: route.request().headers()['authorization'], sent });
        const piece = /#(\d+) /u.exec(sent)?.[1];
        const content =
            asked.length === 1 ? 'Here is my choice: {}' : JSON.stringify([{ piece: Number(piece), action: 'turn', facing: 'east', why: 'face the door' }]);
        await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
    });
    await activate(world, MODULE_ID, 'road');
    await world.click('button[data-tool="generator"]');
    const panel = world.locator(panelSelector('generator'));
    await panel.getByLabel('Compose with').selectOption({ label: 'AI-assisted' });
    await panel.getByLabel('Map intent (JSON)').fill(JSON.stringify(INTENT));
    await panel.getByRole('button', { name: 'Compose', exact: true }).click();
    const report = panel.getByRole('status');
    await expect(report).toContainText('The model chose the stamps of 0 places.', { timeout: 60_000 });
    await expect(report).toContainText('The model asked for 1 fixes; 1 were made:');
    await expect(report).toContainText('turn: face the door');
    // Asked twice, as the world's model, with the GM's key, and without thinking aloud first.
    expect(asked).toHaveLength(2);
    expect(asked[0]?.authorization).toBe('Bearer test-key');
    expect(asked[0]?.sent).toContain('"model":"test-model"');
    expect(asked[0]?.sent).toContain('"chat_template_kwargs":{"enable_thinking":false}');
    await world.unroute(`${ADVISOR}/chat/completions`);
});
