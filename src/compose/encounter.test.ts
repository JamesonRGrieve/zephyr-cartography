// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../generate/random';
import { parseSceneSpec } from '../generate/spec';
import { decodePng } from '../tools/png';
import { composeMap } from './compose';
import {
    DEFAULT_ENCOUNTER,
    type ENCOUNTER_BRIDGES,
    type ENCOUNTER_ROADS,
    ENCOUNTER_DENSITIES,
    ENCOUNTER_FEATURES,
    ENCOUNTER_LANDSCAPES,
    ENCOUNTER_SETTINGS,
    ENCOUNTER_SIZES,
    type EncounterChoice,
    encounterIntent,
    freshSeed,
    intoPass,
    isEncounterBridge,
    isEncounterDensity,
    isEncounterFeature,
    isEncounterLandscape,
    isEncounterRoad,
    isEncounterSetting,
    isEncounterSize,
} from './encounter';
import { GROUND_PX } from './encounter-ground';
import { type MapIntent, parseMapIntent } from './intent';
import { TEST_ROLES } from './test-roles';

const choice = (over: Partial<EncounterChoice> = {}): EncounterChoice => ({ ...DEFAULT_ENCOUNTER, seed: 7, ...over });

/** The encounter's intent, parsed, or a failure naming its issues. */
function parsed(over: Partial<EncounterChoice> = {}): MapIntent {
    const result = parseMapIntent(encounterIntent(choice(over)));
    if (!result.ok) {
        throw new Error(JSON.stringify(result.issues));
    }
    return result.intent;
}

