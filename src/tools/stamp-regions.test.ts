// SPDX-License-Identifier: AGPL-3.0-or-later
/** A stamp's terrain and surface regions: difficult terrain and Define Surface floors and roofs over its footprint. */
import { describe, expect, it } from 'vitest';
import { catalogStamps } from '../canvas/test-fakes';
import type { Level } from './levels';
import { NO_LEVEL_ART } from './levels';
import { planDocuments } from './plan';
import { makeStamp, type StampFeature } from './stamp';

const [rubble, roof, awning, crate, boulder] = catalogStamps([
    {
        id: 'rubble',
        name: 'Rubble',
        category: 'Debris',
        scale: 'interior',
        perspective: 'top-down',
        terrain: { difficulty: { walk: 2, climb: 3 } },
        variants: [
            { state: 'heap', image: 'heap.png', width: 100, height: 100 },
            { state: 'cleared', image: 'cleared.png', width: 100, height: 100, terrain: null },
        ],
    },
    {
        id: 'roof',
        name: 'Roof',
        category: 'Structures',
        scale: 'exterior',
        perspective: 'top-down',
        physical: { height: 3 },
        surface: { placement: 'top', reveal: true },
        variants: [{ state: 'tiled', image: 'roof.png', width: 200, height: 200 }],
    },
    {
        id: 'awning',
        name: 'Awning',
        category: 'Structures',
        scale: 'exterior',
        perspective: 'top-down',
        surface: { placement: 'top', reveal: false },
        variants: [{ state: 'up', image: 'awning.png', width: 100, height: 100 }],
    },
    {
        id: 'crate',
        name: 'Crate',
        category: 'Storage',
        scale: 'interior',
        perspective: 'top-down',
        variants: [{ state: 'x', image: 'c.png', width: 100, height: 100 }],
    },
    {
        id: 'boulder',
        name: 'Boulder',
        category: 'Terrain',
        scale: 'exterior',
        perspective: 'top-down',
        physical: { blocksMovement: true },
        variants: [
            { state: 'whole', image: 'boulder.png', width: 100, height: 100 },
            { state: 'shattered', image: 'gravel.png', width: 100, height: 100, physical: { blocksMovement: false } },
        ],
    },
]);

const GROUND: Level = { id: 'g', name: 'Ground', bottom: 0, top: 20, art: NO_LEVEL_ART };

function place(stampDef: typeof rubble, extra: { variant?: number } = {}, level: string | null = null): StampFeature {
    if (!stampDef) {
        throw new Error('missing fixture');
    }
    return { ...makeStamp('s1', stampDef, { stamp: stampDef.key, x: 100, y: 100, ...extra }, 100), level };
}

function regions(stamp: StampFeature, gridDistance = 5): ReturnType<typeof planDocuments>['regions'] {
    return planDocuments(stamp, { features: [stamp], levels: [GROUND], terrainRegions: false, gridDistance }).regions;
}

