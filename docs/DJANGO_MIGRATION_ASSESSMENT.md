# Django Migration Assessment (Phase 0)

Status: **Proposed. Assessment only.** No application code, infrastructure, or
deployed AWS resource was changed to produce this document.

Companion documents (this file is the entry point):

- `docs/CURRENT_AWS_RESOURCE_INVENTORY.md` - every Amplify/AWS resource, classified.
- `docs/IAM_ROLE_AUDIT.md` - IAM role evidence and the sources of role multiplication.
- `docs/DJANGO_TARGET_ARCHITECTURE.md` - the proposed Django + React + Three.js shape.
- `docs/DJANGO_MIGRATION_ROADMAP.md` - phased, numbered, reviewable tasks.
- `docs/DECISIONS.md` ADR-019 - the proposed decisions (all marked Proposed).
- `tasks/TASK_TRACKER.md` - the numbered tracker (all TODO).

Authority: this document does not replace `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`,
`docs/ROADMAP.md`, or `docs/platform/*`. Those remain authoritative for the system as it
exists today. `CLAUDE.md` section 8 still names Amplify Gen 2 as the baseline "unless an
architectural decision record changes it"; ADR-019 is only **Proposed**, so that baseline is
unchanged until it is accepted.

**Superseded in part by ADR-020 (Accepted, 2026-10-17).** This assessment recommended keeping
both Phaser and Three.js and deferring a `game/` package. Those recommendations are void:
Three.js is now the only gameplay renderer, Phaser is to be retired after conversion, and
`game/` is a first-class package. Statements below about preserving or keeping Phaser, and
about deferring `game/`, are marked **[superseded]** and are kept for the record. The
Phaser count of "seven" is also corrected: the repository has eight Phaser worlds. See
`docs/THREEJS_ENGINE_CONVERSION.md`.

Evidence labels used throughout:

- **[repo]** read from files in this repository.
- **[synth]** read from the locally synthesized CDK output in `.amplify/artifacts/cdk.out`
  (gitignored, dated 27 Aug 2026, from one personal sandbox). Stale-able, not live.
- **[deployed]** observed in a live AWS account. **None in this document**: the session was
  not permitted to run the AWS CLI, so no deployed state was queried.

## 1. Verdict in brief

1. The migration is feasible and incremental, but it is **not a small backend swap**. The
   hardest part is not Amplify. It is that the authoritative game logic is TypeScript that is
   shared between the browser and the Lambdas (section 5.3).
2. The Three.js and Phaser rendering code is already separated from the backend. Scene
   modules never import an API. Backend access funnels through 16 files (15 `features/*/api.ts` plus `child-profile/deletion.ts`)
   plus one client factory (section 4). This is the best news in the audit.
3. The IAM role count is real but modest per environment (40 roles [synth]) and is driven by
   Amplify Data creating one role per model plus per-function roles (`IAM_ROLE_AUDIT.md`).
   Django would remove that scaling factor. It is a side benefit, not the justification.
4. The strongest reason to move is the product direction in
   `docs/platform/CURRENT_PLATFORM_AUDIT.md` section 3: six gameplay write paths are
   client-authoritative today and only one is server-authoritative. A relational,
   service-layer backend is a better home for the remaining five than five more AppSync
   Lambda resolvers.
5. The largest risks are (a) rewriting or relocating the shared TS domain logic, (b) child
   data authorization, which is deny-by-default and tested today, (c) the AI routes, which
   are Amplify AI Kit specific, (d) data migration from DynamoDB, and (e) the multiplayer
   mismatch (section 9). See section 14.

## 2. Current architecture (what actually exists)

[repo] unless stated.

