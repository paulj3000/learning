# Wonderwild Forest — First-Person Storyboard (Three.js)

The storyboard for re-staging Wonderwild Forest as a first-person Three.js
region, continuing the migration ADR-008 (`docs/DECISIONS.md`) started,
Phases 31 to 34 of `docs/ROADMAP.md` carried through Welcome Harbor and
Pirate Builder Bay, and `docs/STORYKEEPER_CASTLE_3D_STORYBOARD.md` carried
through Storykeeper Castle.

This is a design document. Nothing here is implemented. It states what the
forest should become, why the current forest needs replacing, and exactly
which existing engine pieces the new staging binds to, so the build can
begin without re-deciding any of it.

Read `docs/STORYKEEPER_CASTLE_3D_STORYBOARD.md` first. This document
follows its structure deliberately, and section 2 below is mostly an
argument about where the two designs must **differ**.

## 1. Why the forest needs updating

Wonderwild Forest shipped in Phase 6 (adventure) and Phase 13 (explorable
environment) and has not been touched by the Three.js work. Six specific
problems, all visible in the current files:

**The forest is one flat rectangle of grass.**
`buildWonderwildForestTileGrid` fills every tile with `HarborTile.GRASS`,
paints a pond and a two-by-three path spur, and stops.
`WONDERWILD_COLLIDING_TILES` is `[WATER]` and nothing else, so the pond is
the only thing in the entire location a child cannot walk through. There
are no glades, no trails, and no trees — the forest's tilemap contains no
tree of any kind. It is a lawn with five sprites on it.

**The Wonder Wall does not exist.**
`buzzAndTheWaggleDance.ts`'s entry step is `wonder-wall`, and
`wonderWallQuestions.ts` authors four curated questions for it across four
categories. There is no Wonder Wall in `wonderwildForestDecor.ts`, none in
`WONDERWILD_FOREST_INTERACTIONS`, and none anywhere else in the location.
The forest's signature object is a card with a place-name for a title.

**The question is asked after the child has walked to the answer.**
Walking into the hive's zone fires `wonderwild-beehive`'s
`START_ADVENTURE`, and the adventure's first step then asks the child which
of four things they are curious about. Three of the four answers redirect
immediately back to the bees they are already standing in front of. The
curiosity beat happens in the wrong order and in the wrong place, and no
amount of new geometry fixes that on its own.

**The world change is the weakest one on the island — weaker than the
castle's was.**
`forest-changes` promises two specific, visible things: "The Wonder Wall
lights up with a picture of a waggling bee, and a new patch of flowers
blooms in Wonderwild Forest." Neither is built. What actually happens is
`WonderwildForestScene`'s `tileOverrides` recolouring every `GRASS` tile in
the location from green to pink. The castle at least recoloured a floor
that had a shelf promised over it; here a global tint stands in for a
lit-up wall and a specific patch of flowers, and the child cannot walk up
to either of them.

**One band of three has content, and it is the only location on the island
with no second arc.**
`buzz-and-the-waggle-dance` is `ageBands: ['PATHFINDER']`. There is no
Sprouts adventure and no Explorer adventure in Wonderwild at all — the
castle at least had the `EXPLORER` secret-door chapters. Everything a
Sprout or an Explorer can do in this forest is tap a sprite for a sentence.

**The best beat on the island is one sentence.**
`shrink-into-hive` is the only `aiNarrated` step in the location and the
only moment anywhere on the island where a child changes scale. It is a
`NARRATIVE` card that says "down, down, down" and then cuts to another
card. The child never goes inside the hive.

The Three.js migration is the right moment to fix all six.

## 2. The design thesis, and why it is not the castle's

The castle's thesis was **choices become places**: every menu card
`the-storykeepers-tale` asked already had a room authored for it, so the
work was moving each decision into its room.

That thesis does not transfer, because the forest's steps are mostly not
choices. They are **observations**. `count-the-waggles` asks a child to
count something that never happens; the number 5 lives in a sentence and in
`correctValue`. `observe-the-dance` asks what a long waggle means, having
described the long waggle in prose. Moving those into the world as things
to walk to or aim at would turn two reasoning steps into a spatial search,
which is exactly what the castle's beat 5 refused to do.

