# Development Roadmap

## Phase 0 — Foundation

Deliverables:
- React + Vite + TypeScript scaffold;
- Amplify Gen 2 scaffold;
- strict TypeScript, linting, formatting;
- Vitest and React Testing Library;
- Playwright setup;
- CI workflow;
- environment documentation;
- base design tokens and application shell.

Exit criteria:
- app runs locally;
- Amplify sandbox starts;
- checks pass in CI;
- no product features yet.

## Phase 1 — Parent Accounts and Child Profiles

Deliverables:
- Cognito parent authentication;
- custom or carefully themed auth screens;
- ParentProfile and ChildProfile schema;
- owner authorization tests;
- profile create/edit/deactivate;
- age band, interests, reading mode, session limit;
- parent/child mode separation.

## Phase 2 — Island Shell

Deliverables:
- Welcome Harbor;
- visual map;
- three MVP adventure locations;
- companion selection;
- static world-state decorations;
- adventure log shell;
- responsive and accessible navigation.

## Phase 3 — Deterministic Adventure Engine

Deliverables:
- typed adventure definition format;
- state machine and transition validation;
- hint ladder;
- session persistence and resume;
- skill evidence events;
- world change events;
- author one complete Pirate Builder Bay adventure without AI.

## Phase 4 — Safe AI Companion

Deliverables:
- structured AI generation route;
- Chatty persona template;
- age-banded output schemas and limits;
- validation and fallback pipeline;
- audit metadata;
- AI-assisted dialogue and hints in Pirate Builder Bay;
- failure and safety tests.

## Phase 5 — Storykeeper Castle

Deliverables:
- bounded collaborative story adventure;
- child supplies characters, choices, and ideas;
- AI creates short scene variations;
- comprehension and sequencing moments;
- generated story artifact with parent-controlled retention.

## Phase 6 — Wonderwild Forest

Deliverables:
- curated Wonder Wall question categories;
- bounded curiosity-to-adventure generation;
- one complete nature/science adventure;
- evidence-based content templates and source-review workflow;
- safe fallback when a question is out of scope.

## Phase 7 — Parent Dashboard

Deliverables:
- recent adventures;
- skills practiced;
- support and hint patterns;
- creations and world changes;
- controls for AI, voice, session time, and retention;
- plain-language weekly summary.

## Phase 8 — Hardening and Pilot

Deliverables:
- threat modeling;
- authorization review;
- privacy and child-safety review;
- accessibility audit;
- load and cost tests;
- AI red-team tests;
- data deletion flow;
- operational dashboards and alarms;
- closed parent pilot.

## Phase 9 — World Engine Foundation

Supersedes the earlier, narrower "Motion and Embodiment" phase. Full
rationale, architecture, and worked examples are in
`docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` (sections
5–9, 28, 40, 43); see also ADR-007 in `docs/DECISIONS.md`. The hop-animation
precedent in `ChattyAvatar.tsx` (Canvas 2D, `requestAnimationFrame`,
`prefers-reduced-motion` guard) remains the pattern for small self-contained
portraits/icons, but is not extended into a general game engine — Phaser
takes that role instead (ADR-007).

Deliverables:
- Phaser integration and dependency addition;
- a React/Phaser boundary component owning `Phaser.Game` lifecycle
  (mount/unmount, no re-instantiation on unrelated re-renders);
- avatar controller (keyboard and touch movement);
- camera follow;
- tilemaps;
- collisions;
- interaction zones (`WorldInteraction`, roadmap section 8);
- sprite animation;
- world object registry;
- touch controls;
- keyboard controls;
- accessibility support, including a non-graphical alternate navigator
  (roadmap section 42) — walking the world must never be the only way to
  reach a location or adventure;
- reduced-motion support for ambient/cosmetic world effects;
- world event bus decoupling Phaser scenes from React/adventure state;
- Adventure Engine integration (a `WorldInteraction` can start an existing
  deterministic adventure).

