// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { NO_DOCS } from '../tools/generated-docs';
import { catalogStamps, makeHarness } from './test-fakes';

const stamps = catalogStamps([
    {
        id: 'chest',
        name: 'Chest',
        category: 'Storage',
        scale: 'interior',
        perspective: 'top-down',
        container: true,
        variants: [{ state: 'shut', image: 'chest.png', width: 100, height: 100 }],
    },
    {
        id: 'residence',
        name: 'Residence',
        category: 'Structures',
        scale: 'city',
        perspective: 'top-down',
        enterable: true,
        variants: [{ state: 'x', image: 'residence.png', width: 100, height: 100 }],
    },
]);

async function roomAt(c: ReturnType<typeof makeHarness>['c'], x: number): Promise<void> {
    c.begin({ type: 'room', floor: 'dirt' }, 'click');
    for (const p of [
        { x, y: 0 },
        { x: x + 100, y: 0 },
        { x: x + 100, y: 100 },
    ]) {
        c.addPoint(p);
    }
    await c.commit();
}

describe('undo and redo with generated documents', () => {
    it('undoing a room deletes its walls and light; redoing recreates them', async () => {
        const { c, d } = makeHarness();
        await roomAt(c, 0); // walls w0-w2, light L0
        await c.undo();
        expect(d.deletedIds()).toEqual(['w0', 'w1', 'w2', 'L0']);
        await c.redo();
        expect(c.getFeature('p1')?.docs).toEqual({ ...NO_DOCS, walls: ['w3', 'w4', 'w5'], lights: ['L1'] });
    });

    it('undoing a delete brings the documents back', async () => {
        const { c } = makeHarness();
        await roomAt(c, 0);
        await c.remove('p1');
        await c.undo();
        expect(c.getFeature('p1')?.docs.walls).toEqual(['w3', 'w4', 'w5']);
    });

    it('undoing an edit re-syncs from the live documents to the old geometry', async () => {
        const { c, d } = makeHarness();
        await roomAt(c, 0);
        await c.moveVertex('p1', 1, { x: 200, y: 0 }); // the live walls w0-w2 move in place
        await c.undo();
        expect(d.deleted.flatMap((docs) => docs.walls)).toEqual([]);
        const restored = d.wallUpdates[d.wallUpdates.length - 1];
        expect(restored?.[0]).toMatchObject({ id: 'w0', doc: { b: { x: 100, y: 0 } } });
        expect(c.getFeature('p1')?.docs.walls).toEqual(['w0', 'w1', 'w2']);
    });

    it('leaves untouched features and their documents alone', async () => {
        const { c, d } = makeHarness();
        await roomAt(c, 0);
        await roomAt(c, 500);
        const before = d.walls.length;
        await c.undo(); // removes only the second room
        expect(d.walls.length).toBe(before);
        expect(c.getFeature('p1')?.docs.walls).toEqual(['w0', 'w1', 'w2']);
        expect(c.getFeature('p2')).toBeNull();
    });

    it('recreates a container pile and an interior exit when a stamp comes back', async () => {
        const { c, k, w } = makeHarness(stamps);
        await c.placeStamp({ stamp: 'pack:chest', x: 0, y: 0 }); // p1, pile1
        await c.placeStamp({ stamp: 'pack:residence', x: 500, y: 0 }); // p2
        await c.linkSubmap('p2', 'vault'); // exit p4
        await c.remove('p1');
        await c.remove('p2');
        expect(k.removed).toEqual(['pile1']);
        expect(w.deleted).toEqual([{ scene: 'vault', region: 'p4' }]);
        await c.undo(); // p2 back
        await c.undo(); // p1 back
        expect(w.regions.map((r) => r.region.id)).toEqual(['p4', 'p4']);
        const chest = c.getFeature('p1');
        expect(chest?.type === 'stamp' ? chest.pile : null).toBe('pile2');
    });

    it('undoing an interior link removes its exit; redoing restores it', async () => {
        const { c, w } = makeHarness(stamps);
        await c.placeStamp({ stamp: 'pack:residence', x: 0, y: 0 });
        await c.linkSubmap('p1', 'vault');
        await c.undo();
        expect(c.submapOf('p1')).toBeNull();
        expect(w.deleted).toEqual([{ scene: 'vault', region: 'p3' }]);
        await c.redo();
        expect(c.submapOf('p1')?.exitRegion).toBe('p3');
        expect(w.regions.map((r) => r.region.id)).toEqual(['p3', 'p3']);
    });
});

describe('batch', () => {
    it('undoes everything done inside it, nested batches included, in one step', async () => {
        const { c, s } = makeHarness();
        await roomAt(c, 0);
        await c.batch(async () => {
            await roomAt(c, 200);
            await c.batch(async () => {
                await roomAt(c, 400);
            });
        });
        expect(s.last()).toHaveLength(3);
        await c.undo();
        expect(s.last().map((f) => f.id)).toEqual(['p1']);
        await c.undo();
        expect(s.last()).toEqual([]);
    });

    it('saves the features once for the whole batch, however many it adds, and once per edit outside one', async () => {
        const { c, s } = makeHarness();
        await roomAt(c, 0);
        const beforeBatch = s.saved.length;
        await c.batch(async () => {
            for (const x of [200, 400, 600, 800]) {
                // eslint-disable-next-line no-await-in-loop -- rooms are added one after another, as a built spec adds them
                await roomAt(c, x);
            }
        });
        expect(s.saved.length - beforeBatch).toBe(1);
        expect(s.last()).toHaveLength(5);
    });

    it('rolls back and ends when its work throws, so later edits are undone one by one again', async () => {
        const { c, s, d } = makeHarness();
        await expect(
            c.batch(async () => {
                await roomAt(c, 0);
                throw new Error('stop');
            }),
        ).rejects.toThrow('stop');
        // Nothing of the failed batch was written or kept.
        expect(d.writes).toEqual([]);
        expect(s.last()).toEqual([]);
        await roomAt(c, 200);
        await roomAt(c, 400);
        await c.undo();
        expect(s.last().map((f) => f.id)).toEqual(['p2']);
    });

    it('hands out fresh feature ids', () => {
        const { c } = makeHarness();
        expect([c.newFeatureId(), c.newFeatureId()]).toEqual(['p1', 'p2']);
    });
});
