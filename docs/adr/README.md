# Architecture Decision Records

> **Status:** Mandatory
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001

This directory is the **entry point** for architecture decisions. It is not where decisions are
stored.

## Canonical location

Every ADR lives in one file: [`docs/DECISIONS.md`](../DECISIONS.md). Its "ADR registry and
governance" section lists every identifier in use or reserved, the next free number, and the
numbering rules. `npm run adr:check` (`scripts/check-adrs.ts`, also run by `make js-check` and
CI) enforces them. **Binding:** `docs/DECISIONS.md` governance rules 1 to 7.

The engineering standards proposed a `docs/adr/` directory. Individually named ADR files are not
used, because `docs/DECISIONS.md` already records why: moving about 4,500 lines and rewriting
every link gives no collision protection the check does not already give. Do not create ADR files
in this directory or anywhere else (some processing branches keep ADR bodies in
`docs/processing/adr/`; they move into `docs/DECISIONS.md` when those branches merge); a second
location is a competing log. The mapping is:

| Target structure | Canonical location |
|---|---|
| `docs/adr/` (one file per ADR) | `docs/DECISIONS.md` (one section per ADR, plus the registry) |
| `docs/adr/template.md` | [template.md](template.md) in this directory (copy its body into `docs/DECISIONS.md`) |
| ADR index | The registry table at the top of `docs/DECISIONS.md` |

## Status values

| Status | Meaning | Who sets it |
|---|---|---|
| Proposed | Written and argued; not yet approved. Code may exist, but code is not acceptance. | Any agent |
| Accepted | The owner approved it. Record the date and the owner's words or ticket. | Owner only |
| Accepted in part | The owner approved named items; the rest stay Proposed or gated. | Owner only |
| Rejected | The owner declined it. The section stays as a record. | Owner only |
| Superseded by ADR-NNN | A later accepted ADR replaces it. The section stays in place. | Owner (through the superseding ADR) |
| Deprecated | No longer recommended, with no replacement yet. | Owner only |
| Reserved | Registry row only: the number is held for a decision on an unmerged branch. | Any agent, following registry rule 7 |

The registry already uses compound values such as "Accepted; amended by ADR-064". Keep the
leading word one of the values above.

An agent never marks an ADR Accepted, Rejected, Superseded or Deprecated on its own. It records
the owner's decision when the owner gives it, with the date.

## Writing a new ADR

1. Fetch, then read the registry on `main` and on any integration branch your work will join.
   Check open branches too (`git log --all -S"## ADR-NNN"`, with the number you plan to use), because branches sometimes use a
   number before reserving it.
2. Take the next free number. If a branch elsewhere already uses a number without a registry
   row, add a `Reserved` row for it (rule 7) and take the next one.
3. Copy the body of [template.md](template.md) into `docs/DECISIONS.md` as `## ADR-NNN: Title`,
   add the registry row with the identical title, and update "Next free identifier number".
4. Set `Status: Proposed`. Link the Trello ticket.
5. Run `npm run adr:check`.
6. When the owner decides, update the `Status:` line, the registry row and the "Owner approval"
   section with the date and source.

## Related

- [Documentation policy](../engineering/documentation-policy.md)
- [Architecture rules](../engineering/architecture-rules.md)
- [AGENTS.md](../../AGENTS.md), rule 10 (preserve existing decisions)
