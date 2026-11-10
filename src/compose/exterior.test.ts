// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import { distanceToPolyline, pointInPolygon } from '../geometry/hit';
import type { StampRole } from '../stamps/schema';
import { WALL_BAND_SQUARES } from '../tools/materials';
import { composeMap } from './compose';
import { composeExterior, footprintClear, pickDressing, riverWidths, zoneOutline } from './exterior';
import { type MapIntent, parseMapIntent, type ZoneIntent } from './intent';
import { noiseField } from './noise';
import { NO_PREFERENCES } from './preferences';
import type { RoleIndex, RoleStamp } from './roles';
import { TEST_ROLES } from './test-roles';

const MAP = { width: 20, height: 12 };
const noise = noiseField(seededRandom(1), 4);

const zone = (area: ZoneIntent['area']): ZoneIntent => ({ kind: 'woodland', area, density: 'normal', texture: null, soft: false });

describe('riverWidths', () => {
    it('broadens and narrows a chart river smoothly along its run, never past a third of its width either way', () => {
        const run = Array.from({ length: 60 }, (_, i) => ({ x: i * 0.5, y: 10 + Math.sin(i / 8) * 4 }));
        const widths = riverWidths(run, 2, noiseField(seededRandom(3), 6));
        expect(widths).toHaveLength(run.length);
        expect(Math.min(...widths)).toBeGreaterThanOrEqual(2 * 0.65);
        expect(Math.max(...widths)).toBeLessThanOrEqual(2 * 1.35);
        // It varies along the run, and smoothly: half a square on, the width moves by little.
        expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(0.2);
        widths.slice(1).forEach((w, i) => {
            expect(Math.abs(w - (widths[i] ?? w))).toBeLessThan(0.25);
        });
    });
});

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

