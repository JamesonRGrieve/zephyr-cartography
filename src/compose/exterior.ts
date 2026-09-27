// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The outdoors of a map intent:
 * - the ground under everything, then each zone's own ground over it, its
 *   edge wandering by noise rather than drawn with a ruler;
 * - roads and rivers from anchor to anchor, meandering, a road reaching a
 *   building at its front door;
 * - what stands in each zone, scattered by Poisson disc so it is even but
 *   never gridded: clumped by noise, thinning towards the zone's edge, and
 *   kept off roads, water, buildings and clearings;
 * - rocks along riverbanks and worn earth in woods and meadows.
 * Pure and unit-tested; positions are in grid squares.
 */
import type { Rect, Side } from '../generate/floor-plan';
import { pick, type Random } from '../generate/random';
import type { SceneSpecInput } from '../generate/spec';
import { distanceToPolyline, pointInPolygon } from '../geometry/hit';
import type { Point } from '../geometry/spline';
import type { StampHabitat, StampRole } from '../stamps/schema';
import type { BiomeKind } from '../tools/biome';
import { detour, grown } from './detour';
import type { Anchor, Density, Edge, MapIntent, PathIntent, ZoneIntent, ZoneKind } from './intent';
import type { PlacedDoor } from './layout';
import { noiseField, type NoiseField } from './noise';
import { narrowed, type Preferences, zonePlace } from './preferences';
import type { ComposeProblem } from './problems';
import type { RoleIndex, RoleStamp } from './roles';
import { poissonDisc } from './scatter';

type FeatureInput = SceneSpecInput['features'][number];

/** A building as the outdoors sees it: where it stands, and its front door. */
export interface Site {
    readonly key: string | undefined;
    readonly footprint: Rect;
    readonly front: PlacedDoor | null;
}

/** How far the ground reaches past the map's edges, in squares, so no edge shows bare. */
const GROUND_MARGIN = 3;

/** Each zone's ground. */
const ZONE_GROUND: Readonly<Record<ZoneKind, BiomeKind>> = {
    woodland: 'forest',
    meadow: 'grassland',
    clearing: 'grassland',
    marsh: 'marsh',
    rocky: 'rock',
    rubble: 'dirt',
    industrial: 'rock',
    fortified: 'dirt',
    landing: 'rock',
};

/**
 * What stands in each zone: a role; how far apart, as a multiple of the
 * pieces' own size at normal density (below 1, canopies overlap); and how
 * much noise clumps it (0: evenly).
 */
interface Dressing {
    readonly role: StampRole;
    readonly spread: number;
    readonly clumping: number;
    /** Stood in a line just inside the zone's edge, fronts facing out (a perimeter), rather than scattered through it. */
    readonly perimeter?: true;
}

const ZONE_DRESSING: Readonly<Record<ZoneKind, readonly Dressing[]>> = {
    woodland: [
        { role: 'tree', spread: 0.75, clumping: 0.35 },
        { role: 'shrub', spread: 2, clumping: 0.3 },
        { role: 'log', spread: 4, clumping: 0 },
        { role: 'rock', spread: 6, clumping: 0 },
        { role: 'flora', spread: 3, clumping: 0.2 },
    ],
    meadow: [
        { role: 'flora', spread: 2, clumping: 0.4 },
        { role: 'shrub', spread: 5, clumping: 0.3 },
        { role: 'tree', spread: 3, clumping: 0.4 },
        { role: 'rock', spread: 8, clumping: 0 },
    ],
    clearing: [
        { role: 'flora', spread: 3.5, clumping: 0.3 },
        { role: 'rock', spread: 8, clumping: 0 },
    ],
    marsh: [
        { role: 'flora', spread: 1.5, clumping: 0.3 },
        { role: 'shrub', spread: 3, clumping: 0.3 },
        { role: 'log', spread: 5, clumping: 0 },
    ],
    rocky: [
        { role: 'rock', spread: 1.5, clumping: 0.35 },
        { role: 'shrub', spread: 4, clumping: 0.2 },
        { role: 'debris', spread: 5, clumping: 0 },
    ],
    rubble: [
        { role: 'debris', spread: 1.6, clumping: 0.4 },
        { role: 'crater', spread: 3, clumping: 0.2 },
        { role: 'rock', spread: 5, clumping: 0 },
    ],
    industrial: [
        { role: 'structure', spread: 1.4, clumping: 0.3 },
        { role: 'vehicle', spread: 4, clumping: 0 },
        { role: 'storage', spread: 3, clumping: 0.45 },
        { role: 'debris', spread: 4, clumping: 0.2 },
    ],
    // Guns at intervals round the perimeter, barricades closing the line between them, the camp inside.
    fortified: [
        { role: 'emplacement', spread: 5, clumping: 0, perimeter: true },
        { role: 'barricade', spread: 1.05, clumping: 0, perimeter: true },
        { role: 'structure', spread: 2, clumping: 0.2 },
        { role: 'storage', spread: 4, clumping: 0.6 },
        { role: 'crater', spread: 5, clumping: 0 },
        { role: 'debris', spread: 5, clumping: 0.2 },
    ],
    landing: [
        { role: 'vehicle', spread: 1.1, clumping: 0 },
        { role: 'storage', spread: 5, clumping: 0.7 },
        { role: 'structure', spread: 4, clumping: 0.2 },
    ],
};

