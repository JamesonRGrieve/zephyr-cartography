// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { catalogStamps, FAKE_SILHOUETTE, makeHarness } from './test-fakes';

const stamps = catalogStamps([
    {
        id: 'door',
        name: 'Door',
        category: 'Doors',
        scale: 'interior',
        perspective: 'top-down',
        variants: [
            { state: 'closed', image: 'closed.png', width: 100, height: 100 },
            { state: 'open', image: 'open.png', width: 100, height: 200 },
            { state: 'broken', image: 'broken.png', width: 100, height: 100 },
        ],
    },
]);

const walled = catalogStamps([
    {
        id: 'pillar',
        name: 'Pillar',
        category: 'Structural',
        scale: 'interior',
        perspective: 'top-down',
        occlusion: { shape: 'bounds', sound: false },
        variants: [{ state: 'whole', image: 'pillar.png', width: 100, height: 100 }],
    },
    {
        id: 'statue',
        name: 'Statue',
        category: 'Decor',
        scale: 'interior',
        perspective: 'top-down',
        occlusion: { shape: 'alpha' },
        variants: [
            { state: 'standing', image: 'standing.png', width: 100, height: 100 },
            { state: 'rubble', image: 'rubble.png', width: 100, height: 100, occlusion: { shape: 'none' } },
        ],
    },
]);

describe('CartographyController stamp occlusion', () => {
    it('wraps a bounds stamp in four walls blocking the declared senses', async () => {
        const { c, d } = makeHarness(walled);
        c.grid = { size: 100, originX: 0, originY: 0 };
        await c.placeStamp({ stamp: 'pack:pillar', x: 50, y: 50 });
        const walls = d.walls[0] ?? [];
        expect(walls.map((w) => [w.a, w.b])).toEqual([
            [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
            ],
            [
                { x: 100, y: 0 },
                { x: 100, y: 100 },
            ],
            [
                { x: 100, y: 100 },
                { x: 0, y: 100 },
            ],
            [
                { x: 0, y: 100 },
                { x: 0, y: 0 },
            ],
        ]);
        expect(walls[0]?.blocks).toEqual({ sight: 'normal', movement: true, light: 'normal', sound: 'none' });
        expect(c.getFeature('p1')?.docs.walls).toEqual(['w0', 'w1', 'w2', 'w3']);
    });

    it('walls an alpha stamp along its traced silhouette, and drops them for a variant without occlusion', async () => {
        const { c, d } = makeHarness(walled);
        c.grid = { size: 100, originX: 0, originY: 0 };
        await c.placeStamp({ stamp: 'pack:statue', x: 50, y: 50 });
        expect(d.walls[0]?.[0]).toMatchObject({ a: { x: 25, y: 25 }, b: { x: 75, y: 25 } });
        const placed = c.getFeature('p1');
        expect(placed?.type === 'stamp' ? placed.silhouette : null).toEqual(FAKE_SILHOUETTE);
        await c.setStampVariant('p1', 1);
        const rubble = c.getFeature('p1');
        expect(rubble?.type === 'stamp' ? rubble.silhouette : 'x').toBeNull();
        expect(rubble?.docs.walls).toEqual([]);
        expect(d.deletedIds()).toEqual(['w0', 'w1', 'w2', 'w3']);
    });

    it('falls back to the footprint when the image cannot be traced', async () => {
        const { c, d } = makeHarness(walled, null);
        c.grid = { size: 100, originX: 0, originY: 0 };
        await c.placeStamp({ stamp: 'pack:statue', x: 50, y: 50 });
        expect(d.walls[0]?.[0]).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } });
    });

    it('carries sense levels, one-way direction and thresholds to its walls, and walls nothing that restricts nothing', async () => {
        const hedges = catalogStamps([
            {
                id: 'hedge',
                name: 'Hedge',
                category: 'Nature',
                scale: 'exterior',
                perspective: 'top-down',
                occlusion: { shape: 'bounds', sight: 'limited', movement: false, light: 'proximity', sound: false, direction: 'left', threshold: { light: 3 } },
                variants: [{ state: 'grown', image: 'hedge.png', width: 100, height: 100 }],
            },
            {
                id: 'mist',
                name: 'Mist',
                category: 'Nature',
                scale: 'exterior',
                perspective: 'top-down',
                occlusion: { shape: 'bounds', sight: false, movement: false, light: false, sound: false },
                variants: [{ state: 'thin', image: 'mist.png', width: 100, height: 100 }],
            },
        ]);
        const { c, d } = makeHarness(hedges);
        c.grid = { size: 100, originX: 0, originY: 0 };
        await c.placeStamp({ stamp: 'pack:hedge', x: 50, y: 50 });
        expect(d.walls[0]?.[0]).toMatchObject({
            blocks: { sight: 'limited', movement: false, light: 'proximity', sound: 'none' },
            direction: 'left',
            threshold: { light: 3 },
        });
        await c.placeStamp({ stamp: 'pack:mist', x: 250, y: 50 });
        expect(c.getFeature('p2')?.docs.walls).toEqual([]);
    });

    it('moves the walls with the stamp', async () => {
        const { c, d } = makeHarness(walled);
        c.grid = { size: 100, originX: 0, originY: 0 };
        await c.placeStamp({ stamp: 'pack:pillar', x: 50, y: 50 });
        await c.syncStampFrame('p1', { x: 200, y: 0, width: 100, height: 100, rotation: 0 });
        expect(d.wallUpdates[0]?.[0]).toMatchObject({ id: 'w0', doc: { a: { x: 200, y: 0 }, b: { x: 300, y: 0 } } });
        expect(c.getFeature('p1')?.docs.walls).toEqual(['w0', 'w1', 'w2', 'w3']);
    });
});

