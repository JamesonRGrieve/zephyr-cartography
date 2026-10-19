// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The road and river tools' window: opened with either tool, it sets the
 * width the next path is drawn at and, for a river, its liquid, shade and
 * bed. Water, lava, poison and acid are all the river tool.
 */
import { I18N } from '../i18n';
import { floorMaterials } from '../tools/materials';
import { DEFAULT_HALF_WIDTH, LIQUID_LOOKS, type PathKind, type RiverLook } from '../tools/path';
import { parseSizePx } from '../tools/size-input';
import type { WallPreset } from '../tools/wall-presets';
import { renderPathPanel } from '../ui/path-panel-view';
import { localize } from './localize';
import { materialLabel, wallKindNames } from './materials-runtime';
import { acceptTyped, createSettingsWindow } from './view-window';

const PANEL_WIDTH = 300;

export interface PathSettings {
    /** Full width, scene px. */
    readonly width: number;
    /** The kind of walls along the path, or null for none. */
    readonly walls: WallPreset | null;
    readonly river: RiverLook;
}

export interface PathRuntime {
    /** Open the panel for the road or river tool. */
    readonly open: (kind: PathKind) => void;
    readonly current: () => PathSettings;
}

/** `onChange` runs after every choice, to put it in the tools' hands. */
export function registerPathRuntime(textureRoles: () => string[], onChange: (settings: PathSettings) => void): PathRuntime {
    let kind: PathKind = 'river';
    const panel = createSettingsWindow<PathSettings>({
        id: 'paths',
        title: () => localize(I18N.paths.title),
        width: PANEL_WIDTH,
        initial: { width: DEFAULT_HALF_WIDTH * 2, walls: null, river: LIQUID_LOOKS.water },
        onChange,
        render: (root, settings, choose) => {
            const beds = floorMaterials(textureRoles()).map((role) => ({ role, label: materialLabel(role) }));
            renderPathPanel(
                root,
                { kind, beds, ...settings },
                {
                    width: localize(I18N.paths.width),
                    liquid: localize(I18N.paths.liquid),
                    liquids: {
                        water: localize(I18N.paths.liquids.water),
                        lava: localize(I18N.paths.liquids.lava),
                        poison: localize(I18N.paths.liquids.poison),
                        acid: localize(I18N.paths.liquids.acid),
                    },
                    shade: localize(I18N.paths.shade),
                    bed: localize(I18N.paths.bed),
                    noBed: localize(I18N.paths.noBed),
                    walls: localize(I18N.paths.walls),
                    noWalls: localize(I18N.paths.noWalls),
                    wallKinds: wallKindNames(),
                    drawHint: localize(I18N.paths.drawHint),
                    editHint: localize(I18N.paths.editHint),
                },
                {
                    setWidth: acceptTyped(parseSizePx, (width) => {
                        choose({ ...settings, width });
                    }),
                    setRiver: (river) => {
                        choose({ ...settings, river });
                    },
                    setWalls: (walls) => {
                        choose({ ...settings, walls });
                    },
                },
            );
        },
    });

    return {
        open: (tool) => {
            kind = tool;
            panel.open();
            panel.refresh();
        },
        current: panel.current,
    };
}
