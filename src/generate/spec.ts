// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Scene spec v1: a whole map as data. Terrain, paths, rooms with their doors
 * and materials, stamps with their interiors, and the levels they stand on. A
 * generator (ours, or anything that can write JSON) emits one, and it is
 * realised through the same controller API a GM's tools use, so a generated
 * map is made of ordinary features.
 *
 * Single source of truth, like the stamp pack schema: the engine's types, its
 * runtime validation (`parseSceneSpec`) and the published JSON Schema
 * (`schema/scene-spec.v1.schema.json`, via `pnpm schema:gen`) all derive from
 * this file. Changes to v1 are additive only.
 */
import { z } from 'zod';
import {
    DARKNESS_MODES,
    DEFAULT_AREA_DISPLAY,
    HIGHLIGHT_MODES,
    REGION_EVENTS,
    REGION_VISIBILITIES,
    RESTRICTION_TYPES,
    TEXT_EVENTS,
    TEXT_VISIBILITIES,
    TOGGLE_EVENTS,
} from '../tools/area-effects';
import { BIOMES } from '../tools/biome';
import { DOOR_ANIMATIONS, type DoorState } from '../tools/documents';
import { MAX_FONT_SIZE, MIN_FONT_SIZE, NEW_LABEL } from '../tools/label';
import { NO_LEVEL_ART, TEXTURE_FITS } from '../tools/levels';
import type { Liquid, PathKind } from '../tools/path';
import type { RoomDoorType } from '../tools/room';
import { FOG_MODES } from '../tools/scene-settings';
import { DEFAULT_SHAPE_STYLE, SHAPE_KINDS } from '../tools/shape';
import { MAX_SPAWN_COUNT, NO_SPAWN, SPAWN_PLACEMENTS } from '../tools/spawn';
import { MAX_SPLAT_LAYERS } from '../tools/splat';
import { DEFAULT_WALL_PRESET, WALL_PRESETS } from '../tools/wall-presets';
import { CONE_CURVATURES, FULL_TURN, validZoneShape } from '../tools/zone';

export const SCENE_SPEC_SCHEMA_VERSION = 1;

export const SCENE_SPEC_SCHEMA_URL = 'https://raw.githubusercontent.com/JamesonRGrieve/zephyrex-cartography/main/schema/scene-spec.v1.schema.json';

const PATH_KINDS = ['road', 'river'] as const satisfies readonly PathKind[];
const SPEC_LIQUIDS = ['water', 'lava', 'poison', 'acid'] as const satisfies readonly Liquid[];
const DOOR_TYPES = ['door', 'secret'] as const satisfies readonly RoomDoorType[];
const DOOR_STATES = ['closed', 'open', 'locked'] as const satisfies readonly DoorState[];

const text = z.string().min(1);
const point = z.object({ x: z.number(), y: z.number() }).strict();
const positive = z.number().positive();
const biome = z.enum(BIOMES);
const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/u);
const level = text.optional().describe('Key of an entry in `levels`. Omitted: the feature shows on every level.');
const featureKey = text.optional().describe("A name other entries use for this feature, as a light switch's `controls` do.");

const movementCost = z
    .number()
    .min(0)
    .max(5)
    .default(1)
    .describe("Difficult ground: what crossing it on foot costs, times the distance (1 ordinary, 2 mud), as Foundry's Modify Movement Cost.");

const regionEvents = z.array(z.enum(REGION_EVENTS)).default([]).describe("Foundry's region events the behaviour runs on.");

const effectIndex = z.number().int().min(0);

