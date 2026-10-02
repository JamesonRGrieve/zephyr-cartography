// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { withDocs } from './feature';
import { NO_DOCS } from './generated-docs';
import { DEFAULT_FLOOR, doorOn, makeRoom, NEW_DOOR, parseRoom, roomLight, roomWalls, withRoomDoor, withRoomMaterials, withRoomPoints } from './room';

const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
];

describe('makeRoom', () => {
    it('builds a room from >= 3 points with no wall links yet', () => {
        const r = makeRoom('r', DEFAULT_FLOOR, pts);
        expect(r?.type).toBe('room');
        expect(r?.floor).toBe(DEFAULT_FLOOR);
        expect(r?.points).toHaveLength(4);
        expect(r?.docs).toEqual(NO_DOCS);
    });

    it('returns null for fewer than three points', () => {
        expect(
            makeRoom('r', 'dirt', [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
            ]),
        ).toBeNull();
    });
});

describe('withRoomPoints', () => {
    it('rebuilds with new points, preserving floor', () => {
        const r = makeRoom('r', 'rock', pts);
        expect(r).not.toBeNull();
        const shrunk = r ? withRoomPoints(r, pts.slice(0, 3)) : null;
        expect(shrunk?.points).toHaveLength(3);
        expect(shrunk?.floor).toBe('rock');
        expect(r ? withRoomPoints(r, pts.slice(0, 2)) : 'x').toBeNull();
    });

    it('drops windows and daylight on segments the new outline no longer has', () => {
        const r = makeRoom('r', 'rock', pts);
        const shrunk = r ? withRoomPoints({ ...r, windows: [0, 3], daylight: [1, 3] }, pts.slice(0, 3)) : null;
        expect([shrunk?.windows, shrunk?.daylight]).toEqual([[0], [1]]);
    });
});

describe('materials', () => {
    it('defaults to no drawn wall and swaps floor and wall together', () => {
        const r = makeRoom('r', 'dirt', pts);
        expect(r?.wall).toBeNull();
        expect(r?.wallKind).toBe('solid');
        expect(r?.ceiling).toBe(true);
        const dressed = r ? withRoomMaterials(r, { floor: 'floor.oak', wall: 'wall.brick', wallKind: 'terrain', ceiling: false }) : null;
        expect(dressed?.floor).toBe('floor.oak');
        expect(dressed?.wall).toBe('wall.brick');
        expect(dressed?.wallKind).toBe('terrain');
        expect(dressed?.ceiling).toBe(false);
        expect(dressed?.points).toEqual(r?.points);
    });

    it('keeps materials through a points edit', () => {
        const r = makeRoom('r', 'floor.oak', pts, 'wall.brick');
        const moved = r ? withRoomPoints(r, pts.slice(0, 3)) : null;
        expect(moved?.floor).toBe('floor.oak');
        expect(moved?.wall).toBe('wall.brick');
    });
});

describe('doors + roomWalls', () => {
    it('carries each segment and the door on it into the generated walls', () => {
        const r = makeRoom('r', 'dirt', pts); // 4 points → 4 perimeter segments
        const withDoor = r ? withRoomDoor(r, 1, { ...NEW_DOOR, type: 'secret', state: 'locked' }) : null;
        const walls = withDoor ? roomWalls(withDoor) : [];
        expect(walls).toHaveLength(4);
        expect(walls[1]?.door).toEqual({ segment: 1, ...NEW_DOOR, type: 'secret', state: 'locked' });
        expect(walls[0]?.door).toBeNull();
        expect(walls.map((w) => w.segment)).toEqual([0, 1, 2, 3]);
    });

    it('replaces, reads and clears doors, keeping them in segment order', () => {
        const r = makeRoom('r', 'dirt', pts);
        const two = r ? withRoomDoor(withRoomDoor(r, 2, NEW_DOOR), 0, NEW_DOOR) : null;
        expect(two?.doors.map((d) => d.segment)).toEqual([0, 2]);
        const opened = two ? withRoomDoor(two, 2, { ...NEW_DOOR, state: 'open' }) : null;
        expect(opened ? doorOn(opened, 2) : null).toEqual({ segment: 2, ...NEW_DOOR, state: 'open' });
        const cleared = opened ? withRoomDoor(opened, 0, null) : null;
        expect(cleared?.doors.map((d) => d.segment)).toEqual([2]);
        expect(cleared ? doorOn(cleared, 0) : 'x').toBeNull();
    });

    it('drops doors on segments that no longer exist when the room shrinks', () => {
        const r = makeRoom('r', 'dirt', pts);
        const withDoor = r ? withRoomDoor(r, 3, NEW_DOOR) : null; // door on the 4th segment
        const shrunk = withDoor ? withRoomPoints(withDoor, pts.slice(0, 3)) : null; // now 3 segments
        expect(shrunk?.doors).toEqual([]);
    });
});

