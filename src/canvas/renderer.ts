// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Feature rendering over a keyed {@link DrawSurface} seam. Paths become smoothed,
 * variable-width ribbon polygons; biome regions become smoothed, closed fills.
 * Style is derived from the feature, so the controller just hands over features;
 * the concrete PIXI surface lives at the Foundry boundary, keeping this pure.
 */
import { brushOutline, buildRibbon, RIBBON_SAMPLES, ribbonOutline } from '../geometry/ribbon';
import { perimeterSegments, type Segment, segmentBand } from '../geometry/wall';
import { BIOME_STYLES, isBiomeKind, type BiomeKind } from '../tools/biome';
import { tintToward } from '../tools/colour';
import type { DoorAnimationType } from '../tools/documents';
import { type Feature, isAnchored } from '../tools/feature';
import { materialName } from '../tools/materials';
import type { CartographyPath, Liquid } from '../tools/path';
import { proceduralRole, type Pattern } from '../tools/procedural';
import { regionOutline } from '../tools/region';
import { BIOME_TEXTURE, BIOME_TINT, ROAD_TEXTURE, type Textured, type TextureResolver } from '../tools/texture';

/**
 * Opacity of a textured land fill: opaque, so strokes of one texture laid
 * over each other look like one painted area instead of darkening where they
 * overlap. Their feathered edges still blend into what lies beneath.
 */
const TEXTURE_ALPHA = 1;

/** Neutral (no-op) multiply tint for a naturally-coloured texture. */
const NO_TINT = 0xffffff;

/** The multiply tint of a parapet round the top of masonry, against the same stone underfoot within it. */
const PARAPET_TINT = 0x8a8a8a;

interface RibbonStyle {
    readonly fill: number;
    readonly alpha: number;
}

const ROAD_STYLE: RibbonStyle = { fill: 0x6b5a44, alpha: 0.85 };

const PREVIEW_STYLE: RibbonStyle = { fill: 0xff9c00, alpha: 0.4 };

/** How opaque each liquid is: water lets its bed show through, lava hides it. */
const LIQUID_ALPHA: Record<Liquid, number> = { water: 0.85, lava: 0.92, poison: 0.8, acid: 0.8 };

/**
 * Texture roles a liquid is drawn in, the first the active set has; with none, it ripples. Water is still water (a moat, a
 * stream), never an open sea's waves; lightly tinted and nearly opaque, it reads as water, never as a dark road.
 */
const LIQUID_ROLES: Record<Liquid, readonly string[]> = {
    water: ['water', 'floor.shallow-water', 'floor.calm-sea'],
    lava: ['lava'],
    poison: ['poison', 'floor.toxic-sludge'],
    acid: ['acid', 'floor.toxic-sludge'],
};

/**
 * How far a liquid's shade tints a pack texture: a water or sludge texture
 * has its own colour and takes the shade gently, while the lava tile is dark
 * rock that the shade turns molten.
 */
const LIQUID_TINT_STRENGTH: Record<Liquid, number> = { water: 0.25, lava: 1, poison: 0.6, acid: 0.6 };

/** Texture roles of the untextured water biomes, the first the active set has; with none, they ripple. */
const OPEN_WATER_ROLES: Readonly<Partial<Record<BiomeKind, readonly string[]>>> = {
    water: LIQUID_ROLES.water,
    ocean: ['ocean', 'floor.calm-sea', 'floor.rough-sea'],
};

/** A fill's texture and its multiply tint. */
interface Texturing {
    readonly texture: string | null;
    readonly tint: number;
}

/**
 * The first of `roles` the active set has, tinted `packTint`; failing that,
 * procedural `pattern` tinted `colour`, so a fill is never a flat colour.
 */
function texturing(resolve: TextureResolver, roles: readonly string[], packTint: number, pattern: Pattern, colour: number): Texturing {
    for (const role of roles) {
        const texture = resolve(role);
        if (texture !== null) {
            return { texture, tint: packTint };
        }
    }
    return { texture: resolve(proceduralRole(pattern)), tint: colour };
}

/** A river's bed runs this much wider than the river, plus a fixed bank either side, so even a stream shows its banks. */
const BED_SCALE = 1.5;
const BED_BANK_PX = 16;

/** Flat colour of a pack floor material, or a bed, the active texture set does not have. */
const ROLE_FALLBACK = 0x6e6457;

/** Flat colour of a wall material the active texture set does not have. */
const WALL_FALLBACK = 0x3a3a3a;

/** Width (scene px) of a room's drawn wall band on a scene with no grid to size it by. */
const GRIDLESS_WALL_BAND = 8;

