// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Throwaway encounter maps (operator 2026-11-04: "a wide variety of throwaway encounter maps. An encounter map generator
 * in the cartography module"), built from a checklist (operator, the same day: "Landscape type (forest, plains, desert,
 * marsh, etc), River with optional bridge type, road / crossroad, etc"): a landscape, a road, the features ticked, a
 * setting, a size, a density and a seed become a map intent the composer builds like any other. Pure and seeded: the
 * same checklist and seed always give the same map, another seed another layout. The intent is the GM's to edit after.
 */

import { randomInt, type Random, seededRandom, shuffled } from '../generate/random';
import { type EarthCircle, paintGround } from './encounter-ground';

/** The ground the encounter is fought over. */
export const ENCOUNTER_LANDSCAPES = ['forest', 'plains', 'hills', 'desert', 'marsh', 'tundra', 'wasteland', 'cave'] as const;
export type EncounterLandscape = (typeof ENCOUNTER_LANDSCAPES)[number];

/** The ways across it. */
export const ENCOUNTER_ROADS = ['none', 'road', 'crossroads'] as const;
export type EncounterRoad = (typeof ENCOUNTER_ROADS)[number];

/** How a road crosses the river: any bridge built for a road, one of a kind, or a ford with none. */
export const ENCOUNTER_BRIDGES = ['any', 'stone', 'timber', 'rope', 'ford'] as const;
export type EncounterBridge = (typeof ENCOUNTER_BRIDGES)[number];

/** What can be ticked onto the landscape. */
export const ENCOUNTER_FEATURES = ['river', 'lake', 'ruins', 'camp', 'wreck', 'cliffs'] as const;
export type EncounterFeature = (typeof ENCOUNTER_FEATURES)[number];

/** The worlds an encounter is drawn for: its stamps' settings and its light. */
export const ENCOUNTER_SETTINGS = ['feudal', 'grimdark', 'warp', 'scifi'] as const;
export type EncounterSetting = (typeof ENCOUNTER_SETTINGS)[number];

/** How large a map: squares across and down. */
export const ENCOUNTER_SIZES = ['small', 'medium', 'large'] as const;
export type EncounterSize = (typeof ENCOUNTER_SIZES)[number];

/** How thickly its ground is dressed. */
export const ENCOUNTER_DENSITIES = ['sparse', 'normal', 'dense'] as const;
export type EncounterDensity = (typeof ENCOUNTER_DENSITIES)[number];

export interface EncounterChoice {
    readonly landscape: EncounterLandscape;
    readonly road: EncounterRoad;
    readonly bridge: EncounterBridge;
    readonly features: readonly EncounterFeature[];
    readonly setting: EncounterSetting;
    readonly size: EncounterSize;
    readonly density: EncounterDensity;
    readonly seed: number;
}

/** The checklist the builder starts on: a feudal forest road over a river. */
export const DEFAULT_ENCOUNTER: EncounterChoice = {
    landscape: 'forest',
    road: 'road',
    bridge: 'any',
    features: ['river'],
    setting: 'feudal',
    size: 'medium',
    density: 'normal',
    seed: 1,
};

const SIZES: Readonly<Record<EncounterSize, { readonly width: number; readonly height: number }>> = {
    small: { width: 24, height: 18 },
    medium: { width: 32, height: 24 },
    large: { width: 44, height: 30 },
};

interface SettingLook {
    /** Stamp settings: art carrying any of these (a faction named here brings its own art in). */
    readonly settings: readonly string[];
    /** What stands where a place is built up: ruined walls, or a works yard. */
    readonly ruin: 'rubble' | 'industrial';
    readonly lighting: 'day' | 'night';
    /** Whether its art has a road bridge (only the feudal world's does; the Imperium's is a pipe bridge): where not, "any bridge" is a ford. */
    readonly bridged: boolean;
    /** The texture its rocky ground is drawn in. */
    readonly rock: string;
}

/** Desert rock is sandstone scree, whatever the world (2026-11-05: rocky zones drew flat grey with no painted rock). */
const DESERT_ROCK = 'floor.rock-sandstone';

/** A desert's sand in wind ripples, never one flat tone (2026-11-05 preview: bare sand edge to edge). */
const DESERT_GROUND = 'floor.rippled-sand';

/**
 * Rocky ground out in the open: rough earth its boulders and scree are strewn over. The set's own rock (granite slabs)
 * drew every rocky patch as a blob of blue-grey flagstones on the grass (2026-11-06 preview, eight encounters).
 */
const OPEN_ROCK = 'floor.rough-packed-earth-2';

/**
 * The Imperium's and the warp's worn ground under their stones, ruins and camps: shell-churned earth and warp-scarred
 * earth. Their set's slate slabs drew every patch as a dark blob of flagstone on the open ground (2026-11-06 previews,
 * encounter-grimdark-wasteland and -desert, warp-forest).
 */
const GRIMDARK_ROCK = 'floor.shell-churned-earth';
const WARP_ROCK = 'floor.warp-scarred-earth';

/**
 * A wasteland's open ground: rough brown earth, its patches scorched (2026-11-06: grey pebble ash under tan hardpan
 * read as two maps pasted together).
 */
const WASTELAND_GROUND = 'floor.rough-packed-earth-2';

/** The dry ground above a marsh: muted olive meadow, never the set's bright lawn grassland (2026-11-06 preview). */
const MARSH_HEIGHTS = 'floor.olive-meadow';

/** Ground the warp has scarred, dark soil veined violet, under its grassland and forest (2026-11-05: a warp forest drew as any green wood). */
const WARP_GROUND = 'floor.warp-scarred-earth';

/**
 * The ground texture a landscape is drawn in, where it is not its biome's own: rippled sand in any world's desert, the
 * warp's scarred earth under its woods and plains. Null keeps the biome's. A role the active set lacks draws as the
 * biome's own, so a texture still to come falls back cleanly.
 */
function groundTextureOf(landscape: Exclude<EncounterLandscape, 'cave'>, setting: EncounterSetting): string | null {
    if (landscape === 'desert') {
        return DESERT_GROUND;
    }
    // Its heights and base in the same brown earth as its blend, never the set's grey ash.
    if (landscape === 'wasteland') {
        return WASTELAND_GROUND;
    }
    return setting === 'warp' && (landscape === 'forest' || landscape === 'plains' || landscape === 'hills') ? WARP_GROUND : null;
}

