// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stamp pack schema v1 — the contract every asset pack must satisfy.
 *
 * Single source of truth: the engine's types (`z.infer`), its runtime validation
 * (`parseStampPack`), and the published JSON Schema that packs validate against
 * (`scripts/gen-schema.mjs` → `schema/stamp-pack.v1.schema.json`) all derive from
 * this file. It imports only `zod` so Node can load it directly for generation.
 *
 * A pack is one manifest (`zephyr-pack.json`) at an asset module's root,
 * advertised via the module's `flags["zephyr-cartography"].pack`. Paths inside
 * it are relative to that module's root. Changes to v1 are additive only;
 * anything breaking is a new version with its own file.
 */
import { z } from 'zod';

export const STAMP_PACK_SCHEMA_VERSION = 1;

export const STAMP_PACK_SCHEMA_URL = 'https://raw.githubusercontent.com/JamesonRGrieve/zephyr-cartography/main/schema/stamp-pack.v1.schema.json';

/** Map scale band a stamp is authored for (drives browser grouping). */
const STAMP_SCALES = ['system', 'planet', 'regional', 'city', 'exterior', 'interior'] as const;

/**
 * How a stamp's image is drawn: `orthographic` straight down (a plan view,
 * which can be turned any way on a map); `isometric` a three-quarter view
 * with depth but no vanishing point; `front` a straight elevation, seen level
 * from the front or side; `central` from above in one-point perspective, its
 * sides converging. Orthographic and central art can be turned, since both
 * look down on the piece; isometric and front art turned half round stands
 * upside down.
 * `top-down` is the old name for orthographic, still read as it.
 */
const STAMP_PERSPECTIVES = ['orthographic', 'isometric', 'front', 'central', 'top-down'] as const;

/**
 * How an asset's art is made, as a gallery filters it: `painted` (digital or
 * traditional painting), `photorealistic` (photographs and photo scans),
 * `hand-drawn` (inked or sketched), `flat` (vector or cartoon shading),
 * `pixel-art`, or `line-art` (blueprints and black-and-white plans).
 */
const ART_STYLES = ['painted', 'photorealistic', 'hand-drawn', 'flat', 'pixel-art', 'line-art'] as const;

/** An asset's art style. */
const artStyle = z.enum(ART_STYLES).describe('How its art is made: painted, photorealistic, hand-drawn, flat, pixel-art or line-art.');

/** A perspective as read: the old `top-down` is `orthographic`. */
const perspective = z
    .enum(STAMP_PERSPECTIVES)
    .transform((p) => (p === 'top-down' ? 'orthographic' : p))
    .describe(
        'How the image is drawn: orthographic (straight down), isometric (three-quarter, depth, no vanishing point), front (a level elevation from the front or side) or central (one-point perspective).',
    );

const text = z.string().min(1);

/**
 * An image's own resolution: its long side in pixels, rounded to the nearest
 * step. Low-resolution art is what to regenerate first.
 */
const RESOLUTIONS = ['32', '64', '128', '256', '512', '1K', '2K', '4K', '8K'] as const;
const resolution = z.enum(RESOLUTIONS);
const fraction = z.number().min(0).max(1);

const physicalSchema = z
    .object({
        height: z.number().min(0).optional().describe('Height above the stamp base, in grid units (cover and elevation bands).'),
        cover: fraction.optional().describe('Cover density: 0 none, 0.5 half, 0.75 three-quarter, 1 full.'),
        blocksMovement: z.boolean().optional().describe('Tokens cannot move through the stamp footprint.'),
    })
    .strict()
    .describe('The physical body of the stamp.');

/**
 * How a wall restricts one sense: `true` blocks it (Foundry's NORMAL), `false`
 * lets it through, and the rest are Foundry's other edge sense types: LIMITED
 * (a terrain wall, blocking only past a second one), PROXIMITY and DISTANCE
 * (blocking only within, or beyond, the wall's `threshold`).
 */
const senseSchema = z.union([z.boolean(), z.enum(['limited', 'proximity', 'distance'])]);