/** A keyed 2D fill surface: create-or-update / remove / clear filled polygons. */
export interface DrawSurface {
    fill: (id: string, polygon: readonly number[], color: number, alpha: number, feather: boolean) => void;
    /**
     * Fill the polygon with a tiled texture (by image URL), multiply-tinted,
     * its tiling turned by `angle` (radians) about the scene's origin: a wall
     * band's courses run along its wall.
     */
    fillTextured: (id: string, polygon: readonly number[], textureUrl: string, tint: number, alpha: number, feather: boolean, angle: number) => void;
    remove: (id: string) => void;
    clear: () => void;
}

export interface FeatureRenderer {
    set: (id: string, feature: Feature) => void;
    preview: (feature: Feature) => void;
    remove: (id: string) => void;
    clearPreview: () => void;
    clear: () => void;
}

interface Filled {
    readonly outline: number[];
    readonly fill: number;
    readonly alpha: number;
    /** Tiled texture URL, or null for a flat colour fill (water/river, or a role the texture set lacks). */
    readonly texture: string | null;
    /** Multiply tint for the texture (ignored when `texture` is null). */
    readonly tint: number;
    /** Soften the boundary — regions blend into the map (coastline/terrain edge); paths stay crisp. */
    readonly feather: boolean;
    /** How far (radians) the texture's tiling is turned: a wall band's, to lie along its wall; unturned when absent. */
    readonly angle?: number;
}

/** Fill descriptor for a biome area (region, brush stroke, or room floor) — textured, tinted. */
/**
 * How a biome is drawn: water and ocean translucent, in a water texture or
 * rippling; land in its texture, or grain in its colour.
 */
function biomeLook(biome: BiomeKind, resolve: TextureResolver): Texturing & { readonly alpha: number } {
    const style = BIOME_STYLES[biome];
    const role = BIOME_TEXTURE[biome];
    if (role === null) {
        // Drawn as a river of water is, its texture tinted gently toward its colour and as opaque: a lake and the river out of it are one water.
        const tint = tintToward(style.fill, LIQUID_TINT_STRENGTH.water);
        return { ...texturing(resolve, OPEN_WATER_ROLES[biome] ?? [], tint, 'ripple', style.fill), alpha: LIQUID_ALPHA.water };
    }
    return { ...texturing(resolve, [role], BIOME_TINT[biome], 'grain', style.fill), alpha: TEXTURE_ALPHA };
}

function biomeFilled(biome: BiomeKind, outline: number[], feather: boolean, resolve: TextureResolver): Filled {
    return { outline, fill: BIOME_STYLES[biome].fill, feather, ...biomeLook(biome, resolve) };
}

/**
 * How a texture role is drawn: a biome as a biome, any other role (a pack
 * material) in its texture, untinted, or grain. Shared by room floors,
 * painted ground in a texture of its own, and splat-map blending.
 */
export function roleLook(role: string, resolve: TextureResolver): Texturing & { readonly alpha: number } {
    if (isBiomeKind(role)) {
        return biomeLook(role, resolve);
    }
    return { ...texturing(resolve, [role], NO_TINT, 'grain', ROLE_FALLBACK), alpha: TEXTURE_ALPHA };
}

/** Fill descriptor for a texture role (see {@link roleLook}). */
function roleFilled(role: string, outline: number[], feather: boolean, resolve: TextureResolver): Filled {
    return { outline, fill: isBiomeKind(role) ? BIOME_STYLES[role].fill : ROLE_FALLBACK, feather, ...roleLook(role, resolve) };
}

/** Painted ground: in its own texture where the set has it, else its biome's. */
function groundFilled(ground: { readonly biome: BiomeKind } & Textured, outline: number[], resolve: TextureResolver, feather: boolean): Filled {
    const own = ground.texture !== null && resolve(ground.texture) !== null ? ground.texture : null;
    return own === null
        ? biomeFilled(ground.biome, outline, feather, resolve)
        : { ...roleFilled(own, outline, feather, resolve), fill: BIOME_STYLES[ground.biome].fill };
}

/** A path's ribbon outline at `halfWidths`, ending square across at full width: a road's carriageway, a river's banks. */
function pathOutline(path: CartographyPath, halfWidths: readonly number[]): number[] {
    return ribbonOutline(buildRibbon(path.points, halfWidths, RIBBON_SAMPLES));
}

