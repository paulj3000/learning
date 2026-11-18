# Definition of Done

- **Status:** Mandatory policy (merged to `main` at the owner's direction on 2026-11-18; formal acceptance of ADR-072 pending). Rules restated from CLAUDE.md and accepted ADRs bind through those sources.
- **Owner:** project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-033, ADR-053, ADR-072 (proposed engineering governance)
- **Canonical sources:** [CLAUDE.md](../../CLAUDE.md) sections 14 and 15,
  [docs/TESTING_STRATEGY.md](../TESTING_STRATEGY.md) ("When to run which checks"),
  [docs/UX_AND_ACCESSIBILITY.md](../UX_AND_ACCESSIBILITY.md),
  [docs/AI_AND_CHILD_SAFETY.md](../AI_AND_CHILD_SAFETY.md)

"Done" has four gates. Each gate is recorded separately on the Trello card
([trello-workflow.md](trello-workflow.md)). Passing an earlier gate never implies a later one.

Implementation is not a production release. A ticket can be Complete without any deployment;
deployment happens only when it is in scope and the owner authorizes it
([release-policy.md](release-policy.md)).

## Development Complete

Reached by the assigned agent on its branch. All of these hold:

1. The authorized scope is implemented, and nothing outside it.
2. The relevant unit tests pass (Vitest and pytest by path, `npm run typecheck` when TypeScript
   changed, focused regression tests, and every security and privacy test the change touches),
   as defined in [docs/TESTING_STRATEGY.md](../TESTING_STRATEGY.md).
3. Documentation is updated: affected docs, [docs/IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md),
   and [tasks/TASK_TRACKER.md](../../tasks/TASK_TRACKER.md) when the ticket is a tracker task.
4. The work is committed and pushed to the ticket's branch.
5. Known limitations are documented.
6. Dependencies (tickets, branches, owner decisions) are documented.
7. Trello is updated: ticket block current, card in 🧪 Development Complete, evidence attached.
8. A pull request is created where applicable ([templates/pull-request.md](templates/pull-request.md)).
9. Checks deferred to merge verification are listed.

### Feature quality criteria

For any feature that changes product behaviour, Development Complete also requires the product
definition of done in [CLAUDE.md](../../CLAUDE.md) section 15, at the unit and integration level:

- child and parent flows work as specified;
- authorization is explicit and tested (child-scoped endpoints follow the LAI-0403 checklist in
  [docs/TESTING_STRATEGY.md](../TESTING_STRATEGY.md));
- loading, empty, error and AI-fallback states exist;
- age bands are respected (Sprouts, Pathfinders, Explorers);
- accessibility basics are satisfied ([docs/UX_AND_ACCESSIBILITY.md](../UX_AND_ACCESSIBILITY.md));
- analytics and logs avoid sensitive content (no child free text, audio, names or identifiers);
- no play-time limits, countdowns or stop nudges are introduced (ADR-053);
- engine code emits typed events and never validates answers, awards progress or calls AI
  (ADR-020);
- the feature extends the canonical Django apps instead of adding a parallel model (ADR-033).

Browser, WebGL and Playwright verification of these criteria normally happens at merge
readiness, and is listed as deferred until then.

## Integration Complete

Reached on an integration branch or on the feature branch brought up to date with its base
([integration-policy.md](integration-policy.md)). All of these hold:

1. Every dependency is integrated (merged into `main` or into the same integration branch).
2. Conflicts are resolved without discarding anyone's work.
3. The integration checks the owner authorized pass (normally the merge-readiness gates in
   [docs/TESTING_STRATEGY.md](../TESTING_STRATEGY.md)).
4. Compatibility with shared components (engine, movement, camera, assets, NPC, sound, scoring,
   API contracts, auth) is confirmed by tests or recorded checks.
5. Migration compatibility is confirmed: one leaf migration per app, `make migrate-check` passes.
6. `npm run adr:check` passes.

## Owner Accepted

Recorded only by the owner. All of these hold:

1. Manual QA has been performed ([templates/qa-checklist.md](templates/qa-checklist.md)).
2. Each acceptance criterion is verified.
3. Defects the owner marked as required are resolved; others are recorded as follow-up cards.
4. The owner's approval is recorded on the card with date.

## Complete

Recorded only by the owner. All of these hold:

1. Development Complete, Integration Complete and Owner Accepted are met.
2. The change is merged to `main` through an authorized pull request.
3. Deployment is done only if it was in the ticket's scope and the owner authorized it, with
   post-deployment verification recorded. Otherwise the card says
   "No live AWS deployment authorized".

An implementation-only ticket may close at an earlier gate than its parent feature, as recorded
on the parent card ([trello-workflow.md](trello-workflow.md), "Separate completion gates").

## Recording the gates on the card

Each event is recorded separately on the Trello card, with this evidence:

| Gate | Meaning | Evidence |
|---|---|---|
| Development completion | Authorized scope built and unit-checked on a branch | Commit SHA, test results, completion report |
| Integration completion | Works together with its dependencies | Integration branch (or up-to-date feature branch), check results |
| Owner acceptance | Owner verified it in QA | Owner's dated note |
| Merge completion | On `main` | Merge commit, PR link |
| Deployment completion | Released to a named environment ([release-policy.md](release-policy.md)) | Workflow run, deployed SHA, health result |

Use these lines on the card, filled only as each event happens:

```text
Development complete: <date>, <commit SHA>
Unit tests passed: <date>, <command summary>
Integration complete: <date>, <branch>, <check results>
Owner QA required: <yes | no>
Accepted: <date, owner>
Merged: <date>, <merge commit SHA>, PR #<n>
Deployed: <environment>, <date>, <deployed SHA>  (or "No live AWS deployment authorized")
```

## What does not count as done

- Files generated but not tested.
- Tests that were not run, or results that were not observed.
- A green CI run on a branch (CI runs only on pull requests and on `main`).
- Code that exists for an AWS resource that has not been deployed and verified.