const occlusionSchema = z
    .object({
        shape: z
            .enum(['none', 'bounds', 'alpha'])
            .describe('How the stamp is wrapped in native walls: not at all, its bounding box, or its traced alpha silhouette.'),
        sight: senseSchema.default(true).describe('How the generated walls restrict sight.'),
        movement: z.boolean().default(true).describe('The generated walls block movement.'),
        light: senseSchema.default(true).describe('How the generated walls restrict light.'),
        sound: senseSchema.default(true).describe('How the generated walls restrict sound.'),
        direction: z
            .enum(['both', 'left', 'right'])
            .optional()
            .describe('A one-way wall: which side it restricts from (Foundry `dir`), walking the outline clockwise.'),
        threshold: z
            .object({
                light: z.number().positive().optional(),
                sight: z.number().positive().optional(),
                sound: z.number().positive().optional(),
                attenuation: z.boolean().optional().describe('Light and sound fade through the wall with distance.'),
            })
            .strict()
            .optional()
            .describe('Distances (grid units) for proximity and distance senses.'),
    })
    .strict()
    .describe('Automatic occlusion walls around the placed stamp.');

/**
 * Where an asset came from and under what licence: AI-generated art and the
 * person who made it available, or another author's work and its page.
 * Additive and optional; the engine reads none of it (it is the pack's
 * record, for galleries and credits).
 */
const provenanceSchema = z
    .object({
        source: text.describe(
            'Where it came from: the pack’s own repository for art made for it, or the provider ("Poly Haven", "ambientCG", "Kenney", "Freesound").',
        ),
        license: text.describe('Its licence, as an SPDX id ("CC0-1.0").'),
        author: text.optional().describe('Its author, or who made AI-generated art available.'),
        url: z.url().optional().describe('Its source page: the pack’s own repository for art made for it.'),
        ai: z.boolean().optional().describe('Whether it is AI-generated, whatever its source: art made for the pack, or brought in from elsewhere.'),
    })
    .strict()
    .describe('Where an asset came from, its licence, and whether it is AI-generated.');

/** A number, or a `[min, max]` range picked uniformly per particle. */
const rangeSchema = z.union([z.number(), z.tuple([z.number(), z.number()])]);

const particleEmitterSchema = z
    .object({
        textures: z.array(text).min(1).describe('Particle images, relative to the pack module root; each particle takes one at random.'),
        area: z
            .union([
                z.literal('footprint').describe('Anywhere over the stamp footprint.'),
                z
                    .object({
                        x: fraction.describe('Emitter centre as a fraction of the footprint width.'),
                        y: fraction.describe('Emitter centre as a fraction of the footprint height.'),
                        radius: z.number().min(0).default(0).describe('Spawn radius in grid units; 0 is a point.'),
                    })
                    .strict(),
            ])
            .default({ x: 0.5, y: 0.5, radius: 0 })
            .describe('Where particles spawn.'),
        count: z.number().int().positive().describe('How many particles are alive at once.'),
        lifetime: rangeSchema.describe('Particle lifetime in milliseconds.'),
        velocity: z
            .object({
                speed: rangeSchema.describe('Grid units per second.'),
                angle: rangeSchema.describe('Direction in degrees, clockwise from east (the stamp rotation is added).'),
            })
            .strict()
            .optional(),
        alpha: rangeSchema.optional().describe('Peak opacity, 0 to 1.'),
        scale: rangeSchema.optional(),
        rotationSpeed: rangeSchema.optional().describe('Degrees per second.'),
        fade: z
            .object({ in: z.number().min(0).optional(), out: z.number().min(0).optional() })
            .strict()
            .optional()
            .describe('Fade-in and fade-out, in milliseconds (or a fraction of lifetime when below 1).'),
        blend: z.enum(['normal', 'add', 'multiply', 'screen']).optional(),
        elevation: z.number().optional().describe('Height above the stamp base, in grid units.'),
        provenance: provenanceSchema.optional().describe('Where its particle images came from.'),
        style: artStyle.optional(),
    })
    .strict()
    .describe("A native particle emitter (Foundry's ParticleGenerator, effect mode) anchored to the stamp.");

