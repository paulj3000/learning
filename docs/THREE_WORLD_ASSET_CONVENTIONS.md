# Three.js World Asset Conventions

`docs/ROADMAP.md` Phase 34 ("3D Art and Asset Pipeline"). This is the
conventions document that phase calls for: how every glTF asset under
`public/models/` is authored, loaded, and placed, so a future asset (hand
authored by a real artist, or generated the way the first pack is) fits the
existing pipeline without guesswork.

## Why generated, not modeled

There is no artist and no 3D modeling tool available to produce this pack.
"Real art" here means real, checked-in, `GLTFLoader`-loadable `.gltf`
files built from primitive geometry (`assets/primitives.ts` +
`assets/gltfAssembler.ts`, run by `scripts/generate-world-assets.ts`), not
hand-modeled assets. Visual fidelity is simple low-poly "programmer art" -
the deliverable this phase actually ships is the pipeline (conventions,
loader, kit composition, instancing, LOD) proven end-to-end against real
external files, not final illustration-quality art. `GLTFExporter` is
deliberately not used (it expects a browser DOM - `Blob`/canvas - and is
risky to run in Node); the generator instead hand-assembles glTF 2.0 JSON
documents directly, generalizing the one prior precedent in this codebase
(the retired `placeholderNpcGltf.ts`'s inline triangle).

## Units and axes

- 1 unit = 1 meter, matching the existing world scale (`EYE_HEIGHT = 1.6`,
  `WALL_HEIGHT = 3`, a 0.6m crate, and so on - `sceneKit.ts`).
- +Y up, glTF-standard right-handed axes. No asset in this pack encodes a
  different up-axis; if one ever needs to (an imported third-party asset,
  say), convert it at import time rather than teaching the loader a second
  convention.

## Origin and pivot

Every solid (box, cone, cylinder) and the vertical plane
(`buildBoxPrimitive`, `buildConePrimitive`, `buildCylinderPrimitive`,
`buildPlanePrimitive` in `assets/primitives.ts`) is **ground-pivoted**: its
local origin sits at its base center, `y` spanning `[0, height]`, not
centered on the origin the way `THREE.BoxGeometry` etc. default to. The one
exception is the flat-lying torus (`buildTorusPrimitive`, used for the rope
coil): its ring lies in the x/z plane with its lowest point at `y = 0`,
since a torus's "base" isn't a flat face the way a box's is.

This is why placement code throughout `sceneKit.ts` and the region scene
files can set `position.y = 0` for anything standing on the ground, instead
of computing a half-height offset - the convention does that work once, at
authoring time, rather than at every call site.

The horizontal ground plane (`buildGroundPlanePrimitive`, used for
`ground-tile` and `path`) is already flat at `y = 0` by construction; there
is no "pivot" question for a tile that has no height.

## Collider proxy

Visual mesh and gameplay collision stay deliberately decoupled, continuing
the pattern `welcomeHarborRegion.ts`/`pirateBuilderBayRegion.ts` already
established before this phase: authored `RectZone` data becomes a `Box3`
collider (`sceneKit.ts`'s `toBox3`) independent of whatever mesh is placed
on top of it. A kit piece's visual bounding box is not read to derive
collision. This is a decision, not an oversight: it keeps collision
authoring simple, deterministic, and unaffected by an asset's actual
silhouette (a swapped-in prettier wall mesh later does not silently change
where the child can walk).

## Interaction anchor

Where an object needs a raycast target or a HUD focus point, the loaded
asset's own scene root (or a specific named part, e.g. `Body` on a
multi-part character) is used directly - there is no separate authored
"interaction anchor" node in any asset in this pack. If a future asset's
silhouette makes its scene root a poor raycast target (a very tall, thin
object, say), add a dedicated empty node named `InteractionAnchor` to that
asset's authoring and have the placing code look for it by name; nothing in
the loader assumes one exists today.

## Animation clip vocabulary

`assets/animationVocabulary.ts` is the single source of truth:

```
Idle, Walk, Talk, Wave, Point, Celebrate, ReactHappy, ReactConcerned, Open, Close, Activate
```

Not every asset uses every clip - `assets/manifest.ts`'s `clips` field
declares only the ones a given asset actually authors, and
`manifest.test.ts` asserts every declared name is drawn from this list.
Every clip in the first pack is a **TRS (translation/rotation/scale)
keyframe track only** - no skinning, no skeleton, no bones. This matches
what `GLTFLoader`/`AnimationMixer` already handle for a node-transform
animation, and keeps every asset authorable as plain vertex math plus
keyframe numbers, with no rigging step. A future asset that genuinely needs
skeletal animation (a walk cycle with bending limbs, say) would need to
extend `assets/gltfAssembler.ts`'s assembler with skin/joint support - nothing
in the pipeline forbids it, but nothing in the first pack exercises it
either.

One authoring gotcha worth naming: a quaternion rotation track from angle 0
to exactly 2*PI is degenerate for interpolation (both ends encode the same
rotation, so slerp has no defined path between them). `collectible-gem`'s
spin clip is the one asset that needs a full turn; see
`spinYKeyframes` in `scripts/generate-world-assets.ts` for the fix (sample
several waypoints around the turn, not just the two ends).

## State-variant relationships

Where an object has more than one authored state (only the bridge does, so
far), each state is a **separate asset**, and the placing code picks which
one to build at construction time - not a single asset with a runtime mesh
swap. `bridge-plank.gltf` (weathered) and `bridge-plank-repaired.gltf`
(warm gold, with an emissive tint) are the same geometry with different
materials, generated by the same function
(`bridgePlank(repaired: boolean)` in the generator script) called twice.
This continues the "read once at construction" pattern
`pirateBuilderBayRegion.ts`'s header comment already documents for the
bridge's collider, extended to its visual mesh.

## LOD variants

A manifest entry may declare `lod: { lowDetailId, distanceMeters }`
(`assets/manifest.ts`). `assets/assetLoader.ts`'s `instantiateWithLod`
builds a `THREE.LOD` with two levels from it; `sceneKit.ts`'s `placeWithLod`
is the placement-side wrapper. Only `foliage-tree` declares a low-detail
pair (`foliage-tree-lod1`) in the first pack - proving the mechanism works
end-to-end on one real case, rather than inventing detail levels for props
too small to benefit (a 0.5m toolbox has nothing meaningful to simplify).
Add a second LOD level to another asset only when there's a real, measured
reason to (a performance budget problem on target hardware), not by default.

## Instancing

Kit pieces placed many times (foliage, fences, path segments, the rock
terrain accent, every wall/roof/door panel across both buildings) go
through `assets/assetLoader.ts`'s `createInstancedMeshFromAsset`, which
loads the source asset once, bakes its authored node transform into the
geometry (`geometry.applyMatrix4(mesh.matrixWorld)` - an `InstancedMesh`
consumes raw vertex data, so a non-identity glTF node transform would
otherwise be silently dropped), and builds one `THREE.InstancedMesh` for
every placement - one draw call instead of one per instance, continuing the
precedent the Phase 32 crate cluster set with an inline `BoxGeometry`.
`sceneKit.ts`'s `runPlacements` is the pure placement-math half (tiling a
straight run into evenly-spaced segments), kept separate from the
async loading/instancing half so it stays unit-testable without a
rendering context (`sceneKit.test.ts`).

