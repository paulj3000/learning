# Integration Policy

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-020, ADR-033, ADR-047, ADR-064

How finished branches are combined, ordered and merged, and which components need coordination
before anyone changes them. Branch naming and pull requests are in
[branch-policy.md](branch-policy.md). Agent assignment is in
[multi-agent-workflow.md](multi-agent-workflow.md). Completion gates are in
[definition-of-done.md](definition-of-done.md).

Untagged rules are proposals under ADR-072. Rules tagged **Binding:** already apply today.

## 1. Principles

1. An agent never merges its own feature to `main` without explicit owner authorization.
2. Integration proves compatibility; it does not grant acceptance. Owner acceptance is a separate
   gate (definition-of-done.md).
3. Integration branches never merge to `main` without owner authorization.
4. Every merge into `main` passes `npm run adr:check`. **Binding:** DECISIONS.md rule 4
5. No task bypasses an unresolved dependency, an open gate or an APPROVAL stop.
   **Binding:** CLAUDE.md §18

## 2. Merge ordering

Merge in dependency order, then by risk:

| Order | What | Why |
|---|---|---|
| 1 | Parents of stacked branches (branch-policy.md, section 6) | Children are built on them |
| 2 | Shared component changes (section 5) and their migrations | Features depend on them |
| 3 | Backend domain changes | API and models before the clients that use them |
| 4 | Frontend and gameplay features | Consume the merged contracts |
| 5 | Documentation-only changes | Lowest conflict risk; may go at any time if independent |

Rules:

1. A dependency recorded in the ticket block merges first. An unrelated, dependency-ready branch
   does not wait for an earlier-numbered task. **Binding:** CLAUDE.md §18
2. Never combine a backend domain change with a world conversion in one task or pull request.
   **Binding:** CLAUDE.md §19
3. After each merge to `main`, branches waiting behind it update from `main` and rerun their
   affected checks before they are merged.
4. A merge to `main` can trigger a deploy workflow when its repository variable is on
   (release-policy.md, section 3). The owner sequences merges with that in mind.

## 3. Conflict resolution

1. Resolve conflicts in your own branch by merging or rebasing `origin/main` (or the declared
   parent) into it.
2. **Never resolve a conflict with another agent's work by discarding it.** If a conflict involves
   code another agent owns, keep both intents, or stop and ask the owning agent and the
   coordinator. Record the resolution in the pull request.
3. Never use "ours" or "theirs" wholesale on a file another agent changed.
4. Do not edit another agent's branch or worktree to make your merge easier.
5. After resolving, rerun the tests covering both sides of the conflict.

### ADR number collisions

ADR numbering follows [../DECISIONS.md](../DECISIONS.md), "ADR registry and governance". In short:

- An identifier is stable once integrated; renumber only to remove a real collision and record
  the old and new number. **Binding:** DECISIONS.md rule 3
- Before merging, compare the branch's `## ADR-` headings with the registry; `npm run adr:check`
  must pass. **Binding:** DECISIONS.md rule 4
- When two branches used the same number, decide from content which decision each reference
  means; never search and replace across files. **Binding:** DECISIONS.md rule 5
- Real example: the jump controller branches number their decision ADR-055, which `main` uses for
  the native dev environment; the registry reserves ADR-063 for it on merge.

## 4. Database migration coordination

Django migrations are numbered per app (`lai/apps/<app>/migrations/`). Parallel branches that
add migrations to the same app produce conflicting numbers or a split graph.

| Rule | Detail |
|---|---|
| One migration owner per app per wave | When several agents work in parallel, the coordinator names one agent per Django app that may add migrations in that wave. Others request schema changes from that owner. |
| Declare | The ticket block lists each app whose models change under `shared_components`. The pull request "Migrations" section lists every new migration file. |
| Rebase and renumber before merge | Before a branch merges, update it from `main`; if `main` gained migrations in the same app, regenerate or renumber the branch's migrations so the graph has one leaf per app. Never edit a migration that is already on `main`. |
| Check | `cd lai && .venv/bin/python manage.py makemigrations --check --dry-run` (part of `make py-check` and CI) must report no changes. |
| Destructive changes | Remove or rename a column in two releases: code stops using it first, then the migration. The deploy scripts refuse destructive migrations unless explicitly allowed (release-policy.md). |
| Data migrations | Never move production data without explicit owner approval. **Binding:** CLAUDE.md §18 |

## 5. Shared components requiring coordination

A change to any component below needs: the component named under `shared_components` in the ticket
block, the coordinator's agreement before work starts, and the "Shared component changes" section
of the pull request filled. Paths were verified on `main` at `466a4972`.

