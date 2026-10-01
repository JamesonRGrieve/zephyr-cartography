// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The zone window: opened on a zone placed or clicked with the zone tool, in
 * Foundry's Regions controls. It sets the zone's name, shape and sizes,
 * rotation, grid measuring and the token it moves with (from the scene's
 * tokens), labelled with Foundry's own shape and Region sheet strings. The
 * zone itself is the controller's. A zone's region moved with its token is
 * followed back into the zone here.
 */
import type { CartographyController } from '../canvas/controller';
import type { Point } from '../geometry/spline';
import { I18N } from '../i18n';
import { MODULE_ID } from '../module-id';
import { isRecord } from '../tools/guards';
import type { ZoneShapeKind } from '../tools/zone';
import { parseZonePresets, presetOf, serializeZonePresets, withoutPreset, withPreset, type ZonePreset } from '../tools/zone-presets';
import { renderZonePanel, type TokenChoice, type ZoneLabels } from '../ui/zone-panel-view';
import { localize } from './localize';
import { createViewWindow } from './view-window';

const PANEL_WIDTH = 360;

function labels(): ZoneLabels {
    const shape = (kind: ZoneShapeKind): string => localize(`SHAPE.TYPES.${kind}.name`);
    const base = (path: string): string => localize(`SHAPE.TYPES.base.FIELDS.${path}`);
    return {
        name: localize('DOCUMENT.FIELDS.name.label'),
        shape: base('type.label'),
        shapes: {
            circle: shape('circle'),
            ellipse: shape('ellipse'),
            ring: shape('ring'),
            cone: shape('cone'),
            line: shape('line'),
            rectangle: shape('rectangle'),
            // Foundry's own name for its grid-spaces shape.
            cells: localize('SHAPE.TYPES.grid.name'),
            emanation: shape('emanation'),
        },
        rows: localize(I18N.zones.rows),
        columns: localize(I18N.zones.columns),
        size: (kind, field) => localize(`SHAPE.TYPES.${kind}.FIELDS.${field}.label`),
        curvature: localize('SHAPE.TYPES.cone.FIELDS.curvature.label'),
        curvatures: {
            round: localize('SHAPE.TYPES.cone.CURVATURES.round.label'),
            flat: localize('SHAPE.TYPES.cone.CURVATURES.flat.label'),
            semicircle: localize('SHAPE.TYPES.cone.CURVATURES.semicircle.label'),
        },
        rotation: base('rotation.label'),
        gridBased: base('gridBased.label'),
        token: localize('REGION.FIELDS.attachment.token.label'),
        none: localize(I18N.zones.none),
        presets: {
            title: localize(I18N.zones.presets.title),
            preset: localize(I18N.zones.presets.preset),
            apply: localize(I18N.zones.presets.apply),
            forget: localize(I18N.zones.presets.forget),
            name: localize(I18N.zones.presets.name),
            save: localize(I18N.zones.presets.save),
            empty: localize(I18N.zones.presets.empty),
        },
    };
}

/** The world setting the hazard presets are kept in, as JSON. */
const PRESETS_SETTING = 'zonePresets';

declare global {
    interface SettingConfig {
        'zephyr-cartography.zonePresets': string;
    }
}

function presets(): ZonePreset[] {
    return parseZonePresets(game.settings?.get(MODULE_ID, PRESETS_SETTING) ?? '[]');
}

async function savePresets(next: readonly ZonePreset[]): Promise<void> {
    await game.settings?.set(MODULE_ID, PRESETS_SETTING, serializeZonePresets(next));
}

/**
 * The tokens a zone on `level` can move with, by name: those Foundry locates
 * on that level (`TokenDocument#locatedInLevel`, 14.364), every token for a
 * zone on every level, and the one it follows now wherever that has gone.
 */
function tokens(level: string | null, attached: string | null): TokenChoice[] {
    return (canvas?.scene?.tokens.contents ?? [])
        .filter((token) => level === null || token.id === attached || token.locatedInLevel(level))
        .map((token) => ({ id: token.id, name: token.name }));
}

