# Agent Handoff Template

- **Status:** Guidance (template)
- **Owner:** project owner
- **Last reviewed:** 2026-11-18
- **Canonical sources:** [multi-agent-workflow.md](../multi-agent-workflow.md) ("Handoff",
  "Work-package ownership block"), [trello-workflow.md](../trello-workflow.md),
  [integration-policy.md](../integration-policy.md)

Used when an agent stops work on a ticket, whether finished or not, so another agent or the
owner can continue. Post it on the Trello card. Record only what was observed. Write every SHA
in full (40 characters). The departing agent does not name its successor; the owner does
([multi-agent-workflow.md](../multi-agent-workflow.md#handoff)).

---

# Handoff: <ticket id>

## Agent ID

`<Claude-0N>`

## Ticket ID

`<ticket id>`

## Branch

`<branch name>`

## Worktree

`<worktree directory>`

## Commit SHA

`<full SHA of the last pushed commit>` (baseline `<full baseline SHA>`)

## Work-Package Ownership Block

```yaml
ticket_id: <ticket-id>
agent_id: Claude-0N
branch: <branch>
worktree: <worktree-dir>
baseline_sha: <full origin/main SHA at branch creation>
scope: <one-line scope>
owned_components:
  - <paths or components only this ticket changes>
shared_components:
  - <hotspot files this ticket changes, with the intended change>
dependencies:
  - <tickets, PRs, ADRs or gates this ticket waits on>
acceptance_criteria:
  - <criterion from the card>
status: <claimed | in_development | blocked | development_complete | rework | handed_off>
last_pushed_commit: <full SHA or none>
blockers:
  - <blocker and the decision needed, or none>
```

`status` maps to the Trello logical states in
[trello-workflow.md](../trello-workflow.md#logical-states-and-their-lists):

| Ownership block `status` | Trello logical state (list) |
|---|---|
| `claimed`, `in_development` | In Development (💻 In Development) |
| `blocked` | Blocked (🚧 Blocked) |
| `development_complete` | Development Complete (🧪 Development Complete) |
| `rework` | Rework (🔧 Rework Required) |
| `handed_off` | Ready for Development (📋 Ready for Development) until the owner names the new assignee, then In Development |

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