const soundSchema = z
    .object({
        path: text.describe('Audio file relative to the pack module root.'),
        radius: z.number().positive().describe('Audible radius in grid units.'),
        volume: fraction.default(0.5),
        repeat: z.boolean().default(true),
        walls: z.boolean().default(true).describe('Walls muffle the sound.'),
        easing: z.boolean().default(true).describe('Volume falls off with distance.'),
        offset: z.object({ x: fraction, y: fraction }).strict().optional().describe('Emitter position as a fraction of the footprint (default: centre).'),
        provenance: provenanceSchema.optional().describe('Where the audio came from.'),
    })
    .strict()
    .describe('A native ambient sound emitted by the placed stamp.');

const tileSchema = z
    .object({
        alpha: fraction.optional(),
        hidden: z.boolean().optional().describe('Placed hidden from players.'),
        occlusion: z
            .object({
                modes: z
                    .array(z.enum(['fade', 'surface', 'radial', 'vision']))
                    .default([])
                    .describe('Foundry occlusion modes, combined: fade when a token is beneath, reveal as a surface, a radial cut-out, or by vision.'),
                alpha: fraction.optional().describe('Opacity while occluded.'),
            })
            .strict()
            .optional()
            .describe('Roofs and canopies that give way to tokens beneath them.'),
        alphaThreshold: fraction.optional().describe('Opacity below which the image is not solid (for occlusion and hover).'),
        restrictions: z
            .object({ light: z.boolean().optional(), weather: z.boolean().optional() })
            .strict()
            .optional()
            .describe('The tile blocks light and weather beneath it.'),
        video: z
            .object({ loop: z.boolean().optional(), autoplay: z.boolean().optional(), volume: fraction.optional() })
            .strict()
            .optional()
            .describe('For a video image.'),
    })
    .strict()
    .describe('How the stamp tile itself behaves.');

const PILE_TYPES = ['pile', 'container', 'merchant', 'vault', 'auctioneer', 'banker'] as const;

const containerSchema = z
    .object({
        type: z.enum(PILE_TYPES).default('container').describe('Item Piles pile type.'),
        closed: z.boolean().optional().describe('Starts closed.'),
        locked: z.boolean().optional().describe('Starts locked.'),
        distance: z.number().positive().optional().describe('How near (grid squares) a token must be to open it.'),
        canInspectItems: z.boolean().optional(),
        displayItemTypes: z.boolean().optional(),
        sounds: z
            .object({ open: text.optional(), close: text.optional(), locked: text.optional(), unlocked: text.optional() })
            .strict()
            .optional()
            .describe('Audio files relative to the pack module root.'),
        states: z
            .object({ closed: text.optional(), open: text.optional(), empty: text.optional(), locked: text.optional() })
            .strict()
            .optional()
            .describe('Which variant (by state label) shows the pile closed, open, emptied or locked, so the stamp follows it.'),
    })
    .strict()
    .describe('An Item Piles pile backing the stamp (Item Piles must be active).');

const surfaceSchema = z
    .object({
        placement: z.enum(['bottom', 'top', 'both']).default('top').describe('A surface at the bottom, top or both of the stamp height.'),
        reveal: z.boolean().default(false).describe('An elevated surface (a roof, a balcony) hidden from observers nearly beneath it.'),
    })
    .strict()
    .describe('A Define Surface region over the footprint: a floor or roof that restricts light, movement, sight and sound between levels.');

const terrainSchema = z
    .object({
        difficulty: z
            .record(text, z.number().min(0).max(5))
            .describe("Movement cost multiplier per movement action (walk, climb, fly, ...), as Foundry's Modify Movement Cost behaviour."),
    })
    .strict()
    .describe('Difficult terrain over the footprint (rubble, mud, a crowd).');

/** What harms a token that comes too near: a fire, an acid or toxic spill, a live reactor, a live cable, a drop. */
const HAZARD_KINDS = ['fire', 'acid', 'toxic', 'radiation', 'electric', 'fall'] as const;

