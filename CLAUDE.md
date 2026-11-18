# Learning Adventure Island — Claude Project Instructions

This is the mandatory entry point for every Claude Code agent. It states the binding rules in
short form and points to the detailed standards. Section numbers are stable: ADRs and documents
cite "CLAUDE.md section N", so a section is condensed, never renumbered. The full former text of
sections 1 to 13 is kept verbatim in
[docs/engineering/product-baseline.md](docs/engineering/product-baseline.md) and binds exactly as
before. Tool-neutral agent rules are in [AGENTS.md](AGENTS.md); it defers to this file for
project and product rules, and a conflict between them is a defect to report (the stricter rule
applies until the owner resolves it). Governance: ADR-072 (Proposed).

## Start here (every task)

1. Read this file, [AGENTS.md](AGENTS.md) and [docs/engineering/README.md](docs/engineering/README.md).
2. Read the standards that apply to your task (index in section 21) and the source documents in
   section 17.
3. Confirm your Trello ticket, branch, worktree and baseline SHA
   ([multi-agent-workflow.md](docs/engineering/multi-agent-workflow.md)).
4. Audit the code you will touch before planning; name any shared component you will change.
5. Implement, run the development checks (section 14), update docs and
   `docs/IMPLEMENTATION_STATUS.md`, commit, push, report.

## 1. Mission

Build **Learning Adventure Island**, an AI-powered learning adventure world for children aged
**3 to 8**, on React + Three.js, Django REST and PostgreSQL, Amazon Cognito and Amazon Bedrock.
Core promise: **learning makes the island grow.** Every experience combines a child-facing
adventure goal, age-appropriate learning objectives, a visible consequence in the world, safe and
constrained AI personalization, and encouragement without manipulation or shame.

## 2. Primary users

Parent or guardian (owns the account and child profiles, controls voice, microphone, AI and data
retention; no play-time limit, ADR-053). Child profile (no email, parent-managed, never an
unrestricted chat box). Administrator or content designer (Django Admin; reviews flagged AI
interactions without unnecessary child data).

## 3. Target age bands

Sprouts 3 to 4 (voice and picture first, one-step), Pathfinders 5 to 6 (narrated text, two or
three steps), Explorers 7 to 8 (more reading, multi-stage). Difficulty, reading volume, response
mode and length derive from the profile's age band and demonstrated ability, never from mere
availability.

## 4. Product pillars

Adventure first; learning has consequences; AI adds variation, not rules; children remain the
creators; safe by architecture; parent trust; calm engagement (no dark patterns, infinite
scrolling, loot boxes, public leaderboards or anxiety-driven streaks).

## 5. Initial world

Welcome Harbor, Pirate Builder Bay, Wonderwild Forest, Storykeeper Castle. Player-facing text now
says **Realm** for an Island (catalog `World`, ADR-041); see
[realm-standard.md](docs/adventures/realm-standard.md). Future locations are not in scope unless
approved.

## 6. AI companion

Chatty the Parrot: warm, curious, concise, never sarcastic; explains, hints, asks, narrates and
celebrates effort. Never requests private information, encourages secrecy, creates dependency,
diagnoses, disciplines, discusses inappropriate topics, or claims to be human, conscious, lonely
or dependent on the child.

## 7. AI interaction model

Structured generation, curated templates, deterministic game logic, server-side validation.
Never call a model from the browser or expose model credentials. Every AI call goes through
Django's AI pipeline (`lai/apps/ai`, Bedrock; deterministic fake provider locally and in tests),
carries template ID, age band, allowed topic, learning objective and maximum length, returns a
validated schema, and has an authored fallback. Application code, not the model, decides
correctness. Send no full profiles or unnecessary history; no persistent free-form memory.

## 8. Technology baseline

