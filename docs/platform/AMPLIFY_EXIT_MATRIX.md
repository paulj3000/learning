# Amplify exit: dependency inventory and Django parity matrix (AMP-01)

Date: 2026-11-10. Trello: [AMP-01](https://trello.com/c/T8Zf1zs4). **Read-only audit**: no code
path, package, stack or AWS resource was changed. Input for AMP-02 to AMP-08.

Baselines compared:

| Ref | SHA | Relation to `main` |
|---|---|---|
| `main` | `89d1172` | Baseline |
| `dev20261103` | `96aa587` | 24 ahead, 10 behind |
| `claude/jolly-ride-92xktb` | `804aaea` | The live `dev20261103` integration kept merged with `main` (28 ahead, 0 behind) |
| Every other remote branch (31 in all) | | Most are 0 ahead (fully merged). The ones ahead are listed in section 6 |

Coordinates with `docs/infrastructure/inventory.md` (LAI-INFRA-001) and
`resource-ownership.md` (LAI-INFRA-002) and does not repeat them. Those cover AWS resources;
this covers code.

Evidence is from `git grep` over each ref (call sites, imports, routes). "Django path" means a
React code path that `VITE_BACKEND=django` (`react/src/api/config.ts`) switches to. **No live
DynamoDB, AppSync or Cognito data was read**: the session cannot run AWS commands.

## 1. Summary

- **22 React and script files import Amplify** (on `main`): 18 source, 4 test. The only other
  match, `react/src/test/engineBoundary.test.ts`, holds Amplify imports only as forbidden-import
  fixtures.
- **Auth is 100% Amplify Auth** (Cognito through `aws-amplify/auth`): 12 React source files, 2
  scripts, 3 tests. Django only verifies the Cognito **access** token. → AMP-02.
- **Amplify Data:**
  - All 22 models are called from React.
  - There are 3 custom operations (`claimCoopSlot`, `submitAdventureAnswer`,
    `getNextLearningActivity`), one subscription (`CoopSession.onUpdate`) and 2 AI generation
    routes.
  - **12 capabilities already switch to Django** (section 3.1). **18 modules or module groups have no
    Django path** (section 3.2). → AMP-03.
- **Amplify Storage:** child photos (switched to Django) and 3D model URLs (switched through the
  Django asset resolver). The Amplify code paths remain. → AMP-04.
- **Amplify Functions:**
  - The adventure answer has a Django replacement (`AnswersView` on `main`; the step runner on
    `dev20261103`).
  - The co-op slot claim does not: there is a Django model, but no route.
  - **The director's "next learning activity" has no Django equivalent.**
  - Operational metrics have Django logging but no metric parity.
  - → AMP-05.
- **Hosting and build:** `amplify.yml`, `customHttp.yml`, `amplify-hosting/custom-rules.json`,
  the `sandbox` script, `amplify/` typecheck, and the site release's `ampx generate outputs`.
  → AMP-06 and AMP-07.
- **Data migration:** only parent and child profiles have an importer
  (`import_amplify_profiles`). Progress, sessions, world state, NPC, quest, inventory, story and AI
  audit records have none. Whether any real family data exists in DynamoDB is **unknown**.

## 2. Packages, build and CI

| Item | Where (`main`) | Replacement | Owner card |
|---|---|---|---|
| `aws-amplify` ^6.20.0 | `package.json`, `react/package.json` | Remove after AMP-02, 03 and 04 | AMP-07 |
| `@aws-amplify/backend` ^1.24.0, `@aws-amplify/backend-cli` ^1.9.0 | same (dev deps) | Remove after the Gen 2 backend is retired (AMP-08) | AMP-07 |
| `npm run sandbox` (`ampx sandbox`) | `package.json` | Remove | AMP-07 |
| Typecheck of `amplify/tsconfig.json` | `react/package.json` `typecheck` | Drop with `amplify/` | AMP-07 |
| Amplify Gen 2 backend (`amplify/backend.ts`, `auth`, `data`, `storage`, `functions/*`) | `amplify/` | Django apps (section 3) and the CDK stacks | AMP-03, 05, 08 |
| `amplify.yml` (`ampx pipeline-deploy` and the frontend build) | root | `deploy-site.yml` (gated, LAI-INFRA-004); backend deploy until AMP-08 | AMP-06 |
| `customHttp.yml`, `amplify-hosting/custom-rules.json` | root | `LaiFrontend` response headers policy and SPA rewrite (LAI-INFRA-003) | AMP-06 |
| `amplify_outputs.json` (generated, gitignored) | read by `react/src/lib/amplify-config.ts` | None needed once AMP-02 configures Cognito directly. **Until then the site release depends on `ampx generate outputs`** (`.github/actions/site-release`) | AMP-02, AMP-06 |
| `scripts/live-smoke.ts` | Amplify sign-in plus Data | Django smoke (`scripts/aws/verify-dev.sh` covers the API side) | AMP-07 |
| `scripts/ai-red-team.ts` | Amplify sign-in; `--target django` already supported | Keep the Django target; replace the sign-in in AMP-02 | AMP-02 |
| `.github/workflows/ci.yml` | No Amplify step | n/a | n/a |

## 3. Capability matrix

### 3.1 Already switchable to Django (`VITE_BACKEND=django`)

| Capability | React selector | Django route(s) on `main` | Django tests | Amplify code still present |
|---|---|---|---|---|
| Parent account link | `features/auth/DjangoAccountContext.tsx` | `POST`, `GET` and `PATCH /api/v1/me/` | `users/test_users`, `test_profile_management` | n/a (Django-only) |
| Child profiles (list, create, update, delete) | `features/child-profile/api.ts` `profileStoreFor` | `children/`, `children/<id>/` (`DELETE` included) | `users/test_children_api`, `test_child_deletion`, `test_tenant_isolation` | `amplifyProfiles.ts` |
| Child photo | same store | `children/<id>/photo/`, `photo/content/` | `users/test_child_photos` | `avatarPhoto.ts` (Amplify Storage) |
| Companion and tutor AI turns | `api/ai/djangoAi.ts` | `children/<id>/ai/companion-turns/`, `ai/tutor-turns/` | `ai/test_companion_api` and others | `companion/api.ts`, `tutor/api.ts` generation routes |
| AI history and safety events (parent) | `parent-dashboard/api.ts` `aiHistoryStoreFor` | `ai/history/`, `ai/safety-events/` | `ai/test_parent_ai_api` | `listSafetyEvents`, `clearAIHistory` (Amplify) |
| 3D asset resolution | `api/assets/djangoAssetResolver.ts` | `children/<id>/assets/`, `asset-files/<token>/<file>` | `assets/test_resolver_api` and others | `assets/assetService.ts` (Data plus Storage `getUrl`) |
| Audio manifests and settings | `api/audio/*` | `audio/manifests/*`, `audio/settings/` | `audio/*` | n/a |
| Speech | `api/speech/speechApi.ts` | `audio/speech/`, `speech-files/...` | `speech/test_speech_api` | n/a |
| Region play (session, pickups, NPC talk, chests, quests, answers) | `api/play/playApi.ts`, `region-play/regionRepositoryForChild.ts` | `regions/...`, `sessions/<id>/...`, `attempts/<id>/answer/`, `quests/<id>/accept/`, `progress/` | `game_sessions/test_play_api`, `test_chest_play`, `test_sessions`, `quests/*` | n/a |
| Castle rooms and storybook | `api/play/castleRoomsApi.ts`, `storybookApi.ts` | `castle/rooms/`, `castle/storybook/` | `game_sessions/test_castle_*` | `story/api.ts` (see 3.2) |
| Discoveries | `api/play/discoveriesApi.ts` | `discoveries/` | `game_sessions/test_discoveries*` | `discovery/api.ts` (see 3.2) |
| Islands, home, inventory read, launch | `api/play/islandsApi.ts`, native routes | `islands/`, `home/`, `inventory/`, `regions/<id>/adventures/`, `launch-points/.../start/`, `game-launches/` | `game_sessions/test_native_api`, `test_adventure_launch`, `test_game_launch` | `rewards/api.ts` (see 3.2) |

### 3.2 Amplify only on `main` (no Django switch in React)

| Module (`react/src/features/`) | Amplify calls | Django equivalent | Gap | Card |
|---|---|---|---|---|
| `auth/*` (sign-up, confirm, sign-in, sign-out, reset, attributes, password, `Hub`), `api/auth.ts`, `multiplayer/amplifyIdentity.ts`, `routes/AccountSettings.tsx`, `recentSignIn/recentSignIn.ts` | `aws-amplify/auth` (12 source files) | Cognito stays. Django verifies access tokens (`users/authentication.py`, `test_cognito_only`) | **Every flow**: direct Cognito client, token refresh, `Hub` replacement | AMP-02 |
| `child-profile/deletion.ts` | `deleteUser` plus deletes over 13 models | Child: `DELETE children/<id>/` (`test_child_deletion`) | **Parent account deletion: no Django route** (`MeView` has no `DELETE`); Cognito `deleteUser` moves with AMP-02 | AMP-02, AMP-03 |
| `adventures/api.ts` (sessions, actions, answer, skill evidence, world changes, story artifacts) | `AdventureSession`, `AdventureAction`, `submitAdventureAnswer`, `SkillEvidence`, `WorldChange`, `StoryArtifact` | Models exist (`game_sessions`, `education`, `progression`). Routes: `sessions/<id>/`, `sessions/<id>/answers/`, `hints/` on `main`; **the step runner `sessions/<id>/step/` and `content/adventures/<slug>/start/` only on `dev20261103`** (`react/src/api/play/stepRunnerApi.ts`) | React wiring for the classic adventures. Story-artifact save, list and delete have no route | AMP-03 |
| `story/api.ts` | `ChildStoryProgress` | `progression.StoryProgress`; `castle/storybook/`; `content/stories/` (dev only) | Write path (start, flag, chapter, complete) for non-castle stories | AMP-03 |
| `quests/api.ts` | `ChildQuestState` | `quests.QuestProgress`; `quests/<id>/accept/`, `progress/`; `content/quests/` (dev only) | Sync and clear outside region play | AMP-03 |
| `rewards/api.ts` | `ChildInventory` | `inventory.InventoryItem`; `inventory/` (read) | Grants outside region play (Django grants server-side in play) | AMP-03 |
| `npc/api.ts` | `ChildNpcState` (memory flags, dialogue nodes) | `progression.NpcRelationship`; `npcs/<id>/talk/`; `content/npcs/` (dev only) | Memory-flag writes for the non-region worlds | AMP-03 |
| `discovery/api.ts` | `ChildWorldState` | `progression.WorldState`; `discoveries/` | Checkpoint and character-met writes, clear | AMP-03 |
| `mastery/api.ts` | `SkillProgress` | `education.SkillProgress`; `progress/` (read) | Client-side upsert: should become server-side only | AMP-03 |
| `island/api.ts` | `CompanionProfile` | **No Django model** | **Companion choice storage** | AMP-03 |
| `coop/api.ts` | `CoopSession`, `claimCoopSlot`, `onUpdate` subscription | `game_sessions.CoopSession` and `CoopParticipant` models; `server/multiplayer` (room server, ADR-026) | **No co-op route and no realtime replacement** for the AppSync subscription | AMP-03, AMP-05 |
| `director/api.ts` | `getNextLearningActivity` (Lambda) | **None** | **Adaptive "what next"** has no Django service | AMP-05 |
| `catalog/availabilityApi.ts` | `Island`, `Adventure` list | `catalog` (World, Location, Adventure); `islands/`, `regions/<id>/adventures/`; `content/adventures/` (dev only) | React wiring | AMP-03 |
| `admin/api.ts` (parent and child lists) | `ParentProfile`, `ChildProfile` | Django Admin (`users/test_admin_accounts`, ADR-034) | Retire the React admin pages; owner confirms Django Admin covers the reviews | AMP-03 |
| `admin/catalogApi.ts` (island and adventure CRUD, model assignment, content import) | `Island`, `Adventure`, `AdventureModel`, `Asset` | Django Admin catalog and assets (ADR-043, AM-5); content export and `load_content` (ADR-033) | Retire after the owner confirms parity | AMP-03 |
| `parent-dashboard/api.ts` (`listSafetyEvents`, `clearAIHistory`) | `SafetyEvent`, `AIInteractionAudit` | `ai/safety-events/`, `ai/history/` (history is already switched) | Safety events and clear: switch them too | AMP-03 |
| `assets/assetService.ts` | `Asset`, `AssetVersion`, Storage `getUrl` | Django resolver (3.1) | Delete the Amplify path | AMP-04 |
| `child-profile/avatarPhoto.ts` | Storage `uploadData`, `getUrl`, `remove` | `children/<id>/photo/` (3.1) | Object migration (identity-pool keys to child ids) | AMP-04 |

### 3.3 Amplify functions

| Function | Django replacement | Status |
|---|---|---|
| `submit-adventure-answer` | `sessions/<id>/answers/` (`AnswersView`, `test_answers_api`); step runner on `dev20261103` | Replaced server-side; React wiring is in AMP-03 |
| `claim-coop-slot` | None (model only) | **Gap** |
| `get-next-learning-activity` | None | **Gap** |
| `operational-metrics` (DynamoDB stream to CloudWatch EMF) | Django privacy-filtered logs; the `LaiAiGuardrail` AI metric filters | Partial: no SafetyEvent or AppSync-equivalent alarms on Django yet (U6) |
| AI Kit generation routes | `ai/companion-turns/`, `ai/tutor-turns/` | Replaced (3.1) |

## 4. Prioritized gap list

| # | Gap | Why first | Card |
|---|---|---|---|
| G1 | Auth flows on Amplify Auth (12 source files, 2 scripts); the site build needs `amplify_outputs.json` | Blocks removing `aws-amplify`, and the site release depends on it | AMP-02 |
| G2 | Classic adventure path (`adventures/api.ts`) on Amplify. The step runner exists only on `dev20261103` | Core gameplay; merge the integration first, then wire | AMP-03 (after the `dev20261103` merge gate) |
| G3 | Parent account deletion has no Django route | Privacy and right-to-delete | AMP-03 (with G9 / LAI-0308) |
| G4 | Per-child state writers (story, quests, rewards, NPC, discovery, mastery) outside region play | Data would split between DynamoDB and PostgreSQL | AMP-03 |
| G5 | Companion choice has no Django model | Small; needed for onboarding parity | AMP-03 |
| G6 | Director "next learning activity" has no Django service | Adaptive learning | AMP-05 |
| G7 | Co-op: no route, no realtime replacement | Feature-scoped; needs a decision (Django polling vs. the room server) | AMP-05 (owner decision) |
| G8 | Data importers for everything except profiles | Needed only if DynamoDB holds real family data (unknown) | AMP-03, AMP-08 |
| G9 | Amplify Storage objects (photos, models) | Migration with checksums | AMP-04 |
| G10 | React admin pages vs Django Admin | Retire after owner confirmation | AMP-03 |
| G11 | Metrics and alarms parity | Before Amplify monitoring is removed | AMP-05, AMP-08 |

## 5. Resources that must be preserved (until their card says otherwise)

| Resource | Why | Until |
|---|---|---|
| Cognito user pool and app client(s) of the Amplify `main` backend | Every parent sign-in; Django verifies its tokens | Permanently. Detach before any Amplify stack deletion (INFRA-002 D5) |
| Cognito identity pool | Amplify Storage photo access (identity-scoped keys) | AMP-04 migration done |
| Amplify Storage bucket `learningAdventureIslandMedia` | Existing child photos and admin models (ADR-042) | AMP-04 copy verified |
| The 22 DynamoDB tables | Possibly real family data; no importer except profiles | Exported, imported, reconciled (AMP-08) |
| AppSync API, Lambdas, Table Manager | Serve every flow in 3.2 | AMP-03 and 05 |
| `OperationalAlertsTopic`, Bedrock budget, dashboard | The only alerting for Amplify traffic | AMP-08 |
| Amplify Hosting app (`main`) | Serves the live site and deploys the Gen 2 backend | AMP-06 cutover accepted, AMP-08 |

## 6. Branch comparison

| Branch | Ahead of `main` | Amplify call inventory vs `main` |
|---|---|---|
| `dev20261103`, `claude/jolly-ride-92xktb` (integration) | 24, 28 | Same Amplify calls; **one more Django switch** (`api/play/stepRunnerApi.ts`) and **14 more Django routes** (`content/*`, `sessions/<id>/step/`, `content/adventures/<slug>/start/`, `puzzles/<id>/solve/`) |
| `feature/npc-manager`, `qa/npc-manager-acceptance`, `fix/npc-qa-fa-fb`, `feature/sm-p8-live-polly` | 44 to 52 | Same as the integration (one more Django switch) |
| `feature/content` | 19 | Fewer Django switches (older) |
| `feature/ai-studio-queue`, `feature/sound-manager` | 1 | Fewer Django switches (older base) |
| `feature/adr-043-django-content-authoring` | 6 | **More** Amplify (`Asset.create`, `AssetVersion.create`, Storage): removed on `main` |
| `feature/lai-0605-world-quests-discovery` | 16 | **More** Amplify (older AI and asset paths): superseded on `main` |
| `feature/adventure-portal`, `ccr-c3809215-w908lq` | 1 | Identical |
| `phase-23-24-and-child-photos`, `phase-29-multiple-islands-and-worlds` | 62, 64 (295 behind) | August 2026 Amplify-era branches; nothing to carry forward for the exit |

No branch removes an Amplify dependency that `main` still has. The integration's step runner and
content routes are the only Django parity not yet on `main` (G2).
