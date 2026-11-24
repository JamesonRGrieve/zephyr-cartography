// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The area effects window: opened by clicking painted ground or a room with
 * the effects tool, in Foundry's Regions controls. It sets what crossing the
 * area costs and the region behaviours on it, labelled with Foundry's own
 * strings for each behaviour type. The settings themselves are the
 * controller's.
 */
import type { CartographyController } from '../canvas/controller';
import { I18N } from '../i18n';
import type { AreaEffectKind } from '../tools/area-effects';
import { editListOver, editOver } from '../tools/edit-over';
import { parseCostInput } from '../tools/terrain-cost';
import { renderEffectsPanel, type EffectsLabels, type RegionDisplayLabels } from '../ui/effects-panel-view';
import { format, localize } from './localize';
import { spawnInto } from './spawner';
import { createViewWindow } from './view-window';

const PANEL_WIDTH = 460;

/** Each area effect's native behaviour type, whose name Foundry's own strings give. */
const BEHAVIOUR_TYPES: Readonly<Record<AreaEffectKind, string>> = {
    darkness: 'adjustDarknessLevel',
    suppressWeather: 'suppressWeather',
    text: 'displayScrollingText',
    pause: 'pauseGame',
    macro: 'executeMacro',
    script: 'executeScript',
    activeEffect: 'applyActiveEffect',
    toggle: 'toggleBehavior',
};

function labels(): EffectsLabels {
    const behaviour = (path: string): string => localize(`BEHAVIOR.TYPES.${path}`);
    return {
        movementCost: localize(I18N.paint.movementCost),
        effects: localize(I18N.effects.effects),
        none: localize(I18N.effects.none),
        adding: localize(I18N.effects.adding),
        add: localize(I18N.effects.add),
        remove: localize(I18N.effects.remove),
        kind: (kind) => localize(`TYPES.RegionBehavior.${BEHAVIOUR_TYPES[kind]}`),
        darknessMode: behaviour('adjustDarknessLevel.FIELDS.mode.label'),
        darknessModes: {
            override: behaviour('adjustDarknessLevel.MODES.OVERRIDE.label'),
            brighten: behaviour('adjustDarknessLevel.MODES.BRIGHTEN.label'),
            darken: behaviour('adjustDarknessLevel.MODES.DARKEN.label'),
        },
        modifier: behaviour('adjustDarknessLevel.FIELDS.modifier.label'),
        text: behaviour('displayScrollingText.FIELDS.text.label'),
        colour: behaviour('displayScrollingText.FIELDS.color.label'),
        visibility: behaviour('displayScrollingText.FIELDS.visibility.label'),
        visibilities: {
            gamemaster: behaviour('displayScrollingText.VISIBILITY_MODES.GAMEMASTER.label'),
            observer: behaviour('displayScrollingText.VISIBILITY_MODES.OBSERVER.label'),
            anyone: behaviour('displayScrollingText.VISIBILITY_MODES.ANYONE.label'),
        },
        once: behaviour('base.FIELDS.once.label'),
        events: behaviour('base.FIELDS.events.label'),
        eventName: (regionEvent) => localize(`REGION.EVENTS.${regionEvent}.label`),
        macro: behaviour('executeMacro.FIELDS.uuid.label'),
        everyone: behaviour('executeMacro.FIELDS.everyone.label'),
        script: behaviour('executeScript.FIELDS.source.label'),
        activeEffects: localize(I18N.effects.activeEffects),
        disabled: localize('BEHAVIOR.FIELDS.disabled.label'),
        toggleActions: { enable: behaviour('toggleBehavior.FIELDS.enable.label'), disable: behaviour('toggleBehavior.FIELDS.disable.label') },
        untouched: localize(I18N.effects.untouched),
        region: regionLabels(),
        spawn: {
            title: localize(I18N.effects.spawn.title),
            actors: localize(I18N.effects.spawn.actors),
            placement: localize(I18N.submap.placement),
            placements: { random: localize(I18N.submap.placements.random), center: localize(I18N.submap.placements.center) },
            snap: localize(I18N.effects.spawn.snap),
            avoidOccupied: localize(I18N.effects.spawn.avoidOccupied),
            spawnNow: localize(I18N.effects.spawn.now),
        },
    };
}