> **Thesis: the evidence becomes real.**
>
> The forest's job is to make the thing each question is about actually
> happen in front of the child, and to leave the question exactly where it
> is.

One step does move into the world, and it is the one that is genuinely a
choice and is currently in the wrong place:

| Adventure step | Today | In the storyboard |
| --- | --- | --- |
| `wonder-wall` | 4-option card, asked at the hive | Four carved stones in a clearing, asked before the walk |
| `wonder-wall-fallback` | Narrative card | The same authored line, spoken at the stone whose trail has not grown yet |
| `shrink-into-hive` | One narrated sentence | A region change: the child walks in and the hive is enormous |
| `meet-buzz` | Narrative card | Buzz on the comb, three sisters watching her |
| `observe-the-dance` | 3-option card | Card, read against a long run the child watched, beside a short one |
| `count-the-waggles` | Number typed about a sentence | Five waggles that actually happen, and can be watched again |
| `science-comprehension-check` | 3-option card | Card, unchanged |
| `wonder-reflection` | Text prompt | At the hive mouth, looking back out at the forest |
| `forest-changes` | Whole-floor recolour | The bee stone lights; one bare patch blooms |

**The engine does not change.** The 3D interaction emits the option id the
existing `AdventureDefinition` already owns; the adventure engine evaluates
correctness exactly as it does today. Same discipline as Phase 33's bridge
and the castle's `castleChoiceBindings.ts`: a new way to reach an existing
step, never a second copy of the step's rule. See section 8.

## 3. Region plan

**Two regions, not one.** The forest is `wonderwild-forest`, 36m x 26m,
outdoors, glades connected by trails. The hive interior is
`wonderwild-hive`, 14m x 10m, its own small region reached only through the
hive and exiting only back to the hive clearing — the same shape the
castle's Writing Room takes, but on the Pathfinder critical path rather
than at the end of an Explorer arc.

All coordinates in metres, +Y up, matching `sceneKit.ts` (`EYE_HEIGHT =
1.6`).

```text
                                z = +13
  +---------------------------------------------------------------+
  |   LEAF HOLLOW              |             |   THE POND         |
  |   x -16..-7  z 5..12       |             |   x 4..15  z 6..12 |
  |   leaf pile, seed heads    |             |   water, lily pads |
  |   (wonder-seeds, not yet)  |             |   frog, reeds      |
  +--------+                   +-------------+          +---------+
  |        |                                            |         |
  | HARBOR |     THE WONDER WALL CLEARING  (hub)        |  HIVE   |
  | PATH   |     x -6..6   z -5..5                      | CLEARING|
  |x-18..-15|    four carved stones, north arc          | x 9..17 |
  | z -3..3 |    Chatty on the centre stone             | z -4..4 |
  |  west   |                                           | hive on |
  | exit    |                                           | a trunk |
  +--------+                   +-------------+          +---------+
  |  THE FERN BANK             |             |  CAVE MOUTH        |
  |  x -16..-7  z -12..-5      |             |  x 7..16  z -12..-6|
  |  glow moss, unmarked       |             |  glowworms inside  |
  +----------------------------+-------------+--------------------+
                 NIGHT CLEARING   x -4..5  z -12..-7
                                z = -13
```

Glades are connected by trails through a tree line. The tree line is the
only thing that stops the child, and it is **derived**, not hand-listed:
the walkable set is the union of the glade rects and the trail rects, and
everything else inside the ground extents is tree line. See WF-0 in the
roadmap for why that derivation is the geometric heart of this region the
way `buildWallSegments` was the castle's.

The hub is deliberately central and every trail runs through it, so a child
crossing the forest always passes the Wonder Wall — the same call the
castle made about the Story Hall and Keeper Quill.

```text
  wonderwild-hive, 14m x 10m
  +---------------------------------------------+
  |  capped honey cells along the north wall     |
  |                                              |
  |   [out]        THE DANCE FLOOR               |
  |   x -7         a marked patch of comb        |
  |   hive mouth   Buzz here, three sisters      |
  |                around her                    |
  |                                              |
  |  comb cells, floor and walls                 |
  +---------------------------------------------+
```

