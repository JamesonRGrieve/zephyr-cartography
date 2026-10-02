// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The stamp catalog: every stamp from every loaded asset pack, merged into one
 * browsable list. Pure and unit-tested. The Foundry boundary discovers pack
 * modules and fetches their manifests, then hands the raw JSON to
 * {@link loadPacks}. Filtering, variant cycling, per-variant property
 * resolution and placement geometry are all deterministic functions of the
 * catalog.
 */
import {
    type PackIssue,
    parseStampPack,
    type Stamp,
    type StampDoor,
    type StampLight,
    type StampOcclusion,
    type StampParticleEmitter,
    type StampPhysical,
    type StampPile,
    type StampSound,
    type StampSurface,
    type StampHazard,
    type StampWay,
    type StampTerrain,
    type StampTile,
    type StampVariant,
    type TextureSet,
} from './schema';

/** A pack manifest as fetched from an asset module, not yet validated. */
export interface PackSource {
    readonly moduleId: string;
    // eslint-disable-next-line no-restricted-syntax -- boundary: the fetched manifest JSON is untyped until parseStampPack validates it
    readonly manifest: unknown;
}

/** A stamp in the merged catalog. Image paths are already resolved to module-served URLs. */
export interface CatalogStamp extends Stamp {
    /** Unique across all packs: `<moduleId>:<stamp id>`. */
    readonly key: string;
    readonly moduleId: string;
    /** Grid size (px per square) this stamp's variant pixel sizes were authored at. */
    readonly referenceGridSize: number;
}

/** A texture set from a pack. Texture paths are already resolved to module-served URLs. */
interface CatalogTextureSet extends TextureSet {
    /** Unique across all packs: `<moduleId>:<set id>`. */
    readonly key: string;
    readonly moduleId: string;
}

/** A pack that failed validation, reported rather than silently dropped. */
interface PackError {
    readonly moduleId: string;
    readonly issues: readonly PackIssue[];
}

export interface LoadedPacks {
    readonly stamps: readonly CatalogStamp[];
    readonly textureSets: readonly CatalogTextureSet[];
    readonly errors: readonly PackError[];
}

/** A URL with a scheme (`data:`, `https:`, `blob:`): already absolute, never module-relative. */
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:/i;

/** The URL Foundry serves a module-relative file from; an absolute URL passes through untouched. */
export function moduleAssetUrl(moduleId: string, path: string): string {
    return HAS_SCHEME.test(path) ? path : `modules/${moduleId}/${path.replace(/^\.?\//, '')}`;
}

/** Resolves a pack-relative asset path to its served URL. */
type AssetUrl = (path: string) => string;

/** Particle emitters with their texture paths served. */
function servedEmitters(emitters: readonly StampParticleEmitter[], url: AssetUrl): StampParticleEmitter[] {
    return emitters.map((emitter) => ({ ...emitter, textures: emitter.textures.map(url) }));
}

function servedSound(sound: StampSound, url: AssetUrl): StampSound {
    return { ...sound, path: url(sound.path) };
}

/** A door with its animation's leaf image served. */
function servedDoor(door: StampDoor, url: AssetUrl): StampDoor {
    const texture = door.animation?.texture;
    return door.animation === undefined || texture === undefined ? door : { ...door, animation: { ...door.animation, texture: url(texture) } };
}

/** A container flag with its pile's sound paths served; a plain `true` or `false` is unchanged. */
function servedContainer(container: boolean | StampPile, url: AssetUrl): boolean | StampPile {
    if (typeof container === 'boolean' || container.sounds === undefined) {
        return container;
    }
    const sounds = Object.fromEntries(Object.entries(container.sounds).flatMap(([pileEvent, path]) => (path === undefined ? [] : [[pileEvent, url(path)]])));
    return { ...container, sounds };
}

/**
 * A variant's asset paths beyond its image, served. Absent fields stay absent
 * and null (the variant removing one) stays null.
 */
function servedVariant(variant: StampVariant, url: AssetUrl): StampVariant {
    return {
        ...variant,
        image: url(variant.image),
        ...(variant.preview === undefined ? {} : { preview: url(variant.preview) }),
        ...(variant.particles === undefined || variant.particles === null ? {} : { particles: servedEmitters(variant.particles, url) }),
        ...(variant.sound === undefined || variant.sound === null ? {} : { sound: servedSound(variant.sound, url) }),
        ...(variant.container === undefined ? {} : { container: servedContainer(variant.container, url) }),
    };
}

