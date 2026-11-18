# Development Workflow

- **Status:** Mandatory policy (ADR-072, accepted by the owner 2026-11-18). These standards are the final authority after the owner.
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-072 (Accepted), ADR-019 (gates G1 to G10), ADR-020, ADR-033
- **Canonical sources:** [`CLAUDE.md`](../../CLAUDE.md) sections 14, 15 and 18; [`docs/TESTING_STRATEGY.md`](../TESTING_STRATEGY.md) "When to run which checks"; [`docs/DJANGO_MIGRATION_ROADMAP.md`](../DJANGO_MIGRATION_ROADMAP.md) section 1

Every change, from a one-line fix to a new adventure, follows the same 22-step lifecycle. Small
changes move through the steps quickly; they do not skip them. Multi-agent coordination (claiming,
locking, handoff) is in [`multi-agent-workflow.md`](multi-agent-workflow.md); Trello list rules are in
[`trello-workflow.md`](trello-workflow.md), which is authoritative for list transitions.

## Roles

| Role | Who | Decides |
|---|---|---|
| Owner | The project owner | Architecture, product scope, priorities and assignment, acceptance, merge, deployment, any AWS change |
| Product and architecture specification | ChatGPT, working for the owner | Nothing on its own; drafts specifications, tickets, acceptance criteria and priorities for owner approval, and directs assignment only as the owner delegates |
| Development agent | One of Claude-01 to Claude-05, or another tool's agent with an owner-assigned id `<Tool>-NN` (for example `Codex-01`) | How to implement an approved ticket inside its approved scope |
| Coordinator | The owner, or an agent the owner names for a specific integration | Integration order and conflict resolution, within owner direction |

## Lifecycle

"Agent" means the step can be done by a development agent without asking. "Owner" means the step
needs the owner's explicit decision; an agent may prepare it but never performs it on assumption.