**Checkpoints** (`discovery/checkpoints.ts`, authored ids, never raw
coordinates). Yaw follows `firstPersonController.ts` (`forwardX = sin(yaw)`,
`forwardZ = cos(yaw)`): 0 faces +Z, PI/2 faces +X.

| id | label | x | z | yaw |
| --- | --- | --- | --- | --- |
| `wonderwild-forest:harbor-path` | the path into the forest | -16 | 0 | PI/2 |
| `wonderwild-forest:wonder-wall` | the Wonder Wall | 0 | -2 | 0 |
| `wonderwild-forest:hive-clearing` | the hive clearing | 12 | 0 | PI/2 |
| `wonderwild-forest:pond` | the pond | 9 | 6 | 0 |
| `wonderwild-forest:cave-mouth` | the cave mouth | 11 | -8 | PI |
| `wonderwild-hive:entrance` | the hive mouth | -5 | 0 | PI/2 |
| `wonderwild-hive:dance-floor` | the dance floor | 0 | -2 | 0 |

`harbor-path` is first in the forest's list and `entrance` first in the
hive's, because `resolveSpawnCheckpoint` falls back to a region's first
authored checkpoint and arriving at the way in is the only spawn that makes
sense for a child who has never been there.

### Constraint: the child does not shrink, the hive is built big

`firstPersonController.ts` moves on a flat plane at a fixed `EYE_HEIGHT` of
1.6m. There is no scale term anywhere in the controller, the camera rig, or
`sceneKit.ts`, and this storyboard does not ask for one.

So the shrink is staged the only way it honestly can be: **the hive
interior is authored in ordinary metres with enormous props.** A honeycomb
cell is about 1.4m across, the comb floor is a hex-tiled plane, and Buzz
stands about 1.2m tall. The child's body never changes; the world around
them does, and the region change is what sells it.

Two consequences, both non-negotiable:

- **The transition is a cut, not a zoom.** No scale animation, no dolly, no
  camera roll. `shrink-into-hive`'s narrated line plays over a short fade,
  and the child opens their eyes somewhere else. Reduced motion is a stated
  accessibility requirement (`docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md`
  section 42), and a zoom-to-tiny is the single most motion-sensitive thing
  anyone could put in front of a three-year-old.
- **The comb is a floor, not a wall.** Real honeybees dance on vertical
  comb. This region stages the dance floor horizontally, because the
  controller has no vertical traversal and no climbing. Nothing the
  adventure *claims* changes — a longer waggle run still means a farther
  food source, and the dance still tells the hive where to go — so this is
  a staging simplification, not a factual one. It belongs as a note in
  `docs/CONTENT_SOURCES.md` beside the existing waggle-dance entry.

### Constraint: the hive is a region, not a location

`wonderwild-hive` gets a region id and checkpoints. It does **not** get an
`ISLAND_LOCATIONS` entry, a `homeIsland.ts` pack slug, or a route of its
own.

`castle-writing-room` is the near-miss precedent and the distinction is
worth stating: the Writing Room is a *location* — persistent, unlocked by
`THE_CASTLES_SECRET_DOOR_COMPLETE`, listed on the island, somewhere a child
chooses to go back to. The hive interior is a *region the adventure passes
through*. A child cannot decide to visit the inside of a beehive; they get
there by being shrunk, mid-story, and they come back out. Giving it a
location slug would put it on the island map and in the parent-facing
location list, which would be a lie about what it is.

## 4. Storyboard beats

Each beat lists what the child sees, what they do, which existing domain
step it drives, and what the scene does. Beats 1 to 10 are the Pathfinder
core loop. Beats 11 and 12 are the existing unmarked secrets, available to
any band. Beat 13 closes any session.

---

### Beat 1 — The way in

**Sees.** A dirt trail leaving the harbor path east, tree line closing in
either side, and green light. The clearing ahead is visible but the stones
in it are not yet readable.

