// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { habitatsOf, placementOf, roleFromTags, suitsScale } from './role-tags';

describe('roleFromTags', () => {
    it('reads what a stamp is from its tags, the most specific rule first', () => {
        expect(roleFromTags(['cogitator', 'console', 'setting-grimdark'])).toBe('console');
        expect(roleFromTags(['cogitator', 'desk'])).toBe('desk');
        expect(roleFromTags(['desk', 'lamp'])).toBe('light');
        // Votive candles and censers are a shrine's, a candle cluster a room's lamp.
        expect(roleFromTags(['candle', 'bank', 'setting-fantasy'])).toBe('icon');
        expect(roleFromTags(['censer', 'stand'])).toBe('icon');
        expect(roleFromTags(['candle', 'cluster'])).toBe('light');
        expect(roleFromTags(['interrogation', 'chair'])).toBe('restraint');
        expect(roleFromTags(['shrine', 'shelf'])).toBe('shelf');
        expect(roleFromTags(['prep', 'table', 'setting-fantasy'])).toBe('workbench');
        expect(roleFromTags(['chopping', 'block'])).toBe('workbench');
        // Every tag of a combination: table clutter lies on a table, a table alone is one, clutter alone is clutter.
        expect(roleFromTags(['table', 'clutter', 'setting-fantasy'])).toBe('tabletop');
        expect(roleFromTags(['tavern', 'table'])).toBe('table');
        expect(roleFromTags(['tavern', 'clutter'])).toBe('clutter');
        expect(roleFromTags(['sandbag', 'emplacement'])).toBe('emplacement');
        expect(roleFromTags(['sandbag', 'wall'])).toBe('barricade');
        expect(roleFromTags(['cargo', 'hauler'])).toBe('vehicle');
        expect(roleFromTags(['bunk', 'bed'])).toBe('bed');
        expect(roleFromTags(['woodland', 'debris'])).toBe('debris');
        // A bedroom's wardrobe and drawers are dressers, a padded or easy chair an armchair; a locker stays a store's.
        expect(roleFromTags(['oak', 'wardrobe'])).toBe('dresser');
        expect(roleFromTags(['chest', 'of', 'drawers'])).toBe('dresser');
        expect(roleFromTags(['wooden', 'chest'])).toBe('chest');
        expect(roleFromTags(['washstand'])).toBe('dresser');
        expect(roleFromTags(['padded', 'chair'])).toBe('armchair');
        expect(roleFromTags(['wingback'])).toBe('armchair');
        expect(roleFromTags(['metal', 'locker'])).toBe('storage');
        expect(placementOf('armchair', [], undefined).against).toBe('corner');
        expect(placementOf('dresser', [], undefined).against).toBe('wall');
        expect(suitsScale('dresser', 'exterior')).toBe(false);
    });

    it('gives no role to a stamp nothing in its tags describes, or to a trap, so it is only placed by hand', () => {
        expect(roleFromTags(['czech', 'barge', 'setting-modern'])).toBeUndefined();
        expect(roleFromTags([])).toBeUndefined();
        expect(roleFromTags(['pressure', 'plate', 'trap'])).toBeUndefined();
    });
});

describe('suitsScale', () => {
    it('furnishes rooms from interior stamps and yards from exterior ones; land and storage serve either', () => {
        expect(suitsScale('altar', 'interior')).toBe(true);
        expect(suitsScale('altar', 'exterior')).toBe(false);
        expect(suitsScale('structure', 'exterior')).toBe(true);
        expect(suitsScale('structure', 'interior')).toBe(false);
        expect(suitsScale('storage', 'exterior')).toBe(true);
        expect(suitsScale('rock', 'interior')).toBe(true);
    });
});

describe('placementOf', () => {
    it('stands a piece as its role does, with whatever its pack says of the image over that', () => {
        expect(placementOf('altar', [], undefined)).toEqual({ against: 'wall', clearance: 1.5, back: 'top', upright: false });
        expect(placementOf('barricade', [], undefined)).toMatchObject({ back: 'bottom' });
        expect(placementOf('structure', [], undefined)).toMatchObject({ upright: true });
        expect(placementOf('bed', [], { back: 'left' })).toEqual({ against: 'wall', clearance: 0, back: 'left', upright: false });
        expect(placementOf('structure', [], { upright: false })).toMatchObject({ upright: false });
    });

    it('stands crates in corners but a locker against a wall, as its tags say', () => {
        expect(placementOf('storage', ['ammo', 'crate'], undefined).against).toBe('corner');
        expect(placementOf('storage', ['metal', 'locker'], undefined).against).toBe('wall');
        expect(placementOf('storage', ['metal', 'locker'], { against: 'free' }).against).toBe('free');
    });
});

describe('habitatsOf', () => {
    it('keeps land on its ground: the pack’s word, else its tags’, else its role’s usual', () => {
        expect(habitatsOf('rock', ['cave', 'boulder'], [])).toEqual(['cave']);
        expect(habitatsOf('rock', ['ice', 'formation'], [])).toEqual(['arctic']);
        expect(habitatsOf('rock', ['boulder'], [])).toEqual(['forest', 'grassland', 'rocky', 'desert', 'ruin']);
        expect(habitatsOf('rock', ['rock', 'formation'], ['rocky', 'desert'])).toEqual(['rocky', 'desert']);
        expect(habitatsOf('debris', ['metal', 'debris'], [])).toEqual(['urban']);
    });

    it('gives what is not land no habitat: it stands on any ground', () => {
        expect(habitatsOf('structure', ['bunker', 'forest'], [])).toEqual([]);
    });
});
