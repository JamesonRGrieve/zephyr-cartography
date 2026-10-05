// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, frameScene, test } from './lib/foundry';

test('what the GM edits reaches Foundry: draw order, a room’s materials, a crate’s state, a level’s band, an empty level removed', async ({ world }) => {
    const result = await world.evaluate(async () => {
        const api = game.modules?.get('zephyr-cartography').api;
        const square = (x: number): { x: number; y: number }[] => [
            { x, y: 2 },
            { x: x + 3, y: 2 },
            { x: x + 3, y: 5 },
            { x, y: 5 },
        ];
        const built = await api?.buildSpec({
            schemaVersion: 1,
            levels: [
                { key: 'g', name: 'Ground' },
                { key: 'u', name: 'Loft' },
                { key: 'e', name: 'Empty' },
            ],
            features: [
                { type: 'region', biome: 'sand', points: square(1), level: 'g' },
                { type: 'region', biome: 'forest', points: square(6), level: 'g' },
                { type: 'room', points: square(11), level: 'g' },
                { type: 'stamp', stamp: 'zc-e2e-pack:crate', x: 8, y: 8, level: 'g' },
            ],
        });
        const controller = api?.controller();
        if (built?.ok !== true || !controller) {
            return null;
        }
        const [sand, forest, room, crate] = built.report.features;
        const order = (): string[] => (canvas?.scene?.getFlag('zephyr-cartography', 'features') ?? []).map((f) => f.id);
        await controller.toFront(sand ?? '');
        const fronted = order();
        await controller.lower(sand ?? '');
        const lowered = order();
        await controller.toBack(sand ?? '');
        await controller.raise(sand ?? '');
        const raised = order();
        const materials = await controller.setRoomMaterials(room ?? '', { floor: 'stone', wall: null, wallKind: 'solid', ceiling: false });
        const tileBefore = canvas?.scene?.tiles.contents[0]?.texture.src;
        await controller.cycleStampVariant(crate ?? '');
        const tileAfter = canvas?.scene?.tiles.contents[0]?.texture.src;
        const loft = canvas?.scene?.levels.contents.find((l) => l.name === 'Loft');
        const empty = canvas?.scene?.levels.contents.find((l) => l.name === 'Empty');
        const banded = await controller.setLevelBand(loft?.id ?? '', 40, 60);
        const removed = await controller.removeLevel(empty?.id ?? '');
        return {
            ids: { sand, forest, room, crate },
            fronted,
            lowered,
            raised,
            materials,
            floor: controller.getFeature(room ?? '')?.type === 'room',
            tileChanged: tileBefore !== tileAfter,
            banded,
            loftBand: canvas?.scene?.levels.contents.find((l) => l.name === 'Loft')?.elevation.bottom,
            removed,
            emptyGone: !(canvas?.scene?.levels.contents ?? []).some((l) => l.name === 'Empty'),
        };
    });
    if (!result) {
        throw new Error('spec not built');
    }
    const { ids } = result;
    expect(result.fronted).toEqual([ids.forest, ids.room, ids.crate, ids.sand]);
    expect(result.lowered).toEqual([ids.forest, ids.room, ids.sand, ids.crate]);
    // To the back, then one step up: second.
    expect(result.raised).toEqual([ids.forest, ids.sand, ids.room, ids.crate]);
    expect(result.materials).toBe(true);
    expect(result.floor).toBe(true);
    // The crate shows its next state: smashed.
    expect(result.tileChanged).toBe(true);
    expect(result.banded).toBe(true);
    expect(result.loftBand).toBe(40);
    expect(result.removed).toBe(true);
    expect(result.emptyGone).toBe(true);
});

test('zones of every shape, sized in grid squares, become regions in Foundry’s own shapes at the grid’s scale', async ({ world }) => {
    const shapes = await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            units: 'grid',
            features: [
                { type: 'zone', x: 3, y: 3, name: 'Ellipse', shape: { kind: 'ellipse', radiusX: 2, radiusY: 1 } },
                { type: 'zone', x: 8, y: 3, name: 'Ring', shape: { kind: 'ring', radius: 2, innerWidth: 0.5, outerWidth: 0.5 } },
                { type: 'zone', x: 13, y: 3, name: 'Cone', shape: { kind: 'cone', radius: 3, angle: 60, curvature: 'flat' } },
                { type: 'zone', x: 3, y: 9, name: 'Line', shape: { kind: 'line', length: 4, width: 1 } },
                { type: 'zone', x: 8, y: 9, name: 'Rectangle', shape: { kind: 'rectangle', width: 3, height: 2 } },
                {
                    type: 'zone',
                    x: 13,
                    y: 9,
                    name: 'Cells',
                    shape: {
                        kind: 'cells',
                        cells: [
                            { i: 0, j: 0 },
                            { i: 0, j: 1 },
                            { i: 1, j: 1 },
                        ],
                    },
                },
            ],
        });
        const grid = canvas?.grid?.size ?? 0;
        return {
            grid,
            regions: (canvas?.scene?.regions.contents ?? []).map((r) => ({ name: r.name, types: r.shapes.map((s) => s.type) })),
            ellipse: canvas?.scene?.regions.contents.find((r) => r.name === 'Ellipse')?.shapes[0],
        };
    });
    const typeOf = (zone: string): string | undefined => shapes.regions.find((r) => r.name === zone)?.types[0];
    expect(['Ellipse', 'Ring', 'Cone', 'Line', 'Rectangle', 'Cells'].map(typeOf)).toEqual(['ellipse', 'ring', 'cone', 'line', 'rectangle', 'grid']);
    // Sized at the grid's scale: two squares across, one down.
    expect(shapes.ellipse).toMatchObject({ radiusX: 2 * shapes.grid, radiusY: shapes.grid });
});

