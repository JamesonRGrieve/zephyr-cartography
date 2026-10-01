// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { RegionDoc } from './documents';
import { regionColour } from './region-colours';

const base: RegionDoc = { id: null, label: { kind: 'floor', level: 'Upper' }, polygon: [], bottom: null, top: null, level: null, spans: [], behaviour: null };

describe('regionColour', () => {
    it('colours terrain as its biome, and every other region by what it is', () => {
        expect(regionColour({ ...base, label: { kind: 'terrain', biome: 'water' } })).toBe('#2f5d7c');
        expect(regionColour({ ...base, label: { kind: 'stairs', from: 'A', to: ['B'] } })).toBe(
            regionColour({ ...base, label: { kind: 'ladder', from: 'A', to: ['B'] } }),
        );
        expect(regionColour({ ...base, label: { kind: 'entrance', scene: 'Residence' } })).toBe(
            regionColour({ ...base, label: { kind: 'exit', scene: 'Town' } }),
        );
        const kinds = [
            regionColour(base),
            regionColour({ ...base, label: { kind: 'stairs', from: 'A', to: ['B'] } }),
            regionColour({ ...base, label: { kind: 'entrance', scene: 'Residence' } }),
            regionColour({ ...base, label: { kind: 'room' } }),
            regionColour({ ...base, label: { kind: 'stamp-terrain', name: 'Rubble' } }),
            regionColour({ ...base, label: { kind: 'stamp-surface', name: 'Roof' } }),
        ];
        expect(new Set(kinds).size).toBe(kinds.length);
        expect(kinds.every((colour) => /^#[0-9a-f]{6}$/u.test(colour))).toBe(true);
    });
});
