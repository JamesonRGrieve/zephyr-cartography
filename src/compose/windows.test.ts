// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { windowSlots } from './windows';

describe('windowSlots', () => {
    const room = { x: 2, y: 4, w: 10, h: 6 };

    it('spaces windows evenly along each outer wall, clear of its corners', () => {
        const along = windowSlots(room, ['top'], []);
        expect(along.map((s) => s.at)).toEqual([3, 6, 9]);
        expect(along.every((s) => s.side === 'top' && s.window === true && s.daylight === true && s.width === 1)).toBe(true);
        // Down a side wall too, along its own axis.
        expect(windowSlots(room, ['left'], []).map((s) => s.at)).toEqual([5, 8]);
    });

    it('keeps a square between a window and a doorway on the same wall', () => {
        const slots = windowSlots(room, ['top'], [{ side: 'top', at: 5, width: 2 }]);
        expect(slots.map((s) => s.at)).toEqual([3, 9]);
        // A door on another wall moves nothing.
        expect(windowSlots(room, ['top'], [{ side: 'bottom', at: 6 }]).map((s) => s.at)).toEqual([3, 6, 9]);
    });

    it('puts none in a wall too short to hold one clear of its corners', () => {
        expect(windowSlots({ x: 0, y: 0, w: 2, h: 2 }, ['top', 'right'], [])).toEqual([]);
    });

    it('keeps clear of corners cut off a chamfered room', () => {
        // A 9-square octagon cut 2 at each corner: one window in the middle of its straight stretch.
        expect(windowSlots({ x: 0, y: 0, w: 9, h: 9 }, ['top'], [], 2).map((s) => s.at)).toEqual([4]);
    });
});
