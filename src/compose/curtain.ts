// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Curtain walls: a thick band of masonry along a closed line round a bailey,
 * a camp or a town. It is broken where towers stand and gates pierce it; each
 * run of wall between them is a walled strip, solid at ground level (nothing
 * opens into it), the walk along its top drawn between its faces. Towers are
 * rooms at its corners (and wherever asked), eight-sided or square, each with
 * a door into what the wall encloses; a gate is a passage through the wall,
 * its gate on the outer face and open to the inside. Pure.
 */
import { type DoorSlot, outlineRoomSpec, type Rect, type RoomBuild, roomSpec, type Side } from '../generate/floor-plan';
import type { Random } from '../generate/random';
import type { SceneSpecInput } from '../generate/spec';
import { distanceToPolyline, pointInPolygon } from '../geometry/hit';
import { keyhole } from '../geometry/keyhole';
import { closedSpline, type Point } from '../geometry/spline';
import { signedArea, traceShapes } from '../geometry/trace-shape';
import type { RoomDoor } from '../tools/room';
import type { CurtainIntent } from './intent';
import { noiseField, type NoiseField } from './noise';

type FeatureInput = SceneSpecInput['features'][number];

/** A stretch of the wall's line cut out of it, by arc length from its first point: a tower's or a gate's. */
interface Break {
    readonly from: number;
    readonly to: number;
}

/** How much of a round tower's box each corner cut takes: an eight-sided tower near enough a circle. */
const ROUND_CUT = 0.29;

/** The scene's origin: what a point read off an empty line falls back to. */
const ORIGIN: Point = { x: 0, y: 0 };

/** Squares across a tower's door into the bailey. */
const TOWER_DOOR = 1;

/** A gate passage's inner face, open to what the wall encloses: neither wall nor door. */
const OPEN: RoomDoor = { segment: 0, type: 'opening', state: 'open', sound: null, animation: null };

/** The wall's line as a walkable loop: its corners, the arc length at each, and its whole length. */
class Line {
    readonly points: readonly Point[];
    readonly at: readonly number[];
    readonly length: number;
    /** 1 where the loop runs clockwise as seen, so its outside lies to the left of each side; -1 the other way. */
    readonly turn: number;

    constructor(points: readonly Point[]) {
        this.points = points;
        const at: number[] = [];
        let run = 0;
        points.forEach((p, i) => {
            at.push(run);
            const q = this.corner(i + 1);
            run += Math.hypot(q.x - p.x, q.y - p.y);
        });
        this.at = at;
        this.length = run;
        this.turn = signedArea(points) >= 0 ? 1 : -1;
    }

    /** Corner `i` of the loop, counted round it either way. */
    corner(i: number): Point {
        const n = this.points.length;
        return this.points[((i % n) + n) % n] ?? ORIGIN;
    }

    /** The arc length from the loop's first point to corner `i`. */
    arcAt(i: number): number {
        return this.at[i] ?? 0;
    }

    /** The side (edge) holding arc length `s`, and how far along it. */
    private edgeAt(s: number): { i: number; t: number } {
        const wrapped = ((s % this.length) + this.length) % this.length;
        for (let i = this.points.length - 1; i >= 0; i--) {
            const start = this.arcAt(i);
            if (wrapped >= start) {
                return { i, t: wrapped - start };
            }
        }
        return { i: 0, t: 0 };
    }

    /** The unit direction along side `i`. */
    direction(i: number): Point {
        const p = this.corner(i);
        const q = this.corner(i + 1);
        const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        return { x: (q.x - p.x) / d, y: (q.y - p.y) / d };
    }

    /** The outward normal of side `i`: away from what the wall encloses. */
    outward(i: number): Point {
        const u = this.direction(i);
        return this.turn > 0 ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x };
    }

    /** The point at arc length `s`, and the side it lies on. */
    pointAt(s: number): { p: Point; i: number } {
        const { i, t } = this.edgeAt(s);
        const start = this.corner(i);
        const u = this.direction(i);
        return { p: { x: start.x + u.x * t, y: start.y + u.y * t }, i };
    }

    /** The arc length of `p` projected onto the nearest side. */
    project(p: Point): number {
        let best = { s: 0, d: Number.POSITIVE_INFINITY };
        this.points.forEach((a, i) => {
            const u = this.direction(i);
            const b = this.corner(i + 1);
            const span = Math.hypot(b.x - a.x, b.y - a.y);
            const t = Math.max(0, Math.min(span, (p.x - a.x) * u.x + (p.y - a.y) * u.y));
            const d = Math.hypot(a.x + u.x * t - p.x, a.y + u.y * t - p.y);
            if (d < best.d) {
                best = { s: this.arcAt(i) + t, d };
            }
        });
        return best.s;
    }

    /** The line from arc length `from` to `to` (`to` may run past the end, round again), with every corner between. */
    between(from: number, to: number): { points: Point[]; sides: number[] } {
        const start = this.pointAt(from);
        const points: Point[] = [start.p];
        const sides: number[] = [start.i];
        for (let lap = 0; lap <= 1; lap++) {
            this.points.forEach((corner, i) => {
                const s = this.arcAt(i) + lap * this.length;
                if (s > from && s < to) {
                    points.push(corner);
                    sides.push(i);
                }
            });
        }
        const end = this.pointAt(to);
        points.push(end.p);
        sides.push(end.i);
        return { points, sides };
    }
}

