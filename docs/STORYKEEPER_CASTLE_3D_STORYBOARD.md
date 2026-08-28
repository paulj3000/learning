# Storykeeper Castle — First-Person Storyboard (Three.js)

The storyboard for re-staging Storykeeper Castle as a first-person
Three.js region, continuing the migration ADR-008 (`docs/DECISIONS.md`)
started and Phases 31 to 34 of `docs/ROADMAP.md` carried through Welcome
Harbor and Pirate Builder Bay.

This is a design document. Nothing here is implemented. It states what the
castle should become, why the current castle needs replacing, and exactly
which existing engine pieces the new staging binds to, so the build can
begin without re-deciding any of it.

## 1. Why the castle needs updating

Storykeeper Castle shipped in Phase 5 (adventure) and Phase 14 (explorable
environment) and has not been touched by the Three.js work. Four specific
problems, all visible in the current files:

**The castle is a flat floor with six labels on it.**
`storykeeperCastleTilemap.ts` fills the entire grid with one tile
(`HarborTile.SAND` standing in for stone) and paints a single carpet
runner. `STORYKEEPER_CASTLE_COLLIDING_TILES` is empty, so there are no
walls, no rooms, and no doorways — the "castle" is one open rectangle.

**The five story rooms are text popups, not places.**
`storykeeperCastleDecor.ts` places the Character Gallery, Setting Tower,
Costume Room, Great Library, and Illustration Studio as five sprites in
five corners. Every one of them resolves to a `SHOW_MESSAGE` in
`STORYKEEPER_CASTLE_INTERACTIONS` and nothing else. The Character Gallery
describes portraits of "puppies, dragons, foxes" — the exact three heroes
`the-storykeepers-tale` asks the child to choose between — and the two
have no connection at all. The child picks a hero from a menu card while
standing next to a wall that is supposedly covered in those same heroes.

**The world change is the weakest one on the island.**
Completing "The Storykeeper's Tale" writes `FIRST_STORY_TOLD`, and the
scene's `tileOverrides` responds by recolouring the whole floor from stone
to carpet. Compare Pirate Builder Bay, where the same mechanism swaps
actual bridge geometry the child then walks across. The castle's promised
consequence is that the child's story "has a home on the shelf" — and
there is no shelf.

**Two of three age bands get nothing here.**
`the-storykeepers-tale` is `ageBands: ['PATHFINDER']`. The whole
"The Castle's Secret Door" arc is `EXPLORER` only. A Sprout (ages 3 to 4)
can walk into Storykeeper Castle and tap six sprites for six sentences.
There is no Sprouts adventure in this location at all.

The Three.js migration is the right moment to fix all four, because the
fix for the first three is the same fix.

## 2. The design thesis

> **Choices become places.**

Every choice "The Storykeeper's Tale" currently asks as a menu card
already has a room authored for it in the castle's own content. The
storyboard below moves each choice into its room:

| Adventure step | Today | In the storyboard |
| --- | --- | --- |
| `choose-hero` | 3-option card | Walk the Character Gallery, light a portrait |
| `choose-setting` | 3-option card | Three windows in the Setting Tower |
| `comprehension-check` | 3-option card | Card, read against three words carved in the mantel |
| `order-the-story` | Drag list | Three plates seated into the binding lectern |
| `story-reflection` | Text prompt | The Illustration Studio easel |
| `story-written` | Floor recolour | The child's book slides onto a real, empty shelf slot |

**The engine does not change.** The 3D interaction emits the option id the
existing `AdventureDefinition` already owns; the adventure engine
evaluates correctness exactly as it does today. This is the same discipline
Phase 33 used for the bridge: a new way to reach an existing step, never a
second copy of the step's rule. See section 8.

## 3. Region plan

One indoor region, `storykeeper-castle`, 32m x 20m, hub-and-spoke. All
coordinates in metres, +Y up, matching `sceneKit.ts` (`EYE_HEIGHT = 1.6`,
`WALL_HEIGHT = 3`).

