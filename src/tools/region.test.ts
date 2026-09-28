// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { makeRegion, parseRegion, regionOutline } from './region';

describe('makeRegion', () => {
    it('builds a region from >= 3 points', () => {
        const r = makeRegion(
            'id',
            'water',
            [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 5, y: 10 },
            ],
            'floor.calm-sea',
        );
        expect(r?.type).toBe('region');
        expect(r?.biome).toBe('water');
        expect(r?.texture).toBe('floor.calm-sea');
        expect(r?.points).toHaveLength(3);
    });

    it('returns null for fewer than three points', () => {
        expect(
            makeRegion(
                'id',
                'water',
                [
                    { x: 0, y: 0 },
                    { x: 1, y: 1 },
                ],
                null,
            ),
        ).toBeNull();
    });
});

describe('parseRegion', () => {
    it('parses a valid region', () => {
        const r = parseRegion({
            type: 'region',
            id: 'a',
            biome: 'forest',
            points: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 0, y: 1 },
            ],
        });
        expect(r?.biome).toBe('forest');
        // A region saved before texture choices draws in its biome's own.
        expect(r?.texture).toBeNull();
        expect(parseRegion({ ...r, texture: 'floor.moss' })?.texture).toBe('floor.moss');
    });

    it('rejects non-regions and unknown biomes', () => {
        expect(parseRegion({ type: 'path', id: 'x' })).toBeNull();
        expect(
            parseRegion({
                type: 'region',
                id: 'y',
                biome: 'quicksand',
                points: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                    { x: 0, y: 1 },
                ],
            }),
        ).toBeNull();
    });
});

describe('regionOutline', () => {
    const square = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
    ];

    it('produces a closed fill polygon (even-length, >= 6), smoothed round its points', () => {
        const o = regionOutline({ points: square, sharp: false });
        expect(o.length).toBeGreaterThanOrEqual(6);
        expect(o.length % 2).toBe(0);
        expect(o.length).toBeGreaterThan(square.length * 2);
    });

    it('keeps a sharp region to exactly its points, and a sharp one persists as sharp', () => {
        expect(regionOutline({ points: square, sharp: true })).toEqual([0, 0, 10, 0, 10, 10, 0, 10]);
        expect(parseRegion({ type: 'region', id: 'deck', biome: 'dirt', points: square, sharp: true })?.sharp).toBe(true);
        expect(parseRegion({ type: 'region', id: 'old', biome: 'dirt', points: square })?.sharp).toBe(false);
    });
});
