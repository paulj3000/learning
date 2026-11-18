# Integration Policy

- **Status:** Mandatory policy
- **Owner:** project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-033, ADR-047, ADR-063 (reserved), ADR-064, ADR-072 (proposed engineering governance)
- **Canonical sources:** [docs/DECISIONS.md](../DECISIONS.md) ("ADR registry and governance"),
  [docs/TESTING_STRATEGY.md](../TESTING_STRATEGY.md) ("When to run which checks"),
  [docs/ARCHITECTURE.md](../ARCHITECTURE.md) ("Consolidated Django backbone"),
  [tasks/TASK_TRACKER.md](../../tasks/TASK_TRACKER.md),
  [docs/IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md)

Several agents (Claude-01 to Claude-05) work in parallel branches. This policy decides the order
in which their work is combined, who resolves conflicts, how integration branches work, and which
areas need coordination before anyone edits them. Branch naming and commit rules are in
[branch-policy.md](branch-policy.md).

## Core rules

1. Agents never merge their own feature into `main` without the owner's explicit
   authorization for that merge.
2. Never discard another agent's or the owner's work to make a merge succeed. If a conflict
   cannot be resolved without dropping someone's change, stop and ask.
3. GitHub is the record of what code was merged; Trello is the record of who owns what and
   where it is in the workflow ([trello-workflow.md](trello-workflow.md)).

## Merge ordering

- Dependencies merge first. A branch whose ticket lists `dependencies` merges only after each
  dependency is on `main` (or on the same integration branch, for compatibility testing).
- Stacked branches: when the base branch merges, the stacked branch's pull request is
  retargeted to `main` (or to the new base) and brought up to date by merging `main` into it.
  Do not rebase a branch other people have pulled.
- Independent branches merge in the order the owner chooses. Numbering order does not gate
  unrelated work ([CLAUDE.md](../../CLAUDE.md) section 18).
- Shared-component changes (section "Coordination required") merge before the features that
  consume them.

## Conflict resolution

- The owner of the later branch (the one being merged second) resolves conflicts against the
  branch that merged first, on their own branch, by merging the updated base into it.
- Resolve by understanding both changes. Keep both behaviours unless a ticket or the owner says
  otherwise. Never resolve by taking "ours" or "theirs" wholesale across files.
- After resolving, rerun the development checks for every file touched by the conflict and the
  focused regression tests for both features.
- Record non-trivial resolutions in the pull request description and in the handoff
  ([templates/agent-handoff.md](templates/agent-handoff.md)).

## Integration branches

An integration branch, `integration/<yyyymmdd>-<topic>`, combines completed feature branches
to test that they work together before any of them reach `main`.

1. It is created from current `main` by the agent or owner assigned to the integration ticket.
2. Only branches whose cards are at Development Complete or later are merged into it, using
   normal merges (no squash, no rebase), so each branch's history stays traceable.
3. Fixes needed for compatibility are committed on the integration branch with the ticket ids
   of the affected work, and reported back to the owning agents.
4. The authorized integration checks run on it (merge-readiness gates in
   [docs/TESTING_STRATEGY.md](../TESTING_STRATEGY.md), when the owner requests them).
5. An integration branch is never deployed. No deploy workflow is dispatched from it.
6. It merges into `main` only through a pull request with owner approval.
7. Integration completion is a separate gate from development completion
   ([definition-of-done.md](definition-of-done.md)).

## Coordination required

Before editing any area below, the agent checks Trello and open pull requests for other work
on the same area, lists the area under `shared_components` in the ticket block, and tells the
owner if another active ticket touches it. Two agents never change the same shared area in
parallel without an agreed owner for the change.

