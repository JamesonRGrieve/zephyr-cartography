// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Windows in a building's outer walls (operator, 2026-10-02: indoors is lit by
 * the day "only through windows and open doors"). Along each side of a room
 * that is the building's outside wall, one-square windows stand at even
 * steps, clear of the corners and of every doorway on that side; each lets
 * the day in (`daylight`). Pure and unit-tested.
 */
import type { DoorSlot, Rect, Side } from '../generate/floor-plan';

/** Squares from one window to the next along a wall. */
const WINDOW_STEP = 3;

/** A window's width, in squares. */
const WINDOW_WIDTH = 1;

/** Squares a window keeps from a corner of the room, and from a doorway beside it. */
const WINDOW_CLEARANCE = 1;

/** The window slots along `room`'s outer `sides`, clear of its `doors` and of corners cut `chamfer` squares. */
export function windowSlots(room: Rect, sides: readonly Side[], doors: readonly DoorSlot[], chamfer = 0): DoorSlot[] {
    const corner = WINDOW_CLEARANCE + chamfer;
    return sides.flatMap((side) => {
        const horizontal = side === 'top' || side === 'bottom';
        const from = horizontal ? room.x : room.y;
        const span = horizontal ? room.w : room.h;
        const onSide = doors.filter((d) => d.side === side);
        // Clear of a doorway: the window and the door each keep a square between them.
        const clear = (at: number): boolean =>
            onSide.every((d) => at + WINDOW_WIDTH + WINDOW_CLEARANCE <= d.at || at >= d.at + (d.width ?? 1) + WINDOW_CLEARANCE);
        // Evenly spread: as many steps as fit between the corners' clearances, centred on the wall.
        const usable = span - 2 * corner - WINDOW_WIDTH;
        if (usable < 0) {
            return [];
        }
        const count = Math.floor(usable / WINDOW_STEP) + 1;
        const start = from + corner + (usable - (count - 1) * WINDOW_STEP) / 2;
        return Array.from({ length: count }, (_, i) => Math.floor(start + i * WINDOW_STEP))
            .filter(clear)
            .map((at): DoorSlot => ({ side, at, width: WINDOW_WIDTH, window: true, daylight: true }));
    });
}
