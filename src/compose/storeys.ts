// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A building's storeys. Every floor is laid out over the same footprint, so
 * each floor's outer walls stand exactly on the ones below. A stairwell, the
 * size of the stair the building gets, is fixed in one place on every floor:
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
import { type Box, doorApproach, overlaps, within } from './furnish';
import type { BuildingIntent } from './intent';
import { type BuildingLayout, doorsOf, layOutBuilding } from './layout';

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
    readonly stairwell: Box | null;
    readonly cellars: readonly (BuildingLayout | null)[];
    readonly cellarWell: Box | null;
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

/** Whether `layout` holds the stairwell `box` in one of its rooms. */
export const holdsStairwell = (layout: BuildingLayout, box: Box): boolean => stairwellRoom(layout, box) !== undefined;

/** How far (squares) `box` stands from the nearest wall of `room`, which holds it, past the stairwell margin. */
function fromWall(room: LaidRoom, box: Box): number {
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
 * Lay out `building`'s ground floor, its `floors` round a stairwell of the
 * `up` well's size and its `cellars` round one of the `down` well's size,
 * each well common to the ground floor and its storeys; null when the ground
 * floor's rooms cannot fit. Without a stair (or when the storeys cannot
 * share a spot) they are laid out on their own and the well is null.
 */
export function layOutStoreys(building: BuildingIntent, footprint: Rect, wells: Wells, random: Random): Storeys | null {
    const ground = layOutBuilding(building, footprint, random);
    if (!ground) {
        return null;
    }
    const up = stack(ground, building.floors, { building, footprint, size: wells.up, clear: null }, random);
    const down = stack(ground, building.cellars, { building, footprint, size: wells.down, clear: up.well }, random);
    return { ground, floors: up.layouts, stairwell: up.well, cellars: down.layouts, cellarWell: down.well };
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
): { layouts: (BuildingLayout | null)[]; well: Box | null } {
    const { building, footprint, size, clear } = shared;
    const each = (accept: (layout: BuildingLayout) => boolean): (BuildingLayout | null)[] =>
        storeys.map((storey) => layOutBuilding(building, footprint, random, { front: false, accept }, storey.rooms));
    if (storeys.length === 0 || size === null) {
        return { layouts: each(() => true), well: null };
    }
    // A stair stands in a hall where the ground floor has one, and against a wall, as a built one does: those spots first.
    const inHall = (room: LaidRoom): number => (room.intent.purpose === 'hall' ? 0 : 1);
    const held = spots(footprint, size, random)
        .flatMap((box) => {
            const room = stairwellRoom(ground, box);
            return room && (clear === null || !overlaps(box, clear)) ? [{ box, room }] : [];
        })
        .sort((a, b) => inHall(a.room) - inHall(b.room) || fromWall(a.room, a.box) - fromWall(b.room, b.box))
        .map(({ box }) => box);
    // The first spot every storey can hold with every room beside those it opens onto; else the one that misses fewest.
    let best: { layouts: BuildingLayout[]; well: Box; unmet: number } | null = null;
    for (const box of held.slice(0, SPOT_TRIES)) {
        const layouts = each((layout) => holdsStairwell(layout, box));
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
    return best ? { layouts: best.layouts, well: best.well } : { layouts: each(() => true), well: null };
}
