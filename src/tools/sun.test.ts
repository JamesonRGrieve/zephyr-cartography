// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { DEFAULT_SUN, parseSun, SHADOW_OPACITY, shadowOpacity, shadowShift } from './sun';

describe('shadowShift', () => {
    it('falls straight away from the sun: a north-west sun casts to the south-east, an eastern one to the west', () => {
        const fromNorthWest = shadowShift({ azimuth: 315, elevation: 45 }, 10);
        expect(fromNorthWest?.x).toBeGreaterThan(0);
        expect(fromNorthWest?.y).toBeGreaterThan(0);
        const fromEast = shadowShift({ azimuth: 90, elevation: 45 }, 10);
        expect(fromEast?.x).toBeCloseTo(-10);
        expect(fromEast?.y).toBeCloseTo(0);
        // A southern sun (a northern-hemisphere noon) casts north, up the map.
        expect(shadowShift({ azimuth: 180, elevation: 45 }, 10)?.y).toBeCloseTo(-10);
    });

    it('is long at a low sun and short at a high one, as tall over the tangent of its elevation', () => {
        const reach = (elevation: number): number =>
            Math.hypot(shadowShift({ azimuth: 315, elevation }, 10)?.x ?? 0, shadowShift({ azimuth: 315, elevation }, 10)?.y ?? 0);
        expect(reach(45)).toBeCloseTo(10);
        expect(reach(20)).toBeGreaterThan(reach(45));
        expect(reach(80)).toBeLessThan(2);
        // A sun barely risen is taken at the lowest elevation, so no shadow runs off the map.
        expect(reach(1)).toBeCloseTo(reach(8));
    });

    it('is none once the sun is down, or for a piece that stands no height', () => {
        expect(shadowShift({ azimuth: 315, elevation: 0 }, 10)).toBeNull();
        expect(shadowShift({ azimuth: 315, elevation: -20 }, 10)).toBeNull();
        expect(shadowShift(DEFAULT_SUN, 0)).toBeNull();
    });
});

describe('shadowOpacity', () => {
    it('is none at night, fades in through the twilight, and is full with the sun well up', () => {
        expect(shadowOpacity({ azimuth: 90, elevation: -5 })).toBe(0);
        expect(shadowOpacity({ azimuth: 90, elevation: 3 })).toBeCloseTo(SHADOW_OPACITY / 2);
        expect(shadowOpacity(DEFAULT_SUN)).toBe(SHADOW_OPACITY);
    });
});

describe('parseSun', () => {
    it('reads a stored sun, its azimuth turned into a compass bearing and its elevation within the sky', () => {
        expect(parseSun({ azimuth: -45, elevation: 30 })).toEqual({ azimuth: 315, elevation: 30 });
        expect(parseSun({ azimuth: 720, elevation: 120 })).toEqual({ azimuth: 0, elevation: 90 });
    });

    it('refuses anything else', () => {
        expect(parseSun(null)).toBeNull();
        expect(parseSun('noon')).toBeNull();
        expect(parseSun({ azimuth: 10 })).toBeNull();
        expect(parseSun({ azimuth: Number.NaN, elevation: 10 })).toBeNull();
    });
});
