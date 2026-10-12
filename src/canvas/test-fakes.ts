// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * In-memory fakes for the controller's injected ports, shared by the canvas
 * tests. They record every call so tests assert on the declarative effects
 * (what was rendered, persisted, created, deleted) with no Foundry runtime.
 */
import type { Point } from '../geometry/spline';
import { type CatalogStamp, loadPacks } from '../stamps/catalog';
import type { PileSpec } from '../tools/containers';
import type { DrawingDoc, LightDoc, NoteDoc, RegionDoc, SoundDoc, TileDoc, TokenDoc, WallDoc } from '../tools/documents';
import type { Feature } from '../tools/feature';
import { allDocIds, hasDocs, type GeneratedDocs } from '../tools/generated-docs';
import type { Level } from '../tools/levels';
import type { RgbaImage } from '../tools/png';
import type { SceneSettings } from '../tools/scene-settings';
import type { MaskRect, SplatLayer } from '../tools/splat';
import type { SceneFrame } from '../tools/submap';
import {
    CartographyController,
    type ContainerService,
    type DocumentSink,
    type LevelStore,
    type SceneStore,
    type SplatRenderer,
    type SplatStore,
    type TileUpdate,
    type WorldScenes,
    type WriteResult,
} from './controller';
import type { FeatureRenderer } from './renderer';
import type { DocumentKind, Staged, StagedWrite } from './staged-changes';

class FakeRenderer implements FeatureRenderer {
    readonly setIds: string[] = [];
    readonly removed: string[] = [];
    previews = 0;
    cleared = 0;
    set(id: string, _feature: Feature): void {
        this.setIds.push(id);
    }
    preview(_feature: Feature): void {
        this.previews += 1;
    }
    remove(id: string): void {
        this.removed.push(id);
    }
    clearPreview(): void {}
    clear(): void {
        this.cleared += 1;
    }
}

class FakeStore implements SceneStore {
    data: Feature[] = [];
    readonly saved: Feature[][] = [];
    load(): Feature[] {
        return this.data;
    }
    async save(features: readonly Feature[]): Promise<void> {
        this.saved.push([...features]);
        await Promise.resolve();
    }
    /** The most recently persisted feature list. */
    last(): readonly Feature[] {
        return this.saved[this.saved.length - 1] ?? [];
    }
}

/** Document-id prefix per kind, like a real scene's distinct collections. */
const ID_PREFIX: Record<DocumentKind, string> = { walls: 'w', lights: 'L', tiles: 't', regions: 'r', sounds: 's', notes: 'n', drawings: 'd', tokens: 'T' };

/**
 * Records every write, and the documents created per type (one entry per
 * write that created any). Issues ids `<prefix><n>` from one counter per
 * document type.
 */
class FakeSink implements DocumentSink {
    readonly writes: StagedWrite[] = [];
    readonly walls: WallDoc[][] = [];
    readonly lights: LightDoc[][] = [];
    readonly tiles: TileDoc[][] = [];
    readonly tileUpdates: TileUpdate[][] = [];
    readonly wallUpdates: Staged<WallDoc>[][] = [];
    /** Every write's walls, created or updated in place: the walls as they now stand. */
    readonly wallWrites: WallDoc[][] = [];
    readonly regions: RegionDoc[][] = [];
    readonly regionUpdates: RegionDoc[][] = [];
    readonly sounds: SoundDoc[][] = [];
    readonly notes: NoteDoc[][] = [];
    readonly drawings: DrawingDoc[][] = [];
    readonly tokens: TokenDoc[][] = [];
    readonly tokenUpdates: Staged<TokenDoc>[][] = [];
    readonly deleted: GeneratedDocs[] = [];
    /** Reject every write, as Foundry rejects a batch it cannot apply. */
    rejecting = false;
    /** Actors not in the world: tokens of them are reported unplaced. */
    missingActors: string[] = [];
    private readonly counters: Record<DocumentKind, number> = { walls: 0, lights: 0, tiles: 0, regions: 0, sounds: 0, notes: 0, drawings: 0, tokens: 0 };

