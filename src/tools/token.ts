// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Pre-placed tokens: a point on the map realised as a native Token of an
 * actor, named by UUID (a world `Actor.<id>` or a compendium's
 * `Compendium.<pack>.Actor.<id>`), with what the map sets over the actor's
 * prototype token (a name, hidden, a disposition, a size). The token owns its
 * Token like any feature its documents: erasing and undoing follow the usual
 * rules, and where it is moved, hidden or revealed in play is followed back
 * onto the feature, so a later re-sync leaves it as play left it. Pure and
 * unit-tested.
 */
import type { Point } from '../geometry/spline';
import { NEW_FEATURE, parseFeatureCommon, type FeatureCommon } from './feature-common';
import { isPoint, isRecord, stringOrNull } from './guards';

/** Foundry's token dispositions (`CONST.TOKEN_DISPOSITIONS`), by name. */
export const TOKEN_DISPOSITIONS = ['secret', 'hostile', 'neutral', 'friendly'] as const;
export type TokenDisposition = (typeof TOKEN_DISPOSITIONS)[number];

/** What a map sets for its token, over the actor's prototype token. */
export interface TokenSettings {
    /** The actor, by UUID. */
    readonly actor: string;
    /** The token's name; null for the actor's prototype's. */
    readonly name: string | null;
    /** Hidden from players until the GM reveals it. */
    readonly hidden: boolean;
    /** Friend or foe; null for the actor's prototype's. */
    readonly disposition: TokenDisposition | null;
    /** Grid squares across; null for the actor's prototype's. */
    readonly size: number | null;
}

/** A token; its one point is its centre. */
export interface TokenFeature extends FeatureCommon, TokenSettings {
    readonly type: 'token';
    /** Elevation set in play over its level's floor; 0 where it stands on it. */
    readonly lift: number;
}

/** How near (scene px) a click must be to its centre to pick a token. */
export const TOKEN_HIT_RADIUS = 24;

export function makeToken(id: string, at: Point, settings: TokenSettings): TokenFeature {
    return { type: 'token', id, points: [{ x: at.x, y: at.y }], ...settings, lift: 0, ...NEW_FEATURE };
}

/** Where the token's centre stands. */
export function tokenPoint(token: TokenFeature): Point {
    return token.points[0] ?? { x: 0, y: 0 };
}

/** What the map sets for `token`. */
export function tokenSettingsOf(token: TokenFeature): TokenSettings {
    return { actor: token.actor, name: token.name, hidden: token.hidden, disposition: token.disposition, size: token.size };
}

/** Whether `v` names a disposition. */
// eslint-disable-next-line no-restricted-syntax -- boundary: narrows one untyped scene-flag field
export function isTokenDisposition(v: unknown): v is TokenDisposition {
    return typeof v === 'string' && (TOKEN_DISPOSITIONS as readonly string[]).includes(v);
}

/** A size Foundry takes: grid squares across, positive; anything else is the actor's own. */
// eslint-disable-next-line no-restricted-syntax -- boundary: narrows one untyped scene-flag field
function validSize(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * The same token where play left it: its centre at `at`, `lift` above its
 * level's floor, hidden or not. Its actor, name, disposition and size stay.
 */
export function withTokenPlay(token: TokenFeature, at: Point, lift: number, hidden: boolean): TokenFeature {
    return { ...token, points: [{ x: at.x, y: at.y }], lift, hidden };
}

// eslint-disable-next-line no-restricted-syntax -- boundary: parses one untyped scene-flag entry, validating shape and returning a narrow TokenFeature or null
export function parseToken(v: unknown): TokenFeature | null {
    if (!isRecord(v) || v['type'] !== 'token' || typeof v['id'] !== 'string' || typeof v['actor'] !== 'string' || !Array.isArray(v['points'])) {
        return null;
    }
    const [at] = v['points'].filter(isPoint);
    if (at === undefined || v['actor'] === '') {
        return null;
    }
    const token = makeToken(v['id'], at, {
        actor: v['actor'],
        name: stringOrNull(v['name']),
        hidden: v['hidden'] === true,
        disposition: isTokenDisposition(v['disposition']) ? v['disposition'] : null,
        size: validSize(v['size']),
    });
    const lift = typeof v['lift'] === 'number' && Number.isFinite(v['lift']) ? v['lift'] : 0;
    return { ...token, lift, ...parseFeatureCommon(v) };
}
