// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from './lib/foundry';

test('the module boots with its API, scene controls and the e2e pack', async ({ world }) => {
    const state = await world.evaluate(() => {
        const cartography = game.modules?.get('zephyr-cartography');
        const group = ui.controls?.controls['zephyr-cartography'];
        return {
            active: cartography?.active,
            apiVersion: cartography?.api.version,
            controller: cartography?.api.controller() !== null,
            tools: Object.keys(group?.tools ?? {}).length,
            pack: [...(game.modules?.values() ?? [])].some((m) => m.id === 'zc-e2e-pack' && m.active),
        };
    });
    // A pack using every stamp field (particles, piles, terrain, overrides) loads with no errors.
    expect(state).toMatchObject({ active: true, apiVersion: 1, controller: true, pack: true });
    expect(state.tools).toBeGreaterThan(0);
});
