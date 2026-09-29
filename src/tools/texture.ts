// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Terrain texturing. Each biome and path kind fills with a texture *role*.
 * Asset packs ship texture sets that map roles to images, and the GM picks one
 * set. Water and ocean have no land role: they draw translucent, in a water
 * texture where the set has one. A role the active set lacks falls back to a
 * procedural pattern in the fill's colour, never a flat fill. Pure data plus
 * set resolution; unit-tested. The concrete PIXI tiling lives at the Foundry
 * boundary.
 */
import { BIOMES, BIOME_STYLES, type BiomeKind } from './biome';
import { cssHex } from './colour';
import { patternOf, type Pattern } from './procedural';

/**
 * A pack texture set as the renderer needs it: role → module-served image
 * URL, and, for a GPU-compressed one, the image a panel shows instead.
 */
export interface TextureSetRef {
    readonly key: string;
    readonly name: string;
    readonly textures: Readonly<Record<string, string>>;
    readonly previews?: Readonly<Record<string, string>> | undefined;
    /** Ids of this pack's sets that stand in, in order, for the wall textures this set lacks. */
    readonly fallback?: readonly string[] | undefined;
    /** Role → grid squares one tile of its image spans, where the pack says; else {@link TEXTURE_TILE_SQUARES}. */
    readonly tileSquares?: Readonly<Record<string, number>> | undefined;
}

/** The grid squares one tile of each texture image spans, by its URL, where a set says: the canvas tiles it at that. */
export function tileSquaresByUrl(sets: readonly TextureSetRef[]): Map<string, number> {
    return new Map(
        sets.flatMap((set) =>
            Object.entries(set.tileSquares ?? {}).flatMap(([role, squares]) => {
                const image = set.textures[role];
                return image === undefined ? [] : [[image, squares] as const];
            }),
        ),
    );
}

/** Resolves a texture role to an image URL, or null to use the flat colour. */
export type TextureResolver = (role: string) => string | null;