| # | Step | Actor | Inputs | Outputs and evidence | Agent or owner |
|---|---|---|---|---|---|
| 1 | Requirement identified | Owner (agents may propose) | Product vision, defects, QA feedback, roadmap | Trello card in Backlog, or a comment on an existing card | Agent may propose; owner accepts |
| 2 | Structured specification | ChatGPT for the owner | Requirement, [`CLAUDE.md`](../../CLAUDE.md), relevant ADRs and standards | Specification from [`templates/feature-specification.md`](templates/feature-specification.md) (and for gameplay the [`docs/adventures/templates/`](../adventures/README.md) specifications), attached or linked on the card | Owner approves the specification |
| 3 | Trello ticket created or updated | Owner or ChatGPT; agent may update fields it is asked to | Specification | Card with ticket id, description, labels, links; [`templates/task-specification.md`](templates/task-specification.md) for each ticket split from a feature | Agent may create or edit only when asked |
| 4 | Dependencies and acceptance criteria defined | Owner with ChatGPT | Specification, roadmap, ADR registry | Card lists dependencies (tickets, ADRs, gates) and testable acceptance criteria | Owner |
| 5 | Approved and moved to Ready for Development | Owner | Complete card | Card in Ready for Development | Owner only |
| 6 | Agent assigned | Owner (or ChatGPT as the owner delegates), or an agent self-claiming an unclaimed card in Ready for Development under [`multi-agent-workflow.md`](multi-agent-workflow.md) | Ready for Development list, owner-approved priorities | Claim comment, card in In Development | Owner assigns; agent may self-claim only an unclaimed Ready for Development card |
| 7 | Dedicated worktree and branch | Agent | Claim, [`branch-policy.md`](branch-policy.md) | Worktree and branch from current `origin/main` (or the named base); baseline SHA recorded in the ownership block | Agent |
| 8 | Initial technical audit | Agent | Ticket, code at baseline, docs | Audit findings: what exists, what is missing, conflicts, risks | Agent |
| 9 | Implementation plan | Agent | Audit | Plan from [`templates/implementation-plan.md`](templates/implementation-plan.md) posted on the card; any stop-and-ask trigger raised here | Agent; owner if a trigger applies |
| 10 | Development | Agent | Approved plan | Code within the ticket's owned components | Agent |
| 11 | Unit tests implemented and executed | Agent | Code | New or updated tests; development checks from [`docs/TESTING_STRATEGY.md`](../TESTING_STRATEGY.md) run by path, with real results | Agent |
| 12 | Documentation updated | Agent | Change | Docs per [`documentation-policy.md`](documentation-policy.md), including [`docs/IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md) | Agent |
| 13 | Commit and push | Agent | Passing development checks | Commits with the `Agent: <agent id>` trailer, pushed to the ticket branch | Agent |
| 14 | Pull request created | Agent | Pushed branch | PR from [`templates/pull-request.md`](templates/pull-request.md) | Agent, unless the card says the owner opens PRs |
| 15 | Trello updated with evidence | Agent | Pushed commit, PR | Completion report from [`templates/completion-report.md`](templates/completion-report.md): commit SHA, PR link, tests and results, deferred checks, risks; card to Development Complete | Agent |
| 16 | Integration requirements identified | Agent, coordinator | PR, other open branches | Dependencies on other PRs, shared-file conflicts, migration order, ADR numbers ([`integration-policy.md`](integration-policy.md)) | Agent |
| 17 | Authorized merge-readiness checks | Agent when the owner requests them | Owner request | The merge-readiness gates in [`testing-policy.md`](testing-policy.md) and the ticket's deferred checks, with real results | Owner authorizes; agent runs |
| 18 | Owner QA | Owner | PR, [`templates/qa-checklist.md`](templates/qa-checklist.md) | QA result on the card; card in Owner QA | Owner only |
| 19 | Defects corrected | Agent | [`templates/defect-report.md`](templates/defect-report.md) entries; card in Rework Required | Fix commits, tests, updated evidence; back to step 15 | Agent |
| 20 | Owner approves acceptance | Owner | Passed QA | Recorded acceptance; card in Ready to Merge | Owner only |
| 21 | Merge through the authorized process | Owner, or an agent the owner explicitly instructs to perform the merge only | Accepted PR, passing CI | Merged commit on `main`; the owner moves the card to Complete | Owner authorizes every merge |
| 22 | Deployment | Owner, or an agent with explicit per-deployment authorization | Merged code, [`release-policy.md`](release-policy.md) | Release notes from [`templates/release-notes.md`](templates/release-notes.md); deployment record | Owner only; never implied by merge |

Rules that apply across steps:

- Development complete (step 15) is not accepted (step 20), merged (step 21) or deployed (step 22).
  Use those words exactly; see [`definition-of-done.md`](definition-of-done.md).
- Never fabricate evidence. Report each check as passed, failed, not run (with reason), or blocked
  by infrastructure, as [`docs/TESTING_STRATEGY.md`](../TESTING_STRATEGY.md) requires.
- Never trigger a deploy workflow (`deploy-*.yml`, `manage-dev-infrastructure.yml`) or change an
  AWS resource without explicit owner authorization for that action. A merge approval is not a
  deployment approval ([`release-policy.md`](release-policy.md)).
- A blocked ticket moves to Blocked with a comment naming the blocker and the decision needed.

## Stop and ask

Stop, post the question on the Trello card, and wait for an owner answer when any of these applies.
Continue with independent work in the meantime only if it does not depend on the answer.

| Trigger | Source |
|---|---|
| The task is marked APPROVAL in [`docs/DJANGO_MIGRATION_ROADMAP.md`](../DJANGO_MIGRATION_ROADMAP.md) | Roadmap section 1, CLAUDE.md section 18 |
| Anything that creates, changes, deletes or deploys an AWS resource, or migrates production data (the Cognito pool and the retained legacy DynamoDB tables and S3 buckets from the retired backend included) | CLAUDE.md section 18, ADR-019 gate G7 |
| The work touches an open ADR-019 gate (G1 to G3, G5 to G10) | [`docs/DECISIONS.md`](../DECISIONS.md) ADR-019 |
| The change goes beyond the ticket's approved scope or acceptance criteria, or into CLAUDE.md section 12 out-of-scope items | CLAUDE.md sections 11 and 12 |
| A change to a coordination hotspot or a shared component another ticket owns or depends on: record the planned change on the ticket before editing, and get the owner's or coordinator's acknowledgement before merging ([`integration-policy.md`](integration-policy.md#coordination-required), the single hotspot list) | [`integration-policy.md`](integration-policy.md) |
| A new runtime or development dependency | CLAUDE.md section 13 |
| A new framework, engine, renderer, styling system or service, or reintroducing a retired one (the retired backend, Phaser as an alternative engine) | ADR-019, ADR-020 |
| An architectural decision not covered by an accepted ADR (draft it from [`templates/adr.md`](templates/adr.md), number it only through the [reservation procedure](multi-agent-workflow.md#adr-number-reservation)) | [`docs/DECISIONS.md`](../DECISIONS.md) governance |
| Two sources of policy conflict | [`README.md`](README.md) precedence |
| Child data, privacy, authentication or authorization behavior changes beyond what the ticket states | [`security-policy.md`](security-policy.md) |

## Related policies

[`multi-agent-workflow.md`](multi-agent-workflow.md), [`trello-workflow.md`](trello-workflow.md),
[`branch-policy.md`](branch-policy.md), [`testing-policy.md`](testing-policy.md),
[`definition-of-done.md`](definition-of-done.md), [`integration-policy.md`](integration-policy.md),
[`release-policy.md`](release-policy.md), [`documentation-policy.md`](documentation-policy.md),
[`security-policy.md`](security-policy.md).
