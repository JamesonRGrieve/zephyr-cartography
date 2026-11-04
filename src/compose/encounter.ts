// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Throwaway encounter maps (operator 2026-11-04: "a wide variety of throwaway encounter maps. An encounter map generator
 * in the cartography module"), built from a checklist (operator, the same day: "Landscape type (forest, plains, desert,
 * marsh, etc), River with optional bridge type, road / crossroad, etc"): a landscape, a road, the features ticked, a
 * setting, a size, a density and a seed become a map intent the composer builds like any other. Pure and seeded: the
 * same checklist and seed always give the same map, another seed another layout. The intent is the GM's to edit after.
 */

import { randomInt, type Random, seededRandom, shuffled } from '../generate/random';

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
    /** Whether its art has a bridge for a road over a river; where not, "any bridge" is a ford. */
    readonly bridged: boolean;
}

// The feudal world's woods and stone; the Imperium's works; the warp's corrupted night; a frontier world's works.
const LOOKS: Readonly<Record<EncounterSetting, SettingLook>> = {
    feudal: { settings: ['setting-fantasy', 'setting-generic'], ruin: 'rubble', lighting: 'day', bridged: true },
    grimdark: { settings: ['setting-grimdark-human', 'setting-generic'], ruin: 'industrial', lighting: 'day', bridged: true },
    warp: { settings: ['setting-grimdark-chaotic', 'setting-grimdark-human', 'setting-generic'], ruin: 'rubble', lighting: 'night', bridged: true },
    scifi: { settings: ['setting-scifi', 'setting-generic'], ruin: 'industrial', lighting: 'day', bridged: false },
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
    }));
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
            ...Array.from({ length: randomInt(random, 1, 2) }, () => ({ kind: 'lake', area: circle(inside(random, w, h), randomInt(random, 2, 3)) })),
        ],
    },
    tundra: {
        ground: 'snow',
        covered: false,
        zones: (random, w, h, density) => [...clusters(random, w, h, ['rocky'], 'sparse'), ...copses(random, w, h, density, randomInt(random, 1, 2))],
    },
    wasteland: { ground: 'ash', covered: false, zones: (random, w, h, density) => clusters(random, w, h, ['rubble', 'rocky'], density) },
};

/** A cave's chambers: how many, and their size range in squares. */
const CAVE_CHAMBERS = { min: 4, max: 7, smallest: 4, largest: 8 } as const;
const CAVE_BACKDROP = '#0c0b0a';

/** Chambers cut through rock, each joined to the one before, the first opening off the map. */
function cave(random: Random, width: number, height: number): object {
    const count = randomInt(random, CAVE_CHAMBERS.min, CAVE_CHAMBERS.max);
    const chambers = Array.from({ length: count }, () => ({
        centre: inside(random, width, height),
        width: randomInt(random, CAVE_CHAMBERS.smallest, CAVE_CHAMBERS.largest),
        height: randomInt(random, CAVE_CHAMBERS.smallest, CAVE_CHAMBERS.largest),
    }));
    const passages = chambers.slice(1).map((chamber, i) => ({ points: [chambers[i]?.centre ?? chamber.centre, chamber.centre], width: 2 }));
    const first = chambers[0]?.centre ?? { x: width / 2, y: height / 2 };
    const exit = { points: [first, { x: -1, y: first.y }], width: 2 };
    return {
        ground: null,
        backdrop: CAVE_BACKDROP,
        hewn: [{ floor: 'floor.cave-floor', wall: 'wall.rock', roughness: 0.5, chambers, passages: [exit, ...passages] }],
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

/** The map intent for an encounter, as a preset's is: an object the GM edits as JSON and the composer builds. */
export function encounterIntent(choice: EncounterChoice): object {
    const look = LOOKS[choice.setting];
    const { width, height } = SIZES[choice.size];
    const random = seededRandom(choice.seed);
    const base = { schemaVersion: 1, seed: choice.seed, width, height, settings: [...look.settings] };
    if (choice.landscape === 'cave') {
        return { ...base, lighting: 'dim', ...cave(random, width, height) };
    }
    const land = LANDSCAPES[choice.landscape];
    const has = (feature: EncounterFeature): boolean => choice.features.includes(feature);
    const spots = sites(random, width, height);
    const take = (): Point => spots.shift() ?? { x: width / 2, y: height / 2 };
    const span = Math.min(width, height);
    const zones: object[] = land.zones(random, width, height, choice.density);
    const paths: object[] = [];
    // On covered ground a feature stands in a clearing of its own.
    const opened = (at: Point, radius: number): void => {
        if (land.covered) {
            zones.push({ kind: 'clearing', area: circle(at, radius + 1) });
        }
    };
    if (has('cliffs')) {
        // Heights of rock along both long sides, the way between them a pass.
        zones.push({ kind: 'rocky', area: edgeStrip('north', Math.round(height * 0.28)), density: 'dense' });
        zones.push({ kind: 'rocky', area: edgeStrip('south', Math.round(height * 0.28)), density: 'dense' });
    }
    if (has('lake')) {
        const at = take();
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
    if (has('river')) {
        // Down the map, out of the lake where there is one; a road crossing it is bridged (or forded) as asked.
        const x = Math.round(width * (0.35 + random() * 0.3));
        paths.push({
            kind: 'river',
            from: has('lake') ? { zone: 'lake' } : { x, y: -1 },
            to: { x: x + randomInt(random, -3, 3), y: height + 1 },
            width: Math.round((2 + random() * 1.5) * 10) / 10,
            meander: 0.4,
        });
    }
    // A frontier world has no bridge art: its rivers are forded unless a kind is asked for.
    const bridge = choice.bridge === 'any' && !look.bridged ? false : BRIDGE[choice.bridge];
    const road = (from: Side, to: Side, via: Point | null): object => ({
        kind: 'road',
        from,
        to,
        ...(via ? { via: [via] } : {}),
        meander: Math.round((0.3 + random() * 0.3) * 100) / 100,
        ...(bridge === undefined ? {} : { bridge }),
    });
    // The road runs through the camp's gate where there is one: it is what the camp holds.
    if (choice.road !== 'none') {
        paths.push(road('west', 'east', campAt));
    }
    if (choice.road === 'crossroads') {
        paths.push(road('south', 'north', null));
    }
    return { ...base, ground: land.ground, lighting: look.lighting, zones, paths };
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
