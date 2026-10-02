// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseFeatures } from './feature';
import { planDocuments } from './plan';
import { DEFAULT_TRAVEL } from './submap';
import {
    absoluteCells,
    cellBlock,
    cellExtent,
    makeZone,
    NEW_ZONE,
    parseZone,
    parseZoneLink,
    reshapedZone,
    scaledZoneShape,
    shapeSizes,
    validZoneShape,
    withCurvature,
    withShapeSize,
    withZonePlace,
    withZoneSettings,
    zoneHit,
    zonePoint,
    zoneSettingsOf,
} from './zone';
import { ZONE_SHAPES, type ZoneShape } from './zone-shape';

const AT = { x: 1000, y: 500 };

describe('zones as ways to other maps', () => {
    const DOOR = 'DoorRegion000001';
    const TAVERN = { scene: 'TavernScene00001', region: 'TavernFrontDoor1' };

    it('keep their fixed region id and teleport whoever enters to the map they lead to', () => {
        const zone = {
            ...makeZone('z1', AT, { ...NEW_ZONE, shape: { kind: 'rectangle', width: 100, height: 100 } }),
            link: { region: DOOR, targets: [TAVERN], travel: DEFAULT_TRAVEL },
        };
        const [region] = planDocuments(zone, { features: [zone], levels: [], terrainRegions: false, gridDistance: 5 }).regions;
        expect(region).toMatchObject({ id: DOOR, behaviour: { kind: 'teleport', targets: [TAVERN] } });
    });

    it('persist their link, a way still to be linked included; a link naming no region of its own is dropped', () => {
        const linked = { ...makeZone('z1', AT), link: { region: DOOR, targets: [TAVERN], travel: DEFAULT_TRAVEL } };
        expect(parseZone(JSON.parse(JSON.stringify(linked)))?.link).toEqual(linked.link);
        expect(parseZoneLink({ region: DOOR })).toEqual({ region: DOOR, targets: [], travel: DEFAULT_TRAVEL });
        expect(parseZoneLink({ region: DOOR, targets: [{ scene: '', region: 'x' }, TAVERN] })?.targets).toEqual([TAVERN]);
        expect(parseZoneLink({ targets: [TAVERN] })).toBeNull();
        expect(parseZone(JSON.parse(JSON.stringify(makeZone('z2', AT))))).not.toHaveProperty('link');
    });
});

