// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * How tall a piece stands for its drop shadow, as a share of its
 * footprint's shorter side (operator, 2026-10-05: drawn shadows, option B):
 * a tree, a building or a vehicle tallest; a shelf, a machine, a well high;
 * furniture low; what lies on the ground (a rug, a decal, a field, water, a
 * stair or a bridge's deck, a hole in the floor) casts none. Charts draw
 * their buildings as fittings, so a fitting tagged as a building stands as
 * one. A pack's own `shadow` always wins over this. Pure.
 */
import type { StampRole } from '../stamps/schema';

/** Shares of a footprint's shorter side a piece stands. */
const TALL = 0.9;
const HIGH = 0.6;
const MIDDLING = 0.4;
const LOW = 0.3;
const SMALL = 0.2;
const SCANT = 0.1;

/** How tall each role stands; a role left out lies flat. */
const STANDS: Partial<Record<StampRole, number>> = {
    tree: TALL,
    structure: TALL,
    vehicle: HIGH,
    shelf: HIGH,
    rack: HIGH,
    machine: HIGH,
    dresser: HIGH,
    well: HIGH,
    waymark: HIGH,
    rock: MIDDLING,
    shrub: MIDDLING,
    storage: MIDDLING,
    light: MIDDLING,
    hearth: MIDDLING,
    lectern: MIDDLING,
    emplacement: MIDDLING,
    barricade: MIDDLING,
    counter: MIDDLING,
    altar: MIDDLING,
    console: MIDDLING,
    fodder: MIDDLING,
    table: LOW,
    desk: LOW,
    workbench: LOW,
    armchair: LOW,
    icon: LOW,
    medical: LOW,
    pew: LOW,
    seat: SMALL,
    bench: SMALL,
    bed: SMALL,
    nightstand: SMALL,
    chest: SMALL,
    restraint: SMALL,
    enclosure: SMALL,
    log: SMALL,
    clutter: SCANT,
    tabletop: SCANT,
    debris: SCANT,
    flora: SCANT,
};

/** Tags of a fitting drawn as a whole building (a chart's houses, its tower and mill). */
const BUILDING_TAGS: readonly string[] = [
    'town',
    'cottage',
    'house',
    'tower',
    'chapel',
    'church',
    'temple',
    'inn',
    'tavern',
    'barn',
    'mill',
    'windmill',
    'watermill',
    'smithy',
    'bakery',
    'guild',
    'farmhouse',
    'shop',
    'castle',
    'keep',
];

/** Tags of what lies on or in the ground, whatever its role: it casts no shadow. */
const FLAT_TAGS: readonly string[] = [
    'rug',
    'carpet',
    'decal',
    'stain',
    'scorch',
    'floor',
    'drain',
    'field',
    'crop',
    'paving',
    'pond',
    'pool',
    'water',
    'stream',
    'river',
    'puddle',
    'glyph',
    'circle',
    'mosaic',
    'inlay',
    'track',
    'road',
    'path',
    'grave',
    'seal',
    'conduit',
    'chasm',
    'shaft',
    'hole',
    'pit',
    'trench',
    'vein',
    'drip',
    'garden',
];

/** A fitting's share where its tags name no building and no flat thing: a stall, a pipe run, an anvil. */
const FITTING = MIDDLING;

/** How tall a piece of `role` tagged `tags` stands for its drop shadow, a share of its footprint's shorter side; 0 casts none. */
export function shadowStandOf(role: StampRole | undefined, tags: readonly string[]): number {
    if (role === undefined || tags.some((tag) => FLAT_TAGS.includes(tag))) {
        return 0;
    }
    if (role === 'fitting') {
        return tags.some((tag) => BUILDING_TAGS.includes(tag)) ? TALL : FITTING;
    }
    return STANDS[role] ?? 0;
}
