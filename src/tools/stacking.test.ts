// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { catalogStamps } from '../canvas/test-fakes';
import { stackedElevation } from './stacking';
import { makeStamp, type StampFeature } from './stamp';

const [table, mug, rug] = catalogStamps([
    {
        id: 'table',
        name: 'Table',
        category: 'Furniture',
        tags: ['table'],
        scale: 'interior',
        perspective: 'top-down',
        variants: [{ state: 'x', image: 't.png', width: 200, height: 100 }],
    },
    {
        id: 'mug',
        name: 'Mug',
        category: 'Props',
        tags: ['mug'],
        scale: 'interior',
        perspective: 'top-down',
        variants: [{ state: 'x', image: 'm.png', width: 30, height: 30 }],
    },
    {
        id: 'rug',
        name: 'Rug',
        category: 'Decor',
        tags: ['rug'],
        scale: 'interior',
        perspective: 'top-down',
        variants: [{ state: 'x', image: 'r.png', width: 400, height: 300 }],
    },
]);
if (!table || !mug || !rug) {
    throw new Error('fixture stamps');
}

/** Tables are surfaces; rugs and mugs are not. */
const isSurface = (s: StampFeature): boolean => s.stamp === table.key;

/** Scene distance units per grid square: 5 ft. */
const FEET = 5;

describe('stackedElevation', () => {
    const onTable = makeStamp('t', table, { stamp: table.key, x: 500, y: 500 }, 100);

    it('stands what lies wholly on a table at the table’s top: half a square up, when the pack gives it no height', () => {
        const placed = makeStamp('m', mug, { stamp: mug.key, x: 540, y: 510 }, 100);
        expect(stackedElevation(placed, [onTable], isSurface, FEET)).toBe(2.5);
    });

    it('stands it on a raised table’s top, and on the table’s own physical height', () => {
        const raised = { ...onTable, elevation: 10, behaviour: { ...onTable.behaviour, physical: { height: 1 } } };
        const placed = makeStamp('m', mug, { stamp: mug.key, x: 500, y: 500 }, 100);
        expect(stackedElevation(placed, [raised], isSurface, FEET)).toBe(15);
    });

    it('leaves on the floor what only overhangs the table, what is not on a surface, and what is on another level', () => {
        const overhanging = makeStamp('m', mug, { stamp: mug.key, x: 598, y: 500 }, 100);
        expect(stackedElevation(overhanging, [onTable], isSurface, FEET)).toBeNull();
        const onRug = makeStamp('m', mug, { stamp: mug.key, x: 1500, y: 1500 }, 100);
        expect(stackedElevation(onRug, [makeStamp('r', rug, { stamp: rug.key, x: 1500, y: 1500 }, 100)], isSurface, FEET)).toBeNull();
        const upstairs = { ...makeStamp('m', mug, { stamp: mug.key, x: 500, y: 500 }, 100), level: 'upper' };
        expect(stackedElevation(upstairs, [{ ...onTable, level: 'ground' }], isSurface, FEET)).toBeNull();
    });

    it('never stacks a table on a smaller one', () => {
        const small = makeStamp('s', mug, { stamp: mug.key, x: 500, y: 500 }, 100);
        expect(stackedElevation(onTable, [{ ...small, stamp: table.key }], isSurface, FEET)).toBeNull();
    });
});
