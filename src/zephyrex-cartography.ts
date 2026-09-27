// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Zephyrex Cartography: Foundry entry / runtime seam.
 *
 * All authoring logic lives in the pure, unit-tested modules (geometry, tools,
 * stamps, canvas/controller, canvas/renderer). This file is the thin glue that
 * wires the live Foundry canvas, scene, and PIXI into that logic and registers
 * the scene-control tools (paths, biome regions/strokes, rooms, doors, stamps,
 * editing). Pointer input is routed by one {@link Mode} per active tool.
 */
import './styles/entry.css';
import { type Brush, CartographyController } from './canvas/controller';
import { IDLE, type Mode, modeForTool } from './canvas/modes';
import { type FeatureRenderer, GraphicsFeatureRenderer } from './canvas/renderer';
import { inOwnGroup, moduleTool, NATIVE_GROUPS, NATIVE_TOOLS, type NativeTool, nativeToolName } from './canvas/tool-placement';
import { registerAdvisorSettings } from './foundry/advisor';
import { registerApi } from './foundry/api';
import { followViewedLevel } from './foundry/build-spec';
import { lightName, regionName, soundName } from './foundry/document-names';
import { FoundryDocumentSink } from './foundry/documents';
import { registerDoorRuntime } from './foundry/door-runtime';
import { registerEffectsRuntime } from './foundry/effects-runtime';
import { registerGeneratorRuntime } from './foundry/generator-runtime';
import { createItemPilesContainers, followPileStates } from './foundry/item-piles';
import { registerLabelRuntime } from './foundry/label-runtime';
import { registerLevelRuntime } from './foundry/level-runtime';
import { createLevelStore } from './foundry/levels';
import { registerMaterialsRuntime } from './foundry/materials-runtime';
import { registerPackRuntime } from './foundry/pack-runtime';
import { registerPaintRuntime } from './foundry/paint-runtime';
import { withParticles } from './foundry/particles';
import { type PathSettings, registerPathRuntime } from './foundry/path-runtime';
import { registerPinRuntime } from './foundry/pin-runtime';
import { createPixiSurface } from './foundry/pixi-surface';
import { activeScene, modifyBatch } from './foundry/scene-bridge';
import { FoundrySceneStore } from './foundry/scene-store';
import { createWorldScenes } from './foundry/scenes';
import { createSilhouetteSource } from './foundry/silhouette';
import { createSplatRenderer } from './foundry/splat-renderer';
import { createSplatStore } from './foundry/splat-store';
import { registerSubmapRuntime } from './foundry/submap-runtime';
import { registerSwitchDoorControl } from './foundry/switch-door-control';
import { createSwitchLinker, type SwitchLinker } from './foundry/switch-linker';
import { createTerrainLayer } from './foundry/terrain-layer';
import { registerZoneRuntime } from './foundry/zone-runtime';
import { distance, type Point } from './geometry/spline';
import { I18N } from './i18n';
import { MODULE_ID } from './module-id';
import type { BiomeKind } from './tools/biome';
import { WALL_BAND_SQUARES } from './tools/materials';

interface DrawState {
    controller: CartographyController;
    /** What draws the features, and runs their particles. */
    renderer: FeatureRenderer;
    /** The module's layer above the canvas: it takes the pointer and shows the brush outline and link lines. */
    container: PIXI.Container;
    /** Where the painted map draws, in Foundry's primary group beneath tiles and tokens. */
    terrain: PIXI.Container;
    mode: Mode;
    /** A control point being dragged: moved, or (Shift) its path width set by distance from `anchor`. */
    drag: { id: string; index: number; kind: 'move' | 'width'; anchor: Point } | null;
    /** A brush stroke is being painted (the pointer is down with the paint tool laying ground). */
    painting: boolean;
    /** The paint brush's outline, following the pointer while the paint tool is in hand. */
    cursor: PIXI.Graphics;
    /** A blend stroke is under way (the pointer is down with the paint tool blending). */
    blending: boolean;
    /** The link tool: the switch picked and its drawn links. */
    linker: SwitchLinker;
}

