# Engineering Governance: Initial Repository Audit

- **Status:** Guidance (point-in-time audit record, not a policy)
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-072 (engineering governance, Proposed)
- **Related tickets:** LAI-ENG-001

This audit was taken before the engineering standards in `docs/engineering/` and `docs/adventures/`
were written. It records what existed, so later readers can see which standards restate existing
decisions and which are new. It is a snapshot: facts here may be out of date after 2026-11-18.

## 1. Baseline

| Item | Value |
|---|---|
| Baseline branch | `origin/main` |
| Baseline commit | `466a4972fc75e7bf127322d7b0a0b7917d826e85` ("README and installer: the GitHub CLI is optional for the first dev deployment") |
| Work branch | `feature/engineering-standards` |
| Audit date | 2026-11-18 |

## 2. Repository structure

| Path | Contents |
|---|---|
| `react/` | React 19.2, Vite 8, TypeScript 5.9 (strict), React Router 7, Three.js 0.185, Tailwind CSS 4 (shells, admin, portal; ADR-023, ADR-052), CSS Modules elsewhere. Vitest 4 and Playwright 1.62. `phaser` 4.2 is still a dependency while ADR-020 retirement completes. |
| `react/src/features/island-map/three/` | The Three.js runtime today: `firstPersonController.ts`, region modules (`*Region.ts`), `sceneKit.ts`, `runtime/`, `extensions/`. ADR-020's separate `game/` package does not exist yet. |
| `react/src/audio/` | Sound Manager (`SoundManager.ts`, `sharedSoundManager.ts`, spatial audio, speech playback). |
| `react/src/features/npc-manager/` | NPC Manager client (contracts, dialogue, animation, behavior, voice, host). |
| `react/src/features/realms/` | Realm Explorer (AP-03). "Realm" is the child-facing word for an Island (catalog `World`). |
| `lai/` | Django 6.1, DRF 3.18, psycopg 3, PostgreSQL 16 (ADR-021). Apps: `adventures`, `ai`, `assets`, `audio`, `catalog`, `core`, `education`, `game_sessions`, `inventory`, `jobs`, `npcs`, `progression`, `question_studio`, `quests`, `regions`, `speech`, `users`. |
| `lambda/` | Zip-packaged Lambda workers on the canonical processing path (ADR-064). |
| `infra/` | AWS CDK stacks (ADR-037, ADR-055, ADR-064). Code only; deployments are owner-approved. |
| `server/` | Multiplayer room server (ADR-026). |
| `content/`, `scripts/` | Content export (`npm run content:export`, `content:check`), ADR check, golden vectors, asset importers. |
| `.github/workflows/` | `ci.yml` (checks, e2e, python) on pushes to `main` and on pull requests. `deploy-django-ec2.yml`, `deploy-dev-native.yml`, `deploy-dev-lambda.yml` and `deploy-site.yml` run on **push to `main`** (path-filtered) as well as manually, and deploy only when their repository variables are on (`LAI_DEPLOY_ENABLED`, `LAI_DEV_NATIVE_ENABLED`, `LAI_SITE_DEPLOY_ENABLED`); so, with a variable on, merging to `main` is a release action. `manage-dev-infrastructure.yml` is manual only. No PR template and no `CODEOWNERS`. |
| `docs/` | 64 top-level documents plus `android/`, `audio/`, `engine/`, `images/`, `infrastructure/`, `multiplayer/`, `platform/`, `processing/`, `qa/`, `regions/`. |

## 3. Content hierarchy as implemented

| Standard term | Child-facing word | Django model | Notes |
|---|---|---|---|
| Realm | Realm | `catalog.World` | Called "Island" in API routes, fields and older docs (ADR-041). Rename deferred to an approved naming migration. |
| Place | Place | `catalog.Location` | `IslandLocation` in older domain language. |
| 3D Area | (inside a Place) | `regions.WorldRegion` | At most one per Place (ADR-041). Spawn points, placements, `AdventureLaunchPoint`, `AreaPuzzle`. |
| Adventure | Adventure | `catalog.Adventure`, `catalog.AdventureStep` | Played as `game_sessions.AdventureSession`. |
| Quest | Quest | `catalog.Quest`, `quests.QuestProgress` | Quest Engine composes the other engines (`docs/ARCHITECTURE.md`). |
| Challenge | (activity) | `education.ChallengeSpec`, `regions.AreaPuzzle`, `question_studio.Question` | Graded by application code, never by a model (CLAUDE.md section 7). |

