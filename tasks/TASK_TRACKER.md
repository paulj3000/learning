# Numbered migration tracker

Two tracks. **Track A** (Phases 1 to 13): Django backend migration, ADR-019, **Proposed**.
**Track B** (Phases 20 to 23): Phaser to unified Three.js engine, ADR-020, **Accepted**. Source
of detail: `docs/DJANGO_MIGRATION_ROADMAP.md`; Track B inventory and matrix:
`docs/THREEJS_ENGINE_CONVERSION.md`. Statuses: TODO / IN_PROGRESS / BLOCKED / DONE. All Track A tasks
are TODO until ADR-019 is accepted. Track B docs-only tasks (LAI-2001 to 2003) do not wait for
it; Track B code tasks wait for LAI-0201. A task marked in the roadmap as APPROVAL must stop and ask
before touching AWS.

- [x] **LAI-0001** Phase 0 migration assessment and documentation
- [x] **POST-MERGE-01** Reconcile merged content export and duplicate ADR ids (not a roadmap task). DONE locally: export schema v2, ADR-027 to ADR-030 renumbered from the incoming line; see `docs/IMPLEMENTATION_STATUS.md`. Not pushed.
- [x] **POST-MERGE-02** Integrate `origin/main` (eab0817) into the Django migration branch, locally. DONE: ADR-023 to ADR-032 reconciled, ported to the `react/` layout, all checks green; see `docs/IMPLEMENTATION_STATUS.md`. Not pushed. Starts no roadmap task.
- [x] **LAI-0002** Record ADR-020 (Three.js exclusive) and plan Track B (docs only, this change set)

## Phase 1 — Governance and baseline

- [x] **LAI-0101** Resolve open decisions (depends: assessment). DONE WITH OPEN GATES: ADR-019 Accepted in part; gates G1 to G7 stay open (see ADR-019). Assessment Q1 to Q5 are recorded as open, not answered
- [ ] **LAI-0102** Tracker tooling (depends: 0101)
- [ ] **LAI-0103** Capture deployed AWS evidence (read-only) (depends: 0101)
- [ ] **LAI-0104** Relieve IAM pressure independently (depends: 0103)
- [ ] **LAI-0105** Behaviour baseline (depends: none)

## Phase 2 — Repo restructure and Django skeleton

