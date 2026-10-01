// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The ways between a building's levels. Each way (up to its floors, down to
 * its cellars) takes a flight: a stamp of the access asked for that climbs
 * from where it stands, else another that climbs, standing in. Storm doors
 * lead down into the top cellar from outside, through an areaway beside the
 * wall with a door through into the cellar; without storm door art, a
 * flight in the areaway climbs to the ground instead. What stands in, or is
 * borrowed from another setting, is reported. Pure and unit-tested;
 * positions are in grid squares.
 */
import { type DoorSlot, OPPOSITE_SIDE, type Rect, type Side } from '../generate/floor-plan';
import { pick, type Random } from '../generate/random';
import type { StampTransitionKind } from '../stamps/schema';
import type { AccessKind, Edge } from './intent';
import type { ComposeProblem } from './problems';
import type { RoleIndex, RoleStamp } from './roles';

/** The stamp a way between levels takes, and what choosing it had to report. */
export interface Flight {
    readonly stair: RoleStamp | undefined;
    readonly problems: readonly ComposeProblem[];
}

/**
 * Every stamp that climbs from the level it stands on. Over a level below
 * (`below`), those that only climb: a way both up and down would open onto
 * the level beneath too; one is taken there only when nothing else climbs.
 */
function climbers(stamps: RoleIndex, below: boolean): RoleStamp[] {
    const climbing = (stamps.get('stairs') ?? []).filter((s) => s.climb !== null && s.climb.direction !== 'down');
    const onlyUp = climbing.filter((s) => s.climb?.direction === 'up');
    return below && onlyUp.length > 0 ? onlyUp : climbing;
}

/** The problems of taking `stamp` for a way wanted in `wantedIn`: none loaded, another kind standing in, another setting's. */
function flightProblems(stamp: RoleStamp | undefined, standsIn: boolean, wanted: AccessKind | 'storm-door', wantedIn: string): ComposeProblem[] {
    if (!stamp?.climb) {
        return [{ kind: 'no-stamp', role: 'stairs', wantedIn }];
    }
    const used = stamp.climb.kind;
    return [
        ...(standsIn ? [{ kind: 'stand-in' as const, wanted, used, wantedIn }] : []),
        ...(stamp.borrowed ? [{ kind: 'borrowed' as const, used, wantedIn }] : []),
    ];
}

/** The first of `tiers` with any stamps in it: the most fitting choice there is. */
const firstOf = (tiers: readonly (readonly RoleStamp[])[]): readonly RoleStamp[] => tiers.find((tier) => tier.length > 0) ?? [];

/** `stamps` from the map's own settings first, then those borrowed from others. */
const ownFirst = (stamps: readonly RoleStamp[], wanted: (s: RoleStamp) => boolean): (readonly RoleStamp[])[] => [
    stamps.filter((s) => wanted(s) && !s.borrowed),
    stamps.filter((s) => wanted(s) && s.borrowed),
];

/**
 * What the floor above a flight of `stair` shows of the way down: a stair's
 * own steps, seen from above as from below (a spiral stair is the same
 * spiral on both floors); over a ladder, a piece of its kind going down (its
 * well) that turns with the well, of the map's own settings, the same one
 * wherever it is asked: a built opening (a well, a hatch) before a bare
 * shaft or a hole broken through. Undefined where there is none, or the
 * stair is drawn in perspective and cannot turn: the opening is then a dark
 * frame.
 */
export function wayDownOver(stair: RoleStamp, stamps: RoleIndex): RoleStamp | undefined {
    const kind = stair.climb?.kind;
    if (kind === 'stairs') {
        return stair.upright ? undefined : stair;
    }
    return kind === undefined ? undefined : waysDown(kind, stamps)[0];
}

/**
 * The map's own settings' pieces of `kind` going down, seen from above,
 * that turn with a well: a built opening (a well, a hatch) first, then a
 * bare shaft or a hole broken through.
 */