Rewards and progress: `catalog.RewardRule`, `catalog.CollectibleSet`, `catalog.ItemDefinition`,
`inventory.InventoryItem`, `progression.WorldChange`, `education.SkillEvidence`,
`education.SkillProgress`. ADR-011 rejects an XP, coin or level economy.

## 4. Existing engineering policies (preserved)

| Policy | Canonical source |
|---|---|
| Product mission, age bands, AI safety, MVP scope | `CLAUDE.md` sections 1 to 13 |
| Development checks vs merge-readiness gates | `docs/TESTING_STRATEGY.md`, "When to run which checks" (adopted 2026-10-24) |
| ADR numbering, registry and `npm run adr:check` | `docs/DECISIONS.md`, "ADR registry and governance" |
| Django migration tasks and APPROVAL stops | `docs/DJANGO_MIGRATION_ROADMAP.md`, CLAUDE.md section 18 |
| Three.js only, Phaser retirement | ADR-020, ADR-029, CLAUDE.md section 19 |
| One Django backbone | ADR-033, ADR-047, CLAUDE.md section 20 |
| Cognito is the sole application identity provider | ADR-024, ADR-040; Django Admin staff sign-in ADR-034 |
| Django Admin owns staff authoring; React owns child and parent screens | ADR-045, ADR-046, ADR-047 |
| No play-time limits | ADR-053 |
| Background processing | ADR-064 (amends ADR-055, ADR-061, ADR-062); `docs/processing/CANONICAL_PATH.md` |
| Exceptions logged as type and location, never message | ADR-025 |
| Implementation tracking | `docs/IMPLEMENTATION_STATUS.md` |

## 5. Findings

### 5.1 Missing

1. No `AGENTS.md` and no written multi-agent, branch, integration, release or Trello policy.
   Practice exists (stacked PRs #26 to #29 and #37 to #38, `integration/*` branches, owner
   reconciliation of ADR numbers) but is only recorded in Trello cards and commit history.
2. No pull request template, defect template, QA checklist or completion report template.
3. No adventure, Realm, quest, challenge, jumping or scoring standard. Region docs
   (`docs/regions/`, `*_ROADMAP.md`) are per-region, not shared standards.
4. No automated check of documentation links or required documents. `scripts/check-adrs.ts`
   (tested by `react/src/test/adrCheck.test.ts`) was the only documentation check; ADR-072 adds
   `make docs-check` (`scripts/check_engineering_docs.py`).

### 5.2 Conflicting or outdated

1. `CLAUDE.md` is about 370 lines and mixes the product mission with engineering rules. Section 16
   ("First Build Sequence") describes an empty repository and is obsolete. Section 8 lists
   "CSS Modules or a small token-based styling system"; ADR-023 and ADR-052 have since approved
   Tailwind CSS 4 for the admin, shells, homepage and landing page.
2. `CLAUDE.md` uses "island" and `IslandLocation` throughout; the child-facing word is now Realm
   (AP-03) and the catalog model is `World` with `Location` Places (ADR-041).
3. `docs/decisions_adr.md` is a working note restating ADR-027; it is not an ADR and duplicates
   `docs/DECISIONS.md`.
4. ADR-048, ADR-049 and ADR-050 (Sound Manager) and ADR-036 and ADR-043 are `Proposed`, while
   their implementations are on `main`. The code is not evidence of acceptance; owner acceptance
   is still pending for each.
5. ADR-020 calls for a first-class `game/` package. The engine still lives in
   `react/src/features/island-map/three/`. ADR-020's import rules apply "once it is in `game/`".
6. ADR numbers in use on open branches without rows on `main` (registry rule 7):
   ADR-065 (Castle Director, `feature/storykeeper-castle-completion`); ADR-066 to ADR-071
   (processing workstreams, reserved in `docs/processing/COMPLETION_INTEGRATION.md`, with bodies
   in a separate `docs/processing/adr/` directory instead of `docs/DECISIONS.md`); and ADR-070
   again on `feature/firepeak-volcano-adventure` (Heart of Firepeak). **ADR-070 is claimed twice.**
   `feature/north-pole-adventure` also uses ADR-080 and ADR-081. ADR-072 adds `Reserved` rows for
   065 to 071, 080 and 081 and takes 072.
