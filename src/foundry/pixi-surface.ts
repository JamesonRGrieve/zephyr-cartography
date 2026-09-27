// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Concrete {@link DrawSurface} backed by PIXI: one keyed node per feature in a
 * container — a PIXI.Graphics for a flat colour fill, or a Container holding a
 * masked TilingSprite for a textured fill. This is the Foundry/PIXI boundary —
 * the only module that touches PIXI directly.
 *
 * A textured fill tiles from the scene's origin at the grid-relative
 * {@link tileSpan}, so overlapping fills of one texture line up. A feathered
 * one softens only its mask's edge: blurring the fill itself would smear the
 * whole texture.
 */
import type { DrawSurface } from '../canvas/renderer';
import { isCompressedTexture, tileSpan } from '../tools/texture';

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
        const texture = PIXI.Texture.from(url);
        // Terrain tiles repeat, and are drawn well below their own size: without mipmaps (PIXI builds them only for
        // power-of-two images by default) a shrunk photo shimmers and aliases. Compressed art carries its own levels.
        texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
        texture.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
        return texture;
    }
    const loaded = foundry.canvas.getTexture(url);
    return loaded instanceof PIXI.Texture ? loaded : PIXI.Texture.EMPTY;
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

/** Size `sprite`'s tiles to {@link tileSpan} once its texture's size is known. */
function scaleTiles(sprite: PIXI.TilingSprite, tiles: TileTransform, gridSize: number): void {
    const base = sprite.texture.baseTexture;
    const apply = (): void => {
        // A fill redrawn before its texture arrived (a stroke painted on as it is dragged) is already gone.
        if (sprite.destroyed) {
            return;
        }
        tiles.tileScale.set(tileSpan(gridSize, base.width) / base.width, tileSpan(gridSize, base.height) / base.height);
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
            drawn.node.destroy({ children: true });
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
                drawn.node.destroy({ children: true });
            }
            nodes.clear();
            spare = kept;
        },
    };
}
