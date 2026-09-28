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
import { pick, shuffled, type Random } from '../generate/random';
import type { SceneSpecInput } from '../generate/spec';
import { distanceToPolyline, pointInPolygon } from '../geometry/hit';
import type { Point } from '../geometry/spline';
import type { StampHabitat, StampRole } from '../stamps/schema';
import type { BiomeKind } from '../tools/biome';
import { detour, grown } from './detour';
import type { Anchor, Density, Edge, MapIntent, PathIntent, PropIntent, ZoneIntent, ZoneKind } from './intent';
import type { PlacedDoor } from './layout';
import { noiseField, type NoiseField } from './noise';
import { narrowed, type Preferences, zonePlace } from './preferences';
import type { ComposeProblem } from './problems';
import type { RoleIndex, RoleStamp } from './roles';
import { poissonDisc } from './scatter';

type FeatureInput = SceneSpecInput['features'][number];

/** A building as the outdoors sees it: where it stands, its front door, and what it has outside its walls (a storm door's areaway). */
export interface Site {
    readonly key: string | undefined;
    readonly footprint: Rect;
    readonly front: PlacedDoor | null;
    readonly annexes: readonly Rect[];
    /** A working yard round it: stores against its walls, a cart standing by. */
    readonly yard: boolean;
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
    lake: 'water',
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
    /**
     * Grown in patches: each spot `spread` apart is a patch of between these
     * many pieces close together, open ground between patches, as flowers and
     * ground cover grow, never dotted evenly over the grass.
     */
    readonly patch?: readonly [number, number];
}

/** How far a patch's pieces lie from its middle, in the pieces' typical size. */
const PATCH_REACH = 1.1;

