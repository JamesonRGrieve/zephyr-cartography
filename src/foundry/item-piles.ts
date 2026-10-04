// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * {@link ContainerService} over Item Piles (verified against its v3.3 API:
 * `createItemPile` resolves `{ tokenUuid, actorUuid }`, and `deleteItemPile`
 * takes the pile's TokenDocument). Item Piles is optional: when it is not
 * active the service reports unavailable and container stamps stay plain
 * stamps.
 */
import type { CartographyController, ContainerService } from '../canvas/controller';
import { MODULE_ID } from '../module-id';
import type { StampPile } from '../stamps/schema';
import { type PileSpec, type PileState, pileStateOf } from '../tools/containers';
import { isRecord } from '../tools/guards';

const ITEM_PILES_ID = 'item-piles';

/**
 * Item Piles flags for a stamp's pile (names from Item Piles 3.3's
 * PILE_DEFAULTS). A pile is furniture, not a drop, so it is kept when emptied;
 * options the pack leaves out take Item Piles' defaults, its starting state
 * set outright.
 */
function pileFlags(pile: StampPile): object {
    const optional = <K extends keyof StampPile>(key: K): object => (pile[key] === undefined ? {} : { [key]: pile[key] });
    return {
        enabled: true,
        type: pile.type,
        deleteWhenEmpty: false,
        // Item Piles' own defaults, set outright: left out, a new pile takes whatever state the last one left on the
        // default pile actor they share.
        closed: pile.closed ?? false,
        locked: pile.locked ?? false,
        ...optional('distance'),
        ...optional('canInspectItems'),
        ...optional('displayItemTypes'),
        ...(pile.sounds?.open === undefined ? {} : { openSound: pile.sounds.open }),
        ...(pile.sounds?.close === undefined ? {} : { closeSound: pile.sounds.close }),
        ...(pile.sounds?.locked === undefined ? {} : { lockedSound: pile.sounds.locked }),
        ...(pile.sounds?.unlocked === undefined ? {} : { unlockedSound: pile.sounds.unlocked }),
    };
}

interface CreatePileOptions {
    readonly position: { readonly x: number; readonly y: number };
    readonly sceneId: string;
    readonly tokenOverrides: object;
    readonly actorOverrides: object;
    readonly itemPileFlags: object;
}

/* eslint-disable @typescript-eslint/method-signature-style -- mirrors Item Piles' API object, whose members are methods */
interface ItemPilesApi {
    // eslint-disable-next-line no-restricted-syntax -- boundary: Item Piles resolves an untyped result object, parsed below
    createItemPile(options: CreatePileOptions): Promise<unknown>;
    // eslint-disable-next-line no-restricted-syntax -- boundary: takes the pile's TokenDocument and resolves nothing we read
    deleteItemPile(target: unknown): Promise<unknown>;
}
/* eslint-enable @typescript-eslint/method-signature-style */

// eslint-disable-next-line no-restricted-syntax -- boundary: validates the shape of Item Piles' global API before any call
function isItemPilesApi(v: unknown): v is ItemPilesApi {
    // Item Piles exposes its API as a class of static methods, so it is a function, not a plain object.
    if (typeof v !== 'function' && (typeof v !== 'object' || v === null)) {
        return false;
    }
    return 'createItemPile' in v && typeof v.createItemPile === 'function' && 'deleteItemPile' in v && typeof v.deleteItemPile === 'function';
}

/** Item Piles' API, when the module is active. */
function itemPiles(): ItemPilesApi | null {
    if (![...(game.modules ?? [])].some((candidate) => candidate.id === ITEM_PILES_ID && candidate.active)) {
        return null;
    }
    const namespace = isRecord(game) ? game['itempiles'] : null;
    const api = isRecord(namespace) ? namespace['API'] : null;
    return isItemPilesApi(api) ? api : null;
}

// eslint-disable-next-line no-restricted-syntax -- boundary: reads the token UUID out of createItemPile's result
function tokenUuidOf(result: unknown): string | null {
    return isRecord(result) && typeof result['tokenUuid'] === 'string' ? result['tokenUuid'] : null;
}

