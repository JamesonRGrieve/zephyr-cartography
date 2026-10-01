// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Pure translation from the core's document specs to Foundry create data:
 * door, sense and movement enums, scene px to scene distance units, native
 * Level membership, and teleport behaviours. It has no Foundry runtime
 * dependency, so it is unit-tested even though it sits at the boundary.
 */
import type { TileFrame } from '../canvas/controller';
import { rectangleOf } from '../geometry/rectangle';
import type { Point } from '../geometry/spline';
import { MODULE_ID } from '../module-id';
import type { HazardKind } from '../stamps/schema';
import { type AreaEffect, DARKNESS_MODES, type RegionVisibility, TEXT_VISIBILITIES } from '../tools/area-effects';
import type {
    DoorState,
    DoorType,
    DrawingDoc,
    LightDoc,
    NoteDoc,
    RegionBehaviour,
    RegionDoc,
    RegionGeometry,
    SenseLevel,
    SoundDoc,
    TileDoc,
    WallDirection,
    WallDoc,
    WallThreshold,
} from '../tools/documents';
import { regionColour } from '../tools/region-colours';
import { type Environment, FOG_MODE_IDS, type SceneSettings } from '../tools/scene-settings';
import { absoluteCells } from '../tools/zone';
import type {
    AreaEffectBehaviour,
    AreaEffectBehaviourBody,
    DrawingCreateData,
    LightCreateData,
    NoteCreateData,
    RegionCreateData,
    RegionShape,
    SceneSettingsUpdate,
    SoundCreateData,
    TileCreateData,
    TokenFootprint,
    WallCreateData,
} from './boundary';

/** A scene's settings as the partial Scene update Foundry takes; settings not given are left out, so they keep their values. */
export function sceneSettingsData(settings: SceneSettings): SceneSettingsUpdate {
    const { darkness, darknessLock, globalLight, tokenVision, fog, fogColours, cycle, base, dark, weather, transition } = settings;
    const environment = {
        ...(darkness === undefined ? {} : { darknessLevel: darkness }),
        ...(darknessLock === undefined ? {} : { darknessLock }),
        ...(globalLight === undefined ? {} : { globalLight: { enabled: globalLight } }),
        ...(cycle === undefined ? {} : { cycle }),
        ...(base === undefined ? {} : { base: environmentData(base) }),
        ...(dark === undefined ? {} : { dark: environmentData(dark) }),
    };
    const colors = {
        ...(fogColours?.explored === undefined ? {} : { explored: fogColours.explored }),
        ...(fogColours?.unexplored === undefined ? {} : { unexplored: fogColours.unexplored }),
    };
    const fogData = { ...(fog === undefined ? {} : { mode: FOG_MODE_IDS[fog] }), ...(Object.keys(colors).length === 0 ? {} : { colors }) };
    return {
        ...(Object.keys(environment).length === 0 ? {} : { environment }),
        ...(tokenVision === undefined ? {} : { tokenVision }),
        ...(Object.keys(fogData).length === 0 ? {} : { fog: fogData }),
        ...(weather === undefined ? {} : { weather }),
        ...(transition === undefined ? {} : { transition }),
    };
}

/** A lighting environment's given values; those left out keep theirs. */
function environmentData(environment: Environment): NonNullable<NonNullable<SceneSettingsUpdate['environment']>['base']> {
    const { hue, intensity, luminosity, saturation, shadows } = environment;
    return {
        ...(hue === undefined ? {} : { hue }),
        ...(intensity === undefined ? {} : { intensity }),
        ...(luminosity === undefined ? {} : { luminosity }),
        ...(saturation === undefined ? {} : { saturation }),
        ...(shadows === undefined ? {} : { shadows }),
    };
}

/** `CONST.WALL_DOOR_TYPES`. */
const DOOR_TYPES: Record<DoorType, number> = { none: 0, door: 1, secret: 2 };

