// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { DEFAULT_FLOOR_PLAN, generateFloorPlan } from '../generate/floor-plan';
import { parseSceneSpec, type SceneSpec } from '../generate/spec';
import { DEFAULT_AREA_DISPLAY } from '../tools/area-effects';
import { areaSettingsOf, isArea } from '../tools/areas';
import type { WallDoc } from '../tools/documents';
import { NO_LEVEL_ART } from '../tools/levels';
import { LIQUID_LOOKS } from '../tools/path';
import { NO_SPAWN } from '../tools/spawn';
import { realizeSpec } from './realize';
import { catalogStamps, makeHarness, SWITCH_STAMPS } from './test-fakes';

type Harness = ReturnType<typeof makeHarness>;

const GRID = 100;
const ORIGIN = { x: 1000, y: 500 };

const stamps = catalogStamps([
    {
        id: 'hab',
        name: 'Hab Block',
        category: 'Structures',
        scale: 'city',
        perspective: 'top-down',
        enterable: true,
        variants: [{ state: 'intact', image: 'hab.png', width: 200, height: 100 }],
    },
]);

function spec(raw: object): SceneSpec {
    const result = parseSceneSpec({ schemaVersion: 1, ...raw });
    if (!result.ok) {
        throw new Error(JSON.stringify(result.issues));
    }
    return result.spec;
}

/** Every wall the scene's features currently own. */
function liveWalls(h: Harness): WallDoc[] {
    const all = h.d.walls.flat();
    const owned = new Set(h.s.last().flatMap((f) => f.docs.walls));
    return all.filter((_, i) => owned.has(`w${i}`));
}

/** Axis-aligned walls as intervals on their lines, for overlap checks. */
function intervals(walls: readonly WallDoc[]): Map<string, [number, number][]> {
    const lines = new Map<string, [number, number][]>();
    for (const w of walls) {
        const vertical = w.a.x === w.b.x;
        const key = vertical ? `x${w.a.x}` : `y${w.a.y}`;
        const lo = vertical ? Math.min(w.a.y, w.b.y) : Math.min(w.a.x, w.b.x);
        const hi = vertical ? Math.max(w.a.y, w.b.y) : Math.max(w.a.x, w.b.x);
        lines.set(key, [...(lines.get(key) ?? []), [lo, hi]]);
    }
    return lines;
}

