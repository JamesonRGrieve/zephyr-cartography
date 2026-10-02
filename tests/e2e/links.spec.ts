// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Ways between maps: two maps composed into scenes made under their maps'
 * ids, each with a way that names the other's, arrive joined: each way's
 * region teleports to the other's, both ways. A city's blocks each get a
 * native door with a way just inside it, leading nowhere until linked.
 */
import { linkRegionIdOf, sceneIdOf } from '../../src/compose/links';
import { expect, freshScene, test } from './lib/foundry';

const INN = { key: 'inn', at: { x: 6, y: 4 }, width: 8, height: 6, entrance: 'south', rooms: [{ key: 'hall', purpose: 'hall', entrance: true }] };

const TOWN = {
    schemaVersion: 1,
    key: 'e2e-town',
    width: 20,
    height: 15,
    buildings: [INN],
    links: [{ key: 'inn-door', at: { building: 'inn' }, to: { map: 'e2e-tavern', link: 'front' } }],
};

const TAVERN = {
    schemaVersion: 1,
    key: 'e2e-tavern',
    width: 20,
    height: 15,
    buildings: [INN],
    links: [{ key: 'front', at: { building: 'inn' }, to: { map: 'e2e-town', link: 'inn-door' } }],
};

test('two maps whose ways name each other arrive joined: each way teleports to the other, both ways', async ({ world }) => {
    const compose = async (intent: object): Promise<boolean> =>
        world.evaluate(async (given) => (await game.modules?.get('zephyr-cartography').api.compose(given))?.ok === true, intent);
    await freshScene(world, 'Town', undefined, sceneIdOf('e2e-town'));
    expect(await compose(TOWN)).toBe(true);
    await freshScene(world, 'Tavern', undefined, sceneIdOf('e2e-tavern'));
    expect(await compose(TAVERN)).toBe(true);

    const ways = await world.evaluate(
        ([town, tavern]) => {
            // v14 holds a teleport's destinations as a set of UUIDs, maybe relative to the behaviour: each resolved to its region.
            const leadsTo = (sceneId: string, regionId: string): string[] => {
                const scene: Scene | undefined = game.scenes?.get(sceneId);
                const region: RegionDocument | undefined = scene?.regions.get(regionId);
                const behaviour = region?.behaviors.contents[0];
                const system: object | undefined = behaviour?.system;
                return behaviour !== undefined && system !== undefined && 'destinations' in system && system.destinations instanceof Set
                    ? [...system.destinations].map((uuid) => {
                          const resolved = foundry.utils.fromUuidSync(String(uuid), { relative: behaviour })?.uuid;
                          return typeof resolved === 'string' ? resolved : String(uuid);
                      })
                    : [];
            };
            return {
                there: leadsTo(town.scene, town.region),
                back: leadsTo(tavern.scene, tavern.region),
            };
        },
        [
            { scene: sceneIdOf('e2e-town'), region: linkRegionIdOf('e2e-town', 'inn-door') },
            { scene: sceneIdOf('e2e-tavern'), region: linkRegionIdOf('e2e-tavern', 'front') },
        ] as const,
    );
    expect(ways.there).toEqual([`Scene.${sceneIdOf('e2e-tavern')}.Region.${linkRegionIdOf('e2e-tavern', 'front')}`]);
    expect(ways.back).toEqual([`Scene.${sceneIdOf('e2e-town')}.Region.${linkRegionIdOf('e2e-town', 'inn-door')}`]);
});

test('every block of a city has a native door, its way to the building’s own map just inside, leading nowhere yet', async ({ world }) => {
    const intent = {
        schemaVersion: 1,
        width: 20,
        height: 15,
        districts: [{ area: { x: 0, y: 0, w: 20, h: 15 }, street: 2, alley: 1, block: [4, 9], roofs: ['floor.deck-plating'], wall: 'wall.concrete' }],
    };
    const built = await world.evaluate(async (given) => {
        const composed = await game.modules?.get('zephyr-cartography').api.compose(given);
        const scene = canvas?.scene;
        const teleports = (scene?.regions.contents ?? []).filter((r) => r.behaviors.contents.some((b) => b.type === 'teleportToken'));
        return {
            ok: composed?.ok === true,
            doors: (scene?.walls.contents ?? []).filter((w) => w.door === 1).length,
            teleports: teleports.length,
        };
    }, intent);
    expect(built.ok).toBe(true);
    expect(built.doors).toBeGreaterThan(1);
    expect(built.teleports).toBe(built.doors);
});

