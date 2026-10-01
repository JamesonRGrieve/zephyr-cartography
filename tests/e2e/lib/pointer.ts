// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The GM's hands, for the specs that use the plugin as a GM does: a real
 * mouse on the canvas, and tools picked through Foundry's scene controls.
 */
import type { Page } from '@playwright/test';

export type Point = { readonly x: number; readonly y: number };

export const MODULE_ID = 'zephyr-cartography';

/** Hold the view still (the canvas otherwise settles after load), so scene points stay where the mouse is sent. */
export async function holdView(page: Page): Promise<void> {
    await page.evaluate(async () => {
        await canvas?.animatePan({ x: 1000, y: 750, scale: 0.5, duration: 0 });
    });
}

/** Where scene point `at` is in the viewport, for a real mouse. */
export async function clientPoint(page: Page, at: Point): Promise<Point> {
    return page.evaluate((scenePoint) => {
        const point = canvas?.clientCoordinatesFromCanvas(scenePoint);
        return { x: point?.x ?? 0, y: point?.y ?? 0 };
    }, at);
}

export async function clickScene(page: Page, at: Point, button: 'left' | 'right' = 'left'): Promise<void> {
    const client = await clientPoint(page, at);
    await page.mouse.click(client.x, client.y, { button });
}

/** Press at `from`, move through `path`, release at the last point; with Shift held, and the press held first, if asked. */
export async function dragScene(page: Page, from: Point, path: readonly Point[], options: { shift?: boolean; holdMs?: number } = {}): Promise<void> {
    const shift = options.shift === true;
    if (shift) {
        await page.keyboard.down('Shift');
    }
    const start = await clientPoint(page, from);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    if (options.holdMs !== undefined) {
        await page.waitForTimeout(options.holdMs);
    }
    for (const at of path) {
        // eslint-disable-next-line no-await-in-loop -- a drag is sequential by nature
        const next = await clientPoint(page, at);
        // eslint-disable-next-line no-await-in-loop -- see above
        await page.mouse.move(next.x, next.y, { steps: 4 });
    }
    await page.mouse.up();
    if (shift) {
        await page.keyboard.up('Shift');
    }
}

/** Where a module tool sits among Foundry's groups; any other is in the module's own group. */
const NATIVE_HOME: Readonly<Record<string, string>> = {
    room: 'walls',
    door: 'walls',
    materials: 'walls',
    stamp: 'tiles',
    link: 'lighting',
    effects: 'regions',
    pin: 'notes',
    label: 'drawings',
    zone: 'regions',
};

export async function activate(page: Page, control: string, tool: string): Promise<void> {
    await page.evaluate(
        async ({ group, toolName }) => {
            await ui.controls?.activate({ control: group, tool: toolName });
        },
        { group: control, toolName: tool },
    );
}

/** The panels tools open when picked. */
const TOOL_PANELS = ['paint', 'paths', 'pin', 'label', 'zone'] as const;

/** Width (px) given each tucked panel's title bar along the bottom of the screen. */
const TUCKED_WIDTH = 210;

/** How far (px) above the bottom edge the tucked title bars sit: two bars' height, clear of the hotbar's top. */
const TUCKED_RISE = 72;

/**
 * Tuck the tool panels away, as a GM would, so clicks land on the canvas:
 * minimized, and moved to the bottom edge, since a minimized panel's title bar
 * still covers the canvas where it was. The choices made in them stand.
 */
export async function tuckPanels(page: Page): Promise<void> {
    await page.evaluate(
        async ({ ids, width, rise }) => {
            await Promise.all(
                ids.map(async (id, i) => {
                    const app = foundry.applications.instances.get(id);
                    await app?.minimize();
                    app?.setPosition({ left: i * width, top: innerHeight - rise });
                }),
            );
        },
        { ids: TOOL_PANELS.map((panel) => `${MODULE_ID}-${panel}`), width: TUCKED_WIDTH, rise: TUCKED_RISE },
    );
}

/**
 * Pick module tool `tool` from wherever it sits: rooms and doors with the
 * Walls tools, stamps with the Tiles tools. A panel the tool opens is tucked
 * away unless the test is to use it.
 */
export async function useTool(page: Page, tool: string, options: { panel?: boolean } = {}): Promise<void> {
    const home = NATIVE_HOME[tool];
    await (home === undefined ? activate(page, MODULE_ID, tool) : activate(page, home, `zephyr-${tool}`));
    if (options.panel !== true) {
        await tuckPanels(page);
    }
}

/** Click each point, then right-click to finish the shape. */
export async function drawShape(page: Page, points: readonly Point[]): Promise<void> {
    for (const at of points) {
        // eslint-disable-next-line no-await-in-loop -- clicks are sequential by nature
        await clickScene(page, at);
    }
    await clickScene(page, points[0] ?? { x: 0, y: 0 }, 'right');
}

export const SQUARE: readonly Point[] = [
    { x: 300, y: 300 },
    { x: 600, y: 300 },
    { x: 600, y: 600 },
    { x: 300, y: 600 },
];
