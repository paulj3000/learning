# Multi-Agent Workflow

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-055, ADR-063

This document defines how up to five AI coding agents work concurrently without overwriting each
other. The single-ticket lifecycle is in [development-workflow.md](development-workflow.md); the
agent contract is [AGENTS.md](../../AGENTS.md).

## Agent identity

- Five concurrent agents: `Claude-01`, `Claude-02`, `Claude-03`, `Claude-04`, `Claude-05`.
  Another tool (for example Codex) working under this contract takes one of these slots.
- An agent ID names a slot, not a person or a session. A new session that resumes a slot's ticket
  keeps the ID.
- Every Trello comment, handoff and completion report starts with the agent ID and ticket ID.

## Task assignment

- Agents are assigned dynamically from Trello priorities: the coordinator (ChatGPT or the owner)
  picks the highest-priority card in Ready for Development whose dependencies are satisfied and
  whose shared components do not collide with work in progress.
- An agent never assigns itself a card unless the coordinator or owner told it to pick the next
  card.
- Ticket format: [trello-workflow.md](trello-workflow.md).

## Claiming and locking

A claim is the lock. A ticket is claimed only when all of these are true:

1. `assigned_agent` is set to the agent ID.
2. `branch`, `worktree` and `baseline_sha` are filled.
3. A claim comment exists: `<agent-id> claims <ticket-id>: branch <branch>, worktree <path>,
   baseline <sha>`.
4. The card is in In Development.

Rules:

- One ticket per agent at a time unless the owner says otherwise.
- If two agents claim the same card, the earlier claim comment wins; the later agent stops,
  deletes nothing, and reports to the coordinator.
- A claim is released only by the coordinator or owner, or by the agent at completion or handoff.

## Branch ownership and worktree naming

- One branch and one worktree per ticket, owned by the claiming agent.
- Worktree: `/Coding/learning-worktrees/<short-name>`, where `<short-name>` is short, unique and
  recognisable (for example the ticket area and number or the feature name). Check
  `git worktree list` first.
- Branch prefixes: [branch-policy.md](branch-policy.md). Existing branches keep their names.
- Never commit, stash, reset, clean or check out in another agent's worktree. Read other branches
  with `git show origin/<branch>:<path>` or `git log origin/<branch>`.

## Shared files and hot spots

These files change often across tickets and caused real conflicts. Treat edits to them as
shared component changes (declare them on the ticket first).

| File or area | Rule |
|---|---|
| [docs/DECISIONS.md](../DECISIONS.md) | Before using an ADR number, reserve it with a `Reserved` row (registry rule 7) on the integration branch or through the coordinator; take the next free number after every row, including `Reserved` rows (rule 2). Never renumber by search and replace (rule 5). **Binding:** `docs/DECISIONS.md` registry rules |
| [docs/IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md) | Append a new dated section for your ticket; do not edit other tickets' sections. Resolve conflicts by keeping both sections |
| Django migrations (`lai/apps/<app>/migrations/`) | Two branches adding a migration to the same app conflict on numbering. Declare migrations on the ticket; the later-merging branch rebases and regenerates or adds a merge migration. The migration check in `make py-check` runs at merge readiness |
| `react/src/features/island-map/three/firstPersonController.ts` | Shared movement controller. Movement, jumping, camera and collision tickets touch it; serialize or stack them |
| `react/src/audio/SoundManager.ts` | Shared Sound Manager; coordinate with any open sound or NPC voice work |
| `package.json`, `package-lock.json` (root, npm workspaces with `react/`) | Dependency changes need owner approval (**Binding:** CLAUDE.md §13). One dependency change in flight at a time |
| `requirements.txt`, `requirements-dev.txt` | Same as above |
| [CLAUDE.md](../../CLAUDE.md), [AGENTS.md](../../AGENTS.md) | Owner or coordinator only, unless the ticket assigns them |

Other shared components requiring coordination are listed in [AGENTS.md](../../AGENTS.md) and
[architecture-rules.md](architecture-rules.md).

## Dependency ordering: parallel vs serial

| Situation | Mode |
|---|---|
| Tickets touch disjoint owned components and no shared component | Parallel, each from `origin/main` |
| Ticket B needs code from unmerged ticket A | Serial: stack B on A's branch, record A's branch as the base on B's card |
| Tickets change the same shared component | Serial, or one ticket owns the shared change and the others consume it after it is pushed |
| Tickets need the same Django app migrations | Serial within that app, or coordinate numbering through the coordinator |
| Tickets need new ADR numbers | Parallel allowed once each number is reserved |

