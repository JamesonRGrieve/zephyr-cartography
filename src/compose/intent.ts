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
import { ROOM_CORNERS } from '../generate/floor-plan';
import type { SpecIssue } from '../generate/spec';
import { STAMP_ROLES } from '../stamps/schema';
import { BIOMES } from '../tools/biome';
import { DOOR_ANIMATIONS } from '../tools/documents';
import type { Liquid } from '../tools/path';
import { DEFAULT_WALL_PRESET, WALL_PRESETS } from '../tools/wall-presets';

const MAP_INTENT_SCHEMA_VERSION = 1;

export const MAP_INTENT_SCHEMA_URL = 'https://raw.githubusercontent.com/JamesonRGrieve/zephyr-cartography/main/schema/map-intent.v1.schema.json';

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
    'factory',
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
const ZONE_KINDS = ['woodland', 'meadow', 'clearing', 'marsh', 'rocky', 'rubble', 'industrial', 'fortified', 'landing', 'lake', 'paving'] as const;

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

/** A room's four walls, as seen from above: top is north. */
export const WALL_SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** A room's corners. */
const CORNERS = ROOM_CORNERS;

/** Where along its wall a fixture stands: at the wall's start (its top or left end), middle or end, or spread evenly along it. */
const ALONG = ['start', 'middle', 'end', 'spread'] as const;

/** A fraction of a room's width or height, from its top-left corner. */
const fraction = z.number().min(0).max(1);

/**
 * How much grime a room gathers when its intent says nothing: a little. The
 * campaign's map prompts ask for loose scatter "sparse and subtle" almost
 * without exception; a filthier room says so in its intent.
 */
export const DEFAULT_GRIME = 0.2;

/** Part of a room, from one corner to the other, as fractions of its size: the archive behind a counter. */
const area = z
    .object({ from: z.object({ x: fraction, y: fraction }).strict(), to: z.object({ x: fraction, y: fraction }).strict() })
    .strict()
    .refine((a) => a.to.x > a.from.x && a.to.y > a.from.y, 'an area runs from its top-left corner to its bottom-right')
    .describe('Part of the room, from its top-left corner to its bottom-right, as fractions of the room’s size.');

const fixturePlace = z
    .union([
        z
            .object({
                wall: z.enum([...WALL_SIDES, 'any']),
                along: z.enum(ALONG).default('middle'),
                standoff: z.number().min(0).default(0).describe('Squares out from the wall (a bar counter with the barkeep behind it).'),
            })
            .strict()
            .describe('Against a wall, its back to it, facing into the room.'),
        z
            .object({ corner: z.enum([...CORNERS, 'any']) })
            .strict()
            .describe('In a corner.'),
        z
            .object({ centre: z.literal(true) })
            .strict()
            .describe('In the middle of the room.'),
        z
            .object({
                at: z.object({ x: fraction, y: fraction }).strict(),
                astride: z
                    .boolean()
                    .optional()
                    .describe(
                        'Centred on the point even where that sets it into the wall (a firing port in a hull), never drawn in to stand wholly inside the room; it stands there as a `fixed` piece does.',
                    ),
            })
            .strict()
            .describe('At this point of the room, as fractions of its size.'),
        z
            .object({
                line: z.object({ from: z.object({ x: fraction, y: fraction }).strict(), to: z.object({ x: fraction, y: fraction }).strict() }).strict(),
            })
            .strict()
            .describe('`count` of them evenly along a line across the room, from one point to the other, as fractions of its size (stools before a bar).'),
        z
            .object({ grid: z.object({ columns: z.number().int().min(1), rows: z.number().int().min(1) }).strict(), area: area.optional() })
            .strict()
            .describe('Evenly spaced across the room (or its `area`), columns by rows (a nave’s column footprints, three vats in a row).'),
        z
            .object({
                rows: z.enum(['along', 'across']).describe('Rows along the room’s long axis, or across it.'),
                aisle: squares.default(1).describe('Squares of aisle between rows and at their ends.'),
                max: z.number().int().min(1).optional().describe('Rows at most; omitted, as many as fit.'),
                area: area.optional(),
            })
            .strict()
            .describe('In rows filling the room (or its `area`), piece against piece in each row, aisles between (filing cabinets, lockers, pews).'),
        z
            .object({
                before: text.describe('The name of a fixture listed earlier in the room.'),
                gap: z.number().min(0).default(0.1).describe('Squares between the two.'),
                behind: z.boolean().default(false).describe('At its back instead (the clerk’s chair behind a desk, where the visitor’s is before it).'),
            })
            .strict()
            .describe('Before the front of another fixture (or behind it), centred on it and facing it (a stool at a desk, a chair at a console).'),
    ])
    .describe('Where the fixture stands in its room.');

