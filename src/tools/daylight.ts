// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Daylight indoors (operator, 2026-10-02: outdoors is lit by the day,
 * interiors "only through windows and open doors"). A roofed room keeps the
 * scene's global light out (an Adjust Darkness Level region over it, which
 * Foundry's global light never shines through), so what lights it by day is a
 * native light just outside each of its windows and outer doors, shining in:
 * cut by walls, so a shut door keeps it out and a window lets it through, and
 * active only while the scene's darkness is a day's (`DAYLIGHT_MAX_DARKNESS`),
 * so it follows whatever drives the scene's darkness (a system's clock). Pure
 * and unit-tested.
 */
import { pointInPolygon } from '../geometry/hit';
import type { Point } from '../geometry/spline';
import { perimeterSegments } from '../geometry/wall';
import type { LightDoc } from './documents';
import type { RoomFeature } from './room';

/**
 * Scene darkness up to which it is day: daylight shines in, and an outdoor
 * scene's global light is on. A game system whose clock turns global light off
 * at night uses the same darkness, so the two agree.
 */
export const DAYLIGHT_MAX_DARKNESS = 0.6;

/** The cone daylight spreads into a room through an opening, in degrees. */
const DAYLIGHT_ANGLE = 120;

/** Warm white: the day as it falls through a window. */
const DAYLIGHT_COLOUR = '#fff1d6';

/** How much of its reach daylight lights brightly, nearest the opening. */
const DAYLIGHT_BRIGHT_FRACTION = 0.35;

/** Foundry points a light's cone at its rotation plus a quarter turn (0 faces down the canvas). */
const CONE_ZERO_DEGREES = 90;

/**
 * How far a light stands outside its opening, as a fraction of the opening's width: just past the wall, so a shut
 * door or a window's wall is between it and the room, and next to nothing of its cone falls on the ground outside.
 */
const OUTSIDE_FRACTION = 0.05;

/** A small step across an opening, as a fraction of its width, to tell its inside from its outside. */
const PROBE_FRACTION = 0.01;

const DEGREES_PER_RADIAN = 180 / Math.PI;

/** The unit direction from the middle of `a`→`b` into `room`. */
function inward(a: Point, b: Point, room: readonly Point[]): Point {
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    const normal = { x: -(b.y - a.y) / span, y: (b.x - a.x) / span };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const probe = { x: mid.x + normal.x * span * PROBE_FRACTION, y: mid.y + normal.y * span * PROBE_FRACTION };
    return pointInPolygon(
        probe,
        room.flatMap((p) => [p.x, p.y]),
    )
        ? normal
        : { x: -normal.x, y: -normal.y };
}

/** The daylight shining into `room` through each of its daylight openings, on its floor. */
export function daylightLights(room: RoomFeature, floor: { readonly level: string | null; readonly elevation: number }): LightDoc[] {
    const sides = perimeterSegments(room.points);
    return room.daylight.flatMap((segment) => {
        const side = sides[segment];
        const width = side ? Math.hypot(side.b.x - side.a.x, side.b.y - side.a.y) : 0;
        if (!side || width === 0) {
            return [];
        }
        const into = inward(side.a, side.b, room.points);
        const mid = { x: (side.a.x + side.b.x) / 2, y: (side.a.y + side.b.y) / 2 };
        const at = { x: mid.x - into.x * width * OUTSIDE_FRACTION, y: mid.y - into.y * width * OUTSIDE_FRACTION };
        // It reaches the far side of the room.
        const dim = room.points.reduce((far, p) => Math.max(far, Math.hypot(p.x - at.x, p.y - at.y)), 0);
        const light: LightDoc = {
            source: { kind: 'daylight' },
            x: at.x,
            y: at.y,
            dim,
            bright: dim * DAYLIGHT_BRIGHT_FRACTION,
            color: DAYLIGHT_COLOUR,
            angle: DAYLIGHT_ANGLE,
            rotation: Math.atan2(into.y, into.x) * DEGREES_PER_RADIAN - CONE_ZERO_DEGREES,
            technique: { walls: true, vision: false, darkness: { min: 0, max: DAYLIGHT_MAX_DARKNESS } },
            elevation: floor.elevation,
            level: floor.level,
        };
        return [light];
    });
}
