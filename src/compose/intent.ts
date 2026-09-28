// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The map intent schema v1: what a map is, not where each thing goes. A GM,
 * an LLM or a Map builder preset writes one; the composer expands it, seeded
 * and repeatably, into an ordinary scene spec (zoned ground, roads and
 * rivers, scattered vegetation, buildings of rooms by purpose, furnished).
 *
 * Single source of truth, like the other schemas: the types (`z.infer`),
 * validation (`parseMapIntent`) and the published JSON Schema
 * (`schema/map-intent.v1.schema.json`, from `pnpm schema:gen`) all derive
 * from here. v1 changes are additive only.
 */
import { z } from 'zod';
import type { SpecIssue } from '../generate/spec';
import { STAMP_ROLES } from '../stamps/schema';
import { BIOMES } from '../tools/biome';
import type { Liquid } from '../tools/path';
import { DEFAULT_WALL_PRESET, WALL_PRESETS } from '../tools/wall-presets';

const MAP_INTENT_SCHEMA_VERSION = 1;

export const MAP_INTENT_SCHEMA_URL = 'https://raw.githubusercontent.com/JamesonRGrieve/zephyrex-cartography/main/schema/map-intent.v1.schema.json';

/** What a room is for; each purpose has its furnishing template. */
export const ROOM_PURPOSES = [
    'common-room',
    'bar',
    'kitchen',
    'storage',
    'bedroom',
    'hall',
    'office',
    'workshop',
    'shrine',
    'cell',
    'mess',
    'chapel',
    'medicae',
    'command',
    'armoury',
    'barracks',
    'manufactorum',
    'interrogation',
    'porch',
] as const;

/**
 * Kinds of outdoor zone, each with its ground and what grows, lies or
 * stands in it: the wild (woodland, meadow, clearing, marsh, rocky) and the
 * made (rubble: a ruin or a shelled street; industrial: a yard of plant and
 * cargo; fortified: an encampment behind barricades; landing: a field of
 * landed craft).
 */
const ZONE_KINDS = ['woodland', 'meadow', 'clearing', 'marsh', 'rocky', 'rubble', 'industrial', 'fortified', 'landing', 'lake'] as const;

/** How a building's floors are reached from one another. */
const ACCESS_KINDS = ['stairs', 'ladder'] as const;

/** How thickly a zone is filled. */
const DENSITIES = ['sparse', 'normal', 'dense'] as const;

/** The map's four edges. */
const EDGES = ['north', 'east', 'south', 'west'] as const;

/** A texture role to draw ground in instead of its biome's own, which still says what the ground is. */
const groundTexture = z
    .string()
    .min(1)
    .nullable()
    .default(null)
    .describe(
        'A texture role of the active set to draw the ground in (`floor.scorched-earth`); null for its biome’s own. A role the set lacks draws as the biome.',
    );

const INTENT_LIQUIDS = ['water', 'lava', 'poison', 'acid'] as const satisfies readonly Liquid[];

/** A map of this many squares when the intent gives no size. */
const DEFAULT_MAP_SQUARES = { width: 30, height: 20 } as const;

const text = z.string().min(1);
const squares = z.number().positive();
const point = z.object({ x: z.number(), y: z.number() }).strict().describe('In grid squares from the map’s top-left corner.');
const edge = z.enum(EDGES);

const anchor = z
    .union([edge, point, z.object({ building: text }).strict(), z.object({ zone: text }).strict()])
    .describe(
        'Where a road or river starts or ends: a map edge (a point along it), a point, a building (its entrance), or a zone by key (its edge nearest the other end: a river running out of a lake).',
    );

const room = z
    .object({
        key: text.describe('This room’s name among the building’s rooms, for `opensTo`.'),
        purpose: z.enum(ROOM_PURPOSES),
        size: squares.default(1).describe('Floor area relative to the building’s other rooms (2 is twice as big as 1).'),
        opensTo: z.array(text).default([]).describe('Rooms it has a door into; the layout puts them side by side.'),
        entrance: z.boolean().default(false).describe('Has the building’s front door. Without one marked, the first room has it.'),
        floor: text.optional().describe('Its own floor texture role (a kitchen’s flagstones among plank rooms); omitted, the building’s.'),
    })
    .strict();

