// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { BLOCKS_ALL, type DrawingDoc, type RegionDoc } from '../tools/documents';
import { DEFAULT_TRAVEL } from '../tools/submap';
import type { ZoneShape } from '../tools/zone-shape';
import {
    doorStateFromDs,
    drawingCreateData,
    effectBehaviourId,
    effectBehaviours,
    geometryShape,
    lightCreateData,
    noteCreateData,
    pxToDistance,
    regionCreateData,
    regionShape,
    regionUuid,
    sceneSettingsData,
    soundCreateData,
    tileCreateData,
    tileFrame,
    wallCreateData,
} from './translate';

const GRID = { size: 100, distance: 5 };

const BLOCKS_WALL = { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, door: 'none' as const, doorState: 'closed' as const, blocks: BLOCKS_ALL, level: null };

describe('wallCreateData', () => {
    it('translates a plain wall blocking every sense', () => {
        expect(wallCreateData({ a: { x: 0, y: 0 }, b: { x: 10, y: 5 }, door: 'none', doorState: 'closed', blocks: BLOCKS_ALL, level: null }, GRID)).toEqual({
            c: [0, 0, 10, 5],
            door: 0,
            ds: 0,
            sight: 20,
            light: 20,
            sound: 20,
            move: 20,
        });
    });

    it('translates door type, door state and unblocked senses', () => {
        const data = wallCreateData(
            {
                a: { x: 0, y: 0 },
                b: { x: 1, y: 0 },
                door: 'secret',
                doorState: 'locked',
                blocks: { sight: 'none', movement: true, light: 'none', sound: 'normal' },
                level: null,
            },
            GRID,
        );
        expect(data).toMatchObject({ door: 2, ds: 2, sight: 0, light: 0, sound: 20, move: 20 });
    });

    it('gives a door its sound and animation, leaves unset ones to Foundry, and a plain wall neither', () => {
        const door = { ...BLOCKS_WALL, door: 'door' as const };
        expect(wallCreateData({ ...door, look: { sound: 'slidingMetal', animation: { type: 'slide', duration: 500 } } }, GRID)).toMatchObject({
            doorSound: 'slidingMetal',
            animation: { type: 'slide', duration: 500 },
        });
        const defaults = wallCreateData({ ...door, look: { sound: null, animation: null } }, GRID);
        expect(defaults).not.toHaveProperty('doorSound');
        expect(defaults).not.toHaveProperty('animation');
        const plain = wallCreateData({ ...BLOCKS_WALL, look: { sound: 'metal', animation: { type: 'swing' } } }, GRID);
        expect(plain).not.toHaveProperty('doorSound');
    });

    it('flags a light switch’s wall, so its door control shows a light, and no other wall', () => {
        const door = { ...BLOCKS_WALL, door: 'door' as const };
        expect(wallCreateData({ ...door, lightSwitch: true }, GRID).flags).toEqual({ 'zephyr-cartography': { lightSwitch: true } });
        expect(wallCreateData(door, GRID)).not.toHaveProperty('flags');
    });

    it('notes a cover wall’s grade for the game system’s cover check', () => {
        expect(wallCreateData({ ...BLOCKS_WALL, cover: 0.5 }, GRID).flags).toEqual({ 'zephyr-cartography': { cover: 0.5 } });
    });

    it('translates every sense level, one-way walls and thresholds in scene distance units', () => {
        const data = wallCreateData(
            {
                a: { x: 0, y: 0 },
                b: { x: 1, y: 0 },
                door: 'none',
                doorState: 'closed',
                blocks: { sight: 'limited', movement: false, light: 'proximity', sound: 'distance' },
                direction: 'left',
                threshold: { light: 2, attenuation: true },
                level: null,
            },
            GRID,
        );
        expect(data).toMatchObject({ sight: 10, light: 30, sound: 40, move: 0, dir: 1, threshold: { light: 10, sight: null, sound: null, attenuation: true } });
        expect(wallCreateData({ ...BLOCKS_WALL, direction: 'right' }, GRID).dir).toBe(2);
        expect(wallCreateData(BLOCKS_WALL, GRID)).not.toHaveProperty('dir');
    });

    it('puts a levelled wall on its native Level, and a level-less one on every level', () => {
        const wall = { ...BLOCKS_WALL, level: 'L1' };
        expect(wallCreateData(wall, GRID).levels).toEqual(['L1']);
        expect(wallCreateData({ ...wall, level: null }, GRID).levels).toBeUndefined();
    });
});

