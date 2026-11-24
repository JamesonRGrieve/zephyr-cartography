// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import { districtFeatures, withFrontDoor } from './district';
import type { DistrictIntent } from './intent';
import { TEST_ROLES } from './test-roles';

const district = (over: Partial<DistrictIntent>): DistrictIntent => ({
    area: { x: 0, y: 0, w: 60, h: 40 },
    street: 2,
    alley: 1,
    block: [6, 14],
    keepOpen: [],
    roofs: ['floor.deck-plating'],
    wall: 'wall.concrete',
    courtyard: 'floor.concrete',
    streetPieces: [],
    frontage: 0.3,
    streetGrime: 0,
    roofPieces: [],
    ...over,
});

type Box = { x: number; y: number; w: number; h: number };

/** The bounding box of each room, and its floor. */
function rooms(features: ReturnType<typeof districtFeatures>['features']): (Box & { floor: string; corners: number })[] {
    return features.flatMap((f) => {
        if (f.type !== 'room') {
            return [];
        }
        const xs = f.points.map((p) => p.x);
        const ys = f.points.map((p) => p.y);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return [{ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, floor: String(f.floor), corners: f.points.length }];
    });
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** `b` grown by `by` on every side. */
const grownBox = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, w: b.w + 2 * by, h: b.h + 2 * by });

/** Every pair of `blocks` that stands closer than `gap` squares apart: sharing a wall, or with too narrow a lane. */
function crowded(blocks: readonly Box[], gap: number): [Box, Box][] {
    const half = gap / 2 - 1e-6;
    return blocks.flatMap((a, i) => blocks.slice(i + 1).flatMap((b): [Box, Box][] => (overlaps(grownBox(a, half), grownBox(b, half)) ? [[a, b]] : [])));
}

describe('district clearances (operator, 2026-10-02: a well in a house, buildings physically touching)', () => {
    const blocksOf = (features: ReturnType<typeof districtFeatures>['features']): Box[] => rooms(features).filter((r) => r.floor === 'floor.deck-plating');

    it('leaves at least an alley between every two blocks, round open ground too, whatever the seed', () => {
        // A plaza in the middle: the strips cut round it once ran flush against each other.
        const plaza = district({ keepOpen: [{ x: 22, y: 14, w: 12, h: 9 }] });
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const blocks = blocksOf(districtFeatures(plaza, TEST_ROLES, seededRandom(seed), {}).features);
            expect(blocks.length).toBeGreaterThan(4);
            expect(crowded(blocks, 1)).toEqual([]);
        }
    });

    it('never stands a house on the map’s own pieces: a well takes only the house it would stand in, an alley clear', () => {
        const well = { x: 29, y: 19, w: 1.5, h: 1.5 };
        for (const seed of [1, 2, 3, 4]) {
            const bare = blocksOf(districtFeatures(district({}), TEST_ROLES, seededRandom(seed), {}).features);
            const blocks = blocksOf(districtFeatures(district({}), TEST_ROLES, seededRandom(seed), {}, { boxes: [well], paths: [] }).features);
            expect(blocks.filter((b) => overlaps(b, grownBox(well, 0.99)))).toEqual([]);
            // One house or two give way, never a swathe.
            expect(bare.length - blocks.length).toBeLessThanOrEqual(2);
        }
    });

    it('keeps a quarter in one piece where a neighbour’s street shifts its edge half a square (2026-11-24 e2e: no blocks)', () => {
        // A square kept open in its corner, the first quarter's houses beside it, a road down its far side, a chest out among its houses.
        const quarter = district({ area: { x: 40, y: 2, w: 18, h: 26 }, street: 2.5, alley: 1.2, block: [5, 12], keepOpen: [{ x: 42, y: 4, w: 4, h: 4 }] });
        const clear = {
            boxes: [
                { x: 30, y: 2, w: 8, h: 16 },
                { x: 45.5, y: 21.5, w: 1, h: 1 },
            ],
            paths: [
                {
                    points: [
                        { x: 57, y: -1 },
                        { x: 57, y: 29 },
                    ],
                    halfWidth: 1.5,
                },
            ],
        };
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            expect(blocksOf(districtFeatures(quarter, TEST_ROLES, seededRandom(seed), {}, clear).features).length).toBeGreaterThan(0);
        }
    });

    it('carves a street round a building on the map, and ignores pieces standing in its own open ground', () => {
        const hall = { x: 20, y: 10, w: 12, h: 10 };
        const plaza = { x: 36, y: 22, w: 12, h: 9 };
        const lamps = [
            { x: 37, y: 23, w: 0.6, h: 0.6 },
            { x: 46, y: 29, w: 0.6, h: 0.6 },
        ];
        for (const seed of [1, 2, 3]) {
            const blocks = blocksOf(districtFeatures(district({}), TEST_ROLES, seededRandom(seed), {}, { boxes: [hall], paths: [] }).features);
            expect(blocks.filter((b) => overlaps(b, grownBox(hall, 1.99)))).toEqual([]);
            // A plaza's own lamps change nothing: the same blocks with them as without.
            const square = district({ keepOpen: [plaza] });
            const without = blocksOf(districtFeatures(square, TEST_ROLES, seededRandom(seed), {}).features);
            const withLamps = blocksOf(districtFeatures(square, TEST_ROLES, seededRandom(seed), {}, { boxes: lamps, paths: [] }).features);
            expect(withLamps).toEqual(without);
        }
    });

    it('stands no block across or against a road running through it', () => {
        const road = {
            points: [
                { x: -1, y: 21 },
                { x: 61, y: 19 },
            ],
            halfWidth: 1,
        };
        for (const seed of [1, 2, 3, 4]) {
            const blocks = blocksOf(districtFeatures(district({}), TEST_ROLES, seededRandom(seed), {}, { boxes: [], paths: [road] }).features);
            expect(blocks.length).toBeGreaterThan(4);
            // The road's line at each block's middle, never within its half-width of the block.
            for (const b of blocks) {
                const y = 21 - ((b.x + b.w / 2 + 1) / 62) * 2;
                expect(b.y > y + 1 || b.y + b.h < y - 1).toBe(true);
            }
        }
    });
});

