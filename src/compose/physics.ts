// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * How a stamp stands in the scene's physics, read from its role and tags as
 * its role is: what it hides, what it bars, the cover it gives and what it
 * costs to cross. Foundry draws every token's line of sight from walls, so a
 * tall archive shelf or a machine is walled round, blocking sight, light and
 * movement; a table or a pew is low, seen over, crossed at a cost and taken
 * as cover; a barricade is seen over but not crossed; a railing bars the way
 * and hides nothing; rubble is hard going. No stamp is named here, and a
 * pack's own `physical`, `occlusion` and `terrain` win over all of it (see
 * `behaviourOf`). Pure and unit-tested.
 */
import type { HazardKind, StampHazard, StampOcclusion, StampPhysical, StampRole, StampTerrain, StampTile } from '../stamps/schema';

/** What a stamp's role and tags make of it physically; each part absent where they say nothing. */
export interface DerivedPhysics {
    readonly physical?: StampPhysical;
    readonly occlusion?: StampOcclusion;
    readonly terrain?: StampTerrain;
    readonly hazard?: StampHazard;
    /** How its tile gives way to a token beneath it: a roof fades, a tree's crown cuts away round it. */
    readonly tile?: StampTile;
    /** Holds things, as an Item Piles container: a chest, a footlocker, a locker. */
    readonly container?: true;
}

/**
 * Tags of storage or a fitting that holds things to be found (a crate, a
 * locker, a cabinet); a chest's every piece does. Barrels and sacks hold
 * goods in bulk, not loot, and stay scenery.
 */
const CONTAINER_TAGS: readonly string[] = ['chest', 'trunk', 'footlocker', 'strongbox', 'coffer', 'crate', 'crates', 'locker', 'cabinet', 'reliquary'];

/** Whether a stamp of `role` tagged `tags` holds things. */
const holds = (role: StampRole, tags: readonly string[]): boolean =>
    role === 'chest' || ((role === 'storage' || role === 'fitting') && tags.some((tag) => CONTAINER_TAGS.includes(tag)));

/** Grid squares an overhead piece hangs above its base: over a standing figure, so a token beneath is under it. */
const OVERHEAD = 3;

/** Tags of a roof over the ground (a tent's, a shed's), a canopy or an awning: it fades over a token beneath and keeps the weather off. */
const ROOF_TAGS: readonly string[] = ['roof', 'canopy', 'awning', 'tarp'];

/** How much of an overhead tile still shows while a token is beneath it. */
const SHOWS_BENEATH = 0.25;

/** An overhead piece that gives way to a token beneath it: a roof fades and keeps the weather off; a tree's crown cuts away round it. */
function overheadOf(role: StampRole, tags: readonly string[]): DerivedPhysics {
    if (tags.some((tag) => ROOF_TAGS.includes(tag))) {
        return { physical: { height: OVERHEAD }, tile: { occlusion: { modes: ['fade'], alpha: SHOWS_BENEATH }, restrictions: { weather: true } } };
    }
    if (role === 'tree') {
        return { physical: { height: OVERHEAD }, tile: { occlusion: { modes: ['radial'], alpha: SHOWS_BENEATH } } };
    }
    return {};
}

/**
 * Tags that make a stamp a hazard, most particular first: an open fire, a
 * spill of acid, toxic sludge, a live reactor, a live cable, an open pit. A
 * brazier or a lamp is fire kept in check, and harms nothing.
 */
const HAZARD_TAGS: readonly (readonly [HazardKind, readonly string[]])[] = [
    ['fire', ['fire', 'flames', 'burning', 'bonfire', 'pyre', 'furnace', 'campfire']],
    ['acid', ['acid']],
    ['toxic', ['toxic', 'sludge', 'sewage']],
    ['radiation', ['reactor', 'radiation', 'irradiated']],
    ['electric', ['arcing', 'sparking', 'electrified']],
    ['fall', ['pit', 'chasm', 'sinkhole']],
];

/** Roles whose art is a flat mark or a thing set down, never a danger however it is tagged (a scorch mark, a candle). */
const HARMLESS_ROLES: readonly StampRole[] = ['decal', 'rug', 'tabletop', 'light', 'icon', 'clutter'];

/** Squares past its footprint a hazard reaches: close enough to be burned, splashed or to fall. */
const HAZARD_REACH = 0.5;

/** The hazard a stamp of `role` tagged `tags` is, or nothing. */
function hazardOf(role: StampRole, tags: readonly string[]): StampHazard | undefined {
    if (HARMLESS_ROLES.includes(role)) {
        return undefined;
    }
    const kind = HAZARD_TAGS.find(([, words]) => words.some((word) => tags.includes(word)))?.[0];
    return kind === undefined ? undefined : { kind, reach: HAZARD_REACH };
}