const storey = z
    .object({
        name: text.optional().describe('The level’s name; omitted, “Floor 2”, “Cellar” and so on.'),
        rooms: z.array(room).min(1),
    })
    .strict();

const building = z
    .object({
        key: text.optional().describe('A name roads can run to.'),
        at: point.optional().describe('Top-left corner. Omitted: centred on the map.'),
        width: z.number().int().min(3),
        height: z.number().int().min(3),
        floor: text.default('floor.wooden-planks').describe('Floor texture role (a biome or a pack floor.*).'),
        wall: text.default('wall.stone').describe('Wall texture role (a pack wall.*), drawn along every wall.'),
        wallKind: z.enum(WALL_PRESETS).default(DEFAULT_WALL_PRESET),
        entrance: edge.default('south').describe('The side its front door faces.'),
        rooms: z.array(room).min(1).describe('The ground floor’s rooms.'),
        floors: z
            .array(storey)
            .default([])
            .describe(
                'Storeys above the ground floor, bottom to top, each a level of the scene over the same footprint, so every floor’s outer walls stand on the ones below. A stair in the same place on every floor joins each to the next.',
            ),
        floorAccess: z.enum(ACCESS_KINDS).default('stairs').describe('How the floors above are reached: a staircase or a ladder.'),
        cellars: z
            .array(storey)
            .default([])
            .describe(
                'Storeys below the ground floor, top to bottom, each a level under the same footprint, joined to the one above in the same place on each.',
            ),
        cellarAccess: z.enum(ACCESS_KINDS).default('ladder').describe('How the cellars are reached from above: a staircase or a ladder.'),
        stormDoor: edge
            .nullable()
            .default(null)
            .describe('The side with storm doors down into the top cellar from outside, through a small areaway beside the wall; null for none.'),
        porch: squares
            .nullable()
            .default(null)
            .describe('A board porch this many squares deep along the front wall at the front door, with a bench, barrels and a lamp; null for none.'),
        yard: z.boolean().default(false).describe('A working yard: stores stacked against the outside walls and a cart or wagon standing by.'),
    })
    .strict()
    .superRefine((b, ctx) => {
        if (b.stormDoor !== null && b.cellars.length === 0) {
            ctx.addIssue({ code: 'custom', path: ['stormDoor'], message: 'storm doors lead down into a cellar, and the building has none' });
        }
        const storeys = [
            { rooms: b.rooms, at: ['rooms'] },
            ...b.floors.map((f, n) => ({ rooms: f.rooms, at: ['floors', n, 'rooms'] })),
            ...b.cellars.map((c, n) => ({ rooms: c.rooms, at: ['cellars', n, 'rooms'] })),
        ];
        for (const { rooms, at } of storeys) {
            const keys = rooms.map((r) => r.key);
            keys.forEach((key, i) => {
                if (keys.indexOf(key) !== i) {
                    ctx.addIssue({ code: 'custom', path: [...at, i, 'key'], message: `room ${key} is named twice` });
                }
            });
            rooms.forEach((r, i) => {
                r.opensTo.forEach((other, j) => {
                    if (!keys.includes(other) || other === r.key) {
                        ctx.addIssue({ code: 'custom', path: [...at, i, 'opensTo', j], message: `${r.key} cannot open to ${other}` });
                    }
                });
            });
        }
    });

const zoneArea = z
    .union([
        z.object({ shape: z.literal('everywhere') }).strict(),
        z.object({ shape: z.literal('edge'), side: edge, depth: squares.describe('How far in from the edge.') }).strict(),
        z.object({ shape: z.literal('circle'), centre: point, radius: squares }).strict(),
        z.object({ shape: z.literal('polygon'), points: z.array(point).min(3) }).strict(),
    ])
    .describe('Where the zone lies.');

const zone = z
    .object({
        key: text.optional().describe('A name roads and rivers can start or end at.'),
        kind: z.enum(ZONE_KINDS),
        area: zoneArea,
        density: z.enum(DENSITIES).default('normal'),
        texture: groundTexture,
    })
    .strict();

const path = z
    .object({
        kind: z.enum(['road', 'river']),
        from: anchor,
        to: anchor,
        width: squares.optional().describe('Squares across; omitted: a road 1.5, a river 2.'),
        meander: z.number().min(0).max(1).default(0.3).describe('How much it winds: 0 straight, 1 a lot.'),
        liquid: z.enum(INTENT_LIQUIDS).optional().describe('A river’s liquid (default water).'),
    })
    .strict();

