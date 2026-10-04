// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Realise a scene spec: build every feature it describes through the
 * controller's public API, exactly as the GM's tools would, so a generated
 * map is ordinary, editable features and documents. The whole spec is one
 * undo step. Anything that cannot be built (a stamp from a pack that is not
 * loaded, an interior that cannot be linked) is reported, not thrown.
 */
import type { FeatureSpec, SceneSpec } from '../generate/spec';
import type { Point } from '../geometry/spline';
import { type Affected, type AreaEffect, storedDisplay, storedEffects, withDisabled } from '../tools/area-effects';
import { parseCssHex } from '../tools/colour';
import type { Feature } from '../tools/feature';
import { makeLabel } from '../tools/label';
import type { LevelArt } from '../tools/levels';
import { DEFAULT_HALF_WIDTH, LIQUID_LOOKS, makePath } from '../tools/path';
import { makePin, withPinSettings } from '../tools/pin';
import { makeRegion } from '../tools/region';
import { DEFAULT_FLOOR, makeRoom, withRoomDoor, withRoomLit } from '../tools/room';
import { DEFAULT_SHAPE_STYLE, makeShape, type ShapeFeature, type ShapeStyle } from '../tools/shape';
import { storedSpawn } from '../tools/spawn';
import type { StampPlacement } from '../tools/stamp';
import { DEFAULT_BRUSH_RADIUS, makeStroke } from '../tools/stroke';
import { DEFAULT_TRAVEL } from '../tools/submap';
import type { SwitchTarget } from '../tools/switch-targets';
import { type Costed, storedCost } from '../tools/terrain-cost';
import { DEFAULT_WALL_PRESET } from '../tools/wall-presets';
import { makeZone, scaledZoneShape, withZoneSettings } from '../tools/zone';
import type { CartographyController } from './controller';

export interface RealizeOptions {
    /** Scene point the spec's (0, 0) lands on. */
    readonly origin: Point;
    /** Scene px per grid square, for specs in grid units. */
    readonly gridSize: number;
}

/** What could not be built; `splat` is indexed in the spec's splats, the rest in its features. */
type RealizeProblem = 'level' | 'stamp' | 'interior' | 'switch' | 'splat';

export interface RealizeReport {
    /** Ids of the features built, in spec order. */
    readonly features: readonly string[];
    /** Spec level key → the scene level created for it. */
    readonly levels: Readonly<Record<string, string>>;
    /** Spec features that could not be built in full, by index. */
    readonly problems: readonly { readonly index: number; readonly problem: RealizeProblem }[];
}

/** A spec's coordinate and length transforms into scene px. */
interface Scale {
    readonly point: (p: Point) => Point;
    readonly length: (v: number) => number;
    /** Scene px per grid square, whatever the spec's units: a zone's grid spaces are the scene's own. */
    readonly gridSize: number;
}

function scaleOf(spec: SceneSpec, options: RealizeOptions): Scale {
    const unit = spec.units === 'grid' ? options.gridSize : 1;
    return {
        point: (p) => ({ x: options.origin.x + p.x * unit, y: options.origin.y + p.y * unit }),
        length: (v) => v * unit,
        gridSize: options.gridSize,
    };
}

/** The zone a spec describes, on `level`, a way to another map where it has a link; null where Foundry would refuse its shape. */
function buildZone(spec: Extract<FeatureSpec, { type: 'zone' }>, id: string, level: string | null, scale: Scale): Feature | null {
    const zone = withZoneSettings(makeZone(id, scale.point(spec)), {
        name: spec.name,
        shape: spec.shape.kind === 'cells' ? { ...spec.shape, size: scale.gridSize } : scaledZoneShape(spec.shape, scale.length(1)),
        rotation: spec.rotation,
        gridBased: spec.gridBased,
        attachedTo: spec.attachedTo,
    });
    const link = spec.link && { region: spec.link.region, targets: spec.link.targets, travel: { ...DEFAULT_TRAVEL, placement: spec.link.placement } };
    return zone && { ...zone, ...areaOf(spec), level, ...(link ? { link } : {}) };
}

