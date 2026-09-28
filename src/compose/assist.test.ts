// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { adviseAndCompose, applyCritique, choosingPrompt, critiquePrompt, firstJson, placesOf, readChoices } from './assist';
import { composeMap } from './compose';
import { type MapIntent, parseMapIntent } from './intent';
import { TEST_ROLES } from './test-roles';

function intentOf(given: object): MapIntent {
    const parsed = parseMapIntent({ schemaVersion: 1, ...given });
    if (!parsed.ok) {
        throw new Error(`fixture: ${JSON.stringify(parsed.issues)}`);
    }
    return parsed.intent;
}

const INN = intentOf({
    seed: 2,
    width: 20,
    height: 14,
    zones: [{ kind: 'woodland', area: { shape: 'everywhere' } }],
    buildings: [
        {
            key: 'inn',
            at: { x: 4, y: 3 },
            width: 12,
            height: 8,
            rooms: [
                { key: 'common', purpose: 'common-room', size: 2, entrance: true, opensTo: ['bar'] },
                { key: 'bar', purpose: 'bar' },
            ],
        },
    ],
});

/** Two tables and two trees to choose between, named. */
const ROLES = new Map([
    ...TEST_ROLES,
    [
        'table',
        [
            ...(TEST_ROLES.get('table') ?? []),
            {
                ...(TEST_ROLES.get('table')?.[0] ?? {
                    key: '',
                    role: 'table' as const,
                    width: 1,
                    height: 1,
                    turn: 0,
                    against: 'free' as const,
                    clearance: 0,
                    upright: false,
                    habitats: [],
                    climb: null,
                    borrowed: false,
                    purposes: [],
                }),
                key: 'test:round-table',
            },
        ],
    ],
] as const);
const INFO = new Map([
    ['test:table', { name: 'Tavern Table', tags: ['tavern', 'table'] }],
    ['test:round-table', { name: 'Round Table', tags: ['round', 'table'] }],
]);

describe('firstJson', () => {
    it('finds the answer inside prose or thinking, and nothing where there is none', () => {
        expect(firstJson('Sure! Here it is:\n{"a": [1, 2]}\nHope that helps.')).toEqual({ a: [1, 2] });
        expect(firstJson('<think>a {b}</think> [{"piece": 3}]')).toEqual([{ piece: 3 }]);
        expect(firstJson('no json at all')).toBeUndefined();
    });
});

describe('choosing', () => {
    it('asks for every room and zone, offering each role’s candidates by name and tags', () => {
        expect(placesOf(INN).map((p) => p.place)).toEqual(['inn/common', 'inn/bar', 'zone-1']);
        const [, user] = choosingPrompt(INN, ROLES, INFO);
        expect(user?.content).toContain('inn/common (a common-room room):');
        // Each candidate listed once, by number, and the places name them by number.
        expect(user?.content).toContain('1 = Tavern Table [tavern, table]');
        expect(user?.content).toContain('2 = Round Table [round, table]');
        expect(user?.content).toContain('  table: 1, 2');
    });

    it('takes only offered places, roles and numbers from the answer', () => {
        const answer = JSON.stringify({
            'inn/common': { table: [2, 99, 'test:table'], sofa: [1] },
            'nowhere': { table: [1] },
        });
        const chosen = readChoices(answer, INN, ROLES);
        expect([...chosen.keys()]).toEqual(['inn/common']);
        expect(chosen.get('inn/common')?.get('table')).toEqual(['test:round-table']);
        expect(readChoices('I cannot help with that.', INN, ROLES).size).toBe(0);
    });

    it('composes a place’s pieces only from the stamps chosen for it', () => {
        const chosen = readChoices(JSON.stringify({ 'inn/common': { table: [2] } }), INN, ROLES);
        const tables = composeMap(INN, ROLES, chosen).spec.features.filter(
            (f) => f.type === 'stamp' && (f.stamp === 'test:table' || f.stamp === 'test:round-table'),
        );
        expect(tables.length).toBeGreaterThan(0);
        expect(tables.every((t) => t.type === 'stamp' && t.stamp === 'test:round-table')).toBe(true);
    });
});