/** The viewed scene's cell size, for zones of grid spaces: only a square grid has cells the zone math follows. */
function cellSize(): number | null {
    const grid = canvas?.grid;
    return grid?.type === CONST.GRID_TYPES.SQUARE ? grid.size : null;
}

/**
 * Where a zone's region shape now stands: every shape but an emanation at its
 * x, y (turned by its rotation), an emanation at the centre of the token
 * footprint it rounds.
 */
function shapePlace(shape: RegionDocument['shapes'][number]): { readonly point: Point; readonly rotation: number } | null {
    if ('base' in shape) {
        const centre = footprintCentre(shape, canvas?.grid?.size ?? 0);
        return centre && { point: centre, rotation: 0 };
    }
    return 'x' in shape && 'y' in shape ? { point: { x: shape.x, y: shape.y }, rotation: 'rotation' in shape ? shape.rotation : 0 } : null;
}

/**
 * The centre of an emanation's token footprint (its base: top-left px, size in
 * grid spaces of `cell` px), or null when it has none.
 */
// eslint-disable-next-line no-restricted-syntax -- boundary: fvtt-types leaves an emanation's base untyped; it is narrowed here
function footprintCentre(emanation: unknown, cell: number): Point | null {
    const base = isRecord(emanation) ? emanation['base'] : null;
    if (!isRecord(base)) {
        return null;
    }
    const { x, y, width, height } = base;
    return typeof x === 'number' && typeof y === 'number' && typeof width === 'number' && typeof height === 'number'
        ? { x: x + (width * cell) / 2, y: y + (height * cell) / 2 }
        : null;
}

export interface ZoneRuntime {
    /** Open the panel for a zone. */
    readonly edit: (zoneId: string) => void;
}

export function registerZoneRuntime(controller: () => CartographyController | null): ZoneRuntime {
    let zoneId: string | null = null;

    Hooks.once('init', () => {
        game.settings?.register(MODULE_ID, PRESETS_SETTING, { scope: 'world', config: false, type: String, default: '[]' });
    });

    const panel = createViewWindow({
        id: 'zone',
        title: () => localize(I18N.zones.title),
        width: PANEL_WIDTH,
        render: (root) => {
            const active = controller();
            const id = zoneId;
            const settings = id !== null && active ? active.zoneSettings(id) : null;
            if (!active || id === null || !settings) {
                root.replaceChildren();
                return;
            }
            const after = (work: () => Promise<unknown>): void => {
                panel.apply(work);
            };
            const saved = presets();
            const level = active.getFeature(id)?.level ?? null;
            const choices = tokens(level, settings.attachedTo);
            renderZonePanel(root, { settings, tokens: choices, presets: saved.map((p) => p.name), cellSize: cellSize() }, labels(), {
                set: (next) => {
                    after(async () => active.setZoneSettings(id, next));
                    return true;
                },
                applyPreset: (presetName) => {
                    const preset = saved.find((p) => p.name === presetName);
                    if (preset) {
                        after(async () => active.applyZonePreset(id, preset));
                    }
                },
                savePreset: (presetName) => {
                    const area = active.areaSettings(id);
                    const preset = area && presetOf(presetName, settings, area);
                    if (preset) {
                        after(async () => savePresets(withPreset(saved, preset)));
                    }
                },
                forgetPreset: (presetName) => {
                    after(async () => savePresets(withoutPreset(saved, presetName)));
                },
            });
        },
    });

    // Foundry moves an attached zone's region with its token, whoever moved the token; the zone follows on the active
    // GM alone, since players cannot write the scene and several GMs would race.
    Hooks.on('updateRegion', (region, changed) => {
        const active = controller();
        const [shape] = region.shapes;
        const at = shape === undefined ? null : shapePlace(shape);
        if (!active || !('shapes' in changed) || game.users?.activeGM?.isSelf !== true || region.id === null || at === null) {
            return;
        }
        void active.followZone(region.id, at.point, at.rotation);
    });

    return {
        edit: (id) => {
            zoneId = id;
            panel.open();
            panel.refresh();
        },
    };
}
