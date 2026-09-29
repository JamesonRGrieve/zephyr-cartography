// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import { parseSceneSpec, type RoomSpec, SCENE_SPEC_SCHEMA_VERSION } from '../generate/spec';
import { pointInPolygon } from '../geometry/hit';
import { curtainFeatures, moatOutlines } from './curtain';
import { type CurtainIntent, parseMapIntent } from './intent';

/** A curtain with its defaults filled, as the composer receives it. */
function curtainOf(given: object): CurtainIntent {
    const parsed = parseMapIntent({ schemaVersion: 1, width: 40, height: 40, curtains: [given] });
    const curtain = parsed.ok ? parsed.intent.curtains[0] : undefined;
    if (!curtain) {
        throw new Error(`fixture: ${JSON.stringify(parsed.ok ? 'none' : parsed.issues)}`);
    }
    return curtain;
}

const SQUARE = [
    { x: 10, y: 10 },
    { x: 30, y: 10 },
    { x: 30, y: 30 },
    { x: 10, y: 30 },
];

/** The rooms of `features`, read as the scene spec reads them (their doors defaulted). */
function rooms(features: ReturnType<typeof curtainFeatures>): RoomSpec[] {
    const parsed = parseSceneSpec({ schemaVersion: SCENE_SPEC_SCHEMA_VERSION, units: 'grid', features });
    if (!parsed.ok) {
        throw new Error(`invalid features: ${JSON.stringify(parsed.issues.slice(0, 2))}`);
    }
    return parsed.spec.features.flatMap((f) => (f.type === 'room' ? [f] : []));
}

const flat = (room: RoomSpec): number[] => room.points.flatMap((p) => [p.x, p.y]);

