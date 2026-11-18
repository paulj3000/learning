# Trello Workflow

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001

How tickets move on the Trello board, what a card must contain, and what evidence each move needs.
Completion gates are defined in [definition-of-done.md](definition-of-done.md); agent roles in
[multi-agent-workflow.md](multi-agent-workflow.md).

Untagged rules are proposals under ADR-072.

## 1. Authorities

| Source | Authoritative for |
|---|---|
| Trello | Ownership, priority, task state, owner approvals and decisions |
| GitHub (`paulj3000/learning`) | Code evidence: branches, commits, pull requests, CI results |
| `docs/IMPLEMENTATION_STATUS.md` | The repository's own implementation record (CLAUDE.md §14) |

When Trello and GitHub disagree about code (for example a card says "merged" but the commit is not
on `main`), GitHub wins and the card is corrected with a dated entry.

## 2. The board

Board: `Learning Adventure Island — Master Development`
(<https://trello.com/b/ePDDF4Lk/learning-adventure-island-master-development>).

Existing lists, in order. Do not rename, reorder or delete them; any change is an owner decision.

| # | List | Meaning |
|---|---|---|
| 1 | 📥 Backlog | Captured, not yet ready to start |
| 2 | 📋 Ready for Development | Specified, dependencies known, can be assigned |
| 3 | 💻 In Development | An agent or person is implementing it |
| 4 | 🧪 Development Complete | Development Complete gate met; waiting for integration or QA |
| 5 | 👀 Owner QA | The owner is testing it |
| 6 | 🔧 Rework Required | Owner QA or review found defects to fix |
| 7 | 🔀 Ready to Merge | Owner accepted; waiting for the authorized merge |
| 8 | ✅ Complete | All gates met, including the authorized merge (and deployment when in scope) |
| 9 | 🚧 Blocked | Cannot proceed: a dependency, decision or approval is missing |

Labels: the board has six colour labels with no names, and they are unused. Do not rely on them.
Naming them (for example by area or type) is an optional owner decision.

## 3. Logical states and list mapping

The workflow uses more logical states than there are lists. Each logical state maps onto an
existing list; the card's ticket block `status` field and a status line record the precise state.

| Logical state | Trello list | How to show it |
|---|---|---|
| Backlog | 📥 Backlog | `status: backlog` |
| Specification | 📥 Backlog | `status: specification`, plus a status line `CURRENT — specification in progress` |
| Ready for Development | 📋 Ready for Development | `status: ready-for-development` |
| In Development | 💻 In Development | `status: in-development` |
| Blocked | 🚧 Blocked | `status: blocked`, with `blockers` filled |
| Development Complete | 🧪 Development Complete | `status: development-complete` |
| Integration | 🧪 Development Complete | `status: integration`, status line names the integration branch |
| Ready for QA | 🧪 Development Complete | `status: ready-for-qa`, status line names the build or branch to test |
| Owner QA | 👀 Owner QA | `status: owner-qa` |
| (defects after QA) | 🔧 Rework Required | `status: rework-required`, linking the defect reports |
| Accepted | 🔀 Ready to Merge | `status: accepted` |
| Complete | ✅ Complete | `status: complete` |

Optional owner decisions (not to be made automatically): adding "Specification", "Integration",
"Ready for QA" or "Accepted" lists; naming the colour labels.

## 4. Card titles

Observed title conventions on the board:

| Pattern | Example shape |
|---|---|
| `[LAI-AREA-NNN] Title` | `[LAI-LAMBDA-014] Title` |
| `LAI-AREA-NN \| Title` | `LAI-JMP-02 \| Title` |
| `CODE-NN — Title` | `SEA-04 — Title` |
| `[Subproject] Name` | Parent cards for a subproject |
| `CODE-NN Title` | `AP-05 Title` |

New cards use `[LAI-<AREA>-<NNN>] Title`, with `<AREA>` a short uppercase area code and `<NNN>`
three digits. Existing cards keep their titles. Implementation tickets split from a parent may
add a letter suffix (`LAI-JMP-01a`), as the movement line already does.

## 5. Machine-readable ticket block

Every new card description starts with this fenced YAML block, before any prose. Agents read and
update it; humans may edit it. Keep keys in this order. Use `TBD` or `[]` for unknown values,
never guesses.

```yaml
ticket_id: LAI-<AREA>-<NNN>
title: <short title>
project: Learning Adventure Island
type: feature | adventure | defect | infrastructure | integration | docs | spike
priority: P0 | P1 | P2 | P3
status: backlog | specification | ready-for-development | in-development | blocked | development-complete | integration | ready-for-qa | owner-qa | rework-required | accepted | complete
assigned_agent: Claude-01 | Claude-02 | Claude-03 | Claude-04 | Claude-05 | owner | TBD
branch: <prefix>/<name> | TBD
worktree: /Coding/learning-worktrees/<short-name> | TBD
baseline_sha: <sha> | TBD
dependencies: []
owned_components: []
shared_components: []
acceptance_criteria: []
test_requirements: []
owner_approval_required: true | false
pull_request: <PR number or URL> | TBD
implementation_commit: <sha> | TBD
blockers: []
```

Field notes:

- `shared_components` uses the names from [integration-policy.md](integration-policy.md),
  section 5 (for example "database models and migrations", "jumping and collision").
- `dependencies` lists ticket IDs or PR numbers that must merge first.
- `baseline_sha` is the commit the branch started from (a parent branch SHA for stacked work).
- `implementation_commit` is the last commit of the implementation on the branch, not a merge SHA.
- The same block appears in [templates/task-specification.md](templates/task-specification.md).

Existing cards are not rewritten to add the block; add it when a card is next picked up.

## 6. Card history

Observed practice, now the rule:

1. Card descriptions keep dated sections: `Owner approvals — YYYY-MM-DD` for decisions and
   approvals, and `CURRENT — <state>` for the present state.
2. Never delete history. Add a new dated entry; move an outdated "CURRENT" section under a dated
   heading instead of erasing it.
3. Record evidence as links and SHAs (PR, commit, CI run, QA report path), not as pasted logs.
4. Comments are for conversation; decisions go into the description's dated sections too.
5. **Never put secrets in Trello**: no passwords, tokens, keys, `.env` contents, private URLs with credentials,
   or child personal data. Test account credentials are shared with the owner directly,
   never on a card.

## 7. Transitions and required evidence

| From | To | Evidence required |
|---|---|---|
| Backlog | Ready for Development | Ticket block filled (scope, acceptance criteria, dependencies, shared components); specification linked where needed |
| Ready for Development | In Development | `assigned_agent`, `branch`, `worktree`, `baseline_sha` set |
| any | Blocked | `blockers` filled with what is needed and from whom |
| In Development | Development Complete | Development Complete gate met: commits pushed, `implementation_commit` set, tests run and results listed, deferred checks listed, docs updated, PR opened or PR text prepared |
| Development Complete | Integration (status line) | Integration branch named, coordinator agreed |
| Integration | Ready for QA | Integration Complete gate met: integration checks and conflicts recorded |
| Ready for QA | Owner QA | Build, branch or environment to test named; QA checklist ([templates/qa-checklist.md](templates/qa-checklist.md)) attached |
| Owner QA | Rework Required | Defect reports ([templates/defect-report.md](templates/defect-report.md)) linked |
| Rework Required | Development Complete | Fix commits, tests for each defect |
| Owner QA | Ready to Merge (Accepted) | Owner acceptance recorded in a dated `Owner approvals` entry |
| Ready to Merge | Complete | Merge SHA on `main`; deployment evidence only when deployment is in scope and authorized |

**Complete is never set merely because code was written.** An agent may move a card up to
Development Complete. Only the owner, or an agent acting on a recorded owner instruction, moves a
card to Ready to Merge or Complete.

## 8. Kinds of completion

Keep these distinct on cards and in reports:

| Completion | Meaning |
|---|---|
| Development completion | The implementation and its development checks are done on a branch |
| Integration completion | The branch works together with its dependencies and other in-flight branches |
| Owner acceptance | The owner tested it and accepted it |
| Merge completion | The authorized merge to `main` happened |
| Deployment completion | An authorized deployment to a named environment happened and was verified |

An implementation-only ticket (for example one of several tickets under a parent feature) can be
Complete while its parent feature card is still In Development or Owner QA. The parent is Complete
only when all its required child tickets are Complete and the feature-level acceptance criteria
are verified.

## 9. Agent rules

1. Read the card and its ticket block before starting; do not start a card assigned to another agent.
2. Update the ticket block and add a dated entry at each transition.
3. Use the completion report template ([templates/completion-report.md](templates/completion-report.md))
   for the Development Complete entry, and the handoff template
   ([templates/agent-handoff.md](templates/agent-handoff.md)) when work changes hands.
4. Do not create, rename or archive lists or labels.
