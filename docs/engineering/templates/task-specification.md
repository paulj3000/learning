# Task Specification: <ticket title>

> **Status:** Template
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001

One implementation task for one agent on one branch. The ticket block below is the same block that
starts the Trello card description ([../trello-workflow.md](../trello-workflow.md), section 5).
Use `TBD` or `[]` for unknown values; never guess.

## Ticket

```yaml
ticket_id: LAI-<AREA>-<NNN>
title: <short title>
project: Learning Adventure Island
type: <feature | adventure | defect | infrastructure | integration | docs | spike>
priority: <P0 | P1 | P2 | P3>
status: <backlog | specification | ready-for-development>
assigned_agent: <Claude-NN | owner | TBD>
branch: <prefix>/<name>
worktree: /Coding/learning-worktrees/<short-name>
baseline_sha: <sha | TBD>
dependencies: []
owned_components: []
shared_components: []
acceptance_criteria: []
test_requirements: []
owner_approval_required: <true | false>
pull_request: TBD
implementation_commit: TBD
blockers: []
```

Parent feature: `<LAI-<AREA>-<NNN> or None>`

## Objective

`<What this task delivers, in one or two sentences.>`

## Scope

- `<included item>`

## Out of scope

- `<excluded item>`

## Dependencies

| Dependency | Must be | Status |
|---|---|---|
| `<ticket, PR or decision>` | `<merged / available on parent branch / decided>` | `<status>` |

## Owned components

`<Paths this task may change freely. Nobody else changes them during the task.>`

## Shared components

`<Shared components touched, using the names in ../integration-policy.md section 5, and the
coordination agreed. "None" if none.>`

## Acceptance criteria

- [ ] `<criterion>`

## Test requirements

- `<test to add or update, with path>`
- `<development checks to run (see ../../TESTING_STRATEGY.md)>`
- `<checks deferred to merge verification>`

## Owner approval required

`<Yes or No. If yes: what needs approval (APPROVAL task, AWS, deploy, data, ADR) and at which
point work stops.>`
