// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { CONE_CURVATURES, ZONE_SHAPES } from './zone-shape';

describe('zone shapes', () => {
    it('are Foundry’s region shapes a zone takes, and its cone curvatures', () => {
        expect(ZONE_SHAPES).toEqual(['circle', 'ellipse', 'ring', 'cone', 'line', 'rectangle', 'cells', 'emanation']);
        expect(CONE_CURVATURES).toEqual(['round', 'flat', 'semicircle']);
    });
});
