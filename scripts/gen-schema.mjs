#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Generate the published JSON Schemas from their zod sources of truth, loaded
 * directly via Node's TypeScript type stripping:
 *
 *   src/stamps/schema.ts   → schema/stamp-pack.v1.schema.json
 *   src/generate/spec.ts   → schema/scene-spec.v1.schema.json
 *   src/compose/intent.ts  → schema/map-intent.v1.schema.json
 *
 *   node scripts/gen-schema.mjs           # write the schema files
 *   node scripts/gen-schema.mjs --check   # fail if a committed file is stale
 *
 * Output is formatted with the repo's Prettier config so lint-staged never
 * rewrites it into a spurious "stale" state.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { z } from 'zod';

// The sources import each other the way the bundler resolves them, without
// extensions; Node needs the `.ts`.
registerHooks({
    resolve(specifier, context, nextResolve) {
        const relative = specifier.startsWith('./') || specifier.startsWith('../');
        return relative && !/\.[cm]?[jt]s$/.test(specifier) ? nextResolve(`${specifier}.ts`, context) : nextResolve(specifier, context);
    },
});

const { STAMP_PACK_SCHEMA_URL, stampPackSchema } = await import('../src/stamps/schema.ts');
const { SCENE_SPEC_SCHEMA_URL, sceneSpecSchema } = await import('../src/generate/spec.ts');
const { MAP_INTENT_SCHEMA_URL, mapIntentSchema } = await import('../src/compose/intent.ts');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const SCHEMAS = [
    { file: 'stamp-pack.v1.schema.json', id: STAMP_PACK_SCHEMA_URL, title: 'Zephyr Cartography stamp pack (v1)', schema: stampPackSchema },
    { file: 'scene-spec.v1.schema.json', id: SCENE_SPEC_SCHEMA_URL, title: 'Zephyr Cartography scene spec (v1)', schema: sceneSpecSchema },
    { file: 'map-intent.v1.schema.json', id: MAP_INTENT_SCHEMA_URL, title: 'Zephyr Cartography map intent (v1)', schema: mapIntentSchema },
];

let stale = false;
for (const { file, id, title, schema } of SCHEMAS) {
    const out = resolve(ROOT, 'schema', file);
    // `io: "input"` describes what an author writes: defaulted fields stay optional.
    const json = { $id: id, title, ...z.toJSONSchema(schema, { io: 'input' }) };
    const options = (await prettier.resolveConfig(out)) ?? {};
    const text = await prettier.format(JSON.stringify(json), { ...options, parser: 'json' });
    if (check) {
        const current = await readFile(out, 'utf8').catch(() => '');
        if (current !== text) {
            console.error(`[schema] schema/${file} is stale — run: pnpm schema:gen`);
            stale = true;
        }
    } else {
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, text);
        console.log(`[schema] wrote ${out}`);
    }
}

if (stale) {
    process.exit(1);
}
if (check) {
    console.log('[schema] OK: published JSON Schemas match their zod sources.');
}
