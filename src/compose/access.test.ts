// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import type { StampRole } from '../stamps/schema';
import { flightFor, narrowestFlight, stormDoorway, wayDownOver, withStairTags } from './access';
import type { RoleIndex, RoleStamp } from './roles';
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

describe('wayDownOver', () => {
    const ladder = TEST_ROLES.get('stairs')?.find((s) => s.key === 'test:ladder');
    if (!ladder) {
        throw new Error('the test roles have no ladder');
    }
    /** A ladder going down, drawn as `tags` say. */
    const down = (id: string, tags: readonly string[], more: Partial<RoleStamp> = {}): RoleStamp => ({
        ...ladder,
        key: `test:${id}`,
        tags,
        climb: { kind: 'ladder', direction: 'down' },
        ...more,
    });
    /** The key of what shows above the ladder with `pieces` loaded besides the test roles' ways. */
    const over = (...pieces: readonly RoleStamp[]): string | undefined =>
        wayDownOver(ladder, new Map<StampRole, readonly RoleStamp[]>([...TEST_ROLES, ['stairs', [...(TEST_ROLES.get('stairs') ?? []), ...pieces]]]))?.key;

    it('shows a built opening of the flight’s kind above it before a bare shaft, and only the map’s own turnable art', () => {
        const shaft = down('shaft', ['drop', 'shaft']);
        const well = down('well', ['ladder', 'well']);
        expect(over(shaft, well)).toBe('test:well');
        expect(over(shaft)).toBe('test:shaft');
        // Another setting's well, or one drawn in perspective that cannot turn with the well, is never taken.
        expect(over(shaft, down('borrowed-well', ['well'], { borrowed: true }))).toBe('test:shaft');
        expect(over(down('upright-well', ['well'], { upright: true }))).toBeUndefined();
        // The storm doors go down, but as a hatch, not a ladder: over a ladder with nothing else, a dark frame.
        expect(over()).toBeUndefined();
    });

    it('takes a ladder seen only from above, going down, before another kind stands in; never another setting’s', () => {
        const stairs = TEST_ROLES.get('stairs')?.find((s) => s.key === 'test:stairs');
        if (!stairs) {
            throw new Error('the test roles have no stairs');
        }
        const hatch = down('hatch', ['ladder', 'hatch']);
        const loaded = (...ways: readonly RoleStamp[]): RoleIndex => new Map<StampRole, readonly RoleStamp[]>([...TEST_ROLES, ['stairs', [stairs, ...ways]]]);
        expect(flightFor('ladder', loaded(down('shaft', ['shaft']), hatch), seededRandom(1), at('ship'))).toEqual({ stair: hatch, problems: [] });
        expect(flightFor('ladder', loaded({ ...hatch, borrowed: true }), seededRandom(1), at('ship'))).toMatchObject({
            stair: { key: 'test:stairs' },
            problems: [{ kind: 'stand-in', wanted: 'ladder', used: 'stairs' }],
        });
    });

    it('shows a stair’s own steps above it, seen from above as from below; a frame over one drawn in perspective', () => {
        const stairs = TEST_ROLES.get('stairs')?.find((s) => s.key === 'test:stairs');
        if (!stairs) {
            throw new Error('the test roles have no stairs');
        }
        expect(wayDownOver(stairs, TEST_ROLES)?.key).toBe('test:stairs');
        expect(wayDownOver({ ...stairs, upright: true }, TEST_ROLES)).toBeUndefined();
        // A piece that joins no levels has no way down to show.
        expect(wayDownOver({ ...stairs, climb: null }, TEST_ROLES)).toBeUndefined();
    });
});

describe('narrowestFlight', () => {
    it('takes the smallest way of the same kind, direction and source, and leaves one with none smaller as it is', () => {
        const stairs = TEST_ROLES.get('stairs')?.find((s) => s.key === 'test:stairs');
        if (!stairs) {
            throw new Error('the test roles have no stairs');
        }
        const broad: RoleStamp = { ...stairs, key: 'test:broad-stairs', width: 3, height: 3 };
        const other: RoleStamp = { ...stairs, key: 'test:borrowed-stairs', width: 0.5, height: 0.5, borrowed: true };
        const pool = new Map<StampRole, readonly RoleStamp[]>([...TEST_ROLES, ['stairs', [broad, stairs, other]]]);
        expect(narrowestFlight({ stair: broad, problems: [] }, pool).stair?.key).toBe('test:stairs');
        expect(narrowestFlight({ stair: undefined, problems: [] }, pool).stair).toBeUndefined();
    });
});

describe('withStairTags', () => {
    it('narrows the flights of stairs to the art carrying a tag asked, keeping every other way; as it is where none carries one', () => {
        const stairs = TEST_ROLES.get('stairs')?.find((s) => s.key === 'test:stairs');
        if (!stairs) {
            throw new Error('the test roles have no stairs');
        }
        const spiral: RoleStamp = { ...stairs, key: 'test:spiral', tags: ['spiral', 'wooden', 'stairs'] };
        const pool = new Map<StampRole, readonly RoleStamp[]>([...TEST_ROLES, ['stairs', [...(TEST_ROLES.get('stairs') ?? []), spiral]]]);
        const ways = withStairTags(pool, ['spiral']).get('stairs') ?? [];
        expect(ways.map((s) => s.key)).toContain('test:spiral');
        expect(ways.map((s) => s.key)).not.toContain('test:stairs');
        expect(ways.map((s) => s.key)).toContain('test:ladder');
        expect(flightFor('stairs', withStairTags(pool, ['spiral']), seededRandom(1), at('inn')).stair?.key).toBe('test:spiral');
        expect(withStairTags(pool, ['marble'])).toBe(pool);
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

    it('takes storm doors, or failing them a hatch, before a flight going down, whichever seed', () => {
        const stairs = TEST_ROLES.get('stairs') ?? [];
        const doors = stairs.find((s) => s.key === 'test:storm-doors');
        if (!doors) {
            throw new Error('the test roles have no storm doors');
        }
        const crypt: RoleStamp = { ...doors, key: 'test:crypt-stair', tags: ['crypt', 'stair'], climb: { kind: 'stairs', direction: 'down' } };
        const hatch: RoleStamp = { ...doors, key: 'test:trapdoor', tags: ['trapdoor'] };
        const withDown = (...more: readonly RoleStamp[]): RoleIndex => new Map([...TEST_ROLES, ['stairs', [...stairs, ...more]]]);
        for (const seed of [1, 2, 3, 4]) {
            expect(stormDoorway('south', FOOTPRINT, withDown(crypt, { ...doors, tags: ['storm'] }), seededRandom(seed), at('x')).piece?.stamp.key).toBe(
                'test:storm-doors',
            );
            const noStorm =
                withDown(crypt, hatch)
                    .get('stairs')
                    ?.filter((s) => s.key !== 'test:storm-doors') ?? [];
            const hatchKey = stormDoorway('south', FOOTPRINT, new Map([...TEST_ROLES, ['stairs', noStorm]]), seededRandom(seed), at('x')).piece?.stamp.key;
            expect(hatchKey).toBe('test:trapdoor');
        }
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
