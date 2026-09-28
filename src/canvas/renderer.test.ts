// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { tintToward } from '../tools/colour';
import type { Feature } from '../tools/feature';
import { NEW_FEATURE } from '../tools/feature-common';
import { LIQUID_LOOKS, type CartographyPath } from '../tools/path';
import type { RegionFeature } from '../tools/region';
import type { RoomFeature } from '../tools/room';
import type { TextureResolver } from '../tools/texture';
import { GraphicsFeatureRenderer, type DrawSurface } from './renderer';

/** A texture set providing every role as `<role>.jpg`. */
const RESOLVE: TextureResolver = (role) => `${role}.jpg`;

class FakeSurface implements DrawSurface {
    readonly filled: { id: string; n: number; color: number; feather: boolean }[] = [];
    readonly textured: {
        id: string;
        n: number;
        polygon: readonly number[];
        textureFile: string;
        tint: number;
        alpha: number;
        feather: boolean;
        angle: number;
    }[] = [];
    readonly removed: string[] = [];
    cleared = 0;
    fill(id: string, polygon: readonly number[], color: number, _alpha: number, feather: boolean): void {
        this.filled.push({ id, n: polygon.length, color, feather });
    }
    fillTextured(id: string, polygon: readonly number[], textureFile: string, tint: number, alpha: number, feather: boolean, angle: number): void {
        this.textured.push({ id, n: polygon.length, polygon, textureFile, tint, alpha, feather, angle });
    }
    remove(id: string): void {
        this.removed.push(id);
    }
    clear(): void {
        this.cleared += 1;
    }
}

const road: CartographyPath = {
    type: 'path',
    id: 'a',
    kind: 'road',
    points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
    ],
    halfWidths: [5, 5],
    walls: null,
    river: null,
    ...NEW_FEATURE,
};
const river: Feature = { ...road, id: 'r', kind: 'river', river: { ...LIQUID_LOOKS.water, bed: null } };
const lake: RegionFeature = {
    type: 'region',
    id: 'b',
    biome: 'water',
    texture: null,
    sharp: false,
    points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
    ],
    ...NEW_FEATURE,
};
const meadow: Feature = { ...lake, id: 'm', biome: 'grassland' };
const swath: Feature = {
    type: 'stroke',
    id: 'sw',
    biome: 'forest',
    texture: null,
    points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
    ],
    radius: 15,
    ...NEW_FEATURE,
};
const room: RoomFeature = {
    type: 'room',
    id: 'rm',
    floor: 'dirt',
    wall: null,
    wallKind: 'solid',
    ceiling: true,
    lit: true,
    points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
    ],
    doors: [],
    ...NEW_FEATURE,
};