```text
Browser (React 19 + Vite 8 + TS strict, React Router 7)
  |-- Phaser 4 2D worlds (8 location views, scenes/*.ts)       <- ADR-007; retired by ADR-020
      (this line originally said 7; corrected by the ADR-020 review)
  |-- Three.js 0.185 first-person worlds (3 regions + sandbox)  <- ADR-008
  |-- 16 features/*/api.ts  --> lib/data-client.ts --> generateClient<Schema>()
  |-- features/auth/*       --> aws-amplify/auth (Cognito, email login)
  |-- child-profile/avatarPhoto.ts --> aws-amplify/storage (S3)
  v
AWS Amplify Gen 2 (single TS backend, amplify/)
  |-- Cognito user pool + identity pool, group "Admins"
  |-- AppSync GraphQL + 17 DynamoDB models (owner auth)
  |-- 2 AI Kit generation routes -> Bedrock (Claude Haiku 4.5)
  |-- 3 Lambda resolvers (claimCoopSlot, submitAdventureAnswer, getNextLearningActivity)
  |-- 1 DynamoDB Streams Lambda (operationalMetrics)
  |-- S3 bucket (child profile photos only)
  |-- CloudWatch dashboard, 4 alarms, SNS topic, Bedrock budget
Amplify Hosting: amplify.yml runs `ampx pipeline-deploy` then `vite build`.
CI: .github/workflows/ci.yml (typecheck, lint, format, vitest, build, Playwright).
```

Scale: about 449 source files under `src/features`, 175 Vitest files, 1,578 tests passing
at the start of this task (baseline recorded in section 17). `public/models/` holds 78
generated placeholder glTF files (596 KB total). Content (adventures, quests, items, NPC
dialogue, curriculum, world packs) is **authored as TypeScript modules** that ship in the JS
bundle, not as database rows (`docs/platform/CURRENT_PLATFORM_AUDIT.md` section 4).

Two points differ from the premise in the migration brief and should be stated plainly:

- The brief describes "Three.js game integration". The repo runs **two** renderers:
  Phaser 2D (seven worlds) and Three.js first-person (Welcome Harbor, Pirate Builder Bay,
  Storykeeper Castle region data, and a sandbox). ADR-008 says Three.js supersedes Phaser
  as the next-generation renderer, but Phaser is still live. **[superseded]** Originally
  "both are in scope to preserve". Under ADR-020 Three.js is preserved and extended; Phaser
  is converted and removed. The Phaser world count is eight, not seven.
- The brief lists islands, quests, rewards, collectibles, inventory, achievements, spawn
  points, and so on. Several of these exist only as TypeScript content, and some do not exist
  at all (section 6).

## 3. Amplify dependency map

| Layer | Depends on Amplify how | Depth | Replacement effort |
|---|---|---|---|
| `src/lib/amplify-config.ts` | `Amplify.configure(amplify_outputs.json)`, loaded via `import.meta.glob` | Shallow, one file | Low |
| `src/lib/data-client.ts` | `generateClient<Schema>()`, types imported from `amplify/data/resource` | Shallow file, **deep type coupling** | Medium (types leak everywhere) |
| 16 `features/*/api.ts` | 108 `client.models.*` calls, 2 `client.generations.*`, 2 `client.mutations.*`, 1 `client.queries.*` | The real seam | Medium, mechanical |
| `features/coop/api.ts` | `CoopSession.onUpdate` GraphQL subscription | One realtime call site | Medium (needs a transport) |
| `features/auth/*` (18 files) | `aws-amplify/auth`: signUp, signIn, confirm, reset, `fetchAuthSession`, `Hub` | Moderate | Medium (Cognito can stay) |
| `features/child-profile/avatarPhoto.ts`, `deletion.ts` | `aws-amplify/storage` uploadData/getUrl/remove | Moderate | Low-medium |
| `amplify/functions/*` (3 resolvers + metrics) | Import TS from `src/features/*` directly | Deep | **High** (section 5.3) |
| `amplify/data/resource.ts` | Schema + auth rules + AI Kit routes | The system of record | High |
| `amplify/backend.ts` (594 lines) | CDK patching of AI Kit roles, DynamoDB streams, alarms, budget | Deep, brittle | Replace (not port) |
| `amplify.yml`, `ampx` scripts | Hosting build/deploy | Shallow | Low |
| Tests | `api.test.ts` files mock the client | Moderate | Follow the seam |

Not present (verified by search): `fetch(`/axios REST calls, `localStorage`/`sessionStorage`/
IndexedDB, WebSocket/EventSource, any non-Amplify HTTP client. All backend I/O is the
Amplify Data client. The existing audit already notes the API names are platform-neutral
(`claimCoopSlot`, `generateCompanionTurn`, ...).

## 4. React/API boundary

A centralized frontend API layer **partly exists**: every feature has an `api.ts` that wraps
the generated client and returns typed rows, and call sites in components/hooks use those
wrappers rather than the client. Exceptions to check in LAI-0501: `features/island-map/useExplorableWorld.ts`
calls three feature APIs directly (fine), and `lib/data-client.ts` is imported only by those
16 files (verified by search).

