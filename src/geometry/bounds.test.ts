// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { boundsOf } from './bounds';

describe('boundsOf', () => {
    it('is the smallest box holding every point, whatever order they come in', () => {
        expect(
            boundsOf([
                { x: 4, y: -1 },
                { x: -2, y: 3 },
                { x: 1, y: 7 },
            ]),
        ).toEqual({ x: -2, y: -1, w: 6, h: 8 });
        expect(boundsOf([{ x: 3, y: 3 }])).toEqual({ x: 3, y: 3, w: 0, h: 0 });
    });
});
