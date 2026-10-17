# Django Target Architecture

Status: **Proposed.** Nothing here is implemented. Rationale and evidence:
`docs/DJANGO_MIGRATION_ASSESSMENT.md`. Decisions: `docs/DECISIONS.md` ADR-019. Sequence:
`docs/DJANGO_MIGRATION_ROADMAP.md`. Conventions mirror the sibling FinWin project
(`/Coding/flintwin`), adapted where this product differs.

**Amended by ADR-020 (Accepted):** Three.js is the only gameplay renderer, Phaser is
retired after conversion, and `game/` is a first-class engine package. Detail:
`docs/THREEJS_ENGINE_CONVERSION.md`.

Design bias: **simplicity first.** One Django service, one PostgreSQL database, Cognito and
S3 retained, no queues, no microservices, no Kubernetes. Add a component only when a named
requirement in this repo needs it.

## 1. Shape

```text
Browser: React 19 + TS (react/: menus, HUD, admin)  +  game/ (unified Three.js engine)
   |  HTTPS, Cognito JWT in Authorization header
   v
CloudFront --- /          --> S3 (static React build, later /models)
           \-- /api/*     --> ALB --> Django + DRF (lai/)  --> PostgreSQL (RDS)
                                          |-- Cognito JWKS (token validation)
                                          |-- S3 (presigned URLs: child photos, assets)
                                          |-- Bedrock (AI service, boto3)
                                          '-- CloudWatch (logs, metrics)
```

## 2. Repository layout

```text
learning-adventure-island/
  README.md  CLAUDE.md
  docs/                       existing docs kept; migration docs added
  tasks/                      TASK_TRACKER.md (LAI-XXXX), later CSV + checker
  react/                      moved from repo-root src/, public/, index.html, vite config
    src/api/                  client.ts auth.ts islands.ts adventures.ts quests.ts
                              inventory.ts progression.ts assets.ts (new)
    src/features/...          existing feature folders, unchanged internally
  game/                       Unified Three.js engine (ADR-020). Extracted from
                              react/src/features/island-map/three after LAI-0201.
                              No imports from react, Django clients, Amplify, or AWS SDKs.
                              Sub-areas are created only when a file needs them
                              (see THREEJS_ENGINE_CONVERSION.md section 4)
  lai/                        Django project
    manage.py
    config/{asgi,wsgi,urls}.py
    config/settings/{base,local,production,test}.py
    apps/{core,users,islands,adventures,quests,inventory,progression,
          assets,game_sessions,education,audit,ai}/
  infra/                      CDK (TypeScript, as FinWin): network, rds, s3, ecr, ecs, ec2
  ci/                         image build / deploy scripts
  deploy/{dev,prod}/          CodeDeploy / ECS definitions
  tests/                      cross-system: API contract, golden vectors, tenant isolation
  amplify/                    UNTOUCHED until cutover, then removed (Phase 12)
```

## 3. Django apps and ownership

Derived from actual entities (assessment section 6 and 13). Each app owns its models,
serializers, services (business rules as plain functions), and tests. Cross-app access goes
through service functions; the only shared FK target is `users.ChildProfile`.

| App | Owns | Notes |
|---|---|---|
| `core` | `TimeStamped`/UUID base models, pagination, error envelope, health, request-log middleware | Replaces `shared/requestLog.ts` |
| `users` | `ParentAccount`, `ChildProfile`, `CompanionProfile`, `ParentConsent`, Cognito auth backend | `ParentAccount.cognito_sub` unique |
| `islands` | `IslandLocation`/World catalog, activation flag | Seeded from exported content |
| `adventures` | `AdventureTemplate` + versions, steps (JSON validated by schema) | Authoritative step data for the Python validator |
| `quests` | Quest catalog, `QuestProgress` | |
| `inventory` | `ItemDefinition`, `InventoryItem`, `GrantedRule`, reward-rule resolution | Absorbs "rewards"; no randomness (ADR-011) |
| `progression` | `WorldChange`, `WorldState`, `StoryProgress`, `NpcRelationship` | |
| `assets` | Asset catalog (id, kind, version, hash, LOD, clips), presign service | Metadata in Postgres, bytes in S3 |
| `game_sessions` | `AdventureSession`, `AdventureAction`, `CoopSession` | Co-op splits to `multiplayer` only when realtime is real |
| `education` | `LearningObjective`, `SkillEvidence`, `SkillProgress`, `StoryArtifact`, parent summaries | |
| `audit` | `AIInteractionAudit`, `SafetyEvent`, admin review queue | |
| `ai` | Bedrock client, prompt/persona registry, schema validation, safety checks, authored fallbacks | New domain; CLAUDE.md section 7 rules apply verbatim |