/** The plain (non-stamp) feature a spec describes, on `level`, or null if it is malformed. */
function buildFeature(spec: Exclude<FeatureSpec, { type: 'stamp' }>, id: string, level: string | null, scale: Scale): Feature | null {
    if (spec.type === 'label') {
        const { text, fontSize, colour, fontFamily, rotation, hidden } = spec;
        return { ...makeLabel(id, scale.point(spec), { text, fontSize, colour: colour.toLowerCase(), fontFamily, rotation, hidden }), level };
    }
    if (spec.type === 'pin') {
        // A page with no entry is dropped, as the panel drops it.
        const { text, entry, page, icon, readable, hidden } = spec;
        const settings = { text, entry, page, icon, global: spec.global, readable, size: spec.size === null ? null : scale.length(spec.size), hidden };
        return { ...withPinSettings(makePin(id, scale.point(spec)), settings), level };
    }
    if (spec.type === 'shape') {
        const shape = buildShape(spec, id, scale);
        return shape && { ...shape, level };
    }
    if (spec.type === 'zone') {
        return buildZone(spec, id, level, scale);
    }
    if (spec.type === 'region' || spec.type === 'stroke') {
        const ground = buildGround(spec, id, scale);
        return ground && { ...ground, level };
    }
    const points = spec.points.map(scale.point);
    let feature: Feature | null;
    if (spec.type === 'path') {
        const base = LIQUID_LOOKS[spec.liquid ?? 'water'];
        const river = {
            ...base,
            shade: (spec.shade === undefined ? null : parseCssHex(spec.shade)) ?? base.shade,
            bed: spec.bed === undefined ? base.bed : spec.bed,
        };
        const walls = spec.walls === true ? DEFAULT_WALL_PRESET : spec.walls === false ? null : spec.walls;
        const width = spec.halfWidth === undefined ? DEFAULT_HALF_WIDTH : scale.length(spec.halfWidth);
        const widths = spec.halfWidths?.map((w) => scale.length(w)) ?? width;
        feature = makePath(id, spec.kind, points, widths, walls, river, spec.texture ?? null);
    } else {
        const room = makeRoom(id, spec.floor ?? DEFAULT_FLOOR, points, spec.wall, spec.wallKind, spec.ceiling);
        const doored =
            room && spec.doors.reduce((r, d) => withRoomDoor(r, d.segment, { type: d.type, state: d.state, sound: d.sound, animation: d.animation }), room);
        // Windows and daylight on segments the outline has.
        const onOutline = (segment: number): boolean => segment < points.length;
        feature = doored && {
            ...withRoomLit(doored, spec.lit),
            windows: spec.windows.filter(onOutline),
            daylight: spec.daylight.filter(onOutline),
            ...areaOf(spec),
        };
    }
    return feature && { ...feature, level };
}

/** Painted ground a spec describes: an area or a brush stroke of a biome, in its own texture or the biome's. */
function buildGround(spec: Extract<FeatureSpec, { type: 'region' | 'stroke' }>, id: string, scale: Scale): Feature | null {
    const points = spec.points.map(scale.point);
    const texture = spec.texture ?? null;
    if (spec.type === 'region') {
        const region = makeRegion(id, spec.biome, points, texture, spec.sharp);
        return region && { ...region, ...areaOf(spec) };
    }
    const radius = spec.radius === undefined ? DEFAULT_BRUSH_RADIUS : scale.length(spec.radius);
    const stroke = makeStroke(id, spec.biome, points, radius, texture);
    return stroke && { ...stroke, ...areaOf(spec) };
}

/** A spec's drawn shape: a box at its centre, sized in the spec's units, or its vertices; its stroke in px as given. */
function buildShape(spec: Extract<FeatureSpec, { type: 'shape' }>, id: string, scale: Scale): ShapeFeature | null {
    const style: ShapeStyle = {
        strokeColour: spec.stroke.colour.toLowerCase(),
        strokeWidth: spec.stroke.width,
        strokeAlpha: spec.stroke.alpha,
        fillColour: spec.fill?.colour.toLowerCase() ?? null,
        fillAlpha: spec.fill?.alpha ?? DEFAULT_SHAPE_STYLE.fillAlpha,
        hidden: spec.hidden,
    };
    if (spec.kind === 'polygon' || spec.kind === 'line') {
        return makeShape(id, { kind: spec.kind }, (spec.points ?? []).map(scale.point), style);
    }
    const geometry = { kind: spec.kind, width: scale.length(spec.width ?? 0), height: scale.length(spec.height ?? 0), rotation: spec.rotation };
    return makeShape(id, geometry, [scale.point({ x: spec.x ?? 0, y: spec.y ?? 0 })], style);
}

