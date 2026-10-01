// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * {@link SplatStore} over the live scene and the world's data folder: the
 * layers live in the scene's `splats` flag, and each mask is an exact RGBA
 * PNG (`tools/png.ts`) under `worlds/<world>/zephyr-cartography/`, uploaded
 * through Foundry's own file picker. A baked blend is a PNG beside its mask,
 * shown by a native Tile. Only the GM saves; everyone reads.
 */
import type { SplatStore } from '../canvas/controller';
import { I18N } from '../i18n';
import { MODULE_ID } from '../module-id';
import { decodePng, encodePng, type RgbaImage } from '../tools/png';
import { parseSplatLayers, type SplatLayer } from '../tools/splat';
import type { FoundryScene } from './boundary';
import { firstCreatedId } from './created-id';
import { localize } from './localize';

const SPLAT_FLAG = 'splats';

/** A tile anchored at its centre. */
const CENTRE = 0.5;

/** The world's folder for the module's files. */
function worldFolder(): string {
    return `worlds/${game.world?.id ?? 'world'}/${MODULE_ID}`;
}

/** Make the module's world folder once per session; it already existing is fine. */
let folderReady: Promise<void> | null = null;
async function ensureFolder(): Promise<void> {
    folderReady ??= (async (): Promise<void> => {
        try {
            await foundry.applications.apps.FilePicker.implementation.createDirectory('data', worldFolder());
        } catch {
            // The folder is there already: Foundry refuses to make it twice.
        }
    })();
    await folderReady;
}

/** An 8-bit RGBA or RGB PNG as pixels, or null when it cannot be fetched or decoded. */
async function readImage(path: string): Promise<RgbaImage | null> {
    try {
        const response = await fetch(path, { cache: 'no-store' });
        return response.ok ? await decodePng(new Uint8Array(await response.arrayBuffer())) : null;
    } catch {
        return null;
    }
}

/** Save `png` to `path`, a file in the module's world folder. */
async function upload(path: string, png: Uint8Array<ArrayBuffer>): Promise<void> {
    await ensureFolder();
    const file = new File([png], path.slice(path.lastIndexOf('/') + 1), { type: 'image/png' });
    await foundry.applications.apps.FilePicker.implementation.upload('data', worldFolder(), file, {}, { notify: false });
}

/** A baked Tile's `sort`: beneath the tiles Foundry places at its default 0. */
const BAKED_TILE_SORT = -1;

/** Where a layer's tile sits: its level's floor, or 0 on a layer on every level. */
function floorOf(scene: FoundryScene, layer: SplatLayer): number {
    const level = layer.level === null ? undefined : scene.levels.contents.find((l) => l.id === layer.level);
    const bottom = level?.elevation.bottom ?? null;
    return bottom !== null && Number.isFinite(bottom) ? bottom : 0;
}

export function createSplatStore(getScene: () => FoundryScene | null): SplatStore {
    return {
        readImage,
        writeImage: upload,
        createTile: async (layer, src) => {
            const scene = getScene();
            if (!scene) {
                return null;
            }
            const { x, y, width, height } = layer.bounds;
            const created = await scene.createEmbeddedDocuments('Tile', [
                {
                    name: localize(I18N.splats.baked),
                    // The anchor is the tile's centre, as the engine's stamp tiles are placed.
                    texture: { src, anchorX: CENTRE, anchorY: CENTRE },
                    x: x + width * CENTRE,
                    y: y + height * CENTRE,
                    width,
                    height,
                    elevation: floorOf(scene, layer),
                    sort: BAKED_TILE_SORT,
                    ...(layer.level === null ? {} : { levels: [layer.level] }),
                },
            ]);
            return firstCreatedId(created);
        },
        removeTile: async (id) => {
            const scene = getScene();
            // A GM may have deleted the Tile by hand already.
            if (scene?.tiles.has(id) === true) {
                await scene.deleteEmbeddedDocuments('Tile', [id]);
            }
        },
        load: () => {
            const scene = getScene();
            return scene ? parseSplatLayers(scene.getFlag(MODULE_ID, SPLAT_FLAG)) : [];
        },
        save: async (layers) => {
            await getScene()?.setFlag(MODULE_ID, SPLAT_FLAG, layers);
        },
        readMask: async (layer) => {
            const image = await readImage(layer.path);
            return image?.width === layer.width && image.height === layer.height ? image.pixels : null;
        },
        writeMask: async (layer: SplatLayer, mask) => {
            await upload(layer.path, await encodePng({ width: layer.width, height: layer.height, pixels: mask }));
        },
        // A level's first layer keeps the path a lone layer always had.
        pathFor: (level, index) => `${worldFolder()}/splat-${getScene()?.id ?? 'scene'}-${level ?? 'all'}${index === 0 ? '' : `-${index}`}.png`,
    };
}