test('ways stand over the edge a road leaves by, along an edge, over an area and at a two-storey house’s door, round the pieces its brief places', async ({
    world,
}) => {
    const house = {
        key: 'house',
        at: { x: 4, y: 3 },
        width: 10,
        height: 8,
        entrance: 'south',
        rooms: [
            {
                key: 'hall',
                purpose: 'hall',
                entrance: true,
                rect: { x: 0, y: 0, w: 6, h: 8 },
                opensTo: ['store'],
                furnish: 'fixtures',
                // Pieces placed exactly, which the stairwell must keep off: at a point, against a wall, in a corner, along a line,
                // and before another.
                fixtures: [
                    { name: 'centre chest', role: 'storage', width: 1, height: 1, place: { at: { x: 0.5, y: 0.5 } } },
                    { name: 'wall chest', role: 'storage', width: 1, height: 1, place: { wall: 'top', along: 'start' } },
                    { name: 'corner chest', role: 'storage', width: 1, height: 1, place: { corner: 'bottom-left' } },
                    { name: 'line of chests', role: 'storage', width: 1, height: 1, place: { line: { from: { x: 0.8, y: 0.2 }, to: { x: 0.8, y: 0.6 } } } },
                    { name: 'chest before', role: 'storage', width: 1, height: 1, place: { before: 'wall chest', gap: 0 } },
                ],
            },
            { key: 'store', purpose: 'storage', rect: { x: 6, y: 0, w: 4, h: 8 } },
        ],
        floors: [{ name: 'Upper floor', rooms: [{ key: 'loft', purpose: 'storage' }] }],
    };
    const intent = {
        schemaVersion: 1,
        seed: 11,
        key: 'e2e-farm',
        width: 20,
        height: 15,
        paths: [{ kind: 'road', from: 'west', to: 'east', meander: 0 }],
        buildings: [house],
        links: [
            { key: 'road-east', at: { edge: 'east' }, to: { map: 'e2e-region', link: 'farm' } },
            { key: 'north', at: { edge: 'north', along: 3 }, to: null },
            { key: 'cellar-hatch', at: { area: { x: 16, y: 1, w: 1, h: 1 } }, to: null },
            // No road leaves by the south edge: the way stands at its middle.
            { key: 'south', at: { edge: 'south' }, to: null },
            { key: 'house-door', at: { building: 'house' }, to: null },
        ],
    };
    const built = await world.evaluate(async (given) => {
        const composed = await game.modules?.get('zephyr-cartography').api.compose(given);
        const scene = canvas?.scene;
        const grid = scene?.grid.size ?? 1;
        const ways = (scene?.regions.contents ?? []).filter((r) => r.behaviors.contents.some((b) => b.type === 'teleportToken'));
        return {
            ok: composed?.ok === true,
            ways: ways.map((r) => {
                const shape = r.shapes[0];
                return shape?.type === 'rectangle' ? { x: shape.x / grid, y: shape.y / grid } : null;
            }),
            levels: scene?.levels.size ?? 0,
        };
    }, intent);
    expect(built.ok).toBe(true);
    // Two floors, and the five ways as rectangle regions.
    expect(built.levels).toBe(2);
    expect(built.ways).toHaveLength(5);
    expect(built.ways.some((w) => w !== null && w.y > 13 && Math.abs(w.x - 10) < 2)).toBe(true);
    // One stands over the east edge, where the road leaves the map; one at the north edge three squares along.
    expect(built.ways.some((w) => w !== null && w.x > 18)).toBe(true);
    expect(built.ways.some((w) => w !== null && w.y < 2 && w.x < 4)).toBe(true);
});

test('a map is refused, building nothing, where its ways need a key it lacks or stand at places not on it', async ({ world }) => {
    const base = { schemaVersion: 1, width: 20, height: 15 };
    const intents = [
        { ...base, links: [{ key: 'north', at: { edge: 'north' } }] },
        { ...base, key: 'farm', links: [{ key: 'door', at: { building: 'barn' } }] },
        { ...base, key: 'farm', links: [{ key: 'well', at: { fixture: 'the well' } }] },
        { ...base, key: 'farm', links: [{ key: 'pit', at: { area: { x: 19, y: 14, w: 3, h: 3 } } }] },
    ];
    const refused = await world.evaluate(async (all) => {
        const api = game.modules?.get('zephyr-cartography').api;
        const messages: string[] = [];
        for (const intent of all) {
            // eslint-disable-next-line no-await-in-loop -- one scene: each refusal is checked before the next intent
            const composed = await api?.compose(intent);
            messages.push(composed?.ok === false ? composed.issues.map((i) => i.message).join('; ') : 'built');
        }
        return { messages, walls: canvas?.scene?.walls.size, regions: canvas?.scene?.regions.size };
    }, intents);
    expect(refused.messages).toEqual([
        expect.stringContaining('needs its own key'),
        expect.stringContaining('no building named barn'),
        expect.stringContaining('no piece outside named the well'),
        expect.stringContaining('an area off the map'),
    ]);
    expect([refused.walls, refused.regions]).toEqual([0, 0]);
});