let state: DrawState | null = null;

const packs = registerPackRuntime(() => state?.controller ?? null);

const levels = registerLevelRuntime(() => state?.controller ?? null);

registerSubmapRuntime(() => state?.controller ?? null, packs.catalog);

const doors = registerDoorRuntime(() => state?.controller ?? null);

const materials = registerMaterialsRuntime(() => state?.controller ?? null, packs.textureRoles);

const effects = registerEffectsRuntime(() => state?.controller ?? null);

const pins = registerPinRuntime(() => state?.controller ?? null);

const labels = registerLabelRuntime(() => state?.controller ?? null);

const zones = registerZoneRuntime(() => state?.controller ?? null);

followPileStates(() => state?.controller ?? null);

registerAdvisorSettings();
const generator = registerGeneratorRuntime(() => state?.controller ?? null, materials.forNewRooms, packs.stamps);

// A new brush size is the next stroke's; a new texture is picked up at once by a paint tool in hand.
const paint = registerPaintRuntime(
    {
        previews: packs.previews,
        roles: packs.textureRoles,
        sets: packs.textureSets,
        active: packs.activeTextureSet,
        choose: packs.chooseTextureSet,
    },
    (settings) => {
        if (!state) {
            return;
        }
        state.controller.brushRadius = settings.radius;
        state.controller.movementCost = settings.movementCost;
        state.controller.paintTexture = settings.texture;
        const { mode } = state;
        if (mode.kind === 'brush' && mode.brush.type === 'stroke' && mode.brush.biome !== settings.biome) {
            enterMode(state, toolMode('paint', true));
        }
    },
    {
        state: () => state?.controller.splatState() ?? 'none',
        backgroundBakeable: () => state?.controller.splatLayer()?.level != null,
        bake: async (into) => state?.controller.bakeSplat(into),
        unbake: async () => state?.controller.unbakeSplat(),
    },
);

/** Put the road and river panel's width and river look in the controller's hand for the next path. */
function applyPathSettings(controller: CartographyController, settings: PathSettings): void {
    controller.halfWidth = settings.width / 2;
    controller.pathWalls = settings.walls;
    controller.riverLook = settings.river;
}

const paths = registerPathRuntime(packs.textureRoles, (settings) => {
    if (state) {
        applyPathSettings(state.controller, settings);
    }
});

registerApi(() => state?.controller ?? null, packs.stamps);

// Newly loaded packs or another texture set re-render the layer, and the paint panel's textures.
packs.onChange(() => {
    if (canvas?.ready === true) {
        setupDrawLayer();
    }
    paint.refresh();
});

/** Shared across canvases so a stamp variant's silhouette is traced once per session. */
const silhouettes = createSilhouetteSource();

/** Scene-px radius within which a click grabs a control-point handle in edit mode. */
const EDIT_PICK_TOL = 10;

/** Scene-px radius within which a click grabs a room wall segment in door mode. */
const WALL_PICK_TOL = 16;

/** The paint brush outline: a light ring (screen px) inside a dark one, readable on any ground. */
const CURSOR_RING = { width: 1.5, light: 0xffffff, dark: 0x000000, alpha: 0.9 } as const;

/** Pointer button ids. */
const PRIMARY_BUTTON = 0;
const SECONDARY_BUTTON = 2;

function localPoint(pointerEvent: PIXI.FederatedPointerEvent, container: PIXI.Container): Point {
    const p = pointerEvent.getLocalPosition(container);
    return { x: p.x, y: p.y };
}

function teardown(): void {
    if (state) {
        // Particles run outside the layer's container, so a rebuild without a canvas redraw would leave them going.
        state.renderer.clear();
        state.container.destroy({ children: true });
        state.terrain.destroy({ children: true });
        state = null;
    }
}

