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
        expect(roleFromTags(['bookcase', 'setting-fantasy'])).toBe('shelf');
        // Tagged tabletop, it is set on a table, even a candle (it still gives its light there) or a bread board.
        expect(roleFromTags(['tabletop', 'candle'])).toBe('tabletop');
        expect(roleFromTags(['tabletop', 'bread', 'board'])).toBe('tabletop');
        expect(roleFromTags(['flower', 'bed', 'setting-fantasy'])).toBe('flora');
        expect(roleFromTags(['double', 'bed'])).toBe('bed');
        expect(roleFromTags(['high', 'backed', 'settle'])).toBe('bench');
        // A counter's lifting gate is part of the counter; a gate in a wall is a door.
        expect(roleFromTags(['brass', 'counter', 'gate', 'counter-gate'])).toBe('counter');
        expect(roleFromTags(['picket', 'gate'])).toBe('door');
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

    it('never strews a mark that says something, a thing laid flat, or a run’s strip as grime: each is a fitting', () => {
        expect(roleFromTags(['cult', 'graffito', 'decal', 'sigil', 'six-limbed'])).toBe('fitting');
        expect(roleFromTags(['hung', 'bedsheet', 'decal'])).toBe('fitting');
        expect(roleFromTags(['cart', 'route', 'wear', 'decal', 'segment'])).toBe('fitting');
        expect(roleFromTags(['violet', 'scorch'])).toBe('fitting');
        expect(roleFromTags(['brood', 'resin', 'growth', 'decal'])).toBe('fitting');
        // Leaf litter is a wood's ground cover, not grime indoors.
        expect(roleFromTags(['leaf', 'litter', 'decal'])).toBe('flora');
        // Grime is still grime, and a counter's segment still a counter.
        expect(roleFromTags(['oil', 'stain'])).toBe('decal');
        expect(roleFromTags(['service', 'counter', 'segment'])).toBe('counter');
    });

    it('makes a stamp nothing in its tags describes a fitting, drawn only where named, and a trap always one, never scattered', () => {
        expect(roleFromTags(['czech', 'barge', 'setting-modern'])).toBe('fitting');
        expect(roleFromTags([])).toBe('fitting');
        expect(roleFromTags(['pressure', 'plate', 'trap'])).toBe('fitting');
        // A spiked pit is still a trap, not a light or a hazard's scenery to strew.
        expect(roleFromTags(['spike', 'pit', 'trap', 'lamp'])).toBe('fitting');
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
        // A fitting stands in a room or a yard, never drawn at a city's scale.
        expect(suitsScale('fitting', 'interior')).toBe(true);
        expect(suitsScale('fitting', 'exterior')).toBe(true);
        expect(suitsScale('fitting', 'city')).toBe(false);
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
        // A bog log lies in a marsh, not the woods a log usually does.
        expect(habitatsOf('log', ['bog', 'log'], [])).toEqual(['marsh']);
    });

    it('knows wild ground cover by its tags, and leaves lily pads, which float on open water, to be placed by hand', () => {
        expect(['reed', 'sedge', 'tussock', 'cattail', 'bulrush', 'fern', 'bracken', 'wildflower', 'tuft'].map((tag) => roleFromTags([tag]))).toEqual(
            Array.from({ length: 9 }, () => 'flora'),
        );
        expect(roleFromTags(['drowned', 'stump'])).toBe('log');
        expect(roleFromTags(['wetland'])).toBe('debris');
        // A cot-side cabinet stands by a bed: a nightstand, never taken for the cot.
        expect(roleFromTags(['top-down', 'cot', 'cabinet'])).toBe('nightstand');
        expect(roleFromTags(['camp', 'cot'])).toBe('bed');
        // Lily pads float on open water, never strewn on a marsh's mud: a fitting, placed where named.
        expect(roleFromTags(['lily', 'pads'])).toBe('fitting');
    });

    it('grows nothing planted in the wild, and fungus only in a wood or a cave', () => {
        // A flower bed, a potted shrub: tended by someone, so no zone of wild ground is dressed with them.
        expect(habitatsOf('flora', ['flower', 'bed'], [])).toEqual([]);
        expect(habitatsOf('shrub', ['potted', 'shrub'], [])).toEqual([]);
        expect(habitatsOf('flora', ['mushroom', 'cluster'], [])).toEqual(['cave', 'forest']);
        // What the pack says still stands.
        expect(habitatsOf('flora', ['flower', 'bed'], ['grassland'])).toEqual(['grassland']);
    });

    it('gives what is not land no habitat: it stands on any ground', () => {
        expect(habitatsOf('structure', ['bunker', 'forest'], [])).toEqual([]);
    });
});
