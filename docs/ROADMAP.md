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

## Post-MVP candidates

- Robot Repair Reef;
- Creature Care Cove;
- Make-Believe Market;
- seasonal island events;
- additional companions;
- educator or homeschool accounts;
- multilingual narration;
- local or pre-generated content modes for lower latency.