/**
 * Take the pointer over the whole scene while a tool is active, and give it
 * back to Foundry's own layers while idle. A PIXI container without a hit
 * area is hit only through what it has drawn, so clicks on empty canvas
 * would never reach the tools.
 */
function capturePointer(container: PIXI.Container, capture: boolean): void {
    container.eventMode = capture ? 'static' : 'none';
    container.hitArea = capture ? canvas?.dimensions?.rect ?? null : null;
}

/** The mode a scene-control tool puts the layer in, with the texture and room materials last chosen in their panels. */
function toolMode(toolName: string, active: boolean): Mode {
    return modeForTool(toolName, active, { paint: paint.current().biome, room: materials.forNewRooms() });
}

/** Enter `mode`, dropping any in-flight gesture. */
function enterMode(st: DrawState, mode: Mode): void {
    capturePointer(st.container, mode.kind !== 'idle');
    st.mode = mode;
    st.drag = null;
    st.painting = false;
    st.cursor.visible = false;
    // A blend stroke cut short by a tool change still lands as one undo step.
    if (st.blending) {
        st.blending = false;
        void st.controller.endBlend();
    }
    st.controller.cancel();
    // A clicked shape starts now; a paint stroke starts with its press.
    if (mode.kind === 'brush' && mode.brush.type !== 'stroke') {
        st.controller.begin(mode.brush, 'click');
    }
    // Link lines show only while the link tool is in hand.
    if (mode.kind !== 'link') {
        st.linker.reset();
    }
}

/** Finish the shape being drawn, then start the next one with the same brush. */
async function commitAndContinue(st: DrawState, brush: Brush): Promise<void> {
    await st.controller.commit();
    st.controller.begin(brush, 'click');
}

function onPointerDown(st: DrawState, pointerEvent: PIXI.FederatedPointerEvent): void {
    // A tool's left press is the tool's: left to reach the stage, Foundry would also run its own gestures on it (a
    // Shift long-press pings and pulls every view there, mid-drag). The right button still pans the canvas.
    if (pointerEvent.button === PRIMARY_BUTTON) {
        pointerEvent.stopPropagation();
    }
    const mode = st.mode;
    const pt = localPoint(pointerEvent, st.container);
    switch (mode.kind) {
        case 'idle':
            return;
        case 'stamp':
            if (pointerEvent.button === PRIMARY_BUTTON) {
                packs.placeArmedAt(pt);
            }
            return;
        case 'door':
            doorAt(st.controller, pt);
            return;
        case 'edit': {
            const hit = st.controller.pickVertex(pt, EDIT_PICK_TOL);
            const anchor = hit ? st.controller.getFeature(hit.id)?.points[hit.index] : undefined;
            if (hit && pointerEvent.button === SECONDARY_BUTTON) {
                void st.controller.deleteVertex(hit.id, hit.index);
            } else if (hit && anchor) {
                st.drag = { ...hit, kind: pointerEvent.shiftKey ? 'width' : 'move', anchor };
            }
            return;
        }
        case 'materials':
            openOn(st.controller, pt, (id) => st.controller.roomMaterials(id) !== null, materials.edit);
            return;
        case 'effects':
            openOn(st.controller, pt, (id) => st.controller.areaSettings(id) !== null, effects.edit);
            return;
        case 'pin':
            void placeOrOpen(
                st.controller,
                pt,
                (id) => st.controller.pinSettings(id) !== null,
                async (at) => st.controller.placePin(at),
                pins.edit,
            );
            return;
        case 'label':
            void placeOrOpen(
                st.controller,
                pt,
                (id) => st.controller.labelSettings(id) !== null,
                async (at) => st.controller.placeLabel(at),
                labels.edit,
            );
            return;
        case 'zone':
            void placeOrOpen(
                st.controller,
                pt,
                (id) => st.controller.zoneSettings(id) !== null,
                async (at) => st.controller.placeZone(at),
                zones.edit,
            );
            return;
        case 'erase':
            void st.controller.erase(pt);
            return;
        case 'link':
            void st.linker.click(pt);
            return;
        case 'brush':
            brushDown(st, mode.brush, pt, pointerEvent.button);
    }
}

