// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Raised platforms: a feed grate over a machine, a catwalk along vats, a
 * gantry bridge. Each is a floor on the level above the ground, railed round
 * (walls that stop a step but not a look) but where its stair arrives; the
 * stair, a flight from the loaded packs, stands on the ground against that
 * side, turned to climb onto it, and is the way between the two levels.
 */
import { type DoorSlot, type Rect, roomSpec, type Side } from '../generate/floor-plan';
import type { Random } from '../generate/random';
import type { SceneSpecInput } from '../generate/spec';
import { flightFor } from './access';
import type { PlatformIntent } from './intent';
import { standingAt } from './named';
import type { ComposeProblem } from './problems';
import type { RoleIndex, RoleStamp } from './roles';

type FeatureInput = SceneSpecInput['features'][number];

/** Degrees in a full turn. */
const FULL_TURN = 360;

/** The turn that points a flight's top (its upper end, as drawn) at the platform, from each side it stands against. */
const CLIMB_TURN: Readonly<Record<Side, number>> = { bottom: 0, left: 90, top: 180, right: 270 };

/** Where on the ground a platform's stair stands, `stair` wide and long, against its `side` `at` squares along it: its centre. */
function stairFoot(rect: Rect, side: Side, at: number, stair: RoleStamp): { x: number; y: number } {
    const across = at + stair.width / 2;
    const out = stair.height / 2;
    const foot: Readonly<Record<Side, { x: number; y: number }>> = {
        bottom: { x: rect.x + across, y: rect.y + rect.h + out },
        top: { x: rect.x + across, y: rect.y - out },
        left: { x: rect.x - out, y: rect.y + across },
        right: { x: rect.x + rect.w + out, y: rect.y + across },
    };
    return foot[side];
}

/** A platform's stair: the opening in its railing where it arrives, the flight on the ground, and what went wrong. */
interface StairUp {
    readonly head: DoorSlot[];
    readonly flight: FeatureInput[];
    readonly problems: readonly ComposeProblem[];
}

/** A platform reached from beyond the map (an overpass from wall to wall): railed all round, no stair. */
const NO_STAIR: StairUp = { head: [], flight: [], problems: [] };

/** The stair `asked` for up to the platform over `rect`: a flight of the packs', on the ground, turned to climb onto it. */
function stairUp(
    rect: Rect,
    asked: { readonly side: Side; readonly at: number },
    context: {
        readonly stamps: RoleIndex;
        readonly random: Random;
        readonly ground: { readonly level?: string };
        readonly below: boolean;
        readonly wantedIn: string;
    },
): StairUp {
    const { stamps, random, ground, below, wantedIn } = context;
    const { stair, problems } = flightFor('stairs', stamps, random, { wantedIn, below });
    if (!stair) {
        return { ...NO_STAIR, problems };
    }
    const span = asked.side === 'top' || asked.side === 'bottom' ? rect.w : rect.h;
    const along = asked.side === 'top' || asked.side === 'bottom' ? rect.x : rect.y;
    // Where the stair arrives, the railing is open as wide as the stair, or the whole side where the stair is broader (a
    // narrow catwalk's end).
    return {
        head: [{ side: asked.side, at: along + asked.at, width: Math.min(stair.width, span - asked.at), open: true, arch: true }],
        flight: [
            {
                type: 'stamp',
                stamp: stair.key,
                ...stairFoot(rect, asked.side, asked.at, stair),
                rotation: (stair.turn + CLIMB_TURN[asked.side]) % FULL_TURN,
                ...ground,
            },
        ],
        problems,
    };
}

/**
 * The features of the map's `platforms`: each one's railed floor on the
 * level `above`, its stair on the `ground` climbing to it; and what went
 * wrong (no flight loaded, another kind standing in).
 */
export function platformFeatures(
    platforms: readonly PlatformIntent[],
    context: {
        readonly stamps: RoleIndex;
        readonly random: Random;
        readonly ground: { readonly level?: string };
        readonly above: { readonly level?: string };
        readonly below: boolean;
    },
): { features: FeatureInput[]; problems: ComposeProblem[] } {
    const { stamps, random, ground, above, below } = context;
    const composed = platforms.map((platform, i) => {
        const { rect, floor } = platform;
        const wantedIn = `platform-${i + 1}`;
        const { head, flight, problems } = platform.stair === null ? NO_STAIR : stairUp(rect, platform.stair, { stamps, random, ground, below, wantedIn });
        const deck: FeatureInput = { ...roomSpec(rect, head, { floor, wall: null, wallKind: 'invisible', ceiling: false }), key: wantedIn, ...above };
        // What stands on it, on its level, drawn over its floor.
        const standing = platform.fixtures.map((fixture) => standingAt(fixture, stamps));
        const onIt: FeatureInput[] = standing.flatMap(({ placed }) => placed.map((s): FeatureInput => ({ type: 'stamp', ...s, ...above })));
        const boxed = platform.fixtures.flatMap((fixture, n) =>
            standing[n]?.boxed === true ? [{ kind: 'placeholder' as const, piece: fixture.name, wantedIn }] : [],
        );
        return { features: [deck, ...onIt, ...flight], problems: [...problems, ...boxed] };
    });
    return { features: composed.flatMap((c) => c.features), problems: composed.flatMap((c) => c.problems) };
}
