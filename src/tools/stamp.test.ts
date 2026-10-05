// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { catalogStamps } from '../canvas/test-fakes';
import { deletePoint, movePoint } from './edit';
import { NO_DOCS } from './generated-docs';
import { featureHit } from './hit';
import { type Level, NO_LEVEL_ART } from './levels';
import { nthEntranceId, planDocuments, wayGaps, withoutGaps } from './plan';
import { behaviourOf, makeStamp, parseStamp, stampCorners, stampPoint, withReadsHidden, withStampFrame, withStampReads, withStampVariant } from './stamp';
import { DEFAULT_TRAVEL } from './submap';

const [lamp, crate] = catalogStamps([
    {
        id: 'lamp',
        name: 'Lamp',
        category: 'Lighting',
        scale: 'interior',
        perspective: 'top-down',
        light: { dim: 4, bright: 2 },
        variants: [
            { state: 'lit', image: 'stamps/lit.png', width: 100, height: 200 },
            { state: 'unlit', image: 'stamps/unlit.png', width: 50, height: 50, light: null },
        ],
    },
    {
        id: 'crate',
        name: 'Crate',
        category: 'Storage',
        scale: 'interior',
        perspective: 'top-down',
        container: true,
        variants: [{ state: 'shut', image: 'c.png', width: 100, height: 100 }],
    },
]);

function stampOf(stamp: typeof lamp, placement: Partial<Parameters<typeof makeStamp>[2]> = {}): ReturnType<typeof makeStamp> {
    if (!stamp) {
        throw new Error('missing fixture');
    }
    return makeStamp('s1', stamp, { stamp: stamp.key, x: 500, y: 500, ...placement }, 50);
}

describe('ways in', () => {
    // A shuttle 200 px square, walled round its box, with a ramp lowered from each side; raised in its second variant.
    const [shuttle] = catalogStamps([
        {
            id: 'shuttle',
            name: 'Shuttle',
            category: 'Vehicles',
            scale: 'exterior',
            perspective: 'top-down',
            occlusion: { shape: 'bounds', sight: true, movement: true },
            ways: [
                { kind: 'ramp', x: 0, y: 0.5, width: 0.3 },
                { kind: 'ramp', x: 1, y: 0.5, width: 0.3 },
            ],
            variants: [
                { state: 'landed', image: 'landed.png', width: 200, height: 200 },
                { state: 'ramps raised', image: 'raised.png', width: 200, height: 200, ways: null },
            ],
        },
    ]);
    const placed = (variant = 0): ReturnType<typeof makeStamp> => {
        if (!shuttle) {
            throw new Error('missing fixture');
        }
        return makeStamp('sh', shuttle, { stamp: shuttle.key, x: 500, y: 500, variant }, 100);
    };
    const context = { features: [], levels: [], terrainRegions: false, gridDistance: 5 };
    // Walls on the stamp's left side (x = 400): where the box's west wall runs.
    const leftWall = (variant: number) =>
        planDocuments(placed(variant), context).walls.filter((w) => Math.abs(w.a.x - 400) < 1e-6 && Math.abs(w.b.x - 400) < 1e-6);

    it('leave a gap in the walls at each ramp, so a token coming down it can walk off', () => {
        // Its west wall stands in two pieces, a ramp's width (0.3 of 200 px) open about its middle.
        const pieces = leftWall(0)
            .map((w) => [Math.min(w.a.y, w.b.y), Math.max(w.a.y, w.b.y)])
            .sort(([a = 0], [b = 0]) => a - b);
        expect(pieces).toEqual([
            [400, 470],
            [530, 600],
        ]);
        // With its ramps raised, the wall is whole.
        expect(leftWall(1)).toHaveLength(1);
    });

    it('are its entrances where it is linked to an interior: one teleport over each ramp', () => {
        const link = {
            scene: 'Interior00000001',
            sceneName: 'Shuttle',
            entryRegion: 'ShuttleEntry0001',
            exitRegion: 'ShuttleExit00001',
            travel: DEFAULT_TRAVEL,
        };
        const regions = planDocuments({ ...placed(0), submap: link }, context).regions.filter((r) => r.label.kind === 'entrance');
        // The first keeps the link's id; the second's is derived from it, never the same.
        expect(regions.map((r) => r.id)).toEqual(['ShuttleEntry0001', nthEntranceId('ShuttleEntry0001', 1)]);
        expect(regions[1]?.id).not.toBe('ShuttleEntry0001');
        expect(regions.every((r) => r.behaviour?.kind === 'teleport')).toBe(true);
        // Each a ramp's width square, about the ramp.
        expect(regions[0]?.polygon[0]).toEqual({ x: 370, y: 470 });
        // A stamp with no ramps drawn keeps one entrance over its whole footprint.
        expect(planDocuments({ ...placed(1), submap: link }, context).regions.filter((r) => r.label.kind === 'entrance')).toHaveLength(1);
    });

    it('open its traced body walls at each ramp too, where only its body bars movement', () => {
        const stamp = placed(0);
        const body = {
            ...stamp,
            silhouette: [
                [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                    { x: 1, y: 1 },
                    { x: 0, y: 1 },
                ],
            ],
            behaviour: { ...stamp.behaviour, occlusion: null, physical: { blocksMovement: true } },
        };
        const left = planDocuments(body, context).walls.filter((w) => Math.abs(w.a.x - 400) < 1e-6 && Math.abs(w.b.x - 400) < 1e-6);
        expect(left).toHaveLength(2);
    });

    it('leave a stamp saved before ways were kept whole', () => {
        const { ways: _, ...behaviour } = placed(0).behaviour;
        expect(wayGaps({ ...placed(0), behaviour })).toEqual([]);
    });
});

