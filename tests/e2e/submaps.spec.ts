// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from './lib/foundry';

test('an enterable stamp opens into a new interior scene, each side teleporting to the other', async ({ world }) => {
    const result = await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        const stamp = await controller?.placeStamp({ stamp: 'zc-e2e-pack:residence', x: 600, y: 600 });
        const interior = stamp === null || stamp === undefined ? null : await controller?.createInterior(stamp, 'Residence interior');
        const here = canvas?.scene;
        const there = interior === null || interior === undefined ? undefined : game.scenes?.get(interior);
        // fvtt-types still describes v13's single `destination`; v14 holds a set of `destinations`, which
        // 14.368 may store relative to the behaviour, so each is resolved to the region it names.
        const destinations = (region: RegionDocument | undefined): string[] => {
            const behaviour = region?.behaviors.contents[0];
            const system: object | undefined = behaviour?.system;
            return behaviour !== undefined && system !== undefined && 'destinations' in system && system.destinations instanceof Set
                ? [...system.destinations].map((uuid) => {
                      const resolved = foundry.utils.fromUuidSync(String(uuid), { relative: behaviour })?.uuid;
                      return typeof resolved === 'string' ? resolved : String(uuid);
                  })
                : [];
        };
        const entrance = here?.regions.contents[0];
        const exit = there?.regions.contents[0];
        return {
            interiorName: there?.name,
            entranceTo: destinations(entrance),
            exitTo: destinations(exit),
            entranceUuid: entrance?.uuid,
            exitUuid: exit?.uuid,
            locked: [entrance?.locked, exit?.locked],
            visibility: [entrance?.visibility, exit?.visibility],
        };
    });
    expect(result.interiorName).toBe('Residence interior');
    expect(result.entranceTo).toEqual([result.exitUuid]);
    expect(result.exitTo).toEqual([result.entranceUuid]);
    // The entrance follows the stamp, so it is locked; the exit is the GM's to place. Both show on the Regions layer.
    expect(result.locked).toEqual([true, false]);
    expect(result.visibility).toEqual([0, 0]);

    // Moving the stamp redraws the entrance in place, under the same id and with its teleport, so the exit still reaches it.
    await world.evaluate(async () => {
        await canvas?.scene?.tiles.contents[0]?.update({ x: 900, y: 700 });
    });
    await expect
        .poll(async () =>
            world.evaluate(() => {
                const entrance = canvas?.scene?.regions.contents[0];
                // The stamp's footprint is a rectangle, so the entrance is Foundry's own rectangle shape, centred on the stamp.
                const xs = entrance?.shapes.flatMap((shape) => (shape.type === 'rectangle' && 'x' in shape ? [shape.x] : [])) ?? [];
                const behaviour = entrance?.behaviors.contents[0];
                const system: object | undefined = behaviour?.system;
                // Stored relative to the behaviour once redrawn in place (14.368), so each is resolved to the region it names.
                const destinations =
                    behaviour !== undefined && system !== undefined && 'destinations' in system && system.destinations instanceof Set
                        ? [...system.destinations].map((uuid) => {
                              const resolved = foundry.utils.fromUuidSync(String(uuid), { relative: behaviour })?.uuid;
                              return typeof resolved === 'string' ? resolved : String(uuid);
                          })
                        : [];
                return { uuid: entrance?.uuid, count: canvas?.scene?.regions.size, moved: xs.length > 0 && Math.min(...xs) > 600, destinations };
            }),
        )
        .toEqual({ uuid: result.entranceUuid, count: 1, moved: true, destinations: [result.exitUuid] });
});

test('a submap’s travel options reach both teleports in place: arrival, transition and prompt', async ({ world }) => {
    const travel = await world.evaluate(async () => {
        const controller = game.modules?.get('zephyr-cartography').api.controller();
        const stamp = (await controller?.placeStamp({ stamp: 'zc-e2e-pack:residence', x: 600, y: 600 })) ?? '';
        const interior = (await controller?.createInterior(stamp, 'Residence interior')) ?? '';
        // The teleport behaviour of the entrance, here, and of the exit, in the interior.
        const teleports = (): (RegionBehavior | undefined)[] => [
            canvas?.scene?.regions.contents[0]?.behaviors.contents[0],
            game.scenes?.contents.find((scene) => scene.id === interior)?.regions.contents[0]?.behaviors.contents[0],
        ];
        const before = teleports().map((behaviour) => behaviour?.id);
        await controller?.setSubmapTravel(stamp, {
            placement: 'center',
            snap: false,
            revealed: true,
            transition: 'fade',
            duration: 800,
            prompt: 'Enter {scene}?',
        });
        return { before, after: teleports().map((behaviour) => behaviour?.toObject()) };
    });
    const expected = {
        placement: 'center',
        snap: false,
        revealed: true,
        transition: { type: 'fade', duration: 800 },
        dialog: { revealed: 'Enter {scene}?', unrevealed: 'Enter {scene}?' },
    };
    // The same behaviours, updated where they are: the GM's exit is not recreated.
    expect(travel.after).toMatchObject([
        { _id: travel.before[0], system: expected },
        { _id: travel.before[1], system: expected },
    ]);
});
