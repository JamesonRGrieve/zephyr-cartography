// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Build a scene spec on the viewed scene: its (0, 0) is the scene's top-left
 * corner, inside the canvas padding, and grid units are the scene's grid. The
 * one place the map builder window and the module API realise specs.
 */
import type { CartographyController } from '../canvas/controller';
import { realizeSpec, type RealizeReport } from '../canvas/realize';
import { composeMap } from '../compose/compose';
import type { MapIntent } from '../compose/intent';
import type { ComposeProblem } from '../compose/problems';
import { roleIndex } from '../compose/roles';
import { parseSceneSpec, type SceneSpec, type SpecIssue } from '../generate/spec';
import type { CatalogStamp } from '../stamps/catalog';

export async function buildOnScene(controller: CartographyController, spec: SceneSpec): Promise<RealizeReport> {
    const sceneTopLeft = { x: canvas?.dimensions?.sceneX ?? 0, y: canvas?.dimensions?.sceneY ?? 0 };
    const gridSize = controller.grid?.size ?? canvas?.dimensions?.size ?? 1;
    return realizeSpec(controller, spec, { origin: sceneTopLeft, gridSize });
}

/** What composing did: what it built and what it could not do, or why its output was not a valid spec. */
export type ComposeOutcome =
    | { readonly ok: true; readonly report: RealizeReport; readonly problems: readonly ComposeProblem[] }
    | { readonly ok: false; readonly issues: readonly SpecIssue[] };

/** Compose `intent` from the loaded packs' stamps and build it on the viewed scene, as one undo step. */
export async function composeOnScene(controller: CartographyController, intent: MapIntent, stamps: readonly CatalogStamp[]): Promise<ComposeOutcome> {
    const composed = composeMap(intent, roleIndex(stamps, intent.settings));
    const parsed = parseSceneSpec(composed.spec);
    if (!parsed.ok) {
        return { ok: false, issues: parsed.issues };
    }
    return { ok: true, report: await buildOnScene(controller, parsed.spec), problems: composed.problems };
}