/**
 * A band `half` squares either side of the open line `points`, mitred at its
 * bends: its outline, one face forward and the other back.
 */
function band(points: readonly Point[], half: number): Point[] {
    const normalOf = (a: Point, b: Point): Point => {
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: -(b.y - a.y) / d, y: (b.x - a.x) / d };
    };
    // The normal of the side ending at each point, and of the side starting there (none past either end of the line).
    const sides = points.slice(1).map((p, i) => normalOf(points[i] ?? p, p));
    const faces = points.map((p, i) => {
        const before = sides[i - 1] ?? null;
        const after = sides[i] ?? null;
        const n1 = before ?? after ?? ORIGIN;
        const n2 = after ?? n1;
        const sum = { x: n1.x + n2.x, y: n1.y + n2.y };
        const d = Math.hypot(sum.x, sum.y) || 1;
        const miter = { x: sum.x / d, y: sum.y / d };
        // Out along the bisector far enough that each face stands `half` off its own side.
        const reach = half / Math.max(0.2, miter.x * n1.x + miter.y * n1.y);
        const off = { x: miter.x * reach, y: miter.y * reach };
        return { left: { x: p.x + off.x, y: p.y + off.y }, right: { x: p.x - off.x, y: p.y - off.y } };
    });
    return [...faces.map((f) => f.left), ...faces.map((f) => f.right).reverse()];
}

/** The side of a box facing most nearly along `v`. */
function facing(v: Point): Side {
    if (Math.abs(v.x) >= Math.abs(v.y)) {
        return v.x >= 0 ? 'right' : 'left';
    }
    return v.y >= 0 ? 'bottom' : 'top';
}

/** A tower of `size` squares centred on `c`, its door (a square wide) in the middle of the side facing `inward`. */
function tower(c: Point, size: number, round: boolean, inward: Point, build: RoomBuild): FeatureInput {
    const rect: Rect = { x: c.x - size / 2, y: c.y - size / 2, w: size, h: size };
    const side = facing(inward);
    const along = side === 'top' || side === 'bottom' ? c.x : c.y;
    const door: DoorSlot = { side, at: along - TOWER_DOOR / 2 };
    return roomSpec(rect, [door], build, round ? size * ROUND_CUT : 0);
}

/** A gate's passage through the wall centred on `c` along side `i`: its gate on the outer face, its inner face open. */
function gatePassage(line: Line, c: Point, i: number, gate: CurtainIntent['gates'][number], half: number, build: RoomBuild): FeatureInput {
    const u = line.direction(i);
    const out = line.outward(i);
    const w = gate.width / 2;
    const corner = (along: number, across: number): Point => ({ x: c.x + u.x * along + out.x * across, y: c.y + u.y * along + out.y * across });
    // The outer face first, then round: segment 0 the gate, segment 2 the way in.
    const points = [corner(-w, half), corner(w, half), corner(w, -half), corner(-w, -half)];
    const shut: RoomDoor =
        gate.state === 'gap' ? OPEN : { segment: 0, type: 'door', state: gate.state === 'open' ? 'open' : 'closed', sound: null, animation: gate.animation };
    return outlineRoomSpec(points, build, [
        { ...shut, segment: 0 },
        { ...OPEN, segment: 2 },
    ]);
}

/** How finely a moat is traced: fine enough for its banks to wander, coarse enough to stay smooth. */
const MOAT_GRAIN = { cellsPerSquare: 2, tolerance: 0.25, minArea: 2 } as const;

/** Points laid along each traced span of a moat's bank, curving it through the traced corners instead of kinking there. */
const MOAT_CURVE = 3;

/** Squares over which a moat's banks wander in and out, and how far at most (a share of the moat's width) at full wander. */
const MOAT_WANDER = { scale: 6, share: 0.35 } as const;

/**
 * A moat's water round `curtain`, as outlines each with the island it rings
 * keyholed out (so each is one polygon, filled as a lake): the ground outside
 * the wall between `gap` and `gap + width` squares out from its outer face and
 * its towers, each bank wandering by noise, its corners rounded by the
 * distance they are measured by. None without a moat.
 */