/** Every role a zone of `kind` is dressed with. */
export const zoneRoles = (kind: ZoneKind): StampRole[] => ZONE_DRESSING[kind].map((d) => d.role);

/** Land roles: they dress only zones of their habitat. Anything else outdoors (works, cargo) stands on any ground. */
const LAND_ROLES: readonly StampRole[] = ['tree', 'shrub', 'rock', 'log', 'flora', 'debris'];

/**
 * Roles whose pieces must not stand on one another, or reach over a path or
 * a building. Land's canopies and litter may overlap, and a crater is a scar
 * in the ground: works stand at its lip and a road can be shelled.
 */
const SOLID_ROLES: readonly StampRole[] = ['structure', 'vehicle', 'emplacement', 'barricade', 'storage'];

/** The ground each zone's pieces belong on: a wood takes forest rocks, never stalagmites. */
const ZONE_HABITATS: Readonly<Record<ZoneKind, readonly StampHabitat[]>> = {
    woodland: ['forest'],
    meadow: ['grassland'],
    clearing: ['forest', 'grassland'],
    marsh: ['marsh'],
    rocky: ['rocky'],
    // A ruin's rocks are any open ground's: boulders and broken stone as well as the city's own wreckage.
    rubble: ['ruin', 'urban', 'rocky'],
    industrial: ['urban'],
    fortified: ['ruin', 'urban', 'rocky'],
    landing: ['urban'],
};

/** Rocks along a riverbank: any that belong outdoors on open ground. */
const BANK_HABITATS: readonly StampHabitat[] = ['forest', 'grassland', 'marsh', 'rocky'];

/** The stamps of a role that belong on any of `habitats` (any stamp of a role that is not land). */
function inHabitat(stamps: RoleIndex, role: StampRole, habitats: readonly StampHabitat[]): RoleStamp[] {
    const all = stamps.get(role) ?? [];
    return LAND_ROLES.includes(role) ? all.filter((stamp) => stamp.habitats.some((h) => habitats.includes(h))) : [...all];
}

/** The pieces' typical size: the mean of each one's longer side, in squares. */
const typicalSize = (stamps: readonly RoleStamp[]): number => stamps.reduce((sum, s) => sum + Math.max(s.width, s.height), 0) / stamps.length;

/** Roles that a clearing keeps out: it is a clearing because nothing tall grows there. */
const CLEARED: readonly StampRole[] = ['tree', 'shrub', 'log'];

/** Spacing multiplier per density. */
const DENSITY_SPACING: Readonly<Record<Density, number>> = { sparse: 1.6, normal: 1, dense: 0.7 };

/** Squares over which a zone thins out towards its edge. */
const EDGE_FADE = 2.5;

/** Squares of clear ground kept round buildings, and beside roads and rivers. */
const BUILDING_MARGIN = 1.5;
const PATH_MARGIN = 0.6;

/**
 * Squares of ground kept between a building's walls and a path passing it,
 * beyond the path's own edge: a road may run close by, but a river keeps
 * back, leaving the building its yard and its door dry.
 */