/** Open a panel on the feature clicked, if it is one the panel is for. */
function openOn(controller: CartographyController, pt: Point, isFor: (id: string) => boolean, openPanel: (id: string) => void): void {
    const hit = controller.hitTest(pt);
    if (hit !== null && isFor(hit)) {
        openPanel(hit);
    }
}

/** A click with the door tool: a plain wall becomes a door; an existing door opens its panel (type, state, remove). */
function doorAt(controller: CartographyController, pt: Point): void {
    const seg = controller.pickWallSegment(pt, WALL_PICK_TOL);
    if (seg && controller.roomDoor(seg.id, seg.index)) {
        doors.edit(seg.id, seg.index);
    } else if (seg) {
        void controller.toggleDoor(seg.id, seg.index);
    }
}

/** A click with the pin, label or zone tool: open the one clicked, or place a new one there and open that. */
async function placeOrOpen(
    controller: CartographyController,
    pt: Point,
    isOne: (id: string) => boolean,
    place: (at: Point) => Promise<string | null>,
    openPanel: (id: string) => void,
): Promise<void> {
    const hit = controller.hitTest(pt);
    const id = hit !== null && isOne(hit) ? hit : await place(pt);
    if (id !== null) {
        openPanel(id);
    }
}

/** A press with a drawing brush in hand. */
function brushDown(st: DrawState, brush: Brush, pt: Point, button: number): void {
    if (brush.type === 'stroke') {
        paintDown(st, brush.biome, pt, button);
        return;
    }
    if (button === SECONDARY_BUTTON) {
        void commitAndContinue(st, brush);
        return;
    }
    st.controller.addPoint(pt);
}

/**
 * A press with the paint brush: the ground under the brush is painted at
 * once, and the whole press is one stroke — laid as ground, or blended into
 * the level's splat map. The right button only pans.
 */
function paintDown(st: DrawState, biome: BiomeKind, pt: Point, button: number): void {
    if (button !== PRIMARY_BUTTON) {
        return;
    }
    if (paint.current().mode !== 'shapes') {
        st.blending = true;
        blendAt(st, biome, pt);
        return;
    }
    st.controller.cancel();
    st.controller.begin({ type: 'stroke', biome }, 'freehand');
    st.controller.addPoint(pt);
    st.painting = true;
}

/** Draw the paint brush's outline at `pt`, the size the paint panel sets, above everything the layer draws. */
function showCursor(st: DrawState, pt: Point): void {
    const { cursor } = st;
    const screenPx = 1 / (canvas?.stage?.scale.x ?? 1);
    const radius = paint.current().radius;
    cursor.clear();
    cursor.lineStyle(CURSOR_RING.width * 2 * screenPx, CURSOR_RING.dark, CURSOR_RING.alpha).drawCircle(pt.x, pt.y, radius);
    cursor.lineStyle(CURSOR_RING.width * screenPx, CURSOR_RING.light, CURSOR_RING.alpha).drawCircle(pt.x, pt.y, radius);
    cursor.visible = true;
    // Re-adding moves it above any fill drawn since.
    st.container.addChild(cursor);
}

/** One dab of the blend brush at `pt`, as the paint panel sets it: its texture, else the ground's own. */
function blendAt(st: DrawState, biome: BiomeKind, pt: Point): void {
    const { radius, strength, mode, texture } = paint.current();
    st.controller.blend({ at: pt, role: texture ?? biome, radius, strength, erase: mode === 'unblend' });
}