function pathFilled(path: CartographyPath, resolve: TextureResolver): Filled {
    const outline = pathOutline(path, path.halfWidths);
    if (path.river === null) {
        const road = texturing(resolve, [ROAD_TEXTURE], NO_TINT, 'grain', ROAD_STYLE.fill);
        return { outline, fill: ROAD_STYLE.fill, alpha: TEXTURE_ALPHA, ...road, feather: false };
    }
    const { liquid, shade } = path.river;
    const flow = texturing(resolve, LIQUID_ROLES[liquid], tintToward(shade, LIQUID_TINT_STRENGTH[liquid]), 'ripple', shade);
    return { outline, fill: shade, alpha: LIQUID_ALPHA[liquid], ...flow, feather: false };
}

/** Fills drawn beneath a feature's own: a river's bed, wider than the river and feathered into the map. */
function underlays(feature: Feature, resolve: TextureResolver): Filled[] {
    const bed = feature.type === 'path' ? feature.river?.bed ?? null : null;
    if (feature.type !== 'path' || bed === null) {
        return [];
    }
    const outline = pathOutline(
        feature,
        feature.halfWidths.map((w) => w * BED_SCALE + BED_BANK_PX),
    );
    return [roleFilled(bed, outline, true, resolve)];
}

/** Nothing to draw: the feature is realised entirely as native documents (a stamp is its Tile). */
const NOT_DRAWN: Filled = { outline: [], fill: 0, alpha: 0, texture: null, tint: NO_TINT, feather: false };

function outlineAndStyle(feature: Feature, resolve: TextureResolver): Filled {
    // A stamp is its Tile, a pin its Note, a zone its Region, and a label or a shape its Drawing.
    if (feature.type === 'stamp' || feature.type === 'shape' || isAnchored(feature)) {
        return NOT_DRAWN;
    }
    if (feature.type === 'region') {
        return groundFilled(feature, regionOutline(feature), resolve, !feature.sharp);
    }
    if (feature.type === 'stroke') {
        // What a round brush leaves along the pointer's path: rounded at both ends.
        return groundFilled(feature, brushOutline(feature.points, feature.radius, RIBBON_SAMPLES), resolve, true);
    }
    if (feature.type === 'room') {
        // The exact polygon with a crisp edge: a room's walls are straight and cover its boundary.
        return roleFilled(
            feature.floor,
            feature.points.flatMap((p) => [p.x, p.y]),
            false,
            resolve,
        );
    }
    return pathFilled(feature, resolve);
}

const PREVIEW_ID = '__preview__';

/** A door's leaf where no door art draws it: a share of the wall band thick, in timber. */
const DOOR_LEAF = { share: 0.45, colour: 0x5a3d28 } as const;

/** Doors that open out of sight: into the wall, or up or down out of the doorway. */
const RETRACTED: ReadonlySet<DoorAnimationType> = new Set<DoorAnimationType>(['slide', 'ascend', 'descend']);

/** A doorway wider than this many wall bands (a square and a half) has double doors, two leaves each half its width. */
const DOUBLE_LEAF_BANDS = 3;

/**
 * Which way into a room from its outline's edges: 1 where the interior lies
 * to the right of each edge as it runs (screen coordinates, y down), -1
 * where to the left, by the outline's winding.
 */
function insideTurn(points: readonly { x: number; y: number }[]): number {
    const twice = points.reduce((sum, p, i) => {
        const q = points[(i + 1) % points.length] ?? p;
        return sum + p.x * q.y - q.x * p.y;
    }, 0);
    return twice >= 0 ? 1 : -1;
}

/**
 * An open door's leaves swung into the room from their hinges: one leaf
 * from the doorway's start, as long as the doorway is wide; a doorway wider
 * than `doubleFrom` (double doors) two, each half, from either end.
 */
function swungOpen(seg: Segment, inward: number, doubleFrom: number): Segment[] {
    const dx = seg.b.x - seg.a.x;
    const dy = seg.b.y - seg.a.y;
    const span = Math.hypot(dx, dy);
    if (span === 0) {
        return [];
    }
    const [nx, ny] = [(-dy / span) * inward, (dx / span) * inward];
    const swing = (hinge: { x: number; y: number }, reach: number): Segment => ({ a: hinge, b: { x: hinge.x + nx * reach, y: hinge.y + ny * reach } });
    return span > doubleFrom ? [swing(seg.a, span / 2), swing(seg.b, span / 2)] : [swing(seg.a, span)];
}

/**
 * The drawn walls of a room: one band per perimeter segment in its wall
 * material. A doorway breaks the band (a secret door is wall to look at): a
 * closed door shows its leaf across the gap, an open one its leaves swung
 * into the room, an opening nothing. Shade is
 * Foundry's: its lights are cut by the native walls.
 */