const SETBACK: Readonly<Record<PathIntent['kind'], number>> = { road: BUILDING_MARGIN, river: 3 };

/** Feature scale of the clumping noise and of a zone edge's wander, in squares. */
const CLUMP_SCALE = 6;
const EDGE_SCALE = 4;

/** How far a zone's edge wanders in or out, as a fraction of its size (circles) or in squares (edges). */
const EDGE_WANDER = { circle: 0.25, strip: 2 } as const;

/** Points round a circular zone's edge, and the step along a strip's inner edge (squares). */
const CIRCLE_POINTS = 28;
const STRIP_STEP = 2;

/** Default path widths (squares across) and the length of each meander bend. */
const PATH_WIDTH: Readonly<Record<PathIntent['kind'], number>> = { road: 1.5, river: 2 };
const BEND_LENGTH = 5;

/** How far a bend swings sideways at full meander, as a fraction of its length. */
const BEND_SWING = 0.6;

/** Where along an edge (as a fraction) a path may cross it. */
const EDGE_SPAN = [0.2, 0.8] as const;

/** Rocks along a riverbank: every so many squares, this often, this far beyond the water. */
const BANK = { step: 3, chance: 0.5, offset: 0.6 } as const;

/**
 * Worn earth: bare patches in woods and meadows, this far apart, of these
 * radii (squares). Each is a short brush stroke wandering this many steps,
 * each step up to this many radii long, so no patch is a plain disc.
 */
const WORN = { spacing: 6, chance: 0.45, radius: [0.5, 1.1] as const, steps: 3, step: 0.9 } as const;

const QUARTER = 0.25;
const FULL_TURN = 360;

type Size = Pick<MapIntent, 'width' | 'height'>;

/** A point `t` along a map edge and `d` in from it. */
const ALONG_EDGE: Readonly<Record<Edge, (size: Size, t: number, d: number) => Point>> = {
    north: (_, t, d) => ({ x: t, y: d }),
    south: ({ height }, t, d) => ({ x: t, y: height - d }),
    west: (_, t, d) => ({ x: d, y: t }),
    east: ({ width }, t, d) => ({ x: width - d, y: t }),
};

/** The zone's outline in squares. */
export function zoneOutline(zone: ZoneIntent, size: Size, noise: NoiseField): Point[] {
    const { area } = zone;
    const m = GROUND_MARGIN;
    if (area.shape === 'circle') {
        return Array.from({ length: CIRCLE_POINTS }, (_, i) => {
            const a = (i / CIRCLE_POINTS) * 2 * Math.PI;
            const r = area.radius * (1 + EDGE_WANDER.circle * (noise(Math.cos(a) * EDGE_SCALE, Math.sin(a) * EDGE_SCALE) * 2 - 1));
            return { x: area.centre.x + Math.cos(a) * r, y: area.centre.y + Math.sin(a) * r };
        });
    }
    if (area.shape === 'polygon') {
        return area.points.map((p) => ({ x: p.x, y: p.y }));
    }
    if (area.shape === 'edge') {
        return stripOutline(area.side, area.depth, size, noise);
    }
    return [
        { x: -m, y: -m },
        { x: size.width + m, y: -m },
        { x: size.width + m, y: size.height + m },
        { x: -m, y: size.height + m },
    ];
}

/** A strip along one edge, its inner edge wandering. */
function stripOutline(side: Edge, depth: number, size: Size, noise: NoiseField): Point[] {
    const m = GROUND_MARGIN;
    const along = side === 'north' || side === 'south' ? size.width : size.height;
    const at = (t: number, d: number): Point => ALONG_EDGE[side](size, t, d);
    const inner: Point[] = [];
    for (let t = -m; t <= along + m; t += STRIP_STEP) {
        inner.push(at(t, depth + EDGE_WANDER.strip * (noise(t / EDGE_SCALE, depth) * 2 - 1)));
    }
    return [at(-m, -m), ...inner, at(along + m, -m)];
}

