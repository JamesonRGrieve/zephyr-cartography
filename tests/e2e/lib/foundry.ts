// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The e2e fixture: a page joined to this worker's own Foundry world as the
 * Gamemaster, with the module and the e2e stamp pack active, on a fresh
 * scene. It records the module's JS coverage for the source-coverage
 * ratchet, and fails the test on any page error or console error.
 *
 * Specs drive the module through its public API
 * (`game.modules.get('zephyrex-cartography').api`) and assert on the native
 * documents Foundry holds.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';

const PORT_BASE = Number(process.env['FOUNDRY_TEST_PORT'] ?? 30101);
const MODULE_ID = 'zephyrex-cartography';
const PACK_ID = 'zc-e2e-pack';
/**
 * Integrations the suite exercises when their modules are installed (see scripts/e2e-world.mjs), and the real asset
 * packs the showcase maps are built from (the private one, where installed, holds the Imperium's own art; the CC0 one,
 * the public-domain textures and the ambience every pack's stamps sound and smoke by).
 */
const OPTIONAL_MODULES = [
    'item-piles',
    'socketlib',
    'lib-wrapper',
    'zephyrex-cartography-assets',
    'zephyrex-cartography-assets-private',
    'zephyrex-cartography-assets-cc0',
];

/** The e2e system's one Actor type (tests/e2e/fixtures/system). */
const E2E_ACTOR_TYPE = 'npc';

declare global {
    interface SettingConfig {
        /** Item Piles' Actor type for piles, which a GM chooses on a system Item Piles does not know. */
        'item-piles.actorClassType': string;
        /** Whether a GM has seen Item Piles' modal "System Not Recognized" warning, which otherwise covers the page. */
        'item-piles.systemNotFoundWarningShown': boolean;
    }
}

/** Whether an optional integration's module is active in this world. */
export async function moduleActive(page: Page, moduleId: string): Promise<boolean> {
    return page.evaluate((id) => [...(game.modules?.values() ?? [])].some((m) => m.id === id && m.active), moduleId);
}
/** Where the module's served build lives; coverage keeps only these scripts. */
const MODULE_SCRIPT = `/modules/${MODULE_ID}/dist/`;
const RAW_COVERAGE_DIR = resolve('.e2e-raw-coverage');
const JOIN_ATTEMPTS = 6;
const JOIN_RETRY_MS = 2_000;
/** The join form's user field: a name typed in, since 14.368 (earlier releases listed users in a select). */
const USER_FIELD = 'input[name="username"]';
const READY_TIMEOUT_MS = 60_000;

/** A scene every test starts on: gridded, unpadded, so scene px equal canvas px from (0, 0). */
export const SCENE = { width: 2000, height: 1500, gridSize: 100 } as const;

/** Console errors Foundry itself logs on a bare test world, unrelated to the module. */
const FOUNDRY_NOISE = [/Failed to load resource/, /favicon/];

/** This worker's own server. */
function serverUrl(): string {
    const slot = Number(process.env['TEST_PARALLEL_INDEX'] ?? 0);
    return `http://127.0.0.1:${PORT_BASE + slot}`;
}

async function joinAsGamemaster(page: Page): Promise<void> {
    for (let attempt = 0; attempt < JOIN_ATTEMPTS; attempt++) {
        // eslint-disable-next-line no-await-in-loop -- sequential retry: each attempt waits out a still-booting world before the next
        await page.goto(`${serverUrl()}/join`);
        // The join form (a user-name field since 14.368) is served once the world has booted.
        // eslint-disable-next-line no-await-in-loop -- see above
        const ready = await page.locator(USER_FIELD).count();
        if (ready > 0) {
            break;
        }
        // eslint-disable-next-line no-await-in-loop -- see above
        await page.waitForTimeout(JOIN_RETRY_MS);
    }
    await page.fill(USER_FIELD, 'Gamemaster');
    await page.click('button[name="join"]');
    await page.waitForURL(/\/game/);
    await page.waitForFunction(() => game.ready === true, undefined, { timeout: READY_TIMEOUT_MS });
}

/**
 * Activate the module, the e2e pack, and whichever optional integrations are
 * installed, once per world; activating needs a reload.
 */