/** GPU-compressed art (KTX2, Basis; Foundry 14.362): the canvas loads it, a browser cannot show it as an image. */
const COMPRESSED_TEXTURE = /\.(?:ktx2|basis)(?:[?#]|$)/iu;

export function isCompressedTexture(path: string): boolean {
    return COMPRESSED_TEXTURE.test(path);
}

/** What a panel can show for `image`: its preview, else the image itself unless it is compressed (then nothing). */
export function shownImage(image: string, preview: string | undefined): string | null {
    return preview ?? (isCompressedTexture(image) ? null : image);
}

/** Texture role per biome, or null for an untextured (translucent) biome. */
export const BIOME_TEXTURE: Record<BiomeKind, string | null> = {
    water: null,
    ocean: null,
    grassland: 'grassland',
    forest: 'forest',
    sand: 'sand',
    rock: 'rock',
    snow: 'snow',
    dirt: 'dirt',
    lava: 'lava',
    marsh: 'marsh',
    ice: 'ice',
    ash: 'ash',
    tundra: 'tundra',
};

/**
 * Multiply tint for each biome's texture. White (0xffffff) leaves a
 * naturally-coloured photo untouched; the two neutral tiles are recoloured
 * (dark volcanic rock → molten, the reused snow tile → glacial blue).
 */
export const BIOME_TINT: Record<BiomeKind, number> = {
    water: 0xffffff,
    ocean: 0xffffff,
    grassland: 0xffffff,
    forest: 0xffffff,
    sand: 0xffffff,
    rock: 0xffffff,
    snow: 0xffffff,
    dirt: 0xffffff,
    lava: 0xff5a1e,
    marsh: 0xffffff,
    ice: 0xbfe3ec,
    ash: 0xffffff,
    tundra: 0xffffff,
};

/**
 * Grid squares one tile of a terrain texture spans. Pack textures are 512 to
 * 1254 px photos, so drawn this small they keep full detail at any zoom
 * instead of stretching a few texels over a square.
 */
export const TEXTURE_TILE_SQUARES = 2;

/**
 * Scene px one tile of a texture `width` by `height` px spans, in its own
 * proportions: its shorter side `squares` grid squares (the pack's, else
 * {@link TEXTURE_TILE_SQUARES}),
 * its longer side as much more as the image is (a tall plank texture is not
 * squashed square); its own size on a scene with no grid. Every fill tiles
 * from the scene's origin at this size, so overlapping fills of one texture
 * meet without a seam.
 */
export function tileSize(
    gridSize: number,
    width: number,
    height: number,
    squares: number = TEXTURE_TILE_SQUARES,
): { readonly width: number; readonly height: number } {
    if (gridSize <= 0 || width <= 0 || height <= 0) {
        return { width, height };
    }
    const scale = (gridSize * squares) / Math.min(width, height);
    return { width: width * scale, height: height * scale };
}

/** Texture role of a road (a river is drawn in its liquid's). */
export const ROAD_TEXTURE = 'road';

/**
 * Painted ground drawn in a texture of its own instead of its biome's: any
 * texture role (a pack's `floor.cobbled-street`, another biome's), or null
 * for the biome's own. The biome still says what the ground is (its terrain
 * region and colour). A role the active set lacks draws as the biome's own.
 */
export interface Textured {
    readonly texture: string | null;
}

/** A texture role as a person reads it: its last dotted part, hyphens as spaces, capitalised (`floor.cobbled-street` → `Cobbled street`). */
export function roleLabel(role: string): string {
    const words = role.slice(role.lastIndexOf('.') + 1).replaceAll('-', ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A texture in a picker: its role, how it reads, and the image a panel shows (null: none it can show). */
export interface TextureSwatch {
    readonly role: string;
    readonly label: string;
    readonly image: string | null;
}

/** Every texture the active set has, by label, as a picker shows them (`previews` resolves the images panels can show). */
export function textureSwatches(roles: readonly string[], previews: TextureResolver): TextureSwatch[] {
    return roles
        .map((role) => ({ role, label: roleLabel(role), image: previews(role) }))
        .sort((a, b) => a.label.localeCompare(b.label) || a.role.localeCompare(b.role));
}

/** How a biome looks in a picker: its texture from the set (null: none, so its flat colour) and its flat colour. */
export interface BiomeSwatch {
    readonly biome: BiomeKind;
    readonly image: string | null;
    readonly colour: string;
}

/** Every biome's swatch under the active set, in the biome order. */
export function biomeSwatches(resolve: TextureResolver): BiomeSwatch[] {
    return BIOMES.map((biome) => {
        const role = BIOME_TEXTURE[biome];
        return { biome, image: role === null ? null : resolve(role), colour: cssHex(BIOME_STYLES[biome].fill) };
    });
}

/** The chosen texture set, or the first available when the choice is unset or no longer installed. */
export function pickTextureSet(sets: readonly TextureSetRef[], chosen: string): TextureSetRef | null {
    return sets.find((set) => set.key === chosen) ?? sets[0] ?? null;
}

/**
 * A resolver over one texture set, plus the procedural patterns (`patterns`
 * gives each one's image). A wall role the set lacks is borrowed from the
 * first of `others` that has it: a wall drawn in real masonry, never a flat
 * grey band. Any other role the set lacks resolves to null, and the renderer
 * falls back to a pattern.
 */
export function textureResolver(set: TextureSetRef | null, patterns: (pattern: Pattern) => string, others: readonly TextureSetRef[] = []): TextureResolver {
    return (role) => {
        const pattern = patternOf(role);
        if (pattern !== null) {
            return patterns(pattern);
        }
        const own = set?.textures[role];
        if (own !== undefined) {
            return own;
        }
        return role.startsWith(WALL_ROLE_PREFIX)
            ? standIns(set, others)
                  .map((other) => other.textures[role])
                  .find((image) => image !== undefined) ?? null
            : null;
    };
}

/** The sets that stand in for `set`'s missing walls, in order: those it names as its `fallback`, then the rest as listed. */
function standIns(set: TextureSetRef | null, others: readonly TextureSetRef[]): TextureSetRef[] {
    const pack = set === null ? '' : set.key.slice(0, set.key.indexOf(':') + 1);
    const named = (set?.fallback ?? []).flatMap((id) => others.filter((other) => other.key === `${pack}${id}`));
    return [...named, ...others.filter((other) => !named.includes(other))];
}

/** The prefix of the texture roles walls are drawn in (`wall.stone`, `wall.brick`). */
const WALL_ROLE_PREFIX = 'wall.';

/**
 * The images panels show for one texture set's roles: each role's preview, or
 * its image when a browser can show it, and the procedural patterns as they
 * are. A compressed image with no preview resolves to null, and the panel
 * shows the fill's colour instead.
 */
export function previewResolver(set: TextureSetRef | null, patterns: (pattern: Pattern) => string): TextureResolver {
    return (role) => {
        const pattern = patternOf(role);
        if (pattern !== null) {
            return patterns(pattern);
        }
        const image = set?.textures[role];
        return image === undefined ? null : shownImage(image, set?.previews?.[role]);
    };
}

/** Every GPU-compressed image in a texture set, for the canvas to load before it draws with them. */
export function compressedTextures(set: TextureSetRef | null): string[] {
    return Object.values(set?.textures ?? {}).filter(isCompressedTexture);
}

/** Setting choices: texture set key → display name. */
export function textureSetChoices(sets: readonly TextureSetRef[]): Record<string, string> {
    return Object.fromEntries(sets.map((set) => [set.key, set.name]));
}