describe('a chart', () => {
    it('is its ground, zones, paths and named places: nothing scattered, worn, banked or bridged', () => {
        const parsed = parseMapIntent({
            schemaVersion: 1,
            seed: 3,
            width: 30,
            height: 20,
            scale: 'regional',
            zones: [{ kind: 'woodland', area: { shape: 'edge', side: 'west', depth: 10 }, density: 'dense' }],
            paths: [
                { kind: 'road', from: 'west', to: 'east' },
                { kind: 'river', from: 'north', to: 'south' },
            ],
            fixtures: [{ name: 'the town', width: 3, height: 3, at: { x: 20, y: 10 }, role: 'fitting', tags: ['town'] }],
        });
        if (!parsed.ok) {
            throw new Error(JSON.stringify(parsed.issues));
        }
        // The battlemap index offers trees, rocks and bridges; a chart takes none of them.
        const { spec } = composeMap(parsed.intent, TEST_ROLES);
        const stamps = spec.features.filter((f) => f.type === 'stamp');
        expect(stamps).toHaveLength(0);
        expect(spec.features.flatMap((f) => (f.type === 'path' ? [f.kind] : []))).toEqual(['road', 'river']);
        expect(spec.features.some((f) => f.type === 'region' && f.biome === 'forest')).toBe(true);
        // The town, which no art draws yet, stands as its labelled box.
        expect(spec.features.some((f) => f.type === 'shape')).toBe(true);
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

    it('bridges a road in the kind of bridge asked, or fords it with none and nothing reported', () => {
        const base = (TEST_ROLES.get('bridge') ?? [])[0];
        expect(base).toBeDefined();
        if (!base) {
            return;
        }
        const roles: RoleIndex = new Map([
            ...TEST_ROLES,
            [
                'bridge',
                [
                    { ...base, key: 'test:stone-bridge', tags: ['stone', 'road', 'bridge'] },
                    { ...base, key: 'test:timber-bridge', tags: ['timber', 'road', 'bridge'] },
                ],
            ],
        ]);
        const road = (bridge?: false | string[]): object => ({
            paths: [
                { kind: 'road', from: { x: -1, y: 10 }, to: { x: 31, y: 10 }, meander: 0, ...(bridge === undefined ? {} : { bridge }) },
                { kind: 'river', from: { x: 15, y: -1 }, to: { x: 15, y: 21 }, meander: 0 },
            ],
        });
        const timber = composeMap(crossing(road(['timber'])), roles);
        expect(stampsOf(timber.spec, 'test:timber-bridge')).toBe(1);
        expect(stampsOf(timber.spec, 'test:stone-bridge')).toBe(0);
        // A kind no art draws falls back to any road bridge.
        const rope = composeMap(crossing(road(['rope'])), roles).spec;
        expect(stampsOf(rope, 'test:timber-bridge') + stampsOf(rope, 'test:stone-bridge')).toBe(1);
        const ford = composeMap(crossing(road(false)), roles);
        expect(stampsOf(ford.spec, 'test:timber-bridge') + stampsOf(ford.spec, 'test:stone-bridge')).toBe(0);
        expect(ford.problems.filter((p) => 'role' in p && p.role === 'bridge')).toEqual([]);
    });

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

    it('dresses rubble and a camp without craters where none are loaded, and reports nothing for them', () => {
        const noCraters: RoleIndex = new Map([...TEST_ROLES].filter(([role]) => role !== 'crater'));
        const parsed = parseMapIntent({
            schemaVersion: 1,
            width: 30,
            height: 20,
            zones: [
                { kind: 'rubble', area: { shape: 'circle', centre: { x: 8, y: 10 }, radius: 6 } },
                { kind: 'fortified', area: { shape: 'circle', centre: { x: 22, y: 10 }, radius: 6 } },
            ],
        });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) {
            return;
        }
        const composed = composeMap(parsed.intent, noCraters);
        expect(composed.problems.filter((p) => 'role' in p && p.role === 'crater')).toEqual([]);
        // The rest of the dressing still stands.
        expect(composed.spec.features.filter((f) => f.type === 'stamp').length).toBeGreaterThan(5);
    });

    it('never lays rocks, logs or shrubs on a tree crown or on each other', () => {
        const parsed = parseMapIntent({
            schemaVersion: 1,
            width: 30,
            height: 20,
            zones: [
                // A sparse wood: open ground between its crowns where litter can lie.
                { kind: 'woodland', area: { shape: 'everywhere' }, density: 'sparse' },
                { kind: 'rocky', area: { shape: 'circle', centre: { x: 15, y: 10 }, radius: 6 }, density: 'dense' },
            ],
        });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) {
            return;
        }
        const { spec } = composeMap(parsed.intent, TEST_ROLES);
        const stamps = spec.features.flatMap((f) => (f.type === 'stamp' ? [f] : []));
        const radius = (key: string): number => {
            const role = [...TEST_ROLES.values()].flat().find((s) => s.key === key);
            return role ? Math.hypot(role.width, role.height) / 2 : 0;
        };
        const roleOf = (key: string): string | undefined => [...TEST_ROLES.entries()].find(([, list]) => list.some((s) => s.key === key))?.[0];
        const trees = stamps.filter((s) => roleOf(s.stamp) === 'tree');
        const litter = stamps.filter((s) => ['rock', 'log', 'shrub'].includes(roleOf(s.stamp) ?? ''));
        expect(trees.length).toBeGreaterThan(0);
        expect(litter.length).toBeGreaterThan(0);
        const onACrown = litter.filter((l) => trees.some((t) => Math.hypot(t.x - l.x, t.y - l.y) < radius(t.stamp) * 0.8 + radius(l.stamp) - 1e-6));
        expect(onACrown).toEqual([]);
        const onOther = litter.filter((a, i) => litter.some((b, j) => i !== j && Math.hypot(a.x - b.x, a.y - b.y) < radius(a.stamp) + radius(b.stamp) - 1e-6));
        expect(onOther).toEqual([]);
    });

    it('strews crates over open ground but never storage that stands against a wall', () => {
        const crate = (TEST_ROLES.get('storage') ?? [])[0];
        expect(crate).toBeDefined();
        if (!crate) {
            return;
        }
        const locker: RoleStamp = { ...crate, key: 'test:locker', against: 'wall' };
        const roles: RoleIndex = new Map([...TEST_ROLES, ['storage', [{ ...crate, against: 'free' }, locker]]]);
        const parsed = parseMapIntent({
            schemaVersion: 1,
            width: 30,
            height: 20,
            zones: [{ kind: 'industrial', area: { shape: 'everywhere' }, density: 'dense' }],
        });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) {
            return;
        }
        const { spec } = composeMap(parsed.intent, roles);
        expect(stampsOf(spec, crate.key)).toBeGreaterThan(0);
        expect(stampsOf(spec, 'test:locker')).toBe(0);
    });

    it('carries a road on a sound road bridge where one is loaded, in the picture of it seen from above', () => {
        const [plain] = TEST_ROLES.get('bridge') ?? [];
        if (!plain) {
            throw new Error('test bridge');
        }
        const rope = { ...plain, key: 'test:rope-bridge', tags: ['rope', 'bridge'] };
        const broken = { ...plain, key: 'test:broken-road-bridge', tags: ['road', 'bridge', 'collapsed'] };
        const road = { ...plain, key: 'test:road-bridge', tags: ['road', 'bridge'], variant: 3 };
        const bridges = (...list: readonly RoleStamp[]): RoleIndex => new Map([...TEST_ROLES, ['bridge', list]]);
        for (const seed of [1, 2, 3]) {
            const { spec } = composeMap({ ...crossing(), seed }, bridges(rope, broken, road));
            const laid = spec.features.filter((f) => f.type === 'stamp' && f.stamp.includes('bridge'));
            expect(laid).toEqual([expect.objectContaining({ stamp: 'test:road-bridge', variant: 3 })]);
        }
        // With no road bridge, any sound bridge; only a wreck where nothing else is loaded.
        expect(stampsOf(composeMap(crossing(), bridges(rope, broken)).spec, 'test:rope-bridge')).toBe(1);
        expect(stampsOf(composeMap(crossing(), bridges(broken)).spec, 'test:broken-road-bridge')).toBe(1);
    });

    it('stands a sound well in a yard, never a ruin’s while a whole one is loaded', () => {
        const [whole] = TEST_ROLES.get('well') ?? [];
        if (!whole) {
            throw new Error('test well');
        }
        const ruin = { ...whole, key: 'test:ruined-well', tags: ['ruined', 'well'] };
        const wells: RoleIndex = new Map([...TEST_ROLES, ['well', [ruin, whole]]]);
        for (const seed of [1, 2, 3, 4]) {
            const { spec } = composeMap({ ...crossing({ props: [{ role: 'well', at: { x: 5, y: 5 } }] }), seed }, wells);
            expect(stampsOf(spec, 'test:ruined-well')).toBe(0);
            expect(stampsOf(spec, 'test:well')).toBe(1);
        }
    });

    it('strews nothing on hard paving, a crop plot or a yard, whatever its role', () => {
        const field = { x0: 8, y0: 5, x1: 20, y1: 15 };
        const farm = crossing({
            zones: [
                { kind: 'meadow', area: { shape: 'everywhere' }, density: 'dense' },
                { kind: 'rocky', area: { shape: 'everywhere' }, density: 'dense' },
                {
                    kind: 'paving',
                    texture: 'floor.standing-wheat',
                    area: {
                        shape: 'polygon',
                        points: [
                            { x: field.x0, y: field.y0 },
                            { x: field.x1, y: field.y0 },
                            { x: field.x1, y: field.y1 },
                            { x: field.x0, y: field.y1 },
                        ],
                    },
                },
            ],
            paths: [],
            buildings: [],
        });
        const { spec } = composeMap(farm, TEST_ROLES);
        // The composer's spec is in grid squares.
        const onField = spec.features.filter((f) => f.type === 'stamp' && f.x > field.x0 && f.x < field.x1 && f.y > field.y0 && f.y < field.y1);
        expect(spec.features.some((f) => f.type === 'stamp')).toBe(true);
        expect(onField).toEqual([]);
    });

    it('dresses a dense marsh in thickets and reed beds with open mire between, never one even dotting', () => {
        // The marsh encounter's render (2026-11-05): lone shrubs and tufts covered all but 2 of 70 three-square cells.
        const bog = parseMapIntent({
            schemaVersion: 1,
            seed: 2,
            width: 30,
            height: 20,
            zones: [{ kind: 'marsh', area: { shape: 'everywhere' }, density: 'dense' }],
        });
        if (!bog.ok) {
            throw new Error(JSON.stringify(bog.issues));
        }
        const stamps = composeMap(bog.intent, TEST_ROLES).spec.features.flatMap((f) => (f.type === 'stamp' ? [f] : []));
        // Shrubs (1.2 squares across) stand in thickets: nearly every one has another within a thicket's reach.
        const shrubs = stamps.filter((f) => f.stamp === 'test:shrub');
        expect(shrubs.length).toBeGreaterThan(6);
        const thicketed = shrubs.filter((f) => shrubs.some((g) => g !== f && Math.hypot(g.x - f.x, g.y - f.y) < 3.5));
        expect(thicketed.length / shrubs.length).toBeGreaterThan(0.8);
        // And open mire between: at least a fifth of the three-square cells hold nothing.
        const cells = Array.from({ length: 10 * 7 }, (_, i) => ({ x: (i % 10) * 3, y: Math.floor(i / 10) * 3 }));
        const mire = cells.filter((c) => !stamps.some((f) => f.x >= c.x && f.x < c.x + 3 && f.y >= c.y && f.y < c.y + 3));
        expect(mire.length / cells.length).toBeGreaterThan(0.2);
    });

    it('keeps a large strewn piece wholly off a river or road, not just its middle', () => {
        // A ruin's flagstone floor strewn over rubble ran its corner onto the river (2026-11-05 render, feudal forest).
        const debris = TEST_ROLES.get('debris')?.[0];
        if (!debris) {
            throw new Error('the test roles have no debris');
        }
        const roles = new Map(TEST_ROLES);
        roles.set('debris', [{ ...debris, key: 'test:ruin-floor', width: 4, height: 4 }]);
        const ruins = crossing({ zones: [{ kind: 'rubble', area: { shape: 'everywhere' }, density: 'dense' }], buildings: [] });
        const river = ruins.paths.find((p) => p.kind === 'river');
        const road = ruins.paths.find((p) => p.kind === 'road');
        const { spec } = composeMap(ruins, roles);
        const floors = spec.features.filter((f) => f.type === 'stamp' && f.stamp === 'test:ruin-floor');
        const reach = Math.hypot(4, 4) / 2;
        expect(floors.length).toBeGreaterThan(0);
        // The river runs down x 15, the road across y 10, both straight: nothing of a floor over either.
        expect(floors.filter((f) => f.type === 'stamp' && Math.abs(f.x - 15) < reach + (river?.width ?? 0) / 2)).toEqual([]);
        expect(floors.filter((f) => f.type === 'stamp' && Math.abs(f.y - 10) < reach + (road?.width ?? 0) / 2)).toEqual([]);
    });

    it('runs a road round a lake in its way, never through the water', () => {
        const pond = crossing({
            zones: [{ kind: 'lake', area: { shape: 'circle', centre: { x: 15, y: 10 }, radius: 3 } }],
            paths: [{ kind: 'road', from: { x: -1, y: 10 }, to: { x: 31, y: 10 }, meander: 0 }],
            buildings: [],
        });
        const { spec } = composeMap(pond, TEST_ROLES);
        const water = spec.features.find((f) => f.type === 'region' && f.biome === 'water');
        const road = spec.features.find((f) => f.type === 'path' && f.kind === 'road');
        if (water?.type !== 'region' || road?.type !== 'path') {
            throw new Error('no road beside a lake');
        }
        const shore = water.points.flatMap((q) => [q.x, q.y]);
        expect(road.points.filter((p) => pointInPolygon(p, shore))).toEqual([]);
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
        // Crisp-edged, so no fading band of lake draws the shore across the river leaving it.
        expect(
            spec.features
                .filter((f) => f.type === 'region' && (f.biome === 'water' || f.biome === 'dirt'))
                .every((f) => f.type === 'region' && f.sharp === true),
        ).toBe(true);
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
        expect(composed.problems).toContainEqual({ kind: 'placeholder', piece: 'altar', wantedIn: 'hut' });
        expect(composeMap(crossing({ props: [{ role: 'altar', at: { x: 5, y: 5 } }] }), noAltar).problems).toContainEqual({
            kind: 'placeholder',
            piece: 'altar',
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

    it('winds a river through the points it is asked to pass, and lays the bed it is asked for along its banks', () => {
        const { spec } = composeMap(
            crossing({
                paths: [{ kind: 'river', from: { x: -1, y: 5 }, to: { x: 31, y: 5 }, via: [{ x: 15, y: 16 }], meander: 0, bed: 'sand', shade: '#4a8db5' }],
                buildings: [],
            }),
            TEST_ROLES,
        );
        const river = spec.features.find((f) => f.type === 'path' && f.kind === 'river');
        if (river?.type !== 'path') {
            throw new Error('no river');
        }
        // Through the point asked, in a smooth curve: down to it and back up, never turning a corner there.
        expect(river.points).toContainEqual({ x: 15, y: 16 });
        expect(Math.max(...river.points.map((p) => p.y))).toBeCloseTo(16, 0);
        const at = river.points.findIndex((p) => p.x === 15 && p.y === 16);
        const [before, after] = [river.points[at - 1], river.points[at + 1]];
        expect(before && after && Math.abs(before.y - after.y)).toBeLessThan(0.5);
        expect(river).toMatchObject({ bed: 'sand', shade: '#4a8db5' });
        // A road takes no bed and no shade, but its own texture; a river takes no road's texture.
        const road = composeMap(
            crossing({
                paths: [{ kind: 'road', from: { x: -1, y: 5 }, to: { x: 31, y: 5 }, meander: 0, bed: 'sand', shade: '#4a8db5', texture: 'dirt' }],
                buildings: [],
            }),
            TEST_ROLES,
        ).spec.features.find((f) => f.type === 'path');
        expect(road).not.toHaveProperty('bed');
        expect(road).not.toHaveProperty('shade');
        expect(road).toMatchObject({ texture: 'dirt' });
        expect(river).not.toHaveProperty('texture');
    });

    it('keeps a wood’s canopies mostly off a road through it too: the way is seen, never roofed over by a tree', () => {
        const wooded = crossing({
            zones: [{ kind: 'woodland', area: { shape: 'everywhere' }, density: 'dense' }],
            paths: [{ kind: 'road', from: { x: -1, y: 10 }, to: { x: 31, y: 10 }, meander: 0, width: 2 }],
            buildings: [],
        });
        const { spec } = composeMap(wooded, TEST_ROLES);
        const road = spec.features.find((f) => f.type === 'path' && f.kind === 'road');
        if (road?.type !== 'path') {
            throw new Error('no road');
        }
        const trees = spec.features.filter((f) => f.type === 'stamp' && f.stamp === 'test:tree');
        expect(trees.length).toBeGreaterThan(0);
        expect(trees.every((t) => t.type === 'stamp' && Math.abs(t.y - 10) >= (road.halfWidth ?? 1) + 1)).toBe(true);
    });

    it('spaces a zone’s smallest dressing as though a square across: tufts of sedge never pack a marsh by the hundred', () => {
        const flora = TEST_ROLES.get('flora')?.[0];
        if (!flora) {
            throw new Error('no test flora');
        }
        const marsh = crossing({ zones: [{ kind: 'marsh', area: { shape: 'edge', side: 'west', depth: 20 } }], paths: [], buildings: [] });
        const tufts = (width: number): number => {
            const sized: RoleIndex = new Map<StampRole, readonly RoleStamp[]>([...TEST_ROLES, ['flora', [{ ...flora, width, height: width }]]]);
            return composeMap(marsh, sized).spec.features.filter((f) => f.type === 'stamp' && f.stamp === flora.key).length;
        };
        // A fifth of a square across, it stands no thicker than art a square across.
        expect(tufts(1)).toBeGreaterThan(0);
        expect(tufts(0.2)).toBeLessThanOrEqual(tufts(1) * 1.2);
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

    it('lays a yard round a site with no front door, with nothing on it where the packs have no stores, cart or pen at all', () => {
        const intent = crossing({ paths: [], buildings: [] });
        const site = { key: 'barn', footprint: { x: 8, y: 5, w: 12, h: 8 }, front: null, annexes: [], clear: [], yard: true };
        // No placeholders here: the roles are simply absent.
        const bare: RoleIndex = new Map([...TEST_ROLES].filter(([role]) => !['storage', 'vehicle', 'enclosure', 'fodder'].includes(role)));
        const { features } = composeExterior(intent, [site], bare, seededRandom(1), NO_PREFERENCES, () => ({}));
        const standing = features.flatMap((f) => (f.type === 'stamp' ? [f.stamp] : []));
        expect(standing.some((s) => ['test:storage', 'test:vehicle', 'test:enclosure'].includes(s))).toBe(false);
        // Its trodden earth still lies round the building.
        expect(features.some((f) => f.type === 'region' && f.biome === 'dirt')).toBe(true);
    });

    it('stands a pen with no cart to have, a cart with no pen, and a yard round a building with no front door', () => {
        const barn = { x: 8, y: 5, w: 12, h: 8 };
        const site = (frontDoor: boolean): ReturnType<typeof crossing> =>
            crossing({
                paths: [],
                buildings: [
                    {
                        key: 'barn',
                        at: { x: barn.x, y: barn.y },
                        width: barn.w,
                        height: barn.h,
                        yard: true,
                        frontDoor,
                        rooms: [{ key: 'room', purpose: 'storage' }],
                    },
                ],
            });
        const without = (...roles: string[]): typeof TEST_ROLES => new Map([...TEST_ROLES].filter(([role]) => !roles.includes(role)));
        const penOnly = composeMap(site(true), without('vehicle')).spec;
        expect(stampsOf(penOnly, 'test:enclosure')).toBe(1);
        expect(stampsOf(penOnly, 'test:vehicle') + stampsOf(penOnly, 'test:hauler')).toBe(0);
        const cartOnly = composeMap(site(true), without('enclosure')).spec;
        expect(stampsOf(cartOnly, 'test:enclosure')).toBe(0);
        expect(stampsOf(cartOnly, 'test:vehicle') + stampsOf(cartOnly, 'test:hauler')).toBe(1);
        // No way in at ground level: the yard still has its stores against the walls.
        const shut = composeMap(site(false), TEST_ROLES).spec;
        expect(stampsOf(shut, 'test:storage')).toBeGreaterThanOrEqual(2);
    });

    it('lays a working yard’s trodden earth only where no painted blend is the ground, and its stores either way', () => {
        const barn = crossing({
            paths: [],
            buildings: [{ key: 'barn', at: { x: 8, y: 5 }, width: 12, height: 8, yard: true, rooms: [{ key: 'room', purpose: 'storage' }] }],
        });
        const splats: typeof barn.splats = [{ mask: 'modules/x/ground.png', roles: ['floor.packed-dirt', 'floor.mud', null, null] }];
        const earth = (spec: ReturnType<typeof composeMap>['spec']): number => spec.features.filter((f) => f.type === 'region' && f.biome === 'dirt').length;
        const plain = composeMap(barn, TEST_ROLES).spec;
        const blended = composeMap({ ...barn, splats }, TEST_ROLES).spec;
        expect([earth(plain) > 0, earth(blended)]).toEqual([true, 0]);
        expect(stampsOf(blended, 'test:storage')).toBe(stampsOf(plain, 'test:storage'));
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
            // Each stands wholly clear of the wall's drawn band, half of which lies outside the footprint: never on the wall.
            const store = TEST_ROLES.get('storage')?.[0];
            const reach = Math.max(store?.width ?? 0, store?.height ?? 0) / 2;
            for (const f of stores) {
                if (f.type !== 'stamp') {
                    continue;
                }
                const off = Math.max(barn.x - f.x, f.x - (barn.x + barn.w), barn.y - f.y, f.y - (barn.y + barn.h));
                expect(off - reach).toBeGreaterThanOrEqual(WALL_BAND_SQUARES / 2 - 1e-6);
            }
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

describe('footprintClear', () => {
    it('keeps a long piece clear by a chain of circles along it, never one its whole length across', () => {
        // A 32-square run of cliff face, a square deep, lying east to west.
        const chain = footprintClear({ x: 16, y: 5 }, 32, 1, 0);
        expect(chain).toHaveLength(32);
        expect(Math.max(...chain.map((c) => c.r))).toBeLessThan(1);
        expect(chain.every((c) => c.y === 5)).toBe(true);
        expect(Math.min(...chain.map((c) => c.x))).toBeCloseTo(0.5);
        expect(Math.max(...chain.map((c) => c.x))).toBeCloseTo(31.5);
    });

    it('turns the chain with the piece', () => {
        const chain = footprintClear({ x: 10, y: 10 }, 6, 1, 90);
        expect(chain.every((c) => Math.abs(c.x - 10) < 1e-9)).toBe(true);
        expect(Math.min(...chain.map((c) => c.y))).toBeCloseTo(7.5);
        expect(Math.max(...chain.map((c) => c.y))).toBeCloseTo(12.5);
    });

    it('keeps one circle round a piece about as long as it is wide', () => {
        const [one, ...rest] = footprintClear({ x: 3, y: 4 }, 2, 2, 45);
        expect(rest).toHaveLength(0);
        expect(one).toEqual({ x: 3, y: 4, r: Math.hypot(2, 2) / 2 });
    });
});

describe('pickDressing', () => {
    it('keeps a wood mostly green: a tree turned in its colour is an accent', () => {
        const base = (TEST_ROLES.get('tree') ?? [])[0];
        expect(base).toBeDefined();
        if (!base) {
            return;
        }
        // One green tree against three colours, as the packs hold them (a red, an orange and a yellow crown).
        const green = { ...base, key: 'test:green', tags: ['forest', 'tree'] };
        const colours = ['red', 'orange', 'yellow'].map((c) => ({ ...base, key: `test:${c}`, tags: [c, 'autumn', 'tree'] }));
        const random = seededRandom(7);
        const picks = Array.from({ length: 2000 }, () => pickDressing(random, 'tree', [green, ...colours])?.key);
        const autumn = picks.filter((k) => k !== 'test:green').length / picks.length;
        // Three colours at a twentieth of a green tree's weight each: about 0.13 of the wood.
        expect(autumn).toBeGreaterThan(0.08);
        expect(autumn).toBeLessThan(0.2);
    });

    it('picks any other piece from its choices alike', () => {
        const base = (TEST_ROLES.get('rock') ?? [])[0];
        expect(base).toBeDefined();
        if (!base) {
            return;
        }
        const a = { ...base, key: 'test:a', tags: ['autumn'] };
        const b = { ...base, key: 'test:b', tags: ['stone'] };
        const random = seededRandom(3);
        const share = Array.from({ length: 2000 }, () => pickDressing(random, 'rock', [a, b])?.key).filter((k) => k === 'test:a').length / 2000;
        expect(share).toBeGreaterThan(0.4);
        expect(share).toBeLessThan(0.6);
        expect(pickDressing(random, 'tree', [])).toBeUndefined();
    });
});

describe('a piece kept clear', () => {
    it('moves off a road to the nearest free spot, and stands exactly where asked when nothing is in the way', () => {
        const fitting = TEST_ROLES.get('fitting')?.[0];
        if (!fitting) {
            throw new Error('the test roles have no fitting');
        }
        const intentOf = (at: { x: number; y: number }, clear: boolean): MapIntent => {
            const parsed = parseMapIntent({
                schemaVersion: 1,
                seed: 4,
                width: 30,
                height: 20,
                ground: 'grassland',
                paths: [{ kind: 'road', from: { x: -1, y: 10 }, to: { x: 31, y: 10 }, meander: 0 }],
                fixtures: [{ name: 'shrub', role: 'fitting', tags: fitting.tags.slice(0, 1), width: 1, height: 1, at, clear }],
            });
            if (!parsed.ok) {
                throw new Error(JSON.stringify(parsed.issues));
            }
            return parsed.intent;
        };
        const standing = (intent: MapIntent) =>
            composeMap(intent, TEST_ROLES, NO_PREFERENCES).spec.features.flatMap((f) => (f.type === 'stamp' && f.stamp === fitting.key ? [f] : []));
        // On the road, kept clear: moved off it, near where asked.
        const [moved] = standing(intentOf({ x: 15, y: 10 }, true));
        expect(moved).toBeDefined();
        expect(Math.abs((moved?.y ?? 10) - 10)).toBeGreaterThan(1);
        expect(Math.hypot((moved?.x ?? 0) - 15, (moved?.y ?? 0) - 10)).toBeLessThan(4);
        // On the road, not kept clear: stands exactly where asked (named pieces stand where asked).
        const [asked] = standing(intentOf({ x: 15, y: 10 }, false));
        expect(asked?.y).toBe(10);
        // In open ground, kept clear: never moved.
        const [inOpen] = standing(intentOf({ x: 5, y: 4 }, true));
        expect({ x: inOpen?.x, y: inOpen?.y }).toEqual({ x: 5, y: 4 });
    });

    it('stands wholly off a river, where only a tree’s crown may reach over it', () => {
        const fitting = TEST_ROLES.get('fitting')?.[0];
        if (!fitting) {
            throw new Error('the test roles have no fitting');
        }
        const parsed = parseMapIntent({
            schemaVersion: 1,
            seed: 4,
            width: 30,
            height: 20,
            ground: 'grassland',
            paths: [{ kind: 'river', from: { x: -1, y: 10 }, to: { x: 31, y: 10 }, width: 2, meander: 0 }],
            fixtures: [{ name: 'boulder', role: 'fitting', tags: fitting.tags.slice(0, 1), width: 3, height: 3, at: { x: 15, y: 10 }, clear: true }],
        });
        if (!parsed.ok) {
            throw new Error(JSON.stringify(parsed.issues));
        }
        const [moved] = composeMap(parsed.intent, TEST_ROLES, NO_PREFERENCES).spec.features.flatMap((f) =>
            f.type === 'stamp' && f.stamp === fitting.key ? [f] : [],
        );
        expect(moved).toBeDefined();
        // Its whole half-width (1.5) clear of the river's (1): its centre at least 2.5 off the river's line.
        expect(Math.abs((moved?.y ?? 10) - 10)).toBeGreaterThanOrEqual(2.5);
    });
});