describe('zones', () => {
    it('start as a circle at the point placed, on no token', () => {
        const zone = makeZone('z1', AT);
        expect(zonePoint(zone)).toEqual(AT);
        expect(zoneSettingsOf(zone)).toEqual(NEW_ZONE);
        expect(zone).toMatchObject({ type: 'zone', level: null });
    });

    it('take only shapes Foundry takes: sizes positive, a ring inside its centre, a cone within its curvature', () => {
        expect(validZoneShape({ kind: 'circle', radius: 10 })).toBe(true);
        expect(validZoneShape({ kind: 'circle', radius: 0 })).toBe(false);
        expect(validZoneShape({ kind: 'ellipse', radiusX: 10, radiusY: Number.NaN })).toBe(false);
        expect(validZoneShape({ kind: 'ring', radius: 10, innerWidth: 11, outerWidth: 1 })).toBe(false);
        expect(validZoneShape({ kind: 'cone', radius: 10, angle: 120, curvature: 'flat' })).toBe(false);
        expect(validZoneShape({ kind: 'cone', radius: 10, angle: 180, curvature: 'semicircle' })).toBe(true);
        expect(validZoneShape({ kind: 'cone', radius: 10, angle: 360, curvature: 'round' })).toBe(true);
        const zone = makeZone('z1', AT);
        expect(withZoneSettings(zone, { ...NEW_ZONE, shape: { kind: 'line', length: 0, width: 4 } })).toBeNull();
        expect(withZoneSettings(zone, { ...NEW_ZONE, rotation: Number.POSITIVE_INFINITY })).toBeNull();
        expect(withZoneSettings(zone, { ...NEW_ZONE, name: 'Pit', attachedTo: 't1' })).toMatchObject({ name: 'Pit', attachedTo: 't1' });
    });

    it('resize one size at a time, refusing a size the shape lacks or Foundry would not take', () => {
        const ring: ZoneShape = { kind: 'ring', radius: 100, innerWidth: 20, outerWidth: 20 };
        expect(shapeSizes(ring)).toEqual({ radius: 100, innerWidth: 20, outerWidth: 20 });
        expect(withShapeSize(ring, 'outerWidth', 40)).toEqual({ ...ring, outerWidth: 40 });
        expect(withShapeSize(ring, 'innerWidth', 150)).toBeNull();
        expect(withShapeSize(ring, 'height', 10)).toBeNull();
    });

    it('narrow a cone’s spread to what a new curvature allows', () => {
        const cone = { kind: 'cone', radius: 100, angle: 150, curvature: 'round' } as const;
        expect(withCurvature(cone, 'flat')).toEqual({ ...cone, curvature: 'flat', angle: 90 });
        expect(withCurvature(cone, 'semicircle')).toEqual({ ...cone, curvature: 'semicircle' });
    });

    it('keep about the same size when the GM picks another kind', () => {
        const circle: ZoneShape = { kind: 'circle', radius: 100 };
        expect(ZONE_SHAPES.map((kind) => reshapedZone(kind, circle, 100))).toEqual([
            circle,
            { kind: 'ellipse', radiusX: 100, radiusY: 50 },
            { kind: 'ring', radius: 100, innerWidth: 25, outerWidth: 25 },
            { kind: 'cone', radius: 100, angle: 90, curvature: 'round' },
            { kind: 'line', length: 200, width: 25 },
            { kind: 'rectangle', width: 200, height: 200 },
            { kind: 'cells', size: 100, cells: cellBlock(2, 2) },
            { kind: 'emanation', radius: 100 },
        ]);
        expect(reshapedZone('circle', { kind: 'rectangle', width: 40, height: 80 }, null)).toEqual({ kind: 'circle', radius: 40 });
        expect(reshapedZone('circle', { kind: 'line', length: 60, width: 2 }, null)).toEqual({ kind: 'circle', radius: 30 });
        expect(reshapedZone('circle', { kind: 'ellipse', radiusX: 5, radiusY: 9 }, null)).toEqual({ kind: 'circle', radius: 9 });
        // Grid spaces want a square grid; back from them, a circle as wide as their block.
        expect(reshapedZone('cells', circle, null)).toEqual(circle);
        expect(reshapedZone('circle', { kind: 'cells', size: 50, cells: cellBlock(1, 3) }, null)).toEqual({ kind: 'circle', radius: 75 });
    });

    it('hold whole grid spaces from their own cell, each once, and move by whole cells', () => {
        expect(cellBlock(2, 3)).toEqual([
            { i: 0, j: 0 },
            { i: 0, j: 1 },
            { i: 0, j: 2 },
            { i: 1, j: 0 },
            { i: 1, j: 1 },
            { i: 1, j: 2 },
        ]);
        expect(
            cellExtent([
                { i: -1, j: 2 },
                { i: 1, j: 2 },
            ]),
        ).toEqual({ rows: 3, columns: 1 });
        expect(cellExtent([])).toEqual({ rows: 0, columns: 0 });
        const cells = {
            kind: 'cells',
            size: 100,
            cells: [
                { i: 0, j: 0 },
                { i: 1, j: 1 },
            ],
        } as const;
        expect(validZoneShape(cells)).toBe(true);
        expect(validZoneShape({ ...cells, cells: [] })).toBe(false);
        expect(
            validZoneShape({
                ...cells,
                cells: [
                    { i: 0, j: 0 },
                    { i: 0, j: 0 },
                ],
            }),
        ).toBe(false);
        expect(validZoneShape({ ...cells, cells: [{ i: 0.5, j: 0 }] })).toBe(false);
        expect(validZoneShape({ ...cells, size: 0 })).toBe(false);
        expect(shapeSizes(cells)).toEqual({});
        expect(withShapeSize(cells, 'size', 50)).toBeNull();
        expect(scaledZoneShape(cells, 2)).toEqual({ ...cells, size: 200 });
        // At (250, 130): row 1, column 2.
        expect(absoluteCells({ x: 250, y: 130 }, cells)).toEqual([
            { i: 1, j: 2 },
            { i: 2, j: 3 },
        ]);
        const zone = { ...makeZone('z', { x: 250, y: 130 }), shape: cells };
        expect([zoneHit(zone, { x: 299, y: 199 }), zoneHit(zone, { x: 350, y: 250 }), zoneHit(zone, { x: 350, y: 150 })]).toEqual([true, true, false]);
        expect(parseZone(JSON.parse(JSON.stringify(zone)))?.shape).toEqual(cells);
        expect(parseZone({ ...zone, shape: { ...cells, cells: [{ i: 'a', j: 0 }] } })).toBeNull();
    });

    it('scale every length, but not a cone’s angle', () => {
        expect(scaledZoneShape({ kind: 'cone', radius: 3, angle: 60, curvature: 'flat' }, 100)).toEqual({
            kind: 'cone',
            radius: 300,
            angle: 60,
            curvature: 'flat',
        });
        const shapes: ZoneShape[] = [
            { kind: 'circle', radius: 1 },
            { kind: 'ellipse', radiusX: 1, radiusY: 2 },
            { kind: 'ring', radius: 3, innerWidth: 1, outerWidth: 1 },
            { kind: 'line', length: 4, width: 1 },
            { kind: 'rectangle', width: 2, height: 3 },
        ];
        expect(shapes.map((shape) => scaledZoneShape(shape, 10))).toEqual([
            { kind: 'circle', radius: 10 },
            { kind: 'ellipse', radiusX: 10, radiusY: 20 },
            { kind: 'ring', radius: 30, innerWidth: 10, outerWidth: 10 },
            { kind: 'line', length: 40, width: 10 },
            { kind: 'rectangle', width: 20, height: 30 },
        ]);
    });

    it('are hit by their exact shape, turned by their rotation', () => {
        const at = (settings: Partial<typeof NEW_ZONE>) => ({ ...makeZone('z', AT), ...NEW_ZONE, ...settings });
        const off = (dx: number, dy: number) => ({ x: AT.x + dx, y: AT.y + dy });
        expect(zoneHit(at({}), off(149, 0))).toBe(true);
        expect(zoneHit(at({}), off(151, 0))).toBe(false);
        const ellipse = at({ shape: { kind: 'ellipse', radiusX: 100, radiusY: 20 }, rotation: 90 });
        expect([zoneHit(ellipse, off(0, 90)), zoneHit(ellipse, off(90, 0))]).toEqual([true, false]);
        const ring = at({ shape: { kind: 'ring', radius: 100, innerWidth: 10, outerWidth: 10 } });
        expect([zoneHit(ring, off(0, 0)), zoneHit(ring, off(105, 0)), zoneHit(ring, off(115, 0))]).toEqual([false, true, false]);
        const cone = at({ shape: { kind: 'cone', radius: 100, angle: 90, curvature: 'round' }, rotation: 180 });
        expect([zoneHit(cone, off(-50, 10)), zoneHit(cone, off(50, 0)), zoneHit(cone, off(-50, 60))]).toEqual([true, false, false]);
        const line = at({ shape: { kind: 'line', length: 100, width: 10 } });
        expect([zoneHit(line, off(50, 4)), zoneHit(line, off(-5, 0)), zoneHit(line, off(50, 6))]).toEqual([true, false, false]);
        const rectangle = at({ shape: { kind: 'rectangle', width: 100, height: 20 } });
        expect([zoneHit(rectangle, off(-45, 9)), zoneHit(rectangle, off(0, 11))]).toEqual([true, false]);
    });

    it('take an emanation’s radius about their point, and scale and read it back', () => {
        const aura = { ...makeZone('z', AT), shape: { kind: 'emanation', radius: 120 } } as const;
        expect([zoneHit(aura, { x: AT.x + 119, y: AT.y }), zoneHit(aura, { x: AT.x + 121, y: AT.y })]).toEqual([true, false]);
        expect(scaledZoneShape(aura.shape, 2)).toEqual({ kind: 'emanation', radius: 240 });
        expect(shapeSizes(aura.shape)).toEqual({ radius: 120 });
        expect(reshapedZone('circle', aura.shape, null)).toEqual({ kind: 'circle', radius: 120 });
        expect(parseZone(JSON.parse(JSON.stringify(aura)))?.shape).toEqual(aura.shape);
    });

    it('move with their token, keeping everything else', () => {
        const zone = makeZone('z', AT);
        expect(withZonePlace(zone, { x: 5, y: 6 }, 30)).toEqual({ ...zone, points: [{ x: 5, y: 6 }], rotation: 30 });
    });

    it('round-trip through the scene flag, with their area settings, and drop a malformed shape', () => {
        const zone = {
            ...makeZone('z', AT, {
                name: 'Flamer',
                shape: { kind: 'cone', radius: 300, angle: 60, curvature: 'flat' },
                rotation: 45,
                gridBased: true,
                attachedTo: 't1',
            }),
            movementCost: 2,
            effects: [{ kind: 'suppressWeather' }],
            level: 'L1',
        } as const;
        expect(parseFeatures(JSON.parse(JSON.stringify([zone])))).toEqual([zone]);
        expect(parseZone({ ...zone, shape: { kind: 'ring', radius: 5, innerWidth: 9, outerWidth: 1 } })).toBeNull();
        expect(parseZone({ ...zone, shape: { kind: 'hexagon' } })).toBeNull();
        expect(parseZone({ ...zone, points: [] })).toBeNull();
        expect(parseZone({ type: 'zone', id: 'z', points: [AT], shape: { kind: 'circle', radius: 5 } })).toMatchObject({
            name: '',
            rotation: 0,
            gridBased: false,
            attachedTo: null,
            shape: { kind: 'circle', radius: 5 },
        });
    });
});
