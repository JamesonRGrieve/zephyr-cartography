// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Named pieces: what an intent names outright (a room's fixture, a flight of
 * steps outside) is drawn in art of its role carrying one of its tags, the
 * same art wherever a piece of that name stands, fitted to the size asked;
 * where no art draws it, a labelled box its size. Pure.
 */
import { OPPOSITE_SIDE, type Side } from '../generate/floor-plan';
import type { StampRole } from '../stamps/schema';
import { isPlaceholder, placeholder } from './placeholders';
import { drawnAs, partsOf, type RoleIndex, type RoleStamp, type RunEnd } from './roles';

/** What a named piece asks for. */
export interface NamedPiece {
    readonly name: string;
    readonly role?: StampRole | undefined;
    readonly tags: readonly string[];
    readonly width: number;
    readonly height: number;
    /** What players read on it by hovering over it (a sign's words). */
    readonly reads?: string | undefined;
    /** The words of the variant state its art is drawn in (a locker `ajar`); omitted, as drawn. */
    readonly state?: string | undefined;
    /** Which way its front faces; omitted, down. */
    readonly facing?: Side;
    /** The ends of its run (map sides) left without their end pieces, butting against another run. */
    readonly open?: readonly Side[];
}

/** The side of the map a run's start (its left end, as drawn) lies on, facing each way. */
const START_SIDE: Readonly<Record<Side, Side>> = { bottom: 'left', left: 'top', top: 'right', right: 'bottom' };

/** Which of a run's ends, facing `facing`, lie on the map `sides` given. */
export function runEnds(facing: Side, sides: readonly Side[]): RunEnd[] {
    const start = START_SIDE[facing];
    return [...(sides.includes(start) ? ['start' as const] : []), ...(sides.includes(OPPOSITE_SIDE[start]) ? ['end' as const] : [])];
}

/** `stamp` carrying what `piece` reads, if anything. */
const reading = (stamp: RoleStamp, piece: NamedPiece): RoleStamp => (piece.reads === undefined ? stamp : { ...stamp, reads: piece.reads });

/** Whether `art` (or, for a run, its modules) has a variant whose state holds `words`, drawn as its own is. */
function hasState(art: RoleStamp, words: string): boolean {
    const unit = art.run?.module ?? art;
    const lower = words.toLowerCase();
    return (unit.states ?? []).some((state, i) => unit.sizes?.[i] !== null && state.toLowerCase().includes(lower));
}

/**
 * `art` drawn in the variant whose state holds `words` (a locker `ajar`), the
 * sharpest of several (one picture drawn at 128 pixels and again at 512), the
 * first of equals, of those drawn as its own is (never a side-on picture
 * among plans), sized as that picture is at the art's scale; a run's modules
 * with it and its ends refitted to their depth; as it is where none does.
 */
export function inState(art: RoleStamp, words: string | undefined): RoleStamp {
    if (words === undefined) {
        return art;
    }
    if (art.run !== undefined) {
        const unit = inState(art.run.module, words);
        const cap = art.run.cap === undefined ? undefined : depthOf(inState(art.run.cap, words), unit.height);
        const run = { ...art.run, module: unit, ...(cap === undefined ? {} : { cap }) };
        return { ...art, width: runLength(run), height: unit.height, run };
    }
    const sharpness = (i: number): number => art.sharpness?.[i] ?? 0;
    const variant = (art.states ?? []).reduce(
        (best, state, i) =>
            art.sizes?.[i] !== null && state.toLowerCase().includes(words.toLowerCase()) && (best < 0 || sharpness(i) > sharpness(best)) ? i : best,
        -1,
    );
    const size = art.sizes?.[variant];
    if (variant < 0) {
        return art;
    }
    const scale = art.scale ?? 1;
    return size ? { ...art, variant, width: size.width * scale, height: size.height * scale } : { ...art, variant };
}

/** The role a named piece stands as when it names none: a free-standing piece of plant. */
const UNNAMED_ROLE: StampRole = 'machine';

/** FNV-1a's 32-bit offset basis and prime. */
const FNV = { offset: 0x811c9dc5, prime: 0x01000193 } as const;

/** A whole number from a name, the same for the same name (FNV-1a). */
function nameHash(label: string): number {
    let hash = FNV.offset;
    for (const char of label) {
        hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), FNV.prime) >>> 0;
    }
    return hash;
}

