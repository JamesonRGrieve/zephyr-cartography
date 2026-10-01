// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { deletePoint, movePoint } from './edit';
import { NO_DOCS } from './generated-docs';
import { featureHit } from './hit';
import { labelBox, labelCorners, labelSettingsOf, makeLabel, NEW_LABEL, parseLabel, validFontSize } from './label';
import { NO_PLAN, planDocuments } from './plan';

const sump = { text: 'The Sump', fontSize: 40, colour: '#e0c080', fontFamily: 'Amiri', rotation: 0, hidden: false };

describe('labels', () => {
    it('start as Foundry makes a text drawing', () => {
        const label = makeLabel('l', { x: 10, y: 20 });
        expect(labelSettingsOf(label)).toEqual(NEW_LABEL);
        expect(label.docs).toEqual(NO_DOCS);
    });

    it('size their box to hold the longest line on one line, and every line', () => {
        // 8 characters at 0.7 of the font size, plus a font size of margin; one line at 1.5.
        expect(labelBox(sump)).toEqual({ width: Math.ceil((8 * 0.7 + 1) * 40), height: 60 });
        expect(labelBox({ ...sump, text: 'Residence\nDistrict 4' }).height).toBe(120);
        expect(labelBox({ ...sump, text: '' }).width).toBeGreaterThan(0);
    });

    it('plan one text Drawing centred on their point, and nothing else', () => {
        const label = makeLabel('l', { x: 500, y: 300 }, sump);
        expect(planDocuments(label)).toEqual({
            ...NO_PLAN,
            drawings: [{ kind: 'text', x: 500, y: 300, ...labelBox(sump), elevation: 0, level: null, ...sump }],
        });
    });

    it('plan no Drawing while they have no text, which Foundry would refuse', () => {
        expect(planDocuments(makeLabel('l', { x: 0, y: 0 }))).toEqual(NO_PLAN);
        expect(planDocuments(makeLabel('l', { x: 0, y: 0 }, { ...sump, text: '  ' }))).toEqual(NO_PLAN);
    });

    it('are hit inside their box, turned with them, moved whole and not thinned', () => {
        const label = makeLabel('l', { x: 0, y: 0 }, sump);
        const { width } = labelBox(sump);
        expect(featureHit(label, { x: width / 2 - 1, y: 0 })).toBe(true);
        expect(featureHit(label, { x: 0, y: width / 2 - 1 })).toBe(false);
        const turned = { ...label, rotation: 90 };
        expect(featureHit(turned, { x: 0, y: width / 2 - 1 })).toBe(true);
        expect(labelCorners(label)).toHaveLength(4);
        expect(movePoint(label, 0, { x: 7, y: 8 })?.points).toEqual([{ x: 7, y: 8 }]);
        expect(deletePoint(label, 0)).toBeNull();
    });

    it('take font sizes Foundry takes: whole numbers from 8 to 256', () => {
        expect([8, 256, 48].map(validFontSize)).toEqual([8, 256, 48]);
        expect([7, 257, 12.5].map(validFontSize)).toEqual([null, null, null]);
    });

    it('round-trip through the scene flag, falling back to Foundry’s defaults field by field', () => {
        const label = { ...makeLabel('l', { x: 1, y: 2 }, { ...sump, rotation: 15, hidden: true }), docs: { ...NO_DOCS, drawings: ['d0'] } };
        expect(parseLabel(JSON.parse(JSON.stringify(label)))).toEqual(label);
        expect(parseLabel({ type: 'label', id: 'x', points: [{ x: 0, y: 0 }], fontSize: 2, colour: 'gold', rotation: 'up' })).toMatchObject({
            fontSize: 48,
            colour: '#ffffff',
            rotation: 0,
            text: '',
        });
        expect(parseLabel({ type: 'label', id: 'x', points: [] })).toBeNull();
    });
});