/** `CONST.WALL_DOOR_STATES`. */
const DOOR_STATES: Record<DoorState, number> = { closed: 0, open: 1, locked: 2 };

const DOOR_STATE_NAMES: readonly DoorState[] = ['closed', 'open', 'locked'];

/** `CONST.EDGE_SENSE_TYPES`. */
const SENSE_TYPES: Record<SenseLevel, number> = { none: 0, limited: 10, normal: 20, proximity: 30, distance: 40 };

/** `CONST.EDGE_DIRECTIONS`. */
const DIRECTIONS: Record<WallDirection, number> = { both: 0, left: 1, right: 2 };

/** `CONST.REGION_VISIBILITY.LAYER`: shown on the Regions layer, locked or not. */
const REGION_VISIBILITY_LAYER = 0;

/** `CONST.WALL_MOVEMENT_TYPES`: NONE and NORMAL. */
const MOVE_NONE = 0;
const MOVE_NORMAL = 20;

export interface SceneGrid {
    /** Px per grid square. */
    readonly size: number;
    /** Scene distance units per grid square. */
    readonly distance: number;
}

/** The door state for a wall's `ds` value, or null for a value Foundry does not define. */
export function doorStateFromDs(ds: number): DoorState | null {
    return DOOR_STATE_NAMES.find((state) => DOOR_STATES[state] === ds) ?? null;
}

/** A wall threshold from grid units to the scene's distance units; a sense without one is unbounded (null). */
function thresholdData(threshold: WallThreshold, grid: SceneGrid): NonNullable<WallCreateData['threshold']> {
    const distance = (gridUnits: number | undefined): number | null => (gridUnits === undefined ? null : gridUnits * grid.distance);
    return {
        light: distance(threshold.light),
        sight: distance(threshold.sight),
        sound: distance(threshold.sound),
        attenuation: threshold.attenuation ?? false,
    };
}

/** Native Level membership, with any other levels it shows on; left out (every level) for a document on no level. */
function levelsField(level: string | null, seenFrom: readonly string[] = []): { levels?: string[] } {
    return level === null ? {} : { levels: [level, ...seenFrom] };
}

export function wallCreateData(wall: WallDoc, grid: SceneGrid): WallCreateData {
    return {
        c: [wall.a.x, wall.a.y, wall.b.x, wall.b.y],
        door: DOOR_TYPES[wall.door],
        ds: DOOR_STATES[wall.doorState],
        sight: SENSE_TYPES[wall.blocks.sight],
        light: SENSE_TYPES[wall.blocks.light],
        sound: SENSE_TYPES[wall.blocks.sound],
        move: wall.blocks.movement ? MOVE_NORMAL : MOVE_NONE,
        ...(wall.direction === undefined ? {} : { dir: DIRECTIONS[wall.direction] }),
        ...(wall.threshold === undefined ? {} : { threshold: thresholdData(wall.threshold, grid) }),
        ...doorLookData(wall),
        ...levelsField(wall.level),
        ...wallFlags(wall),
    };
}

/** What the module notes on a wall for others to read: a light switch, the cover it grades; nothing for a plain wall. */
function wallFlags(wall: WallDoc): Pick<WallCreateData, 'flags'> {
    const own: { lightSwitch?: true; cover?: number } = {
        ...(wall.lightSwitch === true ? { lightSwitch: true as const } : {}),
        ...(wall.cover === undefined ? {} : { cover: wall.cover }),
    };
    return Object.keys(own).length === 0 ? {} : { flags: { [MODULE_ID]: own } };
}

/** A door's sound and animation, each left to Foundry's default when unset; nothing for a plain wall. */
function doorLookData(wall: WallDoc): Pick<WallCreateData, 'doorSound' | 'animation'> {
    if (wall.door === 'none' || wall.look === undefined) {
        return {};
    }
    const { sound, animation } = wall.look;
    return { ...(sound === null ? {} : { doorSound: sound }), ...(animation === null ? {} : { animation: { ...animation } }) };
}