A ticket never starts before its dependencies are satisfied. An earlier unfinished ticket does
not block an independent, dependency-ready ticket. **Binding:** CLAUDE.md §18.

## Dividing a large feature into work packages

1. ChatGPT or the coordinator writes one feature specification
   ([feature-specification.md](templates/feature-specification.md)) with its parallel and serial
   work packages.
2. Each work package becomes its own ticket with explicit owned and shared components. Two
   packages never own the same component.
3. Shared contracts (types, API schemas, events) go in the first serial package, so parallel
   packages build against a pushed contract.
4. Integration is a separate package or an integration branch
   ([integration-policy.md](integration-policy.md)).

Each work package is recorded on its card in this format:

```yaml
ticket_id: LAI-<AREA>-<NNN>
agent_id: Claude-0<n>
branch: <prefix>/<name>
worktree: /Coding/learning-worktrees/<short-name>
baseline_sha: <sha>
scope: <one or two sentences>
owned_components: []
shared_components: []
dependencies: []
acceptance_criteria: []
current_status: <Trello logical state>
last_pushed_commit: <sha or TBD>
blockers: []
```

## Lessons from real history

- **Stacked PRs.** Movement work landed as a stack: PR #26 (shared jump controller) under #27
  (third-person avatar and camera), under #28 (avatar assets), under #29 (running). Platforms
  (PR #37) sat under Pirate's Leap (PR #38). Stacks work when each card records its base branch
  and the stack merges bottom up. None of this is on `main` yet; it is pending merge.
- **Integration branches.** `integration/gameplay-environment-qa` (PR #39) combined the movement
  and environment branches for one owner QA pass instead of QA on each branch.
- **ADR collisions.** Branches picked ADR numbers independently. The movement branches used
  ADR-055, which `main` already used for the native dev environment. The owner reconciled the
  registry on 2026-11-17 and reserved ADR-063 for the jump decision. Reserve numbers first.

## Integration coordination

- The coordinator tracks which open branches touch which shared components and proposes a merge
  order; the owner approves it.
- Agents never merge overlapping branches on their own (AGENTS.md rule 3). Integration branches
  are created only when the owner or coordinator asks.
- Detail: [integration-policy.md](integration-policy.md).

## Blocker escalation

1. Agent: move the card to Blocked, comment with the blocker, push coherent work.
2. Coordinator: resolve dependency, ordering or scope questions within one working day, or
   escalate.
3. Owner: decides approvals, ADRs, scope changes and anything touching AWS.

## Handoff

A session that ends before completion posts a handoff
([agent-handoff.md](templates/agent-handoff.md)) on the card and pushes its branch. A handoff
to a different agent also changes `assigned_agent` and adds a comment naming both agents.

## Session recovery

After a usage limit, crash or new session:

1. Re-read the Trello card, its comments and the latest handoff.
2. In your own worktree: `git status`, `git log --oneline -10`, `git fetch origin`, and compare
   with `git log -1 origin/<branch>` (the last pushed commit).
3. Treat only pushed commits and the ticket as reliable. Inspect any uncommitted changes before
   using them; never assume prior uncommitted state is complete or correct.
4. Re-run the targeted tests for the code you are about to build on.
5. Post a resume comment, then continue.

## Stale task detection

- Proposed threshold: a claimed card with no push and no Trello update for 2 working days is
  stale.
- A stale card is flagged with a comment and reported to the coordinator. It is never
  reassigned automatically; only the coordinator or owner reassigns it, after checking the
  branch for pushed work.

## Completed-work reporting

At Development Complete the agent posts a
[completion-report.md](templates/completion-report.md) on the card, with the last pushed SHA,
tests run and results, checks deferred to merge verification, shared component changes, and
integration requirements. Gates beyond Development Complete are in
[definition-of-done.md](definition-of-done.md).

## Future orchestration interface (not implemented)

No orchestrator exists today. Coordination is done by ChatGPT and the owner through Trello. If an
orchestrator is built, it is limited to:

| May read | May write | Must never |
|---|---|---|
| Trello cards and fields, branch and PR status, handoffs, completion reports | Card fields (`assigned_agent`, status flags), stale-task comments, proposed assignments and merge orders | Bypass owner approvals, merge to `main`, deploy, call live AWS, edit an agent's worktree, accept an ADR |

Building it requires its own ticket, specification and owner approval.