/** The bog's open mud, and how many squares of marsh hold one wallow of it. */
const MUD = 'floor.mud';
const MUD_SQUARES = 160;

/**
 * A road over open country is a worn earth track, through a bog a muddy one, never the set's grey gravel (2026-11-05
 * preview: a gravel road through a marsh; 2026-11-09 renders: grey gravel over sand, snow and the wasteland's earth).
 */
const TRACK: Readonly<Record<Exclude<EncounterLandscape, 'cave'>, string>> = {
    forest: 'floor.packed-dirt',
    plains: 'floor.packed-dirt',
    hills: 'floor.packed-dirt',
    desert: 'floor.packed-dirt',
    tundra: 'floor.packed-dirt',
    wasteland: 'floor.rough-packed-earth-2',
    marsh: MUD,
};

// The feudal world's woods and stone; the Imperium's works; the warp's corrupted night; a frontier world's works.
const LOOKS: Readonly<Record<EncounterSetting, SettingLook>> = {
    feudal: { settings: ['setting-fantasy', 'setting-generic'], ruin: 'rubble', lighting: 'day', bridged: true, rock: OPEN_ROCK },
    grimdark: { settings: ['setting-grimdark-human', 'setting-generic'], ruin: 'industrial', lighting: 'day', bridged: false, rock: GRIMDARK_ROCK },
    warp: {
        settings: ['setting-grimdark-chaotic', 'setting-grimdark-human', 'setting-generic'],
        ruin: 'rubble',
        lighting: 'night',
        bridged: false,
        rock: WARP_ROCK,
    },
    scifi: { settings: ['setting-scifi', 'setting-generic'], ruin: 'industrial', lighting: 'day', bridged: false, rock: OPEN_ROCK },
};

type Side = 'north' | 'south' | 'east' | 'west';

interface Point {
    readonly x: number;
    readonly y: number;
}

interface CircleArea {
    readonly shape: 'circle';
    readonly centre: Point;
    readonly radius: number;
}
interface EdgeArea {
    readonly shape: 'edge';
    readonly side: Side;
    readonly depth: number;
}
const circle = (centre: Point, radius: number): CircleArea => ({ shape: 'circle', centre, radius });

/** Whether `area` is a circle area: a centre point and a radius. */
function isCircleArea(area: object): area is CircleArea {
    if (!('shape' in area) || area.shape !== 'circle') {
        return false;
    }
    if (!('radius' in area) || typeof area.radius !== 'number' || !('centre' in area)) {
        return false;
    }
    const { centre } = area;
    return typeof centre === 'object' && centre !== null && 'x' in centre && typeof centre.x === 'number' && 'y' in centre && typeof centre.y === 'number';
}
const edgeStrip = (side: Side, depth: number): EdgeArea => ({ shape: 'edge', side, depth });
const EVERYWHERE = { shape: 'everywhere' } as const;

/** Squares kept clear of the map's edge for a feature's centre. */
const MARGIN = 4;

/** A point at random inside the map, clear of its edge by `margin`, rounded to a tenth of a square. */
function inside(random: Random, width: number, height: number, margin = MARGIN): Point {
    const round = (v: number): number => Math.round(v * 10) / 10;
    return { x: round(margin + random() * (width - 2 * margin)), y: round(margin + random() * (height - 2 * margin)) };
}

/** Squares of map per cluster of rock, ruin or wreck: a small map holds three, a large one seven. */
const SQUARES_PER_CLUSTER = 180;

/** Most clusters gathered round one feature's spot. */
const CLUSTERS_AT_A_SITE = 4;

/**
 * Clusters of `kinds` (taking turns), the first the largest and densest: spread over the map by its area, or gathered
 * round `near` (a ruin's own spot).
 */
function clusters(random: Random, width: number, height: number, kinds: readonly string[], density: EncounterDensity, near?: Point): object[] {
    const largest = Math.min(width, height) / 3.5;
    const count = near ? CLUSTERS_AT_A_SITE : Math.max(3, Math.round((width * height) / SQUARES_PER_CLUSTER));
    const spot = (): Point =>
        near ? { x: near.x + (random() - 0.5) * largest * 2, y: near.y + (random() - 0.5) * largest * 2 } : inside(random, width, height);
    return Array.from({ length: count }, (_, i) => ({
        kind: kinds[i % kinds.length] ?? 'rubble',
        area: circle(i === 0 && near ? near : spot(), Math.max(2, largest * (i === 0 ? 1 : 0.45 + random() * 0.4))),
        density: i === 0 ? density : 'sparse',
        // Feathered wide into the ground round it, never a round blob with a crisp rim (2026-11-06 preview).
        blend: CLUSTER_BLEND,
    }));
}

/** Squares over which a cluster's ground fades into the ground round it. */
const CLUSTER_BLEND = 2.5;

/** Each landscape's ground and its patches of another, as its painted blend lays them: the base where nothing else is. */
const GROUND_ROLES: Readonly<Record<Exclude<EncounterLandscape, 'cave'>, readonly [string, string]>> = {
    forest: ['floor.olive-meadow', 'floor.summer-forest-floor-2'],
    plains: ['floor.olive-meadow', 'floor.grass-2'],
    hills: ['floor.olive-meadow', 'floor.dead-grass'],
    desert: ['floor.rippled-sand', 'sand'],
    // Drier olive hummocks through the bog (its mud wallows are zones of their own): all bog read as a black mat.
    marsh: ['marsh', 'floor.olive-meadow'],
    tundra: ['snow', 'tundra'],
    wasteland: [WASTELAND_GROUND, 'floor.scorched-earth-2'],
};

/** Zones whose ground is worn to earth or rock in the painted blend: rock fields, ruins, works, camps, landings. */
const EARTH_KINDS: readonly string[] = ['rocky', 'rubble', 'industrial', 'fortified', 'landing'];

/** A distinct seed for the ground's noise, so painting it never shifts the layout's own random draws. */
const GROUND_SEED_OFFSET = 1105;

