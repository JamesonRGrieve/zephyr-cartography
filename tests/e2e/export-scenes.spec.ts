// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Scene export for an asset pack: each map intent listed in `EXPORT_SCENES`
 * (a JSON list of `{ key, intent }`, the intent a preset's name or a path to
 * an intent file) is composed in the real asset pack's art on a scene its
 * size, and each of its levels exported into `EXPORT_SCENES_OUT`:
 *   - `<key>.<n>.png`: the level drawn unlit (its lights switched off, full
 *     daylight, no grid), at one image px per scene px or less, so that a
 *     VTT lights it from the exported lights;
 *   - `<key>.<n>.uvtt.json`: the level as Universal VTT (`exportUvtt`), its
 *     image left empty for the pack's own build to embed;
 *   - `<key>.scene.json`: the composed scene's document, and
 *     `<key>.problems.json`: what the composer reported.
 * An export, never a check: without the two variables there is nothing to do.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { z } from 'zod';
import { parseMapIntent } from '../../src/compose/intent';
import { sceneIdOf } from '../../src/compose/links';
import { MAP_PRESETS, type MapPreset, PRESET_INTENTS } from '../../src/compose/presets';
import { expect, freshScene, moduleActive, type SceneSize, test } from './lib/foundry';

const ASSETS = 'zephyr-cartography-assets';
/** The suite's own pack of test stamps, which no exported scene may use. */
const FIXTURE_PACK = 'zc-e2e-pack';
const PAINTED = `${ASSETS}:painted`;
const LIST = process.env['EXPORT_SCENES'];
const OUT = process.env['EXPORT_SCENES_OUT'];

/** Px per grid square the scenes are composed at. */
const GRID = 100;

/** The longest side an exported image may have, in px; a larger scene is drawn smaller. */
const MAX_SIDE = 4096;

/** How long one scene's export may take, in ms. */
const EXPORT_TIMEOUT_MS = 10 * 60_000;

/** How long a composed map's images may take to load, in ms. */
const IMAGES_LOAD_MS = 120_000;

/** The scenes to export: a key each, and its intent (a preset's name, or a path to an intent file). */
const listSchema = z.array(z.object({ key: z.string().regex(/^[a-z0-9-]+$/u), intent: z.string().min(1) }));

const listed = LIST === undefined ? [] : listSchema.parse(JSON.parse(readFileSync(LIST, 'utf8')));

const isPreset = (value: string): value is MapPreset => MAP_PRESETS.some((preset) => preset === value);

/** Wait until every visible tile and terrain image of the viewed level is drawn. */
async function drawn(page: Page): Promise<void> {
    await expect.poll(async () => page.evaluate(() => canvas?.ready === true)).toBe(true);
    await expect
        .poll(
            async () =>
                page.evaluate(
                    () =>
                        (canvas?.tiles?.placeables ?? []).filter((t) => t.visible).every((t) => t.mesh?.texture?.valid === true) &&
                        game.modules?.get('zephyr-cartography').api.terrainImagesLoading() === 0,
                ),
            { timeout: IMAGES_LOAD_MS },
        )
        .toBe(true);
}

test.beforeEach(async ({ world }) => {
    test.skip(!(await moduleActive(world, ASSETS)), `${ASSETS} is not installed among the test modules`);
});

