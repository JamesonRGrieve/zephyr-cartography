// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Tier B e2e: the built module running in a real Foundry v14 server.
 *
 * Each worker gets its own server, data directory and world on port
 * `FOUNDRY_TEST_PORT + slot` (base 30101, clear of the system repo's suite), so
 * workers never share a world. `scripts/e2e-world.mjs` provisions it from
 * tests/e2e/fixtures and the current `dist/`. The Foundry release comes from
 * `FOUNDRY_RELEASE_DIR` (default `.foundry-release`, gitignored); without
 * one, every spec is skipped with a banner unless `FOUNDRY_INTEGRATION=required`.
 *
 * Canvas screenshots are pinned to the system Chromium with software
 * rendering, so they are deterministic on one machine.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT_BASE = Number(process.env['FOUNDRY_TEST_PORT'] ?? 30101);
const WORKERS = Math.max(1, Number(process.env['E2E_WORKERS'] ?? 1));
const RELEASE = resolve(process.env['FOUNDRY_RELEASE_DIR'] ?? '.foundry-release');
const FOUNDRY_PRESENT = existsSync(resolve(RELEASE, 'main.js'));
const REQUIRED = process.env['FOUNDRY_INTEGRATION'] === 'required';
const SYSTEM_CHROMIUM = '/usr/bin/chromium';
const executablePath = process.env['CHROMIUM_PATH'] ?? (existsSync(SYSTEM_CHROMIUM) ? SYSTEM_CHROMIUM : undefined);
/** Foundry needs a viewport of at least 1366 × 768, or it shows a blocking warning. */
const VIEWPORT = { width: 1440, height: 900 };
/** A cold world boot can take a while on a loaded machine. */
const BOOT_TIMEOUT_MS = 180_000;

if (!FOUNDRY_PRESENT && !REQUIRED) {
    console.warn(`[e2e] SKIPPED: no Foundry release at ${RELEASE} (set FOUNDRY_RELEASE_DIR, or FOUNDRY_INTEGRATION=required to fail)`);
}

export default defineConfig({
    testDir: './tests/e2e',
    testIgnore: FOUNDRY_PRESENT || REQUIRED ? [] : ['**/*.spec.ts'],
    workers: WORKERS,
    // Each worker has its own world, so even one file's tests spread across them.
    fullyParallel: WORKERS > 1,
    forbidOnly: process.env['CI'] !== undefined,
    retries: 0,
    timeout: 120_000,
    reporter: [['list'], ['json', { outputFile: '.e2e-results.json' }]],
    expect: {
        timeout: 20_000,
        toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' },
    },
    use: {
        browserName: 'chromium',
        viewport: VIEWPORT,
        launchOptions: {
            ...(executablePath === undefined ? {} : { executablePath }),
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--font-render-hinting=none'],
        },
    },
    webServer: FOUNDRY_PRESENT
        ? Array.from({ length: WORKERS }, (_, slot) => {
              const port = PORT_BASE + slot;
              return {
                  // The server's own log goes beside its data, where a failed boot can be read.
                  command: `node scripts/e2e-world.mjs ${port} && exec node --require ./scripts/foundry-hostname-shim.cjs ${RELEASE}/main.js --dataPath=./.foundry-test-data-${port} --port=${port} --noupnp --headless > .foundry-test-data-${port}/server.log 2>&1`,
                  url: `http://127.0.0.1:${port}/join`,
                  reuseExistingServer: false,
                  timeout: BOOT_TIMEOUT_MS,
                  stdout: 'ignore' as const,
                  stderr: 'pipe' as const,
              };
          })
        : [],
});