const hazardSchema = z
    .object({
        kind: z.enum(HAZARD_KINDS).describe('What the hazard is.'),
        reach: z.number().min(0).default(0.5).describe('How far past the footprint it harms, in grid squares.'),
    })
    .strict()
    .describe('A hazard round the footprint: a region that warns a token entering it, where the GM adds the harm the game system deals (a burning, a toxin).');

const COLORATION = [
    'legacy',
    'luminance',
    'internalHalo',
    'externalHalo',
    'colorBurn',
    'internalBurn',
    'externalBurn',
    'lowAbsorption',
    'highAbsorption',
    'invertAbsorption',
    'naturalLight',
    'naturalAttenuation',
    'adaptiveAttenuation',
] as const;

const lightSchema = z
    .object({
        dim: z.number().min(0).describe('Dim light radius, in grid units.'),
        bright: z.number().min(0).describe('Bright light radius, in grid units.'),
        color: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .optional()
            .describe('Light colour as #rrggbb.'),
        alpha: fraction.optional().describe('Colour intensity.'),
        angle: z.number().min(0).max(360).optional().describe('Emission cone in degrees (360 = omnidirectional).'),
        offset: z.object({ x: fraction, y: fraction }).strict().optional().describe('Emitter position as a fraction of the footprint (default: centre).'),
        animation: z
            .object({
                type: text.describe('Foundry light animation key, e.g. "torch", "flame", "pulse".'),
                speed: z.number().int().min(1).max(10).optional(),
                intensity: z.number().int().min(1).max(10).optional(),
            })
            .strict()
            .optional(),
        negative: z.boolean().optional().describe('A darkness source rather than a light.'),
        priority: z.number().int().min(0).optional().describe('Draw priority among overlapping lights.'),
        coloration: z.enum(COLORATION).optional().describe('Foundry colouration technique.'),
        luminosity: fraction.optional(),
        attenuation: fraction.optional(),
        saturation: z.number().min(-1).max(1).optional(),
        contrast: z.number().min(-1).max(1).optional(),
        shadows: fraction.optional(),
        walls: z.boolean().optional().describe('Constrained by walls (default true).'),
        vision: z.boolean().optional().describe('Also provides vision.'),
        darkness: z
            .object({ min: fraction.default(0), max: fraction.default(1) })
            .strict()
            .refine((range) => range.min <= range.max, { message: 'darkness.max may not be less than darkness.min' })
            .optional()
            .describe("The scene darkness range the light is active in, 0 to 1 (a lamp that lights only at night: min 0.5). Foundry's default: always."),
        hidden: z.boolean().optional().describe('Placed hidden from players, for the GM to reveal.'),
    })
    .strict()
    .describe('A native ambient light emitted by the placed stamp.');

const doorSchema = z
    .object({
        type: z.enum(['door', 'secret']).describe('Foundry door type of the wall this stamp sits on.'),
        animation: z
            .object({
                type: z.enum(['ascend', 'descend', 'slide', 'swing', 'swivel']),
                direction: z.union([z.literal(1), z.literal(-1)]).optional(),
                double: z.boolean().optional().describe('A double door, opening from both ends.'),
                duration: z.number().int().positive().optional().describe('Milliseconds.'),
                flip: z.boolean().optional(),
                strength: z.number().min(0).max(2).optional(),
                texture: text.optional().describe('Image of the door leaf Foundry animates, relative to the pack module root.'),
            })
            .strict()
            .optional()
            .describe('How the door animates open and closed.'),
        sound: text.optional().describe('A Foundry door sound key (CONFIG.Wall.doorSounds), e.g. "slidingMetal", "woodCreaky".'),
        switch: z
            .boolean()
            .optional()
            .describe(
                'A light switch: its door wall blocks nothing and cuts no opening, and opening it (players use Foundry\'s own door control) turns on the lights linked to it; its "open" variant is on.',
            ),
    })
    .strict()
    .describe('The stamp is a door: placing it on a wall makes that wall a Foundry door.');

