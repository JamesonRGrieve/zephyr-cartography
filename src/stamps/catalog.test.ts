// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
    buildCategoryTree,
    type CatalogStamp,
    clampVariantIndex,
    computeTilePlacement,
    cycleVariantIndex,
    effectiveProperties,
    filterStamps,
    loadPacks,
    moduleAssetUrl,
    resolveVariant,
    tagsForCategory,
} from './catalog';

const LAMP_LIGHT = { dim: 4, bright: 2, color: '#ffcc88' };

function manifest(stamps: readonly object[], extra: object = {}): object {
    return { schemaVersion: 1, id: 'pack', name: 'Pack', stamps, ...extra };
}

function stampDef(id: string, over: object = {}): object {
    return {
        id,
        name: `Stamp ${id}`,
        category: 'Furniture',
        scale: 'interior',
        perspective: 'top-down',
        variants: [{ state: 'intact', image: `stamps/${id}.png`, width: 100, height: 200 }],
        ...over,
    };
}

function catalogOf(stamps: readonly object[]): readonly CatalogStamp[] {
    return loadPacks([{ moduleId: 'assets', manifest: manifest(stamps) }]).stamps;
}

function only(stamps: readonly object[]): CatalogStamp {
    const [stamp] = catalogOf(stamps);
    if (stamp === undefined) {
        throw new Error('expected one stamp');
    }
    return stamp;
}

describe('moduleAssetUrl', () => {
    it('resolves a module-relative path to its served URL', () => {
        expect(moduleAssetUrl('assets', 'stamps/a.png')).toBe('modules/assets/stamps/a.png');
        expect(moduleAssetUrl('assets', './stamps/a.png')).toBe('modules/assets/stamps/a.png');
    });

    it('passes an absolute URL through untouched', () => {
        for (const url of ['data:image/svg+xml,%3Csvg%3E', 'https://cdn.example/a.png', 'blob:abc']) {
            expect(moduleAssetUrl('assets', url)).toBe(url);
        }
    });
});

describe('loadPacks', () => {
    it('merges packs, keys stamps by module, and resolves image and texture URLs', () => {
        const loaded = loadPacks([
            { moduleId: 'one', manifest: manifest([stampDef('a')], { referenceGridSize: 50 }) },
            {
                moduleId: 'two',
                manifest: manifest([stampDef('a')], {
                    textureSets: [{ id: 'cc0', name: 'CC0', license: 'CC0-1.0', credits: 'tex/CREDITS.md', textures: { road: 'tex/road.jpg' } }],
                }),
            },
        ]);
        expect(loaded.errors).toEqual([]);
        expect(loaded.stamps.map((s) => s.key)).toEqual(['one:a', 'two:a']);
        expect(loaded.stamps[0]?.referenceGridSize).toBe(50);
        expect(loaded.stamps[1]?.referenceGridSize).toBe(100);
        expect(loaded.stamps[0]?.variants[0]?.image).toBe('modules/one/stamps/a.png');
        expect(loaded.textureSets).toEqual([
            {
                id: 'cc0',
                key: 'two:cc0',
                moduleId: 'two',
                name: 'CC0',
                license: 'CC0-1.0',
                credits: 'modules/two/tex/CREDITS.md',
                textures: { road: 'modules/two/tex/road.jpg' },
            },
        ]);
    });

    it('serves the previews packs give their compressed art', () => {
        const loaded = loadPacks([
            {
                moduleId: 'gpu',
                manifest: manifest(
                    [stampDef('crate', { variants: [{ state: 'shut', image: 'crate.ktx2', preview: 'crate.webp', width: 100, height: 100 }] })],
                    {
                        textureSets: [
                            {
                                id: 'gpu',
                                name: 'GPU',
                                license: 'CC0-1.0',
                                textures: { grassland: 'tex/grass.ktx2' },
                                previews: { grassland: 'tex/grass.webp' },
                            },
                        ],
                    },
                ),
            },
        ]);
        expect(loaded.errors).toEqual([]);
        expect(loaded.stamps[0]?.variants[0]).toMatchObject({ image: 'modules/gpu/crate.ktx2', preview: 'modules/gpu/crate.webp' });
        expect(loaded.textureSets[0]?.previews).toEqual({ grassland: 'modules/gpu/tex/grass.webp' });
    });

    it('reports an invalid pack instead of dropping it silently, and keeps the valid ones', () => {
        const loaded = loadPacks([
            { moduleId: 'bad', manifest: { schemaVersion: 2 } },
            { moduleId: 'good', manifest: manifest([stampDef('a')]) },
        ]);
        expect(loaded.stamps.map((s) => s.key)).toEqual(['good:a']);
        expect(loaded.errors).toHaveLength(1);
        expect(loaded.errors[0]?.moduleId).toBe('bad');
        expect(loaded.errors[0]?.issues.length).toBeGreaterThan(0);
    });
});

