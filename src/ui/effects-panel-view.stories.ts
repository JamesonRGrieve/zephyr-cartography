// SPDX-License-Identifier: AGPL-3.0-or-later
/** Stories for the area effects panel; each keeps its own area, so the controls work in Storybook. */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { type AreaEffectKind, DEFAULT_AREA_DISPLAY, type RegionEvent } from '../tools/area-effects';
import type { AreaSettings } from '../tools/areas';
import { NO_SPAWN, spawnCount } from '../tools/spawn';
import { parseCostInput } from '../tools/terrain-cost';
import { renderEffectsPanel, type EffectsLabels } from './effects-panel-view';

export interface EffectsPanelArgs {
    readonly settings: AreaSettings;
}

const KIND_NAMES: Readonly<Record<AreaEffectKind, string>> = {
    darkness: 'Adjust Darkness Level',
    suppressWeather: 'Suppress Weather',
    text: 'Display Scrolling Text',
    pause: 'Pause Game',
    macro: 'Execute Macro',
    script: 'Execute Script',
    activeEffect: 'Apply Active Effect',
    toggle: 'Toggle Behavior',
};

const EVENT_NAMES: Readonly<Record<RegionEvent, string>> = {
    regionBoundary: 'Region Boundary Changed',
    regionAnimation: 'Region Animation State Changed',
    behaviorActivated: 'Behavior Activated',
    behaviorDeactivated: 'Behavior Deactivated',
    behaviorViewed: 'Behavior Viewed',
    behaviorUnviewed: 'Behavior Unviewed',
    tokenEnter: 'Token Enters',
    tokenExit: 'Token Exits',
    tokenMoveIn: 'Token Moves In',
    tokenMoveOut: 'Token Moves Out',
    tokenMoveWithin: 'Token Moves Within',
    tokenAnimateIn: 'Token Animates In',
    tokenAnimateOut: 'Token Animates Out',
    tokenTurnStart: 'Token Starts Turn',
    tokenTurnEnd: 'Token Ends Turn',
    tokenRoundStart: 'Token Starts Round',
    tokenRoundEnd: 'Token Ends Round',
};

/** Named as Foundry's own behaviour sheets name them. */
const LABELS: EffectsLabels = {
    movementCost: 'Movement cost (1: ordinary ground)',
    effects: 'Area effects',
    none: 'No effects.',
    adding: 'New effect',
    add: 'Add effect',
    remove: 'Remove',
    kind: (kind) => KIND_NAMES[kind],
    darknessMode: 'Mode',
    darknessModes: { override: 'Override', brighten: 'Brighten', darken: 'Darken' },
    modifier: 'Modifier',
    text: 'Text',
    colour: 'Color',
    visibility: 'Visibility',
    visibilities: { gamemaster: 'Gamemaster', observer: 'Observer', anyone: 'Anyone' },
    once: 'Once',
    events: 'Events',
    eventName: (regionEvent) => EVENT_NAMES[regionEvent],
    macro: 'Macro',
    everyone: 'Everyone',
    script: 'Script',
    activeEffects: 'Effects (one UUID per line)',
    disabled: 'Disabled',
    toggleActions: { enable: 'Enable Behaviors', disable: 'Disable Behaviors' },
    untouched: 'Left as it is',
    spawn: {
        title: 'Spawn',
        actors: 'Actors, one per line: a UUID, or a count then a UUID',
        placement: 'Arrive',
        placements: { random: 'Anywhere inside', center: 'At the centre' },
        snap: 'Snap to the grid',
        avoidOccupied: 'Avoid occupied spaces',
        spawnNow: 'Spawn now',
    },
    region: {
        title: 'Region',
        visibility: 'Visibility',
        visibilities: {
            layer: 'Only on Region Layer',
            gamemaster: 'Always for Gamemaster',
            observer: 'Always for Observers',
            always: 'Always for Anyone',
        },
        highlight: 'Highlight Mode',
        highlights: { shapes: 'True Shapes', coverage: 'Covered Grid Spaces' },
        measurements: 'Display Measurements',
        observed: 'Players observe it',
        hidden: 'Hidden: GM only, behaviours off',
        restriction: 'Restricted By',
        unrestricted: 'Not shaped by walls',
        restrictions: {
            light: 'Light-blocking Walls and Darkness Sources with Priority ≥ Threshold',
            darkness: 'Darkness-blocking Walls and Light Sources with Priority > Threshold',
            sight: 'Sight-blocking Walls and Darkness Sources with Priority ≥ Threshold',
            sound: 'Sound-blocking Walls',
            move: 'Movement-blocking Walls',
        },
        priority: 'Priority Threshold',
    },
};

