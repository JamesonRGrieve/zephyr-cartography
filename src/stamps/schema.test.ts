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
        const residence = { ...crate, id: 'residence', scale: 'city', enterable: true, occlusion: { shape: 'alpha', sound: false } };
        const result = parseStampPack(pack([torch, door, stairs, residence]));
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

    it('records where each asset came from: a stamp, a texture set and its textures one by one, an ambient sound and a particle emitter', () => {
        const ai = {
            source: 'Zephyr Cartography Assets',
            license: 'CC0-1.0',
            author: 'Jameson Grieve',
            url: 'https://github.com/JamesonRGrieve/zephyr-cartography-assets',
            ai: true,
        };
        const photo = { source: 'Poly Haven', license: 'CC0-1.0', author: 'Rob Tuytel', url: 'https://polyhaven.com/a/grass' };
        const set = {
            id: 'photo',
            name: 'Photo',
            license: 'CC0-1.0',
            textures: { grassland: 'textures/grass.jpg' },
            provenance: { source: 'Poly Haven', license: 'CC0-1.0' },
            sources: { grassland: photo },
        };
        const sound = { path: 'sounds/hum.ogg', radius: 6, provenance: { ...photo, source: 'Freesound' } };
        const smoke = [{ textures: ['particles/smoke.webp'], count: 4, lifetime: 2000, provenance: { source: 'Kenney', license: 'CC0-1.0' } }];
        const result = parseStampPack(
            pack([{ ...crate, provenance: ai }], { textureSets: [set], ambience: { sounds: { machine: sound }, particles: { brazier: smoke } } }),
        );
        expect(result.ok ? result.pack.stamps[0]?.provenance : null).toEqual(ai);
        expect(result.ok ? result.pack.textureSets[0]?.sources?.['grassland'] : null).toEqual(photo);
        expect(result.ok ? result.pack.ambience.sounds['machine']?.provenance?.source : null).toBe('Freesound');
        // A source page must be a link.
        expect(parseStampPack(pack([{ ...crate, provenance: { ...ai, url: 'not a link' } }])).ok).toBe(false);
        // Whether it is AI-generated is its own flag, apart from its source: work brought in from elsewhere can be AI-generated too.
        const broughtIn = { ...photo, ai: true };
        const flagged = parseStampPack(pack([{ ...crate, provenance: broughtIn }]));
        expect(flagged.ok ? flagged.pack.stamps[0]?.provenance : null).toEqual(broughtIn);
        expect(parseStampPack(pack([{ ...crate, provenance: { ...photo, ai: 'yes' } }])).ok).toBe(false);
    });

    it('reads modular tiles, square or hex, whose edges name each of their sides once', () => {
        const square = {
            id: 'corridor',
            name: 'Straight Corridor',
            category: 'Dungeon',
            geometry: 'square',
            size: { w: 2, h: 4 },
            edges: { n: 'passage', e: 'wall', s: 'passage', w: 'wall' },
            walls: [
                [0, 0, 0, 4],
                [2, 0, 2, 4],
            ],
            variants: [{ state: 'plain', image: 'tiles/corridor.webp', resolution: '512' }],
        };
        const hex = {
            ...square,
            id: 'forest',
            geometry: 'hex',
            orientation: 'pointy',
            size: { w: 1, h: 1 },
            walls: [],
            edges: { ne: 'open', e: 'open', se: 'road', sw: 'open', w: 'road', nw: 'open' },
        };
        const result = parseStampPack(pack([], { tiles: [square, hex] }));
        expect(result.ok ? result.pack.tiles.map((tile) => [tile.id, tile.geometry, tile.orientation]) : result.issues).toEqual([
            ['corridor', 'square', null],
            ['forest', 'hex', 'pointy'],
        ]);
        expect(parseStampPack(pack([])).ok ? parseStampPack(pack([])) : null).toMatchObject({ pack: { tiles: [] } });
        // A hex needs its orientation, a square none, and the edges must be its own sides.
        expect(parseStampPack(pack([], { tiles: [{ ...hex, orientation: null }] })).ok).toBe(false);
        expect(parseStampPack(pack([], { tiles: [{ ...square, orientation: 'flat' }] })).ok).toBe(false);
        expect(parseStampPack(pack([], { tiles: [{ ...square, edges: { n: 'wall', e: 'wall', s: 'wall' } }] })).ok).toBe(false);
        expect(parseStampPack(pack([], { tiles: [{ ...hex, orientation: 'flat' }] })).ok).toBe(false);
        expect(parseStampPack(pack([], { tiles: [{ ...square, geometry: 'triangle' }] })).ok).toBe(false);
        const twice = parseStampPack(pack([], { tiles: [square, square] }));
        expect(twice.ok ? [] : twice.issues.map((issue) => issue.message)).toEqual(['duplicate tiles id "corridor"']);
    });

    it('reads the library’s other classes: tokens, character art, music, sound effects, animations and scenes', () => {
        const by = { source: 'Elsewhere', license: 'CC-BY-4.0', author: 'B', url: 'https://example.com', ai: false };
        const image = { state: 'default', image: 'x.webp', resolution: '512' };
        const library = {
            tokens: [{ id: 'wolf', name: 'Wolf', category: 'Beasts', style: 'painted', provenance: by, frame: { cx: 0.5, cy: 0.3 }, variants: [image] }],
            characterArt: [{ id: 'knight', name: 'Knight', category: 'Fighters', variants: [image] }],
            music: [{ id: 'tavern', name: 'Tavern', category: 'Fantasy', path: 'music/tavern.ogg' }],
            soundEffects: [{ id: 'door', name: 'Door Slam', category: 'Doors', path: 'https://example.com/door.ogg' }],
            animations: [{ id: 'fireball', name: 'Fireball', category: 'Spells', variants: [{ state: 'cast', video: 'fx/fireball.webm' }] }],
            scenes: [
                {
                    id: 'inn',
                    name: 'Roadside Inn',
                    category: 'Fantasy',
                    size: { w: 30, h: 20 },
                    gridSize: 100,
                    levels: [{ name: 'Ground', image: 'scenes/inn-0.webp', uvtt: 'scenes/inn-0.dd2vtt' }],
                    foundry: 'scenes/inn.json',
                },
            ],
        };
        const result = parseStampPack(pack([], library));
        expect(result.ok ? [result.pack.music[0]?.loop, result.pack.soundEffects[0]?.loop, result.pack.animations[0]?.loop] : result.issues).toEqual([
            true,
            false,
            true,
        ]);
        expect(result.ok ? [result.pack.tokens[0]?.frame, result.pack.scenes[0]?.levels[0]?.uvtt, result.pack.characterArt[0]?.tags] : null).toEqual([
            { cx: 0.5, cy: 0.3 },
            'scenes/inn-0.dd2vtt',
            [],
        ]);
        expect(parseStampPack(pack([], { scenes: [{ ...library.scenes[0], levels: [] }] })).ok).toBe(false);
        expect(parseStampPack(pack([], { tokens: [{ ...library.tokens[0], variants: [] }] })).ok).toBe(false);
        const twice = parseStampPack(pack([], { music: [...library.music, ...library.music] }));
        expect(twice.ok ? [] : twice.issues.map((issue) => issue.message)).toEqual(['duplicate music id "tavern"']);
    });

    it('records how a stamp’s, texture set’s and particle emitter’s art is made, from six styles', () => {
        const smoke = [{ textures: ['particles/smoke.webp'], count: 4, lifetime: 2000, style: 'flat' }];
        const set = { id: 'photo', name: 'Photo', license: 'CC0-1.0', textures: { grassland: 'textures/grass.jpg' }, style: 'photorealistic' };
        const result = parseStampPack(pack([{ ...crate, style: 'painted' }], { textureSets: [set], ambience: { sounds: {}, particles: { brazier: smoke } } }));
        expect(result.ok ? [result.pack.stamps[0]?.style, result.pack.textureSets[0]?.style] : null).toEqual(['painted', 'photorealistic']);
        expect(result.ok ? result.pack.ambience.particles['brazier']?.[0]?.style : null).toBe('flat');
        expect(parseStampPack(pack([{ ...crate, style: 'watercolour' }])).ok).toBe(false);
    });

    it('records each variant’s and texture’s resolution as a rounded step, and refuses any other value', () => {
        const small = { ...crate, variants: [{ ...variant, resolution: '128' }] };
        const set = {
            id: 'painted',
            name: 'Painted',
            license: 'CC0-1.0',
            textures: { 'floor.deck': 'textures/painted/deck.png' },
            resolutions: { 'floor.deck': '2K' },
        };
        const result = parseStampPack(pack([small], { textureSets: [set] }));
        expect(result.ok ? result.pack.stamps[0]?.variants[0]?.resolution : null).toBe('128');
        expect(result.ok ? result.pack.textureSets[0]?.resolutions : null).toEqual({ 'floor.deck': '2K' });
        expect(parseStampPack(pack([{ ...crate, variants: [{ ...variant, resolution: '190' }] }])).ok).toBe(false);
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
