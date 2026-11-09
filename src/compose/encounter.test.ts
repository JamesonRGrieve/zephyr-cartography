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
        expect(textureOf('wasteland')).toBe('floor.rough-packed-earth-2');
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
        expect(all.zones.some((z) => z.kind === 'fortified')).toBe(true);
        expect(all.zones.filter((z) => z.kind === 'rocky' && z.area.shape === 'edge')).toHaveLength(2);
        // Each height ends in a cliff face along its edge, the face looking into the pass.
        expect(all.fixtures.filter((f) => f.name === 'cliff face run').map((f) => f.facing)).toEqual(['bottom', 'top']);
        expect(parsed({ features: [] }).fixtures).toEqual([]);
    });

    it("paints rocky ground in the world's earth: sandstone in a desert, churned earth in the Imperium's, scarred in the warp's, else rough earth", () => {
        // The blend's third channel is the earth or rock its stones, ruins and camps stand on; rocky zones lay no patch.
        const rockOf = (over: Partial<EncounterChoice>): string | null | undefined => parsed({ features: [], ...over }).splats[0]?.roles[2];
        expect(rockOf({ landscape: 'desert', setting: 'feudal' })).toBe('floor.rock-sandstone');
        expect(rockOf({ landscape: 'hills', setting: 'grimdark' })).toBe('floor.shell-churned-earth');
        expect(rockOf({ landscape: 'tundra', setting: 'warp' })).toBe('floor.warp-scarred-earth');
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
        // Only the feudal world draws road bridges: elsewhere "any bridge" fords the river.
        for (const setting of ['grimdark', 'warp', 'scifi'] as const) {
            expect(parsed({ setting, bridge: 'any' }).paths.find((p) => p.kind === 'road')?.bridge).toBe(false);
        }
        expect(parsed({ setting: 'feudal', bridge: 'any' }).paths.find((p) => p.kind === 'road')?.bridge).toBeUndefined();
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
        const forest = parsed({ landscape: 'forest', features: ['camp', 'ruins'] });
        expect(forest.zones.filter((z) => z.kind === 'clearing')).toHaveLength(2);
        const camp = forest.zones.find((z) => z.kind === 'fortified');
        const road = forest.paths.find((p) => p.kind === 'road');
        expect(camp?.area.shape === 'circle' && road?.via[0]).toEqual(camp?.area.shape === 'circle' ? camp.area.centre : null);
        expect(parsed({ landscape: 'plains', features: ['camp'] }).zones.some((z) => z.kind === 'clearing')).toBe(false);
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

    it('cuts a cave as one network of chambers through rock, opening off the map, in the dark', () => {
        const intent = parsed({ landscape: 'cave' });
        const [network] = intent.hewn;
        expect(intent.ground).toBeNull();
        expect(intent.lighting).toBe('dim');
        expect(network?.chambers.length).toBeGreaterThanOrEqual(4);
        expect(network?.passages.length).toBe(network?.chambers.length);
        expect(network?.passages.some((p) => p.points.some((pt) => pt.x < 0))).toBe(true);
    });

    it('dresses its ground as thickly as asked, and narrows every picker value', () => {
        for (const density of ENCOUNTER_DENSITIES) {
            expect(parsed({ density }).zones.some((z) => z.density === density)).toBe(true);
        }
        expect(Number.isInteger(freshSeed(seededRandom(2)))).toBe(true);
        expect([isEncounterLandscape('forest'), isEncounterLandscape('volcano')]).toEqual([true, false]);
        expect([isEncounterRoad('crossroads'), isEncounterBridge('ford'), isEncounterFeature('lake')]).toEqual([true, true, true]);
        expect([isEncounterSetting('scifi'), isEncounterSize('huge'), isEncounterDensity('dense')]).toEqual([true, false, true]);
    });
});