**Does.** Walks in. Crosses `wonderwild-harbor-path`.

**Drives.** `PlayerEnteredZone { zoneId: 'wonderwild-harbor-path' }` →
checkpoint `wonderwild-forest:harbor-path` saved to
`ChildWorldState.lastCheckpointId`; HUD toast "Wonderwild Forest".

**Scene.** `path-forest` run from the west edge to the hub. Tree line
instanced along the derived collider band. Warm directional light from
above and behind, and the ambient rig from `createSceneBootstrap` tuned so
the hub is the brightest place in the forest and the cave mouth the
darkest.

---

### Beat 2 — The Wonder Wall (`wonder-wall`)

**Sees.** Four standing stones in a shallow arc across the north of the
clearing, each carved with one shape: a bee, a seed head, a sun, a
chrysalis. Chatty is perched on the low centre stone. Behind each stone, a
trail leaves the clearing in a different direction. One of those trails —
the bee's — is worn wide and obvious. The other three are faint.

**Does.** Walks to a stone, or looks at it and presses E.

**Drives.** `ObjectInteracted { entityId: 'wonder-stone-bee', interactionId:
'wonder-wall' }` → mapped to option id `wonder-bees` → the existing
`CHOICE` step. Objective `curious-questioning`.

**On any other stone.** The existing `wonder-wall-fallback` narrative
plays, spoken by Chatty at that stone: "That part of the forest is still
growing." Nothing is invented; that is the authored line, and the faint
trail behind the stone is what makes it true rather than apologetic.

**Why it is better.** The forest currently asks this question at the hive,
after the child has already walked to the answer. Asked here, the choice
comes first and the walk is its consequence — which is what a curated
curiosity catalogue was always standing in for.

**Wayfinding.** The worn trail. No arrow, no waypoint marker, no forced
camera move, and no pointing NPC — the forest has none, and a trail that is
visibly more walked than its neighbours is better wayfinding than a gesture.

---

### Beat 3 — The hive clearing

**Sees.** A wide old trunk with a hive built against it, waist-high and
humming. Bees come and go. On the ground nearby, a flat patch of bare earth
with nothing growing on it — deliberately, conspicuously bare.

**Does.** Walks up. Reticle reads "the beehive: press E".

**Drives.** `PlayerEnteredZone { zoneId: 'wonderwild-hive-clearing' }` →
checkpoint saved. The existing `wonderwild-beehive` / `wonderwild-beehive-
discovered` pair stays exactly as authored, sharing one zone, so a child who
wanders here before visiting the Wonder Wall still starts the same session —
`resumeOrStartSession` makes the second entry safe, the same call
`worldObjects.ts` already documents for the bay's bridge.

**Scene.** The bare patch is placed here in this beat, not in beat 10. It
has to be something the child walked past and *noticed*, or the bloom lands
on ground they never looked at. This is the castle's own SC-6 lesson,
learned there the expensive way: the empty shelf slot was specified for SC-2
and did not get built until the payoff needed it.

---

### Beat 4 — Smaller than a seed (`shrink-into-hive`)

**Sees.** The hive mouth, then a short fade, then a wall of honeycomb the
size of a house.

**Does.** Presses E at the hive.

**Drives.** The existing `NARRATIVE` step, `aiNarrated: true`, unchanged.
Chatty narrates a bounded variation of the authored shrinking line through
the existing Phase 4 `generateCompanionTurn` route with `authoredBaseText`
grounding, exactly as today, with the same authored fallback.

**Scene.** Region change to `wonderwild-hive`. Cut, not zoom (section 3).
The adventure session does not restart, does not navigate, and is not
re-resumed — see section 7 for why that is one view holding two regions
rather than two routes.

**No AI imagery.** This step is `aiNarrated`, and that means text. Nothing
about this beat's geometry, lighting, or composition is generated. Out of
MVP scope and not requested here.

---

### Beat 5 — Buzz on the comb (`meet-buzz`)

**Sees.** A hexagonal comb floor stretching away, capped honey cells
glowing amber along the far wall, and Buzz — head-height, striped, wings
folded — standing on a slightly raised patch of comb with three other bees
around her, watching.