describe('document links', () => {
    it('survive a points edit', () => {
        const r = makeRoom('r', 'dirt', pts);
        const linked = r ? withDocs(r, { ...NO_DOCS, walls: ['w0'], lights: ['L0'] }) : null;
        const moved = linked ? withRoomPoints(linked, pts.slice(0, 3)) : null;
        expect(moved?.docs).toEqual({ ...NO_DOCS, walls: ['w0'], lights: ['L0'] });
    });
});

describe('roomLight', () => {
    it('centres on the vertex average and reaches the farthest corner', () => {
        const r = makeRoom('r', 'dirt', pts);
        expect(r ? roomLight(r) : null).toEqual({ x: 50, y: 50, dim: Math.hypot(50, 50), bright: Math.hypot(50, 50) / 2 });
    });
});

describe('parseRoom', () => {
    it('parses a valid room and its document links', () => {
        const r = parseRoom({ type: 'room', id: 'a', floor: 'sand', points: pts, docs: { walls: ['w0', 'w1'], lights: ['L0'] } });
        expect(r?.floor).toBe('sand');
        expect(r?.points).toHaveLength(4);
        expect(r?.docs).toEqual({ ...NO_DOCS, walls: ['w0', 'w1'], lights: ['L0'] });
    });

    it('reads the legacy flat wallIds / lightIds fields', () => {
        const r = parseRoom({ type: 'room', id: 'a', floor: 'sand', points: pts, wallIds: ['w0', 'w1'], lightIds: ['L0'] });
        expect(r?.docs).toEqual({ ...NO_DOCS, walls: ['w0', 'w1'], lights: ['L0'] });
    });

    it('defaults document links to empty when absent', () => {
        expect(parseRoom({ type: 'room', id: 'a', floor: 'sand', points: pts })?.docs).toEqual(NO_DOCS);
    });

    it('parses doors, reading bare indices (the original format) as ordinary closed doors', () => {
        const doors = parseRoom({
            type: 'room',
            id: 'a',
            floor: 'dirt',
            points: pts,
            doors: [
                0,
                { segment: 2, type: 'secret', state: 'open', sound: 'woodCreaky', animation: 'swivel' },
                { segment: 3, type: 'portal', state: 'ajar', sound: '', animation: 'teleport' },
                { segment: -1 },
                'x',
            ],
        })?.doors;
        expect(doors).toEqual([
            { segment: 0, ...NEW_DOOR },
            { segment: 2, type: 'secret', state: 'open', sound: 'woodCreaky', animation: 'swivel' },
            // An unknown type, state or animation, and a blank sound, fall back to Foundry's defaults.
            { segment: 3, ...NEW_DOOR },
        ]);
    });

    it('parses pack floor and wall materials, reading anything else as an undrawn wall', () => {
        const dressed = parseRoom({ type: 'room', id: 'a', floor: 'floor.oak', wall: 'wall.brick', points: pts });
        expect(dressed?.floor).toBe('floor.oak');
        expect(dressed?.wall).toBe('wall.brick');
        expect(parseRoom({ type: 'room', id: 'b', floor: 'dirt', wall: 'brick', points: pts })?.wall).toBeNull();
        expect(parseRoom({ type: 'room', id: 'c', floor: 'dirt', points: pts })?.wall).toBeNull();
        expect(parseRoom({ type: 'room', id: 'd', floor: 'floor.', points: pts })).toBeNull();
    });

    it('reads a room saved before ceilings existed as having one, and keeps an open one open', () => {
        expect(parseRoom({ type: 'room', id: 'a', floor: 'dirt', points: pts })?.ceiling).toBe(true);
        expect(parseRoom({ type: 'room', id: 'b', floor: 'dirt', points: pts, ceiling: false })?.ceiling).toBe(false);
    });

    it('rejects non-rooms, unknown floors, and too-few points', () => {
        expect(parseRoom({ type: 'region', id: 'x' })).toBeNull();
        expect(parseRoom({ type: 'room', id: 'y', floor: 'quicksand', points: pts })).toBeNull();
        expect(parseRoom({ type: 'room', id: 'z', floor: 'dirt', points: pts.slice(0, 2) })).toBeNull();
    });
});