describe('doorStateFromDs', () => {
    it('maps Foundry door states back, and rejects unknown values', () => {
        expect([0, 1, 2].map(doorStateFromDs)).toEqual(['closed', 'open', 'locked']);
        expect(doorStateFromDs(7)).toBeNull();
    });
});

describe('pxToDistance', () => {
    it('converts px to scene distance units via the grid', () => {
        expect(pxToDistance(250, GRID)).toBe(12.5);
        expect(pxToDistance(250, { size: 0, distance: 5 })).toBe(0);
    });
});

describe('lightCreateData', () => {
    it('converts radii to distance units and passes optional styling through', () => {
        expect(
            lightCreateData(
                {
                    source: { kind: 'stamp', name: 'Lamp' },
                    x: 1,
                    y: 2,
                    dim: 400,
                    bright: 200,
                    color: '#ff0000',
                    angle: 90,
                    rotation: 45,
                    animation: { type: 'torch' },
                    elevation: 3,
                    level: 'L2',
                },
                GRID,
                'Lamp light',
            ),
        ).toEqual({
            name: 'Lamp light',
            x: 1,
            y: 2,
            elevation: 3,
            rotation: 45,
            config: { dim: 20, bright: 10, color: '#ff0000', angle: 90, animation: { type: 'torch' } },
            levels: ['L2'],
        });
    });

    it('omits absent optional styling and defaults rotation to 0', () => {
        expect(lightCreateData({ source: { kind: 'room' }, x: 0, y: 0, dim: 100, bright: 0, elevation: 0, level: null }, GRID, 'Room light')).toEqual({
            name: 'Room light',
            x: 0,
            y: 0,
            elevation: 0,
            rotation: 0,
            config: { dim: 5, bright: 0 },
        });
    });
});

describe('tileCreateData for a mirrored stamp', () => {
    it('flips its image with Foundry’s own texture scale', () => {
        const tile = {
            name: 'End',
            src: 'a.png',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            rotation: 0,
            elevation: 0,
            level: null,
            featureId: 'f',
            mirror: true as const,
        };
        expect(tileCreateData(tile).texture).toEqual({ src: 'a.png', anchorX: 0.5, anchorY: 0.5, scaleX: -1 });
    });
});

describe('tileCreateData', () => {
    it('places the tile by its centre anchor, with its level and owning feature flag', () => {
        expect(
            tileCreateData({ name: 'Lamp', src: 'a.png', x: 10, y: 20, width: 30, height: 40, rotation: 90, elevation: 5, level: 'L1', featureId: 'f1' }),
        ).toEqual({
            name: 'Lamp',
            texture: { src: 'a.png', anchorX: 0.5, anchorY: 0.5 },
            x: 25,
            y: 40,
            width: 30,
            height: 40,
            rotation: 90,
            elevation: 5,
            // Shown, said outright: an update in place clears a hidden it leaves behind (a trap sprung).
            hidden: false,
            flags: { 'zephyr-cartography': { featureId: 'f1' } },
            levels: ['L1'],
        });
        // Shown on the levels that see its own as well.
        const seen = { name: 'Lamp', src: 'a.png', x: 10, y: 20, width: 30, height: 40, rotation: 0, elevation: 0, level: 'L1', featureId: 'f1' };
        expect(tileCreateData({ ...seen, seenFrom: ['L2'] }).levels).toEqual(['L1', 'L2']);
    });
});

