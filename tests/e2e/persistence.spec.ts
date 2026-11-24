// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from './lib/foundry';

/** How long the world may take to come back after a reload, in ms. */
const READY_MS = 120_000;

/**
 * A scene's features are kept in a file of their own (ffc5230), read back by every client that loads the scene. This
 * builds one feature of every kind a scene can keep (a zone of every shape, a drawn shape of every kind, an area with
 * every effect), reloads the page, and finds each feature as it was: the file round-trips everything, read through the
 * module's own parsers in the browser, as a GM or player joining later reads it.
 */
test('every kind of feature is read back from the scene’s features file exactly as saved, after a reload', async ({ world }) => {
    test.setTimeout(240_000);
    const ids = await world.evaluate(async () => {
        const outcome = await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            units: 'grid',
            features: [
                { type: 'zone', x: 3, y: 3, name: 'Circle', shape: { kind: 'circle', radius: 1.5 } },
                { type: 'zone', x: 8, y: 3, name: 'Ellipse', shape: { kind: 'ellipse', radiusX: 2, radiusY: 1 } },
                { type: 'zone', x: 13, y: 3, name: 'Ring', shape: { kind: 'ring', radius: 2, innerWidth: 0.5, outerWidth: 0.5 } },
                { type: 'zone', x: 18, y: 3, name: 'Cone', shape: { kind: 'cone', radius: 3, angle: 60, curvature: 'flat' } },
                { type: 'zone', x: 3, y: 9, name: 'Line', shape: { kind: 'line', length: 4, width: 1 } },
                { type: 'zone', x: 8, y: 9, name: 'Rectangle', shape: { kind: 'rectangle', width: 3, height: 2 }, rotation: 15 },
                {
                    type: 'zone',
                    x: 13,
                    y: 9,
                    name: 'Cells',
                    shape: {
                        kind: 'cells',
                        cells: [
                            { i: 0, j: 0 },
                            { i: 0, j: 1 },
                            { i: 1, j: 1 },
                        ],
                    },
                },
                { type: 'zone', x: 18, y: 9, name: 'Emanation', shape: { kind: 'emanation', radius: 1 } },
                // A black-water moat: its shade taken whole (tint 1), kept across the reload.
                {
                    type: 'path',
                    kind: 'river',
                    points: [
                        { x: 1, y: 11 },
                        { x: 19, y: 11 },
                    ],
                    shade: '#0b0e0c',
                    tint: 1,
                },
                {
                    type: 'shape',
                    kind: 'polygon',
                    points: [
                        { x: 2, y: 13 },
                        { x: 6, y: 13 },
                        { x: 4, y: 16 },
                    ],
                    stroke: { colour: '#ff4400', width: 6 },
                    fill: { colour: '#ffcc00', alpha: 0.4 },
                    walls: { sight: 'limited', light: 'limited', movement: false },
                },
                { type: 'shape', kind: 'ellipse', x: 10, y: 14, width: 4, height: 2, rotation: 30, stroke: { colour: '#00ccff', width: 4 } },
                { type: 'shape', kind: 'rectangle', x: 15, y: 14, width: 3, height: 2, stroke: { colour: '#ffffff', width: 2 }, hidden: true },
                {
                    type: 'shape',
                    kind: 'line',
                    points: [
                        { x: 2, y: 18 },
                        { x: 12, y: 18 },
                    ],
                    stroke: { colour: '#ffffff', width: 10 },
                },
                {
                    type: 'room',
                    points: [
                        { x: 14, y: 16 },
                        { x: 19, y: 16 },
                        { x: 19, y: 19 },
                        { x: 14, y: 19 },
                    ],
                    doors: [{ segment: 3, state: 'open' }],
                    effects: [
                        { kind: 'darkness', modifier: 1, disabled: true },
                        { kind: 'toggle', events: ['tokenEnter'], enable: [0] },
                        { kind: 'suppressWeather' },
                        { kind: 'text', text: 'Cold air', colour: '#aaddff', once: true, events: ['tokenAnimateIn'] },
                        { kind: 'pause', once: true },
                        { kind: 'macro', uuid: null, everyone: true, events: ['tokenEnter'] },
                        { kind: 'script', source: 'console.debug("entered")', events: ['tokenEnter'] },
                    ],
                },
            ],
        });
        return outcome?.ok === true ? outcome.report.features : [];
    });
    expect(ids).toHaveLength(14);

    const read = async (): Promise<unknown[]> =>
        world.evaluate((featureIds) => featureIds.map((id) => game.modules?.get('zephyr-cartography').api.controller()?.getFeature(id) ?? null), ids);
    const saved = await read();
    expect(saved.every((feature) => feature !== null)).toBe(true);

    // A fresh page reads the scene's features from its file alone. It opens on the world's active scene, so view this
    // one again (as a GM moving to it would).
    const sceneId = await world.evaluate(() => canvas?.scene?.id ?? '');
    await world.reload();
    await world.waitForFunction(() => game.ready === true, undefined, { timeout: READY_MS });
    await world.evaluate(async (id) => {
        const scene: Scene | undefined = game.scenes?.get(id);
        await scene?.view();
    }, sceneId);
    await world.waitForFunction(
        (id) => canvas?.ready === true && canvas.scene?.id === id && game.modules?.get('zephyr-cartography').api.controller() != null,
        sceneId,
        { timeout: READY_MS },
    );
    await expect.poll(read, { timeout: READY_MS }).toEqual(saved);
});
