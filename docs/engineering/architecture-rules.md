# Architecture Rules

Status: Mandatory policy
Owner: project owner
Last reviewed: 2026-11-18
Related ADRs: ADR-019, ADR-020, ADR-029, ADR-033, ADR-036, ADR-037, ADR-040, ADR-041, ADR-044, ADR-045, ADR-046, ADR-047, ADR-048, ADR-049, ADR-050, ADR-052, ADR-053, ADR-054, ADR-055, ADR-061, ADR-062, ADR-064, ADR-072
Canonical sources: [DECISIONS.md](../DECISIONS.md) (decisions), [ARCHITECTURE.md](../ARCHITECTURE.md) ("Consolidated Django backbone" and later sections), [CLAUDE.md](../../CLAUDE.md) sections 8 and 18 to 20

This page states the approved architecture as rules, with the status of every element on `main`
at `466a4972` (2026-11-18). It does not replace the ADRs. When this page and an ADR disagree, the
ADR in [DECISIONS.md](../DECISIONS.md) wins and this page is corrected.

## 1. Status vocabulary

| Status | Meaning |
|---|---|
| Implemented (main) | Code is on `main`. It does not mean deployed or owner-accepted in a browser. |
| Pending merge | Code exists only on an open branch or pull request. Never describe it as available. |
| Transitional | Exists on `main` but is being removed or replaced under an accepted decision. |
| Approved future | Accepted direction with no code yet, or code not yet switched on. |
| Proposed | Written down, not accepted by the owner. Do not build on it without asking. |
| Retired | Removed. Never reintroduce. |

"Infrastructure defined in code" is not "deployed". Deployment status comes from the owner and the
dated records in [inventory.md](../infrastructure/inventory.md) and
[CURRENT_AWS_RESOURCE_INVENTORY.md](../CURRENT_AWS_RESOURCE_INVENTORY.md), both of which predate
the Amplify removal and must be re-verified before they are relied on.

## 2. Retired elements

| Element | Status | Rule | Source |
|---|---|---|---|
| Amplify Gen 2 backend (Auth, Data, Storage, Functions, AI Kit) | Retired | Never reintroduce any Amplify package, SDK, `amplify/` directory or Amplify-style data client. `react/src/test/noAmplify.test.ts` guards this. | AMP-01 to AMP-08, [AMPLIFY_FINAL_REMOVAL.md](../platform/AMPLIFY_FINAL_REMOVAL.md), CLAUDE.md section 18 |
| Amplify Hosting | Retired (owner disabled it 2026-11-14) | The site is published by `deploy-site.yml` to S3 and CloudFront, only with owner approval. | ADR-019, [deployment-design.md](../infrastructure/deployment-design.md) |
| Phaser as an alternative engine | Retired | Never start a new world, feature or engine abstraction on Phaser. | ADR-020, ADR-029 |
| ADR-038 dual authentication (local Django sign-in for app users) | Retired (superseded by ADR-040) | Cognito is the only application-user authentication. | ADR-040 |
| Play-time limits, session countdown, calm stop | Retired | Children are never counted down, nudged to stop or cut off for time. | ADR-053 |

## 3. Transitional elements

| Element | Status | Rule | Source |
|---|---|---|---|
| Phaser worlds (`phaser` in `package.json`; `react/src/features/island-map/scenes/` and the `*WorldView.tsx` hosts that import it) | Transitional | Bug fixes only. Delete a world only after its Three.js replacement passes parity tests and visual validation and the Sprouts gate (LAI-2303) allows it. | ADR-020, [THREEJS_ENGINE_CONVERSION.md](../THREEJS_ENGINE_CONVERSION.md) |
| Retained Amplify data, buckets and tables in AWS | Transitional | Never delete, change or import them without explicit owner approval. Import code (`lai/apps/users/amplify_import.py`, `lai/apps/assets/amplify_object_migration.py`) exists; running it against real data is an approval step. | CLAUDE.md section 18, ADR-039, ADR-042 |
| Existing Cognito user pool and web app client | Transitional (kept; pool ownership and detach plan open) | Use the existing pool directly. Never modify or recreate it without approval. | ADR-019 gate G2, ADR-024, ADR-040 |
| ADR-019 gates G1, G2, G3, G5, G6, G7, G8, G9, G10 | Open | A task that touches a gate stops until the gate is resolved. G4 is resolved (Python rules, Django content authority). | ADR-019 |
| `CLIENT_AUTHORED` AI context path | Transitional | Kept behind `LAI_AI_ALLOW_CLIENT_AUTHORED` until adventures run on Django sessions. Do not extend it. | ADR-044 items 7 and 11 |
| `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb` dev dependencies | Transitional (legacy; owner to confirm removal) | Do not use them in new code. | `package.json` |

