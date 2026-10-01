// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The tools as a GM uses them: a real mouse on the canvas, through the scene
 * controls. The other specs drive the controller's API, which cannot catch a
 * tool that never receives the pointer.
 */
import type { Page } from '@playwright/test';
import { expect, frameScene, test } from './lib/foundry';
import { activate, clickScene, clientPoint, dragScene, drawShape, holdView, MODULE_ID, type Point, SQUARE, tuckPanels, useTool } from './lib/pointer';

/** Past Foundry's long-press threshold (`MouseInteractionManager.LONG_PRESS_DURATION_MS`, 500). */
const LONG_PRESS_MS = 700;

async function wallCount(page: Page): Promise<number> {
    return page.evaluate(() => canvas?.scene?.walls.size ?? 0);
}

/** The feature under scene point `at`, as the controller sees it. */
async function featureAt(
    page: Page,
    at: Point,
): Promise<{ type: string; halfWidths: readonly number[]; biome: string | null; radius: number | null; texture: string | null } | null> {
    return page.evaluate((point) => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        const id = controller?.hitTest(point) ?? null;
        const feature = id === null ? undefined : controller?.getFeature(id);
        if (!feature) {
            return null;
        }
        return {
            type: feature.type,
            halfWidths: feature.type === 'path' ? feature.halfWidths : [],
            biome: feature.type === 'region' || feature.type === 'stroke' ? feature.biome : null,
            radius: feature.type === 'stroke' ? feature.radius : null,
            texture: feature.type === 'region' || feature.type === 'stroke' ? feature.texture : null,
        };
    }, at);
}

test('the room, door and materials tools sit with the Walls tools, and the stamp tool with the Tiles tools', async ({ world }) => {
    const placed = await world.evaluate(() => {
        const toolsOf = (group: string): string[] => Object.keys(ui.controls?.controls[group]?.tools ?? {});
        return { walls: toolsOf('walls'), tiles: toolsOf('tiles'), own: toolsOf('zephyr-cartography') };
    });
    expect(placed.walls).toEqual(expect.arrayContaining(['wall', 'zephyr-room', 'zephyr-door', 'zephyr-materials', 'zephyr-edit', 'zephyr-erase']));
    expect(placed.tiles).toEqual(expect.arrayContaining(['tile', 'zephyr-stamp', 'zephyr-erase']));
    expect(placed.own).toEqual(expect.arrayContaining(['road', 'river', 'edit', 'erase']));
    expect(placed.own).not.toContain('room');
});

// A redraw re-activates the layer that was active, keeping the tool selected in its group.
test('a tool in a native group stays in hand across a redraw of the scene', async ({ world }) => {
    await useTool(world, 'room');
    await world.evaluate(async () => {
        await canvas?.draw();
    });
    await holdView(world);
    await drawShape(world, SQUARE.slice(0, 3));
    await expect.poll(async () => wallCount(world)).toBe(3);
});

// The module's own group has no canvas layer, so a redraw falls back to Tokens: the draw layer must come back idle.
test('a redraw under a tool of the module group leaves the pointer to Foundry', async ({ world }) => {
    await useTool(world, 'road');
    await world.evaluate(async () => {
        await canvas?.draw();
    });
    const after = await world.evaluate(() => ({ control: ui.controls?.control?.name, layerMode: canvas?.stage?.children.at(-1)?.eventMode }));
    expect(after).toEqual({ control: 'tokens', layerMode: 'none' });
});

// A group the module shares still has Foundry's own tools: with one of those in hand, a redraw must not wake the layer.
test('a redraw under Foundry’s own Walls tool leaves the pointer to Foundry', async ({ world }) => {
    await activate(world, 'walls', 'wall');
    await world.evaluate(async () => {
        await canvas?.draw();
    });
    const after = await world.evaluate(() => ({
        control: ui.controls?.control?.name,
        tool: ui.controls?.tool?.name,
        layerMode: canvas?.stage?.children.at(-1)?.eventMode,
    }));
    expect(after).toEqual({ control: 'walls', tool: 'wall', layerMode: 'none' });
});

// Choosing another texture set rebuilds the draw layer while Foundry's controls stay put.
test('a tool stays in hand when the draw layer rebuilds for another texture set', async ({ world }) => {
    await useTool(world, 'road');
    await world.evaluate(async () => {
        await game.settings?.set('zephyr-cartography', 'textureSet', 'another-set');
    });
    await holdView(world);
    await drawShape(world, [
        { x: 300, y: 1000 },
        { x: 900, y: 1000 },
    ]);
    await expect.poll(async () => (await featureAt(world, { x: 600, y: 1000 }))?.type).toBe('path');
});