React 19, Vite, TypeScript strict, React Router, CSS Modules plus Tailwind CSS 4 where ADR-023 and
ADR-052 allow, Vitest, React Testing Library, Playwright (gated). Three.js is the only gameplay
renderer (section 19). Django + DRF on PostgreSQL 16 in `lai/` (ADR-021). Cognito is the sole
application identity provider, verified by Django (ADR-024, ADR-040); Django Admin staff sign-in
is separate (ADR-034). S3 through Django; Bedrock and Polly only from Django; background work on
`apps.jobs` with SQS and Lambda (ADR-064); AWS CDK in `infra/`. No Amplify. Detail and status of
every element: [architecture-rules.md](docs/engineering/architecture-rules.md).

## 9. Required domain concepts

Use `ParentAccount`, `ChildProfile`, `AgeBand`, `IslandLocation` (catalog `Location`, a Place),
`AdventureTemplate`, `AdventureSession`, `AdventureStep`, `LearningObjective`, `SkillProgress`,
`WorldChange`, `CompanionProfile`, `AIInteractionAudit`, `ParentConsent`, `SafetyEvent`. Never call
child profiles "users" in child-facing copy. Content hierarchy (Realm, Place, 3D Area, Adventure,
Quest, Challenge): [docs/adventures/README.md](docs/adventures/README.md).

## 10. Authorization principles

Parents authenticate through Cognito and reach only their own children and records. Children
never query admin records or raw AI audit data. Admin access is group-based. Data access is
deny-by-default. Detail: [security-policy.md](docs/engineering/security-policy.md).

## 11. MVP scope

The fourteen MVP items are in [product-baseline.md](docs/engineering/product-baseline.md),
section 11. Item 11: no play-time limits; children are never counted down, nudged to stop or cut
off for time (ADR-053).

## 12. Out of scope for MVP

Not without separate approval: social networking, child-to-child messaging, public profiles or
leaderboards, open-ended AI chat, public user-generated content, live classrooms, real-money
purchases by children, advertising, facial recognition, emotion inference, voice cloning,
unrestricted web search, autonomous agents taking external actions, native mobile apps.

## 13. Coding rules

TypeScript strict, no `any`. Domain logic outside React components; pure functions for adventure
transitions. Validate all external and AI data at runtime. Typed errors with safe messages. Never
log child free text, audio, names or identifiers unless documented as required. Tests with every
feature. No new dependency without approval. Accessible buttons, not clickable divs. Child-facing
text readable aloud and localizable, without em dashes. Detail:
[coding-standards.md](docs/engineering/coding-standards.md).

## 14. Work process and required report

Follow [development-workflow.md](docs/engineering/development-workflow.md). In short: read, audit,
state the acceptance criteria, make the smallest coherent change, add tests, run the development
checks, update docs and `docs/IMPLEMENTATION_STATUS.md`.

Development checks (canonical: `docs/TESTING_STRATEGY.md`, "When to run which checks";
summary: [testing-policy.md](docs/engineering/testing-policy.md)):
- targeted unit tests for changed code only: `npx vitest run --maxWorkers=2 <paths>` (from
  `react/`) and `.venv/bin/python -m pytest -q <paths>`;
- `npm run typecheck` when TypeScript changed;
- security, authorization, privacy-logging and AI-validation tests whenever the change touches
  them, and `npm run content:check` when exported content changes.

Not during development: Playwright, browser or WebGL automation, end-to-end and acceptance
suites, live AWS calls, deployment checks, Ruff, Prettier, oxlint, full suites and builds. They run
at merge or release readiness, only when explicitly requested.

Every task ends with a report: files created; files changed; tests run with exact results;
checks deferred to merge verification; shared components changed; remaining risks, blockers and
TODOs; commit SHA and branch. Use
[completion-report.md](docs/engineering/templates/completion-report.md) for tickets and
[agent-handoff.md](docs/engineering/templates/agent-handoff.md) when stopping mid-task. Never
fabricate results.

## 15. Definition of done

Completion is gated: Development Complete, Integration Complete, Owner Accepted, Complete
(merged; deployed only when in scope and authorized). Code written is not done, and a completed
implementation is never a production release. Criteria:
[definition-of-done.md](docs/engineering/definition-of-done.md). The product bar still applies:
flows work, authorization is explicit and tested, loading, empty, error and AI-fallback states
exist, age bands are respected, accessibility basics hold, analytics avoid sensitive content.

