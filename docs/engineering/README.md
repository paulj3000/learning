# Engineering Standards

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001

The engineering standards for Learning Adventure Island: how work is specified, claimed, built,
tested, integrated, accepted, merged and released by the owner, ChatGPT (project manager and
architect) and up to five Claude Code agents working in parallel worktrees.

Entry points: [`CLAUDE.md`](../../CLAUDE.md) for Claude agents, [`AGENTS.md`](../../AGENTS.md) for
any AI coding agent. This directory holds the detail they link to.

## Status of these standards

ADR-072 proposes this structure. Until the owner accepts it:

- a rule tagged `**Binding:** <source>` binds now, through that source (an accepted ADR, a
  `CLAUDE.md` section, `docs/TESTING_STRATEGY.md` or `docs/DECISIONS.md`);
- an untagged rule is a proposal: follow it as the documented way of working unless the owner or
  your ticket says otherwise, and report where it does not fit.

No document here changes an accepted ADR. If you find a conflict, the accepted ADR wins; report
the conflict.

## Documents

| Document | Use it when |
|---|---|
| [development-workflow.md](development-workflow.md) | Following a ticket from requirement to deployment: the 22 steps and who approves each |
| [multi-agent-workflow.md](multi-agent-workflow.md) | Claiming work, splitting a feature into work packages, recovering a session, handing off |
| [architecture-rules.md](architecture-rules.md) | Choosing where code goes and which shared service to use; checking what is implemented, transitional, retired or future |
| [coding-standards.md](coding-standards.md) | Writing Python, Django, TypeScript, React, Three.js, SQL or CDK |
| [testing-policy.md](testing-policy.md) | Deciding which tests to run now and which wait for merge readiness or owner QA |
| [security-policy.md](security-policy.md) | Anything touching child data, authorization, AI, uploads, storage, secrets or logs |
| [branch-policy.md](branch-policy.md) | Naming branches and worktrees, committing, stacking, cleaning up, rolling back |
| [integration-policy.md](integration-policy.md) | Combining branches, ordering merges, coordinating migrations and shared components |
| [release-policy.md](release-policy.md) | Environments, release candidates, deployment approvals, rollback |
| [trello-workflow.md](trello-workflow.md) | Card states, the machine-readable ticket block, evidence per transition |
| [definition-of-done.md](definition-of-done.md) | Deciding which completion gate a ticket has reached |
| [documentation-policy.md](documentation-policy.md) | Where a document belongs, its status, and when to update it |
| [product-baseline.md](product-baseline.md) | The full product, child-safety and AI rules (former `CLAUDE.md` sections 1 to 13) |
| [initial-audit.md](initial-audit.md) | The 2026-11-18 audit these standards were written from |
| [`../adventures/`](../adventures/README.md) | Building a Realm, adventure, quest or challenge |
| [`../adr/`](../adr/README.md) | Writing or citing an architecture decision |

### Templates

| Template | Used for |
|---|---|
| [feature-specification.md](templates/feature-specification.md) | A feature ChatGPT or the owner specifies, before it is split into tickets |
| [task-specification.md](templates/task-specification.md) | One Trello ticket, with its machine-readable block |
| [implementation-plan.md](templates/implementation-plan.md) | The agent's plan after its initial audit |
| [agent-handoff.md](templates/agent-handoff.md) | Stopping before a ticket is finished |
| [pull-request.md](templates/pull-request.md) | Every pull request description |
| [qa-checklist.md](templates/qa-checklist.md) | Owner QA of a build |
| [defect-report.md](templates/defect-report.md) | A defect found in QA or review |
| [release-notes.md](templates/release-notes.md) | A deployment to dev or production |
| [completion-report.md](templates/completion-report.md) | Closing a ticket at any completion gate |
| [ADR template](../adr/template.md) | An architecture decision (lands in `docs/DECISIONS.md`) |

Adventure templates (Realm, adventure, quest, challenge) are listed in
[`../adventures/README.md`](../adventures/README.md).

## Checks

`npm run docs:check` and `npm run adr:check` validate this documentation
([documentation-policy.md](documentation-policy.md), section 10). Both are cheap and need no
database or network.

## Owner approval checklist

Decisions LAI-ENG-001 cannot make. Each is listed with its default if the owner does nothing.

