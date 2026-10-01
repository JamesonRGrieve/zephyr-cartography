// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The colour a generated region shows on Foundry's Regions layer, by what it
 * is, so a GM can tell terrain from stairs from doorways at a glance instead
 * of reading Foundry's random picks. Terrain takes its biome's colour. Pure
 * and unit-tested.
 */
import { BIOME_STYLES } from './biome';
import { cssHex } from './colour';
import type { RegionDoc } from './documents';

type RegionKind = RegionDoc['label']['kind'];

const KIND_COLOURS: Readonly<Record<Exclude<RegionKind, 'terrain'>, number>> = {
    'stairs': 0x4a90d9,
    'ladder': 0x4a90d9,
    'lift': 0x4a90d9,
    'hatch': 0x4a90d9,
    'entrance': 0x9b59b6,
    'exit': 0x9b59b6,
    'floor': 0x7f8c8d,
    'ceiling': 0x95a5a6,
    'room': 0x16a085,
    'stamp-surface': 0x8d6e63,
    'stamp-terrain': 0xe67e22,
    'stamp-hazard': 0xf1c40f,
    'stamp-trap': 0x8e44ad,
    'zone': 0xc0392b,
};

/** A generated region's colour, as `#rrggbb`. */
export function regionColour(region: RegionDoc): string {
    const { label } = region;
    return cssHex(label.kind === 'terrain' ? BIOME_STYLES[label.biome].fill : KIND_COLOURS[label.kind]);
}
