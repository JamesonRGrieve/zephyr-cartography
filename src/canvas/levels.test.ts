// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { NO_LEVEL_ART } from '../tools/levels';
import { DEFAULT_ROOM_MATERIALS } from '../tools/room';
import { catalogStamps, makeHarness } from './test-fakes';

const stairs = catalogStamps([
    {
        id: 'stairs',
        name: 'Stairs',
        category: 'Access',
        scale: 'interior',
        perspective: 'top-down',
        transition: { kind: 'stairs', direction: 'up' },
        variants: [{ state: 'stone', image: 'stairs.png', width: 100, height: 100 }],
    },
    {
        id: 'well',
        name: 'Stairwell',
        category: 'Access',
        scale: 'interior',
        perspective: 'top-down',
        transition: { kind: 'stairs', direction: 'both' },
        variants: [{ state: 'stone', image: 'well.png', width: 100, height: 100 }],
    },
    {
        id: 'ladder',
        name: 'Ladder',
        category: 'Access',
        scale: 'interior',
        perspective: 'top-down',
        transition: { kind: 'ladder', direction: 'up', movement: ['climb'] },
        variants: [{ state: 'iron', image: 'ladder.png', width: 100, height: 100 }],
    },
]);

async function drawRoom(c: ReturnType<typeof makeHarness>['c']): Promise<void> {
    c.begin({ type: 'room', floor: 'dirt' }, 'click');
    for (const p of [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
    ]) {
        c.addPoint(p);
    }
    await c.commit();
}

