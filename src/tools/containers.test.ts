// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { catalogStamps } from '../canvas/test-fakes';
import { PILE_STATES, pileSpec, pileStateLabel, pileStateOf } from './containers';
import { makeStamp } from './stamp';

const [chest] = catalogStamps([
    {
        id: 'chest',
        name: 'Chest',
        category: 'Storage',
        scale: 'interior',
        perspective: 'top-down',
        container: true,
        variants: [{ state: 'shut', image: 'chest.png', width: 200, height: 100 }],
    },
]);

function placed(gridSize: number): ReturnType<typeof makeStamp> {
    if (!chest) {
        throw new Error('missing fixture');
    }
    return makeStamp('c1', chest, { stamp: chest.key, x: 500, y: 300, rotation: 90 }, gridSize);
}

describe('pile states', () => {
    it('are locked, then closed, then empty when open with nothing in it', () => {
        expect(pileStateOf({ closed: true, locked: true }, 3)).toBe('locked');
        expect(pileStateOf({ closed: true, locked: false }, 0)).toBe('closed');
        expect(pileStateOf({ closed: false, locked: false }, 0)).toBe('empty');
        expect(pileStateOf({ closed: false, locked: false }, 2)).toBe('open');
    });

    it('show the variant the pack names, a locked pile as closed and an emptied one as open where it names none', () => {
        const states = { closed: 'shut', open: 'ajar' };
        expect(PILE_STATES.map((state) => pileStateLabel(states, state))).toEqual(['ajar', 'ajar', 'shut', 'shut']);
        expect(pileStateLabel({ locked: 'chained', empty: 'bare' }, 'locked')).toBe('chained');
        expect(pileStateLabel({ empty: 'bare' }, 'open')).toBeUndefined();
        expect(pileStateLabel(undefined, 'open')).toBeUndefined();
    });
});

describe('pileSpec', () => {
    it('covers the stamp as it lies, turned a quarter, in grid squares, in its image and elevation above the floor', () => {
        // The 2 x 1 chest turned a quarter lies 1 across and 2 down; the token is never turned (Foundry would turn its
        // picture but never its box, leaving the box across the chest).
        expect(pileSpec(placed(100), 10)).toEqual({
            x: 450,
            y: 200,
            width: 1,
            height: 2,
            elevation: 10,
            level: null,
            src: 'modules/pack/chest.png',
            pile: { type: 'container' },
        });
    });

    it('covers an unturned stamp exactly, and a stamp at an angle by its bounds', () => {
        expect(pileSpec({ ...placed(100), rotation: 0 }, 0)).toMatchObject({ x: 400, y: 250, width: 2, height: 1 });
        const angled = pileSpec({ ...placed(100), rotation: 45 }, 0);
        expect(angled.width).toBeCloseTo((300 * Math.SQRT1_2) / 100);
        expect(angled.height).toBeCloseTo((300 * Math.SQRT1_2) / 100);
    });

    it("puts the pile on its stamp's level, so a guest room's chest never stands on the floor below", () => {
        expect(pileSpec({ ...placed(100), level: 'upper' }, 20).level).toBe('upper');
    });

    it("carries the pack's pile options, and a plain container when a stamp predates them", () => {
        const vault = { ...placed(100), behaviour: { ...placed(100).behaviour, pile: { type: 'vault' as const, locked: true } } };
        expect(pileSpec(vault, 0).pile).toEqual({ type: 'vault', locked: true });
        const { pile: _omitted, ...older } = placed(100).behaviour;
        expect(pileSpec({ ...placed(100), behaviour: older }, 0).pile).toEqual({ type: 'container' });
    });

    it('treats a gridless stamp as one px per square rather than dividing by zero', () => {
        const stamp = { ...placed(100), gridSize: 0 };
        expect(pileSpec(stamp, 0)).toMatchObject({ width: 100, height: 200 });
    });

    it('falls back to the origin for a stamp with no centre point', () => {
        expect(pileSpec({ ...placed(100), points: [] }, 0)).toMatchObject({ x: -50, y: -100 });
    });
});