- [x] **LAI-0201** Move the frontend to `react/` (depends: 0101). DONE: merged locally as d27f554 (not pushed) and re-verified on the merged tree. The Amplify Hosting build with the new layout is still unverified until a real deploy
- [x] **LAI-0202** Python tooling (depends: 0201). Done; its deferred CI criterion was delivered by LAI-0206
- [x] **LAI-0203** Engine import boundary guard (depends: 0201). DONE locally: `react/src/test/engineBoundary.test.ts`; six React edges recorded for LAI-2102; lint and formatting deferred to merge verification
- [x] **LAI-0204** Django project skeleton (depends: 0202). DONE locally: Django 6.1.2, DRF 3.18.3, psycopg 3.3.6 (ADR-021); health endpoint; verified against PostgreSQL 16
- [x] **LAI-0205** DRF conventions (depends: 0204). DONE locally: error contract, exception handler, request IDs, access log, deny by default. Two roadmap criteria deliberately not done here: cursor pagination (moves to the first list endpoint, LAI-0502) and OpenAPI generation (LAI-0207)
- [x] **LAI-0208** Privacy review of server-side logging (application layer) (depends: 0205). DONE locally (ADR-025). Deployed logging remains open as gate G10 (LAI-0210)
- [ ] **LAI-0210** Deployed logging verification: server and proxy access logs, load balancer, CDN, CloudWatch, PostgreSQL server logs, monitoring (gate G10). Required before production; needs the infrastructure to exist (depends: 1004)
- [ ] **LAI-0209** Revocation-aware verification and recent-authentication check for sensitive actions (ADR-024 A3). Specify, implement, test. Blocks account/child deletion (0602), consent changes (0308), and privileged admin mutations (0404) (depends: 0402)
- [ ] **LAI-0207** Committed OpenAPI schema generation (split from LAI-0205; needs a recorded dependency decision for PyYAML and uritemplate) (depends: 0205)
- [x] **LAI-0206** Python CI job (carries LAI-0202's deferred CI criterion). DONE locally; REMOTE VERIFICATION PENDING until the first GitHub-hosted run succeeds (depends: 0204)

## Phase 3 — Content export and relational models

- [x] **LAI-0301** Users domain models (depends: 0204). DONE locally: `ParentAccount` (user model) and `ChildProfile` (ADR-022). CompanionProfile and ParentConsent split out to 0307 and 0308
- [ ] **LAI-0307** CompanionProfile model (split from 0301) (depends: 0301)
- [ ] **LAI-0308** ParentConsent privacy design, then model (split from 0301; never implemented in Amplify). REQUIRED GATE G9 before the migrated platform handles live children's data (depends: 0301)
- [x] **LAI-0302** Content export to versioned JSON (depends: 0201). DONE locally: 13 files under `content/`, schema v1, 38 tests. Spatial data and logic are not exported (see DATA_MODEL.md)
- [x] **LAI-0303** Golden vectors (depends: 0302). DONE locally: `tests/golden/*.json` (6 suites), Vitest stale check, pytest format check; no Python rules yet (Phase 6)
- [x] **LAI-0304** Catalog models and loader (depends: 0302, 0301). DONE locally: `lai/apps/catalog` (World, Location, Adventure, AdventureStep, Quest, ContentAsset, LocationAsset, ContentRelease), `manage.py load_content`, export schema 3 `locationAssets`; catalog admin built but not mounted (LAI-0404). Item and learning-objective models not built
- [ ] **LAI-0305** Progress models (depends: 0301, 0304)
- [ ] **LAI-0306** Audit models (depends: 0301)

## Phase 4 — Cognito integration and authorization

- [x] **LAI-0401** Auth decisions (depends: 0204). DONE as decisions (ADR-024, docs only). Open gates A1 to A6 are not approved
- [x] **LAI-0402** Cognito JWT authentication (depends: 0401, 0301). DONE locally 2026-10-18: PyJWT verifier, bounded JWKS cache, `POST /api/v1/me/` onboarding. Verified only against locally generated keys, never a real Cognito token (gate A6)
- [x] **LAI-0403** Tenant isolation harness (depends: 0402). DONE locally: `ChildScopedMixin`/`ChildScopedAPIView`, shared fixtures, route checker, authorization matrix. Nested-record behaviour is proven against a stand-in queryset only; real nested-model tests are required in each model's own task
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
- [ ] **LAI-0805** Spatial layout administration in Django Admin (depends: 0801, 0304, 2103, and a spatial-content ADR first)

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
- [x] **LAI-2106** Asset loader reliability: skeleton-safe cloning, failed-load eviction, load events (depends: none; in place, before 2102). DONE locally: jsdom-verified; no browser or WebGL run

## Phase 22 — World conversions (one task per Phaser world)

- [ ] **LAI-2201** Welcome Harbor (depends: 2103, 2104)
- [ ] **LAI-2202** Pirate Builder Bay (depends: 2103, 2104)
- [ ] **LAI-2203** Wonderwild Forest (depends: 2103, 2104)
- [ ] **LAI-2204** Storykeeper Castle gate (depends: 2103, 2104, SC-2 to SC-9)
- [ ] **LAI-2205** Dragon's Sanctuary (depends: 2103, 2104)
- [ ] **LAI-2206** Fossil Ridge Camp (depends: 2103, 2104)
- [ ] **LAI-2207** Castle Writing Room, consolidated into SC-9 (depends: 2204, SC-9)
- [ ] **LAI-2208** Bolt's Workshop (depends: 2103, 2104)

## Phase 23 — Verification and Phaser retirement

- [ ] **LAI-2301** Gameplay parity tests (written with each world task) (depends: 2103)
- [ ] **LAI-2302** Performance validation on target devices (APPROVAL) (depends: 2105, world tasks)
- [ ] **LAI-2303** Sprouts playtest gate (APPROVAL, human) (depends: 2104, 2201, 2202)
- [ ] **LAI-2304** Phaser dependency removal (APPROVAL) (depends: 2201 to 2208, 2301, 2302, 2303)
- [ ] **LAI-2305** Final Three.js-only verification (depends: 2304)