const ZONE_DRESSING: Readonly<Record<ZoneKind, readonly Dressing[]>> = {
    woodland: [
        { role: 'tree', spread: 0.75, clumping: 0.35 },
        { role: 'shrub', spread: 2, clumping: 0.3 },
        { role: 'log', spread: 4, clumping: 0 },
        { role: 'rock', spread: 6, clumping: 0 },
        { role: 'flora', spread: 6, clumping: 0.2, patch: [2, 4] },
    ],
    meadow: [
        { role: 'flora', spread: 5, clumping: 0.4, patch: [3, 6] },
        { role: 'shrub', spread: 5, clumping: 0.3 },
        { role: 'tree', spread: 3, clumping: 0.4 },
        { role: 'rock', spread: 8, clumping: 0 },
    ],
    clearing: [
        { role: 'flora', spread: 6, clumping: 0.3, patch: [3, 5] },
        { role: 'rock', spread: 8, clumping: 0 },
    ],
    marsh: [
        { role: 'flora', spread: 3.5, clumping: 0.3, patch: [3, 6] },
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
    // Open water: nothing stands in it; its shore is dressed instead.
    lake: [],
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
const SOLID_ROLES: readonly StampRole[] = ['structure', 'vehicle', 'emplacement', 'barricade', 'storage', 'well'];

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
    lake: ['marsh'],
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

/** How much of its reach a canopy may spread over open water: a little overhang at the shore, not a lid on the lake. */
const WATER_OVERHANG = 0.5;

/** The ground under open water, showing through it as a riverbed does. */
const LAKE_BED: BiomeKind = 'dirt';

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
const QUARTER_TURN = 90;

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

/** Where a path's end lies: just past a map edge, at a point, or before a building's front door; null for a zone, which depends on the other end. */
function fixedPoint(anchor: Anchor, size: Size, sites: readonly Site[], random: Random): Point | null {
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
    if ('zone' in anchor) {
        return null;
    }
    return { x: anchor.x, y: anchor.y };
}

/**
 * Squares inside a zone's edge a path from it starts, past the reach of its
 * own bed: a river runs out of the lake, its square end and banks (about
 * twice its half width to each side) wholly under the water, never cut
 * across the shore.
 */
const ZONE_END_INSET = 1;

/** A zone end: the point of its outline nearest `toward`, far enough inside it to hide a path `halfWidth` wide ending there. */
function zoneEnd(outline: readonly Point[], toward: Point, halfWidth: number): Point {
    const centre = centreOf(outline);
    const nearest = outline.reduce((best, p) => (Math.hypot(p.x - toward.x, p.y - toward.y) < Math.hypot(best.x - toward.x, best.y - toward.y) ? p : best));
    const span = Math.hypot(centre.x - nearest.x, centre.y - nearest.y) || 1;
    // Never past the zone's middle, however wide the path.
    const inset = Math.min(ZONE_END_INSET + 2 * halfWidth, span);
    return { x: nearest.x + ((centre.x - nearest.x) / span) * inset, y: nearest.y + ((centre.y - nearest.y) / span) * inset };
}

/** Both ends of `path`: its fixed ends first, then any at a zone, at the edge nearest the other end. */
function pathEnds(path: PathIntent, size: Size, sites: readonly Site[], zones: ReadonlyMap<string, readonly Point[]>, random: Random): [Point, Point] {
    const middle = { x: size.width / 2, y: size.height / 2 };
    const outlineOf = (anchor: Anchor): readonly Point[] | undefined => (typeof anchor === 'object' && 'zone' in anchor ? zones.get(anchor.zone) : undefined);
    const fixedFrom = fixedPoint(path.from, size, sites, random);
    const fixedTo = fixedPoint(path.to, size, sites, random);
    const fromOutline = outlineOf(path.from);
    const toOutline = outlineOf(path.to);
    const halfWidth = (path.width ?? PATH_WIDTH[path.kind]) / 2;
    const from = fixedFrom ?? (fromOutline ? zoneEnd(fromOutline, fixedTo ?? (toOutline ? centreOf(toOutline) : middle), halfWidth) : middle);
    const to = fixedTo ?? (toOutline ? zoneEnd(toOutline, from, halfWidth) : middle);
    return [from, to];
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
    return grown(siteBounds(site), reaches(path, site) ? BUILDING_MARGIN / 2 : halfWidth + SETBACK[path.kind]);
}

/** What a building covers outside: its footprint and its annexes. */
const siteRects = (site: Site): readonly Rect[] => [site.footprint, ...site.annexes];

/** The box round everything a building covers. */
function siteBounds(site: Site): Rect {
    const rects = siteRects(site);
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
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
    /** Open water (lakes): nothing stands in it, and a canopy reaches only a little over it. */
    readonly waters: readonly (readonly Point[])[];
    /** Pieces the intent stood outside (a well), kept clear by everything scattered after them. */
    readonly props: readonly Standing[];
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
    const near = (f: Rect): boolean => p.x > f.x - m && p.x < f.x + f.w + m && p.y > f.y - m && p.y < f.y + f.h + m;
    if (keepout.sites.some((site) => siteRects(site).some(near))) {
        return true;
    }
    // A canopy hangs over a road as it likes, but over a river only as far as over a lake: the water is seen running through.
    const off = (path: LaidPath): number => Math.max(onPaths, path.kind === 'river' ? reach * WATER_OVERHANG : 0);
    if (keepout.paths.some((path) => distanceToPolyline(p, path.points) < path.halfWidth + PATH_MARGIN + off(path))) {
        return true;
    }
    const wet = (outline: readonly Point[]): boolean =>
        pointInPolygon(p, flat(outline)) || distanceToPolyline(p, [...outline, ...outline.slice(0, 1)]) < reach * WATER_OVERHANG;
    if (keepout.waters.some(wet) || keepout.props.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < s.r + reach)) {
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
    const inZone = (p: Point): boolean => pointInPolygon(p, polygon) && !blocked(p, dressing.role, keepout, size / 2);
    const accept = (p: Point): boolean =>
        inZone(p) &&
        // Clumped: where the noise is low, fewer stand.
        clump(p.x, p.y) >= dressing.clumping * random() &&
        // Thinning towards the zone's edge.
        Math.min(1, depthInside(p, outline) / EDGE_FADE) >= random() * QUARTER * 2;
    const solid = SOLID_ROLES.includes(dressing.role);
    const stand = (p: Point): FeatureInput[] => {
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
    };
    // A patch grows round each spot: its pieces close about it, each still only where the zone allows.
    const patched = (spots: readonly Point[]): Point[] => {
        const { patch } = dressing;
        if (!patch) {
            return [...spots];
        }
        return spots.flatMap((spot) => {
            const count = patch[0] + Math.floor(random() * (patch[1] - patch[0] + 1));
            return Array.from({ length: count }, (_, i) => {
                // The first at the spot itself, the rest round it at a random bearing and reach.
                const reach = i === 0 ? 0 : Math.sqrt(random()) * PATCH_REACH * size;
                const bearing = random() * 2 * Math.PI;
                return { x: spot.x + reach * Math.cos(bearing), y: spot.y + reach * Math.sin(bearing) };
            }).filter(inZone);
        });
    };
    const placed = patched(poissonDisc(bounds, spacing, accept, random)).flatMap(stand);
    // Clumping and thinning can leave a zone without any of its pieces (a camp with no tents): then it is dressed again evenly.
    return placed.length > 0 ? placed : patched(poissonDisc(bounds, spacing, inZone, random)).flatMap(stand);
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
                // Uneven steps and a wandering distance from the water: strewn along the bank, never a row.
                for (let t = random() * BANK.step; t < span; t += BANK.step * (QUARTER * 2 + random())) {
                    const aside = (river.halfWidth + BANK.offset * (QUARTER * 2 + random() * 2)) * (random() < QUARTER * 2 ? 1 : -1);
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

/** A lake's shore: reeds and rocks every few squares just outside its edge. */
const SHORE = { step: 1.6, chance: 0.55, offset: 0.4, reeds: 0.6 } as const;

/** Reeds and rocks round a lake's `outline`, on dry land clear of paths and buildings. */
function shore(outline: readonly Point[], keepout: Keepout, stamps: RoleIndex, random: Random): FeatureInput[] {
    const reeds = inHabitat(stamps, 'flora', ['marsh']);
    const rocks = inHabitat(stamps, 'rock', BANK_HABITATS);
    const centre = centreOf(outline);
    const out: FeatureInput[] = [];
    [...outline, ...outline.slice(0, 1)].reduce((a, b) => {
        const span = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        for (let t = 0; t < span; t += SHORE.step) {
            const edge = { x: a.x + ((b.x - a.x) * t) / span, y: a.y + ((b.y - a.y) * t) / span };
            const away = Math.hypot(edge.x - centre.x, edge.y - centre.y) || 1;
            const p = { x: edge.x + ((edge.x - centre.x) / away) * SHORE.offset, y: edge.y + ((edge.y - centre.y) / away) * SHORE.offset };
            const role = random() < SHORE.reeds ? 'flora' : 'rock';
            const stamp = pick(random, role === 'flora' ? reeds : rocks);
            if (stamp && random() < SHORE.chance && !blocked(p, role, keepout)) {
                out.push({ type: 'stamp', stamp: stamp.key, x: p.x, y: p.y, rotation: stamp.upright ? 0 : Math.floor(random() * FULL_TURN) });
            }
        }
        return b;
    });
    return out;
}

/** Squares off a road's edge a waymark stands. */
const WAYMARK_GAP = 0.5;

/**
 * A waymark (a milestone, a wayside post) at each turn-off: where a road
 * leading to a building starts on another road, stood at the corner between
 * them, off both.
 */
function waymarks(paths: readonly LaidPath[], leads: readonly boolean[], stamps: RoleIndex, keepout: Keepout, random: Random): FeatureInput[] {
    const marks = stamps.get('waymark') ?? [];
    return paths.flatMap((spur, i) => {
        const [start, next] = spur.points;
        const stamp = pick(random, marks);
        if (leads[i] !== true || !start || !next || !stamp || spur.kind !== 'road') {
            return [];
        }
        const main = paths.find((p, j) => j !== i && p.kind === 'road' && distanceToPolyline(start, p.points) <= p.halfWidth + WAYMARK_GAP);
        if (!main) {
            return [];
        }
        const span = Math.hypot(next.x - start.x, next.y - start.y) || 1;
        const along = { x: (next.x - start.x) / span, y: (next.y - start.y) / span };
        // Out along the spur past the main road's edge, then aside off the spur's own.
        const out = main.halfWidth + WAYMARK_GAP;
        const aside = spur.halfWidth + WAYMARK_GAP;
        const spots = [1, -1].map((side) => ({ x: start.x + along.x * out - along.y * aside * side, y: start.y + along.y * out + along.x * aside * side }));
        const spot = spots.find((p) => !keepout.paths.some((path) => distanceToPolyline(p, path.points) < path.halfWidth + WAYMARK_GAP / 2));
        return spot ? [{ type: 'stamp' as const, stamp: stamp.key, x: spot.x, y: spot.y, rotation: squareTurn(stamp, random) }] : [];
    });
}

/** Squares within which two crossings are the same one. */
const SAME_CROSSING = 0.5;

/** Where two polylines cross, with the first one's direction there (a unit vector). */
function crossings(first: readonly Point[], second: readonly Point[]): { at: Point; along: Point }[] {
    const found: { at: Point; along: Point }[] = [];
    for (let i = 1; i < first.length; i++) {
        const a = first[i - 1];
        const b = first[i];
        for (let j = 1; a && b && j < second.length; j++) {
            const c = second[j - 1];
            const d = second[j];
            const hit = c && d ? segmentsCross(a, b, c, d) : null;
            // A crossing on a bend point touches the segments either side of it: it is one crossing.
            if (hit && !found.some((f) => Math.hypot(f.at.x - hit.x, f.at.y - hit.y) < SAME_CROSSING)) {
                const span = Math.hypot(b.x - a.x, b.y - a.y) || 1;
                found.push({ at: hit, along: { x: (b.x - a.x) / span, y: (b.y - a.y) / span } });
            }
        }
    }
    return found;
}

/** Where segment `a`–`b` crosses `c`–`d`, or null. */
function segmentsCross(a: Point, b: Point, c: Point, d: Point): Point | null {
    const r = { x: b.x - a.x, y: b.y - a.y };
    const s = { x: d.x - c.x, y: d.y - c.y };
    const denominator = r.x * s.y - r.y * s.x;
    if (denominator === 0) {
        return null;
    }
    const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denominator;
    const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denominator;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + r.x * t, y: a.y + r.y * t } : null;
}

/** Degrees off square an upright bridge (drawn with depth, never turned) may lie from the road and still carry it. */
const UPRIGHT_BRIDGE_SLACK = 20;

/** The rotation that lays `stamp` along a road running `along`, or null when it would need a turn it cannot take. */
function bridgeRotation(stamp: RoleStamp, along: Point): number | null {
    const road = (Math.atan2(along.y, along.x) * (FULL_TURN / 2)) / Math.PI;
    // Its long side carries the road.
    const lengthwise = stamp.width >= stamp.height ? 0 : QUARTER_TURN;
    const rotation = ((Math.round(road + lengthwise + stamp.turn) % FULL_TURN) + FULL_TURN) % FULL_TURN;
    if (!stamp.upright) {
        return rotation;
    }
    const off = rotation % (FULL_TURN / 2);
    return Math.min(off, FULL_TURN / 2 - off) <= UPRIGHT_BRIDGE_SLACK ? 0 : null;
}

/** A bridge wherever a road crosses a river, laid along the road; a problem when a road needs one and no stamp is a bridge. */
function bridges(paths: readonly LaidPath[], stamps: RoleIndex, random: Random): { features: FeatureInput[]; problems: ComposeProblem[] } {
    const choices = stamps.get('bridge') ?? [];
    const features: FeatureInput[] = [];
    const problems: ComposeProblem[] = [];
    for (const road of paths.filter((p) => p.kind === 'road')) {
        for (const river of paths.filter((p) => p.kind === 'river')) {
            for (const { at, along } of crossings(road.points, river.points)) {
                const fits = choices.flatMap((stamp) => {
                    const rotation = bridgeRotation(stamp, along);
                    return rotation === null ? [] : [{ stamp, rotation }];
                });
                const chosen = pick(random, fits);
                if (chosen) {
                    features.push({ type: 'stamp', stamp: chosen.stamp.key, x: at.x, y: at.y, rotation: chosen.rotation });
                } else {
                    problems.push({ kind: 'no-stamp', role: 'bridge', wantedIn: 'road' });
                }
            }
        }
    }
    return { features, problems };
}

/** Squares between a yard piece's footprint and the building's margin. */
const PROP_GAP = 0.3;

/** Squares between the spots along a wall a yard piece is tried at. */
const PROP_STEP = 0.5;

/** Each map edge as the side of a footprint facing it. */
const EDGE_SIDE: Readonly<Record<Edge, Side>> = { north: 'top', east: 'right', south: 'bottom', west: 'left' };

/** Each side of a footprint as the map edge it faces. */
const SIDE_EDGE: Readonly<Record<Side, Edge>> = { top: 'north', right: 'east', bottom: 'south', left: 'west' };

const OPPOSITE_SIDE: Readonly<Record<Side, Side>> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/** Where `stamp` could stand in the yard beside `site`: clear of its margin, off paths and other pieces, nearest the middle of a side first. */
function yardSpot(site: Site, side: Edge | undefined, stamp: RoleStamp, keepout: Keepout, standing: readonly Standing[]): Point | null {
    // Out past everything the building has outside too: a well stands beyond the porch, not on it.
    const f = siteBounds(site);
    const r = footprintRadius(stamp);
    const front = site.front?.slot.side;
    const all: readonly Side[] = ['bottom', 'right', 'top', 'left'];
    const sides = side ? [EDGE_SIDE[side]] : [...(front ? [front] : []), ...all.filter((s) => s !== front)];
    for (const each of sides) {
        const [lo, hi] = each === 'top' || each === 'bottom' ? [f.x, f.x + f.w - 1] : [f.y, f.y + f.h - 1];
        const middle = (lo + hi) / 2;
        const spots: number[] = [];
        for (let at = lo; at <= hi; at += PROP_STEP) {
            spots.push(at);
        }
        spots.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));
        for (const at of spots) {
            const p = OUTSIDE[each](f, at, BUILDING_MARGIN + r + PROP_GAP);
            const { map } = keepout;
            const onMap = p.x - r >= map.x && p.y - r >= map.y && p.x + r <= map.x + map.w && p.y + r <= map.y + map.h;
            if (onMap && !blocked(p, 'well', keepout, r, r) && !standing.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < s.r + r)) {
                return p;
            }
        }
    }
    return null;
}