describe('categories and tags', () => {
    const catalog = catalogOf([
        stampDef('a', { category: 'Lighting', tags: ['lamp', 'brass'] }),
        stampDef('b', { category: 'Lighting', tags: ['lamp', 'iron'] }),
        stampDef('c', { category: 'Doors', tags: ['brass'] }),
        stampDef('d', { category: 'Lighting', tags: ['brass', 'lamp'] }),
    ]);

    it('counts stamps per category, sorted by name', () => {
        expect(buildCategoryTree(catalog)).toEqual([
            { name: 'Doors', count: 1 },
            { name: 'Lighting', count: 3 },
        ]);
    });

    it('surfaces frequent tags within a category, most frequent first', () => {
        expect(tagsForCategory(catalog, 'Lighting')).toEqual([
            { tag: 'lamp', count: 3 },
            { tag: 'brass', count: 2 },
        ]);
        expect(tagsForCategory(catalog, 'Lighting', 1).map((t) => t.tag)).toEqual(['lamp', 'brass', 'iron']);
    });
});

describe('filterStamps', () => {
    const catalog = catalogOf([
        stampDef('a', { name: 'Brass Lamp', category: 'Lighting', tags: ['lamp', 'brass'] }),
        stampDef('b', { name: 'Iron Lamp', category: 'Lighting', tags: ['lamp'], perspective: 'isometric' }),
        stampDef('c', { name: 'Hatch', category: 'Access', scale: 'exterior' }),
    ]);
    const ids = (filters: Parameters<typeof filterStamps>[1]): string[] => filterStamps(catalog, filters).map((s) => s.id);

    it('returns everything with no filters', () => {
        expect(ids({})).toEqual(['a', 'b', 'c']);
    });

    it('filters by category, perspective and scale', () => {
        expect(ids({ category: 'Lighting' })).toEqual(['a', 'b']);
        expect(ids({ perspective: 'isometric' })).toEqual(['b']);
        expect(ids({ scale: 'exterior' })).toEqual(['c']);
    });

    it('requires every active tag', () => {
        expect(ids({ tags: ['lamp'] })).toEqual(['a', 'b']);
        expect(ids({ tags: ['lamp', 'brass'] })).toEqual(['a']);
    });

    it('matches the query case-insensitively over name, tags and category', () => {
        expect(ids({ query: '  IRON ' })).toEqual(['b']);
        expect(ids({ query: 'brass' })).toEqual(['a']);
        expect(ids({ query: 'access' })).toEqual(['c']);
    });
});

describe('variants', () => {
    const variants = ['closed', 'open', 'broken'].map((state) => ({ state, image: `${state}.png`, width: 100, height: 100 }));
    const stamp = only([stampDef('door', { variants, defaultVariant: 1 })]);

    it('clamps an out-of-range index to the default variant', () => {
        expect(clampVariantIndex(stamp, 2)).toBe(2);
        expect(clampVariantIndex(stamp, 7)).toBe(1);
        expect(clampVariantIndex(stamp, -1)).toBe(1);
        expect(clampVariantIndex(stamp, 0.5)).toBe(1);
    });

    it('falls back to 0 when the default is itself out of range', () => {
        expect(clampVariantIndex(only([stampDef('x', { defaultVariant: 5 })]), 9)).toBe(0);
    });

    it('resolves a variant by clamped index', () => {
        expect(resolveVariant(stamp, 0).state).toBe('closed');
        expect(resolveVariant(stamp, 99).state).toBe('open');
    });

    it('cycles forward and backward, wrapping at both ends', () => {
        expect(cycleVariantIndex(stamp, 0)).toBe(1);
        expect(cycleVariantIndex(stamp, 2)).toBe(0);
        expect(cycleVariantIndex(stamp, 0, -1)).toBe(2);
    });

    it('leaves a single-variant stamp where it is', () => {
        const single = only([stampDef('s')]);
        expect(cycleVariantIndex(single, 0)).toBe(0);
        expect(cycleVariantIndex(single, 0, -1)).toBe(0);
    });
});

