// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { decodeFeatures, featuresFileName, featuresUrl, newerThanHeld, nextRev, parseFeaturesMarker } from './features-file';
import { makePin } from './pin';

const PIN = makePin('p1', { x: 10, y: 20 });

describe('parseFeaturesMarker', () => {
    it('reads a path and a finite revision', () => {
        expect(parseFeaturesMarker({ path: 'worlds/w/zephyr-cartography/features-a.json', rev: 5 })).toEqual({
            path: 'worlds/w/zephyr-cartography/features-a.json',
            rev: 5,
        });
    });

    it('refuses anything else', () => {
        expect(parseFeaturesMarker(null)).toBeNull();
        expect(parseFeaturesMarker('features-a.json')).toBeNull();
        expect(parseFeaturesMarker({ path: '', rev: 1 })).toBeNull();
        expect(parseFeaturesMarker({ path: 'a.json', rev: Number.NaN })).toBeNull();
        expect(parseFeaturesMarker({ path: 'a.json', rev: '1' })).toBeNull();
        expect(parseFeaturesMarker({ rev: 1 })).toBeNull();
    });
});

describe('featuresFileName', () => {
    it('names the file for the scene, keeping it a plain file name', () => {
        expect(featuresFileName('abcDEF0123456789')).toBe('features-abcDEF0123456789.json');
        expect(featuresFileName('../x/y')).toBe('features-___x_y.json');
    });
});

describe('featuresUrl', () => {
    it('puts the revision in the query, so no cache serves an older one', () => {
        expect(featuresUrl({ path: 'worlds/w/m/features-a.json', rev: 42 })).toBe('worlds/w/m/features-a.json?rev=42');
    });
});

describe('nextRev', () => {
    it('is the clock when it runs ahead of every revision seen', () => {
        expect(nextRev([10, null], 1000.7)).toBe(1000);
    });

    it('moves past the latest revision seen when the clock runs behind it', () => {
        expect(nextRev([5000, 4000], 1000)).toBe(5001);
        expect(nextRev([null, 5000], 1000)).toBe(5001);
    });
});

describe('newerThanHeld', () => {
    it('takes any revision when nothing is held', () => {
        expect(newerThanHeld(null, { path: 'a.json', rev: 1 })).toBe(true);
    });

    it('takes only a newer revision, never the one held or an older one', () => {
        expect(newerThanHeld(5, { path: 'a.json', rev: 6 })).toBe(true);
        expect(newerThanHeld(5, { path: 'a.json', rev: 5 })).toBe(false);
        expect(newerThanHeld(5, { path: 'a.json', rev: 4 })).toBe(false);
    });
});

describe('decodeFeatures', () => {
    it('reads saved features back, dropping the malformed', () => {
        const decoded = decodeFeatures(JSON.stringify([PIN, { type: 'nonsense' }]));
        expect(decoded?.map((f) => f.id)).toEqual(['p1']);
    });

    it('is null for text that is not a JSON list', () => {
        expect(decodeFeatures('not json')).toBeNull();
        expect(decodeFeatures('{"a":1}')).toBeNull();
    });
});