for (const { key, intent: source } of listed) {
    test(`export scene: ${key}`, async ({ world }) => {
        test.skip(OUT === undefined, 'EXPORT_SCENES_OUT names no directory to write to');
        // Each level is redrawn and drawn again unlit: a scene of several levels takes minutes.
        test.setTimeout(EXPORT_TIMEOUT_MS);
        // Only the real pack's art: the suite's own fixture pack (test stamps) is switched off for the export.
        await world.evaluate(async (id) => {
            const current = game.settings?.get('core', 'moduleConfiguration') ?? {};
            await game.settings?.set('core', 'moduleConfiguration', { ...current, [id]: false });
        }, FIXTURE_PACK);
        await world.reload();
        await world.waitForFunction(() => game.ready === true, undefined, { timeout: IMAGES_LOAD_MS });
        const out = OUT ?? '';
        const raw = isPreset(source) ? PRESET_INTENTS[source] : z.json().parse(JSON.parse(readFileSync(source, 'utf8')));
        const parsed = parseMapIntent(raw);
        if (!parsed.ok) {
            throw new Error(`${key}: ${JSON.stringify(parsed.issues)}`);
        }
        const size: SceneSize = { width: parsed.intent.width * GRID, height: parsed.intent.height * GRID, gridSize: GRID };
        // A map with ways to others is made under its key's scene id, so the other maps' ways reach it when imported.
        await freshScene(world, key, size, parsed.intent.key === undefined ? null : sceneIdOf(parsed.intent.key));
        await world.evaluate(async (set) => {
            await game.settings?.set('zephyr-cartography', 'textureSet', set);
        }, PAINTED);
        const problems = await world.evaluate(async (given) => {
            const composed = await game.modules?.get('zephyr-cartography').api.compose(given);
            if (!composed) {
                return ['no module API'];
            }
            return composed.ok ? [...composed.report.problems, ...composed.problems].map((p) => JSON.stringify(p)) : composed.issues.map((i) => i.message);
        }, raw);
        const fixtureTiles = await world.evaluate(
            (id) => (canvas?.scene?.tiles.contents ?? []).filter((tile) => (tile.texture.src ?? '').includes(id)).length,
            FIXTURE_PACK,
        );
        expect(fixtureTiles, 'tiles drawn from the suite’s fixture pack').toBe(0);
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, `${key}.problems.json`), `${JSON.stringify(problems, null, 2)}\n`);
        // The scene as composed, before anything is changed to draw it: its grid, darkness and lights as they are.
        const sceneData = await world.evaluate(() => canvas?.scene?.toObject() ?? null);

        // Full daylight and no grid while drawing: the exported lights light it in the VTT. A roofed room keeps the day out
        // with a darkness region, so those are switched off for the picture too (and back on after), and the token layer
        // (Item Piles' container tokens, their names and heights) is hidden: the picture is the map's art alone.
        const darkening = await world.evaluate(async () => {
            const scene = canvas?.scene;
            await scene?.update({ grid: { alpha: 0 }, environment: { darknessLevel: 0, globalLight: { enabled: true } } });
            const found = (scene?.regions.contents ?? []).flatMap((region) => {
                const ids = region.behaviors.contents.filter((b) => b.type === 'adjustDarknessLevel' && !b.disabled).map((b) => b.id);
                return ids.length === 0 ? [] : [{ region, ids }];
            });
            await Promise.all(
                found.map(async ({ region, ids }) =>
                    region.updateEmbeddedDocuments(
                        'RegionBehavior',
                        ids.map((_id) => ({ _id, disabled: true })),
                    ),
                ),
            );
            return found.map(({ region, ids }) => ({ region: region.id, ids }));
        });
        const scale = Math.min(1, MAX_SIDE / Math.max(size.width, size.height));
        await world.setViewportSize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale) });
        await world.addStyleTag({ content: 'body > :not(#board) { visibility: hidden !important; }' });
        const levels = await world.evaluate(() => (canvas?.scene?.levels.contents ?? []).map((l) => ({ id: l.id, name: l.name })));
        await levels.reduce(async (previous, level, n) => {
            await previous;
            await world.evaluate(async (id) => {
                await canvas?.scene?.view({ level: id });
            }, level.id);
            await drawn(world);
            // Lights off for the picture, then on again for the export, which reads them.
            const lights = await world.evaluate(async () => {
                const scene = canvas?.scene;
                const shining = (scene?.lights.contents ?? []).filter((l) => !l.hidden).map((l) => l.id);
                await scene?.updateEmbeddedDocuments(
                    'AmbientLight',
                    shining.map((_id) => ({ _id, hidden: true })),
                );
                return shining;
            });
            await world.evaluate(
                async ({ x, y, zoom }) => {
                    await canvas?.animatePan({ x, y, scale: zoom, duration: 0 });
                },
                { x: size.width / 2, y: size.height / 2, zoom: scale },
            );
            await drawn(world);
            // Viewing a level redraws the canvas, the token layer with it: hidden again for each picture.
            await world.evaluate(() => {
                if (canvas?.tokens) {
                    canvas.tokens.visible = false;
                }
            });
            await world.locator('#board').screenshot({ path: join(out, `${key}.${n}.png`) });
            const uvtt = await world.evaluate(
                async ({ shining, imageGridSize }) => {
                    await canvas?.scene?.updateEmbeddedDocuments(
                        'AmbientLight',
                        shining.map((_id) => ({ _id, hidden: false })),
                    );
                    return game.modules?.get('zephyr-cartography').api.exportUvtt({ image: '', imageGridSize });
                },
                { shining: lights, imageGridSize: GRID * scale },
            );
            expect(uvtt).not.toBeNull();
            writeFileSync(join(out, `${key}.${n}.uvtt.json`), `${JSON.stringify({ level: level.name, ...uvtt })}\n`);
        }, Promise.resolve());
        await world.evaluate(async (found) => {
            const regions = canvas?.scene?.regions.contents ?? [];
            await Promise.all(
                regions.flatMap((region) => {
                    const ids = found.find((f) => f.region === region.id)?.ids ?? [];
                    return ids.length === 0
                        ? []
                        : [
                              region.updateEmbeddedDocuments(
                                  'RegionBehavior',
                                  ids.map((_id) => ({ _id, disabled: false })),
                              ),
                          ];
                }),
            );
        }, darkening);
        writeFileSync(join(out, `${key}.scene.json`), `${JSON.stringify({ grid: GRID, scale, levels, scene: sceneData })}\n`);
    });
}
