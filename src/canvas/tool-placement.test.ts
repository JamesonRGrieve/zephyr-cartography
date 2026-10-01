// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { inOwnGroup, moduleTool, NATIVE_GROUPS, NATIVE_TOOLS, nativeToolName } from './tool-placement';

const OWN = 'zephyr-cartography';

describe('tool placement', () => {
    it('puts room, door and materials with the Walls tools, and stamps with the Tiles tools', () => {
        expect(NATIVE_TOOLS.walls).toEqual(expect.arrayContaining(['room', 'door', 'materials']));
        expect(NATIVE_TOOLS.tiles).toContain('stamp');
    });

    it('places tools in the Walls, Tiles, Lighting, Regions, Notes and Drawings groups only', () => {
        expect(NATIVE_GROUPS).toEqual(['walls', 'tiles', 'lighting', 'regions', 'notes', 'drawings']);
        expect(NATIVE_TOOLS.drawings).toEqual(['label', 'edit', 'erase']);
        expect(NATIVE_TOOLS.lighting).toEqual(['link']);
        expect(NATIVE_TOOLS.regions).toEqual(['zone', 'effects', 'edit', 'erase']);
        expect(NATIVE_TOOLS.notes).toEqual(['pin', 'edit', 'erase']);
        expect(moduleTool('notes', 'zephyr-pin', OWN)).toBe('pin');
        expect(Object.keys(NATIVE_TOOLS).sort()).toEqual([...NATIVE_GROUPS].sort());
        expect(moduleTool('regions', 'zephyr-effects', OWN)).toBe('effects');
    });

    it('also offers edit and erase in each native group', () => {
        expect(NATIVE_TOOLS.walls).toEqual(expect.arrayContaining(['edit', 'erase']));
        expect(NATIVE_TOOLS.tiles).toContain('erase');
    });

    it('keeps a native-only tool out of the module group, and the rest in it', () => {
        expect(['room', 'door', 'materials', 'stamp', 'link', 'effects', 'pin', 'label'].some(inOwnGroup)).toBe(false);
        expect(['road', 'river', 'forest', 'edit', 'erase', 'undo', 'levels'].map(inOwnGroup)).toEqual([true, true, true, true, true, true, true]);
    });

    it('names a native tool apart from Foundry’s own', () => {
        expect(nativeToolName('door')).toBe('zephyr-door');
        expect(nativeToolName('door')).not.toBe('doors');
    });

    it('reads a scene-control selection back as the module tool it is', () => {
        expect(moduleTool(OWN, 'road', OWN)).toBe('road');
        expect(moduleTool('walls', 'zephyr-room', OWN)).toBe('room');
        expect(moduleTool('tiles', 'zephyr-stamp', OWN)).toBe('stamp');
    });

    it('is null for Foundry’s tools, a tool placed in another group, and other groups', () => {
        expect(moduleTool('walls', 'wall', OWN)).toBeNull();
        expect(moduleTool('tiles', 'zephyr-room', OWN)).toBeNull();
        expect(moduleTool('tokens', 'zephyr-room', OWN)).toBeNull();
    });
});