/** The intent's props: each stood at its point, or in the yard beside its building, kept clear by what is scattered after. */
function placeProps(
    props: readonly PropIntent[],
    sites: readonly Site[],
    stamps: RoleIndex,
    keepout: Keepout,
    placed: Standing[],
    random: Random,
): { features: FeatureInput[]; problems: ComposeProblem[] } {
    const features: FeatureInput[] = [];
    const problems: ComposeProblem[] = [];
    for (const prop of props) {
        const stamp = pick(random, stamps.get(prop.role) ?? []);
        if (!stamp) {
            problems.push({ kind: 'no-stamp', role: prop.role, wantedIn: 'beside' in prop ? prop.beside.building : 'outside' });
            continue;
        }
        const site = 'beside' in prop ? sites.find((s) => s.key === prop.beside.building) : undefined;
        const p = 'at' in prop ? prop.at : site ? yardSpot(site, prop.beside.side, stamp, keepout, placed) : null;
        if (p) {
            placed.push({ x: p.x, y: p.y, r: footprintRadius(stamp) });
            features.push({ type: 'stamp', stamp: stamp.key, x: p.x, y: p.y, rotation: squareTurn(stamp, random) });
        }
    }
    return { features, problems };
}

/** How far (squares) a yard's trodden earth reaches round its building, and what it is drawn in. */
const YARD_EARTH = 1.5;
const YARD_GROUND = 'floor.packed-dirt';