async function activateModules(page: Page): Promise<void> {
    const changed = await page.evaluate(
        async (wanted) => {
            const installed = [...(game.modules?.values() ?? [])];
            const toActivate = installed.filter((m) => wanted.includes(m.id));
            if (toActivate.every((m) => m.active)) {
                return false;
            }
            const current = game.settings?.get('core', 'moduleConfiguration') ?? {};
            await game.settings?.set('core', 'moduleConfiguration', { ...current, ...Object.fromEntries(toActivate.map((m) => [m.id, true])) });
            return true;
        },
        [MODULE_ID, PACK_ID, ...OPTIONAL_MODULES],
    );
    if (changed) {
        await page.reload();
        await page.waitForFunction(() => game.ready === true, undefined, { timeout: READY_TIMEOUT_MS });
    }
    // Item Piles does not know the e2e system, so it needs the GM's usual setup: which Actor type a pile is, and its
    // modal unknown-system warning dismissed (it covers the page, so real pointer input would never reach the canvas).
    if (await moduleActive(page, 'item-piles')) {
        const configured = await page.evaluate(async (actorType) => {
            let updated = false;
            if (game.settings?.get('item-piles', 'systemNotFoundWarningShown') !== true) {
                await game.settings?.set('item-piles', 'systemNotFoundWarningShown', true);
                updated = true;
            }
            if (game.settings?.get('item-piles', 'actorClassType') !== actorType) {
                await game.settings?.set('item-piles', 'actorClassType', actorType);
                updated = true;
            }
            return updated;
        }, E2E_ACTOR_TYPE);
        // The setting asks for a reload; take it now, before a scene is set up, rather than mid-test.
        if (configured) {
            await page.reload();
            await page.waitForFunction(() => game.ready === true, undefined, { timeout: READY_TIMEOUT_MS });
        }
    }
}

/** Create and view a fresh scene, and wait for the module's controller on it. */
/** A scene's size in px and its grid square. */
export interface SceneSize {
    readonly width: number;
    readonly height: number;
    readonly gridSize: number;
}

export async function freshScene(page: Page, sceneTitle: string, size: SceneSize = SCENE): Promise<void> {
    await page.evaluate(
        async ({ sceneName, scene }) => {
            const created = await Scene.create({ name: sceneName, width: scene.width, height: scene.height, padding: 0, grid: { size: scene.gridSize } });
            await created?.view();
        },
        { sceneName: sceneTitle, scene: size },
    );
    await page.waitForFunction(
        ([sceneName, moduleId]) =>
            canvas?.ready === true && canvas.scene?.name === sceneName && (game.modules?.get(moduleId).api.controller() ?? null) !== null,
        [sceneTitle, MODULE_ID] as const,
        { timeout: READY_TIMEOUT_MS },
    );
    // A real GM's pointer is always somewhere over the canvas. Put it there, so pointer
    // handlers run every time rather than whenever PIXI happens to synthesise a move.
    for (const at of POINTER_SWEEP) {
        // eslint-disable-next-line no-await-in-loop -- mouse moves are sequential by nature
        await page.mouse.move(at.x, at.y);
    }
}

/** Viewport points the pointer sweeps across a fresh scene. */
const POINTER_SWEEP = [
    { x: 700, y: 400 },
    { x: 720, y: 420 },
] as const;

/** How far out the default framing zooms: the default scene fills the view. */
const FRAME_SCALE = 0.5;

/**
 * Hide everything but the canvas (the interface, notifications, the pause
 * banner) and frame the whole scene, for a canvas-only screenshot. A scene
 * of another size is framed at `scale` about its middle.
 */
export async function frameScene(page: Page, layer: 'walls' | null = null, size: SceneSize = SCENE, scale = FRAME_SCALE): Promise<void> {
    // A stylesheet rule, not per-element styles, so overlays added later (a tour, a notification) stay hidden too.
    await page.addStyleTag({ content: 'body > :not(#board) { visibility: hidden !important; }' });
    await page.evaluate(
        async ({ scene, show, zoom }) => {
            // Foundry draws wall lines only while the Walls layer is active.
            if (show === 'walls') {
                canvas?.walls?.activate();
            }
            await canvas?.animatePan({ x: scene.width / 2, y: scene.height / 2, scale: zoom, duration: 0 });
        },
        { scene: size, show: layer, zoom: scale },
    );
}

async function saveCoverage(page: Page, title: string): Promise<void> {
    const entries = (await page.coverage.stopJSCoverage()).filter((entry) => entry.url.includes(MODULE_SCRIPT));
    if (entries.length === 0) {
        return;
    }
    mkdirSync(RAW_COVERAGE_DIR, { recursive: true });
    const file = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
    writeFileSync(resolve(RAW_COVERAGE_DIR, file), JSON.stringify(entries));
}

export const test = base.extend<{ world: Page }>({
    world: async ({ page }, use, testInfo) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => {
            errors.push(error.message);
        });
        page.on('console', (message) => {
            if (message.type() === 'error' && !FOUNDRY_NOISE.some((noise) => noise.test(message.text()))) {
                errors.push(message.text());
            }
        });
        await page.coverage.startJSCoverage({ resetOnNavigation: false });
        await joinAsGamemaster(page);
        await activateModules(page);
        await freshScene(page, testInfo.title);
        await use(page);
        await saveCoverage(page, testInfo.titlePath.join(' '));
        expect(errors, 'page and console errors').toEqual([]);
    },
});

export { expect };