/** What any named piece is: its name, the art that may draw it, and its size. */
const namedPieceSize = {
    name: text.describe('What it is, written on its placeholder box where no stamp draws it (“filing cabinets”, “drain grate”).'),
    role: z.enum(STAMP_ROLES).optional().describe('The stamp role that draws it, where a pack has art for it; omitted, it is always a labelled box.'),
    tags: z
        .array(text)
        .default([])
        .describe('Art of its role must carry one of these tags (a `reception` counter, not a food stall); none: any art of the role.'),
    width: squares.describe('Its size in squares, its back along the width: its art is fitted to it, and it is the box it stands as where no stamp draws it.'),
    height: squares,
    reads: text.optional().describe("What players read on it by hovering over it: a sign's words, a plaque's inscription, a notice pinned to a board."),
    state: text
        .optional()
        .describe(
            "The state its art is drawn in, by the words of a variant's state (a locker `ajar`, a lamp `lit`): the first variant whose state holds them; else as drawn.",
        ),
};

const namedPiece = {
    ...namedPieceSize,
    facing: z.enum(WALL_SIDES).default('bottom').describe('Which way its front faces, standing free (centre, a point, a grid).'),
    fixed: z
        .boolean()
        .default(false)
        .describe(
            'Exactly where asked, whatever is there: hung overhead or laid flush (a sign over a door, a floor inlay), or meant to block the way (rubble spilling from a collapsed doorway, a rockfall choking a tunnel). It keeps no floor from other pieces.',
        ),
    open: z
        .array(z.enum(WALL_SIDES))
        .default([])
        .describe(
            'Ends of its run (map sides) drawn without their end pieces, to butt square against another run: an L-shaped counter is two runs, one `open` where it meets the other. They must be the ends its `facing` gives it (left or right facing up or down; top or bottom facing sideways).',
        ),
};

/** The map sides a piece facing `facing` has its ends on: across its front. */
const endsFacing = (facing: (typeof WALL_SIDES)[number]): readonly string[] =>
    facing === 'top' || facing === 'bottom' ? ['left', 'right'] : ['top', 'bottom'];

/** Flags `open` sides that are not ends of a piece facing `facing`. */
const checkOpenEnds = (piece: { readonly facing: (typeof WALL_SIDES)[number]; readonly open: readonly string[] }, ctx: z.RefinementCtx): void => {
    const ends = endsFacing(piece.facing);
    for (const side of piece.open.filter((s) => !ends.includes(s))) {
        ctx.addIssue({ code: 'custom', path: ['open'], message: `a piece facing ${piece.facing} has no end on its ${side}` });
    }
};

const fixture = z
    .object({
        ...namedPiece,
        count: z.number().int().min(1).default(1).describe('How many, against a wall, in corners or along a line; rows and grids set their own.'),
        place: fixturePlace,
    })
    .strict()
    .superRefine((f, ctx) => {
        // Against a wall or in a corner a piece faces the way its wall turns it, never its `facing`.
        if (f.open.length > 0 && ('wall' in f.place || 'corner' in f.place)) {
            ctx.addIssue({ code: 'custom', path: ['open'], message: 'open ends are for a piece standing where asked, facing its `facing`' });
            return;
        }
        checkOpenEnds(f, ctx);
    })
    .describe('A named piece a room holds, placed as asked before anything its purpose adds.');

