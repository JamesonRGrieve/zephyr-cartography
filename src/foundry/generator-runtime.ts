// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The map builder window. It composes a whole map from a map intent (a
 * preset the GM edits), generates a floor plan, or takes any scene spec as
 * JSON, and realises it on the current scene from the scene's top-left
 * corner. A generated plan's spec is put in the spec box, so the GM can edit
 * it and build it again. Floor-plan rooms get the materials last chosen in
 * the materials panel.
 */
import type { CartographyController } from '../canvas/controller';
import type { RealizeReport } from '../canvas/realize';
import type { Advised } from '../compose/assist';
import { parseMapIntent } from '../compose/intent';
import { isMapPreset, MAP_PRESETS, type MapPreset, presetText, withSeed } from '../compose/presets';
import type { ComposeProblem } from '../compose/problems';
import { generateFloorPlan } from '../generate/floor-plan';
import { DEFAULT_GENERATOR_FORM, floorPlanOptions, newSeed, withGeneratorField, type GeneratorForm } from '../generate/form';
import { formatSpecIssue, parseSceneSpecJson, type SceneSpec } from '../generate/spec';
import { I18N } from '../i18n';
import type { CatalogStamp } from '../stamps/catalog';
import type { RoomMaterials } from '../tools/room';
import { type ComposeMode, renderGeneratorPanel, type GeneratorLabels, type GeneratorPanel } from '../ui/generator-view';
import { advisorAvailable, askAdvisor } from './advisor';
import { buildOnScene, composeOnScene } from './build-spec';
import { format, localize } from './localize';
import { createViewWindow } from './view-window';

const PANEL_WIDTH = 520;

/** Spaces per indent level of a generated spec shown for editing. */
const SPEC_INDENT = 2;

function panelLabels(): GeneratorLabels {
    const g = I18N.generator;
    return {
        compose: localize(g.compose),
        preset: localize(g.preset),
        intent: localize(g.intent),
        composeMap: localize(g.composeMap),
        reseedMap: localize(g.reseedMap),
        mode: localize(g.mode),
        algorithmic: localize(g.algorithmic),
        assisted: localize(g.assisted),
        assistUnavailable: localize(g.assistUnavailable),
        floorPlan: localize(g.floorPlan),
        seed: localize(g.seed),
        newSeed: localize(g.newSeed),
        width: localize(g.width),
        height: localize(g.height),
        minRoom: localize(g.minRoom),
        maxRoom: localize(g.maxRoom),
        entrance: localize(g.entrance),
        generate: localize(g.generate),
        spec: localize(g.spec),
        buildSpec: localize(g.buildSpec),
    };
}

/** Most of the model's fixes listed in the status; the rest are counted. */
const FIXES_SHOWN = 8;

/** What the model did: the places it chose stamps for and the fixes it asked for, or that it could not be reached. */
function adviceLines(advised: Advised): string[] {
    const g = I18N.generator;
    if (advised.failed && advised.chosen === 0) {
        return [localize(g.adviceFailed)];
    }
    const applied = advised.fixes.filter((f) => f.applied);
    return [
        format(g.adviceChosen, { count: String(advised.chosen) }),
        format(g.adviceFixes, { asked: String(advised.fixes.length), applied: String(applied.length) }),
        ...applied.slice(0, FIXES_SHOWN).map((f) => format(g.adviceFix, { piece: String(f.piece), action: f.action, why: f.why })),
        ...(advised.failed ? [localize(g.adviceFailed)] : []),
    ];
}

function reportLines(report: RealizeReport): string[] {
    const problems = I18N.generator.problems;
    return [
        format(I18N.generator.built, { count: String(report.features.length) }),
        ...report.problems.map((p) => format(problems[p.problem], { index: String(p.index) })),
    ];
}

/** A composer problem, worded for the GM. */
function problemLine(problem: ComposeProblem): string {
    const p = I18N.generator.composeProblems;
    if (problem.kind === 'rooms-do-not-fit') {
        return format(p.roomsDoNotFit, { building: problem.building, width: String(problem.width), height: String(problem.height) });
    }
    if (problem.kind === 'not-beside') {
        return format(p.notBeside, { building: problem.building, room: problem.room, other: problem.other });
    }
    if (problem.kind === 'no-stairwell') {
        return format(p.noStairwell, { building: problem.building });
    }
    return format(p.noStamp, { wantedIn: problem.wantedIn, role: problem.role });
}

/** The presets by name, as the picker lists them. */
const PRESET_TITLES: Readonly<Record<MapPreset, string>> = {
    'woodland-inn': I18N.generator.presets.woodlandInn,
    'tavern': I18N.generator.presets.tavern,
    'forest-road': I18N.generator.presets.forestRoad,
    'marsh-crossing': I18N.generator.presets.marshCrossing,
    'hive-outpost': I18N.generator.presets.hiveOutpost,
    'hive-chapel': I18N.generator.presets.hiveChapel,
    'manufactorum': I18N.generator.presets.manufactorum,
    'void-port': I18N.generator.presets.voidPort,
};