One placement gotcha: `runPlacements`'s computed `rotationY` orients a
placed instance **along the direction of the run** (useful for props like a
signpost that should visually "follow" a path). A wall or fence panel
instead needs its rotation fixed to match the building side it's on,
independent of tiling direction - `welcomeHarborScene.ts`'s wall placement
code overrides `rotationY` after calling `runPlacements` for exactly this
reason. Every material in this pack is authored `doubleSided: true`
specifically so a placement that gets this wrong is still visible (from the
"wrong" face) rather than invisible - a flat, untextured color looks
identical from either side, so there is no correctness cost to defaulting
this way.

A second, real gotcha found while browser-testing this phase (not
theoretical): `createInstancedMeshFromAsset` instances only the **first**
mesh a `scene.traverse()` finds (`findFirstMesh` in `assetLoader.ts`). For
a single-mesh kit piece (wall, roof, door, fence, path, rock, bridge-plank)
that's the whole asset. For a **multi-part** asset - `foliage-tree`
(`Trunk` + `Canopy`) is the one in this pack - instancing it would silently
drop every part but the first, with no error or warning. This is why
`foliage-tree` is placed individually via `sceneKit.ts`'s `placeWithLod`
(→ `instantiateAsset` → `gltf.scene.clone(true)`, which preserves every
part) rather than instanced, even though it's placed at only three spots
and would otherwise be a reasonable instancing candidate. **Only
single-mesh assets should go through `createInstancedMeshFromAsset`** - a
future multi-part kit piece that needs many repeated placements would need
either an instancing helper that batches per sub-mesh, or to stay on the
individual-placement path.

## Texture-free, by design (generated assets)

No **generated** asset has a texture, a UV-mapped `TEXCOORD_0` accessor, or
an image reference - every material is a flat `baseColorFactor` (optionally
with `emissiveFactor`). This is not a temporary shortcut: the generator has
no material story, so a generated document referencing a texture means
something went wrong rather than that someone got ambitious.
`castleKit.test.ts` and `wonderwildKit.test.ts` enforce it per pack.

