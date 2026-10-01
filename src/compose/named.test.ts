// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Side } from '../generate/floor-plan';
import { fittedTo, namedArt, namedBox, runEnds, runOf, standsAs } from './named';
import type { RoleIndex, RoleStamp } from './roles';
import { TEST_ROLES } from './test-roles';

const desk = (key: string, tags: readonly string[], upright = false): RoleStamp => {
    const base = TEST_ROLES.get('desk')?.[0];
    if (!base) {
        throw new Error('test desk');
    }
    return { ...base, key, tags, upright, width: 1.5, height: 0.75 };
};

describe('runs between end pieces', () => {
    // An oak section 2 × 1 between its ends, each drawn 0.5 wide at that depth: 3 long as one table.
    const section = { ...desk('oak-section', ['oak', 'section']), role: 'table' as const, width: 2, height: 1 };
    const end = { ...desk('oak-end', ['oak', 'end']), role: 'table' as const, width: 0.5, height: 1 };
    const capped: RoleStamp = { ...section, width: 3, run: { count: 1, module: section, cap: end } };

    it('runs as many sections as reach the length asked between its two ends, shrunk evenly to end exactly there', () => {
        // Three 2-square sections and two half-square ends make 7, short of 7.2: four, shrunk to 0.8, make 7.2 exactly.
        const long = runOf(capped, 7.2, 1);
        expect(long).toMatchObject({ height: 0.8, run: { count: 4, cap: { key: 'oak-end' } } });
        expect(long?.width).toBeCloseTo(7.2);
        // One section between its ends, shrunk a little, makes 2.5.
        expect(runOf(capped, 2.5, 1)?.run?.count).toBe(1);
        // Too short for even one section between its ends without shrinking past three quarters: no run.
        expect(runOf(capped, 2, 1)).toBeUndefined();
    });

    it('stands its ends at both ends of its sections, the left one mirrored so each finishes its own end', () => {
        const placed = standsAs(capped, { x: 10, y: 5 }, 0);
        expect(placed.map((p) => [p.stamp, p.x, p.mirror === true])).toEqual([
            ['oak-end', 8.75, true],
            ['oak-section', 10, false],
            ['oak-end', 11.25, false],
        ]);
        // Turned a quarter, it runs down the map.
        expect(standsAs(capped, { x: 10, y: 5 }, 90).map((p) => [p.x, p.y])).toEqual([
            [10, 3.75],
            [10, 5],
            [10, 6.25],
        ]);
    });

    it('leaves an open end without its end piece, the run one end piece shorter and still centred where asked', () => {
        // One 2-square section and one half-square end make 2.5 exactly, unshrunk.
        const butting = runOf(capped, 2.5, 1, ['end']);
        expect(butting).toMatchObject({ width: 2.5, height: 1, run: { count: 1, open: ['end'] } });
        if (!butting) {
            throw new Error('open run');
        }
        // From 8.75 to 11.25: its start's end piece, then the section running square to its open end.
        expect(standsAs(butting, { x: 10, y: 5 }, 0).map((p) => [p.stamp, p.x, p.mirror === true])).toEqual([
            ['oak-end', 9, true],
            ['oak-section', 10.25, false],
        ]);
        // Open at its start instead, the end piece finishes the right-hand end.
        const other = runOf(capped, 2.5, 1, ['start']);
        expect(other && standsAs(other, { x: 10, y: 5 }, 0).map((p) => [p.stamp, p.x])).toEqual([
            ['oak-section', 9.75],
            ['oak-end', 11],
        ]);
    });

    it('opens the end of a named run on the map side asked, whichever way it faces', () => {
        const pool: RoleIndex = new Map([['table', [capped]]]);
        const openOn = (facing: Side, side: Side): readonly string[] | undefined =>
            namedArt({ name: 'counter leg', role: 'table', tags: [], width: 2.5, height: 1, facing, open: [side] }, pool)?.run?.open;
        // Facing down, its start is at the left; facing left (turned a quarter), its start is at the top.
        expect(openOn('bottom', 'right')).toEqual(['end']);
        expect(openOn('left', 'bottom')).toEqual(['end']);
        expect(openOn('left', 'top')).toEqual(['start']);
        expect(openOn('top', 'left')).toEqual(['end']);
        expect(openOn('right', 'top')).toEqual(['end']);
        expect(runEnds('bottom', ['left', 'right'])).toEqual(['start', 'end']);
        // A side across its length is no end of it.
        expect(runEnds('bottom', ['top'])).toEqual([]);
    });

    it('scales its sections and ends together when fitted whole', () => {
        const small = fittedTo(capped, 1.5, 0.5);
        expect(small).toMatchObject({ width: 1.5, height: 0.5, run: { module: { width: 1, height: 0.5 }, cap: { width: 0.25 } } });
    });

    it('prefers art made to join over repeating a piece made to stand alone', () => {
        const trestle = { ...desk('trestle', []), role: 'table' as const, width: 2, height: 0.9 };
        const pool: RoleIndex = new Map([['table', [trestle, capped]]]);
        for (const called of ['long table', 'high table', 'board', 'feast table']) {
            expect(namedArt({ name: called, role: 'table', tags: [], width: 7, height: 1 }, pool)?.run?.cap?.key).toBe('oak-end');
        }
    });
});

