// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { type CatalogStamp, loadPacks } from '../stamps/catalog';
import { roleIndex } from './roles';

function stamps(defs: readonly object[], referenceGridSize = 100): readonly CatalogStamp[] {
    const packs = loadPacks([{ moduleId: 'pack', manifest: { schemaVersion: 1, id: 'pack', name: 'Pack', referenceGridSize, stamps: defs } }]);
    return packs.stamps;
}

const stampDef = (id: string, over: object): object => ({
    id,
    name: id,
    category: 'Furniture',
    scale: 'interior',
    perspective: 'top-down',
    variants: [{ state: 'intact', image: `stamps/${id}.png`, width: 200, height: 100 }],
    ...over,
});

describe('roleIndex', () => {
    it('indexes stamps with a role by it, sized in grid squares, with how they stand', () => {
        const index = roleIndex(
            stamps([
                stampDef('counter', { role: 'counter', placement: { against: 'wall', clearance: 1 } }),
                stampDef('table', { role: 'table' }),
                stampDef('statue', {}),
            ]),
            [],
        );
        expect(index.get('counter')).toEqual([
            { key: 'pack:counter', role: 'counter', width: 2, height: 1, turn: 0, against: 'wall', clearance: 1, habitats: [] },
        ]);
        expect(index.get('table')).toEqual([{ key: 'pack:table', role: 'table', width: 2, height: 1, turn: 0, against: 'free', clearance: 0, habitats: [] }]);
        // No role: only ever placed by hand.
        expect([...index.values()].flat().map((s) => s.key)).not.toContain('pack:statue');
    });

    it('turns a stamp whose back is not the image’s top so it is, running its size along the back', () => {
        const index = roleIndex(
            stamps([
                stampDef('bed', { role: 'bed', placement: { against: 'wall', back: 'left' } }),
                stampDef('shelf', { role: 'shelf', placement: { against: 'wall', back: 'right' } }),
                stampDef('stove', { role: 'hearth', placement: { against: 'wall', back: 'bottom' } }),
            ]),
            [],
        );
        expect(index.get('bed')?.[0]).toMatchObject({ width: 1, height: 2, turn: 90 });
        expect(index.get('shelf')?.[0]).toMatchObject({ width: 1, height: 2, turn: 270 });
        expect(index.get('hearth')?.[0]).toMatchObject({ width: 2, height: 1, turn: 180 });
    });

    it('keeps only stamps carrying one of the intent’s settings when it names any, and measures by each pack’s own grid size', () => {
        const defs = [
            stampDef('gothic', { role: 'seat', tags: ['imperial'] }),
            stampDef('stool', { role: 'seat', tags: ['generic'] }),
            stampDef('plain', { role: 'seat' }),
        ];
        const keys = (settings: readonly string[]): (string | undefined)[] | undefined =>
            roleIndex(stamps(defs), settings)
                .get('seat')
                ?.map((s) => s.key);
        expect(keys(['imperial'])).toEqual(['pack:gothic']);
        expect(keys(['imperial', 'generic'])).toEqual(['pack:gothic', 'pack:stool']);
        expect(keys([])).toHaveLength(3);
        expect(roleIndex(stamps(defs, 200), []).get('seat')?.[0]).toMatchObject({ width: 1, height: 0.5 });
    });

    it('keeps the ground a land stamp belongs on', () => {
        const index = roleIndex(stamps([stampDef('boulder', { role: 'rock', habitats: ['forest', 'rocky'] })]), []);
        expect(index.get('rock')?.[0]?.habitats).toEqual(['forest', 'rocky']);
    });

    it('skips a stamp whose default variant does not exist', () => {
        const [lamp] = stamps([stampDef('lamp', { role: 'light' })]);
        expect(lamp && roleIndex([{ ...lamp, defaultVariant: 3 }], []).get('light')).toBeUndefined();
    });
});