## 4. Frontend

| Element | Status | Rule | Source |
|---|---|---|---|
| React 19, Vite 8, TypeScript strict, React Router 7 | Implemented (main) | One client in `react/`. `strict: true` in every `tsconfig`. | ADR-019 sub-decision 5, `react/tsconfig.app.json` |
| Three.js as the only gameplay renderer | Implemented (main) for every active 3D region on the generic route; Phaser worlds remain (section 3) | Every new playable environment is Three.js. Menus, HUD, dashboards and parent screens stay React. | ADR-020, ADR-032 |
| Engine import boundary | Implemented (main), interim location | Engine modules (`.ts` under `react/src/features/island-map/three/` and `scenes/`) must not import React, Django clients, `api/`, AWS SDKs or Amplify. Enforced by `react/src/test/engineBoundary.test.ts`. | ADR-020, [ARCHITECTURE.md](../ARCHITECTURE.md) "Engine import boundary" |
| Top-level `game/` package | Approved future (LAI-2101) | Not created yet. Do not create it outside its task. | ADR-020 item 4 |
| Engine never validates answers, awards progress or calls AI; it emits typed events | Implemented (main) | `worldEngineEvents.ts` is the event vocabulary. Django grades. | ADR-020 item 6, ADR-012 |
| Styling: `react/src/styles/tokens.css` theme, CSS Modules, Tailwind CSS 4 for shells, portal pages and the admin section | Implemented (main) | `tokens.css` is the only owner of `--color-*`. Tailwind only where ADR-052 and ADR-023 allow it. | ADR-023, ADR-052 |
| Responsive layout: tablet first, also desktop and phone | Implemented (main) for shells; per-feature quality varies | Every new screen must work at tablet, desktop and phone widths, with touch and keyboard. | CLAUDE.md section 11, [UX_AND_ACCESSIBILITY.md](../UX_AND_ACCESSIBILITY.md) |
| Player naming "Realm" (code keeps World, Location, WorldRegion) | Implemented (main) in `react/src/features/realms/` | Do not rename code, tables or routes. Hierarchy: [CANONICAL_CONTENT_MODEL.md](../platform/CANONICAL_CONTENT_MODEL.md), [02_CONTENT_MODEL_STRATEGY.md](../engine/02_CONTENT_MODEL_STRATEGY.md), ADR-041. | ADR-041 |

### 4.1 Shared engine systems

Reuse these. A second movement controller, camera rig, collision system or interaction registry
for one adventure is not allowed.

