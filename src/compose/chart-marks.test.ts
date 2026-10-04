// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { chartMarks, ORBIT_STROKE } from './chart-marks';
import { composeMap } from './compose';
import { parseMapIntent } from './intent';

describe('chartMarks', () => {
    it('rings a star through its worlds with faint orbits, and writes each place’s name where asked', () => {
        const marks = chartMarks(
            {
                orbits: [{ centre: { x: 7, y: 15 }, radius: 12 }],
                labels: [{ text: 'Dunmarch', at: { x: 20, y: 13 }, size: 40, colour: '#f0e8d0', font: 'Signika' }],
            },
            { level: 'ground' },
        );
        expect(marks).toEqual([
            { type: 'shape', kind: 'ellipse', x: 7, y: 15, width: 24, height: 24, stroke: ORBIT_STROKE, fill: null, level: 'ground' },
            { type: 'label', x: 20, y: 13, text: 'Dunmarch', fontSize: 40, colour: '#f0e8d0', fontFamily: 'Signika', level: 'ground' },
        ]);
        // Faint: a guide, never a ring competing with the worlds on it.
        expect(ORBIT_STROKE.alpha).toBeLessThan(0.5);
    });

    it('draws a map’s labels and orbits over everything it composes, its labels in their defaults where none are given', () => {
        const parsed = parseMapIntent({
            schemaVersion: 1,
            seed: 1,
            width: 30,
            height: 20,
            labels: [{ text: 'The Hill Town', at: { x: 10, y: 5 } }],
            orbits: [{ centre: { x: 15, y: 10 }, radius: 6 }],
        });
        if (!parsed.ok) {
            throw new Error('the intent does not parse');
        }
        const { features } = composeMap(parsed.intent, new Map()).spec;
        expect(features.slice(-2)).toMatchObject([
            { type: 'shape', kind: 'ellipse', width: 12 },
            { type: 'label', text: 'The Hill Town', fontSize: 36, colour: '#2b2118', fontFamily: '' },
        ]);
        expect(parseMapIntent({ schemaVersion: 1, seed: 1, width: 30, height: 20, orbits: [{ centre: { x: 1, y: 1 }, radius: 0 }] }).ok).toBe(false);
    });
});
