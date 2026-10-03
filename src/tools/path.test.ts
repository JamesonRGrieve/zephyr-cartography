// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { DEFAULT_HALF_WIDTH, isLiquid, LIQUID_LOOKS, LIQUIDS, makePath, parsePath, type RiverLook } from './path';

const LINE = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
];

describe('parsePath', () => {
    it('returns null for non-path input', () => {
        expect(parsePath(null)).toBeNull();
        expect(parsePath(42)).toBeNull();
        expect(
            parsePath({
                id: 'x',
                kind: 'bad',
                points: [
                    { x: 0, y: 0 },
                    { x: 1, y: 1 },
                ],
            }),
        ).toBeNull();
        expect(parsePath({ id: 'y', kind: 'river', points: [{ x: 0, y: 0 }] })).toBeNull();
    });

    it('parses a valid path with the type tag + normalised widths', () => {
        const p = parsePath({
            id: 'a',
            kind: 'road',
            points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
            ],
            walls: true,
        });
        expect(p?.type).toBe('path');
        expect(p?.kind).toBe('road');
        // `walls: true`, the original format, is solid walls.
        expect(p?.walls).toBe('solid');
        expect(p?.halfWidths).toEqual([DEFAULT_HALF_WIDTH, DEFAULT_HALF_WIDTH]);
    });

    it('carries explicit per-point widths', () => {
        const p = parsePath({
            id: 'w',
            kind: 'river',
            points: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 2, y: 0 },
            ],
            halfWidths: [5, 10, 15],
        });
        expect(p?.halfWidths).toEqual([5, 10, 15]);
    });
});

describe('makePath', () => {
    it('builds a path from a point stream with uniform width', () => {
        const p = makePath(
            'id',
            'road',
            [
                { x: 0, y: 0 },
                { x: 5, y: 5 },
            ],
            8,
            'window',
            LIQUID_LOOKS.lava,
        );
        expect(p?.type).toBe('path');
        expect(p?.halfWidths).toEqual([8, 8]);
        expect(p?.walls).toBe('window');
        expect(p?.river).toBeNull(); // a road has no look, whatever is passed
    });

    it('gives a river the look it is drawn with', () => {
        const look = { liquid: 'acid', shade: 0x00ff00, bed: null } as const;
        expect(makePath('id', 'river', LINE, 8, null, look)?.river).toEqual(look);
    });

    it('returns null for fewer than two points', () => {
        expect(makePath('id', 'road', [{ x: 0, y: 0 }], 8, null, LIQUID_LOOKS.water)).toBeNull();
    });

    it('takes a width for each point, and a road its own surface, which a river never has', () => {
        const road = makePath('id', 'road', LINE, [6, 9], null, LIQUID_LOOKS.water, 'dirt');
        expect(road?.halfWidths).toEqual([6, 9]);
        expect(road?.surface).toBe('dirt');
        expect(makePath('id', 'river', LINE, 8, null, LIQUID_LOOKS.water, 'dirt')?.surface).toBeNull();
        // A road's surface survives being saved and read back; one saved before surfaces is the set's road.
        const { surface, ...older } = road ?? { surface: null };
        expect(parsePath(road)?.surface).toBe(surface);
        expect(parsePath(older)?.surface).toBeNull();
    });
});

describe('path walls', () => {
    it('reads a wall kind, solid for the original `true`, and none for anything else', () => {
        const walls = (value: string | boolean | number): string | null | undefined =>
            parsePath({ type: 'path', id: 'a', kind: 'road', points: LINE, walls: value })?.walls;
        expect([walls('terrain'), walls(true), walls(false), walls('brick'), walls(3)]).toEqual(['terrain', 'solid', null, null, null]);
    });
});

describe('river looks', () => {
    it('reads a river’s look field by field over its liquid’s defaults', () => {
        const river = (look: Readonly<Record<string, string | number | null>>): RiverLook | null | undefined =>
            parsePath({ type: 'path', id: 'r', kind: 'river', points: LINE, river: look })?.river;
        expect(river({ liquid: 'poison', shade: 0x123456, bed: 'sand' })).toEqual({ liquid: 'poison', shade: 0x123456, bed: 'sand' });
        expect(river({ liquid: 'lava' })).toEqual(LIQUID_LOOKS.lava);
        expect(river({ liquid: 'lava', bed: null })).toEqual({ ...LIQUID_LOOKS.lava, bed: null });
        expect(river({ liquid: 'mercury', shade: 'red', bed: 7 })).toEqual(LIQUID_LOOKS.water);
    });

    it('gives a river saved before looks water on its usual bed, and a road none', () => {
        expect(parsePath({ type: 'path', id: 'r', kind: 'river', points: LINE })?.river).toEqual(LIQUID_LOOKS.water);
        expect(parsePath({ type: 'path', id: 'a', kind: 'road', points: LINE, river: LIQUID_LOOKS.lava })?.river).toBeNull();
    });

    it('offers every liquid a look of its own', () => {
        expect(LIQUIDS.map((liquid) => LIQUID_LOOKS[liquid].liquid)).toEqual(LIQUIDS);
        expect(LIQUIDS.every(isLiquid)).toBe(true);
        expect(isLiquid('mercury')).toBe(false);
    });
});
