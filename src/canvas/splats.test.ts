// SPDX-License-Identifier: AGPL-3.0-or-later
/** The controller's splat maps: blending textures with the brush, level by level, with undo. */
import { describe, expect, it } from 'vitest';
import { NO_LEVEL_ART } from '../tools/levels';
import { makeHarness } from './test-fakes';

const dab = { at: { x: 500, y: 400 }, radius: 100, strength: 1, erase: false };

/** The weight of `channel` at mask pixel (x, y) of a saved mask. */
function weight(mask: Uint8ClampedArray | undefined, width: number, x: number, y: number, channel: number): number {
    return mask?.[(y * width + x) * 4 + channel] ?? -1;
}

describe('splat maps', () => {
    it('blend on the level being edited: a map made over the scene, a channel per texture, drawn as it goes', async () => {
        const { c, sp, spr } = makeHarness();
        expect(c.blend({ ...dab, role: 'grassland' })).toBe(true);
        expect(c.blend({ ...dab, at: { x: 520, y: 400 }, role: 'sand' })).toBe(true);
        const layer = c.splatLayer();
        // The fake scene is 1000×800 at 100px squares: 80×64 mask pixels.
        expect(layer).toMatchObject({ level: null, path: 'splats/all.png', width: 80, height: 64, roles: ['grassland', 'sand', null, null] });
        expect(spr.shown.get('')).toEqual(['grassland', 'sand', null, null]);
        // Nothing is saved until the stroke ends.
        expect(sp.maskWrites).toEqual([]);
        await c.endBlend();
        expect(sp.maskWrites).toEqual(['splats/all.png']);
        expect(sp.layers).toEqual([layer]);
        expect(weight(sp.masks.get('splats/all.png'), 80, 41, 32, 1)).toBeGreaterThan(200);
    });

    it('undo a whole stroke at once, and redo it', async () => {
        const { c, sp } = makeHarness();
        c.blend({ ...dab, role: 'grassland' });
        await c.endBlend();
        c.blend({ ...dab, role: 'sand' });
        c.blend({ ...dab, at: { x: 600, y: 400 }, role: 'sand' });
        await c.endBlend();
        const painted = weight(sp.masks.get('splats/all.png'), 80, 40, 32, 1);
        expect(painted).toBeGreaterThan(200);
        await c.undo();
        expect(weight(sp.masks.get('splats/all.png'), 80, 40, 32, 1)).toBe(0);
        expect(c.splatLayer()?.roles).toEqual(['grassland', null, null, null]);
        await c.redo();
        expect(weight(sp.masks.get('splats/all.png'), 80, 40, 32, 1)).toBe(painted);
        expect(c.splatLayer()?.roles[1]).toBe('sand');
    });

    it('take away, on an undo, a map the stroke made', async () => {
        const { c, sp, spr } = makeHarness();
        c.blend({ ...dab, role: 'grassland' });
        await c.endBlend();
        await c.undo();
        expect(c.splatLayer()).toBeNull();
        expect(c.splatState()).toBe('none');
        expect(sp.layers).toEqual([]);
        expect(spr.shown.has('')).toBe(false);
        await c.redo();
        expect(c.splatLayer()?.roles[0]).toBe('grassland');
    });

    it('keep one map per level, showing only the level being edited', async () => {
        const { c, spr } = makeHarness();
        await c.addLevel('above', 'Ground');
        await c.addLevel('above', 'Upper');
        c.setActiveLevel('lv1');
        c.blend({ ...dab, role: 'grassland' });
        await c.endBlend();
        c.setActiveLevel('lv2');
        expect(spr.shown.has('lv1')).toBe(false);
        expect(c.splatLayer()).toBeNull();
        c.blend({ ...dab, role: 'rock' });
        expect(c.splatLayer()?.level).toBe('lv2');
        c.setActiveLevel('lv1');
        expect([...spr.shown.keys()]).toEqual(['lv1']);
    });

    it('show the blend of a level the edited one sees below it (the ground round an upper storey), and not of one it does not', async () => {
        const { c, spr } = makeHarness();
        await c.addLevel('above', 'Ground');
        await c.addLevel('above', 'Upper');
        c.setActiveLevel('lv1');
        c.blend({ ...dab, role: 'grassland' });
        await c.endBlend();
        c.setActiveLevel('lv2');
        expect(spr.shown.has('lv1')).toBe(false);
        const upper = c.levels.find((level) => level.id === 'lv2');
        await c.setLevelArt('lv2', { ...(upper?.art ?? NO_LEVEL_ART), visibleLevels: ['lv1'] });
        expect([...spr.shown.keys()]).toEqual(['lv1']);
        // Seen, never edited: blending on the upper storey makes its own map, the ground's untouched.
        c.blend({ ...dab, role: 'rock' });
        expect(c.splatLayer()?.level).toBe('lv2');
    });

    it('stack a layer for a fifth texture, sixteen at most, and read saved maps back in', async () => {
        const first = makeHarness();
        const roles = 'abcdefghijklmnop'.split('');
        for (const role of roles) {
            expect(first.c.blend({ ...dab, role })).toBe(true);
        }
        expect(first.c.blend({ ...dab, role: 'q' })).toBe(false);
        await first.c.endBlend();
        expect(first.c.splatStack(null).map((layer) => [layer.index, layer.path, layer.roles.join('')])).toEqual([
            [0, 'splats/all.png', 'abcd'],
            [1, 'splats/all-1.png', 'efgh'],
            [2, 'splats/all-2.png', 'ijkl'],
            [3, 'splats/all-3.png', 'mnop'],
        ]);
        // Each stack layer draws, in order, and the stroke is one undo step.
        expect([...first.spr.shown.keys()]).toEqual(['', '#1', '#2', '#3']);

        const second = makeHarness();
        second.sp.layers = [...first.sp.layers].reverse();
        for (const [path, mask] of first.sp.masks) {
            second.sp.masks.set(path, mask);
        }
        await second.c.loadSplats();
        expect(second.c.splatStack(null).map((layer) => layer.roles.join(''))).toEqual(['abcd', 'efgh', 'ijkl', 'mnop']);
        expect([...second.spr.shown.keys()]).toEqual(['', '#1', '#2', '#3']);
    });

    it('show a texture painted low in the stack through the layers above it, and unblend every layer', async () => {
        const { c, sp } = makeHarness();
        for (const role of ['a', 'b', 'c', 'd', 'e']) {
            c.blend({ ...dab, role });
        }
        await c.endBlend();
        // 'e' lies on the second layer; painting 'a' again takes it from there.
        expect(weight(sp.masks.get('splats/all-1.png'), 80, 40, 32, 0)).toBeGreaterThan(200);
        c.blend({ ...dab, role: 'a' });
        await c.endBlend();
        // Nearly none: a pixel's centre sits half a pixel off the dab's, just inside full strength.
        expect(weight(sp.masks.get('splats/all-1.png'), 80, 40, 32, 0)).toBeLessThan(10);
        expect(weight(sp.masks.get('splats/all.png'), 80, 40, 32, 0)).toBeGreaterThan(200);
        c.blend({ ...dab, role: 'a', erase: true });
        await c.endBlend();
        expect(Math.max(weight(sp.masks.get('splats/all.png'), 80, 40, 32, 0), weight(sp.masks.get('splats/all-1.png'), 80, 40, 32, 0))).toBeLessThan(10);
    });

    it('end a stroke that never started as nothing', async () => {
        const { c, sp } = makeHarness();
        await c.endBlend();
        await c.undo();
        expect(sp.maskWrites).toEqual([]);
    });
});
