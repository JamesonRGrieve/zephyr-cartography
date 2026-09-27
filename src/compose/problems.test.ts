// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { type ComposeProblem, distinctProblems } from './problems';

describe('distinctProblems', () => {
    it('keeps each problem once, in the order first met', () => {
        const tree: ComposeProblem = { kind: 'no-stamp', role: 'tree', wantedIn: 'woodland' };
        const hut: ComposeProblem = { kind: 'rooms-do-not-fit', building: 'hut', width: 3, height: 3 };
        expect(distinctProblems([tree, hut, { ...tree }, hut])).toEqual([tree, hut]);
    });
});
