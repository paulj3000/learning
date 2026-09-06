# Storykeeper Castle — First-Person Region Roadmap

**Status:** SC-0 through SC-6 are implemented, which **completes the
critical vertical slice**. **SC-8 is now complete** and **SC-9 is complete
except for beat 11's writing room**, both unblocked by ADR-019, which
settled how a story chapter may be played inside a region. SC-7 remains
**half implemented**: beat 12's tapestry nook is built, and beat 13's calm
stop is blocked on a session clock that does not exist anywhere in the
product. **SC-10 is complete.** **SC-11's gate is open on one of three deliverables
and therefore does not pass**: the HUD-equivalence audit is done and is a
test, but the Sprouts playtest has not run and no profiling pass has
happened on target hardware. **The card-based castle remains every band's
route.**
This is the stop-and-re-evaluate point: the region is now worth playtesting,
and the rest of the roadmap is worth re-costing before any of it is built.

A standalone roadmap for rebuilding Storykeeper Castle as a first-person
Three.js region. It has its own phase numbering (**SC-0** through
**SC-11**) deliberately, so it can be built independently of, and
concurrently with, `docs/ROADMAP.md`'s Phase 35+ Android platform
sequence. Nothing here blocks or is blocked by those phases.

The design this roadmap builds is specified in
`docs/STORYKEEPER_CASTLE_3D_STORYBOARD.md` (13 beats, floor plan,
age-band routing, asset kit). This document is the build order and the
exit criteria; the storyboard is the what and the why. Read it first.

Standing constraints from the storyboard, restated because every phase
below inherits them:

- **The engine does not change.** No new adventure step, no new story
  scene kind, no new world-engine event, no edit to any authored
  adventure or story text. Every 3D interaction resolves to an option id
  the existing content already owns (`castleChoiceBindings.ts`, SC-0).
- **Every 3D route has a HUD equivalent** driving the identical step.
  Walking, looking, and aiming are never the only way to a learning
  objective (`docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md`
  section 42).
- **No vertical traversal.** `firstPersonController.ts` is flat-plane.
  The Setting Tower is a ground-floor lantern room, not a climb.
- **ADR-008's Sprouts gate still applies.** The existing card-based
  castle route is not retired for any band by any phase below except
  SC-11, and not for Sprouts until the accessibility playtest owed from
  Phase 32 has run.

## Dependency order

```text
SC-0  region data + bindings ──┬──> SC-2 walkable shell ──> SC-3 Quill
SC-1  asset kit ───────────────┘                              │
                                                              v
                          SC-4 gallery + tower ──> SC-5 hearth/lectern/easel
                                                              │
                                                              v
                                      SC-6 the book on the shelf  ← slice complete
                                                              │
                        ┌─────────────────────────────────────┤
                        v                                     v
                 SC-7 secrets + calm stop            SC-8 clues and stars
                                                              │
                                                              v
                                                     SC-9 lock + writing room
                                                              │
                        SC-10 Sprouts content (needs approval)│
                                                              v
                                              SC-11 accessibility + retirement gate
```

**SC-0 and SC-1 are parallel** and share no files. **SC-7 is parallel**
with SC-8 and SC-9. **SC-10 is parallel** with everything from SC-4
onward once approved, since it reuses SC-2 to SC-6's rooms and assets and
adds only content.

**The critical vertical slice is SC-0 to SC-6.** At SC-6 a Pathfinder can
walk into the castle, choose a hero by lighting a portrait, choose a
setting by standing at a window, answer Quill, seat three plates, and
watch their book slide onto a shelf that was visibly empty when they
arrived. Stop there and re-evaluate before building SC-7 onward.

---

## SC-0 — Region data and choice bindings — **DONE**

Pure data and pure functions. No `three` import, no rendering, nothing
child-facing. Everything here is unit tested, and every later phase reads
from it.

Deliverables:
- `three/storykeeperCastleRegion.ts` — the storyboard's floor plan as
  authored numbers: ground extents, room rects, archway gaps, the east
  corridor, boundary and wall colliders, and the zone rects for every
  `APPROACH` trigger (entrance, each spoke room, each tower window, the
  tapestry corner, the harbor exit). Same split and same `RectZone` shape
  as `pirateBuilderBayRegion.ts`;
- stable semantic ids for every entity the later phases place — portraits,
  windows, lectern, plates, hearth, easel, shelf slot, clues, rods,
  carvings, secret door — declared here, not invented in the scene file;
- `three/castleChoiceBindings.ts` — the entity-id to adventure-option-id
  map, plus the resolver both the scene and the world view call;
- `discovery/checkpoints.ts` — `STORYKEEPER_CASTLE_CHECKPOINTS`, the five
  authored checkpoints in the storyboard's table.

Exit criteria:
- `storykeeperCastleRegion.test.ts` passes: no two room rects overlap,
  every archway gap actually connects the rooms it claims to, every zone
  sits on walkable floor, and the harbor exit is reachable from spawn;
- `castleChoiceBindings.test.ts` passes and is the authoring check: every
  entity id in the map resolves to an option id that
  `THE_STORYKEEPERS_TALE` or the secret-door templates actually contain.
  An unresolvable binding is a **test failure, never a runtime fallback**;
- no file in this phase imports `three`.

### What shipped

- `three/storykeeperCastleRegion.ts` + test — eight rooms, seven archways,
  every zone and entity spot, and `buildWallSegments`, which **derives**
  wall colliders from room floors minus archway gaps rather than
  hand-listing two dozen rects that would drift out of agreement with each
  other. `isOnFloor` / `isBlocked` / `isWalkable` are its query surface.
- `three/castleChoiceBindings.ts` + test — 15 bindings across the 5 steps
  the storyboard stages as world objects, and the resolver the scene will
  call.
- `discovery/checkpoints.ts` — `STORYKEEPER_CASTLE_CHECKPOINTS`, five
  authored spots, `entrance` first so a first-time child spawns at the
  doors.
- 52 new tests. No `three` import in any of it.

Two things worth carrying into SC-2, both found by the tests rather than
by reading:

- **The three Setting Tower window zones met at their corners.** A single
  step forward would have stood the child at two settings at once, and
  `choose-setting` would have come down to listener order. The zones are
  now provably disjoint, and the test that proves it is not optional
  decoration — it is the only thing standing between that beat and a
  nondeterministic choice.
- **The pattern-lock carvings sat 0.72m from the nine counting stars.**
  Close enough that a child counting nine could reasonably have counted the
  lock's three stars too. The column moved to a clear 1.4m away, and the
  test now floors that separation at 1m (roadmap A.10, risk 3).

The reachability test flood-fills the floor on a 0.25m grid from the spawn
checkpoint and asserts every room, checkpoint, and zone is reachable. It
also re-runs the fill with the library archway sealed and asserts the Great
Library becomes unreachable — otherwise the test would pass just as well
against walls that were wrong.

## SC-1 — Castle asset kit — **DONE**

Extends the Phase 34 pipeline with the castle's own pieces. Parallel with
SC-0. Follows `docs/THREE_WORLD_ASSET_CONVENTIONS.md` exactly:
ground-pivoted, texture-free, flat `baseColorFactor`, TRS-only clips,
single-mesh for anything to be instanced, checked in under
`public/models/`.

**The full inventory — every model and character, with counts,
placements, and which phase needs it — is Appendix A.** It is kept there
rather than duplicated here so the two lists cannot drift apart. Read it
before costing this phase: at roughly **56 new assets, one of which is a
character**, SC-1 is the single largest phase in this roadmap, and about
16 of those assets are needed only by the Explorer arc (SC-8, SC-9) and
can be deferred.

Deliverables:
- the recoloured pieces (Appendix A.2) — four assets that reuse existing
  geometry with a new `baseColorFactor`, including the **ceiling**, which
  neither existing region needs because both are outdoors;
- the new kit pieces (A.3), props (A.4), state-variant pairs (A.5), and
  the easel composition set (A.6);
- `npc-quill` (A.7), the one new character;
- generator functions in `scripts/generate-world-assets.ts`, manifest
  entries in `assets/manifest.ts`, regenerated and committed output.

Exit criteria:
- `npm run assets:generate` **followed by `npm run format`** reproduces the
  committed `public/models/` byte-for-byte. (The generator emits minified
  `JSON.stringify` output; `public/models` is not in `.prettierignore`, so
  the checked-in files are the pretty-printed ones. Generating without
  formatting leaves 78 files failing `format:check`. This criterion
  originally said "byte-for-byte" with no formatting step, which was simply
  wrong about how this repo already worked.)
- `manifest.test.ts` passes: every url resolves, every declared clip is in
  the vocabulary;
- `assetLoader.test.ts` gains one new case per new shape category — a
  single-mesh instanced kit piece, and `npc-quill` through the real
  `GLTFLoader.load()` fetch path;
