// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Export the viewed level of the viewed scene as Universal VTT (`.dd2vtt`):
 * its walls, doors and lights read from the scene's documents, and its
 * image, given by the caller (a render of the map) or else the level's own
 * background art, read from where Foundry serves it. The conversion itself
 * is pure (`generate/uvtt.ts`).
 */
import { levelScene, type LightData, toUvtt, type Uvtt, type WallData } from '../generate/uvtt';

/** What the caller may give: the map's image as base64 (no `data:` prefix), at its own px per square. */
export interface UvttExportOptions {
    readonly image?: string;
    readonly imageGridSize?: number;
}

/** `bytes` as base64. */
function base64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

/** The image at `src` as base64, and its width in px; null when it cannot be read. */
async function readImage(src: string): Promise<{ image: string; width: number } | null> {
    const response = await fetch(src);
    if (!response.ok) {
        return null;
    }
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const { width } = bitmap;
    bitmap.close();
    return { image: base64(new Uint8Array(await blob.arrayBuffer())), width };
}

/** A Wall document's export data. */
function wallData(wall: WallDocument.Implementation): WallData {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = wall.c;
    // A wall saved before its door type or sight was set reads as Foundry's defaults: no door, blocking sight.
    return { c: [x1, y1, x2, y2], door: wall.door ?? CONST.WALL_DOOR_TYPES.NONE, sight: wall.sight ?? CONST.EDGE_SENSE_TYPES.NORMAL, levels: [...wall.levels] };
}

/** An AmbientLight document's export data, its colour as `#rrggbb` or none. */
function lightData(light: AmbientLightDocument.Implementation): LightData {
    const color = light.config.color;
    return {
        x: light.x,
        y: light.y,
        hidden: light.hidden,
        config: { dim: light.config.dim, color: color === null ? null : color.css },
        levels: [...light.levels],
    };
}

/**
 * The viewed level as Universal VTT, or null with no scene viewed, or no
 * image given and none the level's own that can be read.
 */
export async function exportViewedLevel(options: UvttExportOptions): Promise<Uvtt | null> {
    const scene = canvas?.scene;
    const level = canvas?.level;
    const dimensions = canvas?.dimensions;
    const levelId = level?.id ?? null;
    if (!scene || !level || levelId === null || !dimensions) {
        return null;
    }
    const rect = dimensions.sceneRect;
    const gridSize = scene.grid.size;
    let image = options.image;
    let imageGridSize = options.imageGridSize ?? gridSize;
    if (image === undefined) {
        const src = level.background.src;
        const read = src === null || src === '' ? null : await readImage(src);
        if (read === null) {
            return null;
        }
        image = read.image;
        // The background is drawn over the scene's rectangle, so its px per square is its width over the squares across.
        imageGridSize = (read.width * gridSize) / rect.width;
    }
    return toUvtt(
        levelScene({
            level: levelId,
            gridSize,
            gridDistance: scene.grid.distance,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            walls: scene.walls.contents.map(wallData),
            lights: scene.lights.contents.map(lightData),
            image,
            imageGridSize,
        }),
    );
}
