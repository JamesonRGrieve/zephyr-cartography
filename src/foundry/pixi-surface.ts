// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Concrete {@link DrawSurface} backed by PIXI: one keyed node per feature in a
 * container — a PIXI.Graphics for a flat colour fill, or a Container holding a
 * masked TilingSprite for a textured fill. This is the Foundry/PIXI boundary —
 * the only module that touches PIXI directly.
 *
 * A textured fill tiles from the scene's origin at the grid-relative
 * {@link tileSize}, so overlapping fills of one texture line up. A feathered
 * one softens only its mask's edge: blurring the fill itself would smear the
 * whole texture.
 */
import type { DrawSurface } from '../canvas/renderer';
import { isCompressedTexture, tileSize } from '../tools/texture';

/** Blur strength (px) for a feathered (soft-edged) region boundary. */
const FEATHER_BLUR = 6;

/** Room (px) left round a feathered mask for its blur to spread into. */
const FEATHER_PAD = FEATHER_BLUR * 2;

/** Longest side (px) a feathered mask is rendered at: a larger area's mask is rendered coarser, its edge soft anyway. */
const MAX_MASK_SIDE = 4096;

interface Bounds {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

/**
 * The texture the canvas draws `url` with. PIXI decodes ordinary images
 * itself; GPU-compressed art (KTX2, Basis) only Foundry's loader decodes, so
 * the pack runtime loads a texture set's compressed images before anything
 * redraws with them, and they come from Foundry's cache here (empty until
 * then).
 */
export function canvasTexture(url: string): PIXI.Texture {
    if (!isCompressedTexture(url)) {
        return powerOfTwoTexture(url);
    }
    const loaded = foundry.canvas.getTexture(url);
    return loaded instanceof PIXI.Texture ? loaded : PIXI.Texture.EMPTY;
}

/** The size of each image as drawn, before it was resampled to power-of-two sides: its tiles keep these proportions. */
const IMAGE_SIZES = new WeakMap<PIXI.BaseTexture, { readonly width: number; readonly height: number }>();

/** The size `base`'s image was drawn at: its own, not the power-of-two sides it was resampled to. */
function imageSize(base: PIXI.BaseTexture): { readonly width: number; readonly height: number } {
    return IMAGE_SIZES.get(base) ?? { width: base.width, height: base.height };
}

/**
 * Each terrain image, loaded once and shared by every fill of it. Each fill
 * gets its own Texture over it: a scene torn down destroys its fills'
 * textures, and one shared texture would then draw nothing in the next.
 */
const TERRAIN_IMAGES = new Map<string, PIXI.BaseTexture>();

/** Each terrain texture's image URL, for the squares its pack says one tile spans. */
const TEXTURE_URLS = new WeakMap<PIXI.BaseTexture, string>();

/** Grid squares one tile of an image spans, by URL, as the loaded packs' texture sets say; others take the default. */
let tileSquares: ReadonlyMap<string, number> = new Map();

/** Take the loaded packs' tile squares (`tileSquaresByUrl`): the canvas tiles each image at its own. */
export function setTileSquares(squares: ReadonlyMap<string, number>): void {
    tileSquares = squares;
}

/** Scene px one tile of `base`'s texture spans: its image's own proportions, at the squares its pack gives it. */
export function tileOf(base: PIXI.BaseTexture, gridSize: number): { readonly width: number; readonly height: number } {
    const own = imageSize(base);
    const url = TEXTURE_URLS.get(base);
    const squares = url === undefined ? undefined : tileSquares.get(url);
    return tileSize(gridSize, own.width, own.height, squares);
}

/**
 * The terrain texture for the image at `url`, resampled to power-of-two sides
 * (an 819 × 818 photo to 1024 × 1024) as it loads. PIXI 7 tiles any other
 * size in a shader that wraps its low-precision texture coordinates by hand,
 * which draws thin dark seams across a large fill where tiles meet; a
 * power-of-two texture it tiles by the GPU's own repeat. The texture is
 * empty, and not yet valid, until the image arrives; its tiles keep the
 * image's own proportions ({@link imageSize}). Terrain tiles are drawn well
 * below their own size, so it is mipmapped: a shrunk photo would shimmer.
 */
function powerOfTwoTexture(url: string): PIXI.Texture {
    const loaded = TERRAIN_IMAGES.get(url);
    return new PIXI.Texture(loaded ?? loadPowerOfTwo(url));
}

/** Terrain images asked for and not yet arrived (or failed). */
const LOADING = new Set<HTMLImageElement>();

/** How many terrain images are still loading: a map is fully drawn once none are. */
export function terrainImagesLoading(): number {
    return LOADING.size;
}

/** Load the image at `url` into a base texture resampled to power-of-two sides, cached until it is destroyed. */
function loadPowerOfTwo(url: string): PIXI.BaseTexture {
    const pixels = document.createElement('canvas');
    pixels.width = 0;
    pixels.height = 0;
    const resource = new PIXI.CanvasResource(pixels);
    const base = new PIXI.BaseTexture(resource, { wrapMode: PIXI.WRAP_MODES.REPEAT, mipmap: PIXI.MIPMAP_MODES.ON });
    TEXTURE_URLS.set(base, url);
    // A destroyed image (a fill destroyed with its base) is loaded afresh next time it is wanted.
    base.once('destroyed', () => {
        if (TERRAIN_IMAGES.get(url) === base) {
            TERRAIN_IMAGES.delete(url);
        }
    });
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.addEventListener(
        'load',
        () => {
            LOADING.delete(image);
            if (base.destroyed) {
                return;
            }
            IMAGE_SIZES.set(base, { width: image.naturalWidth, height: image.naturalHeight });
            pixels.width = PIXI.utils.nextPow2(image.naturalWidth);
            pixels.height = PIXI.utils.nextPow2(image.naturalHeight);
            pixels.getContext('2d')?.drawImage(image, 0, 0, pixels.width, pixels.height);
            // Sized, the texture becomes valid and says so ('loaded'), as one PIXI loaded itself would.
            resource.resize(pixels.width, pixels.height);
        },
        { once: true },
    );
    // A missing image leaves its fill empty; it is no longer awaited.
    image.addEventListener('error', () => LOADING.delete(image), { once: true });
    LOADING.add(image);
    image.src = url;
    TERRAIN_IMAGES.set(url, base);
    return base;
}

/** Axis-aligned bounding box of a flat `[x, y, …]` polygon. */
function bounds(polygon: readonly number[]): Bounds {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i + 1 < polygon.length; i += 2) {
        const x = polygon[i] ?? 0;
        const y = polygon[i + 1] ?? 0;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

/**
 * A tiling sprite's tile offset and scale. The bundled PIXI typings leave its
 * `ObservablePoint`s untyped; this is the part of them used here, which the
 * sprite satisfies structurally.
 */
interface TileTransform {
    readonly tilePosition: { set: (x: number, y: number) => void };
    readonly tileScale: { set: (x: number, y: number) => void };
    /** Turns the tiling about the tile origin (radians). */
    readonly tileTransform: { rotation: number };
}

/** Size `sprite`'s tiles to {@link tileSize} once its texture's size is known. */
function scaleTiles(sprite: PIXI.TilingSprite, tiles: TileTransform, gridSize: number): void {
    const base = sprite.texture.baseTexture;
    const apply = (): void => {
        // A fill redrawn before its texture arrived (a stroke painted on as it is dragged) is already gone.
        if (sprite.destroyed) {
            return;
        }
        // The tile keeps the image's own proportions; the scale maps the pixels as they now are onto it.
        const tile = tileOf(base, gridSize);
        tiles.tileScale.set(tile.width / base.width, tile.height / base.height);
    };
    if (base.valid) {
        apply();
    } else {
        base.once('loaded', apply);
    }
}

/**
 * A drawn node, and the feathered mask texture rendered for it with the
 * outline it was rendered from (textures from the shared cache are never
 * destroyed with a node).
 */
interface Node {
    readonly node: PIXI.Container;
    readonly mask: { readonly texture: PIXI.RenderTexture; readonly outline: string } | null;
}

/** The polygon's outline as a key: a fill redrawn with the same one reuses its rendered mask. */
function outlineKey(polygon: readonly number[]): string {
    return polygon.join(',');
}

/** The polygon's shape, filled white, as a mask draws it. */
function maskShape(polygon: readonly number[]): PIXI.Graphics {
    const shape = new PIXI.Graphics();
    shape.beginFill(0xffffff);
    shape.drawPolygon([...polygon]);
    shape.endFill();
    return shape;
}

/** The scene area a feathered mask of `polygon` covers: its bounds and the blur round them. */
function featherRegion(polygon: readonly number[]): PIXI.Rectangle {
    const b = bounds(polygon);
    return new PIXI.Rectangle(b.x - FEATHER_PAD, b.y - FEATHER_PAD, b.w + 2 * FEATHER_PAD, b.h + 2 * FEATHER_PAD);
}

/**
 * The polygon rendered blurred into a texture, as a feathered alpha mask, or
 * null without a renderer. Rendering it is costly (a large blur pass), so a
 * mask is rendered once per outline and reused while the outline holds.
 */
function renderMask(polygon: readonly number[]): PIXI.RenderTexture | null {
    const renderer = canvas?.app?.renderer;
    if (!renderer) {
        return null;
    }
    const shape = maskShape(polygon);
    shape.filters = [new PIXI.BlurFilter(FEATHER_BLUR)];
    const region = featherRegion(polygon);
    const texture = renderer.generateTexture(shape, { region, resolution: Math.min(1, MAX_MASK_SIDE / Math.max(region.width, region.height)) });
    shape.destroy();
    return texture;
}

/** A sprite showing a feathered mask texture over the area it was rendered from. */
function maskSprite(texture: PIXI.RenderTexture, polygon: readonly number[]): PIXI.Sprite {
    const region = featherRegion(polygon);
    const mask = new PIXI.Sprite(texture);
    mask.x = region.x;
    mask.y = region.y;
    return mask;
}

/**
 * Destroy a drawn node, unless something already has: the canvas tears its
 * layers down with their children on a redraw, and a Graphics destroyed
 * twice throws (its geometry is gone).
 */
function discard(node: PIXI.DisplayObject): void {
    if (!node.destroyed) {
        node.destroy({ children: true });
    }
}

/** Draw into `container` on a grid of `gridSize` px (0: none). */
export function createPixiSurface(container: PIXI.Container, gridSize: number): DrawSurface {
    const nodes = new Map<string, Node>();
    /**
     * Masks of the nodes the last clear took away, by id. A clear is a redraw
     * starting over (to rebuild the draw order), so the fills it brings back
     * take their masks from here; those not taken are released by the next
     * clear.
     */
    let spare = new Map<string, NonNullable<Node['mask']>>();

    const release = (mask: Node['mask'] | undefined, keep: PIXI.RenderTexture | null): void => {
        if (mask && mask.texture !== keep && !mask.texture.destroyed) {
            mask.texture.destroy(true);
        }
    };

    /** Take the node with `id` off the canvas, releasing its mask texture (and any spare one) unless `keep` is it. */
    const drop = (id: string, keep: PIXI.RenderTexture | null = null): void => {
        release(spare.get(id), keep);
        spare.delete(id);
        const drawn = nodes.get(id);
        if (drawn) {
            container.removeChild(drawn.node);
            discard(drawn.node);
            release(drawn.mask, keep);
            nodes.delete(id);
        }
    };

    /** The feathered mask already rendered for `id` from this very outline, drawn or spare, if there is one. */
    const renderedMask = (id: string, outline: string): PIXI.RenderTexture | null => {
        const kept = [nodes.get(id)?.mask, spare.get(id)].find((mask) => mask?.outline === outline && !mask.texture.destroyed);
        return kept?.texture ?? null;
    };

    return {
        fill(id, polygon, color, alpha, feather): void {
            drop(id);
            // A flat colour has no detail to smear, so its whole fill blurs and needs no mask.
            const g = new PIXI.Graphics();
            g.beginFill(color, alpha);
            g.drawPolygon([...polygon]);
            g.endFill();
            g.filters = feather ? [new PIXI.BlurFilter(FEATHER_BLUR)] : null;
            container.addChild(g);
            nodes.set(id, { node: g, mask: null });
        },
        fillTextured(id, polygon, textureUrl, tint, alpha, feather, angle): void {
            const outline = outlineKey(polygon);
            const reused = feather ? renderedMask(id, outline) : null;
            drop(id, reused);
            const b = bounds(polygon);
            const pad = feather ? FEATHER_PAD : 0;
            const wrap = new PIXI.Container();
            const sprite = new PIXI.TilingSprite(canvasTexture(textureUrl), b.w + 2 * pad, b.h + 2 * pad);
            // Named for the image it draws: its texture is resampled, so no longer carries the image's URL itself.
            sprite.name = textureUrl;
            sprite.x = b.x - pad;
            sprite.y = b.y - pad;
            const tiles: TileTransform = sprite;
            // Tiles start from the scene's origin, not the fill's corner, turned about it.
            tiles.tilePosition.set(pad - b.x, pad - b.y);
            tiles.tileTransform.rotation = angle;
            scaleTiles(sprite, tiles, gridSize);
            sprite.tint = tint;
            sprite.alpha = alpha;
            const texture = feather ? reused ?? renderMask(polygon) : null;
            // Without a feather (or a renderer) the polygon itself masks, with a crisp edge.
            const mask = texture ? maskSprite(texture, polygon) : maskShape(polygon);
            sprite.mask = mask;
            wrap.addChild(mask, sprite);
            container.addChild(wrap);
            nodes.set(id, { node: wrap, mask: texture ? { texture, outline } : null });
        },
        remove(id): void {
            drop(id);
        },
        clear(): void {
            for (const mask of spare.values()) {
                release(mask, null);
            }
            const kept = new Map<string, NonNullable<Node['mask']>>();
            for (const [id, drawn] of nodes) {
                if (drawn.mask) {
                    kept.set(id, drawn.mask);
                }
                container.removeChild(drawn.node);
                discard(drawn.node);
            }
            nodes.clear();
            spare = kept;
        },
    };
}
