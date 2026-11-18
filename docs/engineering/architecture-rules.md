# Architecture Rules

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-019, ADR-020, ADR-021, ADR-024, ADR-033, ADR-040, ADR-045, ADR-047, ADR-064

This document states the approved architecture of Learning Adventure Island as of baseline
`466a4972` and classifies every major element. It is a governance summary: the decision text
lives in [DECISIONS.md](../DECISIONS.md) and the system description in
[ARCHITECTURE.md](../ARCHITECTURE.md). When this page and an ADR disagree, the ADR wins and this
page is corrected.

Rules tagged **Binding** already apply today through the named source. Untagged rules are
proposals under ADR-072 and bind only once the owner accepts it.

## 1. Classification vocabulary

| Class | Meaning |
|---|---|
| Retired | Removed or mandated for removal. Never extend or reintroduce. |
| Transitional | Still present, scheduled to go. Bug fixes only. |
| Implemented (on main) | Code is on `main`. This says nothing about ADR acceptance or deployment. |
| Approved future | An Accepted ADR requires it; not built yet. |
| Proposed | An ADR or design exists with status Proposed or Reserved, or work is pending merge. |

Two facts are tracked separately and must never be merged into one claim:

- **ADR status** (Accepted, Accepted in part, Proposed, Reserved, Superseded) from the
  [DECISIONS.md](../DECISIONS.md) registry. Code on `main` is not evidence of acceptance.
- **Deployment status.** Infrastructure code in `infra/` is not proof that anything is deployed
  (section 8).

## 2. Architecture at a glance

