# Django Migration Roadmap

Status: **Proposed (Track A, backend) and Accepted direction (Track B, engine).** Nothing below
is started except Phase 0 and the planning in `docs/THREEJS_ENGINE_CONVERSION.md`. Context:
`docs/DJANGO_MIGRATION_ASSESSMENT.md`; target: `docs/DJANGO_TARGET_ARCHITECTURE.md`;
decisions: `docs/DECISIONS.md` ADR-019; tracker: `tasks/TASK_TRACKER.md` (ids are `LAI-PPNN`,
`PP` = phase). This roadmap sits beside, not inside, `docs/ROADMAP.md`, which stays the
product roadmap.

**Two tracks (ADR-019 and ADR-020).** Track A, Phases 1 to 13, migrates the backend from
Amplify to Django. Track B, Phases 20 to 23, converts every Phaser world to the unified
Three.js engine in a first-class `game/` package and then removes Phaser. Track B inventory,
conversion matrix, and engine architecture: `docs/THREEJS_ENGINE_CONVERSION.md`. A task
belongs to exactly one track. Phase numbers 14 to 19 are left unused.

## 1. Principles

1. **Amplify keeps working until cutover.** Nothing under `amplify/` is edited or deleted
   before Phase 13 except path fixes forced by the `react/` move (LAI-0201).
2. **Strangler, not rewrite.** The React app talks to an interface (`react/src/api/*`);
   a build-time flag (`VITE_BACKEND=amplify|django`) selects the implementation per module
   until cutover.
3. **Read before write.** Catalog and read endpoints precede any Django write path.
4. **One implementation of each rule is tested against two languages.** Golden vectors run
   in Vitest and pytest (assessment section 5.3).
5. **Small tasks.** Each task fits one Claude session: one verifiable outcome, tests, docs,
   tracker update, no more than about 25 files.
6. **One renderer at the end, a working app throughout.** Track B keeps each Phaser world
   live until its Three.js replacement passes parity tests and visual validation. No task
   mixes a backend domain change with a world conversion.
7. **No unapproved infrastructure.** Every AWS-touching task is marked **APPROVAL** and
   stops at a plan until a human approves.

Every task also follows `CLAUDE.md` section 14: state acceptance criteria, smallest coherent
change, add tests, run typecheck/lint/tests, update `docs/IMPLEMENTATION_STATUS.md`, report.

## 2. Phase map (adjusted from the brief)

| Phase | Name | Why it differs from the brief's list |
|---|---|---|
| 0 | Assessment (done) | same |
| 1 | Governance and baseline | Split out: decide open questions and collect deployed evidence before touching code |
| 2 | Repo restructure and Django skeleton | Brief's phases 1 and 2 merged; they are mutually dependent |
| 3 | Content export and relational models | New explicit content-to-data step; core of the "data-driven islands" goal |
| 4 | Cognito integration and authorization | same, plus tenant-isolation harness first |
| 5 | Read-only frontend API migration | same |
| 6 | Authoritative progression, inventory, mastery | Brief's phase 6, made explicit as server-authoritative writes |
| 7 | AI service | Split out; AI Kit has no Django equivalent |
| 8 | Admin | same |
| 9 | Realtime (co-op) and storage | Co-op is not true multiplayer here; storage moved up |
| 10 | AWS dev/prod infrastructure | May start in parallel after Phase 4; local Docker is enough until Phase 11 |
| 11 | Data migration and parallel verification | same, plus shadow comparison |
| 12 | Cutover | same |
| 13 | Retire Amplify | same, plus Cognito detach as its own gated task |
| 20 | Engine discovery and architecture (Track B) | New, from ADR-020. Docs only; can run before ADR-019 is accepted |
| 21 | Engine extraction into `game/` (Track B) | New. Needs LAI-0201; supersedes Phase 0's "defer `game/`" |
| 22 | World conversions (Track B) | New. One task per Phaser world, eight in all |
| 23 | Verification and Phaser retirement (Track B) | New. Parity, performance, Sprouts gate, removal, final check |

## 3. Tasks

Format per task: **Depends** | **Risk** (L/M/H) | **Approval** (none or why). Then acceptance
criteria, files, tests, data/rollback/deploy notes where relevant.

### Phase 1 - Governance and baseline

**LAI-0101 Resolve open decisions (human-led).** Depends: assessment. Risk L. **APPROVAL: product owner.**
Acceptance: ADR-019 moved from Proposed to Accepted or amended; answers recorded for the five
open questions (assessment section 16); `CLAUDE.md` section 8 updated only if accepted.
Files: `docs/DECISIONS.md`, `CLAUDE.md`. Tests: none (docs). Rollback: revert docs.