/** Validate every source and merge the valid packs into one catalog. Invalid packs are reported in `errors`. */
export function loadPacks(sources: readonly PackSource[]): LoadedPacks {
    const stamps: CatalogStamp[] = [];
    const textureSets: CatalogTextureSet[] = [];
    const errors: PackError[] = [];
    const parsed = sources.flatMap(({ moduleId, manifest }) => {
        const result = parseStampPack(manifest);
        if (!result.ok) {
            errors.push({ moduleId, issues: result.issues });
            return [];
        }
        return [{ moduleId, pack: result.pack, url: ((path) => moduleAssetUrl(moduleId, path)) satisfies AssetUrl }];
    });
    for (const { moduleId, pack, url } of parsed) {
        const { referenceGridSize } = pack;
        // Ambience reaches every pack's stamps (a pack of sounds alone gives a machine its hum): the stamp's own pack's
        // first, then the others' as loaded, each served from the pack that declares it.
        const ambiences = [...parsed.filter((p) => p.moduleId === moduleId), ...parsed.filter((p) => p.moduleId !== moduleId)];
        for (const stamp of pack.stamps) {
            // Its own sound and particles, else those of the first of its tags an ambience gives any.
            const byTag = <T>(library: (p: (typeof parsed)[number]) => Readonly<Record<string, T>>): { value: T; url: AssetUrl } | undefined =>
                ambiences
                    .flatMap((p) =>
                        stamp.tags.flatMap((tag) => {
                            const value = Object.hasOwn(library(p), tag) ? library(p)[tag] : undefined;
                            return value === undefined ? [] : [{ value, url: p.url }];
                        }),
                    )
                    .at(0);
            const ambientParticles = stamp.particles === undefined ? byTag((p) => p.pack.ambience.particles) : undefined;
            const ambientSound = stamp.sound === undefined ? byTag((p) => p.pack.ambience.sounds) : undefined;
            const particles =
                stamp.particles === undefined
                    ? ambientParticles && servedEmitters(ambientParticles.value, ambientParticles.url)
                    : servedEmitters(stamp.particles, url);
            const sound = stamp.sound === undefined ? ambientSound && servedSound(ambientSound.value, ambientSound.url) : servedSound(stamp.sound, url);
            stamps.push({
                ...stamp,
                ...(particles === undefined ? {} : { particles }),
                ...(sound === undefined ? {} : { sound }),
                ...(stamp.door === undefined ? {} : { door: servedDoor(stamp.door, url) }),
                ...(stamp.container === undefined ? {} : { container: servedContainer(stamp.container, url) }),
                key: `${moduleId}:${stamp.id}`,
                moduleId,
                referenceGridSize,
                variants: stamp.variants.map((variant) => servedVariant(variant, url)),
            });
        }
        for (const set of pack.textureSets) {
            textureSets.push({
                ...set,
                key: `${moduleId}:${set.id}`,
                moduleId,
                textures: Object.fromEntries(Object.entries(set.textures).map(([role, path]) => [role, url(path)])),
                ...(set.previews === undefined ? {} : { previews: Object.fromEntries(Object.entries(set.previews).map(([role, path]) => [role, url(path)])) }),
                ...(set.credits === undefined ? {} : { credits: moduleAssetUrl(moduleId, set.credits) }),
            });
        }
    }
    return { stamps, textureSets, errors };
}

export interface CategoryCount {
    readonly name: string;
    readonly count: number;
}