- **anything to be instanced is verified single-mesh.** `bookshelf` and
  `portrait-frame` are the two at risk;
  `createInstancedMeshFromAsset` silently keeps only the first mesh it
  finds — the trap `foliage-tree` already documents.

Explicit non-goals: textures, UV accessors, skinned animation, LOD
variants. LOD is added later and only on a measured budget problem
(SC-11), never by default.

### What shipped

59 new assets in `public/models/` (78 total, 596 KB; the largest single
file, `npc-quill.gltf`, is 20 KB), generated by a new castle section in
`scripts/generate-world-assets.ts`, registered in `assets/manifest.ts`, and
covered by `assets/castleKit.test.ts` plus three new cases in
`assets/assetLoader.test.ts`. The 19 pre-existing assets regenerate
byte-identically, so nothing in the Phase 34 pack was disturbed.

Four authoring decisions worth carrying forward:

- **`archway` and `window-frame` are multi-part, so they cannot be
  instanced** — contrary to what Appendix A originally assumed. A one-mesh
  archway cannot have a hole in it. Both are placed individually instead,
  which costs nothing at 7 and 3 placements. The instancing-safe list is now
  15 assets, asserted mesh-by-mesh in `castleKit.test.ts` rather than left
  to a comment.
- **The three story plates carry counted notches (one, two, three) rather
  than three different pictures.** A five-year-old can compare one notch
  against two far more reliably than they can tell three untextured
  silhouettes apart, and the HUD list names them in words regardless.
- **The easel is composed, not enumerated**, as Appendix A.6 recommended:
  three hero silhouettes plus three setting backdrops, layered at placement
  time. Seven assets rather than ten, and a fourth hero would cost one.
- **Keeper Quill has an `Arm` and a `Quill` node** so `Point` (beats 2 and
  5) is an arm rotation held at the end rather than sprung back — it is
  wayfinding, and the child needs it still there when they look up from the
  HUD. `ReactConcerned` is a slow head tilt, never a scold.

`castleKit.test.ts` also guards the two conventions most likely to be
broken silently later: nothing in the castle pack references an image,
texture, or `TEXCOORD_0` (which is what keeps every asset loadable in
jsdom), and the three pattern-lock rods are strictly increasing in length
with a 1.5x step between neighbours — `order-the-keys` grades ordering *by
length*, so a child who cannot tell the medium rod from the long one at eye
height is being asked to guess rather than to reason.

Still open from Appendix A.10, and not something a test can settle: whether
a five-year-old reads the three portrait silhouettes as *puppy, dragon,
fox*. That is SC-4's playtest question. The mitigation is already in place —
Quill names each aloud, the HUD card names them in text — so the silhouette
is never the only cue.

## SC-2 — The walkable shell — **DONE**

The castle as architecture, with nothing to do in it yet. This is the
phase that makes the region real.

Deliverables:
- `three/storykeeperCastleScene.ts` — rendering glue, in the same
  not-unit-tested bucket as the other scene files. Builds floors, walls,
  archways, the east corridor, and the boundary colliders from SC-0's
  data using SC-1's kit through `sceneKit.ts`'s existing helpers;
- interior lighting: the west doorway key light and the ambient rig from
  `createSceneBootstrap`, tuned so the Great Library reads as the darkest
  point and the hearth corner as the warmest;
- `three/StorykeeperCastleWorldView.tsx` and
  `routes/StorykeeperCastleWorldPage3D.tsx`, route
  `/island/:childId/world/storykeeper-castle-3d`, naming and lazy-load
  matching `PirateBuilderBayWorldPage3D`;
- the existing `WorldHud` over the canvas, unchanged;
- checkpoint save on zone entry, and spawn from
  `ChildWorldState.lastCheckpointId` — an authored id, never a coordinate;
- the harbor exit, returning to the island map.

Exit criteria:
- a child can walk from the doors to every one of the six rooms and back
  without leaving the floor, passing through the Story Hall each time;
- no room is reachable through a wall, and no collider traps the camera;
- crossing a checkpoint saves it, and re-entering the region spawns there
  with the HUD toast naming the spot;
- `StorykeeperCastleWorldView.test.tsx` covers mount, unmount without
  leaking the bus or the renderer, and the load/error states, mirroring
  `PirateBuilderBayWorldView.test.tsx`;
- the existing card-based castle route still works and is still the
  default. This route is additive.

### What shipped

`three/storykeeperCastleScene.ts`, `three/StorykeeperCastleWorldView.tsx`
and `routes/StorykeeperCastleWorldPage3D.tsx`, on
`/island/:childId/world/storykeeper-castle-3d`, lazy-loaded and reachable
from the castle's location page next to the existing Phaser link. The
castle is built entirely from SC-0's numbers and SC-1's kit: eight room
floors and eight ceilings as scaled `ground-tile-stone`/`ceiling-tile`
slabs, every one of SC-0's derived `WALL_SEGMENTS` tiled in `wall-stone`,
the seven `archway` pieces placed individually, a `carpet` run from the
doors to Quill's lectern, and the `door` itself so the way out is visible
from inside. Colliders are `WALL_SEGMENTS` and nothing else, so the walls
the child sees and the walls that stop them are the same authored data.

Three things worth carrying into SC-3:

- **`runPlacements` was turning every kit panel 90 degrees**, and the
  castle is nothing but panels. The helper aligned a piece's local **+Z**
  with the run, but every piece tiled through it is authored width-first
  (`wall`, `wall-stone` and `fence` are all `buildPlanePrimitive`, wide in
  local X with their normal on +Z). A wall run therefore rendered as a row
  of 2m fins standing across the run with 2m gaps between them. Welcome
  Harbor's buildings and its fence have looked like that since Phase 34;
  the same file's hand-placed doors, left at `rotationY` 0 on a north/south
  side, were already using the correct convention and disagreeing with the
  walls beside them. Fixed in `sceneKit.ts`, which fixes Welcome Harbor
  too. Its test now asserts the *transformed direction* of a panel rather
  than a raw angle, because asserting the angle is what let a 90-degree
  error stand.
- **Panels are drawn on each room's own inner face**, inset half a wall
  thickness from the shared centre line, rather than on the line itself.
  Rooms that share an edge produce two overlapping wall colliders by
  design, and two coplanar panels in the same place would z-fight; two
  faces half a metre apart is both correct and gives the archways a
  readable depth to cut through.
- **Each panel is scaled to the exact quotient of its run**, not tiled at a
  whole 2m. An overhang here is not cosmetic: a wall next to a doorway is
  usually not a multiple of the panel width, and the spare panel grows
  straight across the archway gap and bricks up the door while the collider
  still lets the child walk through it. `storykeeperCastleScene.test.ts`
  holds that invariant, and it is the reason the scene file exports its two
  pure placement helpers at all.

That last test needed two attempts to be worth having. Written the obvious
way it could not fail: a panel is a plane, so its footprint is a
zero-thickness line, and a panel sitting legitimately on its inner face
lands exactly on the gap rect's boundary where a strict overlap test always
reports "no". It now inflates the panel's thin axis into the wall band the
gap is cut through and allows a 1cm tolerance on the long axis, and it was
checked by mutation — widening panels 1.6x and 2.4x both make it fail,
which the first version did not.

Deliberately **not** built, and not accidents: nothing is interactive.
There is no Quill, no raycast target, and so no `interact()` on the engine
handle and no "interact with what you're looking at" button, since offering
one would be a promise the room cannot keep. The view takes no `ageBand`
either — nothing in an empty castle is age-gated, and a prop nothing
honours is worse than adding it in SC-3 alongside the first thing that
needs it. The only thing the child can *do* is leave, through the existing
authored `castle-harbor-exit`, which is reachable both by walking to the
doors and from the "Things to do here" list (roadmap section 42).

Two limitations to carry forward. **The light rig is unverified.** SC-2
asks for the Great Library to read as the darkest point and the hearth
corner as the warmest, and the per-room intensities that encode that are
authored from reasoning about the floor plan, not from looking at it — no
one has seen this region rendered. **And the region has never run in a real
browser**, the same standing gap every scene file in this repo has: the
placement maths is unit tested, the engine factory is not.

## SC-3 — Keeper Quill (beats 1–2) — **DONE**

Deliverables:
- `npc-quill` placed at the lectern in the hub, `Idle` until approached;
- `NpcApproached` wired to the **existing** `recordCharacterMet` and
  `NpcConversation` path Phase 32 already uses for Pip — reused, not
  duplicated;
- adventure step `meet-keeper-quill` reachable from the conversation;
- `Talk` on conversation, then `Point` toward the north archway when the
  step advances. That gesture is the only wayfinding: no arrow, no
  waypoint marker, no forced camera motion.

Exit criteria:
- Quill's existing dialogue, memory flags, relationship points, and quest
  offer all behave exactly as they do in the card-based route;
