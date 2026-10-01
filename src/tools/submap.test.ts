// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { DEFAULT_TRAVEL, exitRegion, exitSquare, parseSubmapLink, parseTravel, type SubmapLink, validDuration } from './submap';

const link: SubmapLink = { scene: 'sc1', sceneName: 'Residence interior', entryRegion: 'in1', exitRegion: 'out1', travel: DEFAULT_TRAVEL };

describe('travel', () => {
    it('reads a link’s travel field by field over the defaults, and a link from before travel by them', () => {
        expect(parseTravel({ placement: 'center', snap: false, revealed: true, transition: 'fade', duration: 800, prompt: 'Go in?' })).toEqual({
            placement: 'center',
            snap: false,
            revealed: true,
            transition: 'fade',
            duration: 800,
            prompt: 'Go in?',
        });
        expect(parseTravel({ placement: 'sideways', snap: 'yes', revealed: 1, transition: '', duration: 50, prompt: '' })).toEqual(DEFAULT_TRAVEL);
        expect(parseTravel(undefined)).toEqual(DEFAULT_TRAVEL);
        expect(parseSubmapLink({ scene: 'a', sceneName: 'A', entryRegion: 'i', exitRegion: 'o' })?.travel).toEqual(DEFAULT_TRAVEL);
        expect([validDuration(500), validDuration(10000), validDuration(499), validDuration(1500.5)]).toEqual([500, 10000, null, null]);
    });

    it('gives the exit the link’s travel, so both ways go alike', () => {
        const travel = { ...DEFAULT_TRAVEL, transition: 'fade' };
        expect(exitRegion({ ...link, travel }, [], 'here', 'Town').behaviour).toMatchObject({ kind: 'teleport', travel });
    });
});

describe('exitSquare', () => {
    it('is one grid square at the centre of the scene', () => {
        expect(exitSquare({ x: 100, y: 100, width: 1000, height: 800, gridSize: 100 })).toEqual([
            { x: 550, y: 450 },
            { x: 650, y: 450 },
            { x: 650, y: 550 },
            { x: 550, y: 550 },
        ]);
    });

    it('falls back to a tenth of the shorter side on a gridless scene', () => {
        const [corner, next] = exitSquare({ x: 0, y: 0, width: 1000, height: 500, gridSize: 0 });
        expect(corner).toEqual({ x: 475, y: 225 });
        expect(next).toEqual({ x: 525, y: 225 });
    });
});

describe('exitRegion', () => {
    it('keeps its fixed id and teleports back to the entrance in the origin scene', () => {
        const polygon = exitSquare({ x: 0, y: 0, width: 100, height: 100, gridSize: 10 });
        expect(exitRegion(link, polygon, 'here', 'Town')).toEqual({
            id: 'out1',
            label: { kind: 'exit', scene: 'Town' },
            polygon,
            bottom: null,
            top: null,
            level: null,
            spans: [],
            behaviour: { kind: 'teleport', targets: [{ scene: 'here', region: 'in1' }], travel: DEFAULT_TRAVEL },
        });
    });
});

describe('parseSubmapLink', () => {
    it('parses a complete link and rejects anything missing a field', () => {
        expect(parseSubmapLink({ ...link })).toEqual(link);
        expect(parseSubmapLink({ ...link, exitRegion: 7 })).toBeNull();
        expect(parseSubmapLink({ scene: 'sc1' })).toBeNull();
        expect(parseSubmapLink('sc1')).toBeNull();
        expect(parseSubmapLink(null)).toBeNull();
    });
});