/**
 * `stamp` scaled evenly to the largest size that fits `width` by `height`
 * squares, its back along the width; isometric art, which is never
 * turned, fits the box whichever way round lets it stand larger (a gurney
 * drawn lying across still fits a gurney's size).
 */
export function fittedTo(stamp: RoleStamp, width: number, height: number): RoleStamp {
    const scaleToFit = (w: number, h: number): number => Math.min(w / stamp.width, h / stamp.height);
    const scale = stamp.upright ? Math.max(scaleToFit(width, height), scaleToFit(height, width)) : scaleToFit(width, height);
    return scaledBy(stamp, scale);
}

/** `stamp` drawn `scale` times its size, a run's modules and end pieces with it. */
function scaledBy(stamp: RoleStamp, scale: number): RoleStamp {
    const scaled = { ...stamp, width: stamp.width * scale, height: stamp.height * scale, scale: (stamp.scale ?? 1) * scale };
    if (stamp.run === undefined) {
        return scaled;
    }
    const { module: unit, cap } = stamp.run;
    return { ...scaled, run: { ...stamp.run, module: scaledBy(unit, scale), ...(cap === undefined ? {} : { cap: scaledBy(cap, scale) }) } };
}

/**
 * The art that draws `piece` from `pool`, fitted to its size: of its role,
 * carrying one of its tags (any, when it names none), chosen by its name,
 * never by chance, so a piece of one name is the same wherever it stands;
 * undefined where none does, or it names no role. A piece of a modular role
 * is drawn as whichever reaches further along its length, one piece of its
 * art or a run of it (a hall's table four squares long is a run of trestles,
 * never one two-square table).
 */
export function namedArt(piece: NamedPiece, pool: RoleIndex): RoleStamp | undefined {
    const { role, tags } = piece;
    // How much of the footprint asked a piece of art covers, fitted to it.
    const cover = (s: RoleStamp): number => {
        const fitted = fittedTo(s, piece.width, piece.height);
        return (fitted.width * fitted.height) / (piece.width * piece.height);
    };
    // A piece asking for a run's part by its tag (a counter's gate) is drawn in that part, which no list offers otherwise.
    const partAsked = tags.filter((tag) => PART_TAGS.includes(tag));
    // Each in the state asked (an open door, a lit lamp), sized as that picture is, before it is fitted or run.
    const asked = (
        role === undefined
            ? []
            : partAsked.length > 0
            ? // Only that part will do; the piece's other tags (riveted, brass) then say which of them.
              preferring(
                  partsOf(pool, role).filter((s) => partAsked.some((tag) => s.tags.includes(tag))),
                  tags.filter((tag) => !partAsked.includes(tag)),
              )
            : (pool.get(role) ?? []).filter((s) => !isPlaceholder(s.key) && (tags.length === 0 || tags.some((tag) => s.tags.includes(tag))))
    ).map((s) => inState(s, piece.state));
    // A state names a picture (a "large farmhouse with outbuildings"): the art that has one in that state is the art meant,
    // before art of the same tags that draws no such thing (another set's farmhouse, drawn another way).
    const { state } = piece;
    const stated = state === undefined ? [] : asked.filter((s) => hasState(s, state));
    const statedOrAsked = stated.length > 0 ? stated : asked;
    // Of that, the art carrying the most of the tags asked that fills the piece: a "grimdark undead stone bench" is the tomb's
    // stone bench, before an oak bench that shares only "bench" (and would otherwise win by running further along the
    // piece). Where none of the closest fills it, the next closest, and so on: a rug asked for as "runner" still lies.
    const sharedTags = (s: RoleStamp): number => tags.filter((tag) => s.tags.includes(tag)).length;
    // A named piece stands exactly where asked, facing the way asked: art seen from above, which turns, before isometric art
    // (a chest against a side wall cannot be drawn in art that will not turn to face out from it).
    const turnable = statedOrAsked.filter((s) => !s.upright);
    const facingFree = turnable.length > 0 ? turnable : statedOrAsked;
    const tiers = [...new Set(facingFree.map(sharedTags))].sort((a, b) => b - a);
    const tierOf = (n: number): readonly RoleStamp[] => facingFree.filter((s) => sharedTags(s) === n);
    const fillingTier = tiers.find((n) => tierOf(n).some((s) => cover(s) >= NAMED_FILL));
    const tagged = fillingTier === undefined ? facingFree : tierOf(fillingTier);
    // Chosen by its name: of the art whose tags share most words with it (a rooftop access hatch is the roof's hatch, not its
    // vent stack), one picked by the name's hash, the same wherever a piece of that name stands.
    const words = nameWords(piece.name);
    const byName = (list: readonly RoleStamp[]): RoleStamp | undefined => {
        const shared = (s: RoleStamp): number => s.tags.filter((tag) => words.has(tag)).length;
        const most = Math.max(0, ...list.map(shared));
        const best = list.filter((s) => shared(s) === most);
        return best[nameHash(piece.name) % Math.max(1, best.length)];
    };
    // Of the art that fills enough of it, that nearly as close to its shape as the closest (a long desk is no round table).
    const filling = tagged.filter((s) => cover(s) >= NAMED_FILL);
    const closest = Math.max(0, ...filling.map(cover));
    const chosen = byName(filling.filter((s) => cover(s) >= CLOSE_FIT * closest));
    const whole = chosen && fittedTo(chosen, piece.width, piece.height);
    // Longer than one piece of its art reaches: a run of modules side by side, where its role is built of them.
    const openEnds = runEnds(piece.facing ?? 'bottom', piece.open ?? []);
    const runs =
        role !== undefined && MODULAR_ROLES.includes(role)
            ? tagged.filter((s) => joins(s)).flatMap((s) => runOf(s, piece.width, piece.height, openEnds) ?? [])
            : [];
    // Art made to join (a section between its end pieces, a module with square ends) beats repeating a piece made to stand alone.
    const made = runs.filter(joinsByDesign);
    const run = byName(made.length > 0 ? made : runs);
    // A piece with an open end butts against another run: only a run leaves an end open. A fitting is one thing (an eagle emblem,
    // a hatch): a run of it only where no one piece of its art fills what is asked (a length of pipe).
    const longer = whole === undefined || (role !== 'fitting' && reach(run ?? whole) > reach(whole));
    const drawn = run !== undefined && (openEnds.length > 0 || longer) ? run : whole;
    return drawn && reading(drawn, piece);
}

