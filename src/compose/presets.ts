// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The Map builder's starting points: map intents a GM picks and then edits,
 * each written as an author would write one (defaults left out). Pure;
 * every preset is validated and composed in the tests.
 */

export const MAP_PRESETS = ['woodland-inn', 'tavern', 'forest-road', 'marsh-crossing'] as const;

export type MapPreset = (typeof MAP_PRESETS)[number];

/** Spaces per indent of an intent shown for editing. */
const INTENT_INDENT = 2;

export function isMapPreset(value: string): value is MapPreset {
    return MAP_PRESETS.some((preset) => preset === value);
}

/** A preset's intent as the JSON a GM edits. */
export function presetText(preset: MapPreset): string {
    return JSON.stringify(PRESET_INTENTS[preset], null, INTENT_INDENT);
}

/** `text`'s intent with another seed, or null when the text is not a JSON object to set one on. */
export function withSeed(text: string, seed: number): string | null {
    // eslint-disable-next-line no-restricted-syntax -- boundary: JSON.parse of the GM's text gives an untyped value, narrowed to an object below
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null;
    }
    return JSON.stringify({ ...parsed, seed }, null, INTENT_INDENT);
}

const TAVERN_ROOMS = [
    { key: 'common', purpose: 'common-room', size: 5, entrance: true, opensTo: ['bar', 'hall'] },
    { key: 'bar', purpose: 'bar', size: 1.6, opensTo: ['kitchen'] },
    { key: 'kitchen', purpose: 'kitchen', size: 1.6, opensTo: ['store'] },
    { key: 'store', purpose: 'storage', size: 0.9 },
    { key: 'hall', purpose: 'hall', size: 1, opensTo: ['room-1', 'room-2'] },
    { key: 'room-1', purpose: 'bedroom', size: 1 },
    { key: 'room-2', purpose: 'bedroom', size: 1 },
] as const;

/** Each preset's intent, as JSON an author would write. */
export const PRESET_INTENTS: Readonly<Record<MapPreset, object>> = {
    'woodland-inn': {
        schemaVersion: 1,
        seed: 7,
        width: 40,
        height: 28,
        settings: ['setting-fantasy', 'setting-generic'],
        ground: 'grassland',
        zones: [
            { kind: 'woodland', area: { shape: 'everywhere' }, density: 'dense' },
            { kind: 'clearing', area: { shape: 'circle', centre: { x: 18, y: 14 }, radius: 11 } },
            { kind: 'meadow', area: { shape: 'circle', centre: { x: 30, y: 21 }, radius: 5 }, density: 'sparse' },
        ],
        paths: [
            { kind: 'road', from: 'west', to: { building: 'inn' }, meander: 0.35 },
            { kind: 'river', from: 'north', to: 'south', width: 2.5, meander: 0.6 },
        ],
        buildings: [{ key: 'inn', at: { x: 10, y: 8 }, width: 16, height: 11, floor: 'floor.tavern-boards', wall: 'wall.stone', rooms: TAVERN_ROOMS }],
    },
    'tavern': {
        schemaVersion: 1,
        seed: 11,
        width: 24,
        height: 16,
        settings: ['setting-fantasy', 'setting-generic'],
        ground: null,
        buildings: [{ key: 'tavern', width: 22, height: 14, floor: 'floor.tavern-boards', wall: 'wall.wood', rooms: TAVERN_ROOMS }],
    },
    'forest-road': {
        schemaVersion: 1,
        seed: 3,
        width: 40,
        height: 26,
        ground: 'grassland',
        zones: [
            { kind: 'woodland', area: { shape: 'edge', side: 'north', depth: 10 }, density: 'dense' },
            { kind: 'woodland', area: { shape: 'edge', side: 'south', depth: 8 } },
            { kind: 'meadow', area: { shape: 'circle', centre: { x: 28, y: 13 }, radius: 6 } },
            { kind: 'rocky', area: { shape: 'circle', centre: { x: 8, y: 14 }, radius: 3 }, density: 'sparse' },
        ],
        paths: [{ kind: 'road', from: 'west', to: 'east', meander: 0.5 }],
    },
    'marsh-crossing': {
        schemaVersion: 1,
        seed: 5,
        width: 36,
        height: 24,
        ground: 'marsh',
        zones: [
            { kind: 'marsh', area: { shape: 'everywhere' }, density: 'dense' },
            { kind: 'rocky', area: { shape: 'edge', side: 'west', depth: 6 } },
            { kind: 'woodland', area: { shape: 'edge', side: 'east', depth: 5 }, density: 'sparse' },
        ],
        paths: [
            { kind: 'river', from: 'north', to: 'south', width: 3, meander: 0.8 },
            { kind: 'road', from: 'west', to: 'east', width: 1.2, meander: 0.2 },
        ],
    },
};