It used to be load-bearing for a second reason - it sidestepped
`Image`/canvas loading entirely, which is what kept every asset testable in
Vitest's jsdom environment (no `HTMLImageElement`, no `ImageBitmap`) - and
this document used to say a future textured asset "would need its own test
strategy for the texture-loading path; nothing here provides one."

**That path now exists.** See "Imported assets" below.

## Imported assets

Not every asset is generated any more. `docs/ASSET_LICENCES.md` is the
ledger of every third-party file checked in, its source and its licence;
ADR-020 is the decision that governs when one may be.

An import follows the same conventions as a generated asset wherever they
apply - 1 unit = 1 metre, +Y up, collision still authored as `RectZone` data
rather than derived from the mesh - and differs in three ways that are
recorded per asset rather than assumed:

- **It may be binary `.glb`.** `assetLoader.ts` resolves by manifest id, so
  the container is invisible to callers; the fetch polyfill in
  `src/test/setup.ts` serves both, reading a `.glb` as bytes and never
  decoding it as utf-8.
- **It may carry a texture**, embedded as a `bufferView` image. Prefer a
  self-contained file: an external texture URI needs a second file placed
  beside it and 404s the moment one moves and the other does not.
- **It may not be ground-pivoted.** Most kits centre-pivot. Rather than
  re-authoring the file, the placing code carries a named offset - see
  `FLOOR_SLAB_TOP_OFFSET` in `storykeeperCastleScene.ts` - and a test pins
  the dimension that offset was derived from, so a re-import that changes
  the mesh fails loudly instead of drifting.

- **It may not be at metre scale.** Kenney's kits are authored on a 1-unit
  module: a castle wall is 1.00 x 1.31 x 1.00, so dropped in unchanged it
  stands below a child's 1.6m `EYE_HEIGHT`. `scripts/import-kenney-assets.ts`
  normalises this at import rather than at placement, by the rule below.

### Normalising an import's scale

An import declares the **generated asset whose manifest id it takes over**,
and is scaled by the largest uniform factor that still fits inside that
asset's bounding box **on all three axes**.

Fitting inside, rather than matching one axis, is the part that matters.
Collision is authored as `RectZone` data around the generated original, so
a mesh that fits inside it cannot poke through the collider - the one way
a pure art swap can change where a child *appears* able to walk. Uniform,
because non-uniform scaling visibly stretches a texture atlas.

The scale is baked into the POSITION data, not onto the node, so the root
transform stays identity. A node transform would survive
`createInstancedMeshFromAsset` (it bakes `matrixWorld`) but only for
single-node files, and identity roots are what the import contracts pin.
Uniform scale leaves NORMAL and TANGENT valid, so only POSITION is rewritten.

For an LOD pair, **both levels are fitted to the near level's box**, not to
their own. The collider belongs to the object rather than to the detail
level, and one shared box is what lands both levels on the same height so
the swap at `distanceMeters` has no vertical pop.

### Importing a rigged character

A character import is a different job from a scenery import, and
`scripts/import-character-assets.ts` is where it lives. Two rules govern it.

**The vocabulary is closed, and imports are renamed to it.** An imported
character declares clips from `animationVocabulary.ts` or it declares
fewer - the vocabulary is never widened to accommodate a pack. In practice
a general-purpose character pack maps onto very little of it: of the 24
clips Quaternius's Ultimate Modular Men ship, three (`Idle`, `Walk`,
`Wave`) map without inventing a meaning, and the rest are dropped. Where a
source clip is plainly useful but ambiguous - `Interact` could be `Point`,
`Talk` or `Activate` - it is dropped rather than guessed, because a wrong
name inside a closed vocabulary is worse than a missing clip.

**A clip that cannot be shown to a child is removed from the file, not left
unreferenced.** Character packs are overwhelmingly built for combat, and
this product is for ages 3 to 8. A `Gun_Shoot` or `Death` clip that nothing
ever plays is still in the bundle and still discoverable. The content half
of `characterImports.test.ts` is what keeps a re-import from restoring
them.

Dropping most of a character's clips leaves most of the document
unreachable, so the importer also **prunes**: it walks reachability from
meshes, skins and the surviving clips, rebuilds the binary buffer from only
those bufferViews, and renumbers every accessor and bufferView index. It
drops `TEXCOORD_*` too when no material samples a texture, since an
untextured character cannot read its own uvs. On these files that is 2797
accessors down to 402, and 2.9 MB down to 824 KB.

Renumbering is the risky part: an off-by-one still parses as JSON and still
looks plausible, and only fails visibly at render. That is why the contract
ends with a real `GLTFLoader` round trip asserting the rig binds and every
surviving clip has tracks, rather than reading the document as JSON alone.