/** Mount an interactive panel inside a stand-in Foundry window scoped for the module's styles. */
export function mountEffectsPanel(args: EffectsPanelArgs): HTMLElement {
    const windowEl = document.createElement('div');
    windowEl.className = 'zephyr-cartography zc-story-window';
    const root = document.createElement('div');
    windowEl.append(root);
    let settings = args.settings;
    let adding: AreaEffectKind = 'darkness';
    const render = (): void => {
        renderEffectsPanel(root, { settings, adding }, LABELS, {
            setMovementCost: (typed) => {
                const cost = parseCostInput(typed);
                if (cost !== null) {
                    settings = { ...settings, movementCost: cost };
                    render();
                }
                return cost !== null;
            },
            setEffects: (effects) => {
                settings = { ...settings, effects };
                render();
            },
            setAdding: (kind) => {
                adding = kind;
                render();
            },
            setDisplay: (display) => {
                settings = { ...settings, display };
                render();
            },
            setSpawn: (spawn) => {
                settings = { ...settings, spawn };
                render();
            },
            spawnNow: () => {
                windowEl.dataset['spawned'] = String(spawnCount(settings.spawn));
            },
        });
    };
    render();
    return windowEl;
}

const meta: Meta<EffectsPanelArgs> = {
    title: 'Regions/Area Effects Panel',
    excludeStories: ['mountEffectsPanel'],
    render: mountEffectsPanel,
    args: { settings: { movementCost: 1, effects: [], display: DEFAULT_AREA_DISPLAY, spawn: NO_SPAWN } },
};

export default meta;

type Story = StoryObj<EffectsPanelArgs>;

export const OrdinaryGround: Story = {};

export const DarkMireRoom: Story = {
    args: {
        settings: {
            movementCost: 2,
            effects: [{ kind: 'darkness', mode: 'darken', modifier: 0.4 }, { kind: 'suppressWeather' }],
            // The darkness stops at the walls, and players see where it lies.
            display: {
                visibility: 'always',
                highlight: 'coverage',
                measurements: false,
                observed: false,
                restriction: { type: 'light', priority: 0 },
                hidden: false,
            },
            spawn: NO_SPAWN,
        },
    },
};

export const TrappedCorridor: Story = {
    args: {
        settings: {
            movementCost: 1,
            effects: [
                { kind: 'text', text: 'Click.', colour: '#ff5500', visibility: 'anyone', once: true, events: ['tokenAnimateIn'] },
                { kind: 'pause', once: true },
                { kind: 'macro', uuid: 'Macro.dartTrap', everyone: false, events: ['tokenEnter'] },
                { kind: 'script', source: 'ui.notifications.info("A draught.");', events: ['tokenExit'] },
                { kind: 'activeEffect', effects: ['Compendium.world.effects.ActiveEffect.poisoned'] },
            ],
            display: DEFAULT_AREA_DISPLAY,
            spawn: NO_SPAWN,
        },
    },
};

/** A room that goes dark when a token walks in, and light again when it leaves. */
export const LightsOutRoom: Story = {
    args: {
        settings: {
            movementCost: 1,
            effects: [
                { kind: 'darkness', mode: 'override', modifier: 1, disabled: true },
                { kind: 'toggle', events: ['tokenEnter'], enable: [0], disable: [] },
                { kind: 'toggle', events: ['tokenExit'], enable: [], disable: [0] },
            ],
            display: DEFAULT_AREA_DISPLAY,
            spawn: NO_SPAWN,
        },
    },
};

/** Reinforcements that pour out of a hab block: three cultists and their leader, anywhere inside. */
export const CultAmbush: Story = {
    args: {
        settings: {
            movementCost: 1,
            effects: [],
            display: DEFAULT_AREA_DISPLAY,
            spawn: {
                actors: [
                    { uuid: 'Actor.cultistNeophyte', count: 3 },
                    { uuid: 'Actor.cultMagus', count: 1 },
                ],
                placement: 'random',
                snap: true,
                avoidOccupied: true,
            },
        },
    },
};