/**
 * A pile token's own fields: its stamp's size, turn, elevation and picture, on its stamp's level. Foundry puts a token
 * given no level on the scene's first, so a guest room's chest stood on the taproom floor below it.
 */
function tokenData(spec: PileSpec): object {
    const base = { width: spec.width, height: spec.height, rotation: spec.rotation, elevation: spec.elevation, texture: { src: spec.src } };
    return spec.level === null ? base : { ...base, level: spec.level };
}

/** Item Piles' record of a pile's state (`flags['item-piles'].data`, its FLAGS.PILE in 3.3): closed and locked. */
// eslint-disable-next-line no-restricted-syntax -- boundary: Item Piles' flags are another module's, untyped here and narrowed
function pileData(flags: unknown): { readonly closed: boolean; readonly locked: boolean } {
    const data = isRecord(flags) && isRecord(flags[ITEM_PILES_ID]) ? flags[ITEM_PILES_ID]['data'] : null;
    return { closed: isRecord(data) && data['closed'] === true, locked: isRecord(data) && data['locked'] === true };
}

/** A pile's state as it stands: Item Piles' own closed and locked record, and whether anything is left in it. */
function pileState(pile: string): PileState | null {
    const token = foundry.utils.fromUuidSync(pile);
    const actor = token instanceof TokenDocument ? token.actor : null;
    return actor ? pileStateOf(pileData(actor.flags), actor.items.size) : null;
}

/** Switch each container stamp on the scene to the variant its pile's state shows, one pile at a time. */
async function showPileStates(controller: CartographyController): Promise<void> {
    for (const pile of controller.stampPiles()) {
        const state = pileState(pile);
        if (state !== null) {
            // eslint-disable-next-line no-await-in-loop -- one pile at a time: each switch is one scene write
            await controller.applyPileState(pile, state);
        }
    }
}

/**
 * Keep container stamps showing their piles' state: opened, closed, locked
 * or emptied in play, through Item Piles or by hand. Any change to a token,
 * an actor or an item may be a pile's, so each rechecks every pile on the
 * scene, one recheck at a time. Only the active GM writes, as for doors.
 */
export function followPileStates(controller: () => CartographyController | null): void {
    let queue: Promise<void> = Promise.resolve();
    const recheck = (): void => {
        const active = controller();
        if (!active || itemPiles() === null || game.users?.activeGM?.isSelf !== true) {
            return;
        }
        // A recheck that fails (a pile deleted mid-way) is reported, and never stops the ones after it.
        queue = queue
            .then(async () => showPileStates(active))
            // eslint-disable-next-line no-restricted-syntax -- boundary: a rejection's reason is untyped, and is only logged
            .catch((error: unknown) => {
                console.error(`${MODULE_ID} | could not follow a pile's state`, error);
            });
    };
    for (const hook of ['updateToken', 'updateActor', 'createItem', 'updateItem', 'deleteItem'] as const) {
        Hooks.on(hook, recheck);
    }
}

export function createItemPilesContainers(sceneId: () => string | null): ContainerService {
    return {
        available: () => itemPiles() !== null,
        create: async (spec, pileName) => {
            const api = itemPiles();
            const scene = sceneId();
            if (!api || scene === null) {
                return null;
            }
            return tokenUuidOf(
                await api.createItemPile({
                    position: { x: spec.x, y: spec.y },
                    sceneId: scene,
                    tokenOverrides: { ...tokenData(spec), name: pileName },
                    actorOverrides: { name: pileName },
                    itemPileFlags: pileFlags(spec.pile),
                }),
            );
        },
        move: async (pile, spec) => {
            const token = foundry.utils.fromUuidSync(pile);
            if (token instanceof TokenDocument) {
                await token.update({ x: spec.x, y: spec.y, ...tokenData(spec) });
            }
        },
        remove: async (pile) => {
            const api = itemPiles();
            const token = foundry.utils.fromUuidSync(pile);
            if (api && token instanceof TokenDocument) {
                await api.deleteItemPile(token);
            }
        },
    };
}
