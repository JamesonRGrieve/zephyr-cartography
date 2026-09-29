// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Urban districts: an area of a city cut into blocks by streets and, deeper
 * in, narrow alleys; each block a building seen from above, its roof walled
 * round so no one walks into it, never a ruled grid: blocks stand back from
 * their streets by differing amounts, some lose a corner to a yard, and the
 * larger keep a courtyard open in their middle. Areas asked to stay open (a
 * chapel and its forecourt, a plaza) take no blocks. Seeded and pure.
 */
import { outlineRoomSpec, type Rect, type RoomBuild, type Side } from '../generate/floor-plan';
import { randomInt, type Random } from '../generate/random';
import type { SceneSpecInput } from '../generate/spec';
import { boundsOf } from '../geometry/bounds';
import { pointInPolygon } from '../geometry/hit';
import type { Point } from '../geometry/spline';
import type { DistrictIntent } from './intent';
import { namedArt, namedBox, standsAs } from './named';
import type { RoleIndex } from './roles';

type FeatureInput = SceneSpecInput['features'][number];

/** Splits deep enough to cut a street rather than an alley: the first this many. */
const STREET_DEPTH = 2;

/** A block's setback from its streets, in squares, at most. */
const MAX_SETBACK = 0.5;

/** Chance a block loses a corner to a yard, and the share of each side the yard takes at most. */
const NOTCH = { chance: 0.45, share: 0.45 } as const;

/** Blocks at least this many squares on each side may keep a courtyard (by this chance), between these shares of each side across. */
const COURTYARD = { min: 9, chance: 0.65, share: [0.24, 0.42] } as const;

/** Whether two boxes overlap. */
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** `rect` grown by `by` on every side. */
const grown = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });

/**
 * `area` cut into blocks: each cut runs across the longer side, leaving a
 * street (an alley once deep enough) between its halves, until a part is no
 * bigger than a block may be.
 */
function blocksIn(area: Rect, district: DistrictIntent, random: Random, depth = 0): Rect[] {
    const [least, most] = district.block;
    const alongX = area.w >= area.h;
    const span = alongX ? area.w : area.h;
    const gap = depth < STREET_DEPTH ? district.street : district.alley;
    if (span <= most || span - gap < 2 * least) {
        return [area];
    }
    // Somewhere in the middle half, so blocks come in differing sizes.
    const at = least + random() * Math.max(0, span - gap - 2 * least);
    const [first, second]: Rect[] = alongX
        ? [
              { ...area, w: at },
              { ...area, x: area.x + at + gap, w: area.w - at - gap },
          ]
        : [
              { ...area, h: at },
              { ...area, y: area.y + at + gap, h: area.h - at - gap },
          ];
    return [first, second].flatMap((part) => (part === undefined ? [] : blocksIn(part, district, random, depth + 1)));
}

/**
 * `area` less every box in `kept`: what is left of it round them, as boxes
 * (the strips beside, above and below each), a street's width `gap` kept
 * round each. Strips thinner than `least` are left as open ground.
 */
function carve(area: Rect, kept: readonly Rect[], gap: number, least: number): Rect[] {
    const [first, ...rest] = kept;
    if (first === undefined) {
        return [area];
    }
    const hole = grown(first, gap);
    if (!overlaps(area, hole)) {
        return carve(area, rest, gap, least);
    }
    const x0 = Math.max(area.x, hole.x);
    const x1 = Math.min(area.x + area.w, hole.x + hole.w);
    const strips: Rect[] = [
        { x: area.x, y: area.y, w: x0 - area.x, h: area.h },
        { x: x1, y: area.y, w: area.x + area.w - x1, h: area.h },
        { x: x0, y: area.y, w: x1 - x0, h: hole.y - area.y },
        { x: x0, y: hole.y + hole.h, w: x1 - x0, h: area.y + area.h - hole.y - hole.h },
    ];
    return strips.filter((s) => s.w >= least && s.h >= least).flatMap((s) => carve(s, rest, gap, least));
}

