# Multi-Agent Workflow

- **Status:** Mandatory policy (in effect once merged to `main` with owner approval; governance decision ADR-072, Proposed)
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-072 (Proposed); ADR-063 and ADR-055 (the collision that motivates ADR reservation)
- **Canonical sources:** [`docs/DECISIONS.md`](../DECISIONS.md) "ADR registry and governance"; [`branch-policy.md`](branch-policy.md); [`trello-workflow.md`](trello-workflow.md)

Up to five Claude Code agents, Claude-01 to Claude-05, work at the same time in isolated worktrees.
Agents are not tied to features: each takes the highest-priority ready ticket it can safely own.
This document defines how they identify themselves, claim and lock work, avoid shared-file
conflicts, hand off, recover and report.

## Agent identity

| Where | Form |
|---|---|
| Agent id | `Claude-01` to `Claude-05`, assigned by the owner when the session starts. An agent without an assigned id asks before claiming |
| Commit messages | Trailer line `Agent: Claude-0N`, alongside any attribution trailers the session requires |
| Trello comments | First line `[Claude-0N]` |
| Handoffs and reports | `agent_id: Claude-0N` in the ownership block and in [`templates/agent-handoff.md`](templates/agent-handoff.md) or [`templates/completion-report.md`](templates/completion-report.md) |
| Pull requests | Agent id in the PR description ([`templates/pull-request.md`](templates/pull-request.md)) |

An agent never uses another agent's id, and never writes as the owner.

## Assignment and claiming

1. Read the Ready for Development list in priority order (top first, unless the owner has said otherwise).
2. Skip a card that is already claimed, whose dependencies are not Complete or merged, or whose
   owned files overlap an active claim (see shared-file conflicts below).