function waysDown(kind: StampTransitionKind, stamps: RoleIndex): readonly RoleStamp[] {
    const built = (s: RoleStamp): boolean => s.tags.some((tag) => BUILT_OPENING_TAGS.includes(tag));
    // A ladder goes down through a trapdoor in the floor as often as through a bare well; never storm doors, which stand outside.
    const ofKind = (s: RoleStamp): boolean => s.climb?.kind === kind || (kind === 'ladder' && s.climb?.kind === 'hatch' && built(s));
    const [own = []] = ownFirst(stamps.get('stairs') ?? [], (s) => s.climb?.direction === 'down' && ofKind(s) && !s.upright);
    return [...own.filter(built), ...own.filter((s) => !built(s))];
}

/**
 * `flight` in the least floor its kind of way takes (a straight flight where
 * a broad stairwell would not fit the room asked for it): the smallest of
 * the loaded ways of its kind and direction, from the same settings; as it
 * is where there is none smaller.
 */
export function narrowestFlight(flight: Flight, stamps: RoleIndex): Flight {
    const { stair } = flight;
    if (!stair) {
        return flight;
    }
    const alike = (stamps.get('stairs') ?? []).filter(
        (s) => s.climb?.kind === stair.climb?.kind && s.climb?.direction === stair.climb?.direction && s.borrowed === stair.borrowed,
    );
    const [least] = [...alike].sort((a, b) => a.width * a.height - b.width * b.height);
    return least ? { ...flight, stair: least } : flight;
}

/**
 * `stamps` with its flights of stairs narrowed to the art carrying one of
 * `tags` (a tavern's `spiral` wooden stair), where any does; ladders, hatches
 * and every other way as they are.
 */
export function withStairTags(stamps: RoleIndex, tags: readonly string[]): RoleIndex {
    const ways = stamps.get('stairs') ?? [];
    const isFlight = (s: RoleStamp): boolean => s.climb?.kind === 'stairs';
    const tagged = ways.filter((s) => isFlight(s) && s.tags.some((tag) => tags.includes(tag)));
    return tagged.length === 0 ? stamps : new Map([...stamps, ['stairs', [...tagged, ...ways.filter((s) => !isFlight(s))]]]);
}

/** Tags naming a way down built into a floor, as a building's is: not a shaft or a hole broken through. */
const BUILT_OPENING_TAGS: readonly string[] = ['well', 'hatch', 'trapdoor', 'stairwell'];

/**
 * The flight a building's `kind` of access takes: one of that kind that
 * climbs, else one of that kind going down, seen from above (it stands in
 * the floor above, the way between the floors), else any that climbs, the
 * map's own settings' before another's (a ladder of the setting before
 * another setting's staircase). `below` says whether the storey it climbs
 * from has a level beneath it.
 */
export function flightFor(kind: AccessKind, stamps: RoleIndex, random: Random, place: { readonly wantedIn: string; readonly below: boolean }): Flight {
    const { wantedIn, below } = place;
    const climbing = climbers(stamps, below);
    const [ownKind = [], borrowedKind = []] = ownFirst(climbing, (s) => s.climb?.kind === kind);
    const [ownAny = [], borrowedAny = []] = ownFirst(climbing, () => true);
    const stair = pick(random, firstOf([ownKind, waysDown(kind, stamps).slice(0, 1), ownAny, borrowedKind, borrowedAny]));
    return { stair, problems: flightProblems(stair, stair !== undefined && stair.climb?.kind !== kind, kind, wantedIn) };
}

/** A storm door's way down: its areaway, the door through into the cellar, and the piece that joins the levels. */
export interface StormDoorway {
    /** On the top cellar's level, outside the footprint beside the wall. */
    readonly areaway: Rect;
    /** The door in the areaway's wall to the building. */
    readonly door: DoorSlot;
    /** The same door, as the building's own wall has it. */
    readonly through: DoorSlot;
    /** The storm doors over the areaway on the ground level, or a flight standing in for them on the cellar's; null with neither. */
    readonly piece: { readonly stamp: RoleStamp; readonly x: number; readonly y: number; readonly rotation: number; readonly onGround: boolean } | null;
    readonly problems: readonly ComposeProblem[];
}