```text
                      z = +10
  +-----------------------------------------------------+
  |  CHARACTER GALLERY   |        |   SETTING TOWER      |
  |  x -8..-1  z 6..10   |        |   x 4..9  z 5..10    |
  |  three portraits     |        |   three windows      |
  +---------+  archway  -+        +-  archway  ----------+
  |         |            |        |                      |
  |  ENTRY  |   STORY HALL (hub)  |  E  | ILLUSTRATION   |
  |  HALL   |   x -9..3  z -6..6  |  A  | STUDIO         |
  | x-16..-10|  Quill, hearth,    |  S  | x 4..9 z -1..3  |
  | z -3..3 |   binding lectern   |  T  |                 |
  |  doors  |                     |  |  +-----------------+
  |  west   |   [tapestry stair]  |  C  |                 |
  |         |   unmarked, SW      |  O  |  GREAT LIBRARY  |
  +---------+  archway  -+        +- R -+  x 4..14        |
  |  COSTUME ROOM        |        |  R  |  z -10..-2      |
  |  x -8..-1  z -10..-6 |        |  |  |  last bookshelf |
  |                      |        |  |  |  at (13,-9)     |
  +-----------------------------------------------------+
                      z = -10        secret door -> Writing Room
```

Spokes open off the hub through archways, so the child always returns
through the Story Hall and always passes Keeper Quill. The east corridor
(x 3..4, z -10..10) is the only route to the tower, studio, and library,
which keeps the Great Library — and the secret door at its far end — the
deepest point in the castle.

**Checkpoints** (`discovery/checkpoints.ts`, authored ids, never raw
coordinates):

| id | label | x | z | yaw |
| --- | --- | --- | --- | --- |
| `storykeeper-castle:entrance` | the castle doors | -13 | 0 | -PI/2 |
| `storykeeper-castle:story-hall` | the story hall | -3 | 0 | -PI/2 |
| `storykeeper-castle:gallery` | the Character Gallery | -4.5 | 8 | 0 |
| `storykeeper-castle:tower` | the Setting Tower | 6.5 | 7.5 | 0 |
| `storykeeper-castle:library` | the Great Library | 8 | -6 | -PI/2 |

### Constraint: no vertical traversal

`firstPersonController.ts` moves on a flat plane. It has no step height,
no ladders, and no y-axis movement, and this storyboard does not ask for
any. The Setting Tower is therefore a **round ground-floor lantern room**
with three floor-to-ceiling arched windows, not a climb. The tapestry
"stair" stays what the Phase 26 content already says it is: a discovery
with a cushioned nook behind it, which "leads nowhere at all, and that is
the point".

Adding stairs is a controller change with its own comfort and motion-
sensitivity questions for the Sprouts band. It is out of scope here.

## 4. Storyboard beats

Each beat lists what the child sees, what they do, which existing domain
step it drives, and what the scene does. Beats 1 to 8 are the Pathfinder
core loop. Beats 9 to 12 are the Explorer arc. Beat 13 closes any session.

---

### Beat 1 — The threshold

**Sees.** Tall doors standing ajar at the west end, warm light on the
stone, a carpet runner leading in. The hall is deep enough that Keeper
Quill is visible but small.

**Does.** Walks in. Crosses `castle-entrance`.

**Drives.** `PlayerEnteredZone { zoneId: 'castle-entrance' }` → checkpoint
`storykeeper-castle:entrance` saved to `ChildWorldState.lastCheckpointId`;
HUD toast "Storykeeper Castle".

**Scene.** `wall-stone` runs instanced along the entry hall; `carpet` run
from the doors to the hub, extended later by beat 8. Warm directional key
light from the west doorway plus the ambient rig from
`createSceneBootstrap`.

---

### Beat 2 — The empty page

**Sees.** Keeper Quill at a lectern in the centre of the hub, an open book
in front of them, its page blank. Quill plays `Idle` until approached,
then `Talk`.

**Does.** Walks up. Reticle reads "Keeper Quill: press E to talk".

**Drives.** `NpcApproached { entityId: 'keeper-quill' }` → the existing
`recordCharacterMet` + `NpcConversation` wiring Phase 32 already uses for
Pip, then adventure step `meet-keeper-quill`.

**Scene.** On the step advancing, Quill plays `Point` toward the north
archway. That is the only wayfinding: no arrow, no marker, no forced
camera move.

---

### Beat 3 — The Character Gallery (`choose-hero`)

**Sees.** A gallery wall of portraits, three of them lit dimly and framed
larger than the rest: a brave puppy, a curious dragon, a clever fox. The
same three the Character Gallery's flavour text has described since Phase
14.

**Does.** Looks at one and presses E (or taps it).

**Drives.** `ObjectInteracted { entityId: 'gallery-portrait-fox',
interactionId: 'choose-hero' }` → mapped to option id `hero-fox` → the
existing `CREATIVE_CHOICE` step. Objective `creative-storytelling`.

**Scene.** The chosen frame swaps to `portrait-frame-lit` and plays
`Activate`; the other two dim. State variant, not a runtime material
swap, per `docs/THREE_WORLD_ASSET_CONVENTIONS.md`.