describe('encounter ground', () => {
    it("lays a marsh road as a muddy track and every other open country as worn earth, never the set's grey gravel", () => {
        const textureOf = (landscape: EncounterChoice['landscape']): string | null | undefined =>
            parsed({ landscape, road: 'road' }).paths.find((p) => p.kind === 'road')?.texture;
        expect(textureOf('marsh')).toBe('floor.mud');
        expect(textureOf('plains')).toBe('floor.packed-dirt');
        expect(textureOf('desert')).toBe('floor.packed-dirt');
        expect(textureOf('tundra')).toBe('floor.packed-dirt');
        expect(textureOf('wasteland')).toBe('floor.packed-dirt');
        // Never the ground's own texture, whose road shows only as seams at its edges.
        for (const landscape of ENCOUNTER_LANDSCAPES.filter((l) => l !== 'cave')) {
            const intent = parsed({ landscape, road: 'road' });
            const ground = [intent.groundTexture, intent.splats[0]?.roles[0]];
            expect(ground).not.toContain(intent.paths.find((p) => p.kind === 'road')?.texture);
        }
    });

    it('cuts a cave over the whole map, a chamber to each cell of its grid, each dressed inside its own floor', () => {
        const intent = parsed({ landscape: 'cave', size: 'large' });
        const [network] = intent.hewn;
        const chambers = network?.chambers ?? [];
        expect(chambers.length).toBeGreaterThanOrEqual(4);
        // Chambers reach every quarter of the map, never bunched in one corner.
        const left = chambers.some((c) => c.centre.x < intent.width / 2);
        const right = chambers.some((c) => c.centre.x > intent.width / 2);
        expect(left && right).toBe(true);
        expect(intent.fixtures.length).toBeGreaterThanOrEqual(chambers.length);
        // Dressed by theme, never alike: at least three of a pool, fungus, bones, a cave-in, crystals or roots.
        const themed = ['cave pool', 'mushrooms', 'old bones', 'bone cairn', 'cave-in rubble', 'crystals', 'roots through the rock'];
        expect(new Set(intent.fixtures.map((f) => f.name).filter((n) => themed.includes(n))).size).toBeGreaterThanOrEqual(3);
        // Every chamber's floor broken by rubble, puddles and stains, more than a token piece or two each (three on
        // average since 2026-11-13: the smaller chambers of a denser web hold as much dressing over the whole cave).
        expect(intent.fixtures.length).toBeGreaterThanOrEqual(chambers.length * 3);
        // No two pieces of dressing heaped on one another.
        const apart = intent.fixtures.every((a, i) => intent.fixtures.slice(i + 1).every((b) => Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y) > 0.6));
        expect(apart).toBe(true);
        // Every piece of dressing stands within the middle half of some chamber.
        for (const piece of intent.fixtures) {
            const inChamber = chambers.some(
                (c) => Math.abs(piece.at.x - c.centre.x) <= c.width / 4 + 0.05 && Math.abs(piece.at.y - c.centre.y) <= c.height / 4 + 0.05,
            );
            expect(inChamber).toBe(true);
        }
    });

    it('breaks a marsh with soft wallows of open mud', () => {
        const mud = parsed({ landscape: 'marsh' }).zones.filter((z) => z.kind === 'paving' && z.texture === 'floor.mud');
        expect(mud.length).toBeGreaterThanOrEqual(2);
        expect(mud.every((z) => z.soft)).toBe(true);
    });

    it("lays a desert in rippled sand in any world, and the warp's woods and plains on scarred earth", () => {
        expect(parsed({ landscape: 'desert', setting: 'scifi' }).groundTexture).toBe('floor.rippled-sand');
        expect(parsed({ landscape: 'forest', setting: 'warp' }).groundTexture).toBe('floor.warp-scarred-earth');
        expect(parsed({ landscape: 'forest', setting: 'feudal' }).groundTexture ?? null).toBeNull();
        expect(parsed({ landscape: 'marsh', setting: 'warp' }).groundTexture ?? null).toBeNull();
    });

    it('slides a pool between cliffs into the pass, shrinking it where the pass is narrow', () => {
        const pool = { kind: 'lake', area: { shape: 'circle', centre: { x: 9, y: 20 }, radius: 3 } };
        expect(intoPass(pool, 5, 24)).toEqual({ kind: 'lake', area: { shape: 'circle', centre: { x: 9, y: 15 }, radius: 3 } });
        expect(intoPass(pool, 9, 24)).toEqual({ kind: 'lake', area: { shape: 'circle', centre: { x: 9, y: 12 }, radius: 2 } });
        const strip = { kind: 'marsh', area: { shape: 'everywhere' } };
        expect(intoPass(strip, 5, 24)).toBe(strip);
    });

    it('keeps a pool between cliffs to one side of a road along the pass, shrinking it to fit there', () => {
        const pool = { kind: 'lake', area: { shape: 'circle', centre: { x: 9, y: 9 }, radius: 3 } };
        // The road along the north face's foot (its band 5.25 to 10.75): the pool goes below it, whole.
        expect(intoPass(pool, 5, 24, { y0: 5.25, y1: 10.75 })).toEqual({ kind: 'lake', area: { shape: 'circle', centre: { x: 9, y: 13.75 }, radius: 3 } });
        // Along the south face's foot (13.25 to 18.75): the pool keeps above it, where it already lies.
        expect(intoPass(pool, 5, 24, { y0: 13.25, y1: 18.75 })).toEqual(pool);
        // A band leaving less than a pool's room either side: it shrinks to its least, on the side with more.
        expect(intoPass(pool, 9, 24, { y0: 10.5, y1: 13.5 })).toMatchObject({ area: { radius: 1 } });
    });
});

