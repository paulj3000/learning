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

Roles (who proposes assignment, who reassigns) are in the role table in
[`AGENTS.md`](../../AGENTS.md#1-roles). This is the one list of claim conditions; other documents
link here.

1. Read the Ready for Development list in priority order (top first, unless the owner has said otherwise).
2. A card is eligible only when all of these hold:
   - it is in Ready for Development and has testable acceptance criteria;
   - its `assigned_agent` is empty, or names you by the owner's decision (ChatGPT may relay it);
   - every dependency is merged to `main` or Complete, except a dependency whose contract is
     pushed and frozen (work-package step 1 below), which may be consumed but not changed;
   - its owned files do not overlap an active claim (see shared-file conflicts below);
   - it does not touch an APPROVAL task, AWS or an open gate that the owner has not cleared.
3. Claim the first eligible card: post the claim comment, fill the card's ticket block
   ([`trello-workflow.md`](trello-workflow.md#ticket-block)), then move the card to In Development.

Claim comment:

```text
[Claude-0N] CLAIM
ticket: <ticket-id>
branch: <branch>
worktree: <worktree-dir>
baseline: <full origin/main SHA>
scope: <one line>
owned: <paths or components>
```

If two agents claim the same card, the earlier claim comment wins; the later agent withdraws with a
comment and picks another card.

## Locking and branch ownership

- One owner per ticket. Ticket ownership (the branch and the lock) belongs to the agent named in
  the card's current `assigned_agent`. The lock is tied to that ticket and agent id, not to a
  session.
- Only the owning agent pushes to the ticket branch. Others may read it (`git show origin/<branch>:<path>`)
  but do not commit to it, rebase it or force-push it.
- The lock is released by a handoff (see Handoff below), or by completion (card reaches
  Development Complete with the completion report). The branch stays; ownership of rework returns
  to the same agent unless the owner reassigns it.
- Only the owner breaks a lock or reassigns a ticket (for example after stale detection); ChatGPT
  may relay and record that decision with a link to its source. The change is recorded with a
  comment and in `assigned_agent`.

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
reconciliation reserved ADR-063 for the movement branch. This is the one numbering procedure;
[`integration-policy.md`](integration-policy.md#adr-numbers), [`templates/adr.md`](templates/adr.md),
[`documentation-policy.md`](documentation-policy.md) and [`AGENTS.md`](../../AGENTS.md) link here.
While drafting, write the identifier as the placeholder `ADR-NNN` (ignored by `npm run adr:check`).

1. Read the registry on `main` (`git show origin/main:docs/DECISIONS.md`, including `Reserved`
   rows) and grep every open branch for numbers in use:
   `git fetch origin && git grep -E "ADR-[0-9]{3}" $(git for-each-ref --format='%(refname)' refs/remotes/origin) -- docs/DECISIONS.md`.
2. Take the next number that is free everywhere: on `main`, in every `Reserved` row and on every
   open branch.
3. Record it immediately as a comment on the ticket's Trello card
   (`[Claude-0N] ADR number: ADR-NNN for <title>`), so parallel agents see it before any merge.
4. On the branch, replace the placeholder and add the registry row with status `Proposed`.
5. If two branches still collide, the owner resolves it under governance rules 3 and 5 in
   [`docs/DECISIONS.md`](../DECISIONS.md): renumber by reading content, never by search and replace.

Never renumber another branch's ADR on your own.

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
3. **Integration (serial).** One agent, named by the owner on the integration ticket, integrates the packages on
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
- ChatGPT proposes merge order (contracts and migrations first); the owner decides it.
- Integration branches are created as [`integration-policy.md`](integration-policy.md#integration-branches)
  states: by the owner or an agent the owner names on the integration ticket.

## Blocker escalation

| Blocker | Action |
|---|---|
| Owner decision needed | Comment on the card with the question and options, move it to Blocked, continue only on independent work |
| Dependency on another agent's ticket | Comment on both cards; if no answer in one working day, escalate to ChatGPT and the owner |
| Infrastructure failure (worker timeout, out of memory, missing database) | Report as infrastructure, separately from test failures ([`docs/TESTING_STRATEGY.md`](../TESTING_STRATEGY.md)); rerun only affected files |
| Network or permission refusal | Report it; do not work around a security control |

## Handoff

A handoff uses [`templates/agent-handoff.md`](templates/agent-handoff.md) and includes the current
ownership block, everything pushed (no unpushed work is handed off), checks run and their results,
open questions and next steps. Post it as a Trello comment. A handoff is required when an agent
stops deliberately before completion, and best-effort when a session ends abruptly (see Session
recovery).

- The departing agent does not choose its successor. The owner (or ChatGPT relaying a recorded
  owner decision, with a link to it) names the new assignee, and `assigned_agent` on the card is
  updated; until then the ticket returns to Ready for Development.
- The receiving agent posts its own claim comment, then creates its **own** worktree from the
  pushed branch and works only there. The old worktree still has the branch checked out, so the
  new one starts detached and pushes to the same branch:

  ```bash
  git fetch origin
  git worktree add --detach ../wt-<branch with / replaced by ->-<receiving agent id> origin/<branch>
  git push origin HEAD:<branch>   # when pushing work
  ```

- The old worktree is left untouched until its creator or the owner removes it.

## Session recovery

Agents push at regular checkpoints (each meaningful commit), so an abrupt session end leaves the
work on `origin`. A resumed session for the same ticket in the same worktree continues as the same
assigned agent: the lock belongs to the ticket and agent id on the card, not to the session.

After a container restart, an abrupt session end, or a new session on an existing ticket:

1. Check that the card's `assigned_agent` still names you. If it does not, stop: the ticket was
   reassigned, and your old worktree is left as it is for the owner.
2. Re-read [`CLAUDE.md`](../../CLAUDE.md), the card, and the latest handoff or ownership block.
3. In your own worktree, `git fetch origin`, then inspect `git status`, `git stash list` and
   unpushed commits (`git log origin/<branch>..HEAD`); compare HEAD with `last_pushed_commit` and
   with `origin/<branch>`.
4. Review leftover uncommitted changes and unpushed commits before committing or pushing them. If
   the remote is ahead, find out who pushed and why before doing anything else.
5. Never reset, force-push, or discard someone else's commits or uncommitted work. If the state is
   unclear, stop and ask on the card.
6. Post a `[Claude-0N] RESUMED` comment with the verified HEAD.

## Stale task detection

A claimed ticket with no push and no Trello update for 48 hours is stale. Any agent or ChatGPT
may flag it with a comment and notify the owner. A stale ticket is never reassigned
automatically: only the owner reassigns it (ChatGPT may relay the decision), after checking the
branch for unpushed or in-progress work.

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