describe('CartographyController levels', () => {
    it('adds levels four grid squares tall', async () => {
        const { c } = makeHarness();
        c.gridDistance = 5;
        await c.addLevel('above', 'Ground');
        await c.addLevel('above', 'Upper');
        expect(c.levels.map((l) => [l.bottom, l.top])).toEqual([
            [0, 20],
            [20, 40],
        ]);
    });

    it('adds levels above and below, making each active', async () => {
        const { c } = makeHarness();
        const ground = await c.addLevel('above', 'Ground');
        const upper = await c.addLevel('above', 'Upper');
        const cellar = await c.addLevel('below', 'Cellar');
        expect(c.levels.map((l) => [l.name, l.bottom, l.top])).toEqual([
            ['Cellar', -10, 0],
            ['Ground', 0, 10],
            ['Upper', 10, 20],
        ]);
        expect([ground, upper, cellar]).toEqual(['lv1', 'lv2', 'lv3']);
        expect(c.activeLevel).toBe('lv3');
    });

    it('puts new features on the active level, at its elevation', async () => {
        const { c, d } = makeHarness();
        await c.addLevel('above', 'Ground');
        await c.addLevel('above', 'Upper');
        await drawRoom(c); // on Upper (lv2)
        expect(c.getFeature('p1')?.level).toBe('lv2');
        expect(d.walls[0]?.every((w) => w.level === 'lv2')).toBe(true);
        expect(d.lights[0]?.[0]?.elevation).toBe(10);
        expect(c.levelCounts()).toEqual({ lv2: 1 });
    });

    it('shows and picks only the active level, plus level-less features', async () => {
        const { c, r } = makeHarness();
        await drawRoom(c); // p1, no level
        await c.addLevel('above', 'Ground'); // active lv1
        await drawRoom(c); // p2 on lv1
        await c.addLevel('above', 'Upper'); // active lv2
        r.setIds.length = 0;
        c.setActiveLevel('lv2');
        // Already the level being edited: nothing is redrawn.
        expect(r.setIds).toEqual([]);
        c.setActiveLevel('lv1');
        r.setIds.length = 0;
        c.setActiveLevel('lv2');
        expect(r.setIds).toEqual(['p1']);
        expect(c.hitTest({ x: 90, y: 10 })).toBe('p1');
        c.setActiveLevel('lv1');
        expect(c.hitTest({ x: 90, y: 10 })).toBe('p2');
        c.setActiveLevel(null);
        expect(r.setIds.slice(-2)).toEqual(['p1', 'p2']);
        c.setActiveLevel('missing');
        expect(c.activeLevel).toBeNull();
    });

    it('draws the levels the active one sees below it beneath its own, and picks only its own', async () => {
        const { c, r, l } = makeHarness();
        await drawRoom(c); // p1, no level
        await c.addLevel('above', 'Ground'); // active lv1
        await drawRoom(c); // p2 on lv1
        await c.addLevel('above', 'Upper'); // active lv2
        // The upper storey sees the ground below it (the yard round it).
        l.levels = l.levels.map((level) => (level.id === 'lv2' ? { ...level, art: { ...NO_LEVEL_ART, visibleLevels: ['lv1'] } } : level));
        c.setActiveLevel('lv1');
        await c.reloadLevels();
        r.setIds.length = 0;
        c.setActiveLevel('lv2');
        // The ground's room first, beneath; then the upper storey's own.
        expect(r.setIds).toEqual(['p2', 'p1']);
        expect(c.hitTest({ x: 90, y: 10 })).toBe('p1');
        // Seen from the ground, the upper storey is not drawn.
        r.setIds.length = 0;
        c.setActiveLevel('lv1');
        expect(r.setIds).toEqual(['p1', 'p2']);
    });

    it('drops the features of a level deleted outside the plugin, from the scene and the undo history', async () => {
        const { c, l, s } = makeHarness();
        await drawRoom(c); // p1, no level
        await c.addLevel('above', 'Ground');
        await drawRoom(c); // p2 on lv1
        await c.addLevel('above', 'Upper');
        await drawRoom(c); // p3 on lv2
        // A GM deletes Ground natively; Foundry deletes its documents with it.
        await l.remove('lv1');
        await c.reloadLevels();
        expect(s.last().map((f) => f.id)).toEqual(['p1', 'p3']);
        expect(c.getFeature('p2')).toBeNull();
        await c.undo(); // takes back p3, and cannot bring p2 back onto the missing level
        expect(s.last().map((f) => f.id)).toEqual(['p1']);
        await c.undo();
        expect(s.last().map((f) => f.id)).toEqual(['p1']);
    });

    it('refuses to remove a level with features on it', async () => {
        const { c } = makeHarness();
        await c.addLevel('above', 'Ground');
        await drawRoom(c);
        expect(await c.removeLevel('lv1')).toBe(false);
        await c.remove('p1');
        expect(await c.removeLevel('lv1')).toBe(true);
        expect(c.levels).toEqual([]);
        expect(c.activeLevel).toBeNull();
    });

    it('renames, re-bands (re-syncing what sits on the level) and rejects inverted bands', async () => {
        const { c, d } = makeHarness();
        await c.addLevel('above', 'Ground');
        await drawRoom(c);
        await c.renameLevel('lv1', '  Hall  ');
        await c.renameLevel('lv1', ' ');
        expect(c.levels[0]?.name).toBe('Hall');
        expect(await c.setLevelBand('lv1', 5, 15)).toBe(true);
        expect(d.lights[d.lights.length - 1]?.[0]?.elevation).toBe(5);
        expect(await c.setLevelBand('lv1', 15, 5)).toBe(false);
        expect(await c.setLevelBand('nope', 0, 5)).toBe(false);
    });

    it('sets a level’s own images without re-syncing what stands on it, and refuses an unknown level', async () => {
        const { c, d, l } = makeHarness();
        await c.addLevel('above', 'Ground');
        c.setActiveLevel('lv1');
        await drawRoom(c);
        const writes = d.writes.length;
        const art = { ...NO_LEVEL_ART, background: 'maps/ground.webp', fog: 'maps/fog.webp', backgroundColor: '#202020' };
        expect(await c.setLevelArt('lv1', art)).toBe(true);
        expect(l.levels[0]?.art).toEqual(art);
        expect(c.levels[0]?.art).toEqual(art);
        expect(d.writes).toHaveLength(writes);
        expect(await c.setLevelArt('nope', art)).toBe(false);
    });

    it('re-syncs what stands on the levels when which levels one sees changes: a stamp’s tile shows on those that see its own', async () => {
        const { c, d } = makeHarness();
        await c.addLevel('above', 'Ground');
        await c.addLevel('above', 'Upper');
        c.setActiveLevel('lv1');
        await drawRoom(c);
        const writes = d.writes.length;
        const upper = c.levels.find((level) => level.id === 'lv2');
        expect(await c.setLevelArt('lv2', { ...(upper?.art ?? NO_LEVEL_ART), visibleLevels: ['lv1'] })).toBe(true);
        expect(d.writes.length).toBeGreaterThan(writes);
    });

    it('gives a room on an upper level a solid floor over the level below, and a ground-floor room none', async () => {
        const { c, d } = makeHarness();
        await c.addLevel('above', 'Ground');
        await c.addLevel('above', 'Upper');
        c.setActiveLevel('lv2');
        await drawRoom(c);
        // The top level has nothing above it, so no ceiling either.
        expect(d.regions.flat()).toEqual([
            expect.objectContaining({
                label: { kind: 'floor', level: 'Upper' },
                level: 'lv2',
                spans: ['lv1'],
                bottom: 10,
                top: 10,
                behaviour: { kind: 'surface', placement: 'bottom', reveal: false },
            }),
        ]);
        c.setActiveLevel('lv1');
        await drawRoom(c);
        expect(d.regions.flat().filter((r) => r.label.kind === 'floor')).toHaveLength(1);
    });

    it('gives a room under another level a solid ceiling at its band’s top, on both levels, unless it is open to the sky', async () => {
        const { c, d } = makeHarness();
        await c.addLevel('above', 'Ground');
        await c.addLevel('above', 'Upper');
        c.setActiveLevel('lv1');
        await drawRoom(c);
        expect(d.regions.flat()).toEqual([
            expect.objectContaining({
                label: { kind: 'ceiling', level: 'Ground' },
                level: 'lv1',
                spans: ['lv2'],
                bottom: 10,
                top: 10,
                behaviour: { kind: 'surface', placement: 'top', reveal: false },
            }),
        ]);
        expect(c.roomMaterials('p1')?.ceiling).toBe(true);
        await c.setRoomMaterials('p1', { ...DEFAULT_ROOM_MATERIALS, ceiling: false });
        expect(c.getFeature('p1')?.docs.regions).toEqual([]);
    });

    it('joins a stair to the level above with one changeLevel region spanning both', async () => {
        const { c, d } = makeHarness(stairs);
        c.grid = { size: 100, originX: 0, originY: 0 };
        await c.addLevel('above', 'Ground');
        await c.addLevel('above', 'Upper');
        c.setActiveLevel('lv1');
        await c.placeStamp({ stamp: 'pack:stairs', x: 50, y: 50 });
        expect(d.regions[0]).toEqual([
            expect.objectContaining({
                level: 'lv1',
                bottom: 0,
                top: 20,
                spans: ['lv2'],
                behaviour: { kind: 'changeLevel', movement: [] },
                label: { kind: 'stairs', from: 'Ground', to: ['Upper'] },
            }),
        ]);
        expect(c.getFeature('p1')?.docs.regions).toEqual(['r0']);
    });

    it('plans no region for a stair with nowhere to go, and adds it when a level appears', async () => {
        const { c, d } = makeHarness(stairs);
        await c.addLevel('above', 'Ground');
        await c.placeStamp({ stamp: 'pack:stairs', x: 50, y: 50 });
        expect(d.regions).toEqual([]);
        await c.addLevel('above', 'Upper');
        expect(d.regions[0]?.map((r) => [r.level, r.spans, r.behaviour])).toEqual([['lv1', ['lv2'], { kind: 'changeLevel', movement: [] }]]);
    });

    it('takes a ladder only by the movement its pack names', async () => {
        const { c, d } = makeHarness(stairs);
        await c.addLevel('above', 'Ground');
        await c.addLevel('above', 'Upper');
        c.setActiveLevel('lv1');
        await c.placeStamp({ stamp: 'pack:ladder', x: 50, y: 50 });
        expect(d.regions[0]?.map((r) => r.behaviour)).toEqual([{ kind: 'changeLevel', movement: ['climb'] }]);
    });

    it('offers both ways from a stairwell, over all three bands', async () => {
        const { c, d } = makeHarness(stairs);
        await c.addLevel('above', 'Ground');
        await c.addLevel('above', 'Upper');
        await c.addLevel('below', 'Cellar');
        c.setActiveLevel('lv1');
        await c.placeStamp({ stamp: 'pack:well', x: 50, y: 50 });
        const [well] = d.regions[d.regions.length - 1] ?? [];
        expect(well).toMatchObject({ bottom: -10, top: 20, level: 'lv1', spans: ['lv2', 'lv3'], behaviour: { kind: 'changeLevel', movement: [] } });
    });
});
