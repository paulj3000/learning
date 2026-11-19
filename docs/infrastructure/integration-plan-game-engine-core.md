# Integration plan: Game Engine Core and the realm branches

- **Status:** Proposed
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-033, ADR-055, ADR-063 (reserved), ADR-065 (reserved), ADR-070 (reserved, collision), ADR-072, ADR-080 (reserved), ADR-081 (reserved)
- **Related tickets:** LAI-ENG-002, GE-100, SEA-04, FPV-*, SC-R*, SC-JMP-*, LAI-JMP-*, LAI-LAMBDA-014
- **Canonical sources:** [integration-policy](../engineering/integration-policy.md), [release-policy](../engineering/release-policy.md), [definition-of-done](../engineering/definition-of-done.md), [TESTING_STRATEGY](../TESTING_STRATEGY.md)

**Proposed.** The coordinator and the owner decide the merge order
([integration-policy](../engineering/integration-policy.md#merge-ordering)). This plan gives them
the evidence. Nothing here merges into `main`, and no integration branch is created by this work.
Branch facts were measured on 2026-11-18 against `origin/main` `8bd19fb7`; re-measure before
acting (section 7).

## 1. Branches in scope

| Stream | Branch | Head (origin) | Ahead / behind `main` | Merge base | Contains |
|---|---|---|---|---|---|
| Game Engine Core (engine) | `core/gameengine` | not pushed | 0 / 0 (merge of Treasure Rush in progress, uncommitted) | `8bd19fb7` | none yet |
| Scoring and progression | `core/ge-scoring` | not pushed | 0 / 0 | `8bd19fb7` | none yet |
| Treasure Rush | `feature/treasure-rush-palm-trees` | `420f1afd` | 56 / 13 | `155f0743` | Pirate's Leap |
| Pirate's Leap | `feature/pirates-leap` | `197a9af0` | 37 / 13 | `155f0743` | (inside Treasure Rush) |
| Storykeeper's Castle | `feature/storykeeper-castle-completion` | `eb2ac90a` (local `a560159b` unpushed) | 90 / 0 | `8bd19fb7` | an earlier Treasure Rush palm-tree base |
| Firepeak | `feature/firepeak-volcano-adventure` | `eaa3a4ab` (local `e85a3c21` unpushed) | 100 / 13 | `155f0743` | Treasure Rush, Pirate's Leap |
| North Pole | `feature/north-pole-adventure` | `130880b7` | 105 / 13 | `155f0743` | Treasure Rush, Pirate's Leap, early Firepeak shared commits |
| Lambda completion (other stream) | `feature/serverless-processing-completion` | `7483c07a` | 140 / 9 | `466a4972` | Waves 1 to 4 |

Pirate's Leap needs no separate merge: Treasure Rush contains every Pirate's Leap commit.

## 2. Recommended merge sequence

Contracts and migrations first, then consumers, engine extraction last.

| Step | Merge | Why here | Prerequisites |
|---|---|---|---|
| 0 | LAI-ENG-002 (this branch) | Slot isolation and checks help every later step. Touches `lai/config/settings/test.py`, so the PR must declare possible `deploy-dev-native` and `deploy-django-ec2` triggers | Owner review |
| 1 | Scoring contract (GE-100 contract package: event types, ledger model and migrations) | Provider of a contract the realms consume. Its apps (`progression`, `quests`) have no migration on any open branch, so it collides with nothing | Contract frozen on the card; `make migrate-check` |
| 2 | Treasure Rush (with Pirate's Leap) | Provider of the shared movement, jump, camera, platforms, collision profiles and avatars that every realm branch already contains. First to merge `assets 0003_collision_profiles` and `avatars 0001-0002` | Jump ADR renamed ADR-055 to ADR-063 (B3); ADR-056 to 060 rows replace their Reserved rows; owner QA |
| 3 | Firepeak | Contains step 2. Provides `regions 0007_puzzle_kinds_choose_order` and puzzle kinds that North Pole consumes | ADR-070 decision (B2); merge `main` after step 2 |
| 4 | North Pole | Contains steps 2 and part of 3; its card says Treasure Rush, then Firepeak, then North Pole. Adds `seasons 0001` | Steps 2 and 3 on `main` |
| 5 | Storykeeper's Castle | Independent content. Renumbers its `regions 0007/0008` after step 3 | Steps 2 and 3 on `main` |
| 6 | Scoring adoption in realms (each realm's Realm SDK adapter) | Consumers of step 1; small per-realm PRs | Step 1, and the realm on `main` |
| 7 | Engine package `game/` (LAI-2101 skeleton, then LAI-2102 moves) | LAI-2102 moves `firstPersonController.ts`, `sceneKit.ts`, `three/assets/*`, which every realm branch edits. Moving them while those branches are open would turn every realm merge into a rename conflict (B6) | LAI-2003 approved (B1); steps 2 to 5 merged, or the remaining branches frozen on the moved files |
| any | Lambda completion stream | Independent stream with its own PRs (#42, #43) | Whichever of it and step 2 merges second renumbers `assets 0003` (section 3) |

If the owner wants the engine package earlier, the alternative is: create only the LAI-2101
skeleton (one trivial module, no moves) after step 1, and hold LAI-2102 until step 5. The skeleton
touches no realm file, so it conflicts with nothing.

## 3. Django migration coordination

Leaves on `main`: `assets 0002`, `regions 0006_merge_main`, `jobs 0002`, `audio 0004`,
`progression 0002`, `quests 0001`, `game_sessions 0007_merge_main`.

| App | Branch A | Branch B | Resolution |
|---|---|---|---|
| `assets` | `0003_collision_profiles` (Treasure Rush, Pirate's Leap, Firepeak, North Pole, Storykeeper; byte-identical file `38188cf04f`) | `0003_derived_artifact` (Lambda completion; depends on `assets 0002`, `catalog 0010`, `jobs 0005`) | The later of step 2 and the Lambda stream renumbers its file to `0004_*` with a dependency on the other's `0003`. Recommended: the Lambda branch renumbers (one branch) rather than five game branches |
| `avatars` (new app) | `0001`, `0002` in five game branches, identical | none | No conflict. Merged once, with step 2 |
| `regions` | `0007_puzzle_kinds_choose_order` (Firepeak, North Pole; identical `5061e9e42b`) | `0007_castle_director`, `0008_castle_director_catalog` (Storykeeper) | Storykeeper (step 5) renumbers to `0008_castle_director`, `0009_castle_director_catalog`, depending on `0007_puzzle_kinds_choose_order` |
| `ai` | `0006_castle_director` (Storykeeper) | none | No conflict |
| `seasons` (new app) | `0001` (North Pole) | none | No conflict |
| `jobs`, `audio` | `0003` to `0005`, `0005`, `0006` (Lambda completion) | none | No conflict |
| `progression`, `quests`, `game_sessions`, `inventory` | Scoring (GE-100) will add here | none today | Scoring checks every active branch before numbering; the other branches add nothing here without telling the scoring card |

Rules (from [integration-policy](../engineering/integration-policy.md#database-models-and-migrations)):
one leaf per app; never edit a migration on `main`; no merge migration to hide a parallel graph
without owner approval; `make migrate-check` on the branch and again after the merge; destructive
changes follow expand and contract. Before numbering, scoring runs:

```bash
git fetch origin
for b in $(git branch -r --format='%(refname:short)' | grep -E 'feature/|core/'); do
  git diff --name-only --diff-filter=A origin/main...$b -- 'lai/apps/*/migrations/*.py'
done | sort | uniq -c
```

## 4. ADR coordination

| Number | State on `main` | Branches | Action |
|---|---|---|---|
| ADR-055 | Accepted: native dev environment | Treasure Rush, Pirate's Leap, Firepeak, North Pole head the jump decision `## ADR-055` | Rename to ADR-063 (reserved for it) by reading content, on Treasure Rush first; the others take it by merging `main` (B3) |
| ADR-056 to 060 | Reserved for the movement branches | Treasure Rush lineage, Storykeeper | Heading and full row replace the Reserved row in step 2 |
| ADR-063, 065 | Reserved | Storykeeper | Step 5 |
| ADR-070 | Reserved, COLLISION | Firepeak, GLB optimization design | Owner decision before step 3 (B2) |
| ADR-080, 081 | Reserved | North Pole | Step 4 |
| new (scoring, engine) | none | GE-100 | `ADR-NNN` until reserved on `main` ([procedure](../engineering/multi-agent-workflow.md#adr-number-reservation)) |

## 5. Integration branch and checks

Created only by the coordinator or on its instruction: `integration/<yyyymmdd>-game-engine-core`
from current `main`. Branches at Development Complete merge in with normal merges, in section 2
order. Prepared, not run (they run only when the owner requests merge readiness):

| Gate | Command | Prepared by |
|---|---|---|
| ADR registry | `npm run adr:check` | existing |
| Documentation | `make docs-check` | existing |
| Workspace packages and engine boundary | `make workspace-check` | this work |
| Migrations | `make migrate-check`, then `make py-test-db` on the slot's database | existing; slot isolation from this work |
| Types, lint, format | `npm run typecheck`, `npm run lint`, `npm run format:check`, `make py-lint py-format-check` | existing |
| Unit suites | `npm test`, `make py-test-db` | existing |
| Build | `npm run build` | existing |
| Browser and e2e (not run during development) | `npm run test:e2e`, `npm run test:acceptance`, one agent at a time | existing; run only on owner request |
| Content | `npm run content:check`, `npm run golden:check` | existing |

### 5.1 Future acceptance gates (for the owner's QA checklist)

- **Engine:** the engine emits events only; scoring and progress arrive from Django; no React in
  `game/`; one Three.js copy in the bundle; dispose on unmount leaves no WebGL context.
- **Scoring:** awards are idempotent (replaying an event awards nothing new); no penalties for
  mistakes or hints; no public leaderboard; values marked provisional until owner approval.
- **Movement and jumping:** every jump route has a non-jump alternative; no arithmetic exit gates;
  no time limits; reduced motion respected.
- **Realms:** Treasure Rush, Pirate's Leap, Firepeak, North Pole and Storykeeper's Castle each
  completable on desktop and touch, progress kept across sessions.
- **Assets:** no published model needs an unloaded decoder; collision profiles applied.

## 6. Checklists

### 6.1 Integration checklist (per branch, before it joins the integration branch)

- [ ] Card at Development Complete with a completion report and pushed SHA.
- [ ] `main` merged into the branch by its owner; conflicts resolved by reading both sides.
- [ ] Migrations renumbered per section 3; `make migrate-check` passes on the branch.
- [ ] ADR headings match registry rows (Reserved rows to be replaced listed in the PR).
- [ ] Shared components changed listed in the PR; consumers' tests rerun.
- [ ] `make workspace-check` and `make docs-check` pass.
- [ ] Deployment impact stated (which `deploy-*` workflows the paths trigger, release-policy table).
- [ ] No secrets, child data or fabricated results in the diff or the PR.

### 6.2 Release checklist (owner-run; links, not restatements)

- [ ] Merge-readiness gates in section 5 passed on the integration branch, with real output.
- [ ] Owner acceptance recorded on each card ([definition-of-done](../engineering/definition-of-done.md)).
- [ ] Release candidate and notes ([release-policy](../engineering/release-policy.md#release-candidates), [release notes template](../engineering/templates/release-notes.md)).
- [ ] Migration review: expand and contract respected; RDS snapshot before migrating
      ([release-policy](../engineering/release-policy.md#database-migrations)).
- [ ] Deployment approval for each environment, named separately from the merge approval.
- [ ] Post-deployment verification ([release-policy](../engineering/release-policy.md#post-deployment-verification)).

### 6.3 Rollback procedure

| What | Rollback | Never |
|---|---|---|
| Integration branch | Abandon it and re-create from `main`; it is never deployed | Force-push someone else's branch |
| A bad merge on `main` | `git revert -m 1 <merge>` on `fix/<ticket>-<slug>`, through a PR ([branch-policy](../engineering/branch-policy.md#rollback)) | Reset or force-push `main` |
| Migrations | Roll forward with a corrective migration. A reverted merge does not unapply migrations; the owner chooses roll forward or snapshot restore ([release-policy](../engineering/release-policy.md#rollback)) | Edit an applied migration |
| Deployed site or Django | The workflow's rollback action with the target SHA, by the owner or an authorized agent | Manual console changes |
| Engine package (`game/`) | Revert the LAI-2101 or LAI-2102 commit; moves are pure `git mv`, so a revert restores the old paths | Partial reverts that leave both copies |
| Local slot changes | `agent_slot.py write --slot 0` (defaults) or delete the managed block in `.env` | Touch another worktree's `.env` |

## 7. Re-measuring before acting

Branch heads move. Before the coordinator uses this plan:

```bash
git fetch origin
git rev-list --left-right --count origin/<branch>...origin/main
git merge-base --is-ancestor origin/feature/treasure-rush-palm-trees origin/<branch> && echo contains-treasure-rush
python3 scripts/check_workspace_packages.py
```