/** Spawn area `areaId`'s tokens into its region, and tell the GM what came of it. */
async function spawnArea(controller: CartographyController, areaId: string): Promise<void> {
    const settings = controller.areaSettings(areaId);
    const regionId = controller.areaRegionId(areaId);
    if (!settings || regionId === null) {
        return;
    }
    try {
        const { spawned, missing } = await spawnInto(regionId, settings.spawn);
        for (const uuid of missing) {
            ui.notifications?.warn(format(I18N.effects.spawn.missing, { uuid }));
        }
        ui.notifications?.info(format(I18N.effects.spawn.spawned, { count: String(spawned) }));
    } catch (error) {
        // Foundry throws when there is no room left inside, or the GM may not create tokens.
        ui.notifications?.warn(format(I18N.effects.spawn.failed, { message: error instanceof Error ? error.message : String(error) }));
    }
}

/** The region display's fields, as Foundry's Region sheet names them. */
function regionLabels(): RegionDisplayLabels {
    const region = (path: string): string => localize(`REGION.${path}`);
    return {
        title: localize(I18N.effects.region),
        visibility: region('FIELDS.visibility.label'),
        visibilities: {
            layer: region('VISIBILITY.LAYER.label'),
            gamemaster: region('VISIBILITY.GAMEMASTER.label'),
            observer: region('VISIBILITY.OBSERVER.label'),
            always: region('VISIBILITY.ALWAYS.label'),
        },
        highlight: region('FIELDS.highlightMode.label'),
        highlights: { shapes: region('HIGHLIGHT_MODES.shapes.label'), coverage: region('HIGHLIGHT_MODES.coverage.label') },
        measurements: region('FIELDS.displayMeasurements.label'),
        observed: localize(I18N.effects.observed),
        hidden: localize(I18N.effects.regionHidden),
        restriction: region('FIELDS.restriction.type.label'),
        unrestricted: localize(I18N.effects.unrestricted),
        restrictions: {
            light: region('RESTRICTION_TYPES.light.label'),
            darkness: region('RESTRICTION_TYPES.darkness.label'),
            sight: region('RESTRICTION_TYPES.sight.label'),
            sound: region('RESTRICTION_TYPES.sound.label'),
            move: region('RESTRICTION_TYPES.move.label'),
        },
        priority: region('FIELDS.restriction.priority.label'),
    };
}

export interface EffectsRuntime {
    /** Open the panel for an area (painted ground or a room). */
    readonly edit: (areaId: string) => void;
}

export function registerEffectsRuntime(controller: () => CartographyController | null): EffectsRuntime {
    let areaId: string | null = null;
    let adding: AreaEffectKind = 'darkness';

    const panel = createViewWindow({
        id: 'effects',
        title: () => localize(I18N.effects.title),
        width: PANEL_WIDTH,
        render: (root) => {
            const active = controller();
            const id = areaId;
            const settings = id !== null && active ? active.areaSettings(id) : null;
            if (!active || id === null || !settings) {
                root.replaceChildren();
                return;
            }
            // Laid over the area as it stands when the write runs, not as last drawn: edits made close together each
            // change one field or one behaviour, and a stale draw would put the one before back.
            const save = (next: typeof settings): void => {
                panel.apply(async () => {
                    const current = active.areaSettings(id);
                    return active.setAreaSettings(
                        id,
                        current ? { ...editOver(current, settings, next), effects: editListOver(current.effects, settings.effects, next.effects) } : next,
                    );
                });
            };
            renderEffectsPanel(root, { settings, adding }, labels(), {
                setMovementCost: (typed) => {
                    const cost = parseCostInput(typed);
                    if (cost !== null) {
                        save({ ...settings, movementCost: cost });
                    }
                    return cost !== null;
                },
                setEffects: (effects) => {
                    save({ ...settings, effects });
                },
                setAdding: (kind) => {
                    adding = kind;
                    panel.refresh();
                },
                setDisplay: (display) => {
                    save({ ...settings, display });
                },
                setSpawn: (spawn) => {
                    save({ ...settings, spawn });
                },
                spawnNow: () => {
                    void spawnArea(active, id);
                },
            });
        },
    });

    return {
        edit: (id) => {
            areaId = id;
            panel.open();
            panel.refresh();
        },
    };
}
