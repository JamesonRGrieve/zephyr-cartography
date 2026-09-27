// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Where the painted map draws: in Foundry's primary canvas group, as a map
 * background does, so tiles (stamps), drawings and tokens stand on it, and
 * lighting and fog of war fall over it. The group orders its children by
 * elevation, then sort layer (14.368 `PrimaryCanvasGroup.SORT_LAYERS`: a
 * level's images at SCENE 0, then TILES 500, DRAWINGS 600, TOKENS 700). The
 * terrain sits at the viewed level's floor, between its images and its tiles.
 * The pointer, the brush outline and link lines stay on the module's own
 * layer above the canvas.
 */

/** The terrain container's name, by which tests and tools find it in the primary group. */
const TERRAIN_LAYER_NAME = 'zephyrex-cartography-terrain';

/** Above a level's background and foreground images (SCENE, 0), beneath its tiles (TILES, 500). */
const TERRAIN_SORT_LAYER = 100;

/** A container the primary group sorts: `elevation` and `sortLayer` are what its comparator reads. */
class TerrainLayer extends PIXI.Container {
    readonly sortLayer = TERRAIN_SORT_LAYER;

    constructor(readonly elevation: number) {
        super();
        this.name = TERRAIN_LAYER_NAME;
        // It only draws: the module's own layer takes the pointer.
        this.eventMode = 'none';
    }
}

/** A terrain layer at `elevation` (the viewed level's floor) in the primary group, or null before the canvas has one. */
export function createTerrainLayer(elevation: number): PIXI.Container | null {
    const primary = canvas?.primary;
    if (!primary) {
        return null;
    }
    const layer = new TerrainLayer(elevation);
    primary.addChild(layer);
    return layer;
}
