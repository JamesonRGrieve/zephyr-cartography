// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
    adjacentLevel,
    editLevelArt,
    findLevel,
    levelElevation,
    levelHeightFor,
    levelPanel,
    nextLevelBand,
    NO_LEVEL_ART,
    onLevel,
    planningLevels,
    seenBelow,
    sortLevels,
    type Level,
    type LevelArt,
    type LevelArtEdit,
} from './levels';

const levels: Level[] = [
    { id: 'upper', name: 'Upper', bottom: 10, top: 20, art: NO_LEVEL_ART },
    { id: 'cellar', name: 'Cellar', bottom: -10, top: 0, art: NO_LEVEL_ART },
    { id: 'ground', name: 'Ground', bottom: 0, top: 10, art: NO_LEVEL_ART },
];

describe('planningLevels', () => {
    it('changes with a band, a name or the levels one sees, but not with a level’s images or look', () => {
        const painted = levels.map((level) => ({ ...level, art: { ...NO_LEVEL_ART, background: 'floor.webp' } }));
        expect(planningLevels(painted)).toBe(planningLevels(levels));
        const seeing = levels.map((level) => (level.id === 'upper' ? { ...level, art: { ...NO_LEVEL_ART, visibleLevels: ['ground'] } } : level));
        expect(planningLevels(seeing)).not.toBe(planningLevels(levels));
        expect(planningLevels(levels.map((level) => ({ ...level, name: `${level.name}!` })))).not.toBe(planningLevels(levels));
        expect(planningLevels(levels.map((level) => ({ ...level, top: level.top + 1 })))).not.toBe(planningLevels(levels));
    });
});

describe('editLevelArt', () => {
    const edit = (change: LevelArtEdit): LevelArt | null => editLevelArt(NO_LEVEL_ART, change);

    it('sets an image path, trimmed, and clears a blank one', () => {
        expect(edit({ kind: 'image', image: 'fog', path: ' maps/fog.webp ' })?.fog).toBe('maps/fog.webp');
        expect(editLevelArt({ ...NO_LEVEL_ART, background: 'a.webp' }, { kind: 'image', image: 'background', path: '  ' })?.background).toBeNull();
    });

    it('takes six-digit hex colours, lower-cased, for the backdrop and each tint', () => {
        expect(edit({ kind: 'backgroundColor', typed: ' #AB12CD ' })?.backgroundColor).toBe('#ab12cd');
        expect(edit({ kind: 'tint', image: 'foreground', typed: '#00ff00' })?.tints).toEqual({ ...NO_LEVEL_ART.tints, foreground: '#00ff00' });
        expect(edit({ kind: 'backgroundColor', typed: 'red' })).toBeNull();
        expect(edit({ kind: 'tint', image: 'background', typed: '#fff' })).toBeNull();
    });

    it('takes alpha thresholds from 0 to 1', () => {
        expect(edit({ kind: 'threshold', image: 'background', typed: '0' })?.alphaThresholds.background).toBe(0);
        expect(edit({ kind: 'threshold', image: 'foreground', typed: '1' })?.alphaThresholds.foreground).toBe(1);
        expect(edit({ kind: 'threshold', image: 'background', typed: '1.01' })).toBeNull();
        expect(edit({ kind: 'threshold', image: 'background', typed: '-0.1' })).toBeNull();
        expect(edit({ kind: 'threshold', image: 'background', typed: '' })).toBeNull();
    });

    it('places the images: whole-pixel offsets, scales that are not 0, any anchor and rotation, and a fit', () => {
        expect(edit({ kind: 'placement', field: 'offsetY', typed: '-40' })?.placement.offsetY).toBe(-40);
        expect(edit({ kind: 'placement', field: 'offsetX', typed: '4.5' })).toBeNull();
        expect(edit({ kind: 'placement', field: 'scaleX', typed: '-1' })?.placement.scaleX).toBe(-1);
        expect(edit({ kind: 'placement', field: 'scaleY', typed: '0' })).toBeNull();
        expect(edit({ kind: 'placement', field: 'anchorX', typed: '0.25' })?.placement.anchorX).toBe(0.25);
        expect(edit({ kind: 'placement', field: 'rotation', typed: '90' })?.placement.rotation).toBe(90);
        expect(edit({ kind: 'placement', field: 'rotation', typed: 'x' })).toBeNull();
        expect(edit({ kind: 'fit', fit: 'contain' })?.placement).toEqual({ ...NO_LEVEL_ART.placement, fit: 'contain' });
    });

    it('adds and removes a level seen from this one, never twice', () => {
        const seen = edit({ kind: 'visible', level: 'cellar', visible: true });
        expect(seen?.visibleLevels).toEqual(['cellar']);
        const again = seen && editLevelArt(seen, { kind: 'visible', level: 'cellar', visible: true });
        expect(again?.visibleLevels).toEqual(['cellar']);
        expect(again && editLevelArt(again, { kind: 'visible', level: 'cellar', visible: false })?.visibleLevels).toEqual([]);
    });
});