/** The preset the builder starts on. */
const FIRST_PRESET: MapPreset = 'woodland-inn';

export interface GeneratorRuntime {
    readonly open: () => void;
}

/** `stamps` lists every stamp the loaded packs offer, which composed maps are furnished and dressed from. */
export function registerGeneratorRuntime(
    controller: () => CartographyController | null,
    roomMaterials: () => RoomMaterials,
    stamps: () => readonly CatalogStamp[],
): GeneratorRuntime {
    let form: GeneratorForm = DEFAULT_GENERATOR_FORM;
    let specText = '';
    let preset: MapPreset = FIRST_PRESET;
    let intentText = presetText(FIRST_PRESET);
    let outcome: readonly string[] | null = null;
    let busy = false;
    let mode: ComposeMode = 'algorithmic';

    /** Run a build with the panel marked busy, then report `lines` of what it did. */
    const run = async (work: () => Promise<readonly string[]>): Promise<void> => {
        busy = true;
        panelWindow.refresh();
        try {
            outcome = await work();
        } finally {
            busy = false;
            panelWindow.refresh();
        }
    };

    const build = async (active: CartographyController, spec: SceneSpec): Promise<void> => run(async () => reportLines(await buildOnScene(active, spec)));

    const compose = (active: CartographyController): void => {
        // eslint-disable-next-line no-restricted-syntax -- boundary: JSON.parse of the GM's text gives an untyped value, validated by parseMapIntent
        let json: unknown;
        try {
            json = JSON.parse(intentText);
        } catch {
            outcome = [localize(I18N.generator.notJson)];
            panelWindow.refresh();
            return;
        }
        const parsed = parseMapIntent(json);
        if (!parsed.ok) {
            outcome = [localize(I18N.generator.intentRefused), ...parsed.issues.map(formatSpecIssue)];
            panelWindow.refresh();
            return;
        }
        const assisted = mode === 'assisted' && advisorAvailable();
        if (assisted) {
            outcome = [localize(I18N.generator.advising)];
        }
        void run(async () => {
            const composed = await composeOnScene(active, parsed.intent, stamps(), assisted ? askAdvisor : null);
            return composed.ok
                ? [...reportLines(composed.report), ...(composed.advised ? adviceLines(composed.advised) : []), ...composed.problems.map(problemLine)]
                : [localize(I18N.generator.refused), ...composed.issues.map(formatSpecIssue)];
        });
    };

    const panelWindow = createViewWindow({
        id: 'generator',
        title: () => localize(I18N.generator.title),
        width: PANEL_WIDTH,
        render: (root) => {
            const presets = MAP_PRESETS.map((key) => ({ key, label: localize(PRESET_TITLES[key]) }));
            const panel: GeneratorPanel = { mode, assistAvailable: advisorAvailable(), presets, preset, intentText, form, specText, status: outcome, busy };
            renderGeneratorPanel(root, panel, panelLabels(), {
                pickMode: (picked) => {
                    mode = picked;
                    panelWindow.refresh();
                },
                pickPreset: (key) => {
                    if (isMapPreset(key)) {
                        preset = key;
                        intentText = presetText(key);
                        panelWindow.refresh();
                    }
                },
                setIntentText: (text) => {
                    intentText = text;
                },
                reseedIntent: () => {
                    intentText = withSeed(intentText, newSeed(Math.random)) ?? intentText;
                    panelWindow.refresh();
                },
                compose: () => {
                    const active = controller();
                    if (active && !busy) {
                        compose(active);
                    }
                },
                setField: (field, typed) => {
                    const next = withGeneratorField(form, field, typed);
                    if (next) {
                        form = next;
                    }
                    return next !== null;
                },
                setEntrance: (entrance) => {
                    form = { ...form, entrance };
                },
                newSeed: () => {
                    form = { ...form, seed: newSeed(Math.random) };
                    panelWindow.refresh();
                },
                generate: () => {
                    const active = controller();
                    if (!active || busy) {
                        return;
                    }
                    const spec = generateFloorPlan(floorPlanOptions(form, roomMaterials()));
                    specText = JSON.stringify(spec, null, SPEC_INDENT);
                    void build(active, spec);
                },
                setSpecText: (text) => {
                    specText = text;
                },
                buildSpec: () => {
                    const active = controller();
                    if (!active || busy) {
                        return;
                    }
                    const parsed = parseSceneSpecJson(specText);
                    if (parsed.ok) {
                        void build(active, parsed.spec);
                    } else {
                        outcome = [localize(I18N.generator.refused), ...parsed.issues.map(formatSpecIssue)];
                        panelWindow.refresh();
                    }
                },
            });
        },
    });

    return {
        open: () => {
            panelWindow.open();
        },
    };
}
