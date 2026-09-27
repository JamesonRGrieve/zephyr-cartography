// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import { zoneOutline } from './exterior';
import type { ZoneIntent } from './intent';
import { noiseField } from './noise';

const MAP = { width: 20, height: 12 };
const noise = noiseField(seededRandom(1), 4);

const zone = (area: ZoneIntent['area']): ZoneIntent => ({ kind: 'woodland', area, density: 'normal' });

describe('zoneOutline', () => {
    it('covers the whole map and past its edges for everywhere', () => {
        const outline = zoneOutline(zone({ shape: 'everywhere' }), MAP, noise);
        expect(Math.min(...outline.map((p) => p.x))).toBeLessThan(0);
        expect(Math.max(...outline.map((p) => p.y))).toBeGreaterThan(MAP.height);
    });

    it('wanders round a circle’s radius, and keeps a polygon as given', () => {
        const circle = zoneOutline(zone({ shape: 'circle', centre: { x: 10, y: 6 }, radius: 4 }), MAP, noise);
        const radii = circle.map((p) => Math.hypot(p.x - 10, p.y - 6));
        expect(Math.min(...radii)).toBeGreaterThanOrEqual(3);
        expect(Math.max(...radii)).toBeLessThanOrEqual(5);
        expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.1);
        const points = [
            { x: 1, y: 1 },
            { x: 4, y: 1 },
            { x: 2, y: 3 },
        ];
        expect(zoneOutline(zone({ shape: 'polygon', points }), MAP, noise)).toEqual(points);
    });

    it('runs a strip along each edge, its inner edge about its depth in and wandering', () => {
        for (const side of ['north', 'south', 'east', 'west'] as const) {
            const outline = zoneOutline(zone({ shape: 'edge', side, depth: 4 }), MAP, noise);
            // The inner edge lies between the ends, which sit beyond the map's corners.
            const inner = outline.slice(1, -1);
            const inFrom = inner.map((p) => ({ north: p.y, south: MAP.height - p.y, west: p.x, east: MAP.width - p.x }[side]));
            expect(Math.min(...inFrom)).toBeGreaterThanOrEqual(2);
            expect(Math.max(...inFrom)).toBeLessThanOrEqual(6);
        }
    });
});