const transitionSchema = z
    .object({
        kind: z.enum(['stairs', 'ladder', 'lift', 'hatch']),
        direction: z.enum(['up', 'down', 'both']).describe('Which level(s) the stamp leads to.'),
        movement: z
            .array(text)
            .min(1)
            .optional()
            .describe('Movement actions that use it (walk, climb, fly, ...); omitted means any. Stairs are walked, ladders climbed.'),
    })
    .strict()
    .describe('The stamp moves tokens between elevation levels.');

const variantSchema = z
    .object({
        state: text.describe('Display label for this variant, e.g. "intact", "open", "lit".'),
        image: text.describe(
            'Image path relative to the pack module root. GPU-compressed art (.ktx2, .basis) is drawn by the canvas, which browsers cannot show as an image, so give it a preview.',
        ),
        preview: text
            .optional()
            .describe('A browser image (PNG, WebP, ...) the stamp browser and the tile HUD show for compressed art; left out, they show the image.'),
        width: z.number().int().positive().describe('Pixel width at the pack referenceGridSize.'),
        height: z.number().int().positive().describe('Pixel height at the pack referenceGridSize.'),
        perspective: perspective.optional().describe('Overrides the stamp perspective.'),
        resolution: resolution.optional().describe("The variant image's long side, rounded to the nearest step (32 to 8K)."),
        anchor: z
            .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
            .strict()
            .optional()
            .describe(
                "The point of the image, as fractions of it (0,0 its top-left), that stands on the stamp's placed point and stays there as variants switch: a ramp or drawbridge lowered from its hinge, its hinge edge's middle. Omitted: the image's centre.",
            ),
        doorState: z.enum(['closed', 'open', 'locked']).optional().describe('Door state this variant represents (door stamps).'),
        light: lightSchema.nullable().optional().describe('Overrides the stamp light; null means this variant emits none (e.g. "unlit").'),
        occlusion: occlusionSchema.optional().describe('Overrides the stamp occlusion.'),
        physical: physicalSchema.optional().describe('Overrides the stamp physical body.'),
        particles: z
            .array(particleEmitterSchema)
            .nullable()
            .optional()
            .describe('Overrides the stamp particles; null means none (a "destroyed" variant can smoke).'),
        sound: soundSchema.nullable().optional().describe('Overrides the stamp sound; null means silent.'),
        tile: tileSchema.optional().describe('Overrides the stamp tile behaviour.'),
        container: z.union([z.boolean(), containerSchema]).optional().describe('Overrides whether (and how) the stamp is an Item Piles pile.'),
        surface: surfaceSchema.nullable().optional().describe('Overrides the stamp surface; null means none.'),
        terrain: terrainSchema.nullable().optional().describe('Overrides the stamp terrain; null means none (e.g. rubble only when "destroyed").'),
        hazard: hazardSchema.nullable().optional().describe('Overrides the stamp hazard; null means none (a brazier only when "lit").'),
        trap: z.boolean().optional().describe('Overrides whether the stamp is an armed trap (false for a "sprung" variant).'),
    })
    .strict();

/**
 * What a stamp is to the map composer, which dresses land and furnishes rooms
 * by role, never by stamp id:
 * - land (tree, shrub, rock, log, flora, debris), which dresses only zones
 *   of its `habitats`;
 * - works that stand outdoors on any ground (structure: a bunker, a tent, a
 *   silo; barricade; crater; emplacement: a gun or its pit; vehicle);
 * - furniture (table, seat, bench, counter, hearth, shelf, bed, storage,
 *   clutter, rug, desk, workbench, light) and the fittings of harder places
 *   (machine, console, altar, pew, lectern, icon: something hung on a wall,
 *   rack: arms or armour, medical, restraint);
 * - stairs: a stair, ladder, lift, trapdoor or storm door joining a
 *   building's floors, which the composer uses only when it carries a
 *   `transition`;
 * - tabletop: what is set on a table, bar or desk (a meal, tankards,
 *   papers), stacked on it;
 * - nightstand: what stands beside a bed;
 * - well: a well or pump in a yard;
 * - bridge: what carries a road over a river, laid along the road;
 * - waymark: a milestone, wayside post or signpost by a road;
 * - chest: a chest, trunk or footlocker, a person's belongings (storage is
 *   a store's crates, barrels and sacks);
 * - enclosure: a pen, corral or paddock for animals, in a yard;
 * - fodder: hay and straw, stacked by an enclosure;
 * - dresser: a chest of drawers, wardrobe or washstand, a bedroom's against
 *   its wall (a store's locker or cabinet is storage);
 * - armchair: an upholstered easy chair, sat in a room's corner.
 */
