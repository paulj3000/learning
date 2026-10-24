# The Dragon's Sanctuary — Implementation Roadmap

## Learning Adventure Island

**Region:** The Dragon's Sanctuary  
**Platform:** AWS Amplify Gen 2 + Three.js  
**Design principle:** Skill-level progression rather than age-based progression  
**Core fantasy:** The player becomes a Dragon Keeper and restores a forgotten dragon sanctuary through exploration, learning challenges, quests, and persistent world changes.

---

## 1. Product Goal

The Dragon's Sanctuary should be a persistent, explorable 3D region rather than a single linear story or minigame.

The player unlocks the sanctuary through story/world progression, discovers that it has fallen into disrepair, and gradually restores it. Dragons, buildings, caves, abilities, collectibles, and new areas become available as the player's skill mastery grows.

### Core loop

**Explore → Discover → Meet/Help Dragon → Complete Skill Challenge → Change World → Earn Reward → Unlock More Sanctuary**

The educational activity should normally be embedded into the environment rather than presented as a conventional worksheet.

Examples:
- Correct multiplication results activate forge machinery.
- Reading clues reveal rune sequences.
- Logic puzzles redirect water through caves.
- Science challenges create suitable habitats for eggs.
- Vocabulary unlocks ancient dragon inscriptions.

---

# Phase 0 — Architecture and Design Decisions

## Goal

Define the sanctuary as a reusable region inside the existing Learning Adventure Island world architecture before building content.

## Tasks

### 0.1 Region specification

Create:

`docs/regions/dragons-sanctuary/REGION_SPEC.md`

Define:
- Region purpose
- Unlock conditions
- Player entry/exit points
- Core gameplay loop
- Skill progression rules
- Dragon progression
- Persistent world-state rules
- Rewards
- Relationship with Storykeeper Castle and other regions

### 0.2 Skill-level model

Do not hard-code challenges around player age.

Define skill bands such as:
- Foundation
- Developing
- Proficient
- Advanced
- Mastery

Each challenge definition should identify:
- skill domain
- skill identifier
- minimum mastery
- target mastery
- difficulty modifiers
- prerequisite skills

### 0.3 Region state contract

Define persistent state for each child.

Suggested concepts:

- `DragonSanctuaryProgress`
- `DragonProgress`
- `SanctuaryQuestProgress`
- `SanctuaryUnlock`
- `DragonEggProgress`
- `SanctuaryCollectible`

Avoid storing the entire sanctuary as one opaque progress blob if individual state will need to be queried or updated independently.

### 0.4 ADRs

Record decisions for:
- Sanctuary unlock mechanism
- Persistent Three.js world-state synchronization
- Dragon ownership/progression
- Skill challenge integration
- AI NPC boundaries
- Polly audio caching
- GLB asset strategy

## Completion criteria

The sanctuary has a documented data contract, progression contract, and Three.js integration plan before gameplay implementation begins.

---

# Phase 1 — Minimum Explorable Sanctuary

## Goal

Create the first playable Three.js version of the region.

## Environment

Build a sanctuary containing:

1. Sanctuary Gate
2. Central Valley
3. Ember's Roost
4. Dragon Keeper Lodge
5. Locked Forge
6. Locked Crystal Cavern entrance
7. Locked Hatchery
8. Distant Sky Cliffs

Several locations should initially be visible but inaccessible so the player can see future progression opportunities.

## Three.js requirements

Implement:
- First-person movement
- Collision system
- Terrain
- GLB model loading
- LOD where appropriate
- Interaction raycasting
- Trigger volumes
- Doors/gates
- Environmental audio
- NPC interaction points
- Region loading/unloading
- Mobile-friendly performance targets

## Art placeholders

Do not block engineering on final art.

Use placeholder GLBs for:
- Ember dragon
- sanctuary gate
- nests
- ruins
- rocks
- crystals
- forge
- lodge
- trees/vegetation

## Deliverable

The child can enter Dragon's Sanctuary, explore it, approach Ember, inspect locked locations, and leave the region.

---