function onPointerMove(st: DrawState, pointerEvent: PIXI.FederatedPointerEvent): void {
    const pt = localPoint(pointerEvent, st.container);
    const mode = st.mode;
    if (mode.kind === 'brush' && mode.brush.type === 'stroke') {
        showCursor(st, pt);
        if (st.blending) {
            blendAt(st, mode.brush.biome, pt);
        } else if (st.painting) {
            st.controller.addPoint(pt);
        }
        return;
    }
    if (st.drag?.kind === 'width') {
        st.controller.previewPathWidth(st.drag.id, st.drag.index, distance(st.drag.anchor, pt));
        return;
    }
    if (st.drag) {
        st.controller.previewVertexMove(st.drag.id, st.drag.index, pt);
    }
}

function onPointerUp(st: DrawState, pointerEvent: PIXI.FederatedPointerEvent): void {
    const pt = localPoint(pointerEvent, st.container);
    if (st.blending) {
        st.blending = false;
        void st.controller.endBlend();
        return;
    }
    if (st.drag) {
        const { id, index, kind, anchor } = st.drag;
        st.drag = null;
        if (kind === 'width') {
            void st.controller.setPathWidth(id, index, distance(anchor, pt));
        } else {
            void st.controller.moveVertex(id, index, pt);
        }
        st.controller.clearPreview();
        return;
    }
    if (st.painting) {
        st.painting = false;
        void st.controller.commit();
    }
}

/** (Re)build the draw layer on the current canvas with the active texture pack. */
function setupDrawLayer(): void {
    teardown();
    // The painted map draws beneath tiles and tokens, on the viewed level's floor; the pointer is taken above it all.
    const terrain = createTerrainLayer(canvas?.level?.elevation.bottom ?? 0);
    if (!canvas?.stage || !terrain) {
        return;
    }
    const container = new PIXI.Container();
    capturePointer(container, false);
    canvas.stage.addChild(container);

    // Particles need the scene's levels and grid, which the controller they draw for holds.
    let built: CartographyController | null = null;
    const gridSize = canvas.grid?.size ?? 0;
    const wallBand = gridSize > 0 ? gridSize * WALL_BAND_SQUARES : undefined;
    const renderer = withParticles(
        new GraphicsFeatureRenderer(createPixiSurface(terrain, gridSize), packs.textures(), wallBand),
        canvas.level?.id ?? null,
        () => (built ? { levels: built.levels, gridDistance: built.gridDistance } : null),
    );
    const makeId = (): string => foundry.utils.randomID();
    const controller = new CartographyController({
        renderer,
        splats: createSplatStore(activeScene),
        splatRenderer: createSplatRenderer(terrain, packs.textures(), gridSize),
        store: new FoundrySceneStore(activeScene),
        sink: new FoundryDocumentSink(activeScene, { makeId, modifyBatch, regionName, lightName, soundName }),
        levels: createLevelStore(activeScene),
        scenes: createWorldScenes({ regionName }),
        containers: createItemPilesContainers(() => activeScene()?.id ?? null),
        catalog: packs.catalog,
        silhouettes,
        makeId,
    });
    controller.grid = gridSize > 0 ? { size: gridSize, originX: 0, originY: 0 } : null;
    controller.gridDistance = canvas.scene?.grid.distance ?? 0;
    controller.brushRadius = paint.current().radius;
    controller.movementCost = paint.current().movementCost;
    controller.paintTexture = paint.current().texture;
    applyPathSettings(controller, paths.current());
    built = controller;
    controller.load();
    followViewedLevel(controller);
    void controller.loadSplats();
    levels.refresh();
    // The scene may have been edited under the other terrain setting; only the active GM writes documents.
    if (game.users?.activeGM?.isSelf === true) {
        void controller.setTerrainRegions(terrainRegionsEnabled());
    }

    const st: DrawState = {
        controller,
        renderer,
        container,
        terrain,
        mode: IDLE,
        drag: null,
        painting: false,
        cursor: Object.assign(new PIXI.Graphics(), { eventMode: 'none' as const, visible: false }),
        blending: false,
        linker: createSwitchLinker(controller, container),
    };
    state = st;
    // A redraw keeps Foundry's control group and tool (it re-activates the layer that was active), so a module tool
    // selected in Walls or Tiles is still in hand: pick it straight back up.
    const control = ui.controls?.control;
    const selected = control && ui.controls?.tool ? moduleTool(control.name, ui.controls.tool.name, MODULE_ID) : null;
    if (selected !== null) {
        enterMode(st, toolMode(selected, true));
    }

    container.on('pointerdown', (pointerEvent: PIXI.FederatedPointerEvent) => {
        onPointerDown(st, pointerEvent);
    });
    container.on('pointermove', (pointerEvent: PIXI.FederatedPointerEvent) => {
        onPointerMove(st, pointerEvent);
    });
    // A press released off the layer still ends its stroke.
    for (const released of ['pointerup', 'pointerupoutside'] as const) {
        container.on(released, (pointerEvent: PIXI.FederatedPointerEvent) => {
            onPointerUp(st, pointerEvent);
        });
    }
    container.on('pointerout', () => {
        st.cursor.visible = false;
    });
}

