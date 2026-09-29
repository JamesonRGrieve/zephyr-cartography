// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { BIOMES } from './biome';
import {
    BIOME_TEXTURE,
    BIOME_TINT,
    biomeSwatches,
    compressedTextures,
    isCompressedTexture,
    pickTextureSet,
    previewResolver,
    roleLabel,
    shownImage,
    TEXTURE_TILE_SQUARES,
    textureResolver,
    textureSetChoices,
    textureSwatches,
    tileSize,
    tileSquaresByUrl,
} from './texture';

describe('texture choices', () => {
    it('reads a role as a person would', () => {
        expect(roleLabel('floor.cobbled-street')).toBe('Cobbled street');
        expect(roleLabel('grassland')).toBe('Grassland');
        expect(roleLabel('wall.')).toBe('');
    });

    it('lists every texture of the set by label, with the image a panel can show', () => {
        const previews = (role: string): string | null => (role === 'floor.marble' ? null : `${role}.png`);
        expect(textureSwatches(['sand', 'floor.marble', 'floor.cobbled-street'], previews)).toEqual([
            { role: 'floor.cobbled-street', label: 'Cobbled street', image: 'floor.cobbled-street.png' },
            { role: 'floor.marble', label: 'Marble', image: null },
            { role: 'sand', label: 'Sand', image: 'sand.png' },
        ]);
        // Two roles reading alike keep a stable order.
        expect(textureSwatches(['wall.stone', 'floor.stone'], previews).map((s) => s.role)).toEqual(['floor.stone', 'wall.stone']);
    });
});

describe('tileSize', () => {
    it('tiles a texture every few grid squares whatever its own size, or at its own size with no grid', () => {
        expect(tileSize(100, 1024, 1024)).toEqual({ width: 100 * TEXTURE_TILE_SQUARES, height: 100 * TEXTURE_TILE_SQUARES });
        expect(tileSize(100, 512, 512)).toEqual({ width: 100 * TEXTURE_TILE_SQUARES, height: 100 * TEXTURE_TILE_SQUARES });
        expect(tileSize(0, 512, 256)).toEqual({ width: 512, height: 256 });
    });

    it('looks up the squares a set gives each texture by its image, ignoring roles the set has no image for', () => {
        const set = { key: 'p:s', name: 'S', textures: { 'floor.plate': 'plate.png', 'dirt': 'dirt.png' }, tileSquares: { 'floor.plate': 6, 'floor.gone': 3 } };
        expect([...tileSquaresByUrl([set, { key: 'p:t', name: 'T', textures: { dirt: 'd2.png' } }])]).toEqual([['plate.png', 6]]);
    });

    it('spans the squares a pack gives a texture drawn to a scale', () => {
        // Three riveted plates meant to be two squares each: a tile of six squares.
        expect(tileSize(100, 600, 600, 6)).toEqual({ width: 600, height: 600 });
        expect(tileSize(100, 512, 1024, 3)).toEqual({ width: 300, height: 600 });
    });

    it('keeps a texture that is not square in its own proportions, its shorter side the tile’s squares', () => {
        // A plank texture twice as tall as wide: two squares across, four down, never squashed square.
        expect(tileSize(100, 512, 1024)).toEqual({ width: 100 * TEXTURE_TILE_SQUARES, height: 2 * 100 * TEXTURE_TILE_SQUARES });
        expect(tileSize(100, 1000, 500)).toEqual({ width: 2 * 100 * TEXTURE_TILE_SQUARES, height: 100 * TEXTURE_TILE_SQUARES });
    });
});

const sets = [
    { key: 'a:photo', name: 'Photo (CC0)', textures: { grassland: 'modules/a/grass.jpg', road: 'modules/a/road.jpg' } },
    { key: 'b:paint', name: 'Painted', textures: { grassland: 'modules/b/grass.png' } },
];

describe('compressed textures', () => {
    const compressed = {
        key: 'c:gpu',
        name: 'GPU',
        textures: { grassland: 'modules/c/grass.ktx2', forest: 'modules/c/forest.basis', road: 'modules/c/road.webp' },
        previews: { grassland: 'modules/c/grass-preview.webp' },
    };

    it('knows KTX2 and Basis files, whatever their case and query', () => {
        expect(['a.ktx2', 'B.KTX2', 'c.basis?v=2', 'd.basis#x', 'e.webp', 'ktx2.png'].map(isCompressedTexture)).toEqual([true, true, true, true, false, false]);
    });

    it('shows a panel a preview, else a browser image, and nothing for compressed art without one', () => {
        expect(shownImage('a.ktx2', 'a.webp')).toBe('a.webp');
        expect(shownImage('a.png', undefined)).toBe('a.png');
        expect(shownImage('a.ktx2', undefined)).toBeNull();
        const shown = previewResolver(compressed, PATTERNS);
        expect([shown('grassland'), shown('forest'), shown('road'), shown('snow'), shown('procedural.ripple')]).toEqual([
            'modules/c/grass-preview.webp',
            null,
            'modules/c/road.webp',
            null,
            'pattern:ripple',
        ]);
    });

    it('lists the compressed images the canvas must load first', () => {
        expect(compressedTextures(compressed)).toEqual(['modules/c/grass.ktx2', 'modules/c/forest.basis']);
        expect(compressedTextures(null)).toEqual([]);
    });
});