### The import contracts

Three files, split by which kit they cover:

- `describe('imported castle kit')` in `castleKit.test.ts` — the KayKit
  floor and ceiling slabs.
- `kenneyImports.test.ts` — the shared kit's nature props.
- `characterImports.test.ts` — the rigged characters.

Between them they pin grid fit, scale fit, pivot, identity roots,
single-mesh where instanced, embedded texture, clip vocabulary, absence of
combat clips, buffer packing, and no required glTF extension (`GLTFLoader`
returns an incomplete scene for an unsupported required extension rather
than throwing).

### The texture test path

A GLB's texture is a `bufferView` PNG. `GLTFLoader` turns it into a `Blob`,
takes an object URL, and hands that to `ImageLoader`, which sets `img.src`
and waits for a `load` event. jsdom has no image decoder, so that event
never fires and `GLTFLoader.load()` **hangs rather than failing** - a
20-second test timeout with no error, which is a genuinely confusing way to
discover the problem.

`stubImageDecoding()` in `src/test/setup.ts` resolves the image half so the
rest of the round trip stays under test. What it proves: the file is
fetched, its container parsed, its `bufferView` image found, and its
material and texture wired onto the mesh. What it does not prove: that the
PNG bytes decode to a valid image. jsdom cannot rasterise one at any level
of effort, so that check belongs to a browser (Playwright) run.

## File layout and format

Every *generated* asset is a single, self-contained `.gltf` **JSON** file
(not binary `.glb`) with its buffer embedded as a base64 data URI, under
`public/models/*.gltf` - no separate `.bin`, no `assetsInclude` change
needed in `vite.config.ts` (Vite serves `public/` as static files as-is).
This trades a slightly larger JSON file (base64 is ~33% bigger than raw
binary) for zero extra file management; at this pack's size (1-12 KB per
asset) that trade is free. A future pack large enough for the size to
matter should reconsider binary `.glb` with a separate `.bin`, not assume
this convention extends indefinitely.

## Regenerating the pack

```
npm run assets:generate
```

Runs `scripts/generate-world-assets.ts` (via `tsx`) and rewrites every
*generated* `.gltf` in `public/models/`. The output is checked in, not built
at deploy time - regenerate and commit after changing any asset's authoring
in that script.

It does not touch the imported `.glb` files, which have their own command:

```
npm run assets:import-kenney
```

Runs `scripts/import-kenney-assets.ts`, which reads the CC0 archives under
`assets/*.zip` and writes the normalised `kenney-*.glb` files.

```
npm run assets:import-characters
```

Runs `scripts/import-character-assets.ts` for the rigged characters, per
the rules above.

Both read their zips in place through `scripts/assets/zipReader.ts`, a
minimal `node:zlib` reader rather than a dependency. Those archives are
**git-ignored** - 532 MB against about 2.1 MB of shipped models - so
re-running either needs them downloaded again, from the urls in
`docs/ASSET_SOURCING.md` and verifiable against the sha256s in
`docs/ASSET_LICENCES.md`. Both importers' output is checked in, so a normal
clone never needs to run them.

## Testing

- `assets/primitives.test.ts` - pure vertex-math invariants (vertex/index
  counts, ground-pivot bounds), no `three` import.
- `assets/gltfAssembler.test.ts` - assembled documents parsed through the
  real `GLTFLoader.parse()`, including a multi-part document and a TRS
  animation clip.
- `assets/manifest.test.ts` - the authoring check: every manifest url
  resolves to a file the generator actually produced, every declared clip
  name is in the approved vocabulary, every `lod.lowDetailId` points at a
  real entry.
- `assets/assetLoader.test.ts` - integration smoke tests against a small
  representative set (one static kit piece, one animated character, one
  instanced kit piece, one LOD pair) through the **real**
  `GLTFLoader.load()` (fetch-based) path, not just `.parse()` - see the
  narrow `fetch` polyfill in `src/test/setup.ts` for how a real file on
  disk gets served to a real `fetch()` call inside Vitest's jsdom
  environment. This is not the primary test strategy for every asset (the
  manifest + assembler tests already cover the rest); it exists to prove
  the generator's output is valid glTF a real fetch + `GLTFLoader.load()`
  round trip accepts.
- `sceneKit.test.ts` - the pure placement math (`toBox3`, `runPlacements`).
- `welcomeHarborScene.ts`/`pirateBuilderBayScene.ts`/`sandboxScene.ts`
  themselves stay in the existing "rendering glue, not unit tested, needs a
  real WebGL/DOM context" bucket, unchanged by this phase.
