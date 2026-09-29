// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Levels: a scene's vertical floors, each an elevation band in scene distance
 * units. Every feature sits on one level (or on none: shown on every level,
 * the single-floor default). Generated documents take their level's band, and
 * transition stamps (stairs, ladders, lifts, hatches) connect adjacent levels.
 * The levels are the scene's native Level documents. Pure and unit-tested.
 */
import { cssHex, parseCssHex } from './colour';

/** A level's own images, which Foundry draws for that floor alone. */
export const LEVEL_IMAGES = ['background', 'foreground', 'fog'] as const;

export type LevelImage = (typeof LEVEL_IMAGES)[number];

/**
 * The images Foundry tints, and whose transparent pixels let light and weather
 * through below a threshold. The fog image has neither (its tint went in
 * 14.364).
 */
export const THRESHOLD_IMAGES = ['background', 'foreground'] as const satisfies readonly LevelImage[];

export type ThresholdImage = (typeof THRESHOLD_IMAGES)[number];

/** How a level's images fit the scene: v14 `CONST.TEXTURE_DATA_FIT_MODES`. */
export const TEXTURE_FITS = ['fill', 'contain', 'cover', 'width', 'height'] as const;

export type TextureFit = (typeof TEXTURE_FITS)[number];

/** Where a level's images sit on the scene: the native Level's `textures`. */
interface LevelPlacement {
    readonly anchorX: number;
    readonly anchorY: number;
    /** Whole pixels. */
    readonly offsetX: number;
    readonly offsetY: number;
    readonly fit: TextureFit;
    readonly scaleX: number;
    readonly scaleY: number;
    /** Degrees. */
    readonly rotation: number;
}

export type PlacementNumber = Exclude<keyof LevelPlacement, 'fit'>;

export const PLACEMENT_NUMBERS = ['anchorX', 'anchorY', 'offsetX', 'offsetY', 'scaleX', 'scaleY', 'rotation'] as const satisfies readonly PlacementNumber[];

/**
 * How Foundry draws a level, for that floor alone: the native Level's
 * background, foreground and fog images (null: none), the first two's tints, the
 * colour shown where there is no background, the alpha below which image
 * pixels let light and weather through, where the images sit, and which other
 * levels are seen from this one. Colours are `#rrggbb`.
 */
export interface LevelArt {
    readonly background: string | null;
    readonly foreground: string | null;
    readonly fog: string | null;
    readonly backgroundColor: string;
    readonly tints: Readonly<Record<ThresholdImage, string>>;
    readonly alphaThresholds: Readonly<Record<ThresholdImage, number>>;
    readonly placement: LevelPlacement;
    /** Ids of the other levels fully or partly visible from this one. */
    readonly visibleLevels: readonly string[];
}

/** A Level as Foundry makes one (14.359 `LevelDocument` defaults). */
export const NO_LEVEL_ART: LevelArt = {
    background: null,
    foreground: null,
    fog: null,
    backgroundColor: '#999999',
    tints: { background: '#ffffff', foreground: '#ffffff' },
    alphaThresholds: { background: 0.75, foreground: 0.75 },
    placement: { anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0, fit: 'fill', scaleX: 1, scaleY: 1, rotation: 0 },
    visibleLevels: [],
};

/** One change the GM makes to a level's art, as typed or picked. */
export type LevelArtEdit =
    | { readonly kind: 'image'; readonly image: LevelImage; readonly path: string }
    | { readonly kind: 'backgroundColor'; readonly typed: string }
    | { readonly kind: 'tint'; readonly image: ThresholdImage; readonly typed: string }
    | { readonly kind: 'threshold'; readonly image: ThresholdImage; readonly typed: string }
    | { readonly kind: 'placement'; readonly field: PlacementNumber; readonly typed: string }
    | { readonly kind: 'fit'; readonly fit: TextureFit }
    | { readonly kind: 'visible'; readonly level: string; readonly visible: boolean };

/** A typed `#rrggbb` colour, lower-cased, or null. */
function colourOf(typed: string): string | null {
    const colour = parseCssHex(typed.trim());
    return colour === null ? null : cssHex(colour);
}

/** A typed number, or null when blank or not finite. */
function numberOf(typed: string): number | null {
    const value = typed.trim() === '' ? Number.NaN : Number(typed);
    return Number.isFinite(value) ? value : null;
}

/** Is `value` right for the placement `field`: whole pixels for an offset, a scale that is not 0. */
function validPlacement(field: PlacementNumber, value: number): boolean {
    if (field === 'offsetX' || field === 'offsetY') {
        return Number.isInteger(value);
    }
    return (field !== 'scaleX' && field !== 'scaleY') || value !== 0;
}