const areaEffectSpec = z
    .discriminatedUnion('kind', [
        z.object({ kind: z.literal('darkness'), mode: z.enum(DARKNESS_MODES).default('override'), modifier: z.number().min(0).max(1).default(0) }).strict(),
        z.object({ kind: z.literal('suppressWeather') }).strict(),
        z
            .object({
                kind: z.literal('text'),
                text: z.string().default(''),
                colour: hexColour.default('#ffffff'),
                visibility: z.enum(TEXT_VISIBILITIES).default('anyone'),
                once: z.boolean().default(false),
                events: z.array(z.enum(TEXT_EVENTS)).default([]),
            })
            .strict(),
        z.object({ kind: z.literal('pause'), once: z.boolean().default(false) }).strict(),
        z
            .object({
                kind: z.literal('macro'),
                uuid: text.nullable().default(null).describe('The Macro to run, by UUID.'),
                everyone: z.boolean().default(false),
                events: regionEvents,
            })
            .strict(),
        z.object({ kind: z.literal('script'), source: z.string().default(''), events: regionEvents }).strict(),
        z.object({ kind: z.literal('activeEffect'), effects: z.array(text).default([]).describe('ActiveEffect UUIDs.') }).strict(),
        z
            .object({
                kind: z.literal('toggle'),
                events: z.array(z.enum(TOGGLE_EVENTS)).default([]),
                enable: z.array(effectIndex).default([]).describe('The behaviours it enables, by their place in this area’s `effects` (from 0).'),
                disable: z.array(effectIndex).default([]).describe('The behaviours it disables, likewise.'),
            })
            .strict(),
    ])
    .and(z.object({ disabled: z.boolean().default(false).describe('Start disabled, for a toggle to enable.') }))
    .describe(
        "A region behaviour on the area, as Foundry's: Adjust Darkness Level, Suppress Weather, Display Scrolling Text, Pause Game, Execute Macro, Execute Script, Apply Active Effect or Toggle Behavior.",
    );

const areaEffects = z
    .array(areaEffectSpec)
    .default([])
    .superRefine((effects, context) => {
        effects.forEach((effect, own) => {
            if (effect.kind !== 'toggle') {
                return;
            }
            const targets = [...effect.enable, ...effect.disable];
            if (targets.some((t) => t >= effects.length || t === own)) {
                context.addIssue({ code: 'custom', path: [own], message: 'A toggle names only other behaviours of its own area.' });
            }
            if (new Set(targets).size < targets.length) {
                context.addIssue({ code: 'custom', path: [own], message: 'A toggle names each behaviour once, to enable or to disable.' });
            }
        });
    })
    .describe("Region behaviours on the area's Scene Region.");

const areaDisplay = z
    .object({
        visibility: z.enum(REGION_VISIBILITIES).default(DEFAULT_AREA_DISPLAY.visibility).describe("Who sees the region, as Foundry's Region visibility."),
        highlight: z.enum(HIGHLIGHT_MODES).default(DEFAULT_AREA_DISPLAY.highlight).describe('Highlight its true shapes, or the grid spaces it covers.'),
        measurements: z.boolean().default(DEFAULT_AREA_DISPLAY.measurements).describe('Show its measurements.'),
        observed: z
            .boolean()
            .default(DEFAULT_AREA_DISPLAY.observed)
            .describe('Make every player an observer of the region, so the "observer" visibility shows it to them.'),
        restriction: z
            .object({ type: z.enum(RESTRICTION_TYPES), priority: z.number().int().min(0).default(0) })
            .strict()
            .nullable()
            .default(null)
            .describe('Shape the region by walls of this type, cast from its origin, so effects stop at walls. Needs a feature on one level.'),
        hidden: z
            .boolean()
            .default(DEFAULT_AREA_DISPLAY.hidden)
            .describe("Hide the region: the GM's alone, its behaviours doing nothing until it is shown (a trap or an ambush)."),
    })
    .strict()
    .default(DEFAULT_AREA_DISPLAY)
    .describe("How the area's Scene Region shows, and whether walls shape it.");

const areaSpawn = z
    .object({
        actors: z
            .array(z.object({ uuid: text.describe("An Actor's UUID."), count: z.number().int().min(1).max(MAX_SPAWN_COUNT).default(1) }).strict())
            .default([]),
        placement: z.enum(SPAWN_PLACEMENTS).default(NO_SPAWN.placement).describe('Anywhere inside, or at the centre.'),
        snap: z.boolean().default(NO_SPAWN.snap).describe('Snap each token to the grid.'),
        avoidOccupied: z.boolean().default(NO_SPAWN.avoidOccupied).describe('Keep off spaces other tokens hold.'),
    })
    .strict()
    .default({ ...NO_SPAWN, actors: [] })
    .describe(
        "Tokens to spawn into the area's Scene Region, for an encounter or reinforcements: the GM spawns them from the area effects panel or the module API.",
    );

