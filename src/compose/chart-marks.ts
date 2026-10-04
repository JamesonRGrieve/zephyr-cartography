// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a chart writes and rules on itself: its places' names, as the
 * operator's reference regions label every town, keep and ruin, and the
 * orbits its worlds run on round their star. Both are native Drawings (a
 * text label, a faint ellipse), drawn over the map's own art.
 */
import type { SceneSpecInput } from '../generate/spec';
import type { MapIntent } from './intent';

type FeatureInput = SceneSpecInput['features'][number];

/** An orbit's line: thin, pale and faint, a guide under the eye, never a ring that competes with the worlds on it. */
export const ORBIT_STROKE = { colour: '#d8e2f0', width: 2, alpha: 0.35 } as const;

/** The intent's labels and orbits as spec features, on `onLevel` (a map's ground). */
export function chartMarks(intent: Pick<MapIntent, 'labels' | 'orbits'>, onLevel: { readonly level?: string }): FeatureInput[] {
    return [
        ...intent.orbits.map(
            (orbit): FeatureInput => ({
                type: 'shape',
                kind: 'ellipse',
                x: orbit.centre.x,
                y: orbit.centre.y,
                width: 2 * orbit.radius,
                height: 2 * orbit.radius,
                stroke: { ...ORBIT_STROKE },
                fill: null,
                ...onLevel,
            }),
        ),
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