- the reticle names Quill on focus and the HUD cue reads correctly;
- no new dialogue text is authored in this phase.

### What shipped

Keeper Quill stands at his lectern in the hub, `Idle`, facing the entry
hall. Walking up fires `NpcApproached` and records the meeting through the
**existing** `recordCharacterMet`; looking at him names him on the reticle;
pressing E opens the **existing** `NpcConversation` on the **existing**
`talk-to-keeper-quill` interaction id the Phaser castle already resolves
him to. The story hall zone offers the unchanged `the-storykeepers-tale`,
whose entry step is `meet-keeper-quill`, and swaps to the authored
already-told line once `FIRST_STORY_TOLD` is recorded — the same split the
Phaser castle makes and the same one the bay makes for its bridge.

**No content was authored in this phase, which was the point.** Quill's
dialogue, memory flags (`metQuill`), relationship points and the
`tell-a-story-together` quest offer are the ones `islandNpcs.ts` and
`islandQuests.ts` have held since Phases 23 and 25; this phase only
translates a raycast and a zone into ids that already existed.

Three things worth carrying into SC-4:

- **Quill turns to point.** `Talk` loops while the conversation panel is
  open and `Point` fires when it closes, held at its end per SC-1's note
  that the gesture is wayfinding. He also *rotates* to face the north
  archway to do it: an arm raised while still facing the child says
  "somewhere", whereas turning to look where the arm goes says "there". Any
  later clip returns him to facing the hall, so a child who comes back for
  a second conversation is not talked to by someone facing away.
- **Quill and his lectern are now solid.** SC-0 flagged the missing
  collider explicitly, and walking through the person you are about to talk
  to undoes the point of him being a place.
- **The rooms are still empty on purpose.** The gallery, tower, studio and
  library zones exist and the engine emits them, but nothing listens. Their
  Phase 14 flavour `SHOW_MESSAGE` interactions were deliberately *not*
  wired, because SC-4 replaces exactly those rooms with real learning
  steps and would only be deleting them again.

One test-quality note, because it cost real time and will recur in SC-4.
Several of these tests were flaky rather than wrong: `findBy*` resolves
from a MutationObserver callback that can run after React commits the DOM
but before it flushes passive effects, and `ThreeGameContainer` builds the
engine inside a `useEffect`. A test that emitted a bus event at that moment
emitted into a `null` bus, silently did nothing, and failed on the next
assertion — intermittently, depending on scheduling. Every such test now
waits for the engine to exist before driving it
(`renderAndWaitForEngine`), and the file was re-run six times to confirm.
SC-4 adds three more spatially-driven steps and will need the same
discipline.

Limitations carried forward, both unchanged from SC-2: **the scene has
never run in a real browser**, so Quill's placement, scale, facing and the
legibility of the `Point` gesture are all unverified, and **the light rig
is still unlooked-at**.

## SC-4 — Choices become places (beats 3–4) — **DONE**

The thesis, proved. The first phase where a learning step is driven by a
place rather than a card.

Deliverables:
- the Character Gallery: three portraits on the north wall, raycast
  interaction, `ObjectInteracted` resolved through SC-0's bindings to
  `hero-puppy` / `hero-dragon` / `hero-fox`; chosen frame swaps to
  `portrait-frame-lit` and plays `Activate`, the other two dim;
- the Setting Tower: three floor-to-ceiling arched windows, `APPROACH`
  triggers resolved to `setting-island` / `setting-mountain` /
  `setting-cave`; the chosen view brightens, the others `Close`;
- the HUD card equivalent for both steps, always available.

Exit criteria:
- both steps advance `THE_STORYKEEPERS_TALE` through
  `useAdventureSession` with **no change to the adventure definition**;
- choosing through the room and choosing through the HUD card produce
  identical session state, asserted in a test;
- the tower uses `APPROACH`, not raycast — a window is a place you stand
  at, and that keeps the beat reachable for a band that cannot aim;
- re-entering the region after a choice shows the chosen portrait still
  lit and the chosen window still bright.

### What shipped

The Character Gallery hangs three hero portraits on its north wall, aimed
at by raycast; the Setting Tower has three windows with a backdrop beyond
each, triggered by walking up to one. Both resolve through SC-0's bindings
to the option ids `the-storykeepers-tale` already declares, and the
adventure definition was not touched.

**The shape that makes this honest is that the session moved into the
room.** Starting the tale no longer navigates to the card route: the view
holds one `useAdventureSession`, and looking at a portrait and pressing the
same option on the card go through the *same* `submitAnswer`. "Identical
session state" is therefore true by construction rather than by two
implementations agreeing, and the test asserts it by comparing the actual
recorded call arguments from both routes.

To do that without a second card implementation, `AdventureRunner.tsx`'s
rendering half was extracted unchanged into `AdventureStepCard.tsx`. The
runner is now the hook plus that card; the castle is its own session plus
the same card. No behaviour changed on the card route, and its 208 tests
pass untouched.

Three things worth carrying into SC-5:

- **The roadmap's asset instructions for this phase were out of date, and
  what SC-1 built is better.** SC-4 above asks for a swap to
  `portrait-frame-lit` playing an `Activate` clip, and for the unchosen
  windows to `Close`. None of those exist: SC-1 shipped *state variants*
  (`portrait-fox` / `portrait-fox-lit`, `window-view-cave` /
  `window-view-cave-lit`) with no clips at all, which is exactly what
  `docs/THREE_WORLD_ASSET_CONVENTIONS.md` prefers over a runtime material
  swap. Both variants load up front and choosing flips which is visible, so
  a choice costs no fetch. The text above is left as written; this note is
  the correction.
- **The reticle names a portrait in the card's own words** ("A clever
  fox"), read off the adventure definition rather than authored twice.
- **Wall-mounted props measure themselves.** Every asset is
  ground-pivoted while `WallMountedSpot.y` is a centre height, so placement
  drops each model by half its own measured bounding box rather than by a
  table of authored heights that would rot the first time an asset is
  regenerated at a different size. Facing is derived from which room edge
  the spot is nearest, so sliding a portrait along its wall cannot leave it
  facing into the stonework.

Two bugs found and closed while building this, both by mutation-testing
assertions that had passed first time:

- **The bus's `removeAllListeners()` was a live hazard.** The view's zone
  effect called it on cleanup and re-runs whenever `FIRST_STORY_TOLD`
  flips, which would have silently dropped the *session's* subscriptions
  while it stayed mounted - leaving every portrait and window inert with
  nothing in the console to show for it. Individual unsubscribes only, now.
- **The "wrong step" guard was half-tested.** `choose-hero` and
  `choose-setting` are not the only bound steps: SC-0 also binds the three
  story plates to `order-the-story`, an ORDERING step whose answer is a
  sequence rather than one option id. Dropping the spatial-step gate
  initially broke no test, because the case being tested (a step with no
  bindings at all) was already covered by the binding lookup itself. The
  test now uses a plate on `order-the-story`, which is the case that will
  actually bite in SC-5 when those plates are placed in the room.

### Rendering verification (SC-2 to SC-4)

**The castle has been looked at**, which closes the "never run in a
browser" limitation for everything a still image can settle.
`.tmp-verify/harness/` mounts the real engine with a stub bus and no
backend; `.tmp-verify/castle-shots.mts` drives it through Chromium at each
authored checkpoint and screenshots the result.

Confirmed working: the castle reads as architecture from the doors, exactly
as beat 1 describes; the Great Library is the darkest room; the portraits
hang at eye height; and a chosen portrait is unmistakable, gold emissive
frame and cream mount against brown and grey.

Three real bugs found, none of which a test could see:

1. **Every tower window opened onto blank stone.** The backdrop was offset
   0.18m outward, but the gap to the wall panel is `WALL_MOUNT_CLEARANCE`
   (0.05m), so all three sat inside the wall and behind the panel. Now
   0.02m. An unchosen window shows SC-1's closed shutters; a chosen one
   opens onto a bright emissive sky.
2. **The windows floated 25cm off the floor** - a 2.7m frame centred on a
   1.6m spot. Placement now has an explicit floor-standing case.
3. **The hub had a hearth glow with no fireplace under it**, because SC-2
   lit the corner and the prop belongs to SC-5. The `hearth` model is now
   placed as scenery; beat 5's mantel interaction is still SC-5's.

**SC-1's open playtest question is answered, in the negative.** The three
silhouettes do not read as *puppy, dragon, fox* - the dragon reads as a
small tree, a green cone on a dark box with its tail floating detached
beside it. That is an SC-1 art decision, so nothing was changed here, but
it is now a known answer rather than an open question, and it matters more
because the portrait **is** the choice. The mitigations hold: Quill names
each hero aloud, the card names them in text, and the reticle names the
option in the card's own words.

