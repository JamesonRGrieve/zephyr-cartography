// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Rough-hewn passages and chambers: tunnels bored or dug through rock, never
 * ruled. Each passage is a line with a width that swells and pinches, each
 * chamber an irregular blob; their edges wander by noise at two scales (the
 * passage's bulges, the rock's jag). Their union is rasterised on a fine
 * grid, its outline traced by marching squares and simplified, and each
 * outline becomes a walled room in the rock's floor: an outer outline the
 * cut itself, an inner one rock left standing where passages loop round it,
 * walled as a pillar and, like the rock round the cut, unfloored. Passages
 * running past the map's edge open off it.
 * Seeded and pure.
 */
import { outlineRoomSpec, type RoomBuild } from '../generate/floor-plan';
import type { Random } from '../generate/random';
import type { SceneSpecInput } from '../generate/spec';
import { distanceToPolyline } from '../geometry/hit';
import { keyhole } from '../geometry/keyhole';
import { type Point, roundCorners, simplify } from '../geometry/spline';
import { traceShapes } from '../geometry/trace-shape';
import type { RoomDoor } from '../tools/room';
import type { HewnIntent } from './intent';
import { noiseField, type NoiseField } from './noise';

type FeatureInput = SceneSpecInput['features'][number];

/** Mask cells per grid square: fine enough that a single-file passage keeps its jag. */
const CELLS_PER_SQUARE = 4;

/** Squares the mask reaches past the map, so a passage running off the edge is traced open, its end walled out of sight. */
const EDGE_MARGIN = 2;

/** The wander of a hewn edge: a passage's swell and pinch over a few squares, and the rock's jag within a square. */
const SWELL = { scale: 3.5, share: 0.55 } as const;
const JAG = { scale: 0.8, squares: 0.45 } as const;

/** Squares an outline may stray from the traced edge when simplified: rough, but not a wall per mask cell. */
const OUTLINE_TOLERANCE = 0.18;

/** Loops enclosing less than this many square squares are specks of noise, not a pillar or a cut. */
const MIN_AREA = 0.75;

/** A keyhole's bridge, the way through the cut's floor to a pillar it holds: an opening, neither wall nor door. */
const BRIDGE: RoomDoor = { segment: 0, type: 'opening', state: 'open', sound: null, animation: null };

/**
 * A floor patch's outline: points round it, and how far its edge wanders in and out, as a share of its radius. Each
 * point is drawn in by PATCH_STEP squares until it and its feathered edge past it lie on the cut floor (render goal63:
 * patches near a chamber's ragged wall glowed over the dark rock beyond it); a patch with no point left on the floor is
 * dropped.
 */
const PATCH_POINTS = 14;
const PATCH_WANDER = 0.3;
const PATCH_STEP = 0.1;
/** The feather a patch with none given is drawn with, in squares (the scene spec's default, under a square). */
const PATCH_FEATHER = 0.75;
/** Patches whose points drew in to less than this share of their radius are too small to read: left out. */
const PATCH_LEAST = 0.4;

/** Times a traced outline's corners are cut: the marching squares' steps and the jag's teeth round into a worn curve. */
const ROUNDING = 2;

/** Squares a rounded outline may stray when its near-straight runs are thinned back to a few points. */
const ROUNDED_TOLERANCE = 0.03;

/** A traced loop rounded into a smooth, still ragged, curve: rock worn and hewn, not stepped. */
function smoothed(loop: readonly Point[]): Point[] {
    // Closed again on its first point to be thinned, then opened.
    const round = roundCorners(loop, ROUNDING);
    return simplify([...round, ...round.slice(0, 1)], ROUNDED_TOLERANCE).slice(0, -1);
}

/** A noise value in [0, 1) as a deviation in about [-1, 1]. */
const centred = (field: NoiseField, p: Point): number => Math.max(-1, Math.min(1, (field(p.x, p.y) - 0.5) * 3));

/** Whether rock at `p` (squares) is cut away by `network`. */
function cut(network: HewnIntent, p: Point, swell: NoiseField, jag: NoiseField): boolean {
    const r = network.roughness;
    const bulge = centred(swell, p) * SWELL.share * r;
    const edge = centred(jag, p) * JAG.squares * r;
    const inPassage = network.passages.some(({ points, width }) => distanceToPolyline(p, points) < (width / 2) * (1 + bulge) + edge);
    return (
        inPassage ||
        network.chambers.some(({ centre, width, height }) => {
            const across = Math.hypot((p.x - centre.x) / (width / 2), (p.y - centre.y) / (height / 2));
            return across < 1 + bulge * 0.6 + edge / (Math.min(width, height) / 2);
        })
    );
}

/**
 * The walled rooms `network` cuts through a map `size` squares across: the
 * passages' and chambers' outlines floored in its floor, the rock left
 * standing inside them walled round and left unfloored, like the rock round
 * the cut.
 */
export function hewnFeatures(
    network: HewnIntent,
    size: { readonly width: number; readonly height: number },
    random: Random,
    level: { level?: string },
): FeatureInput[] {
    const swell = noiseField(random, SWELL.scale);
    const jag = noiseField(random, JAG.scale);
    const box = { x: -EDGE_MARGIN, y: -EDGE_MARGIN, w: size.width + 2 * EDGE_MARGIN, h: size.height + 2 * EDGE_MARGIN };
    const build: RoomBuild = { floor: network.floor, wall: network.wall, wallKind: 'solid', ceiling: true };
    const shapes = traceShapes((p) => cut(network, p, swell, jag), box, { cellsPerSquare: CELLS_PER_SQUARE, tolerance: OUTLINE_TOLERANCE, minArea: MIN_AREA });
    // Rock left standing inside the cut is keyholed out of its floor: unfloored like the rock round it, walled round,
    // the bridges out to it openings, no wall at all.
    const rooms = shapes.map(({ outline, holes }): FeatureInput => {
        const { points, bridges } = keyhole(smoothed(outline), holes.map(smoothed));
        return {
            ...outlineRoomSpec(
                points,
                build,
                bridges.map((segment) => ({ ...BRIDGE, segment })),
            ),
            ...level,
        };
    });
    if (network.patches.length === 0) {
        return rooms;
    }
    // Its floor's patches after the rooms, so they lie over the cut floor; their noise drawn only where there are any,
    // so a network without them keeps the random stream every map composed before them had.
    const wander = noiseField(random, 1);
    const onFloor = (p: Point): boolean => cut(network, p, swell, jag);
    const patches = network.patches.flatMap(({ centre, radius, texture, blend }): FeatureInput[] => {
        const feather = blend ?? PATCH_FEATHER;
        const reaches = Array.from({ length: PATCH_POINTS }, (_, i) => {
            const turn = (i / PATCH_POINTS) * 2 * Math.PI;
            const along = (r: number): Point => ({ x: centre.x + Math.cos(turn) * r, y: centre.y + Math.sin(turn) * r });
            let reach = radius * (1 + centred(wander, along(2)) * PATCH_WANDER);
            while (reach > 0 && !(onFloor(along(reach)) && onFloor(along(reach + feather)))) {
                reach -= PATCH_STEP;
            }
            return { turn, reach };
        });
        if (Math.min(...reaches.map((r) => r.reach)) < radius * PATCH_LEAST) {
            return [];
        }
        return [
            {
                type: 'region',
                biome: 'rock',
                texture,
                points: reaches.map(({ turn, reach }) => ({ x: centre.x + Math.cos(turn) * reach, y: centre.y + Math.sin(turn) * reach })),
                ...(blend === undefined ? {} : { blend }),
                ...level,
            },
        ];
    });
    return [...rooms, ...patches];
}
