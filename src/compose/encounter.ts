// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Throwaway encounter maps (operator 2026-11-04: "a wide variety of throwaway encounter maps. An encounter map generator
 * in the cartography module"): a kind of place, a setting, a size, a density and a seed become a map intent the
 * composer builds like any other. Pure and seeded: the same choices and seed always give the same map, another seed
 * another layout of the same place. The intent is the GM's to edit after, as a preset's is.
 */

import { randomInt, type Random, seededRandom } from '../generate/random';

/** The places an encounter can be fought in. */
export const ENCOUNTER_KINDS = ['road', 'crossroads', 'ford', 'clearing', 'ruins', 'camp', 'marsh', 'pass', 'wreck', 'cave'] as const;
export type EncounterKind = (typeof ENCOUNTER_KINDS)[number];

/** The worlds an encounter is drawn for: its stamps' settings, its ground and its light. */
export const ENCOUNTER_SETTINGS = ['feudal', 'grimdark', 'warp', 'scifi'] as const;
export type EncounterSetting = (typeof ENCOUNTER_SETTINGS)[number];

/** How large a map: squares across and down. */
export const ENCOUNTER_SIZES = ['small', 'medium', 'large'] as const;
export type EncounterSize = (typeof ENCOUNTER_SIZES)[number];

/** How thickly its ground is dressed. */
export const ENCOUNTER_DENSITIES = ['sparse', 'normal', 'dense'] as const;
export type EncounterDensity = (typeof ENCOUNTER_DENSITIES)[number];

export interface EncounterChoice {
    readonly kind: EncounterKind;
    readonly setting: EncounterSetting;
    readonly size: EncounterSize;
    readonly density: EncounterDensity;
    readonly seed: number;
}

const SIZES: Readonly<Record<EncounterSize, { readonly width: number; readonly height: number }>> = {
    small: { width: 24, height: 18 },
    medium: { width: 32, height: 24 },
    large: { width: 44, height: 30 },
};

interface SettingLook {
    /** Stamp settings: art carrying any of these (a faction named here brings its own art in). */
    readonly settings: readonly string[];
    /** The open ground. */
    readonly ground: string;
    /** What stands where a place is built up: ruined walls, a works yard. */
    readonly ruin: 'rubble' | 'industrial';
    /** Woods, where this world grows any. */
    readonly wood: 'woodland' | 'rocky';
    readonly lighting: 'day' | 'night';
    /** Whether its art has a bridge for a road over a river. */
    readonly bridged: boolean;
}

// The feudal world's woods and grass; the Imperium's ash and works; the warp's corrupted night; a frontier world's rock.
const LOOKS: Readonly<Record<EncounterSetting, SettingLook>> = {
    feudal: { settings: ['setting-fantasy', 'setting-generic'], ground: 'grassland', ruin: 'rubble', wood: 'woodland', lighting: 'day', bridged: true },
    grimdark: { settings: ['setting-grimdark-human', 'setting-generic'], ground: 'ash', ruin: 'industrial', wood: 'rocky', lighting: 'day', bridged: true },
    warp: {
        settings: ['setting-grimdark-chaotic', 'setting-grimdark-human', 'setting-generic'],
        ground: 'ash',
        ruin: 'rubble',
        wood: 'rocky',
        lighting: 'night',
        bridged: true,
    },
    scifi: { settings: ['setting-scifi', 'setting-generic'], ground: 'rock', ruin: 'industrial', wood: 'rocky', lighting: 'day', bridged: false },
};

/** The dark round a cave's passages. */
const CAVE_BACKDROP = '#0c0b0a';

/** A cave's chambers: how many, and their size range in squares. */
const CAVE_CHAMBERS = { min: 4, max: 7, smallest: 4, largest: 8 } as const;

/** Squares kept clear of the map's edge for a feature's centre. */
const MARGIN = 4;

type Side = 'north' | 'south' | 'east' | 'west';

interface Point {
    readonly x: number;
    readonly y: number;
}

/** A point at random inside the map, clear of its edge by `margin`, rounded to a tenth of a square. */
function inside(random: Random, width: number, height: number, margin = MARGIN): Point {
    const round = (v: number): number => Math.round(v * 10) / 10;
    return { x: round(margin + random() * (width - 2 * margin)), y: round(margin + random() * (height - 2 * margin)) };
}

/** A whole number of squares between `min` and `max`, both inclusive, scaled to the map. */
const scaled = (random: Random, min: number, max: number, scale: number): number => Math.max(1, Math.round(randomInt(random, min, max) * scale));

/** Squares of map per cluster of wreckage or ruin: a small map holds three, a large one seven. */
const SQUARES_PER_CLUSTER = 180;