**The Welcome Harbor wall fix was verified before and after.** SC-2 changed
a shipped region on reasoning alone; the same harness renders Welcome
Harbor, and reverting the one-line change shows each building as a row of
separated slabs with sky through the gaps and the roof floating, and the
fence run as a single post. With the fix: solid walls, flush roofs, real
doorways.

Still unverified, being what a still image cannot settle: walking,
collision, how the approach zones feel to enter, whether Quill's `Point`
reads as "go that way", frame rate on a real tablet, and the whole flow
against a live backend. The harness mounts the scene alone, so nothing here
exercises `useAdventureSession`, AppSync or the HUD against real data.

## SC-5 — Hearth, lectern, and easel (beats 5–7) — **DONE**

Deliverables:
- the hearth with `HERO · PROBLEM · ENDING` carved in the mantel, and the
  `comprehension-check` step staged against it — **as a HUD card**, not a
  world object. It tests what Quill said; hiding the answer in the room
  would convert a reading-comprehension check into a spatial search and
  break the anchoring `theStorykeepersTale.ts`'s header comment protects;
- Quill playing `Point` at the mantel from hint rung 3 onward. The
  existing five-rung ladder is untouched: the gesture follows it, it never
  replaces, reorders, or short-circuits a rung;
- the binding lectern: three plates picked up
  (`CollectiblePickedUp`) and seated (`BuildActionRequested` carrying the
  order) into three sockets, submitting `order-the-story` only once all
  three are seated. A wrong order lifts the plates back onto the table and
  plays `ReactConcerned`; nothing is destroyed or lost;
- the required HUD ordering list, identical in function;
- the Illustration Studio easel and `story-reflection`, with
  `easel-painted` showing flat-colour shapes from an authored 3×3 table
  keyed by (hero, setting) — nine authored results chosen in code.

Exit criteria:
- the scene never decides correctness: seating three plates emits an
  order, and the `ORDERING` step evaluates it;
- the plate route and the HUD list route produce identical session state;
- the hint ladder's rung sequence is unchanged, asserted in a test;
- **no AI image generation.** The easel is authored colour and geometry.

### What shipped

All four, and the phase divides cleanly into one puzzle and three smaller
pieces.

**The binding lectern is the puzzle.** The child picks up a stone plate
(`CollectiblePickedUp`), carries it in front of them, and seats it in one
of three sockets; the sockets fill in the order the plates are seated, and
seating the third emits `BuildActionRequested` carrying that arrangement.
The scene owns all of the physical state - what is in the child's hands,
which sockets are filled, where a lifted plate goes back to - and owns no
part of whether the arrangement is right. `castleBindingLectern.ts` turns
the arrangement into option ids through SC-0's bindings and the existing
`ORDERING` step grades it, exactly as it grades the HUD list. A plate
already in a socket can be lifted back out, so a child who spots their own
mistake can fix it without submitting first.

`useAdventureSession.submitAnswer` now resolves with the server's verdict
(it returned `void`). Beat 6 promises that a wrong order lifts the plates
back onto the table and that nothing is lost, and the room cannot know it
was wrong without either that verdict or a second copy of the grading that
ADR-012 deliberately keeps server-side. `AdventureStepCard` ignores the new
return value; every decision it could make on a verdict the engine has
already made.

**Beat 5 is a gesture, not an object.** The comprehension check stays a HUD
card, as the storyboard insists. From rung 3 of the *existing* ladder Quill
turns and points at the hearth mantel, and turns back when the step is
answered. The code reads `hintLevel` and never writes one;
`theStorykeepersTale.test.ts` now pins all five rungs verbatim, so the 3D
room can never quietly become a reason to edit a step the card route also
runs.

**Beat 7 is nine authored pictures out of seven assets.**
`castleEaselCanvas.ts` holds the 3x3 table keyed by (hero, setting); each
row authors what composition cannot infer - where on that backdrop this
hero stands, and how big. No AI image generation, and no cross-product of
finished canvases.

Three changes to things SC-0 and SC-1 had already shipped, all of them
found by building on top of them:

- **The plates lay on the table in the correct story order**, so a child
  who seated them left to right without reading them scored a sequencing
  step they had not done - a bug no engine test can see, because the answer
  it receives is genuinely correct. They now start in the step's own
  authored `items` order, the same shuffled order the HUD list starts in.
  Both halves are asserted.
- **The table stood behind the lectern**, so from anywhere the child could
  see the sockets the lectern was between them and the plates. Beat 6 is
  three pickups; that was three walks around the furniture and back. They
  now stand side by side, facing the room.
- **A new `binding-lectern` asset**, and three carved marks added to the
  hearth's mantel. A.4 assumed one `lectern` would serve both jobs, but
  `story-plate-*` is 0.34m wide and three of them need a metre of desk
  against that model's 0.6m. The mantel departs from the storyboard's
  literal `HERO · PROBLEM · ENDING`: this pack is texture-free, so words
  would mean extruding letter geometry for a child who is being asked to
  *recall* what Quill said. It carries three groups of counted marks
  instead - one, two, three - the same language `storyPlate` already chose
  and no more of a giveaway than hint rung 3's own words.

### Rendering verification (SC-5)

**Beat 6 and beat 7 have been looked at**, through the same
`.tmp-verify/harness/` that SC-2 to SC-4 used, driven with the real touch
look controls and the real `e` key. The harness gained an `at=x,z,yaw`
param that appends a checkpoint of its own: walking to a spot on simulated
keystrokes is far too imprecise to put a reticle on a 34cm plate.

Confirmed working: the mantel's three groups of marks read clearly in the
firelight; the workstation reads as a workstation, with the plates' notches
and the lectern's three empty sockets both legible from where a child
stands; a picked-up plate rides visibly in front of the camera and leaves
the table; and a seated plate sits in its socket while the remaining ones
stay visibly empty.

**One real defect found, in beat 7, that no test could have caught.** The
canvas layers are built from the same primitives as everything else, so a
mountain peak is a 30cm-radius cone - and on an easel that reads as a
sculpture leaning out of the page, not a picture. Every layer is now
squashed to a couple of millimetres deep, which turns each one into the
flat-colour silhouette the storyboard asks for without re-authoring six
shared assets. A second defect came with it: the dragon's head hung out
through the top of the picture, because the fit test checked the hero's
*origin* rather than the hero. All nine compositions were then re-authored
and re-shot, and all nine now sit inside their page.

Still unverified: **the third plate's submit has not been driven in a
browser**. Two seats in a row work and are in the screenshots; the harness's
aim then missed the last plate on the table, and chasing that further was
judged not worth the time given the path is covered by tests on both sides
of the boundary (`castleBindingLectern.test.ts` on the arrangement, and the
view test driving a real `BuildActionRequested` through to `submitAnswer`).
Also still unverified, as for SC-2 to SC-4: how any of this feels on a real
tablet, and the whole flow against a live backend.

## SC-6 — The book on the shelf (beat 8) — **DONE**

The world change, and the end of the critical slice.

Deliverables:
- a visibly empty shelf slot in the Great Library, placed in SC-2 and
  passed every visit before the story is told;
- on `FIRST_STORY_TOLD`: Quill plays `Celebrate`, `story-book-shelved`
  replaces `shelf-slot-empty`, `hearth-lit` replaces `hearth`, and the
  carpet runner extends from the doors through the hub;
- read once at construction, the same call `pirateBuilderBayRegion.ts`
  documents for the bridge — a re-entering child finds the castle already
  changed, not an animation replayed each visit.

Exit criteria:
- the existing `WORLD_CHANGE` step and `changeKey` are unchanged;
- a child who completes the tale, leaves, and returns finds the book on
  the shelf and the hearth lit;
- the floor recolour the current Phaser scene performs is **not** carried
  over. The shelf is the consequence.

**Stop and re-evaluate here.** This is the point at which the region is
worth playtesting and the rest of the roadmap is worth re-costing.

### What shipped

The world change, and with it the slice. A Pathfinder can now walk into the
castle, choose a hero by lighting a portrait, choose a setting by standing
at a window, answer Quill at the hearth, seat three plates at the binding
lectern, watch the easel paint their story, and find their book on a shelf
that was visibly empty when they arrived.

`FIRST_STORY_TOLD` toggles three state variants and one extra length of
carpet - `story-book-shelved` over `shelf-slot-empty`, `hearth-lit` over
`hearth`, and the runner carrying on through the hub - with Quill playing
`Celebrate`. All four load up front and switch by visibility, so the change
costs no fetch when it happens and a returning child's castle is already
changed on the first frame. The engine takes the same `showStoryTold` call
at construction and from the room, which is what makes both true at once.

**Driven by the `WORLD_CHANGE` step being on screen, not by a submit.** A
`WORLD_CHANGE` step has no answer to submit: `useAdventureSession` writes
the `WorldChange` and advances past it itself. Wiring beat 8 to a submit
would simply never have fired. The step, its payload and its `changeKey` are
untouched.