# Phase 2 — Ember and the Sanctuary Introduction

## Goal

Give the region an immediate story and purpose.

## Story setup

The sanctuary once protected dragons and Dragon Keepers. Its ancient systems have stopped working and most dragons have disappeared.

Ember is the first dragon encountered.

Ember explains that restoring the sanctuary requires recovering the lost **Keeper Flames**.

Each Keeper Flame represents meaningful progress rather than simple grinding.

## First quest

### Quest: Rekindle the Forge

Player objectives:

1. Meet Ember.
2. Investigate the dormant forge.
3. Locate three missing fire runes.
4. Solve environmental skill challenges.
5. Place the runes correctly.
6. Restart the forge.

## Persistent result

Once completed:
- forge remains active
- lighting changes
- Ember moves into the restored roost
- forge NPC interactions become available
- new challenge tier unlocks
- sanctuary state permanently records restoration

## Deliverable

One complete end-to-end sanctuary quest demonstrating the final architecture.

---

# Phase 3 — Embedded Learning Challenge Engine

## Goal

Connect sanctuary gameplay to the Learning Adventure Island skill system.

## Challenge domains

Initially support:
- Mathematics
- Reading
- Vocabulary
- Logic
- Science

## Challenge contract

A sanctuary challenge should request something conceptually similar to:

```text
skillId
domain
playerMastery
difficulty
worldContext
challengeType
attemptNumber
```

The learning engine returns an appropriate challenge while the sanctuary controls its visual presentation.

## Environmental challenge types

Implement reusable Three.js components for:
- rune selection
- object ordering
- number locks
- rotating mechanisms
- matching
- sorting
- bridge/path construction
- lever sequences
- inventory placement
- dialogue answers

## Important rule

Three.js presentation and educational correctness should remain separated.

The learning engine determines the correct solution.

The 3D environment represents the problem and reacts to the result.

## Adaptive difficulty

After each challenge:
- record attempts
- record hints used
- record completion time
- update skill evidence
- adjust future challenge difficulty

## Deliverable

The same sanctuary quest can serve players at different skill levels without maintaining separate age-specific versions.

---

# Phase 4 — Dragon NPC System

## Goal

Turn dragons into persistent characters rather than quest markers.

## Initial dragons

### Ember
Focus: Mathematics and patterns  
Personality: energetic, brave, occasionally impatient

### Zephyr
Focus: Reading and comprehension  
Personality: curious, clever, playful

### Terra
Focus: Science and nature  
Personality: patient, protective, thoughtful

### Tide
Focus: Logic and spatial reasoning  
Personality: mischievous, puzzle-loving

### Luna
Focus: Vocabulary, language, and storytelling  
Personality: imaginative, mysterious

### Elder Dragon
Focus: Cross-domain mastery  
Role: late-game mentor and sanctuary lore keeper

## NPC state

Persist:
- discovered
- relationship level
- completed quests
- current quest
- unlocked dialogue
- dragon growth/state
- relevant player accomplishments

## Deliverable

A reusable Dragon NPC framework supporting multiple dragon personalities and quest trees.

---

# Phase 5 — AI Dragon Conversations

## Goal

Use AI to make dragons responsive while preserving deterministic learning and child safety.

## AI responsibilities

AI may generate:
- contextual dialogue
- hints
- encouragement
- lore
- quest flavor
- references to previous accomplishments
- explanations at the player's skill level

AI should NOT independently determine:
- whether educational answers are correct
- rewards
- mastery advancement
- unlock conditions
- inventory changes
- quest completion

Those remain server-controlled.

## Context builder

Provide bounded context containing:
- dragon identity/personality
- active quest
- current challenge
- allowed lore
- recent sanctuary history
- relevant skill state
- safe response rules

## Amazon Polly

Generate spoken dragon dialogue using Amazon Polly.

Pipeline:

**Dialogue text → Polly → MP3 → S3 → CDN/cache → client playback**

Cache generated speech by normalized text + voice + engine/settings hash to avoid unnecessary regeneration.

Give dragons distinct voices where supported.