/** Clusters of `kinds` (taking turns) spread over the map by its area, the first the largest and densest. */
function clusters(random: Random, width: number, height: number, kinds: readonly string[], density: EncounterDensity): readonly object[] {
    const count = Math.max(3, Math.round((width * height) / SQUARES_PER_CLUSTER));
    const largest = Math.min(width, height) / 3.5;
    return Array.from({ length: count }, (_, i) => ({
        kind: kinds[i % kinds.length] ?? 'rubble',
        area: circle(inside(random, width, height), Math.max(2, largest * (i === 0 ? 1 : 0.45 + random() * 0.4))),
        density: i === 0 ? density : 'sparse',
    }));
}

/** A road from one edge to the other passing through `via`. */
function through(from: Side, to: Side, via: Point, width: number, meander: number): object {
    return { kind: 'road', from, to, via: [via], width, meander };
}

/** Each kind's ground, zones, ways and passages, for one map. */
type Build = (random: Random, look: SettingLook, width: number, height: number, density: EncounterDensity) => object;

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

const BUILDS: Readonly<Record<EncounterKind, Build>> = {
    // A road through cover: woods (or rock) close on both sides, a few boulders to hide behind.
    road: (random, look, width, height, density) => {
        const across = random() < 0.5;
        const [a, b]: readonly [Side, Side] = across ? ['west', 'east'] : ['north', 'south'];
        const sides: readonly [Side, Side] = across ? ['north', 'south'] : ['west', 'east'];
        const depth = (across ? height : width) / 3;
        return {
            zones: [
                ...sides.map((side) => ({ kind: look.wood, area: edgeStrip(side, Math.round(depth)), density })),
                { kind: 'rocky', area: circle(inside(random, width, height), scaled(random, 2, 3, 1)), density: 'sparse' },
            ],
            paths: [{ kind: 'road', from: a, to: b, meander: 0.3 + random() * 0.4 }],
        };
    },
    // Two ways crossing in open ground, cover in the corners.
    crossroads: (random, look, width, height, density) => ({
        zones: [
            { kind: 'meadow', area: circle({ x: width / 2, y: height / 2 }, Math.min(width, height) / 4), density: 'sparse' },
            ...(['north', 'south'] as const).map((side) => ({ kind: look.wood, area: edgeStrip(side, Math.round(height / 5)), density })),
        ],
        paths: [
            { kind: 'road', from: 'west', to: 'east', meander: 0.2 + random() * 0.3 },
            { kind: 'road', from: 'north', to: 'south', meander: 0.2 + random() * 0.3 },
        ],
    }),
    // A river across the way: the road bridged where they meet, cover along the banks.
    ford: (random, look, width, _height, density) => ({
        zones: [
            { kind: look.wood, area: edgeStrip('west', Math.round(width / 4)), density },
            { kind: look.wood, area: edgeStrip('east', Math.round(width / 5)), density: 'sparse' },
        ],
        paths: [
            { kind: 'river', from: 'north', to: 'south', width: 2 + random() * 2, meander: 0.4 + random() * 0.3 },
            // A frontier world has no bridge art: there the river is waded, with no road to bridge it.
            ...(look.bridged ? [{ kind: 'road', from: 'west', to: 'east', meander: 0.2 + random() * 0.2 }] : []),
        ],
    }),
    // Open ground ringed by cover, something left in the middle of it.
    clearing: (random, look, width, height, density) => {
        const centre = { x: width / 2 + (random() - 0.5) * 4, y: height / 2 + (random() - 0.5) * 4 };
        const radius = Math.min(width, height) / 3;
        return {
            zones: [
                { kind: look.wood, area: { shape: 'everywhere' }, density },
                { kind: 'clearing', area: circle(centre, radius) },
                { kind: random() < 0.5 ? look.ruin : 'rocky', area: circle(centre, radius / 2), density: 'sparse' },
            ],
            // The track runs through the clearing and on out of the woods, never stopping in the open (judge: dead end).
            paths: [random() < 0.5 ? through('south', 'north', centre, 1.2, 0.4) : through('west', 'east', centre, 1.2, 0.4)],
        };
    },
    // Broken walls and fallen stone over a stretch of open ground.
    // Broken walls and fallen stone in clusters over the whole map, more on a larger one (2026-11-04: two clusters left
    // a large map bare), a works yard's machinery among the rubble where the world has one.
    ruins: (random, look, width, height, density) => ({
        zones: [
            ...clusters(random, width, height, ['rubble', look.ruin], density),
            { kind: look.wood, area: edgeStrip(random() < 0.5 ? 'north' : 'south', Math.round(height / 5)), density: 'sparse' },
        ],
        paths: [{ kind: 'road', from: 'west', to: 'east', width: 1.2, meander: 0.5 }],
    }),
    // A fortified camp, its lines facing out, a way in.
    camp: (random, look, width, height, density) => {
        const centre = inside(random, width, height, Math.min(width, height) / 3);
        return {
            zones: [
                { kind: 'fortified', area: circle(centre, Math.min(width, height) / 3.2), density },
                { kind: look.wood, area: edgeStrip('north', Math.round(height / 6)), density: 'sparse' },
            ],
            paths: [through('south', 'north', centre, 1.5, 0.3)],
        };
    },
    // Bog and pools, one causeway across.
    marsh: (random, look, width, height, density) => ({
        ground: look.ground === 'grassland' ? 'marsh' : look.ground,
        zones: [
            { kind: 'marsh', area: { shape: 'everywhere' }, density },
            { kind: 'lake', key: 'pool', area: circle(inside(random, width, height), scaled(random, 2, 4, 1)) },
            { kind: look.wood, area: edgeStrip(random() < 0.5 ? 'east' : 'west', Math.round(width / 6)), density: 'sparse' },
        ],
        paths: [{ kind: 'road', from: 'west', to: 'east', width: 1.2, meander: 0.2 }],
    }),
    // A narrow way between heights of rock.
    pass: (random, _look, width, height, density) => ({
        zones: [
            { kind: 'rocky', area: edgeStrip('north', Math.round(height * (0.3 + random() * 0.1))), density: 'dense' },
            { kind: 'rocky', area: edgeStrip('south', Math.round(height * (0.3 + random() * 0.1))), density: 'dense' },
            { kind: 'rocky', area: circle(inside(random, width, height), 2), density },
        ],
        paths: [{ kind: 'road', from: 'west', to: 'east', width: 1.2, meander: 0.6 }],
    }),
    // A crash or a fight's leavings strewn over open ground.
    wreck: (random, look, width, height, density) => ({
        zones: [
            ...clusters(random, width, height, look.ruin === 'industrial' ? ['rubble', 'landing'] : ['rubble'], density),
            { kind: look.wood, area: edgeStrip(random() < 0.5 ? 'east' : 'west', Math.round(width / 6)), density: 'sparse' },
        ],
    }),
    // Chambers cut through rock, joined by winding passages, one way out off the map.
    cave: (random, _look, width, height) => {
        const count = randomInt(random, CAVE_CHAMBERS.min, CAVE_CHAMBERS.max);
        const chambers = Array.from({ length: count }, () => ({
            centre: inside(random, width, height),
            width: randomInt(random, CAVE_CHAMBERS.smallest, CAVE_CHAMBERS.largest),
            height: randomInt(random, CAVE_CHAMBERS.smallest, CAVE_CHAMBERS.largest),
        }));
        // Each chamber joined to the one before it, so the whole cave is one network; the first opens off the map.
        const passages = chambers.slice(1).map((chamber, i) => ({ points: [chambers[i]?.centre ?? chamber.centre, chamber.centre], width: 2 }));
        const first = chambers[0]?.centre ?? { x: width / 2, y: height / 2 };
        const exit = { points: [first, { x: -1, y: first.y }], width: 2 };
        return {
            ground: null,
            backdrop: CAVE_BACKDROP,
            hewn: [{ floor: 'floor.cave-floor', wall: 'wall.rock', roughness: 0.5, chambers, passages: [exit, ...passages] }],
        };
    },
};

