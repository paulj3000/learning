# Branch Policy

- **Status:** Mandatory policy
- **Owner:** project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-037, ADR-055, ADR-064, ADR-072 (proposed engineering governance)
- **Canonical sources:** [CLAUDE.md](../../CLAUDE.md) sections 14 and 18,
  [docs/DECISIONS.md](../DECISIONS.md) ("ADR registry and governance"),
  [docs/TESTING_STRATEGY.md](../TESTING_STRATEGY.md) ("When to run which checks")

This policy says how branches are named, how commits are written, what a pull request needs,
and how branches are cleaned up and rolled back. Merge ordering and conflict handling are in
[integration-policy.md](integration-policy.md). Deployment is in
[release-policy.md](release-policy.md).

## Protected branch: main

`main` is the integrated, releasable line. A push to `main` runs CI
([.github/workflows/ci.yml](../../.github/workflows/ci.yml)) and can also start the deploy
workflows (`deploy-dev-native.yml`, `deploy-dev-lambda.yml`, `deploy-django-ec2.yml`,
`deploy-site.yml`) when their repository variables are switched on. A merge to `main` must
therefore be treated as a possible deployment (see [release-policy.md](release-policy.md)).

Rules:

1. Agents never commit or push directly to `main`.
2. Changes reach `main` only through a pull request merged by the owner, or by an agent the
   owner has explicitly authorized for that specific merge. Authorization is recorded on the
   Trello card or the pull request.
3. Agents never force-push, rebase, reset or delete `main`, and never rewrite published history
   on any shared branch.
4. A merge into `main` is not complete until the merge-readiness checks in
   [docs/TESTING_STRATEGY.md](../TESTING_STRATEGY.md) pass, including `npm run adr:check`
   (governance rule 4 in [docs/DECISIONS.md](../DECISIONS.md)).

This document does not change GitHub branch protection settings. Whatever protection rules are
configured in the GitHub repository settings remain as they are; changing them is an owner
action.

## Branch naming

Every new branch uses one of these patterns. `<ticket>` is the Trello or tracker ticket id
exactly as written on the card (for example `LAI-0805`, `SC-R04-05`, `SEA-04`); `<slug>` is
2 to 6 lowercase words joined by hyphens.

| Pattern | Use |
|---|---|
| `feature/<ticket>-<slug>` | New behaviour or a change to existing behaviour |
| `adventure/<realm>-<slug>` | Work scoped to one adventure or realm's content and gameplay (for example `adventure/north-pole-sleigh-route`) |
| `fix/<ticket>-<slug>` | Defect fixes (the ticket is the defect card) |
| `infra/<ticket>-<slug>` | CDK, workflows, scripts under `scripts/aws/`, deploy configuration |
| `integration/<yyyymmdd>-<topic>` | Combining completed branches for compatibility testing ([integration-policy.md](integration-policy.md)) |
| `docs/<ticket>-<slug>` | Documentation-only changes |
| `qa/<topic>-<yyyymmdd>` | QA evidence, test plans and QA fixtures, no product behaviour change |

Names are lowercase except the ticket id, which keeps its card spelling. No spaces, no
trailing slash, no personal names.

### Legacy and harness branches

These names exist in the repository and are tolerated. They are not used for new work:

- `claude/<random>` session branches;
- `wip/*`;
- `dev2026MMDD` dated branches;
- `ccr-*`;
- older prefixes such as `features/*`, `adventures/*` and `quest/*`.

Exception: when the session harness mandates a session branch (for example a `claude/<random>`
name assigned by the environment), use it, and record the mapping on the Trello card:

```text
Branch: claude/<random> (harness session branch; logical name feature/<ticket>-<slug>)
```

## Worktrees

Each agent works in its own worktree. The worktree directory name is `wt-` followed by the
branch name with every `/` replaced by `-`:

| Branch | Worktree |
|---|---|
| `feature/LAI-0805-layout-admin` | `wt-feature-LAI-0805-layout-admin` |
| `integration/20261118-movement` | `wt-integration-20261118-movement` |

Record the worktree path and the baseline commit (`baseline_sha`) in the ticket block
([trello-workflow.md](trello-workflow.md)). Never edit files in another agent's worktree.

## Commit messages

```text
<Imperative summary, at most 72 characters>

<Body: what changed and why, wrapped at about 72 columns. Note tests run and
anything deferred to merge verification.>

Ticket: <ticket id>
Agent: Claude-0N
<harness-required trailers, verbatim>
```

Rules:

- The summary is imperative and specific ("Keep exits reachable while a game panel is open"),
  at most 72 characters, no trailing period.
- The body explains intent and limits. It never contains secrets, child data, emails or
  fabricated test results.
- `Ticket:` names the ticket id. A commit that serves several tickets lists them comma-separated.
- `Agent: Claude-0N` names the agent (Claude-01 to Claude-05). The owner's own commits omit it.
- Trailers the session harness requires (for example `Co-Authored-By:` or `Claude-Session:`
  lines) are added exactly as the harness specifies.
- Do not add model identifiers (such as a model's API id) to commit messages yourself. A
  harness-required trailer is kept verbatim even if it names a model.
- Merge commits follow the existing style on `main`:
  `Merge: <what the change does> (PR #<n>, <ticket or Trello short id>)`.

## Pull requests

Every change to `main` goes through a pull request that:

- uses [templates/pull-request.md](templates/pull-request.md);
- names the ticket, the branch, the baseline commit and the owner approvals it relies on;
- lists tests run with their real results and the checks deferred to merge verification;
- states whether the merge can trigger a deployment workflow, and which;
- reserves any new ADR number in the registry of [docs/DECISIONS.md](../DECISIONS.md) before
  it is opened ([integration-policy.md](integration-policy.md)).

A pull request is opened by the agent that owns the branch. It is merged only as described in
"Protected branch: main".

## Cleanup

- Merged branches are deleted only with owner approval.
- Never delete another agent's or the owner's branch, local or remote, merged or not.
- Never delete a branch that an open pull request, a stacked branch or an integration branch
  still uses.
- Worktrees are removed by the agent that created them once the owner has approved deleting
  the branch.

## Rollback

- A bad change on `main` is undone with `git revert` on a `fix/<ticket>-<slug>` branch,
  merged through a pull request like any other change.
- Never force-push `main` and never reset it to an earlier commit.
- Reverting code does not reverse database migrations or deployed infrastructure. Follow
  [release-policy.md](release-policy.md) ("Rollback") for a deployed environment.
