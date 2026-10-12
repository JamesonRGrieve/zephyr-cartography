// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The record of which native documents a feature generated: every generated
 * document's id, by document type, so that feature can re-sync or delete
 * exactly its own documents (the lifecycle rule). Kept apart from the
 * document specs, which the features themselves shape.
 */
import { isRecord, stringArray } from './guards';

/** The ids of every native document one feature generated, by document type. */
export interface GeneratedDocs {
    readonly walls: readonly string[];
    readonly lights: readonly string[];
    readonly tiles: readonly string[];
    readonly regions: readonly string[];
    readonly sounds: readonly string[];
    readonly notes: readonly string[];
    readonly drawings: readonly string[];
    readonly tokens: readonly string[];
}

export const NO_DOCS: GeneratedDocs = { walls: [], lights: [], tiles: [], regions: [], sounds: [], notes: [], drawings: [], tokens: [] };

/** Every generated id, whatever its document type. */
export function allDocIds(docs: GeneratedDocs): string[] {
    return [...docs.walls, ...docs.lights, ...docs.tiles, ...docs.regions, ...docs.sounds, ...docs.notes, ...docs.drawings, ...docs.tokens];
}

export function hasDocs(docs: GeneratedDocs): boolean {
    return allDocIds(docs).length > 0;
}

// eslint-disable-next-line no-restricted-syntax -- boundary: parses the persisted generated-docs record of a scene-flag feature entry
export function parseGeneratedDocs(v: unknown): GeneratedDocs {
    if (!isRecord(v)) {
        return NO_DOCS;
    }
    return {
        walls: stringArray(v['walls']),
        lights: stringArray(v['lights']),
        tiles: stringArray(v['tiles']),
        regions: stringArray(v['regions']),
        // Recorded since stamps emit sounds, pins make notes, labels drawings and tokens tokens; an older record has none.
        sounds: stringArray(v['sounds']),
        notes: stringArray(v['notes']),
        drawings: stringArray(v['drawings']),
        tokens: stringArray(v['tokens']),
    };
}