/** The circles of `zones` whose ground is worn to earth or rock. */
function earthOf(zones: readonly object[]): EarthCircle[] {
    return zones.flatMap((zone) =>
        'kind' in zone &&
        typeof zone.kind === 'string' &&
        EARTH_KINDS.includes(zone.kind) &&
        'area' in zone &&
        typeof zone.area === 'object' &&
        zone.area !== null &&
        isCircleArea(zone.area)
            ? [{ centre: zone.area.centre, radius: zone.area.radius }]
            : [],
    );
}

/** Copses of trees dotted over open ground. */
function copses(random: Random, width: number, height: number, density: EncounterDensity, count: number): object[] {
    return Array.from({ length: count }, () => ({ kind: 'woodland', area: circle(inside(random, width, height), randomInt(random, 2, 4)), density }));
}

/** A landscape's ground and the zones that cover it. */
interface Landscape {
    readonly ground: string;
    /** Whether it is covered (a wood, a bog): a feature on it stands in a clearing of its own. */
    readonly covered: boolean;
    readonly zones: (random: Random, width: number, height: number, density: EncounterDensity) => object[];
}

const LANDSCAPES: Readonly<Record<Exclude<EncounterLandscape, 'cave'>, Landscape>> = {
    forest: { ground: 'grassland', covered: true, zones: (_random, _w, _h, density) => [{ kind: 'woodland', area: EVERYWHERE, density }] },
    plains: {
        ground: 'grassland',
        covered: false,
        zones: (random, w, h, density) => [{ kind: 'meadow', area: EVERYWHERE, density: 'sparse' }, ...copses(random, w, h, density, randomInt(random, 2, 3))],
    },
    hills: {
        ground: 'grassland',
        covered: false,
        zones: (random, w, h, density) => [{ kind: 'meadow', area: EVERYWHERE, density: 'sparse' }, ...clusters(random, w, h, ['rocky'], density)],
    },
    desert: { ground: 'sand', covered: false, zones: (random, w, h) => clusters(random, w, h, ['rocky'], 'sparse') },
    marsh: {
        ground: 'marsh',
        covered: true,
        zones: (random, w, h, density) => [
            { kind: 'marsh', area: EVERYWHERE, density },
            // Wallows of open mud feathered into the bog (2026-11-05 preview: one flat dark green from edge to edge).
            ...Array.from({ length: Math.max(2, Math.round((w * h) / MUD_SQUARES)) }, () => ({
                kind: 'paving',
                soft: true,
                texture: MUD,
                blend: 1.5,
                area: circle(inside(random, w, h, 2), randomInt(random, 1, 3)),
            })),
            ...Array.from({ length: randomInt(random, 1, 2) }, () => ({ kind: 'lake', area: circle(inside(random, w, h), randomInt(random, 2, 3)) })),
        ],
    },
    tundra: {
        ground: 'snow',
        covered: false,
        // No woodland zones on snow: they strewed ferns, bracken and broadleaf (48ca867 census); its trees are the
        // dead-pine feature clusters.
        zones: (random, w, h) => clusters(random, w, h, ['rocky'], 'sparse'),
    },
    // No rubble zones: rubble dresses as urban ruin (street drain grates on open waste, 48ca867 census); its debris is the
    // crater debris-field feature clusters.
    wasteland: { ground: 'ash', covered: false, zones: (random, w, h, density) => clusters(random, w, h, ['rocky'], density) },
};

/** A cave's chambers: their size range in squares, and the squares of map each cell of their grid takes. */
const CAVE_CHAMBERS = { smallest: 6, largest: 11, cell: 12 } as const;
const CAVE_BACKDROP = '#0c0b0a';
/** A passage's width in squares. */
const CAVE_PASSAGE = 2.5;
/** Spots tried for a chamber's dressing, and the squares kept between two pieces of it. */
const CAVE_DRESSING_TRIES = 24;
const CAVE_DRESSING_GAP = 0.3;

/**
 * A cave's dressing, as the Dunmarch caves dress theirs (2026-11-09 renders: every encounter cave a bare floor):
 * boulders, loose stones, stalagmites, mushrooms and roots, each by the role its art's tags derive.
 */
const CAVE_DRESSING: readonly { name: string; width: number; height: number; role: string; tags: readonly string[] }[] = [
    { name: 'cave boulder', width: 1.6, height: 1.4, role: 'rock', tags: ['cave', 'boulder'] },
    { name: 'loose stones', width: 0.8, height: 0.65, role: 'debris', tags: ['rubble', 'bits', 'debris'] },
    { name: 'stalagmite cluster', width: 1.2, height: 1.2, role: 'fitting', tags: ['stalagmite', 'cluster'] },
    { name: 'mushroom cluster', width: 1.2, height: 1.2, role: 'flora', tags: ['mushroom', 'cluster'] },
    { name: 'cave roots', width: 1.6, height: 1.4, role: 'flora', tags: ['cave', 'roots'] },
];

/**
 * What the warp leaves in a cave, dressed among its rocks (2026-11-09 preview: a warp cave read as any other): a rift
 * in the floor, black thorns and a cult's candle-lit bones. The near-black scorch mark is left out: it is lost on a cave
 * floor.
 */
const WARP_CAVE_DRESSING: readonly { name: string; width: number; height: number; role: string; tags: readonly string[]; state: string }[] = [
    { name: 'hell rift', width: 2.4, height: 0.9, role: 'fitting', tags: ['hell', 'rift'], state: 'long cracked' },
    { name: 'thorn growth', width: 1.6, height: 1.6, role: 'fitting', tags: ['thorn', 'growth'], state: 'spreading' },
    { name: 'chaos bone pile', width: 1.4, height: 1.4, role: 'fitting', tags: ['bone', 'pile'], state: 'pile candle stubs' },
];

/**
 * Chambers cut through rock, one in each cell of a grid over the map, jittered, so the cave fills it (2026-11-09:
 * chambers at random bunched in a corner, the rest of the map void); each joined to the one before, the first opening
 * off the map, and dressed in the middle half of its floor, clear of its walls; a `warp` cave with the warp's marks too.
 */
