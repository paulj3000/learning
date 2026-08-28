# Storykeeper Castle — First-Person Region Roadmap

**Status:** Proposed. Nothing in this document is implemented.

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

## SC-0 — Region data and choice bindings

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

## SC-1 — Castle asset kit

Extends the Phase 34 pipeline with the castle's own pieces. Parallel with
SC-0. Follows `docs/THREE_WORLD_ASSET_CONVENTIONS.md` exactly:
ground-pivoted, texture-free, flat `baseColorFactor`, TRS-only clips,
single-mesh for anything to be instanced, checked in under
`public/models/`.

Deliverables:
- kit pieces, instanced: `wall-stone`, `archway`, `ground-tile-stone`,
  `carpet`, `bookshelf`, `tapestry`, `star-carving`, `moon-carving`;
- state-variant pairs, separate assets picked at construction time per the
  bridge precedent: `portrait-frame` / `-lit`, `hearth` / `-lit`,
  `easel` / `-painted`, `secret-door` / `-ajar`, `bookshelf` / `-ajar`,
  `shelf-slot-empty` / `story-book-shelved`, and
  `window-view-island` / `-mountain` / `-cave` each with a lit variant;
- props: `lectern`, three `story-plate` carvings, `rod-silver`,
  `rod-iron`, `rod-brass`, `costume-rack`, `reading-table`, `clue-diary`,
  `clue-map`, `clue-note`, `cushion`;
- character: `npc-quill`, clips `Idle`, `Talk`, `Wave`, `Point`,
  `Celebrate`, `ReactConcerned` — all already in
  `assets/animationVocabulary.ts`; **no vocabulary extension**;
- generator functions in `scripts/generate-world-assets.ts`, manifest
  entries in `assets/manifest.ts`, regenerated and committed output.

Exit criteria:
- `npm run assets:generate` reproduces the committed `public/models/`
  byte-for-byte;
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

## SC-2 — The walkable shell

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

## SC-3 — Keeper Quill (beats 1–2)

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

## SC-4 — Choices become places (beats 3–4)

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

## SC-5 — Hearth, lectern, and easel (beats 5–7)

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

## SC-6 — The book on the shelf (beat 8)

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

## SC-7 — Secrets and the calm stop (beats 12–13)

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

## SC-8 — Three clues and nine stars (beat 9)

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

## SC-9 — The pattern lock and the writing room (beats 10–11)

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

## SC-10 — Quill's Picture Story (Sprouts)

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

## SC-11 — Accessibility, performance, and the retirement gate

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

## Deliberately out of scope

Not in this roadmap, and not to be added without separate approval:
vertical traversal or stairs; AI-generated imagery or textures;
free-text story input; open-ended chat with Keeper Quill; an NPC that
follows the child; any timer, streak, or score; and retiring the
card-based castle route ahead of SC-11.