function wallBands(feature: Feature, resolve: TextureResolver, bandWidth: number): Readonly<Record<'leaf' | 'wall', Filled[]>> {
    if (feature.type !== 'room' || feature.wall === null) {
        return { leaf: [], wall: [] };
    }
    // A room floored in its own masonry (a wall-walk, a tower's top), or in the stuff its walls are made of (concrete within
    // concrete), keeps its walls a shade darker, so its rim still reads against the floor.
    const alike = materialName(feature.floor) === materialName(feature.wall);
    const { texture, tint } = texturing(resolve, [feature.wall], alike ? PARAPET_TINT : NO_TINT, 'grain', WALL_FALLBACK);
    const doorways = new Map(feature.doors.filter((d) => d.type !== 'secret').map((d) => [d.segment, d]));
    const segments = perimeterSegments(feature.points);
    const walls = segments.filter((_, i) => !doorways.has(i));
    const inward = insideTurn(feature.points);
    const leaves = segments.flatMap((seg, i): Filled[] => {
        const door = doorways.get(i);
        if (door === undefined || door.type === 'opening') {
            return [];
        }
        const leaf = (s: Segment): Filled => ({
            outline: segmentBand(s, bandWidth * DOOR_LEAF.share),
            fill: DOOR_LEAF.colour,
            alpha: 1,
            texture: null,
            tint: NO_TINT,
            feather: false,
        });
        if (door.state !== 'open') {
            return [leaf(seg)];
        }
        // A panel slid into the wall or a shutter raised leaves a bare doorway; a hinged leaf stands swung into the room.
        return RETRACTED.has(door.animation ?? 'swing') ? [] : swungOpen(seg, inward, bandWidth * DOUBLE_LEAF_BANDS).map(leaf);
    });
    // Each band's texture is turned to its wall, so courses of brick and grain of planks run along it.
    const bands = walls.map(
        (seg): Filled => ({
            outline: segmentBand(seg, bandWidth),
            fill: WALL_FALLBACK,
            alpha: 1,
            texture,
            tint,
            feather: false,
            angle: Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x),
        }),
    );
    return { leaf: leaves, wall: bands };
}

export class GraphicsFeatureRenderer implements FeatureRenderer {
    /** Surface ids of the extra fills drawn for each feature (a river's bed, a room's wall bands), so they go with it. */
    private readonly extras = new Map<string, string[]>();

    /** `wallBand` is how thick (scene px) room walls are drawn: a share of the grid square, or a fixed width without a grid. */
    constructor(private readonly surface: DrawSurface, private readonly resolve: TextureResolver, private readonly wallBand: number = GRIDLESS_WALL_BAND) {}

    /** Draw a feature: what lies beneath it first (each draw goes on top), then the feature, then its wall bands. */
    set(id: string, feature: Feature): void {
        this.removeExtras(id);
        const below = underlays(feature, this.resolve).map((fill, i) => this.drawExtra(`${id}:bed:${i}`, fill));
        this.draw(id, outlineAndStyle(feature, this.resolve));
        // The leaves of closed doors, then the walls over them.
        const walls = wallBands(feature, this.resolve, this.wallBand);
        const above = (['leaf', 'wall'] as const).flatMap((part) => walls[part].map((fill, i) => this.drawExtra(`${id}:${part}:${i}`, fill)));
        const drawn = [...below, ...above];
        if (drawn.length > 0) {
            this.extras.set(id, drawn);
        }
    }

    private drawExtra(extraId: string, fill: Filled): string {
        this.draw(extraId, fill);
        return extraId;
    }

    private draw(id: string, { outline, fill, alpha, texture, tint, feather, angle = 0 }: Filled): void {
        if (outline.length < 6) {
            this.surface.remove(id);
        } else if (texture !== null) {
            this.surface.fillTextured(id, outline, texture, tint, alpha, feather, angle);
        } else {
            this.surface.fill(id, outline, fill, alpha, feather);
        }
    }

    private removeExtras(id: string): void {
        for (const extraId of this.extras.get(id) ?? []) {
            this.surface.remove(extraId);
        }
        this.extras.delete(id);
    }

    /** A brush stroke paints as it is dragged, in its own look; any other shape shows as a highlight while drawn or edited. */
    preview(feature: Feature): void {
        const look = outlineAndStyle(feature, this.resolve);
        this.draw(
            PREVIEW_ID,
            feature.type === 'stroke' ? look : { ...look, fill: PREVIEW_STYLE.fill, alpha: PREVIEW_STYLE.alpha, texture: null, feather: false },
        );
    }

    remove(id: string): void {
        this.surface.remove(id);
        this.removeExtras(id);
    }

    clearPreview(): void {
        this.surface.remove(PREVIEW_ID);
    }

    clear(): void {
        this.surface.clear();
        this.extras.clear();
    }
}