describe('effectiveProperties', () => {
    const lamp = only([
        stampDef('lamp', {
            light: LAMP_LIGHT,
            physical: { height: 2, cover: 0.5 },
            occlusion: { shape: 'bounds' },
            variants: [
                { state: 'lit', image: 'lit.png', width: 50, height: 50 },
                { state: 'unlit', image: 'unlit.png', width: 50, height: 50, light: null, physical: { cover: 1 } },
                {
                    state: 'blue',
                    image: 'blue.png',
                    width: 50,
                    height: 50,
                    light: { dim: 1, bright: 0 },
                    perspective: 'isometric',
                    occlusion: { shape: 'none' },
                },
            ],
        }),
    ]);

    it('inherits the stamp properties when the variant declares none', () => {
        expect(effectiveProperties(lamp, 0)).toEqual({
            // The pack's old `top-down` reads as orthographic.
            perspective: 'orthographic',
            doorState: undefined,
            light: LAMP_LIGHT,
            occlusion: { shape: 'bounds', sight: true, movement: true, light: true, sound: true },
            physical: { height: 2, cover: 0.5 },
            particles: null,
            sound: null,
            tile: null,
            pile: null,
            surface: null,
            terrain: null,
        });
    });

    it('resolves particles, sounds, piles, surfaces and terrain per variant, null removing them', () => {
        const smoke = { textures: ['smoke.png'], count: 20, lifetime: [800, 1500] as [number, number] };
        const [crate] = loadPacks([
            {
                moduleId: 'pack',
                manifest: manifest([
                    {
                        id: 'crate',
                        name: 'Crate',
                        category: 'Storage',
                        scale: 'interior',
                        perspective: 'top-down',
                        container: { type: 'vault', locked: true, sounds: { open: 'creak.ogg' } },
                        sound: { path: 'hum.ogg', radius: 3 },
                        door: { type: 'door', animation: { type: 'swing', texture: 'lid.png' } },
                        variants: [
                            { state: 'intact', image: 'a.png', width: 100, height: 100 },
                            {
                                state: 'destroyed',
                                image: 'b.png',
                                width: 100,
                                height: 100,
                                particles: [smoke],
                                sound: null,
                                container: false,
                                terrain: { difficulty: { walk: 2 } },
                                tile: { occlusion: { modes: ['fade'] } },
                            },
                        ],
                    },
                ]),
            },
        ]).stamps;
        if (!crate) {
            throw new Error('fixture failed to load');
        }
        const intact = effectiveProperties(crate, 0);
        expect(intact).toMatchObject({
            particles: null,
            pile: { type: 'vault', locked: true, sounds: { open: 'modules/pack/creak.ogg' } },
            terrain: null,
            tile: null,
        });
        // Asset paths resolve to the pack module's served URLs, like variant images.
        expect(intact.sound).toMatchObject({ path: 'modules/pack/hum.ogg', radius: 3, volume: 0.5, repeat: true, walls: true, easing: true });
        expect(crate.door?.animation?.texture).toBe('modules/pack/lid.png');
        const destroyed = effectiveProperties(crate, 1);
        expect(destroyed.particles).toEqual([{ ...smoke, textures: ['modules/pack/smoke.png'], area: { x: 0.5, y: 0.5, radius: 0 } }]);
        expect(destroyed).toMatchObject({ sound: null, pile: null, terrain: { difficulty: { walk: 2 } }, tile: { occlusion: { modes: ['fade'] } } });
    });

    it('reads a plain container flag as a container pile with Item Piles defaults', () => {
        const [chest] = loadPacks([
            {
                moduleId: 'pack',
                manifest: manifest([
                    {
                        id: 'chest',
                        name: 'Chest',
                        category: 'Storage',
                        scale: 'interior',
                        perspective: 'top-down',
                        container: true,
                        variants: [{ state: 'shut', image: 'c.png', width: 100, height: 100 }],
                    },
                ]),
            },
        ]).stamps;
        expect(chest ? effectiveProperties(chest, 0).pile : 'missing').toEqual({ type: 'container' });
    });

    it('treats light: null as unlit and merges physical field by field', () => {
        const props = effectiveProperties(lamp, 1);
        expect(props.light).toBeNull();
        expect(props.physical).toEqual({ height: 2, cover: 1 });
    });

    it('replaces light, occlusion and perspective outright', () => {
        const props = effectiveProperties(lamp, 2);
        expect(props.light).toEqual({ dim: 1, bright: 0 });
        expect(props.occlusion?.shape).toBe('none');
        expect(props.perspective).toBe('isometric');
    });

    it('has no light and no body for a plain stamp, and carries a variant door state', () => {
        const plain = only([
            stampDef('door', { door: { type: 'door' }, variants: [{ state: 'open', image: 'o.png', width: 1, height: 1, doorState: 'open' }] }),
        ]);
        const props = effectiveProperties(plain, 0);
        expect(props.light).toBeNull();
        expect(props.physical).toBeUndefined();
        expect(props.occlusion).toBeUndefined();
        expect(props.doorState).toBe('open');
    });
});

describe('computeTilePlacement', () => {
    const variant = { width: 100, height: 200 };

    it('centres the footprint on the point at the reference grid', () => {
        expect(computeTilePlacement({ variant, x: 500, y: 500, gridSize: 100, referenceGridSize: 100 })).toEqual({ x: 450, y: 400, width: 100, height: 200 });
    });

    it('rescales by scene grid over reference grid, then by the scale multiplier', () => {
        expect(computeTilePlacement({ variant, x: 0, y: 0, gridSize: 50, referenceGridSize: 100, scale: 3 })).toEqual({
            x: -75,
            y: -150,
            width: 150,
            height: 300,
        });
    });

    it('snaps the top-left corner to the scene grid', () => {
        expect(computeTilePlacement({ variant, x: 530, y: 470, gridSize: 100, referenceGridSize: 100, snap: true })).toEqual({
            x: 500,
            y: 400,
            width: 100,
            height: 200,
        });
    });

    it('does not snap on a non-positive grid', () => {
        expect(computeTilePlacement({ variant, x: 530, y: 470, gridSize: 0, referenceGridSize: 100, snap: true })).toEqual({
            x: 530,
            y: 470,
            width: 0,
            height: 0,
        });
    });
});
