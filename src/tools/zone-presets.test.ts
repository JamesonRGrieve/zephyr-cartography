// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { DEFAULT_AREA_DISPLAY } from './area-effects';
import type { AreaSettings } from './areas';
import { NO_SPAWN } from './spawn';
import { NEW_ZONE } from './zone';
import { parseZonePresets, presetOf, presetZone, serializeZonePresets, withoutPreset, withPreset, type ZonePreset } from './zone-presets';

const BURNING: AreaSettings = {
    movementCost: 2,
    effects: [{ kind: 'text', text: 'Burning!', colour: '#ff6600', visibility: 'anyone', once: false, events: ['tokenTurnStart'] }],
    display: { ...DEFAULT_AREA_DISPLAY, visibility: 'always' },
    spawn: NO_SPAWN,
};

const SLICK: ZonePreset = { name: 'Fuel slick', shape: { kind: 'ellipse', radiusX: 200, radiusY: 100 }, gridBased: true, area: BURNING };

describe('hazard presets', () => {
    it('are made from a zone and its area settings, under a name that is not blank', () => {
        const zone = { ...NEW_ZONE, shape: SLICK.shape, gridBased: true, name: 'Slick', attachedTo: 't1' };
        expect(presetOf(' Fuel slick ', zone, BURNING)).toEqual(SLICK);
        expect(presetOf('  ', zone, BURNING)).toBeNull();
    });

    it('replace one of the same name in its place, and are forgotten by name', () => {
        const gas: ZonePreset = { ...SLICK, name: 'Gas' };
        const bigger = { ...SLICK, shape: { kind: 'circle', radius: 500 } } as const;
        expect(withPreset([SLICK, gas], bigger)).toEqual([bigger, gas]);
        expect(withPreset([SLICK], gas)).toEqual([SLICK, gas]);
        expect(withoutPreset([SLICK, gas], 'Fuel slick')).toEqual([gas]);
    });

    it('give a zone their shape and measuring, and their name only when it has none of its own', () => {
        expect(presetZone({ ...NEW_ZONE, attachedTo: 't1' }, SLICK)).toEqual({
            ...NEW_ZONE,
            attachedTo: 't1',
            shape: SLICK.shape,
            gridBased: true,
            name: SLICK.name,
        });
        expect(presetZone({ ...NEW_ZONE, name: 'The pit' }, SLICK).name).toBe('The pit');
    });

    it('round-trip through the world setting, dropping malformed ones and a second of one name', () => {
        const json = serializeZonePresets([SLICK]);
        expect(parseZonePresets(json)).toEqual([SLICK]);
        expect(
            parseZonePresets(
                JSON.stringify([
                    SLICK,
                    { ...SLICK, shape: { kind: 'circle', radius: -1 } },
                    { ...SLICK, name: '' },
                    { ...SLICK, area: { movementCost: 9 } },
                    { name: 'Rubble', shape: { kind: 'circle', radius: 50 } },
                    'x',
                ]),
            ),
        ).toEqual([
            SLICK,
            {
                name: 'Rubble',
                shape: { kind: 'circle', radius: 50 },
                gridBased: false,
                area: { ...BURNING, movementCost: 1, effects: [], display: DEFAULT_AREA_DISPLAY },
            },
        ]);
        expect(parseZonePresets('not json')).toEqual([]);
        expect(parseZonePresets('{}')).toEqual([]);
    });
});
