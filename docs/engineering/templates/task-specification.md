# Task Specification Template

- **Status:** Guidance (template)
- **Owner:** project owner
- **Last reviewed:** 2026-11-18
- **Canonical sources:** [trello-workflow.md](../trello-workflow.md),
  [definition-of-done.md](../definition-of-done.md), [docs/TESTING_STRATEGY.md](../../TESTING_STRATEGY.md)

One task is one verifiable outcome that fits one agent session. Copy below the line into the
Trello card description.

---

# <ticket id>: <task title>

## Ticket Block

```yaml
ticket_id: <ticket id>
title: <task title>
project: Learning Adventure Island
type: <feature | adventure | defect | infra | docs | qa | integration | spike>
priority: <P0 | P1 | P2 | P3>
status: <logical state>
assigned_agent: <Claude-0N>
branch: <branch name>
worktree: <worktree directory>
baseline_sha: <full SHA>
dependencies: []
owned_components: []
shared_components: []
acceptance_criteria: []
test_requirements: []
owner_approval_required: <true | false>
pull_request: <PR URL or empty>
implementation_commit: <full SHA or empty>
blockers: []
```

## Parent Feature

`<parent ticket id>` (<link to feature specification>)

## Objective

<What this task delivers, in one or two sentences.>

## Scope

- In scope: <items>
- Out of scope: <items>

## Owned Components

- `<path>`

## Shared Components

- `<path>`: <coordination agreed with, and how>

## Acceptance Criteria

1. <Verifiable criterion>

## Test Requirements

- <Vitest or pytest paths to add or run>
- <Security and privacy tests touched>
- Deferred to merge readiness: <checks>

## Dependencies

- <ticket, branch or decision>: <state>

## Approvals and Constraints

- Owner approval required for: <items, or none>
- No live AWS deployment authorized: <yes, unless the owner authorized it, linked to the source ([what counts](../../../AGENTS.md#what-counts-as-owner-authorization))>

## Definition of Done Gate

<Which gate the agent's work closes at: Development Complete, or Integration Complete for an
integration ticket. Owner Accepted and Complete are recorded only by the owner.>
