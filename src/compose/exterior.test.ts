// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import { distanceToPolyline, pointInPolygon } from '../geometry/hit';
import { composeMap } from './compose';
import { zoneOutline } from './exterior';
import { type MapIntent, parseMapIntent, type ZoneIntent } from './intent';
import { noiseField } from './noise';
import type { RoleIndex } from './roles';
import { TEST_ROLES } from './test-roles';

const MAP = { width: 20, height: 12 };
const noise = noiseField(seededRandom(1), 4);

const zone = (area: ZoneIntent['area']): ZoneIntent => ({ kind: 'woodland', area, density: 'normal', texture: null });

describe('zoneOutline', () => {
    it('covers the whole map and past its edges for everywhere', () => {
        const outline = zoneOutline(zone({ shape: 'everywhere' }), MAP, noise);
        expect(Math.min(...outline.map((p) => p.x))).toBeLessThan(0);
        expect(Math.max(...outline.map((p) => p.y))).toBeGreaterThan(MAP.height);
    });

    it('wanders round a circle’s radius, and keeps a polygon as given', () => {
        const circle = zoneOutline(zone({ shape: 'circle', centre: { x: 10, y: 6 }, radius: 4 }), MAP, noise);
        const radii = circle.map((p) => Math.hypot(p.x - 10, p.y - 6));
        expect(Math.min(...radii)).toBeGreaterThanOrEqual(3);
        expect(Math.max(...radii)).toBeLessThanOrEqual(5);
        expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.1);
        const points = [
            { x: 1, y: 1 },
            { x: 4, y: 1 },
            { x: 2, y: 3 },
        ];
        expect(zoneOutline(zone({ shape: 'polygon', points }), MAP, noise)).toEqual(points);
    });

    it('runs a strip along each edge, its inner edge about its depth in and wandering', () => {
        for (const side of ['north', 'south', 'east', 'west'] as const) {
            const outline = zoneOutline(zone({ shape: 'edge', side, depth: 4 }), MAP, noise);
            // The inner edge lies between the ends, which sit beyond the map's corners.
            const inner = outline.slice(1, -1);
            const inFrom = inner.map((p) => ({ north: p.y, south: MAP.height - p.y, west: p.x, east: MAP.width - p.x }[side]));
            expect(Math.min(...inFrom)).toBeGreaterThanOrEqual(2);
            expect(Math.max(...inFrom)).toBeLessThanOrEqual(6);
        }
    });
});

