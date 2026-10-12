// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { BLOCKS_ALL, type RegionDoc, type TileDoc, type TokenDoc, type WallDoc } from '../tools/documents';
import { NO_DOCS } from '../tools/generated-docs';
import { NO_PLAN } from '../tools/plan';
import { type DocumentChange, type DocumentKind, StagedChanges } from './staged-changes';

const WALL: WallDoc = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, door: 'none', doorState: 'closed', blocks: BLOCKS_ALL, level: null };
const TOKEN: TokenDoc = { x: 50, y: 50, elevation: 0, level: null, actor: 'Actor.a', name: null, hidden: false, disposition: null, size: null };
const TILE: TileDoc = { name: 'Crate', src: 'crate.webp', x: 0, y: 0, width: 100, height: 100, rotation: 0, elevation: 0, level: null, featureId: 'p1' };
const MOVED: TileDoc = { ...TILE, x: 200 };

function region(id: string | null): RegionDoc {
    return {
        id,
        label: { kind: 'terrain', biome: 'forest' },
        polygon: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
        ],
        bottom: null,
        top: null,
        level: null,
        spans: [],
        behaviour: null,
    };
}

/** Ids `<kind>-<n>`, counted per kind. */
function staging(): StagedChanges {
    const counters = new Map<DocumentKind, number>();
    return new StagedChanges((kind) => {
        const n = counters.get(kind) ?? 0;
        counters.set(kind, n + 1);
        return `${kind}-${n}`;
    });
}

function change(partial: Partial<DocumentChange>): DocumentChange {
    return { remove: NO_DOCS, create: NO_PLAN, updateTiles: [], updateWalls: [], updateTokens: [], ...partial };
}

