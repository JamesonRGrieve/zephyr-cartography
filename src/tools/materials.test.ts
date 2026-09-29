// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { BIOMES } from './biome';
import { floorMaterials, isFloorMaterial, materialName, parseWallMaterial, wallMaterials } from './materials';

const roles = ['grassland', 'road', 'wall.brick', 'floor.oak', 'floor.flagstone', 'wall.', 'floor.'];

describe('room materials', () => {
    it('accepts biomes, floor roles and wall roles (the top of masonry, a wall-walk) as floors, and nothing else', () => {
        expect(isFloorMaterial('dirt')).toBe(true);
        expect(isFloorMaterial('floor.oak')).toBe(true);
        expect(isFloorMaterial('floor.')).toBe(false);
        expect(isFloorMaterial('wall.brick')).toBe(true);
        expect(isFloorMaterial('wall.')).toBe(false);
        expect(isFloorMaterial('road')).toBe(false);
        expect(isFloorMaterial(3)).toBe(false);
    });

    it('reads a wall role, or no drawn wall', () => {
        expect(parseWallMaterial('wall.brick')).toBe('wall.brick');
        expect(parseWallMaterial('wall.')).toBeNull();
        expect(parseWallMaterial('dirt')).toBeNull();
        expect(parseWallMaterial(undefined)).toBeNull();
    });

    it('offers every biome plus the set floor roles, and the set wall roles', () => {
        expect(floorMaterials(roles)).toEqual([...BIOMES, 'floor.flagstone', 'floor.oak']);
        expect(wallMaterials(roles)).toEqual(['wall.brick']);
    });

    it('names pack materials without their prefix', () => {
        expect(materialName('floor.oak')).toBe('oak');
        expect(materialName('wall.brick')).toBe('brick');
        expect(materialName('dirt')).toBe('dirt');
    });
});