7. `docs/IMPLEMENTATION_STATUS.md` is about 14,000 lines; its opening "Current state" section
   describes Phase 0 to 7 and predates the Django cutover.

### 5.3 Retired or superseded architecture still referenced

- Amplify Gen 2 and Amplify Hosting: retired (AMP-01 to AMP-08). Referenced historically in
  ADR-010, ADR-031 and many `docs/platform/AMPLIFY_*` records, which stay as history.
- Phaser: ADR-007 accepted, retirement mandated by ADR-020. Still a runtime dependency.
- ADR-038 (dual local authentication): superseded by ADR-040.
- ECR-image processing worker and separate processing queues (ADR-061 items, ADR-062 decisions
  2 and 3): superseded by ADR-064.

### 5.4 In flight, not on `main`

| Work | Branch or PR | ADR |
|---|---|---|
| Shared jump controller | PR #26 `feature/shared-jump-controller` | ADR-063 (reserved) |
| Third-person avatar and camera | PR #27 | ADR-056 (reserved) |
| Avatar assets | PR #28 | ADR-057 (reserved) |
| Running and sprinting | PR #29 | ADR-058 (reserved) |
| Platforms, checkpoints, safe respawn | PR #37 | ADR-059 (reserved) |
| Player footprint, Treasure Rush palms | PR #36 | ADR-060 (reserved) |
| Pirate's Leap | PR #38 | none |
| Gameplay integration for owner QA | PR #39 `integration/gameplay-environment-qa` | none |
| Canonical processing | PR #42, #43 (#40, #41 superseded) | ADR-064 |
| Castle Director | `feature/storykeeper-castle-completion` | ADR-065 (unreserved on `main`) |
| Derived artifacts, audio, image, thumbnails, GLB optimization, processing release | `feature/serverless-processing-completion`, `feature/lambda-*` | ADR-066 to ADR-071 (unreserved on `main`) |
| Heart of Firepeak; North Pole | `feature/firepeak-volcano-adventure`, `feature/north-pole-adventure` | ADR-070 (collides with the processing ADR-070); none |

Jumping, running, the third-person camera and platforms are therefore not implemented on
`main`. Standards that depend on them describe the shared controller as the required integration
point and say it is pending merge.

## 6. Branches, worktrees and Trello

- Worktrees live under `/Coding/learning-worktrees/<short-name>`; about 22 exist (firepeak,
  northpole, storybook, npc-manager, treasure-rush, gameengine, integration, `lc-*`, `lambda-*`).
- Branch prefixes in use: `feature/` (44), `claude/` (8), `fix/` (7), `integration/` (4),
  `wip/`, `qa/`, `features/`, `docs/`, plus one-off names.
- Commit subjects are plain imperative sentences; merges read
  `Merge: <summary> (PR #n, Trello <id>)`. Conventional-commit prefixes appear on some branches.
- GitHub: `paulj3000/learning`. The `gh` CLI is not installed and the GitHub connector fails
  authentication on this workstation; pushes work over SSH, PR creation is done by the owner.
- Trello board "Learning Adventure Island — Master Development" has nine lists: Backlog, Ready
  for Development, In Development, Development Complete, Owner QA, Rework Required, Ready to
  Merge, Complete, Blocked. There are no Specification, Integration, Ready for QA or Accepted
  lists. Card titles use `[LAI-AREA-NNN] Title`, `LAI-JMP-NN | Title`, `SEA-NN — Title` and
  `[Subproject] Name`. Labels exist but are unnamed and unused. No engineering standards card
  existed; `LAI-ENG` was unused.

## 7. Test and check commands discovered

