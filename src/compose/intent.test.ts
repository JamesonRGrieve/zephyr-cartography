// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseMapIntent } from './intent';

const room = (key: string, opensTo: string[] = []): object => ({ key, purpose: 'hall', opensTo });

/** What is wrong with an intent, by message; none for one accepted. */
function refused(given: object): string[] {
    const parsed = parseMapIntent({ schemaVersion: 1, ...given });
    return parsed.ok ? [] : parsed.issues.map((issue) => issue.message);
}

describe('parseMapIntent', () => {
    it('fills an intent’s defaults: its size, ground, seed, and a building’s materials and front', () => {
        const parsed = parseMapIntent({ schemaVersion: 1, buildings: [{ width: 8, height: 6, rooms: [room('hall')] }] });
        expect(parsed.ok).toBe(true);
        const intent = parsed.ok ? parsed.intent : null;
        expect(intent).toMatchObject({ seed: 1, width: 30, height: 20, ground: 'grassland', zones: [], paths: [] });
        expect(intent?.buildings[0]).toMatchObject({ floor: 'floor.wooden-planks', wall: 'wall.stone', wallKind: 'solid', entrance: 'south' });
        expect(intent?.buildings[0]?.rooms[0]).toMatchObject({ size: 1, entrance: false, opensTo: [] });
    });

    it('takes zones, paths and anchors of every kind', () => {
        const parsed = parseMapIntent({
            schemaVersion: 1,
            ground: null,
            zones: [
                { kind: 'woodland', area: { shape: 'everywhere' }, density: 'dense' },
                { kind: 'clearing', area: { shape: 'circle', centre: { x: 5, y: 5 }, radius: 3 } },
                { kind: 'rocky', area: { shape: 'edge', side: 'east', depth: 4 } },
                {
                    kind: 'marsh',
                    area: {
                        shape: 'polygon',
                        points: [
                            { x: 0, y: 0 },
                            { x: 3, y: 0 },
                            { x: 0, y: 3 },
                        ],
                    },
                },
            ],
            paths: [
                { kind: 'road', from: 'west', to: { building: 'inn' } },
                { kind: 'river', from: { x: 1, y: 1 }, to: 'south', liquid: 'lava', meander: 1 },
            ],
            buildings: [{ key: 'inn', width: 6, height: 5, rooms: [room('hall')] }],
        });
        expect(parsed.ok).toBe(true);
    });

    it('refuses rooms named twice, rooms opening to a room that is not there or to themselves, and a path to a building that is not there', () => {
        expect(refused({ buildings: [{ width: 6, height: 6, rooms: [room('a'), room('a')] }] })).toEqual(['room a is named twice']);
        expect(refused({ buildings: [{ width: 6, height: 6, rooms: [room('a', ['b']), room('c', ['c'])] }] })).toEqual([
            'a cannot open to b',
            'c cannot open to c',
        ]);
        expect(refused({ paths: [{ kind: 'road', from: 'west', to: { building: 'mill' } }] })).toEqual(['no building named mill']);
        expect(refused({ schemaVersion: 2 }).length).toBeGreaterThan(0);
        expect(parseMapIntent({ schemaVersion: 1, zones: [{ kind: 'jungle' }] }).ok).toBe(false);
    });

    it('refuses storm doors with no cellar to lead into, a path to a zone that is not there, and a prop beside a building that is not there', () => {
        const hut = { key: 'hut', width: 4, height: 3, rooms: [room('room')] };
        expect(refused({ buildings: [{ ...hut, stormDoor: 'east' }] })).toEqual(['storm doors lead down into a cellar, and the building has none']);
        expect(refused({ paths: [{ kind: 'river', from: { zone: 'lake' }, to: 'east' }] })).toEqual(['no zone named lake']);
        expect(refused({ buildings: [hut], props: [{ role: 'well', beside: { building: 'mill' } }] })).toEqual(['no building named mill']);
        // All three as they should be.
        const fine = parseMapIntent({
            schemaVersion: 1,
            zones: [{ key: 'lake', kind: 'lake', area: { shape: 'circle', centre: { x: 5, y: 5 }, radius: 3 } }],
            paths: [{ kind: 'river', from: { zone: 'lake' }, to: 'east' }],
            buildings: [{ ...hut, cellars: [{ rooms: [room('cellar')] }], stormDoor: 'east' }],
            props: [{ role: 'well', beside: { building: 'hut' } }],
        });
        expect(fine.ok && fine.intent.buildings[0]?.cellarAccess).toBe('ladder');
    });

    it('refuses a design that names what is not there or cannot stand: a fixture before one not yet placed, an arch or a doorway to no room, a front door past its wall', () => {
        const fixtures = [
            { name: 'chair', width: 0.6, height: 0.6, place: { before: 'desk' } },
            { name: 'desk', width: 2, height: 1, place: { centre: true } },
        ];
        expect(refused({ buildings: [{ width: 8, height: 6, rooms: [{ ...room('hall'), furnish: 'fixtures', fixtures }] }] })).toEqual([
            'no fixture named desk comes before it',
        ]);
        expect(refused({ buildings: [{ width: 8, height: 6, rooms: [{ ...room('hall'), archTo: ['nave'] }] }] })).toEqual(['hall cannot open to nave']);
        expect(refused({ buildings: [{ width: 8, height: 6, openings: [{ side: 'north', at: 2, room: 'vault' }], rooms: [room('hall')] }] })).toEqual([
            'no ground-floor room is named vault',
        ]);
        expect(refused({ buildings: [{ width: 8, height: 6, frontDoorAt: 7, frontDoorWidth: 2, rooms: [room('hall')] }] })).toEqual([
            'the south wall is 8 squares long',
        ]);
        expect(refused({ buildings: [{ width: 8, height: 6, openings: [{ side: 'east', at: 5, width: 2 }], rooms: [room('hall')] }] })).toEqual([
            'the east wall is 6 squares long',
        ]);
    });

    it('refuses rooms placed only part-way, past their building or one on another, and an area running backwards', () => {
        const placed = (rooms: object[]): string[] => refused({ buildings: [{ width: 8, height: 6, rooms }] });
        const at = (key: string, rect: object): object => ({ ...room(key), rect });
        expect(placed([at('a', { x: 0, y: 0, w: 4, h: 6 }), at('b', { x: 4, y: 0, w: 4, h: 6 })])).toEqual([]);
        expect(placed([at('a', { x: 0, y: 0, w: 4, h: 6 }), room('b')])).toEqual(['every room of a floor is placed, or none is: b has no rect']);
        expect(placed([at('a', { x: 0, y: 0, w: 9, h: 6 })])).toEqual(['a reaches past the building']);
        expect(placed([at('a', { x: 0, y: 0, w: 5, h: 6 }), at('b', { x: 4, y: 0, w: 4, h: 6 })])).toEqual(['b lies on a']);
        const backwards = { from: { x: 0.8, y: 0.2 }, to: { x: 0.2, y: 0.9 } };
        const fixtures = [{ name: 'pew', width: 2, height: 0.8, place: { rows: 'along', area: backwards } }];
        expect(refused({ buildings: [{ width: 8, height: 6, rooms: [{ ...room('hall'), furnish: 'fixtures', fixtures }] }] })).toEqual([
            'an area runs from its top-left corner to its bottom-right',
        ]);
    });

    it('takes a run’s open ends only across its front, and only on a piece standing where asked', () => {
        const leg = (facing: string, openEnds: string[], place: object): object => ({
            buildings: [
                {
                    width: 8,
                    height: 6,
                    rooms: [
                        {
                            ...room('bar'),
                            furnish: 'fixtures',
                            fixtures: [{ name: 'counter', role: 'counter', width: 3, height: 1, facing, open: openEnds, place }],
                        },
                    ],
                },
            ],
        });
        const at = { at: { x: 0.5, y: 0.5 } };
        expect(refused(leg('left', ['bottom'], at))).toEqual([]);
        expect(refused(leg('bottom', ['left', 'right'], at))).toEqual([]);
        expect(refused(leg('left', ['right'], at))).toEqual(['a piece facing left has no end on its right']);
        expect(refused(leg('bottom', ['left'], { wall: 'top' }))).toEqual(['open ends are for a piece standing where asked, facing its `facing`']);
    });

    it('takes a backdrop colour, a district’s block sizes and hewn passages, and refuses what cannot be drawn', () => {
        expect(refused({ backdrop: '#0c0c0e' })).toEqual([]);
        expect(refused({ backdrop: 'black' })).toEqual(['a #rrggbb colour']);
        expect(refused({ districts: [{ area: { x: 0, y: 0, w: 20, h: 20 }, block: [8, 12] }] })).toEqual([
            'a block may be cut in two only if two of the least fit the most',
        ]);
        const hewn = parseMapIntent({
            schemaVersion: 1,
            hewn: [
                {
                    passages: [
                        {
                            points: [
                                { x: 0, y: 0 },
                                { x: 5, y: 0 },
                            ],
                            width: 2,
                        },
                    ],
                },
            ],
        });
        expect(hewn.ok && hewn.intent.hewn[0]).toMatchObject({ floor: 'floor.rubble', wall: 'wall.rock', roughness: 0.35, chambers: [] });
        expect(refused({ hewn: [{ passages: [{ points: [{ x: 0, y: 0 }], width: 2 }] }] })).toHaveLength(1);
    });
});