describe('stamp regions', () => {
    it('lays difficult terrain over the footprint, on the stamp’s level, as its variant declares', () => {
        expect(regions(place(rubble, {}, 'g'))).toEqual([
            expect.objectContaining({
                label: { kind: 'stamp-terrain', name: 'Rubble' },
                level: 'g',
                bottom: 0,
                top: 20,
                behaviour: { kind: 'terrain', difficulties: { walk: 2, climb: 3 } },
            }),
        ]);
        expect(regions(place(rubble, {}, 'g'))[0]?.polygon).toHaveLength(4);
        // A variant with `terrain: null` (cleared rubble) has none.
        expect(regions(place(rubble, { variant: 1 }))).toEqual([]);
    });

    it('puts a surface over the footprint up the stamp’s height, revealed as the pack says', () => {
        expect(regions(place(roof))).toEqual([
            expect.objectContaining({
                label: { kind: 'stamp-surface', name: 'Roof' },
                bottom: 0,
                top: 15,
                behaviour: { kind: 'surface', placement: 'top', reveal: true },
            }),
        ]);
    });

    it('gives a surface of unknown height its level’s band, and none with no band to go on', () => {
        expect(regions(place(awning, {}, 'g'))).toEqual([expect.objectContaining({ bottom: 0, top: 20 })]);
        expect(regions(place(awning))).toEqual([]);
        // Without the scene's grid distance a height means nothing either.
        expect(regions(place(roof, {}, 'g'), 0)).toEqual([expect.objectContaining({ bottom: 0, top: 20 })]);
    });

    it('walls round the footprint of a stamp tokens cannot pass, barring movement alone, while its variant says so', () => {
        const walls = (stamp: StampFeature): ReturnType<typeof planDocuments>['walls'] => planDocuments(stamp).walls;
        // A region restriction clips a region to walls and bars nothing, so a body is walls, and no region at all.
        expect(regions(place(boulder, {}, 'g'))).toEqual([]);
        const body = walls(place(boulder, {}, 'g'));
        expect(body).toHaveLength(4);
        expect(body.map(({ door, blocks, level }) => ({ door, blocks, level }))).toEqual(
            Array.from({ length: 4 }, () => ({ door: 'none', blocks: { sight: 'none', light: 'none', sound: 'none', movement: true }, level: 'g' })),
        );
        expect(walls(place(boulder, { variant: 1 }, 'g'))).toEqual([]);
    });

    it('rings a low piece that gives cover with walls restricting nothing, graded with its cover, for the cover check', () => {
        const [table, sandbags] = catalogStamps([
            {
                id: 'table',
                name: 'Table',
                category: 'Furniture',
                scale: 'interior',
                perspective: 'top-down',
                tags: ['table'],
                variants: [{ state: 'x', image: 't.png', width: 100, height: 100 }],
            },
            {
                id: 'sandbags',
                name: 'Sandbags',
                category: 'Defence',
                scale: 'exterior',
                perspective: 'top-down',
                physical: { cover: 0.75, blocksMovement: true },
                variants: [{ state: 'x', image: 's.png', width: 100, height: 100 }],
            },
        ]);
        const cover = planDocuments(place(table, {}, 'g')).walls;
        expect(cover).toHaveLength(4);
        expect(cover.map(({ blocks, cover: grade, level }) => ({ blocks, grade, level }))).toEqual(
            Array.from({ length: 4 }, () => ({ blocks: { sight: 'none', movement: false, light: 'none', sound: 'none' }, grade: 0.5, level: 'g' })),
        );
        // Walls barring movement already stop the cover check's rays: a defence gets its body walls and no cover walls besides.
        const defence = planDocuments(place(sandbags, {}, 'g')).walls;
        expect(defence).toHaveLength(4);
        expect(defence.every((w) => w.cover === undefined && w.blocks.movement)).toBe(true);
        // A piece giving no cover gets none.
        expect(planDocuments(place(crate, {}, 'g')).walls).toEqual([]);
    });

    it('lays a hazard region over the footprint and its reach, on the stamp’s level, warning of the harm', () => {
        const [barrel] = catalogStamps([
            {
                id: 'barrel',
                name: 'Burning Barrel',
                category: 'Hazard',
                scale: 'exterior',
                perspective: 'top-down',
                hazard: { kind: 'fire', reach: 1 },
                variants: [{ state: 'lit', image: 'b.png', width: 100, height: 100 }],
            },
        ]);
        const [hazard] = regions(place(barrel, {}, 'g'));
        expect(hazard).toMatchObject({ label: { kind: 'stamp-hazard', name: 'Burning Barrel' }, level: 'g', behaviour: { kind: 'hazard', hazard: 'fire' } });
        // One square of the 100 px grid round the 100 px footprint centred at (100, 100).
        const xs = hazard?.polygon.map((p) => p.x) ?? [];
        const ys = hazard?.polygon.map((p) => p.y) ?? [];
        expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([-50, 250, -50, 250]);
    });

    it('hangs an overhead stamp’s tile at its height, so a token beneath is below it and it gives way; others lie at their base', () => {
        const [tentRoof] = catalogStamps([
            {
                id: 'tent-roof',
                name: 'Tent Roof',
                category: 'Structure',
                scale: 'exterior',
                perspective: 'top-down',
                tags: ['tent', 'roof'],
                variants: [{ state: 'x', image: 'r.png', width: 100, height: 100 }],
            },
        ]);
        const tile = (stamp: StampFeature): number | undefined =>
            planDocuments(stamp, { features: [stamp], levels: [GROUND], terrainRegions: false, gridDistance: 5 }).tiles[0]?.elevation;
        // Three squares of five units each.
        expect(tile(place(tentRoof, {}, 'g'))).toBe(15);
        expect(tile(place(crate, {}, 'g'))).toBe(0);
    });

    it('hides an armed trap from players over a region that pauses the game the first time a token moves in; a sprung one is neither', () => {
        const [plate] = catalogStamps([
            {
                id: 'plate',
                name: 'Pressure Plate',
                category: 'Trap',
                scale: 'interior',
                perspective: 'top-down',
                tags: ['pressure', 'plate', 'trap'],
                variants: [
                    { state: 'armed', image: 'p.png', width: 100, height: 100 },
                    { state: 'sprung', image: 's.png', width: 100, height: 100, trap: false },
                ],
            },
        ]);
        const armed = place(plate, {}, 'g');
        expect(armed.behaviour.tile).toMatchObject({ hidden: true });
        expect(regions(armed)).toEqual([
            expect.objectContaining({ label: { kind: 'stamp-trap', name: 'Pressure Plate' }, effects: [{ kind: 'pause', once: true }] }),
        ]);
        const sprung = place(plate, { variant: 1 }, 'g');
        expect(sprung.behaviour.tile).toBeNull();
        expect(regions(sprung)).toEqual([]);
    });

    it('makes no region for a stamp with neither', () => {
        expect(regions(place(crate, {}, 'g'))).toEqual([]);
    });
});