/** Grid squares tall: over a standing figure's eyes, and a surface as the stacking takes one (a table's top). */
const TALL = 2;
const LOW = 0.5;

/** Foundry's movement cost multiplier for crossing low furniture or rubble: twice the going. */
const HARD_GOING: StampTerrain = { difficulty: { walk: 2 } };

/** Cover as the schema grades it: half behind furniture, three-quarter behind a defence, full behind a solid body. */
const COVER = { half: 0.5, heavy: 0.75, full: 1 } as const;

/**
 * Walls round the footprint that hide what is behind it and bar the way: a
 * solid body. Foundry's terrain walls (sight and light limited): a token sees
 * through the one nearest it, so it sees the piece itself, but never through
 * both sides, so nothing behind it shows. Solid walls hid the piece too
 * (operator, 2026-10-01). Sound carries round furniture.
 */
// Traced round the art's own outline (`alpha`), never a box round the footprint (operator, 2026-10-02).
const SOLID: StampOcclusion = { shape: 'alpha', sight: 'limited', movement: true, light: 'limited', sound: false };

/** Walls round the footprint that bar the way but hide nothing: a railing, a fence, a barricade seen over. */
const BARRIER: StampOcclusion = { shape: 'alpha', sight: false, movement: true, light: false, sound: false };

/** Roles whose every stamp is a solid body taller than a figure. */
const TALL_ROLES: readonly StampRole[] = ['shelf', 'rack', 'dresser', 'machine', 'structure', 'vehicle'];

/** Roles of low furniture: seen over, crossed at a cost, taken as cover. */
const LOW_ROLES: readonly StampRole[] = [
    'table',
    'desk',
    'counter',
    'bench',
    'pew',
    'workbench',
    'bed',
    'chest',
    'altar',
    'console',
    'medical',
    'storage',
    'nightstand',
    'lectern',
    'restraint',
];

/** Roles of defences: seen over, never crossed, heavy cover. */
const DEFENCE_ROLES: readonly StampRole[] = ['barricade', 'emplacement'];

/** Roles of ground that is hard going: rubble, fallen timber. */
const ROUGH_ROLES: readonly StampRole[] = ['debris', 'log'];

/** Tags that make a low role's stamp (a locker among storage, a terminal stack among consoles) or a fitting a solid body. */
const TALL_TAGS: readonly string[] = [
    'locker',
    'cabinet',
    'wardrobe',
    'column',
    'pillar',
    'statue',
    'obelisk',
    'pylon',
    'stack',
    'generator',
    'drive',
    'reactor',
    'tank',
    'silo',
];

/** Tags that make a stamp a barrier that hides nothing (a railing, a fence, a grille). */
const SEE_THROUGH_TAGS: readonly string[] = ['railing', 'railings', 'stanchion', 'fence', 'grille', 'balustrade'];

const solid: DerivedPhysics = { physical: { height: TALL, cover: COVER.full, blocksMovement: true }, occlusion: SOLID };
const low: DerivedPhysics = { physical: { height: LOW, cover: COVER.half }, terrain: HARD_GOING };

/** What a stamp of `role` tagged `tags` is physically, and the harm it does; nothing for a piece that neither hides, bars, slows nor harms. */
export function physicsOf(role: StampRole | undefined, tags: readonly string[]): DerivedPhysics {
    if (role === undefined) {
        return {};
    }
    const hazard = hazardOf(role, tags);
    const over = overheadOf(role, tags);
    // An overhead piece is its own body: a roof or a crown hangs over the floor, hiding and barring nothing below it.
    const body = over.tile === undefined ? bodyOf(role, tags) : over;
    return {
        ...body,
        ...(hazard === undefined ? {} : { hazard }),
        ...(holds(role, tags) ? { container: true as const } : {}),
    };
}

/** What a stamp of `role` tagged `tags` hides, bars and slows. */
function bodyOf(role: StampRole, tags: readonly string[]): DerivedPhysics {
    const carries = (list: readonly string[]): boolean => tags.some((tag) => list.includes(tag));
    if (carries(SEE_THROUGH_TAGS)) {
        return { physical: { height: LOW, blocksMovement: true }, occlusion: BARRIER };
    }
    if (TALL_ROLES.includes(role) || ((LOW_ROLES.includes(role) || role === 'fitting') && carries(TALL_TAGS))) {
        return solid;
    }
    if (DEFENCE_ROLES.includes(role)) {
        return { physical: { height: LOW * 2, cover: COVER.heavy, blocksMovement: true }, occlusion: BARRIER };
    }
    if (LOW_ROLES.includes(role)) {
        return low;
    }
    if (ROUGH_ROLES.includes(role)) {
        return { physical: { height: LOW, cover: COVER.half }, terrain: HARD_GOING };
    }
    return {};
}
