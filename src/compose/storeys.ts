// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A building's storeys. Every floor is laid out over the same footprint, so
 * each floor's outer walls stand exactly on the ones below. A stairwell, the
 * size of the stair the building gets and lying either way round, is fixed
 * in one place on every floor:
 * wholly inside one room on each, clear of every door's approach, so the
 * stair is reached from a doorway on every floor. The ground floor is laid
 * out first; a spot it holds is then tried on each floor above, whose layout
 * is chosen among those that hold it, and other spots are tried when the
 * floors cannot agree on one. Cellars below are laid out the same way round
 * a well of their own, clear of the stairwell up. Pure and unit-tested;
 * positions are in grid squares.
 */
import type { Rect } from '../generate/floor-plan';
import { shuffled, type Random } from '../generate/random';
import { WALL_BAND_SQUARES } from '../tools/materials';
import { type Box, DOOR_CLEAR, doorApproach, overlaps, within } from './furnish';
import type { BuildingIntent, RoomPurpose } from './intent';
import { type BuildingLayout, CORRIDOR_WIDTH, doorsOf, layOutBuilding } from './layout';

/** Squares kept between a stairwell and its room's walls: the wall's own band and a step round it. */
const STAIRWELL_MARGIN = WALL_BAND_SQUARES / 2 + 0.25;

/** Squares between the stairwell spots tried. */
const SPOT_STEP = 0.5;

/** Spots tried before a building goes without a stairwell. */
const SPOT_TRIES = 12;

/**
 * A building's ground floor; the floors above it and the cellars below it,
 * top down (null where one's rooms could not fit); and the stairwell the
 * floors share and the well the cellars share (null when there is none).
 */
export interface Storeys {
    readonly ground: BuildingLayout;
    readonly floors: readonly (BuildingLayout | null)[];
    readonly stairwell: Well | null;
    readonly cellars: readonly (BuildingLayout | null)[];
    readonly cellarWell: Well | null;
}

/** A stairwell: where it stands, and whether it lies turned a quarter from its stair as drawn (its flights across the other way). */
export interface Well extends Box {
    readonly turned: boolean;
}

/** The size of the well each way needs: its flights side by side; null for none. */
export interface Wells {
    readonly up: { readonly w: number; readonly h: number } | null;
    readonly down: { readonly w: number; readonly h: number } | null;
}

type LaidRoom = BuildingLayout['rooms'][number];

/** The room of `layout` holding the stairwell `box`: wholly inside it, off its walls, and clear of every door's approach there; none if no room does. */
function stairwellRoom(layout: BuildingLayout, box: Box): LaidRoom | undefined {
    const room = layout.rooms.find((r) =>
        within(box, { x: r.rect.x + STAIRWELL_MARGIN, y: r.rect.y + STAIRWELL_MARGIN, w: r.rect.w - 2 * STAIRWELL_MARGIN, h: r.rect.h - 2 * STAIRWELL_MARGIN }),
    );
    return room && !doorsOf(layout, room.key).some((door) => overlaps(doorApproach(room.rect, door), box)) ? room : undefined;
}

/**
 * Where a stair stands, best first: a hall; a public room (an inn's common
 * room, a bar); a room people work in; last a private or service room (a
 * kitchen, a store, a bedroom), which a stair climbs out of only where it
 * must.
 */
const STAIR_RANK: Readonly<Record<RoomPurpose, number>> = {
    'hall': 0,
    'common-room': 1,
    'bar': 1,
    'mess': 1,
    'porch': 1,
    'chapel': 2,
    'office': 2,
    'workshop': 2,
    'shrine': 2,
    'medicae': 2,
    'command': 2,
    'armoury': 2,
    'manufactorum': 2,
    'kitchen': 3,
    'storage': 3,
    'bedroom': 3,
    'cell': 3,
    'barracks': 3,
    'interrogation': 3,
};

/** Every rank a stair's room may have, best first. */
const STAIR_RANKS: readonly number[] = [...new Set(Object.values(STAIR_RANK))].sort((a, b) => a - b);

/** How fit `room` is to hold a stair: lower is better (see {@link STAIR_RANK}). */
const stairRank = (room: LaidRoom): number => STAIR_RANK[room.intent.purpose];

/** Whether `layout` holds the stairwell `box` in one of its rooms. */
export const holdsStairwell = (layout: BuildingLayout, box: Box): boolean => stairwellRoom(layout, box) !== undefined;

/** How far (squares) `box` stands from the nearest wall of `room`, which holds it, past the stairwell margin. */
function fromWall(room: LaidRoom, box: Box): number {
    const { x, y, w, h } = room.rect;
    return Math.min(box.x - x, x + w - (box.x + box.w), box.y - y, y + h - (box.y + box.h)) - STAIRWELL_MARGIN;
}