**The floor recolour the Phaser castle performs is deliberately not carried
over**, per the exit criteria. The promised consequence is that the child's
story has a home on a shelf, so the shelf is the consequence.

**SC-2's real debt came due here.** SC-6's first deliverable says the empty
slot is "placed in SC-2" - it was not, and neither were the bookshelves, the
reading tables, the tapestries, or the costume racks. SC-2 built the rooms
and furnished almost none of them. The library half of that is now paid,
because beat 8's payoff needs it: a book arriving in a slot the child has
walked past and *noticed*, and a lone slot on a bare wall is not something
anyone notices. Eleven shelves (one instanced draw call, `bookshelf` being
single-mesh for exactly this reason) and the two reading tables are placed,
with the runs leaving clear every piece of wall SC-8 and SC-9 have already
claimed and a deliberate short bay beside the slot, so it reads as a gap
where a book should be. **The tapestries and costume racks remain unplaced,
and are still owed** - the tapestries by SC-7, which needs at least three of
them or its secret is a signpost pointing at itself.

### Rendering verification (SC-6)

Looked at before and after, at the slot, the hearth, and the carpet. The
slot reads as a gap between two shelves and the gold book arriving in it is
unmistakable; the lit hearth reads as fire, with SC-5's mantel marks still
legible against it; the runner visibly continues past Keeper Quill.

Two things the screenshots changed. Walking in, the library read as a black
void rather than a dark library - it is by some way the largest room in the
castle and gets the same single ceiling lamp as a two-metre corridor, so
`bookshelf` moved from `woodDark` to `woodMid` and the room's light from 1.4
to 2.4. It is still the lowest number in the map, which is the claim SC-2
actually makes; "dimmest room in the castle" and "you cannot make out the
furniture" turned out not to be the same statement.

## SC-7 — Secrets and the calm stop (beats 12–13) — **PARTIAL**

Parallel with SC-8 and SC-9.

Deliverables:
- the tapestry in the hub's south-west corner, with its slight sway and
  the cushioned nook behind it, firing the existing
  `DISCOVER castle-tapestry-stair`;
- the calm stop: as the parent-configured session limit approaches, Quill
  closes the book and gestures at the reading nook.

Exit criteria:
- the tapestry stays **unmarked**: no HUD cue, no quest entry, no map
  pin, no reward beyond being found. It leads nowhere, and that is the
  point;
- the calm stop adds no countdown, streak, score, or
  come-back-or-lose framing;
- session-time behaviour is otherwise identical to the card-based route.

Open question carried from the storyboard: whether the calm stop can be
staged in-world rather than as an overlay. Confirm against the existing
session-time implementation before building it, and fall back to the
existing overlay if not.

### What shipped — beat 12, the tapestry nook

Three tapestries hang in the hub, the one in the south-west corner stirs
very slightly, and three cushions lie on the floor beneath it. Walking into
that corner fires the existing `DISCOVER castle-tapestry-stair` through the
same `DiscoveryAction` the card-based castle and the other three regions
render, so what a child finds - the authored message, the reward, the
already-found case - has one implementation rather than two that agree
today.

**The sway is the only thing marking it**, and that is deliberate: it is
diegetic, it reads as a draught rather than as a signpost at about two
degrees every four seconds, and it stops entirely under
`prefers-reduced-motion`. The nook is still findable without it, because the
nook is a real place with cushions in it.

Everything else about the beat is an absence, and the absences are tested.
The tapestry is not a raycast target, so the reticle never names it; it
fires no toast the way a checkpoint does; it is not in the "Things to do
here" list; and it has no quest entry or map pin. A test asserts every one
of those routes stays shut, and it catches a leak: adding the zone to the
accessible list fails it. The two decoy tapestries are load-bearing rather
than decorative - the region file's own words are that with exactly one
tapestry the secret would be a signpost pointing at itself - so a test also
asserts at least two of them, and that neither hangs inside the nook.

### What did not ship — beat 13, the calm stop

**The prerequisite it was to be built on does not exist.** This phase's own
instruction was to "confirm against the existing session-time implementation
before building it, and fall back to the existing overlay if not". Confirmed:
there is no implementation and no overlay.

`ChildProfile.sessionMinutes` is validated (`child-profile/validators.ts`),
stored, editable on the profile form, and displayed on the parent dashboard.
Nothing anywhere reads it at play time. Nothing counts elapsed session time,
and nothing acts on the limit - the only file in `src/` that even mentions a
timer is `ChattyAvatar.tsx`, animating a parrot. So MVP scope item 11,
"Session time controls and a calm stopping point", is half built: the
control exists, the stopping point never did.

That makes beat 13 not a castle feature at all. Building a session timer
inside `storykeeperCastleScene.ts` would put the app's only session-limit
behaviour in one room of one location, reachable by one age band, which is
exactly the drift every other constraint in this roadmap exists to prevent -
and it would make this phase's third exit criterion, "session-time behaviour
is otherwise identical to the card-based route", trivially unsatisfiable,
since there is no card-based behaviour to be identical to.

**Recommendation:** build the calm stop app-wide first, as its own piece of
work outside this roadmap, then let the castle stage it in the room. The
storyboard's version - Quill closing the book and gesturing at the reading
nook - is a presentation layer over a session clock, and the clock is the
part that has to exist and be trusted. The nook it gestures at is now built
and waiting.

## SC-8 — Three clues and nine stars (beat 9) — **PARTIAL**

Explorer arc, chapter 1. Requires SC-2's Great Library.

Deliverables:
- the diary page on a reading table, the library map pinned near the door,
  and the folded note tucked in a shelf — three separate spots, three
  separate `CollectiblePickedUp` finds;
- pinning the three on the library wall, driving the chapter's existing
  `ORDERING` step;
- **nine stars carved above the door in two rows, five and four**, driving
  the existing `count-the-stars` `NUMBER_INPUT` step.

Exit criteria:
- the child counts objects that are actually in the room; the answer stays
  deterministic and the step is unchanged;
- the star carvings are placed from SC-0's authored positions, and a test
  asserts there are exactly nine of them in rows of five and four —
  content and question can never drift apart;
- the HUD equivalent for the number and ordering steps is available.

### What shipped — beat 9's evidence

The Great Library's south wall is now the scene the chapter describes: the
door with no handle, **nine gold stars carved above it in two rows of five
and four**, the three clues each in their own part of the room, and the wall
they get pinned to.

The stars are the point. `count-the-stars` asks "5 in the top row and 4 in
the bottom row, how many altogether?", and in the card-based build that is a
number described in a sentence. A child standing in front of that wall can
now look up and count nine objects that are actually there. The step, its
prompt and its `correctValue` are untouched - only the evidence became
physical, which is exactly the trade the storyboard asks for.

They are placed from SC-0's authored positions, and the test asserting there
are exactly nine in rows of five and four has been there since SC-0, so the
content and the question cannot drift apart.

Two faults the screenshots caught, neither of which any test could:

- **The stars were lying flat.** `star-carving` is a five-sided cone
  standing on its base, so it points at the ceiling - right for a floor
  decal and wrong for every authored use of it, all of which are carvings on
  a vertical wall. They are now tipped a quarter turn about x, which is also
  why they are nine placements rather than one instanced run:
  `InstancePlacement` carries only a y rotation.
- **The last bookshelf stood in front of two of them**, so only four and
  three could be counted. It is SC-9's prop and was placed here
  opportunistically; it has been removed. **SC-9 inherits the conflict**:
  `LAST_BOOKSHELF_SPOT` (x 13.1 to 14.9) overlaps the star run (x 11.6 to
  13.6) on the same wall, and the narrative needs that bookshelf to hide the
  door while the child needs to count the stars above it. Resolve it there.

### The clues, wired (ADR-019)

The half SC-8 stopped at is built. Storykeeper Castle is now a second entry
point into `THE_CASTLES_SECRET_DOOR` - the door with no handle is an
authored `START_STORY` interaction sharing the last bookshelf's zone - and
the chapter's `ADVENTURE` scenes render through ADR-019's seam into a
component that holds the session in the room. The three clues are picked up
off the floor and pinned to the library wall, and the third pin reports the
arrangement to the existing `ORDERING` step.

One `ChildStoryProgress` either way: the castle calls `useStoryProgress`
exactly as `StoryPage` does, mounted only once a child takes the entry
point rather than on arrival, since it starts a row on mount and every band
walks through this castle. The band gate is the story's own
`supportedAgeBands` through `isStoryForAgeBand`.

The account below is kept as the record of why this needed a decision
first.

### Why it needed ADR-019 — the clues as a puzzle

The three clues are placed and visible; **picking them up and pinning them
is not wired**, and the reason is worth stating plainly because SC-9 hits it
harder.

