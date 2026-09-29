// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Features drawn on the surface of their own level. The viewed level's
 * features (and those on every level) draw on its own surface; a feature on
 * a level it sees below it (the yard round an upper storey) draws on that
 * level's surface, made when first needed, so it lies at that level's height
 * beneath that level's tiles, as Foundry sorts the canvas. Pure.
 */
import type { Feature } from '../tools/feature';
import type { FeatureRenderer } from './renderer';

export class LevelRoutedRenderer implements FeatureRenderer {
    /** The surface each drawn feature is on, so it is removed from that one. */
    private readonly drawnOn = new Map<string, FeatureRenderer>();
    /** Each other level's renderer, once made. */
    private readonly levels = new Map<string, FeatureRenderer>();

    /** `viewed` is the level in view (null: the scene has none); `surfaceFor` makes another level's renderer, or null where it cannot. */
    constructor(
        private readonly own: FeatureRenderer,
        private readonly viewed: string | null,
        private readonly surfaceFor: (level: string) => FeatureRenderer | null,
    ) {}

    set(id: string, feature: Feature): void {
        const target = this.route(feature);
        const before = this.drawnOn.get(id);
        if (before !== undefined && before !== target) {
            before.remove(id);
        }
        target.set(id, feature);
        this.drawnOn.set(id, target);
    }

    preview(feature: Feature): void {
        this.own.preview(feature);
    }

    remove(id: string): void {
        (this.drawnOn.get(id) ?? this.own).remove(id);
        this.drawnOn.delete(id);
    }

    clearPreview(): void {
        this.own.clearPreview();
    }

    clear(): void {
        this.own.clear();
        for (const renderer of this.levels.values()) {
            if (renderer !== this.own) {
                renderer.clear();
            }
        }
        this.drawnOn.clear();
    }

    /** The renderer for `feature`'s level: the viewed level's own for it and for every level; else that level's, made once. */
    private route(feature: Feature): FeatureRenderer {
        const { level } = feature;
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