## 16. First build sequence (retired)

Historical only; kept in [product-baseline.md](docs/engineering/product-baseline.md). The
lasting rule: make an experience playable deterministically before adding AI (ADR-002).

## 17. Source documents

Product and domain: `docs/PRODUCT_VISION.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`,
`docs/AI_AND_CHILD_SAFETY.md`, `docs/ADVENTURE_ENGINE.md`, `docs/UX_AND_ACCESSIBILITY.md`,
`docs/ROADMAP.md`. Process: `docs/TESTING_STRATEGY.md`, `docs/IMPLEMENTATION_STATUS.md`,
`docs/DJANGO_MIGRATION_ROADMAP.md`. Decisions: `docs/DECISIONS.md` (the only ADR log; see
[docs/adr/README.md](docs/adr/README.md)).

## 18. Backend migration (Django in effect; Amplify retired)

ADR-019 in `docs/DECISIONS.md` moves the backend from Amplify Gen 2 to Django + DRF. It is
**Accepted in part**: the architectural direction (Django + DRF, PostgreSQL, React 19,
Cognito initially, S3, FinWin-style layout) is approved. The owner deleted the Amplify app and
disabled Amplify Hosting (2026-11-14), and the source no longer contains or calls Amplify
(AMP-01 to AMP-08, `docs/platform/AMPLIFY_FINAL_REMOVAL.md`); section 8 describes the code. The
Django and S3/CloudFront deployments, and the import of retained Amplify data, are still owner
approvals, not done. Operational, data, and security items are
open gates (G1 to G10 in the ADR; G4 is resolved: Python rules, Django content authority) and must not be assumed settled. Track A tasks (Phases 1 to
13) proceed when their explicit dependencies and the architecture gates that apply to them are
satisfied (owner, 2026-10-24), and stop for approval at every task marked APPROVAL in
`docs/DJANGO_MIGRATION_ROADMAP.md`:
- An earlier, unfinished task does not block an independent, dependency-ready task; the old
  "in order, skipping nothing" wording means no task skips its own dependencies, not that
  numbering order gates unrelated work.
- Open earlier tasks stay tracked as open and are never marked complete by implication.
- No task bypasses an unresolved dependency, an open gate it touches, or a decision it needs. Never delete or change deployed AWS
resources (the Cognito pool and the retained Amplify tables and buckets included), migrate
production data, or deploy without explicit approval. Never reintroduce Amplify.

## 19. Accepted game engine decision (in effect)

ADR-020 is **Accepted**: Three.js is the only gameplay renderer, and Phaser is to be retired
after every Phaser world is converted and verified. Rules for Claude:
- Do not add features to Phaser worlds. Bug fixes only, until the world is deleted.
- Any new playable environment is Three.js. Menus, HUD, dashboards, and admin stay React.
- Do not delete a Phaser world until its Three.js replacement passes parity tests and visual
  validation, and the Sprouts gate (LAI-2303) allows it.
- The engine never validates answers, awards progress, or calls AI; it emits typed events.
- Engine code must not import React, Django clients, Amplify, or AWS SDKs once it is in `game/`.
- Track B tasks (LAI-2001 to 2305) follow `docs/DJANGO_MIGRATION_ROADMAP.md` Phases 20 to 23.
  Docs-only LAI-2001 to 2003 do not wait for ADR-019; code tasks wait for LAI-0201. Never
  combine a backend domain change with a world conversion in one task.

## 20. One Django backbone (in effect)

ADR-033 (POST-MERGE-03): every feature, Treasure Rush included, uses the canonical Django apps
(`docs/ARCHITECTURE.md`, "Consolidated Django backbone"). Do not add a second catalog, content
loader, child-owned base, or progress model for one feature; extend the canonical one. Content
first reaches Django through the export and `manage.py load_content`; after import Django is
authoritative and administrators edit it through versioned revisions (ADR-047), which an import
never silently overwrites. Spatial layouts are not
Django-administered until LAI-0805's ADR: shipped regions keep their TypeScript manifests and
Treasure Cove's layout stays in `lai/apps/regions/treasure_rush_seed.py`.