`secret-door-chapter-1-three-clues` is not a location adventure. It is an
`ADVENTURE` scene inside `THE_CASTLES_SECRET_DOOR`, a `StoryDefinition`
played by the Story Engine, and its `locationSlug` is `castle-secret-passage`
rather than `storykeeper-castle`. `StoryChapterRunner` renders that scene by
embedding `AdventureRunner`, which owns its own session internally - so the
room cannot reach into it to bind `CollectiblePickedUp` the way SC-4 bound
the portraits, because SC-4's whole trick was that *the view* holds the
session.

Making the room drive this beat therefore needs the Explorer story arc
hosted in the region: a render-prop seam on `StoryChapterRunner` so a caller
can supply its own adventure renderer, plus the castle view holding story
progress. That is tractable - the seam is about ten lines - but it moves
where an arc is *played* and it puts `ChildStoryProgress` in the hands of a
world view, and running the adventure standalone instead would fork story
progress and let a child replay the chapter in the library afterwards.

**The storyboard assumes this and never decides it.** Its age-band table
gives Explorers "beats 1 to 13" in the castle, which can only mean the arc
is played here, but no ADR says so and no phase in this roadmap budgets for
it. SC-9 needs the same thing for chapter 2 and needs it more, since the
pattern lock is three rods seated in a wall rather than a number typed on a
card.

**Recommendation:** decide the hosting question before SC-9. Drafted as
**ADR-019** in `docs/DECISIONS.md` (status: Proposed) - an arc may have a
second entry point but only one record, the Story Engine keeps sole
ownership of `ChildStoryProgress`, and `StoryChapterRunner` gains an
optional renderer for its `ADVENTURE` scenes so a region can hold the
session the way SC-4's castle already holds the tale's. Beat 9's world is
built and waiting for it.

## SC-9 — The pattern lock and the writing room (beats 10–11) — **BEAT 10 DONE**

Explorer arc, chapter 2 and 3.

Deliverables:
- the handleless door with star/moon carvings around it, one worn smooth,
  driving the existing `continue-the-pattern` choice;
- three rods on a rack, seated shortest to longest through the same
  `BuildActionRequested` path as SC-5, driving `order-the-keys`;
- the `what-does-ajar-mean` vocabulary step;
- on success: the moon carving glows, the door plays `Open`, warm light
  spills across the library floor, `SECRET_DOOR_OPENED` is written and
  `secret-door-ajar` is built on re-entry;
- the Writing Room as its own small region reached through the ajar
  bookshelf, exiting **back into the library, never to Welcome Harbor**,
  matching what `CASTLE_WRITING_ROOM_INTERACTIONS` already specifies;
- chapter 3's `whatIsBehind` prediction branch, unchanged.

Exit criteria:
- all three chapter-2 steps and chapter 3's branch behave identically to
  the card-based route;
- the rod route has its HUD equivalent;
- `THE_CASTLES_SECRET_DOOR_COMPLETE` unlocks the same navigation it does
  today.

### What shipped — beat 10, the pattern lock

The library's south wall is now the lock the chapter describes: star, moon,
star, moon, star and one carving worn too smooth to read, in a column beside
the door; three rods on a rack below it, short silver, medium iron, long
brass; and the handleless door itself.

Seating the three rods drives the existing `order-the-keys` step. That is
the **third** instance of the same puzzle as beat 6's story plates and beat
9's clues, and it is the third *instance* rather than the third
implementation: SC-8 factored the mechanic into one `createSeatingPuzzle` in
the scene and one `seatedEntitiesToOrder` in the bindings, so all three pick
up, seat, lift back out and report identically. The view describes the two
arrangement beats as data rather than coding them twice.

The rods seat in a row at a single height on purpose. `order-the-keys`
grades by *length*, so the three have to be comparable from where the child
stands without picking any of them up again (roadmap A.10, risk 2) - which
the screenshots confirm.

On `CASTLE_SECRET_DOOR_OPENED` the worn carving is revealed as the moon it
always was, the door swaps to `secret-door-ajar`, the last bookshelf swings
aside, and warm light spills across the floor of the room the castle
authors as its darkest. All four are state variants switched together, taken
at construction as well as live, so a child who solved the lock yesterday
finds it open on the first frame rather than watching it open again - SC-6's
shape, and beat 10's own instruction.

**SC-8's inherited conflict is resolved.** `LAST_BOOKSHELF_SPOT` was
authored across the south wall at x 13.1 to 14.9, straight through two of
beat 9's nine counting stars. That wall cannot hold the lock, the door, two
metres of stars and a 1.8m bookshelf while keeping the metre of clear space
the counting task needs from the lock's own carvings, so the bookshelf moved
to the east wall of the same corner, and the shelf above it shortened to
make room.

### What did not ship — beat 11, the writing room

The Writing Room is not a 3D region. `THE_CASTLES_SECRET_DOOR_COMPLETE`
still unlocks exactly the navigation it did before - the ajar bookshelf
leads to `locations/castle-writing-room`, the existing card/Phaser region,
which exits back to the library and never to Welcome Harbor - so the third
exit criterion holds and chapter 3's `whatIsBehind` branch is untouched.

What is missing is the storyboard's "its own small region": a round room
with one window, a desk and shelves of empty books, built the way SC-2 built
the castle. That is a region file, a scene file and a route - an SC-2-sized
piece of work rather than a finishing touch - and it is the only part of
beats 10 and 11 that is about somewhere the castle does not yet go.

## SC-10 — Quill's Picture Story (Sprouts) — **DONE**

**Gated on content approval. Do not author before it is granted.**

Storykeeper Castle has no Sprouts adventure today: `the-storykeepers-tale`
is `PATHFINDER` only and the whole secret-door arc is `EXPLORER` only. A
three-to-four-year-old can currently walk into the castle and tap six
sprites for six sentences.

Proposed deliverables:
- a new `AdventureDefinition`, `ageBands: ['SPROUT']`, three beats: walk
  to a portrait to choose who the story is about (vocabulary,
  classification), walk to a window to choose where it happens
  (vocabulary, observation), and a two-plate "what happened first?" at the
  lectern (sequencing);
- one narrated sentence per beat, no reading required, `APPROACH` triggers
  only, no raycast, reticle hidden;
- the same `FIRST_STORY_TOLD` book on the same shelf at the end;
- an age-band branch in the world view choosing which adventure this
  region offers.

Exit criteria:
- it reuses every room and asset SC-1 to SC-6 already built — **new
  authored content, not an engine change**;
- a Sprouts session completes inside the 5-to-8-minute band target;
- `adventureInvariants.test.ts` covers it like every other adventure.

### What shipped

Content approval was given, and `quills-picture-story` is authored:
`ageBands: ['SPROUT']`, six steps, three of them a single decision. Walk to
a portrait to choose who the story is about, walk to a window to choose
where it happens, put two plates in order at the lectern, and the same
`FIRST_STORY_TOLD` book lands on the same shelf in the same library that a
Pathfinder's does. The castle does not keep a lesser shelf for younger
children.

Two options where the tale offers three, two beats to order where it offers
three, option labels that are the picture's name and nothing more, and
three-rung hint ladders rather than five - every rung a sentence a grown-up
can read aloud without explaining it first. It is **authored content, not an
engine change**: every step type, transition and validator already existed.

Three things in the region had to become general rather than
tale-specific, and each was a real defect rather than a tidy-up:

- **The gallery is now an approach as well as a raycast.** Beat 3 was
  raycast-only, and a three-year-old cannot aim. The three portraits have
  approach zones of their own, disjoint from each other for exactly the
  reason the tower's windows are - overlapping them would let one step
  forward stand at two portraits at once. Nothing in this castle needs a
  reticle now, and the reticle is hidden for Sprouts.
- **Bindings are template-scoped.** The fox portrait means `hero-fox` in the
  tale and `picture-fox` here, so an unqualified lookup returns whichever
  was authored first - a silent cross-band bug that would submit an option
  id the open step has never heard of. Every lookup now names its adventure,
  and a test asserts both resolutions.
- **The room shows only the pieces the adventure uses.** The tale seats
  three plates and the picture story seats two, out of the same three. The
  spare leaves the table, because a Sprout who filled a socket with a piece
  that can never be part of an answer would be stuck with no way to
  understand why.

The step the view treats as "answerable by walking there" is now derived
from the bindings rather than listed by id. The hardcoded list was the
Pathfinder tale's step ids, which made the entire gallery inert for
Sprouts - caught by a test rather than by reading.

### Not verified

**The five-to-eight-minute band target.** Six steps with three decisions is
structurally well inside it, and probably under it, but session length is a
thing to observe with a child rather than infer from a step count. It joins
the list of questions only a playtest answers.

## SC-11 — Accessibility, performance, and the retirement gate — **NOT PASSED**

A gate, not a feature. Nothing in SC-2 to SC-10 may claim the castle is
finished before this passes.