/** The words of a piece's name as tags spell them: lower case, each also without a plural `s` (`cabinets` is a `cabinet`). */
function nameWords(called: string): ReadonlySet<string> {
    const words = called
        .toLowerCase()
        .split(/[^a-z]+/u)
        .filter((word) => word.length > 0);
    return new Set(words.flatMap((word) => (word.endsWith('s') ? [word, word.slice(0, -1)] : [word])));
}

/** How much longer than deep a table's art must be to join others end to end: round tables never make one board. */
const JOINING_TABLE_ASPECT = 1.5;

/** Whether pieces of `stamp` join into a run: any module of its role, but only a long table's boards. */
const joins = (stamp: RoleStamp): boolean =>
    stamp.role !== 'table' || Math.max(stamp.width, stamp.height) >= JOINING_TABLE_ASPECT * Math.min(stamp.width, stamp.height);

/** Those of `pieces` carrying one of `tags`, where any does; else all of them. */
const preferring = (pieces: readonly RoleStamp[], tags: readonly string[]): readonly RoleStamp[] => {
    const tagged = pieces.filter((s) => tags.some((tag) => s.tags.includes(tag)));
    return tagged.length > 0 ? tagged : pieces;
};

/** Tags naming a run's part a named piece may ask for: a counter's gate, or its corner. */
const PART_TAGS: readonly string[] = ['counter-gate', 'counter-corner'];

/** Tags a pack gives a piece drawn to be set end to end with others. */
const MODULE_TAGS: readonly string[] = ['module', 'section', 'segment', 'counter-segment'];

/** Whether a run is of art made to join: capped by its end pieces, or modules drawn with square ends. */
const joinsByDesign = (run: RoleStamp): boolean =>
    run.run !== undefined && (run.run.cap !== undefined || run.run.module.tags.some((tag) => MODULE_TAGS.includes(tag)));

/** How far along its width a piece's art reaches: a run's modules end to end, else the piece. */
const reach = (stamp: RoleStamp): number => (stamp.run === undefined ? stamp.width : runLength(stamp.run));

