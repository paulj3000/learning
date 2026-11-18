# Definition of Done

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-020

The completion gates every ticket passes, in order, and how they relate to the existing rules in
[CLAUDE.md](../../CLAUDE.md) section 15 and [TESTING_STRATEGY.md](../TESTING_STRATEGY.md),
"Task completion". Trello mapping is in [trello-workflow.md](trello-workflow.md).

Untagged rules are proposals under ADR-072. Rules tagged **Binding:** already apply today.

## 1. The gates

| Gate | Kind | Who declares it | Trello list |
|---|---|---|---|
| Development Complete | Gate | The implementing agent | 🧪 Development Complete |
| Integration Complete | Gate | The integrating agent or coordinator | 🧪 Development Complete (status line) |
| Owner Accepted | Gate | The owner only | 🔀 Ready to Merge |
| Merged | Recorded fact | The owner, or an agent the owner authorized for that merge | 🔀 Ready to Merge, then ✅ Complete |
| Deployed | Recorded fact | The owner (deployment is owner-run) | Noted on the card, per environment |
| Complete | Gate | The owner | ✅ Complete |

Gates are cumulative: each one requires the earlier ones. Merged and Deployed are facts recorded
with evidence (a merge SHA on `main`; a workflow run and verification for a named environment),
not judgments.

## 2. Development Complete

All of these hold:

- [ ] The authorized scope is implemented, and nothing outside it.
- [ ] Relevant unit tests pass: Vitest and pytest by path for the changed code, `npm run typecheck`
      when TypeScript changed, focused regression tests, and the always-run security and privacy
      checks when touched. **Binding:** TESTING_STRATEGY.md ("During development")
- [ ] Documentation is updated (feature docs, ADR text when a decision changed, and
      `docs/IMPLEMENTATION_STATUS.md`). **Binding:** CLAUDE.md §14
- [ ] The work is committed and pushed to its branch.
- [ ] Known limitations are documented.
- [ ] Dependencies are documented (ticket block `dependencies`, stacked parent if any).
- [ ] Trello is updated: ticket block, dated entry, card moved to Development Complete.
- [ ] A pull request is created where applicable (or its text is prepared for the owner to open,
      see [branch-policy.md](branch-policy.md), section 5).
- [ ] Checks deferred to merge verification are listed.

## 3. Integration Complete

All of Development Complete, plus:

- [ ] Dependencies are integrated (merged into the integration branch or into `main`).
- [ ] Conflicts are resolved without discarding other agents' work
      ([integration-policy.md](integration-policy.md), section 3).
- [ ] The authorized integration checks pass (integration-policy.md, section 6).
- [ ] Shared component compatibility is confirmed for every component in `shared_components`.
- [ ] Migration compatibility is confirmed: one leaf per app, `makemigrations --check` clean.

A ticket with no dependencies and no shared components may record Integration Complete as "not
applicable" with the reason, once it is up to date with `main`.

## 4. Owner Accepted

All of Integration Complete, plus:

- [ ] Required manual QA is performed ([templates/qa-checklist.md](templates/qa-checklist.md)).
- [ ] Acceptance criteria are verified one by one.
- [ ] Required defects are resolved (defects the owner marks as not blocking are recorded).
- [ ] Owner approval is recorded on the Trello card in a dated `Owner approvals` entry.

## 5. Complete

All of Owner Accepted, plus:

- [ ] The authorized merge to `main` is completed (Merged, with the merge SHA).
- [ ] Deployment, only when it is in scope **and** explicitly authorized, is performed and verified
      (Deployed, per environment, with the release notes). **Binding:** CLAUDE.md §18
- [ ] Merge-readiness gates ran before the merge. **Binding:** TESTING_STRATEGY.md ("Merge or
      release readiness")

When deployment is out of scope, Complete means "accepted and merged"; the card states that no
deployment was performed.

**A completed implementation is never represented as a production release.** "Done", "complete"
or "shipped" in reports and cards names the gate reached. Deployment is reported only when an
authorized deployment was performed and verified (release-policy.md).

## 6. Reconciliation with existing rules

| Existing rule | Mapping |
|---|---|
| TESTING_STRATEGY.md, "Task completion": a task may be marked COMPLETE when implemented, development checks pass, typecheck passes, acceptance criteria are met at unit/integration level, docs and tracker updated, with checks **deferred to merge verification** listed | This is **Development Complete**. Existing entries in `docs/IMPLEMENTATION_STATUS.md` marked complete with a "Deferred to merge verification" list, or worded "code complete, unit and API tested" or "development complete", mean Development Complete, not Complete. New entries use the gate names. |
| TESTING_STRATEGY.md exceptions: gates an accepted ADR imposes (Phaser deletion parity tests and visual validation, the Sprouts gate) and APPROVAL or AWS tasks | Unchanged. They are added criteria on the gate where they apply. **Binding:** ADR-020, CLAUDE.md §18 |
| CLAUDE.md §15 "Definition of Done": flows work, authorization tested, loading/empty/error/AI-fallback states, age bands respected, accessibility basics, analytics avoid sensitive content, relevant tests pass, docs and status updated | Feature-level quality criteria. They are part of the acceptance criteria checked at Development Complete (by tests) and Owner Accepted (by QA). CLAUDE.md §15's note that full merge-readiness gates run before a merge maps to the Complete gate. |
| CLAUDE.md §14: completion requires passing acceptance criteria and development checks, with deferred items listed, or a precise explanation of what is blocked | Development Complete, or Blocked with `blockers` filled. |

## 7. Reporting

- Report the gate reached, not "done": for example "Development Complete; Integration not
  started; not merged; not deployed".
- Use [templates/completion-report.md](templates/completion-report.md) at Development Complete and
  [templates/release-notes.md](templates/release-notes.md) for a deployment.
- Never fabricate evidence. A check that was not run is listed as deferred or not run.