describe('districts', () => {
    it('cuts an area into walled blocks with streets between them, each within the area, no two touching', () => {
        const { features } = districtFeatures(district({}), TEST_ROLES, seededRandom(4), {});
        const blocks = rooms(features).filter((r) => r.floor === 'floor.deck-plating');
        expect(blocks.length).toBeGreaterThan(8);
        for (const b of blocks) {
            expect(b.x).toBeGreaterThanOrEqual(0);
            expect(b.x + b.w).toBeLessThanOrEqual(60);
            // No larger than a block may be along its longer side.
            expect(Math.max(b.w, b.h)).toBeLessThanOrEqual(14);
        }
        blocks.forEach((a, i) => {
            for (const b of blocks.slice(i + 1)) {
                expect(overlaps(a, b)).toBe(false);
            }
        });
        expect(features.every((f) => f.type !== 'room' || f.wall === 'wall.concrete')).toBe(true);
    });

    it('gives every block a front door in its longest side, its way to the building’s own map just inside it', () => {
        const { features } = districtFeatures(district({}), TEST_ROLES, seededRandom(5), {});
        const roofs = features.filter((f) => f.type === 'room' && f.floor === 'floor.deck-plating');
        const ways = features.flatMap((f) => (f.type === 'zone' ? [f] : []));
        expect(roofs.length).toBeGreaterThan(1);
        expect(ways).toHaveLength(roofs.length);
        for (const roof of roofs) {
            if (roof.type !== 'room') {
                continue;
            }
            const [door] = roof.doors ?? [];
            expect(door).toMatchObject({ type: 'door', state: 'closed' });
            const a = roof.points[door?.segment ?? 0];
            const b = roof.points[((door?.segment ?? 0) + 1) % roof.points.length];
            // A one-square doorway, and a way standing just inside it, leading nowhere until linked.
            expect(Math.hypot((b?.x ?? 0) - (a?.x ?? 0), (b?.y ?? 0) - (a?.y ?? 0))).toBeCloseTo(1);
            const mid = { x: ((a?.x ?? 0) + (b?.x ?? 0)) / 2, y: ((a?.y ?? 0) + (b?.y ?? 0)) / 2 };
            const way = ways.find((w) => Math.hypot(w.x - mid.x, w.y - mid.y) <= 0.5 + 1e-9);
            expect(way).toMatchObject({ name: 'Door', link: { targets: [] } });
        }
    });

    it('sets a block’s door in the middle of its longest side, the square inside it to the side’s right', () => {
        // Clockwise on screen: the top side (0,0)→(6,0) is the longest, and in is down.
        const front = withFrontDoor([
            { x: 0, y: 0 },
            { x: 6, y: 0 },
            { x: 6, y: 4 },
            { x: 0, y: 4 },
        ]);
        expect(front.door).toBe(1);
        expect(front.points.slice(1, 3)).toEqual([
            { x: 2.5, y: 0 },
            { x: 3.5, y: 0 },
        ]);
        expect(front.inside).toEqual({ x: 2.5, y: 0, w: 1, h: 1 });
        // An outline with no sides still answers, its door at the origin.
        expect(withFrontDoor([]).door).toBe(0);
    });

    it('never ruled: blocks stand back differently, some lose a corner to a yard, larger ones keep a courtyard', () => {
        const { features } = districtFeatures(district({ block: [9, 18] }), TEST_ROLES, seededRandom(8), {});
        const found = rooms(features);
        expect(found.some((r) => r.floor === 'floor.deck-plating' && r.corners > 4)).toBe(true);
        expect(found.some((r) => r.floor === 'floor.concrete')).toBe(true);
        const widths = new Set(found.map((r) => Math.round(r.w * 10)));
        expect(widths.size).toBeGreaterThan(3);
    });

    it('leaves the ground kept open, a street round it, and builds on the rest', () => {
        const square = { x: 20, y: 10, w: 20, h: 20 };
        const { features } = districtFeatures(district({ keepOpen: [square] }), TEST_ROLES, seededRandom(4), {});
        const blocks = rooms(features);
        expect(blocks.length).toBeGreaterThan(4);
        const round = { x: square.x - 2, y: square.y - 2, w: square.w + 4, h: square.h + 4 };
        expect(blocks.some((b) => overlaps(b, round))).toBe(false);
    });

    it('dresses its streets and roofs in art where a pack draws the piece, art drawn with depth standing as drawn, never turned', () => {
        const machine = TEST_ROLES.get('machine')?.[0];
        if (!machine) {
            throw new Error('test machine');
        }
        const drawnWithDepth = { ...machine, key: 'test:tall-machine', upright: true };
        const roles = new Map([...TEST_ROLES, ['machine' as const, [drawnWithDepth]]]);
        const piece = { name: 'pump', role: 'machine' as const, tags: [], width: 2, height: 1.7 };
        const { features, boxed } = districtFeatures(
            // Ground kept open off in a corner the district never reaches changes nothing.
            district({ streetPieces: [piece], frontage: 1, roofPieces: [piece], keepOpen: [{ x: 100, y: 100, w: 5, h: 5 }] }),
            roles,
            seededRandom(2),
            {},
        );
        const pumps = features.flatMap((f) => (f.type === 'stamp' && f.stamp === 'test:tall-machine' ? [f] : []));
        expect(pumps.length).toBeGreaterThan(1);
        expect(pumps.every((f) => f.rotation === 0)).toBe(true);
        expect(boxed).toEqual([]);
    });

    it('stands no street piece on the map’s own pieces in its streets (2026-11-24: a stair on a chapel’s buttress)', () => {
        // A deep piece (a public stair) in broad streets, and a post standing out in the street where its far half lay:
        // further than an alley from every block, so it takes no house, only the street piece's spot.
        const dressed = district({ street: 5, streetPieces: [{ name: 'public stair', tags: [], width: 1, height: 3 }], frontage: 1 });
        const run = (clear?: { boxes: Box[]; paths: [] }): ReturnType<typeof districtFeatures>['features'] =>
            districtFeatures(dressed, TEST_ROLES, seededRandom(2), {}, clear).features;
        const stairsOf = (features: ReturnType<typeof run>): { x: number; y: number }[] =>
            features.flatMap((f) => (f.type === 'stamp' && f.stamp.includes('public stair') ? [{ x: f.x, y: f.y }] : []));
        const bare = run();
        const blocks = rooms(bare);
        const posts = stairsOf(bare).flatMap((stair) =>
            [
                [1.2, 0],
                [-1.2, 0],
                [0, 1.2],
                [0, -1.2],
            ].map(([dx = 0, dy = 0]) => ({ x: stair.x + dx - 0.25, y: stair.y + dy - 0.25, w: 0.5, h: 0.5 })),
        );
        const post = posts.find((box) => !blocks.some((block) => overlaps(grownBox(box, 1.05), block)));
        expect(post).toBeDefined();
        const on = (stair: { x: number; y: number }): boolean =>
            post !== undefined && Math.abs(stair.x - post.x - 0.25) < 1.3 && Math.abs(stair.y - post.y - 0.25) < 1.3;
        expect(stairsOf(run({ boxes: post ? [post] : [], paths: [] })).some(on)).toBe(false);
    });

    it('gathers grime in its streets along the blocks’ walls where asked, never on a block or the ground kept open', () => {
        const rug = TEST_ROLES.get('rug')?.[0];
        expect(rug).toBeDefined();
        if (rug === undefined) {
            return;
        }
        const roles = new Map([...TEST_ROLES, ['decal', [{ ...rug, key: 'test:oil-stain', role: 'decal' as const, width: 1, height: 1 }]] as const]);
        const square = { x: 22, y: 14, w: 12, h: 9 };
        const composed = (grime: number): ReturnType<typeof districtFeatures>['features'] =>
            districtFeatures(district({ streetGrime: grime, keepOpen: [square] }), roles, seededRandom(3), {}).features;
        const stainsOf = (features: ReturnType<typeof composed>): Box[] =>
            features.flatMap((f) => (f.type === 'stamp' && f.stamp === 'test:oil-stain' ? [{ x: f.x - 0.5, y: f.y - 0.5, w: 1, h: 1 }] : []));
        expect(stainsOf(composed(0))).toEqual([]);
        const filthy = composed(1);
        const stains = stainsOf(filthy);
        const blocks = rooms(filthy).filter((r) => r.floor === 'floor.deck-plating');
        expect(stains.length).toBeGreaterThan(20);
        expect(stains.filter((stain) => overlaps(stain, square) || blocks.some((b) => overlaps(stain, b)))).toEqual([]);
        // Close in along the walls: every stain within its reach of a block.
        expect(stains.every((stain) => blocks.some((b) => overlaps(grownBox(stain, 1.7), b)))).toBe(true);
    });

    it('dresses its streets against the frontages and its roofs with their pieces, boxed where no art draws them', () => {
        const pieces = [{ name: 'utility cabinet', tags: [], width: 1, height: 0.6 }];
        const { features, boxed } = districtFeatures(
            district({ streetPieces: pieces, frontage: 1, roofPieces: [{ name: 'vent stack', tags: [], width: 1.5, height: 1.5 }] }),
            TEST_ROLES,
            seededRandom(2),
            { level: 'ground' },
        );
        const stamps = features.flatMap((f) => (f.type === 'stamp' ? [f] : []));
        expect(stamps.some((f) => f.stamp === 'placeholder:1x0.6:utility cabinet')).toBe(true);
        expect(stamps.some((f) => f.stamp === 'placeholder:1.5x1.5:vent stack')).toBe(true);
        expect(stamps.every((f) => f.level === 'ground')).toBe(true);
        expect(new Set(boxed)).toEqual(new Set(['utility cabinet', 'vent stack']));
        // Street pieces stand on no block's roof.
        const blocks = rooms(features);
        const onStreet = stamps.filter((f) => f.stamp.includes('utility cabinet'));
        expect(onStreet.some((f) => blocks.some((b) => f.x > b.x && f.x < b.x + b.w && f.y > b.y && f.y < b.y + b.h))).toBe(false);
    });

    it('crowds a large roof with more pieces than a small one carries, never a big block bare but for one vent', () => {
        const { features } = districtFeatures(
            district({ roofPieces: [{ name: 'vent stack', tags: [], width: 0.8, height: 0.8 }] }),
            TEST_ROLES,
            seededRandom(2),
            {},
        );
        const vents = features.flatMap((f) => (f.type === 'stamp' && f.stamp.includes('vent stack') ? [f] : []));
        const perRoof = rooms(features).map((b) => vents.filter((v) => v.x > b.x && v.x < b.x + b.w && v.y > b.y && v.y < b.y + b.h).length);
        // A roof once took one to three pieces whatever its size.
        expect(Math.max(...perRoof)).toBeGreaterThan(3);
    });
});
