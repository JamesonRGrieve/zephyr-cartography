// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stamp pack discovery. Any active module that advertises a manifest via
 * `flags["zephyr-cartography"].pack` is a pack. Its manifest is fetched from
 * the module's served path and handed, unvalidated, to the pure loader.
 */
import { MODULE_ID } from '../module-id';
import type { PackSource } from '../stamps/catalog';
import { isRecord } from '../tools/guards';

interface PackFetchFailure {
    readonly moduleId: string;
    readonly message: string;
}

export interface FetchedPacks {
    readonly sources: readonly PackSource[];
    readonly failures: readonly PackFetchFailure[];
}

interface PackModule {
    readonly id: string;
    readonly manifestPath: string;
}

// eslint-disable-next-line no-restricted-syntax -- boundary: a module's flags are arbitrary manifest JSON; narrows to the declared pack path
function packPath(flags: unknown): string | null {
    const scoped = isRecord(flags) ? flags[MODULE_ID] : null;
    const pack = isRecord(scoped) ? scoped['pack'] : null;
    return typeof pack === 'string' && pack.length > 0 ? pack : null;
}

function packModules(): PackModule[] {
    const found: PackModule[] = [];
    for (const candidate of game.modules ?? []) {
        const manifestPath = candidate.active ? packPath(candidate.flags) : null;
        if (manifestPath !== null) {
            found.push({ id: candidate.id, manifestPath });
        }
    }
    return found;
}

async function fetchManifest(pack: PackModule): Promise<PackSource | PackFetchFailure> {
    try {
        const response = await fetch(`modules/${pack.id}/${pack.manifestPath}`);
        if (!response.ok) {
            return { moduleId: pack.id, message: `HTTP ${response.status}` };
        }
        return { moduleId: pack.id, manifest: await response.json() };
    } catch (error) {
        return { moduleId: pack.id, message: error instanceof Error ? error.message : String(error) };
    }
}

/** Fetch every active pack's manifest. Fetch failures are reported, not thrown. */
export async function fetchPacks(): Promise<FetchedPacks> {
    const results = await Promise.all(packModules().map(fetchManifest));
    const sources: PackSource[] = [];
    const failures: PackFetchFailure[] = [];
    for (const result of results) {
        if ('manifest' in result) {
            sources.push(result);
        } else {
            failures.push(result);
        }
    }
    return { sources, failures };
}