/**
 * A trodden yard's edge round `rect`: a rounded rectangle (a superellipse of
 * `roundness`), wandering in and out by smooth noise as ground worn by use
 * does, `points` round.
 */
const YARD_EDGE = { points: 64, roundness: 5, wander: 0.18, scale: 2.5 } as const;

function yardEdge(rect: Rect, random: Random): Point[] {
    const noise = noiseField(random, EDGE_SCALE);
    const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    const exponent = 2 / YARD_EDGE.roundness;
    return Array.from({ length: YARD_EDGE.points }, (_, i) => {
        const a = (i / YARD_EDGE.points) * 2 * Math.PI;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const reach = 1 + YARD_EDGE.wander * (noise(cos * YARD_EDGE.scale, sin * YARD_EDGE.scale) * 2 - 1);
        return {
            x: centre.x + Math.sign(cos) * Math.abs(cos) ** exponent * (rect.w / 2) * reach,
            y: centre.y + Math.sign(sin) * Math.abs(sin) ** exponent * (rect.h / 2) * reach,
        };
    });
}

/** Squares out past a yard's building and its stores that an enclosure stands, and fodder stands beside it. */
const PEN_OUT = 2;

/**
 * A yard's enclosure for animals (a pen, a corral) out on the first of
 * `sides` with room for it, clear of the building, its stores' strip and
 * everything else; its fodder stacked at its side.
 */