/** A block's outline: its box, standing back from its streets, perhaps (where `notchable`) with a corner cut away to a yard. */
function blockOutline(block: Rect, random: Random, notchable: boolean): Point[] {
    const inset = (): number => random() * MAX_SETBACK;
    const [fromLeft, fromTop, fromRight, fromBottom] = [inset(), inset(), inset(), inset()];
    const x0 = block.x + fromLeft;
    const y0 = block.y + fromTop;
    const x1 = block.x + block.w - fromRight;
    const y1 = block.y + block.h - fromBottom;
    const corners: Point[] = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
    ];
    if (!notchable || random() >= NOTCH.chance) {
        return corners;
    }
    // One corner cut back: the outline turns in and out round the yard it leaves, still clockwise.
    const corner = randomInt(random, 0, 3);
    const nx = Math.max(1, Math.round((x1 - x0) * NOTCH.share * (0.5 + random() / 2)));
    const ny = Math.max(1, Math.round((y1 - y0) * NOTCH.share * (0.5 + random() / 2)));
    const cut: readonly Point[][] = [
        [
            { x: x0, y: y0 + ny },
            { x: x0 + nx, y: y0 + ny },
            { x: x0 + nx, y: y0 },
        ],
        [
            { x: x1 - nx, y: y0 },
            { x: x1 - nx, y: y0 + ny },
            { x: x1, y: y0 + ny },
        ],
        [
            { x: x1, y: y1 - ny },
            { x: x1 - nx, y: y1 - ny },
            { x: x1 - nx, y: y1 },
        ],
        [
            { x: x0 + nx, y: y1 },
            { x: x0 + nx, y: y1 - ny },
            { x: x0, y: y1 - ny },
        ],
    ];
    return corners.flatMap((p, i) => (i === corner ? cut[i] ?? [p] : [p]));
}

/** The turn that stands a piece against a block's `side`, outside it: its back (the image's top) to the block. */
const BACK_TO_BLOCK: Readonly<Record<Side, number>> = { top: 180, right: 270, bottom: 0, left: 90 };

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/**
 * Street pieces against the blocks' frontages: now and then (the district's
 * `frontage` share of blocks) one stands in the street against a side of a
 * block, its back to the wall, clear of every other block and piece and
 * inside the district. In its art where a pack draws it, else a box.
 */
function frontagePieces(
    district: DistrictIntent,
    blocks: readonly Rect[],
    stamps: RoleIndex,
    random: Random,
    level: { level?: string },
): { features: FeatureInput[]; boxed: string[] } {
    const features: FeatureInput[] = [];
    const boxed: string[] = [];
    const taken: Rect[] = [...blocks];
    for (const block of blocks) {
        const choice = district.streetPieces[randomInt(random, 0, district.streetPieces.length - 1)];
        const side = SIDES[randomInt(random, 0, SIDES.length - 1)];
        if (choice === undefined || side === undefined || random() >= district.frontage) {
            continue;
        }
        const art = namedArt(choice, stamps);
        const piece = art ?? namedBox(choice);
        const turn = piece.upright ? 0 : BACK_TO_BLOCK[side];
        const across = turn % HALF_TURN !== 0;
        const [w, h] = across ? [piece.height, piece.width] : [piece.width, piece.height];
        const t = random();
        const box: Record<Side, Rect> = {
            top: { x: block.x + t * Math.max(0, block.w - w), y: block.y - h, w, h },
            bottom: { x: block.x + t * Math.max(0, block.w - w), y: block.y + block.h, w, h },
            left: { x: block.x - w, y: block.y + t * Math.max(0, block.h - h), w, h },
            right: { x: block.x + block.w, y: block.y + t * Math.max(0, block.h - h), w, h },
        };
        const at = box[side];
        const inside =
            at.x >= district.area.x &&
            at.y >= district.area.y &&
            at.x + at.w <= district.area.x + district.area.w &&
            at.y + at.h <= district.area.y + district.area.h;
        if (!inside || taken.some((other) => overlaps(at, other))) {
            continue;
        }
        taken.push(at);
        if (art === undefined) {
            boxed.push(choice.name);
        }
        features.push(...standsAs(piece, { x: at.x + at.w / 2, y: at.y + at.h / 2 }, turn).map((s) => ({ type: 'stamp' as const, ...s, ...level })));
    }
    return { features, boxed };
}

/** Pieces a roof carries, at least and at most, and how far in from its edge (squares) they keep. */
const ROOF = { pieces: [1, 3], margin: 0.8 } as const;

/**
 * What stands on a block's roof: a few of the district's roof pieces, each
 * inside the roof clear of its edge, of its courtyard (`court`) and of one
 * another, turned square at random. In its art where a pack draws it, else
 * a box.
 */
