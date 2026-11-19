# Completion Report Template

- **Status:** Guidance (template)
- **Owner:** project owner
- **Last reviewed:** 2026-11-18
- **Canonical sources:** [CLAUDE.md](../../../CLAUDE.md) section 14 (report),
  [definition-of-done.md](../definition-of-done.md), [trello-workflow.md](../trello-workflow.md)

Posted on the Trello card when an agent reaches Development Complete (or the gate the ticket
closes at). It reports facts only: no test result, commit or approval that was not observed.

---

# Completion report: <ticket id> <title>

## Agent ID

`<agent id>` ([multi-agent-workflow.md](../multi-agent-workflow.md#agent-identity))

## Branch and Worktree

- Branch: `<branch>`
- Worktree: `<worktree-dir>`
- Baseline: `<full origin/main SHA the branch started from>`

## Original Scope

<Scope as authorized on the card, with the date of the authorization.>

## Implemented Scope

- <item>: <files or components>

## Deferred Scope

- <item>: <reason, follow-up ticket id>

## Test Evidence

| Command | Result as reported | Date |
|---|---|---|
| `<exact command>` | <passed N, failed N, skipped N> | <yyyy-mm-dd> |

- Deferred to merge verification: <checks>
- Infrastructure failures (not test failures): <none or details>

## Commits

- `<full SHA>` <summary line>

## Pull Requests

- #<n> <title> (<state: open | merged>), or "Not created: <reason>"

## Documentation Updates

- `<path>`: <what changed>

## Trello Updates

- Card moved to: <list>; ticket block fields updated: <fields>

## Integration Requirements

- <dependencies to merge first, shared components to verify, migration ordering, or "None">

## Owner QA Requirements

- <what the owner must check, link to QA checklist, or "Not required: <reason>">

## Deployment Status

`<No live AWS deployment authorized | Deployed to <environment> on <date> at <SHA> with owner approval <reference>>`