const groundTexture = z
    .string()
    .min(1)
    .optional()
    .describe(
        "A texture role from the active set to draw the ground in instead of its biome's (`floor.cobbled-street`, another biome's), which still says what the ground is. A role the set lacks draws as the biome.",
    );

const regionSpec = z
    .object({
        type: z.literal('region'),
        key: featureKey,
        biome,
        texture: groundTexture,
        points: z.array(point).min(3).describe('Boundary control points.'),
        movementCost,
        effects: areaEffects,
        display: areaDisplay,
        spawn: areaSpawn,
        level,
    })
    .strict()
    .describe('A closed, smoothed area of one biome.');

const strokeSpec = z
    .object({
        type: z.literal('stroke'),
        key: featureKey,
        biome,
        texture: groundTexture,
        points: z.array(point).min(1).describe('Centerline; one point is a round dab.'),
        radius: positive.optional().describe('Half-width of the swath (default: the brush default).'),
        movementCost,
        effects: areaEffects,
        display: areaDisplay,
        spawn: areaSpawn,
        level,
    })
    .strict()
    .describe('A painted biome swath along a centerline.');

const pathSpec = z
    .object({
        type: z.literal('path'),
        key: featureKey,
        kind: z.enum(PATH_KINDS),
        points: z.array(point).min(2).describe('Centerline control points.'),
        halfWidth: positive.optional().describe('Half-width at every point (default: the path default).'),
        walls: z
            .union([z.boolean(), z.enum(WALL_PRESETS)])
            .default(false)
            .describe(
                "Walls along the centerline: a wall kind as Foundry's Walls palette names them (solid, terrain, invisible, ethereal, window), true for solid, or false for none.",
            ),
        liquid: z.enum(SPEC_LIQUIDS).optional().describe('What a river carries (default: water). Ignored for a road.'),
        shade: hexColour.optional().describe("A river's liquid colour, #rrggbb (default: the liquid's usual shade)."),
        bed: text.nullable().optional().describe('Texture role of a river\'s bed, e.g. "sand"; null: no bed (default: the liquid\'s usual bed).'),
        level,
    })
    .strict()
    .describe('A road, or a river of water, lava, poison or acid.');

const doorSpec = z
    .object({
        segment: z.number().int().min(0).describe('Perimeter segment index: segment i runs from point i to point i + 1 (the last closes the loop).'),
        type: z.enum(DOOR_TYPES).default('door'),
        state: z.enum(DOOR_STATES).default('closed'),
        sound: text.nullable().default(null).describe('A Foundry door sound key (CONFIG.Wall.doorSounds), e.g. "woodCreaky"; null: Foundry\'s default.'),
        animation: z.enum(DOOR_ANIMATIONS).nullable().default(null).describe("How the door animates open; null: Foundry's default."),
    })
    .strict();

const roomSpec = z
    .object({
        type: z.literal('room'),
        key: featureKey,
        points: z.array(point).min(3).describe('Boundary. Split an edge with a collinear point to put a door on part of it.'),
        floor: z
            .union([biome, z.string().regex(/^floor\..+/)])
            .optional()
            .describe('A biome or a pack "floor.<name>" material (default: the room default).'),
        wall: z
            .string()
            .regex(/^wall\..+/)
            .nullable()
            .default(null)
            .describe('A pack "wall.<name>" material to draw the walls in; null leaves them undrawn.'),
        wallKind: z
            .enum(WALL_PRESETS)
            .default(DEFAULT_WALL_PRESET)
            .describe("What kind of walls, as Foundry's Walls palette names them: solid, terrain, invisible, ethereal or window."),
        ceiling: z.boolean().default(true).describe('Whether a level above gets a ceiling over the room (false for an open courtyard).'),
        lit: z.boolean().default(true).describe('Whether its centre light is on: false for a room lit only by what is in it (a hearth, lamps), or left dark.'),
        movementCost,
        effects: areaEffects,
        display: areaDisplay,
        spawn: areaSpawn,
        doors: z.array(doorSpec).default([]),
        level,
    })
    .strict()
    .describe('A walled room. Rooms sharing an edge on one level share its walls.');

