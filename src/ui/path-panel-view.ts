// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The road and river tools' panel: the width the next path is drawn at, the
 * kind of walls along it (Foundry's own, or none) and, for a river, what it carries (water, lava, poison or acid), the liquid's
 * shade, and the texture of the bed laid beneath it (or none); and how the
 * pen draws a path and the edit tool reshapes it. A pure
 * function from the panel state to elements; unit-tested under happy-dom.
 */
import { cssHex, parseCssHex } from '../tools/colour';
import { LIQUID_LOOKS, LIQUIDS, type Liquid, type PathKind, type RiverLook } from '../tools/path';
import { isWallPreset, WALL_PRESETS, type WallPreset } from '../tools/wall-presets';
import { choice, el, labelledInput, replacePreservingFocus } from './dom';

export interface BedChoice {
    readonly role: string;
    readonly label: string;
}

export interface PathPanel {
    readonly kind: PathKind;
    /** Full width, scene px. */
    readonly width: number;
    /** The kind of walls along the path, or null for none. */
    readonly walls: WallPreset | null;
    readonly river: RiverLook;
    /** Bed textures on offer, from the active set. */
    readonly beds: readonly BedChoice[];
}

export interface PathLabels {
    readonly width: string;
    readonly liquid: string;
    readonly liquids: Readonly<Record<Liquid, string>>;
    readonly shade: string;
    readonly bed: string;
    readonly noBed: string;
    readonly walls: string;
    readonly noWalls: string;
    /** Foundry's own Walls palette names. */
    readonly wallKinds: Readonly<Record<WallPreset, string>>;
    /** How the pen draws a path: clicks, drags and keys. */
    readonly drawHint: string;
    /** How the edit tool reshapes one. */
    readonly editHint: string;
}

export interface PathHandlers {
    /** Apply a typed width; false rejects it (the input reverts). */
    readonly setWidth: (typed: string) => boolean;
    readonly setWalls: (walls: WallPreset | null) => void;
    readonly setRiver: (river: RiverLook) => void;
}

/** The bed and walls selects' value standing for "none" (no real role or wall kind is empty). */
const NONE = '';

function shadeInput(label: string, shade: number, onChange: (shade: number) => void): HTMLElement {
    return labelledInput(label, 'color', cssHex(shade), 'path-shade', (typed) => {
        const picked = parseCssHex(typed);
        if (picked !== null) {
            onChange(picked);
        }
        return picked !== null;
    });
}

function riverControls(panel: PathPanel, labels: PathLabels, handlers: PathHandlers): HTMLElement[] {
    const { river } = panel;
    // Keep a bed the active set lacks selectable, so opening the panel never silently changes it.
    const { bed } = river;
    const beds = bed === null || panel.beds.some((b) => b.role === bed) ? panel.beds : [...panel.beds, { role: bed, label: bed }];
    return [
        choice(
            'zc-path-liquid',
            labels.liquid,
            LIQUIDS.map((liquid) => [liquid, labels.liquids[liquid]] as const),
            river.liquid,
            // A new liquid starts from its own shade and bed.
            (liquid) => {
                handlers.setRiver(LIQUID_LOOKS[liquid]);
            },
        ),
        shadeInput(labels.shade, river.shade, (shade) => {
            handlers.setRiver({ ...river, shade });
        }),
        choice('zc-path-bed', labels.bed, [[NONE, labels.noBed] as const, ...beds.map((b) => [b.role, b.label] as const)], bed ?? NONE, (picked) => {
            handlers.setRiver({ ...river, bed: picked === NONE ? null : picked });
        }),
    ];
}

export function renderPathPanel(root: HTMLElement, panel: PathPanel, labels: PathLabels, handlers: PathHandlers): void {
    replacePreservingFocus(root, [
        labelledInput(labels.width, 'number', String(panel.width), 'path-width', handlers.setWidth),
        choice(
            'zc-path-walls',
            labels.walls,
            [[NONE, labels.noWalls] as const, ...WALL_PRESETS.map((kind) => [kind, labels.wallKinds[kind]] as const)],
            panel.walls ?? NONE,
            (picked) => {
                handlers.setWalls(isWallPreset(picked) ? picked : null);
            },
        ),
        ...(panel.kind === 'river' ? riverControls(panel, labels, handlers) : []),
        el('p', 'tw-italic tw-text-xs tw-w-full tw-m-0', labels.drawHint),
        el('p', 'tw-italic tw-text-xs tw-w-full tw-m-0', labels.editHint),
    ]);
}