const doors = catalogStamps([
    {
        id: 'door',
        name: 'Door',
        category: 'Doors',
        scale: 'interior',
        perspective: 'top-down',
        door: { type: 'door' },
        variants: [
            { state: 'shut', image: 'shut.png', width: 100, height: 20, doorState: 'closed' },
            { state: 'open', image: 'open.png', width: 100, height: 20, doorState: 'open' },
        ],
    },
]);

async function roomWithDoor(): Promise<ReturnType<typeof makeHarness>> {
    const h = makeHarness(doors);
    h.c.grid = { size: 100, originX: 0, originY: 0 };
    h.c.begin({ type: 'room', floor: 'dirt' }, 'click');
    for (const p of [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 300 },
        { x: 0, y: 300 },
    ]) {
        h.c.addPoint(p);
    }
    await h.c.commit(); // p1: 4 walls w0..w3 + light
    await h.c.placeStamp({ stamp: 'pack:door', x: 200, y: 30 }); // p2, snaps onto the top wall
    return h;
}

describe('CartographyController door stamps', () => {
    it('snaps onto a room wall, supplies the door wall, and cuts the room wall around it', async () => {
        const { c, d } = await roomWithDoor();
        expect(c.getFeature('p2')?.points).toEqual([{ x: 200, y: 0 }]);
        // One write: the door wall, then the room's walls re-synced around it.
        const [doorWall, ...resynced] = d.walls[1] ?? [];
        expect(doorWall).toEqual(expect.objectContaining({ a: { x: 150, y: 0 }, b: { x: 250, y: 0 }, door: 'door', doorState: 'closed' }));
        expect(resynced).toHaveLength(5);
        expect(c.getFeature('p1')?.docs.walls).toEqual(['w5', 'w6', 'w7', 'w8', 'w9']);
        expect(d.deletedIds()).toEqual(['w0', 'w1', 'w2', 'w3', 'L0']);
    });

    it('closes the wall again when the door is removed', async () => {
        const { c, d } = await roomWithDoor();
        await c.remove('p2');
        expect(d.walls[d.walls.length - 1]).toHaveLength(4);
    });

    it('does not touch rooms for changes to other stamps or door edits that leave the openings alone', async () => {
        const { c, d } = await roomWithDoor();
        const batches = d.wallWrites.length;
        await c.setStampVariant('p2', 1); // same axis → the room keeps its walls
        expect(d.wallWrites.length).toBe(batches + 1);
        expect(d.wallWrites[d.wallWrites.length - 1]).toEqual([expect.objectContaining({ doorState: 'open' })]);
    });

    it('follows a door opened in play by switching the stamp variant', async () => {
        const { c } = await roomWithDoor();
        const doorWall = c.getFeature('p2')?.docs.walls[0] ?? '';
        expect(await c.applyDoorState(doorWall, 'open')).toBe(true);
        const opened = c.getFeature('p2');
        expect(opened?.type === 'stamp' ? opened.variant : -1).toBe(1);
        const newWall = opened?.docs.walls[0] ?? '';
        expect(await c.applyDoorState(newWall, 'open')).toBe(false); // already open
        expect(await c.applyDoorState(newWall, 'locked')).toBe(false); // no variant shows it
        expect(await c.applyDoorState('w0', 'open')).toBe(false); // not a door stamp's wall
    });
});