const interiorSpec = z
    .union([
        z.object({ create: text.describe('Name of a new interior scene to create.') }).strict(),
        z.object({ scene: text.describe('Id of an existing scene to link as the interior.') }).strict(),
    ])
    .describe('Where an enterable stamp leads.');

const stampSpec = z
    .object({
        type: z.literal('stamp'),
        key: featureKey,
        stamp: text.describe('Catalog key, "<pack module id>:<stamp id>".'),
        x: z.number().describe('Footprint centre.'),
        y: z.number(),
        variant: z.number().int().min(0).optional(),
        rotation: z.number().optional().describe('Degrees clockwise.'),
        scale: positive.optional().describe('Multiplier over the authored footprint.'),
        interior: interiorSpec.optional(),
        floors: z
            .array(text)
            .min(1)
            .optional()
            .describe(
                "An enterable stamp's floors in this scene instead of an interior: names of Levels added above the scene's top, bottom to top, reached by stairs over the stamp.",
            ),
        controls: z
            .array(text)
            .default([])
            .describe("A light switch's targets: the keys of the lamp stamps (with lit and unlit variants) and rooms it turns on and off."),
        lights: z.array(text).default([]).describe("A light switch's other targets: ids of AmbientLights already on the scene, shown and hidden."),
        level,
    })
    .strict()
    .describe('A stamp from a loaded pack.');

const { tints, alphaThresholds, placement } = NO_LEVEL_ART;
const alpha = z.number().min(0).max(1);

const levelSpec = z
    .object({
        key: text.describe('What features name in their `level`.'),
        name: text,
        existing: z
            .boolean()
            .default(false)
            .describe(
                "Take the scene's lowest level as this one (renamed to `name`) instead of adding a level: a fresh scene's own floor becomes the ground floor, so the scene opens on it. At most one level does, the first listed; a scene with no levels adds it.",
            ),
        bottom: z.number().optional().describe('Floor elevation (scene distance units); with `top`, sets the band.'),
        top: z.number().optional(),
        background: text.optional().describe("Image Foundry draws as this level's background, for this floor alone."),
        foreground: text.optional().describe("Image Foundry draws over this level's tokens (roofs, canopies)."),
        fog: text.optional().describe('Image shown in unexplored fog on this level.'),
        backgroundColor: hexColour.default(NO_LEVEL_ART.backgroundColor).describe('Colour shown where the level has no background image.'),
        tints: z
            .object({ background: hexColour.default(tints.background), foreground: hexColour.default(tints.foreground) })
            .strict()
            .default(tints)
            .describe("The background's and foreground's tints (Foundry's fog image has none since 14.364)."),
        alphaThresholds: z
            .object({ background: alpha.default(alphaThresholds.background), foreground: alpha.default(alphaThresholds.foreground) })
            .strict()
            .default(alphaThresholds)
            .describe("Image pixels less opaque than this let light and weather through (Foundry's Alpha Threshold)."),
        placement: z
            .object({
                anchorX: z.number().default(placement.anchorX),
                anchorY: z.number().default(placement.anchorY),
                offsetX: z.number().int().default(placement.offsetX).describe('Whole pixels.'),
                offsetY: z.number().int().default(placement.offsetY),
                fit: z.enum(TEXTURE_FITS).default(placement.fit),
                scaleX: z
                    .number()
                    .refine((scale) => scale !== 0, 'not 0')
                    .default(placement.scaleX),
                scaleY: z
                    .number()
                    .refine((scale) => scale !== 0, 'not 0')
                    .default(placement.scaleY),
                rotation: z.number().default(placement.rotation).describe('Degrees.'),
            })
            .strict()
            .default(placement)
            .describe("Where the level's images sit (Foundry's Positioning)."),
        visibleLevels: z.array(text).default([]).describe('Keys of the other levels seen from this one.'),
    })
    .strict();

