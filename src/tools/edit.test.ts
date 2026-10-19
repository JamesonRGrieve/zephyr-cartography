// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { cubicAt, spanControls } from '../geometry/spline';
import { deletePoint, insertPathPoint, MIN_HALF_WIDTH, movePoint, setHalfWidth, setPathHandle } from './edit';
import type { Feature } from './feature';
import { type CartographyPath, LIQUID_LOOKS, makePath } from './path';
import { makeRegion } from './region';
import { makeRoom } from './room';
import { makeStroke } from './stroke';

function road(): Feature {
    const p = makePath(
        'p',
        'road',
        [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
        ],
        5,
        null,
        LIQUID_LOOKS.water,
    );
    if (!p) {
        throw new Error('fixture');
    }
    return p;
}

function region(): Feature {
    const r = makeRegion(
        'r',
        'grassland',
        [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
        ],
        null,
    );
    if (!r) {
        throw new Error('fixture');
    }
    return r;
}

describe('movePoint', () => {
    it('moves a path vertex and keeps half-widths parallel', () => {
        const moved = movePoint(road(), 1, { x: 10, y: 8 });
        expect(moved?.points[1]).toEqual({ x: 10, y: 8 });
        expect(moved?.type).toBe('path');
        const hwLen = moved?.type === 'path' ? moved.halfWidths.length : -1;
        expect(hwLen).toBe(moved?.points.length);
    });

    it('moves a region vertex', () => {
        const moved = movePoint(region(), 2, { x: 12, y: 12 });
        expect(moved?.points[2]).toEqual({ x: 12, y: 12 });
    });

    it('returns null for an out-of-range index', () => {
        expect(movePoint(road(), 9, { x: 0, y: 0 })).toBeNull();
        expect(movePoint(road(), -1, { x: 0, y: 0 })).toBeNull();
    });
});

describe('deletePoint', () => {
    it('deletes a path vertex (and its half-width) when >= 2 remain', () => {
        const d = deletePoint(road(), 1);
        expect(d?.points).toHaveLength(2);
        const hwLen = d?.type === 'path' ? d.halfWidths.length : -1;
        expect(hwLen).toBe(2);
    });

    it('refuses to drop a path below two points', () => {
        const two = makePath(
            'p',
            'road',
            [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
            ],
            5,
            null,
            LIQUID_LOOKS.water,
        );
        expect(two).not.toBeNull();
        expect(deletePoint(two as Feature, 0)).toBeNull();
    });

    it('refuses to drop a region below three points', () => {
        const tri = makeRegion(
            'r',
            'sand',
            [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 5, y: 10 },
            ],
            null,
        );
        expect(tri).not.toBeNull();
        expect(deletePoint(tri as Feature, 0)).toBeNull();
    });
});

describe('editing a brush stroke', () => {
    function stroke(): Feature {
        const s = makeStroke(
            's',
            'grassland',
            [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 20, y: 0 },
            ],
            20,
            null,
        );
        if (!s) {
            throw new Error('fixture');
        }
        return s;
    }

    it('moves a stroke vertex, preserving type and radius', () => {
        const moved = movePoint(stroke(), 1, { x: 10, y: 6 });
        expect(moved?.type).toBe('stroke');
        expect(moved?.points[1]).toEqual({ x: 10, y: 6 });
    });

    it('deletes stroke vertices down to a single dab, and no further', () => {
        const d = deletePoint(stroke(), 1);
        expect(d?.points).toHaveLength(2);
        const dab = deletePoint(d as Feature, 0);
        expect(dab?.points).toHaveLength(1);
        expect(deletePoint(dab as Feature, 0)).toBeNull();
    });
});

describe('editing a room', () => {
    function room(): Feature {
        const r = makeRoom('rm', 'dirt', [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
        ]);
        if (!r) {
            throw new Error('fixture');
        }
        return r;
    }

    it('moves a room vertex, preserving type and floor', () => {
        const moved = movePoint(room(), 2, { x: 120, y: 120 });
        expect(moved?.type).toBe('room');
        expect(moved?.points[2]).toEqual({ x: 120, y: 120 });
    });

    it('deletes a room vertex but refuses to drop below three', () => {
        const d = deletePoint(room(), 0);
        expect(d?.points).toHaveLength(3);
        expect(deletePoint(d as Feature, 0)).toBeNull();
    });
});