describe('encounter maps', () => {
    it('compose every landscape in every setting, every feature ticked, into a valid scene spec', () => {
        const outcomes = ENCOUNTER_LANDSCAPES.flatMap((landscape) =>
            ENCOUNTER_SETTINGS.map((setting) => {
                const intent = parsed({ landscape, setting, road: 'crossroads', features: [...ENCOUNTER_FEATURES] });
                return { landscape, setting, valid: parseSceneSpec(composeMap(intent, TEST_ROLES).spec).ok };
            }),
        );
        expect(outcomes).toEqual(ENCOUNTER_LANDSCAPES.flatMap((landscape) => ENCOUNTER_SETTINGS.map((setting) => ({ landscape, setting, valid: true }))));
    });

    it('lays only what is ticked: no road, a road, or a crossroads; a river and a lake it runs out of', () => {
        const roads = (road: (typeof ENCOUNTER_ROADS)[number]): number => parsed({ road, features: [] }).paths.filter((p) => p.kind === 'road').length;
        expect([roads('none'), roads('road'), roads('crossroads')]).toEqual([0, 1, 2]);
        expect(parsed({ features: [] }).paths.some((p) => p.kind === 'river')).toBe(false);
        const withLake = parsed({ features: ['river', 'lake'] });
        expect(withLake.zones.some((z) => z.kind === 'lake' && z.key === 'lake')).toBe(true);
        expect(withLake.paths.find((p) => p.kind === 'river')?.from).toEqual({ zone: 'lake' });
        const all = parsed({ features: ['ruins', 'camp', 'wreck', 'cliffs'] });
        expect(all.fixtures.some((f) => f.name === 'camp tent')).toBe(true);
        // A frontier world's open field camp: its tents and stores, no ring.
        const frontier = parsed({ features: ['camp'], setting: 'scifi' }).fixtures.map((f) => f.name);
        expect(['large field tent', 'field tent', 'field supply crates'].every((n) => frontier.includes(n))).toBe(true);
        // The Imperium's camp is its command tent and container inside a ring of checkpoint barriers.
        const imperial = parsed({ features: ['camp'], setting: 'grimdark' }).fixtures.map((f) => f.name);
        expect(['command tent', 'cargo container', 'checkpoint barrier'].every((n) => imperial.includes(n))).toBe(true);
        expect(all.zones.filter((z) => z.kind === 'rocky' && z.area.shape === 'edge')).toHaveLength(2);
        // Each height ends in a cliff face along its edge, the face looking into the pass.
        const faces = all.fixtures.filter((f) => f.name === 'cliff face run');
        expect(new Set(faces.map((f) => f.facing))).toEqual(new Set(['bottom', 'top']));
        // Each face jogs in and out along its height, never one straight bar the map's width (2026-11-13 review).
        const north = faces.filter((f) => f.facing === 'bottom');
        expect(north.length).toBeGreaterThan(2);
        expect(new Set(north.map((f) => f.at.y)).size).toBeGreaterThan(1);
        // And stays closed: each segment meets the next.
        const sorted = [...north].sort((a, b) => a.at.x - b.at.x);
        sorted.slice(1).forEach((f, i) => {
            const prev = sorted[i];
            expect(f.at.x - f.width / 2).toBeLessThanOrEqual((prev?.at.x ?? 0) + (prev?.width ?? 0) / 2 + 0.11);
        });
        expect(parsed({ features: [] }).fixtures).toEqual([]);
    });

    it("paints rocky ground in the world's earth: sandstone in a desert, churned earth in the Imperium's, scarred in the warp's, else rough earth", () => {
        // The blend's third channel is the earth or rock its stones, ruins and camps stand on; rocky zones lay no patch.
        const rockOf = (over: Partial<EncounterChoice>): string | null | undefined => parsed({ features: [], ...over }).splats[0]?.roles[2];
        expect(rockOf({ landscape: 'desert', setting: 'feudal' })).toBe('floor.rock-sandstone');
        expect(rockOf({ landscape: 'hills', setting: 'grimdark' })).toBe('floor.shell-churned-earth');
        // A tundra's in frozen churned earth in any world: a world's own earth lay on the snow as brown smudges.
        expect(rockOf({ landscape: 'tundra', setting: 'warp' })).toBe('floor.frozen-churned-earth-large');
        expect(rockOf({ landscape: 'tundra', setting: 'grimdark' })).toBe('floor.frozen-churned-earth-large');
        // A wasteland in one brown family: rough earth, scorched patches, its own ground and heights the same earth.
        const waste = parsed({ landscape: 'wasteland', setting: 'grimdark', features: [] });
        expect(waste.splats[0]?.roles.slice(0, 2)).toEqual(['floor.rough-packed-earth-2', 'floor.scorched-earth-2']);
        expect(waste.groundTexture).toBe('floor.rough-packed-earth-2');
        expect(rockOf({ landscape: 'hills', setting: 'feudal' })).toBe('floor.rough-packed-earth-2');
        expect(rockOf({ landscape: 'hills', setting: 'scifi' })).toBe('floor.rough-packed-earth-2');
        expect(
            parsed({ landscape: 'hills', features: [] })
                .zones.filter((z) => z.kind === 'rocky')
                .map((z) => z.texture),
        ).not.toContain('floor.rough-packed-earth-2');
    });

    it('paints the open ground as one blend: its own ground, patches of another, earth under its rocks', async () => {
        const intent = parsed({ landscape: 'hills', setting: 'feudal', features: [] });
        expect(intent.splats).toHaveLength(1);
        const [splat] = intent.splats;
        expect(splat?.roles).toEqual(['floor.olive-meadow', 'floor.dead-grass', 'floor.rough-packed-earth-2', null]);
        const prefix = 'data:image/png;base64,';
        expect(splat?.mask.startsWith(prefix)).toBe(true);
        const bytes = Uint8Array.from(Buffer.from((splat?.mask ?? '').slice(prefix.length), 'base64'));
        const mask = await decodePng(bytes);
        expect([mask?.width, mask?.height]).toEqual([intent.width * GROUND_PX, intent.height * GROUND_PX]);
        // Every pixel's weights sum to a whole: no backdrop shows through.
        const pixels = mask?.pixels ?? new Uint8ClampedArray(0);
        const sums = new Set<number>();
        for (let i = 0; i < pixels.length; i += 4) {
            sums.add((pixels[i] ?? 0) + (pixels[i + 1] ?? 0) + (pixels[i + 2] ?? 0));
        }
        expect([...sums]).toEqual([255]);
        // At the middle of a rock field the ground is worn well toward earth (never wholly bare).
        const rocky = intent.zones.find((z) => z.kind === 'rocky');
        const centre = rocky?.area.shape === 'circle' ? rocky.area.centre : { x: 0, y: 0 };
        const at = (Math.floor(centre.y * GROUND_PX) * (mask?.width ?? 0) + Math.floor(centre.x * GROUND_PX)) * 4;
        expect(pixels[at + 2] ?? 0).toBeGreaterThan(80);
        // The same checklist paints the same ground.
        expect(parsed({ landscape: 'hills', setting: 'feudal', features: [] }).splats).toEqual(intent.splats);
    });

    it('leaves the cliffs a pass where a road runs down the map through them, and keeps a road round a lake inside the pass', () => {
        const cut = parsed({ features: ['cliffs'], road: 'crossroads' });
        const down = cut.paths.find((p) => p.kind === 'road' && typeof p.from === 'object' && 'y' in p.from && p.from.y > cut.height);
        const x = down && typeof down.from === 'object' && 'x' in down.from ? down.from.x : null;
        expect(x).not.toBeNull();
        const faces = cut.fixtures.filter((f) => f.name === 'cliff face run');
        // Runs either side of the pass on each height, none spanning the road's line.
        expect(faces.every((f) => Math.abs(f.at.x - (x ?? 0)) > f.width / 2)).toBe(true);
        // Round a lake, the road across the map passes inside the pass, never over a height.
        const lake = parsed({ features: ['cliffs', 'lake'], road: 'road' });
        const across = lake.paths.find((p) => p.kind === 'road');
        const depth = Math.round(lake.height * 0.2);
        for (const via of across?.via ?? []) {
            expect(via.y).toBeGreaterThan(depth);
            expect(via.y).toBeLessThan(lake.height - depth);
        }
    });

    it('runs a road along a pass between cliffs, clear of both faces and of its pools', () => {
        for (let seed = 1; seed <= 30; seed++) {
            const intent = parsed({ seed, landscape: 'marsh', features: ['cliffs'], road: 'road' });
            const depth = Math.round(intent.height * 0.2);
            const across = intent.paths.find((p) => p.kind === 'road');
            const from = across && typeof across.from === 'object' && 'y' in across.from ? across.from : null;
            const to = across && typeof across.to === 'object' && 'y' in across.to ? across.to : null;
            const y = from?.y ?? Number.NaN;
            // Pinned along one face's foot, its bends kept low.
            expect(to?.y).toBe(y);
            expect(across?.meander).toBe(0.2);
            expect(y).toBeGreaterThanOrEqual(depth + 2);
            expect(y).toBeLessThanOrEqual(intent.height - depth - 2);
            // Every pool lies off the road's band and between the faces' feet.
            for (const zone of intent.zones) {
                if (zone.kind !== 'lake' || zone.area.shape !== 'circle') {
                    continue;
                }
                const { centre, radius } = zone.area;
                expect(centre.y + radius <= y - 2.75 + 1e-9 || centre.y - radius >= y + 2.75 - 1e-9).toBe(true);
                expect(centre.y - radius).toBeGreaterThanOrEqual(depth + 1 - 1e-9);
                expect(centre.y + radius).toBeLessThanOrEqual(intent.height - depth - 1 + 1e-9);
            }
        }
    });

    it('lays the warp in a warp cave, and none in any other', () => {
        const WARP = ['hell rift', 'thorn growth', 'chaos bone pile'];
        const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
        expect(seeds.every((seed) => parsed({ seed, landscape: 'cave', setting: 'warp' }).fixtures.some((f) => WARP.includes(f.name)))).toBe(true);
        expect(seeds.some((seed) => parsed({ seed, landscape: 'cave', setting: 'feudal' }).fixtures.some((f) => WARP.includes(f.name)))).toBe(false);
    });

    it('gathers an open landscape into clusters of features, none in a forest or a cave, each clear of the ways', () => {
        const FEATURE_NAMES: Readonly<Record<string, readonly string[]>> = {
            plains: ['outcrop boulder', 'outcrop scree', 'outcrop bush', 'thicket bush'],
            tundra: ['frozen boulder', 'frost scree'],
            wasteland: ['broken rock', 'broken scree', 'bone cairn'],
        };
        for (const [landscape, names] of Object.entries(FEATURE_NAMES)) {
            const pieces = parsed({ landscape: landscape as EncounterChoice['landscape'], seed: 4 }).fixtures.filter((f) => names.includes(f.name));
            // At least three clusters' worth, every piece moved off roads, water and camp by the composer.
            expect(pieces.length).toBeGreaterThanOrEqual(6);
            expect(pieces.every((f) => f.clear && f.fixed)).toBe(true);
            // No two pieces stacked on one spot, none off the map.
            const spots = new Set(pieces.map((f) => `${String(f.at.x)},${String(f.at.y)}`));
            expect(spots.size).toBe(pieces.length);
            const intent = parsed({ landscape: landscape as EncounterChoice['landscape'], seed: 4 });
            expect(pieces.every((f) => f.at.x >= f.width / 2 && f.at.x <= intent.width - f.width / 2)).toBe(true);
        }
        // A ruin keeps walls standing among its rubble: a shell and two broken corners, all on the map, and the
        // landscape's own features keep their distance from it.
        const ruined = parsed({ landscape: 'plains', features: ['ruins'], seed: 4 });
        const shells = ruined.fixtures.filter((f) => f.name.startsWith('ruined'));
        const corners = ruined.fixtures.filter((f) => f.name === 'broken wall corner');
        expect(shells).toHaveLength(1);
        expect(corners).toHaveLength(2);
        expect(corners.every((f) => f.at.x >= 1 && f.at.y >= 1 && f.at.x <= ruined.width - 1 && f.at.y <= ruined.height - 1)).toBe(true);
        const site = shells[0]?.at ?? { x: 0, y: 0 };
        const outcrop = ruined.fixtures.filter((f) => f.name.startsWith('outcrop') || f.name.startsWith('thicket'));
        expect(outcrop.every((f) => Math.hypot(f.at.x - site.x, f.at.y - site.y) >= 8)).toBe(true);
        // Burnt-out trees stand on a grimdark tundra, never a feudal one: the burnt woodland's art has no feudal setting.
        const DEAD = ['dead tree', 'dead stump', 'fallen dead trunk'];
        expect(parsed({ landscape: 'tundra', setting: 'grimdark', seed: 4 }).fixtures.some((f) => DEAD.includes(f.name))).toBe(true);
        expect(parsed({ landscape: 'tundra', setting: 'feudal', seed: 4 }).fixtures.some((f) => DEAD.includes(f.name))).toBe(false);
        // A feudal tundra stands snow-laden pines instead.
        expect(parsed({ landscape: 'tundra', setting: 'feudal', seed: 4 }).fixtures.some((f) => f.name === 'snow-laden pine')).toBe(true);
        // The battlefield's leavings are drawn only where the setting's packs have them: grimdark, not feudal.
        const LEAVINGS = ['blast crater', 'scattered wreckage', 'spent casings'];
        expect(parsed({ landscape: 'wasteland', setting: 'grimdark', seed: 4 }).fixtures.some((f) => LEAVINGS.includes(f.name))).toBe(true);
        expect(parsed({ landscape: 'wasteland', setting: 'feudal', seed: 4 }).fixtures.some((f) => LEAVINGS.includes(f.name))).toBe(false);
        const all = Object.values(FEATURE_NAMES).flat();
        for (const landscape of ['forest', 'cave'] as const) {
            expect(parsed({ landscape, seed: 4 }).fixtures.some((f) => all.includes(f.name))).toBe(false);
        }
    });

    it('lays no woodland on a tundra and no rubble on a wasteland (their habitats strewed ferns and drain grates)', () => {
        for (const seed of [1, 2, 3, 4, 5]) {
            expect(parsed({ landscape: 'tundra', seed }).zones.some((z) => z.kind === 'woodland')).toBe(false);
            expect(parsed({ landscape: 'wasteland', seed }).zones.some((z) => z.kind === 'rubble')).toBe(false);
        }
    });

    it("raises the cliffs' heights in the landscape's own ground, a marsh's in olive meadow, never bare rock", () => {
        const heights = (over: Partial<EncounterChoice>): (string | null)[] => {
            const zones = parsed({ features: ['cliffs'], ...over }).zones;
            // The heights are the last two zones, the strips along the long sides.
            return zones.slice(-2).map((z) => z.texture);
        };
        expect(heights({ landscape: 'marsh', setting: 'feudal' })).toEqual(['floor.olive-meadow', 'floor.olive-meadow']);
        expect(heights({ landscape: 'desert', setting: 'feudal' })).toEqual(['floor.rippled-sand', 'floor.rippled-sand']);
        expect(heights({ landscape: 'hills', setting: 'warp' })).toEqual(['floor.warp-scarred-earth', 'floor.warp-scarred-earth']);
        expect(heights({ landscape: 'tundra', setting: 'feudal' })).toEqual(['snow', 'snow']);
    });

    it('crosses the river by the bridge asked: a kind, any road bridge, or a ford', () => {
        const bridgeOf = (bridge: (typeof ENCOUNTER_BRIDGES)[number]): readonly string[] | false | undefined =>
            parsed({ bridge }).paths.find((p) => p.kind === 'road')?.bridge;
        expect(bridgeOf('stone')).toEqual(['stone']);
        expect(bridgeOf('rope')).toEqual(['rope']);
        expect(bridgeOf('ford')).toBe(false);
        expect(bridgeOf('any')).toBeUndefined();
        // The feudal world and the Imperium's (and the warp's, which shares its art) draw road bridges: a frontier world
        // fords the river.
        expect(parsed({ setting: 'scifi', bridge: 'any' }).paths.find((p) => p.kind === 'road')?.bridge).toBe(false);
        for (const setting of ['feudal', 'grimdark', 'warp'] as const) {
            expect(parsed({ setting, bridge: 'any' }).paths.find((p) => p.kind === 'road')?.bridge).toBeUndefined();
        }
    });

    it('runs the roads round a lake, on the far side of the map from it', () => {
        const intent = parsed({ road: 'crossroads', features: ['lake'] });
        const lake = intent.zones.find((z) => z.kind === 'lake' && z.key === 'lake');
        expect(lake?.area.shape).toBe('circle');
        if (lake?.area.shape !== 'circle') {
            return;
        }
        for (const road of intent.paths.filter((p) => p.kind === 'road')) {
            const [via] = road.via;
            expect(via).toBeDefined();
            expect(Math.hypot((via?.x ?? 0) - lake.area.centre.x, (via?.y ?? 0) - lake.area.centre.y)).toBeGreaterThan(lake.area.radius);
        }
    });

    it('keeps a crossroads road running down the map to one bank of a river running down it', () => {
        const xOf = (anchor: MapIntent['paths'][number]['from'] | undefined): number => (typeof anchor === 'object' && 'x' in anchor ? anchor.x : Number.NaN);
        for (let seed = 1; seed <= 20; seed += 1) {
            const intent = parsed({ seed, road: 'crossroads', features: ['river'] });
            const river = intent.paths.find((p) => p.kind === 'river');
            const pinned = intent.paths.filter((p) => p.kind === 'road').at(1);
            const width = intent.width;
            for (const end of [xOf(pinned?.from), xOf(pinned?.to)]) {
                expect(Math.abs(end - xOf(river?.from))).toBeGreaterThan(width / 6);
                expect(Math.abs(end - xOf(river?.to))).toBeGreaterThan(width / 6);
            }
        }
    });

    it('opens a clearing round each feature in a forest, and runs the road through the camp', () => {
        const forest = parsed({ landscape: 'forest', features: ['camp', 'ruins'], setting: 'scifi' });
        expect(forest.zones.filter((z) => z.kind === 'clearing')).toHaveLength(2);
        // The road runs through the camp's clearing, at its centre.
        const road = forest.paths.find((p) => p.kind === 'road');
        const centres = forest.zones.flatMap((z) => (z.kind === 'clearing' && z.area.shape === 'circle' ? [z.area.centre] : []));
        expect(centres).toContainEqual(road?.via[0]);
        expect(parsed({ landscape: 'plains', features: ['ruins'] }).zones.some((z) => z.kind === 'clearing')).toBe(false);
    });

    it("runs a crossroads' second road past a camp, never through it", () => {
        for (const seed of [1, 2, 3, 4]) {
            const intent = parsed({ landscape: 'desert', features: ['camp'], road: 'crossroads', seed });
            const ground = intent.zones.find((z) => z.kind === 'clearing' || z.kind === 'fortified');
            const centre = ground?.area.shape === 'circle' ? ground.area.centre : { x: 0, y: 0 };
            const down = intent.paths.find((p) => p.kind === 'road' && typeof p.from === 'string' && p.from === 'south');
            const via = down?.via[0];
            expect(via).toBeDefined();
            expect(Math.abs((via?.x ?? centre.x) - centre.x)).toBeGreaterThan(intent.width / 4);
        }
    });

    it('stands a feudal camp as tents round a fire inside a ring of stakes, open where the road runs through it', () => {
        const intent = parsed({ landscape: 'plains', features: ['camp'], setting: 'feudal', size: 'large' });
        const ground = intent.zones.find((z) => z.kind === 'clearing');
        expect(intent.zones.some((z) => z.kind === 'fortified')).toBe(false);
        const centre = ground?.area.shape === 'circle' ? ground.area.centre : { x: 0, y: 0 };
        expect(intent.paths.find((p) => p.kind === 'road')?.via[0]).toEqual(centre);
        const named = (piece: string): readonly { at?: { x: number; y: number } | null }[] => intent.fixtures.filter((f) => f.name === piece);
        expect([named('camp fire').length, named('camp tent').length, named('camp bedroll').length]).toEqual([1, 3, 2]);
        const stakes = named('camp stakes').map((f) => f.at ?? centre);
        expect(stakes.length).toBeGreaterThanOrEqual(6);
        // No stake across the road's way in or out, to the camp's west and east.
        expect(stakes.every((p) => Math.abs(p.y - centre.y) > 1.5)).toBe(true);
    });

    it('gives the same map for the same checklist and seed, another layout for another seed, sized and lit by its choices', () => {
        expect(encounterIntent(choice({ seed: 3 }))).toEqual(encounterIntent(choice({ seed: 3 })));
        expect(encounterIntent(choice({ seed: 3 }))).not.toEqual(encounterIntent(choice({ seed: 4 })));
        const areas = ENCOUNTER_SIZES.map((size) => {
            const intent = parsed({ size });
            return intent.width * intent.height;
        });
        expect(areas[0]).toBeLessThan(areas[1] ?? 0);
        expect(areas[1]).toBeLessThan(areas[2] ?? 0);
        const warp = parsed({ setting: 'warp' });
        expect(warp.settings).toContain('setting-grimdark-chaotic');
        expect(warp.lighting).toBe('night');
        expect(parsed({ landscape: 'desert' }).ground).toBe('sand');
        expect(parsed({ landscape: 'tundra' }).ground).toBe('snow');
    });

    it('strews stones thinly over the whole of a desert beneath its outcrops, never bare sand between four clusters', () => {
        const [all, ...outcrops] = parsed({ landscape: 'desert', features: [] }).zones;
        expect(all).toMatchObject({ kind: 'rocky', area: { shape: 'everywhere' }, density: 'sparse' });
        expect(outcrops.length).toBeGreaterThanOrEqual(3);
        expect(outcrops.every((zone) => zone.kind === 'rocky' && zone.area.shape === 'circle')).toBe(true);
    });

    it('cuts a cave as one network of chambers through rock, opening off the map, in the dark', () => {
        const intent = parsed({ landscape: 'cave' });
        const [network] = intent.hewn;
        expect(intent.ground).toBeNull();
        expect(intent.lighting).toBe('dim');
        // A web: a small map's six chambers or more, joined chamber to chamber and looped between rows (2026-11-13
        // review: four chambers in a line).
        expect(network?.chambers.length).toBeGreaterThanOrEqual(6);
        expect(network?.passages.length).toBeGreaterThan(network?.chambers.length ?? 0);
        expect(network?.passages.some((p) => p.points.some((pt) => pt.x < 0))).toBe(true);
        expect(network?.floor).toBe('floor.cave-floor-large-3');
    });

    it('dresses its ground as thickly as asked, and narrows every picker value', () => {
        for (const density of ENCOUNTER_DENSITIES) {
            expect(parsed({ density, landscape: 'plains' }).zones.some((z) => z.density === density)).toBe(true);
        }
        // A forest stands a step denser than its cover asks: its woodland is in groves, so at the cover's own density it
        // read as parkland.
        for (const [asked, laid] of [
            ['sparse', 'normal'],
            ['normal', 'dense'],
            ['dense', 'dense'],
        ] as const) {
            expect(parsed({ density: asked, landscape: 'forest' }).zones.find((z) => z.kind === 'woodland')?.density).toBe(laid);
        }
        expect(Number.isInteger(freshSeed(seededRandom(2)))).toBe(true);
        expect([isEncounterLandscape('forest'), isEncounterLandscape('volcano')]).toEqual([true, false]);
        expect([isEncounterRoad('crossroads'), isEncounterBridge('ford'), isEncounterFeature('lake')]).toEqual([true, true, true]);
        expect([isEncounterSetting('scifi'), isEncounterSize('huge'), isEncounterDensity('dense')]).toEqual([true, false, true]);
    });
});