/** The map intent for an encounter, as a preset's is: an object the GM edits as JSON and the composer builds. */
export function encounterIntent(choice: EncounterChoice): object {
    const look = LOOKS[choice.setting];
    const { width, height } = SIZES[choice.size];
    const random = seededRandom(choice.seed);
    const built = BUILDS[choice.kind](random, look, width, height, choice.density);
    const lighting = choice.kind === 'cave' ? 'dim' : look.lighting;
    return { schemaVersion: 1, seed: choice.seed, width, height, settings: [...look.settings], ground: look.ground, lighting, ...built };
}

/** A whole number seed for a fresh layout. */
export function freshSeed(random: Random): number {
    return randomInt(random, 1, 999_999);
}

/** An encounter whose every choice is rolled: a surprise. */
export function randomEncounter(random: Random): EncounterChoice {
    const pick = <T>(items: readonly T[], fallback: T): T => items[Math.floor(random() * items.length)] ?? fallback;
    return {
        kind: pick(ENCOUNTER_KINDS, 'road'),
        setting: pick(ENCOUNTER_SETTINGS, 'feudal'),
        size: pick(ENCOUNTER_SIZES, 'medium'),
        density: pick(ENCOUNTER_DENSITIES, 'normal'),
        seed: freshSeed(random),
    };
}

/** Narrowing a picker's value. */
export const isEncounterKind = (v: string): v is EncounterKind => ENCOUNTER_KINDS.some((k) => k === v);
export const isEncounterSetting = (v: string): v is EncounterSetting => ENCOUNTER_SETTINGS.some((k) => k === v);
export const isEncounterSize = (v: string): v is EncounterSize => ENCOUNTER_SIZES.some((k) => k === v);
export const isEncounterDensity = (v: string): v is EncounterDensity => ENCOUNTER_DENSITIES.some((k) => k === v);
