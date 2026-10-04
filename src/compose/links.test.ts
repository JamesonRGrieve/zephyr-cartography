// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { stableId } from '../tools/stable-id';
import { composeMap } from './compose';
import { type MapIntent, parseMapIntent } from './intent';
import { type LinkPlaces, linkFeatures, linkRegionIdOf, sceneIdOf } from './links';
import { TEST_ROLES } from './test-roles';

function intentOf(given: object): MapIntent {
    const parsed = parseMapIntent({ schemaVersion: 1, ...given });
    if (!parsed.ok) {
        throw new Error(JSON.stringify(parsed.issues));
    }
    return parsed.intent;
}

const NO_PLACES: LinkPlaces = { width: 30, height: 20, fronts: new Map(), paths: [], fixtures: new Map() };

/** Every way on a map of one level. */
const onGround = (): { level?: string } => ({});

describe('map ids', () => {
    it('keep a scene and its ways apart', () => {
        expect(sceneIdOf('tavern')).toBe(stableId('scene:tavern'));
        expect(sceneIdOf('tavern')).not.toBe(linkRegionIdOf('tavern', 'front'));
        expect(linkRegionIdOf('tavern', 'front')).not.toBe(linkRegionIdOf('tavern', 'back'));
    });
});

describe('linkFeatures', () => {
    it('stands a way over the edge a road runs off, as wide as the road, leading to the other map’s way', () => {
        const places = {
            ...NO_PLACES,
            paths: [
                {
                    points: [
                        { x: 5, y: 10 },
                        { x: 30, y: 12 },
                    ],
                    halfWidth: 1,
                },
            ],
        };
        const [way] = linkFeatures('tavern', [{ key: 'road-east', at: { edge: 'east' }, to: { map: 'region', link: 'tavern' } }], places, onGround);
        expect(way).toMatchObject({
            type: 'zone',
            x: 29,
            y: 12,
            shape: { kind: 'rectangle', width: 2, height: 4 },
            link: { region: linkRegionIdOf('tavern', 'road-east'), targets: [{ scene: sceneIdOf('region'), region: linkRegionIdOf('region', 'tavern') }] },
        });
    });

    it('stands over the edge’s middle where no road runs off it, over a place, or just inside a building’s front door', () => {
        const places = {
            ...NO_PLACES,
            fixtures: new Map([['the town', { x: 10, y: 4, w: 2, h: 2 }]]),
            fronts: new Map([['inn', { slot: { side: 'bottom' as const, at: 7, width: 2 }, room: { x: 4, y: 2, w: 8, h: 6 } }]]),
        };
        const ways = linkFeatures(
            'region',
            [
                { key: 'north', at: { edge: 'north' }, to: null },
                { key: 'town', at: { fixture: 'the town' }, to: { map: 'town', link: 'road' } },
                { key: 'inn-door', at: { building: 'inn' }, to: null },
            ],
            places,
            onGround,
        );
        expect(ways.map((w) => (w.type === 'zone' ? [w.x, w.y, w.shape] : null))).toEqual([
            [15, 1, { kind: 'rectangle', width: 3, height: 2 }],
            [11, 5, { kind: 'rectangle', width: 2, height: 2 }],
            [8, 7.5, { kind: 'rectangle', width: 2, height: 1 }],
        ]);
        // A way still to be linked takes no one anywhere, and is named for what it is.
        expect(ways[2]).toMatchObject({ name: 'inn-door', link: { targets: [] } });
        // A building left unbuilt has no door, and its way no zone.
        expect(linkFeatures('region', [{ key: 'gone', at: { building: 'keep' }, to: null }], places, onGround)).toEqual([]);
    });

    it('finds the road off the edge asked among paths that stay on the map, stands where `along` says, and skips a place not on it', () => {
        const places = {
            ...NO_PLACES,
            paths: [
                {
                    points: [
                        { x: 5, y: 5 },
                        { x: 9, y: 6 },
                    ],
                    halfWidth: 1,
                },
                {
                    points: [
                        { x: 12, y: 8 },
                        { x: 14, y: 0 },
                    ],
                    halfWidth: 0.5,
                },
            ],
        };
        const ways = linkFeatures(
            'map',
            [
                { key: 'north', at: { edge: 'north' }, to: null },
                { key: 'west', at: { edge: 'west', along: 6 }, to: null },
                { key: 'east', at: { edge: 'east' }, to: null },
                { key: 'lost', at: { fixture: 'nowhere' }, to: null },
                { key: 'trapdoor', at: { area: { x: 21.9, y: 13.3, w: 1.2, h: 1.2 }, storey: 0 }, to: { map: 'tomb', link: 'stair' } },
            ],
            places,
            onGround,
        );
        expect(ways.map((w) => (w.type === 'zone' ? [w.name, w.x, w.y, w.shape] : null))).toEqual([
            ['north', 14, 1, { kind: 'rectangle', width: 3, height: 2 }],
            ['west', 1, 6, { kind: 'rectangle', width: 2, height: 3 }],
            ['east', 29, 10, { kind: 'rectangle', width: 2, height: 3 }],
            // A way down inside a building, over the area asked.
            ['To tomb', 22.5, 13.9, { kind: 'rectangle', width: 1.2, height: 1.2 }],
        ]);
    });

    it('stands a way over an area on its storey’s level (a trapdoor in a cellar floor), every other on the ground', () => {
        const levelOf = (storey: number): { level: string } => ({ level: storey === 0 ? 'ground' : `storey ${String(storey)}` });
        const ways = linkFeatures(
            'tower',
            [
                { key: 'road', at: { edge: 'south' }, to: null },
                { key: 'caves', at: { area: { x: 2, y: 5, w: 1, h: 1 }, storey: -1 }, to: { map: 'caves', link: 'up' } },
            ],
            NO_PLACES,
            levelOf,
        );
        expect(ways.map((w) => (w.type === 'zone' ? w.level : null))).toEqual(['ground', 'storey -1']);
    });
});