## 4. Authentication and authorization

```text
Cognito (unchanged) --JWT--> Django (DRF authentication class) --> ParentAccount
```

- Validate the JWT against the pool JWKS (cached), check `iss`, `token_use`, `client_id`/`aud`,
  and expiry. Library choice (for example `PyJWT[crypto]`) is a dependency decision taken
  explicitly in LAI-0402, not assumed here.
- First valid request upserts `ParentAccount(cognito_sub)`.
- Groups: `cognito:groups` contains `Admins` maps to a permission class `IsAdmin`. Django
  `is_staff`/`is_superuser` are **separate** and are granted out of band for Django admin
  only. Destructive admin operations require superuser.
- Authorization is **deny by default**: a base `ChildScopedViewSet` filters every queryset by
  `parent__cognito_sub == request.user.sub` and 404s (not 403s) on foreign ids. No endpoint
  may bypass it; a test enumerates all routes and fails if an unscoped one exists.
- Child "profiles" are never authenticated principals (ADR-001). The child gate remains a
  client convenience; the server always authorizes as the parent.
- Cognito config in the frontend moves from `amplify_outputs.json` to Vite env vars
  (`VITE_COGNITO_*`, `VITE_API_BASE_URL`).

## 5. API conventions

- DRF, JSON, URL-prefix `/api/v1/` (versioning aligns with `docs/platform/MANIFEST_AND_API_VERSIONING.md`).
- Platform-neutral operation names (kept from the Android-minded audit): for example
  `POST /api/v1/sessions/{id}/answers`, `GET /api/v1/children/{id}/next-activity`,
  `POST /api/v1/children/{id}/companion-turns`.
- Typed error envelope with safe user-facing messages (CLAUDE.md section 13).
- Idempotency keys on world-change, reward, and discovery writes (the Amplify code relies
  on deterministic keys such as `recordWorldChangeOnce`; keep that property).
- Pagination on all list endpoints (fixes the unbounded admin `.list()` noted in ADR-018).
- OpenAPI schema generated and committed; the React `src/api/*` types are checked against it
  in CI (contract test).

## 6. Authoritative game logic

The central design problem (assessment section 5.3).

```text
content (TS modules today)
   --export (LAI-0302)--> versioned JSON content package + schema
   --load--> Postgres catalog tables (adventures, quests, items, objectives)
validators / reward resolution / quest sync / mastery counters
   --reimplement--> lai/apps/*/services.py   (pure functions, no ORM)
   <--golden vectors (tests/golden/*.json)--> the existing TS functions
```

- The client keeps its TS decision modules for instant feedback and offline-tolerant UX.
- The server owns the outcome. The same input vectors run against TS (Vitest) and Python
  (pytest) in CI; any divergence fails the build.
- Phase order: read-only catalog first, then progress writes one engine at a time
  (adventures, mastery, rewards, quests, NPC, discovery), each behind its own contract tests.
- This turns the five remaining client-authoritative write paths into server-authoritative
  ones as a natural by-product, closing the ADR-012 / platform-audit gap.

## 7. AI service

- `ai` app exposes `companion-turns` and `tutor-turns` endpoints; the browser never calls
  Bedrock (CLAUDE.md section 7).
- Same model (`anthropic.claude-haiku-4-5-20251001-v1:0`, global inference profile), same
  temperature/max tokens, same personas (copied verbatim from `amplify/data/*Persona.ts`,
  versioned).
- Pipeline kept: safe context builder -> input check -> Bedrock -> JSON schema validation ->
  content/safety check -> authored fallback -> `AIInteractionAudit` row. Fallback behaviour
  must **also** emit a metric so a silent `AccessDeniedException` (as happened with the
  tutor route) is visible.
- IAM: one task-role policy granting `bedrock:InvokeModel` on the three ARNs documented in
  `amplify/backend.ts` `grantBedrockInvoke`.
- The existing red-team script (`scripts/ai-red-team.ts`) is re-pointed at the new endpoint
  before cutover.