test('a room of window walls gets Foundry’s window walls, and its door stays solid', async ({ world }) => {
    const walls = await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            features: [
                {
                    type: 'room',
                    wallKind: 'window',
                    points: [
                        { x: 2, y: 2 },
                        { x: 6, y: 2 },
                        { x: 6, y: 6 },
                        { x: 2, y: 6 },
                    ],
                    doors: [{ segment: 0 }],
                },
            ],
        });
        return (canvas?.scene?.walls.contents ?? []).map((w) => ({ door: w.door, sight: w.sight, light: w.light, lightThreshold: w.threshold.light }));
    });
    // EDGE_SENSE_TYPES: NORMAL 20, PROXIMITY 30. A window reaches 2 squares: 10 distance units at the scene's 5 per square.
    expect(walls.filter((w) => w.door === 0)).toEqual(Array.from({ length: 3 }, () => ({ door: 0, sight: 30, light: 30, lightThreshold: 10 })));
    expect(walls.filter((w) => w.door === 1)).toEqual([{ door: 1, sight: 20, light: 20, lightThreshold: null }]);
});

test('a spec sets the scene’s own darkness, fog, vision, weather and transition', async ({ world }) => {
    const scene = await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            scene: { darkness: 0.75, darknessLock: true, globalLight: true, tokenVision: false, fog: 'shared', transition: { type: 'fade', duration: 800 } },
            features: [],
        });
        const s = canvas?.scene;
        return (
            s && {
                darkness: s.environment.darknessLevel,
                lock: s.environment.darknessLock,
                globalLight: s.environment.globalLight.enabled,
                tokenVision: s.tokenVision,
                fog: s.fog.mode,
                transition: { type: s.transition.type, duration: s.transition.duration },
            }
        );
    });
    // CONST.FOG_EXPLORATION_MODES.SHARED is 2.
    expect(scene).toEqual({ darkness: 0.75, lock: true, globalLight: true, tokenVision: false, fog: 2, transition: { type: 'fade', duration: 800 } });
});

test('a spec sets the scene’s day and night environments, their cycle and the fog’s colours, leaving the rest', async ({ world }) => {
    const scene = await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            scene: {
                cycle: false,
                base: { hue: 0.1, intensity: 0.4 },
                dark: { luminosity: -0.6, shadows: 0.3 },
                fogColours: { unexplored: '#102030' },
            },
            features: [],
        });
        const s = canvas?.scene;
        return (
            s && {
                cycle: s.environment.cycle,
                base: { hue: s.environment.base.hue, intensity: s.environment.base.intensity, luminosity: s.environment.base.luminosity },
                dark: { hue: s.environment.dark.hue, luminosity: s.environment.dark.luminosity, shadows: s.environment.dark.shadows },
                unexplored: s.fog.colors.unexplored?.css ?? null,
            }
        );
    });
    // Values left out keep Foundry's defaults: the dark environment's hue is 257/360.
    expect(scene?.cycle).toBe(false);
    expect(scene?.base).toEqual({ hue: 0.1, intensity: 0.4, luminosity: 0 });
    expect(scene?.dark.luminosity).toBe(-0.6);
    expect(scene?.dark.shadows).toBe(0.3);
    expect(scene?.dark.hue).toBeCloseTo(257 / 360);
    expect(scene?.unexplored).toBe('#102030');
});

test('difficult painted ground becomes a Modify Movement Cost region, with terrain mirroring off', async ({ world }) => {
    const regions = await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            features: [
                {
                    type: 'region',
                    biome: 'marsh',
                    movementCost: 2,
                    points: [
                        { x: 1, y: 1 },
                        { x: 5, y: 1 },
                        { x: 5, y: 5 },
                    ],
                },
                {
                    type: 'region',
                    biome: 'grassland',
                    points: [
                        { x: 7, y: 1 },
                        { x: 11, y: 1 },
                        { x: 11, y: 5 },
                    ],
                },
            ],
        });
        return (canvas?.scene?.regions.contents ?? []).map((r) => ({ name: r.name, behaviors: r.behaviors.contents.map((b) => b.toObject()) }));
    });
    expect(regions).toEqual([
        expect.objectContaining({
            behaviors: [
                expect.objectContaining({
                    type: 'modifyMovementCost',
                    system: expect.objectContaining({ difficulties: expect.objectContaining({ walk: 2 }) }),
                }),
            ],
        }),
    ]);
});