/** Where a pen could stand on the first of `sides` with ground for it, out beyond the stores along the wall; null if none. */
function penSpot(site: Site, sides: readonly Side[], pen: RoleStamp, keepout: Keepout, standing: readonly Standing[]): { side: Side; spot: Point } | null {
    // Stood as if the building reached this far, so the stores along the wall keep their ground.
    const widened = { ...site, front: null, footprint: grown(site.footprint, PEN_OUT) };
    for (const side of sides) {
        const spot = yardSpot(widened, SIDE_EDGE[side], pen, keepout, standing);
        if (spot) {
            return { side, spot };
        }
    }
    return null;
}

function penOf(site: Site, sides: readonly Side[], pen: RoleStamp, stamps: RoleIndex, keepout: Keepout, standing: Standing[], random: Random): FeatureInput[] {
    const found = penSpot(site, sides, pen, keepout, standing);
    if (!found) {
        return [];
    }
    const { spot } = found;
    const r = footprintRadius(pen);
    standing.push({ x: spot.x, y: spot.y, r });
    const out: FeatureInput[] = [{ type: 'stamp', stamp: pen.key, x: spot.x, y: spot.y, rotation: squareTurn(pen, random) }];
    const fodder = pick(random, stamps.get('fodder') ?? []);
    if (fodder) {
        const fr = footprintRadius(fodder);
        // Beside the pen, along whichever side is clear.
        const beside = [0, 1, 2, 3]
            .map((q) => ({ x: spot.x + Math.cos((q * Math.PI) / 2) * (r + fr), y: spot.y + Math.sin((q * Math.PI) / 2) * (r + fr) }))
            .find((p) => !blocked(p, 'fodder', keepout, fr, fr) && !standing.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < s.r + fr));
        if (beside) {
            standing.push({ x: beside.x, y: beside.y, r: fr });
            out.push({ type: 'stamp', stamp: fodder.key, x: beside.x, y: beside.y, rotation: squareTurn(fodder, random) });
        }
    }
    return out;
}

