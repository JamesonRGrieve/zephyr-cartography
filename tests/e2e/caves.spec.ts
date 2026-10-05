// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Caves of several levels: hewn networks cut on their own storeys become
 * native Levels below the scene's own, each named; a piece set on a storey
 * stands on that level, a way over an area on its storey stands there too,
 * and a map's label and a piece's sign can start hidden from players.
 */
import { expect, test } from './lib/foundry';

const line = (y: number): object => ({
    points: [
        { x: 2, y },
        { x: 18, y },
    ],
    width: 2,
});

test('a cave cut on two storeys is two named native Levels, its piece and its way up on the lower, its label and sign hidden', async ({ world }) => {
    const intent = {
        schemaVersion: 1,
        seed: 7,
        key: 'e2e-caves',
        width: 20,
        height: 12,
        ground: null,
        backdrop: '#08080a',
        hewn: [
            { name: 'Upper caves', passages: [line(3)] },
            { storey: -1, name: 'Lower galleries', passages: [line(8)] },
        ],
        fixtures: [
            {
                name: 'cache chest',
                role: 'storage',
                tags: ['loot'],
                width: 1,
                height: 1,
                at: { x: 10, y: 8 },
                storey: -1,
                reads: 'Stores of the deep',
                readsHidden: true,
            },
            // A piece up on the ground floor of the cave, at its mouth.
            { name: 'mouth crate', role: 'storage', tags: ['loot'], width: 1, height: 1, at: { x: 4, y: 3 }, reads: 'Cave mouth' },
        ],
        links: [{ key: 'climb', name: 'Up the shaft', at: { area: { x: 15, y: 7.5, w: 1, h: 1 }, storey: -1 }, to: null }],
        labels: [{ text: 'The Deep', at: { x: 10, y: 10 }, hidden: true }],
    };
    const built = await world.evaluate(async (given) => {
        const composed = await game.modules?.get('zephyr-cartography').api.compose(given);
        const scene = canvas?.scene;
        const levels = (scene?.levels.contents ?? []).map((l) => ({ id: l.id, name: l.name }));
        const lower = levels.find((l) => l.name === 'Lower galleries')?.id ?? null;
        const way = (scene?.regions.contents ?? []).find((r) => r.name === 'Up the shaft');
        const label = (scene?.drawings.contents ?? []).find((d) => d.text === 'The Deep');
        const sign = (scene?.notes.contents ?? []).find((n) => n.text === 'Stores of the deep');
        const mouth = (scene?.notes.contents ?? []).find((n) => n.text === 'Cave mouth');
        const upper = levels.find((l) => l.name === 'Upper caves')?.id ?? null;
        return {
            ok: composed?.ok === true,
            names: levels.map((l) => l.name),
            signOnLower: lower !== null && sign !== undefined && [...sign.levels].includes(lower),
            mouthOnUpper: upper !== null && mouth !== undefined && [...mouth.levels].includes(upper),
            wayOnLower: lower !== null && way !== undefined && [...way.levels].includes(lower),
            labelHidden: label?.hidden ?? null,
            signHidden: sign?.getFlag('zephyr-cartography', 'hidden') ?? null,
        };
    }, intent);
    expect(built.ok).toBe(true);
    expect(built.names).toEqual(expect.arrayContaining(['Upper caves', 'Lower galleries']));
    expect(built.signOnLower).toBe(true);
    expect(built.mouthOnUpper).toBe(true);
    expect(built.wayOnLower).toBe(true);
    expect(built.labelHidden).toBe(true);
    expect(built.signHidden).toBe(true);
});

test('a cave of one level on a dark backdrop names the scene’s own level after its network', async ({ world }) => {
    const intent = {
        schemaVersion: 1,
        seed: 3,
        key: 'e2e-grotto',
        width: 20,
        height: 12,
        ground: null,
        backdrop: '#0a0a0c',
        hewn: [{ name: 'The grotto', passages: [line(6)] }],
    };
    const built = await world.evaluate(async (given) => {
        const composed = await game.modules?.get('zephyr-cartography').api.compose(given);
        return { ok: composed?.ok === true, names: (canvas?.scene?.levels.contents ?? []).map((l) => l.name) };
    }, intent);
    expect(built.ok).toBe(true);
    expect(built.names).toEqual(['The grotto']);
});
