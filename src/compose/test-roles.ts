// SPDX-License-Identifier: AGPL-3.0-or-later
/** Role stamps for the composer's tests: a plausible set of furniture and land, sized in grid squares like the real packs'. */
import { STAMP_HABITATS, type StampAnchor, type StampRole } from '../stamps/schema';
import type { RoleIndex, RoleStamp } from './roles';

function stamp(role: StampRole, width: number, height: number, against: StampAnchor = 'free', clearance = 0, id: string = role, turn = 0): RoleStamp {
    // Land stamps belong on every kind of ground, so every zone can be dressed.
    return { key: `test:${id}`, role, width, height, turn, against, clearance, habitats: STAMP_HABITATS };
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
    ['clutter', [stamp('clutter', 0.4, 0.4)]],
    ['rug', [stamp('rug', 2.4, 1.6)]],
    ['desk', [stamp('desk', 1.4, 0.8, 'wall')]],
    ['workbench', [stamp('workbench', 2, 0.8, 'wall')]],
    ['light', [stamp('light', 0.5, 0.5, 'wall')]],
]);
