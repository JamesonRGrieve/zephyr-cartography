// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The AI-assisted mode's side of composing, pure: what an adviser (a
 * language model, Qwen by default) is asked, and what is made of its
 * answers. Two questions:
 * - Choosing: for each room and zone, the roles it wants and the stamps that
 *   could fill each (their names and tags); the adviser ranks those that
 *   suit the place, which become the composer's preferences.
 * - Critique: the composed rooms and what stands in them (where, facing
 *   which way, against which wall); the adviser answers with fixes (turn,
 *   move or remove a piece), each applied only if the composer's own rules
 *   still hold afterwards (inside its room, on no other piece).
 * Its answers are untrusted: anything unreadable, unknown or breaking a rule
 * is refused and reported, never thrown. The model call itself lives at the
 * Foundry boundary. Positions are in grid squares.
 */
import type { SceneSpecInput } from '../generate/spec';
import { pointInPolygon } from '../geometry/hit';
import type { StampRole } from '../stamps/schema';
import { buildingName, type Composition, composeMap, storeyName } from './compose';
import { zoneRoles } from './exterior';
import { type Box, overlaps, rolesOf } from './furnish';
import type { MapIntent } from './intent';
import { type Preferences, roomPlace, zonePlace } from './preferences';
import type { RoleIndex, RoleStamp } from './roles';

/** A chat message as an OpenAI-compatible API takes it. */
export interface AdviceMessage {
    readonly role: 'system' | 'user';
    readonly content: string;
}

/** What a stamp is, for the adviser: its name and tags. */
export interface StampInfo {
    readonly name: string;
    readonly tags: readonly string[];
}

/** Candidates offered per role and place, so a question stays a size a model reads well. */
const MAX_CANDIDATES = 24;

/** Fixes taken from one critique. */
const MAX_FIXES = 40;

const SYSTEM =
    'You help compose top-down battlemaps for tabletop role-playing games. ' +
    'Judge like an experienced map-maker: every room should look lived in and make sense for its purpose and setting. ' +
    'Answer with one JSON value and nothing else.';

/** The first complete JSON object or array in `text` (a model may wrap it in prose or thinking), or undefined. */
// eslint-disable-next-line no-restricted-syntax -- boundary: a model's reply is untyped JSON, narrowed by each reader below
export function firstJson(text: string): unknown {
    for (let start = 0; start < text.length; start++) {
        const opening = text[start];
        if (opening !== '{' && opening !== '[') {
            continue;
        }
        const closing = opening === '{' ? '}' : ']';
        for (let end = text.lastIndexOf(closing); end > start; end = text.lastIndexOf(closing, end - 1)) {
            try {
                return JSON.parse(text.slice(start, end + 1));
            } catch {
                // Not this span: try a shorter one.
            }
        }
    }
    return undefined;
}

// eslint-disable-next-line no-restricted-syntax -- boundary: narrows untyped JSON
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Each place the map furnishes or dresses, with the roles it wants. */
export function placesOf(intent: MapIntent): { place: string; what: string; roles: StampRole[] }[] {
    const rooms = intent.buildings.flatMap((building, i) =>
        [building.rooms, ...building.floors.map((f) => f.rooms)].flatMap((storeyRooms, storey) =>
            storeyRooms.map((room) => ({
                place: roomPlace(storeyName(buildingName(building, i), storey), room.key),
                what: `a ${room.purpose} room`,
                roles: rolesOf(room.purpose),
            })),
        ),
    );
    const zones = intent.zones.map((zone, i) => ({ place: zonePlace(i), what: `${zone.kind} ground outdoors`, roles: zoneRoles(zone.kind) }));
    return [...rooms, ...zones];
}

/** A role's candidates in a question: those it offers a choice between (more than one). */
const candidatesOf = (stamps: RoleIndex, role: StampRole): readonly RoleStamp[] => (stamps.get(role) ?? []).slice(0, MAX_CANDIDATES);

/**
 * Every candidate stamp a choosing question offers, numbered from 1, so the
 * question lists each once and the answer names them by number: a model
 * writes numbers far faster than keys.
 */
function numbered(intent: MapIntent, stamps: RoleIndex): Map<string, number> {
    const numbers = new Map<string, number>();
    for (const { roles } of placesOf(intent)) {
        for (const role of roles) {
            const candidates = candidatesOf(stamps, role);
            if (candidates.length > 1) {
                for (const s of candidates) {
                    if (!numbers.has(s.key)) {
                        numbers.set(s.key, numbers.size + 1);
                    }
                }
            }
        }
    }
    return numbers;
}