## Deliverable

Ember can conduct contextual spoken conversations without controlling authoritative gameplay state.

---

# Phase 6 — Dragon Hatchery

## Goal

Create the sanctuary's primary long-term retention system.

## Dragon eggs

Players can earn/discover eggs through:
- major quests
- exploration secrets
- mastery milestones
- story completion

Avoid rewarding repetitive low-value grinding.

## Lifecycle

**Egg → Hatching → Hatchling → Young Dragon → Adult Dragon**

## Growth

Growth should depend on meaningful learning and exploration milestones.

Possible factors:
- new skills mastered
- quests completed
- sanctuary discoveries
- dragon care activities
- cross-domain challenges

## Hatchery gameplay

Player must prepare appropriate conditions:
- temperature
- habitat
- food
- light
- water
- magical/environmental properties

These become science, math, reading, and logic activities.

## Deliverable

A child can obtain, hatch, name, and begin raising a dragon.

---

# Phase 7 — Dragon Abilities and Cross-Island Integration

## Goal

Make sanctuary progression affect the rest of Learning Adventure Island.

## Example abilities

### Fire
Lights torches and clears certain obstacles.

### Flight
Provides access to elevated or remote locations.

### Earth
Moves rocks and reveals buried entrances.

### Water
Allows underwater or flooded-area exploration.

### Wind
Operates mechanisms and enables gliding puzzles.

### Dragon Sense
Reveals hidden collectibles, tracks, or magical objects.

## Design rule

Abilities should open **optional discoveries and alternate paths** whenever possible rather than breaking existing region progression.

## Cross-region hooks

Add Dragon Ability interaction points to:
- Storykeeper Castle
- Wonderwild Forest
- Clockwork Harbor
- future island regions

## Deliverable

Unlocking a dragon changes how the child can explore the wider island.

---

# Phase 8 — Sanctuary Expansion

## Goal

Turn the initial valley into a deep explorable region.

## 8.1 Crystal Caverns

Focus:
- logic
- geometry
- spatial reasoning
- patterns

Gameplay:
- crystal light beams
- mirrored paths
- rotating crystals
- underground secrets

## 8.2 Ancient Dragon Library

Focus:
- reading
- comprehension
- vocabulary
- storytelling

Gameplay:
- restore damaged books
- decode inscriptions
- discover dragon history
- story puzzles

## 8.3 Sky Cliffs

Focus:
- advanced traversal
- estimation
- physics concepts

Gameplay:
- gliding
- wind currents
- aerial collectibles
- flying challenges

## 8.4 Dragon Training Grounds

Purpose:
Repeatable mastery challenges.

Include:
- timed challenges
- accuracy challenges
- mixed-skill trials
- personal-best tracking

Avoid public competitive pressure for younger players.

## 8.5 Hidden Caverns

Purpose:
Exploration and secrets.

Include:
- rare collectibles
- lore
- hidden eggs
- secret passages
- environmental puzzles

---

# Phase 9 — Sanctuary Restoration System

## Goal

Make player progress visually transform the region.

## Restoration stages

### Stage 0 — Forgotten
- broken structures
- empty nests
- dark forge
- locked gates

### Stage 1 — Ember Returns
- forge active
- fire lanterns illuminated

### Stage 2 — Dragons Return
- additional roosts occupied
- NPC activity increases

### Stage 3 — Hatchery Restored
- eggs and hatchlings appear
- vegetation/environment improves

### Stage 4 — Sanctuary Reborn
- buildings repaired
- dragons fly overhead
- waterfalls/magic restored
- Keeper Lodge upgraded

### Stage 5 — Dragon Keeper
- Elder Dragon content
- mastery quests
- advanced sanctuary areas

## Technical requirement

World-state changes must be data-driven rather than implemented as separate copies of the Three.js scene.

Example:

```text
forge.active = true
hatchery.restorationLevel = 2
crystalCaverns.unlocked = true
ember.roost = "restored"
sanctuary.restorationLevel = 3
```

