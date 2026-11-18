# Branch Policy

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-063, ADR-064

How branches, worktrees, commits and pull requests are named and handled in this repository.
It codifies the practice already visible in `git log` and the open pull requests, and adds the
rules that were missing. Merge ordering and integration branches are in
[integration-policy.md](integration-policy.md); completion gates are in
[definition-of-done.md](definition-of-done.md).

Untagged rules are proposals under ADR-072. Rules tagged **Binding:** already apply today.

## 1. The `main` branch

`main` is the only long-lived branch. It is the baseline for every new branch and the only branch
from which the deploy workflows release (see [release-policy.md](release-policy.md)).

**Branch protection is not verified.** The GitHub branch protection settings for
`paulj3000/learning` could not be read for this policy: the `gh` CLI is not installed and the
GitHub connector fails authentication on this workstation. The rules below are the required
policy. Do not claim they are enforced by GitHub until the owner confirms the settings.

Required policy for `main`:

| Rule | Detail |
|---|---|
| No direct commits by agents | Agents never commit or push to `main`. Changes reach `main` through a pull request merged by the owner, or by a merge the owner explicitly authorizes. |
| No force push | Never force-push `main`, never rewrite its history, never delete it. |
| CI on pull requests | `.github/workflows/ci.yml` runs on every pull request and on every push to `main` (jobs: checks, e2e, python). A pull request is not merged with a failing required job unless the owner records why. |
| Owner merges | Only the owner merges to `main`, or authorizes a named agent to perform one specific merge. **Binding:** CLAUDE.md §18 (no deploy without approval; a merge to `main` can trigger a deploy workflow, see release-policy.md) |
| Linear evidence | Every merge commit names its pull request and ticket (section 4). |

Recommended GitHub settings, for the owner to apply (owner decision): require a pull request
before merging, require the CI status checks, block force pushes and deletion of `main`.

## 2. Branch naming

New branches use one of these prefixes, a lowercase kebab-case description, and, where it helps,
the ticket ID.

| Prefix | Use | Example shape |
|---|---|---|
| `feature/` | A feature, engine change, backend change, or tooling change | `feature/<short-description>` |
| `adventure/` | A new or reworked Realm, Adventure or 3D Area built on the shared engine | `adventure/<realm-or-adventure-name>` |
| `fix/` | A defect fix (Owner QA defect, production defect, review fix) | `fix/<short-description>` |
| `infra/` | Infrastructure code under `infra/`, `scripts/aws/`, `deploy/` or deploy workflows | `infra/<short-description>` |
| `integration/` | An integration branch that combines finished branches for compatibility testing (integration-policy.md) | `integration/<purpose>` |
| `docs/` | Documentation-only changes | `docs/<short-description>` |

Rules:

1. One branch per ticket. A ticket split into implementation tickets gets one branch per
   implementation ticket.
2. Branch from current `origin/main` unless the ticket names a different baseline (a stacked
   branch, section 6, or an integration branch).
3. Record the branch name and baseline SHA in the ticket block
   ([trello-workflow.md](trello-workflow.md), "Machine-readable ticket block").
4. Do not reuse a branch name after the branch has been merged or abandoned.

### Existing branch names are not renamed

Branches created before this policy keep their names. Renaming a pushed branch breaks open pull
requests, worktrees and Trello references. Legacy prefixes seen in the repository on 2026-11-18:

| Prefix | Notes |
|---|---|
| `claude/` | Branches created by Claude Code sessions (for example the ADR-053 branch) |
| `features/` | `features/ai`, `features/studio` (plural form) |
| `wip/` | Work in progress, never merged as-is |
| `qa/` | Owner QA acceptance branches |
| `work/` | Local Storykeeper Castle work branches |
| `core/` | `core/gameengine` |
| `np/` | Local work branches of one feature line |
| `ccr-*` | Automatically generated remote branches |
| others | `phase-*`, `quest/`, `adventures/`, `storykeeper-*`, `dev2026*` one-off names |

New work does not use these prefixes.

## 3. Worktrees

Parallel work uses Git worktrees so agents never share a working directory.

| Rule | Detail |
|---|---|
| Location | `/Coding/learning-worktrees/<short-name>` (repository-relative convention: `../learning-worktrees/<short-name>`) |
| Short name | Lowercase kebab-case, recognizable from the branch (`firepeak`, `npc-manager`, `engineering-standards`) |
| One branch per worktree | Do not switch a worktree to another agent's branch |
| Ownership | An agent writes only in its own worktree. Never commit, stash, reset or clean in another agent's worktree |
| Record | The worktree path goes in the ticket block and the agent handoff |
| Removal | Remove a worktree only after its branch is merged or abandoned and the owner agrees (section 7) |