Hooks.on('canvasReady', () => {
    setupDrawLayer();
});

const TERRAIN_REGIONS_SETTING = 'terrainRegions';

declare global {
    interface SettingConfig {
        'zephyrex-cartography.terrainRegions': boolean;
    }
}

function terrainRegionsEnabled(): boolean {
    return game.settings?.get(MODULE_ID, TERRAIN_REGIONS_SETTING) === true;
}

Hooks.once('init', () => {
    game.settings?.register(MODULE_ID, TERRAIN_REGIONS_SETTING, {
        name: I18N.settings.terrainRegionsName,
        hint: I18N.settings.terrainRegionsHint,
        scope: 'world',
        config: true,
        type: Boolean,
        default: false,
        onChange: (on): void => {
            if (state && game.users?.activeGM?.isSelf === true) {
                void state.controller.setTerrainRegions(on);
            }
        },
    });
});

// After every module's init, so a light switch's control extends whatever door control another module configured.
Hooks.once('setup', registerSwitchDoorControl);

type Tool = foundry.applications.ui.SceneControls.Tool;

/** A scene-control button that runs `action` against the live controller. */
function actionTool(toolName: string, order: number, title: string, icon: string, action: (controller: CartographyController) => void): Tool {
    return {
        name: toolName,
        order,
        title,
        icon,
        button: true,
        onChange: (): void => {
            if (state) {
                action(state.controller);
            }
        },
    };
}

/** Put the layer in the mode of the module tool `tool`, as it becomes active or inactive in any control group. */
function activateTool(tool: string, active: boolean): void {
    if (!state) {
        return;
    }
    const mode = toolMode(tool, active);
    enterMode(state, mode);
    if (mode.kind === 'stamp') {
        packs.openBrowser();
    }
    if (tool === 'paint' && active) {
        paint.open();
    }
    if ((tool === 'road' || tool === 'river') && active) {
        paths.open(tool);
    }
}

interface ToolLook {
    readonly title: string;
    readonly icon: string;
}

/** Title and icon of each tool that also sits in a native group. */
const NATIVE_TOOL_LOOKS: Readonly<Record<NativeTool, ToolLook>> = {
    room: { title: I18N.tools.room, icon: 'fa-solid fa-vector-square' },
    materials: { title: I18N.tools.materials, icon: 'fa-solid fa-fill-drip' },
    door: { title: I18N.tools.door, icon: 'fa-solid fa-door-open' },
    stamp: { title: I18N.tools.stamp, icon: 'fa-solid fa-stamp' },
    edit: { title: I18N.tools.edit, icon: 'fa-solid fa-arrows-up-down-left-right' },
    erase: { title: I18N.tools.erase, icon: 'fa-solid fa-eraser' },
    link: { title: I18N.tools.link, icon: 'fa-solid fa-link' },
    effects: { title: I18N.tools.effects, icon: 'fa-solid fa-wand-sparkles' },
    pin: { title: I18N.tools.pin, icon: 'fa-solid fa-map-pin' },
    label: { title: I18N.tools.label, icon: 'fa-solid fa-font' },
    zone: { title: I18N.tools.zone, icon: 'fa-solid fa-circle-radiation' },
};

