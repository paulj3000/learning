# Development Workflow

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001

This document defines the lifecycle of one unit of work, from an identified requirement to an
authorized deployment. It applies to every agent ([AGENTS.md](../../AGENTS.md)). Running several
agents at once is covered in [multi-agent-workflow.md](multi-agent-workflow.md).

## Principles

- Trello is the authority for task state; GitHub is the authority for code evidence
  ([trello-workflow.md](trello-workflow.md)).
- Every step leaves evidence another agent or the owner can check without asking.
- Approvals are never implied by silence, by an agent message or by passing tests.
- Each task follows CLAUDE.md section 14: state acceptance criteria, make the smallest coherent
  change, add tests, run the development checks, update `docs/IMPLEMENTATION_STATUS.md`, report.
  **Binding:** CLAUDE.md §14.

## The 22-step lifecycle

"Automatable" means an agent or tool may perform the step without a new decision. "Owner
approval" means the step does not happen until the owner explicitly approves it.

| # | Step | Actor | Inputs | Outputs and evidence | Automatable or owner approval |
|---|---|---|---|---|---|
| 1 | Requirement identified | Owner, ChatGPT, or an agent reporting a gap | Product goals, defects, audits | Short problem statement | Anyone may raise; owner decides whether to pursue |
| 2 | Structured specification written | ChatGPT | Requirement, CLAUDE.md, relevant ADRs | Spec using [feature-specification.md](templates/feature-specification.md) or [task-specification.md](templates/task-specification.md) | Automatable draft; owner reviews |
| 3 | Trello ticket created or updated | ChatGPT or coordinator | Spec | Card `LAI-<AREA>-<NNN>` with the machine-readable fields ([trello-workflow.md](trello-workflow.md)) | Automatable |
| 4 | Dependencies and acceptance criteria defined | ChatGPT, owner | Spec, open branches, ADR registry | `dependencies`, `acceptance_criteria`, `owned_components`, `shared_components`, `test_requirements`, `owner_approval_required` filled | Automatable draft; owner confirms |
| 5 | Approved into Ready for Development | Owner | Complete ticket | Card in Ready for Development | **Owner approval** |
| 6 | Agent assigned | Coordinator or owner | Ready card, agent availability, priority | `assigned_agent` set (Claude-01 to Claude-05) | Automatable from Trello priority; owner may override |
| 7 | Dedicated worktree and branch created | Assigned agent | Ticket, `origin/main` | Worktree path, branch name and baseline SHA on the card; claim comment | Automatable |
| 8 | Initial technical audit | Assigned agent | Ticket, code at baseline, docs it names | Audit findings (what exists, what conflicts, what is missing) | Automatable |
| 9 | Implementation plan | Assigned agent | Audit | Plan using [implementation-plan.md](templates/implementation-plan.md), shared component changes named | Automatable; owner approval if it changes scope, adds a dependency, touches an APPROVAL task or proposes an ADR |
| 10 | Development | Assigned agent | Plan | Commits on the ticket branch | Automatable |
| 11 | Unit tests implemented and run | Assigned agent | Changed code | New or updated tests; command lines and results | Automatable ([testing-policy.md](testing-policy.md)) |
| 12 | Documentation updated | Assigned agent | Change | Updated docs; dated entry in `docs/IMPLEMENTATION_STATUS.md` | Automatable |
| 13 | Commit and push | Assigned agent | Passing development checks | Pushed branch; last pushed SHA | Automatable (never to `main`) |
| 14 | Trello updated with evidence | Assigned agent | Pushed commits, test results | Card comment with SHA, tests run, deferred checks; card in Development Complete | Automatable |
| 15 | Pull request created | Agent prepares, owner opens | Branch, [pull-request.md](templates/pull-request.md) | PR description and compare URL; PR number on the card once opened | Agent drafts; owner opens (see below) |
| 16 | Integration requirements identified | Agent, coordinator | PR, other open branches | Overlaps, merge order, stacked base, migration and ADR number conflicts ([integration-policy.md](integration-policy.md)) | Automatable analysis; owner decides integration order |
| 17 | Authorized merge-readiness checks | Agent or coordinator, when requested | Request from the owner | `make check`, browser suites as relevant, deferred checks, `npm run adr:check`; results | Runs only when the owner explicitly requests merge or release readiness |
| 18 | Submitted for owner QA | Coordinator | Passing merge-readiness checks, [qa-checklist.md](templates/qa-checklist.md) | Card in Owner QA; QA build and instructions | Automatable submission |
| 19 | Defects corrected | Assigned agent | [defect-report.md](templates/defect-report.md) entries; card in Rework Required | Fix commits, tests, updated evidence | Automatable; returns to step 17 or 18 as the owner directs |
| 20 | Owner approves acceptance | Owner | QA result | Acceptance comment on the card; card moves toward Ready to Merge | **Owner approval** |
| 21 | Merge through authorized process | Owner (or an agent explicitly instructed for that merge) | Accepted PR | Merge commit on `main`; card in Complete or awaiting deployment | **Owner approval** |
| 22 | Deployment only after explicit authorization | Owner, or an agent explicitly authorized for that deployment | Merged `main`, [release-notes.md](templates/release-notes.md) | Deployment record and verification | **Owner approval** (**Binding:** CLAUDE.md §18) |