/** A pin's Note; Foundry's own icon when the pin has none. Note positions are whole pixels. */
export function noteCreateData(note: NoteDoc): NoteCreateData {
    return {
        x: Math.round(note.x),
        y: Math.round(note.y),
        elevation: note.elevation,
        text: note.text,
        entryId: note.entry,
        pageId: note.page,
        global: note.global,
        ...(note.icon === null ? {} : { texture: { src: note.icon } }),
        ...(note.size === null ? {} : { iconSize: note.size }),
        ...(note.readable ? { author: null, flags: { [MODULE_ID]: { readable: true } } } : {}),
        ...levelsField(note.level),
    };
}

/** `CONST.DRAWING_FILL_TYPES` NONE and SOLID. */
const DRAWING_FILL_NONE = 0;
const DRAWING_FILL_SOLID = 1;

/** A label's Drawing: text only (no fill, no stroke), its box placed by its top-left corner and turned about its centre. */
export function drawingCreateData(drawing: DrawingDoc): DrawingCreateData {
    const { width, height } = drawing;
    const placed = {
        x: Math.round(drawing.x - width / 2),
        y: Math.round(drawing.y - height / 2),
        elevation: drawing.elevation,
        rotation: drawing.rotation,
        ...levelsField(drawing.level),
    };
    if (drawing.kind === 'shape') {
        const { style } = drawing;
        return {
            ...placed,
            shape: { type: drawing.shape, width, height, ...(drawing.shape === 'p' ? { points: [...drawing.points] } : {}) },
            strokeWidth: style.strokeWidth,
            strokeColor: style.strokeColour,
            strokeAlpha: style.strokeAlpha,
            ...(style.fillColour === null
                ? { fillType: DRAWING_FILL_NONE }
                : { fillType: DRAWING_FILL_SOLID, fillColor: style.fillColour, fillAlpha: style.fillAlpha }),
            hidden: style.hidden,
        };
    }
    return {
        ...placed,
        shape: { type: 'r', width, height },
        fillType: DRAWING_FILL_NONE,
        strokeWidth: 0,
        text: drawing.text,
        fontSize: drawing.fontSize,
        fontFamily: drawing.fontFamily,
        textColor: drawing.colour,
        hidden: drawing.hidden,
    };
}

/** Scene px to scene distance units (a light's radius is measured in the scene's distance units). */
export function pxToDistance(px: number, grid: SceneGrid): number {
    return grid.size > 0 ? (px / grid.size) * grid.distance : 0;
}

export function lightCreateData(light: LightDoc, grid: SceneGrid, displayName: string): LightCreateData {
    return {
        name: displayName,
        x: light.x,
        y: light.y,
        elevation: light.elevation,
        rotation: light.rotation ?? 0,
        config: {
            dim: pxToDistance(light.dim, grid),
            bright: pxToDistance(light.bright, grid),
            ...(light.color === undefined ? {} : { color: light.color }),
            ...(light.alpha === undefined ? {} : { alpha: light.alpha }),
            ...(light.angle === undefined ? {} : { angle: light.angle }),
            ...(light.animation === undefined ? {} : { animation: light.animation }),
            ...lightConfigTechnique(light.technique),
        },
        walls: light.technique?.walls,
        vision: light.technique?.vision,
        hidden: light.technique?.hidden,
        ...levelsField(light.level),
    };
}

/** `AdaptiveLightingShader.SHADER_TECHNIQUES` ids (v14): 0–10, then 100 and 101 for the attenuation techniques. */
const COLORATION_IDS: Readonly<Record<NonNullable<NonNullable<LightDoc['technique']>['coloration']>, number>> = {
    legacy: 0,
    luminance: 1,
    internalHalo: 2,
    externalHalo: 3,
    colorBurn: 4,
    internalBurn: 5,
    externalBurn: 6,
    lowAbsorption: 7,
    highAbsorption: 8,
    invertAbsorption: 9,
    naturalLight: 10,
    naturalAttenuation: 100,
    adaptiveAttenuation: 101,
};

