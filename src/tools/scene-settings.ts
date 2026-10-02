// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Scene settings a map sets for itself, as the scene config's Basics,
 * Lighting and Ambience tabs do: darkness, global light, the day and night
 * environments and their cycle, token vision, fog of war (its exploration
 * mode and colours), weather, and the transition shown on entering it. Only what is given changes; the rest stays as the GM left it.
 * Pure data; the Foundry boundary writes it to the Scene.
 */

/** v14 `CONST.FOG_EXPLORATION_MODES`: whether explored areas are remembered, per user or for everyone. */
export const FOG_MODES = ['disabled', 'individual', 'shared'] as const;

export type FogMode = (typeof FOG_MODES)[number];

export const FOG_MODE_IDS: Readonly<Record<FogMode, number>> = { disabled: 0, individual: 1, shared: 2 };

/**
 * One of the scene's two lighting environments (v14 `environment.base`, by
 * day, and `environment.dark`, at full darkness): each value left out stays.
 */
export interface Environment {
    /** 0–1, a fraction of the colour wheel. */
    readonly hue?: number | undefined;
    /** 0–1: how strongly the hue tints the scene. */
    readonly intensity?: number | undefined;
    /** −1–1. */
    readonly luminosity?: number | undefined;
    /** −1–1. */
    readonly saturation?: number | undefined;
    /** 0–1. */
    readonly shadows?: number | undefined;
}

/** Each setting left out, or undefined (as a parsed spec gives it), stays as the GM left it. */
export interface SceneSettings {
    /** Scene darkness, 0 (day) to 1 (night). */
    readonly darkness?: number | undefined;
    /** Lock the darkness so time of day does not change it. */
    readonly darknessLock?: boolean | undefined;
    /** Foundry's global illumination, lighting the whole scene. */
    readonly globalLight?: boolean | undefined;
    /** The darkness range global light shines in, 0–1 (`environment.globalLight.darkness`); where a region leaves it darker, none. */
    readonly globalLightDarkness?: { readonly min: number; readonly max: number } | undefined;
    readonly tokenVision?: boolean | undefined;
    readonly fog?: FogMode | undefined;
    /** The fog's colours over explored and unexplored ground, `#rrggbb`. */
    readonly fogColours?: { readonly explored?: string | undefined; readonly unexplored?: string | undefined } | undefined;
    /** Whether the lighting moves from the base environment to the dark one as darkness rises. */
    readonly cycle?: boolean | undefined;
    readonly base?: Environment | undefined;
    readonly dark?: Environment | undefined;
    /** A `CONFIG.weatherEffects` key, or "" for none. */
    readonly weather?: string | undefined;
    /** The transition shown on entering the scene: a Foundry transition type (null: none) and its length in ms. */
    readonly transition?: { readonly type: string | null; readonly duration?: number | undefined } | undefined;
}

/** Whether `settings` changes anything. */
export function hasSceneSettings(settings: SceneSettings): boolean {
    const values: readonly unknown[] = Object.values(settings);
    return values.some((value) => value !== undefined);
}