test('the Undo and Redo buttons take a drawn room back and bring it back', async ({ world }) => {
    await useTool(world, 'room');
    await holdView(world);
    await drawShape(world, SQUARE);
    await expect.poll(async () => wallCount(world)).toBe(4);
    await activate(world, MODULE_ID, 'road');
    await world.locator('button[data-tool="undo"]').click();
    await expect.poll(async () => wallCount(world)).toBe(0);
    await world.locator('button[data-tool="redo"]').click();
    await expect.poll(async () => wallCount(world)).toBe(4);
});

test('the room tool draws on empty canvas with the real mouse', async ({ world }) => {
    await useTool(world, 'room');
    await holdView(world);
    await drawShape(world, SQUARE.slice(0, 3));
    await expect.poll(async () => wallCount(world)).toBe(3);
});

test('the layer takes the pointer only while one of its tools is active', async ({ world }) => {
    await holdView(world);
    const probe = await clientPoint(world, { x: 1000, y: 750 });
    const ours = async (): Promise<boolean> =>
        world.evaluate(({ x, y }) => {
            // The draw layer is the last child of the stage; is it what a click at (x, y) lands on?
            const layer = canvas?.stage?.children.at(-1);
            let hit = canvas?.app?.renderer.events.rootBoundary.hitTest(x, y) ?? null;
            while (hit && hit !== layer) {
                hit = hit.parent;
            }
            return hit !== null && hit === layer;
        }, probe);
    await useTool(world, 'road');
    expect(await ours()).toBe(true);
    await activate(world, 'walls', 'wall');
    expect(await ours()).toBe(false);
});

test('the paint tool is a round brush in the texture and size picked in its panel: a click leaves a dab, a drag a stroke', async ({ world }) => {
    await useTool(world, 'paint', { panel: true });
    const panel = world.locator(`#${MODULE_ID}-paint`);
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Forest' }).click();
    await expect(panel.getByRole('button', { name: 'Forest' })).toHaveAttribute('aria-pressed', 'true');
    await panel.getByLabel('Brush size (px)').fill('60');
    await panel.getByLabel('Brush size (px)').press('Enter');
    await tuckPanels(world);
    await holdView(world);
    await clickScene(world, { x: 450, y: 450 });
    await dragScene(world, { x: 1000, y: 300 }, [
        { x: 1100, y: 320 },
        { x: 1200, y: 300 },
        { x: 1300, y: 340 },
    ]);
    // The click is a round dab of the brush's size: painted 50 px from where it landed (inside its 60), not 80.
    await expect.poll(async () => featureAt(world, { x: 450, y: 450 })).toMatchObject({ type: 'stroke', biome: 'forest', radius: 60 });
    expect(await featureAt(world, { x: 450, y: 500 })).toMatchObject({ type: 'stroke' });
    expect(await featureAt(world, { x: 450, y: 530 })).toBeNull();
    await expect.poll(async () => featureAt(world, { x: 1100, y: 320 })).toMatchObject({ type: 'stroke', biome: 'forest', radius: 60 });
});

