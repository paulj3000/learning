# Wonderwild Forest — First-Person Region Roadmap

**Status:** WF-0 and WF-1 are implemented. WF-2 through WF-10 are proposed
and not started.

A standalone roadmap for rebuilding Wonderwild Forest as a first-person
Three.js region. It has its own phase numbering (**WF-0** through
**WF-10**) deliberately, so it can be built independently of, and
concurrently with, `docs/ROADMAP.md`'s Phase 35+ Android platform sequence
and `docs/STORYKEEPER_CASTLE_3D_ROADMAP.md`'s SC sequence. Nothing here
blocks or is blocked by either.

The design this roadmap builds is specified in
`docs/WONDERWILD_FOREST_3D_STORYBOARD.md` (13 beats, two region plans,
age-band routing, asset kit). This document is the build order and the exit
criteria; the storyboard is the what and the why. Read it first, and read
`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` before that — most of what follows
is the castle's method applied to a location whose problems are different,
and several phases below exist only because of something the castle build
learned the expensive way.

Standing constraints from the storyboard, restated because every phase
below inherits them:

- **The engine does not change.** No new adventure step, no new story scene
  kind, no new world-engine event, no edit to any authored adventure or
  story text, and no extension of `assets/animationVocabulary.ts`. Every 3D
  interaction resolves to an option id the existing content already owns
  (`wonderWallBindings.ts`, WF-0).
- **Every 3D route has a HUD equivalent** driving the identical step.
  Walking, looking, and aiming are never the only way to a learning
  objective (`docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md`
  section 42).
- **No vertical traversal, and no change to the child's scale.**
  `firstPersonController.ts` is flat-plane at a fixed `EYE_HEIGHT` of 1.6m.
  The child does not shrink; the hive is built enormous, and the comb is a
  floor rather than a wall.
- **The shrink is a cut, not a zoom.** Reduced motion is a stated
  accessibility requirement and a scale animation is the most
  motion-sensitive thing this island could contain.
- **The 3D forest is the primary route, not a preview.** From WF-2 the
  first-person region is what a Pathfinder or Explorer gets when they open
  Wonderwild Forest. This differs from the castle, whose 3D route SC-2 shipped
  as an additive second link beside the Phaser one, and it is a deliberate
  product call rather than a drift: a region offered as an experiment beside
  the "real" one is a region nobody plays and nobody can playtest.
- **ADR-008's Sprouts gate still applies, and it is the one exception.**
  Sprouts keep the card-based route as their default until the accessibility
  playtest owed from Phase 32 has run - the gate is a band-by-band gate, and
  the shrink into the hive is the most motion-sensitive transition on the
  island. The card route is not *retired* for any band before WF-10; it stops
  being the **default** for the older two bands at WF-2.

## Dependency order

```text
WF-0  region data + bindings ──┬──> WF-2 walkable forest ──> WF-3 Wonder Wall
WF-1  asset kit ───────────────┘                                    │
                                                                    v
                                              WF-4 hive clearing + the shrink
                                                                    │
                                                                    v
                                                    WF-5 the waggle dance
                                                                    │
                                                                    v
                                        WF-6 the forest answers  ← slice complete
                                                                    │
                          ┌─────────────────────────────────────────┤
                          v                                         v
                  WF-7 the two secrets                    WF-8 Sprouts (approval)
                                                                    │
                                                          WF-9 Explorers (approval)
                                                                    │
                                                                    v
                                              WF-10 accessibility + retirement gate
```

**WF-0 and WF-1 are parallel** and share no files. **WF-7 is parallel** with
WF-8 and WF-9. **WF-8 is parallel** with everything from WF-3 onward once
approved, since it reuses WF-2 to WF-6's glades and assets and adds only
content.

**The critical vertical slice is WF-0 to WF-6.** At WF-6 a Pathfinder can
walk into the forest, choose what they are curious about by walking to a
carved stone, follow the worn trail to the hive, be shrunk into it, watch
Buzz dance five waggles and count them, come back out, and find the bare
patch of earth they walked past on the way in covered in flowers and their
question lit up in gold on the stone. Stop there and re-evaluate before
building WF-7 onward.

**The slice is one phase longer than the castle's felt.** WF-4 builds a
second region and a mid-adventure region change, which SC-0 to SC-6 never
had to do. If that phase runs long, the descope is to cut the hive interior
and stage beats 5 to 8 as the existing cards inside the hive clearing — the
forest still gains the Wonder Wall, the trails, and a real world change, and
the shrink stays a sentence for one more cycle. That descope is available
and is worth naming out loud before anyone starts, because it is the only
one in this roadmap that does not lose a learning step.

---

## WF-0 — Region data and question bindings — **DONE**

Pure data and pure functions. No `three` import, no rendering, nothing
child-facing. Everything here is unit tested, and every later phase reads
from it.

Deliverables:
- `three/wonderwildForestRegion.ts` — the storyboard's glade plan as
  authored numbers: ground extents, the eight glade rects, the trail rects
  connecting them, and the zone rects for every trigger (harbor path, each
  glade, the hive, the fern bank, the cave mouth). Same split and same
  `RectZone` shape as `pirateBuilderBayRegion.ts` and
  `storykeeperCastleRegion.ts`;
- `buildTreeLineSegments` — the **derived** collider band. The walkable set
  is the union of glade rects and trail rects; the tree line is everything
  else inside the ground extents, decomposed into `Box3`-able rects for
  `firstPersonController.ts`'s `colliders` array. This is the geometric
  heart of the region, and the reason it is derived rather than hand-listed
  is the same reason `buildWallSegments` is: two dozen hand-written rects
  drift out of agreement with the glades they are supposed to bound, and
  nothing notices until a child walks into a tree they can see through;
- `three/wonderwildHiveRegion.ts` — the hive interior's own extents, the
  dance floor rect, the hive mouth exit zone, and the spots for Buzz, the
  three sisters, and the capped cells;
- stable semantic ids for every entity the later phases place — the four
  wonder stones, the hive, the bare patch, the frog, the leaf pile, the cave
  mouth, the glow moss, the butterfly, the dance floor, the sisters —
  declared here, not invented in a scene file;
- `three/wonderWallBindings.ts` — the entity-id to adventure-option-id map
  for the four stones, plus the resolver both the scene and the world view
  call;