What is missing relative to the FinWin target (`react/src/api/{client,auth,islands,...}.ts`):

- one HTTP client with token injection and typed error mapping (there is none; the Amplify
  client does this implicitly);
- one place for DTO types. Today, row types come from the generated `Schema`, so changing
  the backend changes types across the app. LAI-0501 introduces hand-owned DTO types first,
  with the Amplify implementation behind them, so the Django swap is a per-module change.

Difficulty: **moderate and mechanical**. Roughly 16 modules, each already a thin wrapper.
The pure decision modules (`validators.ts`, `rewardTable.ts`, `relationship.ts`, ...) do not
touch the network and need no change in that step.

## 5. Game-engine / platform / content boundary

### 5.1 Three layers, as found

```text
GAME ENGINE (client-side, keep)
  src/features/island-map/three/*.ts      sceneKit, firstPersonController, pointerControls,
                                          assets/{assetLoader,gltfAssembler,manifest,...},
                                          *Scene.ts, *Region.ts, worldEngineEvents.ts
  src/features/island-map/scenes/*.ts     Phaser scenes (to be retired, ADR-020)
  src/features/island-map/{tilemap,zones,gridGeometry,decor}.ts  collision/zone geometry
  src/features/interaction/               interaction library (client UI mechanics)

GAME PLATFORM (state + rules; today split between client and Amplify)
  adventures/engine, quests, rewards, mastery, npc, discovery, director, coop, story
  = pure decision modules (client+Lambda) + api.ts write paths (client-authoritative)

GAME CONTENT (TypeScript modules in the bundle)
  adventures/content, quests/content, rewards/content, npc/content, discovery/content,
  story/content, curriculum/content, worlds/packs, island/locations.ts,
  island-map/*{Zones,Tilemap,Decor}.ts, npcs.ts, three/assets/manifest.ts
```

### 5.2 How clean is it?

- **Engine to backend: clean.** No file in `island-map/three/*.ts`, `island-map/scenes/*.ts`,
  or the geometry modules imports an `api.ts`, the data client, or `aws-amplify`. Only the
  React wrappers (`*WorldView.tsx`, `NpcConversation.tsx`, `DiscoveryAction.tsx`) and
  `useExplorableWorld.ts` do. The engine communicates through typed events
  (`worldEngineEvents.ts`, `useSandboxBridge.ts`, `npcApproachBridge.ts`).
- **Engine to content: tangled in a benign way.** Engine modules import checkpoint data from
  `features/discovery/checkpoints` (for spawn resolution) and region definitions from content
  modules. This is compile-time import of constants, not runtime coupling to storage.
- **Platform to content: tightly coupled.** Decision modules and Lambdas import content by
  path. This is the coupling that matters (next section).

### 5.3 The decisive finding: shared TypeScript logic

`amplify/functions/submit-adventure-answer/handler.ts` imports `getAdventureTemplate`,
`validateStepAnswer`, `getNextStepId`, `nextHintLevel`, etc. from `src/features/adventures/...`.
`get-next-learning-activity/handler.ts` imports the director (`rankAdventures`,
`reachableAdventures`), curriculum queries, and mastery summaries from `src/features/...`.
That is deliberate and good today (one implementation, unit-tested once). It means:

> A Python/Django backend **cannot** execute the existing authoritative logic. Every
> server-authoritative rule must be re-expressed in Python, or the logic must keep running in
> a Node runtime.

Options (decision for LAI-0102, recorded as an open question in ADR-019):

1. **Content to data, rules to Python (recommended).** Export authored content to versioned
   JSON (this is what `docs/platform/CANONICAL_CONTENT_MODEL.md` and
   `MANIFEST_AND_API_VERSIONING.md` already design), load it into PostgreSQL or a validated
   content package, and re-implement the small validators (about 500 lines in
   `adventures/engine`, plus reward resolution, quest sync, mastery counters) in Python with
   **shared golden-vector tests** run against both implementations.
2. Keep a small Node "rules" service the Django app calls. Preserves one implementation but
   adds a runtime, a network hop, and a second deploy unit. Conflicts with the
   "avoid microservices" constraint. Not recommended unless option 1 proves too divergent.