function cave(random: Random, width: number, height: number, warp: boolean): object {
    const columns = Math.max(2, Math.round(width / CAVE_CHAMBERS.cell));
    const rows = Math.max(1, Math.round(height / CAVE_CHAMBERS.cell));
    const cells = Array.from({ length: columns * rows }, (_, i) => ({ column: i % columns, row: Math.floor(i / columns) }));
    // Snaking through the grid, row by row, so each chamber's passage reaches its neighbour.
    const ordered = cells.sort((a, b) => a.row - b.row || (a.row % 2 === 0 ? a.column - b.column : b.column - a.column));
    const round = (v: number): number => Math.round(v * 10) / 10;
    const chambers = ordered.map(({ column, row }) => {
        const cellWidth = width / columns;
        const cellHeight = height / rows;
        const size = (cell: number): number => Math.min(cell - 2, randomInt(random, CAVE_CHAMBERS.smallest, CAVE_CHAMBERS.largest));
        return {
            centre: { x: round((column + 0.3 + random() * 0.4) * cellWidth), y: round((row + 0.3 + random() * 0.4) * cellHeight) },
            width: size(cellWidth),
            height: size(cellHeight),
        };
    });
    const passages = chambers.slice(1).map((chamber, i) => ({ points: [chambers[i]?.centre ?? chamber.centre, chamber.centre], width: CAVE_PASSAGE }));
    const dressing: object[] = [];
    const first = chambers[0]?.centre ?? { x: width / 2, y: height / 2 };
    const exit = { points: [first, { x: -1, y: first.y }], width: CAVE_PASSAGE };
    // Each chamber's pieces apart from one another: a spot tried a few times, kept only clear of those already there
    // (2026-11-09 judge: boulders and stalagmites heaped on one another). A warp cave's table holds the warp's too.
    const table = warp ? [...CAVE_DRESSING, ...WARP_CAVE_DRESSING] : CAVE_DRESSING;
    for (const chamber of chambers) {
        const placed: { at: Point; reach: number }[] = [];
        const wanted = randomInt(random, 2, 4);
        for (let tries = 0; tries < CAVE_DRESSING_TRIES && placed.length < wanted; tries++) {
            const piece = table[randomInt(random, 0, table.length - 1)] ?? table[0];
            const reach = Math.max(piece?.width ?? 1, piece?.height ?? 1) / 2;
            const at = {
                x: round(chamber.centre.x + (random() - 0.5) * chamber.width * 0.5),
                y: round(chamber.centre.y + (random() - 0.5) * chamber.height * 0.5),
            };
            if (piece && placed.every((other) => Math.hypot(other.at.x - at.x, other.at.y - at.y) > other.reach + reach + CAVE_DRESSING_GAP)) {
                placed.push({ at, reach });
                dressing.push({ ...piece, tags: [...piece.tags], at });
            }
        }
    }
    return {
        ground: null,
        backdrop: CAVE_BACKDROP,
        hewn: [{ floor: 'floor.cave-floor', wall: 'wall.rock', roughness: 0.5, chambers, passages: [exit, ...passages] }],
        fixtures: dressing,
    };
}

/** The spots features stand at: one per quarter of the map and its middle, in a seeded order, none on another. */
function sites(random: Random, width: number, height: number): Point[] {
    const spots = [
        { x: width * 0.28, y: height * 0.3 },
        { x: width * 0.72, y: height * 0.3 },
        { x: width * 0.28, y: height * 0.7 },
        { x: width * 0.72, y: height * 0.7 },
        { x: width * 0.5, y: height * 0.5 },
    ];
    const round = (v: number): number => Math.round(v * 10) / 10;
    return shuffled(random, spots).map((q) => ({ x: round(q.x + (random() - 0.5) * 3), y: round(q.y + (random() - 0.5) * 3) }));
}

/** A road's `bridge`: tags for a kind of bridge, false for a ford, nothing for any road bridge. */
const BRIDGE: Readonly<Record<EncounterBridge, readonly string[] | false | undefined>> = {
    any: undefined,
    stone: ['stone'],
    timber: ['timber'],
    rope: ['rope'],
    ford: false,
};

/**
 * Where a road down the map is pinned, or null to let it wander: beside a river down the map it keeps to one bank, on
 * the side with more room (2026-11-04 render, encounter-feudal-forest: left to wander it met the river and bridged it at
 * the map's edge); through cliffs it is pinned too, so the faces can leave it a pass (2026-11-09 render,
 * encounter-grimdark-marsh: an unpinned road ran straight through both faces).
 */
function downRoadX(at: {
    readonly lakeAt: Point | null;
    readonly riverX: number | null;
    readonly cliffDepth: number | null;
    readonly clearX: number | null;
    readonly width: number;
    readonly random: Random;
}): number | null {
    const { lakeAt, riverX, cliffDepth, clearX, width, random } = at;
    if (lakeAt === null && riverX !== null) {
        return riverX < width / 2 ? width * 0.82 : width * 0.18;
    }
    return cliffDepth === null ? null : clearX ?? Math.round(width * (0.35 + random() * 0.3));
}

/** Squares the roads keep inside the pass from a height's face, and how far a road pinned through cliffs may wander. */
const CLIFF_CLEARANCE = 2;
const CLIFF_ROAD_MEANDER = 0.2;
/** Squares either side of a road's line a cliff face leaves open for its pass. */
const CLIFF_PASS = 3;
/** Squares either side of a road's line along a pass that its pools keep clear: its half width, its bends and a step. */
const ROAD_BAND = 2.75;

/**
 * Where a road along a pass runs, with nothing else to steer it: a step clear of one face's foot, north or south as
 * seeded, so the rest of the pass is the pools' (2026-11-09 preview, encounter-scifi-marsh: a road free to wander
 * went round a pool the short way, over a height).
 */
function passRoadY(random: Random, depth: number, height: number): number {
    const off = depth + CLIFF_CLEARANCE + 1;
    return random() < 0.5 ? off : height - off;
}

/**
 * The road across the map along a pass where the cliffs fixed its line (`roadY`): its ends held there and its bends kept
 * low, or a free edge end and a wide meander climb it over a face (2026-11-09 preview, encounter-scifi-marsh). Elsewhere
 * the road as it is.
 */
