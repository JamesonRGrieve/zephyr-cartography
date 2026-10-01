// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { DEFAULT_TRAVEL } from '../tools/submap';
import { catalogStamps, makeHarness } from './test-fakes';

const buildings = catalogStamps([
    {
        id: 'residence',
        name: 'Residence Block',
        category: 'Structures',
        scale: 'city',
        perspective: 'top-down',
        enterable: true,
        variants: [{ state: 'intact', image: 'residence.png', width: 200, height: 100 }],
    },
    {
        id: 'crate',
        name: 'Crate',
        category: 'Storage',
        scale: 'interior',
        perspective: 'top-down',
        variants: [{ state: 'x', image: 'c.png', width: 100, height: 100 }],
    },
]);

async function placed(): Promise<ReturnType<typeof makeHarness>> {
    const h = makeHarness(buildings);
    h.c.grid = { size: 100, originX: 0, originY: 0 };
    await h.c.placeStamp({ stamp: 'pack:residence', x: 100, y: 50 }); // p1
    await h.c.placeStamp({ stamp: 'pack:crate', x: 500, y: 500 }); // p2
    return h;
}

describe('CartographyController submaps', () => {
    it('creates an interior scene and wires entrance and exit to each other', async () => {
        const { c, d, w } = await placed();
        const sceneId = await c.createInterior('p1', 'Residence Block interior');
        expect(sceneId).toBe('sc1');
        const link = c.submapOf('p1');
        expect(link).toEqual({ scene: 'sc1', sceneName: 'Residence Block interior', entryRegion: 'p3', exitRegion: 'p4', travel: DEFAULT_TRAVEL });
        const exit = w.regions[0];
        expect(exit?.scene).toBe('sc1');
        expect(exit?.region).toMatchObject({
            id: 'p4',
            label: { kind: 'exit', scene: 'Town' },
            behaviour: { kind: 'teleport', targets: [{ scene: 'here', region: 'p3' }] },
        });
        expect(exit?.region.polygon[0]).toEqual({ x: 450, y: 350 });
        const entrance = d.regions[d.regions.length - 1]?.[0];
        expect(entrance).toMatchObject({
            id: 'p3',
            label: { kind: 'entrance', scene: 'Residence Block interior' },
            behaviour: { kind: 'teleport', targets: [{ scene: 'sc1', region: 'p4' }] },
        });
        expect(entrance?.polygon).toHaveLength(4);
        expect(c.getFeature('p1')?.docs.regions).toEqual(['p3']);
    });

    it('changes how tokens travel both ways: the entrance in place, the exit where the GM left it', async () => {
        const { c, d, w } = await placed();
        await c.createInterior('p1', 'Residence Block interior');
        const travel = { placement: 'center' as const, snap: false, revealed: true, transition: 'fade', duration: 800, prompt: 'Enter {scene}?' };
        expect(await c.setSubmapTravel('p1', travel)).toBe(true);
        expect(c.submapOf('p1')?.travel).toEqual(travel);
        // The entrance keeps its id and is redrawn in place; the exit's teleport is updated in the interior.
        expect(d.writes.at(-1)?.regionUpdates).toMatchObject([{ id: 'p3', doc: { behaviour: { travel } } }]);
        expect(w.teleports).toMatchObject([{ scene: 'sc1', region: { id: 'p4', behaviour: { travel } } }]);
        expect(await c.setSubmapTravel('nope', travel)).toBe(false);
    });

    it('links an existing scene, and relinking removes the old exit first', async () => {
        const { c, w } = await placed();
        expect(await c.linkSubmap('p1', 'vault')).toBe(true);
        expect(await c.createInterior('p1', 'Annex')).toBe('sc1');
        expect(w.deleted).toEqual([{ scene: 'vault', region: 'p4' }]);
        expect(c.submapOf('p1')?.scene).toBe('sc1');
    });

    it('keeps the entrance id when the stamp moves, so the exit still points at it', async () => {
        const { c, d } = await placed();
        await c.linkSubmap('p1', 'vault');
        const created = d.regions.length;
        await c.syncStampFrame('p1', { x: 300, y: 300, width: 200, height: 100, rotation: 0 });
        // Redrawn in place, not deleted and recreated (Foundry rejects both on one id in a batch).
        expect(d.regions).toHaveLength(created);
        expect(d.deletedIds()).toEqual([]);
        const entrance = d.regionUpdates[d.regionUpdates.length - 1]?.[0];
        expect(entrance?.id).toBe('p3');
        expect(entrance?.polygon[0]).toEqual({ x: 300, y: 300 });
    });

    it('unlinks, and deletes the exit with the stamp', async () => {
        const first = await placed();
        await first.c.linkSubmap('p1', 'vault');
        expect(await first.c.unlinkSubmap('p1')).toBe(true);
        expect(first.c.submapOf('p1')).toBeNull();
        expect(first.w.deleted).toEqual([{ scene: 'vault', region: 'p4' }]);
        expect(first.d.deletedIds()).toContain('p3');
        expect(await first.c.unlinkSubmap('p1')).toBe(false);

        const second = await placed();
        await second.c.linkSubmap('p1', 'vault');
        await second.c.remove('p1');
        expect(second.w.deleted).toEqual([{ scene: 'vault', region: 'p4' }]);
    });

    it('gives a building its floors in this scene: levels above the top one, joined to its own by stairs', async () => {
        const { c, d } = await placed();
        c.gridDistance = 5;
        await c.addLevel('above', 'Ground');
        // A stamp on every level stands on the lowest once its floors climb from there.
        expect(await c.addBuildingFloors('p1', ['Residence floor 1', 'Residence floor 2'])).toBe(true);
        expect(c.levels.map((l) => [l.name, l.bottom, l.top])).toEqual([
            ['Ground', 0, 20],
            ['Residence floor 1', 20, 40],
            ['Residence floor 2', 40, 60],
        ]);
        const residence = c.getFeature('p1');
        expect(residence?.level).toBe('lv1');
        expect(c.buildingFloors('p1')).toEqual(['lv2', 'lv3']);
        const stairs = d.regions.flat().find((r) => r.label.kind === 'stairs');
        expect(stairs).toMatchObject({ level: 'lv1', spans: ['lv2', 'lv3'], bottom: 0, top: 60, behaviour: { kind: 'changeLevel', movement: [] } });

        expect(await c.removeBuildingFloors('p1')).toBe(true);
        expect(c.buildingFloors('p1')).toEqual([]);
        expect(c.levels).toHaveLength(3);
        expect(await c.removeBuildingFloors('p1')).toBe(false);
        expect(await c.addBuildingFloors('p2', ['x'])).toBe(false);
        expect(await c.addBuildingFloors('p1', [])).toBe(false);
    });

    it('refuses stamps that are not enterable, missing scenes, and the current scene', async () => {
        const { c, w } = await placed();
        expect(await c.linkSubmap('p2', 'vault')).toBe(false);
        expect(await c.createInterior('p2', 'x')).toBeNull();
        expect(await c.linkSubmap('p1', 'nowhere')).toBe(false);
        expect(await c.linkSubmap('p1', 'here')).toBe(false);
        expect(c.submapOf('p2')).toBeNull();
        expect(w.regions).toEqual([]);
    });
});
