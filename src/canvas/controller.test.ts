// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Feature } from '../tools/feature';
import { NO_DOCS } from '../tools/generated-docs';
import { NEW_DOOR } from '../tools/room';
import { makeHarness as make } from './test-fakes';

describe('CartographyController', () => {
    it('commits a road path: renders, persists, no walls by default', async () => {
        const { c, r, s, d } = make();
        c.begin({ type: 'path', kind: 'road' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 10, y: 0 });
        expect(r.previews).toBeGreaterThanOrEqual(1);
        await c.commit();
        expect(r.setIds).toEqual(['p1']);
        expect(s.saved).toHaveLength(1);
        expect(d.walls).toEqual([]);
    });

    it('commits a freehand brush stroke', async () => {
        const { c, r, s } = make();
        c.begin({ type: 'stroke', biome: 'grassland' }, 'freehand');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 10, y: 2 });
        c.addPoint({ x: 20, y: 0 });
        await c.commit();
        expect(r.setIds).toEqual(['p1']);
        expect(s.saved).toHaveLength(1);
        expect(s.saved[0]?.[0]?.type).toBe('stroke');
    });

    it('commits a grid-snapped room', async () => {
        const { c, s } = make();
        c.grid = { size: 100, originX: 0, originY: 0 };
        c.begin({ type: 'room', floor: 'dirt' }, 'click');
        c.addPoint({ x: 12, y: 8 });
        c.addPoint({ x: 105, y: 3 });
        c.addPoint({ x: 98, y: 96 });
        await c.commit();
        const saved = s.last()[0];
        expect(saved?.type).toBe('room');
        expect(saved?.points[0]).toEqual({ x: 0, y: 0 });
        expect(saved?.points[1]).toEqual({ x: 100, y: 0 });
        expect(saved?.points[2]).toEqual({ x: 100, y: 100 });
    });

    it('generates native Foundry walls + a light for a room and cleans them up on removal', async () => {
        const { c, d, s } = make();
        c.begin({ type: 'room', floor: 'dirt' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 100, y: 0 });
        c.addPoint({ x: 100, y: 100 });
        await c.commit(); // p1 — a 3-point room => 3 perimeter segments + 1 centre light
        expect(d.walls.map((batch) => batch.length)).toEqual([3]);
        expect(d.lights).toHaveLength(1);
        expect(c.getFeature('p1')?.docs).toEqual({ ...NO_DOCS, walls: ['w0', 'w1', 'w2'], lights: ['L0'] });
        expect(s.last()[0]?.docs.walls).toEqual(['w0', 'w1', 'w2']);
        await c.remove('p1');
        expect(d.deletedIds()).toEqual(['w0', 'w1', 'w2', 'L0']);
    });

    /** Draw a room through `xs`, the first two on y=0 and the rest on y=100. */
    async function drawRoom(c: ReturnType<typeof make>['c'], xs: readonly number[]): Promise<void> {
        c.begin({ type: 'room', floor: 'dirt' }, 'click');
        for (const [i, x] of xs.entries()) {
            c.addPoint({ x, y: i < 2 ? 0 : 100 });
        }
        await c.commit();
    }

    it('writes an edit and every neighbour it re-syncs as one transaction', async () => {
        const { c, d } = make();
        await drawRoom(c, [0, 100, 100, 0]);
        await drawRoom(c, [100, 200, 200, 100]); // shares an edge with p1, which re-syncs
        expect(d.writes).toHaveLength(2);
        await c.remove('p1'); // p2 takes the shared edge back
        expect(d.writes).toHaveLength(3);
    });

    it('rolls the features, the store and the undo history back when a write is rejected', async () => {
        const { c, d, s } = make();
        await drawRoom(c, [0, 100, 100]);
        const committed = c.getFeature('p1');
        d.rejecting = true;
        await expect(c.moveVertex('p1', 2, { x: 300, y: 300 })).rejects.toThrow('batch rejected');
        expect(c.getFeature('p1')).toEqual(committed);
        expect(s.last()).toEqual([committed]);
        await expect(c.remove('p1')).rejects.toThrow('batch rejected');
        expect(c.getFeature('p1')).toEqual(committed);
        d.rejecting = false;
        // The failed edits left no undo steps: one undo takes back the commit.
        await c.undo();
        expect(s.last()).toEqual([]);
    });

    it('sizes a room light to reach its farthest corner', async () => {
        const { c, d } = make();
        c.begin({ type: 'room', floor: 'dirt' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 60, y: 0 });
        c.addPoint({ x: 60, y: 80 });
        c.addPoint({ x: 0, y: 80 });
        await c.commit();
        const light = d.lights[0]?.[0];
        expect(light?.x).toBe(30);
        expect(light?.y).toBe(40);
        expect(light?.dim).toBe(50);
        expect(light?.bright).toBe(25);
    });

    it('re-syncs native walls when a room vertex moves', async () => {
        const { c, d } = make();
        c.begin({ type: 'room', floor: 'dirt' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 100, y: 0 });
        c.addPoint({ x: 100, y: 100 });
        await c.commit(); // p1 — 3 walls
        await c.moveVertex('p1', 1, { x: 120, y: 0 });
        expect(d.deletedIds()).toEqual(['L0']); // the light is replaced
        expect(d.walls.map((batch) => batch.length)).toEqual([3]); // created on commit...
        expect(d.wallUpdates[0]?.map((u) => u.id)).toEqual(['w0', 'w1', 'w2']); // ...then moved in place, keeping their ids
        expect(d.wallUpdates[0]?.[0]?.doc.b).toEqual({ x: 120, y: 0 });
        expect(c.getFeature('p1')?.docs.walls).toEqual(['w0', 'w1', 'w2']);
    });

    it('toggles a room wall segment into a Foundry door and back', async () => {
        const { c, d } = make();
        c.begin({ type: 'room', floor: 'dirt' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 100, y: 0 });
        c.addPoint({ x: 100, y: 100 });
        await c.commit(); // p1
        expect(c.pickWallSegment({ x: 50, y: 1 }, 8)).toEqual({ id: 'p1', index: 0 });
        await c.toggleDoor('p1', 0);
        const lastSpecs = d.wallWrites[d.wallWrites.length - 1];
        expect(lastSpecs?.[0]?.door).toBe('door');
        expect(lastSpecs?.[1]?.door).toBe('none');
        await c.toggleDoor('p1', 0);
        const room = c.getFeature('p1');
        const doorCount = room?.type === 'room' ? room.doors.length : -1;
        expect(doorCount).toBe(0);
    });

    it('sets a room door type and state, and refuses segments the room lacks', async () => {
        const { c, d } = make();
        c.begin({ type: 'room', floor: 'dirt' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 100, y: 0 });
        c.addPoint({ x: 100, y: 100 });
        await c.commit();
        expect(await c.setRoomDoor('p1', 1, { ...NEW_DOOR, type: 'secret', state: 'locked', sound: 'woodCreaky', animation: 'slide' })).toBe(true);
        expect(c.roomDoor('p1', 1)).toEqual({ segment: 1, type: 'secret', state: 'locked', sound: 'woodCreaky', animation: 'slide' });
        expect(d.wallWrites[d.wallWrites.length - 1]?.[1]).toMatchObject({
            door: 'secret',
            doorState: 'locked',
            look: { sound: 'woodCreaky', animation: { type: 'slide' } },
        });
        expect(await c.setRoomDoor('p1', 7, NEW_DOOR)).toBe(false);
        expect(await c.setRoomDoor('nope', 0, null)).toBe(false);
        expect(c.roomDoor('nope', 0)).toBeNull();
    });

    it('records a room door opened in play without recreating its walls', async () => {
        const { c, d, s } = make();
        c.begin({ type: 'room', floor: 'dirt' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 100, y: 0 });
        c.addPoint({ x: 100, y: 100 });
        await c.commit();
        await c.toggleDoor('p1', 1);
        const doorWall = c.getFeature('p1')?.docs.walls[1] ?? '';
        const batches = d.walls.length;
        expect(await c.applyDoorState(doorWall, 'open')).toBe(true);
        expect(c.roomDoor('p1', 1)?.state).toBe('open');
        expect(d.walls.length).toBe(batches);
        expect(s.last()[0]?.type === 'room' ? s.last()[0] : null).toMatchObject({ doors: [{ segment: 1, state: 'open' }] });
        expect(await c.applyDoorState(doorWall, 'open')).toBe(false);
        const plainWall = c.getFeature('p1')?.docs.walls[0] ?? '';
        expect(await c.applyDoorState(plainWall, 'open')).toBe(false);
    });

    it('commits a biome region', async () => {
        const { c, r, s } = make();
        c.begin({ type: 'region', biome: 'water' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 10, y: 0 });
        c.addPoint({ x: 5, y: 10 });
        await c.commit();
        expect(r.setIds).toEqual(['p1']);
        expect(s.saved).toHaveLength(1);
    });

    it('emits tracked walls of the chosen kind for a path, and deletes them with the path', async () => {
        const { c, d } = make();
        c.pathWalls = 'terrain';
        c.begin({ type: 'path', kind: 'river' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 10, y: 10 });
        await c.commit();
        const created = d.walls[0] ?? [];
        expect(created.length).toBeGreaterThan(0);
        expect(created.every((w) => w.blocks.sight === 'limited' && w.blocks.movement)).toBe(true);
        expect(c.getFeature('p1')?.docs.walls).toHaveLength(created.length);
        await c.remove('p1');
        expect(d.deletedIds()).toHaveLength(created.length);
    });

    it('does not commit a region with too few points', async () => {
        const { c, s } = make();
        c.begin({ type: 'region', biome: 'forest' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 10, y: 0 });
        await c.commit();
        expect(s.saved).toEqual([]);
        expect(c.drawing).toBe(false);
    });

    it('loads and renders existing features', () => {
        const { c, r, s } = make();
        s.data = [
            {
                type: 'path',
                id: 'a',
                kind: 'road',
                points: [
                    { x: 0, y: 0 },
                    { x: 5, y: 5 },
                ],
                halfWidths: [10, 10],
                handles: [null, null],
                walls: null,
                river: null,
                surface: null,
                docs: NO_DOCS,
                level: null,
            },
        ];
        c.load();
        expect(r.cleared).toBe(1);
        expect(r.setIds).toEqual(['a']);
    });

    it('takes features saved by another writer, and leaves its own as they are', () => {
        const { c, r, s } = make();
        const road = (id: string): Feature => ({
            type: 'path',
            id,
            kind: 'road',
            points: [
                { x: 0, y: 0 },
                { x: 5, y: 5 },
            ],
            halfWidths: [10, 10],
            handles: [null, null],
            walls: null,
            river: null,
            surface: null,
            docs: NO_DOCS,
            level: null,
        });
        s.data = [road('a')];
        c.load();
        // Saved as it holds them: no redraw.
        c.reloadIfChanged();
        expect(r.cleared).toBe(1);
        // Saved by another (a controller replaced mid-build, another client): taken and drawn.
        s.data = [road('a'), road('b')];
        c.reloadIfChanged();
        expect(r.cleared).toBe(2);
        expect(r.setIds).toEqual(['a', 'a', 'b']);
    });

    it('cancels a drawing without a trace, and previews a point dragged without saving it', () => {
        const { c, r, s } = make();
        c.begin({ type: 'region', biome: 'sand' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.cancel();
        expect(c.drawing).toBe(false);
        s.data = [
            {
                type: 'region',
                id: 'a',
                biome: 'sand',
                texture: null,
                sharp: false,
                points: [
                    { x: 0, y: 0 },
                    { x: 5, y: 0 },
                    { x: 5, y: 5 },
                ],
                docs: NO_DOCS,
                level: null,
            },
        ];
        c.load();
        const previews = r.previews;
        c.previewVertexMove('a', 1, { x: 9, y: 0 });
        c.previewVertexMove('missing', 1, { x: 9, y: 0 });
        expect(r.previews).toBe(previews + 1);
        c.clearPreview();
        expect(s.saved).toEqual([]);
    });

    it('reorders a feature to the front, the back, and one step either way', async () => {
        const { c, s } = make();
        const region = (id: string): Feature => ({
            type: 'region',
            id,
            biome: 'sand',
            texture: null,
            sharp: false,
            points: [
                { x: 0, y: 0 },
                { x: 5, y: 0 },
                { x: 5, y: 5 },
            ],
            docs: NO_DOCS,
            level: null,
        });
        s.data = ['a', 'b', 'c'].map(region);
        c.load();
        const order = (): string[] => s.last().map((f) => f.id);
        await c.toFront('a');
        expect(order()).toEqual(['b', 'c', 'a']);
        await c.lower('a');
        expect(order()).toEqual(['b', 'a', 'c']);
        await c.toBack('c');
        expect(order()).toEqual(['c', 'b', 'a']);
        await c.raise('c');
        expect(order()).toEqual(['b', 'c', 'a']);
    });

    it('removes a feature and persists', async () => {
        const { c, r, s, d } = make();
        s.data = [
            {
                type: 'region',
                id: 'a',
                biome: 'sand',
                texture: null,
                sharp: false,
                points: [
                    { x: 0, y: 0 },
                    { x: 5, y: 0 },
                    { x: 5, y: 5 },
                ],
                docs: NO_DOCS,
                level: null,
            },
        ];
        c.load();
        await c.remove('a');
        expect(r.removed).toContain('a');
        expect(s.saved).toHaveLength(1);
        expect(d.deleted).toEqual([]);
    });

    it('undoes and redoes a commit', async () => {
        const { c, s } = make();
        c.begin({ type: 'region', biome: 'water' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 10, y: 0 });
        c.addPoint({ x: 5, y: 10 });
        await c.commit();
        await c.undo();
        expect(s.last()).toEqual([]);
        await c.redo();
        expect(s.last().map((f) => f.id)).toEqual(['p1']);
    });

    it('reorders features (z-order) and persists the new order', async () => {
        const { c, s } = make();
        c.begin({ type: 'path', kind: 'road' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 10, y: 0 });
        await c.commit(); // p1
        c.begin({ type: 'path', kind: 'river' }, 'click');
        c.addPoint({ x: 0, y: 20 });
        c.addPoint({ x: 10, y: 20 });
        await c.commit(); // p2, on top
        await c.toBack('p2');
        expect(s.last().map((f) => f.id)).toEqual(['p2', 'p1']);
        await c.raise('p2');
        expect(s.last().map((f) => f.id)).toEqual(['p1', 'p2']);
    });

    it('hit-tests and erases the topmost feature under a point', async () => {
        const { c, r } = make();
        c.begin({ type: 'region', biome: 'grassland' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 100, y: 0 });
        c.addPoint({ x: 100, y: 100 });
        c.addPoint({ x: 0, y: 100 });
        await c.commit(); // p1
        expect(c.hitTest({ x: 50, y: 50 })).toBe('p1');
        expect(c.hitTest({ x: 500, y: 500 })).toBeNull();
        expect(await c.erase({ x: 500, y: 500 })).toBe(false);
        expect(await c.erase({ x: 50, y: 50 })).toBe(true);
        expect(r.removed).toContain('p1');
    });

    it('undo restores an erased feature', async () => {
        const { c, s } = make();
        c.begin({ type: 'path', kind: 'road' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 100, y: 0 });
        await c.commit(); // p1
        await c.erase({ x: 50, y: 0 });
        expect(s.last()).toEqual([]);
        await c.undo();
        expect(s.last().map((f) => f.id)).toEqual(['p1']);
    });

    it('picks and moves a control point, persisting the edit', async () => {
        const { c, r, s } = make();
        c.begin({ type: 'path', kind: 'road' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 100, y: 0 });
        await c.commit(); // p1
        expect(c.pickVertex({ x: 2, y: 1 }, 5)).toEqual({ id: 'p1', index: 0 });
        expect(c.pickVertex({ x: 500, y: 500 }, 5)).toBeNull();
        const setsBefore = r.setIds.length;
        expect(await c.moveVertex('p1', 0, { x: 5, y: 5 })).toBe(true);
        expect(c.getFeature('p1')?.points[0]).toEqual({ x: 5, y: 5 });
        expect(r.setIds.length).toBeGreaterThan(setsBefore);
        expect(s.last()[0]?.points[0]).toEqual({ x: 5, y: 5 });
    });

    it('sets a path width at one point, previewing first', async () => {
        const { c, r, s } = make();
        c.begin({ type: 'path', kind: 'road' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 100, y: 0 });
        await c.commit(); // p1
        const previews = r.previews;
        c.previewPathWidth('p1', 1, 40);
        expect(r.previews).toBe(previews + 1);
        expect(await c.setPathWidth('p1', 1, 40)).toBe(true);
        const saved = s.last()[0];
        expect(saved?.type === 'path' ? saved.halfWidths : null).toEqual([20, 40]);
        expect(await c.setPathWidth('p1', 5, 40)).toBe(false);
        expect(await c.setPathWidth('nope', 0, 40)).toBe(false);
        c.previewPathWidth('nope', 0, 40);
        expect(r.previews).toBe(previews + 1);
    });

    it('deletes a control point and undoes the deletion', async () => {
        const { c, s } = make();
        c.begin({ type: 'region', biome: 'sand' }, 'click');
        c.addPoint({ x: 0, y: 0 });
        c.addPoint({ x: 10, y: 0 });
        c.addPoint({ x: 10, y: 10 });
        c.addPoint({ x: 0, y: 10 });
        await c.commit(); // p1, 4 points
        expect(await c.deleteVertex('p1', 0)).toBe(true);
        expect(c.getFeature('p1')?.points).toHaveLength(3);
        // A 3-point region cannot lose another vertex.
        expect(await c.deleteVertex('p1', 0)).toBe(false);
        await c.undo();
        expect(c.getFeature('p1')?.points).toHaveLength(4);
        expect(s.saved.length).toBeGreaterThan(0);
    });
});

