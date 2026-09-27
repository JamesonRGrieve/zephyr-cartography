// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseSceneSpec } from '../generate/spec';
import { composeMap } from './compose';
import { parseMapIntent } from './intent';
import { isMapPreset, MAP_PRESETS, PRESET_INTENTS, presetText, withSeed } from './presets';
import { TEST_ROLES } from './test-roles';

describe('preset text', () => {
    it('shows a preset as the JSON a GM edits, and knows the preset names', () => {
        expect(JSON.parse(presetText('tavern'))).toEqual(PRESET_INTENTS.tavern);
        expect(presetText('tavern')).toContain('\n  "seed"');
        expect(isMapPreset('tavern')).toBe(true);
        expect(isMapPreset('castle')).toBe(false);
    });

    it('gives an intent a new seed, keeping the rest, and leaves text that is not a JSON object alone', () => {
        expect(JSON.parse(withSeed(presetText('forest-road'), 99) ?? '{}')).toEqual({ ...PRESET_INTENTS['forest-road'], seed: 99 });
        expect(withSeed('{ not json', 3)).toBeNull();
        expect(withSeed('[1, 2]', 3)).toBeNull();
        expect(withSeed('null', 3)).toBeNull();
    });
});

describe('map presets', () => {
    it('are valid intents that compose into valid specs, every room fitting and beside the rooms it opens onto', () => {
        const outcomes = MAP_PRESETS.map((preset) => {
            const parsed = parseMapIntent(PRESET_INTENTS[preset]);
            const composed = parsed.ok ? composeMap(parsed.intent, TEST_ROLES) : null;
            return {
                preset,
                valid: parsed.ok && composed !== null && parseSceneSpec(composed.spec).ok,
                problems: composed?.problems ?? ['not an intent'],
                // Each is a full map: plenty placed on it.
                full: (composed?.spec.features.filter((f) => f.type === 'stamp').length ?? 0) > 30,
            };
        });
        expect(outcomes).toEqual(MAP_PRESETS.map((preset) => ({ preset, valid: true, problems: [], full: true })));
    });
});