describe('withoutGaps', () => {
    const gap = { centre: { x: 5, y: 0 }, radius: 1 };
    const along = (a: number, b: number) => ({ a: { x: a, y: 0 }, b: { x: b, y: 0 } });

    it('cuts a gap out of a wall running through it', () => {
        expect(withoutGaps(along(0, 10), [gap])).toEqual([along(0, 4), along(6, 10)]);
    });

    it('keeps a wall the gap misses, or one only its line would cross', () => {
        const wide = { a: { x: 0, y: 3 }, b: { x: 10, y: 3 } };
        expect(withoutGaps(wide, [gap])).toEqual([wide]);
        expect(withoutGaps(along(0, 2), [gap])).toEqual([along(0, 2)]);
        expect(withoutGaps(along(1, 1), [gap])).toEqual([along(1, 1)]);
    });

    it('drops what lies inside the gap, leaving no sliver', () => {
        expect(withoutGaps(along(0, 5), [gap])).toEqual([along(0, 4)]);
        expect(withoutGaps(along(4.5, 5.5), [gap])).toEqual([]);
    });
});

describe('makeStamp', () => {
    it('scales the footprint to the scene grid and centres it on the point', () => {
        const s = stampOf(lamp);
        expect(s).toMatchObject({ type: 'stamp', stamp: 'pack:lamp', variant: 0, src: 'modules/pack/stamps/lit.png', width: 50, height: 100 });
        expect(s.points).toEqual([{ x: 500, y: 500 }]);
    });

    it('snaps, scales, rotates and elevates as requested', () => {
        const s = stampOf(lamp, { x: 510, y: 530, scale: 2, rotation: 90, elevation: 10, snap: true });
        expect(s.width).toBe(100);
        expect(s.height).toBe(200);
        // top-left (460, 430) snaps to (450, 450) → centre (500, 550)
        expect(s.points).toEqual([{ x: 500, y: 550 }]);
        expect(s.rotation).toBe(90);
        expect(s.elevation).toBe(10);
    });

    it('snapshots the behaviour of the chosen variant', () => {
        expect(stampOf(lamp).behaviour.light).toEqual({ dim: 4, bright: 2 });
        expect(stampOf(lamp, { variant: 1 }).behaviour.light).toBeNull();
        expect(crate ? behaviourOf(crate, 0).container : null).toBe(true);
    });
});