test('an area’s region shows as the spec says, and is shaped by walls only on exactly one level', async ({ world }) => {
    const regions = await world.evaluate(async () => {
        const square = (x: number): { x: number; y: number }[] => [
            { x, y: 1 },
            { x: x + 4, y: 1 },
            { x: x + 4, y: 5 },
            { x, y: 5 },
        ];
        const display = { visibility: 'always', highlight: 'coverage', measurements: true, observed: true, restriction: { type: 'sight', priority: 2 } };
        const outcome = await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            levels: [{ key: 'g', name: 'Ground' }],
            features: [
                { type: 'room', points: square(1), level: 'g', display },
                { type: 'region', biome: 'marsh', points: square(7), display: { ...display, hidden: true } },
            ],
        });
        return {
            problems: outcome?.ok === true ? outcome.report.problems : null,
            // The room's floor over the scene's own first level is left out.
            regions: (canvas?.scene?.regions.contents ?? [])
                .filter((r) => r.name === 'Room' || r.name === 'Marsh')
                .map((r) => ({
                    name: r.name,
                    visibility: r.visibility,
                    highlightMode: r.highlightMode,
                    displayMeasurements: r.displayMeasurements,
                    playersObserve: r.ownership['default'] === CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER,
                    restriction: { enabled: r.restriction.enabled, type: r.restriction.type, priority: r.restriction.priority },
                    // `hidden` is 14.360's, which no fvtt-types release knows yet.
                    hidden: foundry.utils.getProperty(r, 'hidden') === true,
                })),
        };
    });
    expect(regions.problems).toEqual([]);
    // Foundry's ALWAYS visibility is 2; the marsh shows on every level, which Foundry cannot restrict.
    const shown = { visibility: 2, highlightMode: 'coverage', displayMeasurements: true, playersObserve: true };
    expect(regions.regions).toEqual([
        { name: 'Room', ...shown, restriction: { enabled: true, type: 'sight', priority: 2 }, hidden: false },
        // Hidden: the GM's alone, its behaviours off until shown.
        { name: 'Marsh', ...shown, restriction: expect.objectContaining({ enabled: false }), hidden: true },
    ]);
});

test('a toggle names its area’s other behaviours by UUID, and a token walking in switches a disabled one on', async ({ world }) => {
    const built = await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            features: [
                {
                    type: 'room',
                    points: [
                        { x: 4, y: 4 },
                        { x: 8, y: 4 },
                        { x: 8, y: 8 },
                        { x: 4, y: 8 },
                    ],
                    // A door on the left wall, for the token to walk through.
                    doors: [{ segment: 3, state: 'open' }],
                    effects: [
                        { kind: 'darkness', modifier: 1, disabled: true },
                        { kind: 'toggle', events: ['tokenEnter'], enable: [0] },
                    ],
                },
            ],
        });
        const room = canvas?.scene?.regions.contents.find((r) => r.name === 'Room');
        const [darkness, toggle] = room?.behaviors.contents ?? [];
        const enable = toggle?.type === 'toggleBehavior' ? [...toggle.system.enable] : [];
        return {
            types: room?.behaviors.contents.map((b) => b.type),
            startsDisabled: darkness?.disabled,
            // The UUID the toggle holds resolves to the darkness behaviour itself.
            resolves: enable.map((uuid) => foundry.utils.fromUuidSync(uuid)?.id === darkness?.id),
        };
    });
    expect(built).toEqual({ types: ['adjustDarknessLevel', 'toggleBehavior'], startsDisabled: true, resolves: [true] });

    await world.evaluate(async () => {
        // Outside the room, level with the door, then into the room through it. Region events need no Actor.
        const [token] = (await canvas?.scene?.createEmbeddedDocuments('Token', [{ name: 'Walker', x: 200, y: 500 }])) ?? [];
        await token?.update({ x: 500, y: 500 });
    });
    const darknessDisabled = async (): Promise<boolean | undefined> =>
        world.evaluate(() => canvas?.scene?.regions.contents.find((r) => r.name === 'Room')?.behaviors.contents[0]?.disabled);
    await expect.poll(darknessDisabled).toBe(false);
});

test('a zone attached to a token moves with it, and the zone follows its region', async ({ world }) => {
    const placed = await world.evaluate(async () => {
        const [token] = (await canvas?.scene?.createEmbeddedDocuments('Token', [{ name: 'Drone', x: 400, y: 400 }])) ?? [];
        const api = game.modules?.get('zephyr-cartography').api;
        const outcome = await api?.buildSpec({
            schemaVersion: 1,
            units: 'px',
            features: [{ type: 'zone', x: 450, y: 450, shape: { kind: 'circle', radius: 150 }, name: 'Aura', attachedTo: token?.id ?? null }],
        });
        const zoneId = outcome?.ok === true ? outcome.report.features[0] : undefined;
        const region = canvas?.scene?.regions.contents.find((r) => r.name === 'Aura');
        await token?.update({ x: 600, y: 400 });
        return { zoneId: zoneId ?? '', attached: region?.toObject().attachment.token === token?.id };
    });
    expect(placed.attached).toBe(true);
    const where = async (): Promise<{ region: number[]; zone: number[] }> =>
        world.evaluate((zoneId) => {
            const [shape] = canvas?.scene?.regions.contents.find((r) => r.name === 'Aura')?.shapes ?? [];
            const point = game.modules?.get('zephyr-cartography').api.controller()?.getFeature(zoneId)?.points[0];
            return { region: shape && 'x' in shape ? [shape.x, shape.y] : [], zone: point ? [point.x, point.y] : [] };
        }, placed.zoneId);
    // The token moved 200 px right: Foundry moved the region with it, and the zone followed.
    await expect.poll(where).toEqual({ region: [650, 450], zone: [650, 450] });
});

