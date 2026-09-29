// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseSceneSpec, type RoomSpec, type SceneSpec } from '../generate/spec';
import { distanceToPolyline, pointInPolygon } from '../geometry/hit';
import type { StampRole } from '../stamps/schema';
import { composeMap, footprintOf } from './compose';
import { type MapIntent, parseMapIntent } from './intent';
import { PRESET_INTENTS } from './presets';
import type { ComposeProblem } from './problems';
import type { RoleIndex, RoleStamp } from './roles';
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
        // A shared wall's door belongs to one of its rooms, the other opening its side of the wall to it: one per connection (three), and the front door.
        const all = rooms.flatMap((room) => room.doors);
        expect(all.filter((d) => d.type === 'door')).toHaveLength(4);
        expect(all.filter((d) => d.type === 'opening')).toHaveLength(3);
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
        // Each upper storey sees the storeys below it, down to the ground (the yard round it); the ground sees none.
        expect(spec.levels.map((l) => l.visibleLevels)).toEqual([[], ['ground'], ['ground', 'floor-2']]);
        // Everything is on a level: outdoors and the ground floor on the ground.
        expect(spec.features.every((f) => f.level !== undefined)).toBe(true);
        const rooms = spec.features.flatMap((f) => (f.type === 'room' ? [f] : []));
        expect(new Set(rooms.map((r) => r.level))).toEqual(new Set(['ground', 'floor-2', 'floor-3']));
        // Room keys stay unique across floors.
        expect(new Set(rooms.map((r) => r.key)).size).toBe(rooms.length);
        const stairs = spec.features.flatMap((f) => (f.type === 'stamp' && f.stamp === 'test:stairs' ? [f] : []));
        // Each flight, and its steps seen again from the floor above where it arrives.
        expect(stairs.map((s) => s.level)).toEqual(['ground', 'floor-2', 'floor-2', 'floor-3']);
        const [first, firstFromAbove, second, secondFromAbove] = stairs;
        expect([firstFromAbove?.x, firstFromAbove?.y]).toEqual([first?.x, first?.y]);
        expect([secondFromAbove?.x, secondFromAbove?.y]).toEqual([second?.x, second?.y]);
        // Only the flights are ways between the floors: the steps seen from above are drawn, inert.
        expect(stairs.map((s) => s.inert === true)).toEqual([false, true, false, true]);
        // A switchback: the second flight beside the first (one stair's width on), so their ways between floors never overlap.
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
        // A role with a placeholder stands in as a labelled box; one without (the litter of a room) is left out. Each said once.
        expect(empty.problems).toContainEqual({ kind: 'placeholder', piece: 'tree', wantedIn: 'woodland' });
        expect(empty.problems).toContainEqual({ kind: 'placeholder', piece: 'table', wantedIn: 'inn/common' });
        expect(empty.problems).toContainEqual({ kind: 'no-stamp', role: 'clutter', wantedIn: 'inn/common' });
        expect(empty.problems.filter((p) => p.kind === 'placeholder' && p.piece === 'tree')).toHaveLength(1);
        // The boxes are drawn where the pieces stand: a rectangle with its role written across it.
        const shapes = empty.spec.features.filter((f) => f.type === 'shape' && f.kind === 'rectangle');
        const labels = empty.spec.features.filter((f) => f.type === 'label');
        expect(shapes.length).toBeGreaterThan(0);
        expect(labels.length).toBe(shapes.length);
        expect(labels.some((l) => l.text === 'table')).toBe(true);
        expect(empty.spec.features.some((f) => f.type === 'stamp' && f.stamp.startsWith('placeholder:'))).toBe(false);
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
        // Round a cellar's walls is the dark of the earth, never the scene's grey; the ground keeps its own look.
        expect((composeMap(deep, TEST_ROLES).spec.levels ?? []).map((l) => l.backgroundColor)).toEqual(['#0c0c0e', '#0c0c0e', undefined]);
    });

    it('sets a ladder drawn only as its hatch in the deck above, the way between the decks, a box where the ladder rises', () => {
        const ladder = TEST_ROLES.get('stairs')?.find((s) => s.key === 'test:ladder');
        if (!ladder) {
            throw new Error('the test roles have no ladder');
        }
        const hatch: RoleStamp = { ...ladder, key: 'test:hatch', tags: ['hatch'], climb: { kind: 'ladder', direction: 'down' } };
        const hatchOnly: RoleIndex = new Map<StampRole, readonly RoleStamp[]>([...TEST_ROLES, ['stairs', [hatch]]]);
        const ship = intentOf({
            buildings: [
                {
                    key: 'ship',
                    width: 10,
                    height: 8,
                    cellarAccess: 'ladder',
                    rooms: [{ key: 'deck', purpose: 'hall', entrance: true }],
                    cellars: [{ name: 'Engineering', rooms: [{ key: 'engines', purpose: 'storage' }] }],
                },
            ],
        });
        const { spec, problems } = composeMap(ship, hatchOnly);
        const hatches = spec.features.flatMap((f) => (f.type === 'stamp' && f.stamp === 'test:hatch' ? [f] : []));
        // In the deck above, working: never drawn inert, never a second time.
        expect(hatches.map((f) => [f.level, f.inert])).toEqual([['ground', undefined]]);
        // Right below it, on the deck it rises from, a box labelled for the ladder it wants.
        const [hatchway] = hatches;
        const box = spec.features.find((f) => f.type === 'label' && f.level === 'cellar-1' && f.x === hatchway?.x && f.y === hatchway.y);
        expect(box?.type === 'label' ? box.text.replace(/\s+/gu, ' ') : undefined).toBe('ladder up');
        expect(problems).toContainEqual({ kind: 'placeholder', piece: 'ladder up', wantedIn: 'ship/cellar' });
        expect(problems.some((p) => p.kind === 'stand-in')).toBe(false);
    });

    it('raises a platform on a level of its own above the ground, named for it, its stair on the ground', () => {
        const { spec, problems } = compose(
            intentOf({ ground: 'grassland', platforms: [{ name: 'Feed grate', rect: { x: 6, y: 4, w: 6, h: 3 }, stair: { side: 'bottom', at: 1 } }] }),
        );
        expect(problems.filter((p) => p.kind !== 'placeholder' && p.kind !== 'no-stamp')).toEqual([]);
        expect(spec.levels.map((l) => [l.key, l.name])).toEqual([
            ['ground', 'Ground floor'],
            ['floor-2', 'Feed grate'],
        ]);
        expect(spec.features.find((f) => f.type === 'room')?.level).toBe('floor-2');
        expect(spec.features.find((f) => f.type === 'stamp' && f.stamp === 'test:stairs')?.level).toBe('ground');
    });

    it('roofs over what an upper storey leaves of the footprint, never over a whole storey', () => {
        const withFloor = (rooms: readonly object[]) =>
            intentOf({
                ground: null,
                buildings: [
                    {
                        key: 'keep',
                        width: 10,
                        height: 8,
                        rooms: [{ key: 'hall', purpose: 'hall', entrance: true, rect: { x: 0, y: 0, w: 10, h: 8 } }],
                        floors: [{ name: 'Office', rooms }],
                    },
                ],
            });
        const roofs = (intent: MapIntent) => compose(intent).spec.features.filter((f) => f.type === 'region' && f.level === 'floor-2' && f.sharp);
        // An office and its landing over the back half: the front half is roof, the whole footprint laid under the rooms.
        const partial = roofs(
            withFloor([
                { key: 'landing', purpose: 'hall', rect: { x: 0, y: 0, w: 5, h: 4 }, opensTo: ['office'] },
                { key: 'office', purpose: 'office', rect: { x: 5, y: 0, w: 5, h: 4 } },
            ]),
        );
        expect(partial).toHaveLength(1);
        const [roof] = partial;
        expect(roof?.type === 'region' ? roof.points.length : 0).toBe(4);
        // A storey over the whole footprint needs none.
        expect(
            roofs(
                withFloor([
                    { key: 'landing', purpose: 'hall' },
                    { key: 'office', purpose: 'office' },
                ]),
            ),
        ).toEqual([]);
    });

    it('draws a named piece in the state it asks for: its art’s variant of that state', () => {
        const chest = TEST_ROLES.get('chest')?.[0];
        if (!chest) {
            throw new Error('the test roles have no chest');
        }
        const lockers: RoleIndex = new Map<StampRole, readonly RoleStamp[]>([...TEST_ROLES, ['chest', [{ ...chest, states: ['shut', 'ajar'] }]]]);
        const hold = intentOf({
            buildings: [
                {
                    key: 'hold',
                    width: 8,
                    height: 6,
                    rooms: [
                        {
                            key: 'bay',
                            purpose: 'storage',
                            entrance: true,
                            furnish: 'fixtures',
                            fixtures: [
                                { name: 'locker', role: 'chest', width: chest.width, height: chest.height, state: 'ajar', place: { corner: 'top-left' } },
                            ],
                        },
                    ],
                },
            ],
        });
        const [locker] = composeMap(hold, lockers).spec.features.flatMap((f) => (f.type === 'stamp' && f.stamp === chest.key ? [f] : []));
        expect(locker?.variant).toBe(1);
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
        // Up from its hall or its taproom, as an inn's stair climbs: never out of the kitchen or the pantry.
        const from = spec.features.find(
            (f) =>
                f.type === 'room' &&
                f.level === 'ground' &&
                stair?.type === 'stamp' &&
                pointInPolygon(
                    stair,
                    f.points.flatMap((p) => [p.x, p.y]),
                ),
        );
        expect(['inn:hall', 'inn:taproom']).toContain(from?.type === 'room' ? from.key : undefined);
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

describe('maps drawn to a brief', () => {
    const hall = { key: 'hall', purpose: 'hall', entrance: true, furnish: 'fixtures' };

    it('sets the void round a map in its backdrop colour, on the scene’s own floor or every storey', () => {
        const flat = composeMap(intentOf({ ground: null, backdrop: '#0c0c0e', buildings: [{ width: 6, height: 5, rooms: [hall] }] }), TEST_ROLES).spec;
        expect(flat.levels).toEqual([{ key: 'ground', name: 'Ground floor', existing: true, backgroundColor: '#0c0c0e' }]);
        const tall = composeMap(
            intentOf({ backdrop: '#101010', buildings: [{ width: 8, height: 6, rooms: [hall], floors: [{ rooms: [{ key: 'up', purpose: 'bedroom' }] }] }] }),
            TEST_ROLES,
        ).spec;
        expect((tall.levels ?? []).every((l) => l.backgroundColor === '#101010')).toBe(true);
        expect(composeMap(intentOf({ buildings: [{ width: 6, height: 5, rooms: [hall] }] }), TEST_ROLES).spec.levels).toEqual([]);
    });

    it('lays heavy masonry round a building, broken at its doorway by a threshold of its floor', () => {
        const { spec } = composeMap(
            intentOf({
                ground: null,
                buildings: [
                    {
                        at: { x: 4, y: 4 },
                        width: 8,
                        height: 6,
                        wallBand: 1,
                        frontDoorAt: 3,
                        frontDoorWidth: 2,
                        floor: 'floor.concrete',
                        wall: 'wall.stone',
                        rooms: [hall],
                    },
                ],
            }),
            TEST_ROLES,
        );
        const bands = spec.features.filter((f) => f.type === 'region' && f.sharp === true && f.texture === 'wall.stone');
        const threshold = spec.features.filter((f) => f.type === 'region' && f.sharp === true && f.texture === 'floor.concrete');
        // Top, left and right whole; the bottom in two either side of the double door.
        expect(bands).toHaveLength(5);
        expect(threshold).toHaveLength(1);
        const [door] = threshold;
        expect(door?.type === 'region' && door.points.map((p) => p.x)).toEqual([7, 9, 9, 7]);
    });

    it('cuts a room’s corners into an octagon, the corners masonry where another room wraps them and void where none does', () => {
        const chamber = { key: 'chamber', purpose: 'chapel', rect: { x: 4, y: 2, w: 8, h: 6 }, chamfer: 2, furnish: 'fixtures' };
        const lone = composeMap(
            intentOf({ ground: null, buildings: [{ width: 16, height: 10, rooms: [{ ...chamber, rect: { x: 0, y: 0, w: 16, h: 10 }, entrance: true }] }] }),
            TEST_ROLES,
        ).spec;
        const room = lone.features.find((f) => f.type === 'room');
        // Its corners cut: no point of its outline at a corner of its box.
        const corners = [
            [0, 0],
            [16, 0],
            [16, 10],
            [0, 10],
        ];
        expect(room?.type === 'room' && room.points.some((p) => corners.some(([x, y]) => p.x === x && p.y === y))).toBe(false);
        expect(lone.features.some((f) => f.type === 'region')).toBe(false);
        const wrapped = composeMap(
            intentOf({
                ground: null,
                buildings: [
                    {
                        width: 16,
                        height: 10,
                        rooms: [
                            { key: 'ring-top', purpose: 'hall', rect: { x: 0, y: 0, w: 16, h: 2 }, entrance: true, opensTo: ['chamber'] },
                            { key: 'ring-bottom', purpose: 'hall', rect: { x: 0, y: 8, w: 16, h: 2 } },
                            { key: 'ring-left', purpose: 'hall', rect: { x: 0, y: 2, w: 4, h: 6 }, archTo: ['ring-top', 'ring-bottom'] },
                            { key: 'ring-right', purpose: 'hall', rect: { x: 12, y: 2, w: 4, h: 6 }, archTo: ['ring-top', 'ring-bottom'] },
                            chamber,
                        ],
                    },
                ],
            }),
            TEST_ROLES,
        ).spec;
        expect(wrapped.features.filter((f) => f.type === 'region' && f.sharp === true && f.points.length === 3)).toHaveLength(4);
    });

    it('cuts only the corners a chamfer names: a hull tapered at its bow and blunt at its stern, its decks meeting square', () => {
        const { spec } = composeMap(
            intentOf({
                ground: null,
                buildings: [
                    {
                        width: 10,
                        height: 16,
                        entrance: 'south',
                        rooms: [
                            {
                                key: 'bow',
                                purpose: 'hall',
                                rect: { x: 0, y: 0, w: 10, h: 8 },
                                chamfer: 2,
                                chamferAt: ['top-left', 'top-right'],
                                opensTo: ['stern'],
                            },
                            {
                                key: 'stern',
                                purpose: 'hall',
                                rect: { x: 0, y: 8, w: 10, h: 8 },
                                chamfer: 2,
                                chamferAt: ['bottom-right', 'bottom-left'],
                                entrance: true,
                            },
                        ],
                    },
                ],
            }),
            TEST_ROLES,
        );
        const outline = (key: string): readonly { x: number; y: number }[] => {
            const room = spec.features.find((f) => f.type === 'room' && f.key?.endsWith(`:${key}`) === true);
            return room?.type === 'room' ? room.points : [];
        };
        // Where the building stands on the map: the hull's left and its bow's front.
        const left = Math.min(...outline('bow').map((p) => p.x));
        const front = Math.min(...outline('bow').map((p) => p.y));
        const has = (key: string, x: number, y: number): boolean => outline(key).some((p) => p.x === left + x && p.y === front + y);
        // The bow's front corners cut, its back ones square where it meets the stern.
        expect([has('bow', 0, 0), has('bow', 10, 0), has('bow', 10, 8), has('bow', 0, 8)]).toEqual([false, false, true, true]);
        expect([has('stern', 0, 8), has('stern', 10, 8), has('stern', 10, 16), has('stern', 0, 16)]).toEqual([true, true, false, false]);
        // Every cut corner faces the void: no masonry wedge pinches the hull between the decks.
        expect(spec.features.some((f) => f.type === 'region' && f.sharp === true && f.points.length === 3)).toBe(false);
    });

    it('stands a map’s named pieces outside where asked, faced as asked, and paves hard standing crisp over the paths', () => {
        const { spec, problems } = composeMap(
            intentOf({
                zones: [
                    {
                        kind: 'paving',
                        texture: 'floor.concrete',
                        area: {
                            shape: 'polygon',
                            points: [
                                { x: 2, y: 2 },
                                { x: 8, y: 2 },
                                { x: 8, y: 6 },
                                { x: 2, y: 6 },
                            ],
                        },
                    },
                ],
                paths: [{ kind: 'road', from: 'west', to: 'east', meander: 0 }],
                fixtures: [{ name: 'statue plinth', width: 3, height: 3, at: { x: 15, y: 10 }, facing: 'left' }],
            }),
            TEST_ROLES,
        );
        // No art draws it: its labelled box stands there, turned to face left.
        expect(spec.features).toContainEqual(expect.objectContaining({ type: 'shape', kind: 'rectangle', x: 15, y: 10, width: 3, height: 3, rotation: 90 }));
        expect(problems).toContainEqual({ kind: 'placeholder', piece: 'statue plinth', wantedIn: 'outside' });
        const paving = spec.features.findIndex((f) => f.type === 'region' && f.texture === 'floor.concrete' && f.sharp === true);
        const road = spec.features.findIndex((f) => f.type === 'path');
        expect(paving).toBeGreaterThan(road);
        // Soft paving (standing water, a stain) feathers its edge.
        const soft = composeMap(
            intentOf({ zones: [{ kind: 'paving', soft: true, texture: 'floor.mud', area: { shape: 'circle', centre: { x: 10, y: 10 }, radius: 2 } }] }),
            TEST_ROLES,
        ).spec;
        expect(soft.features.some((f) => f.type === 'region' && f.texture === 'floor.mud' && f.sharp !== true)).toBe(true);
    });

    it('hangs only door art carrying one of the building’s door tags; with none, its rooms draw their doors, animated as the building asks', () => {
        const seat = TEST_ROLES.get('seat')?.[0];
        if (!seat) {
            throw new Error('test seat');
        }
        const oak = { ...seat, key: 'test:oak-door', role: 'door' as const, tags: ['oak'], width: 1, height: 0.3, doorStates: { closed: 0 } };
        const roles = new Map([...TEST_ROLES, ['door' as const, [oak]]]);
        const tagged = (doorTags: string[]): ReturnType<typeof composeMap>['spec'] =>
            composeMap(
                intentOf({
                    ground: null,
                    buildings: [
                        {
                            width: 8,
                            height: 6,
                            doorTags,
                            doorAnimation: 'slide',
                            rooms: [
                                { key: 'a', purpose: 'hall', entrance: true, furnish: 'fixtures', grime: 0 },
                                { key: 'b', purpose: 'hall', opensTo: ['a'], furnish: 'fixtures', grime: 0 },
                            ],
                        },
                    ],
                }),
                roles,
            ).spec;
        expect(tagged(['oak']).features.some((f) => f.type === 'stamp' && f.stamp === 'test:oak-door')).toBe(true);
        const iron = tagged(['iron']);
        expect(iron.features.some((f) => f.type === 'stamp' && f.stamp === 'test:oak-door')).toBe(false);
        const doors = iron.features.flatMap((f) => (f.type === 'room' ? f.doors ?? [] : []));
        expect(doors.length).toBeGreaterThan(0);
        // Each door slides as the building asks; the other side of a door between rooms is an opening, the door being drawn once.
        const hinged = doors.filter((d) => typeof d === 'object' && d.type === 'door');
        expect(hinged.length).toBeGreaterThan(0);
        expect(hinged.every((d) => typeof d === 'object' && d.animation === 'slide')).toBe(true);
    });

    it('hangs door art in each doorway as wide as it, in the state it stands in, the room keeping its wall there; an archway stays bare', () => {
        const seat = TEST_ROLES.get('seat')?.[0];
        if (!seat) {
            throw new Error('test seat');
        }
        const door = { ...seat, key: 'test:door', role: 'door' as const, width: 1, height: 0.3, doorStates: { closed: 0, open: 1 } };
        const roles = new Map([...TEST_ROLES, ['door' as const, [door]]]);
        const { spec } = composeMap(
            intentOf({
                ground: null,
                buildings: [
                    {
                        at: { x: 0, y: 0 },
                        width: 12,
                        height: 6,
                        frontDoorAt: 2,
                        rooms: [
                            { key: 'a', purpose: 'hall', rect: { x: 0, y: 0, w: 6, h: 6 }, entrance: true, furnish: 'fixtures', grime: 0 },
                            {
                                key: 'b',
                                purpose: 'hall',
                                rect: { x: 6, y: 0, w: 6, h: 3 },
                                opensTo: ['a'],
                                doorOpen: true,
                                doorAt: 0,
                                furnish: 'fixtures',
                                grime: 0,
                            },
                            { key: 'c', purpose: 'hall', rect: { x: 6, y: 3, w: 6, h: 3 }, archTo: ['a'], furnish: 'fixtures', grime: 0 },
                        ],
                    },
                ],
            }),
            roles,
        );
        const doors = spec.features.filter((f) => f.type === 'stamp' && f.stamp === 'test:door');
        // The front door, shut, across the bottom wall at its doorway; b's, open, in the wall it shares with a. None in c's arch.
        expect(doors).toContainEqual(expect.objectContaining({ x: 2.5, y: 6, rotation: 180, variant: 0, scale: 1 }));
        expect(doors).toContainEqual(expect.objectContaining({ x: 6, y: 0.5, variant: 1 }));
        expect(doors).toHaveLength(2);
        // The hung doorways are wall in the rooms' own outlines; the arch opens both rooms' sides of the wall.
        const roomA = spec.features.find((f) => f.type === 'room' && f.key?.endsWith(':a') === true);
        expect(roomA?.type === 'room' && (roomA.doors ?? []).map((d) => d.type)).toEqual(['opening']);
        const roomC = spec.features.find((f) => f.type === 'room' && f.key?.endsWith(':c') === true);
        expect(roomC?.type === 'room' && (roomC.doors ?? []).map((d) => d.type)).toEqual(['opening']);
    });

    it('lets players read a named piece’s words on hover, over its art or its box', () => {
        const { spec } = composeMap(
            intentOf({
                width: 20,
                height: 20,
                fixtures: [
                    { name: 'shop sign', width: 2, height: 1, at: { x: 5, y: 5 }, reads: 'OPEN LATE' },
                    { name: 'clerk desk', role: 'desk', width: 1.5, height: 0.75, at: { x: 12, y: 12 }, reads: 'Tithe clerk — knock once' },
                ],
            }),
            TEST_ROLES,
        );
        // No art draws the sign: a readable pin over its box.
        expect(spec.features).toContainEqual(expect.objectContaining({ type: 'pin', x: 5, y: 5, text: 'OPEN LATE', readable: true }));
        // Art draws the desk: the stamp reads.
        expect(spec.features).toContainEqual(expect.objectContaining({ type: 'stamp', reads: 'Tithe clerk — knock once' }));
    });

    it('hides a secret door in both rooms’ walls: a native secret door, wall to look at from either side', () => {
        const { spec } = composeMap(
            intentOf({
                ground: null,
                buildings: [
                    {
                        at: { x: 0, y: 0 },
                        width: 12,
                        height: 6,
                        rooms: [
                            { key: 'crypt', purpose: 'hall', rect: { x: 0, y: 0, w: 6, h: 6 }, entrance: true, furnish: 'fixtures', grime: 0 },
                            { key: 'vault', purpose: 'storage', rect: { x: 6, y: 0, w: 6, h: 6 }, secretTo: ['crypt'], furnish: 'fixtures', grime: 0 },
                        ],
                    },
                ],
            }),
            TEST_ROLES,
        );
        const room = (key: string): RoomSpec | undefined => spec.features.find((f): f is RoomSpec => f.type === 'room' && f.key?.endsWith(`:${key}`) === true);
        const shared = (r: RoomSpec | undefined): string[] => (r?.doors ?? []).filter((d) => r?.points[d.segment]?.x === 6).map((d) => d.type);
        expect(shared(room('vault'))).toEqual(['secret']);
        expect(shared(room('crypt'))).toEqual(['secret']);
    });

    it('opens a door between two rooms in both their walls: the door in the one that has it, an opening in the other’s', () => {
        const { spec } = composeMap(
            intentOf({
                ground: null,
                buildings: [
                    {
                        at: { x: 0, y: 0 },
                        width: 12,
                        height: 6,
                        rooms: [
                            { key: 'a', purpose: 'hall', rect: { x: 0, y: 0, w: 6, h: 6 }, entrance: true, furnish: 'fixtures', grime: 0 },
                            { key: 'b', purpose: 'hall', rect: { x: 6, y: 0, w: 6, h: 6 }, opensTo: ['a'], doorAt: 0.5, furnish: 'fixtures', grime: 0 },
                        ],
                    },
                ],
            }),
            TEST_ROLES,
        );
        const room = (key: string): RoomSpec | undefined => spec.features.find((f): f is RoomSpec => f.type === 'room' && f.key?.endsWith(`:${key}`) === true);
        const sharedDoors = (r: RoomSpec | undefined): string[] =>
            (r?.doors ?? []).filter((d) => r?.points[d.segment]?.x === 6).map((d) => `${d.type}:${d.state}`);
        expect(sharedDoors(room('b'))).toEqual(['door:closed']);
        expect(sharedDoors(room('a'))).toEqual(['opening:open']);
    });

    it('darkens the scene for dim or night lighting, never with the global light, and leaves it be by day', () => {
        const scene = (lighting: string): SceneSpec['scene'] => {
            const parsed = parseSceneSpec(composeMap(intentOf({ lighting }), TEST_ROLES).spec);
            return parsed.ok ? parsed.spec.scene : undefined;
        };
        expect(scene('dim')).toMatchObject({ darkness: 0.55, globalLight: false });
        expect(scene('night')).toMatchObject({ darkness: 0.85, globalLight: false });
        expect(scene('day')).toBeUndefined();
    });

    it('keeps the outdoors on its own random stream: rearranging a room never replants the woods', () => {
        const woods = (rooms: object[]): unknown[] =>
            composeMap(
                intentOf({
                    seed: 5,
                    zones: [{ kind: 'woodland', area: { shape: 'everywhere' } }],
                    buildings: [{ at: { x: 12, y: 8 }, width: 8, height: 6, rooms }],
                }),
                TEST_ROLES,
            ).spec.features.filter((f) => f.type === 'stamp' && f.stamp === 'test:tree');
        expect(woods([{ key: 'a', purpose: 'bedroom', entrance: true }])).toEqual(woods([{ key: 'a', purpose: 'kitchen', entrance: true }]));
    });

    it('composes a curtain wall with its moat, a district and hewn passages on one map, each drawn as its own', () => {
        const kinds = (given: object): Record<string, number> => {
            const counts: Record<string, number> = {};
            for (const f of composeMap(intentOf({ width: 60, height: 40, ...given }), TEST_ROLES).spec.features) {
                const key = f.type === 'region' ? `region:${f.biome}` : f.type === 'room' ? `room:${f.floor ?? ''}` : f.type;
                counts[key] = (counts[key] ?? 0) + 1;
            }
            return counts;
        };
        const square = [
            { x: 8, y: 8 },
            { x: 24, y: 8 },
            { x: 24, y: 24 },
            { x: 8, y: 24 },
        ];
        // Four runs of wall and four corner towers in the wall's own masonry, and the moat's still water round them.
        expect(kinds({ curtains: [{ points: square, moat: {} }] })).toMatchObject({ 'room:wall.stone': 8, 'region:water': 1 });
        expect(kinds({ curtains: [{ points: square }] })).not.toHaveProperty(['region:water']);
        // The district's blocks are walled roofs; the hewn passage is a ragged room of rubble.
        expect(kinds({ districts: [{ area: { x: 32, y: 2, w: 26, h: 20 } }] })['room:floor.deck-plating']).toBeGreaterThan(1);
        const tunnel = {
            passages: [
                {
                    points: [
                        { x: 32, y: 30 },
                        { x: 56, y: 30 },
                    ],
                    width: 2,
                },
            ],
        };
        expect(kinds({ hewn: [tunnel] })).toMatchObject({ 'room:floor.rubble': 1 });
    });

    it('carries a named piece’s words onto its art, reports a porch’s missing art, and builds no porch with no front door', () => {
        const building = (over: object): object => ({
            key: 'shop',
            width: 8,
            height: 6,
            porch: 2,
            rooms: [
                {
                    key: 'front',
                    purpose: 'storage',
                    entrance: true,
                    furnish: 'fixtures',
                    fixtures: [{ name: 'shop sign', role: 'seat', width: 0.6, height: 0.6, reads: 'OPEN', place: { centre: true } }],
                },
            ],
            ...over,
        });
        const noBenches = new Map([...TEST_ROLES].filter(([role]) => role !== 'bench'));
        const { spec, problems } = composeMap(intentOf({ ground: null, buildings: [building({})] }), noBenches);
        expect(spec.features.some((f) => f.type === 'stamp' && f.reads === 'OPEN')).toBe(true);
        expect(problems.some((p) => 'wantedIn' in p && p.wantedIn === 'shop/porch')).toBe(true);
        // With no way in at ground level there is no front door to stand a porch at.
        const shut = composeMap(intentOf({ ground: null, buildings: [building({ frontDoor: false })] }), noBenches);
        expect(shut.problems.some((p) => 'wantedIn' in p && p.wantedIn === 'shop/porch')).toBe(false);
    });

    it('reports a room’s named pieces no art draws, and those with no room where asked', () => {
        const { problems } = composeMap(
            intentOf({
                buildings: [
                    {
                        key: 'hut',
                        width: 6,
                        height: 5,
                        rooms: [
                            {
                                key: 'room',
                                purpose: 'storage',
                                entrance: true,
                                furnish: 'fixtures',
                                fixtures: [
                                    { name: 'strange engine', width: 1, height: 1, place: { centre: true } },
                                    { name: 'vast vat', role: 'storage', width: 30, height: 30, place: { centre: true } },
                                ],
                            },
                        ],
                    },
                ],
            }),
            TEST_ROLES,
        );
        expect(problems).toContainEqual({ kind: 'placeholder', piece: 'strange engine', wantedIn: 'hut/room' });
        expect(problems).toContainEqual({ kind: 'no-room', piece: 'vast vat', wantedIn: 'hut/room' });
    });
});
