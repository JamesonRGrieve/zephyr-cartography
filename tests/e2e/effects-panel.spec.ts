// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from './lib/foundry';
import { clickScene, holdView, MODULE_ID, useTool } from './lib/pointer';

interface RoomEffects {
    readonly restriction: { type: string; priority: number } | null;
    readonly effects: readonly Record<string, unknown>[];
}

/**
 * The effects panel edits an area's behaviours field by field, as Foundry's own Region and behaviour sheets do: its
 * wall restriction and threshold, a darkness modifier, which events a toggle answers and what it does to each other
 * behaviour, an Active Effect list, and removing a behaviour (the toggles renumbered round it).
 */
test('the effects panel sets a room’s restriction, darkness, toggle and behaviours, and removes one', async ({ world }) => {
    const room = await world.evaluate(async () => {
        const outcome = await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            units: 'grid',
            features: [
                {
                    type: 'room',
                    points: [
                        { x: 4, y: 4 },
                        { x: 9, y: 4 },
                        { x: 9, y: 9 },
                        { x: 4, y: 9 },
                    ],
                    effects: [
                        { kind: 'macro', uuid: null, everyone: false, events: ['tokenEnter'] },
                        { kind: 'darkness', modifier: 1 },
                        { kind: 'toggle', events: ['tokenEnter'] },
                        { kind: 'activeEffect' },
                    ],
                },
            ],
        });
        return outcome?.ok === true ? outcome.report.features[0] ?? '' : '';
    });
    expect(room).not.toBe('');
    const state = async (): Promise<RoomEffects> =>
        world.evaluate((id) => {
            const feature = game.modules?.get('zephyr-cartography').api.controller()?.getFeature(id);
            if (feature?.type !== 'room') {
                return { restriction: null, effects: [] };
            }
            // Plain JSON across the page boundary: the effects as the feature keeps them.
            return {
                restriction: feature.display?.restriction ?? null,
                effects: (feature.effects ?? []).map((effect): Record<string, unknown> => ({ ...effect })),
            };
        }, room);

    await useTool(world, 'effects');
    await holdView(world);
    await clickScene(world, { x: 650, y: 650 });
    const panel = world.locator(`#${MODULE_ID}-effects`);
    await expect(panel).toBeVisible();

    // Shaped by walls that stop movement, from a threshold of 3.
    await panel.getByLabel('Restricted By').selectOption('move');
    await panel.getByLabel('Priority Threshold').fill('3');
    await panel.getByLabel('Priority Threshold').press('Enter');
    await expect.poll(async () => (await state()).restriction).toEqual({ type: 'move', priority: 3 });

    // The darkness behaviour at half strength.
    await panel.getByLabel('Modifier').fill('0.5');
    await panel.getByLabel('Modifier').press('Enter');
    await expect.poll(async () => (await state()).effects[1]).toMatchObject({ kind: 'darkness', modifier: 0.5 });

    // The toggle answers a token leaving too, and enables the darkness behaviour (the second).
    // The toggle's own checkbox: the macro offers Token Exits too.
    await panel.locator('[data-zc-focus="effect-2-tokenExit"]').check();
    await panel.getByLabel('2. Adjust Darkness Level').selectOption({ label: 'Enable Behaviors' });
    await expect.poll(async () => (await state()).effects[2]).toMatchObject({ kind: 'toggle', events: ['tokenEnter', 'tokenExit'], enable: [1], disable: [] });

    // An Active Effect list typed one UUID a line, blank lines dropped.
    await panel.getByLabel('Active Effect UUIDs, one per line').fill('\n  \n');
    await panel.getByLabel('Active Effect UUIDs, one per line').blur();
    await expect.poll(async () => (await state()).effects[3]).toMatchObject({ kind: 'activeEffect', effects: [] });

    // Removing the macro (the first) renumbers the toggle's target: the darkness behaviour is now the first.
    await panel.getByRole('button', { name: 'Remove: Execute Macro' }).click();
    await expect.poll(async () => (await state()).effects.map((e) => e['kind'])).toEqual(['darkness', 'toggle', 'activeEffect']);
    expect((await state()).effects[1]).toMatchObject({ kind: 'toggle', enable: [0] });
});
