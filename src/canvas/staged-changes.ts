// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Document changes staged for one atomic write. Every created document gets
 * its id here, up front, so a feature records its documents' ids before they
 * exist and a whole edit (or undo, or generated map) can go to Foundry as a
 * single transaction, where no operation may use another's result.
 *
 * Removing a document created earlier in the same transaction cancels its
 * create rather than queueing a delete of something that does not exist yet
 * (a room re-synced by a neighbour added after it, in one spec). Updating
 * such a tile updates its pending create instead. Pure and unit-tested; the
 * Foundry sink turns what it takes into create, update and delete operations.
 */
import type { DrawingDoc, LightDoc, NoteDoc, RegionDoc, SoundDoc, TileDoc, TokenDoc, WallDoc } from '../tools/documents';
import { NO_DOCS, type GeneratedDocs } from '../tools/generated-docs';
import type { DocumentPlan } from '../tools/plan';

/**
 * One feature's change: its old documents to remove, the new ones to create,
 * and tiles, walls and tokens updated in place (keeping their ids, so a door a
 * player is using, or a token in play, is never deleted from under them).
 */
export interface DocumentChange {
    readonly remove: GeneratedDocs;
    readonly create: DocumentPlan;
    readonly updateTiles: readonly { readonly id: string; readonly tile: TileDoc }[];
    readonly updateWalls: readonly { readonly id: string; readonly wall: WallDoc }[];
    readonly updateTokens: readonly { readonly id: string; readonly token: TokenDoc }[];
}

/** A document to create, with the id it will have. */
export interface Staged<T> {
    readonly id: string;
    readonly doc: T;
}

/**
 * Regions are staged per change, each with the id it will have: `ids[i]` is
 * region `i`'s. A cancelled region keeps its position in the group and is
 * simply not created.
 */
export interface StagedRegions {
    readonly ids: readonly string[];
    readonly regions: readonly RegionDoc[];
    readonly cancelled: readonly string[];
}

/**
 * Everything staged, ready to write: deletes first, then creates, then
 * updates. A written region replaced under its own fixed id (a submap
 * entrance following its stamp) is an update: Foundry rejects a batch that
 * deletes and recreates one id. Its behaviours stay as they are, since a
 * fixed-id region's teleport target is fixed with its id.
 */
export interface StagedWrite {
    readonly deletes: GeneratedDocs;
    readonly walls: readonly Staged<WallDoc>[];
    readonly lights: readonly Staged<LightDoc>[];
    readonly tiles: readonly Staged<TileDoc>[];
    readonly sounds: readonly Staged<SoundDoc>[];
    readonly notes: readonly Staged<NoteDoc>[];
    readonly drawings: readonly Staged<DrawingDoc>[];
    readonly tokens: readonly Staged<TokenDoc>[];
    readonly regions: readonly StagedRegions[];
    readonly tileUpdates: readonly Staged<TileDoc>[];
    readonly wallUpdates: readonly Staged<WallDoc>[];
    readonly tokenUpdates: readonly Staged<TokenDoc>[];
    readonly regionUpdates: readonly Staged<RegionDoc>[];
    /** Plain Foundry lights (not the plugin's) a light switch shows or hides. */
    readonly lightVisibility: readonly LightVisibility[];
}

/** Show (`hidden: false`) or hide a Foundry light by id. */
export interface LightVisibility {
    readonly id: string;
    readonly hidden: boolean;
}

/** A kind of generated document. */
export type DocumentKind = keyof GeneratedDocs;

type Kind = DocumentKind;

const KINDS: readonly Kind[] = ['walls', 'lights', 'tiles', 'regions', 'sounds', 'notes', 'drawings', 'tokens'];

/** A document staged for creation, of any kind but regions (staged in groups). */
type PendingDoc = WallDoc | LightDoc | TileDoc | SoundDoc | NoteDoc | DrawingDoc | TokenDoc;

export class StagedChanges {
    private deletes: Record<Kind, string[]> = emptyIds();
    private walls: Staged<WallDoc>[] = [];
    private lights: Staged<LightDoc>[] = [];
    private tiles: Staged<TileDoc>[] = [];
    private sounds: Staged<SoundDoc>[] = [];
    private notes: Staged<NoteDoc>[] = [];
    private drawings: Staged<DrawingDoc>[] = [];
    private tokens: Staged<TokenDoc>[] = [];
    private regions: StagedRegions[] = [];
    private tileUpdates: Staged<TileDoc>[] = [];
    private wallUpdates: Staged<WallDoc>[] = [];
    private tokenUpdates: Staged<TokenDoc>[] = [];
    private regionUpdates: Staged<RegionDoc>[] = [];
    private lightVisibility: LightVisibility[] = [];

    constructor(private readonly makeId: (kind: DocumentKind) => string) {}

    /** Show or hide a plain Foundry light; a later call for the same light wins. */
    setLightVisibility(id: string, hidden: boolean): void {
        this.lightVisibility = [...this.lightVisibility.filter((v) => v.id !== id), { id, hidden }];
    }

    /** Whether anything is waiting to be written. */
    get empty(): boolean {
        return (
            KINDS.every((kind) => this.deletes[kind].length === 0) &&
            this.walls.length +
                this.lights.length +
                this.tiles.length +
                this.sounds.length +
                this.notes.length +
                this.drawings.length +
                this.tokens.length +
                this.regions.length +
                this.tileUpdates.length +
                this.wallUpdates.length +
                this.tokenUpdates.length +
                this.regionUpdates.length +
                this.lightVisibility.length ===
                0
        );
    }