**Drives.** The existing `NARRATIVE` step. Buzz plays `Idle`, then `Talk`.

**Scene.** The three sisters are additional cloned `npc-buzz` placements
playing `Idle`, not new assets, and not instanced — `npc-buzz` is
multi-part, so `createInstancedMeshFromAsset` would silently keep only its
first mesh. The trap `foliage-tree` documents and `npc-quill` inherited.

---

### Beat 6 — The waggle run (`observe-the-dance`)

**Sees.** Buzz walks a straight line across the marked patch, waggling her
abdomen the whole way, then loops back to the start. It is a long run. One
of the sisters then does the same thing over a much shorter distance.

**Does.** Watches, then answers on a HUD card.

**Drives.** The existing `CHOICE` step, unchanged, `correctOptionId:
'opt-far-away'`, objective `cause-and-effect`.

**Deliberately not a world object.** This step asks the child to reason
from what they saw. Making the answer a thing to walk to would convert a
cause-and-effect step into a spatial search — the castle's beat 5 rule,
applied to the beat it was written for.

**What the room contributes is the comparison.** The adventure says "Buzz
waggles for a long time"; long compared to what has never been on screen.
The short run beside it is the whole point of building this in 3D, and it
adds no step, no option, and no text.

**Hints.** The existing five-rung ladder is untouched. From rung 3 the
short run repeats — the physical hint follows the ladder, it never
replaces, reorders, or short-circuits a rung.

---

### Beat 7 — Counting (`count-the-waggles`)

**Sees.** Buzz dances again. Her abdomen waggles five times, distinctly,
before she turns.

**Does.** Counts, and enters the number on the existing HUD card. A "watch
again" control on the dance floor replays the run from the start, as many
times as the child wants.

**Drives.** The existing `NUMBER_INPUT` step, `correctValue: 5`, objective
`observation`.

**This is the strongest 3D beat in the forest**, and it is the exact
counterpart of the castle's nine carved stars. In the current build the
child types a number about a sentence. Here they count a thing that
happens.

**Three requirements the count imposes on the animation**, and they are
requirements, not preferences:

1. **Exactly five, and discrete.** Five separable waggles, not a loop the
   child samples. The scene drives the sequence and stops.
2. **Replayable without penalty.** A child who loses count must be able to
   watch again without spending a hint rung, submitting a wrong answer, or
   asking anyone. Counting is the objective; recounting is not failure.
3. **Countable from where the child is standing**, without moving. The
   dance floor's approach zone is authored so the whole run is in view from
   inside it.

---

### Beat 8 — Why she dances (`science-comprehension-check`)

**Drives.** The existing `CHOICE` step, unchanged, `correctOptionId:
'opt-tell-flowers'`, objective `science-comprehension`.

A HUD card, for the same reason as beat 6, and with the existing hint
ladder untouched. Buzz plays `Celebrate` when it is answered.

---

### Beat 9 — One more question (`wonder-reflection`)

**Sees.** The hive mouth from the inside, with the forest visible through
it as a bright shape.

**Drives.** The existing `REFLECTION` step. No input is graded.

**Scene.** Walking out of the hive mouth returns to the forest at
`wonderwild-forest:hive-clearing`.

---

### Beat 10 — The forest answers (`WAGGLE_DANCE_DISCOVERED`)

**Sees.** The bare patch by the hive is full of flowers. Back at the hub,
the bee stone is lit, and its carving is filled with gold.

**Drives.** The existing `WORLD_CHANGE` step, `changeKey:
'WAGGLE_DANCE_DISCOVERED'`, unchanged.

**Scene.** Read once at construction, the same call
`pirateBuilderBayRegion.ts` documents for the bridge and the castle made
for the shelved book: on re-entry the forest builds with
`flower-patch-bloomed` in place of `flower-patch-bare` and
`wonder-stone-bee-lit` in place of `wonder-stone-bee`. Not a mid-session
animation replayed on every visit.