export const STAMP_ROLES = [
    'tree',
    'shrub',
    'rock',
    'log',
    'flora',
    'debris',
    'table',
    'seat',
    'bench',
    'counter',
    'hearth',
    'shelf',
    'bed',
    'storage',
    'clutter',
    'rug',
    'desk',
    'workbench',
    'light',
    'machine',
    'console',
    'altar',
    'pew',
    'lectern',
    'icon',
    'rack',
    'medical',
    'restraint',
    'structure',
    'barricade',
    'crater',
    'emplacement',
    'vehicle',
    'stairs',
    'tabletop',
    'nightstand',
    'well',
    'bridge',
    'waymark',
    'chest',
    'enclosure',
    'fodder',
    'dresser',
    'armchair',
    'decal',
    'door',
    // Anything else (a pipe run, an anvil, an alms box): never dressed by a purpose, drawn only where a map names it by its tags.
    'fitting',
] as const;

/** An image's edges, as a piece's back. */
const STAMP_BACKS = ['top', 'right', 'bottom', 'left'] as const;

/** Where a stamp stands in a room: against a wall, in a corner, or anywhere on the floor. */
const STAMP_ANCHORS = ['wall', 'corner', 'free'] as const;

/**
 * The kinds of ground a land stamp belongs on, so the composer dresses a
 * wood with forest rocks and never stalagmites: forest, grassland, marsh,
 * rocky (hills, scree), cave, arctic, desert, urban, ruin.
 */
export const STAMP_HABITATS = ['forest', 'grassland', 'marsh', 'rocky', 'cave', 'arctic', 'desert', 'urban', 'ruin'] as const;

const placementSchema = z
    .object({
        against: z
            .enum(STAMP_ANCHORS)
            .optional()
            .describe('Where the composer stands it: with its back (see `back`) against a wall, in a corner, or anywhere free.'),
        clearance: z
            .number()
            .min(0)
            .optional()
            .describe('Grid squares of open floor the composer keeps in front of it: a counter’s serving side, a hearth’s apron.'),
        back: z
            .enum(STAMP_BACKS)
            .optional()
            .describe(
                'The edge of the image that is the piece’s back, set against a wall or turned away from a table: a bed drawn with its headboard on the left says left. For a defence (an emplacement, a barricade), the side away from the enemy: its front faces out.',
            ),
        upright: z
            .boolean()
            .optional()
            .describe('Drawn side-on or front-on (a tower, a tent, a silo): the composer never turns it, so it always stands as drawn.'),
    })
    .strict()
    .describe(
        'How the map composer places the stamp, where this image differs from its role’s way (a role’s pieces stand against a wall, face out, or stand upright as the role does). Omitted fields take the role’s.',
    );