function roofPieces(
    district: DistrictIntent,
    outline: readonly Point[],
    court: Rect | null,
    stamps: RoleIndex,
    random: Random,
    level: { level?: string },
): { features: FeatureInput[]; boxed: string[] } {
    const roof = boundsOf(outline);
    // Wholly on the roof: a block that lost a corner has none there.
    const onRoof = (r: Rect): boolean =>
        [
            { x: r.x, y: r.y },
            { x: r.x + r.w, y: r.y },
            { x: r.x + r.w, y: r.y + r.h },
            { x: r.x, y: r.y + r.h },
        ].every((p) =>
            pointInPolygon(
                p,
                outline.flatMap((q) => [q.x, q.y]),
            ),
        );
    const features: FeatureInput[] = [];
    const boxed: string[] = [];
    const taken: Rect[] = court === null ? [] : [grown(court, ROOF.margin / 2)];
    const count = district.roofPieces.length === 0 ? 0 : randomInt(random, ROOF.pieces[0], ROOF.pieces[1]);
    for (let n = 0; n < count; n++) {
        const choice = district.roofPieces[randomInt(random, 0, district.roofPieces.length - 1)];
        if (choice === undefined) {
            break;
        }
        const art = namedArt(choice, stamps);
        const piece = art ?? namedBox(choice);
        const turn = piece.upright ? 0 : randomInt(random, 0, 3) * (HALF_TURN / 2);
        const [w, h] = turn % HALF_TURN !== 0 ? [piece.height, piece.width] : [piece.width, piece.height];
        const room = { x: roof.x + ROOF.margin, y: roof.y + ROOF.margin, w: roof.w - 2 * ROOF.margin - w, h: roof.h - 2 * ROOF.margin - h };
        const at = { x: room.x + random() * Math.max(0, room.w), y: room.y + random() * Math.max(0, room.h), w, h };
        if (room.w < 0 || room.h < 0 || !onRoof(at) || taken.some((t) => overlaps(t, at))) {
            continue;
        }
        taken.push(at);
        if (art === undefined) {
            boxed.push(choice.name);
        }
        features.push(...standsAs(piece, { x: at.x + w / 2, y: at.y + h / 2 }, turn).map((s) => ({ type: 'stamp' as const, ...s, ...level })));
    }
    return { features, boxed };
}

/** Degrees in a half turn. */
const HALF_TURN = 180;

/**
 * The blocks `district` builds: each a walled roof (a room floored in its
 * roof), a large one round a courtyard (a room floored in the street's paving
 * within it), none on the ground kept open; and its streets' pieces against
 * their frontages, with the names of those no art draws.
 */
export function districtFeatures(
    district: DistrictIntent,
    stamps: RoleIndex,
    random: Random,
    level: { level?: string },
): { features: FeatureInput[]; boxed: string[] } {
    const build = (floor: string): RoomBuild => ({ floor, wall: district.wall, wallKind: 'solid', ceiling: true });
    const outlines: Point[][] = [];
    const onRoofs: FeatureInput[] = [];
    const boxed: string[] = [];
    /** A block's roof pieces, kept for after the buildings, so they stand on the roofs. */
    const dressRoof = (outline: readonly Point[], court: Rect | null): void => {
        const roofed = roofPieces(district, outline, court, stamps, random, level);
        onRoofs.push(...roofed.features);
        boxed.push(...roofed.boxed);
    };
    // The open ground carved out first, a street round it, the rest cut into blocks.
    const buildings = carve(district.area, district.keepOpen, district.street, district.block[0])
        .flatMap((part) => blocksIn(part, district, random))
        .flatMap((block): FeatureInput[] => {
            // A large block keeps a courtyard in its middle; a smaller one may lose a corner to a yard instead.
            const courtyard = block.w >= COURTYARD.min && block.h >= COURTYARD.min && random() < COURTYARD.chance;
            const outline = blockOutline(block, random, !courtyard);
            outlines.push(outline);
            const roofing = district.roofs[randomInt(random, 0, district.roofs.length - 1)] ?? 'floor.deck-plating';
            const roof: FeatureInput = { ...outlineRoomSpec(outline, build(roofing)), ...level };
            if (!courtyard) {
                dressRoof(outline, null);
                return [roof];
            }
            // Its size and where it lies differ block to block, never nearer the edge than a quarter of the block.
            const share = (): number => COURTYARD.share[0] + random() * (COURTYARD.share[1] - COURTYARD.share[0]);
            const cw = Math.round(block.w * share());
            const ch = Math.round(block.h * share());
            const cx = block.x + Math.round(block.w / 4 + random() * Math.max(0, block.w / 2 - cw));
            const cy = block.y + Math.round(block.h / 4 + random() * Math.max(0, block.h / 2 - ch));
            const court: Point[] = [
                { x: cx, y: cy },
                { x: cx + cw, y: cy },
                { x: cx + cw, y: cy + ch },
                { x: cx, y: cy + ch },
            ];
            dressRoof(outline, { x: cx, y: cy, w: cw, h: ch });
            // Drawn after the roof, so it lies over it: a room within a room is drawn above it.
            return [roof, { ...outlineRoomSpec(court, build(district.courtyard)), ...level }];
        });
    const dressed = frontagePieces(district, outlines.map(boundsOf), stamps, random, level);
    return { features: [...buildings, ...onRoofs, ...dressed.features], boxed: [...boxed, ...dressed.boxed] };
}
