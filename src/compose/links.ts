// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Ways between maps: where a map's road runs off its edge, a place on a
 * chart, or just inside a building's front door, a zone whose region
 * teleports a token to a way in another map. Every id is derived from keys
 * (`sceneIdOf`, `linkRegionIdOf`), so two maps name each other's ways before
 * either is built, and a scene made under its map's id arrives already
 * joined. A way with no map to lead to yet takes no one anywhere until it is
 * linked. Pure and unit-tested.
 */
import type { DoorSlot, Rect } from '../generate/floor-plan';
import type { SceneSpecInput } from '../generate/spec';
import type { Point } from '../geometry/spline';
import { stableId } from '../tools/stable-id';
import type { Edge, MapLinkIntent } from './intent';

type FeatureInput = SceneSpecInput['features'][number];

/** The id the scene of the map keyed `mapKey` is made under. */
export const sceneIdOf = (mapKey: string): string => stableId(`scene:${mapKey}`);

/** The id of the region of the way keyed `linkKey` in the map keyed `mapKey`. */
export const linkRegionIdOf = (mapKey: string, linkKey: string): string => stableId(`link:${mapKey}:${linkKey}`);

/** Squares deep a way over a map's edge reaches in from it. */
const EDGE_DEPTH = 2;
/** Squares wide a way over an edge with no road running off it is. */
const EDGE_WIDTH = 3;
/** Squares a road's way reaches past the road on either side. */
const ROAD_MARGIN = 1;
/** Squares an end of a road may lie from the edge and still run off it. */
const OFF_EDGE = 1.5;
/** Squares inside a doorway its way stands. */
const INSIDE = 1;

/** What the composed map says about where its ways go. */
export interface LinkPlaces {
    readonly width: number;
    readonly height: number;
    /** Each building's front door, by building key, and the room it opens into. */
    readonly fronts: ReadonlyMap<string, { readonly slot: DoorSlot; readonly room: Rect }>;
    /** The roads and rivers laid, in squares. */
    readonly paths: readonly { readonly points: readonly Point[]; readonly halfWidth: number }[];
    /** The named pieces outside, by name, with their footprints. */
    readonly fixtures: ReadonlyMap<string, Rect>;
}

/** The ways of the map keyed `mapKey`, as zones on its ground level; a way whose place is not on the map (a building left unbuilt) has none. */
export function linkFeatures(mapKey: string, links: readonly MapLinkIntent[], places: LinkPlaces, onLevel: { readonly level?: string }): FeatureInput[] {
    return links.flatMap((link): FeatureInput[] => {
        const rect = placeOf(link.at, places);
        if (rect === null) {
            return [];
        }
        const targets = link.to === null ? [] : [{ scene: sceneIdOf(link.to.map), region: linkRegionIdOf(link.to.map, link.to.link) }];
        return [
            {
                type: 'zone',
                key: `link-${link.key}`,
                x: rect.x + rect.w / 2,
                y: rect.y + rect.h / 2,
                shape: { kind: 'rectangle', width: rect.w, height: rect.h },
                name: link.name ?? (link.to === null ? link.key : `To ${link.to.map}`),
                link: { region: linkRegionIdOf(mapKey, link.key), targets, placement: 'center' },
                ...onLevel,
            },
        ];
    });
}

/** Where a way stands, in squares, or null where its place is not on this map. */
function placeOf(at: MapLinkIntent['at'], places: LinkPlaces): Rect | null {
    if ('edge' in at) {
        return edgeRect(at.edge, at.along ?? roadOffEdge(at.edge, places), places);
    }
    if ('fixture' in at) {
        return places.fixtures.get(at.fixture) ?? null;
    }
    const front = places.fronts.get(at.building);
    return front ? insideDoor(front.slot, front.room) : null;
}

/** A strip over `edge`, centred `along` it (or the edge's middle), as wide as the road running off there or a few squares. */
function edgeRect(edge: Edge, along: { readonly at: number; readonly width: number } | number | null, places: LinkPlaces): Rect {
    const { width: mapW, height: mapH } = places;
    const across = edge === 'north' || edge === 'south';
    const spot = typeof along === 'number' ? { at: along, width: EDGE_WIDTH } : along ?? { at: (across ? mapW : mapH) / 2, width: EDGE_WIDTH };
    const from = spot.at - spot.width / 2;
    const x = { north: from, south: from, east: mapW - EDGE_DEPTH, west: 0 }[edge];
    const y = { north: 0, south: mapH - EDGE_DEPTH, east: from, west: from }[edge];
    return across ? { x, y, w: spot.width, h: EDGE_DEPTH } : { x, y, w: EDGE_DEPTH, h: spot.width };
}

/** Where a road runs off `edge`, along it, and the way's width there; null where none does. */
function roadOffEdge(edge: Edge, places: LinkPlaces): { readonly at: number; readonly width: number } | null {
    const offEdge = (p: Point): boolean =>
        ({ north: p.y <= OFF_EDGE, south: p.y >= places.height - OFF_EDGE, west: p.x <= OFF_EDGE, east: p.x >= places.width - OFF_EDGE }[edge]);
    for (const path of places.paths) {
        const ends = [path.points[0], path.points.at(-1)].filter((p): p is Point => p !== undefined);
        const end = ends.find(offEdge);
        if (end) {
            return { at: edge === 'north' || edge === 'south' ? end.x : end.y, width: path.halfWidth * 2 + ROAD_MARGIN * 2 };
        }
    }
    return null;
}

/** The square just inside a doorway in `room`'s wall on `slot`, across the doorway's width. */
function insideDoor(slot: DoorSlot, room: Rect): Rect {
    const width = slot.width ?? 1;
    const inside: Readonly<Record<DoorSlot['side'], Rect>> = {
        top: { x: slot.at, y: room.y, w: width, h: INSIDE },
        bottom: { x: slot.at, y: room.y + room.h - INSIDE, w: width, h: INSIDE },
        left: { x: room.x, y: slot.at, w: INSIDE, h: width },
        right: { x: room.x + room.w - INSIDE, y: slot.at, w: INSIDE, h: width },
    };
    return inside[slot.side];
}