test('an emanation zone rounds its token’s own footprint, and follows the token as Foundry refits it', async ({ world }) => {
    const placed = await world.evaluate(async () => {
        const [token] = (await canvas?.scene?.createEmbeddedDocuments('Token', [{ name: 'Pariah', x: 400, y: 400 }])) ?? [];
        const outcome = await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            units: 'px',
            features: [{ type: 'zone', x: 450, y: 450, name: 'Null field', shape: { kind: 'emanation', radius: 200 }, attachedTo: token?.id ?? null }],
        });
        await token?.update({ x: 700, y: 400 });
        return { zoneId: outcome?.ok === true ? outcome.report.features[0] ?? '' : '' };
    });
    const where = async (): Promise<{ type: string | undefined; covers: boolean[]; zone: number[] }> =>
        world.evaluate((zoneId) => {
            const region = canvas?.scene?.regions.contents.find((r) => r.name === 'Null field');
            const point = game.modules?.get('zephyr-cartography').api.controller()?.getFeature(zoneId)?.points[0];
            return {
                type: region?.shapes[0]?.type,
                // Foundry's own geometry: beside the moved token, and not where it stood.
                covers: region ? [region.polygonTree.testPoint({ x: 950, y: 450 }), region.polygonTree.testPoint({ x: 250, y: 450 })] : [],
                zone: point ? [point.x, point.y] : [],
            };
        }, placed.zoneId);
    // Foundry refits the emanation to the moved token (a 1×1 token on a 100 px grid), and the zone follows its centre.
    await expect.poll(where).toEqual({ type: 'emanation', covers: [true, false], zone: [750, 450] });
});

test('a zone of grid spaces becomes Foundry’s own grid-spaces shape, on the spaces from the one its point is in', async ({ world }) => {
    const region = await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            features: [
                {
                    type: 'zone',
                    x: 4.5,
                    y: 2.5,
                    name: 'Rubble',
                    movementCost: 2,
                    shape: {
                        kind: 'cells',
                        cells: [
                            { i: 0, j: 0 },
                            { i: 0, j: 1 },
                            { i: 1, j: 0 },
                        ],
                    },
                },
            ],
        });
        const rubble = canvas?.scene?.regions.contents.find((r) => r.name === 'Rubble');
        const [shape] = rubble?.shapes ?? [];
        return {
            type: shape?.type,
            offsets: shape && 'offsets' in shape ? [...shape.offsets].map((o) => ({ i: o.i, j: o.j })) : [],
            // Foundry's own region geometry covers the spaces: the middle of the first one, not the space beside the third.
            covers: rubble ? [rubble.polygonTree.testPoint({ x: 450, y: 250 }), rubble.polygonTree.testPoint({ x: 550, y: 350 })] : [],
        };
    });
    // The point (450, 250) is in row 2, column 4 of the 100 px grid.
    expect(region).toEqual({
        type: 'grid',
        offsets: [
            { i: 2, j: 4 },
            { i: 2, j: 5 },
            { i: 3, j: 4 },
        ],
        covers: [true, false],
    });
});

test('a spawn zone spawns its actors’ tokens inside its region, snapped and apart', async ({ world }) => {
    // The e2e system's Actor type is not one fvtt-types knows, so the Actor is made from plain script.
    const actorUuid = await world.evaluate<string>("Actor.create({ name: 'Cultist', type: 'npc' }).then((actor) => actor.uuid)");
    expect(actorUuid).toMatch(/^Actor\.\w+$/u);
    const result = await world.evaluate(async (uuid) => {
        const api = game.modules?.get('zephyr-cartography').api;
        const outcome = await api?.buildSpec({
            schemaVersion: 1,
            features: [{ type: 'zone', key: 'ambush', x: 6, y: 6, shape: { kind: 'circle', radius: 2 }, spawn: { actors: [{ uuid, count: 3 }] } }],
        });
        const zoneId = outcome?.ok === true ? outcome.report.features[0] ?? '' : '';
        const spawned = await api?.spawn(zoneId);
        const tokens = (canvas?.scene?.tokens.contents ?? []).map((token) => ({ x: token.x, y: token.y }));
        return { spawned, tokens };
    }, actorUuid);
    expect(result.spawned).toEqual({ spawned: 3, missing: [] });
    expect(result.tokens).toHaveLength(3);
    // Each on its own grid square (100 px), inside the circle 200 px about (600, 600).
    expect(new Set(result.tokens.map((t) => `${t.x},${t.y}`)).size).toBe(3);
    for (const token of result.tokens) {
        expect(token.x % 100).toBe(0);
        expect(Math.hypot(token.x + 50 - 600, token.y + 50 - 600)).toBeLessThanOrEqual(200);
    }
});

