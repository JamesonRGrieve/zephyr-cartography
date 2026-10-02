// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The zone panel: a zone's name, its shape (Foundry's own region shapes)
 * and that shape's sizes, its rotation, whether Foundry measures it in grid
 * units, the token it moves with, and the world's hazard presets to apply to
 * it or save it as. Named with Foundry's own shape and Region sheet strings.
 * A pure function from the zone's settings, the scene's tokens and the
 * preset names to elements; unit-tested under happy-dom.
 */
import { cellBlock, cellExtent, reshapedZone, shapeSizes, withCurvature, withShapeSize, type ZoneSettings } from '../tools/zone';
import { CONE_CURVATURES, type ConeCurvature, ZONE_SHAPES, type ZoneShape, type ZoneShapeKind } from '../tools/zone-shape';
import { button, choice, el, labelledCheckbox, labelledInput, replacePreservingFocus } from './dom';

/** A token on the scene a zone can move with. */
export interface TokenChoice {
    readonly id: string;
    readonly name: string;
}

export interface ZonePanel {
    readonly settings: ZoneSettings;
    readonly tokens: readonly TokenChoice[];
    /** The world's hazard presets, by name. */
    readonly presets: readonly string[];
    /** The scene's cell size (px) on a square grid, for zones of grid spaces; null where there are none. */
    readonly cellSize: number | null;
}

export interface ZoneLabels {
    readonly name: string;
    readonly shape: string;
    readonly shapes: Readonly<Record<ZoneShapeKind, string>>;
    /** A size field's name on a shape of `kind` ("Radius", "X-Size", "Angle"…). */
    readonly size: (kind: ZoneShapeKind, field: string) => string;
    readonly curvature: string;
    readonly curvatures: Readonly<Record<ConeCurvature, string>>;
    /** A block of grid spaces' rows and columns. */
    readonly rows: string;
    readonly columns: string;
    readonly rotation: string;
    readonly gridBased: string;
    readonly token: string;
    /** The "no token" choice. */
    readonly none: string;
    readonly presets: PresetLabels;
}

/** The hazard presets section's fields. */
interface PresetLabels {
    readonly title: string;
    readonly preset: string;
    readonly apply: string;
    readonly forget: string;
    readonly name: string;
    readonly save: string;
    readonly empty: string;
}

export interface ZoneHandlers {
    /** Apply new settings; false rejects them (the input reverts). */
    readonly set: (settings: ZoneSettings) => boolean;
    /** Give the zone the named preset's shape and area settings. */
    readonly applyPreset: (name: string) => void;
    /** Save the zone as a preset named `name` (replacing one of that name). */
    readonly savePreset: (name: string) => void;
    readonly forgetPreset: (name: string) => void;
}

/** The world's presets to apply or forget, and the zone saved as one under a name (its own, to start). */
function presetSection(panel: ZonePanel, labels: PresetLabels, handlers: ZoneHandlers): HTMLElement {
    const section = el('fieldset', 'tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-box-border tw-w-full tw-mx-0');
    section.append(el('legend', 'tw-text-xs tw-font-bold', labels.title));
    const [first] = panel.presets;
    if (first === undefined) {
        section.append(el('p', 'tw-italic tw-text-xs', labels.empty));
    } else {
        let picked = first;
        section.append(
            choice(
                'zc-zone-preset',
                labels.preset,
                panel.presets.map((presetName) => [presetName, presetName] as const),
                first,
                (presetName) => {
                    picked = presetName;
                },
            ),
            button('tw-text-xs', labels.apply, 'zone-preset-apply', () => {
                handlers.applyPreset(picked);
            }),
            button('tw-text-xs', labels.forget, 'zone-preset-forget', () => {
                handlers.forgetPreset(picked);
            }),
        );
    }
    let saveAs = panel.settings.name;
    section.append(
        labelledInput(labels.name, 'text', saveAs, 'zone-preset-name', (typed) => {
            saveAs = typed;
            return true;
        }),
        button('tw-text-xs', labels.save, 'zone-preset-save', () => {
            handlers.savePreset(saveAs);
        }),
    );
    return section;
}

/** Select value standing for "no token" (no real id is empty). */
const NONE = '';

/** One number typed into a field: finite, or null. */
function typedNumber(typed: string): number | null {
    const value = typed.trim() === '' ? Number.NaN : Number(typed);
    return Number.isFinite(value) ? value : null;
}

