# Zephyrex Cartography — Contributor & Agent Protocol

`zephyrex-cartography` is an **AGPL** Foundry VTT v14 module: a **standalone
scene authoring tool**. It paints terrain, draws roads and rivers, builds
structures (rooms, walls, doors, lights), and places **structure-aware stamps**,
all as **native Foundry documents**. It is the open-source take on the best of
**FA-Nexus**, **MapForge**, **Dungeondraft**, and **Inkarnate**.

Art (stamps, terrain textures) is **not** in this repo. It ships in separate
**asset-pack modules**, starting with
[`zephyrex-cartography-assets`](https://github.com/JamesonRGrieve/zephyrex-cartography-assets).
This module owns the engine and the **pack schema** every pack must conform to.

This file is authoritative for this repo. It stacks on the workspace standards
(`/home/jameson/Source/CLAUDE.md`) and the user-level engineering tenets; where
this file is more specific, it wins. **This is a standalone tool:** the checkout
happens to sit inside the `dh-campaign` directory, but that campaign vault and its
`CLAUDE.md` do **not** govern this repo, and nothing here may depend on it.

---

## ⛔ TOP RULES — non-negotiable

1. **Full gates, no shortcuts. Fresh code goes to ZERO — never baseline a
   problem in new code.** Every lint warning, type error, and coverage gap in
   code we write is fixed at the source, not recorded as an accepted floor. The
   ratchets exist to lock a *clean* state in as a hard gate, not to warehouse
   debt. If a rule legitimately does not apply (a genuine framework/parse
   boundary), use a **documented, point-of-use** exception — never a blanket
   disable, file override, or baseline.
2. **Match foundry-system's quality bar exactly.** Its patterns are the
   reference: graduate-at-zero ratchets, `require-await`/`promise-function-async`
   idioms, point-of-use `eslint-disable … -- <rationale>` for real boundaries.
3. **Architecture / dependency / asset-sourcing decisions are the operator's.**
   Surface the specific decision and ask; never infer a default.
4. **AGPL-3.0-or-later. SPDX header on every source file:**
   `// SPDX-License-Identifier: AGPL-3.0-or-later`. Every dependency must be
   licence-compatible. Art lives in asset packs under their own licences.
5. **Commit + push after each feature lands green** (the operator's standing
   cadence for this repo). Work on `main`, never branch. Stage explicit
   pathspecs, `git add <paths> && git commit` in one breath. Never `--no-verify`.
6. **Never invent assets/licences/facts.** Verify a licence before bundling;
   verify a Foundry API (document fields, region behaviour types) against
   fvtt-types before building on it. An empty query result is suspect, not proof.

---

## Code-quality bar — the full gate

`pnpm gate` runs the whole gate serially (CI uses it) and must be green
before a PR. `.husky/pre-commit` fans out everything but the e2e suite in
parallel and must be green before a commit; the e2e suite is a PR and manual
check, never a commit gate (operator decision, 2026-09-25). Every ratchet
is a **one-way valve**: a metric may improve, never regress, and a rule that
reaches zero **graduates to a hard error** (and, for ESLint, flips
`warn`→`error` in `.eslintrc.json`). Baselines are committed alongside the change
that moves them.

Gate members (all wired into `gate` + CI, and all but the e2e suite into
pre-commit):

- **prettier** `--check` (zero diff), **stylelint**, **biome** (`biome:ratchet`, 0 diagnostics)
- **tsc** `--noEmit` (main + `tsconfig.test.json`), **strict:ratchet**, **test:typecheck:ratchet**
- **vitest** with v8 coverage (`pnpm test:coverage`): the full suite, green.
  **coverage:ratchet** holds lines, statements, functions and branches over
  the pure core at or above `.coverage-baseline`; a metric at 100% locks
  there. The Foundry boundary is covered by the e2e suite instead.
- **symmetry** (hard): every `src/ui/*-view.ts` has stories and a story test;
  every core module has a co-located test (or a reasoned entry in
  `.coverage-opt-out.json`); every production module is imported by another
  (tests and stories do not count, so nothing ships unreachable).
- **type-coverage** `--strict` — **locked at 100%** (`type-coverage:ratchet`); fix `any`/casts at the source (prefer a type guard over `as`), never lower the floor to pass
- **lint:ratchet** — 0 warnings; ~94 rules graduated to hard error
- **ts:ratchet** — `any` / `as any` / `@ts-expect-error` / `@ts-ignore` counts at 0
- **knip:ratchet** — no unused files/exports/deps (13 strict categories at 0)
- **deps:ratchet** — dependency-cruiser layering (see Architecture)
- **lockfile:validate** — lockfile resolves only to trusted hosts
- **build** (Vite lib) + **size-limit** (JS bundle only)
- **test:e2e** + **e2e:ratchet** (Tier B): the built module in a **real
  Foundry v14 server** (see "E2E suite" below). No test may fail; the passed
  count and the source coverage the suite reaches (`.e2e-baseline`) may not
  fall. Skipped with a banner where no Foundry release is available (CI).
  Not in the pre-commit hook: run it by hand (`pnpm test:e2e`) or through
  `pnpm gate` before a PR.
- **test:storybook**: Storybook builds, and Playwright renders **every
  story** in its `index.json` in a real browser. Each must mount with no page
  or console errors or failed loads, and match its committed screenshot
  (`tests/storybook/stories.spec.ts-snapshots/`, taken with the system
  Chromium). CI uses Playwright's bundled Chromium and ignores snapshots.
  Refresh baselines deliberately with `pnpm test:storybook --update-snapshots`,
  then look at every changed PNG before committing it.

## E2E suite (Tier B)

`pnpm test:e2e` runs `tests/e2e/*.spec.ts` with Playwright against a real
Foundry v14 server.
- **Server.** Each worker gets its own server, data directory and world on
  port `FOUNDRY_TEST_PORT + slot` (base 30101). `scripts/e2e-world.mjs`
  provisions each one from `tests/e2e/fixtures/`:
  - a rules-free game system;
  - the seed world;
  - a stamp pack with one stamp per behaviour;
  - this module's `module.json` and current `dist/`.
- **Release.** It comes from `FOUNDRY_RELEASE_DIR` (default `.foundry-release`,
  gitignored; a symlink to a licensed release is fine).
  `scripts/foundry-hostname-shim.cjs` makes the local server match the
  licence's hostname. This is a throwaway local instance, never the live
  server.
- **Optional integrations.** Modules in `FOUNDRY_TEST_MODULES` (default
  `.foundry-test-modules`, gitignored) are installed and activated too:
  Item Piles with socketlib and lib-wrapper. The fixture configures Item
  Piles for the e2e system (its Actor type), as a GM would. Specs for an
  integration skip, with a reason, when its module is absent.
- **Specs.** They use the `world` fixture (`tests/e2e/lib/foundry.ts`): joined
  as the Gamemaster, module and pack active, a fresh gridded scene. They drive
  the module through its **public API**
  (`game.modules.get('zephyrex-cartography').api`: `controller()`,
  `buildSpec()`, `generateFloorPlan()`). They assert on the native documents
  Foundry holds.
  - Any page or console error fails the test.
  - Canvas screenshots (`frameScene`, which hides the UI; pass `'walls'` to
    show wall lines) are compared with `toHaveScreenshot`. They are pinned to
    the system Chromium with software GL. Refresh them with
    `pnpm test:e2e --update-snapshots=all`, then look at every changed PNG.
- **Coverage.** The fixture records the module's JS coverage per test.
  `scripts/e2e-coverage.mjs` maps it onto `src/` through the source maps
  (`.e2e-coverage/`), and that covers the Foundry boundary unit tests cannot
  reach.
- **Every roadmap feature lands with an e2e spec** that proves it in Foundry.

## UI views and Storybook

Every DOM view lives in `src/ui/` as a pure function from a view model to
elements. It dispatches actions to a pure reducer, and its view model sits in
the pure core (e.g. `stamps/browser.ts`). The view is built from nodes and
text, never from markup strings. Controls are labelled native elements, and
focus survives a re-render. Views never import `canvas/` or `foundry/`; a thin
ApplicationV2 host in `foundry/` mounts them.

- Each view has a co-located `*.stories.ts` (Storybook 10, `@storybook/html-vite`,
  a11y addon with `test: 'error'`). Stories run the real reducer, so they stay
  interactive. They use `stamps/fixtures.ts` (inline-SVG demo packs), never
  pack assets.
- Foundry's CSS is not redistributable. `.storybook/chrome.css` stands in for
  the window chrome, and stories wrap views in `.zephyrex-cartography` so the
  `tw-` utilities apply.
- A co-located `*-view.test.ts` mounts every story under vitest, so stories
  cannot rot, and `pnpm test:storybook` renders and screenshots every story
  in a real browser (see the gate). `pnpm storybook` runs the dev server.
- Tailwind's preflight is off: it is a global element reset and would restyle
  Foundry's own chrome.

CI (`.github/workflows/ci.yml`) runs `pnpm gate` then `git diff --exit-code` — a
ratchet that had to mutate a baseline means the gate was not run locally, and
fails the build. Ratchet run-report JSONs are gitignored; the `.*-baseline`
files are the committed source of truth.

**Package manager: `/home/jameson/.local/bin/pnpm`** (corepack pnpm is broken on
this box; use the absolute path — `~` may resolve to an ai-switcher session HOME).

---

## Architecture — hexagonal, pure core + thin boundary

Layering (inner → outer; enforced by dependency-cruiser):
`geometry` (pure math) ← `tools` (feature models, pack schema) ← `canvas`
(controller, renderer) ← `foundry` (document/PIXI boundary) ← entry.

- **Pure, unit-tested core** — `src/geometry/`, `src/tools/`, `src/canvas/`.
  No PIXI/Foundry imports. Every non-trivial pure unit has a test; this core
  carries the 100% type-coverage. Rendering and persistence are injected as
  interfaces (`DrawSurface`, `SceneStore`, `WallEmitter`, `LightEmitter`) so the
  whole flow is tested with fakes.
- **Thin Foundry/PIXI boundary** — `src/foundry/*` and the entry
  `src/zephyrex-cartography.ts`. The *only* code that touches Foundry globals.
  Kept minimal and **not unit-tested** by design. Bridge over-strict library
  types here with point-of-use documented exceptions:
  - `unknown` at a real parse/framework boundary → `// eslint-disable-next-line no-restricted-syntax -- boundary: …`.
  - `FoundryScene` mirrors `Scene`'s **methods** (not function properties) so the
    live document is structurally assignable — a scoped `method-signature-style`
    exception, documented in `foundry/boundary.ts`.
  - The one `scene as FoundryScene` bridge in the entry carries a documented
    `no-unnecessary-type-assertion` disable and `type-coverage:ignore-line`.
- **Single sources:** the module id lives only in `src/module-id.ts` (flag
  scope, settings namespace, served path). Every localisation key lives only in
  `src/i18n.ts`; `i18n.test.ts` asserts it matches `src/static/lang/en.json`
  exactly (no missing, no unused keys). `src/static/` is copied into `dist/`.
- **Persistence:** features live on the scene as the `zephyrex-cartography.features`
  flag. Parsing is **defensive and total** — parsers validate shape and drop
  malformed entries, never throw; new fields are optional with defaults.

---

## Generated native documents — the lifecycle rule

Walls, doors, lights, tiles, regions and scenes are **native Foundry documents**.
The plugin never keeps a parallel model of them; Foundry owns vision, movement,
door controls, lighting and navigation. **Every feature that generates documents
tracks their ids in its own scene-flag record**, so create / update / delete are
idempotent. Editing or removing a feature re-syncs *its* documents and never
orphans them or touches hand-placed ones. **Linking to an existing scene**
(hand-built or created by another tool) only **adds** the plugin's own documents
plus a link flag. It never rewrites content the plugin did not create.

---

## Feature scope and status

**Scene controls [done]:** a tool that makes a native document type sits in
that type's own control group, after Foundry's tools
(`canvas/tool-placement.ts`).
- **Walls:** room, door and materials. **Tiles:** stamp. **Lighting:**
  link. **Regions:** zone and effects, with edit and erase. **Notes:** pin,
  with edit and erase. **Drawings:** label, with edit and erase. Edit and
  erase appear in the Walls and Tiles groups too, so what a group draws can
  be reshaped there.
- **The module's own group** keeps what has no native home: roads, rivers,
  the paint tool, edit, erase, undo/redo, levels and the generator.
- **Tool panels.** A tool with choices opens its panel when picked, and the
  panel's choices are what the tool draws next. The **paint tool** is one
  tool for every terrain texture: its panel is a swatch grid of the biomes
  (each shown in the active set's texture, or its flat colour) and a brush
  size.
  - It is a **round brush**: its outline, the brush's size, follows the
    pointer on the map (drawn above everything the layer draws, a
    screen-constant light ring inside a dark one).
  - A press paints at once: a click leaves a round dab (a one-point
    stroke), and a drag paints on along the pointer, drawn in its real
    texture as it goes. Release commits the stroke (one undo step), also
    when released off the layer.
  - Polygon areas (`region`) are built from the scene spec and the
    generator, not by the paint tool.
  - **Texture.** Painted ground (strokes and regions) has a biome, which
    says what the ground is (its terrain region, colour and cost), and a
    `texture`: any role of the active set (a pack's `floor.*` variant,
    another biome's), or null for the biome's own. A role the active set
    lacks draws as the biome's own. The paint panel's Texture section
    (titled with the texture in use) picks it from every texture the set
    has, and picks the texture set itself (the world `textureSet`
    setting) when the packs offer more than one. Blending lays the chosen
    texture into the splat map too, since channel roles are any texture.
    The scene spec's regions and strokes take `texture`.
- **Roads and rivers.** Their panel sets the next path's width. Water,
  lava, poison and acid are all the **river tool**: the panel picks the
  liquid (which resets the shade and bed to that liquid's own), its shade,
  and the texture of the **bed** laid beneath it, wider than the river and
  feathered (or none). A river is drawn in the first of its liquid's
  texture roles the active set has (`water`, `floor.shallow-water`, …),
  tinted by the shade, and the scene spec's paths take `liquid`, `shade`
  and `bed`.
- **No flat fills.** Anything the active set has no texture for (a biome,
  a material, a bed, a liquid) is drawn in a seamless procedural pattern
  (`tools/procedural.ts`: ripples for liquids, grain for the rest) tinted in
  its colour.
- **Texture tiling.** Every textured fill, painted ground and splat blends
  alike, tiles from the **scene's origin**, never its own corner, so
  overlapping fills of one texture meet without a seam. A tile spans
  `TEXTURE_TILE_SQUARES` (2) grid squares whatever the image's own size
  (`tileSpan`; its own size on a gridless scene), which keeps full-detail
  photos sharp. Terrain textures are mipmapped (PIXI mipmaps only
  power-of-two images by default) and wrap. A feathered fill blurs only its
  **mask's** edge (rendered to a texture); blurring the fill would smear the
  texture itself. The splat shader runs in high precision: medium precision
  rounds large scene coordinates to whole texels.
- **Names.** Tools in a native group are named `zephyrex-<tool>`, so they
  never clash with Foundry's own (Walls has `doors`).
- **Inert native layers.** The tools set none of `interaction`, `creation`
  or `control`, so the native layer creates and selects nothing while one
  is active.
- **Redraws.** A canvas redraw re-activates the native layer with its tool
  still selected, and the draw layer picks the tool straight back up.
- **Two layers.** The painted map (terrain, paths, room floors, splat
  blends) draws in Foundry's **primary group** (`foundry/terrain-layer.ts`),
  as a map background does: at the viewed level's floor, between the level's
  images (sort layer SCENE, 0) and its tiles (TILES, 500). So stamps, drawings
  and tokens stand on it, and lighting and fog of war fall over it. Drawn on
  the stage above everything, it buried every stamp (once land was opaque)
  and showed through the fog. The module's own **draw layer** stays on the
  stage, above it all: it takes the pointer and shows the brush outline, link
  lines and nothing else. `tests/e2e/canvas.spec.ts` checks a stamp's tile
  sorts above the terrain.
- **Pointer.** While a tool is active, the draw layer has a hit area over the
  whole scene. Without it, a bare container is hit only through what it has
  drawn, so clicks on empty canvas would never reach it. While idle it takes
  no events.
- **Left presses.** A tool's left press stops at the draw layer: reaching
  the stage, Foundry would also run its own gestures on it, such as the
  Shift long-press ping that pulls every view. The right button still pans.
- `tests/e2e/pointer.spec.ts` drives every tool with the real mouse from its
  group.

**Terrain & paths [done]:** click + freehand paths (Catmull-Rom, RDP), variable
width ribbons ending square at full width (roads and rivers alike), 13-biome
regions, freehand brush strokes shaped as a round brush leaves them (the
swath rounded off at both ends, a single point a round dab; their terrain
region matches), feathered edges, scene-anchored tiled textures from
selectable packs, control-point editing, eraser,
undo/redo, z-order, wall emission along paths.

**Structures [done]:** grid-snapped rooms with floors; perimeter walls as native
`WallDocument`s; wall re-sync on edit; doors (`WallDocument.door`) via a door
tool; an auto `AmbientLightDocument` per room at its centroid.

**Stamp engine [done]:**
- **Pack schema** (versioned, owned here — see below) that every asset pack's
  stamp catalog must validate against. Pack modules are discovered by flag.
- **Placement** as native `TileDocument`s from the browser (click, drag or
  double-click). A placed stamp records its image, footprint and behaviour at
  placement. Variants cycle in place from the Tile HUD, and GM edits to the tile
  (move, resize, rotate, delete) flow back into the feature.
- **Occlusion walls:** `bounds` wraps the rotated footprint; `alpha` traces the
  image once per variant (marching squares), falling back to bounds.
- **Light emitters:** `light` emits a native AmbientLight that follows the
  variant (`light: null` = unlit), the stamp's position and its rotation.
- **Doors:** a door stamp emits its door wall along its long axis in the
  variant's state and cuts collinear room walls; placing it snaps it onto the
  nearest room wall. A door opened in play switches the stamp's variant.
- **Terrain texture sets** come from packs (world `textureSet` setting).
- **Containers:** with Item Piles active (optional, `recommends`), a
  `container` stamp is backed by an Item Piles `container` pile over its
  footprint. The pile is kept when emptied, follows the stamp, and is deleted
  with it. The Item Piles API was verified against its v3.3 source.
- Stair and ladder `transition` stamps belong to Levels.

**Levels [done]:** native Foundry, no Levels module.
- **Model.** A scene's floors are elevation bands (`tools/levels.ts`). Every
  feature has a `level` (null shows on every level). Its documents take that
  level's floor elevation and level id.
- **Editing.** The GM edits one level at a time from the levels panel (pick,
  add above or below, rename, set band, remove when empty). Only that level's
  features, plus level-less ones, are drawn and pickable.
- **Stairs.** `transition` stamps (stairs, ladder, lift, hatch; up, down or
  both) generate one native `changeLevel` region over the stamp. It sits on
  the stamp's level and each adjacent level it reaches, spanning their bands.
  A token entering it is offered the other levels and keeps its height above
  the floor.
- **Native.** Levels *are* the scene's native Level documents. Walls, tiles,
  lights and regions get `levels`, so vision is per floor. Submap teleports
  use `destinations`, `placement: relative` and a choice when there are
  several.

**Submaps [done]:** an enterable stamp (a building, a hab) gets an "Interior"
button on its Tile HUD. The GM either creates a new interior scene (gridded like
the current one) or **links an existing one**, imported scenes included.

- **Regions.** The link fixes both region ids up front, so each teleport can
  name the other across scenes. The entrance sits over the stamp; the exit is
  one square at the interior's centre, for the GM to move.
- **Lifecycle.** The entrance follows the stamp (moves keep its id). The exit
  is deleted with the stamp or on unlink; the interior scene itself is always
  kept.
- **Levels.** An exit in a multi-level interior sits on that scene's initial
  Level, as teleports require.

**Undo/redo [done]** carries the scene with it. Features an undo or redo drops
are discarded (documents, container pile, interior exit). Features it brings
back are revived: documents recreated, a fresh pile, and the exit rebuilt under
its fixed id. Changed features re-sync from their live documents.

**Shared walls [done]:** rooms on the same floor never double a shared edge.
The earlier room (in feature order) owns the shared stretch and the later room
cuts it out. The stretch is a door if either room marks it. When a room is
added, moved or removed, only the neighbours whose planned walls change are
re-synced.

**Room doors [done]:** each room door has a Foundry type (door, secret) and
state (closed, open, locked). A bare segment index, the original format,
parses as a closed door.
- The door tool turns a wall into a door, and clicking an existing door opens
  the door panel to set type and state or remove it.
- A door changed in play is recorded on its room without recreating walls, so
  later re-syncs keep it as left. Each room wall doc carries its perimeter
  `segment` for that mapping.

**Per-point path width [done]:** in edit mode, Shift-dragging a road or river
control point sets that point's half-width to its distance from the pointer.
It previews live and is clamped to a visible minimum.

**Terrain as Scene Regions [done]:** an opt-in world setting (`terrainRegions`,
off by default). Each biome region and brush stroke gets a Scene Region over
exactly what is painted, named after its biome and on its level's band. They
carry no behaviours: GMs and systems attach their own (difficult terrain,
weather and so on). Toggling it, or loading a scene last edited under the
other setting, re-syncs only terrain that disagrees. Only the active GM writes.

**Room nesting [done]:** a room inside another room on the same level (a closet
in a hall) always draws above the room containing it and is picked first,
whatever the drawing order. Nesting is derived from geometry on every draw
(`tools/nesting.ts`), never stored, so edits cannot leave it stale.

**Room materials [done]:** a room's floor is a biome or a pack `floor.<name>`
texture role; its walls are either not drawn or a textured band along the
perimeter in a `wall.<name>` role (`tools/materials.ts`). The materials tool
sets both on a clicked room, and they are the defaults for new rooms. The
choices are whatever the active texture set provides. A role the set lacks
draws as flat colour. Materials are visual only: the native walls and doors
are the same whatever the wall material.

**Generative map builder [done]:** real maps are built *declaratively* with
this module's own tools, not by generating images.
- **Scene spec.** A map as data (`generate/spec.ts`, published as
  `schema/scene-spec.v1.schema.json`, same rules as the pack schema). It holds
  terrain regions and strokes, paths, rooms with doors and materials, stamps
  with interiors, and levels. Coordinates are in grid squares or scene px.
- **Realising.** `canvas/realize.ts` builds a spec through the controller's
  public API, exactly as the GM's tools would, so the result is ordinary,
  editable features. The whole spec is one undo step (`controller.batch`).
  Anything it cannot build (a missing stamp, an interior it cannot link) is
  reported, not thrown.
- **Floor-plan generator.** `generate/floor-plan.ts` is seeded and
  repeatable. It partitions a footprint into rooms wall to wall and crosses
  every split with a one-square door, so every room is reachable, plus an
  optional entrance.
- **Map builder window.** It generates a plan (seed, size, room sizes,
  entrance; rooms take the materials tool's current materials), or builds any
  pasted spec. A generated plan's spec lands in the spec box for editing. The
  spec's origin is the scene's top-left corner.
- **Declarative-first rule (still binding):** every tool's effect must be
  expressible as data and applied through the pure controller API. No
  behaviour may exist only in pointer/UI handlers. A new feature needs a
  scene-spec entry and a realiser test before it is done.

---

## Foundry v14 coverage — the roadmap

The goal is **full use of Foundry v14's scene features**.
- **Sources.** The list comes from comparing what the plugin generates with
  the v14 document schemas and region behaviours in the 14.359 source
  (`common/documents/*.mjs`, `common/constants.mjs`,
  `client/data/region-behaviors/`), and from the v14 release notes, 14.349 to
  14.368 (read 2026-09-23).
- **Checking.** The live server and the local reference source
  (`pull-foundry.sh`) are both 14.368, the latest stable (2026-09-24).
  Verify every feature against that source before building on it.
- **Closing a gap** means exposing the option everywhere it applies:
  - the engine's plan and document specs, and the Foundry translation;
  - the stamp pack schema (additive v1 fields);
  - the scene spec;
  - the UI.
  Release numbers in brackets say where a feature arrived.

Work down the priorities in order.

### Priority 0: v14 semantics the engine must respect [fixed]
- **Tile anchor.** A v14 tile's `(x, y)` is its *anchor* point, and it
  rotates about the anchor (`TileDocument#shape` is a `RectangleShapeData`,
  14.349). The core's frames are an unrotated top-left, so `tileCreateData`
  sends the centre with an explicit 0.5 anchor, and `tileFrame` converts a
  tile back through whatever anchor it has.
- **Level deletion (14.361).** Deleting a Level deletes every placeable that
  exists only on it. `reloadLevels` drops the features of a missing level,
  and removes them from the undo history too, so nothing is revived onto a
  level that is gone. Only the active GM does this; other clients re-read.

### Priority 1: engine foundations
These make everything after them cheaper and safer, so they come first.
- **[done] Atomic writes with `foundry.documents.modifyBatch(operations)`**
  [14.349; broadcasts to every client since 14.353]. It applies many create,
  update and delete operations as one database transaction.
  - Every edit is one controller transaction: with its dependent re-syncs,
    and likewise an undo, a redo, a batch and a built spec.
    `canvas/staged-changes.ts` stages its document changes, and the
    `DocumentSink` (`newId`, `write`) writes them as a single `modifyBatch`.
  - Operations cannot use each other's results, so every document gets its
    id up front and is created with `keepId`.
  - Removing a document created earlier in the same transaction cancels the
    create. A re-sync that plans as many tiles, or walls, as the feature
    has updates them in place, keeping their ids: a door or switch a player
    just used is never deleted from under them. A revived feature forgets
    its deleted ids first, so its documents are recreated.
  - Foundry's dry run drops updates that change nothing, and a batch left
    with nothing to write also resolves to no results; that is not a
    rejection.
  - Foundry rejects a batch that deletes and recreates one id. So a written
    region replaced under its own fixed id (a submap entrance following its
    stamp) is an update that leaves its behaviours alone.
  - Foundry reports a rejected batch only as an empty result, so
    `scene-bridge.modifyBatch` throws on it. Then the transaction rolls the
    features, the store and the undo history back to where it began.
    Side effects outside the scene's documents are not rolled back: another
    scene's exit, a pile or a level.
- **[done] Name every generated document** after its feature, for
  Foundry's Placeables sidebar tab and palette [14.354, 14.355]. Tiles take
  the stamp's pack name, which the stamp keeps. Lights are "<stamp> light" or
  "Room light". Regions describe what they connect or cover
  (`foundry/document-names.ts`). v14 walls have no name.
- **[done] Generated regions are `locked`** with visibility `LAYER`, since a
  feature owns their geometry. An interior exit stays unlocked for the GM to
  place. (From 14.356 the default visibility for non-template regions is
  only on the Region layer when unlocked, which would hide a locked region.)
- **[done] Level bands from the grid.** A new level is 4 grid squares
  tall, as Foundry makes them [14.368] (`levelHeightFor`). The entry sets
  the controller's `levelHeight` from the scene's grid distance, and a
  native Level with an open top is closed at that height.
  `DEFAULT_LEVEL_HEIGHT` is only the fallback for a scene with no grid.
- **[done] Emitter elevation.** Lights and sounds are no longer unbounded
  vertically; they reach by elevation and level [14.353, 14.355]. A stamp's
  light and sound sit on its level, at that level's floor plus the stamp's
  own elevation, and `tests/e2e/emitters.spec.ts` proves it in Foundry. Any
  new emitter (particles) follows the same rule and gets the same proof.
  A fresh v14 scene already has a default Level; nothing may assume level
  bands start at 0.
- **[done] Level-aware helpers for the UI** [14.364].
  - `TokenDocument#locatedInLevel`: a zone offers to move with the tokens
    Foundry locates on its own level (all of them for a zone on every level),
    and keeps the one it follows listed wherever that token has gone.
  - `PlaceableObject#isFilteredOut` reflects only the Placeables sidebar's
    filter over Foundry's own placeables. The plugin's features are drawn on
    its own layer, not as placeables, so nothing here uses it.

### Priority 2: native levels
- **[done] Stairs → `changeLevel`.** A transition stamp makes one region
  spanning the levels it joins, with a `changeLevel` behaviour: Foundry asks
  the token which level to take. Teleport stays for submaps, which cross
  scenes. `RegionDoc.behaviour` is a `teleport` / `changeLevel` union, and
  Priority 5 extends it. `tests/e2e/levels.spec.ts` proves it in Foundry.
  - **[done] Movement actions** [14.361]. A transition's `movement` (pack
    schema) lists the movement actions that take it, and becomes the
    behaviour's `movementActions`. Omitted or empty means any action, as
    Foundry reads an empty set, so stairs stay walkable by all while a
    ladder can say `climb`. A building's floor stairs take any.
    `tests/e2e/levels.spec.ts` reads the live behaviour back.
- **[done] Floors → `defineSurface`** [14.353]. It gives a region a surface
  at its bottom, top or both that restricts light, movement, sight and sound
  and causes occlusion or exposure.
  - A room on a level with another below gets a floor: a flat region over
    the room at its level's base, on both levels (`RegionDoc.spans`), whose
    surface restricts everything and occludes. So the level below cannot be
    seen, heard, lit or walked through.
  - Foundry refreshes its surfaces when one comes into view, meaning a level
    it is on is viewed, so the e2e check in `tests/e2e/levels.spec.ts` views
    each level before `Scene#getSurfaces`.
  - **[done] Roof stamps and reveal.** A stamp's `surface` becomes a Define
    Surface region over its footprint, from its base up its physical height
    (its level's band when the height or the grid is unknown), at the
    bottom, top or both. `reveal` is Foundry's **Reveal Elevated Surface**
    [14.355] (`exposure` in the behaviour's data): roofs and balconies stay
    hidden from observers almost directly below.
  - **[done] Room ceilings.** A room on a level with another above gets a
    ceiling: the floor's mirror, a flat region at its level's top on both
    levels, whose `top` surface restricts everything and occludes. A room's
    `ceiling` (a room material: the materials panel, the scene spec and the
    floor-plan generator) is on by default. Turning it off leaves an open
    courtyard. `tests/e2e/levels.spec.ts` proves it with `Scene#getSurfaces`.
  - It pairs with the tile **SURFACE** occlusion mode (Priority 4).
- **[done] Per-level images.** A `Level` carries its `art`: the native
  Level's `background`, `foreground` and `fog` image paths. The levels panel
  sets each by typing a path or with Foundry's file picker, and a scene spec
  level entry sets them too. Art never re-syncs features: `planningLevels`
  leaves it out.
  - **[done] The rest of the Level's look.** `LevelArt` holds everything
    the native Level draws with: the background colour, the background and
    foreground tints and alpha thresholds, the images' placement
    (`textures`: anchor, offset, fit, scale, rotation) and the other levels
    seen from it (`visibility.levels`).
    - Each row of the levels panel has a Look section, closed until
      opened, that sets them. Typed values are checked first
      (`editLevelArt`).
    - A scene spec level takes them too, defaulting to Foundry's own
      values, with `visibleLevels` naming other levels by key.
    - The fog is an image alone: 14.359 gave it a tint, and 14.364's Level
      schema dropped it, so the engine no longer offers one.
- **[done] Level preloading** [14.364]. Each row of the levels panel has
  Foundry's own Preload, which loads that level's art on every connected
  client (`Scenes#preload` with the level and `broadcast`, as the scene
  navigation's Preload does) before the party climbs to it.
  `tests/e2e/levels.spec.ts` sees the call reach Foundry.
- **Buildings: interior scene or upper levels.** A building can open into a
  separate interior scene (submaps) or have its floors as Levels of the same
  scene. That is the GM's choice per building (operator decision,
  2026-09-23): the Interior panel offers both, "Interior scene" and "Floors
  in this scene". The floors option adds Levels above the building's own and
  a stair region over its footprint joining them, all in one scene.
  - **[done]** A stamp's `floors` lists its floor Levels. `addBuildingFloors`
    stacks one Level per name above the scene's top; a building on every
    level then stands on the lowest. The plan adds one `changeLevel` region
    over the footprint joining its level to every floor still on the scene.
    Removing the stairs keeps the Levels, for the GM to delete when empty.
    The scene spec's stamps take `floors` (their names). Proven in
    `tests/e2e/levels.spec.ts`.
- **Tests and validation** use `Scene#getSurfaces` and
  `Scene#testSurfaceCollision` [14.355, 14.356] to check floors and walls.
- **Region constraints stay current without the engine** (checked in 14.368).
  A restricted region is clipped to the walls and sources on its level, and
  Foundry recomputes that itself (`Level#updateRegionShapeConstraints`,
  14.365) whenever a wall, light or token on the level changes, walls
  written in the engine's batches included, and on scene updates. A level's
  band is not an input, so the engine never calls it.

### Priority 3: full wall and door options
- **[done] Senses, one-way walls and thresholds.**
  - Stamp occlusion walls take the whole `EDGE_SENSE_TYPES` range per sense
    (NONE, LIMITED, NORMAL, PROXIMITY, DISTANCE), movement on or off, `dir`,
    and `threshold` (light, sight and sound distances, and `attenuation`).
  - **Rooms** take a wall kind: Foundry's own Walls palette presets (solid,
    terrain, invisible, ethereal, window), mirrored exactly in
    `tools/wall-presets.ts`. It is set in the materials panel, named with
    Foundry's own strings, and in the scene spec (`wallKind`), and the
    floor-plan generator passes it on. A room's doors still block everything
    while shut.
  - **[done] Path walls** take a kind too, or none: a road or river's
    `walls` is a wall preset or null (a persisted `true`, the original
    format, is solid). The road and river panel picks it, with Foundry's
    names, and the scene spec's paths take a kind or a boolean.
- **[done] Door sounds and animation.** A door wall carries a `look`: a
  `CONFIG.Wall.doorSounds` key and an animation, each null for Foundry's
  default. These become the Wall's `doorSound` and `animation`.
  - Door stamps declare theirs in the pack schema, with the animation's
    type, direction, double, duration, flip, strength and leaf texture.
  - Room doors pick a sound and an animation type in the door panel, from
    Foundry's own lists, and the scene spec's room doors take both.
  - **[done]** A door stamp's animation takes a `texture`: the door leaf
    image Foundry animates, served from its pack. Door types and states are
    complete. Room doors keep Foundry's default leaf.
- **[done] No blank walls.** Foundry groups walls that block nothing as
  "Blank Walls" [14.361]. The engine never emits one. A stamp whose walls
  would block nothing gets none, and every room wall kind blocks something.

### Priority 4: tiles and lights
- **[done] Stamp tiles** take their pack's `tile`:
  - `alpha` and `hidden`;
  - `occlusion`: `modes` is a set of `CONST.OCCLUSION_MODES` [14.355]: FADE
    1, SURFACE 2, RADIAL 4, VISION 8. With `alpha`, it makes roofs and
    canopies give way to tokens beneath them;
  - `texture.alphaThreshold` [14.359];
  - `restrictions` (`light`, `weather`);
  - `video` (`loop`, `autoplay`, `volume`).
  Anything the pack leaves out stays undefined and takes Foundry's default.
- **[done] Lights** take:
  - `walls` and `vision`;
  - in `config`: `negative` (darkness sources), `priority`, `coloration`,
    `attenuation`, `luminosity`, `saturation`, `contrast` and `shadows`.
  - `coloration` maps to `AdaptiveLightingShader.SHADER_TECHNIQUES` ids. Those
    run 0–10, then 100 (Natural Attenuation) and 101 (Adaptive Attenuation)
    [14.349], so they are not an index into the list.
  - These come on top of dim, bright, colour, alpha, angle, rotation and
    animation.
  - **[done]** `hidden` (placed hidden from players) and the `darkness`
    range the light is active in (`config.darkness`, 0–1, min ≤ max; a lamp
    that lights only at night). Both are optional pack fields.
- **[done] Light switches that players click.** A switch is a stamp the engine
  treats as a door: its variants are its on and off states, and it has a
  native door wall that blocks nothing (every sense `none`, movement off).
  - **In play.** Players use Foundry's own door control. v14 lets a player
    change a door's state (`wall.mjs`), and it handles the `WALL_DOORS`
    permission, the pause, sound and visibility. The existing door-state
    hook runs on the active GM. It turns the switch to its matching variant
    and toggles every linked target in one atomic write. No socket.
  - **Targets.** A switch lists what it controls:
    - lamp stamps, switched to their lit or unlit variant, so the art,
      particles and sound follow;
    - a room's generated light;
    - plain AmbientLights, through their native `hidden` field.
  - **Linking.** The link tool, with the Lighting tools, picks a switch,
    then clicks targets to add or remove them, and draws link lines while
    it is active. Removing a target drops it from its switches, and undo
    and redo follow the usual rules. `tests/e2e/switches.spec.ts` and
    `pointer.spec.ts` prove it in Foundry.
  - **[done] Scene-spec links.** Any spec feature can have a `key`. A
    switch stamp's `controls` names lamps and rooms by key, and its
    `lights` names AmbientLights already on the scene by id. The parser
    rejects duplicate keys and keys that name nothing. Links are made once
    everything is built, so a switch may come before what it controls. A
    target that cannot be linked is reported as a `switch` problem.
  - **[done] Switch icon.** A switch's wall carries the module's
    `lightSwitch` flag. At `setup`, the module subclasses whatever
    `CONFIG.Canvas.doorControlClass` is configured, so another module's
    override still applies to other doors. A flagged wall's control shows
    Foundry's own `CONFIG.controlIcons.light` while on (door open) and
    `lightOff` while off. A switch placed before this gains the flag when
    its walls next re-sync.

### Priority 5: regions
- **Shapes beyond polygons** [14.349, 14.352, 14.356]:
  - rectangle, circle, ellipse, cone, ring, line, emanation and token;
  - **grid** (`GridShapeData`): an arbitrary set of grid cells.
  Shapes other than polygons can be grid-based.
  - **[done] Rectangles.** Any generated region whose outline is a
    rectangle becomes Foundry's own rectangle shape, centre-anchored and
    turned by its rotation (`geometry/rectangle.ts`, `regionShape`). That
    covers rooms, a door's split points and all, and every stamp footprint
    region, rotated ones included. So the GM edits it as a rectangle.
    Anything else stays a polygon.
  - **[done] Zones.** A `zone` feature (`tools/zone.ts`) is a Scene Region
    in one of Foundry's own shapes, placed at a point: circle, ellipse,
    ring, cone (round, flat or semicircle), line or rectangle.
    - It has a rotation, `gridBased`, a name and sizes in px. A cone or
      line starts at the point; the rest are centred on it.
    - It is an area, so it takes a movement cost, effects and a display,
      and its region is always there.
    - Sizes Foundry refuses are rejected: a ring's band reaching past its
      centre, or a cone wider than its curvature allows (90° flat, 180°
      semicircle).
    - It is picked by its exact shape, moved by its point with edit, and
      erased like any feature.
    - The **zone tool** sits with Foundry's Regions tools, beside effects,
      edit and erase. Its panel is named in Foundry's shape and Region sheet
      strings, and picking another shape keeps about the same size.
    - The scene spec takes `zone` entries sized in its units, and rejects a
      shape Foundry would refuse.
    - Proven in `tests/e2e/pointer.spec.ts`.
  - **[done] Grid spaces.** A zone's `cells` shape is Foundry's
    `GridShapeData`: whole spaces of a square grid, by row and column.
    - The spaces are relative to the cell the zone's point is in, so the
      zone moves by whole cells. The shape records the cell size it was
      made on, which keeps hit testing and the absolute offsets pure.
    - The zone panel offers it only on a square grid, as a block of rows by
      columns.
    - The scene spec lists any spaces and takes the scene's cell size
      whatever its units, and it rejects a space named twice.
    - `tests/e2e/structures.spec.ts` checks the offsets and Foundry's own
      region geometry.
    - This is how ground difficult square by square is drawn. Smoothed
      painted terrain has no cell outline to give.
  - **[done] Emanations.** A zone's `emanation` shape is a radius round its
    attached token's own footprint: Foundry's `EmanationShapeData` on a
    `TokenShapeData` base, as `createTokenEmanation` makes.
    - The footprint is read off the live token when the region is written
      (`RegionContext.tokenOf`). Foundry refits the shape as the token
      moves, and the zone follows the footprint's centre.
    - Without a token it is a circle at the zone's point.
    - `tests/e2e/structures.spec.ts` moves the token and checks Foundry's
      own geometry.
    - The bare token shape is the footprint alone, which an emanation of
      the smallest radius already covers. It is not a separate kind.
- **Region fields**:
  - **[done]** `color`: every generated region is coloured by what it is
    (`tools/region-colours.ts`), terrain in its biome's colour, instead of
    Foundry's random pick;
  - **[done, corrected] Impassable stamps.** A region's `restriction`
    does not bar tokens. It clips the region's own shapes to walls of its
    type, cast from each shape's origin like a light (14.359
    `_computeShapeConstraints`). So a stamp whose `physical` says
    `blocksMovement` gets movement-only walls round its footprint instead
    (Foundry's Invisible Wall), unless its occlusion walls already bar
    movement. `tests/e2e/stamps.spec.ts` runs Foundry's own move collision
    test through it.
  - **[done] Area region display.** An area's `display` sets its region's
    `visibility` (Foundry's LAYER, GAMEMASTER, OBSERVER or ALWAYS; never
    LAYER_UNLOCKED, which hides a locked region), `highlightMode` (true
    shapes or covered grid spaces), `displayMeasurements`, and
    `restriction`: the region shaped by walls of one type (light, darkness,
    sight, sound or move) with a `priority`, so an effect stops at walls.
    - **[done] `ownership`.** `observed` makes every player an observer of
      the region (default ownership OBSERVER), which is what Foundry's
      "Always for Observers" visibility tests. A generated region is
      recreated on re-sync, so ownership lives on the feature, not the
      document.
    - Foundry restricts only a region on exactly one level and refuses the
      create otherwise, so a restriction is sent only then.
    - An area with a display other than the default gets its region.
    - The effects panel's Region section sets it, in Foundry's Region sheet
      strings. The scene spec's regions, strokes and rooms take `display`.
      `tests/e2e/structures.spec.ts` checks the real Region.
  - **[done] `hidden`** [14.360]: the region is the GM's alone and its
    behaviours do nothing until it is shown, for a trap or an ambush the GM
    springs. An area's display carries it (default off). The effects panel's
    Region section and the scene spec's `display` set it; Foundry has no
    field label for it, so the panel uses the module's own.
    `tests/e2e/structures.spec.ts` reads the real Region back;
  - **[done] `attachment.token`**: a region that moves with a token
    [14.353, renamed 14.356]. A zone's `attachedTo` names a token on the
    scene, and its region is created attached to it.
    - Foundry moves the region with the token. An `updateRegion` hook on the
      active GM records where the zone now is, without recreating the region
      (`followZone`).
    - A zone whose token has gone is created unattached, since Foundry would
      refuse the whole batch.
    - `tests/e2e/structures.spec.ts` moves the token and checks both.
- **Region behaviours** on terrain regions and rooms. Generated today:
  `teleportToken` (submaps), `changeLevel` (stairs), `defineSurface` (room
  floors, roof stamps) and **[done] `modifyMovementCost`**: a stamp's
  `terrain` becomes a "<stamp> terrain" region over its footprint on its
  level, with the pack's cost per movement action (actions left out keep
  Foundry's 1). The roadmap's earlier name for it, `increaseMovementCost`,
  is not the v14 type key. Still to add:
  - **[done] difficult painted ground:** the paint panel and the scene spec
    give a painted area or stroke a movement cost (0–5, 1 ordinary). Ground
    that is not ordinary always gets its terrain region, with a Modify
    Movement Cost for walking, whether or not terrain is mirrored;
  - **[done] area effects and difficult rooms.** Painted areas, strokes and
    rooms are *areas* (`tools/areas.ts`). Each has a movement cost and
    `effects` (`tools/area-effects.ts`), which mirror the 14.359 behaviour
    schemas:
    - `adjustDarknessLevel`, `suppressWeather` and `applyActiveEffect`;
    - `displayScrollingText` (its narrower event set);
    - `pauseGame`, `executeMacro` and `executeScript`.

    An area with a cost or effects always gets its Scene Region. A room's is
    labelled "Room" and sits over its floor. The effects come after any
    Modify Movement Cost.

    The **effects tool** sits with Foundry's Regions tools. Clicking an area
    opens its panel: the cost, each behaviour with the fields Foundry's own
    sheet gives it (named in Foundry's strings), and a picker to add
    another. The scene spec's regions, strokes and rooms take `effects`,
    rooms take `movementCost` too, and fields left out take Foundry's
    defaults. Proven in `tests/e2e/pointer.spec.ts`.
  - **[done] `toggleBehavior`**, and behaviours that start disabled.
    - A toggle enables or disables other behaviours of its own area, named
      by their place in the area's effects.
    - Each area behaviour's id is chosen up front from its region's id and
      its place (`effectBehaviourId`), so the toggle holds real absolute
      UUIDs. An area's behaviours are always recreated together, so these
      never dangle.
    - Removing an effect renumbers the toggles. So does parsing past a
      malformed one.
    - Any effect can start `disabled`, for a toggle to switch it on.
    - The panel lists each behaviour as "N. Kind", with a Disabled box and,
      on a toggle, an enable, disable or leave choice for each other
      behaviour. The scene spec takes both and rejects a toggle naming
      itself, a missing behaviour, or one twice.
    - `tests/e2e/structures.spec.ts` walks a token into a room and sees its
      darkness switch on.
- **[done] Teleport options for submap entrances** [14.349, 14.353]. A
  link carries its `travel`, used both ways:
  - where the token lands: relative, centre or anywhere (14.359's
    `placement`: relative, center, random);
  - a custom prompt, with `{scene}`, `{token}` and `{region}` placeholders
    [fixed in 14.365], for revealed and unrevealed destinations alike;
  - a **scene transition** from `CONFIG.Canvas.sceneTransitions`, or none,
    and its length.
  Once linked, the submap panel sets them. The entrance is redrawn in place,
  and a region redrawn in place now updates its live behaviours' settings.
  The exit, which the GM may have moved, is updated in the interior, not
  recreated.
  - **[done] Snap and Revealed** (14.368 `snap`, `revealed`): whether the
    token snaps to the grid where it lands (Foundry's default, on) and
    whether players see where the way leads (off). The Travel section sets
    both, in Foundry's own field labels.
  - `avoidOccupied` is not a Teleport Token option in 14.368. The behaviour
    teleports through `RegionDocument#teleportTokens` with its default, which
    already avoids occupied grid spaces, so there is nothing to expose.
- **[done] Spawn regions.** Any area (painted ground, a room or a zone) can
  carry a `spawn` (`tools/spawn.ts`), for encounters and reinforcements.
  - It lists actors by UUID, each with a count (1–50), and how Foundry
    places them: anywhere inside or at the centre, snapped or not, and
    avoiding occupied spaces or not.
  - An area with a spawn always has its region. `areaRegionId` names that
    region among the others a room plans.
  - The effects panel's Spawn section lists the actors a line each ("3
    Actor.abc"), reverting a malformed line, and has a Spawn now button.
  - The module API has `spawn(featureId)`. Both run Foundry's own
    `RegionDocument#spawnTokens` (`foundry/spawner.ts`). A region on
    several levels, or on every level, spawns on the viewed level. UUIDs
    that name no Actor are reported, and Foundry's own errors (no room
    left) are shown.
  - The scene spec's areas take `spawn`. Proven in
    `tests/e2e/structures.spec.ts`.
- **[done] Hazard presets.** Measured templates are gone [14.352], and areas
  of effect are regions now. A preset (`tools/zone-presets.ts`) is a zone
  the GM set up once and saved under a name: its shape, grid measuring and
  every area setting (cost, behaviours, display, spawn).
  - The GM makes them, so the module ships no game rules of its own. They
    are the world's, kept as JSON in the `zonePresets` world setting and
    parsed defensively.
  - The zone panel's Hazard presets section applies one to the zone (one
    re-sync, `applyZonePreset`; a zone without a name takes the preset's),
    forgets one, or saves the zone as one, replacing a preset of the same
    name.
  - Proven in `tests/e2e/pointer.spec.ts`.

### Priority 6: sounds, particles and effects
- **[done] Ambient sounds**, as stamp emitters (a generator's hum, a
  fountain): a stamp's `sound` is a native AmbientSound on its level at its
  floor plus its own elevation (Priority 1), proven in
  `tests/e2e/emitters.spec.ts`.
- **[done] Particle emitters.** Each emitter a stamp's variant declares
  (smoke, embers, sparks, dripping water) runs as v14's native
  `ParticleGenerator` [14.355] in effect mode, keeping its count alive
  (`manual: false`; effect mode otherwise spawns only on request).
  - `tools/particles.ts` plans them in scene terms: the spawn point or
    footprint box, speed in px per second, the stamp's rotation added to the
    angle, and elevation as the stamp's floor plus its own height.
  - Particles are per client, not documents, so `foundry/particles.ts` wraps
    the feature renderer: a drawn stamp starts its emitters, a changed one
    restarts them, a removed one stops them hard. Only emitters on the
    viewed level run; viewing another level redraws the canvas.
  - `tests/e2e/stamps.spec.ts` proves them in Foundry. The VFX module
    [14.356] is not used.
- **Canvas shake** (`CanvasShakeEffect` [14.355]) is for scripted moments
  such as explosions, not authored scene content. It is last: a region
  behaviour or macro could trigger it if a use appears.

### Priority 7: other documents, scene settings and assets
- **[done] Notes: map pins.** A `pin` feature (`tools/pin.ts`) is one
  point realised as a native Note on its level. It has text, the journal
  entry and page it opens (by id), an icon (null for Foundry's) and `global`.
  - Notes are a generated document kind like the rest (`GeneratedDocs.notes`),
    so moving, undoing and erasing follow the lifecycle rule.
  - The **pin tool** sits with Foundry's Notes tools, beside edit and erase.
    Clicking places a pin, or opens the one clicked, in a panel named with
    Foundry's Note sheet strings. The panel offers the world's journal
    entries and their pages, and an icon path or Foundry's file picker.
  - The scene spec takes `pin` entries.
  - Foundry stamps a Note's `author` [14.353] with the user who creates it.
  - Proven in `tests/e2e/pointer.spec.ts`.
- **[done] Drawings: map labels.** A `label` feature (`tools/label.ts`) is
  text on the map, realised as a native text Drawing on its level: a
  rectangle with no fill and no line, centred on the label's point and
  turned about it.
  - It has text, font size (8–256), colour, font (from
    `CONFIG.fontDefinitions`, or Foundry's default), rotation and `hidden`.
  - Foundry wraps a drawing's text to its box, so the box is sized
    generously from the longest line.
  - A label with no text has no Drawing yet, since Foundry refuses one with
    nothing to show.
  - The **label tool** sits with Foundry's Drawings tools, beside edit and
    erase, with a panel named with Foundry's Drawing sheet strings.
  - The scene spec takes `label` entries.
  - **[done] Drawn shapes.** A `shape` feature (`tools/shape.ts`) is a
    rectangle or ellipse (its centre, size and rotation) or a polygon or
    line (its vertices), realised as a native Drawing.
    - It has a stroke (colour, whole-px width, alpha), an optional solid
      fill and `hidden`. A polygon closes on its first point again, a line
      stays open, and a box is whole-pixel sized.
    - It is picked by its exact outline (a line within half its width). A
      polygon's or line's vertices move with edit, a box moves whole, and
      erase removes it.
    - Foundry's own Drawings tools already draw shapes by hand, so there is
      no second tool. The scene spec takes `shape` entries, sized in its
      units with strokes in px, and reports a shape missing what its kind
      needs.
    - `tests/e2e/structures.spec.ts` checks the native Drawings and
      screenshots them.
- **[done] Scene settings.** A scene spec's `scene` block sets the scene's
  own settings, only those given (`tools/scene-settings.ts`):
  - darkness, its lock, global light and token vision;
  - weather (a `CONFIG.weatherEffects` key);
  - fog of war exploration: `CONST.FOG_EXPLORATION_MODES` DISABLED,
    INDIVIDUAL or SHARED [14.353];
  - the transition on entering the scene, and its length [14.352].
  They go through the controller's `WorldScenes` port as one Scene update.
  They are the scene's, not features, so undo leaves them be.
  - **[done]** The day (`base`) and night (`dark`) lighting environments
    (hue, intensity, luminosity, saturation, shadows) and their `cycle`, and
    the fog's explored and unexplored colours (`fogColours`). Each value is
    written only if given, and `tests/e2e/structures.spec.ts` checks them on
    the real Scene.
- **[done] Compressed textures** [14.362]. Packs can ship GPU-compressed
  art (`.ktx2`, `.basis`) for stamps and texture sets.
  - A stamp's image becomes a native Tile, which Foundry's own loader
    decodes. The engine's own canvas draws texture-set fills and blends: the
    pack runtime loads a set's compressed images through
    `foundry.canvas.loadTexture` before anything redraws with them, and
    `canvasTexture` takes them from Foundry's cache (PIXI alone cannot decode
    them).
  - Browsers cannot show them as images, so a variant's `preview` and a
    texture set's `previews` (additive v1 fields) give the stamp browser, the
    tile HUD and the paint swatches a PNG or WebP to show. Without one the
    card shows only its name and the swatch its colour.
  - Unit-tested; not yet proven in Foundry, as no KTX2 encoder is available
    here to make a fixture (Foundry ships only the decoders).

### Priority 8: RGBA mask texture painting
Terrain today is polygons and brush strokes, each one biome with a
feathered edge. The operator asked for texture painting with an **RGBA mask
option**: a splat map, as in Dungeondraft and Inkarnate.
- **Design (operator decision, 2026-09-23): one splat map per level.** One
  RGBA mask image covers the scene on each level; each channel weights one
  texture role from the active set, blended by a PIXI shader. It is saved as
  a PNG in the world's data folder and can be baked to a native Tile. The
  paint tool gains a "Blend" mode that paints into the mask with a soft
  brush.
- **Mask.** A painted mask image whose four channels each weight one texture
  from the active set, blended per pixel. Soft, pressure-free brushes paint
  into one channel and take from the others, giving hand-painted edges no
  polygon can.
- **Scene and texture set.** The mask covers a scene area at a chosen
  resolution. A texture set assigns a texture role to each channel, and
  several masks can layer for more than four textures.
- **Persistence.** The mask is image data, not geometry, so it is stored as
  a file in the world's data rather than inlined in the scene flag. The
  scene flag keeps its path, bounds, channel roles and level.
- **Rendering.** The overlay draws the blend (a PIXI shader over the four
  textures). A GM can bake it to a native Tile or into a Level background,
  so it renders without the module.
- **Everything else as today.** Undo, levels, the scene spec (a mask can be
  given as a file path) and the e2e suite all apply.
- **[done] Blend painting.** The paint panel's Brush picks shapes, blend or
  unblend, and blending takes a strength (0.05–1) instead of a cost.
  - A level's first blend makes its `SplatLayer` (`tools/splat.ts`): the
    scene's bounds at 8 mask px per grid square, and channel roles filled
    as textures are first blended. A fifth texture on a full layer is
    refused.
  - A dab is a soft round brush into one channel. It takes the same weight
    from the others, and unblend just takes.
  - The mask is an exact PNG (`tools/png.ts`, which encodes and decodes
    itself: a canvas would premultiply the unused alpha channel away). It
    is saved at the stroke's end to
    `worlds/<world>/zephyrex-cartography/splat-<scene>-<level|all>.png`,
    and the scene's `splats` flag keeps each layer's path, bounds, size,
    roles and level (`foundry/splat-store.ts`).
  - A whole stroke is one undo step, which restores the mask as it was.
  - `foundry/splat-renderer.ts` draws each layer as one quad beneath the
    painted terrain. Its shader blends the four channel textures, each
    tiled by repeat wrap at the painted terrain's tile size (see Texture
    tiling) and drawn as painted ground draws that texture (a biome's
    tinted like its biome, a pack material untinted).
  - `tests/e2e/pointer.spec.ts` reads the saved PNG back in Foundry and
    screenshots the blend.
  - **[done] Masks in the scene spec.** The spec's `splats` give a level
    (or every level) a mask image, an 8-bit RGBA or RGB PNG whose channels
    weight the four `roles`. `adoptSplat` lays it over the whole scene
    whatever its size.
    - The mask is copied to the level's own mask file, so painting over it
      never touches the original.
    - A built spec that brings masks is still one undo step: the batch folds
      the masks as they were into its entry (`steps`).
    - The decoder reads RGB too, its fourth channel weighting nothing.
    - A mask that cannot be read is reported as a `splat` problem.
  - **[done] Baking into a Tile.** The paint panel's Bake button (shown
    while blending) renders the level's blend into a PNG beside its mask.
    - The render uses an unparented copy of the mesh over the scene rect, so
      the canvas's pan and zoom stay out of the image. It is capped at 4096
      px a side.
    - The image becomes a native Tile over the scene on that level, beneath
      other tiles (`sort` -1). The layer records the Tile's id (`baked`),
      and the overlay stops drawing, so the map renders without the module.
    - Blending again, Unbake, or an undo takes the blend back live and
      deletes the Tile. A bake is not an undo step.
  - **[done] Baking into the Level's background.** The paint panel offers
    both targets while blending: "Bake into a tile" and "Bake into the
    level's background".
    - The background bake sets the native Level's `background` to the
      baked image, and the layer records the image it replaced (`baked:
      { into: 'background', previous }`).
    - Unbaking, blending again or an undo puts that image back, unless the
      GM has since set another there.
    - A blend on every level has no one background, so it bakes only into
      a Tile.
    - A layer saved with a bare Tile id reads as a Tile bake.
    - Both are proven in `tests/e2e/structures.spec.ts`.
  - **[done] Stacked masks: more than four textures.** A level's splat map
    is a stack of up to four layers (`SplatLayer.index`, sixteen textures).
    - A texture goes to the layer holding it, else the lowest with a free
      channel, else a new layer on top (`stackChannelFor`), saved to its own
      file (`splat-<scene>-<level>-<n>.png`; the first keeps the old path).
    - Painting a texture takes as much from the layers above it, so it
      shows through them. Unblending takes from every layer.
    - A stroke is one undo step across every layer it touched. Undoing the
      stroke that made a layer takes the layer away.
    - Layers draw in stack order, a stack on every level beneath a level's
      own. A bake renders the whole stack into one image, recorded on the
      first layer.
    - The scene spec stacks up to four masks per level, bottom to top as
      listed, replacing the level's stack as one undo step.
    - A layer saved before stacks reads as its level's first.
    - Proven in `tests/e2e/structures.spec.ts`.

### Priority 9: map composition, from intent to a playable map [done]
The scene spec places every feature by hand, and the floor-plan generator
only splits a rectangle into unnamed rooms. Neither knows what a woodland
or a tavern is. Composition is the layer above them (operator decisions,
2026-09-26):
- **An intent schema** (`compose/intent.ts`, published as
  `schema/map-intent.v1.schema.json`, same rules as the other schemas).
  It says *what* the map is, not where each thing goes: its size and seed,
  its `settings` (stamp tags, any of which a stamp must carry; none: any
  stamp), a ground biome, zones, paths and buildings. Exterior and interior
  share one schema: an exterior can hold buildings, and a building has
  rooms. Duplicate keys, an `opensTo` naming no room and a path to no
  building are refused.
- **The composer** (`compose/`, pure and unit-tested, seeded and
  repeatable; dependency-cruiser's `compose-is-pure` keeps it so) compiles
  an intent into an ordinary scene spec (`composeMap`). The realiser, the
  undo step and the native documents are unchanged, and the result can be
  edited like anything drawn by hand. What it could not do comes back as
  `ComposeProblem`s, each once: a role no loaded stamp fills (and where it
  was wanted), rooms that do not fit their footprint, rooms asked to adjoin
  that could not.
- **Stamps by tags, never by name** (`compose/role-tags.ts`,
  `compose/roles.ts`; operator decision, 2026-09-27: no asset is ever
  hardcoded). A stamp's role (tree, table, console, altar, emplacement,
  stairs, tabletop and so on) comes from its descriptive tags by ordered
  rules (a `cogitator` `desk` is a desk, a `desk` `lamp` a light, a
  `prep` table a workbench, a `trap` never composed; a rule may need a
  combination, so `table` `clutter` is tabletop, not a table), and so
  does how the role stands (against a wall,
  its clearance, a defence's front facing out, a structure upright) and a
  land stamp's habitat (`cave`, `ice`, `forest`, else the role's usual
  ground). A new asset tagged `console` composes with no code change. A
  pack's own `role` (null: never composed), `placement` and `habitats`
  override the tags, for facts only the picture shows (which edge of a bed
  is its head). Indoor roles take interior-scale stamps and outdoor works
  exterior ones. A role's matching pieces (chairs, tables, beds, pews) are
  one stamp per room; its other pieces vary piece by piece.
- **Perspective** (pack `perspective`: `orthographic` straight down,
  `isometric` with depth and no vanishing point, `central` one-point; the
  old `top-down` reads as orthographic). Only orthographic art is ever
  turned: art drawn with depth turned half round stands upside down. So it
  stands as drawn, its back to the top wall or unturned in a corner, and a
  role with any orthographic art uses only that (`Floor.put` refuses a
  turn outright). A light has no back, so light art drawn with depth
  still stands by any wall, unturned. Seats drawn with depth seat each
  table from above only, in rows across the room.
- **Interior.** A building's footprint, floor and wall materials, wall kind
  and rooms, each with a purpose (common room, bar, kitchen, storage,
  bedroom, hall, office, workshop, shrine, cell, mess, chapel, medicae,
  command, armoury, barracks, manufactorum, interrogation), a relative
  size, its own floor if it differs (a kitchen's flagstones), and the rooms
  it opens onto.
  - `compose/layout.ts` partitions the footprint by weighted recursive
    splits over many seeded tries, scoring the room sizes and the adjacency
    asked for. The entrance room reaches the outer wall the building's
    front faces.
  - Doors join the rooms asked to adjoin (every room reachable), plus the
    front door. Walls are always drawn, in the wall material.
  - `compose/furnish.ts` gives each purpose a template of steps: pieces
    against walls, in corners, in clusters (a table with benches or seats
    beside it, a round one seated all round), in rows facing an altar with
    a centre aisle, or scattered, and underlays. A wall piece brings what
    goes with it: seats before a counter, a nightstand beside a bed, a
    chest at its foot, and a bar counter stands out from the wall with its
    shelves behind the barkeep. `dress` steps set tabletop pieces on every
    table, bar and desk. Door approaches and each piece's clearance stay
    open; an altar faces the front door.
- **Stacking** (`tools/stacking.ts`): a stamp set down wholly on a surface
  stamp (a table, a counter, a desk, a workbench, an altar) of its level
  stands at its top (its elevation plus its height, half a square when the
  pack gives none), so Foundry, which orders by elevation first, always
  draws the tankard on the bar. The GM's own placement stacks the same way;
  an elevation asked for outright is kept.
- **Storeys** (`compose/storeys.ts`). A building's `floors` are levels of
  the scene over the same footprint, so every floor's outer walls stand on
  the ones below; upper floors have no front door. The ground floor takes
  the scene's own lowest level (spec levels' `existing`), the rest stack
  above, and everything outside is on the ground level. A stairwell sized
  to the stair (a stamp whose `transition` climbs, found by tags) is fixed
  in one place on every floor, inside one room on each, against a wall,
  clear of every doorway and of furniture. A flight on each floor but the
  top joins it to the next; three floors or more make a switchback, each
  flight beside the one below, so no two level changes overlap. On a scene
  of several levels the map drawn and edited is the viewed level's.
- **Night** (intent `lighting`): the scene goes dark, and a room is lit by
  its hearth and lamps (pack lights), keeping its own flat light only when
  it has neither. Common rooms, halls and chapels get a lamp for every
  eight squares of wall, shared out evenly along every wall, so a great
  nave is lit end to end.
- **Exterior** (`compose/exterior.ts`). Zones (woodland, meadow, clearing,
  marsh, rocky ground, rubble, industrial yards, fortified camps, landing
  fields; everywhere, a circle, an edge strip or a polygon) with a density
  and optionally their own ground texture; roads and rivers from anchor to
  anchor (a map edge, a point or a building's front door), meandering.
  - Solid works (structures, vehicles, barricades, emplacements, cargo)
    keep their whole footprint off one another, paths and buildings.
    Defences line a fortified zone's edge, fronts facing out, the line
    breaking where a road passes.
  - Ground is layered: the base, then each zone's own ground, its edge
    wandering by noise. Worn earth wears into woods and meadows in short
    wandering strokes, never into a clearing.
  - Paths go round buildings (`compose/detour.ts`: the shorter way round
    the footprint, grown by the path's setback; a river keeps well back).
    A path to a door runs on from the step before it to the doorway.
  - Vegetation and props are scattered by Poisson disc, clumped by noise
    and thinning at a zone's edge, spaced by the pieces' own size. Nothing
    stands on a path, in a clearing that keeps it out, or where its canopy
    would spread over a building. Rocks line riverbanks.
- **Presets** (`compose/presets.ts`): fantasy (a woodland inn, a tavern, a
  forest road, a marsh crossing), grimdark (a hive outpost, a hive chapel,
  a manufactorum) and sci-fi (a void port), as intents.
- **Where.** The module API's `compose(intent)`, and the Map builder's
  Compose section: a preset or pasted intent, "Compose map", and "Another
  layout" to reseed. Problems are listed, localised.
- **Two modes** (operator decision, 2026-09-27): algorithmic, and
  AI-assisted, where a language model (Qwen by default) helps
  (`compose/assist.ts`, pure; `foundry/advisor.ts`, the call).
  - It chooses each place's stamps from the tag-matched candidates
    (numbered, with names and tags), which become the composer's
    `Preferences` (`compose/preferences.ts`).
  - It critiques the composed rooms (each piece, where it faces) and
    answers with fixes (turn, move, remove), each applied only if the
    piece stays in its room on no other piece.
  - Its answers are untrusted: anything unreadable or unknown is refused
    and reported; if it cannot be reached the map is composed without it.
  - The GM's browser calls an OpenAI-compatible endpoint (world settings
    `assistEndpoint` and `assistModel`; a key, if needed, is a client
    setting that never reaches players). The endpoint must allow the
    world's origin (CORS) over HTTPS; the lab's Bifrost at
    `https://ai.zephyrex.ca/v1` does, serving `72gb-vllm/qwen3.8-27b`.
    Thinking is turned off (`chat_template_kwargs`). A question is
    abandoned after five minutes and the map composed without advice;
    probed 2026-09-27, whole-map questions to that model still ran past
    it, so the mode works but the model is too slow to help yet.
- **Cost.** A composed map is hundreds of features in one batch. The
  batch saves the feature list once, as it ends (`persist`). Picking the
  level already edited redraws nothing. A redrawn feathered fill reuses the
  mask rendered for its outline (`foundry/pixi-surface.ts`): rendering one
  is a large blur pass, and redrawing every mask per feature made a
  woodland take minutes.
- **Assets.** The photo texture sets carry CC0 walls (stone, brick,
  plaster, wood, rock, concrete, metal). The hand-painted set's walls are
  to be generated to match its style. The asset packs carry descriptive
  tags, each stamp's perspective, lights and level transitions derived
  from tags, and only the image facts tags cannot say.
- **Proof.** Unit tests for every rule (layout, adjacency, clearance,
  spacing, exclusion, detours, tags, perspective, stacking, storeys,
  advice). `tests/e2e/compose.spec.ts` composes a storeroom in the fixture
  pack (documents, one-step undo, the Map builder UI) and a two-storey
  house (native levels, outer walls on the same perimeter on each, one
  level-change region joining them, nothing upstairs over the stair).
  `tests/e2e/showcase.spec.ts` composes every preset in the real asset
  pack's art where it is installed among the test modules (it skips
  elsewhere); what the pack lacks is reported softly, and the screenshots
  are reviewed by eye against the operator's reference battlemaps.

---

## Stamp pack schema — the contract

The engine owns a **versioned schema** for asset packs, defined once in zod in
`src/stamps/schema.ts`. Everything derives from that file: the engine's types
(`z.infer`), its runtime validation (`parseStampPack`), and the **published JSON
Schema** at `schema/stamp-pack.v1.schema.json`. The JSON Schema is generated by
`pnpm schema:gen` and checked by `schema:check` in the gate. Node loads the
schema modules directly via type stripping, so they import only `zod` and
dependency-free leaf modules (`gen-schema.mjs` resolves their extensionless
imports).

- **Pack discovery:** an asset module ships one manifest, `zephyrex-pack.json`,
  at its root and advertises it with `flags["zephyrex-cartography"].pack` in its
  `module.json`. Any module can therefore be a pack. Paths inside the manifest
  are relative to that module's root.
- **Validation:** the manifest sets `"$schema"` to the public raw-GitHub URL of the
  JSON Schema (both repos are public) and `"schemaVersion": 1`. Packs validate
  against that URL at authoring time. The engine validates again at load and
  reports invalid packs instead of silently dropping them. Stamp-id uniqueness
  is checked in code, because JSON Schema can't express it.
- **Contents per stamp:**
  - identity, category, tags, scale band, perspective (orthographic,
    isometric or central; how the picture is drawn);
  - **variants**: a free-text state label, an image, and a pixel size at the
    pack's `referenceGridSize`;
  - `physical`: height in grid units, cover 0–1, blocksMovement;
  - `occlusion`: none, bounds or alpha, plus how the walls restrict each
    sense (on, off, or `limited`, `proximity`, `distance`), a one-way
    `direction`, and a `threshold`;
  - `light`: radii, colour, animation, darkness sources (`negative`),
    priority, colouration technique, luminosity, attenuation, saturation,
    contrast, shadows, whether it is walled and gives vision, the darkness
    range it is active in, and whether it is placed hidden;
  - `door`: type, `animation` (ascend, descend, slide, swing, swivel) and a
    Foundry door `sound`;
  - `transition`: stairs, ladder, lift or hatch; up, down or both; and the
    movement actions that use it;
  - `enterable` (submap-capable);
  - `container`: `true`, or Item Piles pile options (type, starting closed or
    locked, distance, sounds, and which variant shows each pile state:
    closed, open, empty, locked);
  - `particles`: native particle emitters (textures, spawn area, count,
    lifetime, velocity, alpha, scale, fade, blend);
  - `sound`: an ambient sound emitter;
  - `tile`: alpha, hidden, combinable occlusion modes (fade, surface, radial,
    vision), alpha threshold, light and weather restrictions, video;
  - `surface`: a Define Surface floor or roof over the footprint, optionally
    revealed;
  - `terrain`: a movement-cost multiplier per movement action;
  - for composing (Priority 9), all optional overrides of what the tags
    say: `role` (null: never composed), `placement` (`against` a wall, a
    corner or free; the `clearance` kept before it; which image edge is
    its `back`; `upright`, never turned) and `habitats` (forest,
    grassland, marsh, rocky, cave, arctic, desert, urban, ruin). The roles
    are listed in `STAMP_ROLES`.
- **Variant overrides.** Structural properties sit on the stamp, and a
  **variant may override them**. `null` removes a property for that variant:
  `light: null` for an unlit variant, `particles` only on a "destroyed" one,
  `terrain` only when rubble, `container: false` for a smashed crate.
  `doorState` marks open or closed, and `physical` merges field by field.
- **Assets.** Every asset path (images, particle textures, sounds) is
  relative to the pack module and resolved to its served URL at load; an
  absolute URL passes through.
- **Texture sets.** The manifest also carries texture sets: role → image
  path, licence, credits.
- **Engine support, by field.**
  - Realised: identity through `enterable`, occlusion sense levels,
    `direction` and `threshold`, and `container` pile options (type, state,
    distance, inspection, sounds). A variant's `container` override is
    followed too: switching to a variant that is not a container removes the
    pile, and switching back (or undoing) makes a fresh one. `sound` becomes
    a native AmbientSound ("<stamp> sound") at its offset, on the stamp's
    level, removed by a variant with `sound: null`. `tile`, the new light
    and door fields, `surface` and `terrain` are realised too (see their
    priorities).
  - Particles run as native particle generators (Priority 6).
  - **[done] Pile `states`.** A container stamp shows the variant its pack
    names for its pile's state: locked, closed, empty (open with nothing
    in it) or open.
    - A locked pile falls back to its closed look, and an emptied one to
      its open look.
    - The state is read from Item Piles' own record (the pile actor's
      `item-piles.data` `closed` and `locked`) and its items.
    - The active GM rechecks on any token, actor or item change, one
      recheck at a time. A failed recheck is logged and never stalls the
      next.
    - A new pile's `closed` and `locked` are set outright (Item Piles'
      defaults when the pack gives none), since piles share Item Piles'
      default pile actor, and a new one would otherwise inherit the last
      one's state.
    - Proven in `tests/e2e/containers.spec.ts`.
  - A transition's `movement` is the movement actions that take its
    `changeLevel` region (none: any), realised since 14.361.
- **Evolution:** v1 changes are **additive only**. A breaking change becomes a new
  version with its own schema file, and the parser keeps reading supported
  older versions.

---

## Terrain / biomes

`BiomeKind` is the terrain enum. Water and ocean have no land texture role:
they render translucent, in a water texture from the set or a procedural
ripple. Every other biome is a tiled texture, or procedural grain in its
colour.

**Adding or renaming a biome requires lockstep updates**, or the build breaks /
tests fail: `tools/biome.ts` (`BiomeKind`, `BIOMES`, `BIOME_STYLES`) →
`tools/texture.ts` (`BIOME_TEXTURE`, `BIOME_TINT`) → `i18n.ts`
(`BIOME_TITLE_KEYS`) + `static/lang/en.json`. The paint panel offers every
biome from `BIOMES` with no further change.
`region.test.ts`, `texture.test.ts` and `i18n.test.ts` enforce it. A new biome's
texture *role* (its name) should be added to the packs' texture sets. A set
lacking a role renders that terrain as flat colour.

---

## Textures and asset packs

This repo bundles **no art**. Terrain textures are **texture sets** inside asset
packs (the `textureSets` of the pack manifest: role → image path, licence,
credits). The GM picks one set with the world `textureSet` setting, whose choices
fill in once packs load; an unset or uninstalled choice means the first loaded
set. The renderer resolves each biome/path **role** through the active set.
The stamp engine's own packs, `zephyrex-cartography-assets` (CC0 Poly Haven and
ambientCG sets), own the fetch script and credits.

- **Licence verified before bundling — never assumed** (in whichever pack ships it).
- Assets are **static module files referenced by runtime URL**, never
  `import`ed into TS (that would inline them into the size-limited bundle).

---

## Foundry packaging

- **Targets v14 only** (`module.json` minimum and verified 14). Build on v14
  APIs directly (native Levels, multi-destination teleports, per-level walls);
  never add a fallback or version branch for v13 or earlier.
- `module.json` (id `zephyrex-cartography`):
  `esmodules`→`dist/zephyrex-cartography.js`, `styles`→`dist/zephyrex-cartography.css`,
  `languages`→`dist/lang/en.json`.
- Vite lib build → `dist/` (`src/static/` copied verbatim).
- Foundry runtime globals (`game`, `Hooks`, `foundry`, `canvas`, `CONFIG`,
  `PIXI`) come from the host page. They are referenced as globals and never imported.
