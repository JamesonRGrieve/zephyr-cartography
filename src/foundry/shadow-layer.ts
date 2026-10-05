// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Drop shadows (operator, 2026-10-05: drawn shadows, option B). Every tile
 * the module placed that stands (its `shadow` flag, how tall it stands as a
 * share of its shorter side) casts a silhouette of its own picture,
 * darkened and offset straight away from the scene's sun, beneath every
 * tile in Foundry's primary group: lighting and fog of war fall over it as
 * over the map. The silhouettes of one elevation share a container, blurred
 * and faded once, so overlapping shadows never darken twice and a town of
 * five hundred trees costs one blur. The sun is the scene's `sun` flag
 * (set through the module API, by a game system's calendar or the GM), else
 * the cartographer's north-west light; no shadow falls once it is down, and
 * the world setting turns them off. Per client: nothing is written.
 */
import { MODULE_ID } from '../module-id';
import { DEFAULT_SUN, parseSun, type Sun, shadowOpacity, shadowShift } from '../tools/sun';

declare global {
    interface FlagConfig {
        /** A placed tile's marks: the feature it belongs to, and how tall it stands for its drop shadow. */
        Tile: { 'zephyr-cartography': { featureId?: string; shadow?: number } };
    }
}

/** The containers' name, by which tests and tools find them in the primary group. */
const SHADOW_LAYER_NAME = 'zephyr-cartography-shadows';

/** Just beneath a level's tiles (TILES, 500), above its painted map (100). */
const SHADOW_SORT_LAYER = 499;

/** The grid size taken where the scene gives none, in px. */
const DEFAULT_GRID = 100;

/** The blur of a shadow's edge, as a share of a grid square. */
const SOFTNESS = 0.08;

/** The scene flag holding its sun. */
export const SUN_FLAG = 'sun';

/** The world setting that draws them. */
export const DROP_SHADOWS_SETTING = 'dropShadows';

/** A container of one elevation's shadows, sorted by the primary group as its tiles are. */
class ShadowLayer extends PIXI.Container {
    readonly sortLayer = SHADOW_SORT_LAYER;

    constructor(readonly elevation: number) {
        super();
        this.name = SHADOW_LAYER_NAME;
        this.eventMode = 'none';
    }
}

/** The shadows on the canvas: a layer per elevation, a sprite per tile. */
interface Shadows {
    readonly layers: Map<number, ShadowLayer>;
    readonly sprites: Map<string, PIXI.Sprite>;
}

let shadows: Shadows | null = null;

/** The viewed scene's sun, its flag read defensively, else the default. */
function sceneSun(): Sun {
    // eslint-disable-next-line no-restricted-syntax -- boundary: a scene flag is serialised JSON of any shape
    const stored: unknown = canvas?.scene?.getFlag(MODULE_ID, SUN_FLAG);
    return parseSun(stored) ?? DEFAULT_SUN;
}

function enabled(): boolean {
    return game.settings?.get(MODULE_ID, DROP_SHADOWS_SETTING) !== false;
}

/** How tall a tile stands for its shadow, from its module flag; 0 for one that casts none or the module did not place. */
function standsOf(tile: foundry.canvas.placeables.Tile): number {
    // eslint-disable-next-line no-restricted-syntax -- boundary: a tile's flags are serialised JSON of any shape
    const stands: unknown = tile.document.getFlag(MODULE_ID, 'shadow');
    return typeof stands === 'number' && Number.isFinite(stands) && stands > 0 ? stands : 0;
}

/** The layer for `elevation`, made in the primary group the first time it is wanted. */
function layerAt(state: Shadows, elevation: number): ShadowLayer | null {
    const existing = state.layers.get(elevation);
    if (existing) {
        return existing;
    }
    const primary = canvas?.primary;
    if (!primary) {
        return null;
    }
    const layer = new ShadowLayer(elevation);
    layer.filters = [new PIXI.BlurFilter((canvas.scene?.grid.size ?? DEFAULT_GRID) * SOFTNESS)];
    layer.alpha = shadowOpacity(sceneSun());
    primary.addChild(layer);
    state.layers.set(elevation, layer);
    return layer;
}

/** Drop `tile`'s shadow, if it has one. */
function forget(state: Shadows, id: string): void {
    const sprite = state.sprites.get(id);
    if (sprite) {
        sprite.destroy();
        state.sprites.delete(id);
    }
}

/** Draw, move or drop `tile`'s shadow to match the tile as it now stands. */
function follow(tile: foundry.canvas.placeables.Tile): void {
    const state = shadows;
    const id = tile.document.id;
    if (!state || id === null) {
        return;
    }
    const mesh = tile.mesh;
    const texture = mesh?.texture ?? null;
    const stands = standsOf(tile);
    const shift = stands === 0 ? null : shadowShift(sceneSun(), stands * Math.min(tile.document.width, tile.document.height));
    if (!enabled() || !mesh || !texture || !shift || tile.document.hidden || !tile.visible) {
        forget(state, id);
        return;
    }
    const elevation = tile.document.elevation;
    const layer = layerAt(state, elevation);
    if (!layer) {
        return;
    }
    const sprite = state.sprites.get(id) ?? new PIXI.Sprite(texture);
    if (sprite.parent !== layer) {
        layer.addChild(sprite);
        state.sprites.set(id, sprite);
    }
    sprite.texture = texture;
    sprite.anchor.set(mesh.anchor.x, mesh.anchor.y);
    sprite.scale.set(mesh.scale.x, mesh.scale.y);
    sprite.rotation = mesh.rotation;
    sprite.position.set(mesh.x + shift.x, mesh.y + shift.y);
    sprite.tint = 0x000000;
}

/** Every tile's shadow drawn again (the sun moved, the setting changed, the canvas was redrawn). */
function redrawAll(): void {
    for (const layer of shadows?.layers.values() ?? []) {
        layer.destroy({ children: true });
    }
    shadows = { layers: new Map(), sprites: new Map() };
    for (const tile of canvas?.tiles?.placeables ?? []) {
        follow(tile);
    }
}

/** Keep every placed tile's drop shadow in step with the tile, the scene's sun and the world setting. */
export function followShadows(): void {
    Hooks.on('canvasReady', redrawAll);
    Hooks.on('refreshTile', (tile) => {
        follow(tile);
    });
    Hooks.on('destroyTile', (tile) => {
        if (shadows && tile.document.id !== null) {
            forget(shadows, tile.document.id);
        }
    });
    Hooks.on('updateScene', (scene, changed) => {
        // Set, or cleared back to the default (Foundry's update says `-=sun`).
        const sunChanged = [SUN_FLAG, `-=${SUN_FLAG}`].some((key) => foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${key}`));
        if (scene.id === canvas?.scene?.id && sunChanged) {
            redrawAll();
        }
    });
}

/** Redraw every shadow, for the world setting's change. */
export function redrawShadows(): void {
    redrawAll();
}