describe('CartographyController stacked stamps', () => {
    const furniture = catalogStamps([
        {
            id: 'bar',
            name: 'Bar Counter',
            category: 'Furniture',
            tags: ['bar', 'counter'],
            scale: 'interior',
            perspective: 'top-down',
            variants: [{ state: 'x', image: 'bar.png', width: 300, height: 100 }],
        },
        {
            id: 'tankard',
            name: 'Tankard',
            category: 'Props',
            tags: ['tankard'],
            scale: 'interior',
            perspective: 'top-down',
            variants: [{ state: 'x', image: 't.png', width: 30, height: 30 }],
        },
    ]);

    it('stands a tankard set down on a bar at the bar’s top, so it is drawn on it, and leaves one on the floor at the floor', async () => {
        const { c, d } = makeHarness(furniture);
        c.grid = { size: 100, originX: 0, originY: 0 };
        c.gridDistance = 5;
        await c.placeStamp({ stamp: 'pack:bar', x: 500, y: 500 });
        const onBar = await c.placeStamp({ stamp: 'pack:tankard', x: 560, y: 500 });
        const onFloor = await c.placeStamp({ stamp: 'pack:tankard', x: 900, y: 900 });
        const elevationOf = (id: string | null): number | undefined => {
            const f = id === null ? null : c.getFeature(id);
            return f?.type === 'stamp' ? f.elevation : undefined;
        };
        // Half a square up, the pack giving the bar no height: 2.5 ft at 5 ft squares.
        expect(elevationOf(onBar)).toBe(2.5);
        expect(elevationOf(onFloor)).toBe(0);
        // Its tile, the second of the three written, stands there too.
        expect(d.tiles.flat()[1]?.elevation).toBe(2.5);
        // An elevation asked for outright is kept.
        const held = await c.placeStamp({ stamp: 'pack:tankard', x: 440, y: 500, elevation: 0 });
        expect(elevationOf(held)).toBe(0);
    });
});