/** A light's rendering settings inside its `config`; anything left out stays undefined and takes Foundry's default. */
function lightConfigTechnique(technique: LightDoc['technique']): Partial<LightCreateData['config']> {
    if (technique === undefined) {
        return {};
    }
    const { negative, priority, coloration, luminosity, attenuation, saturation, contrast, shadows, darkness } = technique;
    return {
        darkness,
        negative,
        priority,
        coloration: coloration === undefined ? undefined : COLORATION_IDS[coloration],
        luminosity,
        attenuation,
        saturation,
        contrast,
        shadows,
    };
}

export function soundCreateData(sound: SoundDoc, grid: SceneGrid, displayName: string): SoundCreateData {
    return {
        name: displayName,
        x: sound.x,
        y: sound.y,
        elevation: sound.elevation,
        radius: pxToDistance(sound.radius, grid),
        path: sound.path,
        volume: sound.volume,
        repeat: sound.repeat,
        walls: sound.walls,
        easing: sound.easing,
        ...levelsField(sound.level),
    };
}

/**
 * A tile sits at its texture anchor and rotates about it. The core's frames
 * are an unrotated top-left and a rotation about the centre, so tiles are
 * anchored at their centre.
 */
const TILE_ANCHOR = 0.5;

/** A tile as Foundry reports it: its anchor point, size, rotation and anchor. */
export interface TileSource {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly rotation: number;
    readonly texture: { readonly anchorX: number; readonly anchorY: number };
}

/** The core's frame (unrotated top-left) of a tile, whatever anchor a GM gave it. */
export function tileFrame(tile: TileSource): TileFrame {
    return {
        x: tile.x - tile.texture.anchorX * tile.width,
        y: tile.y - tile.texture.anchorY * tile.height,
        width: tile.width,
        height: tile.height,
        rotation: tile.rotation,
    };
}

/** `CONST.OCCLUSION_MODES` (v14): combined as a set on the tile. */
const OCCLUSION_MODES: Readonly<Record<NonNullable<NonNullable<TileDoc['look']>['occlusion']>['modes'][number], number>> = {
    fade: 1,
    surface: 2,
    radial: 4,
    vision: 8,
};

/**
 * The tile's own behaviour, as its pack declares it. Anything the pack leaves
 * out stays undefined, which never reaches Foundry (undefined keys are dropped
 * on the way), so Foundry's defaults apply.
 */
function tileLookData(look: TileDoc['look']): Pick<TileCreateData, 'alpha' | 'hidden' | 'occlusion' | 'restrictions' | 'video'> {
    if (look === undefined) {
        return {};
    }
    const { occlusion } = look;
    return {
        alpha: look.alpha,
        hidden: look.hidden,
        occlusion: occlusion === undefined ? undefined : { modes: occlusion.modes.map((mode) => OCCLUSION_MODES[mode]), alpha: occlusion.alpha },
        restrictions: look.restrictions,
        video: look.video,
    };
}

/** A tile texture's horizontal scale that flips its image left to right. */
const MIRRORED = -1;

export function tileCreateData(tile: TileDoc): TileCreateData {
    return {
        name: tile.name,
        texture: {
            src: tile.src,
            anchorX: TILE_ANCHOR,
            anchorY: TILE_ANCHOR,
            alphaThreshold: tile.look?.alphaThreshold,
            ...(tile.mirror === true ? { scaleX: MIRRORED } : {}),
        },
        ...tileLookData(tile.look),
        // Always said, Foundry's own default when unsaid: a tile updated in place keeps a key left out, so a trap sprung
        // to a variant that no longer hides would otherwise stay hidden.
        hidden: tile.look?.hidden ?? false,
        // Foundry stores tile positions as integers; round here so the read-back matches.
        x: Math.round(tile.x + tile.width * TILE_ANCHOR),
        y: Math.round(tile.y + tile.height * TILE_ANCHOR),
        width: tile.width,
        height: tile.height,
        rotation: tile.rotation,
        elevation: tile.elevation,
        flags: { [MODULE_ID]: { featureId: tile.featureId } },
        ...levelsField(tile.level, tile.seenFrom),
    };
}

