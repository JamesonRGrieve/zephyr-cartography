// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import { type BuildingIntent, parseMapIntent } from './intent';
import { type BuildingLayout, doorsOf } from './layout';
import { holdsStairwell, layOutStoreys, type Wells } from './storeys';

function buildingOf(given: object): BuildingIntent {
    const parsed = parseMapIntent({ schemaVersion: 1, buildings: [given] });
    const building = parsed.ok ? parsed.intent.buildings[0] : undefined;
    if (!building) {
        throw new Error(`fixture: ${JSON.stringify(parsed.ok ? 'no building' : parsed.issues)}`);
    }
    return building;
}

const HOUSE = buildingOf({
    width: 12,
    height: 9,
    rooms: [
        { key: 'hall', purpose: 'hall', entrance: true, opensTo: ['kitchen', 'common'] },
        { key: 'kitchen', purpose: 'kitchen' },
        { key: 'common', purpose: 'common-room', size: 2 },
    ],
    floors: [
        {
            name: 'Bedrooms',
            rooms: [
                { key: 'landing', purpose: 'hall', opensTo: ['bed-1', 'bed-2'] },
                { key: 'bed-1', purpose: 'bedroom' },
                { key: 'bed-2', purpose: 'bedroom' },
            ],
        },
        { rooms: [{ key: 'attic', purpose: 'storage' }] },
    ],
});

const FOOTPRINT = { x: 2, y: 3, w: 12, h: 9 };
/** A one-square flight two long up to the floors, and no way down. */
const STAIR: Wells = { up: { w: 1, h: 2 }, down: null };

/** Whether every room of `layout` can be reached from `start` through its doors. */
function allReachable(layout: BuildingLayout, start: string): boolean {
    const seen = new Set([start]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const door of layout.doors) {
            if (door.to !== null && seen.has(door.room) !== seen.has(door.to)) {
                seen.add(door.room);
                seen.add(door.to);
                grew = true;
            }
        }
    }
    return layout.rooms.every((r) => seen.has(r.key));
}