- `discovery/checkpoints.ts` — `WONDERWILD_FOREST_CHECKPOINTS` and
  `WONDERWILD_HIVE_CHECKPOINTS`, the seven authored checkpoints in the
  storyboard's table.

Exit criteria:
- `wonderwildForestRegion.test.ts` passes: no two glade rects overlap, every
  trail actually connects the two glades it claims to, every zone sits on
  walkable ground, and every checkpoint and glade is reachable from the
  spawn checkpoint by a flood fill on a 0.25m grid;
- **the flood fill is mutation-tested.** Re-run it with one trail rect
  removed and assert the glade behind it becomes unreachable. The castle's
  SC-0 makes this point and it is worth repeating: a reachability test that
  cannot fail passes just as well against geometry that is wrong;
- **the tree line is proved, not assumed.** Assert that no derived collider
  rect overlaps any glade or trail rect, and that the union of glades,
  trails and tree line covers the ground extents with no gap — a hole in
  that cover is a place a child walks into nothing;
- `wonderWallBindings.test.ts` passes and is the authoring check: every
  entity id in the map resolves to an option id that
  `BUZZ_AND_THE_WAGGLE_DANCE` actually contains. An unresolvable binding is
  a **test failure, never a runtime fallback**;
- **the four stones' zones are provably disjoint**, and no two are within
  1.5m of each other. SC-0 found the castle's three tower windows meeting at
  their corners, which would have made `choose-setting` come down to
  listener order; four stones in an arc is the same trap with one more
  chance to fall into it;
- no file in this phase imports `three`.

### What shipped

- `three/wonderwildForestRegion.ts` + test — eight glades, seven trails,
  every zone and entity spot, and `buildTreeLineSegments`, which **derives**
  the tree line as the exact complement of the walkable set by a column sweep
  rather than hand-listing the two dozen rects that would have to bound eight
  irregular glades. `isOnOpenGround` / `isBlocked` / `isWalkable` are its
  query surface.
- `three/wonderwildHiveRegion.ts` + test — the hive interior, its four comb
  walls, the dance floor, Buzz, three sisters, and the two waggle runs.
- `three/wonderWallBindings.ts` + test — four bindings on the one step the
  forest stages as world objects, and the resolvers both directions.
- `discovery/checkpoints.ts` — `WONDERWILD_FOREST_CHECKPOINTS` (five) and
  `WONDERWILD_HIVE_CHECKPOINTS` (two), each region's way-in first so a
  first-time child spawns there.
- 66 new tests. No `three` import in any of it.

Four things worth carrying into WF-2, three of them found by the tests rather
than by reading:

- **Inverting the castle's geometry model was the right call, and the cover
  test is the reason.** The castle authors floors and derives walls; a forest
  has neither, so this region authors the walkable set and derives the trees
  around it. The test that samples every 0.25m of the region and asserts each
  point is either open ground or tree line is what makes that safe, and it is
  not decoration: raising the sliver threshold to 2.5m makes it fail, which is
  exactly the hole a hand-listed tree line would have had somewhere.
- **The harbor path glade ran to the region boundary.** The child could stand
  on the western edge of the world with nothing rendered beyond them, because
  the derived tree line has nothing to close behind a glade that reaches the
  extent. The glade now stops at x -17.5 and the exit zone moved in with it.
- **The night-clearing trail was exactly as wide as the bee's.** Beat 2's only
  wayfinding is that the bee's trail is visibly more worn than its neighbours,
  and a "faint" trail the same width as the "worn" one makes `TrailWear` a
  label rather than a fact. The test now floors the worn trail strictly wider
  than every faint one.
- **The fern bank needed a connection that is not a trail.** Beat 11's glowing
  moss is unmarked, and a path leading to it would be a signpost pointing at
  the one thing the storyboard insists nothing points at. `TrailWear` gained a
  `'none'` case — walkable ground with nothing drawn on it — so the child can
  wander off the trail and there is somewhere to wander. Tests assert the fern
  bank's only connection is `'none'` and that no drawn trail passes within 2m
  of the moss.

The reachability test flood-fills open ground on a 0.25m grid from the spawn
checkpoint and asserts every glade, checkpoint, and zone is reachable. It also
re-runs the fill with the bee's trail removed and asserts the hive clearing
becomes unreachable — otherwise it would pass just as well against a tree line
that was wrong everywhere. All three invariants were checked by mutation
before being trusted.

**One deliberate addition beyond the storyboard.** Each wonder stone gets an
approach zone as well as being a raycast target. The storyboard's age-band
table gives Sprouts `APPROACH` only, so a stone that could only be aimed at
would put beat 2 out of reach of a band that cannot aim — and of anyone using
the region without precise pointer control (explorable-world roadmap section
42). The four zones are asserted disjoint and at least 1.5m apart, which is
the castle's tower-window defect caught before it could happen: overlapping
them would let one step forward stand at two questions at once and leave
`wonder-wall` to listener order.

## WF-1 — Forest and hive asset kit — **DONE**

Extends the Phase 34 and SC-1 pipelines with Wonderwild's own pieces.
Parallel with WF-0. Follows `docs/THREE_WORLD_ASSET_CONVENTIONS.md` exactly:
ground-pivoted, texture-free, flat `baseColorFactor`, TRS-only clips,
single-mesh for anything to be instanced, checked in under `public/models/`.

**The full inventory — every model and character, with counts, placements,
and which phase needs it — is Appendix A.** It is kept there rather than
duplicated here so the two lists cannot drift apart. Read it before costing
this phase: at roughly **29 new assets, one of which is a character**, WF-1
is about half the size of SC-1, and 3 of those assets serve only WF-7's
secrets and can be deferred.

**Why it is half the size.** The castle's Appendix A.1 ruled out the entire
Phase 34 outdoor kit — `foliage-tree`, `foliage-bush`, `rock`, `fence`,
`path`, `bridge-plank*`, `roof` — as having "no role indoors". Every one of
them is load-bearing in a forest. `foliage-tree` is also the only asset in
the repo that already has an LOD level authored, and the tree line will
place more of it than anything else on the island.

Deliverables:
- the recolours (Appendix A.2) — three assets reusing existing geometry with
  a new `baseColorFactor`;
