// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { type CatalogStamp, loadPacks } from '../stamps/catalog';
import { partsOf, roleIndex } from './roles';

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

describe('roleIndex run parts', () => {
    const variant = (id: string, width: number, height: number): object => ({ variants: [{ state: 'bare', image: `stamps/${id}.png`, width, height }] });

    it('never offers an end, corner or gate piece alone, and stands a section of its kind between two of its ends', () => {
        const index = roleIndex(
            stamps([
                stampDef('oak-section', { tags: ['oak', 'table', 'section'], ...variant('oak-section', 200, 100) }),
                stampDef('oak-end', { tags: ['oak', 'table', 'end'], ...variant('oak-end', 100, 125) }),
                stampDef('pine-table', { tags: ['pine', 'table'], ...variant('pine-table', 200, 100) }),
                stampDef('brass-segment', { tags: ['brass', 'counter', 'counter-segment'], ...variant('brass-segment', 100, 50) }),
                stampDef('brass-end', { tags: ['brass', 'counter', 'counter-end'], ...variant('brass-end', 100, 100) }),
                stampDef('brass-corner', { tags: ['brass', 'counter', 'counter-corner'], ...variant('brass-corner', 100, 100) }),
                stampDef('brass-gate', { tags: ['brass', 'counter', 'gate', 'counter-gate'], ...variant('brass-gate', 100, 60) }),
            ]),
            [],
        );
        const tables = index.get('table') ?? [];
        expect(tables.map((t) => t.key)).toEqual(['pack:oak-section', 'pack:pine-table']);
        // The oak section, 2 × 1, between its ends fitted to its depth (1.25 × 1 drawn 0.8 wide): one table 3.6 long.
        const oak = tables[0];
        expect(oak?.width).toBeCloseTo(3.6);
        expect(oak?.run).toMatchObject({ count: 1, module: { key: 'pack:oak-section' }, cap: { key: 'pack:oak-end', height: 1 } });
        expect(oak?.run?.cap?.width).toBeCloseTo(0.8);
        // A table of another kind has no end of its own: it stands as drawn.
        expect(tables[1]?.run).toBeUndefined();
        // The counter's gate is a piece of the counter, never a door; it, the corner and the end stand only in a run.
        expect(index.get('counter')?.map((c) => c.key)).toEqual(['pack:brass-segment']);
        expect(index.get('counter')?.[0]?.run?.cap?.key).toBe('pack:brass-end');
        // Its gate and corner ride on it, for a named piece asking for them.
        expect(partsOf(index, 'counter').map((p) => p.key)).toEqual(['pack:brass-corner', 'pack:brass-gate']);
        expect(partsOf(index, 'table')).toEqual([]);
        expect(index.get('door')).toBeUndefined();
    });
});

describe('roleIndex door art', () => {
    it('knows which variant shows each state of a door: the first of each, for hanging it shut or open', () => {
        const index = roleIndex(
            stamps([
                stampDef('oak-door', {
                    role: 'door',
                    door: { type: 'door' },
                    variants: [
                        { state: 'shut', image: 'stamps/shut.png', width: 100, height: 20, doorState: 'closed' },
                        { state: 'ajar', image: 'stamps/ajar.png', width: 100, height: 20, doorState: 'open' },
                        { state: 'barred', image: 'stamps/barred.png', width: 100, height: 20, doorState: 'closed' },
                        { state: 'plain', image: 'stamps/plain.png', width: 100, height: 20 },
                    ],
                }),
            ]),
            [],
        );
        expect(index.get('door')?.[0]?.doorStates).toEqual({ closed: 0, open: 1 });
        // Every variant's state, by variant, for a named piece asking for one; a variant naming none reads as nothing.
        expect(index.get('door')?.[0]?.states).toEqual(['shut', 'ajar', 'barred', 'plain']);
    });
});

describe('roleIndex variants', () => {
    it('draws a piece in a variant seen from above, so it turns, where its default one is drawn side-on', () => {
        const index = roleIndex(
            stamps([
                stampDef('shelf-module', {
                    role: 'shelf',
                    perspective: 'orthographic',
                    variants: [
                        { state: 'front', image: 'stamps/front.png', width: 100, height: 68, perspective: 'front' },
                        { state: 'plan', image: 'stamps/plan.png', width: 100, height: 68 },
                    ],
                }),
                stampDef('iso-shelf', { role: 'shelf', perspective: 'isometric' }),
            ]),
            [],
        );
        const shelves = new Map((index.get('shelf') ?? []).map((s) => [s.key, s]));
        // The plan variant, turnable, drawn as such.
        expect(shelves.get('pack:shelf-module')).toMatchObject({ variant: 1, upright: false });
        // One with no view from above keeps its own default, standing as drawn.
        expect(shelves.get('pack:iso-shelf')?.variant).toBeUndefined();
    });
});

describe('roleIndex factions', () => {
    it('keeps a faction’s own art to maps that name the faction, whatever broader setting it also carries', () => {
        const pack = stamps([
            stampDef('human-bed', { role: 'bed', tags: ['setting-grimdark-human'] }),
            stampDef('orcish-bunk', { role: 'bed', tags: ['setting-grimdark-orcish'] }),
        ]);
        const keys = (settings: readonly string[]): string[] => (roleIndex(pack, settings).get('bed') ?? []).map((s) => s.key);
        expect(keys(['setting-grimdark-human'])).toEqual(['pack:human-bed']);
        expect(keys(['setting-grimdark-human', 'setting-grimdark-orcish'])).toEqual(['pack:human-bed', 'pack:orcish-bunk']);
    });
});