/** Categories with their stamp counts, sorted by name. */
export function buildCategoryTree(catalog: readonly Stamp[]): CategoryCount[] {
    const counts = new Map<string, number>();
    for (const stamp of catalog) {
        counts.set(stamp.category, (counts.get(stamp.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([category, count]) => ({ name: category, count }));
}

/** Minimum number of stamps a tag must appear on to surface as a sub-tag. */
const DEFAULT_TAG_MIN_FREQUENCY = 2;

export interface TagCount {
    readonly tag: string;
    readonly count: number;
}

/** Tags used by at least `minFrequency` stamps in one category, most frequent first (ties alphabetical). */
export function tagsForCategory(catalog: readonly Stamp[], category: string, minFrequency = DEFAULT_TAG_MIN_FREQUENCY): TagCount[] {
    const counts = new Map<string, number>();
    for (const stamp of catalog) {
        if (stamp.category !== category) {
            continue;
        }
        for (const tag of stamp.tags) {
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
    }
    return [...counts.entries()]
        .filter(([, count]) => count >= minFrequency)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([tag, count]) => ({ tag, count }));
}

export interface StampFilters {
    readonly category?: string;
    readonly perspective?: Stamp['perspective'];
    readonly scale?: Stamp['scale'];
    /** Every tag must be present (AND). */
    readonly tags?: readonly string[];
    /** Case-insensitive substring over name, tags and category. */
    readonly query?: string;
}

function matchesFilters(stamp: Stamp, filters: StampFilters, query: string): boolean {
    if (filters.category !== undefined && stamp.category !== filters.category) {
        return false;
    }
    if (filters.perspective !== undefined && stamp.perspective !== filters.perspective) {
        return false;
    }
    if (filters.scale !== undefined && stamp.scale !== filters.scale) {
        return false;
    }
    if (!(filters.tags ?? []).every((tag) => stamp.tags.includes(tag))) {
        return false;
    }
    return query === '' || `${stamp.name} ${stamp.tags.join(' ')} ${stamp.category}`.toLowerCase().includes(query);
}

/** The stamps matching every active filter. */
export function filterStamps<T extends Stamp>(catalog: readonly T[], filters: StampFilters): T[] {
    const query = (filters.query ?? '').trim().toLowerCase();
    return catalog.filter((stamp) => matchesFilters(stamp, filters, query));
}

/** Clamp an index into the stamp's variant range, falling back to its `defaultVariant`, then 0. */
export function clampVariantIndex(stamp: Stamp, index: number): number {
    const count = stamp.variants.length;
    if (Number.isInteger(index) && index >= 0 && index < count) {
        return index;
    }
    return stamp.defaultVariant < count ? stamp.defaultVariant : 0;
}

/** The variant at a (clamped) index. Every valid stamp has at least one variant. */
export function resolveVariant(stamp: Stamp, index: number): StampVariant {
    const variant = stamp.variants[clampVariantIndex(stamp, index)];
    if (variant === undefined) {
        throw new Error(`stamp "${stamp.id}" has no variants`);
    }
    return variant;
}

/** The next variant index in `direction` (+1 forward, −1 back), wrapping at both ends. */
export function cycleVariantIndex(stamp: Stamp, index: number, direction: 1 | -1 = 1): number {
    const count = stamp.variants.length;
    return (((clampVariantIndex(stamp, index) + direction) % count) + count) % count;
}

/** A stamp's structural properties as they apply to one variant. */
export interface EffectiveStampProperties {
    readonly perspective: Stamp['perspective'];
    readonly doorState: StampVariant['doorState'];
    /** `null` when the variant (or stamp) emits no light. */
    readonly light: StampLight | null;
    readonly occlusion: StampOcclusion | undefined;
    readonly physical: StampPhysical | undefined;
    /** `null` when the variant (or stamp) emits no particles. */
    readonly particles: StampParticleEmitter[] | null;
    readonly sound: StampSound | null;
    readonly tile: StampTile | null;
    /** The Item Piles pile backing the stamp, or null when it is not one. */
    readonly pile: StampPile | null;
    readonly surface: StampSurface | null;
    readonly terrain: StampTerrain | null;
    /** `null` when the variant (or stamp) harms nothing near it. */
    readonly hazard: StampHazard | null;
    /** Its ways in drawn on this variant (ramps, hatches, doors); none where it has none or the variant says so. */
    readonly ways: readonly StampWay[];
}

/** An override that replaces the stamp's value outright; `null` on the variant removes it. */
function overridden<T>(variant: T | null | undefined, stamp: T | undefined): T | null {
    return variant === undefined ? stamp ?? null : variant;
}

/** A container flag as a pile: `true` is a plain container with Item Piles' defaults, `false` or unsaid none. */
function pileOf(container: boolean | StampPile | undefined): StampPile | null {
    if (container === false || container === undefined) {
        return null;
    }
    return container === true ? { type: 'container' } : container;
}

/**
 * Resolve a variant's effective properties. Overrides replace the stamp's
 * value outright, and `null` removes it (`light: null` is unlit, `particles:
 * null` is still). `physical` overrides merge field by field over the stamp's
 * physical body.
 */
export function effectiveProperties(stamp: Stamp, index: number): EffectiveStampProperties {
    const variant = resolveVariant(stamp, index);
    const physical = stamp.physical === undefined && variant.physical === undefined ? undefined : { ...stamp.physical, ...variant.physical };
    return {
        perspective: variant.perspective ?? stamp.perspective,
        doorState: variant.doorState,
        light: overridden(variant.light, stamp.light),
        occlusion: variant.occlusion ?? stamp.occlusion,
        physical,
        particles: overridden(variant.particles, stamp.particles),
        sound: overridden(variant.sound, stamp.sound),
        tile: variant.tile ?? stamp.tile ?? null,
        pile: pileOf(variant.container ?? stamp.container),
        surface: overridden(variant.surface, stamp.surface),
        terrain: overridden(variant.terrain, stamp.terrain),
        hazard: overridden(variant.hazard, stamp.hazard),
        // A variant's null is its word: none in this state (its ramps raised).
        ways: variant.ways === null ? [] : variant.ways ?? stamp.ways ?? [],
    };
}

export interface Rect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface PlacementInput {
    readonly variant: Pick<StampVariant, 'width' | 'height'>;
    /** World point the stamp is centred on. */
    readonly x: number;
    readonly y: number;
    /** Scene grid size (px per square). */
    readonly gridSize: number;
    /** Grid size the variant's pixel size was authored at. */
    readonly referenceGridSize: number;
    readonly scale?: number;
    /** Snap the top-left corner to the scene grid. */
    readonly snap?: boolean;
}

function snapToGrid(value: number, gridSize: number): number {
    return gridSize > 0 ? Math.round(value / gridSize) * gridSize : value;
}

/**
 * The tile rectangle for a stamp centred on a world point. The variant's pixel
 * size is authored at `referenceGridSize`, so the footprint scales by
 * `gridSize / referenceGridSize`, then by `scale`.
 */
export function computeTilePlacement({ variant, x, y, gridSize, referenceGridSize, scale = 1, snap = false }: PlacementInput): Rect {
    const factor = (gridSize / referenceGridSize) * scale;
    const width = variant.width * factor;
    const height = variant.height * factor;
    const originX = x - width / 2;
    const originY = y - height / 2;
    return snap ? { x: snapToGrid(originX, gridSize), y: snapToGrid(originY, gridSize), width, height } : { x: originX, y: originY, width, height };
}