- the new kit pieces (A.3), props (A.4), and state-variant pairs (A.5);
- `npc-buzz` (A.6), the one new character, with clips `Idle`, `Talk` and
  `Celebrate` — **all three already in `assets/animationVocabulary.ts`.
  No vocabulary extension is needed, and none should be added**;
- generator functions in `scripts/generate-world-assets.ts`, manifest
  entries in `assets/manifest.ts`, regenerated and committed output.

Exit criteria:
- `npm run assets:generate` **followed by `npm run format`** reproduces the
  committed `public/models/` byte-for-byte. (The generator emits minified
  `JSON.stringify` output and `public/models` is not in `.prettierignore`,
  so the checked-in files are the pretty-printed ones. SC-1 learned this by
  leaving 78 files failing `format:check`.)
- `manifest.test.ts` passes: every url resolves, every declared clip is in
  the vocabulary;
- `assets/wonderwildKit.test.ts` mirrors `castleKit.test.ts`: nothing in
  this pack references an image, texture, or `TEXCOORD_0` — which is what
  keeps every asset loadable in jsdom — and **anything to be instanced is
  verified single-mesh, mesh by mesh**, not left to a comment.
  `createInstancedMeshFromAsset` silently keeps only the first mesh it
  finds; `foliage-tree` documents the trap and SC-1 hit it twice;
- `assetLoader.test.ts` gains one case for `npc-buzz` through the real
  `GLTFLoader.load()` fetch path;
- **the comb cell is verified single-mesh and hollow.** A hexagonal cell
  with a hole in it is the same shape problem SC-1 found in `archway`, which
  turned out to be multi-part and therefore un-instanceable. The hive places
  far more cells than the castle placed archways, so if `comb-cell` cannot
  be one mesh, the hive's cell count has to come down before WF-4 is
  costed, not during it.

Explicit non-goals: textures, UV accessors, skinned animation, LOD variants
beyond the one `foliage-tree` already has. Further LOD is added later and
only on a measured budget problem (WF-10), never by default.

### What shipped

29 new assets in `public/models/` (108 total), generated by a new Wonderwild
section in `scripts/generate-world-assets.ts`, registered in
`assets/manifest.ts`, and covered by `assets/wonderwildKit.test.ts` plus
three new cases in `assets/assetLoader.test.ts`. **The 79 pre-existing assets
regenerate byte-identically**, so nothing in the Phase 34 or SC-1 packs was
disturbed — which is also what makes this phase safe to build alongside live
castle work.

**A.9 risk 1 is closed, in the affirmative and the opposite direction to the
castle.** SC-1 found `archway` could not be one mesh: a hole in a flat panel
needs geometry either side of it, and the obvious authoring is two posts and
a lintel. A honeycomb cell has the same problem and a different answer.
`buildHexRingPrismPrimitive` (new, in `assets/primitives.ts`) emits the whole
hexagonal annulus as one indexed mesh — 96 vertices, 48 triangles, inside
uint16 — so the roughly forty cells in the hive wall are one instanced draw
call rather than forty scene graphs. **The hive's cell count stands and WF-0's
numbers need no revision.** Six boxes arranged in a hexagon, which is how this
would naturally be authored, would have been six parts and
`createInstancedMeshFromAsset` would have kept only the first.

Four authoring decisions worth carrying forward:

- **The pack is half the castle's size because of what it does not author.**
  SC-1's Appendix A.1 ruled out `ground-tile`, `foliage-tree` (with its
  existing LOD level), `foliage-bush`, `rock`, `path` and `signpost` as having
  no role indoors. Every one is load-bearing in a forest and is reused
  unchanged. 29 assets against the castle's 59.
- **The seed emblem is a winged samara, not a seed head.** Authored as a
  teardrop it read as a second chrysalis two stones along, which would have
  made two of the four questions indistinguishable at a glance. A maple key
  also says *travel*, which is what the question asks.
- **`comb-cell-capped` is a solid hexagonal prism, not a ring with a lid.** A
  lid would be a second part and cost the honey cells their instancing for no
  visual gain, since the cap is what the child sees.
- **Buzz ships with `Idle`, `Talk` and `Celebrate` and nothing else.** The
  waggle run is not a clip: `animationVocabulary.ts` has no `Waggle` or
  `Dance` name, SC-1 declined to extend it, and extending it would be the
  wrong fix regardless — beat 7 needs exactly five discrete waggles, stopped
  at the end and replayable at no cost, which a looping clip does not give
  cleanly. `Abdomen` exists as a named node for WF-5's scene to drive, and a
  test asserts it survives cloning even though no clip in the document targets
  it.

`wonderwildKit.test.ts` guards the conventions most likely to be broken
silently later: nothing in the pack references an image, texture, or
`TEXCOORD_0` (which is what keeps every asset loadable in jsdom); every A.3
kit piece is asserted **one mesh, mesh by mesh** rather than by comment; and
`wonder-stone-bee` and `wonder-stone-bee-lit` are asserted to share exact
accessor counts and bounds, so beat 10's construction-time swap cannot pop.

The single-mesh claim was **mutation-checked**: re-authoring `comb-cell` as
two parts — the exact defect that caught `archway` — fails both the kit test
and the instancing round-trip in `assetLoader.test.ts`.

One test of mine was wrong before the assets were. The ground-pivot check
asserted every asset has positive height, which is false for the three
`buildGroundPlanePrimitive` recolours and the bare flower patch: a floor tile
legitimately sits entirely at y = 0. The check now exempts flat pieces from
the height half while still holding all of them to `y >= 0`.

**Not verified, and inherited from every scene file in this repo:** none of
these assets has been *looked at* in a browser. The comb cell's legibility as
architecture — storyboard open question 3, whether a room of 1.4m hexagons
reads as "inside a beehive" rather than "inside a machine" — is WF-4's
screenshot question, and A.9 risk 2 stays open until it runs. The four stone
emblems have the same standing risk that SC-4 confirmed for the castle's hero
portraits, with the same mitigations already in place: Chatty names the
question aloud and the HUD card names it in text, so the emblem is never the
only cue.

## WF-2 — The walkable forest

The forest as a place, with nothing to do in it yet. This is the phase that
makes the region real.

Deliverables:
- `three/wonderwildForestScene.ts` — rendering glue, in the same
  not-unit-tested bucket as the other scene files. Builds the ground, the
  trails, the tree line, the pond, and every glade's dressing from WF-0's
  data using WF-1's kit and the existing Phase 34 kit through `sceneKit.ts`;
