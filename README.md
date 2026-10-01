# Zephyr Cartography

Scene authoring for Foundry VTT v14. Paint terrain, draw roads and rivers, and
build structures directly on the canvas. Walls, doors and lights come out as
real Foundry documents, so vision, movement and lighting just work.

It's an open (AGPL) alternative to the paid map tools (FA-Nexus, MapForge,
Dungeondraft, Inkarnate) and runs entirely inside Foundry.

## Features

- **Terrain:** 13 biomes as smoothed regions or freehand brush strokes, with
  soft edges and tiled textures from swappable texture packs.
- **Roads and rivers:** smooth, variable-width paths. Rivers taper at the ends.
  Paths can optionally emit walls along their centreline.
- **Structures:** grid-snapped rooms with floor and wall materials. Each room
  gets native walls and a light, and neighbouring rooms share their walls. A
  door tool turns any wall segment into a Foundry door (ordinary or secret;
  closed, open or locked). Editing a room keeps its walls, doors and light in
  sync.
- **Stamps:** placed as native tiles from asset packs. They are
  structure-aware: occlusion walls traced from the art, light emitters, doors
  that cut room walls, and containers backed by Item Piles. Variants (open,
  lit, broken) switch in place.
- **Levels:** multi-floor scenes on Foundry's native Levels, with per-floor
  walls and vision, and stairs, ladders, lifts and hatches as teleport regions.
- **Interiors:** an enterable stamp (a building, a hab) links to its own
  interior scene, new or existing, with an entrance and an exit.
- **Map builder:** generate a floor plan from a seed, or build any map
  described as a scene spec (a published JSON Schema), from terrain to stamps
  and levels. The result is ordinary, editable features, and one undo step.
- **Editing:** drag control points, set road and river widths per point,
  delete points, erase, undo/redo, reorder.

## Asset packs

Art isn't bundled with this module. Stamps and terrain textures come from asset
pack modules such as `zephyr-cartography-assets`. Packs follow a versioned
schema defined here (`schema/stamp-pack.v1.schema.json`), so anyone can
publish their own. Scene specs have one too (`schema/scene-spec.v1.schema.json`),
so any tool that writes JSON can generate maps.

## Install

Add the module to your Foundry `Data/modules` folder (built output in `dist/`),
then enable it in your world. Requires Foundry VTT v14.

## Development

```bash
pnpm install
pnpm gate    # the full quality gate: format, lint, types, tests, ratchets, build
pnpm build   # Vite → dist/
pnpm test    # Vitest
```

Contributor rules and architecture live in [CLAUDE.md](CLAUDE.md).

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
