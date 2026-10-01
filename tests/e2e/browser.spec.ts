// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The stamp browser as a GM uses it: searching, filtering by scale, view,
 * category and tag, and rotating a stamp before placing it.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './lib/foundry';

const BROWSER = '#zephyr-cartography-stamp-browser';

/** Stamps in the e2e pack (tests/e2e/fixtures/pack/zephyr-pack.json). */
const FIXTURE_STAMPS = 35;

async function openBrowser(page: Page): Promise<Locator> {
    await page.evaluate(async () => {
        await ui.controls?.activate({ control: 'tiles', tool: 'zephyr-stamp' });
    });
    const browser = page.locator(BROWSER);
    await expect(browser).toBeVisible();
    return browser;
}

/** The stamps the grid shows (their ids within the e2e pack), in order. */
async function shown(browser: Locator): Promise<string[]> {
    return browser
        .locator('[data-stamp-key]')
        .evaluateAll((cards) => cards.map((card) => (card.getAttribute('data-stamp-key') ?? '').replace('zc-e2e-pack:', '')));
}

test('the browser narrows its stamps by search, scale and view', async ({ world }) => {
    const browser = await openBrowser(world);
    await expect.poll(async () => (await shown(browser)).length).toBe(FIXTURE_STAMPS);

    await browser.getByLabel('Search stamps').fill('cra');
    await expect.poll(async () => shown(browser)).toEqual(['crate']);
    await browser.getByLabel('Search stamps').fill('');

    await browser.getByLabel('Scale').selectOption('city');
    await expect.poll(async () => shown(browser)).toEqual(['residence']);
    await browser.getByLabel('Scale').selectOption('');

    await browser.getByLabel('Perspective').selectOption('isometric');
    await expect(browser.getByText('No stamps match these filters.')).toBeVisible();
    await browser.getByLabel('Perspective').selectOption('');
    await expect.poll(async () => (await shown(browser)).length).toBe(FIXTURE_STAMPS);
});

// A category lists only the tags at least two of its stamps share: both Storage stamps are "loot".
test('the browser picks a category tag, and drops it by its chip or by clearing', async ({ world }) => {
    const browser = await openBrowser(world);
    await browser.getByRole('button', { name: 'Storage (2)' }).click();
    await expect.poll(async () => (await shown(browser)).sort()).toEqual(['chest', 'crate']);
    const chip = browser.getByRole('button', { name: 'loot ×' });

    await browser.getByRole('button', { name: 'loot (2)' }).click();
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(chip).toBeHidden();

    await browser.getByRole('button', { name: 'loot (2)' }).click();
    await expect(chip).toBeVisible();
    await browser.getByRole('button', { name: 'Clear tags' }).click();
    await expect(chip).toBeHidden();

    await browser.getByRole('button', { name: /^All/u }).click();
    await expect.poll(async () => (await shown(browser)).length).toBe(FIXTURE_STAMPS);
});

test('a stamp rotated in the browser is placed rotated', async ({ world }) => {
    const browser = await openBrowser(world);
    await browser.locator('[data-stamp-key="zc-e2e-pack:crate"]').click();
    await browser.getByRole('button', { name: 'Rotation: 0°' }).click();
    await expect(browser.getByRole('button', { name: 'Rotation: 90°' })).toBeVisible();
    await browser.getByRole('button', { name: 'Place at view centre' }).click();
    await expect.poll(async () => world.evaluate(() => canvas?.scene?.tiles.contents[0]?.rotation)).toBe(90);
});