| System | Status | Location | Rule |
|---|---|---|---|
| First-person movement and box collision (axis-separated slide) | Implemented (main) | `react/src/features/island-map/three/firstPersonController.ts` | The one movement controller. Extend it; never fork it. |
| Location runtime, manifests, validation | Implemented (main) | `react/src/features/island-map/three/runtime/` (`createLocationEngine.ts`, `locationManifest.ts`, `validateLocationManifest.ts`) | New 3D places are manifests plus extensions, not new engines (ADR-032, ADR-009). |
| Interaction evaluation and evidence | Implemented (main) | `react/src/features/interaction/` | Presentation-side only; Django is authoritative for grading. |
| Engine events | Implemented (main) | `react/src/features/island-map/three/worldEngineEvents.ts` | Add typed events here; never call APIs from the engine. |
| Jumping (shared jump controller) | Pending merge | `feature/shared-jump-controller` (PR #26), registry row ADR-063 (Reserved) | Owner direction 2026-11-17: jumping is standard in every adventure, with an accessible non-jump route, no forced timers, no loss of learning progress, safe recovery. Do not build a local jump. |
| Third-person camera and perspective switch | Pending merge | `feature/third-person-avatar` (PR #27), ADR-056 (Reserved) | Wait for the merge; do not add a camera rig. |
| Player avatar catalogue | Pending merge | `feature/player-avatar-assets` (PR #28), ADR-057 (Reserved) | Avatars come through the Asset Manager. |
| Walking, running, sprinting gaits | Pending merge | `feature/player-running` (PR #29), ADR-058 (Reserved) | Gaits of the one controller. |
| Interactive platforms, derived colliders, collision profiles | Pending merge | `feature/interactive-platforms` (PR #37), ADR-059 (Reserved) | Platforms are entries in the shared collider list. |
| Cylindrical player footprint | Pending merge | `feature/treasure-rush-palm-trees` (PR #36), ADR-060 (Reserved) | Configurable on the shared controller. |
| Scoring and rewards (presentation) | Implemented (main) | `react/src/features/rewards/`, `react/src/features/quests/` | No XP, coins, levels, loot boxes or leaderboards (ADR-011, CLAUDE.md section 4). Awards come from Django. |

## 5. Backend

| Element | Status | Rule | Source |
|---|---|---|---|
| Django 6.1 + DRF 3.18 + psycopg 3 in `lai/` | Implemented (main) | One project, `lai/config/`, apps in `lai/apps/`. | ADR-019, ADR-021 |
| PostgreSQL 16 | Implemented (main) locally and in CI; deployed databases are approval steps | All application data lives here. No second datastore without an ADR. | ADR-019 sub-decision 2 |
| One Django backbone | Implemented (main) | Extend the canonical app that owns a responsibility. Never add a second catalog, loader, child-owned base or progress model. | ADR-033, CLAUDE.md section 20 |
| Server-authoritative state | Implemented (main) for answers, hints, region play, quests, world changes, discovery | The server decides correctness, progress, rewards and world changes. The client animates only. | ADR-012, ADR-051, [ARCHITECTURE.md](../ARCHITECTURE.md) "State ownership" |
| API namespace `/api/v1/`, fixed error envelope, request IDs | Implemented (main) | Additive changes stay in v1; a breaking change gets `/api/v2/` beside v1. Contract: [ARCHITECTURE.md](../ARCHITECTURE.md) "Django API conventions". | LAI-0205 |
| Content manifest and platform version negotiation | Approved future (design only) | [MANIFEST_AND_API_VERSIONING.md](../platform/MANIFEST_AND_API_VERSIONING.md) is a pre-Django design and still names Amplify files; treat it as background, not as a contract. Sessions pin content versions (LAI-0813). | ADR-014, ADR-047 |
| Deny-by-default permissions, child scoping | Implemented (main) | `IsAuthenticated` default; child routes use `ChildScopedMixin` (`lai/apps/users/scoping.py`) and `<uuid:child_id>`. | ADR-024, LAI-0403 |
| Migrations | Implemented (main) | One migration per model change, committed with the change; `make migrate-check` must be clean. Destructive migrations need their own approved release ([deployment-design.md](../infrastructure/deployment-design.md) section 4). Never edit a migration that has merged to `main`. | ADR-019 |
| Django Admin for staff | Implemented (main) | Local staff sign-in, separate from Cognito. | ADR-034, ADR-040 |
| Multiplayer room server (`server/multiplayer`, Colyseus) | Implemented (main) as a separate process | The engine only renders it. | ADR-026 |

## 6. Authentication and accounts

| Element | Status | Rule | Source |
|---|---|---|---|
| Cognito user pool used directly from the browser (`react/src/lib/cognito`) | Implemented (main) | No Amplify SDK. Tokens stay in the browser storage keys the client uses today. | ADR-040, AMP-02 |
| Django verifies Cognito access tokens (JWKS, issuer, client, `token_use`) | Implemented (main) | `lai/apps/users/authentication.py`, `jwks.py`. Fail closed. | ADR-024 |
| Parent-owned accounts; `ChildProfile` is a managed profile with no email or login | Implemented (main) | Children never authenticate. Up to three child profiles per parent (CLAUDE.md section 11). | ADR-001, ADR-022, ADR-039 |
| Explicit authorization on every route | Implemented (main) | Section 5 rules plus [security-policy.md](security-policy.md). | ADR-024 |
| Game session ticket and cookie for the game-only WebView | Implemented (main); ADR Proposed | One child, one region; owner acceptance pending. | ADR-036 |
| Recent sign-in for sensitive actions | Implemented (main) in `lai/apps/users/recent_auth.py`; ADR Proposed | Owner acceptance and the live Cognito gate pending. | ADR-043, [RECENT_SIGN_IN.md](../platform/RECENT_SIGN_IN.md) |

### 6.1 Not decided (owner decision required)

None of these is implemented or approved. Do not build them.

| Topic | State |
|---|---|
| Child login, child credentials, child PIN sign-in | Not decided. ADR-022 says children never authenticate. |
| Cognito pool ownership, detach and replacement | Open gate G2 |
| `ParentConsent` design | Open gate G9 (LAI-0308) |
| Android child-facing app | Open gate G3; ADR-036 Proposed |

## 7. Content management

| Rule | Status | Source |
|---|---|---|
| Django Admin is the authoritative authoring system for published content, with immutable revisions and publish and rollback. | Implemented (main) | ADR-047, [DJANGO_CONTENT_AUTHORING.md](../platform/DJANGO_CONTENT_AUTHORING.md) |
| The TypeScript export and `manage.py load_content` are the initial import and migration path; an import never overwrites an administrator's published edit. | Implemented (main) | ADR-033, ADR-047 |
| Staff asset authoring and lifecycle live only in Django Admin; React only consumes published assets. | Implemented (main) | ADR-045 |
| React serves child gameplay and parent screens only. Never rebuild a Django Admin staff function in React (every `/admin/*` address now only points to Django Admin, `react/src/routes/AdminMoved.tsx`). | Implemented (main) | ADR-045 |
| Spatial layouts are not Django-administered: shipped regions keep TypeScript manifests; Treasure Cove stays in `lai/apps/regions/treasure_rush_seed.py`. NPC placement is the one approved exception. | Implemented (main) | ADR-033, ADR-054, LAI-0805 |

## 8. Shared application services

Rule for every row: **reuse, do not duplicate.** A feature that needs one of these extends the
owning app or module. A second implementation needs an ADR.

| Service | Status | Owner (verified paths) | Canonical doc |
|---|---|---|---|
| Asset Manager (asset library, validation, storage, signed delivery) | Implemented (main) | `lai/apps/assets/`, identity on `catalog.ContentAsset`; React resolver `react/src/api/assets/` | [ASSET_LIBRARY.md](../ASSET_LIBRARY.md), ADR-035, ADR-045 |
| NPC Manager (versioned NPC releases, dialogue, behaviour) | Implemented (main) | `lai/apps/npcs/`; `react/src/features/npc-manager/` | [NPC_MANAGER_CONTRACTS.md](../NPC_MANAGER_CONTRACTS.md), ADR-054 |
| Sound Manager (one AudioContext, channels, spatial audio, sound cues and releases) | Implemented (main); ADR-048 and ADR-050 Proposed | `lai/apps/audio/`; `react/src/audio/` | [SOUND_MANAGER_ARCHITECTURE.md](../audio/SOUND_MANAGER_ARCHITECTURE.md), [SOUND_MANAGER_USAGE.md](../audio/SOUND_MANAGER_USAGE.md) |
| AI Question Studio (staff-only question drafting, review, publishing) | Implemented (main) | `lai/apps/question_studio/` | [AI_QUESTION_STUDIO.md](../AI_QUESTION_STUDIO.md), ADR-046 |
| Content authoring (revisions, publish, rollback, import) | Implemented (main) | `lai/apps/catalog/` (`authoring.py`, `importer.py`) | [DJANGO_CONTENT_AUTHORING.md](../platform/DJANGO_CONTENT_AUTHORING.md), ADR-047 |
| Adventure engine (step transitions, answers, hints) | Implemented (main) | `lai/apps/adventures/engine.py`; sessions in `lai/apps/game_sessions/`; React runner `react/src/features/adventures/` | [ADVENTURE_ENGINE.md](../ADVENTURE_ENGINE.md) |
| Quest engine | Implemented (main) | `lai/apps/quests/engine.py`; `react/src/features/quests/` | [05_QUEST_NPC_DISCOVERY_INTEGRATION.md](../engine/05_QUEST_NPC_DISCOVERY_INTEGRATION.md) |
| Scoring and rewards (items, reward rules, collectible sets) | Implemented (main) | `lai/apps/inventory/`, `catalog` reward rules; `react/src/features/rewards/` | [CANONICAL_CONTENT_MODEL.md](../platform/CANONICAL_CONTENT_MODEL.md), ADR-011 |
| Progress tracking (skill evidence, mastery, world changes) | Implemented (main) | `lai/apps/education/`, `lai/apps/progression/` | [08_LEARNING_AND_ADAPTIVE_SYSTEMS.md](../engine/08_LEARNING_AND_ADAPTIVE_SYSTEMS.md), ADR-016, ADR-051 |
| Amazon Bedrock (companion, tutor, Studio drafting) | Implemented (main) behind a fake provider; live use is gated | `lai/apps/ai/` (`providers/`, `contracts.py`, `fallbacks.py`) | [AI_SERVICE.md](../AI_SERVICE.md), ADR-044 |
| Amazon Polly (speech synthesis) | Implemented (main) behind a fake client; ADR-049 Proposed; live verification pending | `lai/apps/speech/` (`polly.py`); React plays through `react/src/audio/speech/` | [AMAZON_POLLY_INTEGRATION.md](../audio/AMAZON_POLLY_INTEGRATION.md) |
| Asynchronous processing (jobs, SQS, Lambda workers, outbox) | Implemented (main) in code; not deployed | `lai/apps/jobs/`; workers `lambda/jobs_worker/` | [CANONICAL_PATH.md](../processing/CANONICAL_PATH.md), ADR-064 (amends ADR-061, ADR-062) |

## 9. Infrastructure

| Element | Status | Rule | Source |
|---|---|---|---|
| AWS CDK in `infra/` (TypeScript), bootstrapless | Implemented (main) as code | Synthesize with `npm run infra:synth:dev` or `:prod`. Never deploy from an agent session. | ADR-037, ADR-055 |
| Production: Django on one EC2 instance per environment behind ALB and WAF, RDS PostgreSQL, released through ECR and SSM with GitHub OIDC | Approved future (code on main, not provisioned) | No stored AWS keys. ECS Fargate stays the production candidate (LAI-1007). | ADR-037, [DJANGO_EC2_DEPLOYMENT.md](../platform/DJANGO_EC2_DEPLOYMENT.md) |
| Dev: native Django on one ARM64 EC2 instance, private RDS, Lambda and SQS, nightly shutdown | Approved future (code on main, nothing deployed) | `infra/lib/devPlatformStack.ts`, `devArtifactsStack.ts`. | ADR-055, [dev-native-environment.md](../infrastructure/dev-native-environment.md) |
| React site on S3 and CloudFront | Approved future (gated by `LAI_SITE_DEPLOY_ENABLED`) | `infra/lib/frontendStack.ts`, `.github/workflows/deploy-site.yml`. | [deployment-design.md](../infrastructure/deployment-design.md) |
| Private S3 buckets: asset storage and child photos | Approved future (code on main) | Separate buckets, Django is the control plane. | ADR-042 |
| Bedrock Guardrail stack | Deployed for dev per the 2026-11-07 QA record (re-verify) | `infra/lib/aiGuardrailStack.ts`. | [inventory.md](../infrastructure/inventory.md) |
| SQS + zip Lambda workers | Approved future (code on main) | Canonical path only; no ECR in dev. | ADR-064 |
| CloudWatch logs and alarms | Approved future with the stacks above | Log content rules: [security-policy.md](security-policy.md). | ADR-025, ADR-019 gate G10 |
| Deploy workflows (`deploy-django-ec2.yml`, `deploy-site.yml`, `deploy-dev-native.yml`, `deploy-dev-lambda.yml`, `manage-dev-infrastructure.yml`) | Present, gated | Pushes to `main` start them by path (`react/**` and the npm manifests for the site; `lai/**`, `content/**`, `requirements*.txt`, `pyproject.toml` and more for Django; `lambda/**` for workers), and they release when `LAI_SITE_DEPLOY_ENABLED`, `LAI_DEV_NATIVE_ENABLED` or `LAI_DEPLOY_ENABLED` is `'true'`. A merge to `main` may therefore deploy. Agents never merge, change the gates or dispatch them. Paths: [testing-policy.md](testing-policy.md) section 4. | CLAUDE.md section 18 |

No Amplify, and no Phaser reintroduction, in any infrastructure or build change.

## 10. Changes that require an ADR

Reserve the number in the registry in [DECISIONS.md](../DECISIONS.md) on `main` first (registry
rule 2), then write the decision with the template in
[templates/adr.md](templates/adr.md). Any of these needs one:

1. A new runtime dependency (npm `dependencies`, `requirements.txt`) or a new framework.
2. A new Django app, a second implementation of any service in section 8, or a new datastore.
3. A change to authentication, token handling, cookies, or the authorization model.
4. A new public (unauthenticated) route, or a new kind of child data stored or sent to a model.
5. A new AI provider, model family, Guardrail policy change, or AI context source.
6. A new rendering, physics, or audio engine, or any change to the engine import boundary.
7. A change to the content authority split (Django Admin versus export, spatial layout ownership).
8. A breaking API change (`/api/v2/`) or a change to the error envelope.
9. A new AWS service, stack, or deployment mechanism; a change to environments or IAM model.
10. Retiring or superseding any accepted ADR, or turning a Reserved number into a decision.
11. A shared movement, camera, collision or jumping behaviour that differs from the shared controller.

## 11. Coordination hotspots

Files and areas that several agents touch. Change them only in the task that owns them, keep the
change small, and say so in the handoff. Merge order and conflict rules:
[integration-policy.md](integration-policy.md), [multi-agent-workflow.md](multi-agent-workflow.md).

| Hotspot | Why |
|---|---|
| `docs/DECISIONS.md` registry | Number collisions across branches (ADR-055 and ADR-063 history). Reserve on `main`. |
| `docs/IMPLEMENTATION_STATUS.md`, `tasks/TASK_TRACKER.md` | Every task updates them. Append; do not rewrite other entries. |
| `react/src/features/island-map/three/firstPersonController.ts`, `runtime/createLocationEngine.ts`, `runtime/locationManifest.ts`, `runtime/validateLocationManifest.ts`, `worldEngineEvents.ts` | Shared movement and runtime; five open movement branches change them. |
| `react/src/features/region-play/` (`regionManifest.ts`, `regionLayout.ts`, audio) | Treasure Rush and every region-play adventure. |
| `react/src/routes/LocationWorldPage.tsx` | Host for all 3D places. |
| `lai/config/settings/base.py`, `lai/config/urls.py` | Every app adds settings and routes. |
| `lai/apps/catalog/models.py`, `lai/apps/regions/models.py` and their migrations | Migration numbering conflicts. |
| `lai/apps/game_sessions/` | Sessions, play API, launch, runtime auth. |
| `lai/apps/jobs/` and `lambda/jobs_worker/` | The one background path (ADR-064); PR #40 and #41 re-land here. |
| `infra/lib/*.ts`, `.github/workflows/*` | Deploy-affecting; owner approval. |
| `package.json`, `react/package.json`, `requirements*.txt`, `package-lock.json` | Dependency policy; lockfile conflicts. |
| `content/exported/`, `tests/golden/*.json` | Generated, byte-exact; regenerate, never hand-edit. |
| `CLAUDE.md`, `AGENTS.md`, `react/src/styles/tokens.css` | Global rules and theme. |
