// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Renders every story in the static Storybook build, read from its
 * `index.json`, so a new story is covered the moment it exists. Each must
 * mount with no page or console errors and match its screenshot.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

interface IndexEntry {
    readonly id: string;
    readonly type: string;
    readonly title: string;
    readonly name: string;
}

interface StoryIndex {
    readonly entries: Readonly<Record<string, IndexEntry>>;
}

// eslint-disable-next-line no-restricted-syntax -- boundary: validates the untyped Storybook index JSON
function isStoryIndex(v: unknown): v is StoryIndex {
    return typeof v === 'object' && v !== null && 'entries' in v && typeof v.entries === 'object' && v.entries !== null;
}

function stories(): IndexEntry[] {
    const parsed = JSON.parse(readFileSync(resolve('storybook-static', 'index.json'), 'utf8'));
    if (!isStoryIndex(parsed)) {
        throw new Error('storybook-static/index.json has no entries; build Storybook first');
    }
    return Object.values(parsed.entries).filter((entry) => entry.type === 'story');
}

const ALL = stories();

/** Chromium's console text for a resource that failed to load. */
const FAILED_LOAD = 'Failed to load resource';

const HTTP_ERROR = 400;

/** Requested by the browser itself; the story iframe declares no icon. */
const BROWSER_FAVICON = '/favicon.ico';

test('the build contains stories', () => {
    expect(ALL.length).toBeGreaterThan(0);
});

for (const story of ALL) {
    test(`${story.title} / ${story.name}`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => {
            errors.push(error.message);
        });
        // Failed loads are reported by URL below; the console repeats them without one.
        page.on('console', (message) => {
            if (message.type() === 'error' && !message.text().startsWith(FAILED_LOAD)) {
                errors.push(message.text());
            }
        });
        page.on('response', (response) => {
            if (response.status() >= HTTP_ERROR && new URL(response.url()).pathname !== BROWSER_FAVICON) {
                errors.push(`${response.status()} ${response.url()}`);
            }
        });
        await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
        const root = page.locator('#storybook-root');
        await expect(root.locator('.zephyr-cartography').first()).toBeVisible();
        // Thumbnails load lazily; the screenshot must show them, not their empty frames.
        await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
        expect(errors).toEqual([]);
        await expect(page).toHaveScreenshot(`${story.id}.png`, { fullPage: true });
    });
}
