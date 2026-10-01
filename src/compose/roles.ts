// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The stamps the composer can use, by role: every loaded stamp its pack or
 * its tags give a role (see `role-tags.ts`) and, when the intent names
 * settings, carrying one of their tags, with its footprint in grid squares
 * and how it wants to stand. Pure and unit-tested.
 */
import type { CatalogStamp } from '../stamps/catalog';
import type { StampAnchor, StampBack, StampHabitat, StampRole, StampTransitionDirection, StampTransitionKind } from '../stamps/schema';
import { type MapScale, ROOM_PURPOSES, type RoomPurpose } from './intent';
import { habitatsOf, placementOf, roleFromTags, suitsScale } from './role-tags';

/** A door's state as a pack's variants name it. */
type DoorState = NonNullable<CatalogStamp['variants'][number]['doorState']>;

/** A run's two ends as drawn, its back up: `start` at the left, `end` at the right. */
export type RunEnd = 'start' | 'end';

/**
 * A stamp as the composer handles it: turned so its back is up. `width` runs
 * along its back and `height` is its depth, in grid squares, and `turn` is
 * the rotation (degrees) that brings the image's back edge to the top, added
 * to wherever it is placed.
 */
export interface RoleStamp {
    /** Catalog key, as a scene spec's stamp names it. */
    readonly key: string;
    readonly role: StampRole;
    readonly width: number;
    readonly height: number;
    readonly turn: number;
    readonly against: StampAnchor;
    /** Squares of open floor kept in front of it. */
    readonly clearance: number;
    /** Drawn side-on (a tower, a tent): never turned, so it always stands as drawn. */
    readonly upright: boolean;
    /** The ground a land stamp belongs on (none said: it dresses no outdoor zone). */
    readonly habitats: readonly StampHabitat[];
    /** How it joins levels (a stair's, ladder's or storm door's transition), or null. */
    readonly climb: { readonly kind: StampTransitionKind; readonly direction: StampTransitionDirection } | null;
    /** From outside the map's settings: a way between levels its settings have none of. */
    readonly borrowed: boolean;
    /** The kinds of room its tags say it belongs in (a `medicae` bed, a `cell` bunk); none: any room. */
    readonly purposes: readonly RoomPurpose[];
    /** Its descriptive tags, for a fixture asking for particular art (a `reception` counter, not a food stall). */
    readonly tags: readonly string[];
    /** Drawn at this multiple of its art's own size, `width` and `height` already so: a named fixture's art fitted to the size asked. */
    readonly scale?: number;
    /** For a door stamp, the variant that shows each door state it draws (its first variant for that state). */
    readonly doorStates?: Readonly<Partial<Record<DoorState, number>>>;
    /**
     * A run of modules: drawn as `count` of `module` side by side along its
     * width (a wall of shelving units), between two of `cap` where its pack
     * draws an end piece: `cap` as drawn at the right-hand end, mirrored at
     * the left (a counter's rounded ends, a table's end boards). An `open`
     * end has no cap: it butts square against another run (an L-shaped
     * counter's legs).
     */
    readonly run?: { readonly count: number; readonly module: RoleStamp; readonly cap?: RoleStamp; readonly open?: readonly RunEnd[] };
    /** What players read on this piece by hovering over it: a named fixture's words (a sign's). */
    readonly reads?: string;
    /** Each of its art's variants' state, in the words of its pack (`ajar`, `lit`), by variant; omitted where none says. */
    readonly states?: readonly string[];
    /** Each variant's image resolution (its long side in pixels), by variant; omitted where none says. */
    readonly sharpness?: readonly number[];
    /** The variant it is drawn in (a named piece's state); omitted, its default. */
    readonly variant?: number;
    /** For a run piece, the gate and corner pieces of its kind (never drawn alone): what a named piece may ask for by its tag. */
    readonly parts?: readonly RoleStamp[];
}

/** The first variant of a door stamp showing each door state. */
function doorStatesOf(stamp: CatalogStamp): Partial<Record<DoorState, number>> {
    const states: Partial<Record<DoorState, number>> = {};
    stamp.variants.forEach((v, i) => {
        if (v.doorState !== undefined && states[v.doorState] === undefined) {
            states[v.doorState] = i;
        }
    });
    return states;
}