describe('stamp tile and light behaviour', () => {
    const tile = { name: 'Roof', src: 'roof.webp', x: 0, y: 0, width: 100, height: 100, rotation: 0, elevation: 0, level: null, featureId: 'f' };

    it('gives a tile its pack’s opacity, occlusion modes as Foundry’s values, restrictions and video', () => {
        const data = tileCreateData({
            ...tile,
            look: {
                alpha: 0.9,
                hidden: true,
                occlusion: { modes: ['fade', 'radial'], alpha: 0.25 },
                alphaThreshold: 0.5,
                restrictions: { light: true },
                video: { loop: false },
            },
        });
        expect(data).toMatchObject({
            alpha: 0.9,
            hidden: true,
            occlusion: { modes: [1, 4], alpha: 0.25 },
            texture: { alphaThreshold: 0.5 },
            restrictions: { light: true },
            video: { loop: false },
        });
        // A pack that declares nothing leaves every one of them to Foundry.
        expect(JSON.parse(JSON.stringify(tileCreateData(tile)))).not.toHaveProperty('occlusion');
    });

    it('gives a light its rendering technique, with Foundry’s colouration ids, and its walls and vision', () => {
        const light = { source: { kind: 'room' } as const, x: 0, y: 0, dim: 100, bright: 50, elevation: 0, level: null };
        const attenuating = lightCreateData(
            { ...light, technique: { coloration: 'adaptiveAttenuation', luminosity: 0.3, walls: false, vision: true } },
            GRID,
            'L',
        );
        expect(attenuating).toMatchObject({ config: { coloration: 101, luminosity: 0.3 }, walls: false, vision: true });
        expect(lightCreateData({ ...light, technique: { coloration: 'naturalLight', negative: true } }, GRID, 'L').config).toMatchObject({
            coloration: 10,
            negative: true,
        });
        expect(JSON.parse(JSON.stringify(lightCreateData(light, GRID, 'L')))).not.toHaveProperty('walls');
    });

    it('gives a light the darkness range it is active in, and places it hidden when the pack says so', () => {
        const light = { source: { kind: 'room' } as const, x: 0, y: 0, dim: 100, bright: 50, elevation: 0, level: null };
        const nightLamp = lightCreateData({ ...light, technique: { darkness: { min: 0.5, max: 1 }, hidden: true } }, GRID, 'L');
        expect(nightLamp).toMatchObject({ config: { darkness: { min: 0.5, max: 1 } }, hidden: true });
        const plain = JSON.parse(JSON.stringify(lightCreateData(light, GRID, 'L')));
        expect(plain).not.toHaveProperty('hidden');
        expect(plain).not.toHaveProperty('config.darkness');
    });
});

describe('sceneSettingsData', () => {
    it('writes only the settings given, in the Scene’s own shape and ids', () => {
        expect(
            sceneSettingsData({
                darkness: 0.7,
                darknessLock: true,
                globalLight: false,
                tokenVision: true,
                fog: 'shared',
                weather: 'rain',
                transition: { type: 'fade', duration: 800 },
            }),
        ).toEqual({
            environment: { darknessLevel: 0.7, darknessLock: true, globalLight: { enabled: false } },
            tokenVision: true,
            // CONST.FOG_EXPLORATION_MODES.SHARED
            fog: { mode: 2 },
            weather: 'rain',
            transition: { type: 'fade', duration: 800 },
        });
        expect(sceneSettingsData({ fog: 'disabled' })).toEqual({ fog: { mode: 0 } });
        expect(sceneSettingsData({})).toEqual({});
    });

    it('writes the environments and their cycle, and the fog’s colours, each value only if given', () => {
        expect(
            sceneSettingsData({
                cycle: false,
                base: { hue: 0.1, intensity: 0.3 },
                dark: { luminosity: -0.5, shadows: 0.2, saturation: -0.4 },
                fogColours: { unexplored: '#101820' },
            }),
        ).toEqual({
            environment: { cycle: false, base: { hue: 0.1, intensity: 0.3 }, dark: { luminosity: -0.5, saturation: -0.4, shadows: 0.2 } },
            fog: { colors: { unexplored: '#101820' } },
        });
        expect(sceneSettingsData({ fog: 'individual', fogColours: { explored: '#000000' } })).toEqual({ fog: { mode: 1, colors: { explored: '#000000' } } });
        expect(sceneSettingsData({ fogColours: {} })).toEqual({});
    });
});