const hewn = z
    .object({
        floor: text.default('floor.rubble').describe('Floor texture role of its passages and chambers.'),
        wall: text
            .default('wall.rock')
            .describe('Wall texture role of the rock it is cut through; rock left standing inside a loop is walled round, unfloored.'),
        roughness: z.number().min(0).max(1).default(0.35).describe('How ragged its walls are: 0 smooth-bored, 1 raw rock.'),
        passages: z
            .array(
                z
                    .object({
                        points: z.array(point).min(2).describe('Its line through the rock, in grid squares; running past the map edge, it opens off the map.'),
                        width: squares.describe('Squares across, on average: 1 single file, 2 two abreast, 4 a buried service road.'),
                    })
                    .strict(),
            )
            .default([]),
        chambers: z
            .array(
                z
                    .object({ centre: point, width: squares, height: squares })
                    .strict()
                    .describe('An irregular chamber roughly this size (a cistern, a collapsed hall).'),
            )
            .default([]),
    })
    .strict()
    .describe(
        'Rough-hewn passages and chambers cut through rock: their union traced as ragged walled outlines, rock left standing inside a loop of passages as a walled pillar.',
    );

const curtain = z
    .object({
        points: z
            .array(point)
            .min(3)
            .describe('The wall’s centre line round what it encloses (a bailey, a camp, a town), corner to corner; it closes back to the first.'),
        thickness: squares.default(1.5).describe('Squares through the wall: 1.5 a castle’s curtain, 0.6 a timber palisade.'),
        wall: text.default('wall.stone').describe('Wall texture role of its faces.'),
        walk: text
            .nullable()
            .default(null)
            .describe(
                'Floor texture role of the walk along its top, between its faces; null: its own masonry, the wall solid stone (or timber) seen from above.',
            ),
        moat: z
            .object({
                width: squares.default(3).describe('Squares across the water, on average.'),
                gap: squares.default(1.5).describe('Squares of bank between the wall’s outer face and the water, on average.'),
                wander: z.number().min(0).max(1).default(0.5).describe('How far its banks wander from even: 0 dug true, 1 half-silted and ragged.'),
            })
            .strict()
            .nullable()
            .default(null)
            .describe('Still water round the wall outside it, its banks wandering and its corners rounded, never a ruled ring; none: no moat.'),
        towers: z
            .object({
                corners: z.boolean().default(true).describe('A tower at every corner of the wall.'),
                at: z.array(point).default([]).describe('Towers elsewhere along it (flanking a gate), at these points on its line.'),
                size: squares.default(4).describe('Squares across a tower.'),
                round: z.boolean().default(true).describe('Round (drawn eight-sided); false, square.'),
            })
            .strict()
            .default({ corners: true, at: [], size: 4, round: true }),
        gates: z
            .array(
                z
                    .object({
                        edge: z.number().int().min(0).describe('The side it pierces: 0 runs from the first point to the second.'),
                        at: fraction.default(0.5).describe('How far along that side its middle stands.'),
                        width: squares.default(2).describe('Squares across its passage.'),
                        state: z.enum(['closed', 'open', 'gap']).default('closed').describe('Its gate shut, standing open, or a breach with no gate at all.'),
                        animation: z
                            .enum(DOOR_ANIMATIONS)
                            .default('swing')
                            .describe('How its gate opens: `swing` leaves, `ascend` a portcullis, `slide` a sliding gate.'),
                    })
                    .strict(),
            )
            .default([]),
    })
    .strict()
    .superRefine((c, ctx) => {
        c.gates.forEach((gate, i) => {
            if (gate.edge >= c.points.length) {
                ctx.addIssue({ code: 'custom', path: ['gates', i, 'edge'], message: `the wall has ${c.points.length} sides` });
            }
        });
    })
    .describe(
        'A curtain wall: a thick band of masonry along a closed line, solid at ground level, the walk along its top drawn between its faces; towers at its corners (and where asked), gates through it with their passage and gate.',
    );

