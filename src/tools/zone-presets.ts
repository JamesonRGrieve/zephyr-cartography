// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Hazard presets: a zone the GM has set up once (a burning fuel slick,
 * a gas cloud, a rubble field), saved under a name so any zone can take it
 * again. A preset holds the zone's shape and grid measuring and everything
 * the effects panel sets on it: movement cost, region behaviours, display
 * and spawn. The GM makes them, so the module ships no rules of its own. They
 * are a world's, kept as JSON in a world setting. Pure and unit-tested.
 */
import { DEFAULT_AREA_DISPLAY, parseAreaFields } from './area-effects';
import type { AreaSettings } from './areas';
import { isRecord } from './guards';
import { NO_SPAWN } from './spawn';
import { NORMAL_COST } from './terrain-cost';
import { parseZoneShape, type ZoneSettings } from './zone';
import type { ZoneShape } from './zone-shape';

export interface ZonePreset {
    readonly name: string;
    readonly shape: ZoneShape;
    readonly gridBased: boolean;
    readonly area: AreaSettings;
}

/** The preset a zone's settings and area settings make, named `presetName`; null for a blank name. */
export function presetOf(presetName: string, zone: ZoneSettings, area: AreaSettings): ZonePreset | null {
    const trimmed = presetName.trim();
    return trimmed === '' ? null : { name: trimmed, shape: zone.shape, gridBased: zone.gridBased, area };
}

/** `presets` with `preset` added, replacing one of the same name in its place. */
export function withPreset(presets: readonly ZonePreset[], preset: ZonePreset): ZonePreset[] {
    return presets.some((p) => p.name === preset.name) ? presets.map((p) => (p.name === preset.name ? preset : p)) : [...presets, preset];
}

/** `presets` less the one named `presetName`. */
export function withoutPreset(presets: readonly ZonePreset[], presetName: string): ZonePreset[] {
    return presets.filter((p) => p.name !== presetName);
}

/** A zone's settings with `preset`'s shape and measuring; a zone without a name of its own takes the preset's. */
export function presetZone(zone: ZoneSettings, preset: ZonePreset): ZoneSettings {
    return { ...zone, shape: preset.shape, gridBased: preset.gridBased, name: zone.name === '' ? preset.name : zone.name };
}

// eslint-disable-next-line no-restricted-syntax -- boundary: parses one preset from the world setting's JSON
function parsePreset(v: unknown): ZonePreset | null {
    if (!isRecord(v) || typeof v['name'] !== 'string' || v['name'].trim() === '') {
        return null;
    }
    const shape = parseZoneShape(v['shape']);
    if (shape === null) {
        return null;
    }
    const fields = parseAreaFields(isRecord(v['area']) ? v['area'] : {});
    return {
        name: v['name'].trim(),
        shape,
        gridBased: v['gridBased'] === true,
        area: {
            movementCost: fields.movementCost ?? NORMAL_COST,
            effects: fields.effects ?? [],
            display: fields.display ?? DEFAULT_AREA_DISPLAY,
            spawn: fields.spawn ?? NO_SPAWN,
        },
    };
}

/** The presets a world setting holds: each valid one, each name once (the first); none for text that is not a JSON list. */
export function parseZonePresets(json: string): ZonePreset[] {
    // eslint-disable-next-line no-restricted-syntax -- boundary: JSON.parse yields untyped data, validated preset by preset
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        return [];
    }
    const presets = Array.isArray(raw) ? raw.map(parsePreset).filter((p): p is ZonePreset => p !== null) : [];
    return presets.filter((p, i) => presets.findIndex((q) => q.name === p.name) === i);
}

/** Presets as the world setting keeps them. */
export function serializeZonePresets(presets: readonly ZonePreset[]): string {
    return JSON.stringify(presets);
}