describe('bridges and yard pieces', () => {
    /** A road east to west across a river running north to south, and a hut to stand things beside. */
    const crossing = (given: object = {}): MapIntent => {
        const parsed = parseMapIntent({
            schemaVersion: 1,
            seed: 2,
            width: 30,
            height: 20,
            paths: [
                { kind: 'road', from: { x: -1, y: 10 }, to: { x: 31, y: 10 }, meander: 0 },
                { kind: 'river', from: { x: 15, y: -1 }, to: { x: 15, y: 21 }, meander: 0 },
            ],
            buildings: [{ key: 'hut', at: { x: 22, y: 3 }, width: 4, height: 3, rooms: [{ key: 'room', purpose: 'storage' }] }],
            ...given,
        });
        if (!parsed.ok) {
            throw new Error(JSON.stringify(parsed.issues));
        }
        return parsed.intent;
    };
    const stampsOf = (spec: ReturnType<typeof composeMap>['spec'], key: string): number =>
        spec.features.filter((f) => f.type === 'stamp' && f.stamp === key).length;

    it('lays a bridge drawn with depth only where the road runs across it as drawn, and says when a road crossing has none', () => {
        const upright = (roles: RoleIndex): RoleIndex => new Map([...roles, ['bridge', (roles.get('bridge') ?? []).map((s) => ({ ...s, upright: true }))]]);
        // An east–west road runs along the art's length: it carries it as drawn.
        expect(stampsOf(composeMap(crossing(), upright(TEST_ROLES)).spec, 'test:bridge')).toBe(1);
        // A north–south road would need it turned a quarter: no bridge, and the crossing is reported.
        const turned = crossing({
            paths: [
                { kind: 'road', from: { x: 15, y: -1 }, to: { x: 15, y: 21 }, meander: 0 },
                { kind: 'river', from: { x: -1, y: 10 }, to: { x: 31, y: 10 }, meander: 0 },
            ],
        });
        const composed = composeMap(turned, upright(TEST_ROLES));
        expect(stampsOf(composed.spec, 'test:bridge')).toBe(0);
        expect(composed.problems).toContainEqual({ kind: 'no-stamp', role: 'bridge', wantedIn: 'road' });
    });

    it('runs a river between two lakes from the shore of one to the shore of the other, each end a little inside its water', () => {
        const lakes = crossing({
            zones: [
                { key: 'upper', kind: 'lake', area: { shape: 'circle', centre: { x: 5, y: 5 }, radius: 3 } },
                { key: 'lower', kind: 'lake', area: { shape: 'circle', centre: { x: 24, y: 15 }, radius: 3 } },
            ],
            paths: [{ kind: 'river', from: { zone: 'upper' }, to: { zone: 'lower' }, meander: 0 }],
            buildings: [],
        });
        const { spec } = composeMap(lakes, TEST_ROLES);
        const waters = spec.features.filter((f) => f.type === 'region' && f.biome === 'water');
        const river = spec.features.find((f) => f.type === 'path' && f.kind === 'river');
        if (river?.type !== 'path' || waters.length !== 2) {
            throw new Error('no river between two lakes');
        }
        const [first, last] = [river.points[0], river.points.at(-1)];
        const inWater = (p: { x: number; y: number } | undefined): number =>
            waters.findIndex(
                (w) =>
                    w.type === 'region' &&
                    p !== undefined &&
                    pointInPolygon(
                        p,
                        w.points.flatMap((q) => [q.x, q.y]),
                    ),
            );
        expect([inWater(first), inWater(last)].sort((a, b) => a - b)).toEqual([0, 1]);
        // Deep enough in that the river's square end and its banks lie under the water, not cut across the shore.
        const depth = (p: { x: number; y: number } | undefined): number =>
            Math.max(
                ...waters.map((w) =>
                    w.type === 'region' &&
                    p !== undefined &&
                    pointInPolygon(
                        p,
                        w.points.flatMap((q) => [q.x, q.y]),
                    )
                        ? distanceToPolyline(p, [...w.points, ...w.points.slice(0, 1)])
                        : 0,
                ),
            );
        expect(Math.min(depth(first), depth(last))).toBeGreaterThanOrEqual(1 + 2 * (river.halfWidth ?? 0) - 0.5);
    });

    it('stands a prop at its point, reports one no stamp fills, and leaves one out where the yard has no room', () => {
        const withProps = crossing({
            props: [
                { role: 'well', at: { x: 5, y: 5 } },
                { role: 'altar', beside: { building: 'hut' } },
            ],
        });
        const noAltar = new Map([...TEST_ROLES].filter(([role]) => role !== 'altar'));
        const composed = composeMap(withProps, noAltar);
        expect(composed.spec.features).toContainEqual(expect.objectContaining({ type: 'stamp', stamp: 'test:well', x: 5, y: 5 }));
        expect(composed.problems).toContainEqual({ kind: 'no-stamp', role: 'altar', wantedIn: 'hut' });
        expect(composeMap(crossing({ props: [{ role: 'altar', at: { x: 5, y: 5 } }] }), noAltar).problems).toContainEqual({
            kind: 'no-stamp',
            role: 'altar',
            wantedIn: 'outside',
        });
        // Asked for on a side, it stands there: east of the hut.
        const east = composeMap(crossing({ props: [{ role: 'well', beside: { building: 'hut', side: 'east' } }] }), TEST_ROLES);
        const well = east.spec.features.find((f) => f.type === 'stamp' && f.stamp === 'test:well');
        expect(well?.type === 'stamp' && well.x > 22 + 4).toBe(true);
        // A hut hemmed in by the map's edge on every side leaves no yard for a well.
        const hemmed = crossing({
            width: 6,
            height: 5,
            paths: [],
            buildings: [{ key: 'hut', at: { x: 1, y: 1 }, width: 4, height: 3, rooms: [{ key: 'room', purpose: 'storage' }] }],
            props: [{ role: 'well', beside: { building: 'hut', side: 'north' } }],
        });
        expect(stampsOf(composeMap(hemmed, TEST_ROLES).spec, 'test:well')).toBe(0);
    });

    it('keeps a wood’s canopies mostly off a river through it, and grows a meadow’s flowers in patches', () => {
        const wooded = crossing({
            zones: [
                { kind: 'woodland', area: { shape: 'edge', side: 'west', depth: 14 }, density: 'dense' },
                { kind: 'meadow', area: { shape: 'edge', side: 'east', depth: 14 } },
            ],
            paths: [{ kind: 'river', from: { x: -1, y: 10 }, to: { x: 31, y: 10 }, meander: 0, width: 2 }],
            buildings: [],
        });
        const { spec } = composeMap(wooded, TEST_ROLES);
        const river = spec.features.find((f) => f.type === 'path' && f.kind === 'river');
        if (river?.type !== 'path') {
            throw new Error('no river');
        }
        // A tree's canopy (4 squares across, 2 of reach) hangs over the river by half its reach at most.
        const trees = spec.features.filter((f) => f.type === 'stamp' && f.stamp === 'test:tree');
        expect(trees.length).toBeGreaterThan(0);
        expect(trees.every((t) => t.type === 'stamp' && Math.abs(t.y - 10) >= (river.halfWidth ?? 1) + 1)).toBe(true);
        // Flowers stand in patches: nearly every one has another within a patch's reach, far closer than the patches' spacing.
        const flowers = spec.features.flatMap((f) => (f.type === 'stamp' && f.stamp === 'test:flora' && f.x > 16 ? [f] : []));
        expect(flowers.length).toBeGreaterThan(6);
        const neighboured = flowers.filter((f) => flowers.some((g) => g !== f && Math.hypot(g.x - f.x, g.y - f.y) < 1.5));
        expect(neighboured.length / flowers.length).toBeGreaterThan(0.6);
    });

    it('lays the yard where it has ground: its back to the map’s edge and a river along one side, pen and cart go to the other', () => {
        const hemmed = crossing({
            width: 30,
            height: 26,
            paths: [{ kind: 'river', from: { x: -1, y: 2 }, to: { x: 31, y: 2 }, meander: 0, width: 2 }],
            buildings: [
                {
                    key: 'inn',
                    at: { x: 14, y: 6 },
                    width: 13,
                    height: 6,
                    entrance: 'west',
                    yard: true,
                    rooms: [{ key: 'room', purpose: 'storage', entrance: true }],
                },
            ],
        });
        for (const seed of [1, 2, 3]) {
            const { spec } = composeMap({ ...hemmed, seed }, TEST_ROLES);
            const [pen] = spec.features.filter((f) => f.type === 'stamp' && f.stamp === 'test:enclosure');
            const carts = spec.features.filter((f) => f.type === 'stamp' && (f.stamp === 'test:vehicle' || f.stamp === 'test:hauler'));
            // South of the inn, the only side with ground, both of them.
            expect(pen?.type === 'stamp' && pen.y > 12).toBe(true);
            expect(carts.length).toBe(1);
            expect(carts.every((c) => c.type === 'stamp' && c.y > 12)).toBe(true);
        }
    });

    it('stacks a yard’s stores in clumps with open wall between, stands its cart, and lays nothing it has no art for', () => {
        const barn = { x: 8, y: 5, w: 12, h: 8 };
        const yard = crossing({
            paths: [],
            buildings: [{ key: 'barn', at: { x: barn.x, y: barn.y }, width: barn.w, height: barn.h, yard: true, rooms: [{ key: 'room', purpose: 'storage' }] }],
        });
        const outside = (f: { x: number; y: number }): boolean => f.x < barn.x || f.x > barn.x + barn.w || f.y < barn.y || f.y > barn.y + barn.h;
        // Pieces closer than this along a wall stand in one clump; clumps have open wall between.
        const sameClump = 1.5;
        const longestRun: number[] = [];
        for (const seed of [1, 2, 3, 4]) {
            const { spec } = composeMap({ ...yard, seed }, TEST_ROLES);
            const stores = spec.features.filter((f) => f.type === 'stamp' && f.stamp === 'test:storage' && outside(f));
            expect(stores.length).toBeGreaterThanOrEqual(2);
            expect(stampsOf(spec, 'test:vehicle') + stampsOf(spec, 'test:hauler')).toBeGreaterThanOrEqual(1);
            for (const side of ['top', 'bottom', 'left', 'right'] as const) {
                const along = stores
                    .flatMap((f) => {
                        if (f.type !== 'stamp') {
                            return [];
                        }
                        const at = { top: f.y < barn.y, bottom: f.y > barn.y + barn.h, left: f.x < barn.x, right: f.x > barn.x + barn.w }[side];
                        return at ? [side === 'top' || side === 'bottom' ? f.x : f.y] : [];
                    })
                    .sort((a, b) => a - b);
                let run = 1;
                along.forEach((t, i) => {
                    run = i > 0 && t - (along[i - 1] ?? t) < sameClump ? run + 1 : 1;
                    longestRun.push(run);
                });
            }
        }
        // Never one unbroken line along a wall: every run is a clump of three at most.
        expect(Math.max(...longestRun)).toBeLessThanOrEqual(3);
        // With no stores, cart, pen or fodder to be had, the yard is trodden earth and nothing on it.
        const bare = new Map([...TEST_ROLES].filter(([role]) => !['storage', 'vehicle', 'enclosure', 'fodder'].includes(role)));
        const plain = composeMap(yard, bare).spec.features.filter((f) => f.type === 'stamp' && outside(f));
        expect(plain.every((f) => f.type === 'stamp' && !['test:storage', 'test:vehicle', 'test:hauler'].includes(f.stamp))).toBe(true);
    });
});