/** A turn for a piece stood outside: drawn side-on, it stands as drawn; seen from above, a square turn of any. */
function squareTurn(stamp: RoleStamp, random: Random): number {
    return stamp.upright ? 0 : Math.floor(random() * (FULL_TURN / QUARTER_TURN)) * QUARTER_TURN;
}

/**
 * A yard's stores along a wall: a clump by `chance` where one may start (else
 * `step` squares on), of two to `group` pieces `gap` off the wall, each after
 * the first standing a rank out before the last by `ranked`; `space` squares
 * of open wall (between its bounds) after each clump.
 */
const YARD = { step: 2.5, chance: 0.65, group: 3, gap: 0.1, ranked: 0.4, space: [1.5, 3.5] } as const;

/**
 * Stores stacked against a building's outside walls (all but its front) in
 * groups, clear of its annexes (a porch, an areaway), paths, water and one
 * another; and a cart or wagon standing by in the yard.
 */
function yardOf(site: Site, stamps: RoleIndex, keepout: Keepout, standing: Standing[], random: Random): FeatureInput[] {
    const front = site.front?.slot.side;
    const out: FeatureInput[] = [];
    // The yard is behind the building and round one side of it: its back, and a side beside the back, never the front.
    const back = OPPOSITE_SIDE[front ?? 'bottom'];
    const flanks = shuffled(
        random,
        (['top', 'right', 'bottom', 'left'] as const).filter((s) => s !== front && s !== back),
    );
    // The yard's side is where its pen has ground (never the front; a map edge or a river may leave a side none), a flank
    // before the back; with no pen, a flank.
    const pen = pick(random, stamps.get('enclosure') ?? []);
    const penSides: readonly Side[] = [...flanks, back];
    const penSide = pen ? penSpot(site, penSides, pen, keepout, standing)?.side ?? null : null;
    const flank = penSide !== null && penSide !== back ? penSide : flanks[0];
    // The cart stands by in the yard, beside the pen where the pen still has ground with it there, else on another side
    // (a flank, then the back), so both stand. A yard's is the smallest craft: a cart, not a freighter.
    const cart = [...(stamps.get('vehicle') ?? [])].sort((a, b) => a.width * a.height - b.width * b.height)[0];
    const unfronted = { ...site, front: null };
    const cartAt = (side: Side, withPen: boolean): Point | null => {
        const at = cart ? yardSpot(unfronted, SIDE_EDGE[side], cart, keepout, standing) : null;
        const leaves = (p: Point): boolean =>
            !pen || !cart || penSpot(site, [side], pen, keepout, [...standing, { x: p.x, y: p.y, r: footprintRadius(cart) }]) !== null;
        return at && (!withPen || leaves(at)) ? at : null;
    };
    const spot =
        (penSide ? cartAt(penSide, true) : null) ??
        penSides.filter((s) => s !== penSide).reduce<Point | null>((found, side) => found ?? cartAt(side, false), null) ??
        (penSide ? cartAt(penSide, false) : null);
    if (cart && spot) {
        standing.push({ x: spot.x, y: spot.y, r: footprintRadius(cart) });
        out.push({ type: 'stamp', stamp: cart.key, x: spot.x, y: spot.y, rotation: squareTurn(cart, random) });
    }
    if (pen) {
        out.push(...penOf(site, penSide ? [penSide, ...penSides.filter((s) => s !== penSide)] : penSides, pen, stamps, keepout, standing, random));
    }
    for (const side of flank ? [back, flank] : [back]) {
        out.push(...storesAlong(site, side, stamps.get('storage') ?? [], keepout, standing, random));
    }
    return out;
}