test('the paint tool paints and blends in any texture of the active set, picked in its panel', async ({ world }) => {
    await useTool(world, 'paint', { panel: true });
    const panel = world.locator(`#${MODULE_ID}-paint`);
    await panel.getByRole('button', { name: 'Grassland' }).click();
    await panel.getByText("Texture: The ground's own").click();
    await panel.getByRole('button', { name: 'E2e cobbles' }).click();
    await expect(panel.getByText('Texture: E2e cobbles')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'E2e cobbles' })).toHaveAttribute('aria-pressed', 'true');
    await tuckPanels(world);
    await holdView(world);
    await dragScene(world, { x: 500, y: 500 }, [
        { x: 700, y: 520 },
        { x: 900, y: 500 },
    ]);
    // Grassland ground, drawn in the cobbles.
    await expect.poll(async () => featureAt(world, { x: 700, y: 510 })).toMatchObject({ type: 'stroke', biome: 'grassland', texture: 'floor.e2e-cobbles' });
    const drawnIn = await world.evaluate(() => {
        const terrain = canvas?.primary?.children.find((child) => child.name === 'zephyr-cartography-terrain');
        return (terrain instanceof PIXI.Container ? terrain.children : []).flatMap((child) =>
            child instanceof PIXI.Container ? child.children.flatMap((grandchild) => (grandchild instanceof PIXI.TilingSprite ? [grandchild.name] : [])) : [],
        );
    });
    expect(drawnIn).toEqual([expect.stringContaining('cobbles.svg')]);
    // Blending lays the same texture into the level's splat map. The panel comes back from where it was tucked.
    await world.evaluate(async (id) => {
        const app = foundry.applications.instances.get(id);
        await app?.maximize();
        app?.setPosition({ left: 100, top: 100 });
    }, `${MODULE_ID}-paint`);
    await panel.getByLabel('Brush', { exact: true }).selectOption('blend');
    await tuckPanels(world);
    await clickScene(world, { x: 1200, y: 900 });
    await expect
        .poll(async () => world.evaluate(() => game.modules?.get('zephyr-cartography').api.controller()?.splatLayer()?.roles ?? []))
        .toContain('floor.e2e-cobbles');
});

test('the paint brush shows its size on the map, and paints as it is dragged, before the stroke ends', async ({ world }) => {
    await useTool(world, 'paint', { panel: true });
    const panel = world.locator(`#${MODULE_ID}-paint`);
    await panel.getByLabel('Brush size (px)').fill('80');
    await panel.getByLabel('Brush size (px)').press('Enter');
    await tuckPanels(world);
    await holdView(world);
    // What the canvas shows: the terrain's textured fills, and the brush outline, last on the module's layer above it all.
    const shown = async (): Promise<{ textured: number; ring: { width: number; visible: boolean } | null; committed: boolean }> =>
        world.evaluate(() => {
            const layer = canvas?.stage?.children.at(-1);
            const drawn: readonly PIXI.DisplayObject[] = layer instanceof PIXI.Container ? layer.children : [];
            const last = drawn.at(-1);
            const ring = last instanceof PIXI.Graphics ? { width: last.getLocalBounds().width, visible: last.visible } : null;
            const terrain = canvas?.primary?.children.find((child) => child.name === 'zephyr-cartography-terrain');
            const textured = (terrain instanceof PIXI.Container ? terrain.children : []).filter(
                (child) => child instanceof PIXI.Container && child.children.some((grandchild) => grandchild instanceof PIXI.TilingSprite),
            ).length;
            // A committed stroke is a feature the controller can pick; the one being painted is not yet.
            const committed = (game.modules?.get('zephyr-cartography').api.controller()?.hitTest({ x: 800, y: 810 }) ?? null) !== null;
            return { textured, ring, committed };
        });
    const start = await clientPoint(world, { x: 600, y: 800 });
    await world.mouse.move(start.x, start.y);
    // The outline is the brush's diameter across, give or take its line.
    const hovering = await shown();
    expect(hovering.ring?.visible).toBe(true);
    expect(hovering.ring?.width).toBeGreaterThan(160);
    expect(hovering.ring?.width).toBeLessThan(170);
    await world.mouse.down();
    const midway = await clientPoint(world, { x: 1000, y: 820 });
    await world.mouse.move(midway.x, midway.y, { steps: 6 });
    // Mid-drag: the ground is already painted in its texture, and nothing is committed yet.
    const painting = await shown();
    expect(painting.committed).toBe(false);
    expect(painting.textured).toBeGreaterThan(0);
    await world.mouse.up();
    await expect.poll(async () => (await shown()).committed).toBe(true);
});