- outdoor lighting: the ambient rig from `createSceneBootstrap`, tuned so
  the hub reads as the brightest place in the forest and the cave mouth the
  darkest. **Author the numbers, then look at them** — SC-2 shipped an
  unverified light rig and SC-6 had to raise the Great Library's from 1.4 to
  2.4 after a screenshot showed a black void where a dark library was meant
  to be;
- the pond, as scene geometry with a collider, following
  `pirateBuilderBayScene.ts`'s `addWater` rather than inventing a water
  asset;
- `three/WonderwildForestWorldView.tsx` and
  `routes/WonderwildForestWorldPage3D.tsx`, route
  `/island/:childId/world/wonderwild-forest-3d`, naming and lazy-load
  matching `StorykeeperCastleWorldPage3D`;
- the existing `WorldHud` over the canvas, unchanged;
- checkpoint save on zone entry, and spawn from
  `ChildWorldState.lastCheckpointId` — an authored id, never a coordinate;
- the harbor exit, returning to the island map;
- **every glade dressed in this phase, including the bare patch of earth
  beside the hive.** This deliverable is written in bold because the castle's
  equivalent was not: SC-6's first deliverable said the empty shelf slot was
  "placed in SC-2", it was not, and neither were the bookshelves, the
  reading tables, the tapestries or the costume racks. WF-6's payoff and
  WF-7's secrets both need ground the child has already walked past and
  noticed. Dressing a glade later is dressing it after it stopped mattering.

Exit criteria:
- a child can walk from the harbor path to every one of the eight glades and
  back without leaving walkable ground, passing through the hub each time;
- no glade is reachable through the tree line, and no collider traps the
  camera;
- crossing a checkpoint saves it, and re-entering the region spawns there
  with the HUD toast naming the spot;
- `WonderwildForestWorldView.test.tsx` covers mount, unmount without leaking
  the bus or the renderer, and the load/error states, mirroring
  `StorykeeperCastleWorldView.test.tsx`;
- **the region has been looked at**, through the `.tmp-verify/harness/`
  pattern SC-2 to SC-6 established, at every authored checkpoint. Screenshots
  are not optional decoration here: of the eleven defects that pattern found
  in the castle, none was visible to a unit test, and three of them
  (windows opening onto blank stone, windows floating 25cm off the floor, a
  hearth glow with no fireplace under it) were placement bugs of exactly the
  kind a glade full of ferns will produce;
- **the 3D region is the default route into Wonderwild Forest for
  Pathfinders and Explorers**, reached from the island map and
  `IslandLocationPage` without a "try walking" opt-in, with the card-based
  route still working and still linked as the alternative;
- **Sprouts still get the card-based route by default**, per ADR-008. The
  age-band branch that decides this is authored in WF-2 even though the
  Sprouts adventure does not exist until WF-8, because the alternative is
  shipping a default that is wrong for a band and fixing it later;
- a test asserts both halves of that branch, so "primary for two bands, not
  the third" cannot quietly become "primary for everyone".

## WF-3 — The Wonder Wall (beat 2)

The thesis, proved. The first phase where a learning step is driven by a
place rather than a card, and the first time the forest asks its question
before the child has walked to the answer.

Deliverables:
- the four standing stones in an arc across the north of the hub, each
  carved with one shape, raycast-interactable, `ObjectInteracted` resolved
  through WF-0's bindings to `wonder-bees` / `wonder-seeds` / `wonder-sky` /
  `wonder-butterfly`;
- `companion-chatty` on the low centre stone — an existing asset, placed as
  the narration anchor. Not an NPC, not a conversation, and it never follows
  the child;
- the four trails leaving the clearing behind their stones, with the bee's
  visibly the most worn. This is the region's only wayfinding: no arrow, no
  waypoint marker, no forced camera motion;
- **the session moves into the view.** The view holds one
  `useAdventureSession`; looking at a stone and pressing the matching option
  on the HUD card go through the *same* `submitAnswer`. Reuse
  `AdventureStepCard.tsx`, which SC-4 already extracted from
  `AdventureRunner.tsx` for exactly this;
- the `wonder-wall-fallback` narrative playing at the three stones whose
  adventures do not exist, with its authored text unchanged;
- the hive-clearing zone keeping its existing `wonderwild-beehive` /
  `wonderwild-beehive-discovered` pair as the alternate entry, so a child who
  wanders east first still starts the same session.

Exit criteria:
- the step advances `BUZZ_AND_THE_WAGGLE_DANCE` through
  `useAdventureSession` with **no change to the adventure definition** and
  no change to `wonderWallQuestions.ts`;
- choosing through the clearing and choosing through the HUD card produce
  identical session state, asserted by comparing the recorded `submitAnswer`
  arguments from both routes — true by construction, not by two
  implementations agreeing;
- entering through the Wonder Wall and entering through the hive clearing
  reach the same session, and entering through both in one visit does not
  start two;
- the reticle names each stone **in the card's own words** (the authored
  question text), read off `WONDER_WALL_QUESTIONS` rather than authored a
  second time;
- a stone with no built adventure is never silent and never a dead end: it
  plays the authored fallback line;
- re-entering the region after the tale is told shows the bee stone still
  lit (WF-6 builds the lighting; this phase must not make it impossible).

**Watch for the `removeAllListeners()` hazard.** SC-4 found the castle
view's zone effect calling it on cleanup, which would have silently dropped
the *session's* subscriptions whenever a world-change flag flipped, leaving
every interactive object inert with nothing in the console. Individual
unsubscribes only.

## WF-4 — The hive clearing and the shrink (beats 3–4)

The phase with the engineering risk in it. Budget accordingly.

Deliverables:
- the hive on its trunk in the hive clearing, raycast-interactable;
- `three/wonderwildHiveScene.ts` — the interior built from WF-0's numbers
  and WF-1's kit: comb floor, comb walls, capped cells, the dance floor
  patch, and the hive mouth;
- **the region change**, driven by `shrink-into-hive` advancing. One view,
  two regions: the view rebuilds its engine when the region id changes, and
  the `useAdventureSession` outlives the rebuild. See the storyboard section
  7 for why this is not two routes;
