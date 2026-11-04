// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import { parseSceneSpec } from '../generate/spec';
import { composeMap } from './compose';
import {
    DEFAULT_ENCOUNTER,
    type ENCOUNTER_BRIDGES,
    type ENCOUNTER_ROADS,
    ENCOUNTER_DENSITIES,
    ENCOUNTER_FEATURES,
    ENCOUNTER_LANDSCAPES,
    ENCOUNTER_SETTINGS,
    ENCOUNTER_SIZES,
    type EncounterChoice,
    encounterIntent,
    freshSeed,
    isEncounterBridge,
    isEncounterDensity,
    isEncounterFeature,
    isEncounterLandscape,
    isEncounterRoad,
    isEncounterSetting,
    isEncounterSize,
} from './encounter';
import { type MapIntent, parseMapIntent } from './intent';
import { TEST_ROLES } from './test-roles';

const choice = (over: Partial<EncounterChoice> = {}): EncounterChoice => ({ ...DEFAULT_ENCOUNTER, seed: 7, ...over });

/** The encounter's intent, parsed, or a failure naming its issues. */
function parsed(over: Partial<EncounterChoice> = {}): MapIntent {
    const result = parseMapIntent(encounterIntent(choice(over)));
    if (!result.ok) {
        throw new Error(JSON.stringify(result.issues));
    }
    return result.intent;
}

describe('encounter maps', () => {
    it('compose every landscape in every setting, every feature ticked, into a valid scene spec', () => {
        const outcomes = ENCOUNTER_LANDSCAPES.flatMap((landscape) =>
            ENCOUNTER_SETTINGS.map((setting) => {
                const intent = parsed({ landscape, setting, road: 'crossroads', features: [...ENCOUNTER_FEATURES] });
                return { landscape, setting, valid: parseSceneSpec(composeMap(intent, TEST_ROLES).spec).ok };
            }),
        );
        expect(outcomes).toEqual(ENCOUNTER_LANDSCAPES.flatMap((landscape) => ENCOUNTER_SETTINGS.map((setting) => ({ landscape, setting, valid: true }))));
    });

    it('lays only what is ticked: no road, a road, or a crossroads; a river and a lake it runs out of', () => {
        const roads = (road: (typeof ENCOUNTER_ROADS)[number]): number => parsed({ road, features: [] }).paths.filter((p) => p.kind === 'road').length;
        expect([roads('none'), roads('road'), roads('crossroads')]).toEqual([0, 1, 2]);
        expect(parsed({ features: [] }).paths.some((p) => p.kind === 'river')).toBe(false);
        const withLake = parsed({ features: ['river', 'lake'] });
        expect(withLake.zones.some((z) => z.kind === 'lake' && z.key === 'lake')).toBe(true);
        expect(withLake.paths.find((p) => p.kind === 'river')?.from).toEqual({ zone: 'lake' });
        const all = parsed({ features: ['ruins', 'camp', 'wreck', 'cliffs'] });
        expect(all.zones.some((z) => z.kind === 'fortified')).toBe(true);
        expect(all.zones.filter((z) => z.kind === 'rocky' && z.area.shape === 'edge')).toHaveLength(2);
    });

    it('crosses the river by the bridge asked: a kind, any road bridge, or a ford', () => {
        const bridgeOf = (bridge: (typeof ENCOUNTER_BRIDGES)[number]): readonly string[] | false | undefined =>
            parsed({ bridge }).paths.find((p) => p.kind === 'road')?.bridge;
        expect(bridgeOf('stone')).toEqual(['stone']);
        expect(bridgeOf('rope')).toEqual(['rope']);
        expect(bridgeOf('ford')).toBe(false);
        expect(bridgeOf('any')).toBeUndefined();
        // A frontier world draws no bridges: there "any bridge" fords the river.
        expect(parsed({ setting: 'scifi', bridge: 'any' }).paths.find((p) => p.kind === 'road')?.bridge).toBe(false);
    });

    it('opens a clearing round each feature in a forest, and runs the road through the camp', () => {
        const forest = parsed({ landscape: 'forest', features: ['camp', 'ruins'] });
        expect(forest.zones.filter((z) => z.kind === 'clearing')).toHaveLength(2);
        const camp = forest.zones.find((z) => z.kind === 'fortified');
        const road = forest.paths.find((p) => p.kind === 'road');
        expect(camp?.area.shape === 'circle' && road?.via[0]).toEqual(camp?.area.shape === 'circle' ? camp.area.centre : null);
        expect(parsed({ landscape: 'plains', features: ['camp'] }).zones.some((z) => z.kind === 'clearing')).toBe(false);
    });

    it('gives the same map for the same checklist and seed, another layout for another seed, sized and lit by its choices', () => {
        expect(encounterIntent(choice({ seed: 3 }))).toEqual(encounterIntent(choice({ seed: 3 })));
        expect(encounterIntent(choice({ seed: 3 }))).not.toEqual(encounterIntent(choice({ seed: 4 })));
        const areas = ENCOUNTER_SIZES.map((size) => {
            const intent = parsed({ size });
            return intent.width * intent.height;
        });
        expect(areas[0]).toBeLessThan(areas[1] ?? 0);
        expect(areas[1]).toBeLessThan(areas[2] ?? 0);
        const warp = parsed({ setting: 'warp' });
        expect(warp.settings).toContain('setting-grimdark-chaotic');
        expect(warp.lighting).toBe('night');
        expect(parsed({ landscape: 'desert' }).ground).toBe('sand');
        expect(parsed({ landscape: 'tundra' }).ground).toBe('snow');
    });

    it('cuts a cave as one network of chambers through rock, opening off the map, in the dark', () => {
        const intent = parsed({ landscape: 'cave' });
        const [network] = intent.hewn;
        expect(intent.ground).toBeNull();
        expect(intent.lighting).toBe('dim');
        expect(network?.chambers.length).toBeGreaterThanOrEqual(4);
        expect(network?.passages.length).toBe(network?.chambers.length);
        expect(network?.passages.some((p) => p.points.some((pt) => pt.x < 0))).toBe(true);
    });

    it('dresses its ground as thickly as asked, and narrows every picker value', () => {
        for (const density of ENCOUNTER_DENSITIES) {
            expect(parsed({ density }).zones.some((z) => z.density === density)).toBe(true);
        }
        expect(Number.isInteger(freshSeed(seededRandom(2)))).toBe(true);
        expect([isEncounterLandscape('forest'), isEncounterLandscape('volcano')]).toEqual([true, false]);
        expect([isEncounterRoad('crossroads'), isEncounterBridge('ford'), isEncounterFeature('lake')]).toEqual([true, true, true]);
        expect([isEncounterSetting('scifi'), isEncounterSize('huge'), isEncounterDensity('dense')]).toEqual([true, false, true]);
    });
});
