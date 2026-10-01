// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Universal VTT (`.dd2vtt`, format 0.3): the interchange format most virtual
 * tabletops import (Foundry through its Universal Battlemap Importer, and
 * others), one JSON file holding a map's image, its walls, doors and lights.
 * Everything in it is in grid squares from the map's top-left corner.
 *
 * `toUvtt` converts a scene, given in scene pixels, without touching Foundry,
 * and `levelScene` gathers one level's walls and lights from their documents'
 * data: the boundary reads the scene and supplies its image.
 * - Walls that block sight become `line_of_sight` polylines, joined where
 *   they meet end to end. Walls that block no sight (low cover, railings,
 *   movement-only walls) have no Universal VTT form, which treats every wall
 *   as blocking both, so they are left out.
 * - Doors become `portals` (closed doors that block light). A secret door
 *   stays a plain wall, so the export does not give it away.
 * - Lights keep their position, colour and reach (their dim radius).
 */
import type { Point } from '../geometry/spline';

/** The Universal VTT format version written. */
export const UVTT_FORMAT = 0.3;

/** How a wall opens: not at all, a door, or a secret door. */
type UvttDoor = 'none' | 'door' | 'secret';

/** A wall segment in scene px: its ends, whether it is a door, and whether it blocks sight. */
interface UvttWall {
    readonly a: Point;
    readonly b: Point;
    readonly door: UvttDoor;
    readonly blocksSight: boolean;
}

/** A light in scene px: its centre, its reach (dim radius) and its colour (`#rrggbb`, or null for white). */
interface UvttLight {
    readonly x: number;
    readonly y: number;
    readonly radius: number;
    readonly color: string | null;
}

/**
 * A scene to export: its grid square in scene px, the map's rectangle in
 * scene px, its walls and lights, and its image as base64 (no `data:`
 * prefix) with the image's own px per square (it may be drawn at another
 * scale than the scene).
 */
export interface UvttScene {
    readonly gridSize: number;
    readonly imageGridSize: number;
    readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    readonly walls: readonly UvttWall[];
    readonly lights: readonly UvttLight[];
    readonly image: string;
}

/** A point in grid squares. */
interface GridPoint {
    readonly x: number;
    readonly y: number;
}

/** A Universal VTT file. */
export interface Uvtt {
    readonly format: number;
    readonly resolution: { readonly map_origin: GridPoint; readonly map_size: GridPoint; readonly pixels_per_grid: number };
    readonly line_of_sight: readonly (readonly GridPoint[])[];
    readonly objects_line_of_sight: readonly (readonly GridPoint[])[];
    readonly portals: readonly {
        readonly position: GridPoint;
        readonly bounds: readonly [GridPoint, GridPoint];
        readonly rotation: number;
        readonly closed: boolean;
        readonly freestanding: boolean;
    }[];
    readonly environment: { readonly baked_lighting: boolean; readonly ambient_light: string };
    readonly lights: readonly {
        readonly position: GridPoint;
        readonly range: number;
        readonly intensity: number;
        readonly color: string;
        readonly shadows: boolean;
    }[];
    readonly image: string;
}

/** Decimal places kept in grid coordinates: a thousandth of a square. */
const PLACES = 3;
const round = (value: number): number => Number(value.toFixed(PLACES));

/** White, fully opaque, as Universal VTT writes colours (`aarrggbb`). */
const WHITE = 'ffffffff';

/** A `#rrggbb` colour as Universal VTT's opaque `ffrrggbb`; white for none or anything else. */
function uvttColor(color: string | null): string {
    return color !== null && /^#[0-9a-f]{6}$/iu.test(color) ? `ff${color.slice(1).toLowerCase()}` : WHITE;
}

/** Join segments that meet end to end into polylines (each segment used once; a closed loop ends where it began). */
export function chainSegments(segments: readonly (readonly [GridPoint, GridPoint])[]): GridPoint[][] {
    const key = (p: GridPoint): string => `${p.x},${p.y}`;
    const remaining = segments.map(([a, b]) => ({ a, b, used: false }));
    const byEnd = new Map<string, typeof remaining>();
    for (const segment of remaining) {
        for (const end of [segment.a, segment.b]) {
            byEnd.set(key(end), [...(byEnd.get(key(end)) ?? []), segment]);
        }
    }
    const next = (at: GridPoint): GridPoint | null => {
        // Every point asked about is a segment's end, so it is indexed.
        const segment = byEnd.get(key(at))?.find((candidate) => !candidate.used);
        if (segment === undefined) {
            return null;
        }
        segment.used = true;
        return key(segment.a) === key(at) ? segment.b : segment.a;
    };
    const lines: GridPoint[][] = [];
    for (const segment of remaining) {
        if (segment.used) {
            continue;
        }
        segment.used = true;
        const line = [segment.a, segment.b];
        // The line grows on from the segment's own ends: forwards from b, then backwards from a.
        for (let end = next(segment.b); end !== null; end = next(end)) {
            line.push(end);
        }
        for (let start = next(segment.a); start !== null; start = next(start)) {
            line.unshift(start);
        }
        lines.push(line);
    }
    return lines;
}

