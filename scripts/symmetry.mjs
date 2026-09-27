#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Symmetry and reachability gate. Hard, not a ratchet: fresh code goes to
 * zero. It fails on any of:
 *
 *   1. A DOM view (`src/ui/*-view.ts`) without co-located stories
 *      (`*-view.stories.ts`) and a story test (`*-view.test.ts`).
 *   2. A pure-core module (`src/{geometry,tools,stamps,canvas,generate}/*.ts`)
 *      without a co-located `*.test.ts`, unless `.coverage-opt-out.json` lists
 *      it with a reason (types-only modules, test support).
 *   3. An unconsumed module: production code that no other production module
 *      imports. Tests and stories do not count as consumers, since being
 *      imported only by its own spec means the feature is unreachable. The
 *      entry and ambient declarations are exempt.
 *   4. A stale opt-out: an opted-out module that no longer exists, or that now
 *      has its test.
 *
 * Usage: node scripts/symmetry.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const CORE_DIRS = ['geometry', 'tools', 'stamps', 'canvas', 'generate'];
const ENTRY = 'src/zephyrex-cartography.ts';
const OPT_OUT_FILE = join(ROOT, '.coverage-opt-out.json');

function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

const rel = (path) => relative(ROOT, path);
/** Test support: fakes and fixtures exist only for tests and stories, so they are support, not production. */
const TEST_SUPPORT = ['src/canvas/test-fakes.ts', 'src/stamps/fixtures.ts', 'src/compose/test-roles.ts'];
const isSupport = (path) => /\.(test|stories)\.ts$/.test(path) || path.endsWith('.d.ts') || TEST_SUPPORT.includes(rel(path));
const files = walk(SRC).filter((f) => f.endsWith('.ts'));
const production = files.filter((f) => !isSupport(f));
const optOut = existsSync(OPT_OUT_FILE) ? JSON.parse(readFileSync(OPT_OUT_FILE, 'utf8')) : {};
const problems = [];

// 1. Views have stories and a story test.
for (const view of production.filter((f) => /^src\/ui\/.*-view\.ts$/.test(rel(f)))) {
    for (const suffix of ['.stories.ts', '.test.ts']) {
        const sibling = view.replace(/\.ts$/, suffix);
        if (!existsSync(sibling)) {
            problems.push(`view without ${suffix}: ${rel(view)}`);
        }
    }
}

// 2. Core modules have a test, or a documented opt-out.
for (const mod of production.filter((f) => CORE_DIRS.some((d) => rel(f).startsWith(`src/${d}/`)))) {
    const tested = existsSync(mod.replace(/\.ts$/, '.test.ts'));
    const reason = optOut[rel(mod)];
    if (!tested && typeof reason !== 'string') {
        problems.push(`core module without a test (or an opt-out in .coverage-opt-out.json): ${rel(mod)}`);
    }
}

// 4. Opt-outs stay current.
for (const [path, reason] of Object.entries(optOut)) {
    if (typeof reason !== 'string' || reason.trim() === '') {
        problems.push(`opt-out without a reason: ${path}`);
    } else if (!existsSync(join(ROOT, path))) {
        problems.push(`opt-out for a missing module: ${path}`);
    } else if (existsSync(join(ROOT, path).replace(/\.ts$/, '.test.ts'))) {
        problems.push(`opt-out for a module that now has its test (remove it): ${path}`);
    }
}

// 3. Every production module is imported by another production module.
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|import\s*['"](\.[^'"]+)['"]/g;
function resolveImport(from, spec) {
    const base = resolve(dirname(from), spec);
    for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return null;
}
const consumed = new Set();
for (const file of production) {
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
        const target = resolveImport(file, match[1] ?? match[2] ?? match[3]);
        if (target !== null && target !== file) {
            consumed.add(target);
        }
    }
}
for (const mod of production.filter((f) => rel(f) !== ENTRY && f.endsWith('.ts'))) {
    if (!consumed.has(mod)) {
        problems.push(`unconsumed module (no production module imports it): ${rel(mod)}`);
    }
}

if (problems.length > 0) {
    console.error(`[symmetry] FAIL: ${problems.length} problem(s):`);
    for (const p of problems) {
        console.error(`  ${p}`);
    }
    process.exit(1);
}
console.log(`[symmetry] OK: ${production.length} modules; every view has stories and a story test, every core module is tested, every module is consumed.`);