Gate names used on the card (Development Complete, Integration Complete, Owner Accepted, Merged,
Deployed, Complete) are defined in [definition-of-done.md](definition-of-done.md).

## Step 7: worktree and branch commands

Run from the main checkout (`/Coding/learning`). Choose a short, unique worktree name and a branch
name that follows [branch-policy.md](branch-policy.md).

```bash
git fetch origin
git worktree add -b <branch> /Coding/learning-worktrees/<name> origin/main
cd /Coding/learning-worktrees/<name>
git rev-parse HEAD    # record as baseline_sha on the Trello card
```

When the ticket names a different base (a stacked feature or an integration branch), replace
`origin/main` with that branch and record it on the card. List existing worktrees before choosing
a name:

```bash
git worktree list
```

Never reuse a worktree that belongs to another ticket or agent. Removing a worktree after merge
(`git worktree remove`) is done by its owning agent or the owner.

## Steps 8 and 9: audit and plan

The audit records what exists at the baseline SHA, which shared components the ticket touches,
which ADRs apply, and any conflict with the ticket's assumptions. The plan lists files and
components, shared component changes, the test plan, risks and open questions. If the audit shows
the ticket is wrong (a dependency is missing, a decision is needed), stop and report a blocker
rather than guessing.

## Steps 10 to 13: develop, test, document, push

- Stay inside the scope and the owned components on the ticket.
- Run the development checks only: targeted Vitest and pytest by path, `npm run typecheck` when
  TypeScript changed, focused regression tests, and the security and privacy checks the change
  touches. **Binding:** [TESTING_STRATEGY.md](../TESTING_STRATEGY.md) ("When to run which checks").
- Add a dated section for the ticket to `docs/IMPLEMENTATION_STATUS.md` listing what was done,
  tests run, and checks deferred to merge verification. **Binding:** CLAUDE.md §14.
- Commit with plain imperative subjects. Push the ticket branch only:

```bash
git push -u origin <branch>
```

## Step 15: pull requests (current process)

The `gh` CLI is not installed on this workstation and the GitHub connector currently fails
authentication. Pushes work over SSH. Until that changes:

1. The agent pushes the branch and writes the PR description from
   [pull-request.md](templates/pull-request.md), naming the base branch (usually `main`, or the
   branch it is stacked on).
2. The agent posts the description and the compare URL on the Trello card:
   `https://github.com/paulj3000/learning/compare/main...<branch>` (replace `main` with the base
   for a stacked PR).
3. The owner opens the PR. The agent or coordinator records the PR number on the card.

If PR tooling becomes available, the agent may open the PR itself, still never merging it.

## Steps 16 to 22: integration, QA, merge, deployment

- Integration analysis and integration branches follow [integration-policy.md](integration-policy.md).
- Merge-readiness checks (`make check`, `npm run test:e2e`, `npm run test:acceptance`,
  `npm run content:check`, `npm run adr:check`) run only when the owner explicitly requests them.
- QA uses [qa-checklist.md](templates/qa-checklist.md); defects use
  [defect-report.md](templates/defect-report.md) and return the card to Rework Required.
- Merges to `main` and releases follow [release-policy.md](release-policy.md).
- No AWS deployment, `cdk deploy`, data migration or change to deployed resources happens without
  explicit owner approval for that action. `npm run infra:synth:dev` and
  `npm run infra:synth:prod` are allowed because they do not deploy. **Binding:** CLAUDE.md §18.
- At completion, the agent files [completion-report.md](templates/completion-report.md).

## Approval summary

| Needs explicit owner approval | Never done by an agent alone |
|---|---|
| Ready for Development (step 5) | Commit to `main` |
| Scope expansion, new dependency, new ADR, APPROVAL roadmap task (step 9) | Merge overlapping feature branches |
| Merge-readiness run (step 17) | Accept an ADR or change its text |
| Acceptance (step 20) | Deploy or call live AWS services |
| Merge (step 21) | Mark an unverified acceptance criterion complete |
| Deployment (step 22) | |
