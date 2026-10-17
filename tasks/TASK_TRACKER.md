# Numbered migration tracker

Two tracks. **Track A** (Phases 1 to 13): Django backend migration, ADR-019, **Proposed**.
**Track B** (Phases 20 to 23): Phaser to unified Three.js engine, ADR-020, **Accepted**. Source
of detail: `docs/DJANGO_MIGRATION_ROADMAP.md`; Track B inventory and matrix:
`docs/THREEJS_ENGINE_CONVERSION.md`. Statuses: TODO / IN_PROGRESS / BLOCKED / DONE. All Track A tasks
are TODO until ADR-019 is accepted. Track B docs-only tasks (LAI-2001 to 2003) do not wait for
it; Track B code tasks wait for LAI-0201. A task marked in the roadmap as APPROVAL must stop and ask
before touching AWS.

- [x] **LAI-0001** Phase 0 migration assessment and documentation
- [x] **LAI-0002** Record ADR-020 (Three.js exclusive) and plan Track B (docs only, this change set)

## Phase 1 — Governance and baseline

- [ ] **LAI-0101** Resolve open decisions (depends: assessment)
- [ ] **LAI-0102** Tracker tooling (depends: 0101)
- [ ] **LAI-0103** Capture deployed AWS evidence (read-only) (depends: 0101)
- [ ] **LAI-0104** Relieve IAM pressure independently (depends: 0103)
- [ ] **LAI-0105** Behaviour baseline (depends: none)

## Phase 2 — Repo restructure and Django skeleton

- [ ] **LAI-0201** Move the frontend to `react/` (depends: 0101)
- [ ] **LAI-0202** Python tooling (depends: 0201)
- [ ] **LAI-0203** Engine import boundary guard (depends: 0201)
- [ ] **LAI-0204** Django project skeleton (depends: 0202)
- [ ] **LAI-0205** DRF conventions (depends: 0204)

## Phase 3 — Content export and relational models

- [ ] **LAI-0301** Users domain models (depends: 0204)
- [ ] **LAI-0302** Content export to versioned JSON (depends: 0201)
- [ ] **LAI-0303** Golden vectors (depends: 0302)
- [ ] **LAI-0304** Catalog models and loader (depends: 0302, 0301)
- [ ] **LAI-0305** Progress models (depends: 0301, 0304)
- [ ] **LAI-0306** Audit models (depends: 0301)

## Phase 4 — Cognito integration and authorization

- [ ] **LAI-0401** Auth decisions (depends: 0204)
- [ ] **LAI-0402** Cognito JWT authentication (depends: 0401, 0301)
- [ ] **LAI-0403** Tenant isolation harness (depends: 0402)
- [ ] **LAI-0404** Admin group and Django admin gating (depends: 0402)
- [ ] **LAI-0405** Cognito ownership runbook (depends: 0103)

## Phase 5 — Read-only frontend API migration

- [ ] **LAI-0501** Frontend API layer, Amplify-backed (depends: 0201)
- [ ] **LAI-0502** Profiles read endpoints + client (depends: 0403, 0501)
- [ ] **LAI-0503** Catalog read endpoints + client (depends: 0304, 0501)
- [ ] **LAI-0504** Progress read endpoints + client (depends: 0305, 0403)
- [ ] **LAI-0505** Parent dashboard and admin read endpoints (depends: 0504)

## Phase 6 — Authoritative progression, inventory, mastery

- [ ] **LAI-0601** Python adventure engine + answers endpoint (depends: 0303, 0305, 0403)
- [ ] **LAI-0602** Profile writes and deletion (depends: 0502)
- [ ] **LAI-0603** Mastery writes (depends: 0601)
- [ ] **LAI-0604** Rewards and inventory writes (depends: 0603)
- [ ] **LAI-0605** Quests, NPC, discovery, world state writes (depends: 0604)
- [ ] **LAI-0606** Next-learning-activity (depends: 0603)
- [ ] **LAI-0607** Story artifacts and progress writes (depends: 0305)

## Phase 7 — AI service

- [ ] **LAI-0701** AI domain without Bedrock (depends: 0306)
- [ ] **LAI-0702** Companion turn via Bedrock (depends: 0701, 0403)
- [ ] **LAI-0703** Tutor turn and red-team re-point (depends: 0702)

## Phase 8 — Admin

- [ ] **LAI-0801** Django admin for catalogs (depends: 0304, 0404)
- [ ] **LAI-0802** React admin views on Django (depends: 0505, 0404)