| Area | Why it needs coordination | Where it lives (main) |
|---|---|---|
| Database models and migrations | Migration number collisions and divergent graphs | `lai/apps/*/models.py`, `lai/apps/*/migrations/` |
| Authentication | Cognito verification and the Django authority model (ADR-040) | `react/src/lib/cognito`, `lai/apps/users` |
| Shared API contracts | React, game and Django clients depend on them; `/api/v1/` versioning | `lai/apps/*/views.py`, `serializers.py`, `react/src/api` |
| Shared engine | ADR-020 engine boundaries | `react/src/features/island-map/three`, `game/` when it exists |
| Player movement | One shared controller for every world | `react/src/features/island-map/three/firstPersonController.ts`; pending-merge branches (PR #26, #27, #29, #37, #36) |
| Jumping and collision | Owner direction 2026-11-17: standard in every adventure | pending merge (`feature/shared-jump-controller`, ADR-063 reserved) |
| Camera | One camera controller (pending merge, `feature/third-person-avatar`) | shared engine |
| Asset resolution | One resolver over the Asset Manager (ADR-045) | `react/src/features/island-map/three/assets/assetResolver.ts`, `react/src/api/assets` |
| NPC systems | Versioned NPC releases (ADR-054) | `lai/apps/npcs`, `react/src/features/npc-manager` |
| Sound | One AudioContext and Django-owned cues (ADR-048, ADR-050) | `react/src/audio`, `lai/apps/audio` |
| Content publication | Django is authoritative after import (ADR-047) | `lai/apps/catalog`, `manage.py load_content` |
| Scoring and progress | One canonical progress model (ADR-033) | `lai/apps/progression`, `lai/apps/quests` |
| Deployment infrastructure | Live AWS impact | `infra/`, `scripts/aws/`, `.github/workflows/deploy-*.yml` |
| ADR numbers | Collisions across branches | [docs/DECISIONS.md](../DECISIONS.md) |
| Status and tracker files | Every agent appends to them | [docs/IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md), [tasks/TASK_TRACKER.md](../../tasks/TASK_TRACKER.md) |

### Database models and migrations

- Each Django app keeps a linear migration graph: exactly one leaf migration per app on `main`.
- Before creating a migration, merge current `main` into the branch and check the latest
  migration number of that app on `main` and on open pull requests touching the app.
- If two branches created the same number, the later branch renames or regenerates its
  migration on top of the earlier one. Never edit a migration that is already on `main`.
- Do not use merge migrations to hide a parallel graph unless the owner approves.
- `make migrate-check` (Django `makemigrations --check --dry-run`) must pass on the branch and
  again after the merge. It is part of `make check` and of CI.
- Destructive migrations follow the expand and contract rule in
  [release-policy.md](release-policy.md).

### ADR numbers

- Reserve the number first: add a `Reserved` row to the registry in
  [docs/DECISIONS.md](../DECISIONS.md) on `main` (through a small pull request the owner
  merges), then use it on the feature branch. Take the next free number after every row,
  including `Reserved` rows, after checking `git show origin/main:docs/DECISIONS.md`.
- Collisions have already happened. Parallel branches used ADR-055 for both the native dev
  environment and the jump controller; the jump decision was moved to ADR-063 (Reserved).
  Other open branches use ADR-065 to ADR-071, ADR-080 and ADR-081, which must be registered as
  Reserved before any new number is chosen.
- Renumber only to remove a real collision, by reading content, never by search and replace
  (governance rules 3 and 5).
- `npm run adr:check` must pass before a merge is complete.

### Status and tracker files

[docs/IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md) and
[tasks/TASK_TRACKER.md](../../tasks/TASK_TRACKER.md) are append-only during parallel work:

- add a new section or line for your ticket; do not rewrite or reorder other entries;
- place your entry clear of other open entries to keep merge conflicts small;
- on conflict, keep every side's entries and fix only ordering or duplicated headings;
- correcting another entry's status requires the owner's instruction or verified evidence,
  and is noted in the commit body.

## Before asking for a merge

- The branch is up to date with `main` (or its base) and conflicts are resolved.
- Development checks pass; merge-readiness checks have run if the owner requested them.
- Shared components and migrations changed are listed in the pull request.
- The ADR registry is consistent (`npm run adr:check`).
- The Trello card is at the right list with evidence ([trello-workflow.md](trello-workflow.md)).