**Why it is better.** The child chooses a hero by choosing a *picture of*
a hero, which is what a three-option card was always standing in for.

---

### Beat 4 — The Setting Tower (`choose-setting`)

**Sees.** A round room with three tall arched windows. Beyond each, a
flat, low-poly backdrop: a floating island, a snowy mountain, a glowing
cave.

**Does.** Walks to a window.

**Drives.** `PlayerEnteredZone { zoneId: 'setting-window-cave' }` → option
id `setting-cave` → the same `CREATIVE_CHOICE` step.

**Scene.** The chosen window's backdrop brightens (emissive factor on a
state variant); the other two shutter with `Close`. No texture is used
anywhere: the pack is deliberately texture-free, so each backdrop is flat
colour and silhouette geometry.

**Trigger choice.** `APPROACH`, not raycast — a window is a place you
stand at, and it keeps this beat reachable for a band that cannot aim.

---

### Beat 5 — Quill's three things (`comprehension-check`)

**Sees.** Back in the hub. Above the hearth, three words are carved into
the mantel and lit by the fire: **HERO · PROBLEM · ENDING**.

**Does.** Hears `keeper-explains-rules`, then answers the comprehension
check on a HUD card.

**Drives.** The existing `CHOICE` step, unchanged, `correctOptionId:
'opt-three-things'`, objective `reading-comprehension`.

**Deliberately not a world object.** This step tests whether the child
recalls what Quill *said*. Making the answer a thing to find in the room
would convert a reading-comprehension check into a spatial search and
break the anchoring the adventure's header comment protects.

**Hints.** The existing five-rung ladder is untouched. Rungs 3 and up are
accompanied by Quill playing `Point` at the mantel — the physical hint
follows the ladder, it does not replace or reorder it.

---

### Beat 6 — The binding lectern (`order-the-story`)

**Sees.** Three stone plates on a table beside Quill's lectern, each
carved with one beat of a story: the hero finds a problem, the hero makes
a brave choice, the story reaches a happy ending. The lectern has three
empty sockets.

**Does.** Picks up a plate, seats it in a socket, repeats. The step is
submitted only once all three are seated.

**Drives.** `CollectiblePickedUp { entityId: 'story-plate-problem' }` then
`BuildActionRequested { entityId: 'binding-lectern' }` carrying the seated
order → the existing `ORDERING` step. Objective `sequencing`.

**On an incorrect order.** The plates lift back out and settle on the
table, Quill plays `ReactConcerned`, and the existing hint ladder advances.
No plate is ever destroyed and nothing is lost.

**Required alternate.** A HUD ordering list, identical in function, is
always available. Seating three physical objects is a fine-motor task; per
roadmap section 42 it must never be the only route to the step.

---

### Beat 7 — The Illustration Studio (`story-reflection`)

**Sees.** An easel with a blank page. Reflection prompt, narrated.

**Drives.** The existing `REFLECTION` step. No input is graded.

**Scene.** The easel becomes `easel-painted`, showing flat-colour shapes
selected from an authored 3x3 table keyed by (hero, setting). Nine
authored results, chosen in code. **No AI image generation** — out of MVP
scope and not requested here.

---

### Beat 8 — The book is bound (`FIRST_STORY_TOLD`)

**Sees.** Quill plays `Celebrate`. A bound book slides onto a shelf slot
in the Great Library that has been visibly, deliberately empty since the
child first walked past it. The hearth lights. The carpet runner extends
from the doors through the hub.

**Drives.** The existing `WORLD_CHANGE` step, `changeKey:
'FIRST_STORY_TOLD'`, unchanged.

**Scene.** Read once at construction, the same call
`pirateBuilderBayRegion.ts` documents for the bridge: on re-entry the
scene builds with `story-book-shelved` present and `hearth-lit` in place
of `hearth`. Not a mid-session animation replayed on every visit.

**Why this and not the floor recolour.** The promised consequence is that
the child's story has a home on the shelf. This makes the shelf real,
makes the empty slot visible *before* the story is told, and makes the
change something the child walks up to rather than something the floor
does.

---

### Beat 9 — Three clues (Explorer, `secret-door-chapter-1-three-clues`)

**Sees.** In the Great Library: a diary page on a reading table, a library
map pinned near the door, a folded note tucked in a shelf. Three separate
spots, three separate finds.

**Does.** Collects all three, then pins them in order on the library wall.

**Drives.** `CollectiblePickedUp` x3, then the chapter's existing `CHOICE`
(what the note points to), `ORDERING` (diary, map, note), and
`NUMBER_INPUT` steps.