/** Where a path's end lies: just past a map edge, at a point, or before a building's front door. */
function anchorPoint(anchor: Anchor, size: Size, sites: readonly Site[], random: Random): Point {
    if (typeof anchor === 'string') {
        const f = EDGE_SPAN[0] + random() * (EDGE_SPAN[1] - EDGE_SPAN[0]);
        const along = anchor === 'north' || anchor === 'south' ? size.width : size.height;
        // A square past the edge, so the path runs off the map.
        return ALONG_EDGE[anchor](size, f * along, -1);
    }
    if ('building' in anchor) {
        const site = sites.find((s) => s.key === anchor.building);
        return site ? frontStep(site) : { x: size.width / 2, y: size.height / 2 };
    }
    return { x: anchor.x, y: anchor.y };
}

/** The ground `out` squares outside each side of a footprint, `at` along it. */
const OUTSIDE: Readonly<Record<Side, (f: Rect, at: number, out: number) => Point>> = {
    top: (f, at, out) => ({ x: at + 0.5, y: f.y - out }),
    bottom: (f, at, out) => ({ x: at + 0.5, y: f.y + f.h + out }),
    left: (f, at, out) => ({ x: f.x - out, y: at + 0.5 }),
    right: (f, at, out) => ({ x: f.x + f.w + out, y: at + 0.5 }),
};

/** The ground `out` squares outside a building's front door (or the middle of its front, without one). */
function beforeDoor(site: Site, out: number): Point {
    const { footprint: f, front } = site;
    return front ? OUTSIDE[front.slot.side](f, front.slot.at, out) : OUTSIDE.bottom(f, f.x + f.w / 2 - 0.5, out);
}

/** The ground a step outside a building's front door, where a path to it arrives. */
const frontStep = (site: Site): Point => beforeDoor(site, BUILDING_MARGIN);

/**
 * A path's line, run on from the step before each building door it reaches
 * to the doorway itself, square to the wall, so no strip of ground is left
 * between the path and the door.
 */
function toDoors(line: readonly Point[], path: PathIntent, sites: readonly Site[]): Point[] {
    const doorway = (anchor: Anchor): Point[] => {
        const site = typeof anchor !== 'string' && 'building' in anchor ? sites.find((s) => s.key === anchor.building) : undefined;
        return site ? [beforeDoor(site, 0)] : [];
    };
    return [...doorway(path.from), ...line, ...doorway(path.to)];
}

/** A meandering centerline from `a` to `b`: bends of about `BEND_LENGTH` squares, each swung aside by up to `meander`. */
function meanderLine(a: Point, b: Point, meander: number, random: Random): Point[] {
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    const bends = Math.max(2, Math.round(span / BEND_LENGTH));
    const nx = -(b.y - a.y) / (span || 1);
    const ny = (b.x - a.x) / (span || 1);
    const points: Point[] = [a];
    for (let i = 1; i < bends; i++) {
        const t = i / bends;
        const swing = meander * (random() * 2 - 1) * (span / bends) * BEND_SWING;
        points.push({ x: a.x + (b.x - a.x) * t + nx * swing, y: a.y + (b.y - a.y) * t + ny * swing });
    }
    points.push(b);
    return points;
}

/** Whether `path` starts or ends at the front door of `site`. */
const reaches = (path: PathIntent, site: Site): boolean =>
    [path.from, path.to].some((anchor) => typeof anchor !== 'string' && 'building' in anchor && anchor.building === site.key);

/**
 * The ground a path of `halfWidth` keeps off round a building: clear of its
 * walls by the path's margin. A path to the building's own door keeps off
 * only half the building's margin, so the step before the door, where it
 * ends, stays outside.
 */
function aroundSite(site: Site, path: PathIntent, halfWidth: number): Rect {
    return grown(site.footprint, reaches(path, site) ? BUILDING_MARGIN / 2 : halfWidth + SETBACK[path.kind]);
}

interface LaidPath {
    readonly kind: PathIntent['kind'];
    readonly points: readonly Point[];
    readonly halfWidth: number;
}

/** Everything that decides whether something may stand at a point. */
interface Keepout {
    readonly map: Rect;
    readonly sites: readonly Site[];
    readonly paths: readonly LaidPath[];
    readonly clearings: readonly (readonly number[])[];
}