/**
 * A yard's stores along the `side` wall, in clumps with open wall between
 * them, never one unbroken line: each two or three pieces, some stacked a
 * rank out; clear of the building's annexes, paths, water and what stands.
 */
function storesAlong(site: Site, side: Side, stores: readonly RoleStamp[], keepout: Keepout, standing: Standing[], random: Random): FeatureInput[] {
    const f = site.footprint;
    const out: FeatureInput[] = [];
    const clear = (p: Point, r: number): boolean =>
        p.x - r >= keepout.map.x &&
        p.y - r >= keepout.map.y &&
        p.x + r <= keepout.map.x + keepout.map.w &&
        p.y + r <= keepout.map.y + keepout.map.h &&
        !site.annexes.some((a) => p.x + r > a.x && p.x - r < a.x + a.w && p.y + r > a.y && p.y - r < a.y + a.h) &&
        !keepout.paths.some((path) => distanceToPolyline(p, path.points) < path.halfWidth + PATH_MARGIN + r) &&
        !keepout.waters.some((w) => pointInPolygon(p, flat(w))) &&
        ![...standing, ...keepout.props].some((s) => Math.hypot(s.x - p.x, s.y - p.y) < s.r + r);
    const [lo, hi] = side === 'top' || side === 'bottom' ? [f.x, f.x + f.w] : [f.y, f.y + f.h];
    let at = lo + random() * YARD.step;
    while (at < hi) {
        if (random() >= YARD.chance) {
            at += YARD.step;
            continue;
        }
        const size = 2 + Math.floor(random() * (YARD.group - 1));
        let along = at;
        let reach = at;
        for (let n = 0; n < size && along < hi; n++) {
            const stamp = pick(random, stores);
            if (!stamp) {
                break;
            }
            const r = Math.max(stamp.width, stamp.height) / 2;
            // After the first, a piece may stand before the last, a rank out from the wall, rather than beside it.
            const ranked = n > 0 && random() < YARD.ranked;
            const p = OUTSIDE[side](f, (ranked ? along - 2 * r : along) + r - 0.5, r + YARD.gap + (ranked ? 2 * r : 0));
            if (clear(p, r * 0.9)) {
                standing.push({ x: p.x, y: p.y, r });
                out.push({ type: 'stamp', stamp: stamp.key, x: p.x, y: p.y, rotation: squareTurn(stamp, random) });
            }
            if (!ranked) {
                along += 2 * r;
            }
            reach = Math.max(reach, along);
        }
        at = reach + YARD.space[0] + random() * (YARD.space[1] - YARD.space[0]);
    }
    return out;
}