**LAI-0102 Tracker tooling.** Depends: 0101. Risk L. Acceptance: `tasks/TASK_TRACKER.csv` +
`tasks/TASK_TEMPLATE.md` exist; stdlib-only `scripts/check_repo.py` fails when MD and CSV
disagree (as FinWin). Files: `tasks/*`, `scripts/check_repo.py`, CI step. Tests: unittest for
the checker. Deploy: none.

**LAI-0103 Capture deployed AWS evidence (read-only).** Depends: 0101. Risk L.
**APPROVAL: human supplies a read-only profile.** Acceptance: queries in
`docs/IAM_ROLE_AUDIT.md` section 5 run; results recorded in `IAM_ROLE_AUDIT.md` and
`CURRENT_AWS_RESOURCE_INVENTORY.md` (apps, branches, table item counts, Cognito user count,
Bedrock access). No resource modified. Rollback: n/a.

**LAI-0104 Relieve IAM pressure independently.** Depends: 0103. Risk L. **APPROVAL: human
only.** Acceptance: quota increase requested and/or unused sandboxes deleted by the owner.
This task is human-executed; Claude only prepares the list from LAI-0103.

**LAI-0105 Behaviour baseline.** Depends: none. Risk L. Acceptance: `docs/IMPLEMENTATION_STATUS.md`
records current test counts (175 files, 1,578 tests), Playwright smoke status, and build
output size, so later phases can prove no regression. Files: docs only.

### Phase 2 - Repo restructure and Django skeleton

**LAI-0201 Move the frontend to `react/`. IMPLEMENTED on branch
`lai-0201-move-frontend-to-react`, pending owner approval before merge; as-built deviations are
listed at the end of this task.** Depends: 0101. Risk M. **APPROVAL: before merge
(changes the Amplify build path).** Acceptance: `git mv` of `src/`, `public/`, `index.html`,
`vite.config.ts`, `tsconfig*.json`, `e2e/`, `playwright.config.ts`, `.oxlintrc.json`,
`.prettier*`, `package.json` to `react/`; `amplify/` imports of `../../../src/features/...`
updated to `../../react/src/features/...`; `amplify.yml` and CI use `react/`; all 175 test
files and 1,578 tests still pass; `npm run build` output identical in route/chunk list.
Tests: full unit suite, typecheck (app, amplify, scripts), Playwright smoke. Rollback: revert
the commit (pure moves). Deploy: Amplify Hosting appRoot must be set before merge.

*LAI-0201 as built (deviations from the list above, each forced by the move).* `amplify/`
and `scripts/` stay at the repository root, so (1) a thin root `package.json` declares the
npm workspace `react` and delegates every script, which keeps one `node_modules`, one
lockfile, and the existing `amplify.yml` and CI commands working; (2) `.oxlintrc.json`,
`.prettierrc.json`, and `.prettierignore` stay at the root because they govern `amplify/`,
`scripts/`, and docs as well; (3) `react/vite.config.ts` now also collects the five
`amplify/**/*.test.ts` files, which a bare move would have silently dropped; (4) the
`amplify_outputs.json` glob in `react/src/lib/amplify-config.ts` points at the root file;
(5) `amplify.yml` `baseDirectory` is `react/dist`; (6) `amplify/` and `scripts/` import
`react/src/...`, and `react/src/` imports `../amplify/...` one level further up; (7)
`package-lock.json` was regenerated for the workspace (see IMPLEMENTATION_STATUS). The
Amplify Hosting build with this layout is **unverified** (no deploy was run).