describe('CartographyController pen', () => {
    const TOL = 5;

    /** A river drawn with the pen: a plain click, a press dragged out into a curve, and a click on its last anchor. */
    async function drawRiver(c: ReturnType<typeof make>['c']): Promise<void> {
        c.halfWidth = 15;
        c.begin({ type: 'path', kind: 'river' }, 'pen');
        expect(c.penPress({ x: 0, y: 0 }, TOL, false)).toBe('added');
        c.penRelease();
        expect(c.penPress({ x: 100, y: 0 }, TOL, false)).toBe('added');
        c.penMove({ x: 140, y: 30 }, TOL);
        c.penRelease();
        expect(c.penPress({ x: 200, y: 0 }, TOL, false)).toBe('added');
        c.penRelease();
        expect(c.penPress({ x: 201, y: 1 }, TOL, false)).toBe('finish');
        await c.commit();
    }

    it('commits what the pen shaped: anchors, the handle pulled out, the panel’s width', async () => {
        const { c, s } = make();
        await drawRiver(c);
        const river = s.last()[0];
        expect(river?.type).toBe('path');
        if (river?.type !== 'path') {
            return;
        }
        expect(river.kind).toBe('river');
        expect(river.points).toEqual([
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 200, y: 0 },
        ]);
        expect(river.handles).toEqual([null, { x: 40, y: 30 }, null]);
        expect(river.halfWidths).toEqual([15, 15, 15]);
        expect(c.drawing).toBe(false);
    });

    it('previews the whole path at its width, out to the pointer, while drawing', () => {
        const { c, r } = make();
        c.halfWidth = 12;
        c.begin({ type: 'path', kind: 'road' }, 'pen');
        c.penPress({ x: 0, y: 0 }, TOL, false);
        c.penRelease();
        c.penMove({ x: 50, y: 50 }, TOL);
        const shown = r.previewed;
        expect(shown?.type === 'path' ? { points: shown.points, halfWidths: shown.halfWidths } : null).toEqual({
            points: [
                { x: 0, y: 0 },
                { x: 50, y: 50 },
            ],
            halfWidths: [12, 12],
        });
        expect(c.penOverlay()?.anchors).toEqual([{ x: 0, y: 0 }]);
        expect(c.penAnchors).toBe(1);
    });

    it('takes back the last anchor, and throws the path away on cancel', async () => {
        const { c, s, r } = make();
        c.begin({ type: 'path', kind: 'road' }, 'pen');
        c.penPress({ x: 0, y: 0 }, TOL, false);
        c.penRelease();
        c.penPress({ x: 50, y: 0 }, TOL, false);
        c.penRelease();
        expect(c.penUndo()).toBe(true);
        expect(c.penAnchors).toBe(1);
        expect(c.penUndo()).toBe(true);
        expect(c.penUndo()).toBe(false);
        c.penPress({ x: 0, y: 0 }, TOL, false);
        c.cancel();
        expect(c.penOverlay()).toBeNull();
        expect(r.previewed).toBeNull();
        await c.commit();
        expect(s.saved).toEqual([]);
    });

    it('drops an Alt-pressed anchor as a corner', async () => {
        const { c, s } = make();
        c.begin({ type: 'path', kind: 'road' }, 'pen');
        c.penPress({ x: 0, y: 0 }, TOL, false);
        c.penRelease();
        c.penPress({ x: 50, y: 0 }, TOL, true);
        c.penRelease();
        c.penPress({ x: 50, y: 50 }, TOL, false);
        c.penRelease();
        await c.commit();
        const road = s.last()[0];
        expect(road?.type === 'path' ? road.handles : null).toEqual([null, { x: 0, y: 0 }, null]);
    });

    it('ignores the pen with another brush, or none', () => {
        const { c } = make();
        expect(c.penPress({ x: 0, y: 0 }, TOL, false)).toBe('ignored');
        c.begin({ type: 'region', biome: 'forest' }, 'pen');
        expect(c.penPress({ x: 0, y: 0 }, TOL, false)).toBe('ignored');
        expect(c.penUndo()).toBe(false);
    });

    it('reshapes a drawn path: a handle, an inserted anchor, a removed one, widths and handles kept one per point', async () => {
        const { c, s, r } = make();
        await drawRiver(c);
        expect(c.pickPathControl('p1', { x: 140, y: 30 }, TOL, 1)).toEqual({ kind: 'handle', index: 1, side: 'out' });
        expect(c.pickPathControl('p1', { x: 100, y: 1 }, TOL, null)).toEqual({ kind: 'anchor', index: 1 });
        expect(c.previewPathHandle('p1', 1, { x: 0, y: 40 })?.type).toBe('path');
        expect(r.previewed?.type === 'path' ? r.previewed.handles[1] : null).toEqual({ x: 0, y: 40 });
        expect(await c.setPathHandle('p1', 1, null)).toBe(true);
        expect(await c.setPathWidth('p1', 2, 35)).toBe(true);
        expect(await c.insertPathPoint('p1', 1, 0.5)).toBe(2);
        const reshaped = c.getFeature('p1');
        expect(reshaped?.type === 'path' ? reshaped.handles : null).toEqual([null, null, null, null]);
        expect(reshaped?.type === 'path' ? reshaped.halfWidths : null).toEqual([15, 15, 25, 35]);
        expect(c.pathOverlay('p1', 2)?.anchors).toHaveLength(4);
        expect(await c.deleteVertex('p1', 2)).toBe(true);
        const after = s.last()[0];
        expect(after?.type === 'path' ? [after.points.length, after.halfWidths.length, after.handles.length] : null).toEqual([3, 3, 3]);
        expect(await c.insertPathPoint('p1', 9, 0.5)).toBeNull();
        expect(await c.setPathHandle('p1', 9, null)).toBe(false);
        expect(c.pickPathControl('nope', { x: 0, y: 0 }, TOL, null)).toBeNull();
        expect(c.pathOverlay('nope', null)).toBeNull();
    });
});
