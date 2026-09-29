// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The module's public API, at `game.modules.get('zephyrex-cartography').api`:
 * for macros, other modules and the e2e suite. It exposes the same
 * declarative surface the tools use (the controller, scene specs and the
 * floor-plan generator), so anything a GM can draw can be scripted.
 */
import type { CartographyController } from '../canvas/controller';
import type { RealizeReport } from '../canvas/realize';
import { parseMapIntent } from '../compose/intent';
import { DEFAULT_FLOOR_PLAN, generateFloorPlan, type FloorPlanOptions } from '../generate/floor-plan';
import { parseSceneSpec, type SceneSpec, type SpecIssue } from '../generate/spec';
import { MODULE_ID } from '../module-id';
import type { CatalogStamp } from '../stamps/catalog';
import { buildOnScene, type ComposeOutcome, composeOnScene } from './build-spec';
import { terrainImagesLoading } from './pixi-surface';
import { spawnInto, type SpawnResult } from './spawner';

/** Revision of the API shape; additive changes keep it. */
const API_VERSION = 1;

type BuildOutcome = { readonly ok: true; readonly report: RealizeReport } | { readonly ok: false; readonly issues: readonly SpecIssue[] };

interface CartographyApi {
    readonly version: number;
    /** The controller of the viewed scene, or null before its canvas is ready. */
    readonly controller: () => CartographyController | null;
    /** Validate a scene spec and build it on the viewed scene, from its top-left corner. */
    // eslint-disable-next-line no-restricted-syntax -- boundary: a macro or module passes any value; it is validated as a scene spec
    readonly buildSpec: (spec: unknown) => Promise<BuildOutcome>;
    /** A floor-plan scene spec; options not given take the generator's defaults. */
    readonly generateFloorPlan: (options?: Partial<FloorPlanOptions>) => SceneSpec;
    /**
     * Validate a map intent, compose it from the loaded packs' stamps, and
     * build it on the viewed scene as one undo step; what the composer could
     * not do comes back as problems.
     */
    // eslint-disable-next-line no-restricted-syntax -- boundary: a macro or module passes any value; it is validated as a map intent
    readonly compose: (intent: unknown) => Promise<ComposeOutcome>;
    /**
     * Spawn an area's tokens into its region (painted ground, a room or a
     * zone, by feature id). Foundry's own errors (no room left inside, no
     * permission) are thrown as they are.
     */
    readonly spawn: (featureId: string) => Promise<SpawnResult>;
    /** How many terrain images are still loading; the drawn map is complete once none are. */
    readonly terrainImagesLoading: () => number;
}

declare global {
    interface ModuleConfig {
        'zephyrex-cartography': { api: CartographyApi };
    }
    /** This module's own code only runs while it is active, so `game.modules.get` always finds it. */
    interface RequiredModules {
        'zephyrex-cartography': true;
    }
}

/**
 * `stamps` lists every stamp the loaded packs offer, for composing, and
 * `packsSettled` resolves once they have loaded and the draw layer has been
 * rebuilt for them: building waits for it, and builds with the controller it
 * leaves (one torn down mid-build would leave its features undrawn).
 */
export function registerApi(controller: () => CartographyController | null, stamps: () => readonly CatalogStamp[], packsSettled: () => Promise<void>): void {
    const api: CartographyApi = {
        version: API_VERSION,
        controller,
        buildSpec: async (spec) => {
            const parsed = parseSceneSpec(spec);
            if (!parsed.ok) {
                return { ok: false, issues: parsed.issues };
            }
            await packsSettled();
            const active = controller();
            if (!active) {
                return { ok: false, issues: [{ path: '', message: 'no scene is being viewed' }] };
            }
            return { ok: true, report: await buildOnScene(active, parsed.spec) };
        },
        generateFloorPlan: (options = {}) => generateFloorPlan({ ...DEFAULT_FLOOR_PLAN, ...options }),
        compose: async (intent) => {
            const parsed = parseMapIntent(intent);
            if (!parsed.ok) {
                return { ok: false, issues: parsed.issues };
            }
            await packsSettled();
            const active = controller();
            if (!active) {
                return { ok: false, issues: [{ path: '', message: 'no scene is being viewed' }] };
            }
            return composeOnScene(active, parsed.intent, stamps());
        },
        spawn: async (featureId) => {
            const active = controller();
            const settings = active?.areaSettings(featureId) ?? null;
            const regionId = active?.areaRegionId(featureId) ?? null;
            return settings === null || regionId === null ? { spawned: 0, missing: [] } : spawnInto(regionId, settings.spawn);
        },
        terrainImagesLoading,
    };
    Hooks.once('init', () => {
        const cartography = game.modules?.get(MODULE_ID);
        if (cartography !== undefined) {
            cartography.api = api;
        }
    });
}
