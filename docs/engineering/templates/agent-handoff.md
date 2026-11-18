# Agent Handoff: <ticket ID>

> **Status:** Template
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001

Used when work moves between agents, sessions or the owner. Everything stated must be verifiable
from the branch. Paste it as a dated entry on the Trello card as well. See
[../multi-agent-workflow.md](../multi-agent-workflow.md).

## Agent ID

`<Claude-NN>` handing off to `<Claude-NN | owner | TBD>`, on `<YYYY-MM-DD>`

## Ticket ID

`LAI-<AREA>-<NNN>`

## Branch

`<branch>` (baseline `<sha>`)

## Worktree

`/Coding/learning-worktrees/<short-name>`

## Commit SHA

`<last pushed commit sha>` (pushed: `<yes / no>`)

## Completed work

- `<item>`

## Remaining work

- `<item>`

## Tests executed

| Command | Scope |
|---|---|
| `<command>` | `<paths>` |

## Test results

`<pass / fail counts per command, copied from the actual run; infrastructure failures listed
separately. "Not run" if not run.>`

## Changed components

- `<path or component>`

## Shared component changes

`<Shared components changed, using the names in ../integration-policy.md section 5. "None" if none.>`

## Known defects

- `<defect, or None>`

## Blockers

- `<blocker and who can clear it, or None>`

## Next recommended action

`<the single next step for whoever picks this up>`