const stampSchema = z
    .object({
        id: text.describe('Unique within the pack.'),
        name: text,
        category: text,
        tags: z.array(text).default([]),
        scale: z.enum(STAMP_SCALES),
        perspective,
        provenance: provenanceSchema.optional().describe('Where every variant’s image came from: one origin per stamp.'),
        style: artStyle.optional(),
        role: z
            .enum(STAMP_ROLES)
            .nullable()
            .optional()
            .describe(
                'What the map composer uses it as. Omitted, its tags say (a stamp tagged `console` is a console); null, it is never composed, however it is tagged (an L-shaped counter no wall takes). A stamp neither names nor tags as anything is only placed by hand.',
            ),
        habitats: z
            .array(z.enum(STAMP_HABITATS))
            .default([])
            .describe(
                'The ground a land stamp belongs on; the composer dresses each outdoor zone only with stamps of its habitat. Empty, its tags say (`cave`, `ice`, `forest`), else its role’s usual ground.',
            ),
        placement: placementSchema.optional(),
        defaultVariant: z.number().int().min(0).default(0).describe('Index into variants.'),
        variants: z.array(variantSchema).min(1),
        physical: physicalSchema.optional(),
        occlusion: occlusionSchema.optional(),
        light: lightSchema.optional(),
        door: doorSchema.optional(),
        transition: transitionSchema.optional(),
        enterable: z.boolean().default(false).describe('Can open into a linked interior scene (submap).'),
        container: z
            .union([z.boolean(), containerSchema])
            .default(false)
            .describe('Backed by an Item Piles pile: true for a plain container, or its pile options.'),
        particles: z.array(particleEmitterSchema).optional().describe('Native particle emitters (smoke, embers, sparks, drips).'),
        sound: soundSchema.optional(),
        tile: tileSchema.optional(),
        surface: surfaceSchema.optional(),
        terrain: terrainSchema.optional(),
        hazard: hazardSchema.optional(),
        trap: z
            .boolean()
            .optional()
            .describe(
                'An armed trap: placed hidden from players, over a region that pauses the game the first time a token moves in, for the GM to spring it. Tagged `trap`, a stamp is one unless it says otherwise.',
            ),
    })
    .strict();

const textureSetSchema = z
    .object({
        id: text,
        name: text,
        license: text.describe('SPDX id or licence name covering every file in the set.'),
        credits: text.optional().describe('Path to the set attribution file.'),
        provenance: provenanceSchema.optional().describe('Where the set as a whole came from.'),
        style: artStyle.optional().describe('How its textures are made, the whole set alike.'),
        sources: z
            .record(text, provenanceSchema)
            .optional()
            .describe('Texture role → where that one texture came from, where it differs from the set’s (each photo texture’s own author and page).'),
        textures: z
            .record(text, text)
            .describe(
                'Texture role → image path. Roles: a biome name or "road" (terrain), "floor.<name>" (a room floor material) or "wall.<name>" (a room wall material). GPU-compressed images (.ktx2, .basis) are loaded for the canvas before it draws.',
            ),
        previews: z
            .record(text, text)
            .optional()
            .describe('Texture role → a browser image the panels show for a compressed texture; a compressed role without one shows its colour.'),
        fallback: z
            .array(text)
            .optional()
            .describe(
                "Texture sets that stand in, in order, for the wall textures this set lacks (a painted set borrowing grey photo concrete): this pack's by id, another pack's by its full `module:id` key; omitted, the loaded sets in their listed order.",
            ),
        resolutions: z.record(text, resolution).optional().describe("Texture role → the image's long side, rounded to the nearest step."),
        tileSquares: z
            .record(text, z.number().positive())
            .optional()
            .describe(
                'Texture role → grid squares one tile of the image spans along its shorter side, where the art is drawn to a scale (three riveted plates meant to be two squares each: 6); omitted, 2.',
            ),
    })
    .strict();

/**
 * A pack's ambience by tag: the sound and the particles any of its stamps
 * carrying the tag gives off, where the stamp declares none of its own (every
 * `machine` hums, every `brazier` smokes and throws embers), so the pack
 * ships each sound and emitter once. The first of a stamp's tags with an
 * entry gives it.
 */
const ambienceSchema = z
    .object({
        sounds: z.record(text, soundSchema).default({}).describe('Tag → the ambient sound a stamp carrying it emits.'),
        particles: z.record(text, z.array(particleEmitterSchema)).default({}).describe('Tag → the particle emitters a stamp carrying it gives off.'),
    })
    .strict();

export const stampPackSchema = z
    .object({
        $schema: z.string().optional(),
        schemaVersion: z.literal(STAMP_PACK_SCHEMA_VERSION),
        id: text.describe('Pack id (conventionally the providing module id).'),
        name: text,
        license: text.optional(),
        referenceGridSize: z.number().int().positive().default(100).describe('Grid size (px per square) the stamp pixel sizes were authored at.'),
        stamps: z.array(stampSchema),
        textureSets: z.array(textureSetSchema).default([]),
        ambience: ambienceSchema.default({ sounds: {}, particles: {} }),
    })
    .strict();