test('a spec’s drawn shapes become native Drawings, stroked and filled, and erase with their feature', async ({ world }) => {
    const drawings = async (): Promise<{ type: string; fillType: number; strokeWidth: number; points: number[] }[]> =>
        world.evaluate(() =>
            (canvas?.scene?.drawings.contents ?? []).map((d) => ({
                type: d.shape.type,
                fillType: d.fillType,
                strokeWidth: d.strokeWidth,
                points: [...d.shape.points],
            })),
        );
    await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            features: [
                {
                    type: 'shape',
                    kind: 'polygon',
                    points: [
                        { x: 2, y: 2 },
                        { x: 8, y: 2 },
                        { x: 5, y: 7 },
                    ],
                    stroke: { colour: '#ff4400', width: 6 },
                    fill: { colour: '#ffcc00', alpha: 0.4 },
                },
                { type: 'shape', kind: 'ellipse', x: 12, y: 5, width: 5, height: 3, rotation: 30, stroke: { colour: '#00ccff', width: 4 } },
                {
                    type: 'shape',
                    kind: 'line',
                    points: [
                        { x: 2, y: 9 },
                        { x: 16, y: 9 },
                    ],
                    stroke: { colour: '#ffffff', width: 10 },
                },
            ],
        });
    });
    // CONST.DRAWING_FILL_TYPES: NONE 0, SOLID 1. The polygon closes on its first point; the line stays open.
    expect(await drawings()).toEqual([
        { type: 'p', fillType: 1, strokeWidth: 6, points: [0, 0, 600, 0, 300, 500, 0, 0] },
        { type: 'e', fillType: 0, strokeWidth: 4, points: [] },
        { type: 'p', fillType: 0, strokeWidth: 10, points: [0, 0, 1400, 0] },
    ]);
    await frameScene(world);
    await expect(world.locator('#board')).toHaveScreenshot('drawn-shapes.png');

    await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        await controller?.erase({ x: 1200, y: 500 });
    });
    await expect.poll(async () => (await drawings()).map((d) => d.type)).toEqual(['p', 'p']);
});

test('a fenced road puts Foundry’s terrain walls along its centerline', async ({ world }) => {
    const walls = await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            features: [
                {
                    type: 'path',
                    kind: 'road',
                    walls: 'terrain',
                    points: [
                        { x: 1, y: 3 },
                        { x: 8, y: 3 },
                    ],
                },
            ],
        });
        return (canvas?.scene?.walls.contents ?? []).map((w) => ({ sight: w.sight, move: w.move }));
    });
    // EDGE_SENSE_TYPES: LIMITED 10, NORMAL 20.
    expect(walls.length).toBeGreaterThan(0);
    expect(new Set(walls.map((w) => JSON.stringify(w)))).toEqual(new Set([JSON.stringify({ sight: 10, move: 20 })]));
});

test('a room spec becomes native walls, a door and a light', async ({ world }) => {
    const result = await world.evaluate(async () => {
        const outcome = await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            features: [
                {
                    type: 'room',
                    points: [
                        { x: 2, y: 2 },
                        { x: 7, y: 2 },
                        { x: 7, y: 6 },
                        { x: 2, y: 6 },
                    ],
                    doors: [{ segment: 1, state: 'open' }],
                },
            ],
        });
        const walls = canvas?.scene?.walls.contents ?? [];
        return {
            ok: outcome?.ok,
            walls: walls.length,
            doors: walls.filter((w) => w.door === 1).map((w) => ({ c: w.c, ds: w.ds })),
            lights: canvas?.scene?.lights.size,
        };
    });
    expect(result.ok).toBe(true);
    expect(result.walls).toBe(4);
    // The right-hand wall (grid x = 7) is the door, left open.
    expect(result.doors).toEqual([{ c: [700, 200, 700, 600], ds: 1 }]);
    expect(result.lights).toBe(1);
    await frameScene(world, 'walls');
    await expect(world.locator('#board')).toHaveScreenshot('room-with-door.png');
});

test('a generated floor plan is walled rooms joined by one-square doors, undone in one step', async ({ world }) => {
    const built = await world.evaluate(async () => {
        const api = game.modules?.get('zephyr-cartography').api;
        const plan = api?.generateFloorPlan({ seed: 7, width: 16, height: 12 });
        let deleted = 0;
        const hook = Hooks.on('deleteWall', () => {
            deleted += 1;
        });
        const outcome = await api?.buildSpec(plan);
        Hooks.off('deleteWall', hook);
        const walls = canvas?.scene?.walls.contents ?? [];
        const doorLengths = walls.filter((w) => w.door === 1).map((w) => Math.hypot(w.c[2] - w.c[0], w.c[3] - w.c[1]));
        return { rooms: plan?.features.length ?? 0, ok: outcome?.ok, doorLengths, deleted };
    });
    expect(built.ok).toBe(true);
    // The build is one transaction: a room re-synced by a later neighbour replaces its pending walls, never written ones.
    expect(built.deleted).toBe(0);
    // One door per split (rooms - 1) plus the entrance.
    expect(built.doorLengths).toHaveLength(built.rooms);
    expect(new Set(built.doorLengths)).toEqual(new Set([100]));
    await frameScene(world, 'walls');
    await expect(world.locator('#board')).toHaveScreenshot('floor-plan-seed-7.png');

    const afterUndo = await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.controller()?.undo();
        return { walls: canvas?.scene?.walls.size, lights: canvas?.scene?.lights.size };
    });
    expect(afterUndo).toEqual({ walls: 0, lights: 0 });
});