**LAI-0202 Python tooling. DONE (see IMPLEMENTATION_STATUS; no CI job yet, no type checker yet).** Depends: 0201. Risk L. Acceptance: `pyproject.toml`
(ruff, pytest), `requirements*.txt`, `docker-compose.yml` (PostgreSQL 16), `Makefile` `check`
target running Python and npm gates; CI Python job green on an empty test. No new runtime
dependency without a recorded note in `docs/DECISIONS.md` (CLAUDE.md "do not silently
introduce a new dependency").

**LAI-0203 Engine import boundary guard.** Depends: 0201. Risk L. Acceptance: a Vitest test
(or oxlint rule) fails if any file in `island-map/three/**/*.ts`, `island-map/scenes/**`,
or the geometry modules imports `*/api`, `lib/data-client`, or `aws-amplify`. Today it
passes (assessment section 5.2). Protects the engine boundary during the migration. Interim
guard only: LAI-2101 replaces it with the same rule applied to `game/` (and adds Django
client and `react/` imports to the forbidden list). The `island-map/scenes/**` clause goes
away when Phaser is removed (LAI-2304).

**LAI-0204 Django project skeleton. DONE (Django 6.1.2, ADR-021).** Depends: 0202. Risk L. Acceptance: `lai/` with
`config/settings/{base,local,production,test}.py`, `apps/core`, `GET /api/v1/health`,
`manage.py check` clean, pytest passes against Postgres. Files: `lai/**`. Rollback: delete
`lai/`. Deploy: none.

**LAI-0206 Python CI job (added to carry LAI-0202's deferred CI criterion). DONE locally; remote run pending.** Depends: 0204.
Risk L. **APPROVAL: owner, because it edits `.github/workflows/ci.yml`.** Acceptance: a separate
CI job installs `requirements-dev.txt`, starts PostgreSQL 16 as a service, and runs `make
py-check` and `make py-test-db`; the existing JavaScript jobs are unchanged and stay green.

**LAI-0207 Committed OpenAPI schema generation (split from LAI-0205).** Depends: 0205. Risk L. Acceptance: a recorded decision on the two extra dependencies DRF schema generation needs (PyYAML, uritemplate) or an alternative; a schema file generated from the views and checked in CI for drift.

**LAI-0205 DRF conventions. DONE locally (see IMPLEMENTATION_STATUS); cursor pagination and OpenAPI generation split out: pagination arrives with the first list endpoint (LAI-0502), OpenAPI is LAI-0207.** Depends: 0204. Risk L. Acceptance: typed error envelope with
safe messages, cursor pagination, request-log middleware that logs no child free text or
identifiers, committed OpenAPI schema generation. Tests: unit tests for envelope and the
log-redaction rule.

### Phase 3 - Content export and relational models

**LAI-0301 Users domain models.** Depends: 0204. Risk M. Acceptance: `ParentAccount`
(`cognito_sub` unique), `ChildProfile` (all fields of the Amplify model incl. age band,
reading mode, session minutes, `ai_enabled`, `owner_sub` equivalent via FK), `CompanionProfile`,
`ParentConsent`; maximum three active child profiles enforced in the service (CLAUDE.md
section 11); migrations. Data: schema only. Tests: model and service tests.

**LAI-0302 Content export to versioned JSON.** Depends: 0201. Risk M. Acceptance: a Node
script (`react/scripts/export-content.ts`) writes a content package for adventures, quests,
items/reward table, curriculum, worlds, locations, NPC definitions, discovery/checkpoints,
asset manifest, with a `schemaVersion` and a JSON Schema; an existing Vitest invariant test
validates the export round-trips. No change to runtime TS behaviour.

**LAI-0303 Golden vectors.** Depends: 0302. Risk M. Acceptance: `tests/golden/*.json`
generated by running the TS functions (`validateStepAnswer`, `getNextStepId`, `nextHintLevel`,
`resolveRewards`, quest/objective sync, mastery counters, director ranking) over
representative and edge inputs; a Vitest test regenerates and diffs them so they cannot go
stale.

**LAI-0304 Catalog models and loader.** Depends: 0302, 0301. Risk M. Acceptance: `islands`,
`adventures`, `quests`, `inventory` (ItemDefinition), `education` (LearningObjective),
`assets` models plus `manage.py load_content` that is idempotent and validates against the
JSON Schema; row counts match the export. Tests: loader idempotency and schema rejection.

**LAI-0305 Progress models.** Depends: 0301, 0304. Risk M. Acceptance: `game_sessions`
(AdventureSession, AdventureAction, CoopSession), `education` (SkillEvidence, SkillProgress,
StoryArtifact), `progression` (WorldChange with unique `(child, location, change_key)`,
WorldState, StoryProgress, NpcRelationship), `inventory` (InventoryItem), `quests`
(QuestProgress); array fields become rows or `ArrayField` by documented choice; migrations.

**LAI-0306 Audit models.** Depends: 0301. Risk L. Acceptance: `AIInteractionAudit`,
`SafetyEvent` with the same fields; no free-text columns for child input.

### Phase 4 - Cognito integration and authorization

**LAI-0401 Auth decisions.** Depends: 0204. Risk L. **APPROVAL: dependency choice.**
Acceptance: ADR records JWT library, accepted token type(s), clock-skew tolerance, JWKS
cache TTL, and the new Django-facing Cognito app client.

**LAI-0402 Cognito JWT authentication.** Depends: 0401, 0301. Risk H. Acceptance: DRF
authentication class validates signature (JWKS), `iss`, `token_use`, `client_id`, `exp`;
upserts `ParentAccount`; rejects tokens signed by a different key, expired, wrong audience,
and unsigned. Tests use locally generated RSA keys; no AWS calls in unit tests.

**LAI-0403 Tenant isolation harness.** Depends: 0402. Risk H. Acceptance: `ChildScopedViewSet`
base class; a test enumerates every registered route and asserts it is either public-listed
(health) or child/parent scoped; two-family fixtures prove a parent gets 404 on another
family's child for every endpoint. This is the replacement for AppSync owner rules and must
land before any data endpoint.

**LAI-0404 Admin group and Django admin gating.** Depends: 0402. Risk M. Acceptance:
`IsAdmin` from `cognito:groups`; Django admin accessible only to staff users created
out of band; deny-by-default tests (CLAUDE.md section 10).

**LAI-0405 Cognito ownership runbook.** Depends: 0103. Risk H. **APPROVAL: human reviews
before any rehearsal.** Acceptance: a written procedure for moving the user pool out of the
Amplify stack's lifecycle (stack retention policy / import into a standalone stack),
including a rehearsal plan in a throwaway account. Docs only; no AWS action.

### Phase 5 - Read-only frontend API migration

**LAI-0501 Frontend API layer, Amplify-backed.** Depends: 0201. Risk M. Acceptance:
`react/src/api/{client,auth,islands,adventures,quests,inventory,progression,assets}.ts` exist
with hand-owned DTO types; the 16 existing files' call sites go through them; Amplify
implementation behind the interface; all existing tests pass; no behaviour change. This task
needs no Django and can start right after LAI-0201.

**LAI-0502 Profiles read endpoints + client.** Depends: 0403, 0501. Risk M. Acceptance:
`GET /api/v1/children`, `GET /api/v1/children/{id}`, companion profile; client module with
`VITE_BACKEND=django` implementation; contract test compares DTOs against OpenAPI.

**LAI-0503 Catalog read endpoints + client.** Depends: 0304, 0501. Risk L. Acceptance:
islands, adventures (by slug/version), quests, items, learning objectives, asset manifest
served from the DB; the React app can run its content from the API behind the flag; content
parity test: API output equals the exported package.

**LAI-0504 Progress read endpoints + client.** Depends: 0305, 0403. Risk M. Acceptance:
world changes, inventory, quest state, world state, NPC state, story progress, skill
progress/mastery summary, adventure sessions list; every endpoint covered by the tenant
harness.

**LAI-0505 Parent dashboard and admin read endpoints.** Depends: 0504. Risk M. Acceptance:
skill-level summaries (no raw transcripts); admin directory paginated (replaces unbounded
`.list()`); admin endpoints limited to what Amplify rules allow today (no widening).

### Phase 6 - Authoritative progression, inventory, mastery

**LAI-0601 Python adventure engine + answers endpoint.** Depends: 0303, 0305, 0403. Risk H.
Acceptance: pure-Python `validate_step_answer`, `next_step_id`, `next_hint_level` pass every
golden vector; `POST /api/v1/sessions/{id}/answers` replaces `submitAdventureAnswer`
semantics (ownership re-verified, `lastActivityAt` update, same response shape); Vitest and
pytest both green on the same vectors.

**LAI-0602 Profile writes and deletion.** Depends: 0502. Risk H. Acceptance: create/update/
deactivate child, three-profile cap, parent-triggered deletion cascades every child-scoped
table and the photo object; tests for orphan-free deletion (mirrors `deletion.ts`).

**LAI-0603 Mastery writes.** Depends: 0601. Risk M. Acceptance: skill evidence and
`SkillProgress` counters computed server-side with golden vectors; client no longer sends
counters, only events.

**LAI-0604 Rewards and inventory writes.** Depends: 0603. Risk M. Acceptance: server
resolves rewards from the rule table (no randomness, ADR-011), idempotent by rule id;
client cannot grant arbitrary items.

**LAI-0605 Quests, NPC, discovery, world state writes.** Depends: 0604. Risk M. Acceptance:
split into three sub-PRs if needed; each cascades into world-change/reward as today;
checkpoint and discovery ids validated against the catalog (closed vocabulary).

**LAI-0606 Next-learning-activity.** Depends: 0603. Risk M. Acceptance: Python port of the
director ranking (`rank_adventures`, `reachable_adventures`) passing golden vectors; endpoint
returns the same shape as `getNextLearningActivity`.

**LAI-0607 Story artifacts and progress writes.** Depends: 0305. Risk L. Acceptance:
parent-viewable, parent-deletable artifacts; JSON scenes validated.

### Phase 7 - AI service

**LAI-0701 AI domain without Bedrock.** Depends: 0306. Risk M. Acceptance: persona registry
(copied verbatim from `amplify/data/*Persona.ts`, versioned), request validation (adventure
template id, age band, allowed topic, objective, max length per CLAUDE.md section 7), output
schema validation, content/safety checks, authored fallbacks; a fake model client drives
tests; fallback emits a metric.

**LAI-0702 Companion turn via Bedrock.** Depends: 0701, 0403. Risk H. **APPROVAL: dev AWS
credentials and Bedrock access.** Acceptance: `POST .../companion-turns` calls Bedrock via
boto3 with the same model and limits; `AIInteractionAudit` written; invalid output falls
back; live smoke executed once by a human and recorded.

**LAI-0703 Tutor turn and red-team re-point.** Depends: 0702. Risk M. Acceptance: tutor
endpoint; `scripts/ai-red-team.ts` runs against the Django endpoint with the same pass
criteria as the Amplify route.

### Phase 8 - Admin

**LAI-0801 Django admin for catalogs.** Depends: 0304, 0404. Risk L. Acceptance: islands,
adventures, quests, items, assets editable; activation flag respected by the catalog API;
delete restricted to superusers; every change audited; no child data models registered.

**LAI-0802 React admin views on Django.** Depends: 0505, 0404. Risk M. Acceptance: existing
admin pages run on the Django API behind the flag; any widened access (for example
safety-review queue) is listed and **APPROVAL: product owner** before enabling.

### Phase 9 - Realtime (co-op) and storage

**LAI-0901 Atomic co-op slot claim.** Depends: 0305, 0403. Risk M. Acceptance: transactional
claim with row lock; concurrency test shows exactly one winner; response matches current
`claimCoopSlot` result.

**LAI-0902 Co-op update stream.** Depends: 0901. Risk M. Acceptance: SSE or polling endpoint;
`subscribeToCoopSession` keeps its signature; presence set/clear works; reconnect test.

**LAI-0903 Realtime go/no-go record.** Depends: 0902. Risk L. Acceptance: ADR states whether
Channels + Redis is adopted, with measured load; default is "not adopted".

**LAI-0904 Child photo presigned flow.** Depends: 0602. Risk M. **APPROVAL: bucket and CORS
changes.** Acceptance: Django issues short-lived PUT/GET URLs only for the owner's child;
the 256 px JPEG re-encode stays client-side; key-mapping table for existing identity-scoped
objects.

### Phase 10 - AWS infrastructure (may start after Phase 4)

All tasks: **APPROVAL before any `cdk deploy`.** Each task ends at `cdk synth` + review
unless a human approves deployment.

**LAI-1001 CDK app and environment config.** Risk L. Files: `infra/**`. Acceptance: synth
works for `dev` and `prod`; IAM role count of each stack listed in the PR (target tracked in
`IAM_ROLE_AUDIT.md`).
**LAI-1002 Network, RDS PostgreSQL, S3.** Depends: 1001. Risk M. Acceptance: private subnets,
encrypted RDS, deletion protection on, backups on; no public DB.
**LAI-1003 ECR and image build.** Depends: 1001. Risk L.
**LAI-1004 Dev EC2 + Docker deploy.** Depends: 1002, 1003. Risk M. Acceptance: health check
via ALB; migrate step in deploy; rollback script tested.
**LAI-1005 Edge: CloudFront for React + `/api/*`.** Depends: 1004. Risk M.
**LAI-1006 Monitoring parity.** Depends: 1004. Risk M. Acceptance: ALB 4xx/5xx alarms,
`LearningAdventureIsland/AI` and `/Safety` metrics, dashboard, Bedrock budget retained.
**LAI-1007 Production ECS Fargate definitions.** Depends: 1005. Risk M. Acceptance: defined
and synthesized, **not deployed**.

### Phase 11 - Data migration and parallel verification

**LAI-1101 DynamoDB export tool (read-only).** Depends: 0103, 0305. Risk M. **APPROVAL:
read access to production tables.** Acceptance: exports all 17 tables to local encrypted
files; no write to AWS; PII handling documented.
**LAI-1102 Transform and import dry-run.** Depends: 1101. Risk H. Acceptance: loads into a
scratch Postgres; per-table row counts and checksums reported; array and JSON fields mapped;
unmappable rows listed, none dropped silently.
**LAI-1103 Photo object migration plan and dry-run.** Depends: 0904, 1101. Risk M.
**LAI-1104 Shadow comparison.** Depends: 1102, Phase 6. Risk M. Acceptance: for a sample of
children, Amplify and Django return equal DTOs for reads and equal outcomes for replayed
answers.

### Phase 12 - Cutover

**LAI-1201 Cutover and rollback runbook.** Depends: 1104, 1007. Risk H. Acceptance: freeze
window, final export/import, flag flip order, verification checklist, rollback steps.
**LAI-1202 Rehearsal on dev.** Depends: 1201. Risk H. **APPROVAL.**
**LAI-1203 Production cutover.** Depends: 1202, 0405. Risk H. **APPROVAL: product owner,
in person.** Rollback: flip `VITE_BACKEND` back and keep Amplify stack and DynamoDB intact
and read-write-frozen for a defined window (suggest 14 days).

### Phase 13 - Retire Amplify

**LAI-1301 Remove Amplify from the frontend.** Depends: 1203 + stability window. Risk M.
Acceptance: `aws-amplify` data/storage code and `amplify_outputs.json` handling removed;
Cognito configured by Vite env; tests green.
**LAI-1302 Detach Cognito, then delete Amplify stacks.** Depends: 1301, 0405. Risk H.
**APPROVAL: explicit, per resource group.** Never delete the user pool with the stack.
**LAI-1303 Remove `amplify/`, `amplify.yml`, dev dependencies; supersede ADR-010.** Depends:
1302. Risk L. Update `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `README.md`, `CLAUDE.md`.

### Phase 20 - Engine discovery and architecture (Track B, docs only)

All three tasks change documentation only, need neither ADR-019 nor `react/`, and are
independent of Track A. Verification for each: `git status` shows only files under `docs/`
and `tasks/`; `npm test` is not required because no code changes.

**LAI-2001 Phaser experience inventory.** Depends: none. Risk L. Acceptance: verify and
complete `docs/THREEJS_ENGINE_CONVERSION.md` sections 2.2 and 2.3 by reading code, including
every "not verified" item: adventure templates reachable from each world, how NPC
interactions render when `npcs: []`, every reward and achievement a world can grant, and
whether any adventure is reachable only through a Phaser world. Run the app once per world
and record observed behaviour; no invented findings. Rollback: revert the doc. Docs:
conversion doc, `IMPLEMENTATION_STATUS.md`.

**LAI-2002 Existing Three.js engine capability assessment.** Depends: none. Risk L.
Acceptance: confirm section 3 of the conversion doc: whether `AnimationMixer` is used, how
each region file differs in shape, which modules are pure, what a cold load of each 3D route
costs (bundle size from `npm run build`, first-frame time in a desktop browser as a labelled
baseline, not a target-device figure), and how the Castle region data would plug in.
Rollback: revert the doc.

**LAI-2003 Shared engine architecture.** Depends: 2001, 2002. Risk M. **APPROVAL: the owner
reviews before Phase 21 starts** (it fixes package boundaries and adds tooling). Acceptance:
a design section or ADR addendum fixing: the engine's public interface to React (props in,
typed events out); the `WorldDefinition` schema and loader; the scene lifecycle; input and
camera profiles including the Sprouts guided profile; in-engine versus route-based world
transitions; whether AABB collision suffices (R11); how `game/` is built and consumed
(workspace or path alias, where `three` is declared, TypeScript project references) with any
new tooling recorded as a decision; the confirmed performance budgets and target devices;
the confirmed device list and measurement method (the Castle Writing Room versus SC-9
decision is already recorded, conversion doc section 6). Rollback: revert the doc.

### Phase 21 - Engine extraction into `game/` (Track B)

Starts only after LAI-0201 and LAI-2003. Every task here moves or generalises code with no
gameplay change.

**LAI-2101 `game/` package skeleton and boundary guard.** Depends: 0201, 2003. Risk M.
Acceptance: `game/` exists with the build wiring chosen in LAI-2003, one trivial exported
module, and its own test run; a boundary test fails if `game/**` imports `react`,
`react-router`, `aws-amplify`, any `features/*/api`, or a Django client; replaces LAI-0203's
guard. Files: `game/**`, build config, CI step. No directories without a file. Verification:
`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, boundary test red-green
demonstrated. Rollback: revert the commit (no code has moved yet). Docs: `ARCHITECTURE.md`,
conversion doc.

**LAI-2102 Extract the pure engine modules.** Depends: 2101. Risk M. Acceptance: move, with
`git mv` and no behaviour change, `sceneKit`, `firstPersonController`, `pointerControls`,
`worldEngineEvents`, `three/assets/*`, and their tests into `game/`; React views import them
through the package. `features/discovery/checkpoints` is no longer imported by moved code
(data is passed in). All existing tests pass unchanged apart from import paths. Keep this
under about 25 files per commit by splitting into moves. Verification: full gate, plus
`npm run test:e2e` smoke. Rollback: revert the commits.

**LAI-2103 Shared scene lifecycle and world loading.** Depends: 2102. Risk H. Acceptance: one
engine entry point (create, start, pause, dispose) and a validated `WorldDefinition` loader
replacing per-world scene bootstraps; Welcome Harbor and Pirate Builder Bay 3D run on it with
identical behaviour; one parameterised world route can host them. Existing 3D region tests
still pass; new tests cover schema validation and dispose-on-unmount. Verification: full
gate, e2e smoke, manual walk of both worlds. Rollback: the old per-world scene files stay
until the new path is verified; revert the switch commit.

**LAI-2104 Player controls and interaction standardisation.** Depends: 2103. Risk H.
Acceptance: input profiles from the conversion doc section 4.2 implemented behind one
interface: first-person (existing) and guided tap-to-move for Sprouts; one interaction
contract (zone, raycast, HUD-equivalent action) used by every world; reduced-motion respected;
keyboard-only path to every interaction. Tests: controller unit tests, interaction contract
tests, React Testing Library tests for HUD equivalents. Rollback: profile selection is a
flag defaulting to the current behaviour.

**LAI-2105 Performance harness and budgets.** Depends: 2103. Risk M. Acceptance: a
repeatable measurement (draw calls, triangles, load time, memory across enter/exit cycles)
runnable in CI or locally against the 3D worlds; budgets from the conversion doc section 4.4
encoded as checks, with baseline numbers recorded. Honest limit: a CI browser is not the
target device (see LAI-2302). Verification: harness run output pasted into
`IMPLEMENTATION_STATUS.md`.

### Phase 22 - World conversions (Track B)

Common to every task in this phase. **Depends:** 2103 and 2104. **Risk:** M (L for the four
small worlds). **Acceptance, all required:** a genuine navigable 3D world; the world's
interaction table from `worldObjects.ts` reused unchanged (same ids, requirements, actions);
the world's educational objective, progression, and rewards behave as before, evaluated by
the same application code; world-change state visible as geometry or state variants, not a
UI badge; collision on every solid; controls from both profiles; budgets met in the LAI-2105
harness; the Phaser route and tests for that world **still present and passing**; parity
tests from LAI-2301 written first, red then green; visual validation recorded (screenshot
set at fixed positions, reviewed by the owner). **Verification commands:** `npm run
typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`; after LAI-0201
these run under `react/`. **Rollback:** revert the world's commits; the 2D route was never
removed, so nothing is lost. **Docs:** `IMPLEMENTATION_STATUS.md`, conversion doc section 5
row marked verified, `docs/ROADMAP.md` if scope moved. Constraint: no task here changes data
access, Django, or Amplify.

**LAI-2201 Welcome Harbor.** Parity-verify the existing 3D region against the 12-interaction
2D table; make the 3D route the default for the world; keep 2D behind a flag. Needs the
Sprouts profile from 2104.

**LAI-2202 Pirate Builder Bay.** Parity-verify against the 8-interaction 2D table and the
Phase 33 golden path (walk to the broken bridge, repair it, cross it); make 3D the default.

**LAI-2203 Wonderwild Forest.** New region for the 10-interaction table and
`buzz-and-the-waggle-dance`; floor-bloom state variant for `WAGGLE_DANCE_DISCOVERED`; pond
collision.

**LAI-2204 Storykeeper Castle (gate).** Depends additionally: SC-2 to SC-9 from
`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md`. Does not duplicate them; verifies the 11-interaction
2D table maps onto castle rooms, `FIRST_STORY_TOLD` is visible, and SC-11's accessibility
and performance gate has passed.

**LAI-2205 Dragon's Sanctuary.** 3 interactions; unlock `DRAGON_OF_EMBER_MOUNTAIN_COMPLETE`.

**LAI-2206 Fossil Ridge Camp.** 3 interactions; unlock `DINOSAUR_EXPEDITION_COMPLETE`.

**LAI-2207 Castle Writing Room (consolidated into SC-9).** Decision recorded in the
conversion doc section 6: the room is the SC-9 region, not a separate world. This task builds
no second room. It adds the 2D table's unique behaviour to the SC-9 spec (desk and shelf
messages, exit to the castle, unlock `THE_CASTLES_SECRET_DOOR_COMPLETE`) and verifies parity
of the SC-9 region against the 3 interactions. Depends additionally: SC-9, LAI-2204.

**LAI-2208 Bolt's Workshop.** 3 interactions; unlock `ROBOT_RESCUE_COMPLETE`; Bolt NPC.

Recommended order: 2205, 2206, 2208, 2203, then 2201, 2202, and 2204 and 2207 as the castle
track allows. Not a dependency.

### Phase 23 - Verification and Phaser retirement (Track B)

**LAI-2301 Gameplay parity tests.** Depends: 2103. Risk M. Written alongside each world
task, not after. Acceptance: one shared harness; per world, assert every interaction id is
reachable in 3D, unlock gating matches `island/locations.ts`, world-change keys alter the
scene, and the adventure start fires the same action. Verification: `npm test`. Rollback:
tests only.

**LAI-2302 Performance validation on target devices.** Depends: 2105 and the world tasks.
Risk M. **APPROVAL: needs physical devices and the owner's device list.** Acceptance: the
budgets pass on each listed device for every world; results recorded in
`docs/ACCESSIBILITY_AUDIT.md` or `docs/PILOT_READINESS.md`. Cannot be automated away.

**LAI-2303 Sprouts playtest gate.** Depends: 2104 and at least the Harbor and Bay
conversions. Risk H. **APPROVAL: human, with real 3 to 4 year olds, parental consent** (the
ADR-008 requirement, `docs/PILOT_READINESS.md` section 5). Acceptance: playtest run and
recorded. If the guided profile fails, Phaser removal is blocked for Sprouts until a
Three.js profile passes; it does not silently fall back to Phaser.

**LAI-2304 Phaser dependency removal.** Depends: all of 2201 to 2208, 2301, 2302, 2303. Risk
M. **APPROVAL: before merge.** Acceptance: relocate shared CSS first (conversion doc 2.4);
delete `scenes/`, `PhaserGameContainer*`, the eight 2D `*WorldView` files and pages, the 2D
tilemap, zones, and decor modules and tests that LAI-2001 listed as unused; remove `phaser`
from `package.json` and the lockfile; remove the 2D routes and flags. Verification: full
gate; `grep -r "phaser" --include=*.ts --include=*.tsx --include=package.json` finds only
historical docs. Rollback: revert the single removal PR (kept separate from everything
else); the 3D routes are unaffected.

**LAI-2305 Final Three.js-only verification.** Depends: 2304. Risk L. Acceptance: no
`phaser` in dependencies, imports, bundle, or lockfile; a CI guard test fails if it returns;
every route that renders a playable environment is served by the unified engine; a new test
island added as pure data (a `WorldDefinition` plus catalog rows, no new route or renderer)
loads and plays; `ARCHITECTURE.md`, `ROADMAP.md`, `CLAUDE.md`, ADR-007 and ADR-008 notes
final. Verification: full gate plus e2e.

## 4. Manual approval points (summary)

LAI-0101, 0103 (credentials), 0104, 0201 (before merge), 0401, 0405, 0702, 0802, 0904,
every Phase 10 deploy, 1101, 1202, 1203, 1302, and for Track B: 2003, 2302, 2303, 2304.
Claude must stop and ask at each.

## 5. Data migration implications

- Phase 0-10 migrate no data. The sandbox DynamoDB contents are disposable.
- Phase 11 is the only task group touching deployed data; it is read-only against AWS.
- Hard problems: string-set fields to rows; JSON (`payload`, `sharedState`, `scenes`,
  `storyFlags`, `memoryFlags`) validated before import; DynamoDB `id` strings preserved as
  Django UUID/char keys so URLs and audit references survive; S3 key rewrite for photos.
- Data-loss risk is highest for `ChildInventory`, `SkillProgress`, and `WorldChange`
  (idempotency semantics). Dry-run must reproduce each child's derived summaries exactly.

## 6. Rollback strategy

Before cutover: revert the PR and flip the flag; Amplify is untouched. After cutover:
flip back to Amplify within the freeze window; any Django-only writes since cutover must be
exported and replayed (this is why the window must be short, tested, and writes during it
minimized). After Phase 13 starts, rollback is a restore, not a flip; do not begin it until
the stability window passes.

## 7. Deployment implications

- `amplify.yml` changes only with LAI-0201 (appRoot) and is removed in LAI-1303.
- Two backends run side by side in dev during Phases 5-11. Cognito is shared.
- CORS and CloudFront path routing are the first deployment failures to expect (LAI-1005).
- Fixed monthly cost rises (RDS, ALB, compute) versus pay-per-use Amplify. Estimate in
  LAI-1001 and record in `IAM_ROLE_AUDIT.md`/this file.

## 8. First task after this assessment

Exactly one implementation task: **LAI-0201 Move the frontend to `react/`**. It stays first
after ADR-020 for three reasons: both tracks move `src/`, so moving it once first avoids
moving engine files twice; `game/` has to be a sibling of `react/` in the target layout; and
it is a pure rename with the full test suite as its safety net. Its acceptance criteria are
unchanged by ADR-020.

Docs-only Track B tasks (LAI-2001 to 2003) may run before or beside it; they change no code.

Precondition (a user action, not a Claude task): the project owner reads ADR-019, accepts or
amends it, and answers the open questions in the assessment section 16 (tracked as LAI-0101).
LAI-0103 (read-only AWS evidence) is human-initiated and does not block LAI-0201. Claude must
not start LAI-0201 until the owner says ADR-019 is accepted. ADR-020 is already accepted and
does not wait on ADR-019.