| Component | Canonical paths | Notes |
|---|---|---|
| Database models and migrations | `lai/apps/*/models.py`, `lai/apps/*/migrations/` | One backbone, no second catalog or progress model. **Binding:** ADR-033, CLAUDE.md §20 |
| Authentication | `lai/apps/users/` (`authentication.py`, `jwks.py`, `recent_auth.py`, `permissions.py`, `scoping.py`), `react/src/lib/cognito/`, `react/src/api/auth.ts`, `react/src/features/auth/` | Cognito is the sole application identity provider. **Binding:** ADR-040 |
| Shared API contracts | `lai/config/urls.py`, `lai/apps/*/urls.py`, `lai/apps/*/serializers*.py`, `react/src/api/`, `content/schema/content.schema.json` | Change both sides together, with contract tests |
| Shared game engine | `react/src/features/island-map/three/` (`sceneKit.ts`, `engineHandle.ts`, `runtime/`, `extensions/`) | Three.js only. The engine emits typed events, never grades, awards or calls AI. **Binding:** ADR-020. The `game/` package does not exist yet |
| Player movement | `react/src/features/island-map/three/firstPersonController.ts`, `pointerControls.ts` | Running and sprinting: pending merge (PR #29, ADR-058 reserved) |
| Jumping and collision | `firstPersonController.ts` (collision today) | Jumping: pending merge (PR #26, ADR-063 reserved); platforms PR #37 (ADR-059 reserved); footprint PR #36 (ADR-060 reserved). See [../adventures/jumping-standard.md](../adventures/jumping-standard.md) |
| Camera | `firstPersonController.ts` (first-person camera) | Third-person camera: pending merge (PR #27, ADR-056 reserved) |
| Asset resolution | `react/src/features/island-map/three/assets/` (`assetResolver.ts`, `assetLoader.ts`), `react/src/audio/AudioAssetResolver.ts`, `lai/apps/assets/` (`resolver.py`, `delivery.py`) | Staff authoring is Django Admin only. **Binding:** ADR-045 |
| NPC systems | `lai/apps/npcs/`, `react/src/features/npc-manager/` | **Binding:** ADR-054 |
| Sound systems | `react/src/audio/`, `lai/apps/audio/`, `lai/apps/speech/` | ADR-048, ADR-049, ADR-050 are Proposed |
| Content publication | `content/`, `scripts/export-content.ts`, `lai/apps/catalog/management/commands/load_content.py`, `lai/apps/catalog/authoring.py`, `lai/apps/npcs/publishing/` | Import never silently overwrites administrator edits. **Binding:** ADR-047 |
| Scoring | `lai/apps/education/` (`mastery.py`), `lai/apps/progression/`, `catalog.RewardRule`, `react/src/features/rewards/`, `react/src/features/mastery/` | No XP, coin or level economy. **Binding:** ADR-011. See [../adventures/scoring-standard.md](../adventures/scoring-standard.md) |
| Deployment infrastructure | `infra/`, `.github/workflows/`, `scripts/aws/`, `deploy/`, `lambda/` | Code is not authorization to deploy (release-policy.md). Processing path **Binding:** ADR-064 |

### Shared engine compatibility

1. A change to the shared engine keeps every shipped region working: run the region and runtime
   tests under `react/src/features/island-map/three/` for the regions the change can affect.
2. Add capabilities behind the existing manifest and extension vocabularies (ADR-032) instead of
   per-region branches in shared code.
3. Gameplay that depends on unmerged movement work (jumping, running, third-person camera,
   platforms) builds on the shared controller branch and says "pending merge (PR #n)"; it does not
   copy the controller.
4. Phaser worlds receive bug fixes only. **Binding:** CLAUDE.md §19

## 6. Integration branches

An integration branch combines finished feature branches to test that they work together before
the owner merges any of them.

Real examples: `integration/gameplay-environment-qa` (PR #39) merged the movement stack (through
`feature/player-running`, PR #29) with `feature/treasure-rush-palm-trees` (PR #36) for owner QA.
The `integration/multi-agent-dev` branch has a worktree at
`/Coding/learning-worktrees/integration`.

| Question | Rule |
|---|---|
| Who may create one | The coordinator, or an agent the owner or coordinator names for that integration. Not an agent on its own initiative. |
| Baseline | Current `origin/main`, recorded in the ticket block. |
| What goes in | Only branches at Development Complete (definition-of-done.md). Merge each with a normal merge commit naming the branch and PR; never squash or rewrite the source branches. |
| Fixes | A defect found in integration is fixed on the source branch (or a `fix/` branch based on it) and merged in again. Integration-only glue is allowed when recorded in the integration ticket. |
| Checks | Development checks for every touched area, plus the authorized integration checks: `makemigrations --check`, `npm run adr:check`, `npm run typecheck`, the affected Vitest and pytest paths, `npm run content:check` when content changed, and any browser checks the owner authorizes for the integration. Full gates (`make check`, `npm run test:e2e`, `npm run test:acceptance`) only when requested. **Binding:** TESTING_STRATEGY.md |
| Evidence | Record the merged SHAs, check results and conflicts in the integration ticket and the Trello card. |
| To `main` | Never without owner authorization. Normally the owner merges the source pull requests in order; the integration branch is then retired. |
| Cleanup | Retained until the owner decides (branch-policy.md, section 7). |

## 7. Coordination checklist before merging

- [ ] Dependencies merged or declared as stacked parents.
- [ ] Branch updated from current `main`; conflicts resolved without discarding others' work.
- [ ] Migrations rebased, one leaf per app, `makemigrations --check` clean.
- [ ] `npm run adr:check` passes; ADR numbers checked against the registry.
- [ ] Shared component owners agreed to the changes listed in the pull request.
- [ ] Deferred checks listed; merge-readiness gates run when the owner requests them.
- [ ] Owner authorization to merge recorded on the Trello card.
