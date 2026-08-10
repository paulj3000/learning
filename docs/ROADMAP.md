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

## Phase 9 — Motion and Embodiment

Deliverables:
- extract the hop-animation logic already in `ChattyAvatar.tsx` (easing,
  `requestAnimationFrame` loop, `prefers-reduced-motion` guard) into a
  shared hook so no second component reimplements it;
- animate `WorldChange` as an assembly event (for example, planks flying in
  and snapping to count) instead of a static before/after swap — the
  highest-leverage item, since it is the literal mechanic behind "learning
  makes the island grow" (CLAUDE.md pillar 2);
- companion animation state machine (idle, walk, celebrate, hint-think)
  driven by adventure-engine events rather than click-only;
- avatar traversal between island locations on the map, replacing static
  location cards with a path the avatar visibly walks;
- build-mode placement interactions in Pirate Builder Bay (tap/drag-to-place
  with snapping) for counting, measurement, and sequencing steps;
- ambient idle life (waves, birds, background motion), cosmetic only, always
  gated by `prefers-reduced-motion`.

Constraints carried over from the existing `ChattyAvatar` precedent: Canvas
2D + `requestAnimationFrame`, no new animation/game-engine dependency, and a
coded reduced-motion fallback for every animated component (CLAUDE.md
section 13).

## Phase 10 — Household Co-Presence

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

