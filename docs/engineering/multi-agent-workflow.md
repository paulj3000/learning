# Multi-Agent Workflow

- **Status:** Mandatory policy (merged to `main` at the owner's direction on 2026-11-18; formal acceptance of ADR-072 pending). Rules restated from CLAUDE.md and accepted ADRs bind through those sources.
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-072 (Proposed); ADR-063 and ADR-055 (the collision that motivates ADR reservation)
- **Canonical sources:** [`docs/DECISIONS.md`](../DECISIONS.md) "ADR registry and governance"; [`branch-policy.md`](branch-policy.md); [`trello-workflow.md`](trello-workflow.md)

Up to five Claude Code agents, Claude-01 to Claude-05, work at the same time in isolated worktrees,
alongside agents from other tools under owner-assigned ids. Agents are not tied to features: the
owner approves priorities and assignment, and an agent may self-claim only an unclaimed card in
Ready for Development.
This document defines how they identify themselves, claim and lock work, avoid shared-file
conflicts, hand off, recover and report.

## Agent identity

| Where | Form |
|---|---|
| Agent id | `Claude-01` to `Claude-05`, assigned by the owner when the session starts. Agents from other tools get an owner-assigned id `<Tool>-NN` in the same format (for example `Codex-01`). An agent without an assigned id asks before claiming |
| Commit messages | Trailer line `Agent: <agent id>` (for example `Agent: Claude-01`), alongside any attribution trailers the session requires |
| Trello comments | First line `[<agent id>]` (for example `[Claude-01]`) |
| Handoffs and reports | `agent_id: <agent id>` in the ownership block and in [`templates/agent-handoff.md`](templates/agent-handoff.md) or [`templates/completion-report.md`](templates/completion-report.md) |
| Pull requests | Agent id in the PR description ([`templates/pull-request.md`](templates/pull-request.md)) |

An agent never uses another agent's id, and never writes as the owner.

## Assignment and claiming

The owner approves priorities and assignment. ChatGPT drafts specifications, tickets and
priorities for owner approval, and directs assignment only as far as the owner delegates it. An
agent may self-claim only a card in Ready for Development that is unclaimed:

1. Read the Ready for Development list in priority order (top first, unless the owner has said otherwise).
2. Skip a card that is already claimed or assigned to someone else; a card whose dependencies are
   not merged, Complete, or (for a contract dependency) pushed and frozen as recorded on the
   provider card; and a card whose owned files overlap an active claim (see shared-file conflicts
   below).
3. Claim the first eligible card: post the claim comment, fill the card's ticket block
   ([`trello-workflow.md`](trello-workflow.md#ticket-block)), then move the card to In Development.

Claim comment (field names match the ticket block):

```text
[<agent id>] CLAIM
ticket_id: <ticket-id>
branch: <branch>
worktree: <worktree-dir>
baseline_sha: <full origin/main SHA>
scope: <one line>
owned_components: <paths or components>
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

Branch names and the worktree naming rule are defined in [`branch-policy.md`](branch-policy.md)
("Branch naming", "Worktrees"); this page does not repeat the table.

Create the worktree as a sibling of the main checkout:

```bash
git fetch origin
git worktree add -b feature/<ticket>-<slug> ../wt-feature-<ticket>-<slug> origin/main
```

One ticket, one branch, one worktree. An agent never edits files in another agent's worktree.
Legacy and harness session branches are listed in [`branch-policy.md`](branch-policy.md): leave
existing ones alone and use the conventions there for new work.

## Shared-file conflicts

The single list of coordination hotspots and the required action is in
[`integration-policy.md`](integration-policy.md#coordination-required): record the planned change
on the ticket before editing, list it under `shared_components` in the ownership block, and get
the owner's or coordinator's acknowledgement before merging. If a ticket needs a hotspot that an
active claim owns, sequence behind it (dependency) or agree the exact change in Trello comments
first. Conflicts that remain at merge time are resolved per
[`integration-policy.md`](integration-policy.md), by reading both changes, never by taking one
side wholesale.

## ADR number reservation

This is the one procedure for choosing an ADR number. [`integration-policy.md`](integration-policy.md),
[`documentation-policy.md`](documentation-policy.md) and [`templates/adr.md`](templates/adr.md)
link here instead of restating it.

Parallel branches have collided on ADR numbers: two decisions both used ADR-055, and the owner's
reconciliation reserved ADR-063 for the movement branch. As of 2026-11-18 open branches used
ADR-065 to ADR-071, ADR-080 and ADR-081; the governance change registered them as Reserved;
ADR-070 is used by two branches and awaits an owner decision.

While drafting, write the identifier as the placeholder `ADR-NNN` (ignored by `npm run adr:check`).
Then:

1. Read the registry on `origin/main` (`git fetch origin`, then
   `git show origin/main:docs/DECISIONS.md`) and `git grep` the open branches for `## ADR-`
   headings (for example `git grep "^## ADR-" $(git branch -r --format="%(refname:short)") -- docs/`).
2. Take the next number after every registry row (including `Reserved` rows) and every number a
   branch already uses.
3. Before the branch uses the number, add a `Reserved` row for it on `main` (governance rule 7)
   through a registry-only change the owner merges, or the coordinator records the number on the
   ticket for the owner to register. Record the number on the card.
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
agent_id: <agent id>
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
status: <logical state from trello-workflow.md: In Development | Blocked | Development Complete | Rework>
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
5. Post a `[<agent id>] RESUMED` comment with the verified HEAD.

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
