// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
    bakedImagePath,
    blankMask,
    channelFor,
    maskLength,
    maskPoint,
    newSplatLayer,
    paintDab,
    parseSplatLayers,
    parseStrength,
    type SplatBake,
    type SplatLayer,
    splatState,
    stackChannelFor,
} from './splat';

const SCENE = { x: 100, y: 100, width: 2000, height: 1000 };

function layer(): SplatLayer {
    return newSplatLayer('lv1', 0, 'worlds/w/zephyr-cartography/splat-lv1.png', SCENE, 100);
}

/** One pixel's four weights. */
function weights(mask: Uint8ClampedArray, l: SplatLayer, x: number, y: number): number[] {
    const at = (y * l.width + x) * 4;
    return [mask[at] ?? -1, mask[at + 1] ?? -1, mask[at + 2] ?? -1, mask[at + 3] ?? -1];
}

describe('splat layers', () => {
    it('size a new mask by the grid, 8 pixels a square, with no roles yet', () => {
        expect(layer()).toMatchObject({ level: 'lv1', index: 0, width: 160, height: 80, roles: [null, null, null, null] });
        expect(newSplatLayer(null, 2, 'p', { x: 0, y: 0, width: 1e6, height: 50 }, 100)).toMatchObject({ index: 2, width: 2048, height: 4 });
        expect(blankMask(layer())).toHaveLength(160 * 80 * 4);
    });

    it('put a role in a stack where it already is, else the lowest layer with a free channel, else nowhere', () => {
        const full = { ...layer(), roles: ['a', 'b', 'c', 'd'] } as const;
        const upper = { ...layer(), index: 1, roles: ['e', null, null, null] } as const;
        expect(stackChannelFor([full, upper], 'c')).toMatchObject({ index: 0, channel: 2, layer: full });
        expect(stackChannelFor([full, upper], 'f')).toMatchObject({ index: 1, channel: 1, layer: { roles: ['e', 'f', null, null] } });
        expect(stackChannelFor([full], 'f')).toBeNull();
        expect(stackChannelFor([], 'f')).toBeNull();
    });

    it('read a layer’s place in its stack, a layer saved before stacks as the first, and one out of range as the first', () => {
        const index = (value: number | undefined): number | undefined => parseSplatLayers([{ ...layer(), index: value }])[0]?.index;
        expect([index(2), index(undefined), index(-1), index(9)]).toEqual([2, 0, 0, 0]);
    });

    it('give each texture role a channel, the one it holds or the first free, until all four are taken', () => {
        const first = channelFor(layer(), 'grassland');
        expect(first?.channel).toBe(0);
        const second = first && channelFor(first.layer, 'sand');
        expect(second?.channel).toBe(1);
        expect(second && channelFor(second.layer, 'grassland')?.channel).toBe(0);
        const full = { ...layer(), roles: ['a', 'b', 'c', 'd'] as const };
        expect(channelFor(full, 'e')).toBeNull();
        expect(channelFor(full, 'c')?.channel).toBe(2);
    });

    it('map scene points and lengths into mask pixels', () => {
        expect(maskPoint(layer(), { x: 1100, y: 600 })).toEqual({ x: 80, y: 40 });
        expect(maskLength(layer(), 250)).toBe(20);
    });
});