The scene renderer reads this state and changes models, animations, particles, NPC placement, lighting, and interactions accordingly.

---

# Phase 10 — Collectibles, Secrets, and Exploration

## Goal

Reward children for exploring rather than walking directly between quest markers.

## Collectibles

Possible collectible families:
- Dragon Scales
- Ancient Runes
- Keeper Medallions
- Dragon Lore Pages
- Crystal Shards
- Lost Dragon Toys
- Fossils
- Rare Eggs

## Secret system

Include:
- breakable/interactive environmental clues
- hidden caves
- secret doors
- unusual NPC dialogue
- dragon-ability locations
- environmental riddles

Do not show every secret on the map.

## Exploration journal

Track:
- dragons discovered
- sanctuary areas discovered
- collectibles
- lore
- mysteries
- eggs
- secrets

---

# Phase 11 — Quest Framework and Content Pipeline

## Goal

Allow new Dragon Sanctuary adventures to be added primarily as content rather than custom code.

## Quest definition

Support data-driven definitions for:
- quest ID
- title
- dragon/NPC
- prerequisites
- skill requirements
- steps
- dialogue
- interaction targets
- challenges
- rewards
- world-state mutations
- follow-up quests

## Quest types

Support:
- main sanctuary quests
- dragon-specific quests
- skill quests
- exploration quests
- mystery quests
- collection quests
- mastery quests
- cross-island quests

## Developer tooling

Create validation that detects:
- missing quest targets
- invalid prerequisites
- unreachable states
- missing skill IDs
- missing GLBs
- missing dialogue
- invalid rewards

---

# Phase 12 — Parent/Teacher Integration

## Goal

Expose educational progress without ruining the child's fantasy experience.

Adult-facing reporting can show:
- skills practiced
- mastery evidence
- challenges attempted
- hints required
- successful problem types
- struggling skill areas
- quests completed
- exploration time

The child-facing UI should instead emphasize:
- dragons
- sanctuary restoration
- quests
- abilities
- discoveries

Do not turn the child's sanctuary UI into an analytics dashboard.

---

# Phase 13 — Performance and Device Support

## Three.js optimization

Implement:
- Draco/Meshopt compression where appropriate
- KTX2 textures
- instancing
- LOD
- frustum culling
- lazy region loading
- pooled effects
- optimized animation mixers
- texture budgets
- model polygon budgets

## Target platforms

Design for:
- desktop browsers
- tablets
- mobile browsers
- future Android client using shared Amplify backend/API

The authoritative sanctuary state should live behind shared APIs rather than browser-local state.

---

# Phase 14 — Testing

## Unit tests

Test:
- unlock rules
- skill selection
- rewards
- dragon growth
- quest transitions
- restoration stages
- ability unlocks

## Integration tests

Test:
- challenge completion → skill evidence
- quest completion → sanctuary mutation
- egg progression
- AI dialogue context
- Polly cache generation
- cross-region abilities

## Three.js tests

Verify:
- spawn locations
- collisions
- interaction distances
- inaccessible areas remain inaccessible
- quest objects exist
- state changes render correctly

## Child playtesting

Observe whether children:
- know what to do without excessive instructions
- voluntarily explore
- understand why areas are locked
- care about dragons
- want to hatch eggs
- recognize environmental learning challenges
- return to previously unlocked areas

Use behavior rather than stated preference as the strongest signal.

---

# Recommended Build Order

## Milestone A — Sanctuary Prototype

Build Phases 0–2.

**Result:** A child can enter the sanctuary, meet Ember, complete Rekindle the Forge, and permanently change the environment.

This is the first major go/no-go milestone.

## Milestone B — Learning Integration

Build Phase 3.

**Result:** Forge challenges adapt to player skill level.

## Milestone C — Living Dragon

Build Phases 4–5.

**Result:** Ember becomes a persistent AI-assisted voiced NPC.

## Milestone D — Retention Loop

Build Phase 6.

**Result:** Players can earn and hatch their first dragon.

## Milestone E — Island Integration

Build Phase 7.

