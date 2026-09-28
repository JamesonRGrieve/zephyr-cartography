// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import { flightFor, stormDoorway } from './access';
import type { RoleIndex } from './roles';
import { TEST_ROLES } from './test-roles';

/** The test roles with only these ways between levels. */
function withAccess(keys: readonly string[], change: (key: string) => object = () => ({})): RoleIndex {
    const stairs = (TEST_ROLES.get('stairs') ?? []).filter((s) => keys.includes(s.key)).map((s) => ({ ...s, ...change(s.key) }));
    return new Map([...TEST_ROLES, ['stairs', stairs]]);
}

const FOOTPRINT = { x: 10, y: 6, w: 12, h: 8 };

/** Where a way is wanted, with no level beneath it unless said. */
const at = (wantedIn: string, below = false): { wantedIn: string; below: boolean } => ({ wantedIn, below });

describe('flightFor', () => {
    it('takes the access asked for, and says when another kind stands in or another setting’s is borrowed', () => {
        expect(flightFor('ladder', TEST_ROLES, seededRandom(1), at('inn')).stair?.key).toBe('test:ladder');
        expect(flightFor('stairs', TEST_ROLES, seededRandom(1), at('inn'))).toMatchObject({ stair: { key: 'test:stairs' }, problems: [] });
        // No staircase loaded: the ladder stands in, and never the storm doors, which go down.
        const laddersOnly = withAccess(['test:ladder', 'test:storm-doors']);
        expect(flightFor('stairs', laddersOnly, seededRandom(1), at('inn'))).toMatchObject({
            stair: { key: 'test:ladder' },
            problems: [{ kind: 'stand-in', wanted: 'stairs', used: 'ladder', wantedIn: 'inn' }],
        });
        const borrowed = withAccess(['test:ladder'], () => ({ borrowed: true }));
        expect(flightFor('ladder', borrowed, seededRandom(1), at('inn')).problems).toEqual([{ kind: 'borrowed', used: 'ladder', wantedIn: 'inn' }]);
        // The setting's own staircase stands in for a ladder before another setting's ladder is borrowed.
        const both = withAccess(['test:ladder', 'test:stairs'], (key) => ({ borrowed: key === 'test:ladder' }));
        expect(flightFor('ladder', both, seededRandom(1), at('inn'))).toMatchObject({
            stair: { key: 'test:stairs' },
            problems: [{ kind: 'stand-in', wanted: 'ladder', used: 'stairs' }],
        });
        expect(flightFor('ladder', withAccess([]), seededRandom(1), at('inn'))).toEqual({
            stair: undefined,
            problems: [{ kind: 'no-stamp', role: 'stairs', wantedIn: 'inn' }],
        });
    });

    it('over a level below, takes a way that only climbs before one leading both up and down, which would open onto it', () => {
        const twoWay = withAccess(['test:stairs', 'test:ladder'], (key) => (key === 'test:stairs' ? { climb: { kind: 'stairs', direction: 'both' } } : {}));
        // With nothing beneath, the two-way staircase is as good as any.
        expect(flightFor('stairs', twoWay, seededRandom(1), at('inn')).stair?.key).toBe('test:stairs');
        // Over a cellar, the ladder stands in rather than open the stair onto it.
        expect(flightFor('stairs', twoWay, seededRandom(1), at('inn', true))).toMatchObject({
            stair: { key: 'test:ladder' },
            problems: [{ kind: 'stand-in', wanted: 'stairs', used: 'ladder' }],
        });
        // With nothing else that climbs, it is taken anyway.
        const onlyTwoWay = withAccess(['test:stairs'], () => ({ climb: { kind: 'stairs', direction: 'both' } }));
        expect(flightFor('stairs', onlyTwoWay, seededRandom(1), at('inn', true)).stair?.key).toBe('test:stairs');
    });
});

describe('stormDoorway', () => {
    it('opens an areaway beside the wall with a door through, the storm doors over it on the ground, backs to the wall', () => {
        const south = stormDoorway('south', FOOTPRINT, TEST_ROLES, seededRandom(1), at('inn/storm-door'));
        // Against the bottom wall, centred on it, outside the footprint.
        expect(south.areaway.y).toBe(FOOTPRINT.y + FOOTPRINT.h);
        expect(south.areaway.x + south.areaway.w / 2).toBeCloseTo(FOOTPRINT.x + FOOTPRINT.w / 2, 0);
        expect(south.door.side).toBe('top');
        expect(south.through).toEqual({ side: 'bottom', at: south.door.at });
        expect(south.piece).toMatchObject({ stamp: { key: 'test:storm-doors' }, rotation: 0, onGround: true });
        expect(south.problems).toEqual([]);
        // Every side turns the doors' back to the building.
        const rotations = (['north', 'east', 'west'] as const).map(
            (edge) => stormDoorway(edge, FOOTPRINT, TEST_ROLES, seededRandom(1), at('x')).piece?.rotation,
        );
        expect(rotations).toEqual([180, 270, 90]);
        const west = stormDoorway('west', FOOTPRINT, TEST_ROLES, seededRandom(1), at('x')).areaway;
        expect(west.x + west.w).toBe(FOOTPRINT.x);
    });

    it('stands a flight up in the areaway when no storm doors are loaded, or they cannot lie against that wall, and says so', () => {
        const noDoors = stormDoorway('east', FOOTPRINT, withAccess(['test:ladder']), seededRandom(1), at('inn/storm-door'));
        expect(noDoors.piece).toMatchObject({ stamp: { key: 'test:ladder' }, onGround: false });
        expect(noDoors.problems).toEqual([{ kind: 'stand-in', wanted: 'storm-door', used: 'ladder', wantedIn: 'inn/storm-door' }]);
        // Doors drawn with depth stand only unturned: fine on the south side, never on the north.
        const upright = withAccess(['test:ladder', 'test:storm-doors'], (key) => (key === 'test:storm-doors' ? { upright: true } : {}));
        expect(stormDoorway('south', FOOTPRINT, upright, seededRandom(1), at('x')).piece?.stamp.key).toBe('test:storm-doors');
        expect(stormDoorway('north', FOOTPRINT, upright, seededRandom(1), at('x')).piece?.stamp.key).toBe('test:ladder');
        expect(stormDoorway('north', FOOTPRINT, withAccess([]), seededRandom(1), at('x'))).toMatchObject({
            piece: null,
            problems: [{ kind: 'no-stamp', role: 'stairs', wantedIn: 'x' }],
        });
    });
});