function alongPass(across: object, roadY: number | null, width: number): object {
    return roadY === null ? across : { ...across, from: { x: -1, y: roadY }, to: { x: width + 1, y: roadY }, meander: CLIFF_ROAD_MEANDER };
}

/** The road down the map pinned at `x` (through a pass, or beside a river), its bends kept low; free where none is. */
function throughPass(down: object, x: number | null, height: number): object {
    return x === null ? down : { ...down, from: { x, y: height + 1 }, to: { x, y: -1 }, meander: CLIFF_ROAD_MEANDER };
}

/**
 * The heights of rock along both long sides, the way between them a pass (not a boulder field: a band of rock either
 * side; 2026-11-04 preview: dense strips swamped a marsh in boulders). The landscape's own pools and wallows are moved
 * into the pass, never across a height (2026-11-05 preview: a marsh's pool cut in half by the south cliff face), and
 * clear of the road along it where one runs there (`roadAlong`). Pushes the heights' strips; returns their depth and
 * the road's line along the pass (null where no road runs along it).
 */
function cliffs(at: { readonly random: Random; readonly height: number; readonly zones: object[]; readonly heights: object[]; readonly roadAlong: boolean }): {
    readonly depth: number;
    readonly roadY: number | null;
} {
    const { random, height, zones, heights, roadAlong } = at;
    const depth = Math.round(height * 0.2);
    const roadY = roadAlong ? passRoadY(random, depth, height) : null;
    const band = roadY === null ? null : { y0: roadY - ROAD_BAND, y1: roadY + ROAD_BAND };
    zones.forEach((zone, i) => {
        zones[i] = intoPass(zone, depth, height, band);
    });
    heights.push({ kind: 'rocky', area: edgeStrip('north', depth) }, { kind: 'rocky', area: edgeStrip('south', depth) });
    return { depth, roadY };
}

/**
 * Each height's cliff face looking down into the pass, laid along its edge as a run of plan-view cliff art (2026-11-04
 * render: the strips alone drew as flat grey bands, no cliff to them), broken for a pass where a road runs down the map
 * through the heights at `passX`; none where the map has no cliffs (`depth` null).
 */
function cliffFaces(depth: number | null, width: number, height: number, passX: number | null): object[] {
    if (depth === null) {
        return [];
    }
    const run = (y: number, facing: 'top' | 'bottom', x0: number, x1: number): object => ({
        // "run" in its name as in its art's: plain "cliff face" tied the Run with its corner pieces, and the corner won
        // (2026-11-05 judge census: 44 Earth Cliff Face Outer Corners along a marsh's heights).
        name: 'cliff face run',
        width: Math.round((x1 - x0) * 10) / 10,
        height: 1,
        at: { x: Math.round(((x0 + x1) / 2) * 10) / 10, y },
        role: 'fitting',
        tags: ['cliff', 'face', 'run'],
        state: 'only cliff face',
        facing,
        fixed: true,
    });
    const spans: [number, number][] =
        passX === null
            ? [[0, width]]
            : [
                  [0, passX - CLIFF_PASS],
                  [passX + CLIFF_PASS, width],
              ];
    const kept = spans.filter(([x0, x1]) => x1 - x0 >= 1);
    return kept.flatMap(([x0, x1]) => [run(depth, 'bottom', x0, x1), run(height - depth, 'top', x0, x1)]);
}

/**
 * What the warp leaves on any ground (2026-11-09 renders: a warp desert, marsh or tundra read as any other, its corruption
 * only in a forest's or plain's soil): rifts torn in the ground, corrupted shrubs and a twisted tree or two, scattered
 * over the map by its area and kept clear of the roads, rivers and water (the composer moves each to a free spot).
 * Warp flora is drawn only where named, so each is named here.
 */
const WARP_GROWTH: readonly { name: string; width: number; height: number; role: string; tags: readonly string[]; states: readonly string[]; per: number }[] = [
    { name: 'hell rift', width: 2.4, height: 1.2, role: 'fitting', tags: ['hell', 'rift'], states: ['short', 'longer', 'long cracked'], per: 500 },
    {
        name: 'corrupted shrub',
        width: 1.2,
        height: 1.2,
        role: 'fitting',
        tags: ['corrupted', 'shrub'],
        states: ['black brush', 'teal thorns', 'violet flowering'],
        per: 160,
    },
    {
        name: 'hell-twisted tree',
        width: 2.4,
        height: 2.4,
        role: 'fitting',
        // A fitting, the pack's own role for it, by its own tags: as a tree any tree matched, an autumn one winning (judge
        // WRONG ART, 2026-11-09).
        tags: ['hell', 'twisted', 'tree'],
        states: ['black spirals', 'violet veined', 'thorny tendrils'],
        per: 600,
    },
];

/** The warp's growth on a warp-touched map's open ground; none in any other setting. */
function warpGrowthOf(setting: EncounterSetting, random: Random, width: number, height: number): object[] {
    return setting === 'warp' ? warpGrowth(random, width, height) : [];
}

function warpGrowth(random: Random, width: number, height: number): object[] {
    return WARP_GROWTH.flatMap((kind) =>
        Array.from({ length: Math.max(1, Math.round((width * height) / kind.per)) }, () => ({
            name: kind.name,
            width: kind.width,
            height: kind.height,
            role: kind.role,
            tags: [...kind.tags],
            state: kind.states[randomInt(random, 0, kind.states.length - 1)],
            at: inside(random, width, height, 2),
            angle: randomInt(random, 0, 359),
            fixed: true,
            clear: true,
        })),
    );
}

/** A piece of a landscape feature: its art (role, tags, picture), its size, how many and how far from the centre. */
interface FeaturePart {
    readonly name: string;
    readonly role: string;
    readonly tags: readonly string[];
    readonly size: readonly [number, number];
    readonly count: readonly [number, number];
    readonly spread: number; // squares from the cluster's centre
    /** Only in these settings, where its art is drawn (omitted: every setting). */
    readonly settings?: readonly EncounterSetting[];
}

/** The settings whose packs draw battlefield leavings (craters, wreckage, casings), and the rest. */
const GRIMDARK_ONLY: readonly EncounterSetting[] = ['grimdark', 'warp'];
const OPEN_ONLY: readonly EncounterSetting[] = ['feudal', 'scifi'];
/** The settings whose packs draw the burnt woodland (generic, modern and sci-fi art: no feudal). */
const NOT_FEUDAL: readonly EncounterSetting[] = ['grimdark', 'warp', 'scifi'];

