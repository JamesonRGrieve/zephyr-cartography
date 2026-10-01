// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The panels by keyboard alone: every control reachable by Tab in reading
 * order, a value committed with Enter that leaves focus where it was though
 * the panel redraws, a value the panel refuses that goes back to what it was,
 * a checkbox toggled with Space, and a closed section opened with Enter.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './lib/foundry';
import { clickScene, holdView, useTool } from './lib/pointer';
import { panelSelector, tabOrder } from './lib/ux';

/** Where the tests place their zone. */
const ZONE_AT = { x: 1000, y: 700 } as const;

/** Place a zone with its tool, which opens its panel; its feature id. */
async function openZone(page: Page): Promise<string> {
    await useTool(page, 'zone', { panel: true });
    await holdView(page);
    await clickScene(page, ZONE_AT);
    await expect(page.locator(panelSelector('zone'))).toBeVisible();
    return page.evaluate((at) => game.modules?.get('zephyr-cartography').api.controller()?.hitTest(at) ?? '', ZONE_AT);
}

/** The focus key of the control that has focus, or null. */
async function focused(page: Page): Promise<string | null> {
    return page.evaluate(() => document.activeElement?.getAttribute('data-zc-focus') ?? null);
}

async function zoneRadius(page: Page, zoneId: string): Promise<number | null> {
    return page.evaluate((id) => {
        const settings = game.modules?.get('zephyr-cartography').api.controller()?.zoneSettings(id);
        return settings && 'radius' in settings.shape ? settings.shape.radius : null;
    }, zoneId);
}

test('Tab reaches every control of a panel, top to bottom', async ({ world }) => {
    await openZone(world);
    const reachable = await world.evaluate(
        (selector) =>
            [...document.querySelectorAll(`${selector} .window-content :is(input, select, textarea, button)`)].filter(
                (node) =>
                    node instanceof HTMLElement &&
                    node.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }) &&
                    !(node instanceof HTMLButtonElement && node.disabled),
            ).length,
        panelSelector('zone'),
    );
    const order = await tabOrder(world, 'zone');
    expect(order.length).toBe(reachable);
    // Reading order: the name comes first, the presets last.
    expect(order[0]).toMatch(/name/iu);
});

test('a value committed with Enter applies, and focus stays in its field though the panel redraws', async ({ world }) => {
    const zoneId = await openZone(world);
    const radius = world.locator(panelSelector('zone')).getByLabel('Radius');
    await radius.focus();
    const key = await focused(world);
    await radius.fill('250');
    await radius.press('Enter');
    await expect.poll(async () => zoneRadius(world, zoneId)).toBe(250);
    expect(await focused(world)).toBe(key);
});

test('a value the panel refuses goes back to what it was, and changes nothing', async ({ world }) => {
    const zoneId = await openZone(world);
    const radius = world.locator(panelSelector('zone')).getByLabel('Radius');
    const before = await radius.inputValue();
    await radius.fill('-5');
    await radius.press('Enter');
    await expect(radius).toHaveValue(before);
    expect(await zoneRadius(world, zoneId)).toBe(Number(before));
});

test('Space toggles a checkbox', async ({ world }) => {
    const zoneId = await openZone(world);
    const gridBased = world.locator(panelSelector('zone')).getByLabel('Is Grid-Based');
    await gridBased.focus();
    await world.keyboard.press('Space');
    await expect
        .poll(async () => world.evaluate((id) => game.modules?.get('zephyr-cartography').api.controller()?.zoneSettings(id)?.gridBased, zoneId))
        .toBe(true);
    await expect(world.locator(panelSelector('zone')).getByLabel('Is Grid-Based')).toBeChecked();
});

test('a closed section opens with Enter, and stays open while its fields are edited', async ({ world }) => {
    await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.controller()?.addLevel('above', 'Ground');
    });
    await useTool(world, 'road');
    await world.click('button[data-tool="levels"]');
    const panel = world.locator(panelSelector('levels'));
    const look = panel.locator('summary').first();
    await look.focus();
    await world.keyboard.press('Enter');
    const scaleX = panel.getByLabel('Scale X').first();
    await expect(scaleX).toBeVisible();
    await scaleX.fill('2');
    await scaleX.press('Enter');
    // The edit redraws the panel; the section the GM opened is still open.
    await expect(panel.getByLabel('Scale X').first()).toHaveValue('2');
    await expect(panel.getByLabel('Scale X').first()).toBeVisible();
});