| # | Decision | Default until decided |
|---|---|---|
| 1 | Accept, amend or reject ADR-072 (this structure, and the untagged proposals in every document here) | Proposed; untagged rules are guidance |
| 2 | Accept the restructured `CLAUDE.md` (sections condensed, numbers kept, full former text in [product-baseline.md](product-baseline.md)) | Takes effect when the branch merges |
| 3 | Approve the `Reserved` rows for ADR-065 (Castle Director) and ADR-066 to ADR-071 (processing workstreams), which open branches use without rows on `main` | Rows stay; each branch replaces its row on merge |
| 3a | **Resolve the ADR-070 collision:** processing "GLB optimization" and Firepeak "Heart of Firepeak" both use it (registry rules 3 and 5) | Neither branch may merge until decided |
| 3b | Require the processing branches to move their ADR bodies from `docs/processing/adr/` into `docs/DECISIONS.md` when they merge ([adr/README.md](../adr/README.md)) | Single log rule applies |
| 3c | **Rotate the test parent account password** found in tracked `.claude/settings.json`, and decide whether to remove those allow rules (outside this ticket's scope; not edited) | Credential stays exposed in history |
| 3d | Confirm the deploy gate variables (`LAI_DEPLOY_ENABLED`, `LAI_DEV_NATIVE_ENABLED`, `LAI_SITE_DEPLOY_ENABLED`) before any merge to `main`, including this branch, whose `package.json` and `react/` changes match `deploy-site.yml`'s path filter | A merge may start a release when a variable is on |
| 4 | Add `npm run docs:check` to `.github/workflows/ci.yml` (it already runs in `make js-check`) | Not in CI |
| 5 | Trello: optional new lists or named labels for the logical states mapped in [trello-workflow.md](trello-workflow.md) | Existing nine lists, unchanged |
| 6 | The stale-claim threshold in [multi-agent-workflow.md](multi-agent-workflow.md) | As proposed there; flagged, never auto-reassigned |
| 7 | Branch protection on `main` as described in [branch-policy.md](branch-policy.md) (needs GitHub admin access; settings could not be read) | Unchanged |
| 8 | Whether a stable staging environment is planned ([release-policy.md](release-policy.md)) | None exists; dev and prod only |
| 9 | Decisions on the five Proposed ADRs whose code is on `main` (ADR-036, ADR-043, ADR-048, ADR-049, ADR-050) | Proposed |
| 10 | Whether to deprecate `docs/decisions_adr.md` (a working note duplicating ADR-027) | Kept |
| 10a | Which stale documents to correct (16 conflicts in [initial-audit.md](initial-audit.md), section 9), and record a naming ADR for Realm versus Island | Unchanged; standards follow the accepted ADRs and the code |
| 11 | Legal review of the child-privacy items listed in [security-policy.md](security-policy.md) | No compliance claim is made |

## Rolling these standards out to the existing worktrees

The standards reach other branches only through `main`. Nothing here touches another agent's
worktree. After the owner merges `feature/engineering-standards`:

1. **Tell each active agent** (Claude-01 to Claude-05) at its next task boundary, not mid-change:
   "Engineering standards merged to `main` at `<sha>`. Read `CLAUDE.md` (section 21),
   `AGENTS.md` and `docs/engineering/README.md`."
2. **Each agent updates its own branch** when it next syncs with `main`, by its branch's usual
   method ([branch-policy.md](branch-policy.md)): `git fetch origin`, then merge or rebase onto
   `origin/main` in its own worktree. No open branch edits `CLAUDE.md`, `AGENTS.md`,
   `docs/engineering/` or `docs/adventures/` (checked 2026-11-18), so the only expected conflict is
   the `docs/DECISIONS.md` registry: keep both sides' rows, and a branch that defines ADR-065
   replaces the `Reserved` row with its own (registry rule 3).
3. **Each agent fills in its ticket block** on its Trello card
   ([trello-workflow.md](trello-workflow.md)): agent ID, branch, worktree, baseline SHA, pull
   request, last pushed commit, blockers. Existing card history stays; add a dated entry.
4. **Work in progress is not redone.** Finished work is not re-specified to the new templates.
   The new pull request, completion report and QA templates apply to the next pull request or
   gate each ticket reaches.
5. **New tickets** use the [task specification](templates/task-specification.md) from the start.
6. **Before standards merge,** an agent that wants them can read them without changing its
   worktree: `git show origin/feature/engineering-standards:AGENTS.md`.

Do not copy these files into another branch by hand; that creates competing copies and merge
conflicts.