- a short fade over the narrated line. **No zoom, no scale animation, no
  camera roll**, and the fade respects `prefers-reduced-motion`;
- the hive mouth as the way back, returning to the forest at
  `wonderwild-forest:hive-clearing`;
- checkpoints saved in the hive region as in the forest.

Exit criteria:
- `shrink-into-hive` behaves identically to the card route: the same
  `aiNarrated` call through `generateCompanionTurn` with the same
  `authoredBaseText` grounding, and the same authored fallback when the AI
  route fails or is disabled. **A region change is not a reason to skip the
  fallback path** — a child who gets the fallback line must still end up
  inside the hive;
- the session survives the region change, asserted in a test that drives the
  step and then submits the next one;
- unmounting mid-transition leaks neither renderer, and the test asserts
  both are disposed;
- entering the hive, leaving, and re-entering the forest region does not
  restart the adventure or lose the child's place;
- **the hive has been looked at.** Storyboard open question 3 — whether a
  room of 1.4m hexagons reads as "inside a beehive" — is answered here, with
  a screenshot, in the negative or the affirmative. SC-4 answered the
  castle's equivalent silhouette question in the negative, and knowing that
  was worth more than not knowing it.

**If the region change turns out to need an engine change**, stop and write
an ADR before continuing. Every other phase in this roadmap is content and
placement; this one is the only place the boundary ADR-008 draws comes under
real pressure, and quietly relaxing it inside a scene file is how that kind
of constraint dies.

## WF-5 — The waggle dance (beats 5–8)

The strongest 3D beat in the forest, and the one the whole thesis is for.

Deliverables:
- Buzz on the dance floor, `Idle` until approached, then `Talk`;
- three sister bees around her, cloned `npc-buzz` placements playing `Idle`
  — **cloned through `instantiateAsset`, never instanced**, since `npc-buzz`
  is multi-part;
- **the waggle run as scene-driven TRS motion**, not a glTF clip: Buzz
  translates along an authored straight line while her abdomen oscillates,
  exactly five times, then turns and loops back. The sequence ends; it does
  not loop;
- a short run performed by one sister, for comparison, from rung 3 of the
  existing hint ladder onward and once unprompted during beat 6;
- a "watch again" control on the dance floor that replays the run from the
  start, unlimited, with **no hint-rung cost, no wrong answer, and no
  counter of any kind**;
- `observe-the-dance`, `count-the-waggles` and `science-comprehension-check`
  staged as HUD cards, unchanged;
- `Celebrate` on the comprehension check being answered.

Exit criteria:
- **exactly five waggles, asserted in a test** against the same
  `correctValue` the adventure declares, read from
  `BUZZ_AND_THE_WAGGLE_DANCE` rather than typed a second time. Content and
  question can never drift apart — the castle's SC-8 makes the same demand
  of its nine stars;
- the five are discrete and separable: a test asserts the sequence emits
  five distinct waggle events, and replaying emits five more;
- the whole run is visible from inside the dance floor's approach zone
  without moving, asserted geometrically;
- the existing five-rung hint ladders on all three steps are unchanged,
  asserted verbatim in a test the way `theStorykeepersTale.test.ts` now pins
  the castle's;
- replaying the run mutates no session state at all;
- **the run has been looked at**, and the five waggles counted from a
  screenshot sequence at the child's eye height — not in an asset viewer.
  SC-5's easel defect (a mountain peak rendering as a 30cm cone sticking out
  of a picture) and SC-1's rod-length risk both say the same thing: the only
  test of whether something is legible at eye height is looking at it from
  eye height.

## WF-6 — The forest answers (beats 9–10)

The world change, and the end of the critical slice.

Deliverables:
- `wonder-reflection` staged at the hive mouth, looking out;
- on `WAGGLE_DANCE_DISCOVERED`: `flower-patch-bloomed` replaces
  `flower-patch-bare` in the hive clearing, and `wonder-stone-bee-lit`
  replaces `wonder-stone-bee` at the hub;
- read once at construction, the same call `pirateBuilderBayRegion.ts`
  documents for the bridge and SC-6 made for the shelved book — a
  re-entering child finds the forest already changed, not an animation
  replayed each visit. Both variants load up front so the change costs no
  fetch;
- the visiting butterfly, drawn only when `SAVE_THE_BUTTERFLY_GARDEN_COMPLETE`
  is present, exactly as `wonderwildForestDecor.ts` already authors it.

Exit criteria:
- the existing `WORLD_CHANGE` step, its payload and its `changeKey` are
  unchanged;
- **it is driven by the step being on screen, not by a submit.** A
  `WORLD_CHANGE` step has no answer to submit: `useAdventureSession` writes
  the `WorldChange` and advances past it itself. SC-6 established this;
  wiring it to a submit would simply never fire;
- a child who completes the tale, leaves, and returns finds the flowers and
  the lit stone;
- the whole-grid `GRASS` → `BLOOM` recolour the current Phaser scene
  performs is **not** carried over. The two things the adventure's own text
  promises are the consequence;
- the bare patch was placed in WF-2 and a test asserts it is on ground the
  trail from the hub to the hive passes;
- looked at before and after, at the patch and at the stone.

**Stop and re-evaluate here.** This is the point at which the region is
worth playtesting and the rest of the roadmap is worth re-costing.

---

## WF-7 — The two secrets

Parallel with WF-8 and WF-9. The calm stop is **deliberately not in this
phase**; see below.

Deliverables:
- the glow moss in the fern bank, firing the existing
  `DISCOVER wonderwild-glow-moss` through the same `DiscoveryAction` the
  card-based forest and the other regions render, so the authored message,
  the reward, and the already-found case have one implementation;
- the cave mouth, firing the existing `DISCOVER wonderwild-glowworm-cave`,
  with the authored `lockedMessage` when the child has no jar and the lit
  interior — emissive ceiling, crystal on the floor — when they do;
- enough ferns that the glow is a thing found under something, not a green
  lamp on a lawn.

Exit criteria:
- the glow moss stays **unmarked**: no HUD cue, no map pin, no reticle name,
  no toast, and no entry in the "Things to do here" list. Assert every one
  of those routes stays shut — SC-7's equivalent test caught a leak the
  moment the zone was added to the accessible list;
