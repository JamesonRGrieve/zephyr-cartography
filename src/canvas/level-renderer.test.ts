// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Feature } from '../tools/feature';
import { NO_DOCS } from '../tools/generated-docs';
import { LevelRoutedRenderer } from './level-renderer';
import type { FeatureRenderer } from './renderer';

/** A renderer that records what it was asked to do. */
class Recording implements FeatureRenderer {
    readonly calls: string[] = [];
    set(id: string): void {
        this.calls.push(`set ${id}`);
    }
    preview(): void {
        this.calls.push('preview');
    }
    remove(id: string): void {
        this.calls.push(`remove ${id}`);
    }
    clearPreview(): void {
        this.calls.push('clear preview');
    }
    clear(): void {
        this.calls.push('clear');
    }
}

const road = (id: string, level: string | null): Feature => ({
    type: 'path',
    id,
    kind: 'road',
    points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
    ],
    halfWidths: [10, 10],
    walls: null,
    river: null,
    docs: NO_DOCS,
    level,
});

describe('LevelRoutedRenderer', () => {
    it('draws the viewed level’s features and those on every level on its own surface, another level’s on that level’s', () => {
        const own = new Recording();
        const ground = new Recording();
        const made: string[] = [];
        const renderer = new LevelRoutedRenderer(own, 'upper', (level) => {
            made.push(level);
            return ground;
        });
        renderer.set('a', road('a', 'upper'));
        renderer.set('b', road('b', null));
        renderer.set('c', road('c', 'ground'));
        renderer.set('d', road('d', 'ground'));
        expect(own.calls).toEqual(['set a', 'set b']);
        expect(ground.calls).toEqual(['set c', 'set d']);
        // Each other level's surface is made once.
        expect(made).toEqual(['ground']);
    });

    it('removes a feature from the surface it is on, moves one whose level changed, and clears every surface', () => {
        const own = new Recording();
        const ground = new Recording();
        const renderer = new LevelRoutedRenderer(own, 'upper', () => ground);
        renderer.set('c', road('c', 'ground'));
        renderer.remove('c');
        renderer.set('e', road('e', 'ground'));
        renderer.set('e', road('e', 'upper'));
        renderer.clear();
        expect(ground.calls).toEqual(['set c', 'remove c', 'set e', 'remove e', 'clear']);
        expect(own.calls).toEqual(['set e', 'clear']);
    });

    it('draws on its own surface where another level’s cannot be made, and previews there', () => {
        const own = new Recording();
        const renderer = new LevelRoutedRenderer(own, null, () => null);
        renderer.set('c', road('c', 'ground'));
        renderer.preview(road('p', 'ground'));
        renderer.clearPreview();
        renderer.clear();
        expect(own.calls).toEqual(['set c', 'preview', 'clear preview', 'clear']);
    });
});