/** `scene` as a Universal VTT file. */
export function toUvtt(scene: UvttScene): Uvtt {
    const { gridSize, rect } = scene;
    const grid = (x: number, y: number): GridPoint => ({ x: round((x - rect.x) / gridSize), y: round((y - rect.y) / gridSize) });
    const solid = scene.walls.filter((wall) => wall.blocksSight && wall.door !== 'door');
    const doors = scene.walls.filter((wall) => wall.door === 'door');
    return {
        format: UVTT_FORMAT,
        resolution: {
            map_origin: { x: 0, y: 0 },
            map_size: { x: round(rect.width / gridSize), y: round(rect.height / gridSize) },
            pixels_per_grid: scene.imageGridSize,
        },
        line_of_sight: chainSegments(solid.map((wall) => [grid(wall.a.x, wall.a.y), grid(wall.b.x, wall.b.y)])),
        objects_line_of_sight: [],
        portals: doors.map((door) => {
            const a = grid(door.a.x, door.a.y);
            const b = grid(door.b.x, door.b.y);
            return {
                position: { x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) },
                bounds: [a, b],
                rotation: round(Math.atan2(b.y - a.y, b.x - a.x)),
                closed: true,
                freestanding: false,
            };
        }),
        environment: { baked_lighting: false, ambient_light: WHITE },
        lights: scene.lights.map((light) => ({
            position: grid(light.x, light.y),
            range: round(light.radius / gridSize),
            intensity: 1,
            color: uvttColor(light.color),
            shadows: true,
        })),
        image: scene.image,
    };
}

/** `CONST.WALL_DOOR_TYPES`: none, door, secret. */
const DOOR_KINDS: readonly UvttDoor[] = ['none', 'door', 'secret'];

/** A Wall document's data, as much as an export reads: its ends, door type, sight restriction (0: none) and levels. */
export interface WallData {
    readonly c: readonly [number, number, number, number];
    readonly door: number;
    readonly sight: number;
    readonly levels: readonly string[];
}

/** An AmbientLight document's data, as much as an export reads: its centre, dim reach (in scene distance units), colour, levels and whether it is hidden. */
export interface LightData {
    readonly x: number;
    readonly y: number;
    readonly hidden: boolean;
    readonly config: { readonly dim: number; readonly color: string | null };
    readonly levels: readonly string[];
}

/** What a level export starts from: the scene's grid (px per square, distance units per square), its map rectangle, and the level's id. */
export interface LevelSource {
    readonly level: string;
    readonly gridSize: number;
    readonly gridDistance: number;
    readonly rect: UvttScene['rect'];
    readonly walls: readonly WallData[];
    readonly lights: readonly LightData[];
    readonly image: string;
    readonly imageGridSize: number;
}

/** Whether a document on `levels` is on `level`: one on no level in particular is on every one. */
const onLevel = (levels: readonly string[], level: string): boolean => levels.length === 0 || levels.includes(level);

/** One level of a scene as a Universal VTT scene: its walls and its lights that shine (hidden ones are off), their reach in px. */
export function levelScene(source: LevelSource): UvttScene {
    const pxPerUnit = source.gridSize / source.gridDistance;
    return {
        gridSize: source.gridSize,
        imageGridSize: source.imageGridSize,
        rect: source.rect,
        walls: source.walls
            .filter((wall) => onLevel(wall.levels, source.level))
            .map((wall) => ({
                a: { x: wall.c[0], y: wall.c[1] },
                b: { x: wall.c[2], y: wall.c[3] },
                door: DOOR_KINDS[wall.door] ?? 'none',
                blocksSight: wall.sight !== 0,
            })),
        lights: source.lights
            .filter((light) => !light.hidden && light.config.dim > 0 && onLevel(light.levels, source.level))
            .map((light) => ({ x: light.x, y: light.y, radius: light.config.dim * pxPerUnit, color: light.config.color })),
        image: source.image,
    };
}
