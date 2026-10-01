// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The floor a room's named fixtures ask for, worked out before the room is
 * furnished: where each one placed exactly (at a point, in the middle,
 * against a named wall at its start, middle or end, in a named corner, along
 * a line, or before another) will stand. A stairwell is fixed before any
 * room is furnished, so it keeps off these, rather than take the spot a
 * brief gave a piece and leave it with no room. Pieces placed anywhere (any
 * wall, any corner) or filling the room (a grid, rows) claim nothing: they
 * find their own floor round the well. Pure; positions are in grid squares.
 */
import type { Rect, RoomCorner, Side } from '../generate/floor-plan';
import { ALONG_WALL, type Box } from './furnish';
import type { FixtureIntent, RoomIntent } from './intent';

/** A room as laid out: its floor, and the intent its fixtures come from. */
export interface ClaimingRoom {
    readonly rect: Rect;
    readonly intent: Pick<RoomIntent, 'fixtures' | 'chamfer' | 'chamferAt'>;
}

/** Squares kept round each claim: a step round the piece, as a stairwell keeps off a wall. */
const CLAIM_CLEARANCE = 0.25;

/**
 * The square a free-standing piece may take: its art is fitted to its
 * longer side whichever way round it fits, so either way round it stands
 * within that side's square.
 */
const spanOf = (fixture: FixtureIntent): { w: number; h: number } => {
    const side = Math.max(fixture.width, fixture.height);
    return { w: side, h: side };
};

/** `size` centred on the room's point `at` (fractions of the room), drawn in to stand inside the room as a free piece is. */
function centredAt(rect: Rect, at: { readonly x: number; readonly y: number }, size: { w: number; h: number }): Box {
    const inside = (v: number, lo: number, span: number, extent: number): number => Math.min(Math.max(v - extent / 2, lo), lo + span - extent);
    return { x: inside(rect.x + at.x * rect.w, rect.x, rect.w, size.w), y: inside(rect.y + at.y * rect.h, rect.y, rect.h, size.h), ...size };
}

/** The corners at each end of a wall, its start (top or left end) first. */
const WALL_ENDS: Readonly<Record<Side, readonly [RoomCorner, RoomCorner]>> = {
    top: ['top-left', 'top-right'],
    bottom: ['bottom-left', 'bottom-right'],
    left: ['top-left', 'bottom-left'],
    right: ['top-right', 'bottom-right'],
};

/** How far a room's cut corner takes from each wall it ends. */
const cutAt = (room: ClaimingRoom, corner: RoomCorner): number => (room.intent.chamferAt.includes(corner) ? room.intent.chamfer ?? 0 : 0);

/** A wall's straight run, between its cut corners: where along the room's side it starts and ends. */
function straightRun(room: ClaimingRoom, side: Side): { lo: number; hi: number } {
    const { rect } = room;
    const [start, end] = WALL_ENDS[side];
    const across = side === 'top' || side === 'bottom';
    const [from, size] = across ? [rect.x, rect.w] : [rect.y, rect.h];
    return { lo: from + cutAt(room, start), hi: from + size - cutAt(room, end) };
}

/** The floor a piece against a named wall takes: its row of `count`, at its start, middle or end (a spread, the whole wall). */
function onWall(room: ClaimingRoom, fixture: FixtureIntent, place: { wall: Side; along: string; standoff: number }): Box {
    const { lo, hi } = straightRun(room, place.wall);
    const depth = fixture.height + place.standoff;
    const row = place.along === 'spread' ? hi - lo : Math.min(hi - lo, fixture.width * fixture.count);
    const t = place.along === 'start' ? lo : place.along === 'end' ? hi - row : (lo + hi - row) / 2;
    return ALONG_WALL[place.wall](room.rect, t, row, depth, 0);
}

/** The floor a piece in a named corner takes: drawn in off a cut corner by half its cut. */
function inCorner(room: ClaimingRoom, fixture: FixtureIntent, corner: RoomCorner): Box {
    const { rect } = room;
    const inset = cutAt(room, corner) / 2;
    const onLeft = corner.endsWith('left');
    const onTop = corner.startsWith('top');
    return {
        x: onLeft ? rect.x + inset : rect.x + rect.w - inset - fixture.width,
        y: onTop ? rect.y + inset : rect.y + rect.h - inset - fixture.height,
        w: fixture.width,
        h: fixture.height,
    };
}

/** `box` grown by `by` all round. */
const grown = (box: Box, by: number): Box => ({ x: box.x - by, y: box.y - by, w: box.w + 2 * by, h: box.h + 2 * by });

/** The floor `fixture` asks for in `room`, given what the fixtures named before it claim; none where it may stand anywhere. */
function claimOf(room: ClaimingRoom, fixture: FixtureIntent, earlier: ReadonlyMap<string, readonly Box[]>): Box[] {
    const { place } = fixture;
    if ('at' in place) {
        return [centredAt(room.rect, place.at, spanOf(fixture))];
    }
    if ('centre' in place) {
        return [centredAt(room.rect, { x: 0.5, y: 0.5 }, spanOf(fixture))];
    }
    if ('wall' in place) {
        return place.wall === 'any' ? [] : [onWall(room, fixture, { wall: place.wall, along: place.along, standoff: place.standoff })];
    }
    if ('corner' in place) {
        return place.corner === 'any' ? [] : [inCorner(room, fixture, place.corner)];
    }
    if ('line' in place) {
        const { from, to } = place.line;
        const steps = Math.max(1, fixture.count - 1);
        return Array.from({ length: fixture.count }, (_, i) =>
            centredAt(room.rect, { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }, spanOf(fixture)),
        );
    }
    if ('before' in place) {
        // Which side of its target it stands on follows the target's facing, known only once placed: round it on every side.
        const reach = Math.max(fixture.width, fixture.height) + place.gap;
        return (earlier.get(place.before) ?? []).map((target) => grown(target, reach));
    }
    return [];
}

/** The floor every named fixture of `room` asks for, a step round each, in the order they are named. */
export function claimedIn(room: ClaimingRoom): Box[] {
    const byName = new Map<string, Box[]>();
    for (const fixture of room.intent.fixtures) {
        const boxes = claimOf(room, fixture, byName);
        byName.set(fixture.name, [...(byName.get(fixture.name) ?? []), ...boxes]);
    }
    return [...byName.values()].flat().map((box) => grown(box, CLAIM_CLEARANCE));
}