Success criterion (roadmap section 28): a child can walk around a prototype
Welcome Harbor, interact with Chatty, approach an adventure object, and
launch an existing deterministic adventure.

This Phaser-based world is the current shipped renderer. Per ADR-008
(`docs/DECISIONS.md`), it is superseded going forward by a first-person 3D
world built on Three.js (Phases 31–34) — Phaser stays live and authoritative
until that migration reaches feature parity and is verified, not before.

## Phase 10 — Welcome Harbor

Turn Welcome Harbor into the first production explorable environment:
complete harbor map, environmental animations, NPC framework, Chatty follow
behavior, doors, signs, interactive objects, adventure entrances, persistent
world changes, initial avatar customization, location transitions. Do not
build the rest of the island yet — Welcome Harbor proves the architecture
(roadmap section 29).

## Phase 11 — Pirate Builder Bay (Spatial)

Convert "Repair the Moonlight Bridge" into the first fully spatial
adventure: explore, discover the broken bridge, meet a character, find
materials, complete the existing learning challenges, build the bridge,
watch it assemble, walk across it, discover a new area. Proves that
learning can directly modify navigation (roadmap section 30).

## Phase 12 — Story Engine

Add the Story Engine layer above the deterministic Adventure Engine:
`StoryDefinition`, `StoryChapter`, `StoryScene`, story progress persistence
(`ChildStoryProgress`, `docs/DATA_MODEL.md`), chapter transitions, story
flags, authored branching, adventure embedding, story recap, story
completion, world-change integration, content validation. Build one
reference story: **The Dragon of Ember Mountain** (roadmap sections 10–12,
31).

## Phase 13 — Wonderwild Exploration

Transform Wonderwild Forest from a question-selection interface into a
discovery-driven environment (bee hive, pond, leaves, cave, night clearing).
The existing Wonder Wall may remain as an optional interface, but discovery
becomes the preferred path (roadmap section 32).

## Phase 14 — Storykeeper Castle (Spatial)

Turn the castle into a physical creative-story environment (Character
Gallery, Setting Tower, Story Hall, Costume Room, Great Library,
Illustration Studio) where children construct stories by visiting locations
and making bounded creative choices (roadmap section 33).

## Phase 15 — Adventure Library

Introduce multiple full adventure arcs across fantasy, exploration,
building, nature, and mystery themes, gated by age band and child interest
rather than gender (roadmap sections 4, 34).

## Phase 16 — Island Progression

Connect story completion to larger world evolution: location unlocking,
persistent construction, ecosystem restoration, new NPC arrivals,
story-dependent environmental changes, secret locations, returning
characters, seasonal world state (roadmap section 35).

## Phase 17 — Household Co-Presence

Deliberately last: sibling co-presence only makes sense once the
single-player graphical world and Story Engine are stable (roadmap section
36), since presence UI has nothing meaningful to render without Phase 9's
avatar/world engine in place.

Deliverables:
- `CoopSession` Amplify model, owner-authorized to the shared
  `ParentProfile`, per `docs/DATA_MODEL.md` and ADR-006 in
  `docs/DECISIONS.md`;
- `AdventureSession.coopSessionId` link, preserving per-child
  `AdventureAction`/`SkillEvidence` attribution — `CoopSession` never
  becomes the record of who learned what;
- shared-state subscription wiring (AppSync `onUpdate` on `CoopSession`)
  driving live avatar and action presence on both children's clients;
- slot-claim conflict resolution (atomic first-write-wins; a second child's
  action on an already-filled slot is rejected server-side, not surfaced as
  an error) for the coop-eligible step types defined in
  `docs/ADVENTURE_ENGINE.md`: `NUMBER_INPUT`, `ORDERING`, `MATCHING`, and
  shared-construction `WORLD_CHANGE` steps;
- presence UI (avatar position, join/leave) as ephemeral client state, not a
  stored model;
- dual `WorldChange` write on coop completion, one per participating child,
  so both islands reflect the outcome with no shared/merged world state;
