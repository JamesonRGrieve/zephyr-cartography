// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * {@link WorldScenes} over the world's scenes, for submaps: names and frames
 * of scenes to link, new empty interiors gridded like the current scene, and
 * the exit regions that live in another scene.
 */
import type { WorldScenes } from '../canvas/controller';
import type { HazardKind } from '../stamps/schema';
import type { RegionDoc } from '../tools/documents';
import { activeScene, worldScene } from './scene-bridge';
import { behaviourData, regionCreateData, sceneSettingsData } from './translate';

/** Size of a new interior scene, in grid squares per side; the GM resizes it to suit. */
const INTERIOR_SQUARES = 20;

/** Grid size (px) and distance for an interior when there is no current scene to copy. */
const FALLBACK_GRID = { size: 100, distance: 1 } as const;

export interface WorldScenesOptions {
    readonly regionName: (region: RegionDoc) => string;
    /** A hazard region's warning, scrolled over a token coming into it. */
    readonly hazardText: (kind: HazardKind) => string;
}

export function createWorldScenes(options: WorldScenesOptions): WorldScenes {
    return {
        current: () => {
            const scene = activeScene();
            return scene?.id != null && scene.id !== '' ? { id: scene.id, name: scene.name } : null;
        },
        name: (sceneId) => worldScene(sceneId)?.name ?? null,
        frame: (sceneId) => {
            const d = worldScene(sceneId)?.dimensions;
            return d ? { x: d.sceneX, y: d.sceneY, width: d.sceneWidth, height: d.sceneHeight, gridSize: d.size } : null;
        },
        createScene: async (sceneName) => {
            const grid = activeScene()?.grid ?? FALLBACK_GRID;
            const created = await Scene.create({
                name: sceneName,
                width: grid.size * INTERIOR_SQUARES,
                height: grid.size * INTERIOR_SQUARES,
                grid: { size: grid.size, distance: grid.distance },
            });
            return created?.id ?? null;
        },
        createRegion: async (sceneId, region) => {
            const scene = worldScene(sceneId);
            if (scene?.id == null || scene.id === '' || region.id === null) {
                return false;
            }
            // An interior exit is attached to no token.
            const [data] = regionCreateData([region], [region.id], {
                nameOf: options.regionName,
                hazardText: options.hazardText,
                scene: scene.id,
                tokenOf: () => null,
            });
            if (!data) {
                return false;
            }
            // A region teleported into must sit on one Level; on a multi-level scene, use its default one.
            const initial = scene.initialLevel?.id ?? null;
            const onLevel = scene.levels.size > 1 && initial !== null ? { ...data, levels: [initial] } : data;
            await scene.createEmbeddedDocuments('Region', [onLevel], { keepId: true });
            return true;
        },
        updateTeleport: async (sceneId, region) => {
            const live = region.id === null ? undefined : worldScene(sceneId)?.regions.get(region.id);
            const [planned] = behaviourData(region.behaviour, options.hazardText);
            const behaviour = planned && live?.behaviors.contents.find((b) => b.type === planned.type);
            if (planned && behaviour) {
                await behaviour.update({ system: planned.system });
            }
        },
        updateSettings: async (settings) => {
            await activeScene()?.update(sceneSettingsData(settings));
        },
        deleteRegion: async (sceneId, regionId) => {
            const scene = worldScene(sceneId);
            if (scene?.regions.has(regionId) === true) {
                await scene.deleteEmbeddedDocuments('Region', [regionId]);
            }
        },
    };
}