/** Every place in `footprint` a stairwell `size` could go, either way round, on a half-square step, in a seeded order. */
function spots(footprint: Rect, size: { readonly w: number; readonly h: number }, random: Random): Well[] {
    const found: Well[] = [];
    // A square well turned is the same well.
    const turns = size.w === size.h ? [false] : [false, true];
    for (const turned of turns) {
        const [w, h] = turned ? [size.h, size.w] : [size.w, size.h];
        for (let x = footprint.x + STAIRWELL_MARGIN; x + w <= footprint.x + footprint.w - STAIRWELL_MARGIN; x += SPOT_STEP) {
            for (let y = footprint.y + STAIRWELL_MARGIN; y + h <= footprint.y + footprint.h - STAIRWELL_MARGIN; y += SPOT_STEP) {
                found.push({ x, y, w, h, turned });
            }
        }
    }
    return shuffled(random, found);
}

/**
 * Squares across a corridor a stair of `size` climbs into, narrowest first:
 * two abreast, or wide enough to hold its stairwell lying along it off both
 * its walls; then a doorway's approach wider, so a stair too long to fit
 * between the doors along it stands against one wall, the far wall's
 * doorways clear of it.
 */
function corridorsFor(size: { readonly w: number; readonly h: number }): number[] {
    const depth = Math.min(size.w, size.h);
    const narrow = Math.max(CORRIDOR_WIDTH, Math.ceil(depth + 2 * STAIRWELL_MARGIN));
    const wide = Math.max(narrow, Math.ceil(depth + STAIRWELL_MARGIN + DOOR_CLEAR.depth));
    return wide > narrow ? [narrow, wide] : [narrow];
}

/**
 * Lay out `building`'s ground floor, its `floors` round a stairwell of the
 * `up` well's size and its `cellars` round one of the `down` well's size,
 * each well common to the ground floor and its storeys; null when the ground
 * floor's rooms cannot fit. Without a stair (or when the storeys cannot
 * share a spot) they are laid out on their own and the well is null.
 */
export function layOutStoreys(building: BuildingIntent, footprint: Rect, wells: Wells, random: Random): Storeys | null {
    const landed = hallToHall(building, footprint, wells, random);
    if (landed) {
        return landed;
    }
    const ground = layOutBuilding(building, footprint, random);
    if (!ground) {
        return null;
    }
    const up = stack(ground, building.floors, { building, footprint, size: wells.up, clear: null }, random);
    return withCellars(building, footprint, wells, random, { ground, floors: up.layouts, stairwell: up.well });
}

/** The cellars laid out under `upper` round a well of their own, clear of its stairwell. */
function withCellars(
    building: BuildingIntent,
    footprint: Rect,
    wells: Wells,
    random: Random,
    upper: Pick<Storeys, 'ground' | 'floors' | 'stairwell'>,
): Storeys {
    const down = stack(upper.ground, building.cellars, { building, footprint, size: wells.down, clear: upper.stairwell }, random);
    return { ...upper, cellars: down.layouts, cellarWell: down.well };
}

/**
 * A stair that climbs from hall to hall: the floors above laid out first
 * (a corridor falls where the footprint puts it), then the ground floor
 * among the layouts whose hall holds a spot in every hall above, so the
 * landing is in the corridor, never in a guest's room. Null without floors,
 * a stair, or such a ground floor.
 */
function hallToHall(building: BuildingIntent, footprint: Rect, wells: Wells, random: Random): Storeys | null {
    const size = wells.up;
    // A stair the intent puts in a room of its own choosing stands there, not in whatever hall the floors share.
    if (building.floors.length === 0 || size === null || building.accessRoom !== null) {
        return null;
    }
    for (const corridor of corridorsFor(size)) {
        const landed = landedAt(building, footprint, wells, random, { size, corridor });
        if (landed) {
            return landed;
        }
    }
    return null;
}

