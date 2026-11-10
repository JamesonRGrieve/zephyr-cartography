// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { DAYLIGHT_MAX_DARKNESS, daylightLights } from './daylight';
import { planDocuments } from './plan';
import { makeRoom, parseRoom, type RoomFeature } from './room';

/** A 100 px square room, clockwise from its top-left: segment 0 the top, 1 the right, 2 the bottom, 3 the left. */
function square(given: Partial<RoomFeature> = {}): RoomFeature {
    const room = makeRoom('r', 'dirt', [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
    ]);
    if (!room) {
        throw new Error('no room');
    }
    return { ...room, ...given };
}

const FLOOR = { level: null, elevation: 0 };

describe('daylight', () => {
    it('shines in through each daylit opening from just outside it, its cone facing into the room', () => {
        const [above, right] = daylightLights(square({ daylight: [0, 1] }), FLOOR);
        // Just over the top wall's middle, outside; facing down the canvas (Foundry's rotation 0).
        expect(above).toMatchObject({ source: { kind: 'daylight' }, x: 50, y: -5, angle: 120 });
        expect(above?.rotation).toBeCloseTo(0);
        // Just beside the right wall, facing left.
        expect(right).toMatchObject({ x: 105, y: 50 });
        expect(right?.rotation).toBeCloseTo(90);
    });

    it('reaches the far side of the room, is cut by walls, gives no vision and lights only by day', () => {
        const [light] = daylightLights(square({ daylight: [0] }), FLOOR);
        expect(light?.dim).toBeCloseTo(Math.hypot(50, 105));
        expect(light?.technique).toEqual({ walls: true, vision: false, darkness: { min: 0, max: DAYLIGHT_MAX_DARKNESS } });
    });

    it('shares the day out between a barn of many openings, so it never washes the floor white', () => {
        // A 400 by 200 barn whose top wall is sixteen 25 px openings (segments 0-15), then its right, bottom and left.
        const openings = Array.from({ length: 16 }, (_, i) => ({ x: i * 25, y: 0 }));
        const barn = makeRoom('barn', 'dirt', [...openings, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 0, y: 200 }]);
        if (!barn) {
            throw new Error('no barn');
        }
        const many = daylightLights({ ...barn, daylight: Array.from({ length: 16 }, (_, i) => i) }, FLOOR);
        expect(many).toHaveLength(16);
        for (const light of many) {
            expect(light.alpha).toBeCloseTo(0.125);
            expect(light.bright).toBe(0);
            // A window lights its own stretch of floor, not the barn's far wall.
            expect(light.dim).toBeLessThanOrEqual(4 * 25 + 1e-9);
        }
        const [one] = daylightLights(square({ daylight: [0] }), FLOOR);
        expect(one?.alpha).toBeCloseTo(0.5);
        expect(one?.bright).toBeGreaterThan(0);
        // Stacking is bounded: sixteen openings together are no more than four times one.
        const summed = many.reduce((total, l) => total + (l.alpha ?? 0), 0);
        expect(summed).toBeLessThanOrEqual(4 * (one?.alpha ?? 0) + 1e-9);
    });

    it('none for a room the day never reaches', () => {
        expect(daylightLights(square(), FLOOR)).toEqual([]);
    });

    it('joins the room’s own light in its plan, and makes its windows Foundry window walls', () => {
        const plan = planDocuments(square({ windows: [0], daylight: [0] }));
        expect(plan.lights.map((l) => l.source.kind)).toEqual(['room', 'daylight']);
        // Switched off, the room's own light goes; the day still comes in.
        expect(planDocuments(square({ windows: [0], daylight: [0], lit: false })).lights.map((l) => l.source.kind)).toEqual(['daylight']);
        const glazed = plan.walls.find((w) => w.a.y === 0 && w.b.y === 0);
        expect(glazed?.blocks).toMatchObject({ sight: 'proximity', light: 'proximity' });
        const left = plan.walls.find((w) => w.a.x === 0 && w.b.x === 0);
        expect(left?.blocks).toMatchObject({ sight: 'normal' });
    });

    it('reads windows and daylight back, keeping only segments on the outline', () => {
        expect(parseRoom({ ...square(), windows: [0, 0, 9, -1, 'x'], daylight: [2, 4] })).toMatchObject({ windows: [0], daylight: [2] });
        // A room saved before either has neither.
        const { windows: _w, daylight: _d, ...older } = square();
        expect(parseRoom(older)).toMatchObject({ windows: [], daylight: [] });
    });
});
