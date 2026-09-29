// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * {@link SplatRenderer} in PIXI: each splat map is one quad over its scene
 * bounds, drawn by a small shader that blends its four channel textures by
 * the mask's weights, per pixel. Each texture tiles from the scene's origin at
 * the same grid-relative size as painted terrain, and takes its biome's tint; where the weights sum below full, the
 * map below shows through. A brush stroke re-uploads only the mask.
 */
import type { SplatRenderer } from '../canvas/controller';
import { roleLook } from '../canvas/renderer';
import { MAX_SPLAT_LAYERS, type SplatLayer } from '../tools/splat';
import type { TextureResolver } from '../tools/texture';
import { canvasTexture, tileOf } from './pixi-surface';

const VERTEX = `
precision highp float;
attribute vec2 aVertexPosition;
attribute vec2 aUv;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vUv;
varying vec2 vScene;
void main() {
    vUv = aUv;
    vScene = aVertexPosition;
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

// Scene coordinates run to many thousands of px; a medium-precision float rounds them to whole texels and pixelates the
// tiling, so the fragment stage works in high precision.
const FRAGMENT = `
precision highp float;
varying vec2 vUv;
varying vec2 vScene;
uniform sampler2D uMask;
uniform sampler2D uTex0;
uniform sampler2D uTex1;
uniform sampler2D uTex2;
uniform sampler2D uTex3;
uniform vec2 uTile[4];
uniform vec3 uTint[4];
uniform float uAlpha[4];
vec3 layer(sampler2D tex, vec2 tile, vec3 tint) {
    return texture2D(tex, vScene / tile).rgb * tint;
}
void main() {
    vec4 w = texture2D(uMask, vUv);
    w *= vec4(uAlpha[0], uAlpha[1], uAlpha[2], uAlpha[3]);
    float sum = w.r + w.g + w.b + w.a;
    if (sum <= 0.0) {
        discard;
    }
    vec3 colour = (layer(uTex0, uTile[0], uTint[0]) * w.r + layer(uTex1, uTile[1], uTint[1]) * w.g
        + layer(uTex2, uTile[2], uTint[2]) * w.b + layer(uTex3, uTile[3], uTint[3]) * w.a) / sum;
    float alpha = min(sum, 1.0);
    gl_FragColor = vec4(colour * alpha, alpha);
}`;

/** Tile size, scene px, for a texture that has not loaded yet. */
const PENDING_TILE = 256;

interface Drawn {
    readonly mesh: PIXI.Mesh<PIXI.Shader>;
    readonly mask: PIXI.BaseTexture;
    readonly layer: SplatLayer;
}

/** Longest side of a baked image, in pixels: a large scene bakes at reduced resolution. */
const MAX_BAKE_SIDE = 4096;

/**
 * `drawn`'s blend rendered over its scene rectangle as PNG bytes. It renders a
 * copy of the mesh with no parent: a drawn mesh would carry the canvas's pan
 * and zoom into the image.
 */
async function snapshotOf(stack: readonly [Drawn, ...Drawn[]]): Promise<Uint8Array<ArrayBuffer> | null> {
    const renderer = canvas?.app?.renderer;
    if (!renderer) {
        return null;
    }
    const { x, y, width, height } = stack[0].layer.bounds;
    // Loose copies, bottom of the stack first, so the canvas's pan and zoom stay out of the image.
    const loose = new PIXI.Container();
    loose.addChild(...stack.map((drawn) => new PIXI.Mesh(drawn.mesh.geometry, drawn.mesh.shader)));
    const texture = renderer.generateTexture(loose, {
        region: new PIXI.Rectangle(x, y, width, height),
        resolution: Math.min(1, MAX_BAKE_SIDE / Math.max(width, height)),
    });
    try {
        const url = await renderer.extract.base64(texture, 'image/png');
        return new Uint8Array(await (await fetch(url)).arrayBuffer());
    } finally {
        texture.destroy(true);
        // The copies share the drawn meshes' geometry and shaders, which stay.
        loose.destroy({ children: true });
    }
}

function rgb(colour: number): [number, number, number] {
    return [((colour >> 16) & 0xff) / 255, ((colour >> 8) & 0xff) / 255, (colour & 0xff) / 255];
}

interface ChannelUniforms {
    readonly uTex0: PIXI.Texture | undefined;
    readonly uTex1: PIXI.Texture | undefined;
    readonly uTex2: PIXI.Texture | undefined;
    readonly uTex3: PIXI.Texture | undefined;
    uTile: number[];
    readonly uTint: number[];
    readonly uAlpha: number[];
}

/** Each texture's tile size in scene px, as painted terrain tiles it, once it has loaded. */
function tileSizes(textures: readonly PIXI.Texture[], gridSize: number): number[] {
    return textures.flatMap((texture) => {
        const base = texture.baseTexture;
        if (!base.valid) {
            return [PENDING_TILE, PENDING_TILE];
        }
        const tile = tileOf(base, gridSize);
        return [tile.width, tile.height];
    });
}

/** Each channel's texture, tile size, tint and alpha for `layer`'s roles; an unused channel draws nothing. */
function channelTextures(
    layer: SplatLayer,
    resolve: TextureResolver,
    gridSize: number,
): { readonly textures: PIXI.Texture[]; readonly uniforms: ChannelUniforms } {
    const looks = layer.roles.map((role) => (role === null ? null : roleLook(role, resolve)));
    // canvasTexture's sampler wraps, so tiles meet without the seam a fract() of the coordinate leaves under linear
    // filtering.
    const textures = looks.map((look) => (look && look.texture !== null ? canvasTexture(look.texture) : PIXI.Texture.WHITE));
    return {
        textures,
        uniforms: {
            uTex0: textures[0],
            uTex1: textures[1],
            uTex2: textures[2],
            uTex3: textures[3],
            uTile: tileSizes(textures, gridSize),
            uTint: looks.flatMap((look) => rgb(look?.tint ?? 0)),
            uAlpha: looks.map((look) => (look ? 1 : 0)),
        },
    };
}

/** Draw splat maps into `container` on a grid of `gridSize` px (0: none). */
export function createSplatRenderer(container: PIXI.Container, resolve: TextureResolver, gridSize: number): SplatRenderer {
    const drawn = new Map<string, Drawn>();
    const program = PIXI.Program.from(VERTEX, FRAGMENT);

    const remove = (key: string): void => {
        const old = drawn.get(key);
        if (old) {
            container.removeChild(old.mesh);
            old.mesh.destroy();
            old.mask.destroy();
            drawn.delete(key);
        }
    };

    return {
        set: (key, layer, pixels) => {
            remove(key);
            const { x, y, width, height } = layer.bounds;
            const geometry = new PIXI.Geometry()
                .addAttribute('aVertexPosition', [x, y, x + width, y, x + width, y + height, x, y + height], 2)
                .addAttribute('aUv', [0, 0, 1, 0, 1, 1, 0, 1], 2)
                .addIndex([0, 1, 2, 0, 2, 3]);
            const mask = PIXI.BaseTexture.fromBuffer(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), layer.width, layer.height, {
                alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA,
                scaleMode: PIXI.SCALE_MODES.LINEAR,
            });
            const channels = channelTextures(layer, resolve, gridSize);
            const uniforms = { uMask: new PIXI.Texture(mask), ...channels.uniforms };
            // A texture still loading tiles at a stand-in size until it arrives.
            for (const texture of channels.textures.filter((t) => !t.baseTexture.valid)) {
                texture.baseTexture.once('loaded', () => {
                    uniforms.uTile = tileSizes(channels.textures, gridSize);
                });
            }
            const mesh = new PIXI.Mesh(geometry, new PIXI.Shader(program, uniforms));
            // Beneath the painted terrain and paths, above the scene's own background; among the splat maps, in stack
            // order, and one on every level beneath a level's own.
            const below = [...drawn.values()].filter((other) => stackOrder(other.layer) < stackOrder(layer)).length;
            container.addChildAt(mesh, below);
            drawn.set(key, { mesh, mask, layer });
        },
        update: (key) => {
            drawn.get(key)?.mask.update();
        },
        remove,
        snapshot: async (keys) => {
            const [first, ...rest] = keys.flatMap((key) => drawn.get(key) ?? []);
            return first ? snapshotOf([first, ...rest]) : null;
        },
    };
}

/** Where a layer draws among the splat maps: every level's stack first, then a level's own, each bottom to top. */
function stackOrder(layer: SplatLayer): number {
    return (layer.level === null ? 0 : MAX_SPLAT_LAYERS) + layer.index;
}