| Purpose | Command |
|---|---|
| Targeted frontend unit tests | `npx vitest run --maxWorkers=2 <paths>` (from `react/`) |
| Targeted backend unit tests | `.venv/bin/python -m pytest -q <paths>` |
| Typecheck | `npm run typecheck` |
| Engineering documentation (added by ADR-072) | `make docs-check` |
| ADR registry | `npm run adr:check` |
| Content export | `npm run content:check` |
| Golden vectors | `npm run golden:check` |
| Python merge gates | `make py-check` (Ruff, Ruff format, Django check, migration check, pytest) |
| JS merge gates | `make js-check` (ADR check, admin preview check, typecheck, oxlint, Prettier, Vitest, build) |
| All merge gates | `make check` |
| PostgreSQL-required pytest | `make py-test-db` (needs `make up`) |
| Browser suites (gated) | `npm run test:e2e`, `npm run test:acceptance` |
| CDK synth (no deploy) | `npm run infra:synth:dev`, `npm run infra:synth:prod` |

Correction: Firepeak "The Volcano Awakens" (FP-2 to FP-10) is on `main`; only Heart of Firepeak is
unmerged.

## 8. Decisions this initiative needs from the owner

Listed in `docs/engineering/README.md` ("Owner approval checklist").

## 9. Conflicts found while writing the standards (not resolved here)

The standards follow the accepted ADR or the code in each case. None of these documents was
edited by ADR-072's branch.

| # | Conflict | Where |
|---|---|---|
| 1 | **A test parent account's email and password are in tracked allow rules.** They should be rotated and removed. | `.claude/settings.json` (committed 2026-11-11) |
| 2 | ADR-070 is claimed by two open branches (processing GLB optimization; Heart of Firepeak). | See 5.2 item 6 |
| 3 | The processing branches keep ADR bodies in `docs/processing/adr/`, a second ADR location. | `feature/lambda-*` branches |
| 4 | Four deploy workflows run on push to `main` (path-filtered) when their repository variables are on, so a merge can be a release action. | `.github/workflows/deploy-*.yml` |
| 5 | ADR-041 A says the catalog `World` reads as "Island" in copy and Admin; AP-03 made the child-facing word "Realm" without an ADR, and Admin labels still say "island". | `docs/DECISIONS.md`, `react/src/features/realms/` |
| 6 | "End sessions at calm narrative checkpoints", and session-limit wording, survive after ADR-053 retired session limits. | `docs/UX_AND_ACCESSIBILITY.md`, `docs/THREAT_MODEL.md` (AP-04 entry), `docs/audio/CHILD_AUDIO_PREFERENCES.md` |
| 7 | "Per-child sign-in is still ahead" contradicts ADR-022 ("Children never authenticate"); no ADR approves child login. | `docs/IMPLEMENTATION_STATUS.md` (around lines 9438 and 9476) |
| 8 | "Proposed backend migration (not in effect)" heading is stale after ADR-019 and AMP-01 to AMP-08; "Security defaults" names `IsAuthenticated` where settings use `IsProvisionedParent`. | `docs/ARCHITECTURE.md` |
| 9 | ADR-043 and ADR-052 registry notes say "not merged" but their code is on `main`. | `docs/DECISIONS.md` registry |
| 10 | Threat model, authorization review and IAM audit review the retired Amplify backend; the AWS inventory (2026-11-09) still lists Amplify Hosting. | `docs/THREAT_MODEL.md`, `docs/AUTHORIZATION_REVIEW.md`, `docs/IAM_ROLE_AUDIT.md`, `docs/infrastructure/inventory.md` |
| 11 | ADR-028 described as "still Proposed" (it is Accepted), and the retired Amplify upload flow is still described. | `docs/THREE_WORLD_ASSET_CONVENTIONS.md` |
| 12 | ADR-046 says `LearningObjective` rows come only from the export; ADR-047 made them authorable in Django Admin. | `docs/DECISIONS.md`, `docs/AI_QUESTION_STUDIO.md` |
| 13 | Out-of-date asset and content references (old `public/models/` paths, "no audio code", `amplify/data/chattyPersona.ts`). | `docs/ASSET_SOURCING.md`, `docs/CONTENT_SOURCES.md` |
| 14 | `content/models/npc-pip-pirate.glb` has no licence row. | `docs/ASSET_LICENCES.md` |
| 15 | `.claude/settings.json` blocks only mutating AWS CLI commands; `docs/infrastructure/dev-acceptance.md` says it denies all `aws` commands. | `.claude/settings.json`, `docs/infrastructure/dev-acceptance.md` |
| 16 | The parent gate rule ("external navigation") is narrower in practice: AP-04 removed the gate on the adult exit. | `docs/UX_AND_ACCESSIBILITY.md` |