describe('roleIndex fittings', () => {
    it('keeps every fitting’s art, drawn from above or side-on, since each is one thing a map names', () => {
        const pack = stamps([
            stampDef('hatch', { tags: ['hatch'], perspective: 'orthographic' }),
            stampDef('pict-recorder', { tags: ['pict', 'recorder'], perspective: 'front' }),
        ]);
        expect((roleIndex(pack, []).get('fitting') ?? []).map((s) => s.key)).toEqual(['pack:hatch', 'pack:pict-recorder']);
    });
});

describe('roleIndex purposes', () => {
    it('keeps a piece to the rooms its tags name or imply: a cooking pot to a kitchen, a reliquary to a shrine or chapel', () => {
        const index = roleIndex(
            stamps([
                stampDef('pot', { role: 'clutter', tags: ['cooking', 'pot'] }),
                stampDef('relic', { role: 'clutter', tags: ['reliquary'] }),
                stampDef('bunk', { role: 'bed', tags: ['cell'] }),
                stampDef('satchel', { role: 'clutter', tags: ['adventuring'] }),
            ]),
            [],
        );
        const purposes = new Map((index.get('clutter') ?? []).map((s) => [s.key, s.purposes]));
        expect(purposes.get('pack:pot')).toEqual(['kitchen']);
        expect(purposes.get('pack:relic')).toEqual(['shrine', 'chapel']);
        expect(purposes.get('pack:satchel')).toEqual([]);
        expect(index.get('bed')?.[0]?.purposes).toEqual(['cell']);
    });

    it("keeps a map table to a war room and a throne to a commander's room or a chapel, never a taproom's or a lobby's", () => {
        const index = roleIndex(
            stamps([stampDef('war', { role: 'table', tags: ['map', 'table'] }), stampDef('throne', { role: 'seat', tags: ['throne', 'chair'] })]),
            [],
        );
        expect(index.get('table')?.[0]?.purposes).toEqual(['command']);
        expect(index.get('seat')?.[0]?.purposes).toEqual(expect.arrayContaining(['command', 'chapel']));
        expect(index.get('seat')?.[0]?.purposes).toHaveLength(2);
    });
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
                tags: [],
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
                tags: [],
            },
        ]);
        // Neither a role nor a tag that makes one: a fitting, drawn only where a map names it.
        expect(index.get('fitting')?.map((s) => s.key)).toEqual(['pack:statue']);
    });

    it('never turns isometric or front art, turns art seen from above, and uses only art seen from above wherever a role has any', () => {
        const drawn = roleIndex(
            stamps([
                stampDef('crates', { tags: ['crates'], perspective: 'isometric', placement: { back: 'left' } }),
                stampDef('desk', { tags: ['desk'], perspective: 'central', placement: { back: 'left' } }),
                stampDef('tower', { tags: ['silo'], perspective: 'central', scale: 'exterior' }),
                stampDef('plan-bed', { tags: ['bed'], perspective: 'orthographic' }),
                stampDef('centre-bed', { tags: ['bed'], perspective: 'central' }),
                stampDef('front-bed', { tags: ['bed'], perspective: 'isometric' }),
                stampDef('side-bed', { tags: ['bed'], perspective: 'front' }),
                stampDef('side-crates', { tags: ['crates'], perspective: 'front', placement: { back: 'left' } }),
            ]),
            [],
        );
        // Front art, a level elevation, stands as drawn like isometric art.
        expect(drawn.get('storage')).toContainEqual(expect.objectContaining({ key: 'pack:side-crates', upright: true, turn: 0 }));
        // Its back is its top, whatever the pack says, and it stands as drawn.
        expect(drawn.get('storage')).toContainEqual(expect.objectContaining({ key: 'pack:crates', upright: true, turn: 0, width: 2, height: 1 }));
        // Central art turns like a plan: its back is the pack's, turned to the top.
        expect(drawn.get('desk')).toEqual([expect.objectContaining({ key: 'pack:desk', upright: false, turn: 90, width: 1, height: 2 })]);
        // A structure stands upright whatever its art.
        expect(drawn.get('structure')).toEqual([expect.objectContaining({ upright: true })]);
        // Beds seen from above exist, so the front-on and side-on ones are left out.
        expect(drawn.get('bed')?.map((s) => s.key)).toEqual(['pack:plan-bed', 'pack:centre-bed']);
    });

    it('takes a role its pack does not name from its tags, standing as that role does', () => {
        const index = roleIndex(
            stamps([
                stampDef('console', { tags: ['terminal', 'console'] }),
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
        // An indoor gantry is no yard's structure: never dressed as one, only a fitting a map may name.
        expect(index.get('structure')?.map((s) => s.key)).not.toContain('pack:gantry');
        expect(index.get('fitting')?.map((s) => s.key)).toContain('pack:gantry');
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
            stampDef('gothic', { role: 'seat', tags: ['cathedral'] }),
            stampDef('stool', { role: 'seat', tags: ['generic'] }),
            stampDef('plain', { role: 'seat' }),
        ];
        const keys = (settings: readonly string[]): (string | undefined)[] | undefined =>
            roleIndex(stamps(defs), settings)
                .get('seat')
                ?.map((s) => s.key);
        expect(keys(['cathedral'])).toEqual(['pack:gothic']);
        expect(keys(['cathedral', 'generic'])).toEqual(['pack:gothic', 'pack:stool']);
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
