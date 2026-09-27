// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseMapIntent } from './intent';

const room = (key: string, opensTo: string[] = []): object => ({ key, purpose: 'hall', opensTo });

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
        const refused = (given: object): string[] => {
            const parsed = parseMapIntent({ schemaVersion: 1, ...given });
            return parsed.ok ? [] : parsed.issues.map((issue) => issue.message);
        };
        expect(refused({ buildings: [{ width: 6, height: 6, rooms: [room('a'), room('a')] }] })).toEqual(['room a is named twice']);
        expect(refused({ buildings: [{ width: 6, height: 6, rooms: [room('a', ['b']), room('c', ['c'])] }] })).toEqual([
            'a cannot open to b',
            'c cannot open to c',
        ]);
        expect(refused({ paths: [{ kind: 'road', from: 'west', to: { building: 'mill' } }] })).toEqual(['no building named mill']);
        expect(refused({ schemaVersion: 2 }).length).toBeGreaterThan(0);
        expect(parseMapIntent({ schemaVersion: 1, zones: [{ kind: 'jungle' }] }).ok).toBe(false);
    });
});