/** Each map edge as the side of a footprint facing it. */
const EDGE_SIDE: Readonly<Record<Edge, Side>> = { north: 'top', east: 'right', south: 'bottom', west: 'left' };

/** The rotation that sets a piece beside the footprint's `side` with its back (its image top) to the building's wall. */
const BACK_TO_BUILDING: Readonly<Record<Side, number>> = { bottom: 0, left: 90, top: 180, right: 270 };

const FULL_TURN = 360;

/** The smallest areaway, in squares either way: room to stand at the foot of the way down. */
const MIN_AREAWAY = 2;

/** An areaway `along` the footprint's `side` and `depth` out from it, centred on the wall. */
function areawayRect(footprint: Rect, side: Side, along: number, depth: number): Rect {
    const { x, y, w, h } = footprint;
    const acrossX = x + Math.floor((w - along) / 2);
    const acrossY = y + Math.floor((h - along) / 2);
    const rects: Readonly<Record<Side, Rect>> = {
        top: { x: acrossX, y: y - depth, w: along, h: depth },
        bottom: { x: acrossX, y: y + h, w: along, h: depth },
        left: { x: x - depth, y: acrossY, w: depth, h: along },
        right: { x: x + w, y: acrossY, w: depth, h: along },
    };
    return rects[side];
}

/**
 * Storm doors on the `edge` side of `footprint`: stamps going down from the
 * ground that can lie with their back to the wall, else a flight up from the
 * areaway (`below` says whether the top cellar has a level beneath it).
 */
export function stormDoorway(
    edge: Edge,
    footprint: Rect,
    stamps: RoleIndex,
    random: Random,
    place: { readonly wantedIn: string; readonly below: boolean },
): StormDoorway {
    const { wantedIn, below } = place;
    const side = EDGE_SIDE[edge];
    const turn = BACK_TO_BUILDING[side];
    const lies = (s: RoleStamp): boolean => !s.upright || (turn + s.turn) % FULL_TURN === 0;
    // Storm doors are a hatch over the areaway: art tagged so first, then any hatch going down, only then a flight down.
    const [own = [], lent = []] = ownFirst(stamps.get('stairs') ?? [], (s) => s.climb?.direction === 'down' && lies(s));
    const tiers = (list: readonly RoleStamp[]): (readonly RoleStamp[])[] => [
        list.filter((s) => s.tags.includes('storm')),
        list.filter((s) => s.climb?.kind === 'hatch'),
        list,
    ];
    const doors = pick(random, firstOf([...tiers(own), ...tiers(lent)]));
    // Standing in, a ladder suits a cramped areaway best.
    const climbing = climbers(stamps, below);
    const [ownLadder = [], borrowedLadder = []] = ownFirst(climbing, (s) => s.climb?.kind === 'ladder');
    const [ownAny = [], borrowedAny = []] = ownFirst(climbing, () => true);
    const stamp = doors ?? pick(random, firstOf([ownLadder, ownAny, borrowedLadder, borrowedAny]));
    const along = Math.max(MIN_AREAWAY, Math.ceil(stamp?.width ?? 0));
    const depth = Math.max(MIN_AREAWAY, Math.ceil(stamp?.height ?? 0));
    const areaway = areawayRect(footprint, side, along, depth);
    const at = (side === 'top' || side === 'bottom' ? areaway.x : areaway.y) + Math.floor((along - 1) / 2);
    return {
        areaway,
        door: { side: OPPOSITE_SIDE[side], at },
        through: { side, at },
        piece: stamp
            ? {
                  stamp,
                  x: areaway.x + areaway.w / 2,
                  y: areaway.y + areaway.h / 2,
                  rotation: stamp.upright ? 0 : (turn + stamp.turn) % FULL_TURN,
                  onGround: doors !== undefined,
              }
            : null,
        problems: flightProblems(stamp, doors === undefined && stamp !== undefined, 'storm-door', wantedIn),
    };
}
