// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, frameScene, test } from './lib/foundry';

test('a stamp’s tile and light take its pack’s occlusion, restrictions and light technique', async ({ world }) => {
    const placed = await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.controller()?.placeStamp({ stamp: 'zc-e2e-pack:brazier', x: 500, y: 400 });
        const tile = canvas?.scene?.tiles.contents[0];
        const light = canvas?.scene?.lights.contents[0];
        return {
            tile: tile && {
                modes: [...tile.occlusion.modes].sort((a, b) => (a ?? 0) - (b ?? 0)),
                alpha: tile.occlusion.alpha,
                alphaThreshold: tile.texture.alphaThreshold,
                light: tile.restrictions.light,
            },
            light: light && {
                coloration: light.config.coloration,
                luminosity: light.config.luminosity,
                walls: light.walls,
                darkness: { min: light.config.darkness.min, max: light.config.darkness.max },
                hidden: light.hidden,
            },
        };
    });
    // CONST.OCCLUSION_MODES: FADE 1, VISION 8. SHADER_TECHNIQUES.ADAPTIVE_ATTENUATION is id 101.
    expect(placed.tile).toEqual({ modes: [1, 8], alpha: 0.25, alphaThreshold: 0.5, light: true });
    expect(placed.light).toEqual({ coloration: 101, luminosity: 0.3, walls: false, darkness: { min: 0.25, max: 1 }, hidden: true });
});

test('a stamp’s terrain and surface become native Modify Movement Cost and Define Surface regions', async ({ world }) => {
    await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        const crate = await controller?.placeStamp({ stamp: 'zc-e2e-pack:crate', x: 300, y: 300 });
        await controller?.setStampVariant(crate ?? '', 1); // smashed: rubble underfoot
        await controller?.placeStamp({ stamp: 'zc-e2e-pack:canopy', x: 800, y: 500 });
    });
    const regions = await world.evaluate(() =>
        (canvas?.scene?.regions.contents ?? []).map((r) => ({
            name: r.name,
            bottom: r.elevation.bottom,
            top: r.elevation.top,
            // The behaviours' source data, plain for the trip out of the page.
            behaviors: r.behaviors.contents.map((b) => b.toObject()),
        })),
    );
    const byName = Object.fromEntries(regions.map((r) => [r.name, r]));
    expect(byName['Crate terrain']).toMatchObject({ behaviors: [{ type: 'modifyMovementCost', system: { difficulties: { walk: 2 } } }] });
    // The canopy's roof sits atop its 2-square height: 10 distance units on the fixture's 5-unit grid.
    expect(byName['Canopy surface']).toMatchObject({
        bottom: 0,
        top: 10,
        behaviors: [{ type: 'defineSurface', system: { placement: 'top', exposure: true } }],
    });
});

test('an impassable stamp is walled for movement alone, so Foundry stops a token crossing it but it hides nothing', async ({ world }) => {
    const result = await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.controller()?.placeStamp({ stamp: 'zc-e2e-pack:boulder', x: 400, y: 400 });
        const walls = (canvas?.scene?.walls.contents ?? []).map((w) => ({ move: w.move, sight: w.sight, light: w.light, sound: w.sound }));
        // The collision test Foundry's own token movement runs: a straight move through the boulder, and one beside it.
        const level = canvas?.level ?? undefined;
        const collides = (y: number): boolean =>
            CONFIG.Canvas.polygonBackends.move.testCollision({ x: 250, y }, { x: 550, y }, { type: 'move', mode: 'any', level });
        const blocked = collides(400);
        const beside = collides(700);
        return { walls, blocked, beside, regions: canvas?.scene?.regions.size };
    });
    // CONST.WALL_MOVEMENT_TYPES.NORMAL is 20; EDGE_SENSE_TYPES.NONE is 0.
    expect(result.walls).toEqual(Array.from({ length: 4 }, () => ({ move: 20, sight: 0, light: 0, sound: 0 })));
    expect(result.blocked).toBe(true);
    expect(result.beside).toBe(false);
    expect(result.regions).toBe(0);
});