/** Whether nothing of `role` may stand at `p`; `reach` is how far (squares) what stands there spreads round it. */
/**
 * Whether nothing of `role` may stand at `p`. `reach` is how far (squares)
 * what stands there spreads round it, kept off buildings; `onPaths` is how
 * far of it must also stay off roads and water (a canopy may hang over a
 * road, a bunker may not stand on one).
 */
function blocked(p: Point, role: StampRole, keepout: Keepout, reach = 0, onPaths = 0): boolean {
    const { map } = keepout;
    if (p.x < map.x || p.y < map.y || p.x > map.x + map.w || p.y > map.y + map.h) {
        return true;
    }
    // A tree's canopy must not spread over a building, which the map shows open to the sky, however far off its trunk.
    const m = BUILDING_MARGIN + reach;
    if (keepout.sites.some(({ footprint: f }) => p.x > f.x - m && p.x < f.x + f.w + m && p.y > f.y - m && p.y < f.y + f.h + m)) {
        return true;
    }
    if (keepout.paths.some((path) => distanceToPolyline(p, path.points) < path.halfWidth + PATH_MARGIN + onPaths)) {
        return true;
    }
    return CLEARED.includes(role) && keepout.clearings.some((outline) => pointInPolygon(p, outline));
}

/** How far `p` lies inside `outline` (0 at or outside its edge). */
function depthInside(p: Point, outline: readonly Point[]): number {
    return distanceToPolyline(p, [...outline, ...outline.slice(0, 1)]);
}

const flat = (points: readonly Point[]): number[] => points.flatMap((p) => [p.x, p.y]);

/** Stamps for one zone's dressing, scattered over its outline. */
/** A solid piece already standing: its centre and the radius of its footprint, in squares. */
interface Standing {
    readonly x: number;
    readonly y: number;
    readonly r: number;
}

/** The radius of a piece's footprint however it is turned. */
const footprintRadius = (stamp: RoleStamp): number => Math.hypot(stamp.width, stamp.height) / 2;

function dress(
    zone: ZoneIntent,
    outline: readonly Point[],
    dressing: Dressing,
    keepout: Keepout,
    choices: readonly RoleStamp[],
    standing: Standing[],
    random: Random,
): FeatureInput[] {
    if (choices.length === 0) {
        return [];
    }
    const polygon = flat(outline);
    const clump = noiseField(random, CLUMP_SCALE);
    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    const bounds: Rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    const size = typicalSize(choices);
    const spacing = dressing.spread * size * DENSITY_SPACING[zone.density];
    const accept = (p: Point): boolean =>
        pointInPolygon(p, polygon) &&
        !blocked(p, dressing.role, keepout, size / 2) &&
        // Clumped: where the noise is low, fewer stand.
        clump(p.x, p.y) >= dressing.clumping * random() &&
        // Thinning towards the zone's edge.
        Math.min(1, depthInside(p, outline) / EDGE_FADE) >= random() * QUARTER * 2;
    const solid = SOLID_ROLES.includes(dressing.role);
    return poissonDisc(bounds, spacing, accept, random).flatMap((p) => {
        const stamp = pick(random, choices);
        if (!stamp) {
            return [];
        }
        if (solid) {
            // A solid piece, however big, keeps its whole footprint off paths, buildings and every other solid piece.
            const r = footprintRadius(stamp);
            if (blocked(p, dressing.role, keepout, r, r) || standing.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < s.r + r)) {
                return [];
            }
            standing.push({ x: p.x, y: p.y, r });
        }
        // Drawn side-on, it stands as drawn; seen from above, any way round.
        return [{ type: 'stamp' as const, stamp: stamp.key, x: p.x, y: p.y, rotation: stamp.upright ? 0 : Math.floor(random() * FULL_TURN) }];
    });
}

/** Squares a perimeter piece stands inside the zone's edge, beyond half its own depth. */
const PERIMETER_INSET = 0.3;

/** The mean of a polygon's points: what a perimeter faces away from. */
function centreOf(outline: readonly Point[]): Point {
    return { x: outline.reduce((s, p) => s + p.x, 0) / outline.length, y: outline.reduce((s, p) => s + p.y, 0) / outline.length };
}

/**
 * The rotation (degrees clockwise) that turns a piece's front, the side
 * away from its back (image bottom once its turn brings its back up), to
 * face along `out`.
 */
