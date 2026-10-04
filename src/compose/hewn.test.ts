// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import { pointInPolygon } from '../geometry/hit';
import { hewnFeatures } from './hewn';
import type { HewnIntent } from './intent';

const MAP = { width: 30, height: 20 };

const network = (over: Partial<HewnIntent>): HewnIntent => ({
    storey: 0,
    floor: 'floor.rubble',
    wall: 'wall.rock',
    roughness: 0.4,
    passages: [],
    chambers: [],
    ...over,
});

/** The rooms of hewn features, their outlines as flat coordinate lists. */
function rooms(features: ReturnType<typeof hewnFeatures>): { floor: string; outline: number[] }[] {
    return features.flatMap((f) => (f.type === 'room' ? [{ floor: String(f.floor), outline: f.points.flatMap((p) => [p.x, p.y]) }] : []));
}

describe('hewn passages', () => {
    it('traces a passage as one walled room in the rock, its floor where the passage runs and nothing past its ragged edge', () => {
        const [cut, ...more] = rooms(
            hewnFeatures(
                network({
                    passages: [
                        {
                            points: [
                                { x: 5, y: 10 },
                                { x: 25, y: 10 },
                            ],
                            width: 2,
                        },
                    ],
                }),
                MAP,
                seededRandom(3),
                {},
            ),
        );
        expect(more).toEqual([]);
        expect(cut?.floor).toBe('floor.rubble');
        const outline = cut?.outline ?? [];
        expect(pointInPolygon({ x: 15, y: 10 }, outline)).toBe(true);
        expect(pointInPolygon({ x: 15, y: 14 }, outline)).toBe(false);
        // Ragged, never ruled: many more corners than a box.
        expect(outline.length / 2).toBeGreaterThan(12);
    });

    it('leaves the rock inside a loop of passages standing, walled round and unfloored like the rock round the cut', () => {
        const loop = [
            { x: 5, y: 5 },
            { x: 25, y: 5 },
            { x: 25, y: 15 },
            { x: 5, y: 15 },
            { x: 5, y: 5 },
        ];
        const features = hewnFeatures(network({ roughness: 0.2, passages: [{ points: loop, width: 2 }] }), MAP, seededRandom(5), {});
        const found = rooms(features);
        // One room, its floor the loop of passage alone: the pillar is cut out of it.
        expect(found.map((r) => r.floor)).toEqual(['floor.rubble']);
        const outline = found[0]?.outline ?? [];
        expect(pointInPolygon({ x: 15, y: 10 }, outline)).toBe(false);
        expect(pointInPolygon({ x: 15, y: 5 }, outline)).toBe(true);
        // Its two bridge edges out to the pillar are openings, no wall; the pillar's own edges are walled.
        const [room] = features.filter((f) => f.type === 'room');
        expect(room?.type === 'room' && room.doors?.map((d) => d.type)).toEqual(['opening', 'opening']);
    });

    it('runs a passage past the map edge open off it, and cuts a chamber roughly its size', () => {
        const edge = rooms(
            hewnFeatures(
                network({
                    passages: [
                        {
                            points: [
                                { x: -3, y: 10 },
                                { x: 10, y: 10 },
                            ],
                            width: 2,
                        },
                    ],
                }),
                MAP,
                seededRandom(7),
                {},
            ),
        );
        const outline = edge[0]?.outline ?? [];
        // Open at the edge: the cut reaches past the map, its wall out of sight.
        expect(Math.min(...outline.filter((_, i) => i % 2 === 0))).toBeLessThan(0);
        const chamber = rooms(hewnFeatures(network({ chambers: [{ centre: { x: 15, y: 10 }, width: 8, height: 6 }] }), MAP, seededRandom(9), {}));
        const cx = chamber[0]?.outline.filter((_, i) => i % 2 === 0) ?? [];
        expect(Math.max(...cx) - Math.min(...cx)).toBeGreaterThan(6);
        expect(Math.max(...cx) - Math.min(...cx)).toBeLessThan(11);
    });

    it('lays its rooms on the level given, and nothing for a network with no passages or chambers', () => {
        const [first] = hewnFeatures(network({ chambers: [{ centre: { x: 15, y: 10 }, width: 6, height: 6 }] }), MAP, seededRandom(1), { level: 'cellar-1' });
        expect(first).toMatchObject({ type: 'room', level: 'cellar-1', wall: 'wall.rock' });
        expect(hewnFeatures(network({}), MAP, seededRandom(1), {})).toEqual([]);
    });
});