describe('CartographyController stamps', () => {
    it('emits its ambient sound at the offset, radius in px, and silences it for a variant that sets none', async () => {
        const humming = catalogStamps([
            {
                id: 'generator',
                name: 'Generator',
                category: 'Machinery',
                scale: 'interior',
                perspective: 'top-down',
                sound: { path: 'hum.ogg', radius: 2, volume: 0.3, offset: { x: 1, y: 0.5 } },
                variants: [
                    { state: 'running', image: 'on.png', width: 100, height: 100 },
                    { state: 'off', image: 'off.png', width: 100, height: 100, sound: null },
                ],
            },
        ]);
        const { c, d } = makeHarness(humming);
        c.grid = { size: 100, originX: 0, originY: 0 };
        await c.placeStamp({ stamp: 'pack:generator', x: 250, y: 250 });
        expect(d.sounds).toEqual([
            [
                {
                    name: 'Generator',
                    x: 300,
                    y: 250,
                    radius: 200,
                    path: 'modules/pack/hum.ogg',
                    volume: 0.3,
                    repeat: true,
                    walls: true,
                    easing: true,
                    elevation: 0,
                    level: null,
                },
            ],
        ]);
        expect(c.getFeature('p1')?.docs.sounds).toEqual(['s0']);
        await c.setStampVariant('p1', 1);
        expect(c.getFeature('p1')?.docs.sounds).toEqual([]);
        expect(d.deletedIds()).toContain('s0');
    });

    it('places a stamp as a tracked native tile and removes it with the feature', async () => {
        const { c, d, s } = makeHarness(stamps);
        c.grid = { size: 100, originX: 0, originY: 0 };
        const id = await c.placeStamp({ stamp: 'pack:door', x: 250, y: 250 });
        expect(id).toBe('p1');
        expect(d.tiles).toEqual([
            [
                {
                    name: 'Door',
                    src: 'modules/pack/closed.png',
                    x: 200,
                    y: 200,
                    width: 100,
                    height: 100,
                    rotation: 0,
                    elevation: 0,
                    level: null,
                    featureId: 'p1',
                    // Art its tags name nothing is a fitting, which stands middling tall for its drop shadow.
                    shadow: 0.4,
                },
            ],
        ]);
        expect(c.getFeature('p1')?.docs.tiles).toEqual(['t0']);
        expect(s.last()[0]?.docs.tiles).toEqual(['t0']);
        expect(c.featureForTile('t0')).toBe('p1');
        await c.remove('p1');
        expect(d.deletedIds()).toEqual(['t0']);
    });

    it('refuses a stamp no loaded pack provides', async () => {
        const { c, d } = makeHarness(stamps);
        expect(await c.placeStamp({ stamp: 'pack:missing', x: 0, y: 0 })).toBeNull();
        expect(d.tiles).toEqual([]);
    });

    it('uses the pack reference grid on a gridless scene', async () => {
        const { c, d } = makeHarness(stamps);
        await c.placeStamp({ stamp: 'pack:door', x: 0, y: 0, scale: 0.5 });
        expect(d.tiles[0]?.[0]?.width).toBe(50);
    });

    it('cycles variants by updating the same tile in place', async () => {
        const { c, d } = makeHarness(stamps);
        await c.placeStamp({ stamp: 'pack:door', x: 0, y: 0 });
        expect(await c.cycleStampVariant('p1')).toBe(true);
        expect(await c.cycleStampVariant('p1', -1)).toBe(true);
        expect(await c.cycleStampVariant('p1', -1)).toBe(true);
        expect(d.tiles).toHaveLength(1);
        expect(d.deleted.every((batch) => batch.tiles.length === 0)).toBe(true);
        expect(d.tileUpdates.map((batch) => batch[0]?.tile.src)).toEqual(['modules/pack/open.png', 'modules/pack/closed.png', 'modules/pack/broken.png']);
        expect(d.tileUpdates.map((batch) => batch[0]?.id)).toEqual(['t0', 't0', 't0']);
        expect(c.getFeature('p1')?.docs.tiles).toEqual(['t0']);
    });

    it('sets an explicit variant, and refuses non-stamps and unknown ids', async () => {
        const { c } = makeHarness(stamps);
        await c.placeStamp({ stamp: 'pack:door', x: 0, y: 0 });
        expect(await c.setStampVariant('p1', 1)).toBe(true);
        const feature = c.getFeature('p1');
        expect(feature?.type === 'stamp' ? feature.height : 0).toBe(200);
        expect(await c.setStampVariant('nope', 1)).toBe(false);
        expect(await c.cycleStampVariant('nope')).toBe(false);
        c.begin({ type: 'path', kind: 'road' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 10, y: 0 });
        await c.commit(); // p2
        expect(await c.setStampVariant('p2', 0)).toBe(false);
    });

    it('adopts a native tile edit once, ending the update loop on the echo', async () => {
        const { c, d } = makeHarness(stamps);
        c.grid = { size: 100, originX: 0, originY: 0 };
        await c.placeStamp({ stamp: 'pack:door', x: 50, y: 50 });
        const frame = { x: 300, y: 400, width: 200, height: 100, rotation: 90 };
        expect(await c.syncStampFrame('p1', frame)).toBe(true);
        expect(c.getFeature('p1')?.points).toEqual([{ x: 400, y: 450 }]);
        expect(d.tileUpdates[0]?.[0]?.tile).toMatchObject({ x: 300, y: 400, width: 200, height: 100, rotation: 90 });
        expect(await c.syncStampFrame('p1', frame)).toBe(false);
        expect(d.tileUpdates).toHaveLength(1);
        expect(await c.syncStampFrame('missing', frame)).toBe(false);
    });

    it('moves a stamp by dragging its centre', async () => {
        const { c, d } = makeHarness(stamps);
        c.grid = { size: 100, originX: 0, originY: 0 };
        await c.placeStamp({ stamp: 'pack:door', x: 50, y: 50 });
        expect(c.pickVertex({ x: 52, y: 49 }, 5)).toEqual({ id: 'p1', index: 0 });
        await c.moveVertex('p1', 0, { x: 150, y: 50 });
        expect(d.tileUpdates[0]?.[0]?.tile).toMatchObject({ x: 100, y: 0 });
    });
});