    newId(kind: DocumentKind): string {
        const id = `${ID_PREFIX[kind]}${this.counters[kind]}`;
        this.counters[kind] += 1;
        return id;
    }

    async write(write: StagedWrite): Promise<WriteResult> {
        if (this.rejecting) {
            throw new Error('batch rejected');
        }
        this.writes.push(write);
        if (hasDocs(write.deletes)) {
            this.deleted.push(write.deletes);
        }
        const record = <T>(into: T[][], staged: readonly { readonly doc: T }[]): void => {
            if (staged.length > 0) {
                into.push(staged.map((s) => s.doc));
            }
        };
        record(this.walls, write.walls);
        record(this.lights, write.lights);
        record(this.tiles, write.tiles);
        record(this.sounds, write.sounds);
        record(this.notes, write.notes);
        record(this.drawings, write.drawings);
        record(this.tokens, write.tokens);
        const regions = write.regions.flatMap((group) => group.regions.filter((_, i) => !group.cancelled.includes(group.ids[i] ?? '')));
        if (regions.length > 0) {
            this.regions.push(regions);
        }
        if (write.tileUpdates.length > 0) {
            this.tileUpdates.push(write.tileUpdates.map((s) => ({ id: s.id, tile: s.doc })));
        }
        if (write.wallUpdates.length > 0) {
            this.wallUpdates.push([...write.wallUpdates]);
        }
        if (write.tokenUpdates.length > 0) {
            this.tokenUpdates.push([...write.tokenUpdates]);
        }
        record(this.wallWrites, [...write.walls, ...write.wallUpdates]);
        record(this.regionUpdates, write.regionUpdates);
        await Promise.resolve();
        // A token whose actor is not in the world is never placed: the real sink reports it.
        const unplacedTokens = [...write.tokens, ...write.tokenUpdates].filter(({ doc }) => this.missingActors.includes(doc.actor)).map(({ id }) => id);
        return { unplacedTokens };
    }
    /** Every id deleted so far, flattened across document types. */
    deletedIds(): string[] {
        return this.deleted.flatMap(allDocIds);
    }
}

/** Levels held in memory, issuing ids `lv1`, `lv2`, … */
class FakeLevels implements LevelStore {
    levels: Level[] = [];
    private counter = 0;
    load(): Level[] {
        return [...this.levels];
    }
    async create(level: Omit<Level, 'id'>): Promise<string> {
        this.counter += 1;
        const id = `lv${this.counter}`;
        this.levels.push({ id, ...level });
        await Promise.resolve();
        return id;
    }
    async update(id: string, patch: Partial<Omit<Level, 'id'>>): Promise<void> {
        this.levels = this.levels.map((level) => (level.id === id ? { ...level, ...patch } : level));
        await Promise.resolve();
    }
    async remove(id: string): Promise<void> {
        this.levels = this.levels.filter((level) => level.id !== id);
        await Promise.resolve();
    }
}

/** A world of scenes in memory: the current one is `here` ("Town"); created interiors are `sc1`, `sc2`, … */
class FakeScenes implements WorldScenes {
    readonly names = new Map<string, string>([
        ['here', 'Town'],
        ['vault', 'Vault'],
    ]);
    readonly regions: { scene: string; region: RegionDoc }[] = [];
    readonly deleted: { scene: string; region: string }[] = [];
    private counter = 0;
    current(): { id: string; name: string } {
        return { id: 'here', name: 'Town' };
    }
    name(sceneId: string): string | null {
        return this.names.get(sceneId) ?? null;
    }
    frame(sceneId: string): SceneFrame | null {
        return this.names.has(sceneId) ? { x: 0, y: 0, width: 1000, height: 800, gridSize: 100 } : null;
    }
    async createScene(sceneName: string): Promise<string> {
        this.counter += 1;
        const id = `sc${this.counter}`;
        this.names.set(id, sceneName);
        await Promise.resolve();
        return id;
    }
    async createRegion(sceneId: string, region: RegionDoc): Promise<boolean> {
        this.regions.push({ scene: sceneId, region });
        await Promise.resolve();
        return this.names.has(sceneId);
    }
    /** Every teleport updated in another scene, in order. */
    readonly teleports: { scene: string; region: RegionDoc }[] = [];
    async updateTeleport(sceneId: string, region: RegionDoc): Promise<void> {
        this.teleports.push({ scene: sceneId, region });
        await Promise.resolve();
    }
    /** Every settings change, in order. */
    readonly settings: SceneSettings[] = [];
    async updateSettings(settings: SceneSettings): Promise<void> {
        this.settings.push(settings);
        await Promise.resolve();
    }
    async deleteRegion(sceneId: string, regionId: string): Promise<void> {
        this.deleted.push({ scene: sceneId, region: regionId });
        await Promise.resolve();
    }
}

