# Documentation Policy

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001

How engineering documentation is located, written, reviewed, updated and retired. The goal is one
authoritative place per topic, so that five agents working in parallel read the same rules.

## 1. Kinds of document

| Kind | Purpose | Binds agents? |
|---|---|---|
| **Mandatory** policy | Rules every change must follow. | Yes |
| **Proposed** standard | A rule set awaiting owner acceptance (today: everything under ADR-072). Rules inside it tagged `**Binding:** <source>` already bind through that source. | Tagged rules yes; the rest once accepted |
| **Guidance** | Advice, audits, explanations, examples. | No |
| **Template** | A copy-ready skeleton. | Its required sections are mandatory when used |
| **Deprecated** | Kept for history; do not follow. Names its replacement if one exists. | No |
| **Superseded** | Replaced by a named document. | No |

Every document under `docs/engineering/`, `docs/adventures/` and `docs/adr/` starts with this
metadata block, checked by `npm run docs:check`:

```markdown
# Title

> **Status:** Mandatory | Proposed | Guidance | Template | Deprecated | Superseded
> **Owner:** Project owner
> **Last reviewed:** YYYY-MM-DD
> **Related:** ADR-NNN, LAI-AREA-NNN
```

Older documents elsewhere in `docs/` have no metadata block. Add one when you substantially edit
such a document; do not mass-edit them.

A policy becomes Mandatory only when the owner accepts the ADR or ticket that proposes it. An
agent never promotes a document's status on its own.

## 2. Canonical locations

One topic, one canonical document. Other documents summarize in a few lines and link to it.