describe('curtain walls', () => {
    it('breaks the wall at its corner towers and its gate: a solid strip each run between', () => {
        const all = rooms(curtainFeatures(curtainOf({ points: SQUARE, gates: [{ edge: 2, width: 3, animation: 'ascend' }] }), {}));
        const doorless = all.filter((r) => r.doors.length === 0);
        // Four sides, the gated one in two: five solid runs of wall, nothing opening into them.
        expect(doorless).toHaveLength(5);
        // The wall's line runs down each strip's middle; the bailey inside is none of them.
        expect(doorless.some((r) => pointInPolygon({ x: 20, y: 10 }, flat(r)))).toBe(true);
        expect(doorless.some((r) => pointInPolygon({ x: 20, y: 20 }, flat(r)))).toBe(false);
    });

    it('stands a tower at each corner, its door into the bailey', () => {
        const all = rooms(curtainFeatures(curtainOf({ points: SQUARE }), {}));
        const towers = all.filter((r) => r.doors.length === 1 && r.doors[0]?.type === 'door');
        expect(towers).toHaveLength(4);
        const topLeft = towers.find((r) => pointInPolygon({ x: 10, y: 10 }, flat(r)));
        const door = topLeft?.doors[0];
        const a = door === undefined ? undefined : topLeft?.points[door.segment];
        const b = door === undefined ? undefined : topLeft?.points[(door.segment + 1) % (topLeft.points.length || 1)];
        // The top-left tower's door faces into the bailey: on its bottom or right side, never out of the wall.
        const mid = a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: 0, y: 0 };
        expect(mid.x >= 10 || mid.y >= 10).toBe(true);
        // Round towers are eight-sided.
        expect(topLeft?.points.length).toBeGreaterThanOrEqual(8);
    });

    it('pierces the wall with a gate: its gate shut on the outer face, the inner face open to the bailey', () => {
        const all = rooms(curtainFeatures(curtainOf({ points: SQUARE, towers: { corners: false }, gates: [{ edge: 2, width: 3, animation: 'ascend' }] }), {}));
        const gate = all.find((r) => r.doors.some((d) => d.type === 'opening'));
        expect(gate?.doors.map((d) => `${d.type}:${d.state}:${d.animation ?? ''}`)).toEqual(['door:closed:ascend', 'opening:open:']);
        const outer = gate?.points.slice(0, 2) ?? [];
        // The bottom side's outer face is below the wall's line.
        expect(outer.every((p) => p.y > 30)).toBe(true);
        // A breach has no gate at all.
        const breach = rooms(curtainFeatures(curtainOf({ points: SQUARE, towers: { corners: false }, gates: [{ edge: 0, state: 'gap' }] }), {}));
        expect(breach.find((r) => r.doors.length === 2)?.doors.map((d) => d.type)).toEqual(['opening', 'opening']);
    });

    it('rings the wall with a moat outside it, a bank between, its corners rounded round the towers, never a ruled square', () => {
        const curtain = curtainOf({ points: SQUARE, thickness: 2, towers: { size: 4 }, moat: { width: 3, gap: 1.5, wander: 0 } });
        const [water, ...more] = moatOutlines(curtain, seededRandom(1));
        expect(more).toEqual([]);
        const flatWater = (water ?? []).flatMap((p) => [p.x, p.y]);
        // Mid-side: the wall's outer face at 1 out, the bank to 2.5, the water to 5.5.
        expect(pointInPolygon({ x: 20, y: 10 - 4 }, flatWater)).toBe(true);
        expect(pointInPolygon({ x: 20, y: 10 - 2 }, flatWater)).toBe(false);
        expect(pointInPolygon({ x: 20, y: 20 }, flatWater)).toBe(false);
        // Round the corner tower it curves: its square corner is dry land.
        expect(pointInPolygon({ x: 10 - 3, y: 10 - 3 }, flatWater)).toBe(true);
        expect(pointInPolygon({ x: 10 - 5.5, y: 10 - 5.5 }, flatWater)).toBe(false);
        expect(moatOutlines(curtainOf({ points: SQUARE }), seededRandom(1))).toEqual([]);
    });

    it('builds a wall traced either way round alike: towers along a side, square ones, a gate standing open on its closing side', () => {
        const anticlockwise = [...SQUARE].reverse();
        const given = { towers: { round: false, at: [{ x: 20, y: 10.4 }] }, gates: [{ edge: 3, state: 'open' }] };
        const all = rooms(curtainFeatures(curtainOf({ points: anticlockwise, ...given }), {}));
        const towers = all.filter((r) => r.doors.length === 1 && r.doors[0]?.type === 'door');
        // Four corners and one along the top side, set on the wall's line; square, so four-sided.
        expect(towers).toHaveLength(5);
        const midTop = towers.find((r) => pointInPolygon({ x: 20, y: 10 }, flat(r)));
        // Square: every point of its outline (its door's ends among them) on the box's sides, none cut across a corner.
        const box = { x0: Math.min(...(midTop?.points ?? []).map((p) => p.x)), x1: Math.max(...(midTop?.points ?? []).map((p) => p.x)) };
        expect(midTop?.points.every((p) => p.x === box.x0 || p.x === box.x1 || p.y === 8 || p.y === 12)).toBe(true);
        // Its door faces into the bailey, below the wall.
        const door = midTop?.doors[0];
        const a = door === undefined ? undefined : midTop?.points[door.segment];
        expect(a && a.y > 10).toBe(true);
        // The closing side (the last point back to the first: the left side here) carries the gate, standing open.
        const gate = all.find((r) => r.doors.some((d) => d.type === 'opening'));
        expect(gate?.doors[0]?.state).toBe('open');
        expect(gate?.points.every((p) => Math.abs(p.x - 10) <= 3)).toBe(true);
        // A moat rings square towers too, the water still outside the wall.
        const water = moatOutlines(curtainOf({ points: anticlockwise, ...given, moat: {} }), seededRandom(2));
        expect(water.length).toBeGreaterThan(0);
        expect(
            water.every(
                (outline) =>
                    !pointInPolygon(
                        { x: 20, y: 20 },
                        outline.flatMap((p) => [p.x, p.y]),
                    ),
            ),
        ).toBe(true);
    });

    it('refuses a gate in a side the wall does not have', () => {
        expect(parseMapIntent({ schemaVersion: 1, curtains: [{ points: SQUARE, gates: [{ edge: 4 }] }] }).ok).toBe(false);
    });

    it('keeps a wall with no towers or gates one unbroken run round', () => {
        expect(rooms(curtainFeatures(curtainOf({ points: SQUARE, towers: { corners: false } }), {}))).toHaveLength(1);
    });
});
