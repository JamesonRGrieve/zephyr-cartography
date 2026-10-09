# Zephyr's Cartography

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
- **Interiors:** an enterable stamp (a building, a residence block) links to its own
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

In Foundry VTT v14, open Add-on Modules → Install Module and paste the manifest
URL, then enable the module in your world:

```
https://github.com/JamesonRGrieve/zephyr-cartography/releases/latest/download/module.json
```

For the rolling build of `main`, use
`https://github.com/JamesonRGrieve/zephyr-cartography/releases/download/nightly/module.json`.

## Releasing

`.github/workflows/release.yml` publishes every push to `main` as the `nightly`
prerelease. An official release is a `v<semver>` tag equal to `module.json`'s
version (bump, commit, tag, push): once the maintainer approves the `release`
environment it runs the full gate, publishes the GitHub release, and registers
the version on the Foundry package listing (needs the listing's release token as
the environment's `FOUNDRY_RELEASE_TOKEN` secret).

## Development

```bash
pnpm install
pnpm gate    # the full quality gate: format, lint, types, tests, ratchets, build
pnpm build   # Vite → dist/
pnpm test    # Vitest
```

Contributor rules and architecture live in [CLAUDE.md](CLAUDE.md).

## Content and licensing

Zephyr's Cartography is an independent, unofficial tool. It is not affiliated
with, endorsed by, sponsored by or licensed by any game publisher, studio or
other rights holder, and makes no claim of association with any of them.

- **No art.** The module bundles no images or sounds; asset packs carry their
  own, under their own licences.
- **No trademarked or coined names.** Its interface, schemas and presets name
  things in plain words, with generic genre settings ("Grimdark", "Fantasy").
- **No copyrighted text.** No rules text, lore, quotes or stat blocks from any
  game, book or film.
- **No logos, emblems or iconography** of any publisher.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