test('the paint tool blends texture into the level’s splat map, saved as an exact mask and undone as one stroke', async ({ world }) => {
    await useTool(world, 'paint', { panel: true });
    const panel = world.locator(`#${MODULE_ID}-paint`);
    await panel.getByLabel('Brush', { exact: true }).selectOption('blend');
    await panel.getByRole('button', { name: 'Sand' }).click();
    await panel.getByLabel('Brush size (px)').fill('150');
    await panel.getByLabel('Brush size (px)').press('Enter');
    await panel.getByLabel('Strength (0.05–1)').fill('1');
    await panel.getByLabel('Strength (0.05–1)').press('Enter');
    await tuckPanels(world);
    await holdView(world);
    await dragScene(world, { x: 500, y: 700 }, [
        { x: 800, y: 720 },
        { x: 1100, y: 700 },
        { x: 1400, y: 740 },
    ]);
    // The stroke is saved as it ends: the layer on the scene, the mask in the world's data.
    const saved = async (): Promise<{ roles: readonly (string | null)[]; weight: number } | null> =>
        world.evaluate(async () => {
            const layer = game.modules?.get('zephyr-cartography').api.controller()?.splatLayer();
            if (!layer) {
                return null;
            }
            const response = await fetch(layer.path, { cache: 'no-store' });
            // The upload may still be on its way.
            if (!response.ok || response.headers.get('content-type') !== 'image/png') {
                return null;
            }
            const bytes = new Uint8Array(await response.arrayBuffer());
            // Read the saved PNG back with the browser's own decoder: the red channel of the pixel under the stroke's middle.
            // Through WebGL, unpremultiplied: a 2D canvas would zero every channel where the unused fourth one (alpha) is 0.
            // A file caught mid-upload does not decode yet.
            const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).catch(
                () => null,
            );
            const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
            if (!gl || !bitmap) {
                return null;
            }
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
            gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            const scale = bitmap.width / layer.bounds.width;
            const pixel = new Uint8Array(4);
            gl.readPixels(Math.floor((1100 - layer.bounds.x) * scale), Math.floor((700 - layer.bounds.y) * scale), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            return { roles: layer.roles, weight: pixel[0] ?? -1 };
        });
    await expect.poll(saved).toMatchObject({ roles: ['sand', null, null, null] });
    expect((await saved())?.weight).toBeGreaterThan(150);
    await frameScene(world);
    await expect(world.locator('#board')).toHaveScreenshot('sand-blend.png');

    // The stroke made the map, so undoing it takes the map away.
    await world.evaluate(async () => game.modules?.get('zephyr-cartography').api.controller()?.undo());
    await expect.poll(async () => world.evaluate(() => game.modules?.get('zephyr-cartography').api.controller()?.splatState())).toBe('none');
});

test('the river tool draws the liquid, shade, bed and width picked in its panel', async ({ world }) => {
    await useTool(world, 'river', { panel: true });
    const panel = world.locator(`#${MODULE_ID}-paths`);
    await expect(panel).toBeVisible();
    await panel.getByLabel('Liquid').selectOption('lava');
    // A new liquid starts from its own shade and bed.
    await expect(panel.getByLabel('Shade')).toHaveValue('#ff5a1e');
    await expect(panel.getByLabel('Bed')).toHaveValue('rock');
    await panel.getByLabel('Bed').selectOption('sand');
    await panel.getByLabel('Width (px)').fill('80');
    await panel.getByLabel('Width (px)').press('Enter');
    await tuckPanels(world);
    await holdView(world);
    await drawShape(world, [
        { x: 300, y: 600 },
        { x: 900, y: 650 },
        { x: 1500, y: 600 },
    ]);
    await expect
        .poll(async () =>
            world.evaluate(() => {
                const controller = game.modules?.get('zephyr-cartography').api.controller();
                const id = controller?.hitTest({ x: 900, y: 650 }) ?? null;
                const river = id === null ? null : controller?.getFeature(id);
                return river?.type === 'path' ? { river: river.river, halfWidth: river.halfWidths[1] } : null;
            }),
        )
        .toEqual({ river: { liquid: 'lava', shade: 0xff5a1e, bed: 'sand' }, halfWidth: 40 });
    await frameScene(world);
    await expect(world.locator('#board')).toHaveScreenshot('lava-river-on-sand.png');
});

test('the edit tool drags a room corner, and right-click deletes one', async ({ world }) => {
    await useTool(world, 'room');
    await holdView(world);
    await drawShape(world, SQUARE);
    await expect.poll(async () => wallCount(world)).toBe(4);
    await useTool(world, 'edit');
    await dragScene(world, { x: 600, y: 600 }, [{ x: 700, y: 700 }]);
    const corners = async (): Promise<boolean> =>
        world.evaluate(() => (canvas?.scene?.walls.contents ?? []).some((wall) => wall.c[0] === 700 && wall.c[1] === 700));
    await expect.poll(corners).toBe(true);
    await clickScene(world, { x: 700, y: 700 }, 'right');
    await expect.poll(async () => wallCount(world)).toBe(3);
});

