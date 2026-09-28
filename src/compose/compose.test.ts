// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseSceneSpec, type SceneSpec } from '../generate/spec';
import { distanceToPolyline, pointInPolygon } from '../geometry/hit';
import { composeMap, footprintOf } from './compose';
import { type MapIntent, parseMapIntent } from './intent';
import { PRESET_INTENTS } from './presets';
import type { ComposeProblem } from './problems';
import { TEST_ROLES } from './test-roles';

function intentOf(given: object): MapIntent {
    const parsed = parseMapIntent({ schemaVersion: 1, ...given });
    if (!parsed.ok) {
        throw new Error(`fixture: ${JSON.stringify(parsed.issues)}`);
    }
    return parsed.intent;
}

/** An inn in a woodland clearing: a road from the west to its door, a river down the east. */
const INN_IN_THE_WOODS = intentOf({
    seed: 3,
    width: 36,
    height: 24,
    zones: [
        { kind: 'woodland', area: { shape: 'everywhere' }, density: 'dense' },
        { kind: 'clearing', area: { shape: 'circle', centre: { x: 16, y: 12 }, radius: 9 } },
    ],
    paths: [
        { kind: 'road', from: 'west', to: { building: 'inn' } },
        { kind: 'river', from: 'north', to: 'south', meander: 0.5 },
    ],
    buildings: [
        {
            key: 'inn',
            at: { x: 10, y: 8 },
            width: 12,
            height: 8,
            rooms: [
                { key: 'common', purpose: 'common-room', size: 3, entrance: true, opensTo: ['bar'] },
                { key: 'bar', purpose: 'bar', opensTo: ['kitchen'] },
                { key: 'kitchen', purpose: 'kitchen', opensTo: ['store'] },
                { key: 'store', purpose: 'storage', size: 0.6 },
            ],
        },
    ],
});

function compose(intent: MapIntent): { spec: SceneSpec; problems: readonly ComposeProblem[] } {
    const composed = composeMap(intent, TEST_ROLES);
    const parsed = parseSceneSpec(composed.spec);
    if (!parsed.ok) {
        throw new Error(`composed an invalid spec: ${JSON.stringify(parsed.issues.slice(0, 3))}`);
    }
    return { spec: parsed.spec, problems: composed.problems };
}

