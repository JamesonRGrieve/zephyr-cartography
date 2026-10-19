// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { catmullRom } from '../geometry/spline';
import { controlOverlay, handleFromDrag, pathKey, PenSession, pickPathControl } from './pen';

const TOL = 4;

describe('PenSession', () => {
    it('drops an auto-smooth anchor on a plain click', () => {
        const pen = new PenSession();
        expect(pen.press({ x: 10, y: 20 }, TOL, false)).toBe('added');
        pen.release();
        expect(pen.shape()).toEqual({ points: [{ x: 10, y: 20 }], handles: [null] });
        expect(pen.anchorCount).toBe(1);
    });

    it('pulls out symmetric handles as a press is dragged, the out-handle following the pointer', () => {
        const pen = new PenSession();
        pen.press({ x: 0, y: 0 }, TOL, false);
        pen.move({ x: 2, y: 1 }, TOL);
        // Within the tolerance a jittery click stays a click.
        expect(pen.shape().handles).toEqual([null]);
        pen.move({ x: 30, y: -10 }, TOL);
        pen.release();
        expect(pen.shape().handles).toEqual([{ x: 30, y: -10 }]);
        // Once released, moving the pointer no longer reshapes it.
        pen.move({ x: 90, y: 90 }, TOL);
        expect(pen.shape().handles).toEqual([{ x: 30, y: -10 }]);
    });

    it('drops a corner when asked', () => {
        const pen = new PenSession();
        pen.press({ x: 0, y: 0 }, TOL, true);
        expect(pen.shape().handles).toEqual([{ x: 0, y: 0 }]);
    });

    it('finishes on a press on the last anchor once it has two, and ignores one on a lone anchor', () => {
        const pen = new PenSession();
        pen.press({ x: 0, y: 0 }, TOL, false);
        pen.release();
        expect(pen.press({ x: 1, y: 1 }, TOL, false)).toBe('ignored');
        pen.press({ x: 50, y: 0 }, TOL, false);
        pen.release();
        // A double-click's second press lands on the anchor its first one dropped.
        expect(pen.press({ x: 51, y: 0 }, TOL, false)).toBe('finish');
        expect(pen.anchorCount).toBe(2);
    });

    it('takes back anchors one at a time, then nothing', () => {
        const pen = new PenSession();
        pen.press({ x: 0, y: 0 }, TOL, false);
        pen.press({ x: 50, y: 0 }, TOL, false);
        expect(pen.undo()).toBe(true);
        expect(pen.shape().points).toEqual([{ x: 0, y: 0 }]);
        expect(pen.undo()).toBe(true);
        expect(pen.undo()).toBe(false);
        expect(pen.anchorCount).toBe(0);
    });

    it('stops pulling handles out of an anchor it took back mid-press', () => {
        const pen = new PenSession();
        pen.press({ x: 0, y: 0 }, TOL, false);
        pen.undo();
        pen.move({ x: 40, y: 40 }, TOL);
        expect(pen.shape()).toEqual({ points: [], handles: [] });
    });

    it('previews a rubber-band span on to the pointer between presses only', () => {
        const pen = new PenSession();
        expect(pen.preview()).toEqual({ points: [], handles: [] });
        pen.press({ x: 0, y: 0 }, TOL, false);
        // Mid-press, the pointer is pulling handles, not the next span.
        pen.move({ x: 20, y: 0 }, TOL);
        expect(pen.preview().points).toHaveLength(1);
        pen.release();
        pen.move({ x: 60, y: 30 }, TOL);
        expect(pen.preview()).toEqual({
            points: [
                { x: 0, y: 0 },
                { x: 60, y: 30 },
            ],
            handles: [{ x: 20, y: 0 }, null],
        });
    });

    it('draws its anchors, not the pointer, and the handles of the anchor last placed', () => {
        const pen = new PenSession();
        pen.press({ x: 0, y: 0 }, TOL, false);
        pen.move({ x: 0, y: 30 }, TOL);
        pen.release();
        pen.move({ x: 100, y: 0 }, TOL);
        const overlay = pen.overlay(4);
        expect(overlay.anchors).toEqual([{ x: 0, y: 0 }]);
        expect(overlay.selected).toBe(0);
        // The first anchor shows only the handle leading on.
        expect(overlay.handles).toEqual([{ anchor: 0, side: 'out', from: { x: 0, y: 0 }, to: { x: 0, y: 30 } }]);
        expect(overlay.spine).toHaveLength(5);
    });
});

describe('controlOverlay', () => {
    const points = [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 120, y: 0 },
    ];

    it('is the Catmull-Rom centreline through auto anchors, with no handles shown', () => {
        const overlay = controlOverlay(points, [null, null, null], 6, null);
        expect(overlay.spine).toEqual(catmullRom(points, 6));
        expect(overlay.handles).toEqual([]);
        expect(overlay.selected).toBeNull();
    });

    it('shows a shaped anchor’s handles both ways, the picked auto one’s, and no corner’s', () => {
        const shaped = controlOverlay(points, [null, { x: 10, y: 5 }, { x: 0, y: 0 }], 6, 0);
        expect(shaped.handles).toEqual([
            { anchor: 0, side: 'out', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } },
            { anchor: 1, side: 'in', from: { x: 60, y: 0 }, to: { x: 50, y: -5 } },
            { anchor: 1, side: 'out', from: { x: 60, y: 0 }, to: { x: 70, y: 5 } },
        ]);
    });

    it('picks nothing out of range', () => {
        expect(controlOverlay(points, [null, null, null], 2, 7).selected).toBeNull();
        expect(controlOverlay([{ x: 1, y: 1 }], [null], 2, null).spine).toEqual([{ x: 1, y: 1 }]);
    });
});

describe('pickPathControl', () => {
    const shape = {
        points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 200, y: 0 },
        ],
        handles: [null, { x: 30, y: 30 }, null],
    };

    it('takes an anchor first, the nearest one', () => {
        expect(pickPathControl(shape, { x: 99, y: 2 }, TOL, 20, null, 8)).toEqual({ kind: 'anchor', index: 1 });
    });

    it('takes the end of a shown handle, in or out', () => {
        expect(pickPathControl(shape, { x: 131, y: 29 }, TOL, 20, null, 8)).toEqual({ kind: 'handle', index: 1, side: 'out' });
        expect(pickPathControl(shape, { x: 70, y: -30 }, TOL, 20, null, 8)).toEqual({ kind: 'handle', index: 1, side: 'in' });
    });

    it('takes the path between anchors within reach, with where along which span', () => {
        const control = pickPathControl(shape, { x: 160, y: 10 }, TOL, 30, null, 8);
        expect(control?.kind).toBe('span');
        expect(control?.kind === 'span' ? control.span : -1).toBe(1);
        expect(pickPathControl(shape, { x: 160, y: 300 }, TOL, 30, null, 8)).toBeNull();
    });
});

describe('handleFromDrag', () => {
    it('is the offset for the out-handle and its mirror for the in-handle', () => {
        expect(handleFromDrag({ x: 10, y: 10 }, 'out', { x: 25, y: 5 })).toEqual({ x: 15, y: -5 });
        expect(handleFromDrag({ x: 10, y: 10 }, 'in', { x: 25, y: 5 })).toEqual({ x: -15, y: 5 });
    });
});

describe('pathKey', () => {
    it('maps Backspace and Delete to remove, Enter to finish, Escape to cancel', () => {
        expect(['Backspace', 'Delete', 'Enter', 'Escape', 'a'].map(pathKey)).toEqual(['remove', 'remove', 'finish', 'cancel', null]);
    });
});