/** Apply `edit` to `art`, or null when what was typed is not valid (the field reverts). */
export function editLevelArt(art: LevelArt, edit: LevelArtEdit): LevelArt | null {
    switch (edit.kind) {
        case 'image': {
            const path = edit.path.trim();
            return { ...art, [edit.image]: path === '' ? null : path };
        }
        case 'backgroundColor': {
            const colour = colourOf(edit.typed);
            return colour === null ? null : { ...art, backgroundColor: colour };
        }
        case 'tint': {
            const colour = colourOf(edit.typed);
            return colour === null ? null : { ...art, tints: { ...art.tints, [edit.image]: colour } };
        }
        case 'threshold': {
            const value = numberOf(edit.typed);
            return value === null || value < 0 || value > 1 ? null : { ...art, alphaThresholds: { ...art.alphaThresholds, [edit.image]: value } };
        }
        case 'placement': {
            const value = numberOf(edit.typed);
            return value === null || !validPlacement(edit.field, value) ? null : { ...art, placement: { ...art.placement, [edit.field]: value } };
        }
        case 'fit':
            return { ...art, placement: { ...art.placement, fit: edit.fit } };
        case 'visible':
            break;
    }
    const others = art.visibleLevels.filter((id) => id !== edit.level);
    return { ...art, visibleLevels: edit.visible ? [...others, edit.level] : others };
}

export interface Level {
    readonly id: string;
    readonly name: string;
    /** Elevation band, bottom inclusive, top exclusive (scene distance units). */
    readonly bottom: number;
    readonly top: number;
    readonly art: LevelArt;
}

/**
 * The levels as features see them: their images and look change what
 * Foundry draws, never what the plugin plans; which levels each sees does
 * (a stamp's tile shows on the levels that see its own).
 */
export function planningLevels(levels: readonly Level[]): string {
    return JSON.stringify(levels.map(({ art, ...planned }) => ({ ...planned, sees: art.visibleLevels })));
}

/** Height given to a new level when the scene's grid is unknown, in scene distance units; editable afterwards. */
const DEFAULT_LEVEL_HEIGHT = 10;

/** Levels ordered bottom to top. */
export function sortLevels(levels: readonly Level[]): Level[] {
    return [...levels].sort((a, b) => a.bottom - b.bottom);
}

/**
 * The levels below `active` that it sees (its visible levels), lowest first:
 * what shows round an upper storey (the yard, the road) is drawn beneath its
 * own floor. A level seen above would lie over it, so only those below count.
 */
export function seenBelow(levels: readonly Level[], active: string | null): Level[] {
    const viewed = findLevel(levels, active);
    return viewed === null ? [] : sortLevels(levels.filter((level) => viewed.art.visibleLevels.includes(level.id) && level.bottom < viewed.bottom));
}

export function findLevel(levels: readonly Level[], id: string | null): Level | null {
    return id === null ? null : levels.find((level) => level.id === id) ?? null;
}

/** The level `steps` above (+) or below (−) `id` in bottom-to-top order, or null past either end. */
export function adjacentLevel(levels: readonly Level[], id: string, steps: number): Level | null {
    const ordered = sortLevels(levels);
    const index = ordered.findIndex((level) => level.id === id);
    return index < 0 ? null : ordered[index + steps] ?? null;
}

/** Elevation at which a document on `level` sits: its band's bottom, or 0 on no level. */
export function levelElevation(levels: readonly Level[], id: string | null): number {
    return findLevel(levels, id)?.bottom ?? 0;
}

/** Grid squares tall a new level is: Foundry v14's default Level height (14.368). */
const LEVEL_HEIGHT_SQUARES = 4;

/** How tall a new level is on a scene with `gridDistance` distance units per square. */
export function levelHeightFor(gridDistance: number): number {
    return gridDistance > 0 ? LEVEL_HEIGHT_SQUARES * gridDistance : DEFAULT_LEVEL_HEIGHT;
}

/** Band for a new level stacked directly above (or below) the existing ones. */
export function nextLevelBand(levels: readonly Level[], position: 'above' | 'below', height = DEFAULT_LEVEL_HEIGHT): { bottom: number; top: number } {
    const ordered = sortLevels(levels);
    if (position === 'above') {
        const base = ordered[ordered.length - 1]?.top ?? 0;
        return { bottom: base, top: base + height };
    }
    const ceiling = ordered[0]?.bottom ?? 0;
    return { bottom: ceiling - height, top: ceiling };
}

/** Is a feature on `featureLevel` shown while editing `active`? Level-less features show on every level. */
export function onLevel(featureLevel: string | null, active: string | null): boolean {
    return featureLevel === null || active === null || featureLevel === active;
}

export interface LevelRow {
    readonly level: Level;
    readonly active: boolean;
    /** Features on this level. */
    readonly count: number;
    /** A level can be removed only when nothing sits on it. */
    readonly removable: boolean;
}

export interface LevelPanel {
    /** Top to bottom, as a building's floors read. */
    readonly rows: readonly LevelRow[];
    /** Editing every level at once (no level active). */
    readonly allActive: boolean;
}

/** The level panel's view: rows top to bottom with the active one marked. */
export function levelPanel(levels: readonly Level[], active: string | null, counts: Readonly<Record<string, number>>): LevelPanel {
    const rows = sortLevels(levels)
        .reverse()
        .map((level) => {
            const count = counts[level.id] ?? 0;
            return { level, active: level.id === active, count, removable: count === 0 };
        });
    return { rows, allActive: active === null };
}