describe('a run part asked for by name', () => {
    it('draws a piece asking for a counter’s gate in a gate of the kind it names, never a corner or a segment', () => {
        const segment = { ...desk('segment', ['riveted', 'counter-segment']), role: 'counter' as const, width: 1, height: 0.6 };
        const brassGate = { ...segment, key: 'brass-gate', tags: ['brass', 'counter-gate'], height: 0.65 };
        const rivetedGate = { ...segment, key: 'riveted-gate', tags: ['riveted', 'counter-gate'], height: 0.65 };
        const corner = { ...segment, key: 'riveted-corner', tags: ['riveted', 'counter-corner'], width: 1, height: 1 };
        const pool: RoleIndex = new Map([['counter', [{ ...segment, parts: [corner, brassGate, rivetedGate] }]]]);
        const gate = namedArt({ name: 'hinged counter gate', role: 'counter', tags: ['counter-gate', 'riveted'], width: 1.5, height: 1 }, pool);
        expect(gate?.key).toBe('riveted-gate');
        // Not asking for a part, a counter is never drawn as one.
        expect(namedArt({ name: 'counter', role: 'counter', tags: ['riveted'], width: 1, height: 0.6 }, pool)?.key).toBe('segment');
        // A gate in a finish no gate has is still a gate, of whichever finish there is.
        const oak = namedArt({ name: 'counter gate', role: 'counter', tags: ['counter-gate', 'oak'], width: 1.5, height: 1 }, pool);
        expect(['brass-gate', 'riveted-gate']).toContain(oak?.key);
    });

    it('fits a run of modules with no end pieces whole, every module scaled with it', () => {
        const locker = { ...desk('locker', ['module']), role: 'storage' as const, width: 1, height: 1 };
        const run = runOf(locker, 4, 1);
        const small = run && fittedTo(run, 2, 0.5);
        expect(small).toMatchObject({ width: 2, height: 0.5, run: { count: 4, module: { width: 0.5, height: 0.5 } } });
        expect(small?.run?.cap).toBeUndefined();
    });
});