3. Move validation client-side only. Rejected: it is the status quo the platform audit calls
   a risk.

This choice dominates schedule and risk. It is why the roadmap front-loads a content export
and golden-vector task before any Django write endpoint.

## 6. Existing data model (actual persistent entities)

Source: `amplify/data/resource.ts` [repo], DynamoDB-backed via AppSync. All 17 models use
`allow.owner()` (Cognito `sub` claim stored in the `owner` field). Models marked Admin also
grant `allow.group('Admins').to(['read'])`. `CoopSession` uses
`ownerDefinedIn('hostParentProfileId').identityClaim('sub')`.

| Entity | Key fields | Relationships | Admin read | Django destination | Difficulty | Data-loss risk |
|---|---|---|---|---|---|---|
| ParentProfile | displayName, timezone | has many ChildProfile | yes | `users.ParentAccount` (1:1 with Cognito sub) | Low | Low |
| ChildProfile | nickname, ageBand, avatarKey, avatarPhotoKey, ownerSub, interests[], readingMode, sessionMinutes, active, aiEnabled | belongs to Parent; parent of nearly everything | yes | `users.ChildProfile` (the "player") | Medium | Medium (PII adjacent, deletion cascade) |
| CompanionProfile | companionType, displayName, lastGreetingAt | 1:1 ChildProfile | no | `users.CompanionProfile` | Low | Low |
| AdventureSession | templateSlug, templateVersion, status, currentStepId, startedAt/completedAt/lastActivityAt, coopSessionId | ChildProfile; has many AdventureAction | yes | `game_sessions.AdventureSession` | Medium | Low |
| AdventureAction | stepId, actionType, normalizedAnswer, correctness, hintLevel, attemptNumber, durationMs | AdventureSession | no | `game_sessions.AdventureAction` | Low | Low |
| SkillEvidence | learningObjectiveCode, evidenceType, result, supportLevel, observedAt | ChildProfile | no | `education.SkillEvidence` | Low | Low |
| SkillProgress | learningObjectiveCode, counters, recentLevel, errorPattern, lastPracticedAt | ChildProfile | yes | `education.SkillProgress` | Medium (counter semantics) | Medium |
| WorldChange | locationSlug, changeType, changeKey, payload (JSON), sourceSessionId | ChildProfile | yes | `progression.WorldChange` | Low | Medium (idempotency by key) |
| AIInteractionAudit | routeName, promptTemplateVersion, modelId, validationStatus, safetyDisposition, fallbackUsed, latencyMs | ChildProfile | no | `audit.AIInteractionAudit` | Low | Low |
| SafetyEvent | category, severity, source, actionTaken, reviewStatus | ChildProfile | no (note) | `audit.SafetyEvent` | Low | Low |
| StoryArtifact | templateSlug, title, scenes (JSON) | ChildProfile | no | `education.StoryArtifact` (JSON column) | Low | Medium (child-created content) |
| ChildStoryProgress | storyId, currentChapterId, completedChapterIds[], storyFlags, timestamps | ChildProfile | no | `progression.StoryProgress` | Low | Low |
| CoopSession | hostParentProfileId, templateSlug/Version, participantChildProfileIds[], status, sharedState (JSON) | host parent | host only | `multiplayer.CoopSession` | Medium (atomic slot claim) | Low |
| ChildNpcState | npcId, relationshipPoints/Level, memoryFlags, seenNodeIds[] | ChildProfile | yes | `progression.NpcRelationship` | Low | Low |
| ChildInventory | ownedItemIds[], grantedRuleIds[] | ChildProfile | yes | `inventory.InventoryItem` rows plus `GrantedRule` | Medium (array to rows) | Medium |
| ChildQuestState | questId, status, currentStageId, completed stage/objective ids[] | ChildProfile | yes | `quests.QuestProgress` | Medium | Low |
| ChildWorldState | discoveredObjects[], discoveredCharacters[], lastCheckpointId | ChildProfile | yes | `progression.WorldState` | Low | Low |

Note: `SafetyEvent`, `AIInteractionAudit`, `CompanionProfile`, `AdventureAction`,
`SkillEvidence`, `StoryArtifact`, `ChildStoryProgress` are **not** admin-readable today
(only owner). The brief's "Reviews flagged AI interactions" admin story therefore cannot be
met by the current rules; this is an existing gap, tracked in `docs/AUTHORIZATION_REVIEW.md`,
not a migration regression.