type StampPack = z.infer<typeof stampPackSchema>;

/**
 * The behaviour a placed stamp carries on the scene: the pack's effective
 * properties for the chosen variant, snapshotted at placement so the scene
 * stays intact and self-describing even if the pack is later removed.
 */
export const placedBehaviourSchema = z.object({
    light: lightSchema.nullable(),
    occlusion: occlusionSchema.nullable(),
    physical: physicalSchema.nullable(),
    door: doorSchema.nullable(),
    doorState: z.enum(['closed', 'open', 'locked']).nullable(),
    transition: transitionSchema.nullable(),
    enterable: z.boolean(),
    container: z.boolean(),
    // Added after v1 shipped: optional, so behaviours snapshotted earlier still parse.
    pile: containerSchema.nullable().optional(),
    particles: z.array(particleEmitterSchema).nullable().optional(),
    sound: soundSchema.nullable().optional(),
    tile: tileSchema.nullable().optional(),
    surface: surfaceSchema.nullable().optional(),
    terrain: terrainSchema.nullable().optional(),
    hazard: hazardSchema.nullable().optional(),
    trap: z.boolean().optional(),
});

export type PlacedBehaviour = z.infer<typeof placedBehaviourSchema>;

export type StampHazard = z.infer<typeof hazardSchema>;

export type HazardKind = (typeof HAZARD_KINDS)[number];

export type Stamp = StampPack['stamps'][number];

export type StampVariant = Stamp['variants'][number];

export type StampLight = z.infer<typeof lightSchema>;

export type StampDoor = z.infer<typeof doorSchema>;

export type StampOcclusion = z.infer<typeof occlusionSchema>;

export type StampPhysical = z.infer<typeof physicalSchema>;

export type StampParticleEmitter = z.infer<typeof particleEmitterSchema>;

export type StampSound = z.infer<typeof soundSchema>;

export type StampTile = z.infer<typeof tileSchema>;

export type StampPile = z.infer<typeof containerSchema>;

export type StampSurface = z.infer<typeof surfaceSchema>;

export type StampTerrain = z.infer<typeof terrainSchema>;

export type StampRole = (typeof STAMP_ROLES)[number];

type StampTransition = z.infer<typeof transitionSchema>;

export type StampTransitionKind = StampTransition['kind'];

export type StampTransitionDirection = StampTransition['direction'];

export type StampAnchor = (typeof STAMP_ANCHORS)[number];

export type StampBack = (typeof STAMP_BACKS)[number];

export type StampPlacement = z.infer<typeof placementSchema>;

export type StampHabitat = (typeof STAMP_HABITATS)[number];

export type TextureSet = StampPack['textureSets'][number];

export interface PackIssue {
    readonly path: string;
    readonly message: string;
}

export type PackParseResult = { readonly ok: true; readonly pack: StampPack } | { readonly ok: false; readonly issues: readonly PackIssue[] };

/** Stamp ids that appear more than once (the JSON Schema cannot express keyed uniqueness). */
function duplicateIdIssues(pack: StampPack): PackIssue[] {
    const seen = new Set<string>();
    const issues: PackIssue[] = [];
    pack.stamps.forEach((stamp, i) => {
        if (seen.has(stamp.id)) {
            issues.push({ path: `stamps.${i}.id`, message: `duplicate stamp id "${stamp.id}"` });
        }
        seen.add(stamp.id);
    });
    return issues;
}

// eslint-disable-next-line no-restricted-syntax -- boundary: validates an untyped pack manifest (fetched JSON) and narrows it to StampPack
export function parseStampPack(raw: unknown): PackParseResult {
    const result = stampPackSchema.safeParse(raw);
    if (!result.success) {
        return { ok: false, issues: result.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })) };
    }
    const duplicates = duplicateIdIssues(result.data);
    return duplicates.length > 0 ? { ok: false, issues: duplicates } : { ok: true, pack: result.data };
}