/** Item Piles stand-in: available unless told otherwise, issuing pile UUIDs `pile1`, `pile2`, … */
class FakeContainers implements ContainerService {
    active = true;
    readonly created: { spec: PileSpec; name: string }[] = [];
    readonly moved: { pile: string; spec: PileSpec }[] = [];
    readonly removed: string[] = [];
    available(): boolean {
        return this.active;
    }
    async create(spec: PileSpec, pileName: string): Promise<string> {
        this.created.push({ spec, name: pileName });
        await Promise.resolve();
        return `pile${this.created.length}`;
    }
    async move(pile: string, spec: PileSpec): Promise<void> {
        this.moved.push({ pile, spec });
        await Promise.resolve();
    }
    async remove(pile: string): Promise<void> {
        this.removed.push(pile);
        await Promise.resolve();
    }
}

export interface Harness {
    readonly c: CartographyController;
    readonly r: FakeRenderer;
    readonly s: FakeStore;
    readonly d: FakeSink;
    readonly l: FakeLevels;
    readonly w: FakeScenes;
    readonly k: FakeContainers;
    readonly sp: FakeSplats;
    readonly spr: FakeSplatRenderer;
}

/** A unit square traced from any image: the silhouette every fake stamp gets. */
export const FAKE_SILHOUETTE: Point[][] = [
    [
        { x: 0.25, y: 0.25 },
        { x: 0.75, y: 0.25 },
        { x: 0.75, y: 0.75 },
        { x: 0.25, y: 0.75 },
    ],
];

/** A controller over fresh fakes and the given catalog stamps, issuing feature ids p1, p2, … */
export function makeHarness(stamps: readonly CatalogStamp[] = [], traced: Point[][] | null = FAKE_SILHOUETTE): Harness {
    const r = new FakeRenderer();
    const s = new FakeStore();
    const d = new FakeSink();
    const l = new FakeLevels();
    const w = new FakeScenes();
    const k = new FakeContainers();
    const sp = new FakeSplats();
    const spr = new FakeSplatRenderer();
    let counter = 0;
    const c = new CartographyController({
        renderer: r,
        splats: sp,
        splatRenderer: spr,
        store: s,
        sink: d,
        levels: l,
        scenes: w,
        containers: k,
        catalog: { get: (key) => stamps.find((stamp) => stamp.key === key) ?? null },
        silhouettes: { trace: async () => Promise.resolve(traced) },
        makeId: () => {
            counter += 1;
            return `p${counter}`;
        },
    });
    return { c, r, s, d, l, w, k, sp, spr };
}