describe('noteCreateData', () => {
    const note = {
        x: 10.4,
        y: 20.6,
        elevation: 5,
        level: 'lv1',
        text: 'The Sump',
        entry: 'je1',
        page: 'pg1',
        icon: null,
        global: true,
        readable: false,
        size: null,
    };

    it('writes a Note at whole pixels, opening its journal page, with Foundry’s icon when it has none', () => {
        expect(noteCreateData(note)).toEqual({ x: 10, y: 21, elevation: 5, text: 'The Sump', entryId: 'je1', pageId: 'pg1', global: true, levels: ['lv1'] });
        expect(noteCreateData({ ...note, icon: 'icons/svg/tankard.svg', level: null, entry: null, page: null })).toEqual({
            x: 10,
            y: 21,
            elevation: 5,
            text: 'The Sump',
            entryId: null,
            pageId: null,
            global: true,
            texture: { src: 'icons/svg/tankard.svg' },
        });
    });
});

describe('noteCreateData for a sign', () => {
    it('writes a readable Note authorless, so players see it with no journal, flagged to draw no icon, at its size', () => {
        const sign = {
            x: 50,
            y: 60,
            elevation: 0,
            level: null,
            text: 'OPEN LATE',
            entry: null,
            page: null,
            icon: null,
            global: false,
            readable: true,
            size: 48,
        };
        expect(noteCreateData(sign)).toEqual({
            x: 50,
            y: 60,
            elevation: 0,
            text: 'OPEN LATE',
            entryId: null,
            pageId: null,
            global: false,
            iconSize: 48,
            author: null,
            flags: { 'zephyr-cartography': { readable: true } },
        });
    });
});

describe('drawingCreateData', () => {
    it('writes a text-only rectangle Drawing placed by its top-left corner, turning about its centre', () => {
        const drawing: DrawingDoc = {
            kind: 'text',
            x: 500,
            y: 300,
            width: 200,
            height: 61,
            rotation: -10,
            elevation: 5,
            level: 'lv1',
            text: 'Residence District 4',
            fontSize: 40,
            colour: '#e0c080',
            fontFamily: 'Amiri',
            hidden: true,
        };
        // CONST.DRAWING_FILL_TYPES.NONE is 0.
        expect(drawingCreateData(drawing)).toEqual({
            shape: { type: 'r', width: 200, height: 61 },
            x: 400,
            y: 270,
            elevation: 5,
            rotation: -10,
            fillType: 0,
            strokeWidth: 0,
            text: 'Residence District 4',
            fontSize: 40,
            fontFamily: 'Amiri',
            textColor: '#e0c080',
            hidden: true,
            levels: ['lv1'],
        });
    });

    it('writes a drawn shape’s box, points, stroke and solid fill, and leaves a shape without fill unfilled', () => {
        const style = { strokeColour: '#ff0000', strokeWidth: 4, strokeAlpha: 0.8, fillColour: '#00ff00', fillAlpha: 0.3, hidden: false };
        const polygon = {
            kind: 'shape',
            x: 150,
            y: 125,
            width: 100,
            height: 50,
            rotation: 0,
            shape: 'p',
            points: [0, 0, 100, 0, 50, 50, 0, 0],
            elevation: 0,
            level: null,
            style,
        } as const;
        // CONST.DRAWING_FILL_TYPES.SOLID is 1.
        expect(drawingCreateData(polygon)).toEqual({
            shape: { type: 'p', width: 100, height: 50, points: [0, 0, 100, 0, 50, 50, 0, 0] },
            x: 100,
            y: 100,
            elevation: 0,
            rotation: 0,
            strokeWidth: 4,
            strokeColor: '#ff0000',
            strokeAlpha: 0.8,
            fillType: 1,
            fillColor: '#00ff00',
            fillAlpha: 0.3,
            hidden: false,
        });
        const ellipse = { ...polygon, shape: 'e', points: [], rotation: 30, style: { ...style, fillColour: null } } as const;
        expect(drawingCreateData(ellipse)).toMatchObject({ shape: { type: 'e', width: 100, height: 50 }, rotation: 30, fillType: 0 });
        expect(drawingCreateData(ellipse)).not.toHaveProperty('fillColor');
        expect(drawingCreateData(ellipse).shape).not.toHaveProperty('points');
    });
});