const pinSpec = z
    .object({
        type: z.literal('pin'),
        key: featureKey,
        x: z.number(),
        y: z.number(),
        text: z.string().default('').describe("The note's text label."),
        entry: text.nullable().default(null).describe('Id of the JournalEntry it opens; null: none.'),
        page: text.nullable().default(null).describe('Id of the page within that entry; null: the whole entry.'),
        icon: text.nullable().default(null).describe("The icon's image path; null: Foundry's own."),
        global: z.boolean().default(false).describe('Shown to everyone whatever their tokens see.'),
        level,
    })
    .strict()
    .describe('A map pin: a native Note.');

const labelSpec = z
    .object({
        type: z.literal('label'),
        key: featureKey,
        x: z.number().describe('Centre of the text.'),
        y: z.number(),
        text: text,
        fontSize: z.number().int().min(MIN_FONT_SIZE).max(MAX_FONT_SIZE).default(NEW_LABEL.fontSize).describe('Px.'),
        colour: hexColour.default(NEW_LABEL.colour),
        fontFamily: z.string().default(NEW_LABEL.fontFamily).describe('A font Foundry knows (CONFIG.fontDefinitions); "" for its default.'),
        rotation: z.number().default(NEW_LABEL.rotation).describe('Degrees.'),
        hidden: z.boolean().default(NEW_LABEL.hidden).describe('Seen by the GM alone.'),
        level,
    })
    .strict()
    .describe('A map label: text on the map, as a native Drawing.');

const zoneShapeSpec = z
    .discriminatedUnion('kind', [
        z.object({ kind: z.literal('circle'), radius: positive }).strict(),
        z.object({ kind: z.literal('ellipse'), radiusX: positive, radiusY: positive }).strict(),
        z
            .object({ kind: z.literal('ring'), radius: positive, innerWidth: positive, outerWidth: positive })
            .strict()
            .describe('The band runs from radius − innerWidth to radius + outerWidth.'),
        z
            .object({
                kind: z.literal('cone'),
                radius: positive,
                angle: z.number().positive().max(FULL_TURN).describe('Its spread, in degrees: 90 at most when flat, 180 when a semicircle.'),
                curvature: z.enum(CONE_CURVATURES).default('round'),
            })
            .strict(),
        z.object({ kind: z.literal('line'), length: positive, width: positive }).strict(),
        z.object({ kind: z.literal('rectangle'), width: positive, height: positive }).strict(),
        z
            .object({ kind: z.literal('emanation'), radius: positive })
            .strict()
            .describe("A reach round the attached token's own footprint, kept fitted to it by Foundry; a circle while no token is attached."),
        z
            .object({
                kind: z.literal('cells'),
                cells: z.array(z.object({ i: z.number().int().describe('Rows down.'), j: z.number().int().describe('Columns across.') }).strict()).min(1),
            })
            .strict()
            .describe("Whole spaces of a square grid, from the one the zone's point is in: Foundry's grid-spaces shape."),
    ])
    .describe("One of Foundry's region shapes, sized in the spec's units. A cone or line starts at the zone's point; the rest are centred on it.");

const zoneSpec = z
    .object({
        type: z.literal('zone'),
        key: featureKey,
        x: z.number(),
        y: z.number(),
        shape: zoneShapeSpec,
        name: z.string().default('').describe('The region\'s name; "" for "Zone".'),
        rotation: z.number().default(0).describe('Degrees; a cone or line points this way.'),
        gridBased: z.boolean().default(false).describe('Have Foundry measure the shape in grid units, conforming to the grid.'),
        attachedTo: text.nullable().default(null).describe('Id of a token on the scene the region moves with; null: none.'),
        movementCost,
        effects: areaEffects,
        display: areaDisplay,
        spawn: areaSpawn,
        level,
    })
    .strict()
    .describe("A zone: a Scene Region in one of Foundry's shapes, with a movement cost, behaviours and a display like any area.");

