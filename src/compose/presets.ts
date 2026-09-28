// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The Map builder's starting points: map intents a GM picks and then edits,
 * each written as an author would write one (defaults left out). Pure;
 * every preset is validated and composed in the tests.
 */

export const MAP_PRESETS = [
    'woodland-inn',
    'tavern',
    'roadside-inn',
    'forest-road',
    'marsh-crossing',
    'hive-outpost',
    'hive-chapel',
    'manufactorum',
    'void-port',
] as const;

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

// Planks where guests sit and sleep; stone where the work is done and the stores are kept. One taproom, its counter
// among the tables, the kitchen and the storeroom behind it and the hall to the bedrooms off it, as a tavern is: never
// a second walled bar with a hearth of its own, nor guests walking through the kitchen to bed.
const TAVERN_ROOMS = [
    { key: 'taproom', purpose: 'bar', size: 5, entrance: true, opensTo: ['kitchen', 'store', 'hall'] },
    { key: 'kitchen', purpose: 'kitchen', size: 1.6, floor: 'floor.cobbled-street' },
    { key: 'store', purpose: 'storage', size: 0.9, floor: 'floor.packed-dirt' },
    { key: 'hall', purpose: 'hall', size: 1.2, opensTo: ['room-1', 'room-2'] },
    { key: 'room-1', purpose: 'bedroom', size: 1 },
    { key: 'room-2', purpose: 'bedroom', size: 1 },
] as const;

/** Stamps of the grim far future, and the setting-free ones (barrels, crates) that suit any. */
const GRIMDARK = ['setting-grimdark', 'setting-generic'];

// Rockcrete throughout, deck plate where the machine-spirits are tended, clean stone where the wounded are, grating in the armoury.
const OUTPOST_ROOMS = [
    { key: 'hall', purpose: 'hall', size: 1.2, entrance: true, opensTo: ['command', 'barracks', 'medicae'] },
    { key: 'command', purpose: 'command', size: 1.6, opensTo: ['armoury', 'interrogation'], floor: 'floor.deck-plating' },
    { key: 'armoury', purpose: 'armoury', size: 1, floor: 'floor.metal-grating' },
    { key: 'barracks', purpose: 'barracks', size: 1.6 },
    { key: 'medicae', purpose: 'medicae', size: 1.2, floor: 'floor.white-marble' },
    { key: 'interrogation', purpose: 'interrogation', size: 0.8, opensTo: ['cell'] },
    { key: 'cell', purpose: 'cell', size: 0.5 },
] as const;

