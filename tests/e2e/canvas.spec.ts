// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What the canvas shows for what a GM draws, beyond which documents exist: a
 * painted stroke is the round swath a brush leaves, and a river ends square at
 * its full width. Each is measured where the scene records it and kept as a
 * screenshot of the real canvas.
 */
import { expect, frameScene, savedFeatures, test } from './lib/foundry';
import { dragScene, drawShape, holdView, MODULE_ID, type Point, tuckPanels, useTool } from './lib/pointer';

test('a painted stroke is a round brush’s swath: its ground reaches a brush radius past both ends, no wider', async ({ world }) => {
    await useTool(world, 'paint', { panel: true });
    const panel = world.locator(`#${MODULE_ID}-paint`);
    await panel.getByRole('button', { name: 'Forest' }).click();
    await panel.getByLabel('Brush size (px)').fill('50');
    await panel.getByLabel('Brush size (px)').press('Enter');
    // Difficult ground gets its own Scene Region over exactly what is painted, which Foundry records.
    await panel.getByLabel('Movement cost (×)').fill('2');
    await panel.getByLabel('Movement cost (×)').press('Enter');
    await tuckPanels(world);
    await holdView(world);
    await dragScene(world, { x: 500, y: 1000 }, [
        { x: 800, y: 1000 },
        { x: 1100, y: 1000 },
        { x: 1300, y: 1000 },
    ]);
    const extent = async (): Promise<{ left: number; right: number; top: number; bottom: number } | null> =>
        world.evaluate(() => {
            const region = canvas?.scene?.regions.contents.find((r) => r.shapes.some((shape) => shape.type === 'polygon'));
            const points = region?.shapes.flatMap((shape) => (shape.type === 'polygon' && 'points' in shape ? [...shape.points] : [])) ?? [];
            if (points.length === 0) {
                return null;
            }
            const xs = points.filter((_, i) => i % 2 === 0);
            const ys = points.filter((_, i) => i % 2 === 1);
            return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
        });
    await expect.poll(extent).not.toBeNull();
    const box = await extent();
    // Rounded past each end by the brush's radius (a square end would stop at the press and release), and never wider than it.
    expect(box?.left).toBeLessThanOrEqual(455);
    expect(box?.right).toBeGreaterThanOrEqual(1345);
    expect(box?.top).toBeGreaterThanOrEqual(948);
    expect(box?.bottom).toBeLessThanOrEqual(1052);
    await frameScene(world);
    await expect(world.locator('#board')).toHaveScreenshot('round-brush-stroke.png');
});

test('overlapping strokes of one texture meet seamlessly: every fill tiles from the scene’s origin, two grid squares a tile', async ({ world }) => {
    await useTool(world, 'paint', { panel: true });
    const panel = world.locator(`#${MODULE_ID}-paint`);
    await panel.getByRole('button', { name: 'Forest' }).click();
    await panel.getByLabel('Brush size (px)').fill('120');
    await panel.getByLabel('Brush size (px)').press('Enter');
    await tuckPanels(world);
    await holdView(world);
    await dragScene(world, { x: 500, y: 700 }, [
        { x: 900, y: 760 },
        { x: 1300, y: 700 },
    ]);
    await dragScene(world, { x: 700, y: 900 }, [
        { x: 900, y: 700 },
        { x: 1100, y: 500 },
    ]);
    const tiling = async (): Promise<{ textureOrigin: Point; span: number }[]> =>
        world.evaluate(() => {
            const terrain = canvas?.primary?.children.find((child) => child.name === 'zephyr-cartography-terrain');
            const sprites = (terrain instanceof PIXI.Container ? terrain.children : []).flatMap((child) =>
                child instanceof PIXI.Container ? child.children.filter((grandchild) => grandchild instanceof PIXI.TilingSprite) : [],
            );
            return sprites.map((sprite) => ({
                // Where the texture's own origin falls in the scene.
                textureOrigin: { x: sprite.x + sprite.tilePosition.x, y: sprite.y + sprite.tilePosition.y },
                span: sprite.tileScale.x * sprite.texture.baseTexture.width,
            }));
        });
    await expect.poll(async () => (await tiling()).length).toBe(2);
    const gridSize = await world.evaluate(() => canvas?.grid?.size ?? 0);
    for (const { textureOrigin, span } of await tiling()) {
        expect(textureOrigin).toEqual({ x: 0, y: 0 });
        expect(span).toBeCloseTo(gridSize * 2);
    }
    await frameScene(world);
    await expect(world.locator('#board')).toHaveScreenshot('overlapping-strokes.png');
});

test('features saved to the scene by another writer are drawn: another client, or a canvas replaced mid-build', async ({ world }) => {
    await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            features: [{ type: 'stroke', biome: 'forest', radius: 2, points: [{ x: 5, y: 5 }] }],
        });
    });
    const fills = async (): Promise<number> =>
        world.evaluate(() => {
            const terrain = canvas?.primary?.children.find((child) => child.name === 'zephyr-cartography-terrain');
            return terrain instanceof PIXI.Container ? terrain.children.length : -1;
        });
    await expect.poll(fills).toBe(1);
    // Saved as a writer other than this canvas's controller would: a file of its own with a second stroke, and the
    // scene's marker moved on to it.
    const [first] = await savedFeatures(world);
    if (!first) {
        throw new Error('one feature saved');
    }
    await world.evaluate(
        async (features) => {
            const scene = canvas?.scene;
            const marker = scene?.getFlag('zephyr-cartography', 'featuresFile');
            if (!scene || !marker) {
                throw new Error('the features saved to a file');
            }
            const folder = marker.path.slice(0, marker.path.lastIndexOf('/'));
            const file = new File([JSON.stringify(features)], 'written-elsewhere.json', { type: 'application/json' });
            await foundry.applications.apps.FilePicker.implementation.upload('data', folder, file, {}, { notify: false });
            await scene.setFlag('zephyr-cartography', 'featuresFile', { path: `${folder}/written-elsewhere.json`, rev: marker.rev + 1 });
        },
        [first, { ...first, id: 'written-elsewhere' }],
    );
    await expect.poll(fills).toBe(2);
});