**The strongest 3D beat in the castle.** The `count-the-stars` step asks
for nine. In the current build that is a number typed about a sentence. In
the storyboard the nine stars are **carved above the door in two rows, five
and four**, and the child counts objects that are actually there. The
answer stays deterministic; only the evidence becomes physical.

---

### Beat 10 — The pattern lock (Explorer, `secret-door-chapter-2-pattern-lock`)

**Sees.** A door with no handle, no keyhole, no visible hinges. Around it,
carvings: star, moon, star, moon, star, and one worn smooth. Below, three
rods on a rack — short silver, medium iron, long brass.

**Does.** Chooses what the worn carving must be, then seats the three rods
shortest to longest, then answers what "ajar" means.

**Drives.** The chapter's three existing steps, in order. Rod seating uses
the same `BuildActionRequested` path as beat 6, with the same required HUD
alternate.

**Scene.** On success: the moon carving glows briefly, the door plays
`Open`, warm light spills across the library floor. `secret-door` →
`secret-door-ajar` state variant. World change `SECRET_DOOR_OPENED`.

---

### Beat 11 — Through the door (Explorer)

**Sees.** A small round room: one window, a desk, shelves of empty books.

**Drives.** The story arc's chapter 3, including the `whatIsBehind`
prediction branch, unchanged. `THE_CASTLES_SECRET_DOOR_COMPLETE`.

**Scene.** Its own small region (`castle-writing-room`), reached only
through the ajar bookshelf, exiting back into the library — never to
Welcome Harbor, matching what the content already specifies.

---

### Beat 12 — The tapestry that moves (any band, unmarked)

**Sees.** In the hub's south-west corner, a tapestry with a slight sway.
Nothing points at it. It is on no map, no quest, and no HUD cue.

**Does.** Wanders behind it and finds a cushioned nook.

**Drives.** `DISCOVER castle-tapestry-stair`, exactly as today.

**Do not change this.** It leads nowhere and rewards nothing beyond being
found. It is the castle's one piece of pure play and it should survive the
migration untouched.

---

### Beat 13 — A calm stop

**Sees.** When the parent-configured session limit approaches, Quill
closes the book and gestures at the reading nook. No countdown, no
"streak", no "come back or lose" framing.

**Drives.** The existing session-time controls. The stop is a place in the
room, not a modal over it.

## 5. Age bands

| | Sprouts (3-4) | Pathfinders (5-6) | Explorers (7-8) |
| --- | --- | --- | --- |
| Content | **New: "Quill's Picture Story"** | "The Storykeeper's Tale" | Tale + "The Castle's Secret Door" |
| Beats | 1, 2, 3, 4, short 6, 8 | 1 to 8, 12, 13 | 1 to 13 |
| Triggers | `APPROACH` only | approach + raycast | approach + raycast |
| Reading | none, all narrated | narrated with text | text, narration optional |
| Reticle | hidden | shown | shown |
| Session | 5 to 8 min | 8 to 12 min | 10 to 18 min |

**The Sprouts gap needs new content, and that needs approval.** The castle
has no Sprouts adventure today. Proposed: *Quill's Picture Story*, three
beats — walk to a portrait to choose who the story is about (vocabulary,
classification), walk to a window to choose where it happens (vocabulary,
observation), then a two-plate "what happened first?" at the lectern
(sequencing). One narrated sentence per beat, no reading, no aiming, and
the same `FIRST_STORY_TOLD` book on the same shelf at the end. It reuses
every room and asset this storyboard already builds; it is new authored
content, not an engine change.

**ADR-008's Sprouts gate still applies.** First-person navigation is not
Sprouts' primary route until the accessibility playtest Phase 32 still
owes has run. Until then the castle's card-based route stays the Sprouts
default and this region is an option, not a replacement.

## 6. Asset additions

New entries for `assets/manifest.ts`, generated by
`scripts/generate-world-assets.ts` under the existing conventions:
ground-pivoted, texture-free, flat `baseColorFactor`, TRS-only clips,
single-mesh for anything instanced.

**Kit pieces** (instanced): `wall-stone`, `archway`, `ground-tile-stone`,
`carpet`, `bookshelf`, `tapestry`, `star-carving`, `moon-carving`.

**State-variant pairs** (separate assets, picked at construction, per the
bridge precedent): `portrait-frame` / `portrait-frame-lit`;
`hearth` / `hearth-lit`; `easel` / `easel-painted`;
`secret-door` / `secret-door-ajar`; `bookshelf` / `bookshelf-ajar`;
`shelf-slot-empty` / `story-book-shelved`;
`window-view-island` / `-mountain` / `-cave`, each with a lit variant.