/** Each preset's intent, as JSON an author would write. */
export const PRESET_INTENTS: Readonly<Record<MapPreset, object>> = {
    'woodland-inn': {
        schemaVersion: 1,
        seed: 7,
        width: 40,
        height: 28,
        settings: ['setting-fantasy', 'setting-generic'],
        lighting: 'night',
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
        lighting: 'night',
        ground: null,
        buildings: [{ key: 'tavern', width: 22, height: 14, floor: 'floor.tavern-boards', wall: 'wall.wood', rooms: TAVERN_ROOMS }],
    },
    // A tavern by the road: guest rooms upstairs, a cellar down a ladder with storm doors at the side, a well in the yard.
    // Across the road a wood with a lake, whose river runs behind the tavern under the road's bridge.
    'roadside-inn': {
        schemaVersion: 1,
        seed: 21,
        width: 48,
        height: 36,
        settings: ['setting-fantasy', 'setting-generic'],
        ground: 'grassland',
        zones: [
            { kind: 'woodland', area: { shape: 'edge', side: 'west', depth: 20 }, density: 'dense' },
            { key: 'lake', kind: 'lake', area: { shape: 'circle', centre: { x: 9, y: 9 }, radius: 4.5 } },
            // The open ground round the inn: grass with flowers, a few bushes and a tree or two.
            { kind: 'meadow', area: { shape: 'edge', side: 'east', depth: 24 }, density: 'sparse' },
        ],
        paths: [
            { kind: 'road', from: { x: 23, y: -1 }, to: { x: 23, y: 37 }, width: 2, meander: 0.25 },
            { kind: 'road', from: { x: 23, y: 20 }, to: { building: 'inn' }, width: 1.2, meander: 0 },
            { kind: 'river', from: { zone: 'lake' }, to: { x: 49, y: 7 }, width: 2, meander: 0.35 },
        ],
        buildings: [
            {
                key: 'inn',
                // Set back from the road: a front yard for its porch, its well and the way in.
                at: { x: 31, y: 14 },
                width: 14,
                height: 11,
                entrance: 'west',
                floor: 'floor.tavern-boards',
                wall: 'wall.stone',
                rooms: [
                    // One taproom, its counter among the tables, the kitchen behind it and a pantry off the kitchen.
                    { key: 'taproom', purpose: 'bar', size: 4, entrance: true, opensTo: ['kitchen', 'hall'] },
                    { key: 'kitchen', purpose: 'kitchen', size: 1.4, opensTo: ['pantry'], floor: 'floor.terracotta-tile' },
                    { key: 'pantry', purpose: 'storage', size: 0.6, floor: 'floor.packed-dirt' },
                    { key: 'hall', purpose: 'hall', size: 1 },
                ],
                floors: [
                    {
                        name: 'Guest rooms',
                        rooms: [
                            // A corridor with the guest rooms either side, each a bed's room and a little more.
                            {
                                key: 'corridor',
                                purpose: 'hall',
                                size: 1.8,
                                opensTo: ['room-1', 'room-2', 'room-3', 'room-4', 'room-5', 'room-6', 'room-7', 'room-8'],
                            },
                            { key: 'room-1', purpose: 'bedroom' },
                            { key: 'room-2', purpose: 'bedroom' },
                            { key: 'room-3', purpose: 'bedroom' },
                            { key: 'room-4', purpose: 'bedroom' },
                            { key: 'room-5', purpose: 'bedroom' },
                            { key: 'room-6', purpose: 'bedroom' },
                            { key: 'room-7', purpose: 'bedroom' },
                            { key: 'room-8', purpose: 'bedroom' },
                        ],
                    },
                ],
                cellars: [
                    {
                        name: 'Cellar',
                        rooms: [
                            { key: 'cellar', purpose: 'storage', size: 2, opensTo: ['wine'], floor: 'floor.packed-dirt' },
                            { key: 'wine', purpose: 'storage', floor: 'floor.packed-dirt' },
                        ],
                    },
                ],
                cellarAccess: 'ladder',
                stormDoor: 'south',
                porch: 2,
                yard: true,
            },
        ],
        props: [{ role: 'well', beside: { building: 'inn', side: 'west' } }],
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
    'hive-outpost': {
        schemaVersion: 1,
        seed: 13,
        width: 44,
        height: 30,
        settings: GRIMDARK,
        lighting: 'night',
        ground: 'ash',
        groundTexture: 'floor.scorched-earth',
        zones: [
            { kind: 'rubble', area: { shape: 'everywhere' }, density: 'sparse' },
            { kind: 'rubble', area: { shape: 'circle', centre: { x: 7, y: 7 }, radius: 6 }, density: 'dense', texture: 'floor.rubble' },
            { kind: 'fortified', area: { shape: 'circle', centre: { x: 21, y: 15 }, radius: 12 }, texture: 'floor.packed-dirt' },
            { kind: 'industrial', area: { shape: 'edge', side: 'east', depth: 9 }, texture: 'floor.concrete' },
        ],
        paths: [
            { kind: 'road', from: 'south', to: { building: 'outpost' }, width: 2, meander: 0.3 },
            { kind: 'river', from: 'north', to: 'west', width: 1.5, meander: 0.5, liquid: 'poison' },
        ],
        buildings: [{ key: 'outpost', at: { x: 14, y: 9 }, width: 15, height: 11, floor: 'floor.concrete', wall: 'wall.concrete', rooms: OUTPOST_ROOMS }],
    },
    'hive-chapel': {
        schemaVersion: 1,
        seed: 17,
        width: 24,
        height: 18,
        settings: GRIMDARK,
        lighting: 'night',
        ground: null,
        buildings: [
            {
                key: 'chapel',
                width: 22,
                height: 16,
                floor: 'floor.blackstone-crypt',
                wall: 'wall.stone',
                rooms: [
                    { key: 'nave', purpose: 'chapel', size: 4, entrance: true, opensTo: ['vestry', 'ossuary'], floor: 'floor.black-marble' },
                    { key: 'vestry', purpose: 'office', size: 1, opensTo: ['cell'], floor: 'floor.wooden-planks' },
                    { key: 'ossuary', purpose: 'storage', size: 1 },
                    { key: 'cell', purpose: 'cell', size: 0.6 },
                ],
            },
        ],
    },
    'manufactorum': {
        schemaVersion: 1,
        seed: 19,
        width: 28,
        height: 20,
        settings: GRIMDARK,
        ground: null,
        buildings: [
            {
                key: 'manufactorum',
                width: 26,
                height: 18,
                floor: 'floor.metal-grating',
                wall: 'wall.metal',
                rooms: [
                    { key: 'floor', purpose: 'manufactorum', size: 5, entrance: true, opensTo: ['overseer', 'stores', 'mess'] },
                    { key: 'overseer', purpose: 'command', size: 1, floor: 'floor.deck-plating' },
                    { key: 'stores', purpose: 'storage', size: 1.2 },
                    { key: 'mess', purpose: 'mess', size: 1.5, opensTo: ['bunks'], floor: 'floor.concrete' },
                    { key: 'bunks', purpose: 'barracks', size: 1.5 },
                ],
            },
        ],
    },
    'void-port': {
        schemaVersion: 1,
        seed: 23,
        width: 60,
        height: 40,
        settings: ['setting-scifi', 'setting-grimdark', 'setting-generic'],
        ground: 'rock',
        groundTexture: 'floor.concrete',
        zones: [
            {
                kind: 'landing',
                area: {
                    shape: 'polygon',
                    points: [
                        { x: 3, y: 3 },
                        { x: 38, y: 3 },
                        { x: 38, y: 30 },
                        { x: 3, y: 30 },
                    ],
                },
                texture: 'floor.deck-plating',
            },
            { kind: 'industrial', area: { shape: 'edge', side: 'east', depth: 14 }, density: 'dense', texture: 'floor.metal-grating' },
            { kind: 'fortified', area: { shape: 'circle', centre: { x: 30, y: 36 }, radius: 5 }, density: 'sparse' },
        ],
        paths: [{ kind: 'road', from: 'south', to: { building: 'port-office' }, width: 2.5, meander: 0.2 }],
        buildings: [
            {
                key: 'port-office',
                at: { x: 42, y: 26 },
                width: 12,
                height: 8,
                floor: 'floor.deck-plating',
                wall: 'wall.metal',
                rooms: [
                    { key: 'hall', purpose: 'hall', entrance: true, opensTo: ['control', 'stores'] },
                    { key: 'control', purpose: 'command', size: 1.4 },
                    { key: 'stores', purpose: 'storage', size: 0.8 },
                ],
            },
        ],
    },
};