const prop = z
    .union([
        z.object({ role: z.enum(STAMP_ROLES), at: point }).strict(),
        z
            .object({
                role: z.enum(STAMP_ROLES),
                beside: z.object({ building: text, side: edge.optional().describe('Omitted: whichever side has room, its front first.') }).strict(),
            })
            .strict(),
    ])
    .describe('One piece stood outside: at a point, or in the yard beside a building (a well by the inn).');

export const mapIntentSchema = z
    .object({
        $schema: z.string().optional(),
        schemaVersion: z.literal(MAP_INTENT_SCHEMA_VERSION),
        seed: z.number().int().default(1).describe('The same intent and seed always compose the same map.'),
        width: z.number().int().min(4).default(DEFAULT_MAP_SQUARES.width).describe('Map width in grid squares.'),
        height: z.number().int().min(4).default(DEFAULT_MAP_SQUARES.height),
        settings: z
            .array(text)
            .default([])
            .describe('Stamp tags the map is made from: only stamps carrying at least one are used (e.g. a setting and "generic" pieces); none: any stamp.'),
        ground: z.enum(BIOMES).nullable().default('grassland').describe('The ground under everything; null for none (an interior on a bare scene).'),
        lighting: z
            .enum(['day', 'night'])
            .default('day')
            .describe(
                'By night the scene is dark and rooms are lit by what is in them (a hearth, lamps), not a flat light; a room with nothing to light it keeps its own.',
            ),
        groundTexture: groundTexture,
        zones: z.array(zone).default([]),
        paths: z.array(path).default([]),
        buildings: z.array(building).default([]),
        props: z.array(prop).default([]),
    })
    .strict()
    .superRefine((intent, ctx) => {
        const buildings = intent.buildings.flatMap((b) => (b.key === undefined ? [] : [b.key]));
        const zones = intent.zones.flatMap((each) => (each.key === undefined ? [] : [each.key]));
        intent.paths.forEach((p, i) => {
            for (const end of ['from', 'to'] as const) {
                const at = p[end];
                if (typeof at === 'object' && 'building' in at && !buildings.includes(at.building)) {
                    ctx.addIssue({ code: 'custom', path: ['paths', i, end], message: `no building named ${at.building}` });
                }
                if (typeof at === 'object' && 'zone' in at && !zones.includes(at.zone)) {
                    ctx.addIssue({ code: 'custom', path: ['paths', i, end], message: `no zone named ${at.zone}` });
                }
            }
        });
        intent.props.forEach((p, i) => {
            if ('beside' in p && !buildings.includes(p.beside.building)) {
                ctx.addIssue({ code: 'custom', path: ['props', i, 'beside', 'building'], message: `no building named ${p.beside.building}` });
            }
        });
    });

export type MapIntent = z.infer<typeof mapIntentSchema>;
export type BuildingIntent = MapIntent['buildings'][number];
export type RoomIntent = BuildingIntent['rooms'][number];
export type ZoneIntent = MapIntent['zones'][number];
export type PathIntent = MapIntent['paths'][number];
export type PropIntent = MapIntent['props'][number];
export type AccessKind = (typeof ACCESS_KINDS)[number];
export type Anchor = PathIntent['from'];
export type RoomPurpose = (typeof ROOM_PURPOSES)[number];
export type ZoneKind = (typeof ZONE_KINDS)[number];
export type Density = (typeof DENSITIES)[number];
export type Edge = (typeof EDGES)[number];

/** An intent, validated with its defaults filled, or its problems, each at its path, as a scene spec's are reported. */
export type IntentParseResult = { readonly ok: true; readonly intent: MapIntent } | { readonly ok: false; readonly issues: readonly SpecIssue[] };

/** Validate an intent (untyped JSON from an author), filling its defaults, or list what is wrong with it. */
// eslint-disable-next-line no-restricted-syntax -- boundary: an intent arrives as untyped JSON, narrowed here by its schema
export function parseMapIntent(v: unknown): IntentParseResult {
    const result = mapIntentSchema.safeParse(v);
    if (result.success) {
        return { ok: true, intent: result.data };
    }
    return { ok: false, issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) };
}