/** Bare, worn patches of earth in woods. */
function wornEarth(zone: ZoneIntent, outline: readonly Point[], keepout: Keepout, random: Random): FeatureInput[] {
    // Only under trees, where it is the trodden floor between them; out on open grass it reads as mud stains.
    if (zone.kind !== 'woodland') {
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
    const isLake = ({ zone }: { zone: ZoneIntent }): boolean => zone.kind === 'lake';
    for (const { zone, outline } of outlines.filter((o) => !isLake(o))) {
        features.push({ type: 'region', biome: ZONE_GROUND[zone.kind], points: outline, ...textured(zone.texture) });
    }
    // A working yard's ground is trodden earth round the building, under its paths.
    for (const site of sites.filter((s) => s.yard)) {
        features.push({ type: 'region', biome: 'dirt', texture: YARD_GROUND, points: yardEdge(grown(siteBounds(site), YARD_EARTH), random) });
    }
    const keyed = new Map(outlines.flatMap(({ zone, outline }) => (zone.key === undefined ? [] : [[zone.key, outline] as const])));
    const paths: LaidPath[] = intent.paths.map((path) => {
        const halfWidth = (path.width ?? PATH_WIDTH[path.kind]) / 2;
        const [from, to] = pathEnds(path, intent, sites, keyed, random);
        const line = meanderLine(from, to, path.meander, random);
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
    const props: Standing[] = [];
    const keepout: Keepout = {
        map: { x: 0, y: 0, w: intent.width, h: intent.height },
        sites,
        paths,
        clearings: outlines.filter(({ zone }) => zone.kind === 'clearing').map(({ outline }) => flat(outline)),
        waters: outlines.filter(({ zone }) => zone.kind === 'lake').map(({ outline }) => outline),
        props,
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
    // Water lies over the land round it and over the paths' ends in it: each lake over its own bed, after every other zone's
    // ground and the paths, so a river out of a lake starts under its water, its square end and banks unseen.
    for (const { zone, outline } of outlines.filter(isLake)) {
        features.push(
            { type: 'region', biome: LAKE_BED, points: outline },
            { type: 'region', biome: ZONE_GROUND[zone.kind], points: outline, ...textured(zone.texture) },
        );
    }
    // The intent's own pieces stand first; everything scattered after keeps clear of them.
    const placedProps = placeProps(intent.props, sites, stamps, keepout, props, random);
    features.push(...placedProps.features);
    problems.push(...placedProps.problems);
    // Yards next: their stores against the walls, a cart standing by, before anything grows round them.
    for (const site of sites.filter((s) => s.yard)) {
        features.push(...yardOf(site, stamps, keepout, props, random));
    }
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
    for (const { zone, outline } of outlines) {
        if (zone.kind === 'lake') {
            features.push(...shore(outline, keepout, stamps, random));
        }
    }
    features.push(...banks(paths, keepout, stamps, random));
    const crossed = bridges(paths, stamps, random);
    features.push(...crossed.features);
    problems.push(...crossed.problems);
    const leads = intent.paths.map((p) => typeof p.to === 'object' && 'building' in p.to);
    features.push(...waymarks(paths, leads, stamps, keepout, random));
    return { features, problems };
}