Entities named in the brief that do **not** exist as persistent models: `Island` (static
`island/locations.ts` plus `worlds/packs`), `Adventure`/`Quest`/`Reward`/`Collectible`
(static content modules; only per-child state is persisted), `Objective` (inside quest
content), `Achievement` (no such concept; ADR-011 rejects an XP/coins/level economy),
`ModelPlacement` (per-world `*Decor.ts`), `SpawnPoint` (`discovery/checkpoints.ts`),
`Encounter` (no match), `EducationalChallenge` (adventure steps, `learningObjectives.ts`),
`GameSession` (AdventureSession / CoopSession), `Asset` (`three/assets/manifest.ts` plus
files in `public/models`). The roadmap does not invent models for the missing ones; it
promotes the **static content** to catalog tables only where an admin needs to edit it
(LAI-0400 series).

Client-side persistence: none (no web storage use). Local JSON/config: only the static
content modules above. S3 metadata: `avatarPhotoKey` on ChildProfile. Lambda-specific
structures: `requestLog.ts` log shape; `operationalMetrics` EMF output.

## 7. Authentication

- **Current [repo]:** `amplify/auth/resource.ts` = `defineAuth({ loginWith: { email: true }, groups: ['Admins'] })`.
  Initialization is `src/lib/amplify-config.ts` (from `amplify_outputs.json`). Frontend uses
  `aws-amplify/auth` in `AuthContext.tsx`, `SignInForm`, `SignUpForm`, `ConfirmSignUpForm`,
  `ForgotPasswordForm`, `accountSettings.ts`, `AccountSettings.tsx`. Admin is read from the
  ID token claim `cognito:groups` containing `Admins` (client-side only, for UI); real
  enforcement is the AppSync `allow.group('Admins')` rules. Child profiles are **not**
  Cognito identities (ADR-001); `ChildProfile.ownerSub` records the parent's sub.
  Sandbox pool region in the local `amplify_outputs.json` is `us-west-1`. Production
  pool and region are **unknown** (see `CURRENT_AWS_RESOURCE_INVENTORY.md`).
- **Proposed:** keep Cognito unchanged; Django validates the Cognito JWT (JWKS, `iss`, `aud`/
  `client_id`, `token_use`), maps `sub` to a local `ParentAccount`, maps `cognito:groups`
  to Django permission checks, and never stores passwords. The frontend keeps
  `aws-amplify/auth` (or `amazon-cognito-identity-js`) for the sign-in UX only and attaches
  the access/ID token to the HTTP client. Detail in `DJANGO_TARGET_ARCHITECTURE.md` section 4.
- **Risks:** token type choice (ID vs access token; Amplify sends the ID token to AppSync by default),
  group claim availability, per-child gate being client-side only, deletion of a Cognito
  user vs the local record, and keeping `amplify_outputs.json` out of the build once Amplify
  Data is gone (Cognito config must come from somewhere else).
- Important: when the Amplify backend is retired, the Cognito pool is **owned by the Amplify
  CloudFormation stack**. Retiring the stack would delete the pool and every parent account.
  A pool import/detach plan is mandatory (LAI-0405, called out as a Tier-1 risk).

## 8. Storage

- **Current [repo]:** one Amplify Storage bucket (`learningAdventureIslandMedia`), path
  `child-photos/{entity_id}/*`, identity-scoped (`allow.entity('identity')`), 256 px JPEG
  re-encoded in the browser (`avatarPhoto.ts`). Nothing else uses S3.
- **Game assets are not in S3 today.** All 78 glTF files are static files in `public/models/`,
  served by Vite/Amplify Hosting, generated by `scripts/generate-world-assets.ts`
  (placeholders). There are no textures, audio files, thumbnails, or user-generated 3D
  assets in the repo. `StoryArtifact` (child-created) is JSON in DynamoDB, not S3.
- **Proposed:** keep S3 for binaries (child photos migrate to a private bucket with
  Django-issued, short-lived presigned URLs; game assets move to a public-read/CloudFront
  origin once real art exists). PostgreSQL holds asset metadata: id, kind, version, content
  hash, size, LOD links, animation clip list (what `manifest.ts` already models), and
  placement/decor tables. Binary data never goes in the database. Do not move assets in
  Phase 0; moving placeholders buys nothing until the asset pipeline (Phase 34) is real.
