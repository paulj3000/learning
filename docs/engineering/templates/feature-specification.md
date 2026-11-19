# Feature Specification Template

- **Status:** Guidance (template)
- **Owner:** project owner
- **Last reviewed:** 2026-11-18
- **Canonical sources:** [CLAUDE.md](../../../CLAUDE.md), [docs/ARCHITECTURE.md](../../ARCHITECTURE.md),
  [docs/DATA_MODEL.md](../../DATA_MODEL.md), [definition-of-done.md](../definition-of-done.md)

Copy everything below the line into the feature card or a `docs/` file. Replace every
`<placeholder>`. Write "None" rather than deleting a section. Mark each existing component as
Implemented (main), Pending merge (branch), Approved future, Proposed or Retired.

---

# <Feature title>

## Feature Identifier

- Ticket: `<ticket id>`
- Parent card: `<parent ticket id or none>`
- Author: `<owner | PM | agent id>`
- Date: `<yyyy-mm-dd>`
- Status: `<Specification | Ready for Development>`

## Objective

<One paragraph: what the child, parent or administrator can do when this ships.>

## Business or Educational Value

- Learning objectives: `<skills and age bands: Sprouts 3-4 | Pathfinders 5-6 | Explorers 7-8>`
- World consequence: `<what changes on the island>`
- Parent value: `<what the parent sees or controls>`

## Requirements

1. <Requirement, testable>
2. <Requirement, testable>

## Nonrequirements

- <Explicitly out of scope; cite CLAUDE.md section 12 where relevant>

## Architecture

<Components involved, data flow, which canonical Django apps are extended (ADR-033), engine
boundaries (ADR-020). Link existing docs instead of copying them.>

## Dependencies

| Dependency | Type (ticket, branch, ADR, owner decision) | State |
|---|---|---|
| <dependency> | <type> | <Implemented (main) / Pending merge / Proposed> |

## Data Models

<Models added or changed, fields, migrations expected, ownership and authorization scope.>

## API Contracts

| Method | Path | Request | Response | Auth scope |
|---|---|---|---|---|
| <GET> | `/api/v1/<path>` | <shape> | <shape> | <parent | child-scoped | staff> |

## Frontend Changes

<Routes, features, components; loading, empty, error and AI-fallback states; accessibility;
age-band adaptation.>

## Security Implications

<Authorization, tenant isolation, child data minimization, logging, AI safety, secrets.
Reference docs/THREAT_MODEL.md and docs/AI_AND_CHILD_SAFETY.md.>

## Parallel Work Packages

| Package | Ticket | Owned components | Shared components | Can start after |
|---|---|---|---|---|
| <package> | `<ticket id>` | <paths> | <paths> | <dependency or "now"> |

## Serial Work Packages

1. `<ticket id>`: <package that must land first, and why>
2. `<ticket id>`: <next package>

## Testing Strategy

- Unit (Vitest, pytest): <what>
- Security and privacy tests: <which>
- Deferred to merge readiness (Playwright, WebGL, acceptance): <what>

## Acceptance Criteria

1. <Given / when / then, verifiable by the owner>
2. <...>

## Deployment Implications

<Migrations (expand and contract), infrastructure, assets or content to publish, deploy
workflows a merge would trigger. State "No live AWS deployment authorized" unless the owner has
authorized one.>

## Owner Decisions Required

| Decision | Options | Recommended | Needed before |
|---|---|---|---|
| <question> | <options> | <option> | <package or gate> |