/** The storeys of `hallToHall` with the floors above laid round a corridor `corridor` squares across; null where they cannot land. */
function landedAt(
    building: BuildingIntent,
    footprint: Rect,
    wells: Wells,
    random: Random,
    { size, corridor }: { readonly size: { readonly w: number; readonly h: number }; readonly corridor: number },
): Storeys | null {
    const above = building.floors.map((storey) => layOutBuilding(building, footprint, random, { front: false, accept: () => true, corridor }, storey.rooms));
    const floors = above.flatMap((layout) => (layout ? [layout] : []));
    if (floors.length !== above.length || !floors.some(hasHall)) {
        return null;
    }
    const landings = spots(footprint, size, random).filter((box) => floors.every((layout) => inHall(layout, box)));
    // The stair climbs from the ground floor's hall where one of its layouts puts the hall under the landing; else from
    // the fittest room a layout can put there (an inn's common room, never its kitchen where a common room will do).
    // Where it arrives is what matters: the corridor.
    const holds = (most: number) => (layout: BuildingLayout) =>
        landings.some((box) => {
            const room = stairwellRoom(layout, box);
            return room !== undefined && stairRank(room) <= most;
        });
    const ground = STAIR_RANKS.map(holds).reduce<BuildingLayout | null>(
        (laid, accept) => laid ?? layOutBuilding(building, footprint, random, { front: true, accept }),
        null,
    );
    if (!ground) {
        return null;
    }
    // In the hall where it can be, and against a wall of the ground floor's room, as a built stair stands.
    const [stairwell] = landings
        .flatMap((box) => {
            const room = stairwellRoom(ground, box);
            return room ? [{ box, rank: stairRank(room), away: fromWall(room, box) }] : [];
        })
        .sort((a, b) => a.rank - b.rank || a.away - b.away)
        .map(({ box }) => box);
    return stairwell ? withCellars(building, footprint, wells, random, { ground, floors, stairwell }) : null;
}

/** Whether a layout has a hall: where it does, a stair stands in it. */
const hasHall = (layout: BuildingLayout): boolean => layout.rooms.some((r) => r.intent.purpose === 'hall');

/** Whether `layout` holds the stairwell `box` in its hall, where it has one, else in any room. */
function inHall(layout: BuildingLayout, box: Box): boolean {
    const room = stairwellRoom(layout, box);
    return room !== undefined && (!hasHall(layout) || room.intent.purpose === 'hall');
}

/**
 * `storeys` laid out over the footprint round one well of `size`, held by
 * the ground floor and every storey and clear of the box `clear` (the other
 * way's well).
 */
function stack(
    ground: BuildingLayout,
    storeys: BuildingIntent['floors'],
    shared: { readonly building: BuildingIntent; readonly footprint: Rect; readonly size: Wells['up']; readonly clear: Box | null },
    random: Random,
): { layouts: (BuildingLayout | null)[]; well: Well | null } {
    const { building, footprint, size, clear } = shared;
    // A storey laid round a corridor makes it wide enough to hold the stairwell, so the stair lands in it.
    const widened = size === null ? {} : { corridor: corridorsFor(size)[0] ?? CORRIDOR_WIDTH };
    const each = (accept: (layout: BuildingLayout) => boolean): (BuildingLayout | null)[] =>
        storeys.map((storey) => layOutBuilding(building, footprint, random, { front: false, accept, ...widened }, storey.rooms));
    if (storeys.length === 0 || size === null) {
        return { layouts: each(() => true), well: null };
    }
    // A stair stands in a hall where the ground floor has one, and against a wall, as a built one does: those spots first.
    const held = spots(footprint, size, random)
        .flatMap((box) => {
            const room = stairwellRoom(ground, box);
            const asked = building.accessRoom === null || room?.key === building.accessRoom;
            return room && asked && (clear === null || !overlaps(box, clear)) ? [{ box, room }] : [];
        })
        .sort((a, b) => stairRank(a.room) - stairRank(b.room) || fromWall(a.room, a.box) - fromWall(b.room, b.box))
        .map(({ box }) => box);
    // The first spot every storey can hold with every room beside those it opens onto; else the one that misses fewest.
    // Tried first in the halls of every storey that has one; anywhere each storey holds it only when that keeps more rooms
    // beside those they open onto (a stair too deep for a corridor must not cost the corridor its rooms).
    const search = (
        spotsTried: readonly Well[],
        holds: (layout: BuildingLayout, box: Box) => boolean,
    ): { layouts: BuildingLayout[]; well: Well; unmet: number } | null => {
        let best: { layouts: BuildingLayout[]; well: Well; unmet: number } | null = null;
        for (const box of spotsTried.slice(0, SPOT_TRIES)) {
            const layouts = each((layout) => holds(layout, box));
            const laid = layouts.flatMap((l) => (l ? [l] : []));
            if (laid.length === layouts.length) {
                const unmet = laid.reduce((sum, l) => sum + l.unmet.length, 0);
                if (!best || unmet < best.unmet) {
                    best = { layouts: laid, well: box, unmet };
                }
                if (unmet === 0) {
                    break;
                }
            }
        }
        return best;
    };
    const halled = search(
        held.filter((box) => inHall(ground, box)),
        inHall,
    );
    const anywhere = halled?.unmet === 0 ? null : search(held, holdsStairwell);
    const found = anywhere && (!halled || anywhere.unmet < halled.unmet) ? anywhere : halled;
    return found ? { layouts: found.layouts, well: found.well } : { layouts: each(() => true), well: null };
}