/** A spec area's own fields. */
type AreaSpec = Extract<FeatureSpec, { type: 'region' | 'stroke' | 'room' | 'zone' }>;

/** What a spec area costs to cross, the effects on it, its region's display and what it spawns, as a feature stores them. */
function areaOf(spec: AreaSpec): Costed & Affected {
    const effects = spec.effects.map(({ disabled, ...effect }): AreaEffect => withDisabled(effect, disabled));
    return {
        movementCost: storedCost(spec.movementCost),
        effects: storedEffects(effects),
        display: storedDisplay(spec.display),
        spawn: storedSpawn(spec.spawn),
    };
}

function placement(spec: Extract<FeatureSpec, { type: 'stamp' }>, scale: Scale): StampPlacement {
    const centre = scale.point(spec);
    return {
        stamp: spec.stamp,
        x: centre.x,
        y: centre.y,
        ...(spec.variant === undefined ? {} : { variant: spec.variant }),
        ...(spec.rotation === undefined ? {} : { rotation: spec.rotation }),
        ...(spec.scale === undefined ? {} : { scale: spec.scale }),
        ...(spec.reads === undefined ? {} : { reads: spec.reads }),
        ...(spec.readsHidden === true ? { readsHidden: true } : {}),
        ...(spec.mirror === true ? { mirror: true } : {}),
        ...(spec.inert === true ? { inert: true } : {}),
        ...(spec.reach === undefined ? {} : { reach: spec.reach }),
    };
}

/** How Foundry draws a spec level; the levels it sees are named by key (a level that could not be created is left out). */
function levelArt(l: SceneSpec['levels'][number], ids: Readonly<Record<string, string>>): LevelArt {
    return {
        background: l.background ?? null,
        foreground: l.foreground ?? null,
        fog: l.fog ?? null,
        backgroundColor: l.backgroundColor,
        tints: l.tints,
        alphaThresholds: l.alphaThresholds,
        placement: l.placement,
        visibleLevels: l.visibleLevels.flatMap((key) => ids[key] ?? []),
    };
}

/**
 * Link switch stamp `switchId` to what its spec entry controls: the features
 * it names by key and the AmbientLights it names by id, each once. True when
 * all of it was linked; false when it is not a switch, a target was not built,
 * or a feature target is not a lamp or a room.
 */
async function linkSwitch(
    controller: CartographyController,
    switchId: string,
    f: Extract<FeatureSpec, { type: 'stamp' }>,
    keyed: Readonly<Record<string, string>>,
): Promise<boolean> {
    const features = [...new Set(f.controls)].map((key) => keyed[key]);
    if (features.includes(undefined)) {
        return false;
    }
    const targets: SwitchTarget[] = [
        ...features.flatMap((id): SwitchTarget[] => (id === undefined ? [] : [{ kind: 'feature', id }])),
        ...[...new Set(f.lights)].map((id): SwitchTarget => ({ kind: 'light', id })),
    ];
    return targets.reduce<Promise<boolean>>(
        async (previous, target) => (await previous) && controller.toggleSwitchTarget(switchId, target),
        Promise.resolve(true),
    );
}

