// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a stamp is to the composer, read from its tags. No stamp is named
 * here: a pack's stamps carry descriptive tags (a terminal console is
 * tagged `terminal` and `console`), and these rules turn tags into a role,
 * how the role stands (against a wall, facing out, upright) and, for land,
 * the ground it belongs on. A new asset tagged `console` is composed as one
 * with no change here. A pack's own `role`, `placement` and `habitats`
 * still override what the tags say, for what tags cannot tell (which edge
 * of an image is a bed's head). Pure and unit-tested.
 */
import type { StampAnchor, StampBack, StampHabitat, StampPlacement, StampRole } from '../stamps/schema';
import type { MapScale } from './intent';

/**
 * Each role and the tags that make a stamp one, most specific first: the
 * first rule any of whose tags a stamp carries decides. So a `terminal`
 * `desk` is a desk, a `shrine` `shelf` a shelf, and a `sandbag`
 * `emplacement` an emplacement rather than a barricade. A list in place of
 * a tag matches a stamp carrying every tag in it.
 */
const ROLE_RULES: readonly (readonly [StampRole, readonly (string | readonly string[])[]])[] = [
    // A pack's `tabletop` says outright it is set on a table, whatever else it is (a candle on a table, a bread board).
    ['tabletop', ['tabletop']],
    ['stairs', ['stairs', 'staircase', 'ladder', 'lift', 'trapdoor', 'storm']],
    ['bridge', ['bridge']],
    // A counter's lifting gate is a piece of the counter, not a door in a wall.
    ['counter', ['counter-gate']],
    // What hangs in a doorway (a timber door, a sliding bulkhead, a gate, a roller shutter): after the stairs, as a trapdoor climbs.
    ['door', ['door', 'doors', 'gate', 'shutter', 'bulkhead']],
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
    ['shelf', ['shelf', 'archive', 'bookcase']],
    ['counter', ['counter', 'stall']],
    // An upholstered chair is an armchair before it is a seat.
    ['armchair', ['armchair', 'wingback', ['padded', 'chair'], ['easy', 'chair']]],
    ['seat', ['chair', 'stool']],
    // A cobbler's bench is worked at and armour laid on a bench is an armoury's display: neither is sat on (operator,
    // 2026-10-02: a porch's bench came out a helm and breastplate on a stand).
    ['workbench', ['cobbler']],
    ['rack', [['armour', 'bench']]],
    ['bench', ['bench', 'settle']],
    ['pew', ['pew']],
    // A kitchen's prep table and chopping block are worked at, not eaten at.
    ['workbench', ['prep', 'chopping', 'butcher']],
    // Table clutter (spilled drinks, scraps) lies on a table; it is not one.
    ['tabletop', [['table', 'clutter']]],
    ['table', ['table']],
    // A cabinet by a cot is its bedside cabinet, not a second cot.
    ['nightstand', ['nightstand', 'bedside', ['cot', 'cabinet']]],
    // A flower bed is a garden's, not a bedroom's.
    ['flora', [['flower', 'bed']]],
    ['bed', ['bed', 'bunk', 'cot']],
    ['hearth', ['hearth', 'cook']],
    ['workbench', ['workbench', 'forge']],
    ['console', ['console', 'terminal', 'radio', 'telepathic', ['service', 'bot']]],
    ['machine', ['machine', 'press', 'hopper', 'reactor', 'vat', 'crusher', 'pump']],
    ['altar', ['altar', 'niche', 'shrine']],
    ['lectern', ['lectern']],
    ['icon', ['icon', 'board', 'keypad', 'beacon']],
    ['rack', ['rack', 'mannequin', 'armour', 'helmet']],
    ['medical', ['gurney', 'stretcher', 'iv', 'vitals']],
    ['emplacement', ['emplacement', 'sentry', 'gun']],
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
    // A vegetable patch, a hen run, a mud wallow: a smallholding's ground and pens, set where a map lays them out. A
    // patch of growing cabbages is no basket of produce in a cellar.
    [
        'fitting',
        [
            ['vegetable', 'patch'],
            ['vegetable', 'rows'],
            ['hen', 'run'],
            ['mud', 'wallow'],
            ['compost', 'heap'],
        ],
    ],
    // An alchemist's reagents in bulk (a barrel of acid): set where a map names them, never stacked as a yard's or a
    // storeroom's stores (green acid barrels outside a country inn).
    ['fitting', ['acid', 'toxic', 'caustic']],
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
            // Produce in its basket or sack (a basket of carrots) is stores, never ground cover: its 'root' is no tree's.
            'vegetables',
            'vegetable',
            'produce',
        ],
    ],
    ['rug', ['rug', 'carpet']],
    // A mark that says something (a cult's graffito, a scratched sigil, a violet sorcerous burn, brood resin), a thing laid
    // flat (a hung bedsheet), or a strip made to run along a route: never strewn as grime, only where a map names it.
    ['fitting', ['graffito', 'graffiti', 'sigil', 'bedsheet', 'segment', 'violet', 'brood', 'resin']],
    // A crystal ball on its stand is a seer's, set on a fortune-teller's table: no crystal outcrop growing from the ground.
    ['fitting', [['crystal', 'ball']]],
    // Fallen leaves lie under trees: ground cover outdoors, never a megacity chapel's grime.
    ['flora', ['leaf']],
    // Flat marks on a floor or the ground (an oil stain, cracks, a scorch, a drift of dust): grime, never a piece that stands.
    ['decal', ['decal', 'stain', 'grime', 'cracks', 'crack', 'scorch', 'dust', 'smear', 'grit']],
    ['tree', ['tree', 'copse']],
    ['shrub', ['bush', 'overgrowth']],
    ['log', ['log', 'stump']],
    ['rock', ['boulder', 'rock', 'formation', 'stalagmites', 'stalactites', 'crystal', 'deposit']],
    // Ground cover growing wild: fungus, roots, reeds and sedge at water, ferns and bracken under trees, wildflowers and tufts.
    // Lily pads float on open water, which nothing is dressed in: they are placed by hand, never strewn on a marsh's mud.
    ['flora', ['mushroom', 'roots', 'root', 'reed', 'sedge', 'tussock', 'cattail', 'bulrush', 'fern', 'bracken', 'wildflower', 'tuft']],
    ['debris', ['debris', 'wreckage', 'girders', 'shards', 'casings', 'splatter', 'cairn', 'bone', 'street', 'wetland']],
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
    decal: FREE,
    door: WALL,
    fitting: FREE,
};