describe('behaviourOf physics', () => {
    const [shelf, walledOff, table, cleared] = catalogStamps([
        {
            id: 'shelf',
            name: 'Shelf',
            category: 'Furniture',
            scale: 'interior',
            perspective: 'top-down',
            tags: ['archive', 'shelf'],
            variants: [{ state: 'full', image: 's.png', width: 200, height: 50 }],
        },
        {
            id: 'open-shelf',
            name: 'Open Shelf',
            category: 'Furniture',
            scale: 'interior',
            perspective: 'top-down',
            tags: ['shelf'],
            occlusion: { shape: 'none' },
            variants: [{ state: 'full', image: 'o.png', width: 200, height: 50 }],
        },
        {
            id: 'table',
            name: 'Table',
            category: 'Furniture',
            scale: 'interior',
            perspective: 'top-down',
            tags: ['table'],
            variants: [{ state: 'set', image: 't.png', width: 150, height: 100 }],
        },
        {
            id: 'slab',
            name: 'Slab',
            category: 'Furniture',
            scale: 'interior',
            perspective: 'top-down',
            tags: ['table'],
            variants: [{ state: 'bare', image: 'b.png', width: 150, height: 100, terrain: null }],
        },
    ]);

    it('walls a tall piece and slows over a low one by its role, where its pack says nothing', () => {
        expect(shelf ? behaviourOf(shelf, 0).occlusion : null).toMatchObject({ shape: 'alpha', sight: 'limited', movement: true });
        const low = table ? behaviourOf(table, 0) : null;
        expect(low?.occlusion).toBeNull();
        expect(low?.physical).toEqual({ height: 0.5, cover: 0.5 });
        expect(low?.terrain).toEqual({ difficulty: { walk: 2 } });
    });

    it('keeps the pack’s own word over its role’s, a null included', () => {
        expect(walledOff ? behaviourOf(walledOff, 0).occlusion : undefined).toMatchObject({ shape: 'none' });
        expect(cleared ? behaviourOf(cleared, 0).terrain : undefined).toBeNull();
    });

    it('stands a piece for its drop shadow by its role, a shelf above a table, unless its pack says (null: flat)', () => {
        const shelfStands = shelf ? behaviourOf(shelf, 0).shadow : undefined;
        const tableStands = table ? behaviourOf(table, 0).shadow : undefined;
        expect(shelfStands).toBeGreaterThan(tableStands ?? 0);
        expect(tableStands).toBeGreaterThan(0);
        const [said, flat] = catalogStamps([
            {
                id: 'tall-table',
                name: 'Tall',
                category: 'Furniture',
                scale: 'interior',
                perspective: 'top-down',
                tags: ['table'],
                shadow: 1.2,
                variants: [{ state: 'set', image: 't.png', width: 150, height: 100 }],
            },
            {
                id: 'flat-table',
                name: 'Flat',
                category: 'Furniture',
                scale: 'interior',
                perspective: 'top-down',
                tags: ['table'],
                shadow: null,
                variants: [{ state: 'set', image: 't.png', width: 150, height: 100 }],
            },
        ]);
        expect(said ? behaviourOf(said, 0).shadow : undefined).toBe(1.2);
        expect(flat ? behaviourOf(flat, 0).shadow : 0).toBeUndefined();
    });

    it('makes a chest or a locker an Item Piles container where its pack never says; its pack’s false wins', () => {
        const piece = (id: string, tags: readonly string[], container?: boolean): Record<string, unknown> => ({
            id,
            name: id,
            category: 'Furniture',
            scale: 'interior',
            perspective: 'top-down',
            tags,
            ...(container === undefined ? {} : { container }),
            variants: [{ state: 'shut', image: `${id}.png`, width: 100, height: 60 }],
        });
        const [footlocker, locker, sealed, barrel] = catalogStamps([
            piece('footlocker', ['footlocker']),
            piece('locker', ['standing', 'locker']),
            piece('sealed', ['footlocker'], false),
            piece('barrel', ['barrel']),
        ]);
        expect(footlocker ? behaviourOf(footlocker, 0) : null).toMatchObject({ container: true, pile: { type: 'container' } });
        expect(locker ? behaviourOf(locker, 0).container : null).toBe(true);
        expect(sealed ? behaviourOf(sealed, 0) : null).toMatchObject({ container: false, pile: null });
        expect(barrel ? behaviourOf(barrel, 0).container : null).toBe(false);
    });
});