/** A box on the map, in grid squares from its top-left corner. */
const mapRect = z.object({ x: z.number(), y: z.number(), w: squares, h: squares }).strict();

const district = z
    .object({
        area: mapRect.describe('The part of the map the district fills.'),
        street: squares.default(2.5).describe('Squares across the streets its first cuts leave.'),
        alley: squares.default(1.2).describe('Squares across the alleys between blocks deeper in.'),
        block: z
            .tuple([squares, squares])
            .default([5, 12])
            .refine(([least, most]) => least * 2 <= most, 'a block may be cut in two only if two of the least fit the most')
            .describe('Squares a block runs along its longer side: at least, at most.'),
        keepOpen: z.array(mapRect).default([]).describe('Ground no block stands on (a chapel, its stair and forecourt, a plaza).'),
        roofs: z.array(text).min(1).default(['floor.deck-plating']).describe('Texture roles its roofs are drawn in, one to a block, chosen among them.'),
        wall: text.default('wall.concrete').describe('Wall texture role round each block.'),
        courtyard: text.default('floor.concrete').describe('Texture role of the courtyards open in its larger blocks.'),
        streetPieces: z
            .array(z.object({ ...namedPieceSize }).strict())
            .default([])
            .describe('Named pieces its streets are dressed with, against the blocks’ frontages (drainage grates, utility cabinets, public stairs).'),
        frontage: fraction.default(0.3).describe('Share of block frontages with a street piece against them: 0 bare streets, 1 every frontage.'),
        roofPieces: z
            .array(z.object({ ...namedPieceSize }).strict())
            .default([])
            .describe('Named pieces its roofs carry (vent stacks, conduit housings, cooling fans, access hatches): one to three to a block.'),
    })
    .strict()
    .describe('A stretch of city: blocks of buildings seen from above, walled so none is walked into, cut by streets and alleys, never ruled.');

const outdoorFixture = z
    .object({ ...namedPiece, at: point.describe('Its centre, in grid squares from the map’s top-left corner.') })
    .strict()
    .superRefine(checkOpenEnds)
    .describe('A named piece standing outside (a flight of steps, a plinth, a drain grate), placed before anything is scattered.');

