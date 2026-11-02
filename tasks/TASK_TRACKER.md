# Numbered migration tracker

Two tracks. **Track A** (Phases 1 to 13): Django backend migration, ADR-019, **Proposed**.
**Track B** (Phases 20 to 23): Phaser to unified Three.js engine, ADR-020, **Accepted**. Source
of detail: `docs/DJANGO_MIGRATION_ROADMAP.md`; Track B inventory and matrix:
`docs/THREEJS_ENGINE_CONVERSION.md`. Statuses: TODO / IN_PROGRESS / BLOCKED / DONE / CANCELED (kept as history, struck through). All Track A tasks
are TODO until ADR-019 is accepted. Track B docs-only tasks (LAI-2001 to 2003) do not wait for
it; Track B code tasks wait for LAI-0201. A task marked in the roadmap as APPROVAL must stop and ask
before touching AWS.

- [x] **LAI-0001** Phase 0 migration assessment and documentation
- [x] **POST-MERGE-01** Reconcile merged content export and duplicate ADR ids (not a roadmap task). DONE locally: export schema v2, ADR-027 to ADR-030 renumbered from the incoming line; see `docs/IMPLEMENTATION_STATUS.md`. Not pushed.
- [x] **POST-MERGE-02** Integrate `origin/main` (eab0817) into the Django migration branch, locally. DONE: ADR-023 to ADR-032 reconciled, ported to the `react/` layout, all checks green; see `docs/IMPLEMENTATION_STATUS.md`. Not pushed. Starts no roadmap task.
- [x] **POST-MERGE-03** Reconcile the Storykeeper Castle and Treasure Rush Django backbones on `integration/post-merge-03` (not a roadmap task). DONE locally: one app set on the canonical LAI-0304/0305/0601 models, Treasure Rush adapted onto it, region layouts seed-authored until LAI-0805 (ADR-033); see `docs/IMPLEMENTATION_STATUS.md`. Not pushed or merged
- [x] **POST-MERGE-04** Merge verification of `integration/post-merge-03` (not a roadmap task). DONE locally: all merge-time gates pass; browser gameplay not verifiable here (needs a real Cognito sign-in); see `docs/IMPLEMENTATION_STATUS.md`. Not merged or pushed
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
- [ ] **LAI-0209** Revocation-aware verification and recent-authentication check for sensitive actions (ADR-024 A3). Specify, implement, test. Blocks account/child deletion (0602), consent changes (0308), and privileged admin mutations (0404; the asset administrator API, AM-14) (depends: 0402)
- [ ] **LAI-0207** Committed OpenAPI schema generation (split from LAI-0205; needs a recorded dependency decision for PyYAML and uritemplate) (depends: 0205)
- [x] **LAI-0206** Python CI job (carries LAI-0202's deferred CI criterion). DONE locally; REMOTE VERIFICATION PENDING until the first GitHub-hosted run succeeds (depends: 0204)

## Phase 3 — Content export and relational models

- [x] **LAI-0301** Users domain models (depends: 0204). DONE locally: `ParentAccount` (user model) and `ChildProfile` (ADR-022). CompanionProfile and ParentConsent split out to 0307 and 0308
- [ ] **LAI-0307** CompanionProfile model (split from 0301) (depends: 0301)
- [ ] **LAI-0308** ParentConsent privacy design, then model (split from 0301; never implemented in Amplify). REQUIRED GATE G9 before the migrated platform handles live children's data (depends: 0301)
- [x] **LAI-0302** Content export to versioned JSON (depends: 0201). DONE locally: 13 files under `content/`, schema v1, 38 tests. Spatial data and logic are not exported (see DATA_MODEL.md)
- [x] **LAI-0303** Golden vectors (depends: 0302). DONE locally: `tests/golden/*.json` (6 suites), Vitest stale check, pytest format check; no Python rules yet (Phase 6)
- [x] **LAI-0304** Catalog models and loader (depends: 0302, 0301). DONE locally: `lai/apps/catalog` (World, Location, Adventure, AdventureStep, Quest, ContentAsset, LocationAsset, ContentRelease), `manage.py load_content`, export schema 3 `locationAssets`; catalog admin built but not mounted (LAI-0404). Item and learning-objective models not built
- [x] **LAI-0305** Progress models (depends: 0301, 0304). DONE locally: apps `game_sessions`, `education`, `progression`, `inventory`, `quests` (14 models, 5 migrations), persistence services for sessions, quests and world changes; no endpoints
- [x] **LAI-0306** Audit models (depends: 0301). DONE on `features/ai` 2026-11-01 (unmerged): `apps.ai` `AIInteractionAudit` and `SafetyEvent`, the Amplify fields plus provider, context source, Guardrail, failure category, tokens and request id; no free-text columns (docs/AI_SERVICE.md section 7)
- [ ] **LAI-0309** Remaining catalog models: items, reward rules, learning objectives, stories, NPCs (depends: 0304). PARTIAL via POST-MERGE-03: items, collectible sets, reward rules, learning objectives and NPCs are catalog rows (inventory now references items and rules by foreign key). Remaining: stories, and validated references from `SkillEvidence`/`SkillProgress` objective codes, `StoryProgress.story_slug` and `NpcRelationship.npc_id`

## Phase 4 — Cognito integration and authorization

- [x] **LAI-0401** Auth decisions (depends: 0204). DONE as decisions (ADR-024, docs only). Open gates A1 to A6 are not approved
- [x] **LAI-0402** Cognito JWT authentication (depends: 0401, 0301). DONE locally 2026-10-18: PyJWT verifier, bounded JWKS cache, `POST /api/v1/me/` onboarding. Verified only against locally generated keys, never a real Cognito token (gate A6)
- [x] **LAI-0403** Tenant isolation harness (depends: 0402). DONE locally: `ChildScopedMixin`/`ChildScopedAPIView`, shared fixtures, route checker, authorization matrix. Nested-record behaviour is proven against a stand-in queryset only; real nested-model tests are required in each model's own task
- [ ] **LAI-0404** Admin group and Django admin gating (depends: 0402)
- [ ] **LAI-0405** Cognito ownership runbook (depends: 0103)
- [x] ~~**LAI-AUTH-DUAL**~~ **CANCELED / REVERTED 2026-10-31 by LAI-AUTH-ROLLBACK (ADR-040 supersedes ADR-038); the record below is history.** Environment-selectable API authentication (depends: 0402, 0403, 0404 Django Admin part; ADR-038). DONE 2026-10-30; merged to `main` 2026-10-31 (`beebb6a`) after the full merge gate (Playwright acceptance not run): `AUTH_PROVIDER` (`cognito` in AWS, `django` for local development), local Django sign-in, one `ParentAccount` model, React auth adapters. Follow-ups: React child management on Django (LAI-CHILD-001), Android local-sign-in flavor (not built, no Kotlin code in the repository)
- [x] **LAI-CHILD-001** Parent and child profile management on Django (depends: LAI-AUTH-DUAL, 0403; ADR-039). DONE 2026-10-31; merged to `main` 2026-10-31 after the full merge gate and a Django-mode browser acceptance (Cognito browser sign-in not verified): `PATCH /api/v1/me/`; every React build with the Django API reads and writes profiles through Django under either sign-in; archival via `active`; read-only audited Django Admin view; `import_amplify_profiles` (dry run, idempotent). Unit-tested only. Open: hard deletion (LAI-0209 / LAI-0602), photos (LAI-1103), the Amplify branch for builds without Django until cutover (LAI-1301), Amplify-backed adventures and Lambdas that read DynamoDB children (Phase 6), production import (Phase 11/12, approval)
- [x] **LAI-AUTH-ROLLBACK** Remove dual authentication; Cognito is the sole application sign-in (ADR-040, supersedes ADR-038). DONE 2026-10-31: merged to `main` on the owner's direction with the real-Cognito browser acceptance still OPEN (not passed, not waived as passed; ADR-024 gate A6). Before the merge: every local merge gate passes (Ruff, Ruff format, Django and migration checks, pytest 1097, ADR, typecheck, oxlint, Prettier, Vitest 3158, build, Docker image, compose, Playwright smoke 7); the real-Cognito browser acceptance (sign-in, `me/`, children, Treasure Rush, sign-out) is blocked on a confirmed nonproduction pool and test parent credentials. Scope: no `AUTH_PROVIDER` / `VITE_AUTH_PROVIDER`, no `/api/v1/auth/{csrf,login,logout}/`, no `create_local_parent`, no local sign-in form or session credential; Django Admin staff sign-in unchanged; LAI-CHILD-001's Django profile authority, `PATCH`/`DELETE` client support and Django-backed play settings kept. LAI-CHILD-001 no longer depends on LAI-AUTH-DUAL.

## Phase 5 — Read-only frontend API migration

- [ ] **LAI-0501** Frontend API layer, Amplify-backed (depends: 0201)
- [ ] **LAI-0502** Profiles read endpoints + client (depends: 0403, 0501)
- [ ] **LAI-0503** Catalog read endpoints + client (depends: 0304, 0501)
- [ ] **LAI-0504** Progress read endpoints + client (depends: 0305, 0403)
- [ ] **LAI-0505** Parent dashboard and admin read endpoints (depends: 0504)

## Phase 6 — Authoritative progression, inventory, mastery

- [x] **LAI-0601** Python adventure engine + answers endpoint (depends: 0303, 0305, 0403). DONE locally: `apps/adventures/engine.py` (golden parity), answers and hints endpoints, G6 verified for them; React still calls the Amplify Lambda until the frontend API layer (LAI-0501) switches it
- [ ] **LAI-0602** Profile writes and deletion (depends: 0502). 2026-10-31 on `feature/lai-0905-photo-clients`: child deletion service `lai/apps/users/deletion.py` (photo objects first via `delete_all_child_photos`, child kept on storage failure, idempotent retry), pytest only. 2026-11-01 safety review: partial storage failure, storage-ok-then-database-failure and concurrent-purge cases tested; a spurious refusal when a concurrent purge removed a row first was fixed. Route still blocked until LAI-0209
- [ ] **LAI-0603** Mastery writes (depends: 0601)
- [ ] **LAI-0604** Rewards and inventory writes (depends: 0603)
- [ ] **LAI-0605** Quests, NPC, discovery, world state writes (depends: 0604)
- [ ] **LAI-0606** Next-learning-activity (depends: 0603)
- [ ] **LAI-0607** Story artifacts and progress writes (depends: 0305)

## Phase 7 — AI service

Status ladder (docs/AI_SERVICE.md section 10): 1 implemented, 2 verified with the fake provider,
3 live Bedrock verified, 4 React cutover, 5 Amplify AI retired. On `features/ai` (2026-11-01,
unmerged, not pushed): levels 1 and 2 reached; 3 to 5 not started.

- [x] **LAI-0701** AI domain without Bedrock (depends: 0306). DONE (implemented, fake-verified): personas verbatim and versioned, contracts and validators with `ai-safety` golden-vector parity, authored fallbacks, `FakeModelClient`, settings. Merge verification deferred
- [ ] **LAI-0702** Companion turn via Bedrock (depends: 0701, 0403). IMPLEMENTED and fake-verified: `POST .../ai/companion-turns/`, `BedrockModelClient` (Converse, structured text output, Guardrail), server audit. **Open: the APPROVAL live smoke** (LAI-0705); not accepted until a human runs it
- [ ] **LAI-0703** Tutor turn and red-team re-point (depends: 0702). IMPLEMENTED and fake-verified: `POST .../ai/tutor-turns/`, server-built tutor context; `scripts/ai-red-team.ts --target django` (Amplify target unchanged). **Open: a live red-team run against Django** (LAI-0705)
- [ ] **LAI-0704** Bedrock Guardrails and child AI safety policy (depends: 0702, 0703). IMPLEMENTED and fake-verified: `LaiAiGuardrail-<env>` CDK stack (synthesized, not deployed) and `lai-django-ai-<env>` policy, input screening, Django output policy, fail-closed settings, server safety events (ADR-044). **Open: Guardrail deployment and live block verification** (LAI-0705)
- [ ] **LAI-0705** Live Bedrock and Guardrail verification in dev (depends: 0702, 0703, 0704). **APPROVAL: AWS credentials, Bedrock cost, IAM change, deploy** (docs/AI_SERVICE.md section 9). IMPLEMENTED (level 3): `manage.py ai_live_check` (audit-row scoring, bounded warm-up, Guardrail probe), IAM policy checked against the AWS documented pattern, Gate A plan and cost bound written. **BLOCKED for live acceptance:** AWS CLI access denied in this session, Gate A approval, model access, test identities
- [ ] **LAI-0706** React cutover of companion and tutor turns to Django behind `VITE_BACKEND` (depends: 0705, 0501). IMPLEMENTED and Vitest-verified (level 4): `react/src/api/ai/djangoAi.ts`, Django paths in `companion/api.ts` and `tutor/api.ts` (no browser audit writes), `templateId` from every caller, parent dashboard safety events and history clearing on Django (`GET .../ai/safety-events/`, `DELETE .../ai/history/`). Amplify path unchanged for builds without the Django API. **Open:** Django-enabled dev deploy and browser acceptance (Gate B)
- [ ] **LAI-0707** Safety review views, review workflow and retention for `SafetyEvent` / `AIInteractionAudit` (depends: 0306, 0404; retention with 0308). IMPLEMENTED and tested (level 4): permission-gated audited Django Admin (review status the only editable field), `manage.py ai_retention` (dry run default, refuses without a period, keeps open events), indexes. **Open:** an approved retention period (LAI-0308 / G9) before any `--apply` in a deployed environment
- [ ] **LAI-0708** AI operations: shared rate-limit store, `ai.turn` metric filters and alarms, Bedrock budget kept (depends: 0705). IMPLEMENTED and tested (level 4): PostgreSQL counters (child minute/day, family day, session day, concurrency, global ceiling; 12-thread race test), runtime kill switch, bounded retries, request-size cap, configured-price cost estimate, 10 metric filters and 7 alarms in `LaiAiGuardrail-<env>` (synthesized). **Open:** deploy and live alarm check; the Amplify $50 budget may not see Marketplace-billed Claude spend (verify)
- [ ] **LAI-0709** Server-built context for NPC and story turns and server mastery status; retire `CLIENT_AUTHORED` (depends: 0603, 0605, 0607). PARTIAL (level 3): NPC narration is server-owned (`DJANGO_CATALOG`); `LAI_AI_ALLOW_CLIENT_AUTHORED` switch added. **BLOCKED:** React adventures still run on Amplify sessions; no Django story catalog (LAI-0309); server mastery (LAI-0603). `CLIENT_AUTHORED` must stay on
- [ ] **LAI-0710** Retire Amplify `generateCompanionTurn` / `generateTutorTurn` and their IAM grants (depends: 0706). **APPROVAL** (Phase 13). Dependency audit and rollback plan written (docs/AI_SERVICE.md section 11); **nothing removed**: needs 0705, 0706 and 0709 acceptance and explicit retirement approval

## Phase 8 — Admin

- [ ] **LAI-0801** Django admin for catalogs (depends: 0304, 0404)
- [ ] **LAI-0802** React admin views on Django (depends: 0505, 0404)
- [ ] **LAI-0805** Spatial layout administration in Django Admin (depends: 0801, 0304, 2103, and a spatial-content ADR first)
- [x] **LAI-0806** Island / Place / 3D Area hierarchy and Adventure launch points (ADR-041; depends: 0304, 0601, POST-MERGE-03). DONE: labels, one 3D Area per Place, `AdventureLaunchPoint` with Django Admin, launch API, islands API, React launch and return flow; all suites green at merge (`docs/IMPLEMENTATION_STATUS.md`). Open follow-up: a Django-backed step-adventure client (the runner is still Amplify-backed in Django builds)
- [ ] **LAI-0807** Ungated child exit from Islands, Places, 3D Areas and Adventures (owner request 2026-10-31). Implemented on `feature/lai-ungated-island-exit`: a "Leave island" link in `IslandLayout` goes straight to the sailing dock with no arithmetic question; the separate adult exit to the parent space keeps `ParentGate` (owner decision). Targeted unit tests and typecheck pass; merge gates (full suites, lint, Prettier, Playwright) not yet run

## Phase 9 — Realtime (co-op) and storage

- [ ] **LAI-0901** Atomic co-op slot claim (depends: 0305, 0403)
- [ ] **LAI-0902** Co-op update stream (depends: 0901)
- [ ] **LAI-0903** Realtime go/no-go record (depends: 0902)
- [ ] **LAI-0904** Child photo storage and API in a separate private bucket (ADR-042) (depends: 0602; APPROVAL: deploying the bucket). Repository side done 2026-10-31 on `feature/lai-0904-child-photo-storage`: `LaiChildPhotos-<env>` CDK stack and EC2/SSM wiring (synthesized, not deployed); `GET/PUT/DELETE /children/<id>/photo/` and `photo/content/`; `ChildPhoto` model; JPEG validation and metadata stripping; `child_photo_storage_audit`. Unit-tested only; synth re-verified 2026-10-31. Not deployed: on 2026-11-01 the owner's `list-stacks` in account 008331939914 / us-west-1 showed no `Lai*` stack at all, so neither this stack nor the Django EC2 platform it plugs into exists yet; no change set prepared. Open until deployed and verified on dev (`docs/platform/CHILD_PHOTO_STORAGE.md`)
- [ ] **LAI-0905** React and Android clients on the Django photo API (depends: 0904). Started 2026-10-31 on `feature/lai-0905-photo-clients`: React Django builds upload, show and remove photos through `children/<id>/photo/` (`djangoPhotos.ts`, `photoWrite: 'after-save'`); Android contract in `docs/android/ANDROID_API_CONTRACT.md`. Implementation done and committed; Vitest only. Not deployed or accepted: needs the dev bucket (LAI-0904 approval) and a Cognito test sign-in (gate A6)

## Phase 10 — AWS infrastructure (may start after Phase 4)

- [ ] **LAI-1001** CDK app and environment config (depends: see roadmap)
- [ ] **LAI-1002** Network, RDS PostgreSQL, S3 (depends: 1001). Asset bucket and, since 2026-10-31, the separate child photo bucket (ADR-042) are defined and synthesized, not deployed
- [ ] **LAI-1003** ECR and image build (depends: 1001)
- [ ] **LAI-1004** Dev EC2 + Docker deploy (depends: 1002, 1003)
- [ ] **LAI-1005** Edge: CloudFront for React and `/api/*` (depends: 1004)
- [ ] **LAI-1006** Monitoring parity (depends: 1004)
- [ ] **LAI-1007** Production ECS Fargate definitions (depends: 1005)

## Phase 11 — Data migration and parallel verification

- [ ] **LAI-1101** DynamoDB export tool (read-only) (depends: 0103, 0305)
- [ ] **LAI-1102** Transform and import dry-run (depends: 1101)
- [ ] **LAI-1103** Photo object migration plan and dry-run into the private child photo bucket (depends: 0904, 1101; APPROVAL: bucket read, copy). Specified 2026-10-31 (`docs/platform/CHILD_PHOTO_STORAGE.md` section 10); utility not built because its inputs do not exist yet. Not started (2026-10-31)
  - [ ] **LAI-1103a** Legacy photo inventory, read-only (depends: 1101, G1)
  - [ ] **LAI-1103b** Photo migration planner and dry run (depends: 1103a, profile import applied)
  - [ ] **LAI-1103c** Photo copy (APPROVAL) (depends: 1103b, 0904 deployed, G9)
  - [ ] **LAI-1103d** Photo migration verification (depends: 1103c)
- [ ] **LAI-1104** Shadow comparison (depends: 1102, Phase 6)

## Phase 12 — Cutover

- [ ] **LAI-1201** Cutover and rollback runbook (depends: 1104, 1007)
- [ ] **LAI-1202** Rehearsal on dev (depends: 1201)
- [ ] **LAI-1203** Production cutover (depends: 1202, 0405)
- [ ] **LAI-1204** Retire legacy Amplify S3 storage (APPROVAL: explicit, final) (depends: asset import verified, 1103d, 1203, clients on Django storage (0905, 1301), no runtime references to the bucket). Plan only; never deletes implicitly

## Phase 13 — Retire Amplify

- [ ] **LAI-1301** Remove Amplify from the frontend (depends: 1203 + stability window; storage parts also 0904 deployed, 1103d photos migrated, AM-15 and AM-16 assets on Django, 1002). Acceptance (ADR-042 amendment), after production cutover and verified migration:
  - No Amplify Storage uploads, deletes or download-link generation remain (`features/child-profile/avatarPhoto.ts`, `features/child-profile/deletion.ts`, `features/assets/modelUpload.ts`, `features/assets/assetService.ts`), and no `aws-amplify/storage` import remains anywhere in `react/`.
  - The Amplify branches of the profile store and asset pages (`amplifyProfiles.ts`, `routes/AdminModelAssets.tsx`, `routes/AdminNewModelAsset.tsx`, `features/admin/catalogApi.ts` model picker) are gone.
  - The browser-side storage grants are removed: `amplify/storage/resource.ts` access rules for `child-photos/{entity_id}/*` and `assets/*`, and the Cognito identity pool role permissions they generate; obsolete storage configuration in `amplify_outputs.json` and Vite env is gone.
  - React and Android are checked to hold no reference to the legacy bucket; assets and photos are confirmed migrated. The legacy bucket itself is LAI-1204 (approval) and is never changed here.
- [ ] **LAI-1302** Detach Cognito, then delete Amplify stacks (depends: 1301, 0405, 1204: Amplify storage auto-deletes its objects with the stack)
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

# LAI-2200 Shared Django Asset Manager (`docs/ASSET_MANAGER.md`, ADR-035)

Platform workstream. AM-1 to AM-10 (the foundation and admin preview) were merged into `main` on
2026-10-25 after merge verification (`docs/ASSET_MANAGER.md` section 18). It is not deployed as an
asset service until AM-11 and LAI-1002 provide the infrastructure. Subtasks use their own ids
(AM-n) because LAI-2201 to LAI-2208 are the Phase 22 world conversions.

- [x] **AM-1** Architecture and contract (depends: none)
- [x] **AM-2** Models and migrations (depends: AM-1)
- [x] **AM-3** Model validation service (depends: AM-1)
- [x] **AM-4** Storage abstraction and upload lifecycle (depends: AM-2, AM-3)
- [x] **AM-5** Django Admin management, permissions and groups (depends: AM-4, LAI-0404)
- [x] **AM-6** Published-asset resolver API and delivery (depends: AM-4, LAI-0403)
- [x] **AM-7** Frontend Django resolver adapter (depends: AM-6, LAI-2106)
- [x] **AM-8** Existing asset import tooling (depends: AM-4)
- [x] **AM-9** Security and integration tests, documentation (depends: AM-5 to AM-8)
- [x] **AM-10** Admin 3D model preview (depends: AM-5). Unit-tested and browser-checked (headless Chromium, software WebGL)
- [ ] **AM-11** Signed CloudFront delivery (APPROVAL: AWS) (depends: AM-6, LAI-1002, LAI-1005)
- [ ] **AM-13** Non-model asset kinds (textures, images and sprites, audio, animation clips): validation, key families and matching IAM prefixes in `LaiAssetStorage-<env>` (depends: AM-4; ADR-042 keeps them in the asset bucket, never the photo bucket)
- [ ] **AM-14** Django asset manager upload/delete API (`/api/v1/admin/assets/`, ADR-042 amendment) (depends: AM-4, AM-5; LAI-0209 for mutations). 2026-11-01 on `feature/lai-django-asset-storage`: list, detail, create definition, upload, publish, default, retire, delete unpublished; Cognito `Admins` per request (ADR-024 A4). Implemented and pytest-covered; every mutation answers `sensitive_action_unavailable` until LAI-0209. Open: LAI-0209, live S3 (AM-16)
- [ ] **AM-15** React asset manager migration from Amplify Storage to the Django API (depends: AM-14). 2026-11-01 on the same branch: Django-mode list, add and per-asset pages with upload progress, retry-safe add, findings; Amplify pages unchanged for builds without the Django API. Vitest only; not checked in a browser. Open: usable for changes once LAI-0209 lands; browser acceptance
- [ ] **AM-16** End-to-end asset publishing and delivery verification on the deployed dev environment: upload, validate, publish, resolve in a child scene (Treasure Cove), retire stops new fetches, nothing public (depends: AM-14, AM-15, LAI-0209, LAI-1002 asset bucket deployed, LAI-1004 Django on dev)

# Treasure Rush (`docs/TREASURE_RUSH_ROADMAP.md`)

Feature roadmap with its own ids, like SC-n. Since POST-MERGE-03 (ADR-033) Treasure Rush runs on
the canonical Django backbone; rows that were built as copies of LAI tasks are recorded as
absorbed, so no LAI task is counted twice. Decisions TR-D1, TR-D2, TR-D4, TR-D8 and TR-D11 are
accepted; TR-D3 (admin-authored layout as authoritative) is **not** adopted and waits for
LAI-0805's ADR; TR-D5 is still Proposed.

- [x] **TR-0** Plan: gap analysis, dependency map, decisions, asset contract
- [x] **TR-1** Server-side math challenges (`lai/apps/education/challenges.py`)
- [x] **TR-2** Catalog models. Built on `feature/treasure-rush-slice` as a parallel LAI-0304; **superseded in POST-MERGE-03** by the canonical catalog (`apps/catalog`). Kept from it: item, collectible-set, reward-rule, learning-objective and NPC catalog models (moved into `apps/catalog`), the JSON-schema validator (now part of the canonical import), and the region models (now `apps/regions`, seed-authored)
- [ ] **TR-3** Django admin access and catalog admin, is LAI-0404 then LAI-0801 (APPROVAL: TR-D5) (depends: TR-2)
- [x] **TR-4** Progress models and play services. **Absorbed into the canonical LAI-0305 models in POST-MERGE-03**: session kinds, `ChallengeAttempt`, attempt evidence, foreign-key inventory, append-only world changes, the quest refresh; play services in `apps/game_sessions/play.py`
- [x] **TR-5** Treasure Rush play API (depends: TR-4, LAI-0403). 8 child-scoped routes, contract unchanged by POST-MERGE-03 (`docs/PLAY_API.md`)
- [x] **TR-6** Frontend Django client slice (depends: TR-5, TR-D8). `react/src/api/` client and play DTOs, `features/region-play/` hooks
- [ ] **TR-7a** Placeholder-mesh asset adapter (depends: none)
- [x] **TR-7** Treasure Rush region (depends: TR-6, TR-D2, TR-D4, TR-D14, TR-D15). Treasure Cove on the existing Three.js engine via the `region-play` extension. Not verified in a browser
- [x] **TR-8** Challenge and quest-complete UI (depends: TR-7). DONE locally: Pip dialogue and quest acceptance, chest challenge with hints and retry, reward reveal and chest-opening animation, backpack from progress; no audio (no Polly system exists, TR-D19)
- [x] **TR-8a** Make it runnable locally (depends: TR-8). DONE locally: automatic Django account setup via `POST /me`, correct 403 messages, dev-only `publish_treasure_rush`, `docs/TREASURE_RUSH_LOCAL_DEV.md`
- [ ] **TR-9** End-to-end and playtest (depends: TR-8a; real families also need LAI-0502, LAI-0602, gate G9, ADR-024 A6. Locally, the child mirror step in `docs/TREASURE_RUSH_LOCAL_DEV.md` stands in for LAI-0602)
- [ ] **TR-10** Integrate LAI-2106 shared asset management (depends: LAI-2106, TR-7a)
- [ ] **TR-11** Second chest and quest chain (depends: TR-9)

## Phase 28 — AI Question Studio (branch `features/studio`, ADR-045 Accepted)

Detail: `docs/AI_QUESTION_STUDIO.md`.

- [x] **LAI-AQS-001** Existing architecture audit (depends: docs/AI_QUESTION_STUDIO.md sections 1 to 3). DONE locally: architecture assessment written; no code
- [x] **LAI-AQS-002** Question types and curriculum taxonomy. DONE locally: `taxonomy.py` (subjects, grades to age bands, topics, difficulties, question type registry); tests in test_validation
- [x] **LAI-AQS-003** Database models. DONE locally: `question_studio` models and migration 0001 (ADR-045 accepted); `ChallengeAttempt` gains `source` and `bank_revision_id` (game_sessions 0005, additive)
- [x] **LAI-AQS-004** Generation and publishing contracts. DONE locally: `contracts.py` (request, output schema, untrusted item parsing); immutable `QuestionRevision` enforced in the model
- [x] **LAI-AQS-005** Bedrock generation service. DONE locally, fake-verified: `generation.py` reuses the ADR-044 `ModelClient`; Bedrock studio client differs only by timeout. Live Bedrock not run (LAI-0705 gate)
- [x] **LAI-AQS-006** Versioned prompt templates. DONE locally: `prompts.py` `studio-q-v1`; untrusted notes sent as a Guardrail-screened part; prompt, schema and model recorded per batch and question
- [x] **LAI-AQS-007** Batch question generation. DONE locally: chunked batches (5 per call, 25 per batch by default), partial success, `thread`/`manual`/`inline` run modes, `manage.py studio_run_batch`
- [x] **LAI-AQS-008** Reliability and cost controls. DONE locally: bounded retries by failure category, tokens and configured-price cost on the batch, `StudioLimits` quotas, ADR-044 kill switch, approved-model list
- [x] **LAI-AQS-009** Draft storage and provenance. DONE locally: drafts only, provenance on every question, review events; nothing publishes automatically
- [x] **LAI-AQS-010** Structural validation. DONE locally: `validation.check_structure`
- [x] **LAI-AQS-011** Answer verification. DONE locally: `validation.check_answer` (arithmetic, contradictory keys, unverifiable flagged)
- [x] **LAI-AQS-012** Duplicate detection. DONE locally: exact and normalised hashes, bounded word-trigram near-duplicate warning, no model calls
- [x] **LAI-AQS-013** Educational quality and safety. DONE locally: grade, skill, reading length, answer range, hint leak, ADR-044 safety patterns; heuristics only
- [x] **LAI-AQS-014** Validation reports. DONE locally: `ValidationFinding` runs, PASS/WARNING/FAIL, revalidation, publish blocked by blocking findings
- [x] **LAI-AQS-015** Generation interface (Django Admin). DONE locally: Generate Questions form in Django Admin, batch status feedback. Verified with the Django test client, not a browser
- [x] **LAI-AQS-016** Question review and editing. DONE locally: review page with choices, key, hint, explanation, report and history; edits revalidate
- [x] **LAI-AQS-017** Approval workflow. DONE locally: Draft, Needs review, Approved, Rejected, Published; separate approve and publish permissions; reviewer, time and events recorded
- [x] **LAI-AQS-018** Bulk review operations. DONE locally: bulk approve, reject, revalidate, submit, publish, regenerate with per-question refusal reporting
- [x] **LAI-AQS-019** Publishing and version management. DONE locally: immutable revisions, partial unique active revision, supersede-on-correction, retire, row-lock plus constraint against concurrent publish (two-thread test)
- [x] **LAI-AQS-020** Question-to-adventure integration. DONE locally for integer-answer questions: `QuestionPool` per region and chest; drafts, rejected and retired never served. Needs a catalog objective for real data
- [x] **LAI-AQS-021** Question selection. DONE locally: subject, grade and band, topic, skill, difficulty and adventure filters; no repeat within a session; falls back to the authored challenge
- [x] **LAI-AQS-022** Grading and mastery integration. DONE locally: `grade_answer` and `SkillEvidence` unchanged; attempt snapshots the revision; no model call at runtime. React multiplication picture added, not run (dependencies cannot be installed)
- [x] **LAI-AQS-023** Automated testing. DONE locally: 125 Studio tests plus two updated guard tests; full Python suite 1389 + 354 passed (see IMPLEMENTATION_STATUS)
- [ ] **LAI-AQS-024** End-to-end acceptance (depends: 015 to 023; live Bedrock needs LAI-0705 approval). IN PROGRESS: workflow verified end to end with the fake model; OPEN: live Bedrock (LAI-0705 approval), a Django Admin browser session, the React client tests, and a catalog multiplication objective
