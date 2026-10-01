// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Foundry wiring for asset packs:
 *
 * - loading packs (stamps and terrain texture sets), and the texture-set and
 *   stamp settings;
 * - the stamp browser window, canvas drops, and the tile HUD variant bar;
 * - adopting GM edits to stamp tiles, and door state changes made in play.
 *
 * Every decision is delegated to the controller and the pure core; this only
 * translates Foundry events into controller calls.
 */
import type { CartographyController, StampCatalog } from '../canvas/controller';
import type { Point } from '../geometry/spline';
import { I18N } from '../i18n';
import { MODULE_ID } from '../module-id';
import { type CatalogStamp, loadPacks, resolveVariant } from '../stamps/catalog';
import { parseStampDrop } from '../stamps/drop';
import { isRecord, stringOrNull } from '../tools/guards';
import {
    compressedTextures,
    pickTextureSet,
    previewResolver,
    shownImage,
    textureResolver,
    textureSetChoices,
    tileSquaresByUrl,
    type TextureResolver,
    type TextureSetRef,
} from '../tools/texture';
import type { BrowserLabels } from '../ui/stamp-browser-view';
import { format, localize } from './localize';
import { fetchPacks } from './packs';
import { setTileSquares } from './pixi-surface';
import { patternImage } from './procedural-textures';
import { type ArmedStamp, createStampBrowser } from './stamp-browser';
import { doorStateFromDs, tileFrame } from './translate';

const SNAP_SETTING = 'stampSnap';
const SCALE_SETTING = 'stampScale';
const TEXTURE_SET_SETTING = 'textureSet';

/** Range of the stamp scale setting slider. */
const SCALE_RANGE = { min: 0.25, max: 4, step: 0.05 } as const;

declare global {
    interface SettingConfig {
        'zephyr-cartography.stampSnap': boolean;
        'zephyr-cartography.stampScale': number;
        'zephyr-cartography.textureSet': string;
    }
}

export interface PackRuntime {
    readonly catalog: StampCatalog;
    /** Every stamp the loaded packs offer. */
    readonly stamps: () => readonly CatalogStamp[];
    /** Open the stamp browser window. */
    readonly openBrowser: () => void;
    /** Place the stamp selected in the browser at a world point. */
    readonly placeArmedAt: (point: Point) => void;
    /** Resolves texture roles against the GM's chosen texture set (flat colour until packs load). */
    readonly textures: () => TextureResolver;
    /** Resolves texture roles to the images panels show: a compressed texture's preview, or none. */
    readonly previews: () => TextureResolver;
    /** Every texture role the chosen texture set provides (biomes, `road`, `floor.*`, `wall.*`). */
    readonly textureRoles: () => string[];
    /** The texture sets the loaded packs provide, and the key of the one in use (none loaded: ''). */
    readonly textureSets: () => readonly TextureSetRef[];
    readonly activeTextureSet: () => string;
    /** Use another texture set for all terrain (the world setting, so every client follows). */
    readonly chooseTextureSet: (key: string) => Promise<void>;
    /** Run `listener` whenever the loaded packs or the chosen texture set change. */
    readonly onChange: (listener: () => void) => void;
    /** Resolves once the packs have loaded and every change in hand has rebuilt the draw layer. */
    readonly settled: () => Promise<void>;
}

function browserLabels(): BrowserLabels {
    const b = I18N.browser;
    return {
        search: localize(b.search),
        scale: localize(b.scale),
        perspective: localize(b.perspective),
        settings: localize(b.settings),
        any: localize(b.any),
        all: localize(b.all),
        rotate: localize(b.rotate),
        clearTags: localize(b.clearTags),
        place: localize(b.place),
        variants: localize(b.variants),
        empty: localize(b.empty),
        noSelection: localize(b.noSelection),
        categories: localize(b.categories),
        stamps: localize(b.stamps),
        status: (shown, total) => format(b.status, { shown: String(shown), total: String(total) }),
        cardHint: localize(b.cardHint),
    };
}

function registerSettings(): void {
    game.settings?.register(MODULE_ID, SNAP_SETTING, {
        name: I18N.settings.stampSnapName,
        hint: I18N.settings.stampSnapHint,
        scope: 'client',
        config: true,
        type: Boolean,
        default: true,
    });
    game.settings?.register(MODULE_ID, SCALE_SETTING, {
        name: I18N.settings.stampScaleName,
        hint: I18N.settings.stampScaleHint,
        scope: 'client',
        config: true,
        type: Number,
        default: 1,
        range: { ...SCALE_RANGE },
    });
}

/** The client's placement preferences. */
function placementPrefs(): { snap: boolean; scale: number } {
    const snap = game.settings?.get(MODULE_ID, SNAP_SETTING);
    const scale = game.settings?.get(MODULE_ID, SCALE_SETTING);
    return { snap: snap !== false, scale: typeof scale === 'number' && scale > 0 ? scale : 1 };
}