**Props**: `lectern`, `story-plate` (x3 carvings), `rod-silver`,
`rod-iron`, `rod-brass`, `costume-rack`, `reading-table`, `clue-diary`,
`clue-map`, `clue-note`, `cushion`.

**Character**: `npc-quill`, clips `Idle`, `Talk`, `Wave`, `Point`,
`Celebrate`, `ReactConcerned` — every one already in
`assets/animationVocabulary.ts`. No vocabulary extension is needed.

**Watch the instancing rule.** `createInstancedMeshFromAsset` keeps only
the first mesh it finds. `bookshelf` and `portrait-frame` must each be
authored as a single mesh if they are to be instanced, or be placed
individually through `placeWithLod`. This is the exact trap
`foliage-tree` documents.

**LOD.** Only `bookshelf` is a plausible candidate (the Great Library
places many, at range). Add it only if a measured frame budget on target
tablets asks for it, not by default.

## 7. Files this implies

Mirroring the Pirate Builder Bay split, which is the shape to copy:

- `three/storykeeperCastleRegion.ts` — pure geometry, zone rects, entity
  ids, no `three` import. Unit tested.
- `three/storykeeperCastleRegion.test.ts`
- `three/castleChoiceBindings.ts` — the interaction-id to
  adventure-option-id map (section 8). Pure, unit tested; this is the
  file that keeps the engine untouched.
- `three/castleChoiceBindings.test.ts`
- `three/storykeeperCastleScene.ts` — rendering glue, not unit tested,
  same bucket as the existing scene files.
- `three/StorykeeperCastleWorldView.tsx` + test.
- `routes/StorykeeperCastleWorldPage3D.tsx`, route
  `/island/:childId/world/storykeeper-castle-3d`, naming and lazy-load
  matching `PirateBuilderBayWorldPage3D`.
- `discovery/checkpoints.ts` — add `STORYKEEPER_CASTLE_CHECKPOINTS`.
- `assets/manifest.ts` and `scripts/generate-world-assets.ts` — the kit
  above; regenerate and commit `public/models/`.
- Sprouts content, if approved: a new `AdventureDefinition`.

**No changes to** the adventure engine, the story engine, the hint ladder,
`worldEngineEvents.ts`, the AI pipeline, or any authored adventure or
story text. That is the point of section 8.

## 8. The binding rule

Every 3D interaction resolves to an id the existing content already owns:

```text
ObjectInteracted { entityId: 'gallery-portrait-fox',
                   interactionId: 'choose-hero' }
  -> castleChoiceBindings: 'gallery-portrait-fox' -> 'hero-fox'
  -> useAdventureSession.selectOption('hero-fox')
  -> THE_STORYKEEPERS_TALE step 'choose-hero'   [unchanged]
```

Three rules follow, and they are not negotiable:

1. **The scene never decides correctness.** Seating three plates emits an
   order; the `ORDERING` step evaluates it. A wrong order is not "wrong"
   until the engine says so.
2. **Every 3D route has a HUD equivalent** driving the identical step.
   Walking, looking, and aiming are never the only way to a learning
   objective (roadmap section 42).
3. **A binding that does not resolve is a test failure, not a runtime
   fallback.** `castleChoiceBindings.test.ts` asserts every entity id maps
   to an option id the adventure definition actually contains — the same
   authoring-check spirit as `manifest.test.ts` and `reachableMemoryFlags`.

## 9. Out of scope

Not in this storyboard, and not to be added without separate approval:
vertical traversal or stairs; AI-generated imagery or textures; free-text
story input; open-ended chat with Quill; an NPC that follows the child;
any timer, streak, or score; and retiring the card-based castle route
before the Sprouts playtest ADR-008 requires has run.

## 10. Open questions

1. **Sprouts content approval.** *Quill's Picture Story* (section 5) is a
   new adventure. Approve, defer, or replace before it is authored.
2. **The costume room has no job.** It is the one room in the castle with
   no beat in this storyboard. Options: give it the Sprouts hero choice
   (dress up rather than pick a portrait), leave it as flavour, or cut it
   from the region. Recommendation: leave it as flavour for now; a room
   that is just a nice room is consistent with beat 12.
3. **Session-time staging.** Beat 13 assumes the calm stop can be staged
   in-world rather than as an overlay. Confirm against the existing
   session-time implementation before committing to it.
4. **Playtest ordering.** The Sprouts playtest is owed from Phase 32.
   Running it against Welcome Harbor first, before the castle is built,
   would tell us whether the Sprouts column in section 5 is buildable at
   all.