**Why this and not the floor recolour.** The adventure's own text names
two things, and the current implementation builds neither. This builds
both, makes the bare patch visible *before* the story is told, and makes
the change something the child walks up to rather than something the ground
does. The whole-grid `GRASS` → `BLOOM` override is **not** carried over.

**A second construction-time state read comes free.**
`wonderwildForestDecor.ts` already draws the visiting butterfly only once
`SAVE_THE_BUTTERFLY_GARDEN_COMPLETE` has been recorded elsewhere on the
island. That is the same mechanism, from another location, and it should
survive the migration exactly as authored.

**The lit stone is the island's first progress surface with no score in
it.** Every stone that lights is a question the forest can now answer. It
is not a streak, a counter, or a completion percentage, and nothing on it
is ever taken away.

---

### Beat 11 — The light under the ferns (any band, unmarked)

**Sees.** Nothing points at it. In the fern bank in the south-west, a faint
green glow under the fronds.

**Does.** Wanders off the trail and finds it.

**Drives.** `DISCOVER wonderwild-glow-moss`, exactly as today, granting the
existing `glowing-moss-jar` through the existing reward rule.

**Do not change this.** It is unmarked in every sense — no HUD cue, no
quest pin, no map marker. It is also an objective of "The Quiet Places"
(`islandQuests.ts`), which is the one place an already-authored quest points
at a Wonderwild secret, and that wiring must keep working.

---

### Beat 12 — The glowworm cave (any band, gated on the jar)

**Sees.** A dark opening in a bank on the south-east side. Too dark to see
into. Holding the jar, the ceiling inside lights up.

**Drives.** `DISCOVER wonderwild-glowworm-cave`, requirements
`ITEM_OWNED glowing-moss-jar`, exactly as today, with the authored
`lockedMessage` when the child has no jar.

**Staged in place, not as a third region.** The cave is a lit interior seen
from its mouth: a shallow recess with an emissive ceiling and the crystal
on the floor. Making it a region would triple this storyboard's transition
work for a beat with no learning step in it.

**It stays treasure, and that is load-bearing.**
`islandDiscoveries.ts`'s fourth authoring rule is that no secret gates
learning content. The cave is behind an item; therefore nothing that
teaches anything may ever be put inside it. See section 5 on where the
Explorer arc has to go instead.

---

### Beat 13 — A calm stop

**Sees.** When the parent-configured session limit approaches, the light in
the forest goes long and low and Chatty settles on the centre stone.

**Drives.** The existing session-time controls.

**This beat is blocked, and it is not a forest problem.** SC-7 established
that `ChildProfile.sessionMinutes` is validated, stored, editable, and
displayed, and that **nothing in `src/` reads it at play time**. There is no
session clock and no overlay to fall back to. Building one inside
`wonderwildForestScene.ts` would put the app's only session-limit behaviour
in one glade of one location for one age band. The calm stop is app-wide
work that has to exist before either region can stage it, and this
storyboard does not claim otherwise.

## 5. Age bands

| | Sprouts (3-4) | Pathfinders (5-6) | Explorers (7-8) |
| --- | --- | --- | --- |
| Content | **New: "Who Lives Here?"** | "Buzz and the Waggle Dance" | **New: "How Seeds Travel"** |
| Beats | 1, 2 (one stone), 3, 4, 5, short 7, 10 | 1 to 12 | 1 to 12, plus the seed arc |
| Triggers | `APPROACH` only | approach + raycast | approach + raycast |
| Reading | none, all narrated | narrated with text | text, narration optional |
| Reticle | hidden | shown | shown |
| Session | 5 to 8 min | 8 to 12 min | 10 to 18 min |

**Wonderwild has two content gaps, not one, and the castle only had one.**
There is no Sprouts adventure and no Explorer adventure here. Both proposals
below are new authored content and **need approval before either is
written**.

**Sprouts — "Who Lives Here?"** Three beats, one per glade: walk to the pond
and find who lives in the water, walk to the hive clearing and find who
lives in the hive, walk to the leaf hollow and find who lives under the
leaves. Classification, vocabulary, and observation — three of the six
skills CLAUDE.md section 3 lists for the band. One narrated sentence per
beat, no reading, no aiming, `APPROACH` only. It reuses every glade and
asset the Pathfinder build already places.

