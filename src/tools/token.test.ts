// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { NO_DOCS } from './generated-docs';
import { featureHit } from './hit';
import { NO_LEVEL_ART } from './levels';
import { NO_PLAN, planDocuments } from './plan';
import { isTokenDisposition, makeToken, parseToken, TOKEN_HIT_RADIUS, tokenPoint, tokenSettingsOf, withTokenPlay } from './token';

const guard = { actor: 'Compendium.world.npcs.Actor.guard01', name: 'Gate guard', hidden: true, disposition: 'hostile', size: 1 } as const;

describe('tokens', () => {
    it('stand at one point, own no documents yet, and carry what the map sets over the actor', () => {
        const token = makeToken('t', { x: 150, y: 250 }, guard);
        expect(tokenPoint(token)).toEqual({ x: 150, y: 250 });
        expect(tokenSettingsOf(token)).toEqual(guard);
        expect(token.lift).toBe(0);
        expect(token.docs).toEqual(NO_DOCS);
    });

    it('plan one Token of their actor, on their level, raised by their lift above its floor', () => {
        const levels = [{ id: 'up', name: 'Upstairs', bottom: 10, top: 20, art: NO_LEVEL_ART }];
        const token = { ...withTokenPlay(makeToken('t', { x: 0, y: 0 }, guard), { x: 50, y: 60 }, 2, false), level: 'up' };
        expect(planDocuments(token, { features: [], levels, terrainRegions: false, gridDistance: 5 })).toEqual({
            ...NO_PLAN,
            tokens: [{ x: 50, y: 60, elevation: 12, level: 'up', actor: guard.actor, name: 'Gate guard', hidden: false, disposition: 'hostile', size: 1 }],
        });
    });

    it('follow play: a token moved, raised or revealed keeps its actor and what the map set', () => {
        const played = withTokenPlay(makeToken('t', { x: 0, y: 0 }, guard), { x: 9, y: 8 }, 3, false);
        expect(tokenPoint(played)).toEqual({ x: 9, y: 8 });
        expect(played).toMatchObject({ lift: 3, hidden: false, actor: guard.actor, name: 'Gate guard', disposition: 'hostile', size: 1 });
    });

    it('are hit near their centre', () => {
        const token = makeToken('t', { x: 100, y: 100 }, guard);
        expect(featureHit(token, { x: 100 + TOKEN_HIT_RADIUS, y: 100 })).toBe(true);
        expect(featureHit(token, { x: 100 + TOKEN_HIT_RADIUS + 1, y: 100 })).toBe(false);
    });

    it('name only Foundry’s dispositions', () => {
        expect(['secret', 'hostile', 'neutral', 'friendly'].every(isTokenDisposition)).toBe(true);
        expect(isTokenDisposition('enemy')).toBe(false);
        expect(isTokenDisposition(1)).toBe(false);
    });

    describe('parsing a stored token', () => {
        const stored = { ...makeToken('t', { x: 1, y: 2 }, guard), lift: 4, level: 'up', docs: { ...NO_DOCS, tokens: ['T1'] } };

        it('round-trips', () => {
            expect(parseToken(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
        });

        it('drops what the map did not set back to the actor’s own, and a bad lift to its floor', () => {
            const parsed = parseToken({
                type: 'token',
                id: 't',
                actor: 'Actor.a',
                points: [{ x: 0, y: 0 }],
                disposition: 'enemy',
                size: -1,
                name: 7,
                lift: 'up',
            });
            expect(parsed).toMatchObject({ name: null, hidden: false, disposition: null, size: null, lift: 0, level: null, docs: NO_DOCS });
        });

        it('refuses anything that is not a token with an actor and a point', () => {
            expect(parseToken({ ...stored, type: 'pin' })).toBeNull();
            expect(parseToken({ ...stored, actor: '' })).toBeNull();
            expect(parseToken({ ...stored, actor: undefined })).toBeNull();
            expect(parseToken({ ...stored, id: 3 })).toBeNull();
            expect(parseToken({ ...stored, points: [{ x: 'a' }] })).toBeNull();
            expect(parseToken({ ...stored, points: 'here' })).toBeNull();
            expect(parseToken('token')).toBeNull();
        });
    });
});
