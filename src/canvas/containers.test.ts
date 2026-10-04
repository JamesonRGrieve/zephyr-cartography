// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { catalogStamps, makeHarness } from './test-fakes';

const stamps = catalogStamps([
    {
        id: 'chest',
        name: 'Iron Chest',
        category: 'Storage',
        scale: 'interior',
        perspective: 'top-down',
        container: true,
        variants: [{ state: 'shut', image: 'chest.png', width: 100, height: 50 }],
    },
    {
        id: 'crate',
        name: 'Crate',
        category: 'Storage',
        scale: 'interior',
        perspective: 'top-down',
        container: { type: 'vault', closed: true },
        variants: [
            { state: 'shut', image: 'crate.png', width: 100, height: 100 },
            { state: 'smashed', image: 'smashed.png', width: 100, height: 100, container: false },
        ],
    },
    {
        id: 'strongbox',
        name: 'Strongbox',
        category: 'Storage',
        scale: 'interior',
        perspective: 'top-down',
        container: { type: 'container', states: { closed: 'shut', open: 'open', locked: 'chained' } },
        variants: [
            { state: 'shut', image: 'box.png', width: 100, height: 100 },
            { state: 'open', image: 'box-open.png', width: 100, height: 100 },
            { state: 'chained', image: 'box-chained.png', width: 100, height: 100 },
        ],
    },
    {
        id: 'rug',
        name: 'Rug',
        category: 'Decor',
        scale: 'interior',
        perspective: 'top-down',
        variants: [{ state: 'x', image: 'rug.png', width: 100, height: 100 }],
    },
]);

describe('CartographyController containers', () => {
    it('backs a container stamp with a named Item Piles container over its footprint', async () => {
        const { c, k } = makeHarness(stamps);
        c.grid = { size: 100, originX: 0, originY: 0 };
        await c.placeStamp({ stamp: 'pack:chest', x: 250, y: 125, rotation: 90 });
        expect(k.created).toEqual([
            {
                spec: {
                    x: 200,
                    y: 100,
                    width: 1,
                    height: 0.5,
                    rotation: 90,
                    elevation: 0,
                    level: null,
                    src: 'modules/pack/chest.png',
                    pile: { type: 'container' },
                },
                name: 'Iron Chest',
            },
        ]);
        const chest = c.getFeature('p1');
        expect(chest?.type === 'stamp' ? chest.pile : null).toBe('pile1');
    });

    it("gives the pile the pack's options, and follows a variant that stops or starts being a container", async () => {
        const { c, k } = makeHarness(stamps);
        c.grid = { size: 100, originX: 0, originY: 0 };
        await c.placeStamp({ stamp: 'pack:crate', x: 50, y: 50 });
        expect(k.created[0]?.spec.pile).toEqual({ type: 'vault', closed: true });
        await c.setStampVariant('p1', 1); // smashed: no longer a container
        expect(k.removed).toEqual(['pile1']);
        const smashed = c.getFeature('p1');
        expect(smashed?.type === 'stamp' ? smashed.pile : 'x').toBeNull();
        await c.undo(); // back to shut: a fresh pile
        const shut = c.getFeature('p1');
        expect(shut?.type === 'stamp' ? shut.pile : null).toBe('pile2');
        await c.redo(); // smashed again: that pile goes too
        expect(k.removed).toEqual(['pile1', 'pile2']);
    });

    it('show the variant the pack names for their pile’s state, empty as open, keeping the pile', async () => {
        const { c, k } = makeHarness(stamps);
        await c.placeStamp({ stamp: 'pack:strongbox', x: 50, y: 50 });
        const variant = (): number | null => {
            const box = c.getFeature('p1');
            return box?.type === 'stamp' ? box.variant : null;
        };
        expect(c.stampPiles()).toEqual(['pile1']);
        expect(await c.applyPileState('pile1', 'open')).toBe(true);
        expect(variant()).toBe(1);
        // The pack names no empty look: an emptied box looks open, which it already does.
        expect(await c.applyPileState('pile1', 'empty')).toBe(false);
        expect(await c.applyPileState('pile1', 'locked')).toBe(true);
        expect(variant()).toBe(2);
        expect(await c.applyPileState('nope', 'open')).toBe(false);
        expect(k.removed).toEqual([]);
        // A crate's pack names no states at all.
        await c.placeStamp({ stamp: 'pack:crate', x: 300, y: 300 });
        expect(await c.applyPileState('pile2', 'open')).toBe(false);
    });

    it('follow their pile’s state as the game’s, never an undo step: undo takes back what the GM did', async () => {
        const { c } = makeHarness(stamps);
        await c.placeStamp({ stamp: 'pack:strongbox', x: 50, y: 50 });
        expect(await c.applyPileState('pile1', 'open')).toBe(true);
        // The undo takes back the placing, not the box's opening.
        await c.undo();
        expect(c.getFeature('p1')).toBeNull();
    });

    it('let an undo asked while their pile is being followed wait for it, never joining its write', async () => {
        const { c, k } = makeHarness(stamps);
        await c.placeStamp({ stamp: 'pack:strongbox', x: 50, y: 50 });
        const following = c.applyPileState('pile1', 'open');
        await c.undo();
        expect(await following).toBe(true);
        // The follow ran first, on its own; the undo then took back the placing, pile and all.
        expect(c.getFeature('p1')).toBeNull();
        expect(k.removed).toEqual(['pile1']);
    });

    it('places the pile at the level floor', async () => {
        const { c, k } = makeHarness(stamps);
        await c.addLevel('above', 'Ground');
        await c.addLevel('above', 'Upper');
        await c.placeStamp({ stamp: 'pack:chest', x: 0, y: 0 });
        expect(k.created[0]?.spec.elevation).toBe(10);
    });

    it('moves the pile with the stamp and removes it with the stamp', async () => {
        const { c, k } = makeHarness(stamps);
        c.grid = { size: 100, originX: 0, originY: 0 };
        await c.placeStamp({ stamp: 'pack:chest', x: 250, y: 125 });
        await c.syncStampFrame('p1', { x: 500, y: 500, width: 100, height: 50, rotation: 0 });
        expect(k.moved.map((m) => [m.pile, m.spec.x, m.spec.y])).toEqual([['pile1', 500, 500]]);
        await c.remove('p1');
        expect(k.removed).toEqual(['pile1']);
    });

    it('leaves plain stamps, and every stamp without Item Piles, alone', async () => {
        const { c, k } = makeHarness(stamps);
        await c.placeStamp({ stamp: 'pack:rug', x: 0, y: 0 });
        k.active = false;
        await c.placeStamp({ stamp: 'pack:chest', x: 0, y: 0 });
        expect(k.created).toEqual([]);
        await c.remove('p2');
        expect(k.removed).toEqual([]);
    });
});
