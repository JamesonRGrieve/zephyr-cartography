// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The door panel for a room door: its type (a Foundry door, a secret door, or
 * an opening with no door and no wall), its
 * state (closed, open, locked), or removing it. A pure function from the
 * door's settings to elements; unit-tested under happy-dom.
 */
import { DOOR_ANIMATIONS, type DoorAnimationType, type DoorState } from '../tools/documents';
import type { DoorSettings, RoomDoorType } from '../tools/room';
import { button, choice, replacePreservingFocus } from './dom';

export interface DoorPanelLabels {
    readonly type: string;
    readonly state: string;
    readonly types: Readonly<Record<RoomDoorType, string>>;
    readonly states: Readonly<Record<DoorState, string>>;
    readonly sound: string;
    /** Foundry's door sounds (`CONFIG.Wall.doorSounds`), by key. */
    readonly sounds: Readonly<Record<string, string>>;
    readonly animation: string;
    readonly animations: Readonly<Record<DoorAnimationType, string>>;
    /** The option that leaves the sound or animation to Foundry's default. */
    readonly foundryDefault: string;
    readonly remove: string;
}

export interface DoorPanelHandlers {
    readonly set: (settings: DoorSettings) => void;
    readonly remove: () => void;
}

const TYPES: readonly RoomDoorType[] = ['door', 'secret', 'opening'];
const STATES: readonly DoorState[] = ['closed', 'open', 'locked'];

/** The select value standing for "Foundry's default" (null). */
const DEFAULT_VALUE = '';

/** A choice with a leading "Foundry default" option, standing for null. */
function defaultableChoice<T extends string>(
    id: string,
    label: string,
    names: Readonly<Record<T, string>>,
    options: readonly T[],
    value: T | null,
    defaultName: string,
    onChange: (v: T | null) => void,
): HTMLElement {
    const entries: (readonly [T | typeof DEFAULT_VALUE, string])[] = [[DEFAULT_VALUE, defaultName], ...options.map((o): readonly [T, string] => [o, names[o]])];
    return choice<T | typeof DEFAULT_VALUE>(id, label, entries, value ?? DEFAULT_VALUE, (picked) => {
        onChange(picked === DEFAULT_VALUE ? null : picked);
    });
}

export function renderDoorPanel(root: HTMLElement, door: DoorSettings, labels: DoorPanelLabels, handlers: DoorPanelHandlers): void {
    const soundKeys = Object.keys(labels.sounds);
    replacePreservingFocus(root, [
        choice(
            'zc-door-type',
            labels.type,
            TYPES.map((t) => [t, labels.types[t]] as const),
            door.type,
            (type) => {
                handlers.set({ ...door, type });
            },
        ),
        choice(
            'zc-door-state',
            labels.state,
            STATES.map((s) => [s, labels.states[s]] as const),
            door.state,
            (state) => {
                handlers.set({ ...door, state });
            },
        ),
        defaultableChoice('zc-door-sound', labels.sound, labels.sounds, soundKeys, door.sound, labels.foundryDefault, (sound) => {
            handlers.set({ ...door, sound });
        }),
        defaultableChoice('zc-door-animation', labels.animation, labels.animations, DOOR_ANIMATIONS, door.animation, labels.foundryDefault, (animation) => {
            handlers.set({ ...door, animation });
        }),
        button('tw-text-xs', labels.remove, 'remove', handlers.remove),
    ]);
}
