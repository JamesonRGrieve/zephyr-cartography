// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { newSplatLayer } from '../tools/splat';
import type { SplatRenderer } from './controller';
import { LevelRoutedSplatRenderer } from './level-splat-renderer';

/** A splat renderer that records what it was asked to do. */
class Recording implements SplatRenderer {
    readonly calls: string[] = [];
    set(key: string): void {
        this.calls.push(`set ${key}`);
    }
    update(key: string): void {
        this.calls.push(`update ${key}`);
    }
    remove(key: string): void {
        this.calls.push(`remove ${key}`);
    }
    async snapshot(keys: readonly string[]): Promise<Uint8Array<ArrayBuffer> | null> {
        this.calls.push(`snapshot ${keys.join(',')}`);
        return Promise.resolve(null);
    }
}

const BOUNDS = { x: 0, y: 0, width: 400, height: 400 };
const layer = (level: string | null): ReturnType<typeof newSplatLayer> => newSplatLayer(level, 0, `splat-${level ?? 'all'}.png`, BOUNDS, 100);
const MASK = new Uint8ClampedArray(4);
const RECT = { x: 0, y: 0, width: 1, height: 1 };

describe('LevelRoutedSplatRenderer', () => {
    it('draws the viewed level’s blend and one on every level on its own surface, a seen level’s on that level’s, made once', () => {
        const own = new Recording();
        const ground = new Recording();
        const made: string[] = [];
        const renderer = new LevelRoutedSplatRenderer(own, 'upper', (level) => {
            made.push(level);
            return ground;
        });
        renderer.set('a', layer('upper'), MASK);
        renderer.set('b', layer(null), MASK);
        renderer.set('c', layer('ground'), MASK);
        renderer.set('d', layer('ground'), MASK);
        expect(own.calls).toEqual(['set a', 'set b']);
        expect(ground.calls).toEqual(['set c', 'set d']);
        expect(made).toEqual(['ground']);
    });

    it('updates and removes a layer where it is drawn, and bakes the viewed level’s own blend', async () => {
        const own = new Recording();
        const ground = new Recording();
        const renderer = new LevelRoutedSplatRenderer(own, 'upper', () => ground);
        renderer.set('c', layer('ground'), MASK);
        renderer.update('c', RECT);
        renderer.remove('c');
        await renderer.snapshot(['a']);
        expect(ground.calls).toEqual(['set c', 'update c', 'remove c']);
        expect(own.calls).toEqual(['snapshot a']);
    });

    it('passes an update or removal of a layer it never drew to its own surface', () => {
        const own = new Recording();
        const ground = new Recording();
        const renderer = new LevelRoutedSplatRenderer(own, 'upper', () => ground);
        renderer.update('x', RECT);
        renderer.remove('x');
        expect(own.calls).toEqual(['update x', 'remove x']);
        expect(ground.calls).toEqual([]);
    });

    it('moves a layer that changes level off the surface it was on', () => {
        const own = new Recording();
        const ground = new Recording();
        const renderer = new LevelRoutedSplatRenderer(own, 'upper', () => ground);
        renderer.set('k', layer('ground'), MASK);
        renderer.set('k', layer('upper'), MASK);
        expect(ground.calls).toEqual(['set k', 'remove k']);
        expect(own.calls).toEqual(['set k']);
    });

    it('draws on its own surface where another level’s cannot be made, and on a scene without levels', () => {
        const own = new Recording();
        new LevelRoutedSplatRenderer(own, 'upper', () => null).set('c', layer('ground'), MASK);
        new LevelRoutedSplatRenderer(own, null, () => null).set('d', layer('ground'), MASK);
        expect(own.calls).toEqual(['set c', 'set d']);
    });
});
