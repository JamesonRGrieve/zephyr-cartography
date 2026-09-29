// SPDX-License-Identifier: AGPL-3.0-or-later
/** Persists features (paths, regions, strokes, rooms) on the active scene via its flags. */
import type { SceneStore } from '../canvas/controller';
import { MODULE_ID } from '../module-id';
import { parseFeatures, type Feature } from '../tools/feature';
import { FLAG_KEY } from '../tools/path';
import type { FoundryScene } from './boundary';

declare global {
    interface FlagConfig {
        /** The scene's features, as saved: read back through `parseFeatures`, which drops whatever is malformed. */
        Scene: { 'zephyrex-cartography': { features: readonly Feature[] } };
    }
}

export class FoundrySceneStore implements SceneStore {
    constructor(private readonly getScene: () => FoundryScene | null) {}

    load(): Feature[] {
        const scene = this.getScene();
        return scene ? parseFeatures(scene.getFlag(MODULE_ID, FLAG_KEY)) : [];
    }

    async save(features: readonly Feature[]): Promise<void> {
        const scene = this.getScene();
        if (scene) {
            await scene.setFlag(MODULE_ID, FLAG_KEY, features);
        }
    }
}