function facing(out: Point, turn: number): number {
    const degrees = (Math.atan2(-out.x, out.y) * (FULL_TURN / 2)) / Math.PI;
    return (((Math.round(degrees) + turn) % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

/**
 * Defences stood along the zone's edge, just inside it, every so many
 * squares, each front facing out from the zone's middle and its length along
 * the edge. Where a road, a building or another solid piece is in the way the
 * line breaks: a gate.
 */
function perimeter(
    outline: readonly Point[],
    dressing: Dressing,
    keepout: Keepout,
    choices: readonly RoleStamp[],
    standing: Standing[],
    random: Random,
): FeatureInput[] {
    const centre = centreOf(outline);
    const ring = [...outline, ...outline.slice(0, 1)];
    const out: FeatureInput[] = [];
    let carry = 0;
    let stamp = pick(random, choices);
    ring.reduce((a, b) => {
        const span = Math.hypot(b.x - a.x, b.y - a.y);
        for (let t = carry; stamp && t < span; ) {
            const step = dressing.spread * Math.max(stamp.width, stamp.height);
            const edge = { x: a.x + ((b.x - a.x) * t) / span, y: a.y + ((b.y - a.y) * t) / span };
            const toCentre = { x: centre.x - edge.x, y: centre.y - edge.y };
            const distance = Math.hypot(toCentre.x, toCentre.y) || 1;
            const inset = stamp.height / 2 + PERIMETER_INSET;
            const p = { x: edge.x + (toCentre.x / distance) * inset, y: edge.y + (toCentre.y / distance) * inset };
            const r = footprintRadius(stamp);
            const clear = !blocked(p, dressing.role, keepout, r, r) && !standing.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < s.r + r);
            if (clear) {
                standing.push({ x: p.x, y: p.y, r: Math.max(stamp.width, stamp.height) / 2 });
                out.push({ type: 'stamp', stamp: stamp.key, x: p.x, y: p.y, rotation: facing({ x: -toCentre.x, y: -toCentre.y }, stamp.turn) });
                stamp = pick(random, choices);
            }
            t += step;
            carry = t - span;
        }
        return b;
    });
    return out;
}

/** Rocks strewn along each river's banks. */
function banks(paths: readonly LaidPath[], keepout: Keepout, stamps: RoleIndex, random: Random): FeatureInput[] {
    const rocks = inHabitat(stamps, 'rock', BANK_HABITATS);
    if (rocks.length === 0) {
        return [];
    }
    return paths
        .filter((p) => p.kind === 'river')
        .flatMap((river) => {
            const out: FeatureInput[] = [];
            // Each stretch between control points, a rock every few squares on one bank or the other.
            river.points.reduce((a, b) => {
                const span = Math.hypot(b.x - a.x, b.y - a.y) || 1;
                const ux = (b.x - a.x) / span;
                const uy = (b.y - a.y) / span;
                for (let t = 0; t < span; t += BANK.step) {
                    const aside = (river.halfWidth + BANK.offset) * (random() < QUARTER * 2 ? 1 : -1);
                    const p = { x: a.x + ux * t - uy * aside, y: a.y + uy * t + ux * aside };
                    const stamp = pick(random, rocks);
                    const clearOfBuildings = !blocked(p, 'rock', { ...keepout, paths: [] });
                    if (stamp && clearOfBuildings && random() < BANK.chance) {
                        out.push({ type: 'stamp', stamp: stamp.key, x: p.x, y: p.y, rotation: Math.floor(random() * FULL_TURN) });
                    }
                }
                return b;
            });
            return out;
        });
}

/** Bare, worn patches of earth in woods and meadows. */
function wornEarth(zone: ZoneIntent, outline: readonly Point[], keepout: Keepout, random: Random): FeatureInput[] {
    if (zone.kind !== 'woodland' && zone.kind !== 'meadow') {
        return [];
    }
    const polygon = flat(outline);
    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    const bounds: Rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    // A clearing's grass is unbroken: it keeps worn earth out as it keeps out logs.
    const accept = (p: Point): boolean => pointInPolygon(p, polygon) && !blocked(p, 'log', keepout) && random() < WORN.chance;
    return poissonDisc(bounds, WORN.spacing, accept, random).map((p) => {
        const radius = WORN.radius[0] + random() * (WORN.radius[1] - WORN.radius[0]);
        return { type: 'stroke' as const, biome: 'dirt' as const, radius, points: wander(p, radius, random) };
    });
}

/** A short wandering line from `start`, each step turning a little from the last. */
function wander(start: Point, radius: number, random: Random): Point[] {
    const points = [start];
    let heading = random() * Math.PI * 2;
    for (let i = 0; i < WORN.steps; i++) {
        const last = points.at(-1) ?? start;
        heading += (random() * 2 - 1) * QUARTER * Math.PI;
        const stride = radius * WORN.step * (QUARTER * 2 + random() * QUARTER * 2);
        points.push({ x: last.x + Math.cos(heading) * stride, y: last.y + Math.sin(heading) * stride });
    }
    return points;
}

/** A region's texture field: the role given, or none for its biome's own. */
const textured = (texture: string | null): { texture?: string } => (texture === null ? {} : { texture });

/** The outdoors of `intent` around `sites`: ground, zones, paths and what stands among them. */
export function composeExterior(
    intent: MapIntent,
    sites: readonly Site[],
    stamps: RoleIndex,
    random: Random,
    preferences: Preferences,
): { features: FeatureInput[]; problems: ComposeProblem[] } {
    const features: FeatureInput[] = [];
    const problems: ComposeProblem[] = [];
    if (intent.ground !== null) {
        const everywhere: ZoneIntent = { kind: 'meadow', area: { shape: 'everywhere' }, density: 'normal', texture: null };
        const points = zoneOutline(everywhere, intent, noiseField(random, EDGE_SCALE));
        features.push({ type: 'region', biome: intent.ground, points, ...textured(intent.groundTexture) });
    }
    const outlines = intent.zones.map((zone) => ({ zone, outline: zoneOutline(zone, intent, noiseField(random, EDGE_SCALE)) }));
    for (const { zone, outline } of outlines) {
        features.push({ type: 'region', biome: ZONE_GROUND[zone.kind], points: outline, ...textured(zone.texture) });
    }
    const paths: LaidPath[] = intent.paths.map((path) => {
        const halfWidth = (path.width ?? PATH_WIDTH[path.kind]) / 2;
        const line = meanderLine(anchorPoint(path.from, intent, sites, random), anchorPoint(path.to, intent, sites, random), path.meander, random);
        return {
            kind: path.kind,
            halfWidth,
            points: toDoors(
                detour(
                    line,
                    sites.map((site) => aroundSite(site, path, halfWidth)),
                ),
                path,
                sites,
            ),
        };
    });
    const keepout: Keepout = {
        map: { x: 0, y: 0, w: intent.width, h: intent.height },
        sites,
        paths,
        clearings: outlines.filter(({ zone }) => zone.kind === 'clearing').map(({ outline }) => flat(outline)),
    };
    for (const { zone, outline } of outlines) {
        features.push(...wornEarth(zone, outline, keepout, random));
    }
    intent.paths.forEach((path, i) => {
        const laid = paths[i];
        if (laid) {
            features.push({
                type: 'path',
                kind: path.kind,
                points: [...laid.points],
                halfWidth: laid.halfWidth,
                ...(path.liquid === undefined ? {} : { liquid: path.liquid }),
            });
        }
    });
    // Solid pieces of every zone keep clear of one another; each zone's dressing lists its largest works first, so they stand first.
    const standing: Standing[] = [];
    outlines.forEach(({ zone, outline }, i) => {
        for (const dressing of ZONE_DRESSING[zone.kind]) {
            const choices = narrowed(inHabitat(stamps, dressing.role, ZONE_HABITATS[zone.kind]), preferences.get(zonePlace(i))?.get(dressing.role));
            if (choices.length === 0) {
                problems.push({ kind: 'no-stamp', role: dressing.role, wantedIn: zone.kind });
            }
            features.push(
                ...(dressing.perimeter
                    ? perimeter(outline, dressing, keepout, choices, standing, random)
                    : dress(zone, outline, dressing, keepout, choices, standing, random)),
            );
        }
    });
    features.push(...banks(paths, keepout, stamps, random));
    return { features, problems };
}