describe('soundCreateData', () => {
    it('converts the radius to distance units and keeps the level', () => {
        expect(
            soundCreateData(
                { name: 'Lamp', x: 1, y: 2, radius: 300, path: 'hum.ogg', volume: 0.4, repeat: true, walls: false, easing: true, elevation: 3, level: 'L1' },
                GRID,
                'Lamp sound',
            ),
        ).toEqual({
            name: 'Lamp sound',
            x: 1,
            y: 2,
            elevation: 3,
            radius: 15,
            path: 'hum.ogg',
            volume: 0.4,
            repeat: true,
            walls: false,
            easing: true,
            levels: ['L1'],
        });
    });
});

describe('tileFrame', () => {
    it('reads back the top-left the tile was created from', () => {
        const tile = { name: 'Lamp', src: 'a.png', x: 10, y: 20, width: 30, height: 40, rotation: 45, elevation: 0, level: null, featureId: 'f1' };
        expect(tileFrame(tileCreateData(tile))).toEqual({ x: 10, y: 20, width: 30, height: 40, rotation: 45 });
    });

    it('honours any anchor a GM set', () => {
        expect(tileFrame({ x: 100, y: 100, width: 50, height: 20, rotation: 0, texture: { anchorX: 0, anchorY: 1 } })).toEqual({
            x: 100,
            y: 80,
            width: 50,
            height: 20,
            rotation: 0,
        });
    });

    it('rounds a fractional centre to the integer Foundry stores', () => {
        const data = tileCreateData({ name: 'Lamp', src: 'a.png', x: 0, y: 0, width: 5, height: 3, rotation: 0, elevation: 0, level: null, featureId: 'f' });
        expect([data.x, data.y]).toEqual([3, 2]);
    });
});