## Phase 9 — Realtime (co-op) and storage

- [ ] **LAI-0901** Atomic co-op slot claim (depends: 0305, 0403)
- [ ] **LAI-0902** Co-op update stream (depends: 0901)
- [ ] **LAI-0903** Realtime go/no-go record (depends: 0902)
- [ ] **LAI-0904** Child photo presigned flow (depends: 0602)

## Phase 10 — AWS infrastructure (may start after Phase 4)

- [ ] **LAI-1001** CDK app and environment config (depends: see roadmap)
- [ ] **LAI-1002** Network, RDS PostgreSQL, S3 (depends: 1001)
- [ ] **LAI-1003** ECR and image build (depends: 1001)
- [ ] **LAI-1004** Dev EC2 + Docker deploy (depends: 1002, 1003)
- [ ] **LAI-1005** Edge: CloudFront for React and `/api/*` (depends: 1004)
- [ ] **LAI-1006** Monitoring parity (depends: 1004)
- [ ] **LAI-1007** Production ECS Fargate definitions (depends: 1005)

## Phase 11 — Data migration and parallel verification

- [ ] **LAI-1101** DynamoDB export tool (read-only) (depends: 0103, 0305)
- [ ] **LAI-1102** Transform and import dry-run (depends: 1101)
- [ ] **LAI-1103** Photo object migration plan and dry-run (depends: 0904, 1101)
- [ ] **LAI-1104** Shadow comparison (depends: 1102, Phase 6)

## Phase 12 — Cutover

- [ ] **LAI-1201** Cutover and rollback runbook (depends: 1104, 1007)
- [ ] **LAI-1202** Rehearsal on dev (depends: 1201)
- [ ] **LAI-1203** Production cutover (depends: 1202, 0405)

## Phase 13 — Retire Amplify

- [ ] **LAI-1301** Remove Amplify from the frontend (depends: 1203 + stability window)
- [ ] **LAI-1302** Detach Cognito, then delete Amplify stacks (depends: 1301, 0405)
- [ ] **LAI-1303** Remove `amplify/`, `amplify.yml`, dev dependencies; supersede ADR-010 (depends: see roadmap)

# Track B: unified Three.js engine (ADR-020, Accepted)

## Phase 20 — Engine discovery and architecture (docs only)

- [ ] **LAI-2001** Phaser experience inventory (verify and complete the 8-world inventory) (depends: none)
- [ ] **LAI-2002** Existing Three.js capability assessment (depends: none)
- [ ] **LAI-2003** Shared engine architecture (APPROVAL) (depends: 2001, 2002)

## Phase 21 — Engine extraction into `game/`

- [ ] **LAI-2101** `game/` package skeleton and boundary guard (depends: 0201, 2003)
- [ ] **LAI-2102** Extract pure engine modules (depends: 2101)
- [ ] **LAI-2103** Shared scene lifecycle and world loading (depends: 2102)
- [ ] **LAI-2104** Player controls and interaction standardisation (depends: 2103)
- [ ] **LAI-2105** Performance harness and budgets (depends: 2103)

## Phase 22 — World conversions (one task per Phaser world)

- [ ] **LAI-2201** Welcome Harbor (depends: 2103, 2104)
- [ ] **LAI-2202** Pirate Builder Bay (depends: 2103, 2104)
- [ ] **LAI-2203** Wonderwild Forest (depends: 2103, 2104)
- [ ] **LAI-2204** Storykeeper Castle gate (depends: 2103, 2104, SC-2 to SC-9)
- [ ] **LAI-2205** Dragon's Sanctuary (depends: 2103, 2104)
- [ ] **LAI-2206** Fossil Ridge Camp (depends: 2103, 2104)
- [ ] **LAI-2207** Castle Writing Room (depends: 2103, 2104, SC-9 decision)
- [ ] **LAI-2208** Bolt's Workshop (depends: 2103, 2104)

## Phase 23 — Verification and Phaser retirement

- [ ] **LAI-2301** Gameplay parity tests (written with each world task) (depends: 2103)
- [ ] **LAI-2302** Performance validation on target devices (APPROVAL) (depends: 2105, world tasks)
- [ ] **LAI-2303** Sprouts playtest gate (APPROVAL, human) (depends: 2104, 2201, 2202)
- [ ] **LAI-2304** Phaser dependency removal (APPROVAL) (depends: 2201 to 2208, 2301, 2302, 2303)
- [ ] **LAI-2305** Final Three.js-only verification (depends: 2304)
