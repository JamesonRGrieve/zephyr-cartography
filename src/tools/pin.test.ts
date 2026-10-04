// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { deletePoint, movePoint } from './edit';
import { NO_DOCS } from './generated-docs';
import { featureHit } from './hit';
import { NO_LEVEL_ART } from './levels';
import { makePin, MIN_NOTE_SIZE, NEW_PIN, parsePin, PIN_HIT_RADIUS, pinPoint, pinSettingsOf, withPinSettings } from './pin';
import { NO_PLAN, planDocuments } from './plan';

const settings = { text: 'The Sump', entry: 'je1', page: 'pg1', icon: 'icons/svg/tankard.svg', global: true, readable: false, size: 60, hidden: false };

describe('pins', () => {
    it('stand at one point and start as Foundry makes a note: no text, journal or icon', () => {
        const pin = makePin('p', { x: 10, y: 20 });
        expect(pinPoint(pin)).toEqual({ x: 10, y: 20 });
        expect(pinSettingsOf(pin)).toEqual(NEW_PIN);
        expect(pin.docs).toEqual(NO_DOCS);
    });

    it('drop a page with no journal to hold it', () => {
        const pin = makePin('p', { x: 0, y: 0 });
        expect(pinSettingsOf(withPinSettings(pin, settings))).toEqual(settings);
        expect(withPinSettings(pin, { ...settings, entry: null }).page).toBeNull();
    });

    it('never size their icon below the least Foundry takes, and keep it whole', () => {
        const pin = makePin('p', { x: 0, y: 0 });
        expect(withPinSettings(pin, { ...settings, size: 10 }).size).toBe(MIN_NOTE_SIZE);
        expect(withPinSettings(pin, { ...settings, size: 70.6 }).size).toBe(71);
        expect(withPinSettings(pin, { ...settings, size: null }).size).toBeNull();
    });

    it('can be words for players to read on hover, with no journal: a sign', () => {
        const sign = withPinSettings(makePin('p', { x: 0, y: 0 }), { ...NEW_PIN, text: 'OPEN LATE', readable: true, size: 50 });
        expect(planDocuments(sign).notes).toEqual([expect.objectContaining({ text: 'OPEN LATE', readable: true, size: 50, entry: null })]);
    });

    it('can start hidden from players, for the GM to reveal: a name not yet learnt', () => {
        const secret = withPinSettings(makePin('p', { x: 0, y: 0 }), { ...settings, readable: true, hidden: true });
        expect(planDocuments(secret).notes).toEqual([expect.objectContaining({ readable: true, hidden: true })]);
        expect(parsePin(JSON.parse(JSON.stringify(secret)))?.hidden).toBe(true);
        expect(parsePin({ type: 'pin', id: 'q', points: [{ x: 1, y: 1 }], hidden: 'yes' })?.hidden).toBe(false);
    });

    it('plan one Note on their level, and nothing else', () => {
        const pin = { ...makePin('p', { x: 5, y: 6 }, settings), level: 'lv1' };
        const levels = [{ id: 'lv1', name: 'Up', bottom: 10, top: 20, art: NO_LEVEL_ART }];
        expect(planDocuments(pin, { features: [], levels, terrainRegions: false, gridDistance: 5 })).toEqual({
            ...NO_PLAN,
            notes: [{ x: 5, y: 6, elevation: 10, level: 'lv1', ...settings }],
        });
    });

    it('are hit near their point, moved whole and not thinned', () => {
        const pin = makePin('p', { x: 100, y: 100 });
        expect(featureHit(pin, { x: 100 + PIN_HIT_RADIUS, y: 100 })).toBe(true);
        expect(featureHit(pin, { x: 100 + PIN_HIT_RADIUS + 1, y: 100 })).toBe(false);
        expect(movePoint(pin, 0, { x: 7, y: 8 })?.points).toEqual([{ x: 7, y: 8 }]);
        expect(deletePoint(pin, 0)).toBeNull();
    });

    it('round-trip through the scene flag, and a malformed entry is dropped', () => {
        const pin = { ...withPinSettings(makePin('p', { x: 1, y: 2 }), settings), docs: { ...NO_DOCS, notes: ['n0'] } };
        expect(parsePin(JSON.parse(JSON.stringify(pin)))).toEqual(pin);
        expect(parsePin({ type: 'pin', id: 'q', points: [{ x: 1, y: 1 }], text: 3, global: 'yes', readable: 'yes', size: 'big' })).toMatchObject({
            text: '',
            global: false,
            entry: null,
            readable: false,
            size: null,
        });
        // A pin saved before signs were readable is an ordinary one, its icon Foundry's size.
        expect(parsePin({ type: 'pin', id: 'q', points: [{ x: 1, y: 1 }] })).toMatchObject({ readable: false, size: null });
        expect(parsePin({ type: 'pin', id: 'q', points: [] })).toBeNull();
        expect(parsePin({ type: 'stamp', id: 'q', points: [{ x: 1, y: 1 }] })).toBeNull();
    });
});
