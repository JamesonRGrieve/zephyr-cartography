// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Architecture rules for zephyr-cartography. Layering (inner → outer):
 *   geometry (pure math)  ←  stamps (pack schema/catalog)  ←  tools (feature models)  ←  canvas (controller/renderer)  ←  foundry (boundary)  ←  entry
 *   ui (DOM views over pure view models) sits beside canvas and is hosted by foundry.
 * Inner layers must never import outer ones.
 */
module.exports = {
    forbidden: [
        {
            name: 'no-circular',
            severity: 'warn',
            from: {},
            to: { circular: true },
        },
        {
            name: 'no-orphans',
            severity: 'warn',
            from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)zephyr-cartography\\.ts$', '\\.test\\.ts$', '\\.stories\\.ts$'] },
            to: {},
        },
        {
            name: 'geometry-is-pure',
            comment: 'Pure geometry must not depend on Foundry canvas or tool state.',
            severity: 'warn',
            from: { path: '^src/geometry/' },
            to: { path: '^src/(canvas|tools)/' },
        },
        {
            name: 'stamps-is-pure',
            comment: 'The stamp engine core (schema, catalog, placement math) is Foundry-agnostic.',
            severity: 'warn',
            from: { path: '^src/stamps/' },
            to: { path: '^src/(canvas|foundry)/' },
        },
        {
            name: 'ui-is-foundry-agnostic',
            comment: 'DOM views render view models and dispatch actions; Foundry and the controller stay outside them.',
            severity: 'warn',
            from: { path: '^src/ui/' },
            to: { path: '^src/(canvas|foundry)/' },
        },
        {
            name: 'generate-is-pure',
            comment: "Generators emit scene specs as data; realising a spec on a scene is the canvas layer's job.",
            severity: 'warn',
            from: { path: '^src/generate/' },
            to: { path: '^src/(canvas|foundry|ui)/' },
        },
        {
            name: 'compose-is-pure',
            comment: 'The composer turns an intent into a scene spec as data; it builds nothing itself, and generators never reach up into it.',
            severity: 'warn',
            from: { path: '^src/compose/' },
            to: { path: '^src/(canvas|foundry|ui)/' },
        },
        {
            name: 'tools-must-not-import-canvas',
            comment: 'Tool/path state is Foundry-agnostic; the canvas layer depends on it, not the reverse.',
            severity: 'warn',
            from: { path: '^src/tools/' },
            to: { path: '^src/canvas/' },
        },
        {
            name: 'no-test-into-prod',
            severity: 'error',
            from: { pathNot: '\\.test\\.ts$' },
            to: { path: '\\.test\\.ts$' },
        },
    ],
    options: {
        doNotFollow: { path: 'node_modules' },
        tsConfig: { fileName: 'tsconfig.json' },
        tsPreCompilationDeps: true,
        exclude: { path: '(\\.test\\.ts$|^dist/)' },
    },
};