describe('layOutStoreys', () => {
    it('lays every floor over the same footprint, so its outer walls stand on the ones below', () => {
        const storeys = layOutStoreys(HOUSE, FOOTPRINT, STAIR, seededRandom(1));
        const layouts = [storeys?.ground, ...(storeys?.floors ?? [])];
        expect(layouts).toHaveLength(3);
        for (const layout of layouts) {
            const rects = layout?.rooms.map((r) => r.rect) ?? [];
            // The rooms tile the footprint exactly: its bounds, and its whole area.
            expect(Math.min(...rects.map((r) => r.x))).toBe(FOOTPRINT.x);
            expect(Math.min(...rects.map((r) => r.y))).toBe(FOOTPRINT.y);
            expect(Math.max(...rects.map((r) => r.x + r.w))).toBe(FOOTPRINT.x + FOOTPRINT.w);
            expect(Math.max(...rects.map((r) => r.y + r.h))).toBe(FOOTPRINT.y + FOOTPRINT.h);
            expect(rects.reduce((sum, r) => sum + r.w * r.h, 0)).toBe(FOOTPRINT.w * FOOTPRINT.h);
        }
    });

    it('fixes one stairwell for all floors, inside a room on each and clear of every doorway, every room reachable from it', () => {
        const storeys = layOutStoreys(HOUSE, FOOTPRINT, STAIR, seededRandom(2));
        const box = storeys?.stairwell ?? null;
        expect(box).not.toBeNull();
        for (const layout of [storeys?.ground, ...(storeys?.floors ?? [])]) {
            if (!layout || !box) {
                throw new Error('a floor was not laid out');
            }
            expect(holdsStairwell(layout, box)).toBe(true);
            const stairRoom = layout.rooms.find(
                (r) => box.x >= r.rect.x && box.x + box.w <= r.rect.x + r.rect.w && box.y >= r.rect.y && box.y + box.h <= r.rect.y + r.rect.h,
            );
            expect(stairRoom).toBeDefined();
            expect(allReachable(layout, stairRoom?.key ?? '')).toBe(true);
        }
    });

    it('stands the stairwell against a wall of its room, as a built stair does', () => {
        for (const seed of [1, 2, 3, 4, 5]) {
            const storeys = layOutStoreys(HOUSE, FOOTPRINT, STAIR, seededRandom(seed));
            const box = storeys?.stairwell;
            if (!box) {
                throw new Error(`seed ${seed}: no stairwell`);
            }
            const room = storeys.ground.rooms.find(
                (r) => box.x >= r.rect.x && box.x + box.w <= r.rect.x + r.rect.w && box.y >= r.rect.y && box.y + box.h <= r.rect.y + r.rect.h,
            );
            if (!room) {
                throw new Error(`seed ${seed}: no stairwell`);
            }
            const gap = Math.min(
                box.x - room.rect.x,
                room.rect.x + room.rect.w - box.x - box.w,
                box.y - room.rect.y,
                room.rect.y + room.rect.h - box.y - box.h,
            );
            // Within a square of a wall: its margin and half a square's step.
            expect(gap).toBeLessThanOrEqual(1);
        }
    });

    it('stands the stairwell in the ground floor’s hall when it has one', () => {
        for (const seed of [1, 2, 3, 4, 5]) {
            const storeys = layOutStoreys(HOUSE, FOOTPRINT, STAIR, seededRandom(seed));
            const box = storeys?.stairwell;
            const hall = storeys?.ground.rooms.find((r) => r.key === 'hall')?.rect;
            if (!box || !hall) {
                throw new Error(`seed ${seed}: no stairwell`);
            }
            expect(box.x >= hall.x && box.y >= hall.y && box.x + box.w <= hall.x + hall.w && box.y + box.h <= hall.y + hall.h).toBe(true);
        }
    });

    it('gives only the ground floor a front door', () => {
        const storeys = layOutStoreys(HOUSE, FOOTPRINT, STAIR, seededRandom(3));
        expect(storeys?.ground.doors.some((d) => d.to === null)).toBe(true);
        for (const floor of storeys?.floors ?? []) {
            expect(floor?.doors.some((d) => d.to === null)).toBe(false);
        }
    });

    it('lays floors out without a stairwell when there is no stair, and a building of one floor needs none', () => {
        expect(layOutStoreys(HOUSE, FOOTPRINT, { up: null, down: null }, seededRandom(4))?.stairwell).toBeNull();
        const bungalow = buildingOf({ width: 6, height: 5, rooms: [{ key: 'room', purpose: 'bedroom' }] });
        expect(layOutStoreys(bungalow, { x: 0, y: 0, w: 6, h: 5 }, STAIR, seededRandom(4))).toMatchObject({ floors: [], stairwell: null });
    });

    it('refuses a stairwell in a doorway’s approach or across a wall', () => {
        const storeys = layOutStoreys(HOUSE, FOOTPRINT, STAIR, seededRandom(5));
        const ground = storeys?.ground;
        if (!ground) {
            throw new Error('no ground floor');
        }
        const [door] = ground.doors;
        const room = ground.rooms.find((r) => r.key === door?.room);
        if (!door || !room) {
            throw new Error('no door');
        }
        const inDoorway = doorsOf(ground, room.key).map((slot) =>
            slot.side === 'top' || slot.side === 'bottom'
                ? { x: slot.at, y: slot.side === 'top' ? room.rect.y + 0.4 : room.rect.y + room.rect.h - 2.4, w: 1, h: 2 }
                : { x: slot.side === 'left' ? room.rect.x + 0.4 : room.rect.x + room.rect.w - 1.4, y: slot.at, w: 1, h: 2 },
        );
        for (const box of inDoorway) {
            expect(holdsStairwell(ground, box)).toBe(false);
        }
        // Straddling two rooms' shared wall.
        const [a] = ground.rooms;
        expect(holdsStairwell(ground, { x: (a?.rect.x ?? 0) + (a?.rect.w ?? 0) - 0.5, y: (a?.rect.y ?? 0) + 1, w: 1, h: 2 })).toBe(false);
    });

    it('lays cellars out below round a well of their own, held by the ground floor and every cellar, clear of the stairwell up', () => {
        const house = buildingOf({
            width: 12,
            height: 9,
            rooms: HOUSE.rooms,
            floors: HOUSE.floors.slice(0, 1),
            cellars: [
                {
                    name: 'Cellar',
                    rooms: [
                        { key: 'cellar', purpose: 'storage', size: 2, opensTo: ['vault'] },
                        { key: 'vault', purpose: 'storage' },
                    ],
                },
                { rooms: [{ key: 'crypt', purpose: 'storage' }] },
            ],
        });
        for (const seed of [1, 2, 3]) {
            const storeys = layOutStoreys(house, FOOTPRINT, { up: { w: 1, h: 2 }, down: { w: 2, h: 1.5 } }, seededRandom(seed));
            const { stairwell, cellarWell } = storeys ?? {};
            if (!storeys || !stairwell || !cellarWell) {
                throw new Error(`seed ${seed}: no wells`);
            }
            expect(storeys.cellars).toHaveLength(2);
            expect(holdsStairwell(storeys.ground, cellarWell)).toBe(true);
            expect(storeys.cellars.every((c) => c !== null && holdsStairwell(c, cellarWell))).toBe(true);
            // The two ways never share floor.
            const apart =
                cellarWell.x >= stairwell.x + stairwell.w ||
                stairwell.x >= cellarWell.x + cellarWell.w ||
                cellarWell.y >= stairwell.y + stairwell.h ||
                stairwell.y >= cellarWell.y + cellarWell.h;
            expect(apart).toBe(true);
            // Cellars have no front door.
            expect(storeys.cellars.every((c) => c?.doors.every((d) => d.to !== null) === true)).toBe(true);
        }
    });
});
