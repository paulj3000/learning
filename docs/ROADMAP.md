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

## Post-MVP candidates

- Robot Repair Reef;
- Creature Care Cove;
- Make-Believe Market;
- seasonal island events;
- additional companions;
- educator or homeschool accounts;
- multilingual narration;
- local or pre-generated content modes for lower latency.