- parent-facing entry point to start a coop session between two of their
  own child profiles — no invite or matchmaking system, since v1 is
  household-only and the parent already owns both profiles;
- authorization tests confirming `CoopSession` records stay scoped to the
  shared `ParentProfile` and are unreachable across families.

Explicitly out of scope for this phase, per ADR-006: cross-family pairing,
any communication surface, and continuous cursor/telemetry-level presence.

## Phases 18+ — Curriculum, Mastery, and Platform Engines

An August 2026 planning pack proposed evolving the platform toward explicit
engine boundaries: World Engine, Adventure Engine, Learning Engine, Mastery
Engine, Interaction Engine, Reward/Economy Engine, AI Tutor Engine, and
Parent/Educator Engine, under the rule that curriculum logic should never
reference adventure theme content (dragons, pirates, and so on) and theme
content should never compute mastery directly.

Several of that pack's proposed phases are substantially already delivered
under different names and are not repeated here:

- persistent explorable world and a first complete "broken bridge" style
  vertical slice: delivered as Phase 9 (World Engine Foundation), Phase 10
  (Welcome Harbor), and Phase 11 (Pirate Builder Bay Spatial, "Repair the
  Moonlight Bridge");
- dynamic, persistent world state driven by player action: delivered as the
  existing `WorldChange` model (`docs/DATA_MODEL.md`) and extended by
  Phase 16 (Island Progression);
- long-form, multi-chapter campaigns: delivered as Phase 12 (Story Engine,
  "The Dragon of Ember Mountain") and extended by Phase 15 (Adventure
  Library);
- a parent/educator progress experience: delivered as Phase 7 (Parent
  Dashboard) and extended by Phase 30 below.

The phases below cover the genuinely new ground: formal curriculum
modeling, a standalone mastery engine, reusable teaching and gameplay
interaction frameworks, persistent NPCs, inventory/rewards, a data-driven
quest engine, exploration secrets, an adaptive adventure director, and
multi-island expansion. One naming conflict from the source material is
resolved here: the AI tutor role it called "Pico" is this product's existing
companion, **Chatty the Parrot** (section 6); there is no second companion.

### Phase 18 — Engine Boundaries

Deliverables:
- documented responsibilities for each engine listed above, added to
  `docs/ARCHITECTURE.md`;
- event contracts exchanged between engines (`LearningRequested`,
  `InteractionCompleted`, `MasteryUpdated`, `QuestAdvanced`,
  `WorldStateChanged`);
- an ownership table in `docs/DATA_MODEL.md` naming which engine is
  authoritative for each entity, including existing entities
  (`AdventureTemplate`, `AdventureSession`, `SkillProgress`, `WorldChange`);
- confirmation, by review of existing adventure content, that no adventure
  template currently embeds mastery-calculation logic that belongs in
  Phase 20 instead.

This phase documents boundaries; it does not ship a user-facing feature.

### Phase 19 — Curriculum and Skill Graph

Deliverables:
- subject/domain/skill schema (Subject → Grade/Level → Domain → Skill),
  with prerequisites, difficulty, and representations (numeric, visual,
  word problem, game interaction);
- optional standards-mapping metadata;
- curriculum query APIs;
- a seed curriculum limited to one vertical slice (recommended: grade 1–2
  mathematics, enough to support the Phase 9/11 bridge adventure) rather
  than every grade and subject at once.

### Phase 20 — Mastery Engine

Extends the existing `SkillProgress` model (`docs/DATA_MODEL.md`) rather
than replacing it.

Deliverables:
- per-skill status (locked, introduced, developing, proficient, mastered);
- independent vs. assisted attempt tracking, feeding the existing
  independent/hinted distinction already used by the hint ladder
  (`docs/ADVENTURE_ENGINE.md`);
- recent performance, last-practiced, and error-pattern tracking;
- prerequisite-unlocking and review/decay rules;
- a safe, summarized mastery view exposed to the Adventure Director
  (Phase 28) and to Chatty (Phase 27) — full mastery detail is not sent to
  either.

### Phase 21 — Teaching Engine

Generalizes the existing per-adventure hint ladder (MVP scope item 7,
`docs/ADVENTURE_ENGINE.md`) into a reusable cross-adventure scaffolding
state machine: introduce, demonstrate, guided practice, independent
practice, application, mastery check, review.

Deliverables:
- reusable teaching/lesson state machine;
- defined scaffolding levels (contextual hint, visual representation,
  interactive manipulative, guided demonstration, equivalent retry
  problem);
- a rule preventing repeated failure loops from stalling an adventure;
- assistance level recorded as mastery evidence (Phase 20).

### Phase 22 — Gameplay Interaction Library

Deliverables:
- a common interaction contract usable across adventures (drag/sort/split/
  measure/build/decode/converse mechanics mapped to skill types);
- reusable, themeable React interaction components, with skill parameters
  kept separate from visual/story presentation;
- attempt, hint, duration, and result capture wired into Phase 20;
- keyboard, touch, and mouse accessibility for every interaction.

### Phase 23 — Persistent NPC System

Deliverables:
- NPC identity, location, schedule, dialogue trees, and conditional
  dialogue;
- persistent per-child memory flags (for example `bridgeQuestCompleted`)
  and relationship/friendship progression;
- quest-giver behavior tied into Phase 25;
- controlled integration points for Chatty-narrated dialogue, bounded by
  the same authored-schema rules as section 11.

### Phase 24 — Inventory, Collectibles, and Rewards

Deliverables:
- backpack/inventory data model, item definitions, and rarity;
- collectible sets, cosmetics, quest items, and hidden collectibles;
- reward tables and a safe economy with no manipulative monetization
  patterns (section 4, pillar 7 — no loot-box mechanics);
- explicit design rule: not every reward needs to be educational; some
  treasure is simply treasure.

### Phase 25 — Data-Driven Quest Engine

Complements, rather than replaces, the existing `AdventureTemplate`/
`AdventureStep` model — quests compose existing adventures and world
interactions rather than introducing a parallel content format.

Deliverables:
- quest definitions built from reusable primitives (`TALK_TO`, `FIND`,
  `COLLECT`, `DELIVER`, `EXPLORE`, `SOLVE`, `BUILD`, `CRAFT`, `HELP_NPC`,
  `DISCOVER`, `LEARN`);
- objectives, prerequisites, optional objectives, and branching;
- a quest journal with save/resume;
- quest events that modify `WorldChange` state.

### Phase 26 — Exploration and Secrets

Deliverables:
- hidden caves, secret passages, locked doors, and optional quest chains
  layered onto existing explorable regions (Phases 10, 11, 13, 14);
- discovery tracking and rare-collectible spawning (Phase 24);
- exploration telemetry that follows the existing rule against logging
  child free-text (section 13).

### Phase 26.5 — NPC Conversation UI

Inserted ahead of Phase 27 rather than planned. Phases 22, 23, and 25 each
shipped complete and unreachable: the Interaction Library rendered in no live
screen, the NPC System decided what characters say with no way to talk to
one, and the Quest Engine could run three quests that nothing could start,
because starting them meant talking to Pip, Quill, or Bolt. Phase 26 routed
around the gap by having a discovery give out its quest; this closes it.

Deliverables:
- a conversation screen reached by the `TALK_TO` world action, rendering the
  dialogue node the Phase 23 engine selects and the bounded `CONVERSE`
  choices the Phase 22 library draws (never free text, per CLAUDE.md
  section 2, and never AI, per `DialogueNode.narration` staying opt-in for
  Phase 27);
- persistence of every node shown, so memory flags and friendship carry
  between visits;
- quest offers presented when the talking is done, gated on both the NPC's
  own conditions and the quest being startable, and accepted in place;
- an authoring check (`reachableMemoryFlags`) that a `TALK_TO` objective
  never waits on a flag no conversation can set.

### Phase 27 — Chatty as Contextual AI Tutor

Deliverables:
- a tutor context builder assembling only current quest, current skill,
  known prerequisites, allowed vocabulary, and current hint level — not a
  full child profile or history (section 7);
- an approved-strategies schema so Chatty can explain, ask guiding
  questions, hint, encourage, and switch representations, but cannot
  independently determine mastery, invent curriculum requirements, or
  bypass safety constraints;
- response validation and deterministic fallback, consistent with the
  existing AI validation pipeline (Phase 4).

### Phase 28 — Adaptive Adventure Director

Deliverables:
- skill-needs ranking sourced from Phase 20 mastery summaries;
- adventure eligibility rules that favor weaker skills without presenting
  content to the child as remediation;
- story-continuity and variety/repetition protection;
- explainable selection logs for adults/developers (not exposed to the
  child).

### Phase 29 — Multiple Islands and Worlds

Deliverables:
- world/region registry and a travel system;
- world-specific assets and rules built on the shared curriculum, mastery,
  quest, inventory, and tutor engines from Phases 19–27, so a new island is
  primarily a content-authoring task (section 39);
- shared player identity and inventory across worlds;
- content packaging and lazy loading.

### Phase 30 — Parent/Educator Experience Expansion

Extends the existing Phase 7 Parent Dashboard rather than replacing it.

Deliverables:
- mastery-level summaries ("Measurement → PROFICIENT") sourced from
  Phase 20;
- independent-vs-hinted reporting per adventure;
- suggested next-focus areas sourced from Phase 28's eligibility ranking,
  shown to parents only, never as pressure surfaced to the child;
- optional educator-oriented reporting.

## Phases 31+ — Three.js First-Person World

Per ADR-008 (`docs/DECISIONS.md`), the explorable world's rendering layer
moves from Phaser's top-down/isometric view to a first-person 3D world
built with Three.js: `PerspectiveCamera`, `Raycaster`-based interaction
targeting, GLTF/GLB assets, and `AnimationMixer`-driven animation. This is
a presentation-layer migration, not a rewrite of the Adventure Engine,
Story Engine, Learning Engine, Mastery Engine, AI safety pipeline, or
Amplify persistence — those stay exactly as delivered in Phases 3, 4, 12,
and 18–30. Only the world-rendering half of Phase 9's boundary
(`docs/DECISIONS.md` ADR-007's layering rule) is being re-implemented.

**Status:** Phaser (Phases 9–11) remains the current, shipped, authoritative
child-facing renderer throughout Phases 31–33. It is retired from
child-facing exploration only after Phase 33's vertical slice reaches
feature parity and is verified — never claimed as shipped before that.

**Standing risk:** first-person camera/look controls carry accessibility
and comfort concerns (fine motor control, motion sensitivity,
disorientation) more acute for the Sprouts band (ages 3–4) than for
Pathfinders or Explorers. Every phase below inherits Phase 9's existing
requirement that walking the world must never be the only way to reach a
location or adventure (roadmap section 42) — first-person navigation must
ship alongside a non-graphical alternate navigator, not instead of one.

### Phase 31 — Three.js World Foundation

Covers Graphics Gates A and B: establish the engine-neutral boundary before
building on top of it.

Deliverables:
- engine-neutral world events crossing the Three.js/domain boundary
  (`PlayerEnteredZone`, `ObjectInteracted`, `NpcApproached`,
  `CollectiblePickedUp`, `BuildActionRequested` out; `QuestStateChanged`,
  `WorldStateChanged`, `InventoryChanged`, `NpcStateChanged` in), mirroring
  the existing Phaser world event bus (Phase 9);
- stable semantic identifiers (`regionId`, `zoneId`, `entityId`,
  `interactionId`, `worldStateKey`) so persistent state never depends on a
  Three.js object UUID;
- an isolated Three.js sandbox route: one small scene with movement,
  collision, GLB loading, `Raycaster` interaction, one animated GLB NPC,
  and one persisted semantic world-state change, wired to trigger an
  existing quest/adventure action without duplicating its business rule;
- desktop keyboard/mouse (pointer-lock) and tablet/touch movement and look
  controls, tuned for comfort (acceleration/deceleration, controlled camera
  pitch limits, no forced cinematic camera motion);
- a documented Phaser-to-Three.js migration boundary per ADR-008: which
  Phase 9–11 concerns (tilemaps, top-down movement, tile collision, 2D
  proximity zones, sprite animation) map to which Three.js equivalent
  (GLB regions, first-person controller, 3D collision volumes, trigger
  volumes, `AnimationMixer` clips).

### Phase 32 — First-Person Island Village / Welcome Harbor

Covers Graphics Gate C. Rebuilds Welcome Harbor (or an equivalent first
region) as a polished first-person 3D space: enterable buildings, NPC
placement with proximity + raycast interaction, ambient creatures and
environmental animation, a minimal child-readable HUD (quest cue,
companion cue, inventory entry point, focus/interaction reticle), and
checkpoint-based position saving (never trusting raw coordinates as
durable state). Performance budget work — instancing for repeated scenery,
LOD, lazy-loaded regions, compressed GLB/textures — starts here and is
profiled on target tablets/Chromebooks, not only development desktops.

Exit criterion: a child can navigate the region in first person and
complete an in-world interaction without the top-down map as the primary
play surface, **and** the Sprouts (ages 3–4) accessibility playtest
required by ADR-008 has run, with results recorded in
`docs/PILOT_READINESS.md` or `docs/ACCESSIBILITY_AUDIT.md`. If that
playtest fails for Sprouts, first-person navigation ships for
Pathfinders/Explorers while Sprouts keeps a non-first-person primary route
(map navigator, fixed camera, or the existing Phase 9 Phaser view) — it
does not block the phase for the older bands.

### Phase 33 — First-Person Broken Bridge / Pirate Builder Bay Migration

Covers Graphics Gate D: the full-loop validation of the Three.js world.
Re-implements "Repair the Moonlight Bridge" (Phase 11) in first person so
the child sees the damaged bridge, approaches the NPC, searches the world
for materials, completes the existing measurement challenge using
story-relevant 3D objects where practical, participates in placing/building
the repair, watches the bridge transform from broken to repaired as an
actual geometry/state change (not a UI badge flip), and walks across the
newly opened space. Only after this slice is feature-complete and
play-tested is Phaser retired from child-facing exploration (ADR-008).

### Phase 34 — 3D Art and Asset Pipeline

Deliverables:
- GLTF/GLB as the standardized runtime format, with per-asset conventions
  (scale, forward/up axes, origin/pivot, collider proxy, interaction
  anchor, animation clip names, LOD variants, state-variant relationships);
- a shared animation-clip vocabulary (`Idle`, `Walk`, `Talk`, `Wave`,
  `Point`, `Celebrate`, `ReactHappy`, `ReactConcerned`, `Open`, `Close`,
  `Activate`) so runtime state machines stay simple across assets;
- modular kits (walls, roofs, doors, fences, paths, foliage) composable
  across regions instead of one-off bespoke scenes;
- an optimization pass (geometry/material/texture reduction, instancing
  for repeated props) verified in the actual browser scene before an asset
  ships;
- a first asset pack scoped to Phase 31–33's vertical slice only (terrain
  kit, one building, broken/repaired bridge variants, one NPC, one
  companion asset, quest props, foliage kit, one collectible) — a full
  island is not commissioned before that slice is proven fun and
  performant.

## Post-MVP candidates

- Robot Repair Reef;
- Creature Care Cove;
- Make-Believe Market;
- seasonal island events;
- additional companions;
- educator or homeschool accounts;
- multilingual narration;
- local or pre-generated content modes for lower latency.