/** The choosing question: the candidate stamps, numbered, and each place's roles with theirs. */
export function choosingPrompt(intent: MapIntent, stamps: RoleIndex, info: ReadonlyMap<string, StampInfo>): AdviceMessage[] {
    const setting = intent.settings.length > 0 ? intent.settings.join(', ') : 'any setting';
    const numbers = numbered(intent, stamps);
    const listing = [...numbers].map(([key, n]) => {
        const known = info.get(key);
        return `${n} = ${known?.name ?? key} [${known?.tags.join(', ') ?? ''}]`;
    });
    const places = placesOf(intent).map(({ place, what, roles }) => {
        const lines = roles.flatMap((role) => {
            const candidates = candidatesOf(stamps, role);
            return candidates.length > 1 ? [`  ${role}: ${candidates.map((s) => numbers.get(s.key)).join(', ')}`] : [];
        });
        return lines.length > 0 ? [`${place} (${what}):`, ...lines].join('\n') : '';
    });
    const user =
        `A map in ${setting}. The stamps, by number:\n${listing.join('\n')}\n\n` +
        'For each place below, for each role, choose up to 3 of the numbers offered that best suit that place ' +
        '(its purpose and setting: a chapel wants holy pieces, a tavern homely ones, a factory industrial ones), best first. ' +
        'Leave out a role if none suits.\n\n' +
        `${places.filter((p) => p !== '').join('\n\n')}\n\n` +
        'Answer as {"<place>": {"<role>": [<number>, ...]}}.';
    return [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
    ];
}

/** Preferences from the adviser's choosing answer: only places, roles and stamps that were offered. */
export function readChoices(answer: string, intent: MapIntent, stamps: RoleIndex): Preferences {
    const json = firstJson(answer);
    if (!isRecord(json)) {
        return new Map();
    }
    const byNumber = new Map([...numbered(intent, stamps)].map(([key, n]) => [n, key]));
    const offered = new Map(placesOf(intent).map((p) => [p.place, p.roles]));
    const chosen = new Map<string, Map<StampRole, string[]>>();
    for (const [place, roles] of Object.entries(json)) {
        const wanted = offered.get(place);
        if (!wanted || !isRecord(roles)) {
            continue;
        }
        const byRole = new Map<StampRole, string[]>();
        for (const role of wanted) {
            const picks = roles[role];
            const keys = (Array.isArray(picks) ? picks : []).flatMap((n) => {
                const key = typeof n === 'number' ? byNumber.get(n) : undefined;
                return key !== undefined && candidatesOf(stamps, role).some((s) => s.key === key) ? [key] : [];
            });
            if (keys.length > 0) {
                byRole.set(role, keys);
            }
        }
        if (byRole.size > 0) {
            chosen.set(place, byRole);
        }
    }
    return chosen;
}

type FeatureInput = SceneSpecInput['features'][number];
type StampInput = Extract<FeatureInput, { type: 'stamp' }>;
type RoomInput = Extract<FeatureInput, { type: 'room' }>;

const COMPASS = ['north', 'east', 'south', 'west'] as const;
type Compass = (typeof COMPASS)[number];

const FULL_TURN = 360;
const QUARTER = 90;

/** The rotation (before a piece's own turn) that faces its front, the edge opposite its back, each way. */
const FACING_ROTATION: Readonly<Record<Compass, number>> = { north: 180, east: 270, south: 0, west: 90 };

/** Which way a piece's front faces, to the nearest quarter. */
function facingOf(rotation: number, turn: number): Compass {
    const quarter = Math.round(((((rotation - turn) % FULL_TURN) + FULL_TURN) % FULL_TURN) / QUARTER) % COMPASS.length;
    const byRotation: readonly Compass[] = ['south', 'west', 'north', 'east'];
    return byRotation[quarter] ?? 'south';
}

