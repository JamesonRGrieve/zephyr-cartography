// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The {@link DocumentSink} over the live scene: writes the walls, lights,
 * sounds, tiles and regions features generate, one staged transaction at a
 * time, as a single `modifyBatch` — so an edit, an undo or a whole generated
 * map lands entirely or not at all. Foundry owns the documents from there
 * (vision, doors, lighting, tile rendering, teleports); this is only the
 * write boundary.
 */
import type { DocumentSink } from '../canvas/controller';
import type { DocumentKind, StagedWrite } from '../canvas/staged-changes';
import type { HazardKind } from '../stamps/schema';
import type { LightSource, RegionDoc } from '../tools/documents';
import type { BatchOperation, EmbeddedCollection, EmbeddedName, FoundryScene, IdentifiedCreateData, ModifyBatch, RegionCreateData } from './boundary';
import {
    drawingCreateData,
    lightCreateData,
    noteCreateData,
    type RegionContext,
    regionCreateData,
    soundCreateData,
    tileCreateData,
    wallCreateData,
} from './translate';

export interface SinkOptions {
    /** A new document id; every document is created with an id chosen up front. */
    readonly makeId: () => string;
    /** Applies one transaction of operations. */
    readonly modifyBatch: ModifyBatch;
    /** The display name of a generated region. */
    readonly regionName: (region: RegionDoc) => string;
    /** The display name of a generated light. */
    readonly lightName: (source: LightSource) => string;
    /** The display name of a stamp's sound, from the stamp's name. */
    readonly soundName: (stampName: string) => string;
    /** A hazard region's warning, scrolled over a token coming into it. */
    readonly hazardText: (kind: HazardKind) => string;
}

/** Each generated kind's Foundry document name and its collection on a scene. */
const EMBEDDED: readonly [DocumentKind, EmbeddedName, (scene: FoundryScene) => EmbeddedCollection][] = [
    ['walls', 'Wall', (scene) => scene.walls],
    ['lights', 'AmbientLight', (scene) => scene.lights],
    ['sounds', 'AmbientSound', (scene) => scene.sounds],
    ['notes', 'Note', (scene) => scene.notes],
    ['drawings', 'Drawing', (scene) => scene.drawings],
    ['tiles', 'Tile', (scene) => scene.tiles],
    ['regions', 'Region', (scene) => scene.regions],
];

export class FoundryDocumentSink implements DocumentSink {
    constructor(private readonly getScene: () => FoundryScene | null, private readonly options: SinkOptions) {}

    newId(_kind: DocumentKind): string {
        return this.options.makeId();
    }

    async write(write: StagedWrite): Promise<void> {
        const scene = this.getScene();
        const sceneId = scene?.id ?? null;
        // A scene not yet saved has no id, and cannot hold embedded documents.
        if (sceneId === null || scene === null) {
            return;
        }
        // A GM may have deleted a document by hand, and updating a missing one fails the whole batch: a missing tile is
        // left to its feature's next sync, a missing kept-id region is created afresh.
        const tileUpdates = write.tileUpdates.filter(({ id }) => scene.tiles.has(id)).map(({ id, doc }) => ({ _id: id, ...tileCreateData(doc) }));
        const context = regionContext(scene, sceneId, this.options);
        const replaced = write.regionUpdates.flatMap(({ id, doc }) => regionCreateData([doc], [id], context));
        const regionUpdates = replaced.filter((region) => scene.regions.has(region._id)).map(({ behaviors: _behaviors, ...region }) => region);
        const recreated = replaced.filter((region) => !scene.regions.has(region._id));
        const operations = [...deleteOperations(scene, write), ...this.createOperations(scene, sceneId, write, recreated)];
        if (tileUpdates.length > 0) {
            operations.push({ action: 'update', documentName: 'Tile', parent: scene, updates: tileUpdates });
        }
        // A missing wall, likewise, is left to its feature's next sync.
        const wallUpdates = write.wallUpdates.filter(({ id }) => scene.walls.has(id)).map(({ id, doc }) => ({ _id: id, ...wallCreateData(doc, scene.grid) }));
        if (wallUpdates.length > 0) {
            operations.push({ action: 'update', documentName: 'Wall', parent: scene, updates: wallUpdates });
        }
        if (regionUpdates.length > 0) {
            operations.push({ action: 'update', documentName: 'Region', parent: scene, updates: regionUpdates });
        }
        // A region redrawn in place keeps its behaviours, whose settings (a teleport's travel) follow the plan.
        operations.push(...behaviourUpdates(scene, replaced));
        // A light switch shows or hides plain lights; one a GM has deleted is simply gone.
        const lightUpdates = write.lightVisibility.filter(({ id }) => scene.lights.has(id)).map(({ id, hidden }) => ({ _id: id, hidden }));
        if (lightUpdates.length > 0) {
            operations.push({ action: 'update', documentName: 'AmbientLight', parent: scene, updates: lightUpdates });
        }
        if (operations.length > 0) {
            await this.options.modifyBatch(operations);
        }
    }