| Topic | Canonical document |
|---|---|
| Agent entry point (Claude) | [`CLAUDE.md`](../../CLAUDE.md) |
| Agent contract (any tool) | [`AGENTS.md`](../../AGENTS.md) |
| Product, child-safety and AI rules | [product-baseline.md](product-baseline.md) and `CLAUDE.md` sections 1 to 13 |
| Engineering standards | `docs/engineering/` ([index](README.md)) |
| Adventure standards | `docs/adventures/` ([index](../adventures/README.md)) |
| When each check runs | [`docs/TESTING_STRATEGY.md`](../TESTING_STRATEGY.md), "When to run which checks" (**Binding:** `CLAUDE.md` section 14) |
| Architecture decisions | [`docs/DECISIONS.md`](../DECISIONS.md) only ([mapping](../adr/README.md)) |
| Django migration tasks and APPROVAL stops | [`docs/DJANGO_MIGRATION_ROADMAP.md`](../DJANGO_MIGRATION_ROADMAP.md) |
| What is implemented and what is open | [`docs/IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md) |
| System architecture narrative | [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md); rules and status in [architecture-rules.md](architecture-rules.md) |
| Per-subsystem design | `docs/platform/`, `docs/audio/`, `docs/processing/`, `docs/infrastructure/`, `docs/engine/` |
| Per-Realm and per-adventure design | `docs/regions/` and the `*_ROADMAP.md` files; new ones from the [adventure templates](../adventures/templates/) |
| QA evidence | `docs/qa/<topic-or-date>/` |
| Task state, ownership, priority | Trello (not the repository) |

Do not create a second copy of canonical text. If two documents disagree, the canonical one wins
and the other is a defect to fix in the same branch, or to report if it is outside your scope.

## 3. Naming and placement

- New engineering and adventure documents: lowercase kebab-case, `.md`
  (`integration-policy.md`). Existing upper-case files (`TESTING_STRATEGY.md`) keep their names;
  renaming breaks links and history.
- Templates live in a `templates/` directory next to the standard that uses them.
- Feature or Realm design documents go under the subsystem directory they describe, not in
  `docs/engineering/`.
- QA evidence goes under `docs/qa/`. Binary evidence (screenshots, recordings) follows the asset
  rules in [asset-standard.md](../adventures/asset-standard.md); prefer links to stored evidence.

## 4. Markdown conventions

- One H1 per file, then the metadata block. `##` for sections, `###` below that.
- Relative links between repository documents (`../DECISIONS.md`), so they work on GitHub and in
  every worktree. Use backticks for paths that are not links.
- ADR references are exactly `ADR-` plus three digits; `ADR-NNN` is the only placeholder
  (`npm run adr:check`).
- Ticket references use the Trello ID (`LAI-ENG-001`); pull requests as `PR #n`.
- Dates are absolute (`2026-11-18`), never "yesterday" or "last week".
- Tables for comparisons and mappings; numbered lists for ordered procedures.
- Plain, direct sentences. No em dashes in child-facing copy (**Binding:** `CLAUDE.md` section
  13); avoid them in engineering documents too, for consistency.
- Wrap lines near 100 characters, matching Prettier's `printWidth` in `.prettierrc`.
- Never include secrets, credentials, real child data, personal contact details or production
  identifiers that are not already public.

## 5. Status of claims

Documentation must not overstate the system:

- Say "implemented on `main`" only for code merged to `main`. Work on a branch is "pending merge
  (PR #n)". Infrastructure code is not a deployed resource.
- Distinguish **Retired**, **Transitional**, **Implemented**, **Approved future** and
  **Proposed**, as [architecture-rules.md](architecture-rules.md) does.
- Do not record test results, QA results or approvals that did not happen. Record the command,
  the date and the exact outcome.
- An ADR's status is the owner's decision. Code on `main` is not evidence of acceptance.

## 6. Revision history

Git history is the revision history. Do not add change-log tables to documents. Do:

- update `Last reviewed` when you review or substantially change a document;
- record the decision behind a policy change in an ADR or on the Trello ticket, and link it;
- keep superseded text in place with a note when other documents cite it (as `docs/DECISIONS.md`
  does for superseded ADRs).

## 7. When documentation must be updated

In the same branch as the change, update every document the change makes stale:

| Change | Update |
|---|---|
| New or changed behaviour a child, parent or administrator sees | The feature or Realm document; `docs/IMPLEMENTATION_STATUS.md` |
| Architecture, shared service or dependency | [architecture-rules.md](architecture-rules.md), `docs/ARCHITECTURE.md` where it describes the area, and an ADR when a decision is made |
| Data model or migration | `docs/DATA_MODEL.md` or the subsystem's model document |
| API contract | The subsystem's API document (for example `docs/PLAY_API.md`) |
| Privacy, logging, retention or AI behaviour | [security-policy.md](security-policy.md), `docs/AI_AND_CHILD_SAFETY.md` or `docs/PRIVACY_AND_SAFETY_REVIEW.md` as applicable |
| Test commands or gates | `docs/TESTING_STRATEGY.md` (canonical), then [testing-policy.md](testing-policy.md) if the summary changes |
| Operational or deployment procedure | `docs/infrastructure/` or `docs/platform/` runbook; [release-policy.md](release-policy.md) |
| A standard turns out wrong | The standard itself, with a note on the ticket; owner approval if it is Mandatory |

Every task updates `docs/IMPLEMENTATION_STATUS.md` (**Binding:** `CLAUDE.md` section 14). To limit
merge conflicts between agents, add a new dated entry for your ticket rather than editing
another agent's entry.

## 8. Review

- Engineering documents change through pull requests like code. The owner reviews changes to
  Mandatory policy, `CLAUDE.md`, `AGENTS.md` and ADRs.
- A reviewer checks: canonical location, no duplicated policy, accurate status claims, links
  resolve, ADR references valid, no secrets.
- Proposed standards are reviewed together when the owner considers their ADR.

## 9. Deprecation

1. Set `Status: Deprecated` (or `Superseded`) and add one line naming the replacement and the
   ADR or ticket that retired it.
2. Update links that should point to the replacement. Leave historical references (ADRs, QA
   records) alone.
3. Delete a document only with owner approval and only when nothing cites it. ADRs are never
   deleted (**Binding:** `docs/DECISIONS.md` rule 7).

## 10. Automated checks

| Command | Checks | When |
|---|---|---|
| `npm run docs:check` | Required root files, engineering documents, adventure standards and templates exist; relative links in `CLAUDE.md`, `AGENTS.md`, `docs/engineering/`, `docs/adventures/` and `docs/adr/` resolve; those documents declare a valid status; templates contain their required sections; no Markdown file holds a merge-conflict marker | When you edit governed documents; at merge readiness through `make js-check` |
| `npm run adr:check` | ADR headings unique and well formed, registry consistent, every `ADR-NNN` reference defined or reserved | When you touch ADRs or cite them; at merge readiness; in CI |

`scripts/check-docs.ts` is unit-tested by `react/src/test/docsCheck.test.ts`
(`npx vitest run --maxWorkers=2 src/test/docsCheck.test.ts` from `react/`). The required file list
and template sections live in the script; change them there and in the test fixtures together.
Running `docs:check` in CI is an owner decision ([README](README.md), owner checklist).

## 11. Known documentation debt

Recorded by the [initial audit](initial-audit.md), not fixed by LAI-ENG-001:

- `docs/IMPLEMENTATION_STATUS.md` is about 14,000 lines and its opening summary predates the
  Django cutover.
- `docs/decisions_adr.md` is a working note duplicating ADR-027; a candidate for deprecation.
- Many older documents use "island" where player-facing text now says Realm.
- Five ADRs (ADR-036, ADR-043, ADR-048, ADR-049, ADR-050) are Proposed although their code is on
  `main`; they await owner decisions.