describe('realizeSpec', () => {
    it('builds a generated floor plan as rooms with one-square doors and no doubled walls', async () => {
        const h = makeHarness();
        const plan = generateFloorPlan(DEFAULT_FLOOR_PLAN);
        const report = await realizeSpec(h.c, plan, { origin: ORIGIN, gridSize: GRID });
        expect(report.problems).toEqual([]);
        expect(report.features).toHaveLength(plan.features.length);

        const walls = liveWalls(h);
        const doors = walls.filter((w) => w.door !== 'none');
        const doorCount = plan.features.reduce((n, f) => n + (f.type === 'room' ? f.doors.length : 0), 0);
        expect(doors).toHaveLength(doorCount);
        for (const door of doors) {
            expect(Math.hypot(door.b.x - door.a.x, door.b.y - door.a.y)).toBe(GRID);
        }
        for (const spans of intervals(walls).values()) {
            const sorted = [...spans].sort((a, b) => a[0] - b[0]);
            sorted.slice(1).forEach((span, i) => {
                expect(span[0]).toBeGreaterThanOrEqual(sorted[i]?.[1] ?? -Infinity);
            });
        }
        // The outer wall is closed all round, apart from the entrance door, which is still a wall document.
        const { width, height } = DEFAULT_FLOOR_PLAN;
        const outer = walls.filter(
            (w) =>
                (w.a.x === w.b.x && (w.a.x === ORIGIN.x || w.a.x === ORIGIN.x + width * GRID)) ||
                (w.a.y === w.b.y && (w.a.y === ORIGIN.y || w.a.y === ORIGIN.y + height * GRID)),
        );
        expect(outer.reduce((sum, w) => sum + Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), 0)).toBe(2 * (width + height) * GRID);
    });

    it('is one undo step, and each of building, undoing and redoing is one atomic write', async () => {
        const h = makeHarness();
        const report = await realizeSpec(h.c, generateFloorPlan(DEFAULT_FLOOR_PLAN), { origin: ORIGIN, gridSize: GRID });
        expect(report.features.length).toBeGreaterThan(1);
        expect(h.d.writes).toHaveLength(1);
        // Rooms re-synced by a later neighbour in the same build cancel their earlier creates rather than deleting.
        expect(h.d.deletedIds()).toEqual([]);
        await h.c.undo();
        expect(h.d.writes).toHaveLength(2);
        expect(h.s.last()).toEqual([]);
        expect(liveWalls(h)).toEqual([]);
        await h.c.redo();
        expect(h.d.writes).toHaveLength(3);
        expect(h.s.last()).toHaveLength(report.features.length);
    });

    it('scales grid units, keeps px as given, and applies default widths', async () => {
        const h = makeHarness();
        await realizeSpec(
            h.c,
            spec({
                features: [
                    {
                        type: 'region',
                        biome: 'forest',
                        points: [
                            { x: 0, y: 0 },
                            { x: 2, y: 0 },
                            { x: 2, y: 2 },
                        ],
                    },
                    {
                        type: 'path',
                        kind: 'road',
                        points: [
                            { x: 0, y: 0 },
                            { x: 3, y: 0 },
                        ],
                        halfWidth: 0.5,
                    },
                    {
                        type: 'stroke',
                        biome: 'sand',
                        texture: 'floor.cobbled-street',
                        points: [
                            { x: 0, y: 0 },
                            { x: 1, y: 1 },
                        ],
                    },
                ],
            }),
            { origin: ORIGIN, gridSize: GRID },
        );
        const [region, path, stroke] = h.s.last();
        expect(region?.points[1]).toEqual({ x: 1200, y: 500 });
        expect(path?.type === 'path' ? path.halfWidths : null).toEqual([50, 50]);
        expect(stroke?.type === 'stroke' ? stroke.radius : null).toBe(25);
        // Ground takes a texture of its own; without one it draws in its biome's.
        expect(stroke?.type === 'stroke' ? stroke.texture : null).toBe('floor.cobbled-street');
        expect(region?.type === 'region' ? region.texture : 'none').toBeNull();

        const px = makeHarness();
        await realizeSpec(
            px.c,
            spec({
                units: 'px',
                features: [
                    {
                        type: 'path',
                        kind: 'river',
                        points: [
                            { x: 0, y: 0 },
                            { x: 30, y: 0 },
                        ],
                        halfWidth: 7,
                    },
                ],
            }),
            {
                origin: { x: 0, y: 0 },
                gridSize: GRID,
            },
        );
        const river = px.s.last()[0];
        expect(river?.points[1]).toEqual({ x: 30, y: 0 });
        expect(river?.type === 'path' ? river.halfWidths : null).toEqual([7, 7]);
        expect(river?.type === 'path' ? river.river : null).toEqual(LIQUID_LOOKS.water);
    });

    it('builds a river of any liquid, in its shade and on its bed, each defaulting to the liquid’s own', async () => {
        const h = makeHarness();
        const line = [
            { x: 0, y: 0 },
            { x: 3, y: 0 },
        ];
        await realizeSpec(
            h.c,
            spec({
                features: [
                    { type: 'path', kind: 'river', points: line, liquid: 'acid', shade: '#00FF00', bed: null },
                    { type: 'path', kind: 'river', points: line, liquid: 'lava' },
                    { type: 'path', kind: 'road', points: line, liquid: 'lava' },
                ],
            }),
            { origin: ORIGIN, gridSize: GRID },
        );
        expect(h.s.last().map((f) => (f.type === 'path' ? f.river : undefined))).toEqual([
            { liquid: 'acid', shade: 0x00ff00, bed: null },
            LIQUID_LOOKS.lava,
            null,
        ]);
    });

    it('sets the scene’s own settings, only those given, and none when the spec has none', async () => {
        const h = makeHarness();
        const scene = {
            darkness: 0.8,
            fog: 'shared',
            fogColours: { unexplored: '#101820' },
            cycle: true,
            dark: { hue: 0.7, intensity: 0.5 },
            transition: { type: 'fade' },
        };
        await realizeSpec(h.c, spec({ scene, features: [] }), { origin: ORIGIN, gridSize: GRID });
        await realizeSpec(h.c, spec({ features: [] }), { origin: ORIGIN, gridSize: GRID });
        expect(h.w.settings).toEqual([scene]);
    });

    it('takes the scene’s own lowest floor as an existing level, stacking those after it above and those before it below', async () => {
        const h = makeHarness();
        const own = await h.c.addLevel('above', 'Level 1');
        h.c.setActiveLevel(null);
        const report = await realizeSpec(
            h.c,
            spec({
                levels: [
                    { key: 'cellar-2', name: 'Crypt' },
                    { key: 'cellar-1', name: 'Cellar' },
                    { key: 'ground', name: 'Ground floor', existing: true },
                    { key: 'upper', name: 'Upper floor' },
                ],
                features: [],
            }),
            { origin: ORIGIN, gridSize: GRID },
        );
        expect(report.levels['ground']).toBe(own);
        // Bottom to top, the scene's own floor where it was, the cellars under it.
        expect(h.c.levels.map((l) => l.name)).toEqual(['Crypt', 'Cellar', 'Ground floor', 'Upper floor']);
        const ground = h.c.levels.find((l) => l.name === 'Ground floor');
        const cellar = h.c.levels.find((l) => l.name === 'Cellar');
        expect(cellar?.top).toBe(ground?.bottom);
        // A scene with no levels of its own adds the ground floor first, then the cellar under it.
        const bare = makeHarness();
        await realizeSpec(
            bare.c,
            spec({
                levels: [
                    { key: 'cellar-1', name: 'Cellar' },
                    { key: 'ground', name: 'Ground floor', existing: true },
                ],
                features: [],
            }),
            { origin: ORIGIN, gridSize: GRID },
        );
        expect(bare.c.levels.map((l) => l.name)).toEqual(['Cellar', 'Ground floor']);
        expect(
            parseSceneSpec({
                schemaVersion: 1,
                levels: [
                    { key: 'a', name: 'A', existing: true },
                    { key: 'b', name: 'B', existing: true },
                ],
                features: [],
            }),
        ).toMatchObject({
            ok: false,
            issues: [{ path: 'levels.1.existing' }],
        });
    });

    it('creates levels bottom to top, puts features on them, and restores the level being edited', async () => {
        const h = makeHarness();
        const report = await realizeSpec(
            h.c,
            spec({
                levels: [
                    { key: 'cellar', name: 'Cellar', bottom: -10, top: 0, background: 'maps/cellar.webp', fog: 'maps/damp.webp' },
                    {
                        key: 'ground',
                        name: 'Ground',
                        backgroundColor: '#202020',
                        tints: { foreground: '#8090a0' },
                        alphaThresholds: { foreground: 0.4 },
                        placement: { offsetX: 50, fit: 'cover' },
                        visibleLevels: ['cellar'],
                    },
                ],
                features: [
                    {
                        type: 'room',
                        points: [
                            { x: 0, y: 0 },
                            { x: 2, y: 0 },
                            { x: 2, y: 2 },
                            { x: 0, y: 2 },
                        ],
                        level: 'cellar',
                    },
                    {
                        type: 'region',
                        biome: 'forest',
                        points: [
                            { x: 0, y: 0 },
                            { x: 2, y: 0 },
                            { x: 2, y: 2 },
                        ],
                    },
                ],
            }),
            { origin: ORIGIN, gridSize: GRID },
        );
        expect(report.levels).toEqual({ cellar: 'lv1', ground: 'lv2' });
        expect(h.c.levels.map((l) => l.name)).toEqual(['Cellar', 'Ground']);
        expect(h.c.levels[0]).toMatchObject({
            bottom: -10,
            top: 0,
            art: { ...NO_LEVEL_ART, background: 'maps/cellar.webp', foreground: null, fog: 'maps/damp.webp' },
        });
        // Whatever the spec leaves out is Foundry's own default; visible levels named by key become level ids.
        expect(h.c.levels[1]?.art).toEqual({
            ...NO_LEVEL_ART,
            backgroundColor: '#202020',
            tints: { ...NO_LEVEL_ART.tints, foreground: '#8090a0' },
            alphaThresholds: { ...NO_LEVEL_ART.alphaThresholds, foreground: 0.4 },
            placement: { ...NO_LEVEL_ART.placement, offsetX: 50, fit: 'cover' },
            visibleLevels: ['lv1'],
        });
        expect(h.s.last().map((f) => f.level)).toEqual(['lv1', null]);
        expect(h.c.activeLevel).toBeNull();
    });

    it('roofs a room under another level with a ceiling, unless the spec leaves it open', async () => {
        const h = makeHarness();
        const square = [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 2 },
            { x: 0, y: 2 },
        ];
        await realizeSpec(
            h.c,
            spec({
                levels: [
                    { key: 'ground', name: 'Ground' },
                    { key: 'upper', name: 'Upper' },
                ],
                features: [
                    { type: 'room', points: square, level: 'ground' },
                    { type: 'room', points: square.map((p) => ({ x: p.x + 4, y: p.y })), level: 'ground', ceiling: false },
                ],
            }),
            { origin: ORIGIN, gridSize: GRID },
        );
        expect(h.s.last().map((f) => f.type === 'room' && f.ceiling)).toEqual([true, false]);
        expect(h.d.regions.flat().map((r) => r.label)).toEqual([{ kind: 'ceiling', level: 'Ground' }]);
    });

    it('gives rooms and painted ground their movement cost and region behaviours, with Foundry’s defaults for what is left out', async () => {
        const h = makeHarness();
        const square = [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 2 },
        ];
        await realizeSpec(
            h.c,
            spec({
                features: [
                    { type: 'room', points: square, movementCost: 2, effects: [{ kind: 'darkness', modifier: 0.7 }] },
                    { type: 'region', biome: 'marsh', points: square, effects: [{ kind: 'text', text: 'Squelch', events: ['tokenTurnEnd'] }] },
                    { type: 'stroke', biome: 'sand', points: square },
                ],
            }),
            { origin: ORIGIN, gridSize: GRID },
        );
        const [room, marsh, sand] = h.s.last();
        expect(room && isArea(room) ? areaSettingsOf(room) : null).toEqual({
            movementCost: 2,
            effects: [{ kind: 'darkness', mode: 'override', modifier: 0.7 }],
            display: DEFAULT_AREA_DISPLAY,
            spawn: NO_SPAWN,
        });
        expect(marsh && isArea(marsh) ? areaSettingsOf(marsh).effects : null).toEqual([
            { kind: 'text', text: 'Squelch', colour: '#ffffff', visibility: 'anyone', once: false, events: ['tokenTurnEnd'] },
        ]);
        // Ordinary ground with no effects stores neither.
        expect(sand).not.toHaveProperty('effects', []);
        expect(sand && 'effects' in sand ? sand.effects : undefined).toBeUndefined();
    });

    it('gives an area its region’s display, filling what is left out with the engine’s own and storing none for the default', async () => {
        const h = makeHarness();
        const square = [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 2 },
        ];
        await realizeSpec(
            h.c,
            spec({
                features: [
                    { type: 'room', points: square, display: { visibility: 'always', restriction: { type: 'sight' } } },
                    { type: 'region', biome: 'marsh', points: square, display: {} },
                ],
            }),
            { origin: ORIGIN, gridSize: GRID },
        );
        const [room, marsh] = h.s.last();
        expect(room && isArea(room) ? areaSettingsOf(room).display : null).toEqual({
            ...DEFAULT_AREA_DISPLAY,
            visibility: 'always',
            restriction: { type: 'sight', priority: 0 },
        });
        expect(marsh && 'display' in marsh ? marsh.display : undefined).toBeUndefined();
    });

    it('draws shapes where the spec says, sized in its units with strokes in px, as native Drawings', async () => {
        const h = makeHarness();
        await realizeSpec(
            h.c,
            spec({
                features: [
                    {
                        type: 'shape',
                        kind: 'ellipse',
                        x: 2,
                        y: 3,
                        width: 4,
                        height: 2,
                        rotation: 30,
                        stroke: { colour: '#FF0000', width: 3 },
                        fill: { colour: '#00FF00' },
                    },
                    {
                        type: 'shape',
                        kind: 'line',
                        points: [
                            { x: 0, y: 0 },
                            { x: 1, y: 1 },
                        ],
                        hidden: true,
                    },
                ],
            }),
            { origin: ORIGIN, gridSize: GRID },
        );
        const [ellipse, line] = h.s.last();
        expect(ellipse).toMatchObject({
            type: 'shape',
            geometry: { kind: 'ellipse', width: 400, height: 200, rotation: 30 },
            points: [{ x: 1200, y: 800 }],
            strokeColour: '#ff0000',
            strokeWidth: 3,
            fillColour: '#00ff00',
            fillAlpha: 0.5,
        });
        expect(line).toMatchObject({ geometry: { kind: 'line' }, points: [ORIGIN, { x: 1100, y: 600 }], hidden: true, fillColour: null });
        expect(h.d.drawings.flat()).toEqual([
            expect.objectContaining({ kind: 'shape', shape: 'e', width: 400, height: 200 }),
            expect.objectContaining({ kind: 'shape', shape: 'p', points: [0, 0, 100, 100] }),
        ]);
    });

    it('gives a zone of grid spaces the scene’s own cell size, whatever the spec’s units', async () => {
        const h = makeHarness();
        await realizeSpec(h.c, spec({ units: 'px', features: [{ type: 'zone', x: 150, y: 150, shape: { kind: 'cells', cells: [{ i: 0, j: 1 }] } }] }), {
            origin: { x: 0, y: 0 },
            gridSize: GRID,
        });
        expect(h.s.last()[0]).toMatchObject({ shape: { kind: 'cells', size: GRID, cells: [{ i: 0, j: 1 }] } });
    });

    it('puts zones where the spec says, sized in its units, with their area settings', async () => {
        const h = makeHarness();
        await realizeSpec(
            h.c,
            spec({
                features: [
                    {
                        type: 'zone',
                        x: 2,
                        y: 3,
                        shape: { kind: 'cone', radius: 3, angle: 60, curvature: 'flat' },
                        name: 'Flamer',
                        rotation: 90,
                        attachedTo: 'tk1',
                        movementCost: 2,
                    },
                ],
            }),
            { origin: ORIGIN, gridSize: GRID },
        );
        const [zone] = h.s.last();
        expect(zone).toMatchObject({
            type: 'zone',
            points: [{ x: 1200, y: 800 }],
            shape: { kind: 'cone', radius: 300, angle: 60, curvature: 'flat' },
            name: 'Flamer',
            rotation: 90,
            attachedTo: 'tk1',
            movementCost: 2,
        });
    });

    it('puts map pins where the spec says, opening their journal page, and a lamp switch can be keyed beside them', async () => {
        const h = makeHarness();
        await realizeSpec(
            h.c,
            spec({
                levels: [{ key: 'g', name: 'Ground' }],
                features: [
                    { type: 'pin', x: 2, y: 3, text: 'The Sump', entry: 'je1', page: 'pg1', global: true, level: 'g' },
                    { type: 'pin', key: 'note', x: 0, y: 0, page: 'orphan' },
                ],
            }),
            { origin: ORIGIN, gridSize: GRID },
        );
        const [sump, bare] = h.s.last();
        expect(sump).toMatchObject({
            type: 'pin',
            points: [{ x: 1200, y: 800 }],
            text: 'The Sump',
            entry: 'je1',
            page: 'pg1',
            icon: null,
            global: true,
            level: 'lv1',
        });
        // A page with no entry to hold it is dropped.
        expect(bare).toMatchObject({ type: 'pin', text: '', entry: null, page: null, level: null });
        expect(h.d.notes.flat()).toHaveLength(2);
    });

    it('makes signs readable on hover: a readable pin sized in squares, and a stamp that reads', async () => {
        const h = makeHarness(SWITCH_STAMPS);
        await realizeSpec(
            h.c,
            spec({
                features: [
                    { type: 'pin', x: 1, y: 1, text: 'NO LOITERING', readable: true, size: 0.8 },
                    { type: 'stamp', stamp: 'pack:lamp', x: 4, y: 4, reads: 'Lamplighters’ guild' },
                ],
            }),
            { origin: ORIGIN, gridSize: GRID },
        );
        const [pin, lamp] = h.s.last();
        expect(pin).toMatchObject({ type: 'pin', text: 'NO LOITERING', readable: true, size: 80 });
        expect(lamp).toMatchObject({ type: 'stamp', reads: 'Lamplighters’ guild' });
        expect(h.d.notes.flat()).toEqual([
            expect.objectContaining({ text: 'NO LOITERING', readable: true, size: 80 }),
            expect.objectContaining({ text: 'Lamplighters’ guild', readable: true }),
        ]);
    });

    it('puts map labels where the spec says, with Foundry’s defaults for what it leaves out', async () => {
        const h = makeHarness();
        await realizeSpec(h.c, spec({ features: [{ type: 'label', x: 5, y: 1, text: 'Hab District 4', colour: '#E0C080', rotation: 15 }] }), {
            origin: ORIGIN,
            gridSize: GRID,
        });
        expect(h.s.last()[0]).toMatchObject({
            type: 'label',
            points: [{ x: 1500, y: 600 }],
            text: 'Hab District 4',
            fontSize: 48,
            colour: '#e0c080',
            fontFamily: '',
            rotation: 15,
            hidden: false,
        });
        expect(h.d.drawings.flat()).toHaveLength(1);
    });

    it('links a light switch to the lamps and rooms it names by key, and the lights it names by id', async () => {
        const h = makeHarness(SWITCH_STAMPS);
        const square = [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 2 },
        ];
        const report = await realizeSpec(
            h.c,
            spec({
                features: [
                    // A switch may come before what it controls.
                    { type: 'stamp', stamp: 'pack:switch', x: 1, y: 5, controls: ['lamp', 'hall', 'lamp'], lights: ['L1'] },
                    { type: 'stamp', key: 'lamp', stamp: 'pack:lamp', x: 3, y: 3 },
                    { type: 'room', key: 'hall', points: square },
                    { type: 'stamp', key: 'crate', stamp: 'pack:crate', x: 6, y: 6 },
                    { type: 'stamp', stamp: 'pack:switch', x: 8, y: 5, controls: ['crate'] },
                    { type: 'stamp', stamp: 'pack:lamp', x: 9, y: 9, controls: ['lamp'] },
                ],
            }),
            { origin: ORIGIN, gridSize: GRID },
        );
        const [switchId, lamp, hall] = report.features;
        expect(h.c.switchTargets(switchId ?? '')).toEqual([
            { kind: 'feature', id: lamp },
            { kind: 'feature', id: hall },
            { kind: 'light', id: 'L1' },
        ]);
        // A crate is no lamp, and a lamp is no switch.
        expect(report.problems).toEqual([
            { index: 4, problem: 'switch' },
            { index: 5, problem: 'switch' },
        ]);
    });

    it('places stamps with their interiors, and reports what it could not build', async () => {
        const h = makeHarness(stamps);
        const report = await realizeSpec(
            h.c,
            spec({
                features: [
                    { type: 'stamp', stamp: 'pack:hab', x: 2, y: 1, rotation: 90, interior: { create: 'Hab interior' } },
                    { type: 'stamp', stamp: 'pack:missing', x: 0, y: 0 },
                    { type: 'stamp', stamp: 'pack:hab', x: 6, y: 1, interior: { scene: 'nowhere' } },
                    { type: 'stamp', stamp: 'pack:hab', x: 9, y: 1, interior: { scene: 'vault' } },
                ],
            }),
            { origin: ORIGIN, gridSize: GRID },
        );
        expect(report.problems).toEqual([
            { index: 1, problem: 'stamp' },
            { index: 2, problem: 'interior' },
        ]);
        const [first, , last] = report.features;
        expect(first === undefined ? null : h.c.submapOf(first)?.sceneName).toBe('Hab interior');
        expect(last === undefined ? null : h.c.submapOf(last)?.scene).toBe('vault');
        const placed = first === undefined ? null : h.c.getFeature(first);
        expect(placed?.type === 'stamp' ? { centre: placed.points[0], rotation: placed.rotation } : null).toEqual({
            centre: { x: 1200, y: 600 },
            rotation: 90,
        });
    });

    it('gives a building its floors in this scene, reporting a scene with no level to build them on', async () => {
        const h = makeHarness(stamps);
        const noLevels = await realizeSpec(h.c, spec({ features: [{ type: 'stamp', stamp: 'pack:hab', x: 2, y: 1, floors: ['Upstairs'] }] }), {
            origin: ORIGIN,
            gridSize: GRID,
        });
        expect(noLevels.problems).toEqual([{ index: 0, problem: 'interior' }]);

        const built = await realizeSpec(
            h.c,
            spec({
                levels: [{ key: 'g', name: 'Ground' }],
                features: [{ type: 'stamp', stamp: 'pack:hab', x: 6, y: 1, level: 'g', floors: ['Upstairs', 'Attic'] }],
            }),
            { origin: ORIGIN, gridSize: GRID },
        );
        expect(built.problems).toEqual([]);
        const [hab] = built.features;
        expect(hab === undefined ? [] : h.c.buildingFloors(hab).map((id) => h.c.levels.find((l) => l.id === id)?.name)).toEqual(['Upstairs', 'Attic']);
    });
});
