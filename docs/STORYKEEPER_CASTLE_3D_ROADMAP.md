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

---

# Appendix A — Models and characters

Everything SC-1 has to author, and everything it does not. Placement
counts are estimates read off the storyboard's floor plan
(`docs/STORYKEEPER_CASTLE_3D_STORYBOARD.md` section 3), not authored
numbers — SC-0 produces the authored ones.

Headline: **about 56 new assets, one of which is a character.** Roughly 16
of them serve only the Explorer arc (SC-8, SC-9) and can be deferred
without blocking the SC-0 to SC-6 slice, leaving about 40 for the slice
itself. At the existing pack's 1–12 KB per
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