/**
 * Tags that say which kinds of room a piece belongs in without naming one:
 * a cooking pot is a kitchen's, a reliquary a shrine's, never a guest's
 * bedroom. (A tavern's table serves as well for a guest's writing table.)
 */
const PURPOSE_TAGS: Readonly<Record<string, readonly RoomPurpose[]>> = {
    cooking: ['kitchen'],
    kitchenware: ['kitchen'],
    reliquary: ['shrine', 'chapel'],
    offering: ['shrine', 'chapel'],
    votive: ['shrine', 'chapel'],
    // A chamber pot goes under a guest's bed, never out on a taproom's floor.
    chamber: ['bedroom'],
    // A table spread with maps is a war room's, and a throne a commander's or a chapel's: never a taproom's tables and stools,
    // nor a lobby's seats (a hall is a reception or a corridor as often as a lord's; a great hall names its throne).
    map: ['command'],
    throne: ['command', 'chapel'],
};

/** The kinds of room `tags` name, or say a piece belongs in. */
const purposesOf = (tags: readonly string[]): RoomPurpose[] =>
    ROOM_PURPOSES.filter((purpose) => tags.includes(purpose) || tags.some((tag) => PURPOSE_TAGS[tag]?.includes(purpose) === true));

/**
 * Small pieces a room holds many of, drawn afresh one by one (crates, barrels
 * and sacks; a room's clutter; what is set on a table; lamps): their isometric
 * art stays beside what is seen from above, for variety, standing as drawn. A room's matched furniture is drawn one way only.
 * Fittings are each one thing named by its tags (a pict-recorder, an iron maiden), no two alike: all their art stays.
 */
const MIXED_ROLES: readonly StampRole[] = ['storage', 'chest', 'clutter', 'tabletop', 'light', 'fitting'];

/**
 * Roles a map is unplayable without (a way between levels; a bed in a guest
 * room): other settings' stamps are kept too, flagged. A bed is borrowed only
 * when the map's settings have none; ways between levels keep both, the
 * settings' own taken first (`access.ts`), as the way wanted may be one only
 * another setting draws.
 */
const BORROWED_ROLES: readonly StampRole[] = ['stairs', 'bed'];

/** A piece of a run a pack draws apart, never drawn alone: the end that caps it, the corner that turns it, the gate through it. */
type RunPart = 'end' | 'corner' | 'gate';

/** Roles whose runs a pack may draw in parts: a table's sections and ends, a counter's segments, corner and gate. */
const RUN_ROLES: readonly StampRole[] = ['table', 'bench', 'counter', 'shelf', 'storage', 'console'];

/** The part of a run `tags` say a stamp of `role` is, if it is one. */
function partOf(role: StampRole, tags: readonly string[]): RunPart | undefined {
    if (!RUN_ROLES.includes(role)) {
        return undefined;
    }
    if (tags.includes('counter-gate')) {
        return 'gate';
    }
    if (tags.includes('counter-corner')) {
        return 'corner';
    }
    return tags.includes('counter-end') || tags.includes('end') ? 'end' : undefined;
}

/** Tags that say which part of a run a piece is, not what it is made of, so never pair a section with its end. */
const PART_WORDS: ReadonlySet<string> = new Set([
    'end',
    'section',
    'module',
    'segment',
    'corner',
    'gate',
    'counter-end',
    'counter-corner',
    'counter-gate',
    'counter-segment',
]);

/** What a run piece is made of, by its tags (oak, steel, brass): neither its role, its setting nor its part. */
const kindOf = (stamp: RoleStamp): string[] => stamp.tags.filter((tag) => tag !== stamp.role && !tag.startsWith('setting-') && !PART_WORDS.has(tag));

/** `stamp` drawn `depth` deep, its proportions kept. */
function atDepth(stamp: RoleStamp, depth: number): RoleStamp {
    const scale = depth / stamp.height;
    return { ...stamp, width: stamp.width * scale, height: depth, scale: (stamp.scale ?? 1) * scale };
}

/** `section` between two of `end`, fitted to its depth: the shortest whole piece its parts make (a table, a counter). */
function capped(section: RoleStamp, end: RoleStamp): RoleStamp {
    const cap = atDepth(end, section.height);
    return { ...section, width: section.width + 2 * cap.width, run: { count: 1, module: section, cap } };
}