3. Claim the first eligible card: post the claim comment, fill the card's ticket block
   ([`trello-workflow.md`](trello-workflow.md#ticket-block)), then move the card to In Development.

Claim comment:

```text
[Claude-0N] CLAIM
ticket: <ticket-id>
branch: <branch>
worktree: <worktree-dir>
baseline: <origin/main short SHA>
scope: <one line>
owned: <paths or components>
```

If two agents claim the same card, the earlier claim comment wins; the later agent withdraws with a
comment and picks another card.

## Locking and branch ownership

- One owner per ticket. The lock is the claim comment plus the existing branch.
- Only the owning agent pushes to the ticket branch. Others may read it (`git show origin/<branch>:<path>`)
  but do not commit to it, rebase it or force-push it.
- The lock is released by a handoff comment (ticket returns to Ready for Development or goes to a
  named agent), or by completion (card reaches Development Complete with the completion report).
  The branch stays; ownership of rework returns to the same agent unless the owner reassigns it.
- Only the owner or coordinator may break a lock (for example after stale detection). They record
  it with a comment.

## Branches and worktrees

Branch names follow [`branch-policy.md`](branch-policy.md):

| Kind | Branch |
|---|---|
| Feature | `feature/<ticket>-<slug>` |
| Adventure content or gameplay | `adventure/<realm>-<slug>` |
| Fix | `fix/<ticket>-<slug>` |
| Infrastructure code (never a deploy) | `infra/<ticket>-<slug>` |
| Integration | `integration/<yyyymmdd>-<topic>` |
| Documentation | `docs/<ticket>-<slug>` |

The worktree directory is `wt-` plus the branch name with every `/` replaced by `-`, created as a
sibling of the main checkout:

```bash
git fetch origin
git worktree add -b feature/<ticket>-<slug> ../wt-feature-<ticket>-<slug> origin/main
```

One ticket, one branch, one worktree. An agent never edits files in another agent's worktree.
Session branches created by tooling (`claude/<random>`) and older names (`features/*`, `wip/*`,
`adventures/*`, `quest/*`) are legacy: leave existing ones alone and use the conventions above for
new work.

## Shared-file conflicts

These files are edited by many tickets. Treat a change to them as a shared change: keep it minimal,
list it under `shared_components` in the ownership block, and say so in the claim comment.

| Hotspot | Rule |
|---|---|
| [`docs/DECISIONS.md`](../DECISIONS.md) registry and headings | Reserve numbers on `main` first (below). Add only your own row and section; never renumber others |
| [`docs/IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md) | Append your own entry; do not rewrite other entries |
| [`tasks/TASK_TRACKER.md`](../../tasks/TASK_TRACKER.md) | Change only your ticket's line |
| Django migrations (`lai/apps/*/migrations/`) | One ticket per app at a time. Announce on the card; the second ticket rebases and renumbers its migration at integration, never edits a merged migration |
| `package.json`, `package-lock.json` | New dependency is a stop-and-ask trigger. Regenerate the lockfile with npm, never hand-edit it |
| `requirements*.txt` | Same as above; pinned versions only |
| `lai/config/settings` | Additive settings only, with defaults safe for development and tests |
| Shared engine and movement code (shared controllers, camera, collision) | Owned by one ticket at a time; others consume it through its interface |
| [`CLAUDE.md`](../../CLAUDE.md), [`AGENTS.md`](../../AGENTS.md) | Owner-approved policy changes only |

If a ticket needs a hotspot that an active claim owns, either sequence behind it (dependency) or
agree the exact change in Trello comments before editing. Conflicts that remain at merge time are
resolved per [`integration-policy.md`](integration-policy.md), by reading both changes, never by
taking one side wholesale.

## ADR number reservation

Parallel branches have collided on ADR numbers: two decisions both used ADR-055, and the owner's
reconciliation reserved ADR-063 for the movement branch. Today, open branches use ADR-065 to
ADR-071, ADR-080 and ADR-081, while the registry on `main` still says the next free number is 065.
To prevent another collision:

1. While drafting, write the identifier as the placeholder `ADR-NNN` (ignored by `npm run adr:check`).
2. Request a number on the Trello card. The coordinator reads the registry on `main`
   (`git show origin/main:docs/DECISIONS.md`) and every open branch's `## ADR-` headings, and takes
   the next free number after all of them.
3. The number is reserved by a `Reserved` registry row on `main` (governance rule 7), through a small
   registry-only change merged with owner authorization. Record the number on the card.
4. Only then replace the placeholder in the branch. When the branch merges, its heading and full
   registry row replace the `Reserved` row (governance rule 4: `npm run adr:check` must pass).

Never renumber another branch's ADR or search and replace ADR ids across files (governance rule 5).

## Dependency ordering, parallel and serial work

| Situation | Mode |
|---|---|
| Tickets with no shared owned files and no dependency | Parallel |
| One ticket defines an interface, schema, migration or ADR another consumes | Serial: the provider merges (or at least pushes a stable contract) first |
| Two tickets change the same hotspot in non-additive ways | Serial |
| A ticket touches an APPROVAL task, AWS or an open gate | Waits for the owner, regardless of priority |

An earlier, unfinished ticket does not block an independent, dependency-ready ticket (CLAUDE.md
section 18). An open ticket is never marked complete by implication.

### Splitting a larger feature into work packages

1. **Contract first (serial).** One agent defines the shared interfaces: types, API shapes, events,
   Django model and migration, and any ADR. This package merges, or is pushed and frozen, before the
   others start.
2. **Parallel packages.** Each package gets its own ticket, branch, worktree and exclusive set of
   owned files. Packages use the contract and never change it; a needed contract change goes back to
   step 1 as its own ticket.
3. **Integration (serial).** One agent, named by the coordinator, integrates the packages on
   `integration/<yyyymmdd>-<topic>` per [`integration-policy.md`](integration-policy.md) and runs the
   authorized merge-readiness checks.

### Work-package ownership block

Every claimed ticket keeps this block current, in the claim comment's follow-up and in handoffs. It
is the agent's working view of the card's ticket block in [`trello-workflow.md`](trello-workflow.md#ticket-block),
which stays the record on the card: `agent_id` is the ticket block's `assigned_agent`, and the
shared fields (`branch`, `worktree`, `baseline_sha`, components, dependencies, criteria, blockers)
must match it. `last_pushed_commit` tracks progress; the ticket block's `implementation_commit` is
filled at completion.

```yaml
ticket_id: <ticket-id>
agent_id: Claude-0N
branch: <branch>
worktree: <worktree-dir>
baseline_sha: <origin/main SHA at branch creation>
scope: <one-line scope>
owned_components:
  - <paths or components only this ticket changes>
shared_components:
  - <hotspot files this ticket changes, with the intended change>
dependencies:
  - <tickets, PRs, ADRs or gates this ticket waits on>
acceptance_criteria:
  - <criterion from the card>
status: <claimed | in_development | blocked | development_complete | rework | handed_off>
last_pushed_commit: <SHA or none>
blockers:
  - <blocker and the decision needed, or none>
```

## Integration coordination

- Each agent records cross-ticket requirements at lifecycle step 16 ([`development-workflow.md`](development-workflow.md)).
- The coordinator decides merge order (contracts and migrations first) and names who integrates.
- Integration branches are created only by the coordinator or on its instruction.

## Blocker escalation

| Blocker | Action |
|---|---|
| Owner decision needed | Comment on the card with the question and options, move it to Blocked, continue only on independent work |
| Dependency on another agent's ticket | Comment on both cards; if no answer in one working day, escalate to the coordinator |
| Infrastructure failure (worker timeout, out of memory, missing database) | Report as infrastructure, separately from test failures ([`docs/TESTING_STRATEGY.md`](../TESTING_STRATEGY.md)); rerun only affected files |
| Network or permission refusal | Report it; do not work around a security control |

## Handoff

A handoff uses [`templates/agent-handoff.md`](templates/agent-handoff.md) and includes the current
ownership block, everything pushed (no unpushed work is handed off), checks run and their results,
open questions and next steps. Post it as a Trello comment; the receiving agent posts its own claim
comment before working.

## Session recovery

After a container restart or a new session on an existing ticket:

1. Re-read [`CLAUDE.md`](../../CLAUDE.md), the card, and the latest handoff or ownership block.
2. `git fetch origin`, then compare the worktree branch HEAD with `last_pushed_commit` and with
   `origin/<branch>`.
3. If local commits are not pushed, inspect them before pushing. If the remote is ahead, find out who
   pushed and why before doing anything else.
4. Never reset, force-push, or discard someone else's commits or uncommitted work. If the state is
   unclear, stop and ask on the card.
5. Post a `[Claude-0N] RESUMED` comment with the verified HEAD.

## Stale task detection

A claimed ticket with no push and no Trello update for 48 hours is stale. Any agent or the
coordinator may flag it with a comment and notify the owner. A stale ticket is never reassigned
automatically: only the owner or coordinator reassigns it, after checking the branch for unpushed
or in-progress work.

## Reporting completed work

On completion the agent posts [`templates/completion-report.md`](templates/completion-report.md) on
the card: commits (SHAs), files created and changed, tests run with real results, checks deferred to
merge verification, documentation updated, remaining risks. It then moves the card to Development
Complete and releases the lock. It never reports acceptance, merge or deployment that has not
happened.

## Future orchestration interface (not implemented)

Status: described for planning only. No orchestrator exists, and nothing in this section is
implemented.

A future orchestrator could automate the mechanical parts of this policy:

| Inputs | Outputs |
|---|---|
| Trello Ready for Development list and priorities | Proposed agent-to-ticket assignments |
| Ownership blocks and open branches | Detected file-ownership overlaps and dependency order |
| ADR registry on `main` and branch headings | Proposed next free ADR number |
| Push and comment timestamps | Stale-ticket flags |
| Completion reports | Integration plan drafts |

Constraints on any such orchestrator: it may propose and report, but it must not bypass owner
approval. It never moves a card to Ready for Development, Ready to Merge or Complete, never merges,
never deploys, never changes AWS, never breaks a lock, and never reassigns a stale ticket on its
own. Adopting one needs an owner decision and an ADR.