test('a spec with problems reports them instead of throwing', async ({ world }) => {
    const outcome = await world.evaluate(async () =>
        game.modules?.get('zephyr-cartography').api.buildSpec({ schemaVersion: 1, features: [{ type: 'region', biome: 'quicksand' }] }),
    );
    expect(outcome?.ok).toBe(false);
});

test('a spec’s splat map blends the textures its mask weights over the whole scene, saved as the scene’s own mask', async ({ world }) => {
    const result = await world.evaluate(async () => {
        const api = game.modules?.get('zephyr-cartography').api;
        const outcome = await api?.buildSpec({
            schemaVersion: 1,
            splats: [{ mask: 'modules/zc-e2e-pack/masks/sand-rock.png', roles: ['sand', 'rock', null, null] }],
            features: [],
        });
        const layer = api?.controller()?.splatLayer();
        return { problems: outcome?.ok === true ? outcome.report.problems : null, roles: layer?.roles, path: layer?.path, size: [layer?.width, layer?.height] };
    });
    expect(result.problems).toEqual([]);
    expect(result.roles).toEqual(['sand', 'rock', null, null]);
    // Copied to the scene's own mask file, so painting over it leaves the pack's image alone.
    expect(result.path).toMatch(/^worlds\/zc-e2e\/zephyr-cartography\/splat-.+-all\.png$/u);
    expect(result.size).toEqual([40, 30]);
    await frameScene(world);
    await expect(world.locator('#board')).toHaveScreenshot('spec-splat.png');
});

test('a blend bakes into a native Tile over the scene, drawn without the module’s overlay, and unbakes back', async ({ world }) => {
    const baked = await world.evaluate(async () => {
        const api = game.modules?.get('zephyr-cartography').api;
        await api?.buildSpec({
            schemaVersion: 1,
            splats: [{ mask: 'modules/zc-e2e-pack/masks/sand-rock.png', roles: ['sand', 'rock', null, null] }],
            features: [],
        });
        const controller = api?.controller();
        const ok = await controller?.bakeSplat();
        const tiles = (canvas?.scene?.tiles.contents ?? []).map((tile) => ({
            src: tile.texture.src ?? '',
            width: tile.width,
            height: tile.height,
            sort: tile.sort,
        }));
        return { ok, tiles, baked: controller?.splatState(), scene: { width: canvas?.dimensions?.sceneWidth, height: canvas?.dimensions?.sceneHeight } };
    });
    expect(baked.ok).toBe(true);
    expect(baked.baked).toBe('tile');
    expect(baked.tiles).toEqual([{ src: expect.stringMatching(/splat-.+-all-baked\.png$/u), width: baked.scene.width, height: baked.scene.height, sort: -1 }]);
    await frameScene(world);
    // The Tile looks as the overlay did.
    await expect(world.locator('#board')).toHaveScreenshot('baked-splat.png');

    const unbaked = await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        return { ok: await controller?.unbakeSplat(), tiles: canvas?.scene?.tiles.size, baked: controller?.splatState() };
    });
    expect(unbaked).toEqual({ ok: true, tiles: 0, baked: 'live' });
});

test('a spec’s masks on one level stack, each saved to its own file, and bake together into one Tile', async ({ world }) => {
    const stacked = await world.evaluate(async () => {
        const api = game.modules?.get('zephyr-cartography').api;
        const outcome = await api?.buildSpec({
            schemaVersion: 1,
            splats: [
                { mask: 'modules/zc-e2e-pack/masks/sand-rock.png', roles: ['sand', 'rock', null, null] },
                { mask: 'modules/zc-e2e-pack/masks/sand-rock.png', roles: ['snow', 'ice', null, null] },
            ],
            features: [],
        });
        const controller = api?.controller();
        const stack = controller?.splatStack(null).map((layer) => ({ index: layer.index, path: layer.path, first: layer.roles[0] })) ?? [];
        // Each layer's mask is a file of its own in the world's data.
        const saved = await Promise.all(stack.map(async (layer) => (await fetch(layer.path)).ok));
        const baked = await controller?.bakeSplat('tile');
        return { problems: outcome?.ok === true ? outcome.report.problems : null, stack, saved, baked, tiles: canvas?.scene?.tiles.size };
    });
    expect(stacked.problems).toEqual([]);
    expect(stacked.stack).toEqual([
        { index: 0, path: expect.stringMatching(/splat-.+-all\.png$/u), first: 'sand' },
        { index: 1, path: expect.stringMatching(/splat-.+-all-1\.png$/u), first: 'snow' },
    ]);
    expect(stacked.saved).toEqual([true, true]);
    expect([stacked.baked, stacked.tiles]).toEqual([true, 1]);
});