**It needs its own `changeKey`.** Reusing `WAGGLE_DANCE_DISCOVERED` would
record that a three-year-old discovered why bees dance, in a parent summary
that is supposed to be honest about what was learned. The castle's SC-10
could reuse `FIRST_STORY_TOLD` because its Sprout does tell a story; this
one cannot.

**Explorers — "How Seeds Travel", at the Leaf Hollow.** This is the
proposal because of where it cannot go. The glowworm cave is the obvious
Explorer setting and it is disqualified: it sits behind
`ITEM_OWNED glowing-moss-jar`, and `islandDiscoveries.ts` rule 4 forbids a
secret gating learning content. The Leaf Hollow is ungated, it is one of the
five discovery points `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md`
section 32 already names ("Leaves → Seasons adventure"), and — the reason to
prefer it over the pond — it is the place the Wonder Wall's **`wonder-seeds`
stone already points at**. Building it lights a second stone, turns a dead
fallback into a real path, and proves the Wonder Wall is a surface that
grows rather than a menu with three broken entries.

**ADR-008's Sprouts gate still applies.** First-person navigation is not
Sprouts' primary route until the accessibility playtest Phase 32 still owes
has run. Until then the card-based forest route stays the Sprouts default
and this region is an option, not a replacement.

## 6. Asset additions

New entries for `assets/manifest.ts`, generated by
`scripts/generate-world-assets.ts` under the existing conventions:
ground-pivoted, texture-free, flat `baseColorFactor`, TRS-only clips,
single-mesh for anything instanced. The full inventory with counts and
phases is Appendix A of `docs/WONDERWILD_FOREST_3D_ROADMAP.md`.

**The forest is the cheapest region on the island to dress**, and it is
worth saying why. The castle's Appendix A.1 listed `foliage-tree`,
`foliage-bush`, `rock`, `fence`, `path`, `roof` and the rest of the Phase 34
outdoor kit as having "no role indoors" — every one of them is load-bearing
here. Roughly **29 new assets against the castle's 59**, one of which is a
character.

**Buzz's dance is scene-driven motion, not a glTF clip.** There is no
`Waggle` or `Dance` name in `assets/animationVocabulary.ts`, and SC-1 made a
point of not extending that vocabulary. Extending it is also the wrong fix:
beat 7 needs exactly five discrete waggles, stopped at the end, replayable
on demand, and countable — properties a looping clip makes awkward and an
authored sequence in the scene makes trivial. Buzz therefore ships with
`Idle`, `Talk` and `Celebrate`, all three already in the vocabulary, and the
run is TRS motion the scene drives on a cloned node. **No vocabulary
extension is needed, and none should be added.**

## 7. Files this implies

Mirroring the castle split, which mirrors Pirate Builder Bay's:

- `three/wonderwildForestRegion.ts` — pure geometry: ground extents, glade
  rects, trail rects, the derived tree-line colliders, every zone rect, and
  stable semantic entity ids. No `three` import. Unit tested.
- `three/wonderwildForestRegion.test.ts`
- `three/wonderwildHiveRegion.ts` + test — the hive interior's own numbers.
- `three/wonderWallBindings.ts` — the entity-id to adventure-option-id map
  for the four stones, plus the resolver. Pure, unit tested; this is the
  file that keeps the engine untouched.
- `three/wonderWallBindings.test.ts`
- `three/wonderwildForestScene.ts` and `three/wonderwildHiveScene.ts` —
  rendering glue, not unit tested, same bucket as the existing scene files.
- `three/WonderwildForestWorldView.tsx` + test — **one view, both regions.**
- `routes/WonderwildForestWorldPage3D.tsx`, route
  `/island/:childId/world/wonderwild-forest-3d`, naming and lazy-load
  matching `StorykeeperCastleWorldPage3D`.
- `discovery/checkpoints.ts` — add `WONDERWILD_FOREST_CHECKPOINTS` and
  `WONDERWILD_HIVE_CHECKPOINTS`.
