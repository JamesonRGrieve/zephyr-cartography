// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { type ClaimingRoom, claimedIn } from './claims';
import { parseMapIntent } from './intent';

/** The room `given` describes, parsed as an intent's, laid at `rect`. */
function roomOf(given: object, rect = { x: 10, y: 20, w: 11, h: 11 }): ClaimingRoom {
    const parsed = parseMapIntent({ schemaVersion: 1, buildings: [{ width: 11, height: 11, rooms: [{ key: 'room', purpose: 'office', ...given }] }] });
    const intent = parsed.ok ? parsed.intent.buildings[0]?.rooms[0] : undefined;
    if (!intent) {
        throw new Error(`fixture: ${JSON.stringify(parsed.ok ? 'no room' : parsed.issues)}`);
    }
    return { rect, intent };
}

const piece = (place: object, size = { width: 2, height: 1 }, more: object = {}): object => ({ name: 'piece', role: 'table', ...size, place, ...more });

/** `box` with the quarter-square step every claim keeps round it. */
const stepRound = (box: { x: number; y: number; w: number; h: number }): object => ({
    x: box.x - 0.25,
    y: box.y - 0.25,
    w: box.w + 0.5,
    h: box.h + 0.5,
});

describe('claimedIn', () => {
    it('claims the square of a free piece’s longer side, either way round its art may fit, drawn in to stand inside the room', () => {
        expect(claimedIn(roomOf({ fixtures: [piece({ at: { x: 0.5, y: 0.25 } })] }))).toEqual([stepRound({ x: 14.5, y: 21.75, w: 2, h: 2 })]);
        expect(claimedIn(roomOf({ fixtures: [piece({ centre: true }, { width: 2, height: 1 }, { facing: 'left' })] }))).toEqual([
            stepRound({ x: 14.5, y: 24.5, w: 2, h: 2 }),
        ]);
        // A cot asked for by the wall stands against it, not half through it.
        expect(claimedIn(roomOf({ fixtures: [piece({ at: { x: 0.94, y: 0.8 } }, { width: 1, height: 2 })] }))).toEqual([
            stepRound({ x: 19, y: 27.8, w: 2, h: 2 }),
        ]);
    });

    it('claims a piece against a named wall at its start, middle or end, between the wall’s cut corners', () => {
        const octagon = (place: object): ClaimingRoom => roomOf({ chamfer: 3, fixtures: [piece(place)] });
        expect(claimedIn(octagon({ wall: 'left', along: 'middle' }))).toEqual([stepRound({ x: 10, y: 24.5, w: 1, h: 2 })]);
        expect(claimedIn(octagon({ wall: 'top', along: 'start' }))).toEqual([stepRound({ x: 13, y: 20, w: 2, h: 1 })]);
        expect(claimedIn(octagon({ wall: 'bottom', along: 'end' }))).toEqual([stepRound({ x: 16, y: 30, w: 2, h: 1 })]);
        // Spread, it takes the whole straight wall; stood out from it, the floor behind too.
        expect(claimedIn(octagon({ wall: 'right', along: 'spread', standoff: 1 }))).toEqual([stepRound({ x: 19, y: 23, w: 2, h: 5 })]);
        // A wall uncut runs corner to corner.
        expect(claimedIn(roomOf({ chamfer: 3, chamferAt: ['bottom-left'], fixtures: [piece({ wall: 'top', along: 'start' })] }))).toEqual([
            stepRound({ x: 10, y: 20, w: 2, h: 1 }),
        ]);
    });

    it('claims a named corner, drawn in off its cut, and every point of a line', () => {
        expect(claimedIn(roomOf({ chamfer: 2, fixtures: [piece({ corner: 'bottom-right' })] }))).toEqual([stepRound({ x: 18, y: 29, w: 2, h: 1 })]);
        const line = piece({ line: { from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } } }, { width: 1, height: 1 }, { count: 3 });
        expect(claimedIn(roomOf({ fixtures: [line] }))).toEqual([
            stepRound({ x: 10, y: 25, w: 1, h: 1 }),
            stepRound({ x: 15, y: 25, w: 1, h: 1 }),
            stepRound({ x: 20, y: 25, w: 1, h: 1 }),
        ]);
    });

    it('claims round a piece named before another, on every side, and nothing for a piece placed anywhere or filling the room', () => {
        const table = { name: 'table', role: 'table', width: 2, height: 1, place: { at: { x: 0.5, y: 0.5 } } };
        const chair = { name: 'chair', role: 'seat', width: 0.5, height: 0.5, place: { before: 'table', gap: 0 } };
        expect(claimedIn(roomOf({ fixtures: [table, chair] }))).toEqual([stepRound({ x: 14.5, y: 24.5, w: 2, h: 2 }), stepRound({ x: 14, y: 24, w: 3, h: 3 })]);
        const anywhere = [piece({ wall: 'any' }), piece({ corner: 'any' }), piece({ grid: { columns: 2, rows: 2 } }), piece({ rows: 'along' })];
        expect(claimedIn(roomOf({ fixtures: anywhere }))).toEqual([]);
    });
});