describe('GraphicsFeatureRenderer', () => {
    it('textures a road ribbon (bundled tile)', () => {
        const s = new FakeSurface();
        new GraphicsFeatureRenderer(s, RESOLVE).set('a', road);
        expect(s.textured).toHaveLength(1);
        expect(s.textured[0]?.textureFile).toBe('road.jpg');
        expect(s.textured[0]?.n ?? 0).toBeGreaterThanOrEqual(6);
    });

    it('draws a river in the set’s water texture, gently tinted by its shade', () => {
        const s = new FakeSurface();
        new GraphicsFeatureRenderer(s, RESOLVE).set('r', river);
        expect(s.filled).toHaveLength(0);
        expect(s.textured).toEqual([expect.objectContaining({ id: 'r', textureFile: 'water.jpg', tint: tintToward(LIQUID_LOOKS.water.shade, 0.5) })]);
    });

    it('draws each liquid in the first of its textures the set has, else ripples in its full shade', () => {
        const s = new FakeSurface();
        const painted: TextureResolver = (role) => (['floor.toxic-sludge', 'lava', 'procedural.ripple'].includes(role) ? `${role}.png` : null);
        const gr = new GraphicsFeatureRenderer(s, painted);
        gr.set('p', { ...river, id: 'p', river: { ...LIQUID_LOOKS.poison, bed: null } });
        gr.set('l', { ...river, id: 'l', river: { ...LIQUID_LOOKS.lava, bed: null } });
        gr.set('w', { ...river, id: 'w', river: { ...LIQUID_LOOKS.water, shade: 0x0000ff, bed: null } });
        expect(s.textured.map((t) => [t.id, t.textureFile, t.tint])).toEqual([
            ['p', 'floor.toxic-sludge.png', tintToward(LIQUID_LOOKS.poison.shade, 0.6)],
            ['l', 'lava.png', LIQUID_LOOKS.lava.shade],
            ['w', 'procedural.ripple.png', 0x0000ff],
        ]);
    });

    it('never draws a flat colour where a pattern will do: land, materials, walls and roads fall back to grain', () => {
        const s = new FakeSurface();
        const patternsOnly: TextureResolver = (role) => (role.startsWith('procedural.') ? `${role}.png` : null);
        const gr = new GraphicsFeatureRenderer(s, patternsOnly);
        gr.set('m', meadow);
        gr.set('a', road);
        gr.set('rm', { ...room, floor: 'floor.oak', wall: 'wall.brick' });
        gr.set('b', lake);
        expect(s.filled).toEqual([]);
        expect(s.textured.find((t) => t.id === 'm')).toMatchObject({ textureFile: 'procedural.grain.png', tint: 0x5a7b3c });
        expect(s.textured.find((t) => t.id === 'b')).toMatchObject({ textureFile: 'procedural.ripple.png', tint: 0x2f5d7c });
        expect(s.textured.find((t) => t.id === 'rm:wall:0')?.textureFile).toBe('procedural.grain.png');
    });

    it('lays a river’s bed beneath it, wider and feathered, and takes the bed away with the river', () => {
        const s = new FakeSurface();
        const gr = new GraphicsFeatureRenderer(s, RESOLVE);
        gr.set('r', { ...river, river: LIQUID_LOOKS.water });
        // The bed is drawn first, so the river lies on top of it.
        expect(s.textured.map((t) => [t.id, t.textureFile, t.feather])).toEqual([
            ['r:bed:0', 'dirt.jpg', true],
            ['r', 'water.jpg', false],
        ]);
        gr.set('r', river); // the bed taken away
        expect(s.removed).toContain('r:bed:0');
        gr.set('r', { ...river, river: { ...LIQUID_LOOKS.water, bed: 'floor.stone' } });
        expect(s.textured.at(-2)).toMatchObject({ id: 'r:bed:0', textureFile: 'floor.stone.jpg' });
        gr.remove('r');
        expect(s.removed.filter((id) => id === 'r:bed:0')).toHaveLength(2);
    });

    it('textures a land biome region and recolours nothing (white tint)', () => {
        const s = new FakeSurface();
        new GraphicsFeatureRenderer(s, RESOLVE).set('m', meadow);
        expect(s.textured).toHaveLength(1);
        expect(s.textured[0]?.textureFile).toBe('grassland.jpg');
        expect(s.textured[0]?.tint).toBe(0xffffff);
    });

    it('draws a water region translucent in the set’s water texture, as a river of water is: one water where a river leaves a lake', () => {
        const s = new FakeSurface();
        new GraphicsFeatureRenderer(s, RESOLVE).set('b', lake);
        expect(s.filled).toHaveLength(0);
        expect(s.textured).toEqual([expect.objectContaining({ id: 'b', textureFile: 'water.jpg', tint: tintToward(LIQUID_LOOKS.water.shade, 0.5) })]);
        const flowing = new FakeSurface();
        new GraphicsFeatureRenderer(flowing, RESOLVE).set('r', river);
        expect(flowing.textured[0]?.alpha).toBe(s.textured[0]?.alpha);
        expect(s.textured[0]?.n ?? 0).toBeGreaterThanOrEqual(6);
    });

    it('textures a brush stroke as a feathered biome swath', () => {
        const s = new FakeSurface();
        new GraphicsFeatureRenderer(s, RESOLVE).set('sw', swath);
        expect(s.textured).toHaveLength(1);
        expect(s.textured[0]?.textureFile).toBe('forest.jpg');
        expect(s.textured[0]?.feather).toBe(true);
        // Ground is never turned: its tiling lines up with every other fill's.
        expect(s.textured[0]?.angle).toBe(0);
    });

    it('renders a room floor textured with a crisp (unfeathered) edge on its exact polygon', () => {
        const s = new FakeSurface();
        new GraphicsFeatureRenderer(s, RESOLVE).set('rm', room);
        expect(s.textured).toHaveLength(1);
        expect(s.textured[0]?.textureFile).toBe('dirt.jpg');
        expect(s.textured[0]?.feather).toBe(false);
        expect(s.textured[0]?.n).toBe(8);
    });

    it('fills a pack floor material by role, or a flat colour when not even a pattern resolves', () => {
        const s = new FakeSurface();
        new GraphicsFeatureRenderer(s, (role) => (role === 'floor.oak' ? 'oak.jpg' : null)).set('rm', { ...room, floor: 'floor.oak' });
        expect(s.textured[0]?.textureFile).toBe('oak.jpg');
        const flat = new FakeSurface();
        new GraphicsFeatureRenderer(flat, () => null).set('rm', { ...room, floor: 'floor.oak' });
        expect(flat.filled).toHaveLength(1);
    });

    it('draws one wall band per perimeter segment in the wall material, and removes them with the room', () => {
        const s = new FakeSurface();
        const gr = new GraphicsFeatureRenderer(s, (role) => (role === 'wall.brick' ? 'brick.jpg' : null));
        gr.set('rm', { ...room, wall: 'wall.brick' });
        const bands = s.textured.filter((t) => t.id.startsWith('rm:wall:'));
        expect(bands.map((b) => b.textureFile)).toEqual(['brick.jpg', 'brick.jpg', 'brick.jpg', 'brick.jpg']);
        // As thick as the renderer is told (a share of the grid square), else a fixed width: the top wall's band, across y.
        const across = (polygon: readonly number[] | undefined): number => {
            const ys = (polygon ?? []).filter((_, i) => i % 2 === 1);
            return Math.max(...ys) - Math.min(...ys);
        };
        expect(across(bands[0]?.polygon)).toBeCloseTo(8);
        const thick = new FakeSurface();
        new GraphicsFeatureRenderer(thick, (role) => (role === 'wall.brick' ? 'brick.jpg' : null), 20).set('rm', { ...room, wall: 'wall.brick' });
        expect(across(thick.textured.find((t) => t.id === 'rm:wall:0')?.polygon)).toBeCloseTo(20);
        // Each band's texture turned to its wall (clockwise round the room), so courses run along it.
        expect(bands.map((b) => Math.round((b.angle * 180) / Math.PI))).toEqual([0, 90, 180, -90]);
        gr.set('rm', room); // walls no longer drawn
        expect(s.removed.filter((id) => id.startsWith('rm:wall:'))).toHaveLength(4);
        gr.set('rm', { ...room, wall: 'wall.missing' });
        expect(s.filled.filter((f) => f.id.startsWith('rm:wall:'))).toHaveLength(4);
        gr.remove('rm');
        expect(s.removed.filter((id) => id.startsWith('rm:wall:'))).toHaveLength(8);
    });

    it('feathers region edges but keeps paths crisp', () => {
        const s = new FakeSurface();
        const gr = new GraphicsFeatureRenderer(s, RESOLVE);
        gr.set('m', meadow); // textured land region
        gr.set('b', lake); // water region
        gr.set('a', road); // textured path
        expect(s.textured.find((t) => t.id === 'm')?.feather).toBe(true);
        expect(s.textured.find((t) => t.id === 'b')?.feather).toBe(true);
        expect(s.textured.find((t) => t.id === 'a')?.feather).toBe(false);
    });

    it('falls back to the flat biome colour only when neither the role nor a pattern resolves', () => {
        const s = new FakeSurface();
        const gr = new GraphicsFeatureRenderer(s, (role) => (role === 'road' ? 'road.png' : null));
        gr.set('m', meadow);
        gr.set('a', road);
        expect(s.filled.map((f) => f.id)).toEqual(['m']);
        expect(s.textured.map((t) => t.textureFile)).toEqual(['road.png']);
    });

    it('draws painted ground in a texture of its own where the set has it, else in its biome’s', () => {
        const s = new FakeSurface();
        const gr = new GraphicsFeatureRenderer(s, (role) => (role === 'floor.cobbles' || role === 'forest' ? `${role}.jpg` : null));
        gr.set('cobbled', { ...swath, texture: 'floor.cobbles' });
        gr.set('missing', { ...swath, texture: 'floor.gone' });
        gr.set('meadow', { ...lake, biome: 'forest', texture: 'floor.cobbles' });
        expect(s.textured.map((t) => [t.id, t.textureFile, t.tint, t.feather])).toEqual([
            ['cobbled', 'floor.cobbles.jpg', 0xffffff, true],
            ['missing', 'forest.jpg', 0xffffff, true],
            ['meadow', 'floor.cobbles.jpg', 0xffffff, true],
        ]);
    });

    it('previews a brush stroke as it will be painted, and any other shape as a flat highlight', () => {
        const s = new FakeSurface();
        const gr = new GraphicsFeatureRenderer(s, RESOLVE);
        gr.preview(swath);
        expect(s.textured).toEqual([expect.objectContaining({ id: '__preview__', textureFile: 'forest.jpg', feather: true })]);
        gr.preview(meadow);
        expect(s.filled).toEqual([expect.objectContaining({ id: '__preview__', feather: false })]);
        gr.preview({ ...swath, points: [] });
        gr.clearPreview();
        expect(s.removed).toEqual(['__preview__', '__preview__']);
    });

    it('clears the surface', () => {
        const s = new FakeSurface();
        new GraphicsFeatureRenderer(s, RESOLVE).clear();
        expect(s.cleared).toBe(1);
    });
});
