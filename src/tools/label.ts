// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Map labels: text on the map ("Residence District 4", "The Sump"), realised as a
 * native text Drawing. The label owns its Drawing like any feature its
 * documents, so moving, undoing and erasing follow the usual rules. Foundry
 * wraps a drawing's text to its box, so the box is sized generously from the
 * text. Pure and unit-tested.
 */
import { boxCorners } from '../geometry/rectangle';
import type { Point } from '../geometry/spline';
import { parseCssHex } from './colour';
import { NEW_FEATURE, parseFeatureCommon, type FeatureCommon } from './feature-common';
import { isPoint, isRecord } from './guards';

/** How a label reads. */
export interface LabelSettings {
    readonly text: string;
    /** Px, 8–256 as Foundry takes it. */
    readonly fontSize: number;
    /** `#rrggbb`. */
    readonly colour: string;
    /** A font Foundry knows; "" for its default. */
    readonly fontFamily: string;
    /** Degrees. */
    readonly rotation: number;
    /** Seen by the GM alone. */
    readonly hidden: boolean;
}

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 256;

/** Foundry's own defaults for a new text drawing's size and colour. */
export const NEW_LABEL: LabelSettings = { text: '', fontSize: 48, colour: '#ffffff', fontFamily: '', rotation: 0, hidden: false };

/** A label; its one point is the centre of its text. */
export interface LabelFeature extends FeatureCommon, LabelSettings {
    readonly type: 'label';
}

/** How much wider than the font size one character is allowed, and the box's height in lines, so Foundry never wraps a label. */
const CHARACTER_WIDTH = 0.7;
const LINE_HEIGHT = 1.5;

export function makeLabel(id: string, at: Point, settings: LabelSettings = NEW_LABEL): LabelFeature {
    return { type: 'label', id, points: [{ x: at.x, y: at.y }], ...settings, ...NEW_FEATURE };
}

/** The centre of the label's text. */
export function labelPoint(label: LabelFeature): Point {
    return label.points[0] ?? { x: 0, y: 0 };
}

/** The label's box: wide enough for its longest line on one line, and as tall as its lines. */
export function labelBox(settings: LabelSettings): { readonly width: number; readonly height: number } {
    const lines = settings.text.split('\n');
    const longest = Math.max(1, ...lines.map((line) => line.length));
    return {
        width: Math.ceil((longest * CHARACTER_WIDTH + 1) * settings.fontSize),
        height: Math.ceil(lines.length * LINE_HEIGHT * settings.fontSize),
    };
}

/** The corners of the label's box, turned with it. */
export function labelCorners(label: LabelFeature): Point[] {
    return boxCorners({ centre: labelPoint(label), ...labelBox(label), rotation: label.rotation });
}

/** How `label` reads. */
export function labelSettingsOf(label: LabelFeature): LabelSettings {
    return {
        text: label.text,
        fontSize: label.fontSize,
        colour: label.colour,
        fontFamily: label.fontFamily,
        rotation: label.rotation,
        hidden: label.hidden,
    };
}

/** A font size Foundry takes (a whole number, 8–256), or null. */
export function validFontSize(size: number): number | null {
    return Number.isInteger(size) && size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE ? size : null;
}

// eslint-disable-next-line no-restricted-syntax -- boundary: parses one untyped scene-flag entry, validating shape and returning a narrow LabelFeature or null
export function parseLabel(v: unknown): LabelFeature | null {
    if (!isRecord(v) || v['type'] !== 'label' || typeof v['id'] !== 'string' || !Array.isArray(v['points'])) {
        return null;
    }
    const [at] = v['points'].filter(isPoint);
    if (at === undefined) {
        return null;
    }
    const { text, fontSize, colour, fontFamily, rotation, hidden } = v;
    const settings: LabelSettings = {
        text: typeof text === 'string' ? text : NEW_LABEL.text,
        fontSize: (typeof fontSize === 'number' ? validFontSize(fontSize) : null) ?? NEW_LABEL.fontSize,
        colour: typeof colour === 'string' && parseCssHex(colour) !== null ? colour : NEW_LABEL.colour,
        fontFamily: typeof fontFamily === 'string' ? fontFamily : NEW_LABEL.fontFamily,
        rotation: typeof rotation === 'number' && Number.isFinite(rotation) ? rotation : NEW_LABEL.rotation,
        hidden: hidden === true,
    };
    return { ...makeLabel(v['id'], at, settings), ...parseFeatureCommon(v) };
}
