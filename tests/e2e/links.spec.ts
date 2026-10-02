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
