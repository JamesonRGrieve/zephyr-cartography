// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Where a scene's features live: a JSON file of their own in the world's
 * data folder, named for the scene, with a small marker in the scene's flags
 * saying which file and which revision of it is current.
 *
 * Kept in the scene flag, every client downloaded every scene's features in
 * the world's data at boot (12 MB over 84 scenes on the live world, wh40k#739).
 * In a file, a client fetches only the viewed scene's, when it views it. A
 * scene saved before this still carries its features in the flag (`FLAG_KEY`);
 * it is read from there until it is next saved, or migrated.
 */
import { parseFeatures, type Feature } from './feature';
import { isRecord } from './guards';

/** Scene-flag key (under the module-id scope) holding the {@link FeaturesMarker}. */
export const FEATURES_FILE_FLAG = 'featuresFile';

/** Which file holds a scene's features, and the revision last written to it. */
export interface FeaturesMarker {
    readonly path: string;
    readonly rev: number;
}

/** A stored marker read defensively: a non-empty path and a finite revision; else null. */
// eslint-disable-next-line no-restricted-syntax -- boundary: a scene flag holds serialised JSON of any shape
export function parseFeaturesMarker(value: unknown): FeaturesMarker | null {
    if (!isRecord(value)) {
        return null;
    }
    const { path, rev } = value;
    if (typeof path !== 'string' || path.length === 0 || typeof rev !== 'number' || !Number.isFinite(rev)) {
        return null;
    }
    return { path, rev };
}

/**
 * The file a scene's features are saved to: always named for the scene
 * itself, never taken from its marker, so a duplicated scene (which copies its
 * original's marker) reads its original's features but saves its own.
 */
export function featuresFileName(sceneId: string): string {
    return `features-${sceneId.replace(/[^A-Za-z0-9_-]/gu, '_')}.json`;
}

/** The URL a marker's revision is fetched from: the revision in the query, so no cache serves an older one. */
export function featuresUrl(marker: FeaturesMarker): string {
    return `${marker.path}?rev=${String(marker.rev)}`;
}

/**
 * The revision a save writes: the clock, but always past every revision this
 * client has seen, so a writer whose clock runs behind still moves it on.
 */
export function nextRev(seen: readonly (number | null)[], now: number): number {
    return Math.max(Math.floor(now), ...seen.map((rev) => (rev === null ? 0 : rev + 1)));
}

/**
 * Whether a fetched revision replaces what a client holds: only a newer one.
 * A client's own save is held before its marker lands, so a redraw that reads
 * the old marker in between never puts the older features back.
 */
export function newerThanHeld(held: number | null, marker: FeaturesMarker): boolean {
    return held === null || marker.rev > held;
}

/** A features file's text read back as features (the malformed dropped), or null when it is not JSON at all. */
export function decodeFeatures(text: string): Feature[] | null {
    try {
        // eslint-disable-next-line no-restricted-syntax -- boundary: a fetched file is untyped JSON, validated by parseFeatures
        const parsed: unknown = JSON.parse(text);
        return Array.isArray(parsed) ? parseFeatures(parsed) : null;
    } catch {
        return null;
    }
}