// A GM who holds the press before dragging makes a Shift long-press, which Foundry would turn into a ping that pulls
// every view to the point, mid-drag. The tool's press must be the tool's alone.
test('the edit tool sets a road width by Shift-dragging a point, however long the press', async ({ world }) => {
    await useTool(world, 'road');
    await holdView(world);
    await drawShape(world, [
        { x: 300, y: 1000 },
        { x: 900, y: 1000 },
    ]);
    await expect.poll(async () => (await featureAt(world, { x: 600, y: 1000 }))?.type).toBe('path');
    await useTool(world, 'edit');
    await dragScene(world, { x: 900, y: 1000 }, [{ x: 900, y: 1080 }], { shift: true, holdMs: LONG_PRESS_MS });
    // The pointer maps back from a zoomed view, so the width is 80 to within float error.
    await expect.poll(async () => Math.round((await featureAt(world, { x: 600, y: 1000 }))?.halfWidths[1] ?? 0)).toBe(80);
});

test('the door tool makes a room wall a door, then opens its panel', async ({ world }) => {
    await useTool(world, 'room');
    await holdView(world);
    await drawShape(world, SQUARE);
    await useTool(world, 'door');
    await clickScene(world, { x: 450, y: 300 });
    await expect.poll(async () => world.evaluate(() => (canvas?.scene?.walls.contents ?? []).filter((wall) => wall.door === 1).length)).toBe(1);
    await clickScene(world, { x: 450, y: 300 });
    await expect(world.locator(`#${MODULE_ID}-door`)).toBeVisible();
});

test('the materials tool opens a room’s materials, and the erase tool removes the room', async ({ world }) => {
    await useTool(world, 'room');
    await holdView(world);
    await drawShape(world, SQUARE);
    await expect.poll(async () => wallCount(world)).toBe(4);
    await useTool(world, 'materials');
    await clickScene(world, { x: 450, y: 450 });
    await expect(world.locator(`#${MODULE_ID}-materials`)).toBeVisible();
    await useTool(world, 'erase');
    await clickScene(world, { x: 450, y: 450 });
    await expect.poll(async () => wallCount(world)).toBe(0);
});

test('the effects tool, with the Regions tools, gives a room difficult ground and region behaviours on a native region', async ({ world }) => {
    await useTool(world, 'room');
    await holdView(world);
    await drawShape(world, SQUARE);
    await expect.poll(async () => wallCount(world)).toBe(4);
    await useTool(world, 'effects');
    await clickScene(world, { x: 450, y: 450 });
    const panel = world.locator(`#${MODULE_ID}-effects`);
    await expect(panel).toBeVisible();
    await panel.getByLabel('Movement cost (×)').fill('2');
    await panel.getByLabel('Movement cost (×)').press('Enter');
    // Foundry's own name for the behaviour type.
    await panel.getByLabel('New behaviour').selectOption({ label: 'Adjust Darkness Level' });
    await panel.getByRole('button', { name: 'Add behaviour' }).click();
    await panel.getByLabel('Mode', { exact: true }).selectOption({ label: 'Darken' });
    // The darkness behaviour's mode is Foundry's DARKEN (2).
    const behaviours = async (): Promise<{ type: string; mode: number | null }[]> =>
        world.evaluate(() =>
            (canvas?.scene?.regions.contents.find((region) => region.name === 'Room')?.behaviors.contents ?? []).map((behaviour) => ({
                type: behaviour.type,
                mode: behaviour.type === 'adjustDarknessLevel' ? Number(behaviour.system.mode) : null,
            })),
        );
    await expect.poll(behaviours).toEqual([
        { type: 'modifyMovementCost', mode: null },
        { type: 'adjustDarknessLevel', mode: 2 },
    ]);
});

test('a zone offers to move with the tokens Foundry locates on its own level', async ({ world }) => {
    await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        const ground = (await controller?.addLevel('above', 'Ground')) ?? '';
        const upper = (await controller?.addLevel('above', 'Upper')) ?? '';
        await canvas?.scene?.createEmbeddedDocuments('Token', [
            { name: 'Gun drone', x: 1200, y: 1200, level: ground },
            { name: 'Gargoyle', x: 1400, y: 1200, level: upper },
        ]);
        controller?.setActiveLevel(ground);
    });
    await useTool(world, 'zone');
    await holdView(world);
    await clickScene(world, { x: 700, y: 500 });
    const panel = world.locator(`#${MODULE_ID}-zone`);
    await expect(panel).toBeVisible();
    const choices = panel.getByLabel('Attached Token').locator('option');
    // "None", then only the ground's token.
    await expect(choices).toHaveText([/.+/u, 'Gun drone']);
});

