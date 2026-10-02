// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { physicsOf } from './physics';

describe('physicsOf', () => {
    it('walls a tall solid body round, hiding what is behind it and barring the way', () => {
        for (const [role, tags] of [
            ['shelf', ['archive']],
            ['machine', ['press']],
            ['vehicle', ['hauler']],
            ['storage', ['metal', 'locker']],
            ['fitting', ['support', 'column']],
        ] as const) {
            const physics = physicsOf(role, tags);
            // Terrain walls: the piece itself is seen through its near side, never what lies beyond both.
            expect(physics.occlusion).toMatchObject({ shape: 'bounds', sight: 'limited', movement: true, light: 'limited' });
            expect(physics.physical).toMatchObject({ cover: 1, blocksMovement: true });
        }
    });

    it('makes low furniture cover that is seen over and crossed at twice the going, never a wall', () => {
        for (const role of ['table', 'pew', 'desk', 'counter', 'console', 'storage'] as const) {
            const physics = physicsOf(role, []);
            expect(physics.occlusion).toBeUndefined();
            expect(physics.physical).toEqual({ height: 0.5, cover: 0.5 });
            expect(physics.terrain).toEqual({ difficulty: { walk: 2 } });
        }
    });

    it('makes a chest, a footlocker, a locker or a crate a container; barrels, sacks and furniture stay scenery', () => {
        expect(physicsOf('chest', ['treasure']).container).toBe(true);
        expect(physicsOf('storage', ['standing', 'locker']).container).toBe(true);
        expect(physicsOf('storage', ['ammo', 'crate']).container).toBe(true);
        expect(physicsOf('fitting', ['wall', 'cabinet']).container).toBe(true);
        expect(physicsOf('storage', ['barrels']).container).toBeUndefined();
        expect(physicsOf('storage', ['sack', 'pile']).container).toBeUndefined();
        expect(physicsOf('table', ['oak']).container).toBeUndefined();
    });

    it('bars the way at a defence or a railing but hides nothing behind it', () => {
        const sandbags = physicsOf('barricade', ['sandbag']);
        expect(sandbags.occlusion).toMatchObject({ sight: false, movement: true });
        expect(sandbags.physical).toMatchObject({ cover: 0.75, blocksMovement: true });
        // A railing is a barrier whatever role its tags give it.
        expect(physicsOf('fitting', ['steel', 'railing', 'segment']).occlusion).toMatchObject({ sight: false, movement: true, light: false });
    });

    it('makes an open fire, a spill, a live reactor or a pit a hazard reaching half a square past it; never a mark or a lamp', () => {
        expect(physicsOf('fitting', ['burning', 'barrel']).hazard).toEqual({ kind: 'fire', reach: 0.5 });
        expect(physicsOf('machine', ['acid', 'vat']).hazard).toEqual({ kind: 'acid', reach: 0.5 });
        // A reactor is a solid body and a hazard both.
        const reactor = physicsOf('machine', ['reactor', 'core']);
        expect(reactor.hazard?.kind).toBe('radiation');
        expect(reactor.occlusion).toMatchObject({ sight: 'limited' });
        expect(physicsOf('fitting', ['open', 'pit']).hazard?.kind).toBe('fall');
        // A scorch mark, a lamp, a candle: fire's traces or fire kept in check.
        expect(physicsOf('decal', ['scorch', 'fire']).hazard).toBeUndefined();
        expect(physicsOf('light', ['brazier', 'fire']).hazard).toBeUndefined();
    });

    it('hangs a roof or a tree’s crown over a token beneath: a roof fades and keeps the weather off, a crown cuts away round it', () => {
        const tent = physicsOf('structure', ['command', 'tent', 'roof']);
        expect(tent.tile).toEqual({ occlusion: { modes: ['fade'], alpha: 0.25 }, restrictions: { weather: true } });
        // Overhead, it hangs over the floor: no walls, however solid a structure it is.
        expect(tent.occlusion).toBeUndefined();
        expect(tent.physical).toEqual({ height: 3 });
        expect(physicsOf('tree', ['oak']).tile).toEqual({ occlusion: { modes: ['radial'], alpha: 0.25 } });
    });

    it('makes rubble and fallen timber hard going, and leaves what neither hides, bars nor slows alone', () => {
        expect(physicsOf('debris', ['rubble']).terrain).toEqual({ difficulty: { walk: 2 } });
        expect(physicsOf('log', ['fallen']).physical).toMatchObject({ cover: 0.5 });
        for (const role of ['decal', 'rug', 'tabletop', 'light', 'seat', 'door', 'stairs', 'flora'] as const) {
            expect(physicsOf(role, [])).toEqual({});
        }
        expect(physicsOf(undefined, ['column'])).toEqual({});
        // A fitting is only a body where its tags say so: a pipe run on a wall hides nothing.
        expect(physicsOf('fitting', ['pipe', 'run'])).toEqual({});
    });
});