Deliverables:
- the Sprouts (ages 3–4) accessibility playtest ADR-008 requires,
  recorded in `docs/ACCESSIBILITY_AUDIT.md` or `docs/PILOT_READINESS.md`;
- a profiling pass on a target tablet or Chromebook, not a development
  desktop: draw calls, frame time in the Great Library (the densest room),
  and load time to first walkable frame;
- LOD on `bookshelf` **only if** that profile shows a real budget problem;
- an audit that every learning step in the region has a working HUD
  equivalent, and that no learning objective is reachable only by walking,
  looking, or aiming;
- documentation: `docs/IMPLEMENTATION_STATUS.md`, and an ADR if any
  standing constraint in this roadmap's preamble had to be relaxed.

Exit criteria:
- the playtest has **run**, with results recorded. If it fails for
  Sprouts, the region ships for Pathfinders and Explorers and Sprouts keep
  the card-based route — that outcome does not block the older bands;
- performance is within budget on target hardware;
- only then may the card-based castle route be retired for a band, and
  only for a band the playtest cleared.

### Where the gate stands

**It does not pass, and nothing is retired.** One of its three deliverables
is done; the other two need a child and a tablet.

**Done - the HUD-equivalence audit, as a test.**
`castleHudEquivalence.test.tsx` renders the real `AdventureStepCard` for
every step the castle stages as a world object and asserts that every option
a child could walk to is on the card too, in the same words, with a control
to commit it - and that every graded step of every castle adventure is
answerable from the card alone. A prose audit would have been true on the
day it was written; this fails the day someone binds a step the card cannot
answer, which is the failure the standing constraint exists to prevent. It
has been mutation-checked against exactly that.

**Not done - the Sprouts playtest.** It has not run, and no code substitutes
for it. The castle raises the stakes over Welcome Harbor's version: since
SC-10 there is content authored *for* Sprouts here, so the question is no
longer "can a three-year-old walk to Quill" but "can a three-year-old
complete a learning objective this way". Runbook in
`docs/PILOT_READINESS.md` section 5b.

**Not done - the profiling pass.** Nothing has run on a tablet or
Chromebook; every frame in this roadmap was rendered by SwiftShader in a
container, which says nothing about a real device. The Great Library is now
the densest room it has ever been - eleven instanced shelves, the
secret-door wall with nine stars and six carvings, three rods, three clues -
and it is the room to measure. Runbook in the same place.

**No LOD was added**, deliberately. `bookshelf` is the one plausible
candidate and it is one instanced draw call; adding a level of detail
against no measurement would be optimising a number nobody has looked at,
and this phase's own wording is "only if that profile shows a real budget
problem".

**No standing constraint was relaxed**, so no ADR is owed for one. ADR-008's
Sprouts gate holds unchanged: the card-based castle is still every band's
route and the region is still offered as an option, which is the
conservative reading of an unrun playtest.

## Deliberately out of scope

Not in this roadmap, and not to be added without separate approval:
vertical traversal or stairs; AI-generated imagery or textures;
free-text story input; open-ended chat with Keeper Quill; an NPC that
follows the child; any timer, streak, or score; and retiring the
card-based castle route ahead of SC-11.

### Third-party asset kits — not yet

**Decided 2026-08-28: no third-party castle kit is imported for now.** Every
file in `public/models/` is generated from `scripts/generate-world-assets.ts`
in this repo, and SC-1 shipped that way.

This continues the call the generator's own header already documents for the
Phase 34 pack (licensing, network dependency, and a poor fit for bespoke
gameplay geometry), and four things make it sharper for the castle:

- **Texture-free is load-bearing, not aesthetic.** No asset has a UV
  accessor or an image reference, which is exactly what lets
  `assetLoader.test.ts` run real `GLTFLoader.load()` calls inside jsdom -
  no `HTMLImageElement`, no `ImageBitmap`. A textured import needs a whole
  test strategy this pipeline does not have.
- **Most of the castle is gameplay, not scenery.** A door with no handle
  and one carving worn smooth; a shelf slot visibly empty until
  `FIRST_STORY_TOLD`; three rods whose *lengths* are the graded answer to
  `order-the-keys`; nine stars in rows of five and four. None of that is
  purchasable, because the geometry is the puzzle.
- **State-variant pairs need identical geometry.** Half the pack is
  `X` / `X-lit` sharing exact vertices. Two downloaded models never match,
  so the construction-time swap would visibly pop.
- **Licensing on a children's product.** CC-BY needs attribution surfaced
  where a parent can find it, and marketplace "royalty-free" terms often
  exclude redistribution inside an app bundle.

**When to revisit: after SC-6**, and for scenery only - bookshelves,
tables, costume racks, filler picture frames. By then the region is
walkable and it is clear what actually looks thin, and swapping an asset is
a one-line manifest change. The gameplay-bearing assets stay generated
regardless.

If it is ever revisited, prefer CC0 (Kenney, Quaternius, the CC0 half of
Poly Pizza) over CC-BY, and treat it as its own phase with its own
conventions section: an import needs scale normalisation to 1 unit = 1
metre, re-pivoting to ground-pivot (most packs are centre-pivoted), and
either a texture-loading test path or a strip-textures-on-import step.
None of those exist today.

---

# Appendix A — Models and characters

Everything SC-1 has to author, and everything it does not. Placement
counts are estimates read off the storyboard's floor plan
(`docs/STORYKEEPER_CASTLE_3D_STORYBOARD.md` section 3), not authored
numbers — SC-0 produces the authored ones.

Headline, as estimated before SC-1 was built: **about 56 new assets, one of
which is a character.** Roughly 16 of them serve only the Explorer arc
(SC-8, SC-9) and can be deferred without blocking the SC-0 to SC-6 slice,
leaving about 40 for the slice itself.

**SC-1 shipped 59.** The three over the estimate are `binding-table` (the
plates need something to start on), and the split of `archway` and
`window-frame` out of the instanced-kit group into individually placed
multi-part assets, which the estimate had folded together. The tables below
are the estimate as written; `assets/manifest.ts` is the built truth. At the existing pack's 1–12 KB per
asset, the whole castle kit is well under a megabyte on disk — **size is
not the constraint here, authoring time is.**

## A.1 What you do **not** need

- **No child avatar model.** The region is first person. The camera is
  the child; nothing is rendered for them.
- **No new NPC besides Quill.** `npc-pip` stays in the bay.
- **`companion-chatty`** already exists and is reused unchanged if Chatty
  is placed in the castle at all. The HUD companion cue uses
  `ChattyAvatar.tsx` (Canvas 2D), not a model.
- **`door`** and **`signpost`** already exist and are reusable as-is for
  the castle doors and an entry-hall sign, if you want them.
- **No outdoor kit.** `foliage-tree`, `foliage-bush`, `rock`, `fence`,
  `path`, `bridge-plank*`, `roof`, `rope-coil`, `toolbox`,
  `treasure-chest`, `collectible-gem` have no role indoors.

## A.2 Recolours — existing geometry, new material (4)

The cheapest assets in the pack: same primitive, different
`baseColorFactor`, one generator function each.

| Asset | From | Placements | Notes |
| --- | --- | --- | --- |
| `ground-tile-stone` | `ground-tile` (4×4m) | ~28 | ~380 m² of floor across eight rooms |
| `ceiling-tile` | `ground-tile`, inverted | ~28 | **New requirement.** Both existing regions are outdoors, so looking up has always shown `scene.background`. Indoors that reads as a hole in the roof. |
| `wall-stone` | `wall` (2×3m panel) | ~100 | Exterior shell plus interior partitions, instanced in one run |
| `carpet` | `path` (1.5×1.5m) | ~5, then ~14 | The entry runner. Extends through the hub on `FIRST_STORY_TOLD` (SC-6) |

## A.3 New kit pieces — instanced (6, plus 2 optional)

| Asset | Placements | Phase | Notes |
| --- | --- | --- | --- |
| `archway` | 7 | SC-2 | Entry↔hub, hub↔gallery, hub↔costume, hub↔corridor, corridor↔tower, ↔studio, ↔library |
| `bookshelf` | ~16 | SC-2 | **Must be authored single-mesh** — see A.8 |
| `portrait-frame` | ~10 | SC-2 | The gallery's filler portraits, so the three hero portraits are not the only frames on the wall |
| `tapestry` | 3 | SC-2 | **At least three.** If the castle has exactly one tapestry, the beat-12 secret is a signpost pointing at itself |
| `star-carving` | 12 | SC-8, SC-9 | 9 above the door in rows of 5 and 4 (the counting beat), 3 in the pattern ring |
| `moon-carving` | 2 | SC-9 | The pattern ring |
| `wall-sconce` / `-lit` | ~12 | SC-2, SC-6 | *Optional.* A cheap way to make `FIRST_STORY_TOLD` warm the whole castle, not just the hearth corner |