describe('variants and frames', () => {
    it('changes variant keeping centre, rotation and elevation', () => {
        const s = stampOf(lamp, { rotation: 45, elevation: 3 });
        const next = lamp ? withStampVariant({ ...s, docs: { ...NO_DOCS, tiles: ['t0'] } }, lamp, 1, 50) : null;
        expect(next).toMatchObject({ variant: 1, src: 'modules/pack/stamps/unlit.png', width: 25, height: 25, rotation: 45, elevation: 3 });
        expect(next?.points).toEqual(s.points);
        expect(next?.behaviour.light).toBeNull();
        expect(next?.docs.tiles).toEqual(['t0']);
    });

    it('keeps everything the stamp carries beyond what the variant decides: its switch links, pile and level', () => {
        const carried = { ...stampOf(lamp), switchTargets: [{ kind: 'light' as const, id: 'L1' }], pile: 'Scene.x.Token.y', level: 'lv1' };
        const next = lamp ? withStampVariant(carried, lamp, 1, 50) : null;
        expect(next).toMatchObject({ switchTargets: [{ kind: 'light', id: 'L1' }], pile: 'Scene.x.Token.y', level: 'lv1', variant: 1 });
    });

    it('stands a variant with an anchor on its placed point by that anchor, and keeps it there as variants switch', () => {
        // A ramp: raised, a plate centred in the wall; lowered, lying out from its hinge along the image's bottom edge.
        const [ramp] = catalogStamps([
            {
                id: 'ramp',
                name: 'Ramp',
                category: 'Doors',
                scale: 'interior',
                perspective: 'top-down',
                door: { type: 'door' },
                variants: [
                    { state: 'raised', image: 'raised.png', width: 300, height: 50, doorState: 'closed' },
                    { state: 'lowered', image: 'lowered.png', width: 300, height: 200, doorState: 'open', anchor: { x: 0.5, y: 1 } },
                ],
            },
        ]);
        if (!ramp) {
            throw new Error('missing fixture');
        }
        // At 50 px squares, turned half round as in a south wall: the lowered ramp's centre lies 50 px beyond the wall line.
        const lowered = makeStamp('r', ramp, { stamp: ramp.key, x: 500, y: 500, variant: 1, rotation: 180 }, 50);
        expect(lowered.points[0]?.x).toBeCloseTo(500);
        expect(lowered.points[0]?.y).toBeCloseTo(550);
        const raised = withStampVariant(lowered, ramp, 0, 50);
        expect(raised.points[0]?.x).toBeCloseTo(500);
        expect(raised.points[0]?.y).toBeCloseTo(500);
        // And back down again, from the hinge.
        expect(withStampVariant(raised, ramp, 1, 50).points[0]?.y).toBeCloseTo(550);
    });

    it('adopts a new frame', () => {
        const moved = withStampFrame(stampOf(lamp), { centre: { x: 1, y: 2 }, width: 3, height: 4, rotation: 5 });
        expect(moved).toMatchObject({ points: [{ x: 1, y: 2 }], width: 3, height: 4, rotation: 5 });
    });

    it('rotates the footprint corners about the centre', () => {
        const corners = stampCorners({ ...stampOf(lamp), rotation: 90 }).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
        expect(corners).toEqual([
            { x: 550, y: 475 },
            { x: 550, y: 525 },
            { x: 450, y: 525 },
            { x: 450, y: 475 },
        ]);
    });
});

describe('stamp editing and hits', () => {
    it('moves as a whole by its centre and cannot lose its only point', () => {
        const s = stampOf(lamp);
        expect(movePoint(s, 0, { x: 7, y: 8 })?.points).toEqual([{ x: 7, y: 8 }]);
        expect(deletePoint(s, 0)).toBeNull();
    });

    it('hits inside the rotated footprint only', () => {
        const s = { ...stampOf(lamp), rotation: 90 };
        expect(featureHit(s, { x: 540, y: 500 })).toBe(true);
        expect(featureHit(s, { x: 500, y: 540 })).toBe(false);
    });
});

describe('planDocuments for a stamp', () => {
    it('plans its tile from the unrotated top-left, owned by the feature', () => {
        const plan = planDocuments({ ...stampOf(lamp), rotation: 30, elevation: 2 });
        expect(plan.tiles).toEqual([
            {
                name: 'Lamp',
                src: 'modules/pack/stamps/lit.png',
                x: 475,
                y: 450,
                width: 50,
                height: 100,
                rotation: 30,
                elevation: 2,
                level: null,
                featureId: 's1',
                // A lamp stands middling tall for its drop shadow.
                shadow: 0.4,
            },
        ]);
    });
});