describe('map links in an intent', () => {
    it('need the map’s own key, places on the map, and keys used once', () => {
        const link = { key: 'door', at: { building: 'inn' }, to: { map: 'tavern', link: 'front' } };
        const building = { key: 'inn', width: 6, height: 4, rooms: [{ key: 'hall', purpose: 'hall' }] };
        expect(parseMapIntent({ schemaVersion: 1, links: [link], buildings: [building] }).ok).toBe(false);
        expect(parseMapIntent({ schemaVersion: 1, key: 'town', links: [link], buildings: [] }).ok).toBe(false);
        expect(parseMapIntent({ schemaVersion: 1, key: 'town', links: [link, link], buildings: [building] }).ok).toBe(false);
        expect(parseMapIntent({ schemaVersion: 1, key: 'town', links: [{ ...link, at: { fixture: 'nowhere' } }] }).ok).toBe(false);
        const area = (x: number) => ({ schemaVersion: 1, key: 'town', width: 20, height: 10, links: [{ ...link, at: { area: { x, y: 2, w: 2, h: 2 } } }] });
        expect(parseMapIntent(area(19)).ok).toBe(false);
        expect(parseMapIntent(area(-1)).ok).toBe(false);
        expect(parseMapIntent(area(4)).ok).toBe(true);
        expect(parseMapIntent({ schemaVersion: 1, key: 'town', links: [link], buildings: [building] }).ok).toBe(true);
    });

    it('compose ways over the road leaving the map and over a place on it, past buildings with no way', () => {
        const region = intentOf({
            key: 'region',
            width: 30,
            height: 20,
            paths: [{ kind: 'road', from: 'west', to: 'east', meander: 0 }],
            fixtures: [{ name: 'the town', width: 2, height: 2, at: { x: 15, y: 5 } }],
            buildings: [{ at: { x: 4, y: 12 }, width: 6, height: 4, rooms: [{ key: 'hall', purpose: 'hall' }] }],
            links: [
                { key: 'road-east', at: { edge: 'east' }, to: null },
                { key: 'town', at: { fixture: 'the town' }, to: { map: 'town', link: 'road' } },
            ],
        });
        const ways = composeMap(region, TEST_ROLES).spec.features.flatMap((f) => (f.type === 'zone' && f.link !== undefined ? [f] : []));
        expect(ways.map((w) => w.name)).toEqual(['road-east', 'To town']);
        // The road's way stands over the edge where it leaves, the town's over the town.
        expect(ways[0]?.x).toBe(29);
        expect([ways[1]?.x, ways[1]?.y]).toEqual([15, 5]);
    });

    it('compose two maps whose ways name each other: the town’s inn door leads to the tavern’s front, and back', () => {
        const town = intentOf({
            key: 'town',
            width: 20,
            height: 16,
            buildings: [{ key: 'inn', at: { x: 6, y: 4 }, width: 8, height: 6, entrance: 'south', rooms: [{ key: 'hall', purpose: 'hall', entrance: true }] }],
            links: [{ key: 'inn-door', at: { building: 'inn' }, to: { map: 'tavern', link: 'front' } }],
        });
        const tavern = intentOf({
            key: 'tavern',
            width: 20,
            height: 16,
            buildings: [{ key: 'inn', at: { x: 6, y: 4 }, width: 8, height: 6, entrance: 'south', rooms: [{ key: 'hall', purpose: 'hall', entrance: true }] }],
            links: [{ key: 'front', at: { building: 'inn' }, to: { map: 'town', link: 'inn-door' } }],
        });
        const wayOf = (intent: MapIntent) => composeMap(intent, TEST_ROLES).spec.features.find((f) => f.type === 'zone' && f.link !== undefined);
        const there = wayOf(town);
        const back = wayOf(tavern);
        expect(there?.type === 'zone' ? there.link?.targets : null).toEqual([
            { scene: sceneIdOf('tavern'), region: back?.type === 'zone' ? back.link?.region : '' },
        ]);
        expect(back?.type === 'zone' ? back.link?.targets : null).toEqual([
            { scene: sceneIdOf('town'), region: there?.type === 'zone' ? there.link?.region : '' },
        ]);
        // Just inside the front door, in the bottom row of the entrance room.
        expect(there?.type === 'zone' ? there.y : null).toBe(9.5);
    });
});
