// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Rect } from '../generate/floor-plan';
import { seededRandom } from '../generate/random';
import { type BuildingIntent, parseMapIntent } from './intent';
import { type BuildingLayout, layOutBuilding, sharedWall } from './layout';

/** A building intent with its defaults filled, as the composer receives it. */
function building(given: object): BuildingIntent {
    const parsed = parseMapIntent({ schemaVersion: 1, buildings: [given] });
    const b = parsed.ok ? parsed.intent.buildings[0] : undefined;
    if (!b) {
        throw new Error(`fixture: ${JSON.stringify(parsed)}`);
    }
    return b;
}

const TAVERN = building({
    width: 18,
    height: 12,
    entrance: 'south',
    rooms: [
        { key: 'common', purpose: 'common-room', size: 4, entrance: true, opensTo: ['bar', 'stair'] },
        { key: 'bar', purpose: 'bar', size: 1.5, opensTo: ['kitchen'] },
        { key: 'kitchen', purpose: 'kitchen', size: 1.5, opensTo: ['store'] },
        { key: 'store', purpose: 'storage', size: 1 },
        { key: 'stair', purpose: 'hall', size: 0.8 },
    ],
});

const FOOTPRINT: Rect = { x: 2, y: 3, w: 18, h: 12 };

function layOut(b: BuildingIntent, footprint: Rect, seed: number): BuildingLayout {
    const layout = layOutBuilding(b, footprint, seededRandom(seed));
    if (!layout) {
        throw new Error('no layout');
    }
    return layout;
}

/** The rooms reached from `start` through the layout's doors. */
function reached(layout: BuildingLayout, start: string): Set<string> {
    const seen = new Set([start]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const door of layout.doors) {
            const ends = [door.room, door.to];
            if (door.to !== null && ends.some((e) => e !== null && seen.has(e)) && !ends.every((e) => e !== null && seen.has(e))) {
                seen.add(door.room);
                seen.add(door.to);
                grew = true;
            }
        }
    }
    return seen;
}

