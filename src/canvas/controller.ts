// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Orchestrates a drawing session against a renderer, a persistence store, and a
 * wall emitter — all injected interfaces, so the whole flow (begin → point →
 * preview → commit → save → walls, plus load/remove) is unit-tested with fakes
 * and never touches Foundry directly. Handles both brushes: path (road/river)
 * and region (biome).
 */
import { isSurface } from '../compose/role-tags';
import { nearestVertex } from '../geometry/hit';
import { snapToGrid, type Grid } from '../geometry/snap';
import type { Point } from '../geometry/spline';
import { centroid, nearestSegment } from '../geometry/wall';
import { type CatalogStamp, cycleVariantIndex, effectiveProperties } from '../stamps/catalog';
import { storedDisplay, storedEffects } from '../tools/area-effects';
import { type AreaFeature, type AreaSettings, areaSettingsOf, isArea } from '../tools/areas';
import type { BiomeKind } from '../tools/biome';
import { pileSpec, type PileSpec, type PileState, pileStateLabel } from '../tools/containers';
import type { DoorState, RegionDoc, SubmapTravel, TileDoc } from '../tools/documents';
import { isDoorStamp, snapDoorToRooms, stampDoorState } from '../tools/doors';
import { DrawSession, type DrawMode } from '../tools/draw-session';
import { deletePoint, movePoint, setHalfWidth } from '../tools/edit';
import { withDocs, type Feature } from '../tools/feature';
import { hasDocs, NO_DOCS, type GeneratedDocs } from '../tools/generated-docs';
import { featureHit } from '../tools/hit';
import { type LabelSettings, labelSettingsOf, makeLabel, NEW_LABEL, validFontSize } from '../tools/label';
import {
    findLevel,
    type Level,
    type LevelArt,
    levelElevation,
    levelHeightFor,
    nextLevelBand,
    NO_LEVEL_ART,
    onLevel,
    planningLevels,
    seenBelow,
    sortLevels,
} from '../tools/levels';
import type { FloorMaterial, WallMaterial } from '../tools/materials';
import { drawOrder } from '../tools/nesting';
import { DEFAULT_HALF_WIDTH, LIQUID_LOOKS, makePath, type PathKind, type RiverLook } from '../tools/path';
import { makePin, NEW_PIN, type PinSettings, pinSettingsOf, withPinSettings } from '../tools/pin';
import { NO_PLAN, type PlanContext, planDocuments } from '../tools/plan';
import type { RgbaImage } from '../tools/png';
import { makeRegion } from '../tools/region';
import {
    type DoorSettings,
    doorOn,
    makeRoom,
    NEW_DOOR,
    type RoomDoor,
    type RoomFeature,
    type RoomMaterials,
    roomMaterialsOf,
    withRoomDoor,
    withRoomLit,
    withRoomMaterials,
} from '../tools/room';
import { hasSceneSettings, type SceneSettings } from '../tools/scene-settings';
import { storedSpawn } from '../tools/spawn';
import {
    type BakeTarget,
    bakedImagePath,
    blankMask,
    channelFor,
    type MaskRect,
    maskLength,
    maskPoint,
    newSplatLayer,
    paintDab,
    type SplatBake,
    type SplatLayer,
    type SplatRoles,
    type SplatState,
    splatState,
    MAX_SPLAT_LAYERS,
    stackChannelFor,
} from '../tools/splat';
import { stackedElevation } from '../tools/stacking';
import { makeStamp, stampCentre, withStampFrame, withStampVariant, type StampFeature, type StampPlacement } from '../tools/stamp';
import { DEFAULT_BRUSH_RADIUS, makeStroke } from '../tools/stroke';
import { DEFAULT_TRAVEL, exitRegion, exitSquare, type SceneFrame, type SubmapLink } from '../tools/submap';
import { sameTarget, type SwitchTarget, toggleTarget } from '../tools/switch-targets';
import { lampVariant, switchOf } from '../tools/switches';
import { NORMAL_COST, storedCost, validCost } from '../tools/terrain-cost';
import type { WallPreset } from '../tools/wall-presets';
import { makeZone, NEW_ZONE, withZonePlace, withZoneSettings, type ZoneFeature, zonePoint, type ZoneSettings, zoneSettingsOf } from '../tools/zone';
import { presetZone, type ZonePreset } from '../tools/zone-presets';
import type { FeatureRenderer } from './renderer';
import { type DocumentKind, StagedChanges, type StagedWrite } from './staged-changes';

export interface SceneStore {
    load: () => Feature[];
    save: (features: readonly Feature[]) => Promise<void>;
}

/** Resolves a catalog key to its stamp across every loaded pack. */
export interface StampCatalog {
    get: (key: string) => CatalogStamp | null;
}

/** Traces an image's opaque silhouette into closed loops of footprint fractions (0..1), or null if it cannot. */
export interface SilhouetteSource {
    trace: (src: string) => Promise<Point[][] | null>;
}

/** The scene's levels: its native Level documents. */
export interface LevelStore {
    load: () => Level[];
    create: (level: Omit<Level, 'id'>) => Promise<string | null>;
    update: (id: string, patch: Partial<Omit<Level, 'id'>>) => Promise<void>;
    remove: (id: string) => Promise<void>;
}

/** The world's scenes, for submaps: the one being edited, others to link, new interiors, their exit regions. */
export interface WorldScenes {
    /** The scene being edited. */
    current: () => { readonly id: string; readonly name: string } | null;
    name: (sceneId: string) => string | null;
    frame: (sceneId: string) => SceneFrame | null;
    /** Create an empty interior scene named `name`, gridded like the current one; returns its id. */
    createScene: (name: string) => Promise<string | null>;
    /** Create one region in another scene, with the id it names. */
    createRegion: (sceneId: string, region: RegionDoc) => Promise<boolean>;
    deleteRegion: (sceneId: string, regionId: string) => Promise<void>;
    /** Give a region in another scene the teleport `region` plans, leaving its shape as it is. */
    updateTeleport: (sceneId: string, region: RegionDoc) => Promise<void>;
    /** Change the current scene's settings: only those given. */
    updateSettings: (settings: SceneSettings) => Promise<void>;
}

/** Item Piles containers backing container stamps; unavailable (and inert) when Item Piles is not active. */
export interface ContainerService {
    available: () => boolean;
    /** Create a container pile named `name`; returns its token UUID. */
    create: (spec: PileSpec, name: string) => Promise<string | null>;
    move: (pile: string, spec: PileSpec) => Promise<void>;
    remove: (pile: string) => Promise<void>;
}

/** The scene's splat maps: their layers (in the scene flag) and each one's mask pixels (a PNG in the world's data). */
export interface SplatStore {
    load: () => SplatLayer[];
    save: (layers: readonly SplatLayer[]) => Promise<void>;
    /** A layer's saved mask, or null when it has none yet or it cannot be read. */
    readMask: (layer: SplatLayer) => Promise<Uint8ClampedArray<ArrayBuffer> | null>;
    /** Any mask image (an 8-bit RGBA or RGB PNG) as pixels, or null when it cannot be read. */
    readImage: (path: string) => Promise<RgbaImage | null>;
    /** Save a baked blend's image (PNG bytes) to `path`. */
    writeImage: (path: string, png: Uint8Array<ArrayBuffer>) => Promise<void>;
    /** A native Tile over `layer`'s scene area on its level, showing the image at `src`, beneath other tiles; its id. */
    createTile: (layer: SplatLayer, src: string) => Promise<string | null>;
    /** Delete a baked Tile; one a GM has deleted already is simply gone. */
    removeTile: (id: string) => Promise<void>;
    writeMask: (layer: SplatLayer, mask: Uint8ClampedArray<ArrayBuffer>) => Promise<void>;
    /** Where layer `index` of `level`'s stack saves its mask. */
    pathFor: (level: string | null, index: number) => string;
}

/**
 * Draws splat maps, one per key (a level's layer), each level's stack in
 * order from its first layer up, and a stack on every level beneath a
 * level's own.
 */
export interface SplatRenderer {
    set: (key: string, layer: SplatLayer, mask: Uint8ClampedArray) => void;
    /** Redraw the part of `key`'s mask a brush just changed. */
    update: (key: string, rect: MaskRect) => void;
    remove: (key: string) => void;
    /** The blend `keys` draw together, in order, rendered to a PNG over their scene area; null when none is drawn. */
    snapshot: (keys: readonly string[]) => Promise<Uint8Array<ArrayBuffer> | null>;
}