/** Every pointer tool, by name, in toolbar order: paths, painting, then the tools native groups share. */
function pointerTools(): [string, ToolLook][] {
    return [
        ['road', { title: I18N.tools.road, icon: 'fa-solid fa-road' }],
        ['river', { title: I18N.tools.river, icon: 'fa-solid fa-water' }],
        ['paint', { title: I18N.tools.paint, icon: 'fa-solid fa-paintbrush' }],
        ...Object.entries(NATIVE_TOOL_LOOKS),
    ];
}

/**
 * Add the module's tools to Foundry's own groups (rooms and doors with the
 * Walls tools, stamps with the Tiles tools), after Foundry's tools. They set
 * none of `interaction`, `creation` or `control`, so the native layer stays
 * inert while one is active and the draw layer takes the pointer.
 */
function addNativeTools(controls: Record<string, foundry.applications.ui.SceneControls.Control>): void {
    for (const group of NATIVE_GROUPS) {
        // Every v14 group comes with its tools; one without (another module's rewrite) is left alone.
        const groupTools = controls[group]?.tools;
        if (!groupTools) {
            continue;
        }
        const after = Math.max(0, ...Object.values(groupTools).map((tool) => tool.order)) + 1;
        NATIVE_TOOLS[group].forEach((tool, i) => {
            const look = NATIVE_TOOL_LOOKS[tool];
            const toolName = nativeToolName(tool);
            groupTools[toolName] = {
                name: toolName,
                order: after + i,
                title: look.title,
                icon: look.icon,
                onChange: (_event, active): void => {
                    activateTool(tool, active);
                },
            };
        });
    }
}

Hooks.on('getSceneControlButtons', (controls) => {
    addNativeTools(controls);
    const modeTools = pointerTools().filter(([toolName]) => inOwnGroup(toolName));
    const tools: Record<string, Tool> = {};
    modeTools.forEach(([toolName, { title, icon }], order) => {
        tools[toolName] = { name: toolName, order, title, icon };
    });
    tools['undo'] = actionTool('undo', modeTools.length, I18N.tools.undo, 'fa-solid fa-rotate-left', (controller) => {
        void controller.undo();
    });
    tools['levels'] = {
        name: 'levels',
        order: modeTools.length + 2,
        title: I18N.tools.levels,
        icon: 'fa-solid fa-layer-group',
        button: true,
        onChange: (): void => {
            levels.openPanel();
        },
    };
    tools['generator'] = {
        name: 'generator',
        order: modeTools.length + 3,
        title: I18N.tools.generator,
        icon: 'fa-solid fa-wand-magic-sparkles',
        button: true,
        onChange: (): void => {
            generator.open();
        },
    };
    tools['redo'] = actionTool('redo', modeTools.length + 1, I18N.tools.redo, 'fa-solid fa-rotate-right', (controller) => {
        void controller.redo();
    });
    controls[MODULE_ID] = {
        name: MODULE_ID,
        order: 100,
        title: I18N.controlsGroup,
        icon: 'fa-solid fa-map',
        tools,
        activeTool: 'road',
        onChange: (_event, active): void => {
            if (state && !active) {
                enterMode(state, IDLE);
            }
        },
        onToolChange: (_event, tool, active): void => {
            activateTool(tool.name, active);
        },
    };
});
