// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Universal VTT export: the module API's `exportUvtt` turns the viewed level
 * of a real scene (its native walls, doors and lights) into a `.dd2vtt`, in
 * grid squares from the map's corner, with the image the caller gives or
 * else the level's own background.
 */
import { expect, test } from './lib/foundry';

/** A 1×1 transparent PNG, base64. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test('exports a room’s walls, its door as a portal and its light, from the map’s corner', async ({ world }) => {
    const uvtt = await world.evaluate(async (image) => {
        const api = game.modules?.get('zephyr-cartography').api;
        await api?.buildSpec({
            schemaVersion: 1,
            features: [
                {
                    type: 'room',
                    points: [
                        { x: 2, y: 2 },
                        { x: 6, y: 2 },
                        { x: 6, y: 6 },
                        { x: 2, y: 6 },
                    ],
                    doors: [{ segment: 0 }],
                },
            ],
        });
        return api?.exportUvtt({ image, imageGridSize: 50 });
    }, PIXEL);
    expect(uvtt?.image).toBe(PIXEL);
    expect(uvtt?.resolution.pixels_per_grid).toBe(50);
    // One door, on the room's top wall, between its corners at 2 and 6 squares in.
    expect(uvtt?.portals).toHaveLength(1);
    const [door] = uvtt?.portals ?? [];
    expect(door?.position.y).toBe(2);
    expect(door?.position.x).toBeGreaterThan(2);
    expect(door?.position.x).toBeLessThan(6);
    // The rest of its walls block sight, joined into lines along the room's outline.
    const walled = (uvtt?.line_of_sight ?? []).flat();
    expect(walled.length).toBeGreaterThan(0);
    expect(walled.every((p) => p.x >= 2 && p.x <= 6 && p.y >= 2 && p.y <= 6)).toBe(true);
    // The room's own light, at its centre.
    expect(uvtt?.lights.map((l) => l.position)).toEqual([{ x: 4, y: 4 }]);
});

test('exports nothing for a level with no image given and no background of its own', async ({ world }) => {
    const uvtt = await world.evaluate(async () => game.modules?.get('zephyr-cartography').api.exportUvtt());
    expect(uvtt).toBeNull();
});