describe('a stamp on a level another sees', () => {
    it('shows its tile on the levels that see its own below them, and only there', () => {
        const band = (id: string, bottom: number, visibleLevels: string[] = []): Level => ({
            id,
            name: id,
            bottom,
            top: bottom + 10,
            art: { ...NO_LEVEL_ART, visibleLevels },
        });
        const levels = [band('ground', 0), band('upper', 10, ['ground']), band('cellar', -10)];
        const context = { features: [], levels, terrainRegions: false, gridDistance: 5 };
        expect(planDocuments({ ...stampOf(lamp), level: 'ground' }, context).tiles[0]?.seenFrom).toEqual(['upper']);
        expect(planDocuments({ ...stampOf(lamp), level: 'cellar' }, context).tiles[0]).not.toHaveProperty('seenFrom');
        expect(planDocuments(stampOf(lamp), context).tiles[0]).not.toHaveProperty('seenFrom');
    });
});

describe('a mirrored stamp', () => {
    it('is drawn flipped left to right, and what sits on its art flips with it', () => {
        const plain = stampOf(lamp);
        const mirrored = stampOf(lamp, { mirror: true });
        expect(plain.mirror).toBe(false);
        expect(mirrored.mirror).toBe(true);
        expect(planDocuments(plain).tiles[0]).not.toHaveProperty('mirror');
        expect(planDocuments(mirrored).tiles[0]?.mirror).toBe(true);
        // A point a quarter in from the art's left edge lies a quarter in from its right once mirrored (the lamp is 50 wide).
        expect(stampPoint(plain, { x: 0.25, y: 0.5 })).toEqual({ x: 487.5, y: 500 });
        expect(stampPoint(mirrored, { x: 0.25, y: 0.5 })).toEqual({ x: 512.5, y: 500 });
        expect(parseStamp(JSON.parse(JSON.stringify(mirrored)))?.mirror).toBe(true);
    });
});

describe('an inert stamp', () => {
    it('is drawn with none of its behaviour: another placement of it carries that', () => {
        const lit = planDocuments(stampOf(lamp));
        const inert = stampOf(lamp, { inert: true });
        expect(lit.lights.length).toBeGreaterThan(0);
        expect(inert.behaviour).toMatchObject({ light: null, occlusion: null, door: null, transition: null });
        expect(planDocuments(inert).lights).toEqual([]);
        expect(planDocuments(inert).tiles).toHaveLength(1);
    });
});

describe('a stamp players read', () => {
    it('reads nothing unless given words, and blanks are nothing', () => {
        expect(stampOf(lamp).reads).toBeNull();
        expect(stampOf(lamp, { reads: '   ' }).reads).toBeNull();
        expect(withStampReads(stampOf(lamp), 'OPEN').reads).toBe('OPEN');
        expect(withStampReads(stampOf(lamp, { reads: 'OPEN' }), null).reads).toBeNull();
        expect(planDocuments(stampOf(lamp)).notes).toEqual([]);
    });

    it('plans a readable Note at its centre on its floor, its hover spot as wide as it is long', () => {
        const plan = planDocuments({ ...stampOf(lamp, { reads: 'OPEN LATE' }), elevation: 2 });
        expect(plan.notes).toEqual([
            {
                x: 500,
                y: 500,
                elevation: 2,
                level: null,
                text: 'OPEN LATE',
                entry: null,
                page: null,
                icon: null,
                global: false,
                readable: true,
                size: 100,
                hidden: false,
            },
        ]);
    });

    it('hides its reading from players until the GM reveals it, when placed so', () => {
        const named = stampOf(lamp, { reads: 'The Antler Inn', readsHidden: true });
        expect(named.readsHidden).toBe(true);
        expect(planDocuments(named).notes).toEqual([expect.objectContaining({ text: 'The Antler Inn', readable: true, hidden: true })]);
        expect(planDocuments(withReadsHidden(named, false)).notes[0]?.hidden).toBe(false);
        expect(stampOf(lamp, { reads: 'OPEN' }).readsHidden).toBe(false);
    });

    it('keeps its hover spot at least as large as Foundry takes', () => {
        const small = { ...stampOf(lamp, { reads: 'x' }), width: 10, height: 12 };
        expect(planDocuments(small).notes[0]?.size).toBe(32);
    });
});