describe('regionCreateData', () => {
    const square = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
    ];
    const nameOf = (r: RegionDoc): string => `${r.label.kind} ${r.level ?? ''}`;
    const SCENE = 'sceneAAAAAAAAAAA';
    /** A 2×1 token standing at (300, 200), the one token on the scene. */
    const FOOTPRINT = { x: 300, y: 200, width: 2, height: 1, shape: 4 };
    const CONTEXT = { nameOf, hazardText: (kind: string) => `${kind}!`, scene: SCENE, tokenOf: (id: string) => (id === 'tk1' ? FOOTPRINT : null) };

    it('warns of a hazard over a token coming into its region, in the GM’s language, for everyone to see', () => {
        const fire: RegionDoc = {
            id: null,
            label: { kind: 'stamp-hazard', name: 'Burning Barrel' },
            polygon: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 100, y: 100 },
            ],
            bottom: null,
            top: null,
            level: null,
            spans: [],
            behaviour: { kind: 'hazard', hazard: 'fire' },
        };
        expect(regionCreateData([fire], ['h0'], CONTEXT)[0]?.behaviors).toEqual([
            { type: 'displayScrollingText', system: { events: ['tokenAnimateIn'], text: 'fire!', color: '#f1c40f', visibility: 2, once: false } },
        ]);
    });

    it('makes a stair a native changeLevel region on every level it joins', () => {
        const stair: RegionDoc = {
            id: null,
            label: { kind: 'stairs', from: 'A', to: ['B', 'C'] },
            polygon: square,
            bottom: -10,
            top: 20,
            level: 'A',
            spans: ['B', 'C'],
            behaviour: { kind: 'changeLevel', movement: ['walk', 'climb'] },
        };
        expect(regionCreateData([stair], ['r0'], CONTEXT)).toEqual([
            {
                _id: 'r0',
                name: 'stairs A',
                color: '#4a90d9',
                shapes: [{ type: 'polygon', points: [0, 0, 10, 0, 10, 10], hole: false }],
                elevation: { bottom: -10, top: 20 },
                behaviors: [{ type: 'changeLevel', system: { movementActions: ['walk', 'climb'] } }],
                locked: true,
                visibility: 0,
                levels: ['A', 'B', 'C'],
            },
        ]);
    });

    it('adds an area’s effects as native behaviours after its movement cost, with Foundry’s enum values', () => {
        const room: RegionDoc = {
            id: null,
            label: { kind: 'room' },
            polygon: square,
            bottom: null,
            top: null,
            level: null,
            spans: [],
            behaviour: { kind: 'terrain', difficulties: { walk: 2 } },
            effects: [
                { kind: 'darkness', mode: 'darken', modifier: 0.5 },
                { kind: 'suppressWeather' },
                { kind: 'text', text: 'Hot', colour: '#ff0000', visibility: 'observer', once: true, events: ['tokenTurnStart'] },
                { kind: 'pause', once: true },
                { kind: 'macro', uuid: 'Macro.m', everyone: true, events: ['tokenEnter'] },
                { kind: 'script', source: 'return;', events: ['tokenExit'] },
                { kind: 'activeEffect', effects: ['Item.i.ActiveEffect.e'] },
            ],
        };
        const id = (i: number): string => `roomRegion00Bh0${i}`;
        expect(regionCreateData([room], ['roomRegion000001'], CONTEXT)[0]?.behaviors).toEqual([
            { type: 'modifyMovementCost', system: { difficulties: { walk: 2 } } },
            { _id: id(0), type: 'adjustDarknessLevel', system: { mode: 2, modifier: 0.5 } },
            { _id: id(1), type: 'suppressWeather', system: {} },
            { _id: id(2), type: 'displayScrollingText', system: { events: ['tokenTurnStart'], text: 'Hot', color: '#ff0000', visibility: 1, once: true } },
            { _id: id(3), type: 'pauseGame', system: { once: true } },
            { _id: id(4), type: 'executeMacro', system: { events: ['tokenEnter'], uuid: 'Macro.m', everyone: true } },
            { _id: id(5), type: 'executeScript', system: { events: ['tokenExit'], source: 'return;' } },
            { _id: id(6), type: 'applyActiveEffect', system: { effects: ['Item.i.ActiveEffect.e'] } },
        ]);
    });

    it('gives each behaviour of an area an id up front, so a toggle names the others by UUID, and starts disabled ones off', () => {
        const effects = [
            { kind: 'darkness', mode: 'override', modifier: 1, disabled: true },
            { kind: 'toggle', events: ['tokenEnter'], enable: [0], disable: [2] },
            { kind: 'suppressWeather' },
        ] as const;
        const behaviours = effectBehaviours(effects, { scene: SCENE, region: 'lightsOutRoom001' });
        // The region id's first 12 characters, then Bh and the behaviour's place.
        expect(behaviours.map((b) => b._id)).toEqual(['lightsOutRooBh00', 'lightsOutRooBh01', 'lightsOutRooBh02']);
        expect(behaviours[0]).toMatchObject({ type: 'adjustDarknessLevel', disabled: true });
        expect(behaviours[1]).toEqual({
            _id: effectBehaviourId('lightsOutRoom001', 1),
            type: 'toggleBehavior',
            system: {
                events: ['tokenEnter'],
                enable: [`Scene.${SCENE}.Region.lightsOutRoom001.RegionBehavior.${effectBehaviourId('lightsOutRoom001', 0)}`],
                disable: [`Scene.${SCENE}.Region.lightsOutRoom001.RegionBehavior.${effectBehaviourId('lightsOutRoom001', 2)}`],
            },
        });
        expect(behaviours[2]).not.toHaveProperty('disabled');
        // A valid 16-character document id, unique within the region.
        expect(effectBehaviourId('lightsOutRoom001', 40)).toMatch(/^[a-zA-Z0-9]{16}$/u);
    });

    it('sends a rectangular outline, rotated or not, as Foundry’s own rectangle shape centred on its anchor', () => {
        expect(
            regionShape([
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 300, y: 100 },
                { x: 300, y: 200 },
                { x: 100, y: 200 },
            ]),
        ).toEqual({ type: 'rectangle', x: 200, y: 150, width: 200, height: 100, anchorX: 0.5, anchorY: 0.5, rotation: 0, hole: false });
        expect(
            regionShape([
                { x: 0, y: 0 },
                { x: 0, y: 100 },
                { x: -50, y: 100 },
                { x: -50, y: 0 },
            ]),
        ).toMatchObject({ type: 'rectangle', x: -25, y: 50, width: 100, height: 50, rotation: 90 });
        expect(regionShape(square)).toEqual({ type: 'polygon', points: [0, 0, 10, 0, 10, 10], hole: false });
    });

    it('sends a zone’s shape as Foundry’s own shape data, and attaches it to its token', () => {
        const placed = { x: 10, y: 20, rotation: 30, gridBased: true };
        const on = { x: 10, y: 20, gridBased: true, hole: false };
        const shapes: ZoneShape[] = [
            { kind: 'circle', radius: 5 },
            { kind: 'ellipse', radiusX: 5, radiusY: 3 },
            { kind: 'ring', radius: 5, innerWidth: 1, outerWidth: 2 },
            { kind: 'cone', radius: 5, angle: 60, curvature: 'flat' },
            { kind: 'line', length: 8, width: 2 },
            { kind: 'rectangle', width: 8, height: 4 },
        ];
        expect(shapes.map((shape) => geometryShape({ ...shape, ...placed }, null))).toEqual([
            { type: 'circle', ...on, radius: 5 },
            { type: 'ellipse', ...on, radiusX: 5, radiusY: 3, rotation: 30 },
            { type: 'ring', ...on, radius: 5, innerWidth: 1, outerWidth: 2 },
            { type: 'cone', ...on, radius: 5, angle: 60, rotation: 30, curvature: 'flat' },
            { type: 'line', ...on, length: 8, width: 2, rotation: 30 },
            { type: 'rectangle', ...on, width: 8, height: 4, anchorX: 0.5, anchorY: 0.5, rotation: 30 },
        ]);
        // Grid spaces go by row and column from the cell the zone's point (10, 20) is in, on a 10 px grid: row 2, column 1.
        const cells = {
            kind: 'cells',
            size: 10,
            cells: [
                { i: 0, j: 0 },
                { i: 0, j: 1 },
            ],
        } as const;
        expect(geometryShape({ ...cells, ...placed }, null)).toEqual({
            type: 'grid',
            offsets: [
                { i: 2, j: 1 },
                { i: 2, j: 2 },
            ],
            origin: null,
            hole: false,
        });
        const zone: RegionDoc = {
            id: null,
            label: { kind: 'zone', title: '' },
            polygon: [],
            bottom: null,
            top: null,
            level: null,
            spans: [],
            behaviour: null,
            geometry: { kind: 'circle', radius: 5, ...placed },
            attachedTo: 'tk1',
        };
        expect(regionCreateData([zone], ['z1'], CONTEXT)[0]).toMatchObject({ shapes: [{ type: 'circle', radius: 5 }], attachment: { token: 'tk1' } });
        // An emanation rounds its token's own footprint, read off the live token; a circle while it has none there.
        const aura: RegionDoc = { ...zone, geometry: { kind: 'emanation', radius: 150, ...placed } };
        expect(regionCreateData([aura], ['z2'], CONTEXT)[0]?.shapes).toEqual([
            { type: 'emanation', base: { type: 'token', ...FOOTPRINT, hole: false }, radius: 150, gridBased: true, hole: false },
        ]);
        expect(regionCreateData([{ ...aura, attachedTo: 'gone' }], ['z3'], CONTEXT)[0]?.shapes).toEqual([{ type: 'circle', ...on, radius: 150 }]);
    });

    it('gives a region without a behaviour none, on its own level', () => {
        const plain: RegionDoc = {
            id: null,
            label: { kind: 'terrain', biome: 'forest' },
            polygon: square,
            bottom: 0,
            top: 10,
            level: 'C',
            spans: [],
            behaviour: null,
        };
        const [data] = regionCreateData([plain], ['r2'], CONTEXT);
        expect(data?.behaviors).toEqual([]);
        expect(data?.levels).toEqual(['C']);
    });

    it('shows an area’s region as chosen, with Foundry’s visibility ids, and shapes it by walls only on exactly one level', () => {
        const display = {
            visibility: 'observer',
            highlight: 'coverage',
            measurements: true,
            observed: true,
            restriction: { type: 'sight', priority: 3 },
            hidden: true,
        } as const;
        const area: RegionDoc = { id: null, label: { kind: 'room' }, polygon: square, bottom: 0, top: 10, level: 'C', spans: [], behaviour: null, display };
        const [one, everywhere, spanning] = regionCreateData([area, { ...area, level: null }, { ...area, spans: ['D'] }], ['r1', 'r2', 'r3'], CONTEXT);
        expect(one).toMatchObject({
            visibility: 3,
            highlightMode: 'coverage',
            displayMeasurements: true,
            restriction: { enabled: true, type: 'sight', priority: 3 },
            // Every player an observer: DOCUMENT_OWNERSHIP_LEVELS.OBSERVER.
            ownership: { default: 2 },
            hidden: true,
        });
        expect(everywhere).not.toHaveProperty('restriction');
        expect(spanning).not.toHaveProperty('restriction');
        const { display: _shown, ...undisplayed } = area;
        const [plain] = regionCreateData([undisplayed], ['r4'], CONTEXT);
        expect(plain).toMatchObject({ visibility: 0 });
        expect(plain).not.toHaveProperty('highlightMode');
        expect(plain).not.toHaveProperty('ownership');
        expect(plain).not.toHaveProperty('hidden');
    });

    it('makes a floor a solid defineSurface at its bottom, on its level and the one seen from below', () => {
        const floor: RegionDoc = {
            id: null,
            label: { kind: 'floor', level: 'Upper' },
            polygon: square,
            bottom: 10,
            top: 10,
            level: 'B',
            spans: ['A', 'B'],
            behaviour: { kind: 'surface', placement: 'bottom', reveal: false },
        };
        const [data] = regionCreateData([floor], ['r4'], CONTEXT);
        expect(data?.behaviors).toEqual([
            {
                type: 'defineSurface',
                system: { placement: 'bottom', light: true, move: true, sight: true, sound: true, occlusion: true, exposure: false },
            },
        ]);
        expect(data?.elevation).toEqual({ bottom: 10, top: 10 });
        // Each level once, however it is listed.
        expect(data?.levels).toEqual(['B', 'A']);
    });

    it('teleports to regions in another scene, relative, with a choice when there are several', () => {
        const many: RegionDoc = {
            id: null,
            label: { kind: 'entrance', scene: 'Residence' },
            polygon: square,
            bottom: null,
            top: null,
            level: null,
            spans: [],
            behaviour: {
                kind: 'teleport',
                targets: [
                    { scene: 'residence', region: 'a' },
                    { scene: 'residence', region: 'b' },
                ],
                travel: { placement: 'center', snap: false, revealed: true, transition: 'swirl', duration: 2000, prompt: 'Enter {scene}?' },
            },
        };
        expect(regionCreateData([many], ['r3'], CONTEXT)[0]?.behaviors).toEqual([
            {
                type: 'teleportToken',
                system: {
                    destinations: ['Scene.residence.Region.a', 'Scene.residence.Region.b'],
                    placement: 'center',
                    snap: false,
                    choice: true,
                    revealed: true,
                    dialog: { revealed: 'Enter {scene}?', unrevealed: 'Enter {scene}?' },
                    transition: { type: 'swirl', duration: 2000 },
                },
            },
        ]);
    });

    it('addresses a region in another scene directly, with an open-ended band', () => {
        const entrance: RegionDoc = {
            id: 'in1',
            label: { kind: 'entrance', scene: 'Residence' },
            polygon: square,
            bottom: null,
            top: null,
            level: null,
            spans: [],
            behaviour: { kind: 'teleport', targets: [{ scene: 'residence', region: 'out1' }], travel: DEFAULT_TRAVEL },
        };
        const [data] = regionCreateData([entrance], ['in1'], CONTEXT);
        expect(data?.elevation).toEqual({ bottom: null, top: null });
        expect(data?.behaviors[0]?.system).toEqual({
            destinations: ['Scene.residence.Region.out1'],
            placement: 'relative',
            snap: true,
            choice: false,
            revealed: false,
            dialog: { revealed: null, unrevealed: null },
            transition: { type: null, duration: 1500 },
        });
        expect(regionUuid('a', 'b')).toBe('Scene.a.Region.b');
    });

    it('locks regions drawn from features, but leaves an interior exit for the GM to move', () => {
        const exit: RegionDoc = {
            id: 'out1',
            label: { kind: 'exit', scene: 'Town' },
            polygon: square,
            bottom: null,
            top: null,
            level: null,
            spans: [],
            behaviour: null,
        };
        const [entrance, back] = regionCreateData([{ ...exit, id: 'in1', label: { kind: 'entrance', scene: 'Residence' } }, exit], ['in1', 'out1'], CONTEXT);
        expect([entrance?.locked, back?.locked]).toEqual([true, false]);
        expect([entrance?.visibility, back?.visibility]).toEqual([0, 0]);
    });
});