const room = z
    .object({
        key: text.describe('This room’s name among the building’s rooms, for `opensTo`.'),
        purpose: z.enum(ROOM_PURPOSES),
        size: squares.default(1).describe('Floor area relative to the building’s other rooms (2 is twice as big as 1).'),
        opensTo: z.array(text).default([]).describe('Rooms it has a door into; the layout puts them side by side.'),
        doorOpen: z.boolean().default(false).describe('Its doors to the rooms it opens onto stand open (a room left open, its sliding door slid back).'),
        archTo: z
            .array(text)
            .default([])
            .describe(
                'Rooms it opens onto through a doorless archway: the wall they share open but for a pier at each end (a corridor’s mouth), or only `archWidth` of it.',
            ),
        archWidth: squares
            .nullable()
            .default(null)
            .describe(
                'Squares across its archways, the rest of each shared wall left standing (a narthex walled off from its nave but for one arch in line with the aisle); null: the whole wall but its piers.',
            ),
        archAt: fraction
            .nullable()
            .default(null)
            .describe(
                'Where along each shared wall the centre of an `archWidth` archway stands, as a fraction of that wall from its top or left end; null: its middle.',
            ),
        secretTo: z
            .array(text)
            .default([])
            .describe(
                'Rooms it opens onto through a secret door: plain wall to look at from either side, a native secret door to find (a vault behind a crypt).',
            ),
        doorAt: fraction
            .nullable()
            .default(null)
            .describe(
                'Where along each wall it shares a door through stands, as a fraction of that wall from its top or left end (a row of identical cells); null: anywhere.',
            ),
        entrance: z.boolean().default(false).describe('Has the building’s front door. Without one marked, the first room has it.'),
        floor: text.optional().describe('Its own floor texture role (a kitchen’s flagstones among plank rooms); omitted, the building’s.'),
        rect: z
            .object({ x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().min(1), h: z.number().int().min(1) })
            .strict()
            .optional()
            .describe(
                'Exactly where it lies, in squares from the building’s top-left corner. When every room of a floor gives one, the layout is taken as given.',
            ),
        grime: fraction
            .default(DEFAULT_GRIME)
            .describe('How much grime (stains, cracks, dust) gathers on its floor along its walls: 0 none, 1 filthy; a little when omitted.'),
        chamfer: squares
            .nullable()
            .default(null)
            .describe('Its corners cut off diagonally this many squares (an octagonal chamber), the cut corners solid masonry; null: square corners.'),
        chamferAt: z
            .array(z.enum(CORNERS))
            .min(1)
            .default([...CORNERS])
            .describe('Which corners its chamfer cuts: all four (an octagonal chamber), or some (a hull tapering to its bow, a blunt stern).'),
        fixtures: z.array(fixture).default([]).describe('Named pieces it holds, placed first, each where asked.'),
        furnish: z
            .enum(['purpose', 'fixtures'])
            .default('purpose')
            .describe('What furnishes it: its fixtures, then what its purpose adds; or its fixtures alone, as a map drawn to a brief is.'),
    })
    .strict()
    .superRefine((r, ctx) => {
        r.fixtures.forEach(({ place }, i) => {
            if ('before' in place && !r.fixtures.slice(0, i).some((earlier) => earlier.name === place.before)) {
                ctx.addIssue({ code: 'custom', path: ['fixtures', i, 'place', 'before'], message: `no fixture named ${place.before} comes before it` });
            }
        });
    });

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
        wallBand: squares
            .nullable()
            .default(null)
            .describe(
                'A band this many squares deep of its wall material round the outside of its footprint, broken at its doorways: heavy masonry. Null: its walls alone.',
            ),
        entrance: edge.default('south').describe('The side its front door faces.'),
        frontDoor: z
            .boolean()
            .default(true)
            .describe(
                'Has a front door; false: no way in through its outer walls but its `openings` (a guest floor reached only by its stair, a sealed vault).',
            ),
        frontDoorAt: z
            .number()
            .int()
            .min(0)
            .nullable()
            .default(null)
            .describe(
                'Squares along the entrance side from its top or left end where the front door stands; null: anywhere along the entrance room’s outer wall.',
            ),
        frontDoorWidth: z.number().int().min(1).default(1).describe('Squares wide: 2 for double doors.'),
        frontDoorOpen: z.boolean().default(false).describe('The front door standing open (stuck on seized hinges, left unbarred).'),
        frontDoorGap: z.boolean().default(false).describe('No door at all where the front door would be: a breach, a street running on off the map.'),
        doorAnimation: z
            .enum(DOOR_ANIMATIONS)
            .nullable()
            .default(null)
            .describe(
                'How its doors open, where no door art hangs in the doorway: `slide` (a panel into the wall, seen open as a bare doorway), `ascend` (a shutter rising), `swing` on hinges; null: Foundry’s default swing.',
            ),
        doorTags: z
            .array(text)
            .default([])
            .describe(
                'Door art its doorways are hung with must carry one of these tags (`timber`, `bulkhead`, `blast`); none: any door art as wide as the doorway.',
            ),
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
        accessRoom: text
            .nullable()
            .default(null)
            .describe(
                'The ground-floor room the stair or ladder between storeys stands in (the living area’s floor-hatch down to engineering); null: a hall where there is one, else wherever every storey holds it.',
            ),
        stormDoor: edge
            .nullable()
            .default(null)
            .describe('The side with storm doors down into the top cellar from outside, through a small areaway beside the wall; null for none.'),
        porch: squares
            .nullable()
            .default(null)
            .describe('A board porch this many squares deep along the front wall at the front door, with a bench, barrels and a lamp; null for none.'),
        yard: z.boolean().default(false).describe('A working yard: stores stacked against the outside walls and a cart or wagon standing by.'),
        openings: z
            .array(
                z
                    .object({
                        side: edge,
                        at: z.number().int().min(0).describe('Squares along that side from the building’s top or left end.'),
                        width: z.number().int().min(1).default(1).describe('Squares wide: 2 for double doors, more for a loading bay.'),
                        open: z.boolean().default(false).describe('Standing open (a door stuck open on seized hinges, an unbarred gate).'),
                        gap: z.boolean().default(false).describe('No door at all: a collapsed frontage, a breach, a way running on off the map.'),
                        room: text
                            .optional()
                            .describe(
                                'The ground-floor room whose own wall on that side it opens, where that wall stands short of the footprint’s edge (an irregular building); omitted, the room on the footprint’s edge there.',
                            ),
                    })
                    .strict(),
            )
            .default([])
            .describe('Doorways in the outer walls besides the front door (a warehouse’s other doors, a hall’s side exits).'),
    })
    .strict()
    .superRefine((b, ctx) => {
        if (b.stormDoor !== null && b.cellars.length === 0) {
            ctx.addIssue({ code: 'custom', path: ['stormDoor'], message: 'storm doors lead down into a cellar, and the building has none' });
        }
        const wallLength = (side: z.infer<typeof edge>): number => (side === 'north' || side === 'south' ? b.width : b.height);
        b.openings.forEach((o, i) => {
            if (o.at + o.width > wallLength(o.side)) {
                ctx.addIssue({ code: 'custom', path: ['openings', i, 'at'], message: `the ${o.side} wall is ${wallLength(o.side)} squares long` });
            }
            if (o.room !== undefined && !b.rooms.some((r) => r.key === o.room)) {
                ctx.addIssue({ code: 'custom', path: ['openings', i, 'room'], message: `no ground-floor room is named ${o.room}` });
            }
        });
        if (b.accessRoom !== null && !b.rooms.some((r) => r.key === b.accessRoom)) {
            ctx.addIssue({ code: 'custom', path: ['accessRoom'], message: `no ground-floor room is named ${b.accessRoom}` });
        }
        if (b.frontDoorAt !== null && b.frontDoorAt + b.frontDoorWidth > wallLength(b.entrance)) {
            ctx.addIssue({ code: 'custom', path: ['frontDoorAt'], message: `the ${b.entrance} wall is ${wallLength(b.entrance)} squares long` });
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
                for (const field of ['opensTo', 'archTo', 'secretTo'] as const) {
                    r[field].forEach((other, j) => {
                        if (!keys.includes(other) || other === r.key) {
                            ctx.addIssue({ code: 'custom', path: [...at, i, field, j], message: `${r.key} cannot open to ${other}` });
                        }
                    });
                }
            });
            pinnedIssues(rooms, b).forEach(({ index, message }) => {
                ctx.addIssue({ code: 'custom', path: [...at, index, 'rect'], message });
            });
        }
    });