export function moatOutlines(curtain: CurtainIntent, random: Random): Point[][] {
    const { moat } = curtain;
    if (moat === null) {
        return [];
    }
    const line = new Line(curtain.points);
    const half = curtain.thickness / 2;
    const size = curtain.towers.size;
    const towers = [...(curtain.towers.corners ? line.at : []), ...curtain.towers.at.map((p) => line.project(p))].map((s) => line.pointAt(s).p);
    const loop = [...curtain.points, ...curtain.points.slice(0, 1)];
    const flat = curtain.points.flatMap((p) => [p.x, p.y]);
    const inner = noiseField(random, MOAT_WANDER.scale);
    const outer = noiseField(random, MOAT_WANDER.scale);
    const wobble = (field: NoiseField, p: Point): number => (field(p.x, p.y) - 0.5) * 2 * MOAT_WANDER.share * moat.width * moat.wander;
    // How far outside the masonry a point stands: off the wall's outer face, or a tower's (round, or square).
    const offTower = (p: Point, c: Point): number =>
        (curtain.towers.round ? Math.hypot(p.x - c.x, p.y - c.y) : Math.max(Math.abs(p.x - c.x), Math.abs(p.y - c.y))) - size / 2;
    const clearance = (p: Point): number => Math.min(distanceToPolyline(p, loop) - half, ...towers.map((c) => offTower(p, c)));
    const inWater = (p: Point): boolean => {
        if (pointInPolygon(p, flat)) {
            return false;
        }
        const out = clearance(p);
        return out > moat.gap + wobble(inner, p) && out < moat.gap + moat.width + wobble(outer, p);
    };
    const reach = half + moat.gap + moat.width * (1 + MOAT_WANDER.share) + size;
    const xs = curtain.points.map((p) => p.x);
    const ys = curtain.points.map((p) => p.y);
    const box = {
        x: Math.min(...xs) - reach,
        y: Math.min(...ys) - reach,
        w: Math.max(...xs) - Math.min(...xs) + 2 * reach,
        h: Math.max(...ys) - Math.min(...ys) + 2 * reach,
    };
    // Water is drawn crisp to its outline, so the banks are curved here: traced, they run straight and kink.
    const curved = (bank: readonly Point[]): Point[] => closedSpline(bank, MOAT_CURVE);
    return traceShapes(inWater, box, MOAT_GRAIN).map(({ outline, holes }) => keyhole(curved(outline), holes.map(curved)).points);
}

/**
 * The features a curtain wall is built of, on `level`: each run of wall between
 * its towers and gates a solid walled strip, each tower a room with its door
 * into the bailey, each gate a passage with its gate.
 */
export function curtainFeatures(curtain: CurtainIntent, level: { level?: string }): FeatureInput[] {
    const line = new Line(curtain.points);
    const half = curtain.thickness / 2;
    const build: RoomBuild = { floor: curtain.walk ?? curtain.wall, wall: curtain.wall, wallKind: 'solid', ceiling: true };
    const { size, round } = curtain.towers;
    const centre = curtain.points.reduce((sum, p) => ({ x: sum.x + p.x / curtain.points.length, y: sum.y + p.y / curtain.points.length }), { x: 0, y: 0 });
    const towerAt = [...(curtain.towers.corners ? line.at : []), ...curtain.towers.at.map((p) => line.project(p))];
    const gateAt = curtain.gates.map((gate) => {
        const start = line.arcAt(gate.edge);
        const next = gate.edge + 1 < line.at.length ? line.arcAt(gate.edge + 1) : line.length;
        return { gate, s: start + gate.at * (next - start) };
    });
    const breaks: Break[] = [
        ...towerAt.map((s) => ({ from: s - size / 2, to: s + size / 2 })),
        ...gateAt.map(({ gate, s }) => ({ from: s - gate.width / 2, to: s + gate.width / 2 })),
    ]
        .map((b) => {
            // Started before the loop's first point, it counts from the end of the loop instead.
            const from = ((b.from % line.length) + line.length) % line.length;
            return { from, to: from + (b.to - b.from) };
        })
        .sort((a, b) => a.from - b.from);
    // The runs of wall: from each break's end to the next one's start, round the loop; unbroken, the whole loop.
    const runs: Break[] =
        breaks.length === 0
            ? [{ from: 0, to: line.length }]
            : breaks.flatMap((b, n) => {
                  const next = breaks[(n + 1) % breaks.length] ?? b;
                  const to = n + 1 < breaks.length ? next.from : next.from + line.length;
                  return to > b.to ? [{ from: b.to, to }] : [];
              });
    const strips = runs.map((run): FeatureInput => ({ ...outlineRoomSpec(band(line.between(run.from, run.to).points, half), build), ...level }));
    const towers = towerAt.map((s): FeatureInput => {
        const { p } = line.pointAt(s);
        return { ...tower(p, size, round, { x: centre.x - p.x, y: centre.y - p.y }, build), ...level };
    });
    const gates = gateAt.map(({ gate, s }): FeatureInput => {
        const { p, i } = line.pointAt(s);
        return { ...gatePassage(line, p, i, gate, half, build), ...level };
    });
    return [...strips, ...towers, ...gates];
}