const shapeSpec = z
    .object({
        type: z.literal('shape'),
        key: featureKey,
        kind: z.enum(SHAPE_KINDS),
        points: z.array(point).optional().describe("A polygon's vertices (3 or more) or a line's (2 or more)."),
        x: z.number().optional().describe("A rectangle's or ellipse's centre."),
        y: z.number().optional(),
        width: positive.optional().describe("A rectangle's or ellipse's size."),
        height: positive.optional(),
        rotation: z.number().default(0).describe('Degrees a rectangle or ellipse is turned about its centre.'),
        stroke: z
            .object({
                colour: hexColour.default(DEFAULT_SHAPE_STYLE.strokeColour),
                width: z.number().int().min(0).default(DEFAULT_SHAPE_STYLE.strokeWidth).describe('Px, whatever the spec’s units.'),
                alpha: alpha.default(DEFAULT_SHAPE_STYLE.strokeAlpha),
            })
            .strict()
            .default({ colour: DEFAULT_SHAPE_STYLE.strokeColour, width: DEFAULT_SHAPE_STYLE.strokeWidth, alpha: DEFAULT_SHAPE_STYLE.strokeAlpha }),
        fill: z
            .object({ colour: hexColour, alpha: alpha.default(DEFAULT_SHAPE_STYLE.fillAlpha) })
            .strict()
            .nullable()
            .default(null)
            .describe('A solid fill; null for none.'),
        hidden: z.boolean().default(false).describe('Seen by the GM alone.'),
        level,
    })
    .strict()
    .describe("A drawn shape: a native Drawing, as Foundry's own Drawings tools draw them.");

const featureSpec = z.discriminatedUnion('type', [regionSpec, strokeSpec, pathSpec, roomSpec, stampSpec, pinSpec, labelSpec, zoneSpec, shapeSpec]);

const signed = z.number().min(-1).max(1);

const environmentSpec = z
    .object({
        hue: alpha.optional().describe('0–1, a fraction of the colour wheel.'),
        intensity: alpha.optional().describe('How strongly the hue tints the scene, 0–1.'),
        luminosity: signed.optional(),
        saturation: signed.optional(),
        shadows: alpha.optional(),
    })
    .strict();

const sceneSettingsSpec = z
    .object({
        darkness: z.number().min(0).max(1).optional().describe('Scene darkness, 0 (day) to 1 (night).'),
        darknessLock: z.boolean().optional().describe('Lock the darkness so time of day does not change it.'),
        globalLight: z.boolean().optional().describe("Foundry's global illumination, lighting the whole scene."),
        tokenVision: z.boolean().optional(),
        fog: z.enum(FOG_MODES).optional().describe('Fog of war exploration: disabled, individual (each user their own), or shared.'),
        fogColours: z
            .object({ explored: hexColour.optional(), unexplored: hexColour.optional() })
            .strict()
            .optional()
            .describe("The fog's colours over explored and unexplored ground."),
        cycle: z.boolean().optional().describe('Whether the lighting moves from the base environment to the dark one as darkness rises.'),
        base: environmentSpec.optional().describe('The lighting environment by day.'),
        dark: environmentSpec.optional().describe('The lighting environment at full darkness.'),
        weather: z.string().optional().describe('A Foundry weather effect key (CONFIG.weatherEffects), or "" for none.'),
        transition: z
            .object({
                type: text.nullable().describe('A Foundry scene transition type, or null for none.'),
                duration: z.number().int().min(500).max(10000).optional().describe('Milliseconds.'),
            })
            .strict()
            .optional()
            .describe('The transition shown on entering the scene.'),
    })
    .strict()
    .describe("The scene's own settings, as its config's Basics, Lighting and Ambience tabs set them; only those given change.");