test('a stamp’s particles run as native particle generators, following its variant', async ({ world }) => {
    /** The particle containers Foundry's generators put on the primary canvas, with their elevation and particles. */
    const running = async (): Promise<{ elevation: number; particles: number }[]> =>
        world.evaluate(() =>
            (canvas?.primary?.children ?? [])
                .filter((child) => child instanceof foundry.canvas.primary.PrimaryCanvasParticleContainer)
                .map((child) => ({ elevation: child.elevation, particles: child.children.length })),
        );
    const crate = await world.evaluate(
        async () => (await game.modules?.get('zephyr-cartography').api.controller()?.placeStamp({ stamp: 'zc-e2e-pack:crate', x: 400, y: 400 })) ?? '',
    );
    expect(await running()).toEqual([]);
    const setVariant = async (variant: number): Promise<void> => {
        await world.evaluate(async ({ id, index }) => game.modules?.get('zephyr-cartography').api.controller()?.setStampVariant(id, index), {
            id: crate,
            index: variant,
        });
    };
    // Smashed, it smokes: one emitter at the stamp's base, spawning its particles.
    await setVariant(1);
    await expect.poll(running).toEqual([{ elevation: 0, particles: expect.any(Number) }]);
    await expect.poll(async () => (await running())[0]?.particles ?? 0).toBeGreaterThan(0);
    // Back to whole, the smoke stops and its container goes.
    await setVariant(0);
    await expect.poll(running).toEqual([]);
});

test('a placed stamp is a native tile centred on its point, with its light', async ({ world }) => {
    const placed = await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        const id = await controller?.placeStamp({ stamp: 'zc-e2e-pack:lamp', x: 500, y: 400 });
        const tile = canvas?.scene?.tiles.contents[0];
        const light = canvas?.scene?.lights.contents[0];
        return {
            id,
            tile: tile && {
                name: tile.name,
                x: tile.x,
                y: tile.y,
                width: tile.width,
                height: tile.height,
                anchorX: tile.texture.anchorX,
                anchorY: tile.texture.anchorY,
            },
            light: light && { name: light.name, x: light.x, y: light.y },
        };
    });
    expect(placed.id).toEqual(expect.any(String));
    // v14 places a tile by its anchor: the stamp's centre, not its top-left.
    // Named after the stamp, so they read clearly in Foundry's Placeables tab.
    expect(placed.tile).toEqual({ name: 'Lamp', x: 500, y: 400, width: 100, height: 100, anchorX: 0.5, anchorY: 0.5 });
    expect(placed.light).toEqual({ name: 'Lamp light', x: 500, y: 400 });
    await frameScene(world);
    await expect(world.locator('#board')).toHaveScreenshot('lamp-placed.png');
});

test('a stamp emits its ambient sound as a native AmbientSound, silenced by a variant that sets none', async ({ world }) => {
    const sound = await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        const id = await controller?.placeStamp({ stamp: 'zc-e2e-pack:lamp', x: 500, y: 400 });
        const placed = canvas?.scene?.sounds.contents[0];
        const before = placed && { name: placed.name, x: placed.x, y: placed.y, radius: placed.radius, path: placed.path, volume: placed.volume };
        if (id !== undefined && id !== null) {
            await controller?.setStampVariant(id, 1);
        }
        return { before, after: canvas?.scene?.sounds.size };
    });
    // 3 grid units at the scene's 5 distance units per square; the path served from the pack module.
    expect(sound.before).toEqual({ name: 'Lamp sound', x: 500, y: 400, radius: 15, path: 'modules/zc-e2e-pack/sounds/silence.wav', volume: 0.5 });
    expect(sound.after).toBe(0);
});

test('switching to an unlit variant swaps the image and removes the light', async ({ world }) => {
    const after = await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        const id = await controller?.placeStamp({ stamp: 'zc-e2e-pack:lamp', x: 300, y: 300 });
        if (id !== undefined && id !== null) {
            await controller?.setStampVariant(id, 1);
        }
        return { src: canvas?.scene?.tiles.contents[0]?.texture.src, lights: canvas?.scene?.lights.size };
    });
    expect(after.src).toContain('lamp-unlit.svg');
    expect(after.lights).toBe(0);
});

test('a GM moving the tile moves the stamp and its light', async ({ world }) => {
    await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        await controller?.placeStamp({ stamp: 'zc-e2e-pack:lamp', x: 500, y: 500 });
        await canvas?.scene?.tiles.contents[0]?.update({ x: 800, y: 600 });
    });
    // The update hook re-syncs the stamp's documents asynchronously.
    await expect
        .poll(async () =>
            world.evaluate(() => {
                const light = canvas?.scene?.lights.contents[0];
                return light && { x: light.x, y: light.y };
            }),
        )
        .toEqual({ x: 800, y: 600 });
});
