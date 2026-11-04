// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import { parseSceneSpec } from '../generate/spec';
import { composeMap } from './compose';
import {
    ENCOUNTER_DENSITIES,
    ENCOUNTER_KINDS,
    ENCOUNTER_SETTINGS,
    ENCOUNTER_SIZES,
    type EncounterChoice,
    encounterIntent,
    freshSeed,
    isEncounterDensity,
    isEncounterKind,
    isEncounterSetting,
    isEncounterSize,
    randomEncounter,
} from './encounter';
import { parseMapIntent } from './intent';
import { TEST_ROLES } from './test-roles';

const choice = (over: Partial<EncounterChoice> = {}): EncounterChoice => ({
    kind: 'road',
    setting: 'feudal',
    size: 'medium',
    density: 'normal',
    seed: 7,
    ...over,
});

describe('encounter maps', () => {
    it('compose every kind in every setting into a valid scene spec with nothing it cannot draw left over', () => {
        const outcomes = ENCOUNTER_KINDS.flatMap((kind) =>
            ENCOUNTER_SETTINGS.map((setting) => {
                const parsed = parseMapIntent(encounterIntent(choice({ kind, setting })));
                const composed = parsed.ok ? composeMap(parsed.intent, TEST_ROLES) : null;
                return { kind, setting, valid: parsed.ok && composed !== null && parseSceneSpec(composed.spec).ok };
            }),
        );
        expect(outcomes).toEqual(ENCOUNTER_KINDS.flatMap((kind) => ENCOUNTER_SETTINGS.map((setting) => ({ kind, setting, valid: true }))));
    });

    it('give the same map for the same choices and seed, and another layout for another seed', () => {
        expect(encounterIntent(choice({ kind: 'cave', seed: 3 }))).toEqual(encounterIntent(choice({ kind: 'cave', seed: 3 })));
        expect(encounterIntent(choice({ kind: 'cave', seed: 3 }))).not.toEqual(encounterIntent(choice({ kind: 'cave', seed: 4 })));
    });

    it('size the map by its size and draw each setting in its own art, ground and light', () => {
        const sizes = ENCOUNTER_SIZES.map((size) => {
            const parsed = parseMapIntent(encounterIntent(choice({ size })));
            return parsed.ok ? parsed.intent.width * parsed.intent.height : 0;
        });
        expect(sizes[0]).toBeLessThan(sizes[1] ?? 0);
        expect(sizes[1]).toBeLessThan(sizes[2] ?? 0);
        const warp = parseMapIntent(encounterIntent(choice({ setting: 'warp' })));
        expect(warp.ok && warp.intent.settings).toContain('setting-grimdark-chaotic');
        expect(warp.ok && warp.intent.lighting).toBe('night');
        const feudal = parseMapIntent(encounterIntent(choice({ setting: 'feudal' })));
        expect(feudal.ok && feudal.intent.settings).toContain('setting-fantasy');
    });

    it('cut a cave as one network of chambers through rock, opening off the map, in the dark', () => {
        const parsed = parseMapIntent(encounterIntent(choice({ kind: 'cave' })));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) {
            return;
        }
        const [network] = parsed.intent.hewn;
        expect(parsed.intent.ground).toBeNull();
        expect(parsed.intent.lighting).toBe('dim');
        expect(network?.chambers.length).toBeGreaterThanOrEqual(4);
        // A passage for each chamber after the first, and one out off the map.
        expect(network?.passages.length).toBe(network?.chambers.length);
        expect(network?.passages.some((p) => p.points.some((pt) => pt.x < 0))).toBe(true);
    });

    it('dresses its ground as thickly as asked', () => {
        for (const density of ENCOUNTER_DENSITIES) {
            const parsed = parseMapIntent(encounterIntent(choice({ kind: 'ruins', density })));
            expect(parsed.ok && parsed.intent.zones.some((z) => z.density === density)).toBe(true);
        }
    });

    it('rolls a surprise from every list, with a fresh seed, and narrows a picker value', () => {
        const random = seededRandom(11);
        const rolled = Array.from({ length: 40 }, () => randomEncounter(random));
        expect(new Set(rolled.map((r) => r.kind)).size).toBeGreaterThan(5);
        expect(rolled.every((r) => isEncounterKind(r.kind) && isEncounterSetting(r.setting) && isEncounterSize(r.size) && isEncounterDensity(r.density))).toBe(
            true,
        );
        const seed = freshSeed(seededRandom(2));
        expect(Number.isInteger(seed) && seed >= 1).toBe(true);
        expect(isEncounterKind('volcano')).toBe(false);
        expect(isEncounterSetting('feudal')).toBe(true);
        expect(isEncounterSize('huge')).toBe(false);
        expect(isEncounterDensity('dense')).toBe(true);
    });
});