- "The Quiet Places" (`islandQuests.ts`) still advances on both discoveries;
- the glowworm cave grants `glowworm-crystal` through the existing reward
  rule and nothing else;
- **nothing that teaches anything is placed inside the cave.**
  `islandDiscoveries.ts`'s fourth authoring rule is that no secret gates
  learning content, and the cave sits behind `ITEM_OWNED glowing-moss-jar`.
  A test that fails if a learning objective ever appears behind that gate is
  worth more than a comment saying not to.

### The calm stop is not a deliverable here, and that is deliberate

The storyboard's beat 13 has no phase. SC-7 went looking for the
session-time implementation it was told to build on and found that
`ChildProfile.sessionMinutes` is validated, stored, editable and displayed,
and that **nothing in `src/` reads it at play time.** There is no clock,
no overlay, and nothing to be identical to.

Putting a session timer in `wonderwildForestScene.ts` would do what putting
one in `storykeeperCastleScene.ts` would have done: give the app its only
session-limit behaviour in one glade of one location for one age band. MVP
scope item 11 ("session time controls and a calm stopping point") is
app-wide work, it is half built, and it belongs outside both region
roadmaps. When it exists, staging it here is an afternoon: the light goes
long and Chatty settles on the centre stone.

## WF-8 — "Who Lives Here?" (Sprouts)

**Gated on content approval. Do not author before it is granted.**

Wonderwild Forest has no Sprouts adventure today, and it has no Explorer
adventure either — it is the only location on the island with a single arc.
A three-to-four-year-old can currently walk into the forest and tap six
sprites for six sentences.

Proposed deliverables:
- a new `AdventureDefinition`, `ageBands: ['SPROUT']`, three beats: walk to
  the pond and find who lives in the water, walk to the hive clearing and
  find who lives in the hive, walk to the leaf hollow and find who lives
  under the leaves. Classification, vocabulary and observation;
- one narrated sentence per beat, no reading required, `APPROACH` triggers
  only, no raycast, reticle hidden;
- **its own `changeKey`**, not `WAGGLE_DANCE_DISCOVERED`. Reusing the
  Pathfinder key would record in a parent summary that a three-year-old
  discovered why bees dance. The castle's SC-10 could reuse
  `FIRST_STORY_TOLD` because its Sprout does tell a story; this one cannot;
- its own small consequence at the end, sited in a glade the Sprout visited;
- an age-band branch in the world view choosing which adventure this region
  offers.

Exit criteria:
- it reuses every glade and asset WF-1 to WF-6 already built — **new
  authored content, not an engine change**;
- a Sprouts session completes inside the 5-to-8-minute band target;
- `adventureInvariants.test.ts` covers it like every other adventure;
- the new `changeKey` appears in the parent-facing summary as what it
  actually is.

## WF-9 — "How Seeds Travel" (Explorers)

**Gated on content approval. Do not author before it is granted.**

Proposed deliverables:
- a new `AdventureDefinition`, `ageBands: ['EXPLORER']`, sited at the Leaf
  Hollow, entered from the Wonder Wall's `wonder-seeds` stone;
- on completion, the seed stone lights, exactly as the bee stone does.

Why the Leaf Hollow and not the glowworm cave, which is the more atmospheric
setting: the cave is behind `ITEM_OWNED glowing-moss-jar`, and
`islandDiscoveries.ts` rule 4 forbids a secret gating learning content.
Putting an Explorer arc in there would either violate that rule or need an
ADR to relax it, and neither is worth it when an ungated alternative already
exists. The Leaf Hollow is one of the five discovery points
`docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 32
names ("Leaves → Seasons adventure"), it is ungated, and it is the place the
`wonder-seeds` stone already points at.

Exit criteria:
- `wonder-seeds` stops taking the `wonder-wall-fallback` branch, and
  `buzzAndTheWaggleDance.ts`'s fallback step is **still reachable** from the
  two remaining unbuilt questions and still tested;
- a second lit stone changes nothing about the first;
- the Wonder Wall gains no counter, no progress bar, and no "2 of 4" label.
  Lit stones are the only signal, they are never taken away, and nothing
  anywhere totals them.

## WF-10 — Accessibility, performance, and the retirement gate

A gate, not a feature. Nothing in WF-2 to WF-9 may claim the forest is
finished before this passes.

Deliverables:
- the Sprouts (ages 3–4) accessibility playtest ADR-008 requires, recorded
  in `docs/ACCESSIBILITY_AUDIT.md` or `docs/PILOT_READINESS.md`. **This
  region raises the stakes on it**: the shrink is the most
  motion-sensitive transition on the island, and it is on the Pathfinder
  critical path, not tucked behind an Explorer secret;
- a profiling pass on a target tablet or Chromebook, not a development
  desktop: draw calls, frame time in the densest part of the tree line, and
  load time to first walkable frame — plus the cost of the region rebuild at
  the shrink, which is this region's own performance question and has no
  precedent anywhere in the repo;
- LOD tuning on `foliage-tree` and the ferns **only if** that profile shows
  a real budget problem;
- an audit that every learning step in the region has a working HUD
  equivalent, and that no learning objective is reachable only by walking,
  looking, or aiming. Beat 7 gets particular attention: counting an
  animation is the closest this roadmap comes to a motor-skill dependency,
  and the authored hint ladder's fourth rung stating the number in words is
  what keeps it from being one;
- documentation: `docs/IMPLEMENTATION_STATUS.md`, a `docs/CONTENT_SOURCES.md`
  note about the horizontal comb, and an ADR if any standing constraint in
  this roadmap's preamble had to be relaxed.

Exit criteria:
- the playtest has **run**, with results recorded. If it fails for Sprouts,
  the region ships for Pathfinders and Explorers and Sprouts keep the
  card-based route — that outcome does not block the older bands;
- the shrink specifically is cleared for motion sensitivity, or it is
  replaced with a hold-and-fade the playtest does clear;
- performance is within budget on target hardware;
- only then may the card-based forest route be **retired** for a band, and
  only for a band the playtest cleared. Being the default since WF-2 is not
  retirement: until this gate passes, every band can still reach the card
  route, and Sprouts still start there.

## Deliberately out of scope

Not in this roadmap, and not to be added without separate approval: vertical
traversal, climbing, or flight; any scale term in the controller or camera;
AI-generated imagery or textures; free-text question input on the Wonder
Wall; open-ended chat with Buzz or Chatty; an NPC that follows the child;
any timer, streak, or score; extending `assets/animationVocabulary.ts`;
weather or a day/night cycle; and retiring the card-based forest route ahead
of WF-10.

### Third-party asset kits — still not yet

**The 2026-08-28 decision holds** (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md`,
"Third-party asset kits — not yet"): every file in `public/models/` is
generated from `scripts/generate-world-assets.ts` in this repo.

