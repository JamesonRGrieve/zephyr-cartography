// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A stamp's place in the scene's physics, in Foundry: a burning piece's
 * hazard region scrolling its warning over a token coming in, a low wall's
 * cover walls (blocking nothing, flagged with the cover they give), an armed
 * trap's hidden tile over a region that pauses the game, sprung by its
 * variant; and a hinged variant (a ramp lowered from its hinge) keeping its
 * hinge where it stands as the variants switch.
 */
import { expect, test } from './lib/foundry';

test('a burning stamp warns in a hazard region, a low wall gives flagged cover, and an armed trap hides over a pausing region until sprung', async ({
    world,
}) => {
    const placed = await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        await controller?.placeStamp({ stamp: 'zc-e2e-pack:fire-pit', x: 300, y: 300 });
        await controller?.placeStamp({ stamp: 'zc-e2e-pack:low-wall', x: 700, y: 300 });
        const plate = await controller?.placeStamp({ stamp: 'zc-e2e-pack:pressure-plate', x: 300, y: 700 });
        const scene = canvas?.scene;
        return {
            plate: plate ?? '',
            regions: (scene?.regions.contents ?? []).map((r) => ({ name: r.name, behaviors: r.behaviors.contents.map((b) => b.toObject()) })),
            cover: (scene?.walls.contents ?? []).flatMap((w) => {
                const flags: Record<string, unknown> = w.flags;
                const own = flags['zephyr-cartography'];
                const cover = typeof own === 'object' && own !== null && 'cover' in own ? own.cover : undefined;
                return cover === undefined ? [] : [{ cover, move: w.move, sight: w.sight }];
            }),
            hidden: (scene?.tiles.contents ?? []).filter((t) => t.hidden).map((t) => t.texture.src),
            sounds: (scene?.sounds.contents ?? []).map((s) => ({ path: s.path, radius: s.radius })),
        };
    });
    // The fire pit declares no sound of its own: the pack's ambience gives every `bonfire` its crackle, its 5 squares 25
    // distance units on the fixture's 5-unit grid.
    expect(placed.sounds).toEqual([{ path: expect.stringContaining('sounds/silence.wav'), radius: 25 }]);
    const byName = Object.fromEntries(placed.regions.map((r) => [r.name, r]));
    expect(byName['Fire Pit hazard']).toMatchObject({ behaviors: [{ type: 'displayScrollingText', system: { text: 'Fire!', events: ['tokenAnimateIn'] } }] });
    expect(byName['Pressure Plate trap']).toMatchObject({ behaviors: [{ type: 'pauseGame', system: { once: true } }] });
    // Four walls round the low wall, restricting nothing (CONST.EDGE_SENSE_TYPES.NONE, no movement), each saying its cover.
    expect(placed.cover).toEqual(Array.from({ length: 4 }, () => ({ cover: 0.5, move: 0, sight: 0 })));
    expect(placed.hidden).toEqual([expect.stringContaining('crate.svg')]);

    const sprung = await world.evaluate(async (plate) => {
        await game.modules?.get('zephyr-cartography').api.controller()?.setStampVariant(plate, 1);
        const scene = canvas?.scene;
        return { regions: (scene?.regions.contents ?? []).map((r) => r.name), hidden: (scene?.tiles.contents ?? []).filter((t) => t.hidden).length };
    }, placed.plate);
    expect(sprung.regions).not.toContain('Pressure Plate trap');
    expect(sprung.hidden).toBe(0);
});

test('a ramp lowered from its hinge stands out from it, and raised again stands on it', async ({ world }) => {
    const centres = await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        // The lowered ramp's hinge, its image's bottom edge, on the point; a v14 tile's (x, y) is its centre here.
        const ramp = (await controller?.placeStamp({ stamp: 'zc-e2e-pack:ramp', x: 500, y: 500, variant: 1 })) ?? '';
        const tile = (): { x: number; y: number; height: number } => {
            const t = canvas?.scene?.tiles.contents[0];
            return { x: t?.x ?? NaN, y: t?.y ?? NaN, height: t?.height ?? NaN };
        };
        const lowered = tile();
        await controller?.setStampVariant(ramp, 0);
        const raised = tile();
        await controller?.setStampVariant(ramp, 1);
        return { lowered, raised, again: tile() };
    });
    expect(centres.lowered.x).toBeCloseTo(500);
    expect(centres.lowered.y).toBeCloseTo(500 - centres.lowered.height / 2);
    // Raised, the plate is centred on the hinge line; lowered again, the ramp lies out from it as before.
    expect(centres.raised).toMatchObject({ x: expect.closeTo(500), y: expect.closeTo(500) });
    expect(centres.again.y).toBeCloseTo(centres.lowered.y);
});