const splatSpec = z
    .object({
        level,
        mask: text.describe(
            'Path to the mask image: an 8-bit RGBA or RGB PNG laid over the whole scene, each channel weighting one texture (RGB leaves the fourth unused).',
        ),
        roles: z
            .tuple([text.nullable(), text.nullable(), text.nullable(), text.nullable()])
            .describe('The texture roles of the red, green, blue and alpha channels, e.g. "sand"; null for a channel not used.'),
    })
    .strict()
    .describe("A level's painted texture blend (its splat map), as the paint tool's Blend brush makes one.");

export const sceneSpecSchema = z
    .object({
        $schema: z.string().optional(),
        schemaVersion: z.literal(SCENE_SPEC_SCHEMA_VERSION),
        units: z.enum(['grid', 'px']).default('grid').describe('Unit of every coordinate, width and radius: grid squares, or scene pixels.'),
        scene: sceneSettingsSpec.optional(),
        levels: z.array(levelSpec).default([]).describe('Levels to add, bottom to top, stacked above any the scene has.'),
        splats: z
            .array(splatSpec)
            .default([])
            .describe('Painted texture blends. A level stacks up to four, bottom to top in the order listed, for sixteen textures.'),
        features: z.array(featureSpec).describe('In drawing order: later features draw above, and earlier rooms own shared walls.'),
    })
    .strict();

export type SceneSpec = z.infer<typeof sceneSpecSchema>;

/** A spec as an author writes it, defaulted fields left out: what the composer emits before it is validated. */
export type SceneSpecInput = z.input<typeof sceneSpecSchema>;

export type FeatureSpec = SceneSpec['features'][number];

export type RoomSpec = z.infer<typeof roomSpec>;

export interface SpecIssue {
    readonly path: string;
    readonly message: string;
}

export type SpecParseResult = { readonly ok: true; readonly spec: SceneSpec } | { readonly ok: false; readonly issues: readonly SpecIssue[] };

/** The keys `entries` declare, and an issue for each one declared twice. */
function declaredKeys(entries: readonly { readonly key?: string | undefined }[], path: string, what: string): { keys: Set<string>; issues: SpecIssue[] } {
    const keys = new Set<string>();
    const issues: SpecIssue[] = [];
    entries.forEach((entry, i) => {
        if (entry.key === undefined) {
            return;
        }
        if (keys.has(entry.key)) {
            issues.push({ path: `${path}.${i}.key`, message: `duplicate ${what} key "${entry.key}"` });
        }
        keys.add(entry.key);
    });
    return { keys, issues };
}

/** An issue for each of `named` that is not one of `keys`, at `pathOf` its index. */
function unresolved(named: readonly string[], keys: ReadonlySet<string>, pathOf: (index: number) => string, what: string): SpecIssue[] {
    return named.flatMap((reference, j) => (keys.has(reference) ? [] : [{ path: pathOf(j), message: `no ${what} with key "${reference}"` }]));
}

/** Splat maps on levels the spec does not have, and more on one level than its stack holds. */
function splatIssues(splats: SceneSpec['splats'], levelKeys: ReadonlySet<string>): SpecIssue[] {
    const counts = new Map<string, number>();
    return splats.flatMap((splat, i) => {
        const on = splat.level ?? '';
        const count = (counts.get(on) ?? 0) + 1;
        counts.set(on, count);
        return [
            ...unresolved(splat.level === undefined ? [] : [splat.level], levelKeys, () => `splats.${i}.level`, 'level'),
            ...(count > MAX_SPLAT_LAYERS ? [{ path: `splats.${i}.level`, message: `a level stacks ${MAX_SPLAT_LAYERS} splat maps at most` }] : []),
        ];
    });
}

/** Doors on segments the room does not have. */
function doorIssues(f: FeatureSpec, i: number): SpecIssue[] {
    if (f.type !== 'room') {
        return [];
    }
    return f.doors.flatMap((d, j) =>
        d.segment < f.points.length ? [] : [{ path: `features.${i}.doors.${j}.segment`, message: `the room has only ${f.points.length} segments` }],
    );
}

