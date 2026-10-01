// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { formatSpecIssue, parseSceneSpec, parseSceneSpecJson } from './spec';

const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
];

describe('parseSceneSpec', () => {
    it('accepts a spec, filling in the defaults', () => {
        const result = parseSceneSpec({ schemaVersion: 1, features: [{ type: 'room', points: square, doors: [{ segment: 1 }] }] });
        expect(result).toEqual({
            ok: true,
            spec: {
                schemaVersion: 1,
                units: 'grid',
                levels: [],
                splats: [],
                features: [
                    {
                        type: 'room',
                        points: square,
                        wall: null,
                        wallKind: 'solid',
                        ceiling: true,
                        lit: true,
                        movementCost: 1,
                        effects: [],
                        display: { visibility: 'layer', highlight: 'shapes', measurements: false, observed: false, restriction: null, hidden: false },
                        spawn: { actors: [], placement: 'random', snap: true, avoidOccupied: true },
                        doors: [{ segment: 1, type: 'door', state: 'closed', sound: null, animation: null }],
                    },
                ],
            },
        });
    });

    it('accepts every feature type', () => {
        const result = parseSceneSpec({
            schemaVersion: 1,
            units: 'px',
            levels: [{ key: 'g', name: 'Ground', bottom: 0, top: 10 }],
            features: [
                { type: 'region', biome: 'forest', points: square },
                { type: 'stroke', biome: 'sand', points: square.slice(0, 2), radius: 30 },
                { type: 'path', kind: 'road', points: square.slice(0, 2), halfWidth: 12, walls: true, level: 'g' },
                { type: 'room', points: square, floor: 'floor.oak', wall: 'wall.brick' },
                { type: 'stamp', stamp: 'pack:residence', x: 2, y: 2, rotation: 90, interior: { create: 'Residence interior' } },
                { type: 'stamp', stamp: 'pack:residence', x: 8, y: 2, interior: { scene: 'abc' } },
            ],
        });
        expect(result.ok).toBe(true);
    });

    it('reports schema violations with their paths', () => {
        const result = parseSceneSpec({ schemaVersion: 1, features: [{ type: 'region', biome: 'quicksand', points: square }] });
        expect(result.ok ? null : result.issues[0]?.path).toBe('features.0.biome');
        expect(parseSceneSpec({ schemaVersion: 2, features: [] }).ok).toBe(false);
        expect(parseSceneSpec({ schemaVersion: 1, features: [{ type: 'room', points: square, floor: 'marble' }] }).ok).toBe(false);
        expect(parseSceneSpec({ schemaVersion: 1, features: [{ type: 'room', points: square, wall: 'brick' }] }).ok).toBe(false);
        expect(parseSceneSpec('nope').ok).toBe(false);
    });

    it('takes toggles naming other behaviours of their own area, each once', () => {
        const withEffects = (effects: unknown[]): ReturnType<typeof parseSceneSpec> =>
            parseSceneSpec({ schemaVersion: 1, features: [{ type: 'room', points: square, effects }] });
        const good = withEffects([
            { kind: 'darkness', disabled: true },
            { kind: 'toggle', events: ['tokenEnter'], enable: [0] },
        ]);
        expect(good.ok && good.spec.features[0]?.type === 'room' ? good.spec.features[0].effects : null).toEqual([
            { kind: 'darkness', mode: 'override', modifier: 0, disabled: true },
            { kind: 'toggle', events: ['tokenEnter'], enable: [0], disable: [], disabled: false },
        ]);
        const paths = (effects: unknown[]): string[] => {
            const result = withEffects(effects);
            return result.ok ? [] : result.issues.map((i) => i.path);
        };
        expect(paths([{ kind: 'toggle', enable: [0] }])).toEqual(['features.0.effects.0']);
        expect(paths([{ kind: 'pause' }, { kind: 'toggle', enable: [3] }])).toEqual(['features.0.effects.1']);
        expect(paths([{ kind: 'pause' }, { kind: 'toggle', enable: [0], disable: [0] }])).toEqual(['features.0.effects.1']);
    });

    it('takes zones in Foundry’s shapes, and reports a shape Foundry would refuse', () => {
        const zone = (shape: object): ReturnType<typeof parseSceneSpec> =>
            parseSceneSpec({ schemaVersion: 1, features: [{ type: 'zone', x: 1, y: 1, shape }] });
        const good = zone({ kind: 'cone', radius: 3, angle: 60 });
        expect(good.ok ? good.spec.features[0] : null).toMatchObject({
            shape: { kind: 'cone', radius: 3, angle: 60, curvature: 'round' },
            name: '',
            rotation: 0,
            gridBased: false,
            attachedTo: null,
        });
        const issues = (shape: object): string[] => {
            const result = zone(shape);
            return result.ok ? [] : result.issues.map((i) => i.path);
        };
        expect(issues({ kind: 'ring', radius: 2, innerWidth: 3, outerWidth: 1 })).toEqual(['features.0.shape']);
        expect(issues({ kind: 'cone', radius: 2, angle: 120, curvature: 'flat' })).toEqual(['features.0.shape']);
        expect(issues({ kind: 'circle', radius: 0 })).toEqual(['features.0.shape.radius']);
        expect(issues({ kind: 'cells', cells: [{ i: 0, j: 0 }] })).toEqual([]);
        expect(issues({ kind: 'cells', cells: [] })).toEqual(['features.0.shape.cells']);
        expect(
            issues({
                kind: 'cells',
                cells: [
                    { i: 1, j: 1 },
                    { i: 1, j: 1 },
                ],
            }),
        ).toEqual(['features.0.shape']);
    });

    it('takes drawn shapes, and reports one missing what its kind stands on', () => {
        const good = parseSceneSpec({ schemaVersion: 1, features: [{ type: 'shape', kind: 'line', points: square.slice(0, 2) }] });
        expect(good.ok ? good.spec.features[0] : null).toMatchObject({
            stroke: { colour: '#ffffff', width: 8, alpha: 1 },
            fill: null,
            rotation: 0,
            hidden: false,
        });
        const paths = (feature: object): string[] => {
            const result = parseSceneSpec({ schemaVersion: 1, features: [{ type: 'shape', ...feature }] });
            return result.ok ? [] : result.issues.map((i) => i.path);
        };
        expect(paths({ kind: 'polygon', points: square.slice(0, 2) })).toEqual(['features.0.points']);
        expect(paths({ kind: 'line' })).toEqual(['features.0.points']);
        expect(paths({ kind: 'rectangle', x: 1, y: 1, width: 2 })).toEqual(['features.0']);
        expect(paths({ kind: 'ellipse', x: 1, y: 1, width: 2, height: 1, fill: { colour: '#123456' } })).toEqual([]);
    });

    it('parses JSON text, reporting text that is not JSON at the root', () => {
        expect(parseSceneSpecJson('{"schemaVersion": 1, "features": []}').ok).toBe(true);
        const broken = parseSceneSpecJson('{"schemaVersion": 1,');
        expect(broken.ok ? null : broken.issues.map((i) => i.path)).toEqual(['']);
        const wrong = parseSceneSpecJson('{"schemaVersion": 2, "features": []}');
        expect(wrong.ok ? null : wrong.issues.map(formatSpecIssue)[0]).toMatch(/^schemaVersion: /);
        expect(formatSpecIssue({ path: '', message: 'bad' })).toBe('bad');
    });

    it('reports duplicate level keys, unknown level references and doors off the room', () => {
        const result = parseSceneSpec({
            schemaVersion: 1,
            levels: [
                { key: 'g', name: 'Ground' },
                { key: 'g', name: 'Again' },
            ],
            features: [
                { type: 'region', biome: 'forest', points: square, level: 'roof' },
                { type: 'room', points: square, doors: [{ segment: 4 }] },
            ],
        });
        expect(result.ok ? [] : result.issues.map((i) => i.path)).toEqual(['levels.1.key', 'features.0.level', 'features.1.doors.0.segment']);
    });

    it('reports a splat map on a level it does not have, and a fifth stacked on one level', () => {
        const roles = ['sand', null, null, null];
        const onGround = [1, 2, 3, 4, 5].map((n) => ({ level: 'g', mask: `maps/g${n}.png`, roles }));
        const result = parseSceneSpec({
            schemaVersion: 1,
            levels: [{ key: 'g', name: 'Ground' }],
            splats: [...onGround, { level: 'attic', mask: 'maps/a.png', roles }, { mask: 'maps/all.png', roles }],
            features: [],
        });
        expect(result.ok ? [] : result.issues).toEqual([
            { path: 'splats.4.level', message: 'a level stacks 4 splat maps at most' },
            { path: 'splats.5.level', message: 'no level with key "attic"' },
        ]);
    });

    it('reports duplicate feature keys, and visible levels and switch controls that name no key', () => {
        const result = parseSceneSpec({
            schemaVersion: 1,
            levels: [{ key: 'g', name: 'Ground', visibleLevels: ['cellar'] }],
            features: [
                { type: 'room', key: 'hall', points: square },
                { type: 'room', key: 'hall', points: square },
                { type: 'stamp', stamp: 'pack:switch', x: 0, y: 0, controls: ['hall', 'kitchen'] },
            ],
        });
        expect(result.ok ? [] : result.issues).toEqual([
            { path: 'features.1.key', message: 'duplicate feature key "hall"' },
            { path: 'levels.0.visibleLevels.0', message: 'no level with key "cellar"' },
            { path: 'features.2.controls.1', message: 'no feature with key "kitchen"' },
        ]);
    });
});
