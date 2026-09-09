# The Dragon's Sanctuary — Adapting the Roadmap to Existing Conventions

**Written 2026-09-09.** Read `docs/regions/dragons-sanctuary-roadmap.md`
first; this document is only useful next to it.

## 1. Why this document exists

The roadmap closes its "Suggested Repository Structure" section with the
instruction this document acts on:

> Adapt these paths to the existing Learning Adventure Island repository
> conventions rather than creating duplicate frameworks.

That instruction is load-bearing, because the roadmap was written as though
the sanctuary were the first region of its kind. It is not. Six explorable
regions already exist, five engines already own the concepts the roadmap
names as new, and a place called the Dragon's Sanctuary is already in the
build and reachable by a child today.

So this document does four things:

- records what already exists under that name, measured rather than
  remembered;
- translates every path, model, and concept the roadmap proposes into the
  convention this repository actually uses;
- names the places where the roadmap contradicts a standing decision, so
  those get decided rather than absorbed silently;
- proposes the honest first increment.

It records findings and a recommendation. It authorises no implementation.

## 2. A Dragon's Sanctuary already exists, and it is not this one

`dragons-sanctuary` is a registered home-island location today
(`src/features/island/locations.ts:77`), claimed by `HOME_ISLAND_PACK`
(`src/features/worlds/packs/homeIsland.ts:21`), gated on the change key
`DRAGON_OF_EMBER_MOUNTAIN_COMPLETE`, and reachable through the
`mountain-path` interaction in `worldObjects.ts`.

What it consists of:

| Artefact | File | Substance |
| --- | --- | --- |
| Route | `src/routes/DragonsSanctuaryWorldPage.tsx` | 79 lines; loads the profile, renders the view |
| View | `src/features/island-map/DragonsSanctuaryWorldView.tsx` | 2D Phaser tilemap view |
| Tilemap | `src/features/island-map/dragonsSanctuaryTilemap.ts` | reuses the shared `HarborTile` palette |
| Zones | `src/features/island-map/dragonsSanctuaryZones.ts` | **one** zone: the path back to Welcome Harbor |
| Decor | `src/features/island-map/dragonsSanctuaryDecor.ts` | the dragon and one egg |
| Collision | `DRAGONS_SANCTUARY_COLLIDING_TILES` | **empty** |

