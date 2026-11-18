// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { SceneSpecInput } from '../generate/spec';
import { type Crown, woodEdges } from './wood-edges';

/** A block of crowns `cols` by `rows`, a square and a half apart, starting at (`x`, `y`). */
function grove(x: number, y: number, cols: number, rows: number): Crown[] {
    return Array.from({ length: cols * rows }, (_, i) => ({ x: x + (i % cols) * 1.5, y: y + Math.floor(i / cols) * 1.5, r: 1 }));
}

type Line = Extract<SceneSpecInput['features'][number], { type: 'shape' }> & { readonly points: readonly { x: number; y: number }[] };

/** The walled lines round the woods, each with its points. */
function linesOf(features: readonly SceneSpecInput['features'][number][]): Line[] {
    return features.flatMap((f) => (f.type === 'shape' && f.points !== undefined ? [{ ...f, points: f.points }] : []));
}

function lines(crowns: readonly Crown[], width = 30, height = 30): Line[] {
    return linesOf(woodEdges(crowns, width, height, {}));
}

describe('woodEdges', () => {
    it('ring a wood twice with walls that limit sight and light and bar nothing, drawing nothing', () => {
        const edges = lines(grove(8, 8, 8, 8));
        // One ring on the canopy's edge and one inside it, each a closed run.
        expect(edges).toHaveLength(2);
        for (const edge of edges) {
            expect(edge).toMatchObject({
                type: 'shape',
                kind: 'line',
                hidden: true,
                stroke: { width: 0 },
                walls: { sight: 'limited', light: 'limited', movement: false },
            });
            expect(edge.points.length).toBeGreaterThan(3);
        }
        const span = (edge: Line): number => Math.max(...edge.points.map((p) => p.x)) - Math.min(...edge.points.map((p) => p.x));
        const [outer, inner] = edges.map(span).sort((a, b) => b - a);
        // The outer ring runs on the canopy (crowns from 7 to 19.5, joined a little wider); the inner one well inside it.
        expect(outer).toBeGreaterThan(12);
        expect(inner).toBeLessThan((outer ?? 0) - 2.5);
    });

    it('leave a lone tree or a pair open, and nothing without crowns', () => {
        expect(lines([{ x: 10, y: 10, r: 1.2 }])).toEqual([]);
        expect(lines(grove(10, 10, 2, 1))).toEqual([]);
        expect(woodEdges([], 30, 30, {})).toEqual([]);
    });

    it('never wall the map’s own edge where a wood runs off it, and keep to the level asked', () => {
        const edges = linesOf(woodEdges(grove(0, 0, 10, 6), 30, 30, { level: 'G' }));
        expect(edges.length).toBeGreaterThan(0);
        for (const edge of edges) {
            expect(edge.level).toBe('G');
            for (let i = 1; i < edge.points.length; i++) {
                const a = edge.points[i - 1];
                const b = edge.points[i];
                const onTop = a !== undefined && b !== undefined && a.y <= 0.3 && b.y <= 0.3;
                const onLeft = a !== undefined && b !== undefined && a.x <= 0.3 && b.x <= 0.3;
                expect(onTop || onLeft).toBe(false);
            }
        }
    });

    it('ring a glade inside a wood too, so a token in the glade sees its edge and no further', () => {
        // A wood with its middle left open: crowns all round a square hole.
        const ring = grove(4, 4, 14, 14).filter((c) => !(c.x > 10 && c.x < 16 && c.y > 10 && c.y < 16));
        const edges = lines(ring);
        const inGlade = edges.filter((e) => e.points.every((p) => p.x > 8 && p.x < 18 && p.y > 8 && p.y < 18));
        expect(inGlade.length).toBeGreaterThan(0);
    });
});