test('a blend on a level bakes into the native Level’s background, and unbaking puts the level’s own image back', async ({ world }) => {
    const background = async (): Promise<string | null> =>
        world.evaluate(() => canvas?.scene?.levels.contents.find((level) => level.name === 'Ground')?.background.src ?? null);
    const baked = await world.evaluate(async () => {
        const api = game.modules?.get('zephyr-cartography').api;
        const outcome = await api?.buildSpec({
            schemaVersion: 1,
            levels: [{ key: 'g', name: 'Ground', background: 'modules/zc-e2e-pack/masks/sand-rock.png' }],
            splats: [{ level: 'g', mask: 'modules/zc-e2e-pack/masks/sand-rock.png', roles: ['sand', 'rock', null, null] }],
            features: [],
        });
        const controller = api?.controller();
        const ground = outcome?.ok === true ? outcome.report.levels['g'] : undefined;
        if (ground !== undefined) {
            controller?.setActiveLevel(ground);
        }
        return { ok: await controller?.bakeSplat('background'), state: controller?.splatState(), tiles: canvas?.scene?.tiles.size };
    });
    // Baked into the background, no Tile.
    expect(baked).toEqual({ ok: true, state: 'background', tiles: 0 });
    await expect.poll(background).toMatch(/splat-.+-baked\.png$/u);

    const unbaked = await world.evaluate(async () => game.modules?.get('zephyr-cartography').api.controller()?.unbakeSplat());
    expect(unbaked).toBe(true);
    await expect.poll(background).toBe('modules/zc-e2e-pack/masks/sand-rock.png');
});

test('a sign’s words are a readable Note: authorless, so players see it with no journal, and drawn with no icon over the art', async ({ world }) => {
    await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            features: [
                { type: 'pin', x: 2, y: 2, text: 'NO LOITERING', readable: true, size: 0.8 },
                { type: 'stamp', stamp: 'zc-e2e-pack:crate', x: 6, y: 6, reads: 'Property of the Supply Office' },
            ],
        });
        canvas?.tokens?.activate();
    });
    const signs = async (): Promise<unknown[]> =>
        world.evaluate(() =>
            (canvas?.scene?.notes.contents ?? []).map((note) => {
                const shown = note.object?.controlIcon;
                return {
                    text: note.text,
                    author: note._source.author,
                    readable: foundry.utils.getProperty(note.flags, 'zephyr-cartography.readable'),
                    iconSize: note.iconSize,
                    tooltip: note.object?.tooltip?.text,
                    iconShown: shown ? shown.icon.visible || shown.bg.visible || shown.border.visible : null,
                };
            }),
        );
    // The crate's hover spot is as wide as its footprint is long: one square.
    await expect.poll(signs).toEqual([
        { text: 'NO LOITERING', author: null, readable: true, iconSize: 80, tooltip: 'NO LOITERING', iconShown: false },
        { text: 'Property of the Supply Office', author: null, readable: true, iconSize: 100, tooltip: 'Property of the Supply Office', iconShown: false },
    ]);
    // The GM finds and edits them on the Notes layer, where their icons show.
    const onNotes = async (): Promise<(boolean | undefined)[]> =>
        world.evaluate(() => {
            canvas?.notes?.activate();
            return (canvas?.notes?.placeables ?? []).map((note) => {
                note.renderFlags.set({ refreshState: true });
                note.applyRenderFlags();
                return note.controlIcon?.icon.visible;
            });
        });
    await expect.poll(onNotes).toEqual([true, true]);
});

test('a building’s name is hidden from players until the GM reveals it on the Note sheet, and the reveal is kept', async ({ world }) => {
    await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            features: [
                { type: 'stamp', stamp: 'zc-e2e-pack:crate', x: 6, y: 6, reads: 'The Antler Inn', readsHidden: true },
                // Another building beside it, its name never hidden: a reveal records only its own stamp.
                { type: 'stamp', stamp: 'zc-e2e-pack:crate', x: 10, y: 6, reads: 'The Mill' },
            ],
        });
    });
    const state = async (): Promise<unknown> =>
        world.evaluate(() => {
            const note = canvas?.scene?.notes.contents.find((n) => n.text === 'The Antler Inn');
            const stamp = (canvas?.scene?.getFlag('zephyr-cartography', 'features') ?? []).find((f) => f.type === 'stamp' && f.reads === 'The Antler Inn');
            return {
                hidden: note ? foundry.utils.getProperty(note.flags, 'zephyr-cartography.hidden') : null,
                // The GM always sees it, to find it and reveal it.
                gmSees: note?.object?.isVisible,
                recorded: stamp?.type === 'stamp' ? stamp.readsHidden : null,
            };
        });
    await expect.poll(state).toEqual({ hidden: true, gmSees: true, recorded: true });
    // The Note sheet carries the box, checked, and submits it with the sheet.
    const box = async (): Promise<boolean | null> =>
        world.evaluate(async () => {
            const note = canvas?.scene?.notes.contents.find((n) => n.text === 'The Antler Inn');
            if (note === undefined) {
                return null;
            }
            const sheet = new foundry.applications.sheets.NoteConfig({ document: note });
            await sheet.render({ force: true });
            const input = sheet.element.querySelector('input[name="flags.zephyr-cartography.hidden"]');
            const checked = input instanceof HTMLInputElement ? input.checked : null;
            await sheet.close();
            return checked;
        });
    await expect.poll(box).toBe(true);
    // Revealed: the flag clears and the stamp records it, so a re-sync keeps it shown.
    await world.evaluate(async () => {
        await canvas?.scene?.notes.contents.find((n) => n.text === 'The Antler Inn')?.setFlag('zephyr-cartography', 'hidden', false);
    });
    await expect.poll(state).toEqual({ hidden: false, gmSees: true, recorded: false });
});