- Identity-pool scoping disappears: the Amplify `entity('identity')` rule (per-identity-id
  prefix) must be replaced by Django-authorized presigned URLs keyed by `ChildProfile` id.
  Existing objects are keyed by identity-pool id, so a key-rewrite or lookup table is needed
  (data-migration risk).

## 9. Multiplayer

- **Current [repo]:** there is no real-time multiplayer. "Household co-presence" (ADR-006)
  is one parent hosting a `CoopSession` that two of their own children join. Mechanism:
  DynamoDB row `CoopSession.sharedState`, atomic first-write-wins `claimCoopSlot` Lambda
  (conditional `UpdateItem`), presence as a list of child ids, and the generated
  `CoopSession.onUpdate` AppSync subscription for live updates (`useCoopPresence.ts`).
  ADR-006 explicitly excludes cursor-level presence and any communication channel.
  Authority: server for slot claims, client for everything else. Synchronization frequency:
  event-driven row updates, not a tick loop.
- **What must never go through ordinary REST:** continuous position/animation sync, if it is
  ever added. Not needed today.
- **Assessment of Django Channels + Redis:** appropriate **only if** ADR-006 is widened.
  For the existing slot-claim and low-frequency shared-state updates, REST plus either
  short polling or Server-Sent Events is enough and avoids Redis and ASGI workers. Recommend
  deferring Channels/Redis to the realtime phase and deciding with measured need. If real
  multiplayer arrives (shared worlds, other families), Channels with Redis is a sound default
  with this codebase, because the game logic is Python-side anyway. No better alternative is
  clearly indicated by the engine, which has no networking code to constrain the choice.

## 10. Admin

[repo] `routes/AdminDashboard.tsx` and `AdminChildProgress.tsx` plus `features/admin/api.ts`
(46 lines): read-only directory of all parents/children and per-child progress, gated by the
`Admins` group. There is no content editing, activation, or destructive operation today.
Content is code, so "activate/deactivate an adventure" does not exist yet.

Proposed split: keep the **React admin** for the privacy-minimized, role-gated product views
(child progress summaries, safety review queue) because they encode product rules. Use
**Django admin** as an internal engineering/emergency tool for catalog tables (islands,
adventures, quests, items, assets) once those are DB-backed, with destructive operations
restricted to superusers and an audit log. Django admin must not expose child free text or
AI audit detail beyond what the product's privacy docs allow (`docs/PRIVACY_AND_SAFETY_REVIEW.md`).

## 11. Code classification

| Class | Items |
|---|---|
| KEEP AS-IS | Three.js scene/controller/asset modules; interaction tables (`worldObjects.ts`); [superseded: Phaser scenes and 2D tilemap/zone/decor geometry are CONVERT-THEN-REMOVE, ADR-020]; interaction library; all pure decision modules' TS (still used client-side for instant feedback); design tokens/CSS; Playwright smoke; asset generation script |
| KEEP BUT RELOCATE | `src/**` into `react/src/**`; engine modules into `game/` (**mandatory under ADR-020**, LAI-2101 and 2102; the import graph is made acyclic as part of the extraction, not as a precondition) |
| WRAP / ADAPT | 16 `features/*/api.ts` behind `react/src/api/*`; `AuthContext` token source; `useCoopPresence` transport; `avatarPhoto.ts` upload path |
| REFACTOR DURING MIGRATION | Move authoritative checks out of `api.ts` write paths into Django services (rewards, quests, mastery, NPC, discovery); content modules to exported versioned JSON; admin directory `.list()` (unbounded cross-family scan) to a paginated endpoint |
| REPLACE | `amplify/data/resource.ts` (to Django models + DRF); 3 resolver Lambdas (to Django services); AI Kit routes (to a Django service calling Bedrock); `operationalMetrics` + stream wiring + custom-resource ARN lookups (to application logging/CloudWatch metrics); Amplify Storage rules |
| REMOVE AFTER CUTOVER | `amplify/**`, `amplify.yml`, `amplify_outputs.json` handling, `aws-amplify` data/storage deps, `ampx` scripts, `@aws-amplify/backend*`, `aws-cdk-lib` dev dep in this package, DynamoDB tables and AppSync API |