describe('StagedChanges', () => {
    it('starts empty, and is empty again once taken', () => {
        const staged = staging();
        expect(staged.empty).toBe(true);
        staged.stage(change({ create: { ...NO_PLAN, walls: [WALL] } }));
        expect(staged.empty).toBe(false);
        staged.take();
        expect(staged.empty).toBe(true);
        expect(staged.take()).toMatchObject({ walls: [], tiles: [], regions: [], tileUpdates: [] });
    });

    it('assigns every created document its id up front, keeping a region id it is given', () => {
        const staged = staging();
        const ids = staged.stage(change({ create: { ...NO_PLAN, walls: [WALL, WALL], tiles: [TILE], regions: [region(null), region('fixed')] } }));
        expect(ids).toEqual({ ...NO_DOCS, walls: ['walls-0', 'walls-1'], tiles: ['tiles-0'], regions: ['regions-0', 'fixed'] });
        const write = staged.take();
        expect(write.walls).toEqual([
            { id: 'walls-0', doc: WALL },
            { id: 'walls-1', doc: WALL },
        ]);
        expect(write.regions).toEqual([{ ids: ['regions-0', 'fixed'], regions: [region(null), region('fixed')], cancelled: [] }]);
    });

    it('queues deletes of documents already written', () => {
        const staged = staging();
        staged.stage(change({ remove: { ...NO_DOCS, walls: ['w9'], regions: ['r9'], sounds: ['s9'] } }));
        expect(staged.take().deletes).toEqual({ ...NO_DOCS, walls: ['w9'], regions: ['r9'], sounds: ['s9'] });
    });

    it('cancels the create of a document removed in the same transaction instead of deleting it', () => {
        const staged = staging();
        const first = staged.stage(change({ create: { ...NO_PLAN, walls: [WALL], tiles: [TILE] } }));
        staged.stage(change({ remove: first, create: { ...NO_PLAN, walls: [WALL] } }));
        const write = staged.take();
        expect(write.walls.map((s) => s.id)).toEqual(['walls-1']);
        expect(write.tiles).toEqual([]);
        expect(write.deletes).toEqual(NO_DOCS);
    });

    it('cancels a pending region in place, so its group keeps positions, and drops a fully cancelled group', () => {
        const staged = staging();
        const pair = staged.stage(change({ create: { ...NO_PLAN, regions: [region(null), region(null)] } }));
        const lone = staged.stage(change({ create: { ...NO_PLAN, regions: [region(null)] } }));
        staged.stage(change({ remove: { ...NO_DOCS, regions: [pair.regions[0] ?? '', ...lone.regions] } }));
        const write = staged.take();
        expect(write.regions).toEqual([{ ids: ['regions-0', 'regions-1'], regions: [region(null), region(null)], cancelled: ['regions-0'] }]);
        expect(write.deletes.regions).toEqual([]);
    });

    it('redraws a written region replaced under its own id in place, since Foundry rejects deleting and recreating one id', () => {
        const staged = staging();
        const kept = region('kept');
        const ids = staged.stage(change({ remove: { ...NO_DOCS, regions: ['kept', 'old'] }, create: { ...NO_PLAN, regions: [kept, region(null)] } }));
        expect(ids.regions).toEqual(['kept', 'regions-0']);
        const write = staged.take();
        expect(write.deletes.regions).toEqual(['old']);
        expect(write.regionUpdates).toEqual([{ id: 'kept', doc: kept }]);
        expect(write.regions).toEqual([{ ids: ['kept', 'regions-0'], regions: [kept, region(null)], cancelled: ['kept'] }]);
    });

    it('stages no group for a change whose only region is redrawn in place, and deletes it outright if removed after', () => {
        const staged = staging();
        staged.stage(change({ remove: { ...NO_DOCS, regions: ['kept'] }, create: { ...NO_PLAN, regions: [region('kept')] } }));
        staged.stage(change({ remove: { ...NO_DOCS, regions: ['kept'] }, create: { ...NO_PLAN, regions: [region('kept')] } }));
        expect(staged.take()).toMatchObject({ regions: [], regionUpdates: [{ id: 'kept' }], deletes: NO_DOCS });
        staged.stage(change({ remove: { ...NO_DOCS, regions: ['kept'] }, create: { ...NO_PLAN, regions: [region('kept')] } }));
        staged.stage(change({ remove: { ...NO_DOCS, regions: ['kept'] } }));
        expect(staged.take()).toMatchObject({ regions: [], regionUpdates: [], deletes: { ...NO_DOCS, regions: ['kept'] } });
    });

    it('updates a pending tile create in place, and a written tile by update', () => {
        const staged = staging();
        const created = staged.stage(change({ create: { ...NO_PLAN, tiles: [TILE] } }));
        const pendingId = created.tiles[0] ?? '';
        staged.stage(change({ updateTiles: [{ id: pendingId, tile: MOVED }] }));
        staged.stage(change({ updateTiles: [{ id: 'live', tile: TILE }] }));
        staged.stage(change({ updateTiles: [{ id: 'live', tile: MOVED }] }));
        const write = staged.take();
        expect(write.tiles).toEqual([{ id: pendingId, doc: MOVED }]);
        expect(write.tileUpdates).toEqual([{ id: 'live', doc: MOVED }]);
    });

    it('shows or hides a plain light, the last request for it winning', () => {
        const staged = staging();
        staged.setLightVisibility('L1', true);
        expect(staged.empty).toBe(false);
        staged.setLightVisibility('L2', false);
        staged.setLightVisibility('L1', false);
        expect(staged.take().lightVisibility).toEqual([
            { id: 'L2', hidden: false },
            { id: 'L1', hidden: false },
        ]);
        expect(staged.empty).toBe(true);
    });

    it('deletes a written tile without its pending update, which would fail the batch after the delete', () => {
        const staged = staging();
        staged.stage(change({ updateTiles: [{ id: 'live', tile: MOVED }] }));
        staged.stage(change({ remove: { ...NO_DOCS, tiles: ['live'] } }));
        const write = staged.take();
        expect(write.tileUpdates).toEqual([]);
        expect(write.deletes.tiles).toEqual(['live']);
    });

    it('updates walls in place like tiles, and drops a wall update when that wall is deleted', () => {
        const staged = staging();
        const created = staged.stage(change({ create: { ...NO_PLAN, walls: [WALL] } }));
        const pendingId = created.walls[0] ?? '';
        const door: WallDoc = { ...WALL, door: 'door' };
        staged.stage(change({ updateWalls: [{ id: pendingId, wall: door }] }));
        staged.stage(change({ updateWalls: [{ id: 'live', wall: door }] }));
        expect(staged.empty).toBe(false);
        const write = staged.take();
        expect(write.walls).toEqual([{ id: pendingId, doc: door }]);
        expect(write.wallUpdates).toEqual([{ id: 'live', doc: door }]);
        staged.stage(change({ updateWalls: [{ id: 'live', wall: door }] }));
        staged.stage(change({ remove: { ...NO_DOCS, walls: ['live'] } }));
        expect(staged.take()).toMatchObject({ wallUpdates: [], deletes: { ...NO_DOCS, walls: ['live'] } });
    });

    it('updates tokens in place like walls, so a token in play is never deleted and made again', () => {
        const staged = staging();
        const created = staged.stage(change({ create: { ...NO_PLAN, tokens: [TOKEN] } }));
        const pendingId = created.tokens[0] ?? '';
        const moved: TokenDoc = { ...TOKEN, x: 150 };
        staged.stage(change({ updateTokens: [{ id: pendingId, token: moved }] }));
        staged.stage(change({ updateTokens: [{ id: 'live', token: moved }] }));
        const write = staged.take();
        expect(write.tokens).toEqual([{ id: pendingId, doc: moved }]);
        expect(write.tokenUpdates).toEqual([{ id: 'live', doc: moved }]);
        staged.stage(change({ updateTokens: [{ id: 'live', token: moved }] }));
        staged.stage(change({ remove: { ...NO_DOCS, tokens: ['live'] } }));
        expect(staged.take()).toMatchObject({ tokenUpdates: [], deletes: { ...NO_DOCS, tokens: ['live'] } });
    });
});