describe('BIOME_TEXTURE / BIOME_TINT', () => {
    it('has a texture role and a tint for every biome', () => {
        for (const biome of BIOMES) {
            expect(biome in BIOME_TEXTURE).toBe(true);
            expect(BIOME_TINT[biome]).toBeTypeOf('number');
        }
    });

    it('leaves water and ocean untextured, and names land biomes by role', () => {
        expect(BIOME_TEXTURE.water).toBeNull();
        expect(BIOME_TEXTURE.ocean).toBeNull();
        expect(BIOME_TEXTURE.grassland).toBe('grassland');
        expect(BIOME_TEXTURE.lava).toBe('lava');
    });

    it('recolours only the neutral tiles (lava, ice); leaves natural tiles white', () => {
        expect(BIOME_TINT.lava).not.toBe(0xffffff);
        expect(BIOME_TINT.ice).not.toBe(0xffffff);
        expect(BIOME_TINT.grassland).toBe(0xffffff);
    });
});

/** Each pattern's image, as the boundary would give it. */
const PATTERNS = (pattern: string): string => `pattern:${pattern}`;

describe('texture sets', () => {
    it('picks the chosen set, else the first, else none', () => {
        expect(pickTextureSet(sets, 'b:paint')?.key).toBe('b:paint');
        expect(pickTextureSet(sets, 'gone:set')?.key).toBe('a:photo');
        expect(pickTextureSet([], 'a:photo')).toBeNull();
    });

    it('resolves roles to URLs, null for a role the set lacks or with no set, and patterns whatever the set', () => {
        const resolve = textureResolver(pickTextureSet(sets, 'b:paint'), PATTERNS);
        expect(resolve('grassland')).toBe('modules/b/grass.png');
        expect(resolve('road')).toBeNull();
        expect(textureResolver(null, PATTERNS)('grassland')).toBeNull();
        expect(textureResolver(null, PATTERNS)('procedural.ripple')).toBe('pattern:ripple');
        // With no set chosen, a wall still comes from any set that has it.
        const walled = [{ key: 'a:photo', name: 'Photo', textures: { 'wall.stone': 'modules/a/stone.jpg' } }];
        expect(textureResolver(null, PATTERNS, walled)('wall.stone')).toBe('modules/a/stone.jpg');
    });

    it('borrows a wall role the set lacks from another set, never a floor or ground role', () => {
        const painted = { key: 'p:paint', name: 'Painted', textures: { grassland: 'modules/p/grass.png' } };
        const photo = { key: 'a:photo', name: 'Photo', textures: { 'wall.stone': 'modules/a/stone.jpg', 'road': 'modules/a/road.jpg' } };
        const resolve = textureResolver(painted, PATTERNS, [painted, photo]);
        expect(resolve('wall.stone')).toBe('modules/a/stone.jpg');
        expect(resolve('road')).toBeNull();
        expect(resolve('grassland')).toBe('modules/p/grass.png');
        expect(resolve('wall.brick')).toBeNull();
    });

    it('borrows first from the sets a set names as its fallback, in its order, then from the rest as listed', () => {
        const warm = { key: 'p:warm', name: 'Warm', textures: { 'wall.concrete': 'modules/p/beige.jpg', 'wall.brick': 'modules/p/brick.jpg' } };
        const grey = { key: 'p:grey', name: 'Grey', textures: { 'wall.concrete': 'modules/p/grey.jpg' } };
        const painted = { key: 'p:paint', name: 'Painted', textures: {}, fallback: ['grey'] };
        const resolve = textureResolver(painted, PATTERNS, [warm, grey, painted]);
        expect(resolve('wall.concrete')).toBe('modules/p/grey.jpg');
        // A wall the named set lacks still comes from the rest.
        expect(resolve('wall.brick')).toBe('modules/p/brick.jpg');
        // Without a fallback, the sets as listed.
        expect(textureResolver({ ...painted, fallback: undefined }, PATTERNS, [warm, grey])('wall.concrete')).toBe('modules/p/beige.jpg');
    });

    it('offers each set by name as a setting choice', () => {
        expect(textureSetChoices(sets)).toEqual({ 'a:photo': 'Photo (CC0)', 'b:paint': 'Painted' });
    });

    it('gives every biome a swatch: the set’s texture where it has one, and always a flat colour', () => {
        const swatches = biomeSwatches(textureResolver(pickTextureSet(sets, 'a:photo'), PATTERNS));
        expect(swatches.map((s) => s.biome)).toEqual(BIOMES);
        expect(swatches.find((s) => s.biome === 'grassland')).toEqual({ biome: 'grassland', image: 'modules/a/grass.jpg', colour: '#5a7b3c' });
        expect(swatches.find((s) => s.biome === 'water')).toEqual({ biome: 'water', image: null, colour: '#2f5d7c' });
        expect(swatches.find((s) => s.biome === 'forest')?.image).toBeNull();
    });
});
