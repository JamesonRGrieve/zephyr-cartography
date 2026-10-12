// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Tokens the module placed, followed through play: where one is moved,
 * raised, taken to another level, hidden or revealed, its token feature
 * records it (by the active GM alone: players cannot write the scene's
 * features, and several GMs would race), so a later re-sync leaves it as play
 * left it. A GM deleting such a Token by hand removes its feature too.
 *
 * Since v13 a Token's move is a movement, reported by the `moveToken` hook
 * with where it ends; its other changes (hidden, an elevation or level set on
 * its sheet) come as an ordinary `updateToken`.
 */
import type { CartographyController } from '../canvas/controller';

/** The Token fields, other than a move, that change where it stands or whether players see it. */
const PLACEMENT_FIELDS = ['elevation', 'level', 'width', 'height', 'hidden'] as const;

/** Where a Token stands: its top-left and size (grid squares), elevation and level. */
interface Standing {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly elevation: number;
    readonly level: string;
}

export function followTokens(controller: () => CartographyController | null): void {
    /** Record on its feature where `token` stands, as `standing`, hidden or not: the active GM's alone to write. */
    const follow = (token: TokenDocument.Implementation, standing: Standing): void => {
        const active = controller();
        const scene = token.parent;
        if (!active || !scene || token.id === null || game.users?.activeGM?.isSelf !== true) {
            return;
        }
        const size = scene.grid.size;
        const centre = { x: standing.x + (standing.width * size) / 2, y: standing.y + (standing.height * size) / 2 };
        void active.followToken(token.id, centre, standing.elevation, standing.level, token.hidden);
    };

    Hooks.on('moveToken', (token, movement) => {
        follow(token, movement.destination);
    });

    Hooks.on('updateToken', (token, changed) => {
        if (PLACEMENT_FIELDS.some((field) => field in changed)) {
            follow(token, token);
        }
    });

    Hooks.on('deleteToken', (token, _options, userId) => {
        const active = controller();
        if (!active || userId !== game.user?.id || token.id === null) {
            return;
        }
        const featureId = active.featureForToken(token.id);
        if (featureId !== null) {
            void active.remove(featureId);
        }
    });
}
