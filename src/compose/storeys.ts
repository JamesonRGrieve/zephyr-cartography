// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A building's storeys. Every floor is laid out over the same footprint, so
 * each floor's outer walls stand exactly on the ones below. A stairwell, the
 * size of the stair the building gets, is fixed in one place on every floor:
 * wholly inside one room on each, clear of every door's approach, so the
 * stair is reached from a doorway on every floor. The ground floor is laid
 * out first; a spot it holds is then tried on each floor above, whose layout
 * is chosen among those that hold it, and other spots are tried when the
 * floors cannot agree on one. Pure and unit-tested; positions are in grid
 * squares.
 */
import type { Rect } from '../generate/floor-plan';
import { shuffled, type Random } from '../generate/random';
import { WALL_BAND_SQUARES } from '../tools/materials';
import { type Box, doorApproach, overlaps, within } from './furnish';
import type { BuildingIntent } from './intent';
import { type BuildingLayout, doorsOf, layOutBuilding } from './layout';

/** Squares kept between a stairwell and its room's walls: the wall's own band and a step round it. */
const STAIRWELL_MARGIN = WALL_BAND_SQUARES / 2 + 0.25;

/** Squares between the stairwell spots tried. */
const SPOT_STEP = 0.5;

/** Spots tried before a building goes without a stairwell. */
const SPOT_TRIES = 12;

/** A building's ground floor, the floors above it (null where one's rooms could not fit), and the stairwell they all share (null when there is none). */
export interface Storeys {
    readonly ground: BuildingLayout;
    readonly floors: readonly (BuildingLayout | null)[];
    readonly stairwell: Box | null;
}

/** Whether `layout` holds the stairwell `box`: wholly inside one room, off its walls, and clear of every door's approach there. */
export function holdsStairwell(layout: BuildingLayout, box: Box): boolean {
    const room = layout.rooms.find((r) =>
        within(box, { x: r.rect.x + STAIRWELL_MARGIN, y: r.rect.y + STAIRWELL_MARGIN, w: r.rect.w - 2 * STAIRWELL_MARGIN, h: r.rect.h - 2 * STAIRWELL_MARGIN }),
    );
    return room !== undefined && !doorsOf(layout, room.key).some((door) => overlaps(doorApproach(room.rect, door), box));
}

/** How far (squares) `box` stands from the nearest wall of the room holding it, past the stairwell margin. */
function fromWall(layout: BuildingLayout, box: Box): number {
    const room = layout.rooms.find((r) => within(box, r.rect));
    if (!room) {
        return Number.POSITIVE_INFINITY;
    }
    const { x, y, w, h } = room.rect;
    return Math.min(box.x - x, x + w - (box.x + box.w), box.y - y, y + h - (box.y + box.h)) - STAIRWELL_MARGIN;
}

/** Every place in `footprint` a stairwell `size` could go, on a half-square step, in a seeded order. */
function spots(footprint: Rect, size: { readonly w: number; readonly h: number }, random: Random): Box[] {
    const found: Box[] = [];
    for (let x = footprint.x + STAIRWELL_MARGIN; x + size.w <= footprint.x + footprint.w - STAIRWELL_MARGIN; x += SPOT_STEP) {
        for (let y = footprint.y + STAIRWELL_MARGIN; y + size.h <= footprint.y + footprint.h - STAIRWELL_MARGIN; y += SPOT_STEP) {
            found.push({ x, y, w: size.w, h: size.h });
        }
    }
    return shuffled(random, found);
}

/**
 * Lay out `building`'s ground floor and its `floors`, with a stairwell of
 * `stair`'s size common to them all; null when the ground floor's rooms
 * cannot fit. Without a stair (or when the floors cannot share a spot) the
 * floors are laid out on their own and `stairwell` is null.
 */
export function layOutStoreys(
    building: BuildingIntent,
    footprint: Rect,
    stair: { readonly w: number; readonly h: number } | null,
    random: Random,
): Storeys | null {
    const ground = layOutBuilding(building, footprint, random);
    if (!ground) {
        return null;
    }
    const upper = (accept: (layout: BuildingLayout) => boolean): (BuildingLayout | null)[] =>
        building.floors.map((floor) => layOutBuilding(building, footprint, random, { front: false, accept }, floor.rooms));
    if (building.floors.length === 0 || stair === null) {
        return { ground, floors: upper(() => true), stairwell: null };
    }
    // A stair stands against a wall, as a built one does: the spots nearest a room's wall are tried first.
    const held = spots(footprint, stair, random)
        .filter((box) => holdsStairwell(ground, box))
        .sort((a, b) => fromWall(ground, a) - fromWall(ground, b));
    for (const box of held.slice(0, SPOT_TRIES)) {
        const floors = upper((layout) => holdsStairwell(layout, box));
        if (floors.every((l) => l !== null)) {
            return { ground, floors, stairwell: box };
        }
    }
    return { ground, floors: upper(() => true), stairwell: null };
}