/** Tags that say which ground land belongs on. */
const HABITAT_RULES: readonly (readonly [StampHabitat, readonly string[]])[] = [
    // Fungus grows in the dark and the damp under trees: a wood or a cave, never spread across an open marsh or a meadow.
    ['cave', ['cave', 'stalagmites', 'stalactites', 'crystal', 'mineral', 'mushroom']],
    ['arctic', ['ice', 'frost', 'snow']],
    ['forest', ['forest', 'woodland', 'mushroom']],
    ['marsh', ['mire', 'marsh', 'swamp', 'bog']],
    ['desert', ['desert', 'sand', 'dune']],
    ['ruin', ['bone', 'cairn', 'crypt', 'dungeon', 'ruin', 'ruined']],
    ['urban', ['street', 'metal', 'girders', 'cable', 'wreckage', 'casings', 'shards', 'splatter']],
];

/** Tags of land that is planted and tended (a flower bed, a planter, a potted shrub): it grows in no wild ground. */
const CULTIVATED_TAGS: readonly string[] = ['bed', 'planter', 'garden', 'pot', 'potted', 'trellis'];

/** Tags of growth from a climate no zone here has (a jungle's vine tangle): never strewn in a temperate wood. */
const FOREIGN_CLIMATE_TAGS: readonly string[] = ['jungle', 'tropical'];

/** Where each kind of land belongs when its tags say nothing of ground: a plain boulder lies on any open ground. */
const LAND_HABITATS: Partial<Readonly<Record<StampRole, readonly StampHabitat[]>>> = {
    tree: ['forest', 'grassland'],
    shrub: ['forest', 'grassland', 'marsh'],
    rock: ['forest', 'grassland', 'rocky', 'desert', 'ruin'],
    log: ['forest'],
    flora: ['forest', 'grassland', 'marsh'],
    debris: ['urban', 'ruin'],
};

/**
 * Tags of what is only ever set where it is meant, never scattered: a trap lies where it is meant to catch someone, and a
 * hillside's pieces (a cliff band, the steps cut through it) lie along the edge a map draws, never furnishing a room: a
 * cliff's stone steps are no tower's stair between its floors.
 */
const NAMED_ONLY = ['trap', 'hillside', 'escarpment'];

/**
 * The role `tags` make a stamp: a fitting, drawn only where a map names it,
 * when no rule says more, and always for a trap (a pressure plate in a
 * tomb's guardian hall), whatever else its tags say.
 */
export function roleFromTags(tags: readonly string[]): StampRole | undefined {
    if (tags.some((tag) => NAMED_ONLY.includes(tag))) {
        return 'fitting';
    }
    const carries = (tag: string | readonly string[]): boolean => (typeof tag === 'string' ? tags.includes(tag) : tag.every((t) => tags.includes(t)));
    return ROLE_RULES.find(([, any]) => any.some(carries))?.[0] ?? 'fitting';
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

/** Scales of art seen from far above, for charts (a city's blocks drawn for a region's towns), never for a battlemap. */
const CHART_SCALES: readonly string[] = ['city', 'regional', 'planet', 'system'];

/**
 * Whether a stamp drawn at `scale` can fill `role` on a map drawn at
 * `mapScale`: a room's altar is an interior altar, not a wayside shrine; a
 * yard's structure is a building-sized work, not an indoor gantry. Land,
 * storage, clutter and the ways between levels (a stair indoors, storm doors
 * outside) serve either. A chart (a region, a world, a system) takes only art
 * of its own scale, and only where the map names it: its towns, ruins and
 * worlds are named pieces, never scattered.
 */
export function suitsScale(role: StampRole, scale: string, mapScale: MapScale = 'battlemap'): boolean {
    if (mapScale !== 'battlemap') {
        // A region's towns and keeps are drawn as a city's blocks seen from far above.
        // Only its own scale (operator, 2026-10-02: a region's town is one stamp, typically; its cottages and barns are a
        // town map's art, never a region's).
        return role === 'fitting' && scale === mapScale;
    }
    // A fitting stands in a room or a yard, never a city block or a world drawn to look like one from far above.
    if (role === 'fitting') {
        return scale === 'interior' || scale === 'exterior';
    }
    // A chart's art (a map pin, a town seen from far above, a world) never stands on a battlemap: a supply pin is no crate,
    // a city tile's cart and crates no cellar store.
    if (CHART_SCALES.includes(scale)) {
        return false;
    }
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
    // Planted by someone (a flower bed, a potted shrub): never growing wild in a marsh or a wood.
    if (tags.some((tag) => CULTIVATED_TAGS.includes(tag))) {
        return [];
    }
    // Jungle growth: no ground here is a jungle, so it is never strewn, only set where a map names it.
    if (tags.some((tag) => FOREIGN_CLIMATE_TAGS.includes(tag))) {
        return [];
    }
    const tagged = HABITAT_RULES.filter(([, any]) => any.some((tag) => tags.includes(tag))).map(([habitat]) => habitat);
    return tagged.length > 0 ? tagged : land;
}