## 12. Admin/auth/data deviations from the FinWin layout

FinWin (`/Coding/flintwin`, read only for this comparison) is organised as
`fin/` (Django: `config/`, `config/settings/{base,local,production,test}.py`, `apps/*`),
`react/`, `infra/` (CDK in TypeScript), `ci/`, `deploy/{dev,prod}`, `tests/`, `tasks/`,
`docs/`, plus `containers/`, `scripts/`, `Makefile`, `docker-compose.yml`, `pyproject.toml`.
Task ids are `FT-XXXX`, tracked in `tasks/TASK_TRACKER.{md,csv}` with a checker script;
decisions in `docs/DECISION_LOG.md`.

| Target path | Current LAI state | Recommendation |
|---|---|---|
| `react/` | App lives in `src/`, `index.html`, `vite.config.ts`, `public/` at repo root | Move to `react/` (LAI-0201). Git-mv to preserve history. CI and `amplify.yml` paths must change in the same task. |
| `game/` | Engine code lives under `src/features/island-map/{three,scenes}` and is imported by React wrappers | **[superseded] was "Defer".** ADR-020 makes `game/` a first-class package, extracted after LAI-0201 (LAI-2101, 2102). The Phase 0 risk (breaking 175 test files) is handled by moving files without behaviour change and keeping tests green per step. LAI-0203's boundary guard is the interim protection. |
| `lai/` (Django) | Absent | Create in Phase 2. Name `lai/` mirrors FinWin's `fin/`. |
| `lai/config/settings/` | Absent | `base/local/production/test` as in FinWin. |
| `lai/apps/` | Absent | Domain apps, derived from section 6, not the brief's list (section 13). |
| `infra/` | `amplify/` holds IaC | New CDK TypeScript app in `infra/`. Keep `amplify/` untouched until cutover. |
| `ci/`, `deploy/` | `.github/workflows/ci.yml`, `amplify.yml` | Add in Phase 9. Note FinWin keeps CI scripts in `ci/` and workflow files in `.github`. |
| `tests/` | `e2e/smoke.spec.ts`, per-feature `*.test.ts` | Keep per-feature unit tests colocated. `tests/` holds cross-system contract and golden-vector tests only. |
| `tasks/` | Absent | Created now with `TASK_TRACKER.md`. IDs `LAI-XXXX`. CSV and checker deferred to LAI-0102. |
| `docs/` | Present, 25 files plus `platform/` | Keep. Do not rename `DECISIONS.md` to `DECISION_LOG.md`; this repo's ADR sequence (ADR-001 to ADR-018) is the authority. |

Deviation summary: (1) `game/` deferred [superseded by ADR-020: now first-class], (2) `docs/DECISIONS.md` kept as the decision log,
(3) per-feature tests stay colocated, (4) `amplify/` stays until cutover, (5) repo-root
`CLAUDE.md` is retained and extended rather than replaced.

## 13. Proposed Django domains (derived, not imposed)