function flatten(points: readonly Point[]): number[] {
    return points.flatMap((p) => [p.x, p.y]);
}

/**
 * A region's outline as a native shape: a rectangle (centred on its anchor,
 * turned by its rotation) where the outline is one, as rooms and stamp
 * footprints are, so the GM edits it as Foundry's own rectangle; otherwise a
 * polygon.
 */
export function regionShape(polygon: readonly Point[]): RegionShape {
    const rectangle = rectangleOf(polygon);
    if (rectangle === null) {
        return { type: 'polygon', points: flatten(polygon), hole: false };
    }
    const { centre, width, height, rotation } = rectangle;
    return { type: 'rectangle', x: centre.x, y: centre.y, width, height, anchorX: CENTRE_ANCHOR, anchorY: CENTRE_ANCHOR, rotation, hole: false };
}

/** A shape anchored at its centre. */
const CENTRE_ANCHOR = 0.5;

/** A zone's shape as Foundry's own shape data; a rectangle is centred on the zone's point. */
export function geometryShape(geometry: RegionGeometry, token: TokenFootprint | null): RegionShape {
    const { x, y, rotation, gridBased } = geometry;
    const placed = { x, y, gridBased, hole: false };
    switch (geometry.kind) {
        case 'emanation':
            // Round the token's own footprint, which Foundry keeps fitted to the token; a circle while it has none.
            return token
                ? { type: 'emanation', base: { type: 'token', ...token, hole: false }, radius: geometry.radius, gridBased, hole: false }
                : { type: 'circle', ...placed, radius: geometry.radius };
        case 'circle':
            return { type: 'circle', ...placed, radius: geometry.radius };
        case 'ellipse':
            return { type: 'ellipse', ...placed, radiusX: geometry.radiusX, radiusY: geometry.radiusY, rotation };
        case 'ring':
            return { type: 'ring', ...placed, radius: geometry.radius, innerWidth: geometry.innerWidth, outerWidth: geometry.outerWidth };
        case 'cone':
            return { type: 'cone', ...placed, radius: geometry.radius, angle: geometry.angle, rotation, curvature: geometry.curvature };
        case 'line':
            return { type: 'line', ...placed, length: geometry.length, width: geometry.width, rotation };
        case 'cells':
            // Foundry's grid-spaces shape: the spaces themselves, by row and column.
            return { type: 'grid', offsets: absoluteCells({ x, y }, geometry), origin: null, hole: false };
        case 'rectangle':
            break;
    }
    const { width, height } = geometry;
    return { type: 'rectangle', ...placed, width, height, anchorX: CENTRE_ANCHOR, anchorY: CENTRE_ANCHOR, rotation };
}

/** A Scene Region's UUID. */
export function regionUuid(scene: string, region: string): string {
    return `Scene.${scene}.Region.${region}`;
}

/** The colour a hazard's warning scrolls up in: a warning amber. */
const HAZARD_COLOUR = '#f1c40f';

/**
 * A region's native behaviour.
 * - A hazard scrolls its warning, in the GM's language (`hazardText`), up over
 *   a token coming into it, for everyone to see.
 * - A teleport names its destinations by region UUID, and travels as its link
 *   says: where the token lands and whether it snaps there, whether players
 *   see where it leads, the prompt and the scene transition. The token
 *   chooses when there is more than one way to go.
 * - `changeLevel`: which levels it offers comes from the region's own level
 *   membership; its movement actions are the ones that take it (none: any,
 *   `movementActions` since 14.361).
 * - A floor is a `defineSurface` at the region's bottom that restricts every
 *   sense and movement and occludes what is beneath.
 */