/** How long a run is end to end: its modules, and the end pieces of its ends not left open. */
const runLength = (run: NonNullable<RoleStamp['run']>): number => run.count * run.module.width + capsOf(run.open) * (run.cap?.width ?? 0);

/** How many of a run's two ends take an end piece, those in `openEnds` left without. */
const capsOf = (openEnds: readonly RunEnd[] = []): number => RUN_ENDS - openEnds.length;

/** A run's ends: its start and its end. */
const RUN_ENDS = 2;

/**
 * Roles built of modules set side by side: a wall of shelving units, a row of
 * lockers, a bank of terminals, a line of pews, a hall's trestle tables
 * pushed end to end into one long board; a fitting's length of pipe, cable,
 * kerb or railing laid along a wall.
 */
const MODULAR_ROLES: readonly StampRole[] = ['shelf', 'bench', 'pew', 'rack', 'storage', 'console', 'table', 'counter', 'fitting'];

/**
 * `stamp` as modules `height` deep side by side along `width`, as many as
 * fit (at least two), or, where its pack draws its ends, as many sections as
 * fit between its two end pieces (at least one), none at its `openEnds`;
 * undefined where they do not.
 */
export function runOf(given: RoleStamp, width: number, height: number, openEnds: readonly RunEnd[] = []): RoleStamp | undefined {
    // A piece already capped at its ends is run from its section, between the same ends.
    const stamp = given.run?.module ?? given;
    const cap = given.run?.cap;
    // Isometric seating, shrunk to a run's depth, reads as a scatter of tiny seats, not one bench: only flat segments run.
    if (cap === undefined && stamp.upright && SEATING_RUNS.includes(stamp.role)) {
        return undefined;
    }
    // Art whose length runs back from its front (a partition drawn lying down the image) is no module to set side by side:
    // shrunk to a run's depth it is a row of slivers.
    if (stamp.height > DEEPEST_MODULE * stamp.width) {
        return undefined;
    }
    const [section, end] = [depthOf(stamp, height), cap === undefined ? undefined : depthOf(cap, height)];
    const ends = capsOf(openEnds) * (end?.width ?? 0);
    // As many modules as reach the length asked, the run then shrunk evenly to end exactly there (never deeper than asked);
    // a run that would shrink too far takes one module fewer and falls short instead.
    const reaching = Math.max(1, Math.ceil((width - ends - RUN_EPSILON) / section.width));
    const fits = (modules: number): number => width / (modules * section.width + ends);
    const count = fits(reaching) >= MIN_RUN_SHRINK ? reaching : reaching - 1;
    const shrink = Math.min(1, fits(count));
    if (count < (cap === undefined ? 2 : 1)) {
        return undefined;
    }
    const unit = depthOf(section, section.height * shrink);
    const capped = end === undefined ? {} : { cap: depthOf(end, end.height * shrink), ...(openEnds.length > 0 ? { open: openEnds } : {}) };
    const run = { count, module: unit, ...capped };
    return { ...given, width: runLength(run), height: unit.height, run };
}

/** How many times deeper than wide a module may be drawn and still be set side by side in a run. */
const DEEPEST_MODULE = 2;

/** The least a run is shrunk evenly to end exactly at the length asked; any further and it takes a module fewer. */
const MIN_RUN_SHRINK = 0.75;

/** Runs that are sat on: their modules must be flat segments that join into one bench. */
const SEATING_RUNS: readonly StampRole[] = ['bench', 'pew'];

/** `stamp` drawn `depth` deep, its proportions kept. */
function depthOf(stamp: RoleStamp, depth: number): RoleStamp {
    const scale = depth / stamp.height;
    return { ...stamp, width: stamp.width * scale, height: depth, scale: (stamp.scale ?? 1) * scale };
}

/** Slack in counting modules, so a run asked exactly so many modules long takes them all. */
const RUN_EPSILON = 1e-9;

/** A piece of art as it stands on the map: its stamp, its centre, its turn, and the multiple of its size it is drawn at. */
export interface PlacedPiece {
    readonly stamp: string;
    readonly x: number;
    readonly y: number;
    readonly rotation: number;
    /** A multiple of the art's own size it is drawn at; omitted, as authored. */
    readonly scale?: number;
    /** What players read on it by hovering over it; omitted, nothing. */
    readonly reads?: string;
    /** Drawn flipped left to right (a run's far end cap); omitted, as drawn. */
    readonly mirror?: true;
    /** The variant of its art it is drawn in; omitted, its default. */
    readonly variant?: number;
}