The brief's candidate list was `core, users, islands, adventures, quests, rewards, inventory,
progression, assets, game_sessions, multiplayer, education, audit`. Mapped against actual
entities (section 6):

| App | Keep? | Reason |
|---|---|---|
| `core` | Yes | Base models, ids, timestamps, pagination, error envelope, health |
| `users` | Yes | ParentAccount, ChildProfile, CompanionProfile, consent |
| `islands` | Yes, small | Location/world catalog (today static content); needed for admin activation |
| `adventures` | Yes | Adventure template catalog + versions |
| `quests` | Yes | Quest catalog + QuestProgress |
| `rewards` | **Merge into `inventory`** | Reward rules are a pure table (`rewardTable.ts`, no randomness, ADR-011); a separate app adds a boundary with no second model |
| `inventory` | Yes | Items, InventoryItem, granted rules |
| `progression` | Yes | WorldChange, WorldState, StoryProgress, NpcRelationship |
| `assets` | Yes | Asset catalog metadata and presigned URL issuing |
| `game_sessions` | Yes | AdventureSession, AdventureAction |
| `multiplayer` | **Defer** | Only `CoopSession` exists; start inside `game_sessions`, split when realtime is real |
| `education` | Yes | Curriculum/LearningObjective, SkillEvidence, SkillProgress, StoryArtifact, parent summaries |
| `audit` | Yes | AIInteractionAudit, SafetyEvent, admin review |
| `ai` | **Add** | Not in the brief's list. The Bedrock calls, schema validation, safety checks, and fallbacks are a distinct, security-critical domain (CLAUDE.md section 7) |

Avoid a monolithic `game` app. The boundary rule: apps may import `core`; cross-app calls go
through service functions, not model imports, except FK targets to `users.ChildProfile`.

## 14. Highest-risk areas

1. **Shared TS rules vs Python backend (section 5.3).** Divergence between the TS client
   validators and Python authoritative validators would show children inconsistent
   feedback or reject correct answers. Mitigate with golden vectors and a content export
   before any write endpoint.
2. **Child-data authorization.** Amplify gives deny-by-default owner rules enforced by
   AppSync. In Django, every queryset must be scoped; one forgotten filter is a cross-family
   data leak about children under 8. Mitigate with a mandatory scoped base manager/viewset,
   and cross-tenant tests for every endpoint (the FinWin "tenant authorization" gate).
3. **Cognito stack ownership.** The pool is a resource of the Amplify stack. Deleting the
   stack deletes all parent accounts. Needs a documented detach/import procedure and a
   rehearsal before cutover. Highest consequence.
4. **AI routes.** `generateCompanionTurn`/`generateTutorTurn` rely on AI Kit, which already
   needed a custom IAM patch (`backend.ts`). A boto3 Bedrock replacement must reproduce the
   fixed system prompts, token limits, schema validation, safety checks, audit rows, and
   authored fallbacks. The fallback-on-any-error behavior currently masked a deployed
   `AccessDeniedException` (see `backend.ts` comment); the new service needs explicit
   failure metrics.
5. **Data migration and parity.** DynamoDB string arrays and JSON blobs to relational rows;
   no deployed data volume is known; "pilot" status means real families' children data may
   exist. Needs an export, dry-run import, row-count/checksum parity, and a freeze window.

Also notable: deployed state is unverified (this assessment had no AWS access), and a
possible schedule trap is treating the Android-oriented ADR-010 ("one Amplify platform")
as still current; ADR-019 must explicitly supersede it if accepted.

## 15. What should NOT be migrated

- Three.js controllers, scene builders, asset loader/assembler, manifest, LOD handling
  (these move into `game/`, but are not rewritten).
- ~~Phaser scenes and tilemap/zone/decor geometry.~~ **[superseded]** Phaser scenes are
  retired by ADR-020 after conversion. Their *data* (interaction tables, unlock keys, layouts
  as hints) is reused.
- Adventure, quest, reward, NPC, discovery pure decision modules (kept for client-side
  responsiveness; they gain a Python twin, they are not deleted).
- All design tokens, CSS Modules, routes, and accessibility behavior.
- The adventure content itself (it is exported to data, not rewritten).
- Cognito (initially) and the parent sign-in UX.
- The `AuthContext` shape and `useAuth` API (token source changes behind it).
- CloudWatch as the metrics destination (the transport changes, not the destination).
- The test suite. It is the safety net for the swap.

## 16. Open questions (need a human)

1. Is there a **production Amplify app** (branch `main`) with real family data, or only
   sandboxes? `amplify.yml` and the "pilot" docs imply a hosting app exists; the repo cannot
   confirm it. Decides whether Phase 10 (data migration) is real or a no-op.
2. Which AWS account/region hosts it? (Local sandbox outputs say `us-west-1`.)
3. Should Android (ADR-010, `docs/android/android.md`) remain a goal? Django makes a REST
   API a natural fit, but ADR-010 and Phases 35-45 are written around Amplify.
4. Option 1 vs 2 in section 5.3 (rules in Python vs Node service).
5. Is DynamoDB-to-Postgres data loss on pre-pilot sandbox data acceptable (no migration)?

## 17. Verification record

- Branch `storykeeper-castle-3d-storyboard-and-roadmap`, starting commit `365d7582`.
- Starting tree: clean (`git status` empty).
- `npm test` at start: 175 files, 1,578 tests, all passing (~90 s).
- AWS CLI not available to this session; no deployed inspection performed.
- No application source, `amplify/`, `package.json`, or CI file was modified.
- ADR-020 review (2026-10-17): docs only. Counted eight Phaser `LocationScene` subclasses and
  ten files importing `phaser`; no test or build was run because no code changed.
