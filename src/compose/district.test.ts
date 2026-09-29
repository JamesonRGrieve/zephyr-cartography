// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import { districtFeatures } from './district';
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
});