The forest is, however, the **strongest candidate on the island** for
revisiting it, and stronger than the castle was. The castle's argument
against importing was that most of its geometry is gameplay — a door with no
handle, a shelf slot visibly empty, three rods whose lengths are the graded
answer. Almost none of Wonderwild is like that. Trees, ferns, mushrooms,
logs, reeds and lily pads are pure scenery, they are the bulk of the
placements by a wide margin, and CC0 forest packs are the best-covered
category in the whole free-asset ecosystem.

What does not change: `comb-cell`, the four wonder stones, `npc-buzz`, and
the two state-variant pairs stay generated. The stones' carvings are the
choice, the cell shape is the hive's whole legibility question, and a
state-variant pair needs identical vertices across both halves, which two
downloaded models never have.

**When to revisit: after WF-6**, and for the A.3 kit pieces only. By then
the forest is walkable and it is clear what actually looks thin. The
import work itself — scale normalisation to 1 unit = 1 metre, re-pivoting
from centre to ground, and either a texture-loading test path or a
strip-textures-on-import step — still does not exist and is still its own
phase with its own conventions section.

---

# Appendix A — Models and characters

Everything WF-1 has to author, and everything it does not. Placement counts
are estimates read off the storyboard's region plan, not authored numbers —
WF-0 produces the authored ones.

Headline: **about 29 new assets, one of which is a character.** Three of
them serve only WF-7's secrets and can be deferred without blocking the WF-0
to WF-6 slice, leaving about 26 for the slice itself. At the existing pack's
1–12 KB per asset the whole forest kit is a few hundred kilobytes on disk —
**size is not the constraint here, authoring time is.**

## A.1 What you do **not** need

- **No child avatar model.** The region is first person. The camera is the
  child; nothing is rendered for them.
- **No new companion asset.** `companion-chatty` exists and is reused
  unchanged on the centre stone. The HUD companion cue uses
  `ChattyAvatar.tsx` (Canvas 2D), not a model.
- **No water asset.** The pond is scene geometry with a collider, following
  `pirateBuilderBayScene.ts`'s `addWater`.
- **Almost the entire Phase 34 outdoor kit is reused as-is:**
  `ground-tile`, `foliage-tree` (with its existing LOD level),
  `foliage-bush`, `rock`, `path`, `signpost`, `collectible-gem`. This is the
  single biggest reason WF-1 is half the size of SC-1.
- **Nothing from the castle pack.** `wall-stone`, `ceiling-tile`, `archway`,
  `bookshelf` and the rest have no role outdoors, and the hive is comb, not
  masonry.
- **No new animation clips.** See A.6.

## A.2 Recolours — existing geometry, new material (3)

The cheapest assets in the pack: same primitive, different
`baseColorFactor`, one generator function each.

| Asset | From | Placements | Notes |
| --- | --- | --- | --- |
| `ground-tile-moss` | `ground-tile` (4×4m) | ~60 | ~940 m² of forest floor across seven glades and the trails |
| `ground-tile-comb` | `ground-tile` | ~12 | The hive interior's floor, warm amber |
| `path-forest` | `path` (1.5×1.5m) | ~34 | The trails. The bee's trail is the same asset laid wider, not a second one |

## A.3 New kit pieces — instanced (9)

Every one of these must be authored **single-mesh** or be placed
individually instead.

| Asset | Placements | Phase | Notes |
| --- | --- | --- | --- |
| `fern` | ~40 | WF-2 | Ground cover, and what the glow moss hides under |
| `flower-cluster` | ~24 | WF-6 | The bloom. Placed only when `WAGGLE_DANCE_DISCOVERED` is present |
| `mushroom-cluster` | ~10 | WF-2 | Flavour |
| `log-fallen` | ~5 | WF-2 | Flavour, and something to walk around |
| `reed` | ~14 | WF-2 | The pond edge |
| `lily-pad` | ~6 | WF-2 | The pond, and where the frog sits |
| `standing-stone` | ~5 | WF-2 | The night clearing's ring. Plain, uncarved — the four Wonder Wall stones are separate props because their carvings differ |
| `comb-cell` | ~40 | WF-4 | **The riskiest single asset in this pack.** A hexagonal cell with a hole in it may not be authorable as one mesh; SC-1 found exactly this with `archway`. If it is not, the hive's cell count comes down before WF-4 is costed |
| `comb-cell-capped` | ~20 | WF-5 | The amber honey stores along the hive's far wall. Same single-mesh requirement, and no hole in it, so the safer half of the pair |

## A.4 New props — placed individually (10)

| Asset | Count | Phase | Beat |
| --- | --- | --- | --- |
| `wonder-stone-seed` | 1 | WF-3 | 02 — carving must be geometry, not texture |
| `wonder-stone-sun` | 1 | WF-3 | 02 |
| `wonder-stone-chrysalis` | 1 | WF-3 | 02 |
| `beehive` | 1 | WF-2 | 03 — on a trunk in the hive clearing |
| `hive-mouth` | 1 | WF-4 | 04, 09 — the interior side of the way out |
| `frog` | 1 | WF-2 | flavour |
| `leaf-pile` | 1 | WF-2 | flavour, and WF-9's setting |
| `butterfly` | 1 | WF-6 | 10 — drawn only on `SAVE_THE_BUTTERFLY_GARDEN_COMPLETE` |
| `glow-moss` | 1 | WF-7 | 11 — emissive |
| `glowworm-ceiling` | 1 | WF-7 | 12 — emissive, inside the cave |

## A.5 State-variant pairs (6 assets, 3 pairs)

Each state is a **separate asset**, picked at construction time — the
`bridge-plank` / `bridge-plank-repaired` precedent, not a runtime material
swap.

