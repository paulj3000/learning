# ADR template

> **Status:** Template
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001

Copy everything below the line into [`docs/DECISIONS.md`](../DECISIONS.md), replacing the
`## ADR identifier` and `## Title` sections with one heading of the form
`## ADR-NNN: <title>` (that is the syntax `npm run adr:check` requires), and the remaining
`## ` sections with `###` subsections. Add the registry row with the identical title. See
[README.md](README.md) for numbering.

---

## ADR identifier

ADR-NNN (the next free number in the `docs/DECISIONS.md` registry, after every `Reserved` row)

## Title

<one sentence stating the decision, not the problem>

## Status

Proposed

<!-- Allowed: Proposed, Accepted, Accepted in part, Rejected, Superseded by ADR-NNN, Deprecated.
     Only the owner moves an ADR out of Proposed. -->

## Date

<YYYY-MM-DD proposed>

## Context

<What forces this decision now. Current architecture, constraints, the ticket that raised it,
and the accepted ADRs it touches. Facts only, with file paths.>

## Decision

<Numbered, testable statements. What is decided, what is explicitly not decided, and what stays
as it is.>

1. <statement>
2. <statement>

## Alternatives considered

| Alternative | Why not chosen |
|---|---|
| <option> | <reason> |

## Consequences

<What becomes easier, what becomes harder, what follow-up work is created.>

## Security implications

<Child privacy, authorization, data retention, secrets, AI safety. Write "None identified" only
after checking `docs/engineering/security-policy.md`.>

## Implementation impact

<Code, migrations, infrastructure, documentation and tests affected. State whether anything is
deployed: an ADR never authorizes a deployment.>

## Related tickets

- <LAI-AREA-NNN>

## Related ADRs

- Builds on: <ADR-NNN>
- Amends or supersedes: <ADR-NNN, or none>

## Owner approval

<Pending. When the owner decides: date, decision, and source (Trello card or message).>
