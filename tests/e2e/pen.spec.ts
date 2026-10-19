// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The pen, as a GM draws a river with it: clicks drop anchors, a press dragged
 * out curves the path through its anchor, Backspace takes the last anchor
 * back, Enter finishes and Escape throws the path away. Then the edit tool
 * reshapes it: a handle dragged, an anchor added on the path and removed again
 * with Delete, widths and handles kept one per point throughout.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './lib/foundry';
import { clickScene, dragScene, holdView, type Point, useTool } from './lib/pointer';

interface DrawnPath {
    readonly id: string;
    readonly points: readonly Point[];
    readonly handles: readonly (Point | null)[];
    readonly halfWidths: readonly number[];
}

/** Round a scene point (the pointer maps back from a zoomed view, so to within float error). */
const rounded = (p: Point | null): Point | null => (p === null ? null : { x: Math.round(p.x), y: Math.round(p.y) });

/** Every road and river on the scene, as the controller holds them, rounded. */
async function paths(page: Page): Promise<DrawnPath[]> {
    const drawn = await page.evaluate(() =>
        (canvas?.scene?.getFlag('zephyr-cartography', 'features') ?? []).flatMap((feature) =>
            feature.type === 'path' ? [{ id: feature.id, points: feature.points, handles: feature.handles, halfWidths: feature.halfWidths }] : [],
        ),
    );
    return drawn.map((path) => ({
        ...path,
        points: path.points.map((p) => rounded(p) ?? p),
        handles: path.handles.map(rounded),
    }));
}

/** A point on the drawn path `id`, `share` of the way along its centreline. */
async function onPath(page: Page, id: string, share: number): Promise<Point> {
    return page.evaluate(
        ({ pathId, along }) => {
            const spine = game.modules?.get('zephyr-cartography').api.controller()?.pathOverlay(pathId, null)?.spine ?? [];
            return spine[Math.round((spine.length - 1) * along)] ?? { x: 0, y: 0 };
        },
        { pathId: id, along: share },
    );
}

test('the river tool is a pen: click, drag to curve, Backspace to take back, Enter to finish', async ({ world }) => {
    await useTool(world, 'river');
    await holdView(world);
    await clickScene(world, { x: 300, y: 600 });
    // Pressed at the second anchor and dragged: its handle follows the pointer.
    await dragScene(world, { x: 800, y: 700 }, [{ x: 900, y: 550 }]);
    await clickScene(world, { x: 1200, y: 300 });
    await world.keyboard.press('Backspace');
    await clickScene(world, { x: 1400, y: 650 });
    await world.keyboard.press('Enter');
    await expect.poll(async () => (await paths(world)).length).toBe(1);
    const [river] = await paths(world);
    expect(river?.points).toEqual([
        { x: 300, y: 600 },
        { x: 800, y: 700 },
        { x: 1400, y: 650 },
    ]);
    expect(river?.handles).toEqual([null, { x: 100, y: -150 }, null]);
    expect(river?.halfWidths).toHaveLength(3);
});

test('Escape throws away the path being drawn, and a click on the last anchor finishes one', async ({ world }) => {
    await useTool(world, 'river');
    await holdView(world);
    await clickScene(world, { x: 300, y: 400 });
    await clickScene(world, { x: 700, y: 400 });
    await world.keyboard.press('Escape');
    await clickScene(world, { x: 300, y: 900 });
    await clickScene(world, { x: 900, y: 900 });
    await clickScene(world, { x: 900, y: 900 });
    await expect
        .poll(async () => (await paths(world)).map((path) => path.points))
        .toEqual([
            [
                { x: 300, y: 900 },
                { x: 900, y: 900 },
            ],
        ]);
});

test('the edit tool reshapes a river: a handle dragged, an anchor added on the path and deleted again', async ({ world }) => {
    await useTool(world, 'river');
    await holdView(world);
    await clickScene(world, { x: 300, y: 600 });
    await dragScene(world, { x: 800, y: 700 }, [{ x: 900, y: 550 }]);
    await clickScene(world, { x: 1400, y: 650 });
    await world.keyboard.press('Enter');
    await expect.poll(async () => (await paths(world)).length).toBe(1);

    await useTool(world, 'edit');
    // Picking its first anchor picks the river, and shows the handles of its shaped anchor.
    await clickScene(world, { x: 300, y: 600 });
    await dragScene(world, { x: 900, y: 550 }, [{ x: 800, y: 500 }]);
    await expect.poll(async () => (await paths(world))[0]?.handles).toEqual([null, { x: 0, y: -200 }, null]);

    const id = (await paths(world))[0]?.id ?? '';
    await clickScene(world, await onPath(world, id, 0.75));
    await expect.poll(async () => (await paths(world))[0]?.points.length).toBe(4);
    const inserted = (await paths(world))[0];
    expect([inserted?.halfWidths.length, inserted?.handles.length]).toEqual([4, 4]);

    // The anchor just added is the picked one: Delete removes it.
    await world.keyboard.press('Delete');
    await expect.poll(async () => (await paths(world))[0]?.points.length).toBe(3);
    const after = (await paths(world))[0];
    expect([after?.halfWidths.length, after?.handles.length]).toEqual([3, 3]);
});