/** Whether `variant` of `stamp` is drawn looking down on the piece (straight down or in one-point perspective), so turns like a plan. */
function seenFromAbove(stamp: CatalogStamp, variant: CatalogStamp['variants'][number]): boolean {
    const perspective = variant.perspective ?? stamp.perspective;
    return perspective === 'orthographic' || perspective === 'central';
}

/**
 * How `stamp`, of `role`, stands as the composer handles it: sized in grid
 * squares from `variant`, its back turned to the top. Art seen from above,
 * straight down or in one-point perspective, turns to face any wall;
 * isometric or front art's back is the image's top whatever the pack says,
 * and it is never turned.
 */
function roleStampOf(stamp: CatalogStamp, role: StampRole, variant: CatalogStamp['variants'][number], inSetting: boolean): RoleStamp {
    const placement = placementOf(role, stamp.tags, stamp.placement);
    const flat = seenFromAbove(stamp, variant);
    const back = flat ? placement.back : 'top';
    // A back on the image's left or right runs along its height.
    const sideways = back === 'left' || back === 'right';
    const w = variant.width / stamp.referenceGridSize;
    const h = variant.height / stamp.referenceGridSize;
    return {
        key: stamp.key,
        role,
        width: sideways ? h : w,
        height: sideways ? w : h,
        turn: TURN_TO_TOP[back],
        against: placement.against,
        clearance: placement.clearance,
        upright: placement.upright || !flat,
        habitats: habitatsOf(role, stamp.tags, stamp.habitats),
        climb: stamp.transition ? { kind: stamp.transition.kind, direction: stamp.transition.direction } : null,
        borrowed: !inSetting,
        purposes: purposesOf(stamp.tags),
        tags: stamp.tags,
        ...(stamp.door === undefined ? {} : { doorStates: doorStatesOf(stamp) }),
        // A state to ask for only where there is another to choose from.
        ...(stamp.variants.length > 1 ? { states: stamp.variants.map((v) => v.state), sharpness: stamp.variants.map((v) => pixelsOf(v.resolution)) } : {}),
    };
}

/** A pack resolution step (`512`, `2K`) as the long side in pixels; 0 where the pack does not say. */
const pixelsOf = (resolution: string | undefined): number =>
    resolution === undefined ? 0 : resolution.endsWith('K') ? Number(resolution.slice(0, -1)) * 1024 : Number(resolution);

/** The turn that brings each image edge to the top (clockwise, as Foundry turns tiles). */
const TURN_TO_TOP: Readonly<Record<StampBack, number>> = { top: 0, right: 270, bottom: 180, left: 90 };

export type RoleIndex = ReadonlyMap<StampRole, readonly RoleStamp[]>;

/** The gate and corner pieces `index` holds for `role` on its run pieces (a counter's lifting gate, its corner), for a named piece asking for one. */
export function partsOf(index: RoleIndex, role: StampRole): readonly RoleStamp[] {
    const parts = (index.get(role) ?? []).flatMap((s) => s.parts ?? []);
    return parts.filter((part, i) => parts.findIndex((other) => other.key === part.key) === i);
}

/** Setting tags naming a faction: its art stands only in maps that name it. */
const FACTION_SETTINGS: readonly string[] = [
    'setting-grimdark-communist',
    'setting-grimdark-undead',
    'setting-grimdark-chaotic',
    'setting-grimdark-elven',
    'setting-grimdark-orcish',
];

/**
 * The role `stamp` is composed in: its pack's, else its tags'; none where
 * its pack says null. Art drawn at a scale its role never takes (a room's
 * horse stall, a street stall's counter out on a promenade) cannot furnish
 * as that role, but a map can still name it: a fitting.
 */
export function composedRole(stamp: CatalogStamp, mapScale: MapScale = 'battlemap'): StampRole | undefined {
    const tagged = stamp.role === null ? undefined : stamp.role ?? roleFromTags(stamp.tags);
    return tagged !== undefined && !suitsScale(tagged, stamp.scale, mapScale) && suitsScale('fitting', stamp.scale, mapScale) ? 'fitting' : tagged;
}

/**
 * Index `stamps` by role, keeping only those carrying one of `settings` when
 * any are given. Isometric and front art stands as drawn, never turned:
 * turned half round it is upside down. Art seen from above (orthographic, or central
 * one-point perspective) turns like a plan, and a role with any such art
 * uses only that.
 */