    /** Stage a change; returns the ids its created documents will have, by type, in input order. */
    stage(change: DocumentChange): GeneratedDocs {
        for (const kind of KINDS) {
            for (const id of change.remove[kind]) {
                this.remove(kind, id);
            }
        }
        for (const update of change.updateTiles) {
            this.tileUpdates = this.updateInPlace(this.tiles, this.tileUpdates, update.id, update.tile);
        }
        for (const update of change.updateWalls) {
            this.wallUpdates = this.updateInPlace(this.walls, this.wallUpdates, update.id, update.wall);
        }
        for (const update of change.updateTokens) {
            this.tokenUpdates = this.updateInPlace(this.tokens, this.tokenUpdates, update.id, update.token);
        }
        const walls = this.push('walls', this.walls, change.create.walls);
        const lights = this.push('lights', this.lights, change.create.lights);
        const tiles = this.push('tiles', this.tiles, change.create.tiles);
        const sounds = this.push('sounds', this.sounds, change.create.sounds);
        const notes = this.push('notes', this.notes, change.create.notes);
        const drawings = this.push('drawings', this.drawings, change.create.drawings);
        const tokens = this.push('tokens', this.tokens, change.create.tokens);
        const regionIds = change.create.regions.map((region) => region.id ?? this.makeId('regions'));
        // A written region recreated under its own id is updated in place; it keeps its position in the group.
        const replaced = regionIds.filter((id, i) => change.create.regions[i]?.id === id && this.deletes.regions.includes(id));
        this.deletes.regions = this.deletes.regions.filter((id) => !replaced.includes(id));
        change.create.regions.forEach((region, i) => {
            const id = regionIds[i];
            if (id !== undefined && replaced.includes(id)) {
                this.regionUpdates = [...this.regionUpdates.filter((update) => update.id !== id), { id, doc: region }];
            }
        });
        if (regionIds.length > replaced.length) {
            this.regions.push({ ids: regionIds, regions: change.create.regions, cancelled: replaced });
        }
        return { ...NO_DOCS, walls, lights, tiles, sounds, notes, drawings, tokens, regions: regionIds };
    }

    /** Hand over everything staged, and start afresh. */
    take(): StagedWrite {
        const write: StagedWrite = {
            deletes: { ...this.deletes },
            walls: this.walls,
            lights: this.lights,
            tiles: this.tiles,
            sounds: this.sounds,
            notes: this.notes,
            drawings: this.drawings,
            tokens: this.tokens,
            regions: this.regions,
            tileUpdates: this.tileUpdates,
            wallUpdates: this.wallUpdates,
            tokenUpdates: this.tokenUpdates,
            regionUpdates: this.regionUpdates,
            lightVisibility: this.lightVisibility,
        };
        this.deletes = emptyIds();
        this.walls = [];
        this.lights = [];
        this.tiles = [];
        this.sounds = [];
        this.notes = [];
        this.drawings = [];
        this.tokens = [];
        this.regions = [];
        this.tileUpdates = [];
        this.wallUpdates = [];
        this.tokenUpdates = [];
        this.regionUpdates = [];
        this.lightVisibility = [];
        return write;
    }

    private push<T>(kind: Kind, into: Staged<T>[], docs: readonly T[]): string[] {
        return docs.map((doc) => {
            const id = this.makeId(kind);
            into.push({ id, doc });
            return id;
        });
    }

    /** Remove a document: cancel its create if it is still pending, otherwise queue its delete. */
    private remove(kind: Kind, id: string): void {
        // Deletes run before updates, and updating a deleted document would fail the whole batch.
        if (kind === 'tiles') {
            this.tileUpdates = this.tileUpdates.filter((update) => update.id !== id);
        }
        if (kind === 'walls') {
            this.wallUpdates = this.wallUpdates.filter((update) => update.id !== id);
        }
        if (kind === 'tokens') {
            this.tokenUpdates = this.tokenUpdates.filter((update) => update.id !== id);
        }
        if (kind === 'regions') {
            this.regionUpdates = this.regionUpdates.filter((update) => update.id !== id);
            const group = this.regions.findIndex((staged) => staged.ids.includes(id) && !staged.cancelled.includes(id));
            const found = this.regions[group];
            if (found) {
                const cancelled = [...found.cancelled, id];
                // A group whose every region is cancelled has nothing left to create.
                this.regions =
                    cancelled.length === found.ids.length
                        ? this.regions.filter((_, i) => i !== group)
                        : this.regions.map((staged, i) => (i === group ? { ...staged, cancelled } : staged));
                return;
            }
        } else {
            const pending = this.pendingOf(kind);
            const at = pending.findIndex((staged) => staged.id === id);
            if (at >= 0) {
                pending.splice(at, 1);
                return;
            }
        }
        this.deletes[kind].push(id);
    }

    /**
     * Update a document in place: its pending create (in `pending`) when it has
     * not been written yet, otherwise queue an update of the live one. Returns
     * the updates with this one queued.
     */
    private updateInPlace<T>(pending: Staged<T>[], updates: readonly Staged<T>[], id: string, doc: T): Staged<T>[] {
        const at = pending.findIndex((staged) => staged.id === id);
        if (at >= 0) {
            pending[at] = { id, doc };
            return [...updates];
        }
        return [...updates.filter((update) => update.id !== id), { id, doc }];
    }

    private pendingOf(kind: Exclude<Kind, 'regions'>): Staged<PendingDoc>[] {
        const pending: Record<Exclude<Kind, 'regions'>, Staged<PendingDoc>[]> = {
            walls: this.walls,
            lights: this.lights,
            tiles: this.tiles,
            sounds: this.sounds,
            notes: this.notes,
            drawings: this.drawings,
            tokens: this.tokens,
        };
        return pending[kind];
    }
}

function emptyIds(): Record<Kind, string[]> {
    return { walls: [], lights: [], tiles: [], regions: [], sounds: [], notes: [], drawings: [], tokens: [] };
}