## 8. Storage

- Child photos: private bucket; Django authorizes by `ChildProfile` ownership and returns
  short-lived presigned PUT/GET URLs. Keep the browser-side 256 px JPEG re-encode.
- Game assets: remain static in `react/public/models` until real art exists; then S3 +
  CloudFront with immutable, content-hashed keys. `assets` rows mirror `manifest.ts`.
- User-generated content: `StoryArtifact` stays a JSON column (it is text scenes, not
  binary). Revisit only if media creation is approved (currently out of scope in CLAUDE.md
  section 12).

## 9. Realtime

- Today's co-op needs slot claims and low-frequency shared-state updates. Phase 6 replaces
  `claimCoopSlot` with a transactional `SELECT ... FOR UPDATE` (or conditional UPDATE) in
  Django and replaces the GraphQL subscription with Server-Sent Events or short polling
  behind the same `subscribeToCoopSession` function signature.
- Django Channels + Redis is **deferred** until a requirement exceeds that (for example,
  cross-family sessions or position sync). If adopted: Channels for sessions, Redis for
  transient presence only, persistent state stays in PostgreSQL via DRF.

## 10. Admin

- React admin keeps the product views (progress summaries, safety review).
- Django admin: internal engineering tool, catalog tables first. Child free text and raw AI
  audit rows are not exposed. Superuser required for delete. Admin actions write
  `audit` log entries.

## 11. Infrastructure

Development (matches FinWin): CloudFront/S3 for React, ALB or reverse proxy to a Docker
Django container on one EC2 instance, RDS PostgreSQL (single-AZ, smallest class), Cognito,
S3, CloudWatch.

Production (candidate, not committed): CloudFront with `/api/*` to ALB to ECS Fargate
service, RDS PostgreSQL (Multi-AZ), Cognito, S3, CloudWatch, Secrets Manager.

Explicitly **not** introduced: Kubernetes, microservices, additional databases, queues,
service mesh, per-feature Lambdas, event buses. Revisit each only when a documented
requirement cannot be met otherwise.

IaC: CDK in TypeScript (`infra/`), consistent with FinWin and with this team's existing CDK
familiarity (current `amplify/backend.ts` is already CDK). One stack per concern
(network, data, app, edge); resource count and IAM role count are tracked in
`docs/IAM_ROLE_AUDIT.md`.

## 12. Observability and cost

- Request logging middleware replicates `requestLog.ts` fields; no child free text, audio,
  names, or identifiers in logs (CLAUDE.md section 13).
- Keep CloudWatch namespaces `LearningAdventureIsland/AI` and `/Safety` and the four
  alarms plus Bedrock budget, repointed from AppSync to ALB/target-group metrics.
- Added fixed costs vs Amplify (RDS, ALB, instance/Fargate) are real; Amplify's pay-per-use
  DynamoDB/AppSync is cheaper at pilot scale. Cost estimate belongs in LAI-0900.

## 13. Local development

`docker compose` runs PostgreSQL; `make check` runs ruff, pytest, and the existing npm
checks (same pattern as FinWin). Local auth uses a real Cognito dev pool or a documented
test-token issuer in `test` settings only; the production path never accepts unsigned tokens.

## 13a. Engine and platform responsibilities

| Layer | Owns | Does not own |
|---|---|---|
| `game/` | Rendering, scene lifecycle, input profiles, camera, collision, interaction targeting, animation, asset loading, typed event output | Answer validation, rewards, mastery, AI calls, persistence, auth |
| `react/` | Routes, menus, HUD overlays, dashboards, admin UI, calling `react/src/api`, hosting the engine, passing a loaded `WorldDefinition` in and reacting to engine events | Frame loop, physics, scene graph |
| `lai/` (Django) | Islands, adventures, quests, inventory, progression, authoritative rules, catalog and `WorldDefinition` content, audit, AI service, admin | Anything about how a world is drawn |

Content flow: catalog rows (islands, adventures, `WorldDefinition`s) are served by DRF; React
loads one and hands it to `game/`. A new island or adventure is data in `lai/` plus assets in
S3, not new infrastructure.

## 14. What stays the same

The Three.js engine modules (moved to `game/`, not rewritten), scene assets, React routes and UI, design tokens, Cognito,
S3, CloudWatch, Bedrock model, safety rules, age-band adaptation rules, the adventure
content, and the test suite.
