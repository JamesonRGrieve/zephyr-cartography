// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A small demonstration catalog for stories: a few stamps across categories,
 * scales and perspectives, with multi-variant entries. Images are inline SVG
 * data URIs, so stories need no pack assets. It is loaded through the real
 * pack parser, so the fixtures are valid packs by construction.
 */
import { type CatalogStamp, loadPacks } from './catalog';

function swatch(fill: string, label: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="6" fill="${fill}"/><text x="32" y="38" font-size="12" text-anchor="middle" fill="#fff">${label}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const DEMO_STAMPS = [
    {
        id: 'brass-lamp',
        name: 'Brass Lamp',
        category: 'Lighting',
        tags: ['lamp', 'brass', 'setting-grimdark-human'],
        scale: 'interior',
        perspective: 'top-down',
        light: { dim: 4, bright: 2, color: '#ffcc88' },
        variants: [
            { state: 'lit', image: swatch('#c89b3c', 'lit'), width: 100, height: 100 },
            { state: 'unlit', image: swatch('#5a4a2a', 'off'), width: 100, height: 100, light: null },
        ],
    },
    {
        id: 'wall-torch',
        name: 'Wall Torch',
        category: 'Lighting',
        tags: ['lamp', 'fire', 'setting-fantasy'],
        scale: 'interior',
        perspective: 'isometric',
        variants: [{ state: 'burning', image: swatch('#d2531f', 'fire'), width: 50, height: 100 }],
    },
    {
        id: 'bulkhead-door',
        name: 'Bulkhead Door',
        category: 'Doors',
        tags: ['metal', 'heavy', 'setting-grimdark-human', 'setting-modern'],
        scale: 'interior',
        perspective: 'top-down',
        door: { type: 'door' },
        variants: [
            { state: 'closed', image: swatch('#56606b', 'shut'), width: 100, height: 25, doorState: 'closed' },
            { state: 'open', image: swatch('#3a424b', 'open'), width: 100, height: 25, doorState: 'open' },
            { state: 'breached', image: swatch('#7b2e2e', 'hole'), width: 100, height: 25, doorState: 'open' },
        ],
    },
    {
        id: 'supply-crate',
        name: 'Supply Crate',
        category: 'Storage',
        tags: ['metal', 'loot', 'setting-modern'],
        scale: 'interior',
        perspective: 'top-down',
        container: true,
        variants: [{ state: 'sealed', image: swatch('#4f6b3a', 'box'), width: 100, height: 100 }],
    },
    {
        id: 'residence-block',
        name: 'Residence Block',
        category: 'Structures',
        tags: ['residence', 'heavy', 'setting-grimdark-human'],
        scale: 'city',
        perspective: 'top-down',
        enterable: true,
        variants: [{ state: 'intact', image: swatch('#6b6b7b', 'residence'), width: 400, height: 300 }],
    },
] as const;

export function demoCatalog(): readonly CatalogStamp[] {
    return loadPacks([{ moduleId: 'demo-pack', manifest: { schemaVersion: 1, id: 'demo-pack', name: 'Demo pack', stamps: DEMO_STAMPS } }]).stamps;
}