/** What is wrong with a floor's placed rooms: placed only in part, reaching past the building, or lying on one another. */
function pinnedIssues(
    rooms: readonly { readonly key: string; readonly rect?: Rect | undefined }[],
    b: { readonly width: number; readonly height: number },
): { index: number; message: string }[] {
    const placed = rooms.filter((r) => r.rect !== undefined).length;
    if (placed === 0) {
        return [];
    }
    if (placed < rooms.length) {
        const index = rooms.findIndex((r) => r.rect === undefined);
        return [{ index, message: `every room of a floor is placed, or none is: ${rooms[index]?.key ?? ''} has no rect` }];
    }
    return rooms.flatMap((r, index) => {
        const box = r.rect;
        if (box === undefined) {
            return [];
        }
        if (box.x + box.w > b.width || box.y + box.h > b.height) {
            return [{ index, message: `${r.key} reaches past the building` }];
        }
        const onto = rooms
            .slice(0, index)
            .find(({ rect: o }) => o !== undefined && box.x < o.x + o.w && o.x < box.x + box.w && box.y < o.y + o.h && o.y < box.y + box.h);
        return onto ? [{ index, message: `${r.key} lies on ${onto.key}` }] : [];
    });
}

/** A placed room's rectangle, in squares from its building's corner. */
interface Rect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

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
        soft: z.boolean().default(false).describe('Paving only: its edge feathered rather than crisp (standing water, a stain), not laid hard standing.'),
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

