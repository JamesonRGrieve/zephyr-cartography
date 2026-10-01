// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Localised names for the native documents the plugin generates, so a GM can
 * tell them apart in Foundry's Placeables tab and palette: regions after what
 * they connect or cover, lights after what emits them. Tiles take their
 * stamp's pack name as it is, and v14 walls have no name.
 */
import { BIOME_TITLE_KEYS, I18N, TRANSITION_KIND_KEYS } from '../i18n';
import type { HazardKind } from '../stamps/schema';
import type { LightSource, RegionDoc } from '../tools/documents';
import { format, localize } from './localize';

/** A generated region's display name, e.g. "Stairs: Ground floor → Upper floor" or "Enter Residence 12". */
export function regionName(region: RegionDoc): string {
    const label = region.label;
    if ('name' in label) {
        const keys = {
            'stamp-terrain': I18N.regions.terrain,
            'stamp-surface': I18N.regions.surface,
            'stamp-hazard': I18N.regions.hazard,
            'stamp-trap': I18N.regions.trap,
        } as const;
        return format(keys[label.kind], { name: label.name });
    }
    if ('scene' in label) {
        return format(label.kind === 'entrance' ? I18N.regions.entrance : I18N.regions.exit, { scene: label.scene });
    }
    if ('biome' in label) {
        return localize(BIOME_TITLE_KEYS[label.biome]);
    }
    if ('level' in label) {
        return format(label.kind === 'floor' ? I18N.regions.floor : I18N.regions.ceiling, { level: label.level });
    }
    if (label.kind === 'room') {
        return localize(I18N.regions.room);
    }
    if (label.kind === 'zone') {
        return label.title === '' ? localize(I18N.regions.zone) : label.title;
    }
    return format(I18N.regions.transition, { kind: localize(TRANSITION_KIND_KEYS[label.kind]), from: label.from, to: label.to.join(' / ') });
}

/** A hazard's warning, scrolled over a token coming into it: "Fire!". */
export function hazardWarning(kind: HazardKind): string {
    return localize(I18N.hazards[kind]);
}

/** A stamp's sound's display name: "Generator sound". */
export function soundName(stampName: string): string {
    return format(I18N.sounds.stamp, { name: stampName });
}

/** A generated light's display name: "Brass Lamp light", or "Room light". */
export function lightName(source: LightSource): string {
    return source.kind === 'stamp' ? format(I18N.lights.stamp, { name: source.name }) : localize(I18N.lights.room);
}
