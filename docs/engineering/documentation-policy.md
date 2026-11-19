# Documentation Policy

- **Status:** Mandatory policy (ADR-072, accepted by the owner 2026-11-18). These standards are the final authority after the owner.
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-072 (Accepted), ADR-027 (working note distinct from the ADR log)
- **Canonical sources:** [`CLAUDE.md`](../../CLAUDE.md) sections 13 to 15; [`docs/DECISIONS.md`](../DECISIONS.md) "ADR registry and governance"

Documentation is part of the change. This policy says where documents live, how they are marked,
when they must be updated, and how they are retired.

## Ownership

| Document set | Owner | Who may edit |
|---|---|---|
| [`CLAUDE.md`](../../CLAUDE.md), [`AGENTS.md`](../../AGENTS.md) | Project owner | Agents only with an owner-approved ticket |
| `docs/engineering/`, `docs/adventures/` (Mandatory policy) | Project owner | Agents propose changes through a PR; the owner approves |
| [`docs/DECISIONS.md`](../DECISIONS.md) | Project owner | Agents number and register their own ADR only through the [ADR number procedure](multi-agent-workflow.md#adr-number-reservation) (the `Reserved` row lands on `main` in a registry-only change the owner merges); status changes need the owner |
| [`docs/IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md), [`tasks/TASK_TRACKER.md`](../../tasks/TASK_TRACKER.md) | Project owner | The agent of each ticket updates its own entry |
| Feature, subsystem and adventure docs (for example `docs/regions/`, `docs/audio/`, `docs/platform/`) | Project owner | The ticket that changes the behavior |
| Generated files (`content/exported`, golden vectors) | Their generator | Regenerate; never hand-edit |

## Canonical locations

One topic has one canonical document. Others link to it and may summarize it in a sentence; they do
not copy it.

| Topic | Canonical location |
|---|---|
| Agent entry point and product rules | [`CLAUDE.md`](../../CLAUDE.md) |
| Tool-neutral agent rules | [`AGENTS.md`](../../AGENTS.md) |
| Engineering policy | `docs/engineering/` (index: [`README.md`](README.md)) |
| Adventure standards | [`docs/adventures/`](../adventures/README.md) |
| Architecture decisions | [`docs/DECISIONS.md`](../DECISIONS.md) (single log; no `docs/adr/` directory) |
| Check cadence | [`docs/TESTING_STRATEGY.md`](../TESTING_STRATEGY.md) |
| Architecture overview | [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Data model | [`docs/DATA_MODEL.md`](../DATA_MODEL.md) |
| AI and child safety | [`docs/AI_AND_CHILD_SAFETY.md`](../AI_AND_CHILD_SAFETY.md) |
| Content hierarchy | [`docs/platform/CANONICAL_CONTENT_MODEL.md`](../platform/CANONICAL_CONTENT_MODEL.md) |
| Project status | [`docs/IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md) |
| Migration roadmap and APPROVAL tasks | [`docs/DJANGO_MIGRATION_ROADMAP.md`](../DJANGO_MIGRATION_ROADMAP.md) |
| Templates | [`templates/`](README.md#engineering-templates) and [`docs/adventures/templates/`](../adventures/README.md) |

The full path mapping is in [`README.md`](README.md#requested-paths-and-their-canonical-locations).

## Naming

- Existing `UPPER_SNAKE_CASE.md` documents (for example `docs/TESTING_STRATEGY.md`) keep their names.
  Renaming breaks links and history.
- New documents in `docs/engineering/` and `docs/adventures/` use `kebab-case.md`.
- New documents elsewhere follow the convention of their directory.
- Templates live in a `templates/` directory next to the policy that uses them.

## Markdown conventions

- One `#` title, then ATX headings (`##`, `###`) in order, without skipping levels.
- Plain, direct English. Prefer tables and checklists to long prose.
- No em dashes in child-facing copy; avoid them in documents too.
- Code, paths, commands and identifiers in backticks; commands in fenced blocks with a language.
- Placeholders in templates are written `<placeholder>`. ADR placeholders are written `ADR-NNN`.
- Reference ADRs as `ADR-` plus three digits, and only identifiers that exist or are `Reserved` in
  the registry; `npm run adr:check` fails on any other.
- No secrets, credentials, email addresses, child data or fabricated results in any document.
- `docs/` and `CLAUDE.md` are excluded from Prettier (`.prettierignore`); `AGENTS.md` is not, so it
  must pass `npm run format:check`.

## Status values and header block

Every new policy, standard or template starts with a title and this header block:

```markdown
# <Title>

- **Status:** <Mandatory policy | Guidance | Proposed | Deprecated | Superseded>
- **Owner:** Project owner
- **Last reviewed:** <yyyy-mm-dd>
- **Related ADRs:** <ADR ids, or none>
- **Related tickets:** <ticket ids, optional>
- **Canonical sources:** <links to the documents this one relies on>
```

| Status | Meaning |
|---|---|
| Mandatory policy | In effect and must be followed. Deviations need an owner decision, recorded on the ticket |
| Guidance | Recommended practice. Deviate with a reason recorded in the PR or completion report |
| Proposed | Not in effect. A draft not yet merged at the owner's direction; must not be cited as a rule |
| Deprecated | Still present for reference, no longer to be followed; names its replacement |
| Superseded | Replaced by a named document or ADR; kept for history |

Statements about the system inside any document use the implementation labels: Implemented (main),
Pending merge (branch), Approved future, Proposed, Retired. Never describe branch-only work as
implemented.

## Revision history

Git history is the revision history. Do not keep change logs inside documents, except that a
Mandatory policy document may keep a short `## Changes` section listing dated policy changes and
the ticket or ADR that approved each. Update **Last reviewed** whenever the content is reviewed or
changed.

## Related ADRs and tickets

List the ADRs a document depends on in its header. Link tickets by id; do not paste ticket content.
When an ADR changes a documented behavior, the ADR names the affected document (as ADR-047 names
`docs/platform/DJANGO_CONTENT_AUTHORING.md`) and the document names the ADR.

## Cross-references

- Use relative links that resolve from the document's own location.
- Link only to files that exist in the same commit.
- `make docs-check` (`scripts/check_engineering_docs.py`, standard library only; also run by
  `make js-check` and CI) checks required documents, status lines, relative links in `CLAUDE.md`,
  `AGENTS.md`, `docs/engineering/` and `docs/adventures/`, template sections and merge-conflict
  markers. It is cheap and may be run during development whenever documentation changes.
- Fix or remove a broken link in the same change that breaks it.

## When documentation must be updated

| Change | Update in the same branch |
|---|---|
| Behavior, architecture, schema, API, privacy behavior or scope | The canonical document for that topic (CLAUDE.md section 13) |
| Operations: configuration, environment variables, deployment, infrastructure code | The relevant `docs/platform/` or `docs/infrastructure/` document |
| An architectural decision | A new or amended ADR in [`docs/DECISIONS.md`](../DECISIONS.md), numbered per [`multi-agent-workflow.md`](multi-agent-workflow.md#adr-number-reservation) |
| Any completed ticket | Its entry in [`docs/IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md) (CLAUDE.md section 14), and its line in [`tasks/TASK_TRACKER.md`](../../tasks/TASK_TRACKER.md) if it is a roadmap task |
| A new check or command | [`docs/TESTING_STRATEGY.md`](../TESTING_STRATEGY.md) |

A ticket is not done while its documentation is out of date ([`definition-of-done.md`](definition-of-done.md)).

## Review requirements

| Change | Review |
|---|---|
| Mandatory policy, `CLAUDE.md`, `AGENTS.md` | Owner approval through a PR |
| Architectural change | ADR in [`docs/DECISIONS.md`](../DECISIONS.md), accepted by the owner |
| Guidance, feature and subsystem docs | Reviewed with the code change in its PR |
| Typo or broken-link fix with no meaning change | Reviewed in any PR; say so in the description |

## Deprecation

1. Change the header status to Deprecated or Superseded and add a line at the top naming the
   replacement document or ADR.
2. Update links that should now point to the replacement.
3. Keep the file. Delete a deprecated document only with owner approval, after nothing links to it.
4. ADRs are never deleted. A superseded ADR keeps its section; only its `Status:` line changes
   (governance rule 6 in [`docs/DECISIONS.md`](../DECISIONS.md)).

## No duplicate documents

Before writing a new document, search `docs/` for the topic. If a canonical document exists, extend
it or link to it. If two documents already overlap, report it and propose which one becomes
canonical; do not merge or delete them without owner approval.

## Mandatory policy, guidance and proposals

- **Mandatory policy** is binding on every agent and contributor. Conflicts are resolved by the
  precedence order in [`README.md`](README.md#precedence-when-documents-conflict).
- **Guidance** describes good practice; a reasoned deviation is allowed and recorded.
- **Proposed** content is a draft. It may be discussed and planned against, but no agent treats it
  as permission or as a rule until the owner approves it and its status changes.
- The standards (`CLAUDE.md`, `AGENTS.md`, `docs/engineering/`, `docs/adventures/`) are Mandatory
  policy under ADR-072, accepted by the owner 2026-11-18. They are the final authority after the
  owner: an owner decision ranks first, then these standards, then accepted ADRs in
  [`docs/DECISIONS.md`](../DECISIONS.md) and every other document. An older document that
  conflicts with the standards is stale and is corrected to match.