describe('setHalfWidth', () => {
    it('sets one path point width, clamped to the minimum', () => {
        const wide = setHalfWidth(road(), 1, 12);
        expect(wide?.type === 'path' ? wide.halfWidths : null).toEqual([5, 12, 5]);
        const thin = setHalfWidth(road(), 0, -3);
        expect(thin?.type === 'path' ? thin.halfWidths[0] : null).toBe(MIN_HALF_WIDTH);
    });

    it('refuses non-paths, bad indices and non-numbers', () => {
        expect(setHalfWidth(region(), 0, 5)).toBeNull();
        expect(setHalfWidth(road(), 9, 5)).toBeNull();
        expect(setHalfWidth(road(), 0, Number.NaN)).toBeNull();
    });
});

/** A river through four points, shaped at the second, widening along its run. */
function shapedRiver(): CartographyPath {
    const p = makePath(
        'r',
        'river',
        [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 200, y: 0 },
            { x: 300, y: 0 },
        ],
        [10, 20, 30, 40],
        null,
        LIQUID_LOOKS.water,
        null,
        [null, { x: 30, y: 30 }, null, null],
    );
    if (!p) {
        throw new Error('fixture');
    }
    return p;
}

/** Each of a path's parallel lists' lengths: points, widths, handles. */
const lengths = (f: Feature | null): number[] => (f?.type === 'path' ? [f.points.length, f.halfWidths.length, f.handles.length] : []);

describe('path handles in edits', () => {
    it('keeps each point’s handle with it when a point moves or another is deleted', () => {
        const moved = movePoint(shapedRiver(), 1, { x: 90, y: 5 });
        expect(moved?.type === 'path' ? moved.handles : null).toEqual([null, { x: 30, y: 30 }, null, null]);
        const deleted = deletePoint(shapedRiver(), 0);
        expect(lengths(deleted)).toEqual([3, 3, 3]);
        expect(deleted?.type === 'path' ? deleted.handles : null).toEqual([{ x: 30, y: 30 }, null, null]);
        expect(deleted?.type === 'path' ? deleted.halfWidths : null).toEqual([20, 30, 40]);
    });

    it('sets a point’s handle, back to auto with null, and refuses a bad index or a handle that is not finite', () => {
        expect(setPathHandle(shapedRiver(), 2, { x: -5, y: 5 })?.handles).toEqual([null, { x: 30, y: 30 }, { x: -5, y: 5 }, null]);
        expect(setPathHandle(shapedRiver(), 1, null)?.handles).toEqual([null, null, null, null]);
        expect(setPathHandle(shapedRiver(), 4, null)).toBeNull();
        expect(setPathHandle(shapedRiver(), -1, null)).toBeNull();
        expect(setPathHandle(shapedRiver(), 0, { x: Number.NaN, y: 0 })).toBeNull();
    });

    it('inserts a point on the curve as drawn, as wide as the path is there, every list kept one per point', () => {
        const river = shapedRiver();
        const inserted = insertPathPoint(river, 1, 0.5);
        expect(lengths(inserted)).toEqual([5, 5, 5]);
        const controls = spanControls(river.points, river.handles, 1);
        expect(controls).not.toBeNull();
        if (!controls || !inserted) {
            return;
        }
        expect(inserted.points[2]).toEqual(cubicAt(...controls, 0.5));
        expect(inserted.halfWidths).toEqual([10, 20, 25, 30, 40]);
        // Beside a shaped point it takes the curve's direction there: a sixth of its derivative.
        const handle = inserted.handles[2];
        expect(handle?.x).toBeCloseTo(17.0833, 3);
        expect(handle?.y).toBeCloseTo(-3.75, 3);
    });

    it('inserts an auto-smooth point between two auto-smooth ones, and none outside the path', () => {
        const river = shapedRiver();
        expect(insertPathPoint(river, 2, 0.25)?.handles).toEqual([null, { x: 30, y: 30 }, null, null, null]);
        expect(insertPathPoint(river, 2, 0.25)?.halfWidths[3]).toBe(32.5);
        expect(insertPathPoint(river, 3, 0.5)).toBeNull();
        expect(insertPathPoint(river, 0, Number.NaN)).toBeNull();
        // Past either end of its span, a point lands on the span's end.
        expect(insertPathPoint(river, 0, 7)?.points[1]).toEqual({ x: 100, y: 0 });
    });
});