test('the zone tool, with the Regions tools, places a native Region in Foundry’s own shape, and erase removes it', async ({ world }) => {
    await useTool(world, 'zone');
    await holdView(world);
    await clickScene(world, { x: 700, y: 500 });
    const panel = world.locator(`#${MODULE_ID}-zone`);
    await expect(panel).toBeVisible();
    // Named as Foundry's own shape strings name them.
    await panel.getByLabel('Type').selectOption({ label: 'Cone' });
    await panel.getByLabel('Radius').fill('200');
    await panel.getByLabel('Radius').press('Enter');
    await panel.getByLabel('Name', { exact: true }).fill('Fuel wash');
    await panel.getByLabel('Name', { exact: true }).press('Enter');
    const zones = async (): Promise<{ name: string; shapes: { type: string; x: number; y: number; radius: number | null }[] }[]> =>
        world.evaluate(() =>
            (canvas?.scene?.regions.contents ?? []).map((region) => ({
                name: region.name,
                shapes: region.shapes.map((shape) => ({
                    type: shape.type,
                    // The click lands a hair off the whole pixel through the canvas transform.
                    x: 'x' in shape ? Math.round(shape.x) : Number.NaN,
                    y: 'y' in shape ? Math.round(shape.y) : Number.NaN,
                    radius: 'radius' in shape ? shape.radius : null,
                })),
            })),
        );
    await expect.poll(zones).toEqual([{ name: 'Fuel wash', shapes: [{ type: 'cone', x: 700, y: 500, radius: 200 }] }]);

    await useTool(world, 'erase');
    // Inside the cone, below where its tucked-away panel's title bar sits.
    await clickScene(world, { x: 800, y: 560 });
    await expect.poll(zones).toEqual([]);
});

test('a zone saved as a hazard preset gives another zone its shape and behaviours', async ({ world }) => {
    await useTool(world, 'zone');
    await holdView(world);
    await clickScene(world, { x: 400, y: 400 });
    const panel = world.locator(`#${MODULE_ID}-zone`);
    await panel.getByLabel('Type').selectOption({ label: 'Ring' });
    await panel.getByLabel('Preset name').fill('Cordon');
    await panel.getByLabel('Preset name').press('Enter');
    await panel.getByRole('button', { name: 'Save this zone as a preset' }).click();
    await expect(panel.getByLabel('Preset', { exact: true })).toHaveValue('Cordon');

    // A second zone, clear of the first and of the open panel, takes the preset.
    await clickScene(world, { x: 100, y: 800 });
    await panel.getByRole('button', { name: 'Apply to this zone' }).click();
    const shapes = async (): Promise<string[][]> =>
        world.evaluate(() => (canvas?.scene?.regions.contents ?? []).map((region) => region.shapes.map((shape) => `${region.name}:${shape.type}`)));
    await expect.poll(shapes).toEqual([['Zone:ring'], ['Cordon:ring']]);
});

test('the pin tool, with the Notes tools, places a native Note that opens a journal page, and erase removes it', async ({ world }) => {
    const journal = await world.evaluate(async () => {
        const entry = await JournalEntry.create({ name: 'The Sump', pages: [{ name: 'The bar', type: 'text' }] });
        return { entry: entry?.id ?? '', page: entry?.pages.contents[0]?.id ?? '' };
    });
    await useTool(world, 'pin');
    await holdView(world);
    await clickScene(world, { x: 700, y: 500 });
    const panel = world.locator(`#${MODULE_ID}-pin`);
    await expect(panel).toBeVisible();
    // Named as Foundry's own Note sheet names them.
    await panel.getByLabel('Text Label').fill('The Sump');
    await panel.getByLabel('Text Label').press('Enter');
    await panel.getByLabel('Journal Entry').selectOption({ label: 'The Sump' });
    await panel.getByLabel('Page').selectOption({ label: 'The bar' });
    await panel.getByLabel('Globally Visible').check();
    const notes = async (): Promise<{ x: number; y: number; text: string; entry: string | null; page: string | null; global: boolean }[]> =>
        world.evaluate(() =>
            (canvas?.scene?.notes.contents ?? []).map((note) => ({
                x: note.x,
                y: note.y,
                text: note.text ?? '',
                entry: note.entryId ?? null,
                page: note.pageId ?? null,
                global: note.global,
            })),
        );
    await expect.poll(notes).toEqual([{ x: 700, y: 500, text: 'The Sump', entry: journal.entry, page: journal.page, global: true }]);

    await useTool(world, 'erase');
    await clickScene(world, { x: 700, y: 500 });
    await expect.poll(notes).toEqual([]);
});