export function behaviourData(behaviour: RegionBehaviour | null, hazardText: (kind: HazardKind) => string): RegionCreateData['behaviors'] {
    if (behaviour === null) {
        return [];
    }
    if (behaviour.kind === 'hazard') {
        // Scrolled up over a token coming into it, for everyone to see; the harm itself is the GM's to add.
        return [
            {
                type: 'displayScrollingText',
                system: {
                    events: ['tokenAnimateIn'],
                    text: hazardText(behaviour.hazard),
                    color: HAZARD_COLOUR,
                    visibility: TEXT_VISIBILITIES.indexOf('anyone'),
                    once: false,
                },
            },
        ];
    }
    if (behaviour.kind === 'changeLevel') {
        return [{ type: 'changeLevel', system: { movementActions: behaviour.movement } }];
    }
    if (behaviour.kind === 'surface') {
        return [
            {
                type: 'defineSurface',
                system: { placement: behaviour.placement, light: true, move: true, sight: true, sound: true, occlusion: true, exposure: behaviour.reveal },
            },
        ];
    }
    if (behaviour.kind === 'terrain') {
        return [{ type: 'modifyMovementCost', system: { difficulties: behaviour.difficulties } }];
    }
    const destinations = behaviour.targets.map((target) => regionUuid(target.scene, target.region));
    const { placement, snap, revealed, transition, duration, prompt: question } = behaviour.travel;
    return [
        {
            type: 'teleportToken',
            system: {
                destinations,
                placement,
                snap,
                choice: destinations.length > 1,
                revealed,
                // One prompt whether or not the destination is revealed.
                dialog: { revealed: question, unrevealed: question },
                transition: { type: transition, duration },
            },
        },
    ];
}

/**
 * An area effect as its native behaviour. Modes and visibilities are the
 * behaviour types' numeric enums, in the order the core lists them.
 */
/**
 * The id of effect `index`'s behaviour on region `region`, chosen up front so
 * a toggle can name it. It is unique within the region, which is all an
 * embedded id needs to be, and a valid 16-character document id.
 */
export function effectBehaviourId(region: string, index: number): string {
    return `${region.slice(0, BEHAVIOUR_ID_PREFIX)}Bh${index.toString(BASE36).padStart(2, '0')}`;
}

/** Characters of the region id an effect behaviour's id keeps: 16 less the `Bh` and a two-digit index. */
const BEHAVIOUR_ID_PREFIX = 12;

const BASE36 = 36;

/** Where the behaviour `index` of an area's region sits, for the others to name. */
interface BehaviourPlace {
    readonly scene: string;
    readonly region: string;
}

/** An area's behaviours: each with its id chosen up front, starting disabled if it says so, a toggle naming its targets by UUID. */
export function effectBehaviours(effects: readonly AreaEffect[], place: BehaviourPlace): AreaEffectBehaviour[] {
    const uuidOf = (index: number): string => `${regionUuid(place.scene, place.region)}.RegionBehavior.${effectBehaviourId(place.region, index)}`;
    return effects.map((effect, index) => ({
        _id: effectBehaviourId(place.region, index),
        ...(effect.kind === 'toggle'
            ? {
                  type: 'toggleBehavior' as const,
                  system: { events: [...effect.events], enable: effect.enable.map(uuidOf), disable: effect.disable.map(uuidOf) },
              }
            : effectBehaviour(effect)),
        ...(effect.disabled === true ? { disabled: true } : {}),
    }));
}

