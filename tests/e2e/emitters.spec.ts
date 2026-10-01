// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from './lib/foundry';

test("a stamp's light and sound sit on its level, at the level's floor, since v14 sources are bounded vertically", async ({ world }) => {
    const result = await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        await controller?.addLevel('above', 'Ground');
        const upper = await controller?.addLevel('above', 'Upper'); // now the level being edited
        await controller?.placeStamp({ stamp: 'zc-e2e-pack:lamp', x: 400, y: 400 });
        const floor = canvas?.scene?.levels.contents.find((l) => l.id === upper)?.elevation.bottom;
        const light = canvas?.scene?.lights.contents[0];
        const sound = canvas?.scene?.sounds.contents[0];
        return {
            upper,
            floor,
            light: light && { elevation: light.elevation, levels: [...light.levels] },
            sound: sound && { elevation: sound.elevation, levels: [...sound.levels] },
        };
    });
    // A fresh v14 scene already has a default Level, so "Upper" is not the first band above 0.
    expect(result.floor).toBeGreaterThan(0);
    expect(result.light).toEqual({ elevation: result.floor, levels: [result.upper] });
    expect(result.sound).toEqual({ elevation: result.floor, levels: [result.upper] });
});