describe('critique', () => {
    const { spec } = composeMap(INN, TEST_ROLES);
    const pieces = spec.features.flatMap((f, index) => (f.type === 'stamp' ? [{ f, index }] : []));

    it('describes each room and what stands in it, numbered, with where it faces', () => {
        const [, user] = critiquePrompt(spec, TEST_ROLES, new Map());
        expect(user?.content).toMatch(/inn:common: x \d+ to \d+, y \d+ to \d+/u);
        expect(user?.content).toMatch(/#\d+ test:\w+ \(\w+\) at \([\d.]+, [\d.]+\), front facing (north|east|south|west)/u);
    });

    it('turns and removes as asked, refusing a move out of the room or onto another piece, and fixes nothing unknown', () => {
        // A lamp is square: turned any way it keeps its footprint, so nothing stops the turn.
        const lamp = pieces.find((p) => p.f.stamp === 'test:light');
        const table = pieces.find((p) => p.f.stamp === 'test:table');
        const other = pieces.find((p) => p.f.stamp === 'test:table' && p !== table);
        if (!lamp || !table || !other) {
            throw new Error('fixture pieces');
        }
        const answer = JSON.stringify([
            { piece: lamp.index, action: 'turn', facing: 'east', why: 'face the room' },
            { piece: table.index, action: 'move', x: 100, y: 100, why: 'out of the room' },
            { piece: table.index, action: 'move', x: other.f.x, y: other.f.y, why: 'onto another table' },
            { piece: 9999, action: 'remove', why: 'no such piece' },
            { piece: other.index, action: 'remove', why: 'too many tables' },
        ]);
        const { spec: fixed, fixes } = applyCritique(spec, answer, TEST_ROLES);
        expect(fixes.map((f) => [f.action, f.applied])).toEqual([
            ['turn', true],
            ['move', false],
            ['move', false],
            ['remove', true],
        ]);
        expect(fixed.features).toHaveLength(spec.features.length - 1);
        // Found where it stands: the removal shifts every piece after it.
        const turned = fixed.features.find((f) => f.type === 'stamp' && f.stamp === 'test:light' && f.x === lamp.f.x && f.y === lamp.f.y);
        expect(turned?.type === 'stamp' ? turned.rotation : null).toBe(270);
        // An unreadable answer changes nothing.
        expect(applyCritique(spec, 'looks fine to me', TEST_ROLES).fixes).toEqual([]);
    });
});

describe('adviseAndCompose', () => {
    it('asks twice, uses the choices and applies the fixes', async () => {
        const asked: string[] = [];
        const result = await adviseAndCompose(INN, ROLES, INFO, async (messages) => {
            asked.push(messages[1]?.content ?? '');
            return Promise.resolve(asked.length === 1 ? JSON.stringify({ 'inn/common': { table: [2] } }) : '[]');
        });
        expect(asked).toHaveLength(2);
        expect(result).toMatchObject({ chosen: 1, fixes: [], failed: false });
    });

    it('composes without the model when it cannot be reached, and says so', async () => {
        const result = await adviseAndCompose(INN, ROLES, INFO, async () => Promise.reject(new Error('offline')));
        expect(result).toMatchObject({ chosen: 0, fixes: [], failed: true });
        expect(result.composition.spec.features.length).toBeGreaterThan(0);
    });

    it('keeps the chosen stamps when only the critique cannot be had', async () => {
        let asked = 0;
        const result = await adviseAndCompose(INN, ROLES, INFO, async () => {
            asked += 1;
            return asked === 1 ? Promise.resolve(JSON.stringify({ 'inn/common': { table: [2] } })) : Promise.reject(new Error('timed out'));
        });
        expect(result).toMatchObject({ chosen: 1, fixes: [], failed: true });
        expect(result.composition.spec.features.some((f) => f.type === 'stamp' && f.stamp === 'test:round-table')).toBe(true);
    });
});