describe('paintDab', () => {
    it('paints one channel softly, full at the centre and nothing past the rim, and reports what it touched', () => {
        const l = layer();
        const mask = blankMask(l);
        const rect = paintDab(mask, l, { at: { x: 20, y: 20 }, radius: 5, channel: 1, strength: 1, erase: false });
        expect(rect).toEqual({ x: 15, y: 15, width: 10, height: 10 });
        const [, centre] = weights(mask, l, 20, 20);
        const [, edge] = weights(mask, l, 16, 20);
        expect(centre).toBeGreaterThan(240);
        expect(edge).toBeGreaterThan(0);
        expect(edge).toBeLessThan(centre ?? 0);
        expect(weights(mask, l, 30, 20)).toEqual([0, 0, 0, 0]);
    });

    it('takes weight from the other channels as it paints one, and erasing takes from them all', () => {
        const l = layer();
        const mask = blankMask(l);
        paintDab(mask, l, { at: { x: 20, y: 20 }, radius: 5, channel: 0, strength: 1, erase: false });
        paintDab(mask, l, { at: { x: 20, y: 20 }, radius: 5, channel: 2, strength: 0.5, erase: false });
        const [red, , blue] = weights(mask, l, 20, 20);
        expect(red).toBeGreaterThan(100);
        expect(red).toBeLessThan(140);
        expect((red ?? 0) + (blue ?? 0)).toBeLessThanOrEqual(256);
        paintDab(mask, l, { at: { x: 20, y: 20 }, radius: 5, channel: 0, strength: 1, erase: true });
        // Nearly all of it: a pixel's centre sits half a pixel off the dab's, just inside full strength.
        expect(Math.max(...weights(mask, l, 20, 20))).toBeLessThan(10);
    });

    it('stays inside the mask at its edges, and does nothing wholly outside it', () => {
        const l = layer();
        const mask = blankMask(l);
        expect(paintDab(mask, l, { at: { x: 0, y: 0 }, radius: 4, channel: 3, strength: 1, erase: false })).toEqual({ x: 0, y: 0, width: 4, height: 4 });
        expect(paintDab(mask, l, { at: { x: -50, y: 10 }, radius: 4, channel: 3, strength: 1, erase: false })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });
});

describe('parseStrength', () => {
    it('takes a blend strength from a light touch to full, and nothing else', () => {
        expect(['0.3', '1', '0.05', '', '0', '1.5', 'firm'].map(parseStrength)).toEqual([0.3, 1, 0.05, null, null, null, null]);
    });
});

describe('parseSplatLayers', () => {
    it('reads layers back, and drops malformed ones', () => {
        const saved = JSON.parse(JSON.stringify([{ ...layer(), roles: ['grassland', null, 'sand', null] }]));
        expect(parseSplatLayers(saved)).toEqual([{ ...layer(), roles: ['grassland', null, 'sand', null] }]);
        expect(parseSplatLayers([{ path: 'p', bounds: { x: 0, y: 0, width: 0, height: 5 }, width: 1, height: 1, roles: [] }, 'junk', { path: 3 }])).toEqual([]);
        expect(parseSplatLayers(null)).toEqual([]);
        expect(parseSplatLayers([{ path: 'p', bounds: { width: 5, height: 5 }, width: 2, height: 2, roles: [], level: 7 }])).toEqual([
            {
                level: null,
                index: 0,
                path: 'p',
                bounds: { x: 0, y: 0, width: 5, height: 5 },
                width: 2,
                height: 2,
                roles: [null, null, null, null],
                baked: null,
            },
        ]);
    });

    it('keeps where a layer is baked, reads an older layer’s Tile id as a Tile, and one before baking as not baked', () => {
        const baked = (bake: object | string | undefined): SplatBake | null | undefined =>
            parseSplatLayers(JSON.parse(JSON.stringify([{ ...layer(), baked: bake }])))[0]?.baked;
        expect(baked({ into: 'tile', tile: 'tile1' })).toEqual({ into: 'tile', tile: 'tile1' });
        expect(baked({ into: 'background', previous: 'maps/g.webp' })).toEqual({ into: 'background', previous: 'maps/g.webp' });
        expect(baked({ into: 'background' })).toEqual({ into: 'background', previous: null });
        expect(baked('tile1')).toEqual({ into: 'tile', tile: 'tile1' });
        expect(baked(undefined)).toBeNull();
        expect(baked('')).toBeNull();
        expect(baked({ into: 'tile', tile: '' })).toBeNull();
        expect(baked({ into: 'ceiling' })).toBeNull();
    });

    it('says whether a level’s blend is there, live or baked, and into what', () => {
        expect(splatState(null)).toBe('none');
        expect(splatState(layer())).toBe('live');
        expect(splatState({ ...layer(), baked: { into: 'background', previous: null } })).toBe('background');
    });
});

describe('bakedImagePath', () => {
    it('saves the baked image beside the mask', () => {
        expect(bakedImagePath(layer())).toBe('worlds/w/zephyr-cartography/splat-lv1-baked.png');
        expect(bakedImagePath({ ...layer(), path: 'masks/odd' })).toBe('masks/odd-baked.png');
    });
});