| Pair | Assets | Swapped by | Phase |
| --- | --- | --- | --- |
| `wonder-stone-bee` / `-lit` | 2 | `WAGGLE_DANCE_DISCOVERED` | WF-3, WF-6 |
| `flower-patch-bare` / `flower-patch-bloomed` | 2 | `WAGGLE_DANCE_DISCOVERED` | WF-2, WF-6 |
| `cave-mouth` / `cave-mouth-lit` | 2 | `ITEM_OWNED glowing-moss-jar` | WF-2, WF-7 |

`flower-patch-bare` and `cave-mouth` are placed in **WF-2**, not in the
phase that swaps them. Both have to be visible on the child's first walk
through the forest, or their payoffs land on ground nobody looked at. SC-6
paid for learning this.

`wonder-stone-seed` gains a `-lit` variant only if WF-9 is approved and
built; it is not in this count.

## A.6 The one new character: Buzz (1)

`npc-buzz`, `kind: 'character'`.

**Clips:** `Idle`, `Talk`, `Celebrate` — all three already in
`assets/animationVocabulary.ts`. **No vocabulary extension is needed, and
none should be added.**

**The waggle run is not a clip.** There is no `Waggle` or `Dance` name in
the vocabulary, and adding one would be the first extension since Phase 34 —
which SC-1 explicitly declined to make. It is also the wrong fix on its own
merits. Beat 7 needs exactly five discrete waggles, stopped at the end,
replayable on demand, and countable from a fixed viewpoint. A looping glTF
clip gives none of those cleanly; a TRS sequence the scene drives on the
cloned node gives all four, and it is the same thing the castle's scene
already does for the tapestry sway and the carried plate.

**No `Walk` clip.** Buzz's translation along the run is scene-driven for the
same reason. She never leaves the dance floor and never follows the child.

**Authoring recipe — follow `npcPip()` and `npcQuill()` in
`scripts/generate-world-assets.ts` exactly.** Both are node hierarchies
whose clips are TRS rotation tracks on named nodes. Buzz needs `Body`,
`Head`, `Abdomen` and `Wing`; the scene's waggle sequence oscillates
`Abdomen` and translates `Body`, so both must be named nodes with the
`Abdomen` pivot at its joint rather than at its centre. There is no
skinning, no skeleton, and no bones anywhere in this pipeline, and adding
them would mean extending `assets/gltfAssembler.ts`.

**Two consequences of Buzz being multi-part:**

1. **Buzz can never be instanced.** `createInstancedMeshFromAsset` keeps
   only the first mesh it finds, which would render a floating abdomen. The
   three sister bees are `instantiateAsset` clones, which cost four scene
   graphs rather than one instanced draw call — acceptable at four, and the
   reason the sisters are three and not twenty.
2. **The raycast target needs naming.** Use `Body`, as
   `docs/THREE_WORLD_ASSET_CONVENTIONS.md` suggests and `npc-quill` does.

## A.7 Constraints every asset inherits

From `docs/THREE_WORLD_ASSET_CONVENTIONS.md`. None of these are negotiable
within this roadmap:

- **Ground-pivoted.** Local origin at base centre, `y` spanning
  `[0, height]`, so placement code can set `position.y = 0`.
- **1 unit = 1 metre**, +Y up. This is what makes the hive work: a comb cell
  is authored at 1.4m because at bee scale that is what it would be.
- **Texture-free.** Flat `baseColorFactor`, optionally `emissiveFactor`. No
  image, no UV accessor — this is what keeps every asset loadable in
  Vitest's jsdom.
- **Single-mesh for anything instanced.** Everything in A.3 is an
  instancing candidate and must each be one mesh, or be placed individually
  instead.
- **TRS keyframe tracks only** on animated assets.
- **Self-contained `.gltf` JSON** with a base64 buffer, under
  `public/models/`, regenerated by `npm run assets:generate` and committed.
- **`doubleSided: true`** on every material.

## A.8 Which assets block which phase

| Phase | Blocked without |
| --- | --- |
| WF-2 | A.2 in full, `fern`, `mushroom-cluster`, `log-fallen`, `reed`, `lily-pad`, `standing-stone`, `beehive`, `frog`, `leaf-pile`, `flower-patch-bare`, `cave-mouth` |
| WF-3 | The four wonder stones (`-bee` plus three), `companion-chatty` (exists) |
| WF-4 | `comb-cell`, `hive-mouth`, `ground-tile-comb` |
| WF-5 | `npc-buzz`, `comb-cell-capped` |
| WF-6 | `wonder-stone-bee-lit`, `flower-patch-bloomed`, `flower-cluster`, `butterfly` |
| WF-7 | `glow-moss`, `glowworm-ceiling`, `cave-mouth-lit` |
| WF-8 | Nothing new. "Who Lives Here?" reuses WF-2 to WF-6's glades entirely |
| WF-9 | `wonder-stone-seed-lit`, plus whatever the seed content needs |

**WF-1 does not have to ship whole.** Authoring it in WF-2/WF-3/WF-4 order
lets the forest go up while Buzz is still being built. Only the manifest and
generator plumbing has to land first.

## A.9 Risks in this inventory

1. **`comb-cell` may not be single-mesh.** The whole hive interior's draw
   budget depends on instancing it, and a hexagon with a hole in it is
   exactly the shape SC-1 discovered `archway` could not be. Settle this
   first in WF-1, not during WF-4.
2. **Whether a room of hexagons reads as a beehive.** Texture-free means
   silhouette, not picture — SC-4 found the castle's dragon portrait reading
   as a small tree. The hive has no per-object naming to fall back on the way
   a reticle names a portrait, so the mitigations are Chatty's narration and
   the authored text, and the answer comes from a screenshot at WF-4.
3. **The five waggles must be countable at eye height, from one spot.** This
   is the counting task's counterpart of the castle's nine stars, with the
   extra difficulty that the thing being counted moves. Verify in the
   browser at 1.6m, not in an asset viewer.
4. **The tree line is the densest instancing on the island.** More
   `foliage-tree` placements than Welcome Harbor and the bay combined. It is
   the one thing in this pack likely to move WF-10's profiling numbers, and
   it is also the one asset that already has an LOD level authored, so the
   fix is tuning rather than authoring.
5. **The bee's trail has to read as more worn than the other three** from
   inside the hub, or beat 2's wayfinding is nothing at all and the child
   wanders. It is a width and a colour, and both are cheap to change once
   someone has looked at it.