test('features are saved to a file of the scene’s own, never into the scene, so no client downloads them with the world', async ({ world }) => {
    await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            features: [{ type: 'stroke', biome: 'forest', radius: 2, points: [{ x: 5, y: 5 }] }],
        });
    });
    const flags = await world.evaluate(() => {
        const scene = canvas?.scene;
        const marker = scene?.getFlag('zephyr-cartography', 'featuresFile');
        return {
            id: scene?.id ?? null,
            inScene: scene?.getFlag('zephyr-cartography', 'features') ?? null,
            path: marker === undefined ? null : marker.path,
        };
    });
    expect(flags.inScene).toBeNull();
    expect(flags.path).toBe(`worlds/${await world.evaluate(() => game.world?.id ?? '')}/zephyr-cartography/features-${flags.id ?? ''}.json`);
    expect((await savedFeatures(world)).map((f) => f.type)).toEqual(['stroke']);
});

test('a scene saved before files is drawn from its flag, then moved into a file of its own with nothing lost', async ({ world }) => {
    await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            features: [
                { type: 'stroke', biome: 'forest', radius: 2, points: [{ x: 5, y: 5 }] },
                { type: 'pin', x: 8, y: 4, text: 'Old well' },
            ],
        });
    });
    const saved = await savedFeatures(world);
    // The scene as saved before files: its features in its flag, and no marker.
    await world.evaluate(async (features) => {
        const scene = canvas?.scene;
        await scene?.unsetFlag('zephyr-cartography', 'featuresFile');
        await scene?.setFlag('zephyr-cartography', 'features', features);
        await canvas?.draw();
    }, saved);
    const ids = saved.map((f) => f.id);
    const drawn = async (): Promise<number> =>
        world.evaluate((wanted) => {
            const controller = game.modules?.get('zephyr-cartography').api.controller();
            return controller ? wanted.filter((id) => controller.getFeature(id) !== null).length : -1;
        }, ids);
    await expect.poll(drawn).toBe(2);
    const moved = await world.evaluate(async () => game.modules?.get('zephyr-cartography').api.migrateFeatures());
    expect(moved).toBeGreaterThanOrEqual(1);
    const flags = await world.evaluate(() => ({
        inScene: canvas?.scene?.getFlag('zephyr-cartography', 'features') ?? null,
        marked: canvas?.scene?.getFlag('zephyr-cartography', 'featuresFile') !== undefined,
    }));
    expect(flags).toEqual({ inScene: null, marked: true });
    expect(await savedFeatures(world)).toEqual(saved);
    // Moved once: run again, nothing moves.
    expect(await world.evaluate(async () => game.modules?.get('zephyr-cartography').api.migrateFeatures())).toBe(0);
});

test('painted ground lies beneath the stamps placed on it, as a map background does', async ({ world }) => {
    await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            features: [
                { type: 'stroke', biome: 'forest', radius: 2, points: [{ x: 5, y: 5 }] },
                { type: 'stamp', stamp: 'zc-e2e-pack:crate', x: 5, y: 5 },
            ],
        });
    });
    // Where the terrain and the stamp's tile sort in the primary group, once the tile is drawn (-1: not there yet).
    const order = async (): Promise<{ terrain: number; tile: number }> =>
        world.evaluate(() => {
            const primary = canvas?.primary;
            primary?.sortChildren();
            const children = primary?.children ?? [];
            const mesh = canvas?.tiles?.placeables[0]?.mesh;
            return { terrain: children.findIndex((child) => child.name === 'zephyr-cartography-terrain'), tile: mesh ? children.indexOf(mesh) : -1 };
        });
    await expect.poll(async () => (await order()).tile).toBeGreaterThanOrEqual(0);
    const { terrain, tile } = await order();
    expect(terrain).toBeGreaterThanOrEqual(0);
    expect(tile).toBeGreaterThan(terrain);
});

test('a river ends square at its full width, as a road does', async ({ world }) => {
    await useTool(world, 'river', { panel: true });
    const panel = world.locator(`#${MODULE_ID}-paths`);
    await panel.getByLabel('Width (px)').fill('120');
    await panel.getByLabel('Width (px)').press('Enter');
    await tuckPanels(world);
    await holdView(world);
    await drawShape(world, [
        { x: 300, y: 750 },
        { x: 1000, y: 750 },
        { x: 1700, y: 750 },
    ]);
    await expect
        .poll(async () =>
            world.evaluate(() => {
                const controller = game.modules?.get('zephyr-cartography').api.controller();
                // Just inside each end, off the centerline by most of the half-width: full width reaches there.
                return [
                    { x: 310, y: 800 },
                    { x: 1690, y: 700 },
                ].map((at) => controller?.getFeature(controller.hitTest(at) ?? '')?.type ?? null);
            }),
        )
        .toEqual(['path', 'path']);
    await frameScene(world);
    await expect(world.locator('#board')).toHaveScreenshot('river-square-ends.png');
});
