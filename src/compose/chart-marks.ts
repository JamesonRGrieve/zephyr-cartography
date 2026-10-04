// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a chart writes and rules on itself: its places' names, as the
 * operator's reference regions label every town, keep and ruin, and the
 * orbits its worlds run on round their star. Both are native Drawings (a
 * text label, a faint line), drawn over the map's own art; an orbit breaks
 * round each body standing on it, so it never cuts across a world.
 */
import type { SceneSpecInput } from '../generate/spec';
import type { MapIntent } from './intent';

type FeatureInput = SceneSpecInput['features'][number];

/** An orbit's line: thin, pale and faint, a guide under the eye, never a ring that competes with the worlds on it. */
export const ORBIT_STROKE = { colour: '#d8e2f0', width: 2, alpha: 0.35 } as const;

/** Squares of open space an orbit leaves round a body standing on it, past the body's own half-size. */
const ORBIT_GAP = 0.35;

/** Squares along an orbit between the points its line is drawn through. */
const ORBIT_STEP = 0.25;

/** The fewest points an orbit is drawn through, however small. */
const ORBIT_MIN_POINTS = 48;

type Orbit = MapIntent['orbits'][number];
type Body = { readonly x: number; readonly y: number; readonly r: number };

/** The bodies an orbit must break round: each of the map's pieces, as a circle its larger side across, plus the gap. */
const bodiesOf = (fixtures: MapIntent['fixtures']): Body[] => fixtures.map((f) => ({ x: f.at.x, y: f.at.y, r: Math.max(f.width, f.height) / 2 + ORBIT_GAP }));

/**
 * An orbit's line: a closed ring where nothing stands on it, else the arcs
 * between the bodies on it, each a line through points along the ring.
 */
function orbitLines(orbit: Orbit, bodies: readonly Body[], onLevel: { readonly level?: string }): FeatureInput[] {
    const { centre, radius } = orbit;
    const n = Math.max(ORBIT_MIN_POINTS, Math.ceil((2 * Math.PI * radius) / ORBIT_STEP));
    const at = (i: number): { x: number; y: number } => ({
        x: centre.x + radius * Math.cos((2 * Math.PI * i) / n),
        y: centre.y + radius * Math.sin((2 * Math.PI * i) / n),
    });
    // A body at the centre (the star) lies inside the ring, never on it.
    const onRing = bodies.filter((b) => Math.abs(Math.hypot(b.x - centre.x, b.y - centre.y) - radius) < b.r);
    const hidden = (p: { x: number; y: number }): boolean => onRing.some((b) => Math.hypot(p.x - b.x, p.y - b.y) < b.r);
    const stroke = { ...ORBIT_STROKE };
    if (onRing.length === 0) {
        return [{ type: 'shape', kind: 'ellipse', x: centre.x, y: centre.y, width: 2 * radius, height: 2 * radius, stroke, fill: null, ...onLevel }];
    }
    // Start the walk round at a hidden point, so each visible arc is one run, never split across the walk's start.
    const start = Array.from({ length: n }, (_, i) => i).find((i) => hidden(at(i))) ?? 0;
    const runs: { x: number; y: number }[][] = [];
    let run: { x: number; y: number }[] = [];
    for (let k = 0; k <= n; k++) {
        const p = at(start + k);
        if (hidden(p)) {
            if (run.length >= 2) {
                runs.push(run);
            }
            run = [];
        } else {
            run.push(p);
        }
    }
    if (run.length >= 2) {
        runs.push(run);
    }
    return runs.map((points): FeatureInput => ({ type: 'shape', kind: 'line', points, stroke, fill: null, ...onLevel }));
}

/** The intent's labels and orbits as spec features, on `onLevel` (a map's ground). */
export function chartMarks(intent: Pick<MapIntent, 'labels' | 'orbits' | 'fixtures'>, onLevel: { readonly level?: string }): FeatureInput[] {
    const bodies = bodiesOf(intent.fixtures);
    return [
        ...intent.orbits.flatMap((orbit) => orbitLines(orbit, bodies, onLevel)),
        ...intent.labels.map(
            (label): FeatureInput => ({
                type: 'label',
                x: label.at.x,
                y: label.at.y,
                text: label.text,
                fontSize: label.size,
                colour: label.colour,
                fontFamily: label.font,
                ...onLevel,
            }),
        ),
    ];
}