| Element | Class | Source | Status of source |
|---|---|---|---|
| Amplify Gen 2 backend and Amplify Hosting | Retired | CLAUDE.md §18, AMP-01 to AMP-08 | Owner directive |
| Dual local authentication (`AUTH_PROVIDER=django`) | Retired | ADR-038 | Superseded by ADR-040 |
| Phaser 2D worlds (`phaser` 4.2 in `react/package.json`, 11 files import it) | Transitional | ADR-007, ADR-020, ADR-029 | ADR-020, ADR-029 Accepted |
| ECR-image processing worker, separate processing queues and stack | Retired | ADR-061 items 3, 5, 10; ADR-062 decisions 2, 3 | Superseded by ADR-064 |
| React 19, Vite, TypeScript strict, React Router 7 | Implemented (on main) | CLAUDE.md §8 | Binding |
| Three.js gameplay runtime in `react/src/features/island-map/three/` | Implemented (on main) | ADR-020 | Accepted |
| First-class `game/` package | Approved future | ADR-020 item 4 | Accepted, not built |
| Shared first-person controller with collision (`firstPersonController.ts`) | Implemented (on main) | ADR-020 | Accepted |
| Jumping, running, third-person camera, avatars, platforms, player footprint | Proposed | ADR-056 to ADR-060, ADR-063 | Reserved; pending merge (PR #26 to #29, #36, #37) |
| CSS Modules and `tokens.css` theme | Implemented (on main) | ADR-023, ADR-052 | Accepted |
| Tailwind CSS 4 for admin, shells, homepage, landing page | Implemented (on main) | ADR-023, ADR-052 | Accepted |
| Django 6.1, DRF 3.18, psycopg 3, PostgreSQL 16 | Implemented (on main) | ADR-019, ADR-021 | ADR-019 Accepted in part; ADR-021 Accepted |
| `/api/v1/` namespace and error envelope | Implemented (on main) | ARCHITECTURE.md "Django API conventions" | LAI-0205 |
| Content manifest and multi-version API | Approved future (designed, not built) | ADR-014 part B | Accepted |
| Cognito as sole application identity provider | Implemented (on main) | ADR-024, ADR-040 | ADR-024 Accepted in part; ADR-040 Accepted |
| Django Admin local staff sign-in | Implemented (on main) | ADR-034 | Accepted |
| Recent sign-in for sensitive actions | Implemented (on main) | ADR-043 | Proposed |
| Android API and WebView game session cookie | Implemented (on main) | ADR-036 | Proposed |
| Django Admin as sole staff authoring surface | Implemented (on main) | ADR-045, ADR-046, ADR-047 | Accepted |
| Sound Manager, spatial audio, Polly speech | Implemented (on main) | ADR-048, ADR-049, ADR-050 | Proposed |
| NPC Manager | Implemented (on main) | ADR-054 | Accepted |
| Bedrock companion and tutor turns | Implemented (on main) | ADR-044 | Accepted (code and definitions only) |
| Canonical background processing (`apps.jobs`, SQS, zip Lambda) | Implemented (on main) | ADR-064 | Accepted |
| Production on one EC2 per environment via GitHub OIDC | Implemented (on main); not deployed (section 8) | ADR-037 | Accepted |
| Native dev environment (ARM64 EC2, RDS, Lambda, SQS) | Implemented (on main); not deployed (section 8) | ADR-055 | Accepted |
| Multiplayer room server (`server/`) | Implemented (on main) | ADR-026 | Accepted |
| Spatial layout administration in Django | Proposed | LAI-0805 (no ADR yet) | Open |
| ECS Fargate production | Proposed | ADR-037 (LAI-1007 candidate) | Not decided |

## 3. Frontend

- **Stack.** React 19.2, Vite 8, TypeScript 5.9 with `strict`, React Router 7
  (`react-router-dom` 7), Vitest 4, Playwright. **Binding:** CLAUDE.md §8, §13.
- **One gameplay renderer.** Every playable environment is Three.js. Menus, HUD, dashboards,
  parent screens and admin stay React. **Binding:** ADR-020, ADR-029, CLAUDE.md §19.
- **Phaser is Transitional.** No new Phaser features; bug fixes only until the world's Three.js
  replacement passes parity tests, visual validation and the Sprouts gate (LAI-2303). Never add a
  new Phaser import. **Binding:** ADR-020 item 8, CLAUDE.md §19.
- **Styling.** CSS Modules reading `src/styles/tokens.css` everywhere. Tailwind 4 only through the
  two entries `src/features/admin/admin.css` (ADR-023) and `src/features/portal/portal.css`
  (ADR-052) and only for the pages ADR-052 lists (shells, child homepage, landing page). Child and
  parent code never imports `features/admin/ui`. **Binding:** ADR-023, ADR-052.
- **Responsive layouts.** Tablet-first, and usable on desktop and phone widths. **Binding:**
  CLAUDE.md §11 item 13. ADR-020's frame-rate figures are planning targets, not release gates.
- **Configuration.** The browser reads only `VITE_*` variables (see
  [coding-standards.md](coding-standards.md)). No model credentials or AWS SDK calls from the
  browser. **Binding:** CLAUDE.md §7.

### 3.1 Shared engine components (on main)

The engine is not yet in `game/`. Use these shared pieces; do not build a parallel one.

| Component | Path (under `react/src/features/island-map/three/`) | Use it for |
|---|---|---|
| First-person controller | `firstPersonController.ts`, `pointerControls.ts` | Walking, look, box-collider collision |
| Scene kit | `sceneKit.ts` | Shared scene construction helpers |
| Location runtime | `runtime/createLocationEngine.ts`, `runtime/ThreeLocationWorldView.tsx` | Running a Place from a manifest |
| Location manifests | `runtime/locationManifest.ts`, `runtime/validateLocationManifest.ts`, `runtime/manifests/` | Declaring a 3D Area as data (ADR-032) |
| Trigger tracking and bindings | `runtime/worldTriggerTracker.ts`, `runtime/manifestBindings.ts`, `runtime/adventureStepBindings.ts` | Emitting semantic events to React |
| View extensions | `extensions/`, `runtime/viewExtensionRegistry.tsx` | Region-specific behaviour without branching the runtime |
| Engine events | `worldEngineEvents.ts`, `engineHandle.ts` | The typed boundary between engine and React |

`runtime/noLocationBranching.test.ts` guards against per-location branches in the shared runtime.

### 3.2 Engine boundary

- The engine never validates answers, awards progress, decides mastery or calls AI. It emits
  typed, semantic-ID events; React and Django decide outcomes. **Binding:** ADR-020 item 6,
  CLAUDE.md §19.
- Once code is in `game/`, it imports nothing from React, Django clients or AWS SDKs. **Binding:**
  ADR-020 item 4 (applies "once it is in `game/`"). Proposed: new engine modules already follow
  this rule inside `island-map/three/` so the move is mechanical.
- A new Realm or Adventure is data (catalog content plus a manifest), not a new renderer, route or
  infrastructure. **Binding:** ADR-009, ADR-020 item 5.

### 3.3 Movement, jumping, collision and camera

| Capability | State on `main` | Pending work |
|---|---|---|
| Walking and collision | Shared first-person controller with `Box3` colliders | Footprint: PR #36 (ADR-060 reserved) |
| Jumping | Not implemented | PR #26 (ADR-063 reserved) |
| Running and sprinting | Not implemented | PR #29 (ADR-058 reserved) |
| Third-person camera and avatar | Not implemented | PR #27, #28 (ADR-056, ADR-057 reserved) |
| Platforms, checkpoints, safe respawn | Not implemented | PR #37 (ADR-059 reserved) |

Rules: movement, jumping, camera and collision are shared components. No adventure implements its
own controller, gravity, camera rig or collision loop; it configures the shared controller.
Until the PRs merge, specifications describe the shared controller as the required integration
point and say "pending merge (PR #n)". See
[jumping-standard.md](../adventures/jumping-standard.md).

## 4. Backend

- **Stack.** Django 6.1, DRF 3.18, psycopg 3, PostgreSQL 16, Python 3.12, all pinned in
  `requirements.txt`. **Binding:** ADR-021.
- **One backbone.** Every feature extends the canonical apps listed in
  [ARCHITECTURE.md](../ARCHITECTURE.md) ("Consolidated Django backbone"). No second catalog,
  loader, child-owned base or progress model. **Binding:** ADR-033, CLAUDE.md §20.
- **Server-authoritative gameplay.** Correctness, hint level, next step, completion and rewards
  are computed by Django for every path that has been moved there (answers and hints, region play,
  puzzles, quests). The client sends what the child did, never a computed result. **Binding:**
  ADR-012, [PLAY_API.md](../PLAY_API.md), ARCHITECTURE.md "Authoritative adventure answers".
- **API namespace and versioning.** Every route is under `/api/v1/`, one `include` per app in
  `lai/config/urls.py`; a test fails on a route outside it. Additive changes stay in v1; a
  breaking change needs a new `/api/v2/` prefix beside v1. There is no v2. A content manifest and
  formal client version negotiation are designed, not built. **Binding:** ADR-014,
  [MANIFEST_AND_API_VERSIONING.md](../platform/MANIFEST_AND_API_VERSIONING.md).
- **Ownership enforcement.** Child data is reached only through the parent: `ChildScopedMixin`
  (`lai/apps/users/scoping.py`), `ChildProfile.objects.owned_by`, `ChildOwnedModel`
  (`lai/apps/core/models.py`). Foreign and unknown ids return the same 404. **Binding:** ADR-022,
  CLAUDE.md §10, TESTING_STRATEGY.md (LAI-0403).
- **Migrations.** Every model change ships its migration in the same commit;
  `manage.py makemigrations --check --dry-run` (`make migrate-check`) must be clean at merge.
  Never edit an applied migration; add a new one. Data migrations are reversible or state why not.
  Production data migration needs owner approval. **Binding:** CLAUDE.md §18 (no production data
  migration without approval); the rest is proposed.

## 5. Authentication and identity

- **Cognito is the sole identity provider for application users** in every environment; Django
  verifies bearer access tokens and authorizes. No Amplify SDK. **Binding:** ADR-024 (Accepted in
  part), ADR-040.
- **Django Admin staff** use local Django sign-in, separate from Cognito. **Binding:** ADR-034.
- **ChildProfile is a managed profile, not a login.** A child has no email, password, Cognito
  identity or Django login; the server always authorizes as the parent. **Binding:** ADR-001,
  ADR-022.
- **Recent sign-in for sensitive actions** (child deletion today): implemented on `main` in
  `lai/apps/users/recent_auth.py`; ADR-043 is **Proposed**, owner acceptance and the live Cognito
  gate pending. See [RECENT_SIGN_IN.md](../platform/RECENT_SIGN_IN.md).
- **Android and WebView game session**: a ticket-redeemed, child- and region-scoped cookie accepted
  only by game runtime routes; implemented on `main`; ADR-036 is **Proposed**.

### 5.1 Approved future child-login decisions

**None is approved.** No ADR in the registry approves a child sign-in, a child credential or a
child session principal. The Accepted decisions point the other way: ADR-001 (parent-owned
accounts), ADR-022 ("Children never authenticate"), and ADR-014 (a `CHILD` grant collapses into
`OWNER`). The ADR-036 game session cookie is issued from a parent-authenticated ticket and is not
a child login. `docs/IMPLEMENTATION_STATUS.md` mentions "per-child sign-in is still ahead"; that is
a note, not a decision. Any child-login work needs a new ADR accepted by the owner first.

## 6. Content management

- Django Admin is the authoritative authoring system. The TypeScript export and
  `manage.py load_content` are the initial import and migration path; an import never silently
  overwrites an administrator's published revision. **Binding:** ADR-047, CLAUDE.md §20. Details:
  [DJANGO_CONTENT_AUTHORING.md](../platform/DJANGO_CONTENT_AUTHORING.md).
- React never duplicates staff functionality: no React page authors assets or content and there is
  no administrator asset API. React owns gameplay and parent screens and consumes published
  content. **Binding:** ADR-045, ADR-047.
- Spatial layouts are not Django-administered until LAI-0805's ADR. Shipped regions keep their
  TypeScript manifests; Treasure Cove stays in `lai/apps/regions/treasure_rush_seed.py`. NPC
  placement is the one owner-approved exception. **Binding:** CLAUDE.md §20, ADR-054.

## 7. Shared services

Use the owner listed. Do not build a second one; extend the existing service and coordinate the
change as a shared component ([multi-agent-workflow.md](multi-agent-workflow.md)).

| Service | Owner app or path | Use it when | Do not build |
|---|---|---|---|
| Asset Manager (ADR-035, ADR-042, ADR-045) | `lai/apps/assets`, `catalog.ContentAsset`; React resolver consumers | Any 3D model, texture or binary a game loads | A React asset manager, a second asset identity, direct bucket URLs. See [asset-standard.md](../adventures/asset-standard.md) |
| NPC Manager (ADR-054, Accepted) | `lai/apps/npcs`, `react/src/features/npc-manager` | Any character with dialogue, behaviour, animation or voice | Per-adventure NPC scripts or a second NPC model. See [npc-standard.md](../adventures/npc-standard.md) |
| Sound Manager (ADR-048, ADR-049, ADR-050, all Proposed) | `react/src/audio` (`sharedSoundManager.ts`), `lai/apps/audio` | Every sound, music bed, spatial emitter or voice clip | A second `AudioContext`, raw `<audio>` playback in games. See [audio-standard.md](../adventures/audio-standard.md) |
| Speech (Polly) (ADR-049, Proposed) | `lai/apps/speech` | Spoken lines; games speak only server-approved references | Browser or client calls to Polly |
| AI Question Studio (ADR-046) | `lai/apps/question_studio`, Django Admin | Staff-drafted, reviewed question banks | A React question editor; model-graded answers |
| Content authoring (ADR-047) | `lai/apps/catalog` (`ContentRevision`, `authoring.py`) | Editing published content | Edits only in TypeScript after import |
| Adventure engine (ADR-002, ADR-012) | `lai/apps/adventures/engine.py`, `lai/apps/game_sessions`; React `features/adventures` | Step-based adventures, answers and hints | Client-side grading of a server-authoritative path |
| Quest engine | `lai/apps/quests/engine.py` | Multi-step objectives across engines | Per-adventure quest state |
| Scoring and rewards (ADR-011, ADR-013) | `catalog.RewardRule`, `inventory`, `progression.WorldChange` | Collectibles, items, world changes | XP, coins, levels, drop rates or currency. See [scoring-standard.md](../adventures/scoring-standard.md) |
| Progress tracking (ADR-016) | `lai/apps/education` (`SkillEvidence`, `SkillProgress`), `lai/apps/progression` | Skill evidence and parent summaries | A new generic event log or progress table |
| Bedrock AI (ADR-044) | `lai/apps/ai` | Companion and tutor turns, NPC AI lines | Any model call outside Django; any call without the Guardrail |
| Async processing (ADR-064) | `lai/apps/jobs`, `lambda/jobs_worker`, [CANONICAL_PATH.md](../processing/CANONICAL_PATH.md) | Long or external work (generation, media validation) | New queues, stacks, ECR workers or a second job table |
| Multiplayer (ADR-026) | `server/` room server | Co-presence state | Engine-side networking or a chat channel |

## 8. Infrastructure and deployment

| Item | Source | Code | Deployed? (only what the records say) |
|---|---|---|---|
| Production Django on one EC2 per environment, GitHub OIDC, ECR, SSM | ADR-037 (Accepted, repository side only) | `infra/lib/djangoEc2Stack.ts`, `githubOidc.ts`, `.github/workflows/deploy-django-ec2.yml` | Inventory (2026-11-09): `LaiDjangoEc2-<env>` "No" |
| Native dev environment | ADR-055 (Accepted, repository side only) | `infra/lib/devPlatformStack.ts`, `devArtifactsStack.ts` | [dev-native-environment.md](../infrastructure/dev-native-environment.md): "Nothing has been deployed." |
| Canonical processing | ADR-064 (Accepted) | `LaiDevPlatform-dev`, `lambda/jobs_worker` | Not recorded as deployed |
| React site on S3 and CloudFront | CLAUDE.md §8 | `infra/lib/frontendStack.ts` (`LaiFrontend-<env>`, us-east-1), `deploy-site.yml` | [domains-and-hosting.md](../infrastructure/domains-and-hosting.md): "proposed changeset, not deployed" |
| Asset and child photo buckets | ADR-042 | `assetStorageStack.ts`, `childPhotoStorageStack.ts` | Inventory: "No" [owner-cli 2026-11-01] |
| Bedrock Guardrail | ADR-044 | `aiGuardrailStack.ts` | Inventory: only `LaiAiGuardrailOnly-dev` (Guardrail `lai-child-safety-dev` v1) deployed outside the repository on 2026-11-07 |

Rules:
- Infrastructure code is not proof of deployment. Quote the dated record or say "not recorded".
  [CURRENT_AWS_RESOURCE_INVENTORY.md](../CURRENT_AWS_RESOURCE_INVENTORY.md) states it holds
  repository evidence only; [inventory.md](../infrastructure/inventory.md) is dated 2026-11-09.
- Never deploy, provision, delete or change AWS resources (the Cognito pool and retained Amplify
  tables and buckets included) or migrate production data without explicit owner approval.
  **Binding:** CLAUDE.md §18, ADR-037, ADR-055.
- No Amplify and no Phaser reintroduction. **Binding:** CLAUDE.md §18, §19.

## 9. Changing this architecture

A change to any row in section 2 needs an ADR (see [DECISIONS.md](../DECISIONS.md) and
[the ADR guide](../adr/README.md)). Reserve the number before the branch uses it; `npm run
adr:check` enforces the registry. Proposed ADRs do not bind; implementing one does not accept it.
