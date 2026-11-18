# Trello Workflow

- **Status:** Mandatory policy (merged to `main` at the owner's direction on 2026-11-18; formal acceptance of ADR-072 pending). Rules restated from CLAUDE.md and accepted ADRs bind through those sources.
- **Owner:** project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-072 (proposed engineering governance)
- **Canonical sources:** Trello board "Learning Adventure Island — Master Development"
  (<https://trello.com/b/ePDDF4Lk/learning-adventure-island-master-development>),
  [tasks/TASK_TRACKER.md](../../tasks/TASK_TRACKER.md),
  [docs/IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md)

Trello holds ownership, priority and workflow state. GitHub holds code evidence (branches,
commits, pull requests, CI runs). When they disagree about code, GitHub wins; when they
disagree about who owns a ticket or what is next, Trello wins.

## Board lists

The board has exactly these lists, in this order. This policy does not create, rename or
reorder lists; the owner may add lists later, and this document will then be updated.

1. 📥 Backlog
2. 📋 Ready for Development
3. 💻 In Development
4. 🧪 Development Complete
5. 👀 Owner QA
6. 🔧 Rework Required
7. 🔀 Ready to Merge
8. ✅ Complete
9. 🚧 Blocked

## Logical states and their lists

The workflow has more states than the board has lists. States without their own list are shown
with a label and a `Status:` line at the top of the card description.

| Logical state | Trello list | Marker |
|---|---|---|
| Backlog | 📥 Backlog | none |
| Specification | 📥 Backlog | label `spec`, `Status: Specification` |
| Ready for Development | 📋 Ready for Development | none |
| In Development | 💻 In Development | none |
| Blocked | 🚧 Blocked | `blockers` in the ticket block |
| Development Complete | 🧪 Development Complete | `Status: Development Complete` |
| Integration | 🧪 Development Complete | label `integration`, `Status: Integration` |
| Ready for QA | 🧪 Development Complete | label `ready-for-qa`, `Status: Ready for QA` |
| Owner QA | 👀 Owner QA | none |
| Rework (QA found defects) | 🔧 Rework Required | linked defect cards |
| Accepted | 🔀 Ready to Merge | label `accepted`, `Status: Accepted` (recorded by the owner) |
| Complete | ✅ Complete | none (moved by the owner) |

Proposed labels (the owner creates them; agents do not): `spec`, `integration`,
`ready-for-qa`, `accepted`, `deploy-pending`, `deployed`. Until a label exists, the `Status:`
line alone carries the state.

## Ticket block

Every card that an agent works on carries this block in its description, kept current by the
assigned agent. Fields that do not apply keep their empty value; do not delete them.

```yaml
ticket_id: <ticket id>
title: <card title>
project: Learning Adventure Island
type: <feature | adventure | defect | infra | docs | qa | integration | spike>
priority: <P0 | P1 | P2 | P3>
status: <logical state from the table above>
assigned_agent: <agent id | owner>
branch: <branch name>
worktree: <worktree directory>
baseline_sha: <full SHA the branch started from>
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

The block holds facts only. `implementation_commit` and `pull_request` are filled only once they
exist on GitHub.

## Ticket ids

Existing prefixes, in use on the board and in the repository:

| Prefix | Use |
|---|---|
| `LAI-NNNN` | Roadmap tasks ([docs/DJANGO_MIGRATION_ROADMAP.md](../DJANGO_MIGRATION_ROADMAP.md), [tasks/TASK_TRACKER.md](../../tasks/TASK_TRACKER.md)) |
| `LAI-<AREA>-NNN` | Area series, for example `LAI-NPC-039`, `LAI-LAMBDA-008b`, `LAI-JMP-01` |
| `SC-R` | Storykeeper Castle reboot (`SC-R04-05`) |
| `SC-JMP` | Storykeeper Castle jumping (`SC-JMP-07`) |
| `SEA` | Existing board series (`SEA-04`); check the board card for its area |
| `AP` | Adventure Portal (`AP-11`) |
| `NP` | North Pole adventure (`NP-001`) |

Rules:

- Search the board and the repository (`grep -r "<prefix>-"`) before creating a ticket.
- Reuse the existing prefix for the area and take its next free number. Do not invent a new
  prefix for an area that already has one, and never create a duplicate id.
- A new prefix needs the owner's agreement.
- Branch names, commit trailers and pull requests use the id exactly as on the card.

## Transitions and required evidence

| From | To | Who | Required evidence |
|---|---|---|---|
| Backlog | Specification | owner, PM | Card states the problem; feature spec started ([templates/feature-specification.md](templates/feature-specification.md)) |
| Specification | Ready for Development | owner | Task spec with acceptance criteria and test requirements ([templates/task-specification.md](templates/task-specification.md)); dependencies and owner decisions listed |
| Ready for Development | In Development | assigned agent | Ticket block filled: `assigned_agent`, `branch`, `worktree`, `baseline_sha`; ADR numbers reserved if needed ([procedure](multi-agent-workflow.md#adr-number-reservation)) |
| any | Blocked | assigned agent | `blockers` filled with what is blocked, by whom or what, and what unblocks it |
| Blocked | previous state | assigned agent or owner | Blocker resolution recorded |
| In Development | Development Complete | assigned agent | All Development Complete criteria in [definition-of-done.md](definition-of-done.md); commit SHA pushed; PR link where applicable; completion report ([templates/completion-report.md](templates/completion-report.md)). A handoff ([templates/agent-handoff.md](templates/agent-handoff.md)) is used only if work stops before completion |
| Development Complete | Integration | owner or integrating agent | Integration branch name; list of branches combined |
| Integration | Ready for QA | integrating agent | Integration Complete criteria met; check results attached |
| Development Complete or Ready for QA | Owner QA | owner | QA checklist prepared ([templates/qa-checklist.md](templates/qa-checklist.md)) |
| Owner QA | Rework Required | owner | Defect cards linked ([templates/defect-report.md](templates/defect-report.md)) |
| Rework Required | Development Complete | assigned agent | Fix commits and test results per defect |
| Owner QA | Ready to Merge (Accepted) | owner only | Owner acceptance recorded on the card with date |
| Ready to Merge | Complete | owner only | Integration Complete recorded (integration branch or up-to-date feature branch with check results); merge commit on `main` (PR link); deployment evidence only if deployment was in scope and authorized |

Agents never move a card to ✅ Complete, never move a card to 🔀 Ready to Merge on their own
judgment, and never write owner acceptance or owner approval on a card. They may quote an
approval the owner gave, with its date and where it was given.

## Separate completion gates

Development completion, integration completion, owner acceptance, merge completion and
deployment completion are different events, recorded separately on the card. Their criteria,
evidence and the card lines to use are defined once in
[definition-of-done.md](definition-of-done.md#recording-the-gates-on-the-card).

An implementation-only ticket (for example one work package of a feature) may close at
Development Complete or Merged while its parent feature card stays open until owner acceptance
or deployment. The parent card lists its children and which gate each must reach.

## GitHub and Trello responsibilities

- Commits, branches, pull requests and CI results are referenced from Trello by link or SHA,
  not copied.
- Status in [docs/IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md) and
  [tasks/TASK_TRACKER.md](../../tasks/TASK_TRACKER.md) must not claim more than the Trello card
  and GitHub show.
- If the session harness mandates a branch name, record the mapping on the card
  ([branch-policy.md](branch-policy.md)).