/** Most rows or columns of grid spaces the panel makes a block of. */
const MAX_BLOCK_SIDE = 50;

/** A typed count of rows or columns: a whole number from 1, or null. */
function typedSide(typed: string): number | null {
    const value = typedNumber(typed);
    return value !== null && Number.isInteger(value) && value >= 1 && value <= MAX_BLOCK_SIDE ? value : null;
}

/** Grid spaces as a block of rows by columns (a spec's own spaces become a block of their span when either is changed). */
function cellFields(shape: Extract<ZoneShape, { kind: 'cells' }>, labels: ZoneLabels, set: (change: Partial<ZoneSettings>) => boolean): HTMLElement[] {
    const { rows, columns } = cellExtent(shape.cells);
    const block = (r: number, c: number): boolean => set({ shape: { ...shape, cells: cellBlock(r, c) } });
    return [
        labelledInput(labels.rows, 'number', String(rows), 'zone-rows', (typed) => {
            const side = typedSide(typed);
            return side !== null && block(side, columns);
        }),
        labelledInput(labels.columns, 'number', String(columns), 'zone-columns', (typed) => {
            const side = typedSide(typed);
            return side !== null && block(rows, side);
        }),
    ];
}

/** The size inputs of the zone's shape, each rejected (and reverted) when Foundry would not take it. */
function sizeFields(settings: ZoneSettings, labels: ZoneLabels, set: (change: Partial<ZoneSettings>) => boolean): HTMLElement[] {
    const { shape } = settings;
    if (shape.kind === 'cells') {
        return cellFields(shape, labels, set);
    }
    return Object.entries(shapeSizes(shape)).map(([field, value]) =>
        labelledInput(labels.size(shape.kind, field), 'number', String(value), `zone-${field}`, (typed) => {
            const number = typedNumber(typed);
            const next = number === null ? null : withShapeSize(shape, field, number);
            return next !== null && set({ shape: next });
        }),
    );
}

export function renderZonePanel(root: HTMLElement, panel: ZonePanel, labels: ZoneLabels, handlers: ZoneHandlers): void {
    const { settings } = panel;
    const set = (change: Partial<ZoneSettings>): boolean => handlers.set({ ...settings, ...change });
    const { shape } = settings;
    // A token no longer on the scene stays selectable, so opening the panel never silently detaches the zone.
    const tokens =
        settings.attachedTo === null || panel.tokens.some((t) => t.id === settings.attachedTo)
            ? panel.tokens
            : [...panel.tokens, { id: settings.attachedTo, name: settings.attachedTo }];
    replacePreservingFocus(root, [
        labelledInput(labels.name, 'text', settings.name, 'zone-name', (typed) => set({ name: typed.trim() })),
        choice(
            'zc-zone-shape',
            labels.shape,
            // Grid spaces only where the grid is square (or the zone already is some).
            ZONE_SHAPES.filter((kind) => kind !== 'cells' || panel.cellSize !== null || shape.kind === 'cells').map(
                (kind) => [kind, labels.shapes[kind]] as const,
            ),
            shape.kind,
            (kind) => {
                set({ shape: reshapedZone(kind, shape, panel.cellSize) });
            },
        ),
        ...sizeFields(settings, labels, set),
        ...(shape.kind === 'cone'
            ? [
                  choice(
                      'zc-zone-curvature',
                      labels.curvature,
                      CONE_CURVATURES.map((curvature) => [curvature, labels.curvatures[curvature]] as const),
                      shape.curvature,
                      (curvature) => {
                          set({ shape: withCurvature(shape, curvature) });
                      },
                  ),
              ]
            : []),
        labelledInput(labels.rotation, 'number', String(settings.rotation), 'zone-rotation', (typed) => {
            const rotation = typedNumber(typed);
            return rotation !== null && set({ rotation });
        }),
        labelledCheckbox(labels.gridBased, settings.gridBased, 'zone-grid-based', (gridBased) => {
            set({ gridBased });
        }),
        choice(
            'zc-zone-token',
            labels.token,
            [[NONE, labels.none] as const, ...tokens.map((t) => [t.id, t.name] as const)],
            settings.attachedTo ?? NONE,
            (token) => {
                set({ attachedTo: token === NONE ? null : token });
            },
        ),
        presetSection(panel, labels.presets, handlers),
    ]);
}