/**
 * What gathers on each open landscape, a few clusters a map (2026-11-10 review of the goal32 renders: rocks scattered
 * evenly over one flat ground read as empty against the reference maps, which gather their dressing into outcrops,
 * thickets and debris fields with quiet ground between).
 */
const LANDSCAPE_FEATURES: Readonly<Partial<Record<EncounterLandscape, readonly (readonly FeaturePart[])[]>>> = {
    plains: [
        // A boulder outcrop with its scree apron and scrub in its lee.
        [
            { name: 'outcrop boulder', role: 'rock', tags: ['boulder'], size: [1.6, 1.4], count: [3, 5], spread: 1.6 },
            { name: 'outcrop scree', role: 'debris', tags: ['scree'], size: [2, 1.6], count: [1, 2], spread: 2.4 },
            { name: 'outcrop bush', role: 'shrub', tags: ['bush'], size: [1, 1], count: [2, 4], spread: 2.8 },
        ],
        // A thicket.
        [{ name: 'thicket bush', role: 'shrub', tags: ['bush'], size: [1.1, 1.1], count: [5, 8], spread: 2.2 }],
    ],
    hills: [
        [
            { name: 'knoll boulder', role: 'rock', tags: ['boulder'], size: [1.8, 1.5], count: [4, 6], spread: 2 },
            { name: 'knoll scree', role: 'debris', tags: ['scree'], size: [2.2, 1.8], count: [2, 3], spread: 2.8 },
        ],
        [{ name: 'hillside bush', role: 'shrub', tags: ['bush'], size: [1, 1], count: [4, 7], spread: 2.4 }],
    ],
    desert: [
        [
            { name: 'outcrop boulder', role: 'rock', tags: ['boulder'], size: [1.8, 1.5], count: [3, 5], spread: 1.8 },
            { name: 'outcrop scree', role: 'debris', tags: ['scree'], size: [2.2, 1.8], count: [1, 3], spread: 2.6 },
        ],
        [{ name: 'desert scrub', role: 'shrub', tags: ['scrub'], size: [0.9, 0.9], count: [3, 6], spread: 2.4 }],
        [{ name: 'bleached bones', role: 'debris', tags: ['bone', 'cairn'], size: [1, 0.85], count: [1, 2], spread: 1.2 }],
    ],
    tundra: [
        [
            { name: 'frozen boulder', role: 'rock', tags: ['boulder'], size: [1.6, 1.4], count: [3, 5], spread: 1.8 },
            { name: 'frost scree', role: 'debris', tags: ['scree'], size: [2, 1.6], count: [1, 2], spread: 2.4 },
        ],
        // Dead trees standing in the snow (the pack's burnt woodland: no plan-view snow-laden pine exists yet). Its art is
        // generic, modern and sci-fi, so a feudal tundra has none.
        [
            { name: 'dead tree', role: 'fitting', tags: ['burnt', 'tree'], size: [2.2, 2.2], count: [2, 4], spread: 2.6, settings: NOT_FEUDAL },
            { name: 'dead stump', role: 'fitting', tags: ['charred', 'stump'], size: [0.9, 0.9], count: [1, 3], spread: 3, settings: NOT_FEUDAL },
        ],
    ],
    wasteland: [
        // A debris field round a crater: its art is the grimdark's alone, so elsewhere a field of broken rock.
        [
            { name: 'blast crater', role: 'crater', tags: ['impact', 'crater'], size: [2.2, 2.2], count: [1, 1], spread: 0, settings: GRIMDARK_ONLY },
            { name: 'scattered wreckage', role: 'debris', tags: ['wreckage', 'plates'], size: [1.2, 1], count: [3, 5], spread: 3, settings: GRIMDARK_ONLY },
            { name: 'spent casings', role: 'debris', tags: ['spent', 'casings'], size: [0.8, 0.8], count: [2, 3], spread: 3.4, settings: GRIMDARK_ONLY },
        ],
        [
            { name: 'broken rock', role: 'rock', tags: ['boulder'], size: [1.4, 1.2], count: [4, 6], spread: 2.4, settings: OPEN_ONLY },
            { name: 'broken scree', role: 'debris', tags: ['scree'], size: [2, 1.6], count: [1, 2], spread: 2.8, settings: OPEN_ONLY },
        ],
        // A stand of burnt-out trees round a fallen trunk, as on the tundra.
        [
            { name: 'dead tree', role: 'fitting', tags: ['burnt', 'tree'], size: [2.2, 2.2], count: [2, 3], spread: 2.4, settings: NOT_FEUDAL },
            {
                name: 'fallen dead trunk',
                role: 'fitting',
                tags: ['fallen', 'burnt', 'trunk'],
                size: [3, 0.8],
                count: [0, 1],
                spread: 2.4,
                settings: NOT_FEUDAL,
            },
            { name: 'dead stump', role: 'fitting', tags: ['charred', 'stump'], size: [0.9, 0.9], count: [1, 3], spread: 3, settings: NOT_FEUDAL },
        ],
        [{ name: 'bone cairn', role: 'debris', tags: ['bone', 'cairn'], size: [1, 0.85], count: [1, 2], spread: 1.4 }],
    ],
};
/** Clusters a map gets for every this many squares of it, and the least and most. */
const FEATURE_SQUARES = 160;
const FEATURE_CLUSTERS = { least: 3, most: 8 } as const;
/** How near two pieces of one cluster may stand, as a share of their mean size. */
const FEATURE_GAP = 1;
/** The features' own random stream, off the map's seed, so roads and zones keep their layout. */
const FEATURE_SEED_OFFSET = 7;

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * The landscape's features: clusters at seeded spots over the map, each piece around its cluster's centre at its own
 * size, turn and distance, all kept clear of the roads, water and camp (`clear`: the composer moves them off).
 */
