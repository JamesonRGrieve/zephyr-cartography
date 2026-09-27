// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseStampPack, STAMP_PACK_SCHEMA_VERSION } from './schema';

const variant = { state: 'intact', image: 'stamps/interior/crate.png', width: 100, height: 100 };

function pack(stamps: object[], extra: object = {}): object {
    return { schemaVersion: STAMP_PACK_SCHEMA_VERSION, id: 'test-pack', name: 'Test', stamps, ...extra };
}

const crate = { id: 'crate', name: 'Crate', category: 'Storage', scale: 'interior', perspective: 'top-down', variants: [variant] };

describe('parseStampPack', () => {
    it('accepts a minimal pack and applies defaults', () => {
        const result = parseStampPack(pack([crate]));
        expect(result.ok).toBe(true);
        const parsed = result.ok ? result.pack : null;
        expect(parsed?.referenceGridSize).toBe(100);
        expect(parsed?.textureSets).toEqual([]);
        expect(parsed?.stamps[0]?.tags).toEqual([]);
        expect(parsed?.stamps[0]?.defaultVariant).toBe(0);
        expect(parsed?.stamps[0]?.enterable).toBe(false);
        expect(parsed?.stamps[0]?.container).toBe(false);
    });

    it('takes a role and placement for the map composer, keeping only what the pack says, and refuses an unknown role', () => {
        const counter = { ...crate, id: 'counter', role: 'counter', placement: { against: 'wall', clearance: 1 } };
        const table = { ...crate, id: 'table', role: 'table', placement: {} };
        const result = parseStampPack(pack([counter, table, crate]));
        const [c, t, plain] = result.ok ? result.pack.stamps : [];
        // What a pack leaves out is its role's way, filled in by the composer, not here.
        expect([c?.role, c?.placement]).toEqual(['counter', { against: 'wall', clearance: 1 }]);
        expect(t?.placement).toEqual({});
        expect(parseStampPack(pack([{ ...crate, placement: { upright: true } }])).ok).toBe(true);
        const bed = parseStampPack(pack([{ ...crate, role: 'bed', placement: { against: 'wall', back: 'left' } }]));
        expect(bed.ok ? bed.pack.stamps[0]?.placement?.back : null).toBe('left');
        // Land stamps say where they belong; unsaid, nowhere in particular.
        const rock = parseStampPack(pack([{ ...crate, role: 'rock', habitats: ['forest', 'rocky'] }]));
        expect(rock.ok ? rock.pack.stamps[0]?.habitats : null).toEqual(['forest', 'rocky']);
        expect(result.ok ? result.pack.stamps[2]?.habitats : null).toEqual([]);
        expect(parseStampPack(pack([{ ...crate, habitats: ['moon'] }])).ok).toBe(false);
        // Without a role, a stamp is only placed by hand.
        expect([plain?.role, plain?.placement]).toEqual([undefined, undefined]);
        expect(parseStampPack(pack([{ ...crate, role: 'spaceship' }])).ok).toBe(false);
        expect(parseStampPack(pack([{ ...crate, placement: { clearance: -1 } }])).ok).toBe(false);
    });

    it('accepts full structural behaviour with per-variant overrides', () => {
        const torch = {
            id: 'torch',
            name: 'Wall Torch',
            category: 'Lighting',
            scale: 'interior',
            perspective: 'top-down',
            physical: { height: 1, cover: 0 },
            occlusion: { shape: 'none' },
            light: { dim: 4, bright: 2, color: '#ff9c33', animation: { type: 'torch', speed: 3 } },
            variants: [
                { ...variant, state: 'lit' },
                { ...variant, state: 'unlit', light: null },
            ],
        };
        const door = {
            id: 'bulkhead',
            name: 'Bulkhead Door',
            category: 'Doors',
            scale: 'interior',
            perspective: 'top-down',
            door: { type: 'door' },
            occlusion: { shape: 'bounds' },
            variants: [
                { ...variant, state: 'closed', doorState: 'closed' },
                { ...variant, state: 'open', doorState: 'open', occlusion: { shape: 'none' } },
            ],
        };
        const stairs = { ...crate, id: 'stairs', transition: { kind: 'stairs', direction: 'both' } };
        const hab = { ...crate, id: 'hab', scale: 'city', enterable: true, occlusion: { shape: 'alpha', sound: false } };
        const result = parseStampPack(pack([torch, door, stairs, hab]));
        expect(result.ok).toBe(true);
        const stamps = result.ok ? result.pack.stamps : [];
        expect(stamps[0]?.variants[1]?.light).toBeNull();
        expect(stamps[1]?.variants[1]?.doorState).toBe('open');
        expect(stamps[3]?.occlusion).toEqual({ shape: 'alpha', sight: true, movement: true, light: true, sound: false });
    });

    it('accepts texture sets', () => {
        const set = { id: 'polyhaven', name: 'Poly Haven', license: 'CC0-1.0', textures: { grassland: 'textures/polyhaven/grassland.jpg' } };
        const result = parseStampPack(pack([], { textureSets: [set] }));
        expect(result.ok).toBe(true);
    });

    it('rejects a wrong schema version', () => {
        expect(parseStampPack({ ...pack([crate]), schemaVersion: 2 }).ok).toBe(false);
    });

    it('rejects unknown keys (strict)', () => {
        expect(parseStampPack(pack([{ ...crate, glowing: true }])).ok).toBe(false);
    });

    it('rejects invalid values with a readable issue path', () => {
        const result = parseStampPack(pack([{ ...crate, physical: { cover: 1.5 } }]));
        const issues = result.ok ? [] : result.issues;
        expect(issues.map((i) => i.path)).toContain('stamps.0.physical.cover');
    });

    it('rejects a stamp with no variants, a bad scale, or a bad colour', () => {
        expect(parseStampPack(pack([{ ...crate, variants: [] }])).ok).toBe(false);
        expect(parseStampPack(pack([{ ...crate, scale: 'galactic' }])).ok).toBe(false);
        expect(parseStampPack(pack([{ ...crate, light: { dim: 1, bright: 1, color: 'orange' } }])).ok).toBe(false);
    });

    it('takes a light’s darkness range, filling its ends, and refuses one upside down', () => {
        const lit = (darkness: object): ReturnType<typeof parseStampPack> =>
            parseStampPack(pack([{ ...crate, light: { dim: 2, bright: 1, darkness, hidden: true } }]));
        const night = lit({ min: 0.5 });
        expect(night.ok ? night.pack.stamps[0]?.light : null).toMatchObject({ darkness: { min: 0.5, max: 1 }, hidden: true });
        expect(lit({ min: 0.8, max: 0.2 }).ok).toBe(false);
    });

    it('rejects duplicate stamp ids', () => {
        const result = parseStampPack(pack([crate, crate]));
        const issues = result.ok ? [] : result.issues;
        expect(issues).toEqual([{ path: 'stamps.1.id', message: 'duplicate stamp id "crate"' }]);
    });
});
