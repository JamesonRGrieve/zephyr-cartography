// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from './lib/foundry';

test('a door stamp’s wall slides open with its pack’s animation and sound', async ({ world }) => {
    const door = await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.controller()?.placeStamp({ stamp: 'zc-e2e-pack:door', x: 500, y: 500 });
        const wall = canvas?.scene?.walls.contents.find((w) => w.door === CONST.WALL_DOOR_TYPES.DOOR);
        return wall ? { doorSound: wall.doorSound, type: wall.animation?.type, duration: wall.animation?.duration, texture: wall.animation?.texture } : null;
    });
    // The door leaf's image is served from the pack module.
    expect(door).toEqual({ doorSound: 'slidingMetal', type: 'slide', duration: 500, texture: 'modules/zc-e2e-pack/stamps/door-closed.svg' });
});

test('stamp walls carry every sense level, a one-way direction and thresholds into Foundry', async ({ world }) => {
    const walls = await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.controller()?.placeStamp({ stamp: 'zc-e2e-pack:fence', x: 500, y: 500 });
        return (canvas?.scene?.walls.contents ?? []).map((w) => ({
            sight: w.sight,
            light: w.light,
            sound: w.sound,
            move: w.move,
            dir: w.dir,
            threshold: { light: w.threshold.light, sight: w.threshold.sight, sound: w.threshold.sound, attenuation: w.threshold.attenuation },
        }));
    });
    expect(walls).toHaveLength(4);
    // EDGE_SENSE_TYPES: LIMITED 10, PROXIMITY 30, NONE 0, NORMAL 20; EDGE_DIRECTIONS.LEFT 1.
    // Thresholds are authored in grid units: 3, 2 and 4 squares at the scene's 5 distance units per square.
    for (const wall of walls) {
        expect(wall).toEqual({ sight: 10, light: 30, sound: 0, move: 20, dir: 1, threshold: { light: 15, sight: 10, sound: 20, attenuation: true } });
    }
});