/** A level's splat map: its layer and its mask's pixels. */
interface Splat {
    readonly layer: SplatLayer;
    readonly mask: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * A step undo can take back: the feature list as it was, a level's splat map
 * before a blend stroke or an adopted mask, or several of those taken back
 * together (a built spec that also brought splat maps).
 */
type HistoryEntry =
    | { readonly kind: 'features'; readonly features: readonly Feature[] }
    /** A splat layer as it was: its layer and mask, or null when it was not there. */
    | { readonly kind: 'blend'; readonly key: string; readonly splat: Splat | null }
    | { readonly kind: 'steps'; readonly steps: readonly HistoryEntry[] };

/** A copy of a splat layer and its mask, unbaked, for undo to bring back live; null when there is none. */
function liveCopy(splat: Splat | undefined): Splat | null {
    return splat ? { layer: { ...splat.layer, baked: null }, mask: splat.mask.slice() } : null;
}

/** A splat layer's key: its level ("" for every level), then its place in the stack past the first. */
function splatKey(level: string | null, index: number): string {
    const base = level ?? '';
    return index === 0 ? base : `${base}${STACK_SEPARATOR}${index}`;
}

/** The level a splat layer's key names, or null for every level. */
function keyLevel(key: string): string | null {
    const [level = ''] = key.split(STACK_SEPARATOR);
    return level === '' ? null : level;
}

/** Between a layer key's level and its place in the stack: no document id holds it. */
const STACK_SEPARATOR = '#';

/** A blend brush dab, in scene terms. */
export interface BlendDab {
    readonly at: Point;
    /** The texture role painted. */
    readonly role: string;
    /** Scene px. */
    readonly radius: number;
    /** 0–1 per dab. */
    readonly strength: number;
    readonly erase: boolean;
}

/** Everything the controller is injected with: rendering, persistence, document creation, levels, scenes, containers, packs, ids. */
export interface ControllerPorts {
    readonly renderer: FeatureRenderer;
    readonly splats: SplatStore;
    readonly splatRenderer: SplatRenderer;
    readonly store: SceneStore;
    readonly sink: DocumentSink;
    readonly levels: LevelStore;
    readonly scenes: WorldScenes;
    readonly containers: ContainerService;
    readonly catalog: StampCatalog;
    readonly silhouettes: SilhouetteSource;
    readonly makeId: () => string;
}

/** A tile's frame as Foundry reports it: unrotated top-left, size, rotation about the centre. */
export interface TileFrame {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly rotation: number;
}

export interface TileUpdate {
    readonly id: string;
    readonly tile: TileDoc;
}

/**
 * Writes the native Foundry documents features generate. The controller
 * stages each transaction's changes (see {@link StagedChanges}) and hands
 * them over whole, to be written atomically.
 */
export interface DocumentSink {
    /** A fresh id for a document of `kind` about to be created. */
    newId: (kind: DocumentKind) => string;
    /** Delete, create and update everything in `write`, in one transaction: all of it lands, or none. */
    write: (write: StagedWrite) => Promise<void>;
}

export type Brush =
    | { readonly type: 'path'; readonly kind: PathKind }
    | { readonly type: 'region'; readonly biome: BiomeKind }
    | { readonly type: 'stroke'; readonly biome: BiomeKind }
    | { readonly type: 'room'; readonly floor: FloorMaterial; readonly wall?: WallMaterial; readonly wallKind?: WallPreset; readonly ceiling?: boolean };

/** Cap on retained undo snapshots — bounds memory on a long editing session. */
const MAX_HISTORY = 50;

/** A door stamp placed within this many grid squares of a room wall snaps onto it. */
const DOOR_SNAP_SQUARES = 0.5;

/** The labels of the regions areas carry their settings on: a room's own, painted ground's and a zone's. */
const AREA_REGION_KINDS: ReadonlySet<string> = new Set(['room', 'terrain', 'zone']);

/** `area` with `settings`, each stored only when not ordinary; null when the cost is not one Foundry takes. */
function withAreaSettings<A extends AreaFeature>(area: A, settings: AreaSettings): A | null {
    if (validCost(settings.movementCost) === null) {
        return null;
    }
    return {
        ...area,
        movementCost: storedCost(settings.movementCost),
        effects: storedEffects(settings.effects),
        display: storedDisplay(settings.display),
        spawn: storedSpawn(settings.spawn),
    };
}

function swap(arr: Feature[], a: number, b: number): void {
    const first = arr[a];
    const second = arr[b];
    if (first !== undefined && second !== undefined) {
        arr[a] = second;
        arr[b] = first;
    }
}

/** Pair existing document ids with their new specs, index by index. */
function pairDocs<T>(ids: readonly string[], docs: readonly T[]): { readonly id: string; readonly doc: T }[] {
    return ids.flatMap((id, i) => {
        const doc = docs[i];
        return doc === undefined ? [] : [{ id, doc }];
    });
}

/** Do two feature lists carry the same ids in the same order? */
function sameOrder(a: readonly Feature[], b: readonly Feature[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    return a.every((f, i) => f.id === b[i]?.id);
}

export class CartographyController {
    private features: Feature[] = [];
    private session: DrawSession | null = null;
    private brush: Brush | null = null;
    private readonly history: HistoryEntry[] = [];
    private future: HistoryEntry[] = [];
    /** Each level's splat map, by key. */
    private readonly splats = new Map<string, Splat>();
    /** The splat map as the blend stroke under way found it, for undo; null between strokes. */
    /** The layers the blend stroke under way has touched, each as it was before (null: not there yet). */
    private blendStart: Map<string, Splat | null> | null = null;
    /** Inside {@link batch}: edits share the batch's one undo snapshot. */
    private batching = false;
    /** Splat maps as they were before the batch under way changed them, to undo with it. */
    private batchSteps: HistoryEntry[] = [];
    /** Document changes waiting for the current transaction to end. */
    private readonly staged: StagedChanges;
    /** Depth of nested transactions; only the outermost one writes. */
    private writing = 0;
    /** The features changed inside the transaction under way, to be saved as it ends. */
    private unsaved = false;

    /** Half-width (scene px) applied to newly drawn paths. */
    halfWidth = DEFAULT_HALF_WIDTH;
    /** The look of newly drawn rivers: liquid, shade and bed. */
    riverLook: RiverLook = LIQUID_LOOKS.water;
    /** Radius (scene px) applied to newly painted terrain strokes. */
    brushRadius = DEFAULT_BRUSH_RADIUS;
    /** Movement cost of newly painted areas and strokes (1: ordinary ground). */
    movementCost = NORMAL_COST;
    /** The texture newly painted strokes are drawn in, or null for their biome's own. */
    paintTexture: string | null = null;
    /** Scene grid for snapping room vertices; null disables snapping. */
    grid: Grid | null = null;
    /** The kind of Foundry walls newly drawn paths put along their centerline, or null for none. */
    pathWalls: WallPreset | null = null;
    /**
     * Scene distance units per grid square; the entry sets it from the scene's
     * grid. 0 (no grid) leaves new levels at the default height and stamp
     * heights unknown.
     */
    gridDistance = 0;

    private readonly renderer: FeatureRenderer;
    private readonly splatStore: SplatStore;
    private readonly splatRenderer: SplatRenderer;
    private readonly store: SceneStore;
    private readonly sink: DocumentSink;
    private readonly levelStore: LevelStore;
    private readonly scenes: WorldScenes;
    private readonly containers: ContainerService;
    private readonly catalog: StampCatalog;
    private readonly silhouettes: SilhouetteSource;
    private readonly makeId: () => string;

    private levelList: Level[] = [];
    private terrainRegions = false;
    /** The level being edited: new features land on it, and only its features (and level-less ones) show. */
    private active: string | null = null;

    constructor(ports: ControllerPorts) {
        this.renderer = ports.renderer;
        this.splatStore = ports.splats;
        this.splatRenderer = ports.splatRenderer;
        this.store = ports.store;
        this.sink = ports.sink;
        this.levelStore = ports.levels;
        this.scenes = ports.scenes;
        this.containers = ports.containers;
        this.catalog = ports.catalog;
        this.silhouettes = ports.silhouettes;
        this.makeId = ports.makeId;
        this.staged = new StagedChanges((kind) => ports.sink.newId(kind));
    }

    /** An enterable stamp, or null for anything else. */
    private enterable(id: string): StampFeature | null {
        const feature = this.getFeature(id);
        return feature?.type === 'stamp' && feature.behaviour.enterable ? feature : null;
    }

    /** The levels of an enterable stamp's floors in this scene, bottom to top; empty for none. */
    buildingFloors(id: string): readonly string[] {
        return this.enterable(id)?.floors ?? [];
    }

    /**
     * Give a building its floors in this scene: one Level per name, stacked
     * above the scene's top level, and stairs over its footprint joining its
     * own level to all of them. A building on every level stands on the
     * lowest from then on, since its floors climb from there. More can be
     * added later, above. False for a stamp that is not enterable, or a scene
     * with no levels.
     */
    async addBuildingFloors(id: string, names: readonly string[]): Promise<boolean> {
        const stamp = this.enterable(id);
        const ground = stamp && (findLevel(this.levelList, stamp.level) ?? this.levelList[0] ?? null);
        if (!stamp || !ground || names.length === 0) {
            return false;
        }
        const created = await names.reduce(async (built, levelName) => {
            const ids = await built;
            const levelId = await this.levelStore.create({
                name: levelName,
                ...nextLevelBand(this.levelList, 'above', levelHeightFor(this.gridDistance)),
                art: NO_LEVEL_ART,
            });
            this.levelList = sortLevels(this.levelStore.load());
            return levelId === null ? ids : [...ids, levelId];
        }, Promise.resolve<string[]>([]));
        await this.reloadLevels();
        await this.replaceFeature(id, { ...stamp, level: ground.id, floors: [...stamp.floors, ...created] });
        return created.length > 0;
    }

    /** Take away a building's stairs to its floors; the floors themselves stay, for the GM to remove from the levels panel. */
    async removeBuildingFloors(id: string): Promise<boolean> {
        const stamp = this.enterable(id);
        if (!stamp || stamp.floors.length === 0) {
            return false;
        }
        await this.replaceFeature(id, { ...stamp, floors: [] });
        return true;
    }

    /** The interior an enterable stamp leads into, or null. */
    submapOf(id: string): SubmapLink | null {
        return this.enterable(id)?.submap ?? null;
    }

    /**
     * Link an enterable stamp to `sceneId` as its interior: an exit region
     * goes into the interior (one square at its centre, for the GM to move)
     * and an entrance region over the stamp, each teleporting to the other.
     * A previous link is undone first. False if the stamp is not enterable, or
     * either scene is missing.
     */
    async linkSubmap(id: string, sceneId: string, travel: SubmapTravel = DEFAULT_TRAVEL): Promise<boolean> {
        const stamp = this.enterable(id);
        const here = this.scenes.current();
        const frame = this.scenes.frame(sceneId);
        const sceneName = this.scenes.name(sceneId);
        if (!stamp || !here || !frame || sceneName === null || sceneId === here.id) {
            return false;
        }
        if (stamp.submap) {
            await this.scenes.deleteRegion(stamp.submap.scene, stamp.submap.exitRegion);
        }
        const link: SubmapLink = { scene: sceneId, sceneName, entryRegion: this.makeId(), exitRegion: this.makeId(), travel };
        if (!(await this.scenes.createRegion(sceneId, exitRegion(link, exitSquare(frame), here.id, here.name)))) {
            return false;
        }
        await this.replaceFeature(id, { ...stamp, submap: link });
        return true;
    }

    /** Create a new, empty interior scene named `name` and link the stamp to it; returns the scene id. */
    async createInterior(id: string, sceneName: string): Promise<string | null> {
        if (!this.enterable(id)) {
            return null;
        }
        const sceneId = await this.scenes.createScene(sceneName);
        return sceneId !== null && (await this.linkSubmap(id, sceneId)) ? sceneId : null;
    }

    /**
     * Change how tokens travel through a stamp's interior link, both ways. The
     * entrance re-syncs with the stamp; the exit, which the GM may have moved,
     * is updated where it is. False for a stamp with no link.
     */
    async setSubmapTravel(id: string, travel: SubmapTravel): Promise<boolean> {
        const stamp = this.enterable(id);
        const here = this.scenes.current();
        if (!stamp?.submap || !here) {
            return false;
        }
        const link = { ...stamp.submap, travel };
        await this.replaceFeature(id, { ...stamp, submap: link });
        await this.scenes.updateTeleport(link.scene, exitRegion(link, [], here.id, here.name));
        return true;
    }

    /** Remove a stamp's interior link and both of its regions (the interior scene itself is kept). */
    async unlinkSubmap(id: string): Promise<boolean> {
        const stamp = this.enterable(id);
        if (!stamp?.submap) {
            return false;
        }
        await this.scenes.deleteRegion(stamp.submap.scene, stamp.submap.exitRegion);
        await this.replaceFeature(id, { ...stamp, submap: null });
        return true;
    }

    /** What plans read besides the feature: the scene's features (by default the live ones), levels and options. */
    private planContext(features: readonly Feature[] = this.features): PlanContext {
        return { features, levels: this.levelList, terrainRegions: this.terrainRegions, gridDistance: this.gridDistance };
    }

    /** Whether terrain is mirrored as Scene Regions. */
    get terrainAsRegions(): boolean {
        return this.terrainRegions;
    }

    /**
     * Mirror terrain (biome regions and brush strokes) as Scene Regions, or
     * stop, and bring the scene in line. Also run after loading a scene, which
     * may have been last edited under the other setting.
     */
    async setTerrainRegions(on: boolean): Promise<void> {
        this.terrainRegions = on;
        // Only terrain whose regions disagree with its plan is re-synced (difficult ground keeps its region either way).
        const stale = this.features.filter(
            (f) => (f.type === 'region' || f.type === 'stroke') && f.docs.regions.length !== planDocuments(f, this.planContext()).regions.length,
        );
        await this.transaction(async () =>
            stale.reduce(async (previous, f) => {
                await previous;
                await this.syncDocs(this.getFeature(f.id) ?? f);
            }, Promise.resolve()),
        );
    }

    /** The scene's levels, bottom to top. */
    get levels(): readonly Level[] {
        return this.levelList;
    }

    get activeLevel(): string | null {
        return this.active;
    }

    /** Edit on `id` (null: every level). Redraws to show only that level's features. */
    setActiveLevel(id: string | null): void {
        const next = id !== null && findLevel(this.levelList, id) ? id : null;
        // A built spec names a level for every feature; redrawing the whole map for each was most of its cost.
        if (next === this.active) {
            return;
        }
        this.active = next;
        this.redraw();
    }

    /** Re-read the levels (after an outside edit, e.g. a GM changing a native Level) and re-sync what depends on them. */
    async reloadLevels(): Promise<void> {
        const before = this.levelList;
        this.levelList = sortLevels(this.levelStore.load());
        if (findLevel(this.levelList, this.active) === null) {
            this.active = null;
        }
        await this.transaction(async () => {
            await this.dropOrphans();
            if (planningLevels(before) !== planningLevels(this.levelList)) {
                await this.resyncLevelled();
            }
        });
        this.redraw();
    }

    /** Add a level stacked above (or below) the existing ones and make it active; returns its id. */
    async addLevel(position: 'above' | 'below', levelName: string): Promise<string | null> {
        const id = await this.levelStore.create({
            name: levelName,
            ...nextLevelBand(this.levelList, position, levelHeightFor(this.gridDistance)),
            art: NO_LEVEL_ART,
        });
        await this.reloadLevels();
        if (id !== null) {
            this.setActiveLevel(id);
        }
        return id;
    }

    /**
     * Change the scene's own settings (darkness, fog, weather and so on): only
     * those given. They are the scene's, not features, so undo leaves them be.
     */
    async setSceneSettings(settings: SceneSettings): Promise<void> {
        if (hasSceneSettings(settings)) {
            await this.scenes.updateSettings(settings);
        }
    }

    /** Set a level's own background, foreground and fog images; false for an unknown level. */
    async setLevelArt(id: string, art: LevelArt): Promise<boolean> {
        if (!findLevel(this.levelList, id)) {
            return false;
        }
        await this.levelStore.update(id, { art });
        await this.reloadLevels();
        return true;
    }

    async renameLevel(id: string, levelName: string): Promise<void> {
        if (findLevel(this.levelList, id) && levelName.trim() !== '') {
            await this.levelStore.update(id, { name: levelName.trim() });
            await this.reloadLevels();
        }
    }

    /** Move a level's elevation band; everything on it (and transitions touching it) re-syncs. */
    async setLevelBand(id: string, bottom: number, ceiling: number): Promise<boolean> {
        if (!findLevel(this.levelList, id) || !(ceiling > bottom)) {
            return false;
        }
        await this.levelStore.update(id, { bottom, top: ceiling });
        await this.reloadLevels();
        return true;
    }

    /** How many features sit on each level. */
    levelCounts(): Record<string, number> {
        const counts: Record<string, number> = {};
        for (const f of this.features) {
            if (f.level !== null) {
                counts[f.level] = (counts[f.level] ?? 0) + 1;
            }
        }
        return counts;
    }

    /** Remove an empty level; refuses (false) while features sit on it, so nothing is orphaned. */
    async removeLevel(id: string): Promise<boolean> {
        if (!findLevel(this.levelList, id) || (this.levelCounts()[id] ?? 0) > 0) {
            return false;
        }
        await this.levelStore.remove(id);
        await this.reloadLevels();
        return true;
    }

    /**
     * Drop the features of a level that no longer exists. Foundry deletes a
     * Level's own placeables with it, so their documents are already gone;
     * anything they own elsewhere (an interior exit, a pile) is discarded, and
     * they leave the undo history too, so nothing is revived onto a missing
     * level.
     */
    private async dropOrphans(): Promise<void> {
        const orphaned = (f: Feature): boolean => f.level !== null && findLevel(this.levelList, f.level) === null;
        const orphans = this.features.filter(orphaned);
        if (orphans.length === 0) {
            return;
        }
        const before = this.features;
        this.features = this.features.filter((f) => !orphaned(f));
        for (const f of orphans) {
            this.renderer.remove(f.id);
        }
        // A blend on a level that is gone has nothing left to undo onto.
        const prune = (entries: readonly HistoryEntry[]): HistoryEntry[] =>
            entries.flatMap((entry): HistoryEntry[] => {
                if (entry.kind === 'features') {
                    return [{ kind: 'features', features: entry.features.filter((f) => !orphaned(f)) }];
                }
                if (entry.kind === 'steps') {
                    const steps = prune(entry.steps);
                    return steps.length > 0 ? [{ kind: 'steps', steps }] : [];
                }
                const level = keyLevel(entry.key);
                return level !== null && findLevel(this.levelList, level) === null ? [] : [entry];
            });
        this.history.splice(0, this.history.length, ...prune(this.history));
        this.future = prune(this.future);
        await this.persist();
        await Promise.all(orphans.map(async (f) => this.discard(f)));
        await this.resyncDependents(before, orphans);
    }

    /** Re-sync every feature whose documents depend on the levels: anything on a level, and every transition stamp. */
    private async resyncLevelled(): Promise<void> {
        const levelled = this.features.filter((f) => f.level !== null);
        await levelled.reduce(async (previous, f) => {
            await previous;
            await this.syncDocs(this.getFeature(f.id) ?? f);
        }, Promise.resolve());
    }

    private visible(feature: Feature): boolean {
        return onLevel(feature.level, this.active);
    }

    /** Draw a feature if it is on the active level, otherwise make sure it is not drawn. */
    private show(feature: Feature): void {
        if (feature.type === 'room' || this.seen(feature)) {
            // A room can change what nests in what, and a seen level lies beneath the active one: the whole draw order is rebuilt.
            this.redraw();
        } else if (this.visible(feature)) {
            this.renderer.set(feature.id, feature);
        } else {
            this.renderer.remove(feature.id);
        }
    }

    /** Trace the stamp's silhouette when its occlusion asks for one; otherwise it carries none. */
    private async withSilhouette(stamp: StampFeature): Promise<StampFeature> {
        if (stamp.behaviour.occlusion?.shape !== 'alpha') {
            return { ...stamp, silhouette: null };
        }
        return { ...stamp, silhouette: await this.silhouettes.trace(stamp.src) };
    }

    /** Scene px per grid square for stamp footprints; a gridless scene uses the pack's own reference grid. */
    private stampGrid(stamp: CatalogStamp): number {
        return this.grid?.size ?? stamp.referenceGridSize;
    }

    /** Place a catalog stamp; returns the new feature id, or null if the stamp is not in any loaded pack. */
    async placeStamp(placement: StampPlacement): Promise<string | null> {
        const stamp = this.catalog.get(placement.stamp);
        if (!stamp) {
            return null;
        }
        const placed = makeStamp(this.makeId(), stamp, placement, this.stampGrid(stamp));
        // A door dropped near a room wall lands on it, so its axis cuts the wall cleanly.
        const feature = await this.withSilhouette(snapDoorToRooms(placed, this.features, placed.gridSize * DOOR_SNAP_SQUARES));
        const onItsLevel = { ...feature, level: feature.level ?? this.active };
        await this.add(await this.withPile(placement.elevation === undefined ? this.stacked(onItsLevel) : onItsLevel, stamp.name));
        return feature.id;
    }

    /** A stamp set down wholly on a table, bar or desk stands on it, at its top, so it is drawn on it; else as it is. */
    private stacked(stamp: StampFeature): StampFeature {
        const stamps = this.features.filter((f): f is StampFeature => f.type === 'stamp');
        const surface = (f: StampFeature): boolean => {
            const listed = this.catalog.get(f.stamp);
            return listed !== null && isSurface(listed.role, listed.tags);
        };
        const elevation = stackedElevation(stamp, stamps, surface, this.gridDistance);
        return elevation === null ? stamp : { ...stamp, elevation };
    }

    /** Put a map pin at `at` on the level being edited; returns its feature id. */
    async placePin(at: Point, settings: PinSettings = NEW_PIN): Promise<string> {
        const pin = makePin(this.makeId(), at, settings);
        await this.add(pin);
        return pin.id;
    }

    /** What a pin shows and opens, or null for anything else. */
    pinSettings(id: string): PinSettings | null {
        const f = this.getFeature(id);
        return f?.type === 'pin' ? pinSettingsOf(f) : null;
    }

    /** Change what a pin shows and opens, re-syncing its Note; false if it is not a pin. */
    async setPinSettings(id: string, settings: PinSettings): Promise<boolean> {
        const f = this.getFeature(id);
        if (f?.type !== 'pin') {
            return false;
        }
        await this.replaceFeature(id, withPinSettings(f, settings));
        return true;
    }

    /** Put a map label at `at` on the level being edited; returns its feature id. */
    async placeLabel(at: Point, settings: LabelSettings = NEW_LABEL): Promise<string> {
        const label = makeLabel(this.makeId(), at, settings);
        await this.add(label);
        return label.id;
    }

    /** How a label reads, or null for anything else. */
    labelSettings(id: string): LabelSettings | null {
        const f = this.getFeature(id);
        return f?.type === 'label' ? labelSettingsOf(f) : null;
    }

    /** Change how a label reads, re-syncing its Drawing; false if it is not a label or the font size is not one Foundry takes. */
    async setLabelSettings(id: string, settings: LabelSettings): Promise<boolean> {
        const f = this.getFeature(id);
        if (f?.type !== 'label' || validFontSize(settings.fontSize) === null) {
            return false;
        }
        await this.replaceFeature(id, { ...f, ...settings });
        return true;
    }

    /** Put a zone at `at` on the level being edited; returns its feature id, or null if its shape is not one Foundry takes. */
    async placeZone(at: Point, settings: ZoneSettings = NEW_ZONE): Promise<string | null> {
        const zone = withZoneSettings(makeZone(this.makeId(), at), settings);
        if (zone === null) {
            return null;
        }
        await this.add(zone);
        return zone.id;
    }

    /** A zone's shape, name and token, or null for anything else. */
    zoneSettings(id: string): ZoneSettings | null {
        const f = this.getFeature(id);
        return f?.type === 'zone' ? zoneSettingsOf(f) : null;
    }

    /** Reshape, rename or attach a zone, re-syncing its region; false if it is not a zone or the shape is not one Foundry takes. */
    async setZoneSettings(id: string, settings: ZoneSettings): Promise<boolean> {
        const f = this.getFeature(id);
        const next = f?.type === 'zone' ? withZoneSettings(f, settings) : null;
        if (next === null) {
            return false;
        }
        await this.replaceFeature(id, next);
        return true;
    }

    /**
     * Follow a zone's region that Foundry moved with its token: record where
     * the zone now is and how it is turned, without recreating the region
     * (Foundry already moved it). False when the region is no zone's, or the
     * zone is already there.
     */
    async followZone(regionId: string, at: Point, rotation: number): Promise<boolean> {
        const zone = this.features.find((f): f is ZoneFeature => f.type === 'zone' && f.docs.regions.includes(regionId));
        const was = zone && zonePoint(zone);
        if (!zone || !was || (was.x === at.x && was.y === at.y && zone.rotation === rotation)) {
            return false;
        }
        const next = withZonePlace(zone, at, rotation);
        this.features = this.features.map((f) => (f.id === zone.id ? next : f));
        await this.persist();
        this.redraw();
        return true;
    }

    /** Back a container stamp with an Item Piles container, when Item Piles is available. */
    private async withPile(stamp: StampFeature, pileName: string): Promise<StampFeature> {
        if (!stamp.behaviour.container || !this.containers.available()) {
            return stamp;
        }
        return { ...stamp, pile: await this.containers.create(pileSpec(stamp, levelElevation(this.levelList, stamp.level)), pileName) };
    }

    /**
     * Follow a door opened, closed or locked in play: switch the door stamp
     * that owns `wallId` to a variant showing `state`. Returns false when the
     * wall is not a door stamp's, it already shows that state, or no variant
     * does.
     */
    async applyDoorState(wallId: string, state: DoorState): Promise<boolean> {
        const feature = this.features.find((f) => f.docs.walls.includes(wallId));
        if (feature?.type === 'room') {
            return this.recordRoomDoorState(feature, wallId, state);
        }
        const stamp = feature && isDoorStamp(feature) ? this.catalog.get(feature.stamp) : null;
        if (!feature || !isDoorStamp(feature) || !stamp || stampDoorState(feature) === state) {
            return false;
        }
        const index = stamp.variants.findIndex((_, i) => (effectiveProperties(stamp, i).doorState ?? 'closed') === state);
        if (index < 0) {
            return false;
        }
        const lightSwitch = switchOf(feature);
        if (!lightSwitch) {
            return this.setStampVariant(feature.id, index);
        }
        // A light switch flipped in play: the switch and everything it lights change together, as one undo step.
        await this.batch(async () => {
            await this.setStampVariant(lightSwitch.id, index);
            await this.applySwitch(lightSwitch, state === 'open');
        });
        return true;
    }

    /** Turn everything `switchFeature` controls on or off. */
    private async applySwitch(switchFeature: StampFeature, on: boolean): Promise<void> {
        await switchFeature.switchTargets.reduce(async (previous, target) => {
            await previous;
            if (target.kind === 'light') {
                this.staged.setLightVisibility(target.id, !on);
                return;
            }
            const feature = this.getFeature(target.id);
            if (feature?.type === 'room') {
                if (feature.lit !== on) {
                    await this.replaceFeature(feature.id, withRoomLit(feature, on));
                }
                return;
            }
            const lamp = feature?.type === 'stamp' ? this.catalog.get(feature.stamp) : null;
            const variant = lamp ? lampVariant(lamp, on) : null;
            if (feature?.type === 'stamp' && variant !== null && variant !== feature.variant) {
                await this.setStampVariant(feature.id, variant);
            }
        }, Promise.resolve());
    }

    isLightSwitch(id: string): boolean {
        return switchOf(this.getFeature(id)) !== null;
    }

    /** Where a switch or its target is, for drawing the link between them: a stamp's centre, a room's centroid. */
    featureCentre(id: string): Point | null {
        const feature = this.getFeature(id);
        if (feature?.type === 'stamp') {
            return stampCentre(feature);
        }
        return feature?.type === 'room' ? centroid(feature.points) : null;
    }

    /** What light switch `id` controls; empty for any other feature. */
    switchTargets(id: string): readonly SwitchTarget[] {
        return switchOf(this.getFeature(id))?.switchTargets ?? [];
    }

    /**
     * Link `target` to light switch `id`, or unlink it if it is linked. A
     * feature target must be a lamp stamp (one with lit and unlit variants) or
     * a room; false for anything else, or when `id` is not a switch.
     */
    async toggleSwitchTarget(id: string, target: SwitchTarget): Promise<boolean> {
        const switchFeature = switchOf(this.getFeature(id));
        if (!switchFeature || (target.kind === 'feature' && !this.switchable(target.id))) {
            return false;
        }
        await this.replaceFeature(id, { ...switchFeature, switchTargets: toggleTarget(switchFeature.switchTargets, target) });
        return true;
    }

    /** Whether a switch can control feature `id`: a room, or a stamp with both lit and unlit variants. */
    private switchable(id: string): boolean {
        const feature = this.getFeature(id);
        if (feature?.type === 'room') {
            return true;
        }
        const lamp = feature?.type === 'stamp' ? this.catalog.get(feature.stamp) : null;
        return lamp !== null && lampVariant(lamp, true) !== null && lampVariant(lamp, false) !== null;
    }

    /**
     * Record a room door's state changed in play, without touching its walls
     * (the live wall already shows it). A later re-sync then keeps the door as
     * it was left rather than resetting it.
     */
    private async recordRoomDoorState(room: RoomFeature, wallId: string, state: DoorState): Promise<boolean> {
        const plan = planDocuments(room, this.planContext());
        const segment = plan.walls[room.docs.walls.indexOf(wallId)]?.segment;
        const door = segment === undefined ? null : doorOn(room, segment);
        if (segment === undefined || !door || door.state === state) {
            return false;
        }
        const { segment: _segment, ...settings } = door;
        const next = withRoomDoor(room, segment, { ...settings, state });
        this.features = this.features.map((f) => (f.id === room.id ? next : f));
        await this.persist();
        return true;
    }

    /** Switch a placed stamp to variant `index` (clamped); false if it is not a stamp or its pack is gone. */
    async setStampVariant(id: string, index: number): Promise<boolean> {
        const feature = this.getFeature(id);
        const stamp = feature?.type === 'stamp' ? this.catalog.get(feature.stamp) : null;
        if (feature?.type !== 'stamp' || !stamp) {
            return false;
        }
        const varied = await this.withSilhouette(withStampVariant(feature, stamp, index, this.stampGrid(stamp)));
        await this.replaceFeature(id, await this.followPile(varied, feature.pile));
        return true;
    }

    /** The Item Piles piles (token UUIDs) backing the scene's container stamps. */
    stampPiles(): string[] {
        return this.features.flatMap((f) => (f.type === 'stamp' && f.pile !== null ? [f.pile] : []));
    }

    /**
     * Follow a pile opened, closed, locked or emptied in play: switch the
     * container stamp backed by pile `pileUuid` to the variant its pack names
     * for `state`, as a door stamp follows its door. False when no stamp has
     * that pile, the pack names no variant for the state, or it shows already.
     */
    async applyPileState(pileUuid: string, state: PileState): Promise<boolean> {
        const feature = this.features.find((f): f is StampFeature => f.type === 'stamp' && f.pile === pileUuid);
        const stamp = feature ? this.catalog.get(feature.stamp) : null;
        const label = feature ? pileStateLabel(feature.behaviour.pile?.states, state) : undefined;
        const index = stamp && label !== undefined ? stamp.variants.findIndex((variant) => variant.state === label) : -1;
        if (!feature || index < 0 || index === feature.variant) {
            return false;
        }
        return this.setStampVariant(feature.id, index);
    }

    /** Step a placed stamp to its next (or previous) variant, wrapping. */
    async cycleStampVariant(id: string, direction: 1 | -1 = 1): Promise<boolean> {
        const feature = this.getFeature(id);
        const stamp = feature?.type === 'stamp' ? this.catalog.get(feature.stamp) : null;
        if (feature?.type !== 'stamp' || !stamp) {
            return false;
        }
        return this.setStampVariant(id, cycleVariantIndex(stamp, feature.variant, direction));
    }

    /** The feature that owns a native tile, or null for a tile the plugin did not generate. */
    featureForTile(tileId: string): string | null {
        return this.features.find((f) => f.docs.tiles.includes(tileId))?.id ?? null;
    }

    /**
     * Adopt a GM's native edit of a stamp's tile (move, resize, rotate) and
     * re-sync its other documents. Returns false when nothing changed, which
     * ends the update loop our own tile write triggers.
     */
    async syncStampFrame(id: string, frame: TileFrame): Promise<boolean> {
        const feature = this.getFeature(id);
        if (feature?.type !== 'stamp') {
            return false;
        }
        const centre = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
        const current = stampCentre(feature);
        const unchanged =
            current.x === centre.x &&
            current.y === centre.y &&
            feature.width === frame.width &&
            feature.height === frame.height &&
            feature.rotation === frame.rotation;
        if (unchanged) {
            return false;
        }
        await this.replaceFeature(id, withStampFrame(feature, { centre, width: frame.width, height: frame.height, rotation: frame.rotation }));
        return true;
    }

    get drawing(): boolean {
        return this.session !== null;
    }

    /**
     * Take the scene's saved features where they are not the ones this
     * controller holds: another client's edit, or a controller torn down
     * mid-build (the canvas redrawn while a map was composed) saving after
     * this one loaded, which would leave its features undrawn. Features are
     * told apart by id, so this controller's own saves never redraw; nothing
     * is taken mid-transaction.
     */
    reloadIfChanged(): void {
        if (this.writing > 0 || this.batching) {
            return;
        }
        const saved = this.store.load();
        const same = saved.length === this.features.length && saved.every((feature, i) => feature.id === this.features[i]?.id);
        if (!same) {
            this.load();
        }
    }

    load(): void {
        this.features = this.store.load();
        this.levelList = sortLevels(this.levelStore.load());
        if (findLevel(this.levelList, this.active) === null) {
            this.active = null;
        }
        this.redraw();
    }

    begin(brush: Brush, mode: DrawMode): void {
        this.brush = brush;
        this.session = new DrawSession(mode);
    }

    addPoint(p: Point): void {
        if (!this.session) {
            return;
        }
        // Rooms snap to the scene grid so their walls meet cleanly; other tools stay freeform.
        const point = this.grid && this.brush?.type === 'room' && this.session.mode === 'click' ? snapToGrid(p, this.grid) : p;
        this.session.addPoint(point);
        const preview = this.buildFeature('__preview__');
        if (preview) {
            this.renderer.preview(preview);
        }
    }

    cancel(): void {
        this.session = null;
        this.brush = null;
        this.renderer.clearPreview();
    }

    async commit(): Promise<void> {
        const feature = this.buildFeature(this.makeId());
        this.session = null;
        this.brush = null;
        this.renderer.clearPreview();
        if (!feature) {
            return;
        }
        await this.add(feature);
    }

    /** Add a committed feature: onto the active level unless it names its own, render, persist, then generate its documents. */
    async add(input: Feature): Promise<void> {
        const feature = input.level === null && this.active !== null ? { ...input, level: this.active } : input;
        await this.transaction(async () => {
            this.snapshot();
            const before = [...this.features];
            this.features.push(feature);
            this.show(feature);
            await this.persist();
            await this.syncDocs(feature);
            await this.resyncDependents(before, [feature]);
        });
    }

    async remove(id: string): Promise<void> {
        const target = this.features.find((f) => f.id === id);
        if (!target) {
            return;
        }
        await this.transaction(async () => {
            this.snapshot();
            const before = this.features;
            // What goes is no longer anything's to switch.
            const unlinked: SwitchTarget = { kind: 'feature', id };
            this.features = this.features
                .filter((f) => f.id !== id)
                .map((f) => {
                    const lightSwitch = switchOf(f);
                    return lightSwitch ? { ...lightSwitch, switchTargets: lightSwitch.switchTargets.filter((t) => !sameTarget(t, unlinked)) } : f;
                });
            this.renderer.remove(id);
            await this.persist();
            await this.discard(target);
            await this.resyncDependents(before, [target]);
        });
    }

    /** Delete everything a feature owns outside the feature list: its documents, its interior exit, its container pile. */
    private async discard(feature: Feature): Promise<void> {
        if (hasDocs(feature.docs)) {
            await this.transaction(() => this.staged.stage({ remove: feature.docs, create: NO_PLAN, updateTiles: [], updateWalls: [] }));
        }
        if (feature.type !== 'stamp') {
            return;
        }
        // A linked stamp's exit lives in its interior scene; it goes with the stamp.
        if (feature.submap) {
            await this.scenes.deleteRegion(feature.submap.scene, feature.submap.exitRegion);
        }
        if (feature.pile !== null) {
            await this.containers.remove(feature.pile);
        }
    }

    /**
     * Rebuild what `discard` deleted for a feature undo or redo brings back:
     * a fresh container pile, and the interior exit under its fixed id. Its
     * documents were deleted, so it forgets their ids (the sync that follows
     * would otherwise update them in place) and that sync recreates them.
     */
    private async revive(revived: Feature): Promise<Feature> {
        const feature = withDocs(revived, NO_DOCS);
        if (feature.type !== 'stamp') {
            return feature;
        }
        const withPile = feature.pile === null ? feature : await this.withPile({ ...feature, pile: null }, this.catalog.get(feature.stamp)?.name ?? '');
        await this.restoreExit(withPile);
        return withPile;
    }

    /** Recreate a linked stamp's exit in its interior (its id is fixed by the link, so the entrance still points at it). */
    private async restoreExit(stamp: StampFeature): Promise<void> {
        const here = this.scenes.current();
        const frame = stamp.submap ? this.scenes.frame(stamp.submap.scene) : null;
        if (stamp.submap && here && frame) {
            await this.scenes.createRegion(stamp.submap.scene, exitRegion(stamp.submap, exitSquare(frame), here.id, here.name));
        }
    }

    /**
     * Make `target` (an undo or redo snapshot) the live feature list, and bring
     * the scene's documents with it:
     * - features it drops are discarded;
     * - features it brings back are revived and synced;
     * - features it changes are synced from their live documents (the snapshot's
     *   document ids were replaced since);
     * - an interior link it undoes or redoes moves the exit region to match.
     */
    private async restore(target: readonly Feature[]): Promise<void> {
        const live = new Map(this.features.map((f) => [f.id, f]));
        const kept = new Set(target.map((f) => f.id));
        const before = this.features;
        const dropped = before.filter((f) => !kept.has(f.id));
        await Promise.all(dropped.map(async (f) => this.discard(f)));

        const unchanged = (f: Feature, current: Feature): boolean => JSON.stringify({ ...f, docs: null }) === JSON.stringify({ ...current, docs: null });
        const touched = target.filter((f) => {
            const current = live.get(f.id);
            return !current || !unchanged(f, current);
        });
        // In order: reviving can create piles and exit regions, which must not race.
        this.features = await target.reduce(async (built, f) => {
            const list = await built;
            const current = live.get(f.id);
            if (!current) {
                return [...list, await this.revive(f)];
            }
            return [...list, unchanged(f, current) ? current : await this.relink(f, current)];
        }, Promise.resolve<Feature[]>([]));
        await this.persist();
        this.redraw();
        await touched.reduce(async (previous, f) => {
            await previous;
            await this.syncDocs(this.getFeature(f.id) ?? f);
        }, Promise.resolve());
        await this.resyncDependents(before, [...dropped, ...touched]);
    }

    /** A changed feature restored from a snapshot, on the live documents, with its interior exit moved to match. */
    private async relink(restored: Feature, current: Feature): Promise<Feature> {
        const next = withDocs(restored, current.docs);
        if (next.type !== 'stamp' || current.type !== 'stamp') {
            return next;
        }
        if (JSON.stringify(next.submap) !== JSON.stringify(current.submap)) {
            if (current.submap) {
                await this.scenes.deleteRegion(current.submap.scene, current.submap.exitRegion);
            }
            await this.restoreExit(next);
        }
        // The live pile is the real one; the snapshot's may since have been removed.
        return this.followPile(next, current.pile);
    }

    /**
     * Keep a stamp's pile in line with its variant's container flag: create
     * the pile a variant now needs, and remove one it no longer has (a
     * smashed crate is not a container).
     */
    private async followPile(stamp: StampFeature, livePile: string | null): Promise<StampFeature> {
        if (stamp.behaviour.container && livePile === null) {
            return this.withPile({ ...stamp, pile: null }, stamp.name);
        }
        if (!stamp.behaviour.container && livePile !== null) {
            await this.containers.remove(livePile);
            return { ...stamp, pile: null };
        }
        return { ...stamp, pile: livePile };
    }

    /** The features shown on the active level, topmost (last drawn) first: what pointer picks consider. */
    private topDown(): Feature[] {
        return drawOrder(this.features.filter((f) => this.visible(f))).reverse();
    }

    /** Topmost shown feature under `pt`, or null. */
    hitTest(pt: Point): string | null {
        return this.topDown().find((f) => featureHit(f, pt))?.id ?? null;
    }

    /** Remove the topmost feature under `pt`; returns whether one was erased. */
    async erase(pt: Point): Promise<boolean> {
        const id = this.hitTest(pt);
        if (id === null) {
            return false;
        }
        await this.remove(id);
        return true;
    }

    /** The feature with `id`, or null (read-only; used for edit previews). */
    getFeature(id: string): Feature | null {
        return this.features.find((f) => f.id === id) ?? null;
    }

    /** The topmost feature vertex within `tol` of `pt`: its feature id + vertex index, or null. */
    pickVertex(pt: Point, tol: number): { id: string; index: number } | null {
        for (const f of this.topDown()) {
            const { index, distance } = nearestVertex(pt, f.points);
            if (index >= 0 && distance <= tol) {
                return { id: f.id, index };
            }
        }
        return null;
    }

    /** The topmost room wall segment within `tol` of `pt`: its room id + segment index, or null. */
    pickWallSegment(pt: Point, tol: number): { id: string; index: number } | null {
        for (const f of this.topDown()) {
            if (f.type !== 'room') {
                continue;
            }
            const { index, distance } = nearestSegment(pt, f.points);
            if (index >= 0 && distance <= tol) {
                return { id: f.id, index };
            }
        }
        return null;
    }

    /** Toggle whether a room's perimeter segment is a door (a new door is ordinary and closed); re-syncs the native walls. */
    async toggleDoor(id: string, index: number): Promise<boolean> {
        const f = this.getFeature(id);
        if (f?.type !== 'room') {
            return false;
        }
        return this.setRoomDoor(id, index, doorOn(f, index) ? null : NEW_DOOR);
    }

    /** The door on a room's perimeter segment, or null. */
    roomDoor(id: string, index: number): RoomDoor | null {
        const f = this.getFeature(id);
        return f?.type === 'room' ? doorOn(f, index) : null;
    }

    /** A room's floor and wall materials, or null for anything else. */
    roomMaterials(id: string): RoomMaterials | null {
        const f = this.getFeature(id);
        return f?.type === 'room' ? roomMaterialsOf(f) : null;
    }

    /** Give a room other floor and wall materials; false if it is not a room. */
    async setRoomMaterials(id: string, materials: RoomMaterials): Promise<boolean> {
        const f = this.getFeature(id);
        if (f?.type !== 'room') {
            return false;
        }
        await this.replaceFeature(id, withRoomMaterials(f, materials));
        return true;
    }

    /** What crossing an area (painted ground or a room) costs, and its effects; null for anything else. */
    areaSettings(id: string): AreaSettings | null {
        const f = this.getFeature(id);
        return f && isArea(f) ? areaSettingsOf(f) : null;
    }

    /** Give an area another movement cost and effects, re-syncing its Scene Region; false if it is not an area or the cost is not one Foundry takes. */
    async setAreaSettings(id: string, settings: AreaSettings): Promise<boolean> {
        const f = this.getFeature(id);
        const next = f && isArea(f) ? withAreaSettings(f, settings) : null;
        if (next === null) {
            return false;
        }
        await this.replaceFeature(id, next);
        return true;
    }

    /** Give a zone a hazard preset's shape and area settings, as one re-sync; false if it is not a zone or the preset will not fit it. */
    async applyZonePreset(id: string, preset: ZonePreset): Promise<boolean> {
        const f = this.getFeature(id);
        const shaped = f?.type === 'zone' ? withZoneSettings(f, presetZone(zoneSettingsOf(f), preset)) : null;
        const next = shaped && withAreaSettings(shaped, preset.area);
        if (!next) {
            return false;
        }
        await this.replaceFeature(id, next);
        return true;
    }

    /** The id of the Scene Region an area's settings live on, or null if it is not an area or has none yet. */
    areaRegionId(id: string): string | null {
        const f = this.getFeature(id);
        if (!f || !isArea(f)) {
            return null;
        }
        // An area's own region sits among the others its feature plans (a room's floor and ceiling) in plan order.
        const index = planDocuments(f, this.planContext()).regions.findIndex((region) => AREA_REGION_KINDS.has(region.label.kind));
        return f.docs.regions[index] ?? null;
    }

    /** Put a door with `settings` on a room's perimeter segment, or clear it with null; re-syncs the native walls. */
    async setRoomDoor(id: string, index: number, settings: DoorSettings | null): Promise<boolean> {
        const f = this.getFeature(id);
        if (f?.type !== 'room' || index < 0 || index >= f.points.length) {
            return false;
        }
        await this.replaceFeature(id, withRoomDoor(f, index, settings));
        return true;
    }

    /** Move a control point of a committed feature; false if the edit is invalid. */
    async moveVertex(id: string, index: number, to: Point): Promise<boolean> {
        const f = this.getFeature(id);
        if (!f) {
            return false;
        }
        const next = movePoint(f, index, to);
        if (!next) {
            return false;
        }
        await this.replaceFeature(id, next);
        return true;
    }

    /** Render a transient preview of a vertex move (drag feedback), without persisting. */
    previewVertexMove(id: string, index: number, to: Point): void {
        const f = this.getFeature(id);
        if (!f) {
            return;
        }
        const moved = movePoint(f, index, to);
        if (moved) {
            this.renderer.preview(moved);
        }
    }

    /** Set a path's half-width at one control point; false if it is not a path point. */
    async setPathWidth(id: string, index: number, halfWidth: number): Promise<boolean> {
        const f = this.getFeature(id);
        const next = f ? setHalfWidth(f, index, halfWidth) : null;
        if (!next) {
            return false;
        }
        await this.replaceFeature(id, next);
        return true;
    }

    /** Render a transient preview of a path width change (drag feedback), without persisting. */
    previewPathWidth(id: string, index: number, halfWidth: number): void {
        const f = this.getFeature(id);
        const next = f ? setHalfWidth(f, index, halfWidth) : null;
        if (next) {
            this.renderer.preview(next);
        }
    }

    /** Clear any transient preview (end of a drag). */
    clearPreview(): void {
        this.renderer.clearPreview();
    }

    /** Delete a control point; false if invalid or it would drop below the minimum. */
    async deleteVertex(id: string, index: number): Promise<boolean> {
        const f = this.getFeature(id);
        if (!f) {
            return false;
        }
        const next = deletePoint(f, index);
        if (!next) {
            return false;
        }
        await this.replaceFeature(id, next);
        return true;
    }

    /** Step back one edit, bringing the scene's generated documents (or a blend's mask) back with it. */
    async undo(): Promise<void> {
        const prev = this.history.pop();
        if (!prev) {
            return;
        }
        this.future.push(this.present(prev));
        await this.revert(prev);
    }

    /** Re-apply an undone edit, documents included. */
    async redo(): Promise<void> {
        const next = this.future.pop();
        if (!next) {
            return;
        }
        this.history.push(this.present(next));
        await this.revert(next);
    }

    /** The present state of what `entry` records, to step back to it again. */
    private present(entry: HistoryEntry): HistoryEntry {
        if (entry.kind === 'features') {
            return { kind: 'features', features: [...this.features] };
        }
        if (entry.kind === 'steps') {
            return { kind: 'steps', steps: entry.steps.map((step) => this.present(step)) };
        }
        // Stepping back and forth brings the blend back live; a bake is not undone and redone.
        return { kind: 'blend', key: entry.key, splat: liveCopy(this.splats.get(entry.key)) };
    }

    /** Make what `entry` records the present. */
    private async revert(entry: HistoryEntry): Promise<void> {
        if (entry.kind === 'features') {
            // One transaction: an undo lands whole or not at all.
            await this.transaction(async () => this.restore(entry.features));
            return;
        }
        if (entry.kind === 'steps') {
            await entry.steps.reduce(async (previous, step) => {
                await previous;
                await this.revert(step);
            }, Promise.resolve());
            return;
        }
        // The blend comes back live, so what it had been baked into since goes.
        const now = this.splats.get(entry.key)?.layer;
        if (now) {
            await this.discardBake(now);
        }
        if (entry.splat === null) {
            // A layer the step made is taken away again.
            this.splats.delete(entry.key);
            this.splatRenderer.remove(entry.key);
            await this.saveSplatLayers();
            return;
        }
        this.splats.set(entry.key, { layer: entry.splat.layer, mask: entry.splat.mask.slice() });
        this.redrawSplats();
        await this.saveSplats([entry.key]);
    }

    async toFront(id: string): Promise<void> {
        await this.reorder(id, (arr, i) => {
            const [f] = arr.splice(i, 1);
            if (f) {
                arr.push(f);
            }
        });
    }

    async toBack(id: string): Promise<void> {
        await this.reorder(id, (arr, i) => {
            const [f] = arr.splice(i, 1);
            if (f) {
                arr.unshift(f);
            }
        });
    }

    async raise(id: string): Promise<void> {
        await this.reorder(id, (arr, i) => {
            if (i < arr.length - 1) {
                swap(arr, i, i + 1);
            }
        });
    }

    async lower(id: string): Promise<void> {
        await this.reorder(id, (arr, i) => {
            if (i > 0) {
                swap(arr, i, i - 1);
            }
        });
    }

    /** Swap the feature with `id` for `next`, snapshotting for undo, then persist + redraw it. */
    private async replaceFeature(id: string, next: Feature): Promise<void> {
        const old = this.features.find((f) => f.id === id);
        if (!old) {
            return;
        }
        await this.transaction(async () => {
            this.snapshot();
            const before = this.features;
            this.features = this.features.map((f) => (f.id === id ? next : f));
            this.show(next);
            await this.persist();
            await this.syncDocs(next);
            if (next.type === 'stamp' && next.pile !== null) {
                // The container token follows the stamp.
                await this.containers.move(next.pile, pileSpec(next, levelElevation(this.levelList, next.level)));
            }
            await this.resyncDependents(before, [old, next]);
        });
    }

    /**
     * Re-sync the features whose plan depends on others that just changed. A
     * door stamp changes the openings in room walls, and a room changes which
     * stretches its neighbours share with it (and their doors). Only rooms
     * whose planned walls actually differ are touched.
     */
    private async resyncDependents(before: readonly Feature[], changed: readonly Feature[]): Promise<void> {
        if (!changed.some((f) => isDoorStamp(f) || f.type === 'room')) {
            return;
        }
        const wallsOf = (room: Feature, features: readonly Feature[]): string => JSON.stringify(planDocuments(room, this.planContext(features)).walls);
        // The changed features themselves were synced already.
        const changedIds = new Set(changed.map((f) => f.id));
        const affected = this.features.filter((f) => f.type === 'room' && !changedIds.has(f.id) && wallsOf(f, before) !== wallsOf(f, this.features));
        // Sequential: each sync reads and persists the shared feature list, so concurrent syncs would race.
        await affected.reduce(async (previous, room) => {
            await previous;
            await this.syncDocs(this.getFeature(room.id) ?? room);
        }, Promise.resolve());
    }

    /**
     * Bring a feature's native documents in line with its plan: tiles are
     * updated in place when the count is unchanged (keeping their ids, and
     * anything a GM set on them), everything else is replaced. Records the
     * resulting ids on the feature and persists.
     */
    private async syncDocs(feature: Feature): Promise<void> {
        await this.transaction(async () => this.stageDocs(feature));
    }

    private async stageDocs(feature: Feature): Promise<void> {
        const plan = planDocuments(feature, this.planContext());
        const old = feature.docs;
        const planned = [plan.walls, plan.lights, plan.tiles, plan.regions, plan.sounds, plan.notes, plan.drawings].some((kind) => kind.length > 0);
        if (!planned && !hasDocs(old)) {
            return;
        }
        // Tiles and walls whose count is unchanged are updated in place, keeping their ids:
        // a door or switch a player just used must not be deleted from under them.
        const keepTiles = old.tiles.length > 0 && old.tiles.length === plan.tiles.length;
        const keepWalls = old.walls.length > 0 && old.walls.length === plan.walls.length;
        const created = this.staged.stage({
            remove: { ...old, tiles: keepTiles ? [] : old.tiles, walls: keepWalls ? [] : old.walls },
            create: { ...plan, tiles: keepTiles ? [] : plan.tiles, walls: keepWalls ? [] : plan.walls },
            updateTiles: keepTiles ? pairDocs(old.tiles, plan.tiles).map(({ id, doc }) => ({ id, tile: doc })) : [],
            updateWalls: keepWalls ? pairDocs(old.walls, plan.walls).map(({ id, doc }) => ({ id, wall: doc })) : [],
        });
        const docs: GeneratedDocs = {
            ...created,
            tiles: keepTiles ? old.tiles : created.tiles,
            walls: keepWalls ? old.walls : created.walls,
        };
        this.features = this.features.map((f) => (f.id === feature.id ? withDocs(f, docs) : f));
        await this.persist();
    }

    /**
     * Run `work` as one document transaction: whatever it stages is written
     * together when it ends, atomically. Nested transactions join the
     * outermost, which does the writing. If the work or the write fails,
     * nothing was written, so the feature list and undo history roll back to
     * where the transaction began (and are persisted so), and the error
     * propagates. Side effects outside the scene's documents (another scene's
     * exit region, a container pile, a level) are not rolled back.
     */
    private async transaction<T>(work: () => Promise<T> | T): Promise<T> {
        if (this.writing > 0) {
            return work();
        }
        const before = { features: [...this.features], history: [...this.history], future: [...this.future] };
        this.writing = 1;
        try {
            const result = await work();
            // The features are saved once, as the transaction ends, before the documents they own are written.
            if (this.unsaved) {
                this.unsaved = false;
                await this.store.save(this.features);
            }
            if (!this.staged.empty) {
                await this.sink.write(this.staged.take());
            }
            return result;
        } catch (error) {
            this.staged.take();
            this.unsaved = false;
            this.features = before.features;
            this.history.splice(0, this.history.length, ...before.history);
            this.future = before.future;
            this.redraw();
            await this.store.save(this.features);
            throw error;
        } finally {
            this.writing = 0;
        }
    }

    /**
     * Save the features: now, or, inside a transaction, once as it ends. A
     * built spec adds hundreds of features in one transaction, and saving the
     * whole list after each made that hundreds of ever-larger scene writes.
     */
    private async persist(): Promise<void> {
        if (this.writing > 0) {
            this.unsaved = true;
            return;
        }
        await this.store.save(this.features);
    }

    /** A fresh id for a feature built outside the controller (e.g. from a scene spec). */
    newFeatureId(): string {
        return this.makeId();
    }

    /** Run `work` as one edit: a single undo step takes back everything it did. */
    async batch(work: () => Promise<void>): Promise<void> {
        if (this.batching) {
            await work();
            return;
        }
        this.snapshot();
        this.batching = true;
        this.batchSteps = [];
        try {
            // One undo step, and one atomic document write.
            await this.transaction(work);
            // Splat maps the batch changed are taken back with its features, as the same step.
            const snapshot = this.history.at(-1);
            if (this.batchSteps.length > 0 && snapshot?.kind === 'features') {
                this.history.splice(-1, 1, { kind: 'steps', steps: [snapshot, ...this.batchSteps] });
            }
        } finally {
            this.batching = false;
            this.batchSteps = [];
        }
    }

    /** Record splat layers as they were: their own undo step, or part of the batch under way. */
    private recordSplat(entry: HistoryEntry): void {
        if (this.batching) {
            this.batchSteps.push(entry);
        } else {
            this.record(entry);
        }
    }

    /** Record the current feature list for undo, capped, and drop the redo stack; inside a batch, the batch's one snapshot stands. */
    private snapshot(): void {
        if (this.batching) {
            return;
        }
        this.record({ kind: 'features', features: [...this.features] });
    }

    /** Push an undo step, capped, and drop the redo stack. */
    private record(entry: HistoryEntry): void {
        this.history.push(entry);
        if (this.history.length > MAX_HISTORY) {
            this.history.shift();
        }
        this.future = [];
    }

    /** Read every level's splat map in from the scene; a mask that cannot be read starts blank. */
    async loadSplats(): Promise<void> {
        const layers = this.splatStore.load();
        const loaded = await Promise.all(layers.map(async (layer) => ({ layer, mask: (await this.splatStore.readMask(layer)) ?? blankMask(layer) })));
        this.splats.clear();
        // Bottom of each stack first, so each level's layers draw in order.
        for (const splat of [...loaded].sort((a, b) => a.layer.index - b.layer.index)) {
            this.splats.set(splatKey(splat.layer.level, splat.layer.index), splat);
        }
        this.redrawSplats();
    }

    /** The first layer of the splat map of the level being edited, if it has one: the one a bake is recorded on. */
    splatLayer(): SplatLayer | null {
        return this.splats.get(splatKey(this.active, 0))?.layer ?? null;
    }

    /** The layers of `level`'s splat map, bottom to top. */
    splatStack(level: string | null): SplatLayer[] {
        return this.stackOf(level).map((splat) => splat.layer);
    }

    private stackOf(level: string | null): Splat[] {
        return [...this.splats.values()].filter((splat) => splat.layer.level === level).sort((a, b) => a.layer.index - b.layer.index);
    }

    /** Whether the blend of the level being edited is live, baked (and into what), or not there. */
    splatState(): SplatState {
        return splatState(this.splatLayer());
    }

    /** Take the blend of the level being edited back from its bake to the live overlay; false when it is not baked. */
    async unbakeSplat(): Promise<boolean> {
        const base = this.splats.get(splatKey(this.active, 0));
        if (!base?.layer.baked) {
            return false;
        }
        await this.discardBake(base.layer);
        this.liven(this.active);
        await this.saveSplatLayers();
        return true;
    }

    /**
     * Bake the blend of the level being edited so it renders without the
     * module; its overlay stops drawing. Into a native Tile beneath the
     * level's other tiles, or into the level's own background image, which
     * is put back on unbaking (a blend on every level has no one background
     * to go into). Blending again unbakes it. False with no blend to bake,
     * one already baked, or an image that could not be rendered.
     */
    async bakeSplat(into: BakeTarget = 'tile'): Promise<boolean> {
        const key = splatKey(this.active, 0);
        const splat = this.splats.get(key);
        const level = splat?.layer.level == null ? null : findLevel(this.levelList, splat.layer.level);
        // Nothing to bake, baked already, or no level's background to bake into.
        if (splat?.layer.baked !== null || (into === 'background' && !level)) {
            return false;
        }
        // The whole stack bakes into one image.
        const png = await this.splatRenderer.snapshot(this.splatStack(this.active).map((layer) => splatKey(layer.level, layer.index)));
        if (!png) {
            return false;
        }
        const src = bakedImagePath(splat.layer);
        await this.splatStore.writeImage(src, png);
        const baked = level && into === 'background' ? await this.bakeIntoBackground(level, src) : await this.bakeIntoTile(splat.layer, src);
        if (baked === null) {
            return false;
        }
        this.splats.set(key, { ...splat, layer: { ...splat.layer, baked } });
        this.redrawSplats();
        await this.saveSplatLayers();
        return true;
    }

    private async bakeIntoTile(layer: SplatLayer, src: string): Promise<SplatBake | null> {
        const tile = await this.splatStore.createTile(layer, src);
        return tile === null ? null : { into: 'tile', tile };
    }

    private async bakeIntoBackground(level: Level, src: string): Promise<SplatBake | null> {
        const previous = level.art.background;
        return (await this.setLevelArt(level.id, { ...level.art, background: src })) ? { into: 'background', previous } : null;
    }

    /**
     * Undo where `layer` is baked: delete its Tile, or put its level's
     * background back, unless the GM has since set another one there.
     */
    private async discardBake(layer: SplatLayer): Promise<void> {
        const bake = layer.baked;
        if (bake?.into === 'tile') {
            await this.splatStore.removeTile(bake.tile);
            return;
        }
        const level = layer.level === null ? null : findLevel(this.levelList, layer.level);
        if (bake?.into === 'background' && level?.art.background === bakedImagePath(layer)) {
            await this.setLevelArt(level.id, { ...level.art, background: bake.previous });
        }
    }

    /**
     * One dab of the blend brush on the level being edited. Painting puts the
     * role into its own channel of the level's splat map: the layer holding
     * it, else the lowest with a channel free, else a new layer stacked on
     * top (made to cover the scene). The layers above it lose as much, so the
     * paint shows through them. Unblending takes from every layer. False once
     * the stack is full and every channel holds another role, or with no
     * scene to cover. The stroke ends, as one undo step, with `endBlend`.
     */
    blend(dab: BlendDab): boolean {
        const level = this.active;
        this.liven(level);
        if (dab.erase) {
            for (const splat of this.stackOf(level)) {
                this.dab(splat, dab, 0, true);
            }
            return true;
        }
        const placed = this.placeRole(level, dab.role);
        if (!placed) {
            return false;
        }
        this.dab(placed.splat, dab, placed.channel, false);
        for (const above of this.stackOf(level).filter((splat) => splat.layer.index > placed.splat.layer.index)) {
            this.dab(above, dab, 0, true);
        }
        return true;
    }

    /** The layer and channel painting `role` on `level` goes into, naming it there first if it is new; null when the stack is full. */
    private placeRole(level: string | null, role: string): { readonly splat: Splat; readonly channel: number } | null {
        const stack = this.splatStack(level);
        const found = stackChannelFor(stack, role);
        // No layer has room for it: a new one on top, while the stack has room.
        const fresh = found !== null || stack.length >= MAX_SPLAT_LAYERS ? null : this.newSplat(level, stack.length);
        const freshChannel = fresh && channelFor(fresh.layer, role);
        const assigned = found ?? (fresh && freshChannel ? { index: fresh.layer.index, ...freshChannel } : null);
        if (!assigned) {
            return null;
        }
        const key = splatKey(level, assigned.index);
        const mask = this.splats.get(key)?.mask ?? fresh?.mask;
        if (!mask) {
            return null;
        }
        if (this.splats.get(key)?.layer !== assigned.layer) {
            // The role is new to this layer (or the layer is new): recorded as it was, then redrawn naming it.
            this.touch(key);
            this.splats.set(key, { layer: assigned.layer, mask });
            this.splatRenderer.set(key, assigned.layer, mask);
        }
        const splat = this.splats.get(key);
        return splat ? { splat, channel: assigned.channel } : null;
    }

    /** One dab into one layer's mask, the layer recorded as it was first. */
    private dab(splat: Splat, dab: BlendDab, channel: number, erase: boolean): void {
        const { layer } = splat;
        const key = splatKey(layer.level, layer.index);
        this.touch(key);
        const rect = paintDab(splat.mask, layer, {
            at: maskPoint(layer, dab.at),
            radius: maskLength(layer, dab.radius),
            channel,
            strength: dab.strength,
            erase,
        });
        this.splatRenderer.update(key, rect);
    }

    /** Record layer `key` as it is, the first time the stroke under way touches it. */
    private touch(key: string): void {
        this.blendStart ??= new Map();
        if (!this.blendStart.has(key)) {
            this.blendStart.set(key, liveCopy(this.splats.get(key)));
        }
    }

    /** End the blend stroke under way: one undo step for every layer it touched, and their masks saved. */
    async endBlend(): Promise<void> {
        const start = this.blendStart;
        if (!start) {
            return;
        }
        this.blendStart = null;
        const steps: HistoryEntry[] = [...start].map(([key, splat]) => ({ kind: 'blend', key, splat }));
        const [only] = steps;
        this.recordSplat(steps.length === 1 && only ? only : { kind: 'steps', steps });
        await this.saveSplats([...start.keys()]);
    }

    /**
     * Make mask images the splat map of `level` (null: every level), bottom
     * to top, each one's channels weighting its roles: a scene spec's painted
     * blend. It replaces the level's whole stack, as one undo step. Each
     * image is copied to a mask file of the level's own, so painting over it
     * never touches the original, and covers the scene whatever its size.
     * Whether each image was taken: not when it cannot be read, or there is
     * no scene to cover.
     */
    async adoptSplats(level: string | null, masks: readonly { readonly image: string; readonly roles: SplatRoles }[]): Promise<boolean[]> {
        const here = this.scenes.current();
        const frame = here ? this.scenes.frame(here.id) : null;
        const reads = await Promise.all(masks.map(async (mask) => this.splatStore.readImage(mask.image)));
        if (!frame) {
            return masks.map(() => false);
        }
        const before = this.stackOf(level);
        const bounds = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
        const adopted = reads.flatMap((read, i) => (read && masks[i] ? [{ read, roles: masks[i].roles }] : []));
        const layers = adopted.map(
            ({ read, roles }, index): Splat => ({
                layer: { level, index, path: this.splatStore.pathFor(level, index), bounds, width: read.width, height: read.height, roles, baked: null },
                mask: read.pixels,
            }),
        );
        // Undo brings back the stack as it was, live, and takes away the layers it did not have.
        const keys = [...new Set([...before, ...layers].map(({ layer }) => splatKey(level, layer.index)))];
        this.recordSplat({ kind: 'steps', steps: keys.map((key) => ({ kind: 'blend', key, splat: liveCopy(this.splats.get(key)) })) });
        const base = before[0];
        if (base) {
            await this.discardBake(base.layer);
        }
        for (const { layer } of before) {
            const key = splatKey(level, layer.index);
            this.splats.delete(key);
            this.splatRenderer.remove(key);
        }
        for (const splat of layers) {
            this.splats.set(splatKey(level, splat.layer.index), splat);
        }
        this.redrawSplats();
        await this.saveSplats(layers.map(({ layer }) => splatKey(level, layer.index)));
        return reads.map((read) => read !== null);
    }

    /**
     * `level`'s splat map live again: blending takes the blend back from where
     * it was baked (undone in the background, as a stroke cannot wait for it),
     * and its whole stack draws. The record is saved when the stroke ends.
     */
    private liven(level: string | null): void {
        const key = splatKey(level, 0);
        const base = this.splats.get(key);
        if (!base?.layer.baked) {
            return;
        }
        void this.discardBake(base.layer);
        this.splats.set(key, { ...base, layer: { ...base.layer, baked: null } });
        this.redrawSplats();
    }

    /** A blank layer `index` of `level`'s splat map over the scene, or null with no scene frame to cover. */
    private newSplat(level: string | null, index: number): Splat | null {
        const here = this.scenes.current();
        const frame = here ? this.scenes.frame(here.id) : null;
        if (!frame) {
            return null;
        }
        const layer = newSplatLayer(level, index, this.splatStore.pathFor(level, index), frame, frame.gridSize);
        return { layer, mask: blankMask(layer) };
    }

    /** Draw the splat maps shown while editing the active level, and no others; a baked one is what it was baked into. */
    private redrawSplats(): void {
        for (const [key, splat] of this.splats) {
            const baked = this.splats.get(splatKey(splat.layer.level, 0))?.layer.baked ?? null;
            if (baked === null && onLevel(splat.layer.level, this.active)) {
                this.splatRenderer.set(key, splat.layer, splat.mask);
            } else {
                this.splatRenderer.remove(key);
            }
        }
    }

    /** Save the masks of the layers `keys`, and every layer's record. */
    private async saveSplats(keys: readonly string[]): Promise<void> {
        for (const key of keys) {
            const splat = this.splats.get(key);
            if (splat) {
                // eslint-disable-next-line no-await-in-loop -- each mask is its own file upload; one at a time keeps the order the records name
                await this.splatStore.writeMask(splat.layer, splat.mask);
            }
        }
        await this.saveSplatLayers();
    }

    /** Save every layer's record, each level's stack in order. */
    private async saveSplatLayers(): Promise<void> {
        await this.splatStore.save([...this.splats.values()].map((splat) => splat.layer).sort((a, b) => a.index - b.index));
    }

    /** Apply an in-place reordering `move` to a copy, persisting + redrawing if it changed. */
    private async reorder(id: string, move: (arr: Feature[], i: number) => void): Promise<void> {
        const i = this.features.findIndex((f) => f.id === id);
        if (i < 0) {
            return;
        }
        const next = [...this.features];
        move(next, i);
        if (sameOrder(next, this.features)) {
            return;
        }
        this.snapshot();
        this.features = next;
        await this.persist();
        this.redraw();
    }

    private buildFeature(id: string): Feature | null {
        if (!this.session || !this.brush) {
            return null;
        }
        const pts = this.session.simplified();
        if (this.brush.type === 'path') {
            return makePath(id, this.brush.kind, pts, this.halfWidth, this.pathWalls, this.riverLook);
        }
        if (this.brush.type === 'region') {
            const region = makeRegion(id, this.brush.biome, pts, this.paintTexture);
            return region && { ...region, movementCost: storedCost(this.movementCost) };
        }
        if (this.brush.type === 'room') {
            return makeRoom(id, this.brush.floor, pts, this.brush.wall ?? null, this.brush.wallKind, this.brush.ceiling);
        }
        const stroke = makeStroke(id, this.brush.biome, pts, this.brushRadius, this.paintTexture);
        return stroke && { ...stroke, movementCost: storedCost(this.movementCost) };
    }

    private redraw(): void {
        this.renderer.clear();
        // What the active level sees below it (the yard round an upper storey) first, beneath its own; seen, never edited.
        for (const seen of seenBelow(this.levelList, this.active)) {
            for (const f of drawOrder(this.features.filter((feature) => feature.level === seen.id))) {
                this.renderer.set(f.id, f);
            }
        }
        for (const f of drawOrder(this.features)) {
            if (this.visible(f)) {
                this.renderer.set(f.id, f);
            }
        }
        this.redrawSplats();
    }

    /** Whether `feature` is on a level the active one sees below it: drawn beneath, never picked. */
    private seen(feature: Feature): boolean {
        return feature.level !== null && seenBelow(this.levelList, this.active).some((level) => level.id === feature.level);
    }
}
