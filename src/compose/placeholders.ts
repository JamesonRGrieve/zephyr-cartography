// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Placeholders: a piece no loaded stamp draws still stands where the layout
 * wants it, as a labelled box its size, so a map shows every piece its
 * design calls for (a guest room's dresser, a bar's shelves, a named
 * fixture such as a drain grate) until the art exists. The composer lays a
 * placeholder out like any stamp, reports it, and draws it as a native
 * rectangle with its name written in it. A placeholder's key carries its
 * size and its label. Roles scattered by the dozen (clutter, what is set on
 * a table, ground litter), shaped by what they serve (a stair, a bridge) or
 * laid only to dress a floor (a rug) have no box of their own. Pure.
 */
import type { SceneSpecInput } from '../generate/spec';
import { STAMP_HABITATS, STAMP_ROLES, type StampRole } from '../stamps/schema';
import type { ComposeProblem } from './problems';
import { placementOf } from './role-tags';
import type { RoleIndex, RoleStamp } from './roles';

type FeatureInput = SceneSpecInput['features'][number];

/** A placeholder's catalog key: this, its size and its label (`placeholder:1.2x0.5:dresser`). */
const PLACEHOLDER_PREFIX = 'placeholder:';

/** A placeholder key's size, whether it lies flat on the floor, and its label. */
const PLACEHOLDER_KEY = /^placeholder:(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(:flat)?:(.+)$/u;

/** Roles that lie flat on the floor (a stain, a rug): their boxes are drawn as marks on it, never as objects standing there. */
const FLAT_ROLES: readonly StampRole[] = ['decal', 'rug'];

/** Each role's usual footprint in grid squares, its back along the width: the size its box stands at. */
const PLACEHOLDER_SIZES: Partial<Readonly<Record<StampRole, readonly [number, number]>>> = {
    tree: [3, 3],
    shrub: [1, 1],
    rock: [1, 1],
    log: [2, 1],
    table: [1.5, 1],
    seat: [0.6, 0.6],
    bench: [1.5, 0.5],
    counter: [3, 1],
    hearth: [1.5, 1],
    shelf: [1.5, 0.5],
    bed: [1, 2],
    storage: [1, 1],
    desk: [1.5, 0.8],
    workbench: [2, 1],
    light: [0.5, 0.5],
    machine: [2, 2],
    console: [1.5, 0.8],
    altar: [2, 1],
    pew: [2, 0.8],
    lectern: [0.8, 0.8],
    icon: [0.8, 0.4],
    rack: [2, 0.6],
    medical: [1, 2],
    restraint: [1, 2],
    structure: [4, 4],
    barricade: [2, 0.6],
    emplacement: [2, 2],
    vehicle: [3, 2],
    nightstand: [0.5, 0.5],
    well: [1.2, 1.2],
    waymark: [0.5, 0.5],
    chest: [0.8, 0.5],
    enclosure: [4, 4],
    fodder: [2, 1.5],
    dresser: [1.2, 0.5],
    armchair: [0.8, 0.8],
};

/** Whether the stamp keyed `key` is a placeholder. */
export const isPlaceholder = (key: string | undefined): boolean => key?.startsWith(PLACEHOLDER_PREFIX) === true;

/** A labelled box `width` by `height` squares standing as `role` would: what the composer places for a piece no stamp draws. */
export function placeholder(role: StampRole, label: string, width: number, height: number): RoleStamp {
    const { against, clearance } = placementOf(role, [], undefined);
    return {
        key: `${PLACEHOLDER_PREFIX}${width}x${height}${FLAT_ROLES.includes(role) ? ':flat' : ''}:${label}`,
        role,
        width,
        height,
        turn: 0,
        against,
        clearance,
        upright: false,
        // Any ground: land stands in for whatever its zone wanted.
        habitats: STAMP_HABITATS,
        climb: null,
        borrowed: false,
        purposes: [],
        tags: [],
    };
}

/** `stamps` with a placeholder for every role that has one and no stamp of its own. */
export function withPlaceholders(stamps: RoleIndex): RoleIndex {
    const index = new Map(stamps);
    for (const role of STAMP_ROLES) {
        const size = PLACEHOLDER_SIZES[role];
        if (size !== undefined && (index.get(role) ?? []).length === 0) {
            index.set(role, [placeholder(role, role.replace(/-/gu, ' '), size[0], size[1])]);
        }
    }
    return index;
}

/** What wanting `piece` where `stamp` (the one chosen for it, if any) came from costs: a box standing in, or nothing placed. */
export function missing(piece: StampRole, wantedIn: string, stamp: RoleStamp | undefined): ComposeProblem | null {
    if (stamp !== undefined && !isPlaceholder(stamp.key)) {
        return null;
    }
    return stamp === undefined ? { kind: 'no-stamp', role: piece, wantedIn } : { kind: 'placeholder', piece, wantedIn };
}

/** How a placeholder is drawn: a dark translucent box, a pale frame and pale text, clear over any floor or ground. */
const PLACEHOLDER_LOOK = {
    stroke: { colour: '#e8dcc0', width: 2, alpha: 0.9 },
    fill: { colour: '#1c1812', alpha: 0.55 },
    text: '#f4ead2',
} as const;

/**
 * How a flat one is drawn: a clear frame over the floor, barely filled, so
 * it reads as a mark painted on it (a berth's bay, a stain's spread), not a
 * thing in the way; a hairline frame vanished on dark plating.
 */
const FLAT_LOOK = {
    stroke: { colour: '#e8dcc0', width: 3, alpha: 0.8 },
    fill: { colour: '#1c1812', alpha: 0.15 },
    text: '#f4ead2',
} as const;

/** Px per grid square the label's type is sized for: the reference grid the packs are drawn at. */
const LABEL_GRID_PX = 100;

/** Share of a character's size its width takes, for fitting a label across its box. */
const CHARACTER_WIDTH = 0.6;

/** Degrees; a label turned this way reads upward, along a box standing upright. */
const READ_UPWARD = 270;

/** A half turn, degrees: a box turned by a multiple of it lies as drawn. */
const HALF_TURN = 180;

/** The smallest and largest type a placeholder's label is set in, px. */
const LABEL_FONT = { min: 10, max: 24 } as const;

/** A line of a label's height, as a share of its type size. */
const LINE_HEIGHT = 1.2;

/** `text` broken at its spaces into lines of at most `columns` characters (a longer word keeps a line of its own). */
function wrap(text: string, columns: number): string[] {
    const lines: string[] = [];
    for (const word of text.split(' ')) {
        const last = lines.at(-1);
        if (last !== undefined && last.length + 1 + word.length <= columns) {
            lines[lines.length - 1] = `${last} ${word}`;
        } else {
            lines.push(word);
        }
    }
    return lines;
}

/**
 * A label set to fit a box `length` by `depth` px as it reads: the largest
 * type, down to the smallest readable, at which its words, wrapped, fit both
 * ways; at the smallest, wrapped to the box's length, whatever its depth.
 */
function fitLabel(text: string, span: number, depth: number): { text: string; fontSize: number } {
    // Every size from the largest down to just above the smallest.
    const sizes = Array.from({ length: LABEL_FONT.max - LABEL_FONT.min }, (_, i) => LABEL_FONT.max - i);
    for (const fontSize of sizes) {
        const lines = wrap(text, Math.floor(span / (fontSize * CHARACTER_WIDTH)));
        const widest = Math.max(...lines.map((l) => l.length));
        if (widest * fontSize * CHARACTER_WIDTH <= span && lines.length * fontSize * LINE_HEIGHT <= depth) {
            return { text: lines.join('\n'), fontSize };
        }
    }
    return { text: wrap(text, Math.floor(span / (LABEL_FONT.min * CHARACTER_WIDTH))).join('\n'), fontSize: LABEL_FONT.min };
}

/**
 * The spec's features with each placed placeholder stamp drawn as its
 * labelled box on its level: a rectangle its size, turned as it stands,
 * and its name written across it, sized to fit.
 */
export function drawPlaceholders(features: readonly FeatureInput[]): FeatureInput[] {
    return features.flatMap((feature): FeatureInput[] => {
        const parts = feature.type === 'stamp' ? PLACEHOLDER_KEY.exec(feature.stamp) : null;
        if (feature.type !== 'stamp' || parts === null) {
            return [feature];
        }
        const [, w = '1', h = '1', flat, label = ''] = parts;
        const look = flat === undefined ? PLACEHOLDER_LOOK : FLAT_LOOK;
        const width = Number(w);
        const height = Number(h);
        const { x, y } = feature;
        const rotation = feature.rotation ?? 0;
        const level = feature.level === undefined ? {} : { level: feature.level };
        // Along a box standing upright as it lies, read from below, rather than spilling off its sides.
        const turned = rotation % HALF_TURN !== 0;
        const upright = (turned ? width : height) > (turned ? height : width);
        // Along the box's longer side, wrapped over its depth, but never smaller than can be read.
        const { text, fontSize } = fitLabel(label, Math.max(width, height) * LABEL_GRID_PX, Math.min(width, height) * LABEL_GRID_PX);
        // What the piece reads (a sign's words) is read on hover over its box as it would be over its art.
        const reading: FeatureInput[] =
            feature.reads === undefined ? [] : [{ type: 'pin', x, y, text: feature.reads, readable: true, size: Math.max(width, height), ...level }];
        return [
            { type: 'shape', kind: 'rectangle', x, y, width, height, rotation, stroke: look.stroke, fill: look.fill, ...level },
            { type: 'label', x, y, text, fontSize, colour: look.text, ...(upright ? { rotation: READ_UPWARD } : {}), ...level },
            ...reading,
        ];
    });
}