- `assets/manifest.ts` and `scripts/generate-world-assets.ts` — the kit in
  Appendix A; regenerate and commit `public/models/`.
- Sprouts and Explorer content, if approved: two new `AdventureDefinition`s.

**One view holding two regions, not two routes.** This is the one place
Wonderwild comes closer to the engine than the castle ever did, and it is a
deliberate choice with a cost. Two routes would be simpler to build: the
hive gets its own page, `shrink-into-hive` navigates, and the second view
resumes the same server-side session. It is rejected because SC-4's hardest-
won property was that the room and the HUD card drive **one**
`useAdventureSession` in **one** view, which is what makes "identical
session state" true by construction rather than by two implementations
agreeing. Splitting the Pathfinder loop across two views gives that back for
a mid-adventure transition. So the view rebuilds its engine when the region
id changes, and the session outlives the rebuild.

**No changes to** the adventure engine, the story engine, the hint ladder,
`worldEngineEvents.ts`, `firstPersonController.ts`, the animation
vocabulary, the AI pipeline, or any authored adventure or story text.

## 8. The binding rule

Every 3D interaction resolves to an id the existing content already owns:

```text
ObjectInteracted { entityId: 'wonder-stone-bee',
                   interactionId: 'wonder-wall' }
  -> wonderWallBindings: 'wonder-stone-bee' -> 'wonder-bees'
  -> useAdventureSession.submitAnswer('wonder-bees')
  -> BUZZ_AND_THE_WAGGLE_DANCE step 'wonder-wall'   [unchanged]
```

Three rules follow, and they are not negotiable:

1. **The scene never decides correctness.** The stones emit option ids; the
   `CHOICE` step evaluates them. Five waggles happen; the `NUMBER_INPUT`
   step decides whether the child's number is right.
2. **Every 3D route has a HUD equivalent** driving the identical step.
   Walking, looking, and aiming are never the only way to a learning
   objective (`docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md`
   section 42). This is sharper here than in the castle: beat 7's count is
   only reachable by watching an animation, so the HUD card must state the
   number of waggles in words at hint rung 4, exactly as the authored ladder
   already does.
3. **A binding that does not resolve is a test failure, not a runtime
   fallback.** `wonderWallBindings.test.ts` asserts every entity id maps to
   an option id `BUZZ_AND_THE_WAGGLE_DANCE` actually contains — the same
   authoring-check spirit as `manifest.test.ts` and `reachableMemoryFlags`.

## 9. Out of scope

Not in this storyboard, and not to be added without separate approval:
vertical traversal, climbing, or flight; any change to the child's scale in
the controller; AI-generated imagery or textures; free-text question input
on the Wonder Wall; open-ended chat with Buzz or Chatty; an NPC that follows
the child; any timer, streak, or score; extending
`assets/animationVocabulary.ts`; and retiring the card-based forest route
before the Sprouts playtest ADR-008 requires has run.

## 10. Open questions

1. **Sprouts content approval.** "Who Lives Here?" (section 5) is a new
   adventure and needs its own `changeKey`. Approve, defer, or replace
   before it is authored.
2. **Explorer content approval.** "How Seeds Travel" (section 5) is a new
   adventure. It is the only proposal that lights a second Wonder Wall
   stone, which is the argument for it over a pond or cave arc.
3. **Does the hive read as a hive at bee scale?** A honeycomb cell 1.4m
   across, texture-free, is a hexagonal hole in a wall. Whether a
   five-year-old reads a room of those as "inside a beehive" rather than
   "inside a machine" is this region's counterpart of the castle's
   silhouette risk, and the same mitigation applies: Chatty says where they
   are, and the authored narrative says it in text. Answer it with a
   screenshot at WF-4, not with an argument.
4. **The pond and the night clearing still have no job.** Two of the five
   discovery points section 32 names stay honest "not yet" flavour after
   this storyboard is fully built. Recommendation: leave them, as the castle
   left its costume room. A forest with places that are just nice places is
   consistent with beat 11.
5. **Beat 13 depends on work that does not exist.** The calm stop needs an
   app-wide session clock (section 4, beat 13). Sequence that before either
   region tries to stage it.
