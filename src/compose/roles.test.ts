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
                stampDef('counter', { role: 'counter', placement: { against: 'wall', clearance: 2 } }),
                stampDef('table', { role: 'table' }),
                stampDef('statue', {}),
            ]),
            [],
        );
        expect(index.get('counter')).toEqual([
            {
                key: 'pack:counter',
                role: 'counter',
                width: 2,
                height: 1,
                turn: 0,
                against: 'wall',
                clearance: 2,
                upright: false,
                habitats: [],
                climb: null,
                borrowed: false,
                purposes: [],
            },
        ]);
        expect(index.get('table')).toEqual([
            {
                key: 'pack:table',
                role: 'table',
                width: 2,
                height: 1,
                turn: 0,
                against: 'free',
                clearance: 0,
                upright: false,
                habitats: [],
                climb: null,
                borrowed: false,
                purposes: [],
            },
        ]);
        // Neither a role nor a tag that makes one: only ever placed by hand.
        expect([...index.values()].flat().map((s) => s.key)).not.toContain('pack:statue');
    });

    it('never turns art drawn with depth, and uses art drawn straight down wherever a role has any', () => {
        const drawn = roleIndex(
            stamps([
                stampDef('crates', { tags: ['crates'], perspective: 'isometric', placement: { back: 'left' } }),
                stampDef('tower', { tags: ['silo'], perspective: 'central', scale: 'exterior' }),
                stampDef('plan-bed', { tags: ['bed'], perspective: 'orthographic' }),
                stampDef('front-bed', { tags: ['bed'], perspective: 'isometric' }),
            ]),
            [],
        );
        // Its back is its top, whatever the pack says, and it stands as drawn.
        expect(drawn.get('storage')).toEqual([expect.objectContaining({ key: 'pack:crates', upright: true, turn: 0, width: 2, height: 1 })]);
        expect(drawn.get('structure')).toEqual([expect.objectContaining({ upright: true })]);
        // Beds drawn straight down exist, so the front-on one is left out.
        expect(drawn.get('bed')?.map((s) => s.key)).toEqual(['pack:plan-bed']);
    });

    it('takes a role its pack does not name from its tags, standing as that role does', () => {
        const index = roleIndex(
            stamps([
                stampDef('console', { tags: ['cogitator', 'console'] }),
                stampDef('lamp', { tags: ['desk', 'lamp'] }),
                stampDef('gun', { tags: ['sandbag', 'emplacement'], scale: 'exterior' }),
                stampDef('silo', { tags: ['ore', 'silo'], scale: 'exterior' }),
                // An indoor gantry is not a yard's structure.
                stampDef('gantry', { tags: ['crane', 'gantry'] }),
                // The pack's word beats its tags.
                stampDef('odd', { tags: ['console'], role: 'clutter' }),
            ]),
            [],
        );
        expect(index.get('console')).toEqual([expect.objectContaining({ key: 'pack:console', against: 'wall', clearance: 1 })]);
        expect(index.get('light')?.map((s) => s.key)).toEqual(['pack:lamp']);
        // A defence is drawn front up: its back is the image's bottom, turned half round to stand back up.
        expect(index.get('emplacement')).toEqual([expect.objectContaining({ key: 'pack:gun', turn: 180 })]);
        expect(index.get('structure')).toEqual([expect.objectContaining({ key: 'pack:silo', upright: true })]);
        expect([...index.values()].flat().map((s) => s.key)).not.toContain('pack:gantry');
        expect(index.get('clutter')?.map((s) => s.key)).toEqual(['pack:odd']);
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

    it('borrows a way between levels from another setting only when the map’s settings have none, and keeps how each climbs', () => {
        const ladder = stampDef('ladder', { tags: ['ladder', 'setting-grimdark'], transition: { kind: 'ladder', direction: 'up' } });
        const doors = stampDef('storm-doors', {
            tags: ['storm', 'cellar', 'doors', 'setting-fantasy'],
            scale: 'exterior',
            transition: { kind: 'hatch', direction: 'down' },
        });
        const chair = stampDef('chair', { tags: ['chair', 'setting-grimdark'] });
        const fantasy = roleIndex(stamps([ladder, chair]), ['setting-fantasy']);
        expect(fantasy.get('stairs')?.map((s) => [s.key, s.borrowed, s.climb])).toEqual([['pack:ladder', true, { kind: 'ladder', direction: 'up' }]]);
        // Nor is a chair; but a bed is, when the settings have none, and only then.
        expect(fantasy.has('seat')).toBe(false);
        const cot = stampDef('cot', { tags: ['cot', 'setting-grimdark'] });
        const pallet = stampDef('pallet', { tags: ['bed', 'setting-fantasy'] });
        expect(
            roleIndex(stamps([cot]), ['setting-fantasy'])
                .get('bed')
                ?.map((s) => [s.key, s.borrowed]),
        ).toEqual([['pack:cot', true]]);
        expect(
            roleIndex(stamps([cot, pallet]), ['setting-fantasy'])
                .get('bed')
                ?.map((s) => [s.key, s.borrowed]),
        ).toEqual([['pack:pallet', false]]);
        // Storm doors drawn for outside are a way down whatever their scale; the setting's own come first, the borrowed after.
        const withDoors = roleIndex(stamps([ladder, doors]), ['setting-fantasy']);
        expect(withDoors.get('stairs')?.map((s) => [s.key, s.borrowed, s.climb?.direction])).toEqual([
            ['pack:storm-doors', false, 'down'],
            ['pack:ladder', true, 'up'],
        ]);
        // A hatch that joins no levels is not a way between them.
        expect(roleIndex(stamps([stampDef('hatch', { tags: ['hatch', 'trapdoor'] })]), []).has('stairs')).toBe(false);
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