// eslint-disable-next-line no-restricted-syntax -- boundary: a tile document's flags are arbitrary JSON; reads the owning feature id we wrote
function flaggedFeatureId(flags: unknown): string | null {
    const scoped = isRecord(flags) ? flags[MODULE_ID] : null;
    return isRecord(scoped) ? stringOrNull(scoped['featureId']) : null;
}

/** The feature that generated a tile: from the tile's own flag, else the controller's records. */
// eslint-disable-next-line no-restricted-syntax -- boundary: a tile document's flags are arbitrary JSON, narrowed by flaggedFeatureId
function tileOwner(active: CartographyController, tile: { readonly id: string | null; readonly flags: unknown }): string | null {
    return flaggedFeatureId(tile.flags) ?? (tile.id === null ? null : active.featureForTile(tile.id));
}

export function registerPackRuntime(controller: () => CartographyController | null): PackRuntime {
    let stamps: readonly CatalogStamp[] = [];
    let byKey = new Map<string, CatalogStamp>();
    let textureSets: readonly TextureSetRef[] = [];
    const listeners: (() => void)[] = [];
    let firstLoaded = (): void => undefined;
    /**
     * Every pack change in hand, the packs' first load among them. Each
     * rebuilds the draw layer with a new controller, so what writes to the
     * scene (composing) waits for them: a controller rebuilt mid-write would
     * load the features half written and draw none of the rest.
     */
    let settling = new Promise<void>((resolve) => {
        firstLoaded = resolve;
    });
    /** The chosen texture set, loaded: its compressed images are in Foundry's texture cache before anything redraws with them. */
    const notifyChange = async (): Promise<void> => {
        const change = (async (): Promise<void> => {
            // Foundry's loader decodes KTX2 and Basis (14.362); a failed one logs and the fill falls back to its colour.
            await Promise.all(
                compressedTextures(activeSet()).map(async (url) =>
                    // eslint-disable-next-line no-restricted-syntax -- boundary: a rejection's reason is untyped, and is only logged
                    foundry.canvas.loadTexture(url).catch((error: unknown) => {
                        console.error(`${MODULE_ID} | could not load the compressed texture ${url}`, error);
                    }),
                ),
            );
            for (const listener of listeners) {
                listener();
            }
        })();
        // A failed change is reported where it is awaited; later waiters still go ahead once it has ended.
        const ended = change.catch(() => undefined);
        settling = Promise.all([settling, ended]).then(() => undefined);
        await change;
    };
    // Foundry keeps a reference to this object; filling it once packs load populates the settings dropdown.
    const textureChoices: Record<string, string> = {};

    /** The GM's chosen texture set, or the first loaded one. */
    const activeSet = (): TextureSetRef | null => {
        const chosen = game.settings?.get(MODULE_ID, TEXTURE_SET_SETTING);
        return pickTextureSet(textureSets, typeof chosen === 'string' ? chosen : '');
    };

    const place = (armed: ArmedStamp, point: Point): void => {
        const active = controller();
        if (!active || !canvas?.scene) {
            ui.notifications?.warn(localize(I18N.notifications.noScene));
            return;
        }
        void active.placeStamp({ stamp: armed.stamp, variant: armed.variant, rotation: armed.rotation, x: point.x, y: point.y, ...placementPrefs() });
    };

    const browser = createStampBrowser({
        title: () => localize(I18N.browser.title),
        catalog: () => stamps,
        labels: browserLabels,
        placeAtViewCentre: (armed) => {
            const pivot = canvas?.stage?.pivot;
            place(armed, { x: pivot?.x ?? 0, y: pivot?.y ?? 0 });
        },
    });

    Hooks.once('init', registerSettings);

    const loadAllPacks = async (): Promise<void> => {
        try {
            await loadPacksOnce();
        } finally {
            firstLoaded();
        }
    };

    const loadPacksOnce = async (): Promise<void> => {
        const fetched = await fetchPacks();
        const loaded = loadPacks(fetched.sources);
        stamps = loaded.stamps;
        byKey = new Map(stamps.map((s) => [s.key, s]));
        textureSets = loaded.textureSets;
        setTileSquares(tileSquaresByUrl(textureSets));
        Object.assign(textureChoices, textureSetChoices(textureSets));
        for (const failure of fetched.failures) {
            ui.notifications?.error(format(I18N.notifications.packFetchFailed, { module: failure.moduleId, message: failure.message }));
        }
        for (const error of loaded.errors) {
            console.error(`${MODULE_ID} | stamp pack ${error.moduleId} is invalid`, error.issues);
            ui.notifications?.error(format(I18N.notifications.packInvalid, { module: error.moduleId, count: String(error.issues.length) }));
        }
        await notifyChange();
    };

    Hooks.once('init', () => {
        game.settings?.register(MODULE_ID, TEXTURE_SET_SETTING, {
            name: I18N.settings.textureSetName,
            hint: I18N.settings.textureSetHint,
            scope: 'world',
            config: true,
            type: String,
            choices: textureChoices,
            default: '',
            onChange: () => {
                void notifyChange();
            },
        });
    });

    Hooks.once('ready', () => {
        void loadAllPacks();
    });

    // Returning false claims the drop; true lets Foundry's own handlers see anything that is not a stamp.
    Hooks.on('dropCanvasData', (_canvas, data) => {
        const drop = parseStampDrop(data);
        if (!drop || typeof data.x !== 'number' || typeof data.y !== 'number') {
            return true;
        }
        place(drop, { x: data.x, y: data.y });
        return false;
    });

    Hooks.on('renderTileHUD', (hud, html) => {
        const active = controller();
        const tile = hud.document;
        const featureId = tile && active ? tileOwner(active, tile) : null;
        const feature = featureId !== null && active ? active.getFeature(featureId) : null;
        const stamp = feature?.type === 'stamp' ? byKey.get(feature.stamp) : undefined;
        const column = html.querySelector('.col.right');
        if (!active || feature?.type !== 'stamp' || !stamp || stamp.variants.length < 2 || !column) {
            return;
        }
        const bar = document.createElement('div');
        bar.className = `${MODULE_ID}-hud-variants`;
        stamp.variants.forEach((variant, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'control-icon';
            button.setAttribute('aria-pressed', String(index === feature.variant));
            button.setAttribute('aria-label', format(I18N.hud.variant, { state: resolveVariant(stamp, index).state }));
            button.title = button.getAttribute('aria-label') ?? '';
            // Compressed art with no preview has no image a browser can show; the button keeps its label.
            const shown = shownImage(variant.image, variant.preview);
            if (shown !== null) {
                const img = document.createElement('img');
                img.src = shown;
                img.alt = '';
                button.append(img);
            } else {
                button.textContent = String(index + 1);
            }
            const choose = async (): Promise<void> => {
                await active.setStampVariant(feature.id, index);
                await hud.render();
            };
            button.addEventListener('click', (clickEvent) => {
                clickEvent.preventDefault();
                void choose();
            });
            bar.append(button);
        });
        column.append(bar);
    });

    Hooks.on('updateTile', (tile, changed, _options, userId) => {
        const active = controller();
        // A changed anchor moves the drawn tile too.
        const moved = ['x', 'y', 'width', 'height', 'rotation', 'texture'].some((field) => field in changed);
        if (!active || !moved || userId !== game.user?.id) {
            return;
        }
        const featureId = tileOwner(active, tile);
        if (featureId !== null) {
            void active.syncStampFrame(featureId, tileFrame(tile));
        }
    });

    // A door opened, closed or locked in play shows on its door stamp. Only the active GM rewrites the
    // stamp: players cannot edit tiles or walls, and several GMs acting would race.
    Hooks.on('updateWall', (wall, changed) => {
        const active = controller();
        const ds = 'ds' in changed ? changed.ds : undefined;
        if (!active || typeof ds !== 'number' || wall.id === null || game.users?.activeGM?.isSelf !== true) {
            return;
        }
        const state = doorStateFromDs(ds);
        if (state) {
            void active.applyDoorState(wall.id, state);
        }
    });

    Hooks.on('deleteTile', (tile, _options, userId) => {
        const active = controller();
        if (!active || userId !== game.user?.id) {
            return;
        }
        // A GM deleting a stamp's tile deletes the stamp (and its other documents) too.
        const featureId = tile.id === null ? null : active.featureForTile(tile.id);
        if (featureId !== null) {
            void active.remove(featureId);
        }
    });

    return {
        settled: async () => settling,
        textures: () => textureResolver(activeSet(), patternImage, textureSets),
        previews: () => previewResolver(activeSet(), patternImage),
        textureRoles: () => Object.keys(activeSet()?.textures ?? {}),
        textureSets: () => textureSets,
        activeTextureSet: () => activeSet()?.key ?? '',
        chooseTextureSet: async (key) => {
            await game.settings?.set(MODULE_ID, TEXTURE_SET_SETTING, key);
        },
        onChange: (listener) => {
            listeners.push(listener);
        },
        catalog: { get: (key) => byKey.get(key) ?? null },
        stamps: () => stamps,
        openBrowser: browser.open,
        placeArmedAt: (point) => {
            const armed = browser.armed();
            if (armed) {
                place(armed, point);
            } else {
                ui.notifications?.info(localize(I18N.notifications.noArmedStamp));
            }
        },
    };
}