function landscapeFeatures(landscape: EncounterLandscape, setting: EncounterSetting, random: Random, width: number, height: number): object[] {
    const kinds = LANDSCAPE_FEATURES[landscape]
        ?.map((kind) => kind.filter((part) => part.settings?.includes(setting) ?? true))
        .filter((kind) => kind.length > 0);
    if (!kinds || kinds.length === 0) {
        return [];
    }
    const count = Math.max(FEATURE_CLUSTERS.least, Math.min(FEATURE_CLUSTERS.most, Math.round((width * height) / FEATURE_SQUARES)));
    const out: object[] = [];
    // Every piece laid so far, across clusters: none piles on another (judge CROWDED, OVERLAP).
    const laid: { x: number; y: number; size: number }[] = [];
    for (let c = 0; c < count; c++) {
        const kind = kinds[c % kinds.length] ?? [];
        const centre = inside(random, width, height, 3);
        for (const part of kind) {
            const n = randomInt(random, part.count[0], part.count[1]);
            for (let i = 0; i < n; i++) {
                const angle = random() * Math.PI * 2;
                const r = part.spread * Math.sqrt(random());
                const k = 0.8 + random() * 0.4;
                const at = { x: round1(centre.x + Math.cos(angle) * r), y: round1(centre.y + Math.sin(angle) * r) };
                const size = Math.max(part.size[0], part.size[1]) * k;
                // A spot off the map's edge, or too near a piece laid, is skipped.
                // Turned, a piece reaches out to half its diagonal.
                const reach = Math.hypot(part.size[0], part.size[1]) * k * 0.5;
                const off = at.x < reach || at.y < reach || at.x > width - reach || at.y > height - reach;
                if (off || laid.some((p) => Math.hypot(p.x - at.x, p.y - at.y) < ((p.size + size) / 2) * FEATURE_GAP)) {
                    continue;
                }
                laid.push({ ...at, size });
                out.push({
                    name: part.name,
                    role: part.role,
                    tags: [...part.tags],
                    width: round1(part.size[0] * k),
                    height: round1(part.size[1] * k),
                    at,
                    angle: randomInt(random, 0, 359),
                    fixed: true,
                    clear: true,
                });
            }
        }
    }
    return out;
}

/** The map intent for an encounter, as a preset's is: an object the GM edits as JSON and the composer builds. */
export function encounterIntent(choice: EncounterChoice): object {
    const look = LOOKS[choice.setting];
    const { width, height } = SIZES[choice.size];
    const random = seededRandom(choice.seed);
    const base = { schemaVersion: 1, seed: choice.seed, width, height, settings: [...look.settings] };
    if (choice.landscape === 'cave') {
        return { ...base, lighting: 'dim', ...cave(random, width, height, choice.setting === 'warp') };
    }
    const land = LANDSCAPES[choice.landscape];
    const has = (feature: EncounterFeature): boolean => choice.features.includes(feature);
    const spots = sites(random, width, height);
    const take = (): Point => spots.shift() ?? { x: width / 2, y: height / 2 };
    const span = Math.min(width, height);
    const zones: object[] = land.zones(random, width, height, choice.density);
    const paths: object[] = [];
    const fixtures: object[] = [];
    // The cliffs' heights, drawn in the landscape's own ground after the rest (see below).
    const heights: object[] = [];
    // On covered ground a feature stands in a clearing of its own.
    const opened = (at: Point, radius: number): void => {
        if (land.covered) {
            zones.push({ kind: 'clearing', area: circle(at, radius + 1) });
        }
    };
    // The heights' depth where the map has cliffs (their faces are laid once the roads are known, broken where one
    // crosses), and where the road across runs along the pass when nothing else steers it.
    const { depth: cliffDepth, roadY } = has('cliffs')
        ? cliffs({ random, height, zones, heights, roadAlong: choice.road !== 'none' && !has('camp') && !has('lake') })
        : { depth: null, roadY: null };
    let lakeAt: Point | null = null;
    if (has('lake')) {
        const at = take();
        lakeAt = at;
        zones.push({ kind: 'lake', key: 'lake', area: circle(at, span * 0.18) });
        opened(at, span * 0.18);
    }
    if (has('ruins')) {
        const at = take();
        zones.push(...clusters(random, width, height, ['rubble', look.ruin], choice.density, at));
        opened(at, span / 3.5);
    }
    let campAt: Point | null = null;
    if (has('camp')) {
        campAt = take();
        zones.push({ kind: 'fortified', area: circle(campAt, span / 4), density: choice.density });
        opened(campAt, span / 4);
    }
    if (has('wreck')) {
        const at = take();
        zones.push(...clusters(random, width, height, look.ruin === 'industrial' ? ['rubble', 'landing'] : ['rubble'], choice.density, at));
        opened(at, span / 3.5);
    }
    let riverX: number | null = null;
    if (has('river')) {
        // Down the map, out of the lake where there is one; a road crossing it is bridged (or forded) as asked.
        const x = Math.round(width * (0.35 + random() * 0.3));
        riverX = x;
        paths.push({
            kind: 'river',
            from: has('lake') ? { zone: 'lake' } : { x, y: -1 },
            // Its end drifts toward its own side of the map, away from the bank a crossroads' second road keeps to.
            to: { x: x + randomInt(random, 0, 3) * (x < width / 2 ? -1 : 1), y: height + 1 },
            width: Math.round((2 + random() * 1.5) * 10) / 10,
            meander: 0.4,
        });
    }
    // A world with no road bridge art fords its rivers unless a kind is asked for.
    const bridge = choice.bridge === 'any' && !look.bridged ? false : BRIDGE[choice.bridge];
    const track = TRACK[choice.landscape];
    const road = (from: Side, to: Side, via: Point | null): object => ({
        kind: 'road',
        from,
        to,
        ...(via ? { via: [via] } : {}),
        meander: Math.round((0.3 + random() * 0.3) * 100) / 100,
        ...(bridge === undefined ? {} : { bridge }),
        texture: track,
    });
    // The road runs through the camp's gate where there is one: it is what the camp holds. Round a lake, never over it
    // (2026-11-04 preview: a road ran straight across one): it passes the far side of the map from the water.
    // A y held inside the pass, clear of both heights, where the map has cliffs.
    const intoPassY = (y: number): number =>
        cliffDepth === null ? y : Math.min(height - cliffDepth - CLIFF_CLEARANCE, Math.max(cliffDepth + CLIFF_CLEARANCE, y));
    const clear = (along: 'x' | 'y'): Point | null =>
        lakeAt === null
            ? null
            : along === 'y'
            ? // Inside the pass where the map has cliffs: at 0.82 or 0.18 of the map the road climbed over a height's face
              // round a lake (2026-11-09 render, encounter-scifi-marsh).
              { x: width / 2, y: intoPassY(lakeAt.y < height / 2 ? height * 0.82 : height * 0.18) }
            : { x: lakeAt.x < width / 2 ? width * 0.82 : width * 0.18, y: height / 2 };
    if (choice.road !== 'none') {
        paths.push(alongPass(road('west', 'east', campAt ?? clear('y')), roadY, width));
    }
    // Where a road runs down the map through the heights, its x: the faces break there for a pass.
    let passX: number | null = null;
    if (choice.road === 'crossroads') {
        // Pinned beside a river or through cliffs (downRoadX), else free to wander.
        const pinned = downRoadX({ lakeAt, riverX, cliffDepth, clearX: clear('x')?.x ?? null, width, random });
        passX = pinned;
        paths.push(throughPass(road('south', 'north', pinned === null ? clear('x') : null), pinned, height));
    }
    fixtures.push(...cliffFaces(cliffDepth, width, height, passX), ...warpGrowthOf(choice.setting, random, width, height));
    fixtures.push(...landscapeFeatures(choice.landscape, choice.setting, seededRandom(choice.seed + FEATURE_SEED_OFFSET), width, height));
    // Rocky ground in the world's own rock (a texture role the set lacks draws as the biome's own).
    const rock = choice.landscape === 'desert' ? DESERT_ROCK : look.rock;
    // Rocky ground is painted into the blend as earth or rock under its stones, never laid over it as a patch of its own.
    const groundTexture = groundTextureOf(choice.landscape, choice.setting);
    // The heights are the landscape's own ground raised, strewn with its rocks, never a band of bare rock: in the rock
    // texture they read as flagstone paving either side of the pass (2026-11-06 preview, encounter-feudal-marsh). A
    // marsh's heights are the dry olive meadow above it.
    const heightGround = groundTexture ?? (land.ground === 'marsh' ? MARSH_HEIGHTS : land.ground);
    const raised = heights.map((h) => ({ ...h, texture: heightGround }));
    // The open ground painted as a blend: the landscape's own, its patches of another, and worn earth or rock under its
    // stones, ruins and camps (2026-11-06 previews: rocky and earth patches lay as rimmed blobs on the ground).
    const [baseRole, patchRole] = GROUND_ROLES[choice.landscape];
    const painted = paintGround({
        width,
        height,
        seed: choice.seed + GROUND_SEED_OFFSET,
        roles: [groundTexture ?? baseRole, patchRole, rock],
        earth: earthOf(zones),
    });
    return {
        ...base,
        ground: land.ground,
        ...(groundTexture === null ? {} : { groundTexture }),
        lighting: look.lighting,
        splats: [painted],
        zones: [...zones, ...raised],
        paths,
        fixtures,
    };
}

