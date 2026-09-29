// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { drawPlaceholders, isPlaceholder, missing, placeholder, withPlaceholders } from './placeholders';
import { TEST_ROLES } from './test-roles';

describe('placeholders', () => {
    it('stands a labelled box in for each role no stamp fills, and never for one that has art or has no box', () => {
        const index = withPlaceholders(new Map([...TEST_ROLES].filter(([role]) => role !== 'dresser' && role !== 'clutter')));
        const [dresser] = index.get('dresser') ?? [];
        expect(dresser).toMatchObject({ key: 'placeholder:1.2x0.5:dresser', role: 'dresser', width: 1.2, height: 0.5, against: 'wall' });
        expect(isPlaceholder(dresser?.key)).toBe(true);
        // Art of its own: kept as it is. Clutter is scattered by the dozen: no box for it.
        expect(index.get('bed')).toEqual(TEST_ROLES.get('bed'));
        expect(index.get('clutter')).toBeUndefined();
        expect(withPlaceholders(new Map()).get('stairs')).toBeUndefined();
        expect(isPlaceholder('test:bed')).toBe(false);
        expect(isPlaceholder(undefined)).toBe(false);
    });

    it('says what wanting a role cost: nothing with art, a box standing in, or nothing placed', () => {
        const bed = TEST_ROLES.get('bed')?.[0];
        const [box] = withPlaceholders(new Map()).get('bed') ?? [];
        expect(missing('bed', 'inn/room', bed)).toBeNull();
        expect(missing('bed', 'inn/room', box)).toEqual({ kind: 'placeholder', piece: 'bed', wantedIn: 'inn/room' });
        expect(missing('clutter', 'inn/room', undefined)).toEqual({ kind: 'no-stamp', role: 'clutter', wantedIn: 'inn/room' });
    });

    it('draws each placed box as a rectangle its size, turned as it stands, its role written across it on its level', () => {
        const drawn = drawPlaceholders([
            { type: 'stamp', stamp: 'placeholder:0.5x0.5:nightstand', x: 3, y: 4, rotation: 90, level: 'floor-2' },
            { type: 'stamp', stamp: 'placeholder:4x4:enclosure', x: 10, y: 10 },
            { type: 'stamp', stamp: 'test:bed', x: 1, y: 1 },
        ]);
        expect(drawn).toEqual([
            expect.objectContaining({ type: 'shape', kind: 'rectangle', x: 3, y: 4, width: 0.5, height: 0.5, rotation: 90, level: 'floor-2' }),
            // A long word in a small box is set small, but never smaller than can be read.
            expect.objectContaining({ type: 'label', x: 3, y: 4, text: 'nightstand', fontSize: 10, level: 'floor-2' }),
            expect.objectContaining({ type: 'shape', kind: 'rectangle', width: 4, height: 4, rotation: 0 }),
            // A short word in a large box is set large, but no larger than a label should be.
            expect.objectContaining({ type: 'label', text: 'enclosure', fontSize: 24 }),
            { type: 'stamp', stamp: 'test:bed', x: 1, y: 1 },
        ]);
        expect(drawn[1]).not.toHaveProperty('rotation');
        expect(drawn[3]).not.toHaveProperty('level');
        // A box standing upright as it lies (a shelf along a side wall) is labelled along it, reading upward.
        const [, alongShelf] = drawPlaceholders([{ type: 'stamp', stamp: 'placeholder:4x0.6:bottle shelf', x: 1, y: 1, rotation: 90 }]);
        expect(alongShelf).toMatchObject({ type: 'label', rotation: 270 });
        const [, tallBox] = drawPlaceholders([{ type: 'stamp', stamp: 'placeholder:1x3:filing row', x: 1, y: 1, rotation: 0 }]);
        expect(tallBox).toMatchObject({ type: 'label', rotation: 270 });
    });

    it('lets players read a box’s words on hover as they would its art’s, anywhere along it', () => {
        const drawn = drawPlaceholders([{ type: 'stamp', stamp: 'placeholder:3x1:shop sign', x: 5, y: 2, reads: 'OPEN LATE', level: 'lv' }]);
        expect(drawn).toContainEqual({ type: 'pin', x: 5, y: 2, text: 'OPEN LATE', readable: true, size: 3, level: 'lv' });
        expect(drawPlaceholders([{ type: 'stamp', stamp: 'placeholder:3x1:crate', x: 5, y: 2 }]).some((f) => f.type === 'pin')).toBe(false);
    });

    it('draws a flat piece’s box (a stain, a rug) as a faint mark on the floor, not a thing standing on it', () => {
        const stain = placeholder('decal', 'oil stain', 3, 2);
        expect(stain.key).toBe('placeholder:3x2:flat:oil stain');
        expect(placeholder('desk', 'desk', 1, 1).key).toBe('placeholder:1x1:desk');
        const [mark, label] = drawPlaceholders([{ type: 'stamp', stamp: stain.key, x: 5, y: 5 }]);
        const [solid] = drawPlaceholders([{ type: 'stamp', stamp: 'placeholder:3x2:desk', x: 5, y: 5 }]);
        const fillOf = (f: typeof mark): number => (f?.type === 'shape' ? f.fill?.alpha ?? 0 : 0);
        expect(fillOf(mark)).toBeGreaterThan(0);
        expect(fillOf(mark)).toBeLessThan(fillOf(solid));
        expect(label).toMatchObject({ type: 'label', text: 'oil stain' });
    });

    it('wraps a long name over a small box, as large as its lines still fit it', () => {
        const [, crate] = drawPlaceholders([{ type: 'stamp', stamp: 'placeholder:1x1:crate rigged with razor wire', x: 1, y: 1 }]);
        expect(crate).toMatchObject({ type: 'label', text: 'crate\nrigged\nwith razor\nwire', fontSize: 16 });
        // A name that fits one line at the largest type stays whole.
        const [, bank] = drawPlaceholders([{ type: 'stamp', stamp: 'placeholder:12x0.8:cabinet bank', x: 1, y: 1 }]);
        expect(bank).toMatchObject({ text: 'cabinet bank', fontSize: 24 });
    });
});