/** Splat maps in memory: layers and masks as last saved, with every write recorded. */
class FakeSplats implements SplatStore {
    layers: SplatLayer[] = [];
    readonly masks = new Map<string, Uint8ClampedArray<ArrayBuffer>>();
    readonly maskWrites: string[] = [];
    load(): SplatLayer[] {
        return [...this.layers];
    }
    async save(layers: readonly SplatLayer[]): Promise<void> {
        this.layers = [...layers];
        await Promise.resolve();
    }
    async readMask(layer: SplatLayer): Promise<Uint8ClampedArray<ArrayBuffer> | null> {
        await Promise.resolve();
        return this.masks.get(layer.path)?.slice() ?? null;
    }
    async writeMask(layer: SplatLayer, mask: Uint8ClampedArray<ArrayBuffer>): Promise<void> {
        this.masks.set(layer.path, mask.slice());
        this.maskWrites.push(layer.path);
        await Promise.resolve();
    }
    /** Mask images a spec can name, by path. */
    readonly images = new Map<string, RgbaImage>();
    async readImage(path: string): Promise<RgbaImage | null> {
        await Promise.resolve();
        const image = this.images.get(path);
        return image ? { ...image, pixels: image.pixels.slice() } : null;
    }
    pathFor(level: string | null, index: number): string {
        return `splats/${level ?? 'all'}${index === 0 ? '' : `-${index}`}.png`;
    }
    /** Baked images saved, by path. */
    readonly written = new Map<string, Uint8Array<ArrayBuffer>>();
    async writeImage(path: string, png: Uint8Array<ArrayBuffer>): Promise<void> {
        this.written.set(path, png);
        await Promise.resolve();
    }
    /** Baked Tiles standing, by id: the image each shows. */
    readonly tiles = new Map<string, string>();
    private tileCount = 0;
    async createTile(_layer: SplatLayer, src: string): Promise<string> {
        const id = `bake${this.tileCount}`;
        this.tileCount += 1;
        this.tiles.set(id, src);
        await Promise.resolve();
        return id;
    }
    async removeTile(id: string): Promise<void> {
        this.tiles.delete(id);
        await Promise.resolve();
    }
}

/** Records what splat maps are drawn: key → the roles shown, and each partial update; a drawn map snapshots to its key's bytes. */
class FakeSplatRenderer implements SplatRenderer {
    readonly shown = new Map<string, SplatLayer['roles']>();
    readonly updates: { key: string; rect: MaskRect }[] = [];
    set(key: string, layer: SplatLayer): void {
        this.shown.set(key, layer.roles);
    }
    update(key: string, rect: MaskRect): void {
        this.updates.push({ key, rect });
    }
    remove(key: string): void {
        this.shown.delete(key);
    }
    async snapshot(keys: readonly string[]): Promise<Uint8Array<ArrayBuffer> | null> {
        await Promise.resolve();
        const drawn = keys.filter((key) => this.shown.has(key));
        return drawn.length > 0 ? new TextEncoder().encode(`png:${drawn.join('+')}`) : null;
    }
}

/** One catalog stamp per definition, loaded through the real pack parser from module `pack`. */
export function catalogStamps(definitions: readonly object[]): readonly CatalogStamp[] {
    const loaded = loadPacks([{ moduleId: 'pack', manifest: { schemaVersion: 1, id: 'pack', name: 'Pack', stamps: definitions } }]);
    if (loaded.errors.length > 0) {
        throw new Error(`invalid test stamps: ${JSON.stringify(loaded.errors)}`);
    }
    return loaded.stamps;
}

/** A light switch (`pack:switch`), a lamp with lit and unlit variants (`pack:lamp`), and a crate no switch can control (`pack:crate`). */
export const SWITCH_STAMPS = catalogStamps([
    {
        id: 'switch',
        name: 'Light Switch',
        category: 'Lighting',
        scale: 'interior',
        perspective: 'top-down',
        door: { type: 'door', switch: true },
        variants: [
            { state: 'off', image: 'off.png', width: 20, height: 100, doorState: 'closed' },
            { state: 'on', image: 'on.png', width: 20, height: 100, doorState: 'open' },
        ],
    },
    {
        id: 'lamp',
        name: 'Lamp',
        category: 'Lighting',
        scale: 'interior',
        perspective: 'top-down',
        light: { dim: 4, bright: 2 },
        variants: [
            { state: 'unlit', image: 'unlit.png', width: 100, height: 100, light: null },
            { state: 'lit', image: 'lit.png', width: 100, height: 100 },
        ],
    },
    {
        id: 'crate',
        name: 'Crate',
        category: 'Storage',
        scale: 'interior',
        perspective: 'top-down',
        variants: [{ state: 'shut', image: 'crate.png', width: 100, height: 100 }],
    },
]);
