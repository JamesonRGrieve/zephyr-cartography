// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseSceneSpec, type SceneSpec } from '../generate/spec';
import { distanceToPolyline, pointInPolygon } from '../geometry/hit';
import { composeMap, footprintOf } from './compose';
import { type MapIntent, parseMapIntent } from './intent';
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
        // The common room has its hearth and lamps; the store has nothing to light it.
        expect(rooms.find((r) => r.key === 'inn:common')?.lit).toBe(false);
        expect(rooms.find((r) => r.key === 'inn:store')?.lit).toBe(true);
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
    });

    it('centres a building placed nowhere in particular, and composes an interior alone on a bare scene', () => {
        const alone = intentOf({ width: 20, height: 14, ground: null, buildings: [{ width: 10, height: 6, rooms: [{ key: 'hall', purpose: 'hall' }] }] });
        expect(footprintOf({ at: undefined, width: 10, height: 6 }, alone)).toEqual({ x: 5, y: 4, w: 10, h: 6 });
        const { spec } = compose(alone);
        expect(spec.features.some((f) => f.type === 'region')).toBe(false);
        expect(spec.features.filter((f) => f.type === 'room')).toHaveLength(1);
    });
});