/** A room's bounds. */
function boundsOf(room: RoomInput): Box {
    const xs = room.points.map((p) => p.x);
    const ys = room.points.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** A piece, as the critique numbers it: its place in the spec's features, its stamp, and the room it stands in. */
interface Piece {
    readonly index: number;
    readonly feature: StampInput;
    readonly stamp: RoleStamp;
    readonly room: RoomInput;
}

/** A piece's floor box: its footprint, turned by its rotation to the nearest quarter. */
function boxOf(feature: StampInput, stamp: RoleStamp): Box {
    const across = Math.round(((feature.rotation ?? 0) - stamp.turn) / QUARTER) % 2 !== 0;
    const w = across ? stamp.height : stamp.width;
    const h = across ? stamp.width : stamp.height;
    return { x: feature.x - w / 2, y: feature.y - h / 2, w, h };
}

/** The pieces standing in the spec's rooms, numbered from 1. */
function piecesOf(spec: SceneSpecInput, stamps: RoleIndex): Piece[] {
    const byKey = new Map([...stamps.values()].flat().map((s) => [s.key, s]));
    const rooms = spec.features.flatMap((f) => (f.type === 'room' ? [f] : []));
    return spec.features.flatMap((feature, index) => {
        const stamp = feature.type === 'stamp' ? byKey.get(feature.stamp) : undefined;
        const room =
            feature.type === 'stamp'
                ? rooms.find(
                      (r) =>
                          r.level === feature.level &&
                          pointInPolygon(
                              feature,
                              r.points.flatMap((p) => [p.x, p.y]),
                          ),
                  )
                : undefined;
        return feature.type === 'stamp' && stamp && room ? [{ index, feature, stamp, room }] : [];
    });
}

/** The critique question: each room and what stands in it. */
export function critiquePrompt(spec: SceneSpecInput, stamps: RoleIndex, info: ReadonlyMap<string, StampInfo>): AdviceMessage[] {
    const pieces = piecesOf(spec, stamps);
    const rooms = [...new Set(pieces.map((p) => p.room))];
    const listing = rooms.map((room) => {
        const b = boundsOf(room);
        const own = pieces.filter((p) => p.room === room);
        const lines = own.map((p) => {
            const called = info.get(p.stamp.key)?.name ?? p.stamp.key;
            return `  #${p.index} ${called} (${p.stamp.role}) at (${p.feature.x.toFixed(1)}, ${p.feature.y.toFixed(1)}), front facing ${facingOf(
                p.feature.rotation ?? 0,
                p.stamp.turn,
            )}`;
        });
        return [`${room.key ?? 'room'}: x ${b.x} to ${b.x + b.w}, y ${b.y} to ${b.y + b.h} (y grows southward)`, ...lines].join('\n');
    });
    const user =
        'Here is a composed map: its rooms, and the pieces in each (grid squares). Find what makes no sense: a piece facing the wrong way ' +
        '(a seat turned away from its table, a counter facing the wall, a gun pointing at its own side), something out of place for the room, ' +
        'or a piece blocking the way through. Fix each with an action on its number: "turn" to face north, east, south or west; ' +
        '"move" to a new centre x, y in the same room; or "remove". Change only what is wrong; leave the rest.\n\n' +
        `${listing.join('\n\n')}\n\n` +
        'Answer as [{"piece": <number>, "action": "turn" | "move" | "remove", "facing": "north", "x": 1.5, "y": 2.5, "why": "..."}] ([] if all is well).';
    return [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
    ];
}

/** A fix the critique asked for, and whether it was made. */
export interface Fix {
    readonly piece: number;
    readonly action: string;
    readonly why: string;
    readonly applied: boolean;
}

/** One fix read from the answer, or null when it names no action on a known piece. */
// eslint-disable-next-line no-restricted-syntax -- boundary: one element of the model's untyped reply, narrowed here
function readFix(v: unknown): { piece: number; action: 'turn' | 'move' | 'remove'; facing?: Compass; x?: number; y?: number; why: string } | null {
    if (!isRecord(v) || typeof v['piece'] !== 'number') {
        return null;
    }
    const action = v['action'];
    if (action !== 'turn' && action !== 'move' && action !== 'remove') {
        return null;
    }
    const facing = COMPASS.find((c) => c === v['facing']);
    const x = typeof v['x'] === 'number' ? v['x'] : undefined;
    const y = typeof v['y'] === 'number' ? v['y'] : undefined;
    return {
        piece: v['piece'],
        action,
        ...(facing ? { facing } : {}),
        ...(x === undefined ? {} : { x }),
        ...(y === undefined ? {} : { y }),
        why: typeof v['why'] === 'string' ? v['why'] : '',
    };
}

/** Asks the adviser: its reply's text, or a rejection when it cannot be reached. */
export type Ask = (messages: readonly AdviceMessage[]) => Promise<string>;

/** What the AI-assisted mode made: the composition, and what the adviser chose and fixed; `failed` when it could not be reached. */
export interface Advised {
    readonly composition: Composition;
    /** Places whose stamps the adviser chose. */
    readonly chosen: number;
    readonly fixes: readonly Fix[];
    readonly failed: boolean;
}

/**
 * Compose `intent` with an adviser's help: it chooses each place's stamps,
 * the composer lays the map out, and it critiques the result, whose fixes
 * are applied where the rules allow. If it cannot be reached, the map is
 * composed without it (and says so).
 */
export async function adviseAndCompose(intent: MapIntent, stamps: RoleIndex, info: ReadonlyMap<string, StampInfo>, ask: Ask): Promise<Advised> {
    let preferences: Preferences;
    try {
        preferences = readChoices(await ask(choosingPrompt(intent, stamps, info)), intent, stamps);
    } catch {
        return { composition: composeMap(intent, stamps), chosen: 0, fixes: [], failed: true };
    }
    const composition = composeMap(intent, stamps, preferences);
    try {
        const { spec, fixes } = applyCritique(composition.spec, await ask(critiquePrompt(composition.spec, stamps, info)), stamps);
        return { composition: { ...composition, spec }, chosen: preferences.size, fixes, failed: false };
    } catch {
        return { composition, chosen: preferences.size, fixes: [], failed: true };
    }
}

/** Roles that stand on something or lie beneath it, so never collide with what stands on the floor. */
const LAYERED: readonly StampRole[] = ['tabletop', 'rug'];

/**
 * The spec with the critique's fixes made where the composer's rules still
 * hold: a moved or turned piece stays wholly inside its room and stands on no
 * other piece; a removed piece goes. Every fix asked for is reported.
 */
export function applyCritique(spec: SceneSpecInput, answer: string, stamps: RoleIndex): { spec: SceneSpecInput; fixes: Fix[] } {
    const json = firstJson(answer);
    const asked = (Array.isArray(json) ? json : []).slice(0, MAX_FIXES).map(readFix);
    const pieces = new Map(piecesOf(spec, stamps).map((p) => [p.index, p]));
    const features: (FeatureInput | null)[] = [...spec.features];
    const fixes: Fix[] = [];
    const boxOfIndex = (i: number): Box | null => {
        const p = pieces.get(i);
        const f = features[i];
        return p && f?.type === 'stamp' && !LAYERED.includes(p.stamp.role) ? boxOf(f, p.stamp) : null;
    };
    for (const fix of asked) {
        const piece = fix ? pieces.get(fix.piece) : undefined;
        if (!fix || !piece) {
            continue;
        }
        const current = features[piece.index];
        if (current?.type !== 'stamp') {
            continue;
        }
        let next: StampInput | null = current;
        if (fix.action === 'remove') {
            next = null;
        } else if (fix.action === 'turn' && fix.facing) {
            next = { ...current, rotation: (FACING_ROTATION[fix.facing] + piece.stamp.turn) % FULL_TURN };
        } else if (fix.action === 'move' && fix.x !== undefined && fix.y !== undefined) {
            next = { ...current, x: fix.x, y: fix.y };
        }
        const fits = (candidate: StampInput): boolean => {
            const box = boxOf(candidate, piece.stamp);
            const room = boundsOf(piece.room);
            const inside = box.x >= room.x && box.y >= room.y && box.x + box.w <= room.x + room.w && box.y + box.h <= room.y + room.h;
            // What stands on a table or lies beneath the furniture collides with nothing; the rest must stand clear of every other piece.
            const collides = (i: number): boolean => {
                const other = i === piece.index ? null : boxOfIndex(i);
                return other !== null && overlaps(box, other);
            };
            return inside && (LAYERED.includes(piece.stamp.role) || ![...pieces.keys()].some(collides));
        };
        const applied = next === null || (next !== current && fits(next));
        if (applied) {
            features[piece.index] = next;
        }
        fixes.push({ piece: fix.piece, action: fix.action, why: fix.why, applied });
    }
    return { spec: { ...spec, features: features.filter((f): f is FeatureInput => f !== null) }, fixes };
}