describe('composeMap', () => {
    it('composes a valid spec with nothing it could not do', () => {
        const { problems, spec } = compose(INN_IN_THE_WOODS);
        expect(problems).toEqual([]);
        expect(spec.units).toBe('grid');
    });

    it('lays the ground, the zones, the paths, then everything standing, then the building on top', () => {
        const { spec } = compose(INN_IN_THE_WOODS);
        const kinds = spec.features.map((f) => f.type);
        const firstStamp = kinds.indexOf('stamp');
        expect(kinds.slice(0, 3)).toEqual(['region', 'region', 'region']);
        expect(kinds.lastIndexOf('path')).toBeLessThan(firstStamp);
        expect(kinds.indexOf('room')).toBeGreaterThan(firstStamp);
    });

    it('walls, doors and furnishes every room of the building', () => {
        const { spec } = compose(INN_IN_THE_WOODS);
        const rooms = spec.features.filter((f) => f.type === 'room');
        expect(rooms).toHaveLength(4);
        for (const room of rooms) {
            expect(room.wall).toBe('wall.stone');
        }
        // A shared wall's door belongs to one of its rooms: one per connection (three), and the front door.
        expect(rooms.reduce((n, room) => n + room.doors.length, 0)).toBe(4);
        const foot = { x: 10, y: 8, w: 12, h: 8 };
        const inside = spec.features.flatMap((f) =>
            f.type === 'stamp' && f.x > foot.x && f.x < foot.x + foot.w && f.y > foot.y && f.y < foot.y + foot.h ? [f.stamp] : [],
        );
        expect(inside.filter((key) => key === 'test:table').length).toBeGreaterThanOrEqual(1);
        expect(inside).toContain('test:counter');
    });

    it('fills the woods with trees and undergrowth, but none in the clearing, on the road or the water, or against the inn', () => {
        const { spec } = compose(INN_IN_THE_WOODS);
        const trees = spec.features.flatMap((f) => (f.type === 'stamp' && (f.stamp === 'test:tree' || f.stamp === 'test:big-tree') ? [f] : []));
        expect(trees.length).toBeGreaterThan(30);
        // The clearing: the grassland zone with a wandering (many-pointed) outline.
        const clearing = spec.features.flatMap((f) => (f.type === 'region' ? [f] : [])).find((r) => r.biome === 'grassland' && r.points.length > 20);
        const paths = spec.features.flatMap((f) => (f.type === 'path' ? [f] : []));
        expect(paths.map((p) => p.kind).sort()).toEqual(['river', 'road']);
        for (const tree of trees) {
            expect(
                clearing &&
                    pointInPolygon(
                        tree,
                        clearing.points.flatMap((p) => [p.x, p.y]),
                    ),
            ).toBe(false);
            for (const path of paths) {
                expect(distanceToPolyline(tree, path.points)).toBeGreaterThan(path.halfWidth ?? 0);
            }
            const inn = { x: 10, y: 8, w: 12, h: 8 };
            expect(tree.x > inn.x - 1 && tree.x < inn.x + inn.w + 1 && tree.y > inn.y - 1 && tree.y < inn.y + inn.h + 1).toBe(false);
        }
        // The river has rocks along its banks.
        expect(spec.features.some((f) => f.type === 'stamp' && f.stamp === 'test:rock')).toBe(true);
    });

    it('keeps every canopy off the inn, not only every trunk', () => {
        const { spec } = compose(INN_IN_THE_WOODS);
        const inn = { x: 10, y: 8, w: 12, h: 8 };
        const sizes = new Map([...TEST_ROLES.values()].flat().map((s) => [s.key, Math.max(s.width, s.height)]));
        const outdoors = spec.features.flatMap((f) =>
            f.type === 'stamp' && (f.stamp === 'test:tree' || f.stamp === 'test:big-tree' || f.stamp === 'test:shrub') ? [f] : [],
        );
        expect(outdoors.length).toBeGreaterThan(0);
        for (const piece of outdoors) {
            const half = (sizes.get(piece.stamp) ?? 0) / 2;
            const overlaps = piece.x + half > inn.x && piece.x - half < inn.x + inn.w && piece.y + half > inn.y && piece.y - half < inn.y + inn.h;
            expect(overlaps).toBe(false);
        }
    });

    it('wears bare earth into the woods in wandering patches, never into the clearing', () => {
        const { spec } = compose(INN_IN_THE_WOODS);
        const worn = spec.features.flatMap((f) => (f.type === 'stroke' && f.biome === 'dirt' ? [f] : []));
        expect(worn.length).toBeGreaterThan(0);
        const clearing = spec.features.flatMap((f) => (f.type === 'region' ? [f] : [])).find((r) => r.biome === 'grassland' && r.points.length > 20);
        const outline = clearing?.points.flatMap((p) => [p.x, p.y]) ?? [];
        for (const patch of worn) {
            // A line of several points, not a single round dab.
            expect(patch.points.length).toBeGreaterThan(2);
            expect(patch.points[0] && pointInPolygon(patch.points[0], outline)).toBe(false);
        }
    });

    it('runs the road to the inn’s front door', () => {
        const { spec } = compose(INN_IN_THE_WOODS);
        const road = spec.features.find((f) => f.type === 'path' && f.kind === 'road');
        const points = road?.type === 'path' ? road.points : [];
        const end = points.at(-1) ?? { x: 0, y: 0 };
        const step = points.at(-2) ?? { x: 0, y: 0 };
        // The front door is in the common room's outer wall: the road runs on from a step outside it to the doorway, square to the wall.
        const inn = { x: 10, y: 8, w: 12, h: 8 };
        const onWall =
            ((end.y === inn.y || end.y === inn.y + inn.h) && end.x > inn.x && end.x < inn.x + inn.w) ||
            ((end.x === inn.x || end.x === inn.x + inn.w) && end.y > inn.y && end.y < inn.y + inn.h);
        expect(onWall).toBe(true);
        expect(step.x === end.x || step.y === end.y).toBe(true);
        const start = road?.type === 'path' ? road.points[0] : undefined;
        expect(start?.x).toBeLessThan(0);
    });

    it('takes a river laid through the inn round it, its water clear of the walls', () => {
        const { spec } = compose({
            ...INN_IN_THE_WOODS,
            paths: [{ kind: 'river', from: { x: 16, y: -1 }, to: { x: 16, y: 25 }, meander: 0 }],
        });
        const river = spec.features.find((f) => f.type === 'path');
        const points = river?.type === 'path' ? river.points : [];
        expect(points.at(0)).toEqual({ x: 16, y: -1 });
        expect(points.at(-1)).toEqual({ x: 16, y: 25 });
        const inn = { x: 10, y: 8, w: 12, h: 8 };
        const reach = river?.type === 'path' ? river.halfWidth ?? 0 : 0;
        // Every square the inn stands on is further from the river's line than its banks reach.
        for (let x = inn.x; x <= inn.x + inn.w; x += 1) {
            for (let y = inn.y; y <= inn.y + inn.h; y += 1) {
                expect(distanceToPolyline({ x, y }, points)).toBeGreaterThan(reach);
            }
        }
    });

    it('stands a fortified yard’s works and a landing field’s craft apart, clear of the road and the building, on their own ground', () => {
        const { spec } = compose(
            intentOf({
                seed: 4,
                width: 56,
                height: 28,
                ground: 'ash',
                groundTexture: 'floor.scorched-earth',
                zones: [
                    { kind: 'fortified', area: { shape: 'circle', centre: { x: 12, y: 14 }, radius: 10 }, density: 'dense', texture: 'floor.packed-dirt' },
                    { kind: 'landing', area: { shape: 'edge', side: 'east', depth: 22 } },
                ],
                // From the west, through the yard, so the landing field is left whole for its craft.
                paths: [{ kind: 'road', from: 'west', to: { building: 'post' } }],
                buildings: [{ key: 'post', at: { x: 16, y: 4 }, width: 6, height: 5, rooms: [{ key: 'command', purpose: 'command', entrance: true }] }],
            }),
        );
        const sizes = new Map([...TEST_ROLES.values()].flat().map((s) => [s.key, s]));
        const works = spec.features.flatMap((f) => {
            const stamp = f.type === 'stamp' ? sizes.get(f.stamp) : undefined;
            return f.type === 'stamp' && stamp && ['structure', 'vehicle', 'emplacement', 'barricade'].includes(stamp.role)
                ? // Half its longer side: barricades in a line stand end to end, and nothing stands on another.
                  [{ x: f.x, y: f.y, r: Math.max(stamp.width, stamp.height) / 2, role: stamp.role }]
                : [];
        });
        expect(new Set(works.map((w) => w.role))).toEqual(new Set(['structure', 'vehicle', 'emplacement', 'barricade']));
        // Craters scar the yard's ground among the works.
        expect(spec.features.some((f) => f.type === 'stamp' && f.stamp === 'test:crater')).toBe(true);
        works.forEach((a, i) => {
            for (const b of works.slice(i + 1)) {
                expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r);
            }
        });
        const road = spec.features.find((f) => f.type === 'path');
        const post = { x: 16, y: 4, w: 6, h: 5 };
        for (const w of works) {
            expect(distanceToPolyline(w, road?.type === 'path' ? road.points : [])).toBeGreaterThan(w.r);
            const clear = w.x + w.r < post.x || w.x - w.r > post.x + post.w || w.y + w.r < post.y || w.y - w.r > post.y + post.h;
            expect(clear).toBe(true);
        }
        // The ground and the yard are drawn in the textures the intent names.
        const textures = spec.features.flatMap((f) => (f.type === 'region' ? [f.texture ?? null] : []));
        expect(textures).toEqual(['floor.scorched-earth', 'floor.packed-dirt', null]);
    });

    it('rings a fortified yard with its defences, every front facing out, and stands side-on works as drawn', () => {
        const centre = { x: 20, y: 14 };
        const { spec } = compose(intentOf({ seed: 6, width: 40, height: 28, zones: [{ kind: 'fortified', area: { shape: 'circle', centre, radius: 9 } }] }));
        const defences = spec.features.flatMap((f) => (f.type === 'stamp' && (f.stamp === 'test:barricade' || f.stamp === 'test:emplacement') ? [f] : []));
        expect(defences.length).toBeGreaterThan(8);
        for (const d of defences) {
            // Near the edge, not scattered through the yard.
            expect(Math.hypot(d.x - centre.x, d.y - centre.y)).toBeGreaterThan(9 * 0.6);
            // Its front (the image's top, the piece drawn back down) points away from the middle, within a few degrees.
            const radians = ((d.rotation ?? 0) * Math.PI) / 180;
            const front = { x: Math.sin(radians), y: -Math.cos(radians) };
            const out = { x: d.x - centre.x, y: d.y - centre.y };
            const cos = (front.x * out.x + front.y * out.y) / Math.hypot(out.x, out.y);
            expect(cos).toBeGreaterThan(0.95);
        }
        const posts = spec.features.filter((f) => f.type === 'stamp' && f.stamp === 'test:watch-post');
        expect(posts.every((p) => p.type === 'stamp' && p.rotation === 0)).toBe(true);
    });

    it('dresses a landing field or a yard whatever the habitats, but a wood only with its own land', () => {
        const barren = new Map([...TEST_ROLES].map(([role, stamps]) => [role, stamps.map((s) => ({ ...s, habitats: [] }))]));
        const composed = composeMap(
            intentOf({
                zones: [
                    { kind: 'landing', area: { shape: 'everywhere' } },
                    { kind: 'woodland', area: { shape: 'everywhere' } },
                ],
            }),
            barren,
        );
        const roles = new Set(composed.spec.features.flatMap((f) => (f.type === 'stamp' ? [f.stamp] : [])));
        expect(roles.has('test:hauler') || roles.has('test:vehicle')).toBe(true);
        expect(roles.has('test:tree')).toBe(false);
        expect(composed.problems).toContainEqual({ kind: 'no-stamp', role: 'tree', wantedIn: 'woodland' });
    });

    it('puts a building of three floors on three levels, the ground on the scene’s own, a switchback stair joining each floor to the next, nothing on it', () => {
        const { spec, problems } = compose(
            intentOf({
                seed: 8,
                width: 24,
                height: 18,
                zones: [{ kind: 'meadow', area: { shape: 'everywhere' } }],
                buildings: [
                    {
                        key: 'house',
                        at: { x: 6, y: 4 },
                        width: 12,
                        height: 9,
                        rooms: [
                            { key: 'hall', purpose: 'hall', entrance: true, opensTo: ['kitchen', 'common'] },
                            { key: 'kitchen', purpose: 'kitchen' },
                            { key: 'common', purpose: 'common-room', size: 2 },
                        ],
                        floors: [
                            {
                                name: 'Bedrooms',
                                rooms: [
                                    { key: 'landing', purpose: 'hall', opensTo: ['bed-1', 'bed-2'] },
                                    { key: 'bed-1', purpose: 'bedroom' },
                                    { key: 'bed-2', purpose: 'bedroom' },
                                ],
                            },
                            { rooms: [{ key: 'attic', purpose: 'storage' }] },
                        ],
                    },
                ],
            }),
        );
        expect(problems).toEqual([]);
        expect(spec.levels.map((l) => [l.key, l.name, l.existing])).toEqual([
            ['ground', 'Ground floor', true],
            ['floor-2', 'Bedrooms', false],
            ['floor-3', 'Floor 3', false],
        ]);
        // Everything is on a level: outdoors and the ground floor on the ground.
        expect(spec.features.every((f) => f.level !== undefined)).toBe(true);
        const rooms = spec.features.flatMap((f) => (f.type === 'room' ? [f] : []));
        expect(new Set(rooms.map((r) => r.level))).toEqual(new Set(['ground', 'floor-2', 'floor-3']));
        // Room keys stay unique across floors.
        expect(new Set(rooms.map((r) => r.key)).size).toBe(rooms.length);
        const stairs = spec.features.flatMap((f) => (f.type === 'stamp' && f.stamp === 'test:stairs' ? [f] : []));
        expect(stairs.map((s) => s.level)).toEqual(['ground', 'floor-2']);
        // A switchback: the second flight beside the first (one stair's width on), so their ways between floors never overlap.
        const [first, second] = stairs;
        expect(second?.y).toBe(first?.y);
        expect((second?.x ?? 0) - (first?.x ?? 0)).toBeCloseTo(1);
        // Nothing else stands in the stairwell, on any floor.
        const well = { x: (first?.x ?? 0) - 0.5, y: (first?.y ?? 0) - 1, w: 2, h: 2 };
        const sizes = new Map([...TEST_ROLES.values()].flat().map((s) => [s.key, s]));
        const inWell = spec.features.flatMap((f) => {
            const piece = f.type === 'stamp' && f.stamp !== 'test:stairs' ? sizes.get(f.stamp) : undefined;
            if (f.type !== 'stamp' || !piece || piece.role === 'rug') {
                return [];
            }
            // The piece's inner half-size: however it is turned, at least this much of it lies each way of its centre.
            const r = Math.min(piece.width, piece.height) / 2;
            const clear = f.x + r <= well.x || f.x - r >= well.x + well.w || f.y + r <= well.y || f.y - r >= well.y + well.h;
            return clear ? [] : [f.stamp];
        });
        expect(inWell).toEqual([]);
    });

    it('by night darkens the scene and lights a room by its hearth and lamps, keeping the light of a room with neither', () => {
        const { spec } = compose({ ...INN_IN_THE_WOODS, lighting: 'night' });
        expect(spec.scene).toMatchObject({ darkness: 0.85, globalLight: false });
        const rooms = spec.features.flatMap((f) => (f.type === 'room' ? [f] : []));
        // Each room is dark but for its own hearth and lamps where it has any, and keeps a light of its own where it has none.
        const glowing = new Set(['test:hearth', 'test:light']);
        const glows = (room: (typeof rooms)[number]): boolean => {
            const xs = room.points.map((p) => p.x);
            const ys = room.points.map((p) => p.y);
            return spec.features.some(
                (f) =>
                    f.type === 'stamp' &&
                    glowing.has(f.stamp) &&
                    f.x > Math.min(...xs) &&
                    f.x < Math.max(...xs) &&
                    f.y > Math.min(...ys) &&
                    f.y < Math.max(...ys),
            );
        };
        expect(rooms.find((r) => r.key === 'inn:common')?.lit).toBe(false);
        for (const room of rooms) {
            expect(room.lit).toBe(!glows(room));
        }
        // By day every room keeps its light.
        expect(compose(INN_IN_THE_WOODS).spec.features.every((f) => f.type !== 'room' || f.lit)).toBe(true);
    });

    it('is the same map for the same intent, and another for another seed', () => {
        expect(compose(INN_IN_THE_WOODS).spec).toEqual(compose(INN_IN_THE_WOODS).spec);
        expect(compose({ ...INN_IN_THE_WOODS, seed: 4 }).spec).not.toEqual(compose(INN_IN_THE_WOODS).spec);
    });

    it('reports what it could not do, once each: roles no stamp fills, rooms that do not fit, rooms it could not put side by side', () => {
        const empty = composeMap(INN_IN_THE_WOODS, new Map());
        expect(empty.problems).toContainEqual({ kind: 'no-stamp', role: 'tree', wantedIn: 'woodland' });
        expect(empty.problems).toContainEqual({ kind: 'no-stamp', role: 'table', wantedIn: 'inn/common' });
        expect(empty.problems.filter((p) => p.kind === 'no-stamp' && p.role === 'tree')).toHaveLength(1);
        const cramped = intentOf({ buildings: [{ key: 'hut', width: 3, height: 3, rooms: ['a', 'b', 'c', 'd'].map((key) => ({ key, purpose: 'cell' })) }] });
        expect(composeMap(cramped, TEST_ROLES).problems).toEqual([{ kind: 'rooms-do-not-fit', building: 'hut', width: 3, height: 3 }]);
        const strip = intentOf({
            buildings: [
                {
                    width: 15,
                    height: 3,
                    rooms: [{ key: 'a', purpose: 'hall', opensTo: ['b', 'c', 'd', 'e'] }, ...['b', 'c', 'd', 'e'].map((key) => ({ key, purpose: 'cell' }))],
                },
            ],
        });
        expect(composeMap(strip, TEST_ROLES).problems).toContainEqual(expect.objectContaining({ kind: 'not-beside', building: 'building-1', room: 'a' }));
    });

    it('reports a building of floors with no stair to join them, and an upper floor whose rooms do not fit', () => {
        const tower = (upper: readonly string[]): MapIntent =>
            intentOf({
                buildings: [
                    {
                        key: 'tower',
                        width: 6,
                        height: 5,
                        rooms: [{ key: 'hall', purpose: 'hall', entrance: true }],
                        floors: [{ rooms: upper.map((key) => ({ key, purpose: 'cell' })) }],
                    },
                ],
            });
        const stairless = new Map([...TEST_ROLES].filter(([role]) => role !== 'stairs'));
        expect(composeMap(tower(['loft']), stairless).problems).toContainEqual({ kind: 'no-stamp', role: 'stairs', wantedIn: 'tower' });
        // Nine cells cannot share a 6 by 5 floor, so no stairwell serves it either.
        const crowded = composeMap(tower(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']), TEST_ROLES).problems;
        expect(crowded).toContainEqual({ kind: 'rooms-do-not-fit', building: 'tower/floor-2', width: 6, height: 5 });
        expect(crowded).toContainEqual({ kind: 'no-stairwell', building: 'tower' });
        // So too a cellar too crowded to hold the ladder down.
        const cellared = intentOf({
            buildings: [
                {
                    key: 'tower',
                    width: 6,
                    height: 5,
                    rooms: [{ key: 'hall', purpose: 'hall', entrance: true }],
                    cellars: [{ rooms: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((key) => ({ key, purpose: 'cell' })) }],
                },
            ],
        });
        expect(composeMap(cellared, TEST_ROLES).problems).toContainEqual({ kind: 'no-stairwell', building: 'tower/cellar' });
        // Cellars below cellars are numbered down, each on its own level beneath the one above.
        const deep = intentOf({
            buildings: [
                {
                    key: 'keep',
                    width: 10,
                    height: 8,
                    rooms: [{ key: 'hall', purpose: 'hall', entrance: true }],
                    cellars: [{ rooms: [{ key: 'store', purpose: 'storage' }] }, { rooms: [{ key: 'crypt', purpose: 'storage' }] }],
                },
            ],
        });
        expect((composeMap(deep, TEST_ROLES).spec.levels ?? []).map((l) => l.name)).toEqual(['Cellar 2', 'Cellar', 'Ground floor']);
    });

    it('centres a building placed nowhere in particular, and composes an interior alone on a bare scene', () => {
        const alone = intentOf({ width: 20, height: 14, ground: null, buildings: [{ width: 10, height: 6, rooms: [{ key: 'hall', purpose: 'hall' }] }] });
        expect(footprintOf({ at: undefined, width: 10, height: 6 }, alone)).toEqual({ x: 5, y: 4, w: 10, h: 6 });
        const { spec } = compose(alone);
        expect(spec.features.some((f) => f.type === 'region')).toBe(false);
        expect(spec.features.filter((f) => f.type === 'room')).toHaveLength(1);
    });
});

describe('a roadside inn', () => {
    const parsed = parseMapIntent(PRESET_INTENTS['roadside-inn']);
    if (!parsed.ok) {
        throw new Error('the roadside inn preset is not an intent');
    }
    const intent = parsed.intent;
    const { spec, problems } = compose(intent);
    const building = intent.buildings[0];
    if (!building) {
        throw new Error('no inn');
    }
    const inn = footprintOf(building, intent);
    const stampsOf = (key: string): SceneSpec['features'] => spec.features.filter((f) => f.type === 'stamp' && f.stamp === key);
    const roomAt = (key: string): SceneSpec['features'][number] | undefined => spec.features.find((f) => f.type === 'room' && f.key === key);
    const inside = (p: { x: number; y: number }): boolean => p.x > inn.x && p.x < inn.x + inn.w && p.y > inn.y && p.y < inn.y + inn.h;

    it('is composed whole, on three levels: the cellar below the scene’s own floor, the guest rooms above', () => {
        expect(problems).toEqual([]);
        expect(spec.levels.map((l) => [l.key, l.name, l.existing])).toEqual([
            ['cellar-1', 'Cellar', false],
            ['ground', 'Ground floor', true],
            ['floor-2', 'Guest rooms', false],
        ]);
        expect(roomAt('inn/cellar-1:cellar')?.level).toBe('cellar-1');
        expect(roomAt('inn/floor-2:room-3')?.level).toBe('floor-2');
    });

    it('climbs to the guest rooms by the stair and down to the cellar by a ladder standing in the cellar, each inside the inn', () => {
        const [stair] = stampsOf('test:stairs');
        const ladders = stampsOf('test:ladder');
        expect(stair?.level).toBe('ground');
        expect(ladders.map((l) => l.level)).toEqual(['cellar-1']);
        for (const flight of [stair, ...ladders]) {
            expect(flight?.type === 'stamp' && inside(flight)).toBe(true);
        }
    });

    it('has storm doors on the ground beside its south wall, over an areaway on the cellar level with a door through into the cellar', () => {
        const areaway = roomAt('inn:areaway');
        if (areaway?.type !== 'room') {
            throw new Error('no areaway');
        }
        expect(areaway.level).toBe('cellar-1');
        const ys = areaway.points.map((p) => p.y);
        expect(Math.min(...ys)).toBe(inn.y + inn.h);
        expect(areaway.doors).toHaveLength(1);
        const [doors] = stampsOf('test:storm-doors');
        expect(doors).toMatchObject({ level: 'ground', rotation: 0 });
        expect(doors?.type === 'stamp' && doors.y > inn.y + inn.h).toBe(true);
        // The cellar room on the other side of the wall has the door too.
        // With no way down loaded at all, the areaway is still walled, its door through, and nothing is placed to join it.
        const noWays = new Map([...TEST_ROLES].filter(([role]) => role !== 'stairs'));
        const bare = composeMap(intent, noWays);
        expect(bare.spec.features.some((f) => f.type === 'room' && f.key === 'inn:areaway')).toBe(true);
        expect(bare.problems).toContainEqual({ kind: 'no-stamp', role: 'stairs', wantedIn: 'inn/storm-door' });
        // On an east wall, the areaway stands east of the inn, the storm doors' back turned to it, the door through its west wall.
        const eastward = { ...intent, buildings: [{ ...building, stormDoor: 'east' as const }] };
        const east = compose(eastward).spec.features;
        const eastAreaway = east.find((f) => f.type === 'room' && f.key === 'inn:areaway');
        expect(eastAreaway?.type === 'room' && Math.min(...eastAreaway.points.map((p) => p.x))).toBe(inn.x + inn.w);
        expect(east).toContainEqual(expect.objectContaining({ type: 'stamp', stamp: 'test:storm-doors', rotation: 270, level: 'ground' }));
        const eastCellar = east.filter((f) => f.type === 'room' && f.level === 'cellar-1' && f.key !== 'inn:areaway');
        expect(eastCellar.flatMap((f) => (f.type === 'room' ? f.doors : [])).length).toBeGreaterThanOrEqual(2);
        // Without storm door art, a ladder stands in the areaway on the cellar level, climbing to the ground, and says so.
        const noDoors = new Map([...TEST_ROLES, ['stairs', (TEST_ROLES.get('stairs') ?? []).filter((s) => s.key !== 'test:storm-doors')] as const]);
        const standIn = composeMap(intent, noDoors);
        expect(standIn.problems).toContainEqual({ kind: 'stand-in', wanted: 'storm-door', used: 'ladder', wantedIn: 'inn/storm-door' });
        const ladders = standIn.spec.features.filter((f) => f.type === 'stamp' && f.stamp === 'test:ladder' && f.y > inn.y + inn.h);
        expect(ladders).toEqual([expect.objectContaining({ level: 'cellar-1' })]);
        // On the ground the doors are still seen: boards laid over the areaway, beside the wall.
        const boards = standIn.spec.features.find((f) => f.type === 'region' && f.texture === 'floor.wooden-planks');
        expect(boards).toMatchObject({ level: 'ground' });
        expect(boards?.type === 'region' && Math.min(...boards.points.map((p) => p.y))).toBe(inn.y + inn.h);
        const cellarDoors = spec.features
            .filter((f) => f.type === 'room' && f.level === 'cellar-1' && f.key !== 'inn:areaway')
            .flatMap((f) => (f.type === 'room' ? f.doors : []));
        expect(cellarDoors.length).toBeGreaterThanOrEqual(2);
    });

    it('lays a lake of open water in the wood, nothing standing in it, its river running out of it behind the inn and under the road’s bridge', () => {
        const lake = spec.features.find((f) => f.type === 'region' && f.biome === 'water');
        if (lake?.type !== 'region') {
            throw new Error('no lake');
        }
        // Over a bed of its own, showing through as a riverbed does.
        const bed = spec.features[spec.features.indexOf(lake) - 1];
        expect(bed).toMatchObject({ type: 'region', biome: 'dirt', points: lake.points });
        const outline = lake.points.flatMap((p) => [p.x, p.y]);
        const trees = stampsOf('test:tree');
        expect(trees.length).toBeGreaterThan(10);
        expect(trees.some((t) => t.type === 'stamp' && pointInPolygon(t, outline))).toBe(false);
        const river = spec.features.find((f) => f.type === 'path' && f.kind === 'river');
        if (river?.type !== 'path') {
            throw new Error('no river');
        }
        const [mouth] = river.points;
        expect(mouth && pointInPolygon(mouth, outline)).toBe(true);
        // Behind the inn: north of it wherever it passes it.
        const passing = river.points.filter((p) => p.x > inn.x && p.x < inn.x + inn.w);
        expect(passing.length).toBeGreaterThan(0);
        expect(passing.every((p) => p.y < inn.y)).toBe(true);
        // One bridge, where the road crosses, laid along the road (running north to south, a quarter turn from the art's length).
        const bridges = stampsOf('test:bridge');
        expect(bridges).toHaveLength(1);
        const [bridge] = bridges;
        const road = spec.features.find((f) => f.type === 'path' && f.kind === 'road');
        if (bridge?.type !== 'stamp' || road?.type !== 'path') {
            throw new Error('no bridge');
        }
        expect(distanceToPolyline(bridge, road.points)).toBeLessThan(0.1);
        expect(distanceToPolyline(bridge, river.points)).toBeLessThan(0.1);
        expect(Math.abs(((bridge.rotation ?? 0) % 180) - 90)).toBeLessThan(30);
    });

    it('has a board porch at its front door, furnished, and a yard of stores against its walls with a cart standing by', () => {
        const deck = spec.features.find((f) => f.type === 'region' && f.sharp && f.texture === 'floor.wooden-planks' && f.level === 'ground');
        if (deck?.type !== 'region') {
            throw new Error('no porch');
        }
        // Against the west wall, where the front door is, two squares deep.
        const xs = deck.points.map((p) => p.x);
        expect([Math.min(...xs), Math.max(...xs)]).toEqual([inn.x - 2, inn.x]);
        const onDeck = spec.features.filter((f) => f.type === 'stamp' && f.x > inn.x - 2 && f.x < inn.x && f.level === 'ground');
        expect(onDeck.length).toBeGreaterThanOrEqual(3);
        // Stores stacked just outside the walls, and a cart.
        const stores = spec.features.filter((f) => f.type === 'stamp' && f.stamp === 'test:storage' && f.level === 'ground' && !inside(f));
        expect(stores.length).toBeGreaterThanOrEqual(4);
        expect(stampsOf('test:vehicle').length + stampsOf('test:hauler').length).toBeGreaterThanOrEqual(1);
    });

    it('stands a well in the yard before the inn, clear of its walls and of the road', () => {
        const [well] = stampsOf('test:well');
        if (well?.type !== 'stamp') {
            throw new Error('no well');
        }
        // Out in the front yard, past the porch (2 squares deep), not across the road.
        expect(well.x).toBeLessThan(inn.x - 2);
        expect(well.x).toBeGreaterThan(inn.x - 7);
        const roads = spec.features.filter((f) => f.type === 'path' && f.kind === 'road');
        expect(roads.every((r) => r.type === 'path' && distanceToPolyline(well, r.points) > (r.halfWidth ?? 0))).toBe(true);
    });
});