## 21. Engineering governance (ADR-072, Proposed)

Rules marked as binding elsewhere bind now; the rest of these standards bind once the owner
accepts ADR-072. Until then, follow them as the documented way of working unless the owner or
your ticket says otherwise.

**Operating model.** The owner makes final architecture, product, acceptance, merge and deployment
decisions. ChatGPT is project manager, architect, specification writer and coordinator. Up to
five Claude agents (Claude-01 to Claude-05) implement tickets. Trello is authoritative for task
ownership, priority and state; GitHub for code, branches, pull requests and history.

**Git and worktrees.** One ticket, one branch, one worktree under
`/Coding/learning-worktrees/<short-name>`, created from a fetched baseline whose SHA you record.
Never commit to `main`, merge into `main`, force-push a shared branch, or touch another agent's
worktree, branch or stash. Push your branch; the owner opens or authorizes the pull request and
every merge. [branch-policy.md](docs/engineering/branch-policy.md),
[integration-policy.md](docs/engineering/integration-policy.md).

**Development restrictions.** Stay inside the ticket's scope; record and seek approval for any
significant expansion. No new framework, runtime dependency or architecture without approval.
Identify shared-component changes (models and migrations, auth, API contracts, engine, movement,
jumping, collision, camera, asset resolution, NPC, sound, content publication, scoring,
infrastructure) before making them. No AWS deployment, live AWS call or production data change
without explicit owner approval (section 18).

**Trello.** Claim the card before work, keep its ticket block current (branch, worktree, baseline,
pull request, commit, blockers), add dated evidence at each transition, and never move a card to
Complete because code exists. [trello-workflow.md](docs/engineering/trello-workflow.md).

**Documentation.** Update the documents your change makes stale, in the same branch; no
duplicate copies of canonical text. Run `npm run docs:check` when you edit governed documents and
`npm run adr:check` when you touch ADRs. [documentation-policy.md](docs/engineering/documentation-policy.md).

**Security.** Child privacy first, deny-by-default authorization tested per endpoint, server-side
validation, no secrets anywhere in the repository, fixtures or Trello, no compliance claims.
[security-policy.md](docs/engineering/security-policy.md).

**Adventures.** Every new adventure follows [adventure-standard.md](docs/adventures/adventure-standard.md)
and its templates, reuses the shared engine, movement, jumping, asset, NPC, sound, content,
scoring and progress systems, integrates jumping meaningfully with accessible alternatives
([jumping-standard.md](docs/adventures/jumping-standard.md)), never gates exits behind a
challenge, and never adds time limits.

### Standards index

| Topic | Document |
|---|---|
| Engineering index and owner checklist | [docs/engineering/README.md](docs/engineering/README.md) |
| Lifecycle | [development-workflow.md](docs/engineering/development-workflow.md) |
| Multi-agent work | [multi-agent-workflow.md](docs/engineering/multi-agent-workflow.md) |
| Architecture | [architecture-rules.md](docs/engineering/architecture-rules.md) |
| Coding | [coding-standards.md](docs/engineering/coding-standards.md) |
| Testing | [testing-policy.md](docs/engineering/testing-policy.md) |
| Security and privacy | [security-policy.md](docs/engineering/security-policy.md) |
| Branches | [branch-policy.md](docs/engineering/branch-policy.md) |
| Integration | [integration-policy.md](docs/engineering/integration-policy.md) |
| Releases | [release-policy.md](docs/engineering/release-policy.md) |
| Trello | [trello-workflow.md](docs/engineering/trello-workflow.md) |
| Definition of done | [definition-of-done.md](docs/engineering/definition-of-done.md) |
| Documentation | [documentation-policy.md](docs/engineering/documentation-policy.md) |
| Engineering templates | [docs/engineering/templates/](docs/engineering/templates/) |
| Adventure standards and templates | [docs/adventures/README.md](docs/adventures/README.md) |
| ADRs | [docs/adr/README.md](docs/adr/README.md) and `docs/DECISIONS.md` |