describe('planDocuments for a lit stamp', () => {
    it('emits the variant light at the centre, radii in px, following elevation', () => {
        const plan = planDocuments({ ...stampOf(lamp), elevation: 4 });
        expect(plan.lights).toEqual([{ source: { kind: 'stamp', name: 'Lamp' }, x: 500, y: 500, dim: 200, bright: 100, elevation: 4, level: null }]);
    });

    it('emits nothing for an unlit variant', () => {
        expect(planDocuments(stampOf(lamp, { variant: 1 })).lights).toEqual([]);
    });

    it('places an offset cone with the stamp rotated, styled as authored', () => {
        const s = {
            ...stampOf(lamp, { rotation: 90 }),
            behaviour: {
                ...stampOf(lamp).behaviour,
                light: { dim: 2, bright: 1, color: '#ff0000', alpha: 0.5, angle: 60, offset: { x: 1, y: 0.5 }, animation: { type: 'torch' } },
            },
        };
        const [light] = planDocuments(s).lights;
        // Offset to the right edge (+25 px); rotated 90° clockwise → straight down.
        expect(light?.x).toBeCloseTo(500);
        expect(light?.y).toBeCloseTo(525);
        expect(light).toMatchObject({ dim: 100, bright: 50, color: '#ff0000', alpha: 0.5, angle: 60, rotation: 90, animation: { type: 'torch' } });
    });
});

describe('stampPoint', () => {
    it('maps footprint fractions to world points', () => {
        expect(stampPoint(stampOf(lamp), { x: 0, y: 0 })).toEqual({ x: 475, y: 450 });
        expect(stampPoint(stampOf(lamp), { x: 0.5, y: 0.5 })).toEqual({ x: 500, y: 500 });
    });
});

describe('parseStamp', () => {
    it('defaults the grid size of a stamp persisted without one', () => {
        const { gridSize: _omitted, ...legacy } = stampOf(lamp);
        expect(parseStamp(legacy)?.gridSize).toBe(100);
    });

    it('keeps the pack name, and names a stamp saved without one after its id in the pack', () => {
        expect(parseStamp(stampOf(lamp))?.name).toBe('Lamp');
        const { name: _omitted, ...legacy } = stampOf(lamp);
        expect(parseStamp(legacy)?.name).toBe('lamp');
    });

    it('round-trips a placed stamp through JSON', () => {
        const s = stampOf(lamp, { rotation: 15, reads: 'Mind the step' });
        expect(parseStamp(JSON.parse(JSON.stringify(s)))).toEqual(s);
    });

    it('reads nothing on a stamp saved before stamps could be read, or with words of no kind', () => {
        const { reads: _omitted, ...legacy } = stampOf(lamp);
        expect(parseStamp(legacy)?.reads).toBeNull();
        expect(parseStamp({ ...legacy, reads: 7 })?.reads).toBeNull();
    });

    it('keeps a hidden reading through the scene flag, and a stamp saved before shows its reading', () => {
        const named = stampOf(lamp, { reads: 'The Antler Inn', readsHidden: true });
        expect(parseStamp(JSON.parse(JSON.stringify(named)))?.readsHidden).toBe(true);
        const { readsHidden: _omitted, ...legacy } = named;
        expect(parseStamp(legacy)?.readsHidden).toBe(false);
    });

    it('keeps a stamp with an unreadable behaviour, but inert', () => {
        const parsed = parseStamp({ ...stampOf(lamp), behaviour: { light: 'bright' } });
        expect(parsed?.behaviour.light).toBeNull();
        expect(parsed?.behaviour.container).toBe(false);
    });

    it('rejects entries without identity, image or footprint', () => {
        const s = stampOf(lamp);
        expect(parseStamp({ ...s, src: 3 })).toBeNull();
        expect(parseStamp({ ...s, width: 0 })).toBeNull();
        expect(parseStamp({ ...s, points: [] })).toBeNull();
        expect(parseStamp({ ...s, type: 'room' })).toBeNull();
    });
});
