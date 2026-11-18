# Agent Handoff Template

- **Status:** Guidance (template)
- **Owner:** project owner
- **Last reviewed:** 2026-11-18
- **Canonical sources:** [trello-workflow.md](../trello-workflow.md),
  [integration-policy.md](../integration-policy.md)

Used when an agent stops work on a ticket, whether finished or not, so another agent or the
owner can continue. Post it on the Trello card. Record only what was observed.

---

# Handoff: <ticket id>

## Agent ID

`<agent id>`

## Ticket ID

`<ticket id>`

## Branch

`<branch name>`

## Worktree

`<worktree directory>`

## Commit SHA

`<full SHA of the last pushed commit>` (baseline `<baseline SHA>`)

## Completed Work

- <item>

## Remaining Work

- <item>

## Tests Executed

- `<exact command>`

## Test Results

- `<command>`: <passed N, failed N, skipped N, as reported>
- Infrastructure failures (reported separately): <none or details>

## Changed Components

- `<path>`

## Shared Component Changes

- `<path>`: <what changed and who was told, or "None">

## Known Defects

- <defect, or "None known">

## Blockers

- <blocker, who or what unblocks it, or "None">

## Next Recommended Action

<One concrete next step and who should take it.>