test('a pin hidden from players is revealed and hidden again from its Note, a cleared mark kept, a plain Note’s sheet unticked', async ({ world }) => {
    await world.evaluate(async () => {
        await game.modules?.get('zephyr-cartography').api.buildSpec({
            schemaVersion: 1,
            features: [
                { type: 'pin', x: 4, y: 4, text: 'The smugglers’ cache', size: 2, hidden: true },
                // A plain pin beside it: no mark, Foundry's own spot, left alone by the reveal.
                { type: 'pin', x: 8, y: 4, text: 'Old well' },
            ],
        });
    });
    const state = async (): Promise<unknown> =>
        world.evaluate(() => {
            const note = canvas?.scene?.notes.contents.find((n) => n.text === 'The smugglers’ cache');
            const pin = (canvas?.scene?.getFlag('zephyr-cartography', 'features') ?? []).find((f) => f.type === 'pin');
            return {
                hidden: note ? foundry.utils.getProperty(note.flags, 'zephyr-cartography.hidden') ?? null : 'no note',
                // A hidden pin that is no sign keeps its icon: only its mark is set, and its spot is sized as asked.
                readable: note ? foundry.utils.getProperty(note.flags, 'zephyr-cartography.readable') ?? null : 'no note',
                sized: (note?.iconSize ?? 0) > 0,
                recorded: pin?.type === 'pin' ? pin.hidden : null,
            };
        });
    await expect.poll(state).toEqual({ hidden: true, readable: null, sized: true, recorded: true });
    const pinNote = async (act: 'reveal' | 'hide' | 'clear' | 'retext' | 'other-mark'): Promise<void> =>
        world.evaluate(async (how) => {
            const note = canvas?.scene?.notes.contents.find((n) => n.text === 'The smugglers’ cache');
            if (how === 'clear') {
                await note?.unsetFlag('zephyr-cartography', 'hidden');
            } else if (how === 'retext') {
                // A change that touches no flag: the mark stands.
                await note?.update({ fontSize: 30 });
            } else if (how === 'other-mark') {
                // Another of the module's marks changed, not this one: the mark stands.
                await note?.setFlag('zephyr-cartography', 'readable', true);
            } else {
                await note?.setFlag('zephyr-cartography', 'hidden', how === 'hide');
            }
        }, act);
    await pinNote('reveal');
    await expect.poll(state).toEqual({ hidden: false, readable: null, sized: true, recorded: false });
    await pinNote('hide');
    await expect.poll(state).toEqual({ hidden: true, readable: null, sized: true, recorded: true });
    await pinNote('retext');
    await pinNote('other-mark');
    await expect.poll(state).toEqual({ hidden: true, readable: true, sized: true, recorded: true });
    await world.evaluate(async () => {
        await canvas?.scene?.notes.contents.find((n) => n.text === 'The smugglers’ cache')?.unsetFlag('zephyr-cartography', 'readable');
    });
    // Cleared outright (the mark removed, not set false): shown, and the pin records it.
    await pinNote('clear');
    await expect.poll(state).toEqual({ hidden: null, readable: null, sized: true, recorded: false });
    const plain = await world.evaluate(() => {
        const note = canvas?.scene?.notes.contents.find((n) => n.text === 'Old well');
        return note === undefined ? 'no note' : foundry.utils.getProperty(note.flags, 'zephyr-cartography') ?? null;
    });
    expect(plain).toBeNull();
    // A Note the module never made: its sheet carries the box, unticked.
    const plainBox = await world.evaluate(async () => {
        const [note] = (await canvas?.scene?.createEmbeddedDocuments('Note', [{ x: 400, y: 400, text: 'A GM’s own note' }])) ?? [];
        if (note === undefined) {
            return null;
        }
        const sheet = new foundry.applications.sheets.NoteConfig({ document: note });
        await sheet.render({ force: true });
        const input = sheet.element.querySelector('input[name="flags.zephyr-cartography.hidden"]');
        const checked = input instanceof HTMLInputElement ? input.checked : null;
        await sheet.close();
        return checked;
    });
    expect(plainBox).toBe(false);
});