export async function realizeSpec(controller: CartographyController, spec: SceneSpec, options: RealizeOptions): Promise<RealizeReport> {
    const scale = scaleOf(spec, options);
    const levels: Record<string, string> = {};
    const features: string[] = [];
    /** Spec feature key → the feature built for it. */
    const keyed: Record<string, string> = {};
    /** Spec feature index → the feature built for it. */
    const builtAt: Record<number, string> = {};
    const problems: { index: number; problem: RealizeProblem }[] = [];
    const editing = controller.activeLevel;

    if (spec.scene) {
        await controller.setSceneSettings(spec.scene);
    }
    await controller.batch(async () => {
        // A level may take the scene's own lowest floor rather than stacking a new one: those listed after it stack above,
        // those before it go below it, nearest first, so the scene's floor stays where it was.
        const own = spec.levels.findIndex((l) => l.existing);
        const lowest = own >= 0 ? controller.levels[0] : undefined;
        const order = own > 0 ? [...spec.levels.slice(own), ...spec.levels.slice(0, own).reverse()] : spec.levels;
        await order.reduce(async (previous, l) => {
            await previous;
            const below = own > 0 && spec.levels.indexOf(l) < own;
            if (lowest && l.existing) {
                await controller.renameLevel(lowest.id, l.name);
            }
            const id = lowest && l.existing ? lowest.id : await controller.addLevel(below ? 'below' : 'above', l.name);
            if (id !== null) {
                levels[l.key] = id;
                if (l.bottom !== undefined && l.top !== undefined) {
                    await controller.setLevelBand(id, l.bottom, l.top);
                }
            }
        }, Promise.resolve());
        // Once every level exists, so each can name the others it sees.
        await spec.levels.reduce(async (previous, l) => {
            await previous;
            const id = levels[l.key];
            if (id !== undefined) {
                await controller.setLevelArt(id, levelArt(l, levels));
            }
        }, Promise.resolve());
        // Each level's masks stack bottom to top in the order the spec lists them.
        const stacks = new Map<string, { index: number; image: string; roles: SceneSpec['splats'][number]['roles'] }[]>();
        spec.splats.forEach((splat, index) => {
            const key = splat.level ?? '';
            stacks.set(key, [...(stacks.get(key) ?? []), { index, image: splat.mask, roles: splat.roles }]);
        });
        await [...stacks].reduce(async (previous, [key, masks]) => {
            await previous;
            const level = key === '' ? null : levels[key] ?? null;
            const taken = await controller.adoptSplats(level, masks);
            masks.forEach((mask, i) => {
                if (taken[i] !== true) {
                    problems.push({ index: mask.index, problem: 'splat' });
                }
            });
        }, Promise.resolve());

        await spec.features.reduce(async (previous, f, index) => {
            await previous;
            const level = f.level === undefined ? null : levels[f.level] ?? null;
            if (f.level !== undefined && level === null) {
                problems.push({ index, problem: 'level' });
                return;
            }
            // New features land on the level being edited, so edit the one this feature names.
            controller.setActiveLevel(level);
            const built = (featureId: string): void => {
                features.push(featureId);
                builtAt[index] = featureId;
                if (f.key !== undefined) {
                    keyed[f.key] = featureId;
                }
            };
            if (f.type !== 'stamp') {
                const feature = buildFeature(f, controller.newFeatureId(), level, scale);
                if (feature) {
                    await controller.add(feature);
                    built(feature.id);
                }
                return;
            }
            const id = await controller.placeStamp(placement(f, scale));
            if (id === null) {
                problems.push({ index, problem: 'stamp' });
                return;
            }
            built(id);
            if (f.interior) {
                const linked =
                    'create' in f.interior
                        ? (await controller.createInterior(id, f.interior.create)) !== null
                        : await controller.linkSubmap(id, f.interior.scene);
                if (!linked) {
                    problems.push({ index, problem: 'interior' });
                }
            }
            if (f.floors && !(await controller.addBuildingFloors(id, f.floors))) {
                problems.push({ index, problem: 'interior' });
            }
        }, Promise.resolve());

        // Once everything is built, so a switch can control what comes after it.
        await spec.features.reduce(async (previous, f, index) => {
            await previous;
            const switchId = builtAt[index];
            const controls = f.type === 'stamp' && (f.controls.length > 0 || f.lights.length > 0);
            if (controls && switchId !== undefined && !(await linkSwitch(controller, switchId, f, keyed))) {
                problems.push({ index, problem: 'switch' });
            }
        }, Promise.resolve());
    });

    controller.setActiveLevel(editing);
    return { features, levels, problems };
}