describe('named pieces', () => {
    it('fits art to the size asked, as large as fits, its back along the width', () => {
        const fitted = fittedTo(desk('a', []), 3, 3);
        expect(fitted).toMatchObject({ width: 3, height: 1.5, scale: 2 });
        // A fitted piece fitted again scales on from where it was.
        expect(fittedTo(fitted, 1.5, 1.5).scale).toBeCloseTo(1);
    });

    it('fits art drawn with depth whichever way round lets it stand larger, since it is never turned', () => {
        // A 1.5 × 0.75 piece asked to fill 1 × 2: as drawn it could only be 1 wide; lying the box the other way, 2.
        expect(fittedTo(desk('a', [], true), 1, 2)).toMatchObject({ width: 2, height: 1 });
        expect(fittedTo(desk('a', []), 1, 2)).toMatchObject({ width: 1, height: 0.5 });
    });

    it('draws a piece in art of its role carrying one of its tags, the same art for the same name wherever it stands', () => {
        const pool: RoleIndex = new Map([['desk', [desk('plain', ['desk']), desk('clerk', ['desk', 'clerk']), desk('terminal', ['desk', 'terminal'])]]]);
        const asked = { name: 'clerk desk', role: 'desk', tags: ['clerk'], width: 1.5, height: 0.75 } as const;
        expect(namedArt(asked, pool)?.key).toBe('clerk');
        // With no tags any art of the role serves, but always the same one for one name.
        const any = { ...asked, tags: [] };
        expect(namedArt(any, pool)?.key).toBe(namedArt({ ...any }, pool)?.key);
        // No art carrying the tag, no role, or a placeholder alone: none.
        expect(namedArt({ ...asked, tags: ['gilded'] }, pool)).toBeUndefined();
        expect(namedArt({ ...asked, role: undefined }, pool)).toBeUndefined();
    });

    it('draws a piece in the art whose tags share most words with its name, among all its tags draw', () => {
        const fitting = (key: string, tags: readonly string[]): RoleStamp => ({ ...desk(key, tags), role: 'fitting', width: 1, height: 1 });
        const pool: RoleIndex = new Map([['fitting', [fitting('vent', ['roof', 'vent', 'stack']), fitting('hatch', ['roof', 'hatch'])]]]);
        const roofTop = (called: string): string | undefined => namedArt({ name: called, role: 'fitting', tags: ['roof'], width: 1, height: 1 }, pool)?.key;
        expect(roofTop('rooftop access hatch')).toBe('hatch');
        expect(roofTop('rooftop vent stack')).toBe('vent');
        // A plural in the name is the tag's word: filing cabinets are a cabinet.
        const cabinets: RoleIndex = new Map([['fitting', [fitting('crate', ['roof']), fitting('cabinet', ['roof', 'cabinet'])]]]);
        expect(namedArt({ name: 'roof cabinets', role: 'fitting', tags: ['roof'], width: 1, height: 1 }, cabinets)?.key).toBe('cabinet');
    });

    it('draws a fitting whole wherever one piece of its art fills what is asked, a run of it only where none does', () => {
        const pipe: RoleStamp = { ...desk('pipe', ['pipe']), role: 'fitting', width: 1, height: 0.5 };
        const pool: RoleIndex = new Map([['fitting', [pipe]]]);
        // A 1.2 × 0.5 piece: one pipe fills it; a shelf there would run as two.
        expect(namedArt({ name: 'pipe', role: 'fitting', tags: [], width: 1.2, height: 0.5 }, pool)).toMatchObject({ key: 'pipe', width: 1 });
        // Six squares of pipe along a wall: a run of six.
        expect(namedArt({ name: 'pipe', role: 'fitting', tags: [], width: 6, height: 0.5 }, pool)?.run?.count).toBe(6);
        // Art whose length runs back from its front never runs: shrunk to the run's depth it would be slivers.
        const partition = { ...pipe, width: 0.3, height: 3 };
        expect(runOf(partition, 9, 0.2)).toBeUndefined();
    });

    it('draws a named piece in art seen from above, which turns to face the way asked, before isometric art', () => {
        const pool: RoleIndex = new Map([['desk', [desk('front-on', ['desk'], true), desk('plan', ['desk'])]]]);
        for (const called of ['clerk desk', 'writing desk', 'desk', 'bureau']) {
            expect(namedArt({ name: called, role: 'desk', tags: [], width: 1.5, height: 0.75 }, pool)?.key).toBe('plan');
        }
        // Isometric art alone still draws it.
        expect(namedArt({ name: 'desk', role: 'desk', tags: [], width: 1.5, height: 0.75 }, new Map([['desk', [desk('front-on', [], true)]]]))?.key).toBe(
            'front-on',
        );
    });

    it('draws a piece in the art closest to its shape among what fills it: a long desk is never a round table', () => {
        const long = desk('long', []);
        const round = { ...desk('round', []), width: 1, height: 1 };
        const pool: RoleIndex = new Map([['desk', [round, long]]]);
        // The round table fitted to 1.6 × 0.8 covers exactly half of it: enough to fill, far from the long one's cover.
        for (const called of ['writing desk', 'clerk desk', 'bureau', 'desk']) {
            expect(namedArt({ name: called, role: 'desk', tags: [], width: 1.6, height: 0.8 }, pool)?.key).toBe('long');
        }
    });

    it('draws no piece in art of another shape: art covering under half the footprint asked leaves it to its box', () => {
        const pool: RoleIndex = new Map([['desk', [desk('counter', ['counter'])]]]);
        // 1.5 × 0.75 art fitted to a 5 × 1 run is 2 × 1: two fifths of it.
        expect(namedArt({ name: 'bar', role: 'desk', tags: [], width: 5, height: 1 }, pool)).toBeUndefined();
        expect(namedArt({ name: 'bar', role: 'desk', tags: [], width: 2, height: 1 }, pool)?.key).toBe('counter');
    });

    it('draws a long piece of a modular role as a run of its art side by side, each as deep as the piece', () => {
        const shelf = { ...desk('unit', ['shelf']), role: 'shelf' as const, width: 1, height: 1 };
        const pool: RoleIndex = new Map([['shelf', [shelf]]]);
        // A 5 × 0.5 shelving run from a square unit: ten half-square units.
        const run = namedArt({ name: 'wall shelving', role: 'shelf', tags: [], width: 5, height: 0.5 }, pool);
        expect(run).toMatchObject({ width: 5, height: 0.5, run: { count: 10, module: { width: 0.5, height: 0.5, scale: 0.5 } } });
        // Not a desk: a desk is one piece, never a run.
        expect(namedArt({ name: 'long desk', role: 'desk', tags: [], width: 5, height: 0.5 }, new Map([['desk', [desk('d', [])]]]))).toBeUndefined();
        // Two modules shrunk to three quarters make 1.5; 1.2 would shrink them further: no run.
        expect(runOf(shelf, 1.5, 1)?.run?.count).toBe(2);
        expect(runOf(shelf, 1.2, 1)).toBeUndefined();
        // A bench drawn with depth never runs (it would read as a scatter of tiny seats); a flat bench segment does.
        const bench = { ...shelf, role: 'bench' as const };
        expect(runOf({ ...bench, upright: true }, 5, 0.5)).toBeUndefined();
        expect(runOf(bench, 5, 0.5)?.run?.count).toBe(10);
    });

    it('stands a run’s modules side by side along its width however it is turned, each with its art’s own turn', () => {
        const shelf = { ...desk('unit', ['shelf']), role: 'shelf' as const, width: 1, height: 1 };
        const run = runOf(shelf, 3, 1);
        if (run === undefined) {
            throw new Error('no run');
        }
        expect(standsAs(run, { x: 10, y: 10 }, 0).map((p) => [p.x, p.y])).toEqual([
            [9, 10],
            [10, 10],
            [11, 10],
        ]);
        expect(standsAs(run, { x: 10, y: 10 }, 90).map((p) => [p.x, p.y, p.rotation])).toEqual([
            [10, 9, 90],
            [10, 10, 90],
            [10, 11, 90],
        ]);
        // A single piece stands as itself.
        expect(standsAs(shelf, { x: 2, y: 3 }, 180)).toEqual([{ stamp: 'unit', x: 2, y: 3, rotation: 180 }]);
    });

    it('draws a long table as a run of trestles when one fitted table would fall well short of it, but never joins round tables', () => {
        const trestle = { ...desk('trestle', []), role: 'table' as const, width: 2, height: 0.9 };
        const round = { ...trestle, key: 'round', width: 1, height: 1 };
        // One trestle fitted to 4 × 0.9 covers half of it: allowed as a whole piece, but two end to end reach all the way.
        const board = namedArt({ name: 'high table', role: 'table', tags: [], width: 4, height: 0.9 }, new Map([['table', [trestle]]]));
        expect(board?.run?.count).toBe(2);
        // A piece its art already reaches stays one piece.
        expect(namedArt({ name: 'side table', role: 'table', tags: [], width: 2, height: 0.9 }, new Map([['table', [trestle]]]))?.run).toBeUndefined();
        // Round tables make no board: one fitted, never a line of them.
        expect(namedArt({ name: 'high table', role: 'table', tags: [], width: 4, height: 1 }, new Map([['table', [round]]]))).toBeUndefined();
    });

    it('carries what a piece reads onto its art, its box, and the one module a run is read at', () => {
        const pool: RoleIndex = new Map([['desk', [desk('plain', ['desk'])]]]);
        const sign = { name: 'shop sign', role: 'desk', tags: [], width: 1.5, height: 0.75, reads: 'OPEN LATE' } as const;
        expect(namedArt(sign, pool)?.reads).toBe('OPEN LATE');
        expect(namedArt({ ...sign, reads: undefined }, pool)).not.toHaveProperty('reads');
        expect(namedBox({ ...sign, role: undefined }).reads).toBe('OPEN LATE');
        expect(standsAs({ ...desk('plain', []), reads: 'OPEN' }, { x: 1, y: 1 }, 0)).toEqual([expect.objectContaining({ reads: 'OPEN' })]);
        const shelf = { ...desk('unit', ['shelf']), role: 'shelf' as const, width: 1, height: 1 };
        const board = namedArt(
            { name: 'notice board', role: 'shelf', tags: [], width: 4, height: 1, reads: 'Curfew at the ninth bell' },
            new Map([['shelf', [shelf]]]),
        );
        if (board === undefined) {
            throw new Error('no run');
        }
        expect(standsAs(board, { x: 10, y: 10 }, 0).map((p) => p.reads)).toEqual([undefined, 'Curfew at the ninth bell', undefined, undefined]);
    });

    it('draws a piece in the variant whose state holds the words asked, a run’s modules with it; as drawn where none does', () => {
        const locker = {
            ...desk('locker', ['locker']),
            role: 'storage' as const,
            width: 0.5,
            height: 0.6,
            states: ['shut', 'shut dented', 'Ajar', 'dented ajar'],
        };
        const pool: RoleIndex = new Map([['storage', [locker]]]);
        const asked = { name: 'tall locker', role: 'storage', tags: [], width: 0.5, height: 0.6 } as const;
        expect(namedArt({ ...asked, state: 'ajar' }, pool)?.variant).toBe(2);
        expect(namedArt({ ...asked, state: 'shut' }, pool)?.variant).toBe(0);
        expect(namedArt({ ...asked, state: 'burning' }, pool)).not.toHaveProperty('variant');
        expect(namedArt(asked, pool)).not.toHaveProperty('variant');
        // Art of one look has no state to draw it in.
        const plain = { ...desk('plain-locker', ['locker']), role: 'storage' as const, width: 0.5, height: 0.6 };
        expect(namedArt({ ...asked, state: 'ajar' }, new Map([['storage', [plain]]]))).not.toHaveProperty('variant');
        expect(standsAs({ ...locker, variant: 2 }, { x: 1, y: 1 }, 0)).toEqual([expect.objectContaining({ variant: 2 })]);
        // A row of them, all in the state asked.
        const row = namedArt({ ...asked, width: 2, state: 'ajar' }, pool);
        expect(row === undefined ? [] : standsAs(row, { x: 5, y: 5 }, 0).map((p) => p.variant)).toEqual([2, 2, 2, 2]);
    });

    it('stands a piece no art draws as a labelled box its size, a free-standing piece of plant when it names no role', () => {
        expect(namedBox({ name: 'drain grate', tags: [], width: 1.2, height: 0.6 })).toMatchObject({ key: 'placeholder:1.2x0.6:drain grate', role: 'machine' });
        expect(namedBox({ name: 'altar', role: 'altar', tags: [], width: 2, height: 1 }).role).toBe('altar');
    });
});