function effectBehaviour(effect: Exclude<AreaEffect, { readonly kind: 'toggle' }>): Exclude<AreaEffectBehaviourBody, { readonly type: 'toggleBehavior' }> {
    switch (effect.kind) {
        case 'darkness':
            return { type: 'adjustDarknessLevel', system: { mode: DARKNESS_MODES.indexOf(effect.mode), modifier: effect.modifier } };
        case 'suppressWeather':
            return { type: 'suppressWeather', system: {} };
        case 'text':
            return {
                type: 'displayScrollingText',
                system: {
                    events: [...effect.events],
                    text: effect.text,
                    color: effect.colour,
                    visibility: TEXT_VISIBILITIES.indexOf(effect.visibility),
                    once: effect.once,
                },
            };
        case 'pause':
            return { type: 'pauseGame', system: { once: effect.once } };
        case 'macro':
            return { type: 'executeMacro', system: { events: [...effect.events], uuid: effect.uuid, everyone: effect.everyone } };
        case 'script':
            return { type: 'executeScript', system: { events: [...effect.events], source: effect.source } };
        case 'activeEffect':
            break;
    }
    return { type: 'applyActiveEffect', system: { effects: [...effect.effects] } };
}

/** The levels a region sits on: its own, and those it spans; none (every level) for a level-less region. */
function regionLevels(region: RegionDoc): { readonly levels?: readonly string[] } {
    if (region.level === null) {
        return {};
    }
    return { levels: [...new Set([region.level, ...region.spans])] };
}

/** Where regions are written: how each is named, the scene they are on, and the footprints of its tokens (null for one not there). */
export interface RegionContext {
    readonly nameOf: (region: RegionDoc) => string;
    /** A hazard's warning in the GM's language: "Fire!". */
    readonly hazardText: (kind: HazardKind) => string;
    readonly scene: string;
    readonly tokenOf: (id: string) => TokenFootprint | null;
}

/**
 * Create data for the regions of one plan, whose ids are chosen up front
 * (`ids[i]` for `regions[i]`).
 */
export function regionCreateData(regions: readonly RegionDoc[], ids: readonly string[], context: RegionContext): RegionCreateData[] {
    const { nameOf, scene, tokenOf } = context;
    return regions.map((region, i) => ({
        _id: ids[i] ?? '',
        name: nameOf(region),
        color: regionColour(region),
        shapes: [
            region.geometry === undefined
                ? regionShape(region.polygon)
                : geometryShape(region.geometry, region.attachedTo === undefined ? null : tokenOf(region.attachedTo)),
        ],
        ...(region.attachedTo === undefined ? {} : { attachment: { token: region.attachedTo } }),
        elevation: { bottom: region.bottom, top: region.top },
        behaviors: [...behaviourData(region.behaviour, context.hazardText), ...effectBehaviours(region.effects ?? [], { scene, region: ids[i] ?? '' })],
        // A region drawn from a feature is edited through the feature, so it is locked and
        // shown on the Regions layer unless the GM chose otherwise. An interior exit is the GM's to place, so it stays free.
        locked: region.label.kind !== 'exit',
        ...displayData(region),
        ...regionLevels(region),
    }));
}

/** `CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER`. */
const OWNERSHIP_OBSERVER = 2;

/** `CONST.REGION_VISIBILITY` values. */
const VISIBILITY_IDS: Readonly<Record<RegionVisibility, number>> = { layer: REGION_VISIBILITY_LAYER, gamemaster: 1, always: 2, observer: 3 };

/**
 * How a region shows, and its restriction. Foundry restricts only a region on
 * exactly one level (and refuses the create otherwise), so a region on every
 * level, or spanning several, is left unrestricted.
 */
function displayData(
    region: RegionDoc,
): Pick<RegionCreateData, 'visibility' | 'highlightMode' | 'displayMeasurements' | 'restriction' | 'ownership' | 'hidden'> {
    const display = region.display;
    if (display === undefined) {
        return { visibility: REGION_VISIBILITY_LAYER };
    }
    const { restriction } = display;
    const onOneLevel = region.level !== null && region.spans.length === 0;
    return {
        visibility: VISIBILITY_IDS[display.visibility],
        highlightMode: display.highlight,
        displayMeasurements: display.measurements,
        ...(restriction !== null && onOneLevel ? { restriction: { enabled: true, ...restriction } } : {}),
        ...(display.observed ? { ownership: { default: OWNERSHIP_OBSERVER } } : {}),
        ...(display.hidden ? { hidden: true } : {}),
    };
}
