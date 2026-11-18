// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { deletePoint, movePoint } from './edit';
import { parseFeatures } from './feature';
import { planDocuments } from './plan';
import { DEFAULT_SHAPE_STYLE, isBox, makeShape, parseShape, shapeBox, shapeDrawn, shapeHit, type ShapeFeature, withShapePoints } from './shape';

const TRIANGLE = [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
    { x: 200, y: 250 },
];

function shape(made: ShapeFeature | null): ShapeFeature {
    if (!made) {
        throw new Error('not a shape');
    }
    return made;
}

describe('drawn shapes', () => {
    it('stand on enough points for their kind, a box on its centre alone, in a style Foundry takes', () => {
        expect(makeShape('s', { kind: 'polygon' }, TRIANGLE.slice(0, 2))).toBeNull();
        expect(makeShape('s', { kind: 'line' }, TRIANGLE.slice(0, 2))?.points).toHaveLength(2);
        const box = makeShape('s', { kind: 'rectangle', width: 100, height: 50, rotation: 0 }, TRIANGLE);
        expect(box?.points).toEqual([TRIANGLE[0]]);
        expect(makeShape('s', { kind: 'ellipse', width: 0, height: 50, rotation: 0 }, TRIANGLE)).toBeNull();
        expect(makeShape('s', { kind: 'line' }, TRIANGLE, { ...DEFAULT_SHAPE_STYLE, strokeColour: 'red' })).toBeNull();
        expect(makeShape('s', { kind: 'line' }, TRIANGLE, { ...DEFAULT_SHAPE_STYLE, strokeWidth: 1.5 })).toBeNull();
        expect(makeShape('s', { kind: 'line' }, TRIANGLE, { ...DEFAULT_SHAPE_STYLE, fillAlpha: 2 })).toBeNull();
        expect(isBox({ kind: 'ellipse', width: 1, height: 1, rotation: 0 })).toBe(true);
        expect(isBox({ kind: 'polygon' })).toBe(false);
    });

    it('lay out as a Drawing: a box at its centre, whole-pixel sized; a polygon closed and its points from its top-left', () => {
        const polygon = shape(makeShape('s', { kind: 'polygon' }, TRIANGLE));
        expect(shapeBox(polygon)).toEqual({ x: 200, y: 175, width: 200, height: 150, rotation: 0, shape: 'p', points: [0, 0, 200, 0, 100, 150, 0, 0] });
        const line = shape(makeShape('s', { kind: 'line' }, TRIANGLE));
        expect(shapeBox(line).points).toEqual([0, 0, 200, 0, 100, 150]);
        const ellipse = shape(makeShape('s', { kind: 'ellipse', width: 99.6, height: 40.2, rotation: 15 }, [{ x: 10, y: 20 }]));
        expect(shapeBox(ellipse)).toEqual({ x: 10, y: 20, width: 100, height: 40, rotation: 15, shape: 'e', points: [] });
        expect(shapeBox(shape(makeShape('s', { kind: 'rectangle', width: 10, height: 10, rotation: 0 }, [{ x: 0, y: 0 }]))).shape).toBe('r');
    });

    it('are hit inside a box or polygon, and near a line', () => {
        const polygon = shape(makeShape('s', { kind: 'polygon' }, TRIANGLE));
        expect([shapeHit(polygon, { x: 200, y: 150 }), shapeHit(polygon, { x: 120, y: 240 })]).toEqual([true, false]);
        const line = shape(makeShape('s', { kind: 'line' }, TRIANGLE));
        expect([shapeHit(line, { x: 200, y: 108 }), shapeHit(line, { x: 200, y: 120 })]).toEqual([true, false]);
        const rectangle = shape(makeShape('s', { kind: 'rectangle', width: 100, height: 20, rotation: 90 }, [{ x: 0, y: 0 }]));
        expect([shapeHit(rectangle, { x: 0, y: 45 }), shapeHit(rectangle, { x: 45, y: 0 })]).toEqual([true, false]);
        const ellipse = shape(makeShape('s', { kind: 'ellipse', width: 100, height: 20, rotation: 0 }, [{ x: 0, y: 0 }]));
        expect([shapeHit(ellipse, { x: 45, y: 0 }), shapeHit(ellipse, { x: 45, y: 9 })]).toEqual([true, false]);
    });

    it('move a polygon’s vertex, a box whole, and lose a vertex only while enough are left', () => {
        const polygon = shape(makeShape('s', { kind: 'polygon' }, TRIANGLE));
        expect(movePoint(polygon, 2, { x: 0, y: 0 })?.points[2]).toEqual({ x: 0, y: 0 });
        expect(deletePoint(polygon, 0)).toBeNull();
        const line = shape(makeShape('s', { kind: 'line' }, TRIANGLE));
        expect(deletePoint(line, 0)?.points).toEqual(TRIANGLE.slice(1));
        const box = shape(makeShape('s', { kind: 'rectangle', width: 10, height: 10, rotation: 0 }, [{ x: 0, y: 0 }]));
        expect(movePoint(box, 0, { x: 5, y: 5 })?.points).toEqual([{ x: 5, y: 5 }]);
        expect(deletePoint(box, 0)).toBeNull();
        expect(withShapePoints(box, [])).toBeNull();
    });

    it('round-trip through the scene flag, each style field valid or Foundry’s default, and drop a malformed one', () => {
        const styled = { ...DEFAULT_SHAPE_STYLE, strokeColour: '#ff0000', strokeWidth: 3, fillColour: '#00ff00', fillAlpha: 0.25, hidden: true };
        const ellipse = { ...shape(makeShape('s', { kind: 'ellipse', width: 80, height: 40, rotation: 10 }, [{ x: 5, y: 6 }], styled)), level: 'L1' };
        expect(parseFeatures(JSON.parse(JSON.stringify([ellipse])))).toEqual([ellipse]);
        const loose = parseShape({
            type: 'shape',
            id: 's',
            points: TRIANGLE,
            geometry: { kind: 'polygon' },
            strokeColour: 'red',
            strokeWidth: -1,
            strokeAlpha: 7,
            fillColour: 3,
        });
        expect(loose).toMatchObject({ ...DEFAULT_SHAPE_STYLE });
        expect(parseShape({ type: 'shape', id: 's', points: TRIANGLE, geometry: { kind: 'hexagon' } })).toBeNull();
        expect(parseShape({ type: 'shape', id: 's', points: TRIANGLE, geometry: 'polygon' })).toBeNull();
        expect(parseShape({ type: 'shape', id: 's', points: [], geometry: { kind: 'rectangle', width: 5, height: 5 } })).toBeNull();
    });

    it('wall a polygon closed and a line open, as their senses say; a box or walls blocking nothing have none', () => {
        const foliage = { sight: 'limited', light: 'limited', movement: false } as const;
        const unseen = { ...DEFAULT_SHAPE_STYLE, strokeWidth: 0 };
        const wood = shape(makeShape('w', { kind: 'polygon' }, TRIANGLE, unseen, foliage));
        expect(wood.walls).toEqual(foliage);
        // Drawn with nothing to show and walled, it is its walls alone: three of them round the triangle, no Drawing.
        expect(shapeDrawn(wood)).toBe(false);
        const plan = planDocuments(wood);
        expect(plan.drawings).toEqual([]);
        expect(plan.walls).toHaveLength(3);
        expect(plan.walls[0]).toMatchObject({
            a: TRIANGLE[0],
            b: TRIANGLE[1],
            door: 'none',
            blocks: { sight: 'limited', light: 'limited', movement: false, sound: 'none' },
        });
        // A line is walled along its run, never closed back to its start; a drawn one keeps its Drawing.
        const edge = shape(makeShape('e', { kind: 'line' }, TRIANGLE, DEFAULT_SHAPE_STYLE, foliage));
        expect(planDocuments(edge).walls).toHaveLength(2);
        expect(planDocuments(edge).drawings).toHaveLength(1);
        // An unwalled shape with nothing to show still asks for its Drawing, as before.
        expect(planDocuments(shape(makeShape('u', { kind: 'polygon' }, TRIANGLE, unseen))).drawings).toHaveLength(1);
        expect(shape(makeShape('b', { kind: 'rectangle', width: 5, height: 5, rotation: 0 }, [{ x: 0, y: 0 }], DEFAULT_SHAPE_STYLE, foliage)).walls).toBeNull();
        expect(shape(makeShape('n', { kind: 'line' }, TRIANGLE, DEFAULT_SHAPE_STYLE, { sight: 'none', light: 'none', movement: false })).walls).toBeNull();
        // Walls round-trip through the scene flag, an unknown sense read as none.
        expect(parseFeatures(JSON.parse(JSON.stringify([wood])))).toEqual([wood]);
        expect(
            parseShape({ type: 'shape', id: 'x', points: TRIANGLE, geometry: { kind: 'line' }, walls: { sight: 'fog', light: 'limited', movement: 1 } })?.walls,
        ).toEqual({
            sight: 'none',
            light: 'limited',
            movement: false,
        });
    });
});
