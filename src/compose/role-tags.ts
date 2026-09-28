// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a stamp is to the composer, read from its tags. No stamp is named
 * here: a pack's stamps carry descriptive tags (a cogitator console is
 * tagged `cogitator` and `console`), and these rules turn tags into a role,
 * how the role stands (against a wall, facing out, upright) and, for land,
 * the ground it belongs on. A new asset tagged `console` is composed as one
 * with no change here. A pack's own `role`, `placement` and `habitats`
 * still override what the tags say, for what tags cannot tell (which edge
 * of an image is a bed's head). Pure and unit-tested.
 */
import type { StampAnchor, StampBack, StampHabitat, StampPlacement, StampRole } from '../stamps/schema';

/**
 * Each role and the tags that make a stamp one, most specific first: the
 * first rule any of whose tags a stamp carries decides. So a `cogitator`
 * `desk` is a desk, a `shrine` `shelf` a shelf, and a `sandbag`
 * `emplacement` an emplacement rather than a barricade. A list in place of
 * a tag matches a stamp carrying every tag in it.
 */
const ROLE_RULES: readonly (readonly [StampRole, readonly (string | readonly string[])[]])[] = [
    ['stairs', ['stairs', 'staircase', 'ladder', 'lift', 'trapdoor', 'storm']],
    ['bridge', ['bridge']],
    ['well', ['well']],
    ['waymark', ['milestone', 'wayside', 'signpost']],
    // A bedroom's chest of drawers, wardrobe and washstand: before chest, as drawers are no trunk.
    ['dresser', ['dresser', 'wardrobe', 'drawers', 'washstand']],
    ['chest', ['chest', 'trunk', 'footlocker', 'strongbox']],
    ['enclosure', ['pen', 'corral', 'paddock', 'stable']],
    ['fodder', ['hay', 'straw', 'fodder']],
    // A desk lamp is a lamp, an interrogation chair a restraint: these come before what else they are tagged.
    // A bank of votive candles and a censer are a shrine's, not a room's lamps.
    ['icon', [['candle', 'bank'], 'censer']],
    ['light', ['brazier', 'candle', 'lantern', 'lamp']],
    ['restraint', ['restraint', 'interrogation']],
    ['desk', ['desk', 'workstation']],
    ['shelf', ['shelf', 'archive']],
    ['counter', ['counter', 'stall']],
    // An upholstered chair is an armchair before it is a seat.
    ['armchair', ['armchair', 'wingback', ['padded', 'chair'], ['easy', 'chair']]],
    ['seat', ['chair', 'stool']],
    ['bench', ['bench']],
    ['pew', ['pew']],
    // A kitchen's prep table and chopping block are worked at, not eaten at.
    ['workbench', ['prep', 'chopping', 'butcher']],
    // Table clutter (spilled drinks, scraps) lies on a table; it is not one.
    ['tabletop', [['table', 'clutter']]],
    ['table', ['table']],
    ['nightstand', ['nightstand', 'bedside']],
    ['bed', ['bed', 'bunk', 'cot']],
    ['hearth', ['hearth', 'cook']],
    ['workbench', ['workbench', 'forge']],
    ['console', ['cogitator', 'console', 'terminal', 'vox', 'astropathic', 'servitor']],
    ['machine', ['machine', 'press', 'hopper', 'reactor', 'vat', 'crusher', 'pump']],
    ['altar', ['altar', 'niche', 'shrine']],
    ['lectern', ['lectern']],
    ['icon', ['icon', 'board', 'keypad', 'beacon']],
    ['rack', ['rack', 'mannequin', 'armour', 'helmet']],
    ['medical', ['gurney', 'stretcher', 'iv', 'vitals']],
    ['emplacement', ['emplacement', 'sentry', 'stubber', 'gun']],
    ['barricade', ['barricade', 'sandbag', 'picket', 'palisade', 'hedgehogs', 'barrier']],
    ['crater', ['crater']],
    ['vehicle', ['freighter', 'shuttle', 'tug', 'yacht', 'hauler', 'loader', 'lighter', 'wagon', 'handcart']],
    [
        'structure',
        [
            'bunker',
            'tent',
            'tents',
            'bivouac',
            'silo',
            'tower',
            'watchtower',
            'watch',
            'smokestack',
            'crane',
            'transformer',
            'generator',
            'dump',
            'sensor',
            'mast',
            'slag',
        ],
    ],
    [
        'storage',
        // Not coffins or sarcophagi: they are a crypt's, never a storeroom's.
        [
            'crate',
            'crates',
            'barrel',
            'barrels',
            'locker',
            'wardrobe',
            'dresser',
            'cabinet',
            'sack',
            'sacks',
            'cache',
            'supply',
            'drums',
            'canister',
            'case',
            'luggage',
            'munitions',
        ],
    ],
    ['rug', ['rug', 'carpet']],
    ['tree', ['tree', 'copse']],
    ['shrub', ['bush', 'overgrowth']],
    ['log', ['log']],
    ['rock', ['boulder', 'rock', 'formation', 'stalagmites', 'stalactites', 'crystal', 'deposit']],
    ['flora', ['mushroom', 'roots', 'root']],
    ['debris', ['debris', 'wreckage', 'girders', 'shards', 'casings', 'splatter', 'cairn', 'bone', 'street']],
    [
        // What is set on a table, a bar or a desk: a meal, drink, papers. A pack's `tabletop` art says so outright.
        'tabletop',
        [
            'tabletop',
            'bottle',
            'bottles',
            'mug',
            'tankard',
            'teacup',
            'food',
            'meal',
            'platter',
            'tray',
            'pitcher',
            'drinkware',
            'bowl',
            'flask',
            'ration',
            'document',
            'parchment',
            'scroll',
            'ink',
            'writing',
            'calculator',
            'slate',
            'ashtray',
        ],
    ],
    ['clutter', ['clutter', 'kitchenware', 'pot', 'specimen', 'reagent', 'offering', 'reliquary', 'effects', 'potion', 'trash', 'bin']],
];

/** Roles a stamp can be stood on: a table, a bar, a desk, a bench to work at, an altar. */
const SURFACE_ROLES: readonly StampRole[] = ['table', 'counter', 'desk', 'workbench', 'altar'];

/** Whether a stamp of `role` is a surface other stamps can stand on. */
export const isSurfaceRole = (role: StampRole): boolean => SURFACE_ROLES.includes(role);

/** Whether a stamp tagged `tags` (or its pack's `role`) is a surface other stamps can stand on. */
export function isSurface(role: StampRole | null | undefined, tags: readonly string[]): boolean {
    const own = role === undefined ? roleFromTags(tags) : role;
    return own !== null && own !== undefined && isSurfaceRole(own);
}

/** How a role stands, unless its pack says otherwise. */
export interface RolePlacement {
    readonly against: StampAnchor;
    /** Squares of open floor kept before it. */
    readonly clearance: number;
    /** The image edge that is its back; for a defence, the side away from the enemy. */
    readonly back: StampBack;
    /** Drawn side-on, never turned. */
    readonly upright: boolean;
}

const FREE: RolePlacement = { against: 'free', clearance: 0, back: 'top', upright: false };
const WALL: RolePlacement = { ...FREE, against: 'wall' };
const WORKED: RolePlacement = { ...WALL, clearance: 1 };
/** Defences are drawn front up: their back, away from the enemy, is the image's bottom. */
const DEFENCE: RolePlacement = { ...FREE, back: 'bottom' };

const ROLE_PLACEMENT: Readonly<Record<StampRole, RolePlacement>> = {
    tree: FREE,
    shrub: FREE,
    rock: FREE,
    log: FREE,
    flora: FREE,
    debris: FREE,
    table: FREE,
    seat: FREE,
    bench: FREE,
    counter: WORKED,
    hearth: WORKED,
    shelf: WALL,
    bed: WALL,
    storage: { ...FREE, against: 'corner' },
    clutter: FREE,
    rug: FREE,
    desk: WORKED,
    workbench: WORKED,
    light: WALL,
    machine: FREE,
    console: WORKED,
    altar: { ...WALL, clearance: 1.5 },
    pew: FREE,
    lectern: WORKED,
    icon: WALL,
    rack: WALL,
    medical: WALL,
    restraint: FREE,
    // Towers, silos and tents are drawn side-on; one seen from above loses nothing by standing square.
    structure: { ...FREE, upright: true },
    barricade: DEFENCE,
    crater: FREE,
    emplacement: DEFENCE,
    vehicle: FREE,
    stairs: FREE,
    tabletop: FREE,
    nightstand: WALL,
    well: FREE,
    bridge: FREE,
    waymark: FREE,
    chest: FREE,
    enclosure: FREE,
    fodder: FREE,
    dresser: WALL,
    armchair: { ...FREE, against: 'corner' },
};

/** Tags that say which ground land belongs on. */
const HABITAT_RULES: readonly (readonly [StampHabitat, readonly string[]])[] = [
    ['cave', ['cave', 'stalagmites', 'stalactites', 'crystal', 'mineral']],
    ['arctic', ['ice', 'frost', 'snow']],
    ['forest', ['forest', 'woodland', 'jungle']],
    ['marsh', ['mire', 'marsh', 'swamp']],
    ['desert', ['desert', 'sand', 'dune']],
    ['ruin', ['bone', 'cairn', 'crypt', 'dungeon', 'ruin', 'ruined']],
    ['urban', ['street', 'metal', 'girders', 'cable', 'wreckage', 'casings', 'shards', 'splatter']],
];

/** Where each kind of land belongs when its tags say nothing of ground: a plain boulder lies on any open ground. */
const LAND_HABITATS: Partial<Readonly<Record<StampRole, readonly StampHabitat[]>>> = {
    tree: ['forest', 'grassland'],
    shrub: ['forest', 'grassland', 'marsh'],
    rock: ['forest', 'grassland', 'rocky', 'desert', 'ruin'],
    log: ['forest'],
    flora: ['forest', 'grassland', 'marsh'],
    debris: ['urban', 'ruin'],
};

/** Tags of what is set by the GM, never scattered by the composer: a trap is placed where it is meant to catch someone. */
const NEVER_COMPOSED = ['trap'];

/** The role `tags` make a stamp, or undefined when none does (it is placed by hand only). */
export function roleFromTags(tags: readonly string[]): StampRole | undefined {
    if (tags.some((tag) => NEVER_COMPOSED.includes(tag))) {
        return undefined;
    }
    const carries = (tag: string | readonly string[]): boolean => (typeof tag === 'string' ? tags.includes(tag) : tag.every((t) => tags.includes(t)));
    return ROLE_RULES.find(([, any]) => any.some(carries))?.[0];
}

/** Roles that furnish a room, which take only stamps drawn at interior scale. */
const INDOOR_ROLES: readonly StampRole[] = [
    'table',
    'seat',
    'bench',
    'counter',
    'hearth',
    'shelf',
    'bed',
    'rug',
    'desk',
    'workbench',
    'light',
    'machine',
    'console',
    'altar',
    'pew',
    'lectern',
    'icon',
    'rack',
    'medical',
    'restraint',
    'tabletop',
    'nightstand',
    'dresser',
    'armchair',
];

/** Roles that stand outdoors, which take only stamps drawn at exterior scale. */
const OUTDOOR_ROLES: readonly StampRole[] = ['structure', 'barricade', 'crater', 'emplacement', 'vehicle', 'well', 'bridge', 'waymark', 'enclosure', 'fodder'];

/**
 * Whether a stamp drawn at `scale` can fill `role`: a room's altar is an
 * interior altar, not a wayside shrine; a yard's structure is a building-sized
 * work, not an indoor gantry. Land, storage, clutter and the ways between
 * levels (a stair indoors, storm doors outside) serve either.
 */
export function suitsScale(role: StampRole, scale: string): boolean {
    if (INDOOR_ROLES.includes(role)) {
        return scale === 'interior';
    }
    return !OUTDOOR_ROLES.includes(role) || scale === 'exterior';
}

/** How a stamp of `role` stands: the role's way, as its tags adjust it, with whatever the pack says of this image over that. */
/** Tags that stand a piece otherwise than its role does: storage is crates in corners, but a locker stands against a wall. */
const TAG_PLACEMENT: readonly (readonly [StampRole, readonly string[], Partial<RolePlacement>])[] = [
    ['storage', ['locker', 'cabinet', 'case'], { against: 'wall' }],
];

export function placementOf(role: StampRole, tags: readonly string[], own: StampPlacement | undefined): RolePlacement {
    const tagged = TAG_PLACEMENT.find(([r, any]) => r === role && any.some((tag) => tags.includes(tag)))?.[2];
    const usual = { ...ROLE_PLACEMENT[role], ...tagged };
    return {
        against: own?.against ?? usual.against,
        clearance: own?.clearance ?? usual.clearance,
        back: own?.back ?? usual.back,
        upright: own?.upright ?? usual.upright,
    };
}

/** The ground a land stamp belongs on: the pack's word, else its tags', else its role's; none for what is not land. */
export function habitatsOf(role: StampRole, tags: readonly string[], own: readonly StampHabitat[]): readonly StampHabitat[] {
    const land = LAND_HABITATS[role];
    if (!land) {
        return [];
    }
    if (own.length > 0) {
        return own;
    }
    const tagged = HABITAT_RULES.filter(([, any]) => any.some((tag) => tags.includes(tag))).map(([habitat]) => habitat);
    return tagged.length > 0 ? tagged : land;
}
