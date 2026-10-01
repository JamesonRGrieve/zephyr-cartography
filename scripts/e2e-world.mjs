#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Provision an isolated Foundry data directory for one e2e server:
 * `.foundry-test-data-<port>/`, with
 *   - the e2e game system and seed world (tests/e2e/fixtures),
 *   - this module (module.json + the built dist/, symlinked so the world runs
 *     the current build),
 *   - the e2e stamp pack (tests/e2e/fixtures/pack),
 *   - Config/options.json for a headless, auth-free test instance, and the
 *     release's license.
 * Each run rebuilds the directory from scratch, so every server starts from
 * the same state.
 *
 * Usage: node scripts/e2e-world.mjs <port>
 * Env:   FOUNDRY_RELEASE_DIR (default .foundry-release)
 *        FOUNDRY_TEST_MODULES (default .foundry-test-modules): optional
 *        third-party modules (Item Piles, socketlib, lib-wrapper) to install
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = resolve(ROOT, process.env['FOUNDRY_RELEASE_DIR'] ?? '.foundry-release');
const TEST_MODULES = resolve(ROOT, process.env['FOUNDRY_TEST_MODULES'] ?? '.foundry-test-modules');
const FIXTURES = join(ROOT, 'tests', 'e2e', 'fixtures');
const MODULE_ID = 'zephyr-cartography';
const SYSTEM_ID = 'zc-e2e';
const WORLD_ID = 'zc-e2e';
const PACK_ID = 'zc-e2e-pack';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
    console.error('usage: node scripts/e2e-world.mjs <port>');
    process.exit(2);
}
if (!existsSync(join(RELEASE, 'main.js'))) {
    console.error(`[e2e-world] ${RELEASE}/main.js is missing: point FOUNDRY_RELEASE_DIR at a Foundry v14 release`);
    process.exit(3);
}
if (!existsSync(join(ROOT, 'dist', `${MODULE_ID}.js`))) {
    console.error('[e2e-world] dist/ is missing: run `pnpm build` first');
    process.exit(4);
}

const DATA_ROOT = join(ROOT, `.foundry-test-data-${port}`);
const DATA = join(DATA_ROOT, 'Data');
const CONFIG = join(DATA_ROOT, 'Config');

// Every run starts from a fresh data directory: the same world each time, and no lock left
// behind by a previous server that was still shutting down.
rmSync(DATA_ROOT, { recursive: true, force: true });

/** Point `path` at `target`, replacing a stale link. */
function link(target, path) {
    if (existsSync(path) || isLink(path)) {
        if (isLink(path) && readlinkSync(path) === target) {
            return;
        }
        rmSync(path, { recursive: true, force: true });
    }
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(target, path);
}

function isLink(path) {
    try {
        return lstatSync(path).isSymbolicLink();
    } catch {
        return false;
    }
}

link(join(FIXTURES, 'system'), join(DATA, 'systems', SYSTEM_ID));
link(join(FIXTURES, 'pack'), join(DATA, 'modules', PACK_ID));

// Optional third-party modules (Item Piles and its dependencies), for the specs that
// integrate with them. Each subdirectory with a module.json is installed; specs skip
// what is not.
if (existsSync(TEST_MODULES)) {
    for (const entry of readdirSync(TEST_MODULES, { withFileTypes: true })) {
        const source = join(TEST_MODULES, entry.name);
        if (existsSync(join(source, 'module.json'))) {
            link(source, join(DATA, 'modules', entry.name));
        }
    }
}
// The module directory holds only what Foundry serves: the manifest and the build.
const moduleDir = join(DATA, 'modules', MODULE_ID);
mkdirSync(moduleDir, { recursive: true });
link(join(ROOT, 'module.json'), join(moduleDir, 'module.json'));
link(join(ROOT, 'dist'), join(moduleDir, 'dist'));

const worldDir = join(DATA, 'worlds', WORLD_ID);
mkdirSync(worldDir, { recursive: true });
cpSync(join(FIXTURES, 'world'), worldDir, { recursive: true });

mkdirSync(CONFIG, { recursive: true });
const options = {
    port,
    hostname: '127.0.0.1',
    world: WORLD_ID,
    // A throwaway local instance: no admin password, no update checks, no telemetry.
    adminPassword: null,
    proxyPort: null,
    compressStatic: false,
    noUpdate: true,
    telemetry: false,
};
writeFileSync(join(CONFIG, 'options.json'), `${JSON.stringify(options, null, 4)}\n`);
if (existsSync(join(RELEASE, 'license.json'))) {
    cpSync(join(RELEASE, 'license.json'), join(CONFIG, 'license.json'));
} else {
    console.warn(`[e2e-world] ${RELEASE}/license.json is missing: Foundry may stop at its license page`);
}

console.log(`[e2e-world] ready: ${DATA_ROOT} (port ${port}, world ${WORLD_ID})`);