/**
 * `zone` moved into the pass between two heights `depth` deep along the north and south edges: a circle (a pool, a
 * wallow) slid north or south until it clears both by a square, shrunk to fit where the pass is narrower. Where a road
 * runs along the pass (`road`, the band it keeps), the circle keeps to one side of it, shrunk to fit there, so the road
 * never has to go round it over a height (2026-11-09 preview, encounter-scifi-marsh). Anything else is left as it is.
 */
export function intoPass(zone: object, depth: number, height: number, road: Band | null = null): object {
    if (!('area' in zone) || typeof zone.area !== 'object' || zone.area === null || !isCircleArea(zone.area)) {
        return zone;
    }
    const { area } = zone;
    const feet = passFeet(depth, height, road, area.centre.y);
    const radius = Math.max(1, Math.min(area.radius, (feet.south - feet.north) / 2));
    const y = Math.min(Math.max(area.centre.y, feet.north + radius), feet.south - radius);
    return { ...zone, area: circle({ x: area.centre.x, y }, radius) };
}

/** A band of the map's height, from `y0` down to `y1`. */
interface Band {
    readonly y0: number;
    readonly y1: number;
}

/** Squares across the least room either side of a road a pool keeps to (a pool a square across). */
const POOL_ROOM = 2;

/**
 * The part of the pass a pool at `y` may lie in: between the faces' feet, a square clear of each, and where a road runs
 * along the pass, on the pool's own side of the road's band while that side has room, else on the side with more.
 */
function passFeet(depth: number, height: number, road: Band | null, y: number): { readonly north: number; readonly south: number } {
    const north = depth + 1;
    const south = height - depth - 1;
    if (road === null) {
        return { north, south };
    }
    const above = road.y0 - north;
    const below = south - road.y1;
    const keepsAbove = (y < (road.y0 + road.y1) / 2 && above >= POOL_ROOM) || (below < POOL_ROOM && above > below);
    return keepsAbove ? { north, south: road.y0 } : { north: road.y1, south };
}

/** A whole number seed for a fresh layout. */
export function freshSeed(random: Random): number {
    return randomInt(random, 1, 999_999);
}

/** Narrowing a picker's value. */
export const isEncounterLandscape = (v: string): v is EncounterLandscape => ENCOUNTER_LANDSCAPES.some((k) => k === v);
export const isEncounterRoad = (v: string): v is EncounterRoad => ENCOUNTER_ROADS.some((k) => k === v);
export const isEncounterBridge = (v: string): v is EncounterBridge => ENCOUNTER_BRIDGES.some((k) => k === v);
export const isEncounterFeature = (v: string): v is EncounterFeature => ENCOUNTER_FEATURES.some((k) => k === v);
export const isEncounterSetting = (v: string): v is EncounterSetting => ENCOUNTER_SETTINGS.some((k) => k === v);
export const isEncounterSize = (v: string): v is EncounterSize => ENCOUNTER_SIZES.some((k) => k === v);
export const isEncounterDensity = (v: string): v is EncounterDensity => ENCOUNTER_DENSITIES.some((k) => k === v);