The main checkout (`/Coding/learning`) stays on `main` and is not used for feature work by agents.
See [multi-agent-workflow.md](multi-agent-workflow.md) for agent assignment.

## 4. Commit conventions

Match the existing repository practice:

| Element | Convention |
|---|---|
| Subject | Plain imperative sentence, no trailing period, about 72 characters or fewer. Example from `main`: "README and installer: the GitHub CLI is optional for the first dev deployment". An area prefix followed by a colon is fine. |
| Body | What changed and why, wrapped at about 100 characters. Name the ticket ID (`LAI-<AREA>-<NNN>`) and any ADR. |
| Merge commits on `main` | `Merge: <summary> (PR #<n>, Trello <id>)`. Example: "Merge: NPC dialogue keeps Pip's greeting when an empty play trigger races it (PR #34, Trello CeKICNoP)". |
| Merges into integration branches | "Merge <branch> (PR #<n>) into <integration branch purpose>", as on `integration/gameplay-environment-qa`. |
| Trailers | Keep `Co-Authored-By:` and session trailers when the tool adds them. Do not add attribution a tool did not produce. |
| Conventional-commit prefixes | Allowed but not required (some branches use them). Do not rewrite history to add or remove them. |
| Secrets | Never commit secrets, `.env` files, credentials or child data. **Binding:** CLAUDE.md §13 |

Commit small, coherent steps. Do not mix a backend domain change and a world conversion in one
task. **Binding:** CLAUDE.md §19

## 5. Pull requests

Every change to `main` goes through a pull request.

1. Use the template [templates/pull-request.md](templates/pull-request.md). Every required section
   is filled or says "None" with a reason.
2. Link the Trello card and name the ticket ID in the title or summary.
3. List the checks run and the checks **deferred to merge verification**.
   **Binding:** TESTING_STRATEGY.md ("When to run which checks")
4. Declare shared component changes and migrations (integration-policy.md, section 4).
5. State the deployment impact: which deploy workflows the merge triggers by path
   (release-policy.md, section 3).
6. PR creation: pushes work over SSH, but the `gh` CLI is not installed and the GitHub connector
   fails authentication on this workstation, so the owner opens pull requests from the pushed
   branch. The agent supplies the filled template text.
7. An agent never merges its own pull request without explicit owner authorization.

## 6. Stacked branches

A branch may build on another unmerged branch when it depends on that work.

Real example (movement line): PR #26 `feature/shared-jump-controller` is the base of PR #27
`feature/third-person-avatar`, which is the base of PR #28 `feature/player-avatar-assets`, which
is the base of PR #29 `feature/player-running`. PR #37 `feature/interactive-platforms` and PR #38
`feature/pirates-leap` continue the stack. Ancestry was verified with `git merge-base
--is-ancestor` on 2026-11-18.

Rules:

1. Record the parent branch and its SHA as the baseline in the ticket block.
2. The pull request description names its parent PR and says it must merge after it.
3. Merge bottom-up: the parent first, then each child, rebased or merged onto the new `main`.
4. A fix to a lower branch is made on that branch and merged upward; never fix it only in a child.
5. Keep stacks short. Prefer an integration branch (integration-policy.md) for testing several
   independent branches together.

## 7. Branch cleanup

1. Delete a branch only after its merge into `main` is verified (`git branch -r --merged
   origin/main` or the merged pull request) **and** the owner approves the deletion.
2. Keep superseded branches until the owner decides otherwise. Example: PR #40 and PR #41
   (processing) were superseded by PR #42 and PR #43 under ADR-064 and the branches were retained.
3. Remove the matching worktree only after the branch is merged or abandoned and nothing
   uncommitted remains in it.
4. Never delete another agent's branch or worktree.

## 8. Rollback of a change on `main`

1. Revert with `git revert <sha>` (use `-m 1` for a merge commit) on a `fix/` branch, and open a
   pull request like any other change.
2. Never force-push `main` and never reset it to an earlier commit.
3. A revert that touches migrations needs its own migration plan: Django migrations are never
   reversed by the deploy scripts (release-policy.md, section 7).
4. Reverting code does not roll back a deployed environment. Environment rollback is a separate,
   owner-authorized workflow dispatch (release-policy.md).
5. Record the revert in Trello with a dated entry and reopen or create a defect card.