/**
 * A raised platform (a feed grate over a machine, a catwalk along vats, a
 * gantry bridge): its floor on the level above the ground, railed round but
 * where its stair arrives; the stair stands on the ground against that side,
 * climbing to it.
 */
const platform = z
    .object({
        name: text.default('Platform').describe('The level it stands on, named (the first platform’s name, where a building’s floors give none).'),
        rect: mapRect.describe('Its floor, in grid squares from the map’s top-left corner.'),
        floor: text.default('floor.metal-grating').describe('Texture role its floor is drawn in.'),
        fixtures: z
            .array(outdoorFixture)
            .default([])
            .describe('Named pieces standing on it (a feed hopper at a grate’s edge), each where asked in map squares.'),
        stair: z
            .object({
                side: z.enum(WALL_SIDES).describe('The side of the platform its stair climbs to.'),
                at: z.number().min(0).describe('Where along that side the stair arrives, in squares from its top or left end.'),
            })
            .strict()
            .nullable()
            .default(null)
            .describe('Its stair up from the ground; null for one reached from beyond the map (an overpass from wall to wall).'),
    })
    .strict()
    .superRefine((p, ctx) => {
        if (p.stair === null) {
            return;
        }
        const along = p.stair.side === 'top' || p.stair.side === 'bottom' ? p.rect.w : p.rect.h;
        if (p.stair.at >= along) {
            ctx.addIssue({ code: 'custom', path: ['stair', 'at'], message: `the platform's ${p.stair.side} side is ${along} squares long` });
        }
    })
    .describe('A raised platform: its floor on the level above the ground, railed round but where its stair from the ground arrives.');

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
            .enum(['day', 'dim', 'night'])
            .default('day')
            .describe(
                'Day leaves the scene lit. Dim (an interior, the underhive) is half dark, each room lit by its own light and its lamps, the walls cutting the light. By night the scene is dark and rooms are lit by what is in them (a hearth, lamps), not a flat light; a room with nothing to light it keeps its own.',
            ),
        groundTexture: groundTexture,
        backdrop: z
            .string()
            .regex(/^#[0-9a-f]{6}$/iu, 'a #rrggbb colour')
            .nullable()
            .default(null)
            .describe(
                'The colour shown round the map where nothing is drawn (the void round a ship, the dark round a tunnel), `#rrggbb`; null: the scene’s own.',
            ),
        zones: z.array(zone).default([]),
        paths: z.array(path).default([]),
        buildings: z.array(building).default([]),
        props: z.array(prop).default([]),
        fixtures: z.array(outdoorFixture).default([]),
        hewn: z.array(hewn).default([]),
        districts: z.array(district).default([]),
        curtains: z.array(curtain).default([]),
        platforms: z.array(platform).default([]),
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
export type FixtureIntent = RoomIntent['fixtures'][number];
export type HewnIntent = MapIntent['hewn'][number];
export type DistrictIntent = MapIntent['districts'][number];
export type CurtainIntent = MapIntent['curtains'][number];
export type PlatformIntent = MapIntent['platforms'][number];
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
