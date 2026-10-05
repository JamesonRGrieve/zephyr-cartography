// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Drop shadows (operator, 2026-10-05: drawn shadows, option B): a standing
 * stamp casts its own picture's silhouette beneath the tiles in Foundry's
 * primary group, offset away from the scene's sun; the API's sun moves it,
 * a sun below the horizon takes it away, and the world setting turns it off.
 */
import { expect, test } from './lib/foundry';

/** Each shadow's offset from its tile, and how many there are. */
type Cast = { readonly count: number; readonly dx: number; readonly dy: number; readonly sortLayer: number | null };

test('a standing stamp casts a drop shadow away from the sun, beneath the tiles, gone at night and with the setting off', async ({ world }) => {
    await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            features: [{ type: 'stamp', stamp: 'zc-e2e-pack:chest', x: 6, y: 6 }],
        });
    });
    const cast = async (): Promise<Cast> =>
        world.evaluate(() => {
            const layers = (canvas?.primary?.children ?? []).filter((child) => child.name === 'zephyr-cartography-shadows');
            // Each layer's sprites, read as plain positions: the page's PIXI is untyped here.
            const positions = layers.flatMap((layer) => {
                // eslint-disable-next-line no-restricted-syntax -- boundary: the page's PIXI objects are untyped in the e2e context
                const children: unknown = Reflect.get(layer, 'children');
                return Array.isArray(children)
                    ? // eslint-disable-next-line no-restricted-syntax -- boundary: each child is an untyped PIXI sprite, read for its position
                      children.map((child: unknown) => ({ x: Number(Reflect.get(Object(child), 'x')), y: Number(Reflect.get(Object(child), 'y')) }))
                    : [];
            });
            const tile = canvas?.tiles?.placeables.find((t) => t.document.getFlag('zephyr-cartography', 'featureId') !== undefined);
            const first = positions[0];
            const mesh = tile?.mesh;
            const sortLayer = layers[0] === undefined ? null : Number(Reflect.get(layers[0], 'sortLayer'));
            return {
                count: positions.length,
                dx: first !== undefined && mesh ? first.x - mesh.x : 0,
                dy: first !== undefined && mesh ? first.y - mesh.y : 0,
                sortLayer,
            };
        });
    const sunTo = async (sun: { azimuth: number; elevation: number } | null): Promise<void> =>
        world.evaluate(async (given) => {
            await game.modules?.get('zephyr-cartography').api.setSun(given);
        }, sun);

    // The default sun stands in the north-west: the shadow falls to the south-east, just beneath the tiles.
    await expect.poll(cast).toMatchObject({ count: 1, sortLayer: 499 });
    const southEast = await cast();
    expect(southEast.dx).toBeGreaterThan(0);
    expect(southEast.dy).toBeGreaterThan(0);

    // An eastern sun casts it west.
    await sunTo({ azimuth: 90, elevation: 30 });
    await expect.poll(async () => (await cast()).dx).toBeLessThan(0);

    // Once the sun is down there is none, and it comes back at sunrise.
    await sunTo({ azimuth: 90, elevation: -10 });
    await expect.poll(async () => (await cast()).count).toBe(0);
    await sunTo(null);
    await expect.poll(async () => (await cast()).count).toBe(1);

    // The world setting turns them off and on again.
    await world.evaluate(async () => {
        await game.settings?.set('zephyr-cartography', 'dropShadows', false);
    });
    await expect.poll(async () => (await cast()).count).toBe(0);
    await world.evaluate(async () => {
        await game.settings?.set('zephyr-cartography', 'dropShadows', true);
    });
    await expect.poll(async () => (await cast()).count).toBe(1);

    // A sun that is no sun is refused, and the scene keeps the one it had.
    const refused = await world.evaluate(async () => game.modules?.get('zephyr-cartography').api.setSun({ azimuth: 'noon' }));
    expect(refused).toBe(false);
});
