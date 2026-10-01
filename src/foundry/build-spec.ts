// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Build a scene spec on the viewed scene: its (0, 0) is the scene's top-left
 * corner, inside the canvas padding, and grid units are the scene's grid. The
 * one place the map builder window and the module API realise specs.
 */
import type { CartographyController } from '../canvas/controller';
import { realizeSpec, type RealizeReport } from '../canvas/realize';
import { adviseAndCompose, type Advised, type Ask } from '../compose/assist';
import { composeMap } from '../compose/compose';
import type { MapIntent } from '../compose/intent';
import type { ComposeProblem } from '../compose/problems';
import { roleIndex } from '../compose/roles';
import { parseSceneSpec, type SceneSpec, type SpecIssue } from '../generate/spec';
import type { CatalogStamp } from '../stamps/catalog';

/**
 * On a scene of several floors, draw and edit the viewed floor's map, not
 * every floor's at once (a scene of one floor draws everything, as before).
 */
export function followViewedLevel(controller: CartographyController): void {
    if (controller.levels.length > 1 && canvas?.level) {
        controller.setActiveLevel(canvas.level.id);
    }
}

export async function buildOnScene(controller: CartographyController, spec: SceneSpec): Promise<RealizeReport> {
    const sceneTopLeft = { x: canvas?.dimensions?.sceneX ?? 0, y: canvas?.dimensions?.sceneY ?? 0 };
    const gridSize = controller.grid?.size ?? canvas?.dimensions?.size ?? 1;
    const report = await realizeSpec(controller, spec, { origin: sceneTopLeft, gridSize });
    // A spec that made the scene's floors leaves the map on the one in view.
    followViewedLevel(controller);
    return report;
}

/** What composing did: what it built and what it could not do (and what the model did, when it was asked), or why its output was not a valid spec. */
export type ComposeOutcome =
    | { readonly ok: true; readonly report: RealizeReport; readonly problems: readonly ComposeProblem[]; readonly advised: Advised | null }
    | { readonly ok: false; readonly issues: readonly SpecIssue[] };

/**
 * Compose `intent` from the loaded packs' stamps and build it on the viewed
 * scene, as one undo step: by the algorithm alone, or, given a model to
 * `ask`, with its help choosing stamps and critiquing the layout.
 */
export async function composeOnScene(
    controller: CartographyController,
    intent: MapIntent,
    stamps: readonly CatalogStamp[],
    ask: Ask | null = null,
): Promise<ComposeOutcome> {
    const index = roleIndex(stamps, intent.settings, intent.scale);
    const info = new Map(stamps.map((s) => [s.key, { name: s.name, tags: s.tags }]));
    const advised = ask ? await adviseAndCompose(intent, index, info, ask) : null;
    const composed = advised ? advised.composition : composeMap(intent, index);
    const parsed = parseSceneSpec(composed.spec);
    if (!parsed.ok) {
        return { ok: false, issues: parsed.issues };
    }
    return { ok: true, report: await buildOnScene(controller, parsed.spec), problems: composed.problems, advised };
}
