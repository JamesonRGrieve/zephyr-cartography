// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Splat maps drawn on the surface of their own level, as `LevelRoutedRenderer`
 * draws painted features: the viewed level's layers (and those on every level)
 * on its own surface; a layer of a level it sees below it (the blended ground
 * round an upper storey) on that level's surface, made when first needed, so
 * the yard below shows round the storey instead of the scene's bare grey. A
 * bake renders the viewed level's own blend. Pure.
 */
import type { SplatLayer } from '../tools/splat';
import type { SplatRenderer } from './controller';

export class LevelRoutedSplatRenderer implements SplatRenderer {
    /** The renderer each drawn layer is on, so it is updated and removed there. */
    private readonly drawnOn = new Map<string, SplatRenderer>();
    /** Each other level's renderer, once made. */
    private readonly levels = new Map<string, SplatRenderer>();

    /** `viewed` is the level in view (null: the scene has none); `surfaceFor` makes another level's renderer, or null where it cannot. */
    constructor(
        private readonly own: SplatRenderer,
        private readonly viewed: string | null,
        private readonly surfaceFor: (level: string) => SplatRenderer | null,
    ) {}

    set(key: string, layer: SplatLayer, mask: Uint8ClampedArray): void {
        const target = this.route(layer.level);
        const before = this.drawnOn.get(key);
        if (before !== undefined && before !== target) {
            before.remove(key);
        }
        target.set(key, layer, mask);
        this.drawnOn.set(key, target);
    }

    update(key: string, rect: Parameters<SplatRenderer['update']>[1]): void {
        (this.drawnOn.get(key) ?? this.own).update(key, rect);
    }

    remove(key: string): void {
        (this.drawnOn.get(key) ?? this.own).remove(key);
        this.drawnOn.delete(key);
    }

    /**
     * A bake of the layers `keys`, rendered where they are drawn: a level viewed without a redraw since (a bake straight
     * after `setActiveLevel`) still has its layers on the surface they were drawn on, not on this renderer's own.
     */
    async snapshot(keys: readonly string[]): Promise<Uint8Array<ArrayBuffer> | null> {
        const first = keys[0];
        return ((first === undefined ? undefined : this.drawnOn.get(first)) ?? this.own).snapshot(keys);
    }

    /** The renderer for a layer on `level`: the viewed level's own for it and for every level; else that level's, made once. */
    private route(level: string | null): SplatRenderer {
        if (level === null || level === this.viewed) {
            return this.own;
        }
        const made = this.levels.get(level);
        if (made !== undefined) {
            return made;
        }
        const renderer = this.surfaceFor(level) ?? this.own;
        this.levels.set(level, renderer);
        return renderer;
    }
}
