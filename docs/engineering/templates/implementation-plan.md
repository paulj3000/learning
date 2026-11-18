# Implementation Plan Template

- **Status:** Guidance (template)
- **Owner:** project owner
- **Last reviewed:** 2026-11-18
- **Canonical sources:** [CLAUDE.md](../../../CLAUDE.md) section 14,
  [integration-policy.md](../integration-policy.md), [docs/TESTING_STRATEGY.md](../../TESTING_STRATEGY.md)

Written by the assigned agent before coding, from the task specification. Copy below the line.

---

# Implementation plan: <ticket id> <title>

## Ticket

- Ticket: `<ticket id>`
- Agent: `<Claude-0N>`
- Branch: `<branch>`
- Worktree: `<worktree>`
- Baseline SHA: `<full SHA>`

## Acceptance Criteria Being Implemented

1. <criterion copied from the task>

## Current State

<What exists on main today (verified by reading the code), with paths.>

## Approach

<Smallest coherent change. Which canonical apps, modules and engine boundaries are used.>

## Steps

1. <step>
2. <step>

## Files

| Path | Create or change | Purpose |
|---|---|---|
| `<path>` | <create | change> | <purpose> |

## Shared Components and Coordination

<Shared areas touched, other tickets touching them, agreements made. "None" if none.>

## Migrations

<App, expected migration number, expand and contract plan, or "None".>

## ADR Impact

<None, or the reserved number `ADR-NNN` and why a decision is needed.>

## Test Plan

- Development checks: <commands with paths>
- Security and privacy tests: <which>
- Deferred to merge readiness: <which>

## Risks

- <risk and mitigation>

## Owner Approvals Needed

- <item, or none>
