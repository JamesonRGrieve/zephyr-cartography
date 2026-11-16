// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Persists features (paths, regions, strokes, rooms, stamps…) for each scene in a file of its own in the world's data
 * folder, with a marker in the scene's flags naming the file and its revision (`tools/features-file.ts`). A client
 * fetches the viewed scene's file before the draw layer is built (`prefetchFeatures`) and holds it, so `load` stays
 * synchronous; saving holds the new features at once and writes the file, then the marker, which tells every other
 * client to fetch it. A scene saved before files (features in its flag) is read from the flag until it is next saved,
 * or until the active GM migrates it (`migrateFeatureFlags`).
 */
import type { SceneStore } from '../canvas/controller';
import { I18N } from '../i18n';
import { MODULE_ID } from '../module-id';
import { parseFeatures, type Feature } from '../tools/feature';
import {
    decodeFeatures,
    FEATURES_FILE_FLAG,
    featuresFileName,
    type FeaturesMarker,
    featuresUrl,
    newerThanHeld,
    nextRev,
    parseFeaturesMarker,
} from '../tools/features-file';
import { FLAG_KEY } from '../tools/path';
import type { Sun } from '../tools/sun';
import type { FoundryScene } from './boundary';
import { format } from './localize';
import { worldScene } from './scene-bridge';
import { canWriteWorldFiles, writeWorldFile } from './world-files';

declare global {
    interface FlagConfig {
        /**
         * Where the scene's features are saved (`featuresFile`), or, saved before that, the features themselves
         * (`features`), read back through `parseFeatures`, which drops whatever is malformed; and the sun its drop
         * shadows fall from, read back through `parseSun`.
         */
        Scene: { 'zephyr-cartography': { features?: readonly Feature[]; featuresFile?: FeaturesMarker; sun?: Sun } };
    }
}

/** What this client holds of a scene's features: the revision of its file they came from (null: from the flag). */
interface Held {
    readonly rev: number | null;
    readonly features: readonly Feature[];
    /** The file that could not be read, while it cannot: the scene is shown but never saved over. */
    readonly unreadable: string | null;
}

const held = new Map<string, Held>();
const fetching = new Map<string, Promise<void>>();

function markerOf(scene: FoundryScene): FeaturesMarker | null {
    return parseFeaturesMarker(scene.getFlag(MODULE_ID, FEATURES_FILE_FLAG));
}

/** The features a scene still keeps in its flag, or null where it keeps none there. */
function legacyOf(scene: FoundryScene): Feature[] | null {
    const raw = scene.getFlag(MODULE_ID, FLAG_KEY);
    return raw === undefined || raw === null ? null : parseFeatures(raw);
}

async function readFile(marker: FeaturesMarker): Promise<Feature[] | null> {
    try {
        const response = await fetch(featuresUrl(marker), { cache: 'no-store' });
        return response.ok ? decodeFeatures(await response.text()) : null;
    } catch {
        return null;
    }
}

async function fetchInto(scene: FoundryScene, id: string): Promise<void> {
    const marker = markerOf(scene);
    const current = held.get(id);
    if (marker === null) {
        // Saved to the flag alone, unless this client's own first save to a file is still landing.
        if (current?.rev === null || current === undefined) {
            held.set(id, { rev: null, features: legacyOf(scene) ?? [], unreadable: null });
        }
        return;
    }
    if (current?.unreadable === null && !newerThanHeld(current.rev, marker)) {
        return;
    }
    const features = await readFile(marker);
    // A save of this client's own may have moved on while the file was on its way.
    const now = held.get(id);
    if (now?.unreadable === null && !newerThanHeld(now.rev, marker)) {
        return;
    }
    held.set(id, features === null ? { rev: null, features: legacyOf(scene) ?? [], unreadable: marker.path } : { rev: marker.rev, features, unreadable: null });
}

/** Fetch a scene's features, if its file has moved on from what this client holds, before they are loaded. */
export async function prefetchFeatures(scene: FoundryScene | null): Promise<void> {
    const id = scene?.id ?? null;
    if (scene === null || id === null) {
        return;
    }
    const running = fetching.get(id);
    if (running) {
        await running;
    }
    const task = fetchInto(scene, id).finally(() => {
        fetching.delete(id);
    });
    fetching.set(id, task);
    await task;
}

/** Write a scene's features to its own file, then point its marker at it and clear any it kept in its flag. */
async function writeFeatures(scene: FoundryScene, id: string, features: readonly Feature[], seen: readonly (number | null)[]): Promise<void> {
    const rev = nextRev(seen, Date.now());
    const path = await writeWorldFile(featuresFileName(id), JSON.stringify(features), 'application/json');
    held.set(id, { rev, features: [...features], unreadable: null });
    await scene.setFlag(MODULE_ID, FEATURES_FILE_FLAG, { path, rev });
    if (scene.getFlag(MODULE_ID, FLAG_KEY) !== undefined) {
        await scene.unsetFlag(MODULE_ID, FLAG_KEY);
    }
}

export class FoundrySceneStore implements SceneStore {
    constructor(private readonly getScene: () => FoundryScene | null) {}

    load(): Feature[] {
        const scene = this.getScene();
        const id = scene?.id ?? null;
        if (scene === null || id === null) {
            return [];
        }
        const mine = held.get(id);
        return mine ? [...mine.features] : legacyOf(scene) ?? [];
    }

    async save(features: readonly Feature[]): Promise<void> {
        const scene = this.getScene();
        const id = scene?.id ?? null;
        if (scene === null || id === null) {
            return;
        }
        const marker = markerOf(scene);
        const mine = held.get(id);
        const unread = mine?.unreadable ?? (marker !== null && (mine?.rev ?? null) === null ? marker.path : null);
        if (unread !== null || (marker !== null && !canWriteWorldFiles())) {
            // Saving now would replace the file's features with what this client failed to read.
            const path = unread ?? marker?.path ?? '';
            ui.notifications?.error(format(I18N.notifications.featuresUnreadable, { scene: scene.name, path }));
            throw new Error(`zephyr-cartography: the features of scene ${id} could not be read from ${path}`);
        }
        if (!canWriteWorldFiles()) {
            // A user who may not write files keeps a scene that has none in its flag, as before files.
            held.set(id, { rev: null, features: [...features], unreadable: null });
            await scene.setFlag(MODULE_ID, FLAG_KEY, features);
            return;
        }
        await writeFeatures(scene, id, features, [mine?.rev ?? null, marker?.rev ?? null]);
    }
}

/**
 * Move every world scene that still keeps its features in its flag into a file, as saved, so no client downloads
 * them with the world. Run by the active GM, who may write files; a scene already moved is left alone. Returns how
 * many scenes moved.
 */
export async function migrateFeatureFlags(): Promise<number> {
    if (game.users?.activeGM?.isSelf !== true || !canWriteWorldFiles()) {
        return 0;
    }
    const scenes = (game.scenes?.contents ?? []).map((doc) => worldScene(doc.id)).filter((s): s is FoundryScene => s !== null);
    let moved = 0;
    for (const scene of scenes) {
        const id = scene.id;
        const raw = scene.getFlag(MODULE_ID, FLAG_KEY);
        if (id === null || raw === undefined || raw === null) {
            continue;
        }
        const marker = markerOf(scene);
        // eslint-disable-next-line no-await-in-loop -- one scene at a time: each is a file upload and two scene updates, and the world's scenes are many
        await (marker === null ? writeFeatures(scene, id, parseFeatures(raw), [held.get(id)?.rev ?? null]) : scene.unsetFlag(MODULE_ID, FLAG_KEY));
        moved += 1;
    }
    return moved;
}