    private createOperations(scene: FoundryScene, sceneId: string, write: StagedWrite, recreated: readonly RegionCreateData[]): BatchOperation[] {
        const { grid } = scene;
        const regions = [
            ...write.regions.flatMap((group) =>
                regionCreateData(group.regions, group.ids, regionContext(scene, sceneId, this.options)).filter(
                    (region) => !group.cancelled.includes(region._id),
                ),
            ),
            ...recreated,
        ];
        const creates: [EmbeddedName, readonly IdentifiedCreateData[]][] = [
            ['Wall', write.walls.map(({ id, doc }) => ({ _id: id, ...wallCreateData(doc, grid) }))],
            ['AmbientLight', write.lights.map(({ id, doc }) => ({ _id: id, ...lightCreateData(doc, grid, this.options.lightName(doc.source)) }))],
            ['AmbientSound', write.sounds.map(({ id, doc }) => ({ _id: id, ...soundCreateData(doc, grid, this.options.soundName(doc.name)) }))],
            ['Tile', write.tiles.map(({ id, doc }) => ({ _id: id, ...tileCreateData(doc) }))],
            ['Note', write.notes.map(({ id, doc }) => ({ _id: id, ...noteCreateData(doc) }))],
            ['Drawing', write.drawings.map(({ id, doc }) => ({ _id: id, ...drawingCreateData(doc) }))],
            ['Region', regions.map((region) => attachable(scene, region))],
        ];
        return creates
            .filter(([, data]) => data.length > 0)
            .map(([documentName, data]) => ({ action: 'create', documentName, parent: scene, data, keepId: true }));
    }
}

/** Settings updates for the live behaviours of regions redrawn in place, matched to the plan's by type. */
function behaviourUpdates(scene: FoundryScene, regions: readonly RegionCreateData[]): BatchOperation[] {
    return regions.flatMap((region) => {
        const live = scene.regions.get(region._id);
        const updates = region.behaviors.flatMap((planned) => {
            const id = live?.behaviors.contents.find((behaviour) => behaviour.type === planned.type)?.id ?? null;
            return id === null ? [] : [{ _id: id, system: planned.system }];
        });
        return live && updates.length > 0 ? [{ action: 'update' as const, documentName: 'RegionBehavior' as const, parent: live, updates }] : [];
    });
}

/** Where the scene's regions are written: named as the options name them, their tokens' footprints read off the live tokens. */
function regionContext(scene: FoundryScene, sceneId: string, names: Pick<SinkOptions, 'regionName' | 'hazardText'>): RegionContext {
    return {
        nameOf: names.regionName,
        hazardText: names.hazardText,
        scene: sceneId,
        tokenOf: (id) => {
            const token = scene.tokens.get(id);
            return token ? { x: token.x, y: token.y, width: token.width, height: token.height, shape: token.shape } : null;
        },
    };
}

/** A region attached only to a token still on the scene: a zone's token may since have been deleted, and Foundry would refuse the whole batch over it. */
function attachable(scene: FoundryScene, region: RegionCreateData): RegionCreateData {
    const { attachment, ...unattached } = region;
    return attachment === undefined || scene.tokens.has(attachment.token) ? region : unattached;
}

/** Deletes of what is still on the scene: a GM may already have deleted some by hand, and deleting a missing id makes Foundry throw. */
function deleteOperations(scene: FoundryScene, write: StagedWrite): BatchOperation[] {
    const operations: BatchOperation[] = [];
    for (const [kind, documentName, collectionOf] of EMBEDDED) {
        const collection = collectionOf(scene);
        const ids = write.deletes[kind].filter((id) => collection.has(id));
        if (ids.length > 0) {
            operations.push({ action: 'delete', documentName, parent: scene, ids });
        }
    }
    return operations;
}