Its own header states the intent plainly: "this is a calm arrival scene, not
an adventure of its own (the learning already happened inside 'The Dragon of
Ember Mountain')." It is the reward room at the end of a story, roughly one
screen, with nothing to solve and nothing to collide with.

The roadmap's sanctuary is a persistent first-person 3D region with eight
locations, six dragons, a hatchery, a restoration ladder, cross-island
abilities, and a quest pipeline. These are not two versions of one thing.
**The existing location is the fiction the new region should be built out
of, not an obstacle to it** - the dragon a child already met and the egg
they already saw are exactly the hooks Phase 2 and Phase 6 need. But the
2D tilemap, zones, and decor are not a foundation for any of it.

### Decision, 2026-09-09: the sanctuary is built directly in Three.js

An earlier draft of this section recommended the Storykeeper Castle
pattern - a 2D view at the `island-map/` root and a 3D one under
`island-map/three/`, coexisting behind separate routes.

**That recommendation is withdrawn.** The direction is: the Dragon's
Sanctuary is authored as a first-person Three.js region from the start,
with no 2D counterpart, and the 2D Phaser views across the project are
phased out rather than maintained in parallel. See ADR-021.

Concretely, for this region: `dragonsSanctuaryTilemap.ts`,
`dragonsSanctuaryZones.ts`, `dragonsSanctuaryDecor.ts`, and the 2D
`DragonsSanctuaryWorldView.tsx` are superseded. They are not deleted in the
same change that adds the 3D region - the route has to be switched and
verified first - but nothing new is authored into them, and they carry no
state the 3D region needs: the durable facts are the location registration,
the `DRAGON_OF_EMBER_MOUNTAIN_COMPLETE` gate, and the dragon-and-egg
fiction, all of which live outside the tilemap.

## 3. Structural translation

The roadmap proposes `src/regions/dragons-sanctuary/` with `scene/`,
`dragons/`, `quests/`, `challenges/`, `interactions/`, `effects/`, `audio/`,
`state/`, `assets/` subfolders, plus a top-level `services/` tree. Neither
`src/regions/` nor `services/` exists, and creating them would give this one
region a private copy of five engines.

The convention in force is: **an engine owns a concept; a region owns
content.** Every engine keeps its authored definitions in its own
`content/` folder, and a region appears as one file in each.

| Roadmap path | This repository |
| --- | --- |
| `src/regions/dragons-sanctuary/DragonSanctuaryRegion.ts` | `src/features/island-map/three/dragonsSanctuaryRegion.ts` - pure numbers, no `three` import, unit-testable (the `clockworkHarborRegion.ts` / `welcomeHarborRegion.ts` split) |
| `.../scene/` | `src/features/island-map/three/dragonsSanctuaryScene.ts` - the only place those numbers become `three` objects - plus `three/DragonsSanctuaryWorldView.tsx` and `src/routes/DragonsSanctuaryWorldPage3D.tsx` |
| `.../dragons/` | `src/features/npc/content/dragonsSanctuaryNpcs.ts` |
| `.../quests/` | `src/features/quests/content/dragonsSanctuaryQuests.ts` |
| `.../challenges/` | `src/features/adventures/content/dragonsSanctuaryAdventures.ts` |
| `.../interactions/` | trigger volumes in the region module; `worldEngineEvents.ts` for the event vocabulary |
| `.../state/` | nothing new - see section 4 |
| `.../assets/` | `src/features/island-map/three/assets/manifest.ts` and `public/models/` |
| `services/skills/` | `src/features/mastery/`, `src/features/curriculum/`, `src/features/learning-profile/` |
| `services/quests/` | `src/features/quests/` |
| `services/dialogue/` | `src/features/npc/dialogue.ts`, `src/features/companion/` |
| `services/speech/` | does not exist; see section 6.4 |
| `services/sanctuary/` | derived projection under `src/features/dragons-sanctuary/`, following `src/features/clockwork-harbor/` |
| `docs/regions/dragons-sanctuary/*.md` (10 files) | keep the single `docs/regions/dragons-sanctuary-roadmap.md`, as `clockwork.md` and `storykeeper_castle.md` do; split only when a section outgrows it |

Region ids and checkpoint coordinates go in
`src/features/discovery/checkpoints.ts`, never in the Three.js module. This
is ADR-008: the World Engine may depend downward on World State, never the
reverse.

## 4. Concepts the roadmap proposes that already exist

This is the substance of the adaptation. Nine of the roadmap's proposed
systems are already built, tested, and in use by other regions.

### 4.1 Skill bands are `SkillStatus`

Phase 0.2 asks for bands "Foundation, Developing, Proficient, Advanced,
Mastery". `src/features/mastery/types.ts` already defines:

```text
'LOCKED' | 'INTRODUCED' | 'DEVELOPING' | 'PROFICIENT' | 'MASTERED'
```

with `SKILL_STATUS_ORDER` for comparison. Four of five bands match by name.
Introduce no second ladder.

Separately, `SkillLevel` (1-6, `src/features/learning-profile/types.ts`)
answers the *other* question the roadmap conflates into one: `SkillStatus`
is how well a skill is known, `SkillLevel` is how hard the next puzzle
should be. The roadmap's per-challenge `minimum mastery` / `target mastery`
fields map onto `SkillStatus`; `difficulty` maps onto `SkillLevel`.

### 4.2 Challenge domains are `LEARNING_DOMAINS`

Phase 3 asks for mathematics, reading, vocabulary, logic, and science.
`LEARNING_DOMAINS` is exactly `['math', 'reading', 'vocabulary', 'logic',
'science', 'spatial']`. An exact superset, no change needed.

Caveat, already tracked in `IMPLEMENTATION_STATUS.md`: `reading`,
`vocabulary`, and `spatial` have **no authored curriculum skills yet**
(`DOMAINS_WITHOUT_CURRICULUM_SKILLS`). Zephyr (reading), Luna (vocabulary),
and Tide (spatial) therefore have no skills to draw on. Authoring those is a
prerequisite for Phase 4, not a detail of it.

### 4.3 Adaptive difficulty is `src/features/adaptive/selection.ts`

Phase 3's "after each challenge, record attempts, hints, time; update skill
evidence; adjust future difficulty" is `selectDifficultyLevel` plus the
Mastery Engine's existing evidence recording. That module's own header
already explains why it stayed small: grading, hint ladders, transitions and
fallbacks belong to the Adventure Engine, and duplicating them would put two
things in charge of deciding whether a child was right.

(`src/features/adaptive/` is present in the working tree but not yet
committed as of this writing.)

### 4.4 Environmental challenge types are `PresentationSpec`

Phase 3 lists ten reusable challenge components. The Adventure Engine's
`PresentationSpec` union already covers the graded shapes:
`number-input`, `choice`, `ordering`, `matching`, `short-response`,
`creative-choice`, `reflection`, `world-change`, `complete`.

This is the roadmap's own "important rule" made structural, and it is
already enforced: **the learning engine determines the correct solution; the
3D environment represents the problem and reacts to the result.** A rune
lock, a number lock, a lever sequence, and a rotating mechanism are four
*presentations* of `ordering` and `number-input`, not four new graders. Add
Three.js renderers; add no second answer-checking path.

### 4.5 Persistent world state is `WorldChange`

Phase 0.3 proposes six new models (`DragonSanctuaryProgress`,
`DragonProgress`, `SanctuaryQuestProgress`, `SanctuaryUnlock`,
`DragonEggProgress`, `SanctuaryCollectible`), and Phase 9 proposes a
data-driven state document.

Clockwork Harbor faced this exact question one milestone ago and the answer
is recorded in `IMPLEMENTATION_STATUS.md`: its harbor state and region
progress are **derived from existing `WorldChange` rows**, not stored in a
new model, because `WorldChange` is already the durable "this happened"
record that the parent dashboard, quest conditions, and `isLocationUnlocked`
all read. A private store would give the sanctuary a history none of those
can see. ADR-005 is the standing decision.

So: `sanctuary.restorationLevel` is *computed* from the change keys a child
holds, in a `src/features/dragons-sanctuary/` projection. Quest state is the
Quest Engine's `QuestState`. Collectibles are inventory. Dragon relationship
is `NpcRelationshipState`. The roadmap's warning against "one opaque
progress blob" is right, and derivation satisfies it more completely than
six new tables would.

Egg lifecycle (Phase 6) is the one item here that may genuinely need its own
row; see section 5.

### 4.6 Dragon NPCs are `NpcDefinition`

Phase 4's persisted list - discovered, relationship level, completed quests,
current quest, unlocked dialogue - is `src/features/npc/`:
`NpcDefinition`, `DialogueNode`, `NpcCondition`, `NpcMemoryFlags`,
`NpcQuestOffer`, `NpcScheduleEntry`, and `RelationshipLevel`
(`STRANGER | ACQUAINTANCE | FRIEND | TRUSTED_FRIEND`). Six dragons are six
entries in `npc/content/dragonsSanctuaryNpcs.ts`.

"Dragon growth/state" is the only field with no home, and it belongs with
the egg lifecycle.

### 4.7 Collectibles are the Rewards Engine

Phase 10's eight collectible families are `ItemDefinition` rows with
`ItemCategory` (`COLLECTIBLE | COSMETIC | QUEST_ITEM | KEEPSAKE`),
`ItemRarity`, and `CollectibleSet`, granted through `RewardRule` /
`RewardTable`. See `rewards/content/creatureCareCoveItems.ts` for the
per-region file shape.

Note ADR-011 while authoring: there is no XP, coin, or level economy, by
decision. The roadmap's own "avoid rewarding repetitive low-value grinding"
points the same way; the ADR makes it binding.

### 4.8 Secrets are the Discovery Engine

Phase 10's secret system is `DiscoveryDefinition` with
`DiscoveryKind` (`HIDDEN_CAVE | SECRET_PASSAGE | LOCKED_DOOR |
HIDDEN_OBJECT`) - which covers hidden caves, secret doors, and hidden eggs
directly - plus `DiscoveryRequirement` and `DiscoveryWorldChange`.

`DiscoveryDefinition.lockedMessage` already encodes the roadmap's Phase 1
instruction that locked areas be visible-but-inaccessible: a locked thing
describes what would open it and never reports a refusal (CLAUDE.md pillar
7). Phase 1's "several locations should initially be visible but
inaccessible" needs no new mechanism.

### 4.9 Quest definitions are `QuestDefinition`

Phase 11's data-driven quest fields map one-to-one onto `QuestDefinition`,
`QuestStage`, `QuestObjective`, `QuestCondition`, `QuestBranch`,
`QuestWorldChange`, and `QuestCompletion`. Phase 11's proposed validation
tooling ("missing quest targets, invalid prerequisites, unreachable states,
missing skill IDs") is the same job `adventureInvariants.test.ts`,
`packs.test.ts`'s "every location belongs to exactly one world", and
`validateWorldContentPack` already do - extend those suites rather than
building a separate validator.

## 5. What is genuinely new

Five things in the roadmap have no existing home, and these are where the
actual engineering is:

1. **The 3D sanctuary region** - `dragonsSanctuaryRegion.ts` and
   `dragonsSanctuaryScene.ts`. The kit exists (`sceneKit.ts`,
   `firstPersonController.ts`, `npcApproachBridge.ts`, `worldEngineEvents.ts`,
   `ThreeGameContainer.tsx`), so this is region authoring rather than engine
   work.
2. **A dragon rig and animation set** - the roadmap's thirteen Ember clips.
   Nothing in `public/models/` is a rigged creature; the three existing
   dragon files (`canvas-hero-dragon`, `portrait-dragon`,
   `portrait-dragon-lit`) are flat portrait assets.
3. **The egg lifecycle** (Phase 6). Egg -> Hatching -> Hatchling -> Young ->
   Adult is a state machine whose transitions are earned over weeks. This is
   the one candidate for a new model, and it should be argued for on its own
   rather than smuggled in with the other five from Phase 0.3.
4. **Polly speech and its S3 cache** (Phase 5). No `services/speech`
   equivalent exists anywhere in `src/` or `amplify/functions/`; the four
   existing functions are `claim-coop-slot`,
   `get-next-learning-activity`, `operational-metrics`, and
   `submit-adventure-answer`.
5. **Cross-region ability hooks** (Phase 7). Fire, flight, earth, water,
   wind, and dragon sense as interaction points in other regions. The
   roadmap's own design rule - abilities open optional paths rather than
   gating existing progression - is what makes this additive and safe to
   defer.

## 6. Contradictions to resolve before building

These are the places where following the roadmap literally would break
something already decided. Each needs a decision, not an assumption.

### 6.1 Skill level versus age band

The roadmap's headline design principle is "skill-level progression rather
than age-based progression", and Phase 0.2 says "do not hard-code challenges
around player age".

CLAUDE.md section 3 says the opposite in equally plain terms: difficulty,
reading volume, response mode, and interaction length "must derive from the
child profile's age band". `AgeBand` is a required domain concept (section
9), `AdventureDefinition` selects on `ageBands`, and `WorldDefinition`
carries `supportedAgeBands`.

These are reconcilable, and Clockwork Harbor has already reconciled them
once: age band governs **presentation** - reading volume, narration,
session length, how many steps a child is asked to hold at once - while
skill level governs **difficulty within** what that band can present.
`adaptive/selection.ts` picks the variant; `ageBands` decides which variants
are offered at all. The roadmap should be read as replacing age-derived
*difficulty*, not age-derived *presentation*.

This needs to be written down as an ADR before Phase 3, because reading it
the other way would let a three-year-old be handed an Explorer's wall of
text on the strength of good arithmetic.

### 6.2 Whether the sanctuary is a region or a world

The roadmap does not say. `dragons-sanctuary` is currently an
`ISLAND_LOCATIONS` entry on the home island, which is what Clockwork Harbor
and Storykeeper Castle are, and Phase 7's cross-island abilities only make
sense if the sanctuary stays part of the same island rather than becoming a
sailing destination. Recommendation: keep it a home-island region and
leave `HOME_ISLAND_PACK`'s claim untouched. ADR-009 governs.

### 6.3 The unlock condition already exists, and Phase 1 contradicts it

The location is gated today on `DRAGON_OF_EMBER_MOUNTAIN_COMPLETE`: a child
reaches the sanctuary by finishing the dragon story, meeting the dragon, and
seeing her egg. That is a better unlock than anything Phase 0.1 would invent,
and it hands Phase 2 a first quest hook and Phase 6 an egg for free.

But it collides with the roadmap's story: Phase 2 says "most dragons have
disappeared" and the sanctuary "has fallen into disrepair", while a child
arriving today is told the dragon "rests peacefully beside her egg", "safe
at last". A child cannot walk out of a story about making a dragon feel safe
and into a ruin she has abandoned. Either the sanctuary's disrepair is
somewhere the known dragon leads the child *to*, or the existing location
copy changes. This is a writing decision and should be made before the
region is laid out, because it determines where the gate is.

Also worth settling: the roadmap names its first dragon **Ember**, and the
story's dragon is unnamed and lives on **Ember Mountain**. Making them the
same dragon costs nothing and is almost certainly right.

### 6.4 Polly is a pending decision, not an available service

`docs/IMPLEMENTATION_STATUS.md` lists "Text-to-speech provider and voice
consent model" under **Decisions pending**. Phase 5 specifies Polly, S3, a
CDN, per-voice caching, and distinct voices per dragon as though the
provider were settled. It is not, and voice for children carries a consent
question the roadmap does not mention. Treat Phase 5's audio half as
blocked on that decision.

### 6.5 The art problem is not new and is not solved

`docs/regions/storykeeper_castle_reconciliation.md` section 2 measured it:
all 108 files in `public/models/` are generated from primitives by
`scripts/generate-world-assets.ts`, and **none has a texture**. The
roadmap's Phase 1 says "do not block engineering on final art", which is
correct and is what every region has done. But its Definition of Done
assumes a sanctuary a child wants to inhabit, and thirteen animation clips
on a rigged dragon is a materially larger ask than another primitive
assembly. ADR-020 is the open question here; the sanctuary does not reopen
it, but it does raise the stakes on it.

### 6.6 AI boundaries are already decided, and the roadmap agrees

Phase 5's list of what AI may not determine - correctness, rewards, mastery,
unlocks, inventory, quest completion - restates ADR-002, ADR-003, ADR-004,
and CLAUDE.md section 7. No new decision needed; cite the existing ones.
Note also that ADR-004 forbids open-ended child chat in the MVP, so "Ember
can conduct contextual spoken conversations" must mean bounded, structured,
schema-validated turns, in the shape `src/features/companion/` and
`src/features/tutor/` already use.

## 7. ADRs

Phase 0.4 asks for seven ADRs. Four are already answered:

| Phase 0.4 item | Status |
| --- | --- |
| Sanctuary unlock mechanism | exists in code (`DRAGON_OF_EMBER_MOUNTAIN_COMPLETE`); needs the section 6.3 story decision, not an ADR |
| Persistent world-state sync | **ADR-005**, plus Clockwork Harbor's derived-projection precedent |
| Dragon ownership/progression | genuinely new - the egg lifecycle. Write it. |
| Skill challenge integration | **ADR-002**; but section 6.1's age-band/skill-level split needs a new ADR |
| AI NPC boundaries | **ADR-002/003/004** |
| Polly audio caching | blocked on the pending TTS provider decision (section 6.4) |
| GLB asset strategy | **ADR-020**, open |

So the real ADR backlog is two: **age band governs presentation, skill level
governs difficulty**, and **dragon growth state**.

## 8. Recommended first increment

The roadmap's Milestone A is Phases 0-2, which is right in shape but assumes
a green field. Adapted to what exists, the first increment is:

1. Settle section 6.3 (the story collision) and section 6.1 (the age-band
   ADR). Both are cheap, both block layout and content respectively.
2. Author `DRAGONS_SANCTUARY_REGION_ID` and its checkpoints in
   `src/features/discovery/checkpoints.ts`.
3. Author `dragonsSanctuaryRegion.ts` - the eight Phase 1 locations as
   footprints, boundary walls, and trigger volumes, with the five locked
   ones present as `DiscoveryDefinition`s carrying `lockedMessage`s, not as
   empty rooms. Clockwork Harbor's header states the rule: "an empty room a
   child can walk into is a worse promise than a gate that has not opened
   yet."
4. Author `dragonsSanctuaryScene.ts` and the first-person view, and point
   the existing `DragonsSanctuaryWorldPage` route at it. No `3D`-suffixed
   route: there is no second view to disambiguate from.
5. Ember as one `NpcDefinition` in `npc/content/`, with authored dialogue
   and no AI.
6. "Rekindle the Forge" as one `QuestDefinition` plus three authored
   `AdventureDefinition` variants selected by `selectDifficultyLevel`,
   recording a `WorldChange` on completion that the scene reads to light the
   forge.

That is Milestone A end to end, it introduces no new engine, no new model,
and no AI, and it satisfies CLAUDE.md section 16's rule that the core be
playable deterministically before any generation is added.

The measure of success is the roadmap's own, unchanged: a child unlocks the
sanctuary, explores it, meets Ember, takes the quest, finds the runes,
solves challenges pitched at their level, restarts the forge, and sees the
sanctuary change and stay changed.