**Result:** Dragons provide abilities usable elsewhere on Learning Adventure Island.

## Milestone F — Full Region

Build Phases 8–11.

**Result:** Dragon's Sanctuary becomes a substantial persistent world with multiple dragons, quest lines, secrets, collectibles, and restoration stages.

## Milestone G — Production

Build Phases 12–14.

**Result:** Adult reporting, device optimization, testing, and production hardening.

---

# MVP Scope

Do **not** attempt to build the entire roadmap before testing the concept.

The first production-quality MVP should contain:

1. Sanctuary Gate
2. Central Valley
3. Ember
4. Ember's Roost
5. Dragon Keeper Lodge exterior
6. Ember Forge
7. One locked future area
8. Rekindle the Forge quest
9. 3–5 reusable environmental challenge mechanics
10. Adaptive skill difficulty
11. Persistent sanctuary state
12. Ember dialogue
13. Amazon Polly voice playback
14. One visible permanent world transformation
15. One reward/collectible system

### MVP success experience

A child should be able to:

**Unlock Sanctuary → Enter → Explore → Meet Ember → Receive Quest → Find Runes → Solve Adaptive Challenges → Restart Forge → See Sanctuary Change → Receive Reward → Discover Teaser for Next Adventure**

If that experience is fun, expand into eggs, additional dragons, abilities, caverns, flying, and full restoration.

---

# Suggested Repository Structure

```text
docs/
  regions/
    dragons-sanctuary/
      REGION_SPEC.md
      STORY.md
      QUESTS.md
      DRAGONS.md
      SKILLS.md
      WORLD_STATE.md
      ASSETS.md
      AUDIO.md
      AI.md
      TESTING.md

src/
  regions/
    dragons-sanctuary/
      DragonSanctuaryRegion.ts
      scene/
      dragons/
      quests/
      challenges/
      interactions/
      effects/
      audio/
      state/
      assets/

amplify/
  data/
    # sanctuary-related schema integrated into existing data definitions

services/
  sanctuary/
  skills/
  dragons/
  quests/
  dialogue/
  speech/
```

Adapt these paths to the existing Learning Adventure Island repository conventions rather than creating duplicate frameworks.

---

# Initial Asset List

## Environment GLBs

- sanctuary gate
- ruined dragon temple pieces
- forge
- dragon roost/nest
- lodge
- cliffs
- rocks
- cave entrance
- crystals
- rune stones
- bridges
- vegetation

## Characters

- Ember dragon
- future dragon base rigs
- optional Keeper spirit/NPC

## Animation requirements

Ember should initially support:
- idle
- breathing
- looking at player
- walk
- turn
- sit
- sleep
- roar
- happy/excited reaction
- frustrated/thinking reaction
- takeoff
- landing
- short flight

Use a reusable dragon rig/animation strategy whenever practical so future dragons do not require entirely independent animation systems.

---

# Definition of Done for Dragon's Sanctuary 1.0

The region reaches 1.0 when:

- Multiple dragons inhabit the sanctuary.
- Challenges adapt to skill mastery.
- The sanctuary visibly changes through progression.
- At least one dragon can be raised from an egg.
- Dragons unlock useful cross-island abilities.
- Multiple sanctuary subregions exist.
- Exploration contains optional secrets and collectibles.
- Dragon NPCs support safe contextual AI dialogue.
- Spoken dialogue uses Polly with S3-backed caching.
- Quest/state systems are server authoritative.
- New quests can be added primarily through content definitions.
- Progress is available to parent/teacher reporting.
- The region performs acceptably on target web/mobile hardware.

---

# Guiding Principle

**The Dragon's Sanctuary should never feel like a collection of educational minigames with dragons painted on top.**

The player should feel that they are exploring a real sanctuary, befriending dragons, restoring a lost place, discovering secrets, raising creatures, and gaining new powers. Learning challenges are the mechanism through which the player succeeds in that world.

The desired child motivation is:

> "I want to solve this because I want to hatch my dragon / open that cave / repair the sanctuary."

rather than:

> "The game says I have to answer another school question."
