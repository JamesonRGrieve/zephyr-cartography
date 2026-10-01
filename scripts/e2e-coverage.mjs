#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Merge the e2e suite's per-test V8 coverage of the served bundle
 * (`.e2e-raw-coverage/*.json`, written by tests/e2e/lib/foundry.ts) back onto
 * `src/**` through the build's source maps, and write an istanbul report to
 * `.e2e-coverage/` (coverage-final.json, coverage-summary.json, lcov.info).
 *
 * This is the coverage of the Foundry boundary (foundry/ and the entry) that
 * unit tests cannot reach, and of the core as a real Foundry drives it.
 *
 * Usage: node scripts/e2e-coverage.mjs   (after the e2e suite has run)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import v8toIstanbul from 'v8-to-istanbul';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = resolve(ROOT, '.e2e-raw-coverage');
const OUT_DIR = resolve(ROOT, '.e2e-coverage');
const DIST = resolve(ROOT, 'dist');
const SERVED = '/modules/zephyr-cartography/dist/';
const SRC = `${resolve(ROOT, 'src')}/`;

if (!existsSync(RAW_DIR) || readdirSync(RAW_DIR).length === 0) {
    console.error('[e2e-coverage] .e2e-raw-coverage/ is empty: run `pnpm test:e2e` first.');
    process.exit(2);
}

const map = libCoverage.createCoverageMap({});
let merged = 0;
for (const file of readdirSync(RAW_DIR).filter((name) => name.endsWith('.json'))) {
    for (const entry of JSON.parse(readFileSync(resolve(RAW_DIR, file), 'utf8'))) {
        const at = entry.url.indexOf(SERVED);
        const distPath = at < 0 ? null : resolve(DIST, entry.url.slice(at + SERVED.length));
        if (distPath === null || !existsSync(distPath)) {
            console.error(`[e2e-coverage] no built file for ${entry.url}`);
            process.exit(1);
        }
        // The dist file's sibling source map attributes each byte to its src/ file.
        const converter = v8toIstanbul(distPath, 0, { source: entry.source });
        await converter.load();
        converter.applyCoverage(entry.functions);
        const ours = Object.fromEntries(Object.entries(converter.toIstanbul()).filter(([path]) => path.startsWith(SRC) && path.endsWith('.ts')));
        map.merge(ours);
        converter.destroy();
        merged += 1;
    }
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
const context = libReport.createContext({ dir: OUT_DIR, coverageMap: map, defaultSummarizer: 'flat' });
for (const [name, options] of [
    ['json', { file: 'coverage-final.json' }],
    ['json-summary', {}],
    ['lcovonly', { file: 'lcov.info' }],
]) {
    reports.create(name, options).execute(context);
}

const total = JSON.parse(readFileSync(resolve(OUT_DIR, 'coverage-summary.json'), 'utf8')).total;
console.log(
    `[e2e-coverage] ${merged} bundle coverage dumps merged over ${Object.keys(map.data).length} src files: ` +
        ['lines', 'statements', 'functions', 'branches'].map((m) => `${m} ${total[m].pct}%`).join(', '),
);