/** Degrees in a full turn. */
const FULL_TURN = 360;

/**
 * What stands for `piece` centred at `at`, turned `rotation` degrees (its
 * art's own turn added): the piece itself, or a run's modules side by side
 * along its width, however it is turned.
 */
export function standsAs(piece: RoleStamp, at: { readonly x: number; readonly y: number }, rotation: number): PlacedPiece[] {
    const one = (art: RoleStamp, x: number, y: number, reads: string | undefined, mirror = false): PlacedPiece => ({
        ...drawnAs(art),
        x,
        y,
        rotation: (rotation + art.turn) % FULL_TURN,
        ...(art.scale === undefined ? {} : { scale: art.scale }),
        ...(reads === undefined ? {} : { reads }),
        ...(mirror ? { mirror: true as const } : {}),
    });
    if (piece.run === undefined) {
        return [one(piece, at.x, at.y, piece.reads)];
    }
    const { count, module: unit, cap, open: openEnds = [] } = piece.run;
    // A run is read at its middle module.
    const middle = Math.floor((count - 1) / 2);
    const radians = (rotation * Math.PI) / (FULL_TURN / 2);
    const [dx, dy] = [Math.round(Math.cos(radians) * UNIT_ROUNDING) / UNIT_ROUNDING, Math.round(Math.sin(radians) * UNIT_ROUNDING) / UNIT_ROUNDING];
    // Laid from its start, end to end, the whole run centred on `at`.
    const start = -runLength(piece.run) / 2;
    const along = (offset: number): { x: number; y: number } => ({ x: at.x + dx * (start + offset), y: at.y + dy * (start + offset) });
    const [capWidth, first] = [cap?.width ?? 0, cap === undefined || openEnds.includes('start') ? 0 : cap.width];
    const sections = Array.from({ length: count }, (_, i) => {
        const { x, y } = along(first + (i + 1 / 2) * unit.width);
        return one(unit, x, y, i === middle ? piece.reads : undefined);
    });
    if (cap === undefined) {
        return sections;
    }
    // Its end pieces, each finishing its own end: drawn capping the right-hand end, so mirrored at the left.
    const [left, right] = [along(capWidth / 2), along(first + count * unit.width + capWidth / 2)];
    return [
        ...(openEnds.includes('start') ? [] : [one(cap, left.x, left.y, undefined, true)]),
        ...sections,
        ...(openEnds.includes('end') ? [] : [one(cap, right.x, right.y, undefined)]),
    ];
}

/** Rounds a turn's sine and cosine, so a quarter turn's are exactly 0 and 1. */
const UNIT_ROUNDING = 1e9;

/**
 * The least share of a named piece's asked footprint its art must cover: art
 * of another shape (a two-square counter asked to run five) would misdraw the
 * plan, so the piece's labelled box stands in until art of its shape exists.
 */
const NAMED_FILL = 0.5;

/** Of the art filling a named piece, the share of the closest fit's cover the art chosen from must reach. */
const CLOSE_FIT = 0.85;

/** The turn that faces a free-standing piece's front (the image's bottom, its back up) the `facing` way. */
export const FACING_TURN: Readonly<Record<Side, number>> = { bottom: 0, left: 90, top: 180, right: 270 };

/** The labelled box `piece` stands as where no art draws it. */
export const namedBox = (piece: NamedPiece): RoleStamp => reading(placeholder(piece.role ?? UNNAMED_ROLE, piece.name, piece.width, piece.height), piece);

/**
 * A named piece standing where asked (`at`, in map squares), faced as asked:
 * the stamps drawing it, the art (or labelled box) they are of, and whether
 * it is a box for want of art. Isometric art stands as drawn.
 */
export function standingAt(
    fixture: NamedPiece & { readonly at: { readonly x: number; readonly y: number }; readonly facing: Side },
    stamps: RoleIndex,
): { placed: PlacedPiece[]; piece: RoleStamp; boxed: boolean } {
    const art = namedArt(fixture, stamps);
    const piece = art ?? namedBox(fixture);
    const turn = piece.upright ? 0 : FACING_TURN[fixture.facing];
    return { placed: standsAs(piece, fixture.at, turn), piece, boxed: art === undefined };
}