describe('layOutBuilding', () => {
    it('fills the footprint with its rooms, wall to wall, none overlapping', () => {
        for (const seed of [1, 2, 3, 4, 5]) {
            const { rooms } = layOut(TAVERN, FOOTPRINT, seed);
            expect(rooms.map((r) => r.key).sort()).toEqual(['bar', 'common', 'kitchen', 'stair', 'store']);
            expect(rooms.reduce((sum, r) => sum + r.rect.w * r.rect.h, 0)).toBe(FOOTPRINT.w * FOOTPRINT.h);
            for (const { rect } of rooms) {
                expect(rect.x).toBeGreaterThanOrEqual(FOOTPRINT.x);
                expect(rect.y).toBeGreaterThanOrEqual(FOOTPRINT.y);
                expect(rect.x + rect.w).toBeLessThanOrEqual(FOOTPRINT.x + FOOTPRINT.w);
                expect(rect.y + rect.h).toBeLessThanOrEqual(FOOTPRINT.y + FOOTPRINT.h);
                expect(Math.min(rect.w, rect.h)).toBeGreaterThanOrEqual(2);
            }
        }
    });

    it('sizes rooms by what the intent asks: the common room largest, the stair smallest', () => {
        const { rooms } = layOut(TAVERN, FOOTPRINT, 1);
        const area = (key: string): number => {
            const rect = rooms.find((r) => r.key === key)?.rect;
            return rect ? rect.w * rect.h : 0;
        };
        expect(Math.max(...rooms.map((r) => area(r.key)))).toBe(area('common'));
        expect(area('common')).toBeGreaterThan(area('bar') * 2);
    });

    it('puts rooms that open onto each other side by side, with a door in their shared wall', () => {
        for (const seed of [1, 2, 3]) {
            const layout = layOut(TAVERN, FOOTPRINT, seed);
            expect(layout.unmet).toEqual([]);
            for (const [a, b] of [
                ['common', 'bar'],
                ['bar', 'kitchen'],
                ['kitchen', 'store'],
                ['common', 'stair'],
            ] as const) {
                const door = layout.doors.find((d) => (d.room === a && d.to === b) || (d.room === b && d.to === a));
                const from = layout.rooms.find((r) => r.key === door?.room)?.rect;
                const to = layout.rooms.find((r) => r.key === door?.to)?.rect;
                const wall = from && to ? sharedWall(from, to) : null;
                expect(wall?.side).toBe(door?.slot.side);
                // The door square lies within the shared wall.
                expect(door?.slot.at).toBeGreaterThanOrEqual(wall?.from ?? Infinity);
                expect((door?.slot.at ?? Infinity) + 1).toBeLessThanOrEqual(wall?.to ?? -Infinity);
            }
        }
    });

    it('opens the front door in the entrance room’s outer wall, on the side the building faces', () => {
        const layout = layOut(TAVERN, FOOTPRINT, 2);
        const front = layout.doors.filter((d) => d.to === null);
        expect(front).toHaveLength(1);
        expect(front[0]?.room).toBe('common');
        expect(front[0]?.slot.side).toBe('bottom');
        const common = layout.rooms.find((r) => r.key === 'common')?.rect;
        expect((common?.y ?? 0) + (common?.h ?? 0)).toBe(FOOTPRINT.y + FOOTPRINT.h);
    });

    it('reaches every room from the entrance, adding doors where the asked-for ones leave a room cut off', () => {
        // A store no one asked to open onto still gets a door.
        const layout = layOut(TAVERN, FOOTPRINT, 3);
        expect(reached(layout, 'common').size).toBe(5);
        // Five rooms in a strip cannot all adjoin the first: those it cannot reach are reported, and still joined up.
        const strip = building({
            width: 15,
            height: 3,
            rooms: [
                { key: 'a', purpose: 'hall', opensTo: ['b', 'c', 'd', 'e'] },
                { key: 'b', purpose: 'cell' },
                { key: 'c', purpose: 'cell' },
                { key: 'd', purpose: 'cell' },
                { key: 'e', purpose: 'cell' },
            ],
        });
        const narrow = layOut(strip, { x: 0, y: 0, w: 15, h: 3 }, 1);
        expect(narrow.unmet.length).toBeGreaterThan(0);
        expect(reached(narrow, 'a').size).toBe(5);
    });

    it('is the same for the same seed', () => {
        expect(layOut(TAVERN, FOOTPRINT, 7)).toEqual(layOut(TAVERN, FOOTPRINT, 7));
    });

    it('has no layout when the rooms cannot fit the footprint', () => {
        const crowded = building({ width: 3, height: 3, rooms: [0, 1, 2, 3].map((i) => ({ key: `r${i}`, purpose: 'cell' })) });
        expect(layOutBuilding(crowded, { x: 0, y: 0, w: 3, h: 3 }, seededRandom(1))).toBeNull();
    });

    it('takes the first room as the entrance when none is marked, and faces another way when the asked-for side is inside', () => {
        const pair = building({
            width: 6,
            height: 4,
            entrance: 'north',
            rooms: [
                { key: 'hall', purpose: 'hall' },
                { key: 'cell', purpose: 'cell' },
            ],
        });
        const layout = layOut(pair, { x: 0, y: 0, w: 6, h: 4 }, 1);
        const front = layout.doors.find((d) => d.to === null);
        expect(front?.room).toBe('hall');
    });
});

describe('sharedWall', () => {
    const a: Rect = { x: 0, y: 0, w: 4, h: 4 };
    it('finds the wall two rooms share, on each side, and none where they only meet at a corner or not at all', () => {
        expect(sharedWall(a, { x: 4, y: 2, w: 3, h: 5 })).toEqual({ side: 'right', from: 2, to: 4 });
        expect(sharedWall(a, { x: -3, y: 1, w: 3, h: 2 })).toEqual({ side: 'left', from: 1, to: 3 });
        expect(sharedWall(a, { x: 1, y: 4, w: 5, h: 2 })).toEqual({ side: 'bottom', from: 1, to: 4 });
        expect(sharedWall(a, { x: 0, y: -2, w: 4, h: 2 })).toEqual({ side: 'top', from: 0, to: 4 });
        expect(sharedWall(a, { x: 4, y: 4, w: 2, h: 2 })).toBeNull();
        expect(sharedWall(a, { x: 6, y: 0, w: 2, h: 2 })).toBeNull();
    });
});
