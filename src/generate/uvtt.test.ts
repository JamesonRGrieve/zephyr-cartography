// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { chainSegments, levelScene, toUvtt, UVTT_FORMAT, type UvttScene } from './uvtt';

const SQUARE = 100;

/** A 10×8-square scene whose map starts 200 px in (Foundry's padding), with a room, a door, a secret door, low cover and a lamp. */
const SCENE: UvttScene = {
    gridSize: SQUARE,
    imageGridSize: SQUARE,
    rect: { x: 200, y: 200, width: 1000, height: 800 },
    walls: [
        { a: { x: 200, y: 200 }, b: { x: 600, y: 200 }, door: 'none', blocksSight: true },
        { a: { x: 600, y: 200 }, b: { x: 600, y: 600 }, door: 'none', blocksSight: true },
        { a: { x: 600, y: 600 }, b: { x: 600, y: 700 }, door: 'door', blocksSight: true },
        { a: { x: 200, y: 600 }, b: { x: 300, y: 600 }, door: 'secret', blocksSight: true },
        { a: { x: 800, y: 800 }, b: { x: 900, y: 800 }, door: 'none', blocksSight: false },
    ],
    lights: [
        { x: 450, y: 350, radius: 300, color: '#FFAA33' },
        { x: 250, y: 250, radius: 150, color: null },
    ],
    image: 'iVBORw0KGgo=',
};

describe('toUvtt', () => {
    const uvtt = toUvtt(SCENE);

    it('sizes the map in squares from its own corner, at the scene’s px per square', () => {
        expect(uvtt.format).toBe(UVTT_FORMAT);
        expect(uvtt.resolution).toEqual({ map_origin: { x: 0, y: 0 }, map_size: { x: 10, y: 8 }, pixels_per_grid: SQUARE });
        expect(uvtt.image).toBe(SCENE.image);
        expect(uvtt.environment).toEqual({ baked_lighting: false, ambient_light: 'ffffffff' });
    });

    it('joins sight-blocking walls into polylines, keeps a secret door as wall, and leaves out walls that block no sight', () => {
        expect(uvtt.line_of_sight).toEqual([
            [
                { x: 0, y: 0 },
                { x: 4, y: 0 },
                { x: 4, y: 4 },
            ],
            [
                { x: 0, y: 4 },
                { x: 1, y: 4 },
            ],
        ]);
        expect(uvtt.objects_line_of_sight).toEqual([]);
    });

    it('makes each door a closed portal: its middle, its two ends and its angle', () => {
        expect(uvtt.portals).toEqual([
            {
                position: { x: 4, y: 4.5 },
                bounds: [
                    { x: 4, y: 4 },
                    { x: 4, y: 5 },
                ],
                rotation: Number((Math.PI / 2).toFixed(3)),
                closed: true,
                freestanding: false,
            },
        ]);
    });

    it('places lights in squares, reaching their dim radius, coloured as aarrggbb (white when none)', () => {
        expect(uvtt.lights).toEqual([
            { position: { x: 2.5, y: 1.5 }, range: 3, intensity: 1, color: 'ffffaa33', shadows: true },
            { position: { x: 0.5, y: 0.5 }, range: 1.5, intensity: 1, color: 'ffffffff', shadows: true },
        ]);
    });
});

describe('chainSegments', () => {
    it('joins segments end to end whichever way round they were given, and closes a loop', () => {
        const p = (x: number, y: number) => ({ x, y });
        expect(
            chainSegments([
                [p(1, 0), p(2, 0)],
                [p(0, 0), p(1, 0)],
                [p(5, 5), p(6, 5)],
            ]),
        ).toEqual([
            [p(0, 0), p(1, 0), p(2, 0)],
            [p(5, 5), p(6, 5)],
        ]);
        expect(
            chainSegments([
                [p(0, 0), p(1, 0)],
                [p(1, 0), p(1, 1)],
                [p(1, 1), p(0, 0)],
            ]),
        ).toEqual([[p(0, 0), p(1, 0), p(1, 1), p(0, 0)]]);
    });
});

describe('levelScene', () => {
    const source = {
        level: 'ground',
        gridSize: SQUARE,
        gridDistance: 5,
        rect: SCENE.rect,
        image: 'abc=',
        imageGridSize: 50,
        walls: [
            { c: [200, 200, 600, 200] as const, door: 0, sight: 20, levels: ['ground'] },
            { c: [600, 200, 600, 300] as const, door: 1, sight: 20, levels: [] },
            { c: [600, 300, 600, 400] as const, door: 2, sight: 20, levels: ['ground', 'upper'] },
            { c: [800, 800, 900, 800] as const, door: 0, sight: 0, levels: ['ground'] },
            { c: [0, 0, 100, 0] as const, door: 0, sight: 20, levels: ['upper'] },
        ],
        lights: [
            { x: 450, y: 350, hidden: false, config: { dim: 15, color: '#ffaa33' }, levels: ['ground'] },
            { x: 450, y: 350, hidden: true, config: { dim: 15, color: null }, levels: [] },
            { x: 450, y: 350, hidden: false, config: { dim: 0, color: null }, levels: [] },
            { x: 50, y: 50, hidden: false, config: { dim: 10, color: null }, levels: ['upper'] },
        ],
    };

    it('takes the level’s walls (those on no level in particular too), their doors and whether they block sight', () => {
        expect(levelScene(source).walls).toEqual([
            { a: { x: 200, y: 200 }, b: { x: 600, y: 200 }, door: 'none', blocksSight: true },
            { a: { x: 600, y: 200 }, b: { x: 600, y: 300 }, door: 'door', blocksSight: true },
            { a: { x: 600, y: 300 }, b: { x: 600, y: 400 }, door: 'secret', blocksSight: true },
            { a: { x: 800, y: 800 }, b: { x: 900, y: 800 }, door: 'none', blocksSight: false },
        ]);
    });

    it('takes the level’s shining lights, their reach from distance units to px; hidden and unlit ones are off', () => {
        expect(levelScene(source).lights).toEqual([{ x: 450, y: 350, radius: 300, color: '#ffaa33' }]);
    });

    it('reads a door type it does not know as no door', () => {
        const odd = { ...source, walls: [{ c: [0, 0, 100, 0] as const, door: 9, sight: 20, levels: [] }] };
        expect(levelScene(odd).walls.map((wall) => wall.door)).toEqual(['none']);
    });

    it('writes the image’s own px per square, which may differ from the scene’s', () => {
        expect(toUvtt(levelScene(source)).resolution).toEqual({ map_origin: { x: 0, y: 0 }, map_size: { x: 10, y: 8 }, pixels_per_grid: 50 });
    });
});
