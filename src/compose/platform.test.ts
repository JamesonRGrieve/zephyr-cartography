// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import type { StampRole } from '../stamps/schema';
import { parseMapIntent, type PlatformIntent } from './intent';
import { platformFeatures } from './platform';
import type { RoleIndex, RoleStamp } from './roles';
import { TEST_ROLES } from './test-roles';

/** A platform as the intent gives it, its defaults filled in. */
function platformOf(given: object): PlatformIntent {
    const parsed = parseMapIntent({ schemaVersion: 1, platforms: [given] });
    const [platform] = parsed.ok ? parsed.intent.platforms : [];
    if (!platform) {
        throw new Error(parsed.ok ? 'no platform' : JSON.stringify(parsed.issues));
    }
    return platform;
}

const LEVELS = { ground: { level: 'ground' }, above: { level: 'floor-2' }, below: false } as const;

const compose = (platform: PlatformIntent, stamps: RoleIndex = TEST_ROLES) => platformFeatures([platform], { stamps, random: seededRandom(1), ...LEVELS });

describe('platformFeatures', () => {
    it('lays a platform’s railed floor on the level above, open where its stair climbs to it from the ground', () => {
        const { features, problems } = compose(platformOf({ name: 'Feed grate', rect: { x: 10, y: 4, w: 8, h: 3 }, stair: { side: 'left', at: 0.5 } }));
        expect(problems).toEqual([]);
        const deck = features.find((f) => f.type === 'room');
        expect(deck).toMatchObject({ key: 'platform-1', level: 'floor-2', floor: 'floor.metal-grating', wallKind: 'invisible', ceiling: false });
        // One opening, an archway where the stair arrives: the rest of its edge railed.
        expect(deck?.type === 'room' ? (deck.doors ?? []).map((d) => d.type) : []).toEqual(['opening']);
        // The stair on the ground just west of it, turned to climb east onto it, centred on the stretch it arrives at.
        const stair = features.find((f) => f.type === 'stamp');
        const flight = TEST_ROLES.get('stairs')?.find((s) => s.key === 'test:stairs');
        expect(stair).toMatchObject({ stamp: 'test:stairs', level: 'ground', rotation: 90 });
        expect(stair?.type === 'stamp' ? [stair.x, stair.y] : []).toEqual([10 - (flight?.height ?? 0) / 2, 4 + 0.5 + (flight?.width ?? 0) / 2]);
    });

    it('turns its stair to climb onto whichever side it stands against', () => {
        const turns = (['bottom', 'left', 'top', 'right'] as const).map((side) => {
            const stair = compose(platformOf({ rect: { x: 10, y: 10, w: 6, h: 6 }, stair: { side, at: 1 } })).features.find((f) => f.type === 'stamp');
            return stair?.type === 'stamp' ? stair.rotation : undefined;
        });
        expect(turns).toEqual([0, 90, 180, 270]);
    });

    it('opens the whole end of a catwalk narrower than its stair, and stands what is on it on its level', () => {
        const hopper = { name: 'feed hopper', width: 1, height: 1, at: { x: 12, y: 5 } };
        const { features, problems } = compose(platformOf({ rect: { x: 10, y: 4, w: 12, h: 0.5 }, fixtures: [hopper], stair: { side: 'left', at: 0 } }));
        const deck = features.find((f) => f.type === 'room');
        // Its end is half a square: the stair is wider, so the opening is the whole end, the railing kept whole along its length.
        expect(deck?.type === 'room' ? deck.doors ?? [] : []).toHaveLength(1);
        expect(features.filter((f) => f.type === 'stamp' && f.level === 'floor-2')).toHaveLength(1);
        // No art for it: a labelled box, reported for the platform.
        expect(problems).toEqual([{ kind: 'placeholder', piece: 'feed hopper', wantedIn: 'platform-1' }]);
    });

    it('still lays the platform where no stair is loaded, and says so', () => {
        const noStairs: RoleIndex = new Map<StampRole, readonly RoleStamp[]>([...TEST_ROLES, ['stairs', []]]);
        const { features, problems } = compose(platformOf({ rect: { x: 0, y: 0, w: 4, h: 4 }, stair: { side: 'top', at: 1 } }), noStairs);
        expect(features.map((f) => f.type)).toEqual(['room']);
        expect(problems).toEqual([{ kind: 'no-stamp', role: 'stairs', wantedIn: 'platform-1' }]);
    });

    it('rails round an overpass reached from beyond the map: no stair, no opening', () => {
        const { features, problems } = compose(platformOf({ name: 'Overpass', rect: { x: 0, y: 8, w: 30, h: 2 } }));
        expect(problems).toEqual([]);
        expect(features.map((f) => f.type)).toEqual(['room']);
        const [deck] = features;
        expect(deck?.type === 'room' ? deck.doors ?? [] : ['a door']).toEqual([]);
    });

    it('refuses a stair that arrives past the end of its side', () => {
        const parsed = parseMapIntent({ schemaVersion: 1, platforms: [{ rect: { x: 0, y: 0, w: 4, h: 2 }, stair: { side: 'left', at: 2 } }] });
        expect(parsed.ok).toBe(false);
    });
});