describe('levels', () => {
    it('sort bottom to top and are found by id', () => {
        expect(sortLevels(levels).map((l) => l.id)).toEqual(['cellar', 'ground', 'upper']);
        expect(findLevel(levels, 'ground')?.name).toBe('Ground');
        expect(findLevel(levels, 'attic')).toBeNull();
        expect(findLevel(levels, null)).toBeNull();
    });

    it('see the levels below them they name, lowest first, never one above', () => {
        const seeing = (id: string, visibleLevels: string[]): Level[] =>
            levels.map((l) => (l.id === id ? { ...l, art: { ...NO_LEVEL_ART, visibleLevels } } : l));
        expect(seenBelow(seeing('upper', ['ground', 'cellar']), 'upper').map((l) => l.id)).toEqual(['cellar', 'ground']);
        // The ground sees nothing above it, and a level naming none sees none.
        expect(seenBelow(seeing('ground', ['upper']), 'ground')).toEqual([]);
        expect(seenBelow(levels, 'upper')).toEqual([]);
        expect(seenBelow(levels, null)).toEqual([]);
    });

    it('step to the neighbouring level, null past the ends', () => {
        expect(adjacentLevel(levels, 'ground', 1)?.id).toBe('upper');
        expect(adjacentLevel(levels, 'ground', -1)?.id).toBe('cellar');
        expect(adjacentLevel(levels, 'upper', 1)).toBeNull();
        expect(adjacentLevel(levels, 'attic', 1)).toBeNull();
    });

    it('give documents their floor elevation', () => {
        expect(levelElevation(levels, 'upper')).toBe(10);
        expect(levelElevation(levels, null)).toBe(0);
    });

    it('stack new bands above or below, starting from 0', () => {
        expect(nextLevelBand(levels, 'above')).toEqual({ bottom: 20, top: 30 });
        expect(nextLevelBand(levels, 'below', 5)).toEqual({ bottom: -15, top: -10 });
        expect(nextLevelBand([], 'above')).toEqual({ bottom: 0, top: 10 });
        expect(nextLevelBand([], 'below')).toEqual({ bottom: -10, top: 0 });
    });

    it('make a new level 4 grid squares tall, as Foundry v14 does', () => {
        expect(levelHeightFor(5)).toBe(20);
        expect(levelHeightFor(1.5)).toBe(6);
        // A scene without a usable grid distance falls back to the default height.
        expect(levelHeightFor(0)).toBe(10);
    });

    it('show a feature on its own level, and level-less features everywhere', () => {
        expect(onLevel('ground', 'ground')).toBe(true);
        expect(onLevel('ground', 'upper')).toBe(false);
        expect(onLevel(null, 'upper')).toBe(true);
        expect(onLevel('ground', null)).toBe(true);
    });

    it('present the panel top to bottom, only empty levels removable', () => {
        const panel = levelPanel(levels, 'ground', { ground: 2 });
        expect(panel.rows.map((r) => [r.level.id, r.active, r.count, r.removable])).toEqual([
            ['upper', false, 0, true],
            ['ground', true, 2, false],
            ['cellar', false, 0, true],
        ]);
        expect(panel.allActive).toBe(false);
        expect(levelPanel(levels, null, {}).allActive).toBe(true);
    });
});