## A.4 New props — placed individually (16)

| Asset | Count | Phase | Beat |
| --- | --- | --- | --- |
| `lectern` | 1 | SC-3 | Quill's, with three sockets for the plates |
| `story-plate-problem` | 1 | SC-5 | 06 — the carving must be geometry, not texture, so these are three distinct models |
| `story-plate-choice` | 1 | SC-5 | 06 |
| `story-plate-ending` | 1 | SC-5 | 06 |
| `reading-table` | 2 | SC-2 | Library furniture; also where the diary clue sits |
| `costume-rack` | 3 | SC-2 | The costume room, flavour only |
| `cushion` | ~4 | SC-7 | The tapestry nook and the reading nook |
| `clue-diary` | 1 | SC-8 | 09 |
| `clue-map` | 1 | SC-8 | 09 |
| `clue-note` | 1 | SC-8 | 09 |
| `rod-rack` | 1 | SC-9 | 10 |
| `rod-silver` | 1 | SC-9 | 10 — short. Length must be visually unambiguous at a glance; the step grades ordering by length |
| `rod-iron` | 1 | SC-9 | 10 — medium |
| `rod-brass` | 1 | SC-9 | 10 — long |
| `writing-desk` | 1 | SC-9 | 11 |
| `round-window` | 1 | SC-9 | 11 |

## A.5 State-variant pairs (22)

Each state is a **separate asset**, picked at construction time — the
`bridge-plank` / `bridge-plank-repaired` precedent, not a runtime material
swap.

| Pair | Assets | Swapped by | Phase |
| --- | --- | --- | --- |
| `portrait-puppy` / `-lit` | 2 | `choose-hero` | SC-4 |
| `portrait-dragon` / `-lit` | 2 | `choose-hero` | SC-4 |
| `portrait-fox` / `-lit` | 2 | `choose-hero` | SC-4 |
| `window-frame` | 1 | — (static, ×3 placements) | SC-2 |
| `window-view-island` / `-lit` | 2 | `choose-setting` | SC-4 |
| `window-view-mountain` / `-lit` | 2 | `choose-setting` | SC-4 |
| `window-view-cave` / `-lit` | 2 | `choose-setting` | SC-4 |
| `hearth` / `hearth-lit` | 2 | `FIRST_STORY_TOLD` | SC-5, SC-6 |
| `shelf-slot-empty` / `story-book-shelved` | 2 | `FIRST_STORY_TOLD` | SC-2, SC-6 |
| `carving-worn` / `-revealed` | 2 | `continue-the-pattern` | SC-9 |
| `secret-door` / `secret-door-ajar` | 2 | `SECRET_DOOR_OPENED` | SC-9 |
| `bookshelf-ajar` | 1 | `THE_CASTLES_SECRET_DOOR_COMPLETE` | SC-9 |

`shelf-slot-empty` is placed in **SC-2**, not SC-6. The empty slot has to
be visible on the child's first walk through the library, or beat 8's
payoff lands on a shelf they never noticed.

## A.6 The easel, and the cross-product trap (7)

Beat 7 fills the easel with shapes keyed by (hero, setting). Three heroes
× three settings is nine outcomes. Authoring nine finished canvases means
nine assets that all have to be redrawn if a fourth hero is ever added.

**Compose instead of enumerating:**

| Asset | Count |
| --- | --- |
| `easel` | 1 |
| `canvas-hero-puppy` / `-dragon` / `-fox` | 3 |
| `canvas-setting-island` / `-mountain` / `-cave` | 3 |

Seven assets, layered at placement time — hero silhouette in front, setting
backdrop behind. A fourth hero costs one asset instead of three, and the
nine authored outcomes the storyboard describes still exist, they are just
produced by composition rather than by hand.

## A.7 The one new character: Keeper Quill (1)

`npc-quill`, `kind: 'character'`.

**Clips:** `Idle`, `Talk`, `Wave`, `Point`, `Celebrate`, `ReactConcerned`
— all six already in `assets/animationVocabulary.ts`. **No vocabulary
extension is needed, and none should be added.**

**No `Walk` clip.** Quill is stationary, the same call the current Phaser
decor already makes (a stationary `CHARACTER` sprite, not an NPC that
follows the child). An NPC that follows is explicitly out of scope.

**Authoring recipe — follow `npcPip()` in
`scripts/generate-world-assets.ts` exactly.** Pip is a four-part node
hierarchy (`Body`, `Head`, `Hat`, `Arm`) whose clips are TRS rotation
tracks on named nodes: `Talk` rotates `Head`, `Wave` rotates `Arm`. Quill
needs the same shape, with an `Arm` node because `Point` (beats 2 and 5)
is an arm rotation. There is no skinning, no skeleton, and no bones
anywhere in this pipeline, and adding them would mean extending
`assets/gltfAssembler.ts`.

**Two consequences of Quill being multi-part:**

1. **Quill can never be instanced.** `createInstancedMeshFromAsset` keeps
   only the first mesh it finds, which would silently render a floating
   torso. Place via `instantiateAsset` / `placeWithLod`, which clone the
   whole scene. Quill is placed once, so this costs nothing — but the same
   trap applies to any multi-part prop.
2. **The raycast target needs naming.** Per
   `docs/THREE_WORLD_ASSET_CONVENTIONS.md`, the scene root or a named part
   is used directly. Use `Body`, as the conventions doc suggests. If
   Quill's silhouette turns out to be a poor target, add an
   `InteractionAnchor` empty node — nothing in the loader assumes one
   exists today.

## A.8 Constraints every asset inherits

From `docs/THREE_WORLD_ASSET_CONVENTIONS.md`. None of these are
negotiable within this roadmap:

- **Ground-pivoted.** Local origin at base centre, `y` spanning
  `[0, height]`, so placement code can set `position.y = 0`.
- **1 unit = 1 metre**, +Y up.
- **Texture-free.** Flat `baseColorFactor`, optionally `emissiveFactor`.
  No image, no UV accessor — this is what keeps every asset loadable in
  Vitest's jsdom.
- **Single-mesh for anything instanced.** `bookshelf`, `portrait-frame`,
  `wall-stone`, `archway`, `tapestry`, and both carvings are all
  instancing candidates and must each be one mesh, or be placed
  individually instead.
- **TRS keyframe tracks only** on animated assets.
- **Self-contained `.gltf` JSON** with a base64 buffer, under
  `public/models/`, regenerated by `npm run assets:generate` and
  committed.
- **`doubleSided: true`** on every material, so a placement with the wrong
  `rotationY` is visible from the wrong face rather than invisible.

## A.9 Which assets block which phase

| Phase | Blocked without |
| --- | --- |
| SC-2 | A.2 in full, `archway`, `bookshelf`, `portrait-frame`, `tapestry`, `window-frame`, `shelf-slot-empty`, `reading-table`, `costume-rack` |
| SC-3 | `npc-quill`, `lectern` |
| SC-4 | The three hero portraits and three window views, both variants each (12 assets) |
| SC-5 | Three `story-plate` models, `hearth`, the A.6 easel set |
| SC-6 | `hearth-lit`, `story-book-shelved`, extra `carpet` segments |
| SC-7 | `cushion` |
| SC-8 | `star-carving`, three clue props |
| SC-9 | `moon-carving`, `carving-worn` pair, `secret-door` pair, `bookshelf-ajar`, three rods, `rod-rack`, `writing-desk`, `round-window` |
| SC-10 | Nothing new. Quill's Picture Story reuses SC-2 to SC-6's assets entirely |

**SC-1 does not have to ship whole.** Authoring it in SC-2/SC-3/SC-4 order
lets the walkable shell go up while the hero portraits are still being
drawn. Only the manifest and generator plumbing has to land first.

## A.10 Risks in this inventory

1. **Texture-free means silhouette, not picture.** You cannot draw a
   puppy; you extrude a puppy-shaped outline in flat colour. Whether a
   five-year-old reads three low-poly silhouettes as *puppy, dragon, fox*
   is the single biggest content risk in SC-4. Mitigation, already in the
   storyboard: Quill names each one aloud, and the HUD card equivalent
   names them in text — the silhouette is never the only cue. If the
   playtest says it still fails, the fallback is a labelled plaque under
   each portrait, not a texture.
2. **The three rods must read as three lengths from where the child
   stands**, because the step grades ordering by length. Verify in the
   browser at eye height, not in an asset viewer.
3. **The nine stars are a counting task.** They must be countable from one
   viewpoint without moving, and unambiguous about which carvings are part
   of the nine — the pattern ring's stars sit near them and are *not* part
   of the count. Consider putting the nine above the door and the ring
   beside it, clearly separated.
4. **`bookshelf` is the one plausible LOD candidate** (~16 placements in
   the densest room). Add LOD only if SC-11's profiling on a target tablet
   asks for it.
