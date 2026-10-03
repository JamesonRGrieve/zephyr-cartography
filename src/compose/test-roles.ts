// SPDX-License-Identifier: AGPL-3.0-or-later
/** Role stamps for the composer's tests: a plausible set of furniture and land, sized in grid squares like the real packs'. */
import { STAMP_HABITATS, type StampAnchor, type StampRole, type StampTransitionDirection, type StampTransitionKind } from '../stamps/schema';
import type { RoleIndex, RoleStamp } from './roles';

function stamp(
    role: StampRole,
    width: number,
    height: number,
    against: StampAnchor = 'free',
    clearance = 0,
    id: string = role,
    turn = 0,
    upright = false,
): RoleStamp {
    // Land stamps belong on every kind of ground, so every zone can be dressed.
    return {
        key: `test:${id}`,
        role,
        width,
        height,
        turn,
        against,
        clearance,
        upright,
        habitats: STAMP_HABITATS,
        climb: null,
        borrowed: false,
        purposes: [],
        tags: [],
    };
}

/** A way between levels: a flight or ladder climbing from where it stands, or a hatch going down from it. */
function access(id: string, kind: StampTransitionKind, direction: StampTransitionDirection, width: number, height: number): RoleStamp {
    return { ...stamp('stairs', width, height, 'free', 0, id), climb: { kind, direction } };
}

/** Every role the templates use, with sizes like the real packs' (a 5 ft square). */
export const TEST_ROLES: RoleIndex = new Map<StampRole, readonly RoleStamp[]>([
    ['tree', [stamp('tree', 4, 3.7), stamp('tree', 3, 3, 'free', 0, 'big-tree')]],
    ['shrub', [stamp('shrub', 1.2, 1.1)]],
    ['rock', [stamp('rock', 1.2, 0.9)]],
    ['log', [stamp('log', 3, 2)]],
    ['flora', [stamp('flora', 1.2, 1.1)]],
    ['debris', [stamp('debris', 1, 0.8)]],
    ['table', [stamp('table', 1.6, 0.8)]],
    ['seat', [stamp('seat', 0.5, 0.5)]],
    ['bench', [stamp('bench', 1.6, 0.4)]],
    ['counter', [stamp('counter', 3, 0.8, 'wall', 1)]],
    ['hearth', [stamp('hearth', 1.4, 0.9, 'wall', 1)]],
    ['shelf', [stamp('shelf', 1.6, 0.5, 'wall')]],
    // Drawn lengthwise with its headboard on the image's left, as the packs' beds are: a quarter turn brings it up.
    ['bed', [stamp('bed', 1.2, 2, 'wall', 0, 'bed', 90)]],
    ['storage', [stamp('storage', 0.8, 0.8, 'corner')]],
    ['chest', [stamp('chest', 0.7, 0.45)]],
    ['clutter', [stamp('clutter', 0.4, 0.4)]],
    ['rug', [stamp('rug', 2.4, 1.6)]],
    ['desk', [stamp('desk', 1.4, 0.8, 'wall')]],
    ['workbench', [stamp('workbench', 2, 0.8, 'wall')]],
    ['light', [stamp('light', 0.5, 0.5, 'wall')]],
    ['machine', [stamp('machine', 2, 1.7)]],
    ['console', [stamp('console', 1, 1, 'wall', 1)]],
    ['altar', [stamp('altar', 1, 1.2, 'wall', 1.5)]],
    ['pew', [stamp('pew', 2, 1.66)]],
    ['lectern', [stamp('lectern', 0.5, 0.6, 'wall', 1)]],
    ['icon', [stamp('icon', 0.4, 0.6, 'wall')]],
    ['rack', [stamp('rack', 1, 1, 'wall')]],
    ['medical', [stamp('medical', 1.4, 1, 'wall')]],
    ['restraint', [stamp('restraint', 0.7, 1.4)]],
    // A bunker seen from above, and a watch post drawn side-on that must stand as drawn.
    ['structure', [stamp('structure', 5, 2.8), stamp('structure', 1.4, 2, 'free', 0, 'watch-post', 0, true)]],
    // Defences drawn front up, back to the image's bottom: a quarter turn twice brings the back to the top.
    ['barricade', [stamp('barricade', 2, 0.5, 'free', 0, 'barricade', 180)]],
    ['crater', [stamp('crater', 2, 1.9)]],
    ['emplacement', [stamp('emplacement', 2.2, 2.4, 'free', 0, 'emplacement', 180)]],
    ['vehicle', [stamp('vehicle', 9, 9), stamp('vehicle', 6, 2.4, 'free', 0, 'hauler')]],
    ['stairs', [access('stairs', 'stairs', 'up', 1, 2), access('ladder', 'ladder', 'up', 1, 1.5), access('storm-doors', 'hatch', 'down', 2, 1.5)]],
    ['tabletop', [stamp('tabletop', 0.3, 0.3), stamp('tabletop', 0.4, 0.25, 'free', 0, 'tankards')]],
    ['nightstand', [stamp('nightstand', 0.5, 0.5, 'wall')]],
    ['dresser', [stamp('dresser', 1.2, 0.5, 'wall')]],
    ['armchair', [stamp('armchair', 0.8, 0.8, 'corner')]],
    ['well', [stamp('well', 1.1, 1.2)]],
    // Drawn with the road running along its length, across the image.
    ['bridge', [stamp('bridge', 6, 2.4)]],
    ['waymark', [stamp('waymark', 0.3, 0.4, 'free', 0, 'waymark', 0, true)]],
    ['enclosure', [stamp('enclosure', 4, 3.75)]],
    ['fodder', [stamp('fodder', 2, 1.7, 'free', 0, 'fodder', 0, true)]],
    // A post seen from above, holding up a porch's roof: a fitting, drawn only where a map (or a porch) names it.
    ['fitting', [{ ...stamp('fitting', 0.3, 0.3, 'free', 0, 'post'), tags: ['post'] }]],
]);