export function roleIndex(stamps: readonly CatalogStamp[], settings: readonly string[], mapScale: MapScale = 'battlemap'): RoleIndex {
    const index = new Map<StampRole, RoleStamp[]>();
    const borrowed = new Map<StampRole, RoleStamp[]>();
    const orthographic = new Set<string>();
    // The end pieces of runs, set apart to cap the sections of their kind.
    const ends: RoleStamp[] = [];
    // A run's gates and corners, kept out of every list, carried by the run pieces of their kind.
    const apart: RoleStamp[] = [];
    for (const stamp of stamps) {
        // Its default variant, unless that one is drawn side-on and another looks down on the piece: then that one, which turns.
        const plan = stamp.variants.findIndex((v) => seenFromAbove(stamp, v));
        const defaultSeen = stamp.variants[stamp.defaultVariant];
        const drawn = defaultSeen !== undefined && !seenFromAbove(stamp, defaultSeen) && plan >= 0 ? plan : stamp.defaultVariant;
        const variant = stamp.variants[drawn];
        const role = composedRole(stamp, mapScale);
        // A faction's own art (communist, chaotic, orcish...) is in a map only where the map names that faction, whatever broader
        // setting it also carries: a human fortress never climbs orcish stairs.
        const factionless = stamp.tags.every((tag) => !FACTION_SETTINGS.includes(tag) || settings.includes(tag));
        const inSetting = (settings.length === 0 || stamp.tags.some((tag) => settings.includes(tag))) && factionless;
        // A stair joins floors only if it carries a transition.
        if (role === undefined || variant === undefined || !suitsScale(role, stamp.scale, mapScale) || (role === 'stairs' && stamp.transition === undefined)) {
            continue;
        }
        if (!inSetting && !BORROWED_ROLES.includes(role)) {
            continue;
        }
        const own = roleStampOf(stamp, role, variant, inSetting);
        const entry = drawn === stamp.defaultVariant ? own : { ...own, variant: drawn };
        // Seen from above: preferred where a role has any.
        if (seenFromAbove(stamp, variant)) {
            orthographic.add(stamp.key);
        }
        const part = partOf(role, stamp.tags);
        if (part !== undefined) {
            if (part === 'end') {
                ends.push(entry);
            } else if (inSetting) {
                apart.push(entry);
            }
            continue;
        }
        const into = inSetting ? index : borrowed;
        into.set(role, [...(into.get(role) ?? []), entry]);
    }
    // A section with an end piece of its kind stands capped at both ends, never with its cut ends bare.
    const withEnds = (entry: RoleStamp): RoleStamp => {
        const kind = kindOf(entry);
        const ofKind = (piece: RoleStamp): boolean => piece.role === entry.role && kindOf(piece).some((tag) => kind.includes(tag));
        const end = RUN_ROLES.includes(entry.role) ? ends.find(ofKind) : undefined;
        const parts = RUN_ROLES.includes(entry.role) ? apart.filter(ofKind) : [];
        const withParts = parts.length === 0 ? entry : { ...entry, parts };
        return end === undefined ? withParts : capped(withParts, end);
    };
    for (const into of [index, borrowed]) {
        for (const [role, list] of into) {
            into.set(role, list.map(withEnds));
        }
    }
    // Art drawn straight down is preferred within the map's settings and, apart, among what is borrowed; borrowed art comes
    // last, flagged, for whoever needs a way between levels the settings lack (`access.ts` takes the settings' own first).
    // Small pieces that vary one by one keep their isometric art too: it stands as drawn, never turned.
    const preferFlat = (role: StampRole, list: readonly RoleStamp[]): readonly RoleStamp[] => {
        const flat = list.filter((s) => orthographic.has(s.key));
        return flat.length > 0 && !MIXED_ROLES.includes(role) ? flat : list;
    };
    const roles = new Set([...index.keys(), ...borrowed.keys()]);
    return new Map(
        [...roles].map((role) => {
            const own = preferFlat(role, index.get(role) ?? []);
            const lent = preferFlat(role, borrowed.get(role) ?? []);
            return [role, role === 'stairs' || own.length === 0 ? [...own, ...lent] : own];
        }),
    );
}