/** A drawn shape missing what its kind stands on: a box's centre and size, a polygon's three vertices or a line's two. */
function shapeIssues(f: FeatureSpec, i: number): SpecIssue[] {
    if (f.type !== 'shape') {
        return [];
    }
    const boxed = f.kind === 'rectangle' || f.kind === 'ellipse';
    const least = f.kind === 'polygon' ? MIN_POLYGON_POINTS : MIN_LINE_POINTS;
    if (boxed) {
        return [f.x, f.y, f.width, f.height].some((v) => v === undefined)
            ? [{ path: `features.${i}`, message: `a ${f.kind} needs x, y, width and height` }]
            : [];
    }
    return (f.points ?? []).length < least ? [{ path: `features.${i}.points`, message: `a ${f.kind} needs ${least} points at least` }] : [];
}

const MIN_POLYGON_POINTS = 3;
const MIN_LINE_POINTS = 2;

/**
 * A zone shape Foundry would refuse: a ring whose band reaches past its
 * centre, a cone wider than its curvature allows, or a grid space named
 * twice (a spec's spaces take the scene's cell size when built).
 */
function zoneIssues(f: FeatureSpec, i: number): SpecIssue[] {
    if (f.type !== 'zone') {
        return [];
    }
    const shape = f.shape.kind === 'cells' ? { ...f.shape, size: 1 } : f.shape;
    return validZoneShape(shape)
        ? []
        : [
              {
                  path: `features.${i}.shape`,
                  message:
                      'Foundry does not take this shape: a ring must not reach past its centre, a cone spread wider than its curvature allows, nor a grid space appear twice',
              },
          ];
}

/**
 * What JSON Schema cannot express: unique level and feature keys, references
 * to them that resolve (a feature's level, a level's visible levels, a
 * switch's controls), only the first level taking the scene's own floor,
 * doors on real segments, and zone shapes Foundry takes.
 */
function referenceIssues(spec: SceneSpec): SpecIssue[] {
    const levels = declaredKeys(spec.levels, 'levels', 'level');
    const features = declaredKeys(spec.features, 'features', 'feature');
    return [
        ...levels.issues,
        ...features.issues,
        ...splatIssues(spec.splats, levels.keys),
        ...spec.levels.flatMap((l, i) => unresolved(l.visibleLevels, levels.keys, (j) => `levels.${i}.visibleLevels.${j}`, 'level')),
        // Only the bottom level can be the scene's own lowest floor.
        ...spec.levels.flatMap((l, i) =>
            i > 0 && l.existing ? [{ path: `levels.${i}.existing`, message: "only the first level can take the scene's own lowest floor" }] : [],
        ),
        ...spec.features.flatMap((f, i) => [
            ...unresolved(f.level === undefined ? [] : [f.level], levels.keys, () => `features.${i}.level`, 'level'),
            ...(f.type === 'stamp' ? unresolved(f.controls, features.keys, (j) => `features.${i}.controls.${j}`, 'feature') : []),
            ...doorIssues(f, i),
            ...zoneIssues(f, i),
            ...shapeIssues(f, i),
        ]),
    ];
}

// eslint-disable-next-line no-restricted-syntax -- boundary: validates an untyped scene spec (pasted or generated JSON) and narrows it to SceneSpec
export function parseSceneSpec(raw: unknown): SpecParseResult {
    const result = sceneSpecSchema.safeParse(raw);
    if (!result.success) {
        return { ok: false, issues: result.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })) };
    }
    const issues = referenceIssues(result.data);
    return issues.length > 0 ? { ok: false, issues } : { ok: true, spec: result.data };
}

/** Parse a scene spec from JSON text; text that is not JSON at all is one issue at the root. */
export function parseSceneSpecJson(json: string): SpecParseResult {
    // eslint-disable-next-line no-restricted-syntax -- boundary: JSON.parse yields untyped data, validated by parseSceneSpec
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch (error) {
        return { ok: false, issues: [{ path: '', message: error instanceof Error ? error.message : String(error) }] };
    }
    return parseSceneSpec(raw);
}

/** An issue as one line of text: its path, then what is wrong there. */
export function formatSpecIssue(issue: SpecIssue): string {
    return issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`;
}