test('the label tool, with the Drawings tools, places a native text Drawing centred where the GM clicks, and erase removes it', async ({ world }) => {
    await useTool(world, 'label');
    await holdView(world);
    await clickScene(world, { x: 800, y: 600 });
    const panel = world.locator(`#${MODULE_ID}-label`);
    await expect(panel).toBeVisible();
    // Named as Foundry's own Drawing sheet names them.
    await panel.getByLabel('Text Label').fill('Residence District 4');
    await panel.getByLabel('Text Label').blur();
    await panel.getByLabel('Font Size').fill('64');
    await panel.getByLabel('Font Size').press('Enter');
    const drawings = async (): Promise<{ text: string; fontSize: number; centre: { x: number; y: number }; fill: number; stroke: number }[]> =>
        world.evaluate(() =>
            (canvas?.scene?.drawings.contents ?? []).map((drawing) => ({
                text: drawing.text ?? '',
                fontSize: drawing.fontSize,
                centre: { x: drawing.x + (drawing.shape.width ?? 0) / 2, y: drawing.y + (drawing.shape.height ?? 0) / 2 },
                fill: drawing.fillType,
                stroke: drawing.strokeWidth,
            })),
        );
    // Text only: CONST.DRAWING_FILL_TYPES.NONE, and no line.
    await expect.poll(drawings).toEqual([{ text: 'Residence District 4', fontSize: 64, centre: { x: 800, y: 600 }, fill: 0, stroke: 0 }]);

    await useTool(world, 'erase');
    await clickScene(world, { x: 800, y: 600 });
    await expect.poll(drawings).toEqual([]);
});

test('the stamp tool places the stamp armed in the browser where the GM clicks', async ({ world }) => {
    await useTool(world, 'stamp');
    await holdView(world);
    const card = world.locator(`#${MODULE_ID}-stamp-browser [data-stamp-key="zc-e2e-pack:crate"]`);
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    // Tuck the browser away, as a GM would, so the click lands on the canvas; the stamp stays armed.
    await world.evaluate(async (id) => {
        await foundry.applications.instances.get(id)?.minimize();
    }, `${MODULE_ID}-stamp-browser`);
    await clickScene(world, { x: 350, y: 350 });
    await expect
        .poll(async () =>
            world.evaluate(() => {
                const tile = canvas?.scene?.tiles.contents[0];
                return tile ? { x: tile.x, y: tile.y } : null;
            }),
        )
        .toEqual({ x: 350, y: 350 });
});

test('the link tool, with the Lighting tools, picks a switch and links a lamp and a plain light to it', async ({ world }) => {
    const ids = await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        const switchId = (await controller?.placeStamp({ stamp: 'zc-e2e-pack:switch', x: 300, y: 300 })) ?? '';
        const lampId = (await controller?.placeStamp({ stamp: 'zc-e2e-pack:lamp', x: 700, y: 300 })) ?? '';
        const [plain] = (await canvas?.scene?.createEmbeddedDocuments('AmbientLight', [{ x: 1000, y: 600, config: { dim: 10, bright: 5 } }])) ?? [];
        return { switchId, lampId, plainId: plain?.id ?? '' };
    });
    await useTool(world, 'link');
    await holdView(world);
    await clickScene(world, { x: 300, y: 300 });
    await clickScene(world, { x: 700, y: 300 });
    await clickScene(world, { x: 1000, y: 600 });
    const targets = async (): Promise<readonly { kind: string; id: string }[]> =>
        world.evaluate((id) => game.modules?.get('zephyr-cartography').api.controller()?.switchTargets(id) ?? [], ids.switchId);
    await expect.poll(targets).toEqual([
        { kind: 'feature', id: ids.lampId },
        { kind: 'light', id: ids.plainId },
    ]);
    // Clicking a linked target again unlinks it.
    await clickScene(world, { x: 700, y: 300 });
    await expect.poll(targets).toEqual([{ kind: 'light', id: ids.plainId }]);
});
