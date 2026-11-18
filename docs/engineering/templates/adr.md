# ADR Template

- **Status:** Guidance (template)
- **Owner:** project owner
- **Last reviewed:** 2026-11-18
- **Canonical sources:** [docs/DECISIONS.md](../../DECISIONS.md) ("ADR registry and governance"),
  [multi-agent-workflow.md](../multi-agent-workflow.md) ("ADR number reservation")

`docs/DECISIONS.md` is the only ADR log. Do not create separate ADR files or a `docs/adr/`
directory. This file shows the content an ADR must have; the decision itself is added to
`docs/DECISIONS.md`.

## How to add an ADR

1. Take the number through the reservation procedure in
   [multi-agent-workflow.md](../multi-agent-workflow.md#adr-number-reservation) (check `main`
   and open branches, record the number on the Trello card, add a `Proposed` registry row on
   your branch).
2. Append the decision to `docs/DECISIONS.md` using the heading format below: exactly
   `## ADR-` plus three digits, a colon, and the title, followed by a `Status:` line.
3. Update the registry row: same title as the heading, current status, origin branch, notes.
   Update "Next free identifier number" if it changed.
4. Reference decisions everywhere as `ADR-` plus three digits. The literal `ADR-NNN` is a
   placeholder and is ignored by the check; never write short forms with fewer than three digits.
5. Run `npm run adr:check`. A merge is not complete until it passes.
6. To supersede a decision, keep its section, change its `Status:` line, and add the new ADR.
   Never delete a decision.

Status values: `Proposed`, `Accepted`, `Rejected`, `Superseded by ADR-NNN`, `Deprecated`. The
existing log also uses `Accepted in part` (for example ADR-019) and `Reserved` (registry rows for
decisions not yet merged), and compound forms such as `Accepted; amended by ADR-NNN`. Only the
owner sets `Accepted`, `Accepted in part` or `Rejected`.

Section labels: in `docs/DECISIONS.md` each ADR is itself a `##` heading, so when you paste the
template there, turn the `##` section headings below into bold paragraph labels
(`**Context.**`, `**Decision.**`) as existing entries do.

Registry row to add or update:

```text
| ADR-NNN | <Title, identical to the heading> | <Status> | <origin branch or main> | <notes: owner approval date, amends or supersedes> |
```

---

## ADR-NNN: <Title>

Status: <Proposed | Accepted | Rejected | Superseded by ADR-NNN | Deprecated> (<who, yyyy-mm-dd>)

## ADR Identifier

`ADR-NNN` (reserved in the registry on <yyyy-mm-dd>)

## Title

<Title, identical to the heading and the registry row>

## Status

<Status as above, with the owner approval reference when accepted>

## Date

<yyyy-mm-dd>

## Context

<The problem, the forces, what exists today on main (verified), and what triggered the decision.>

## Decision

1. <Numbered, testable decision items.>

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| <alternative> | <reason> |

## Consequences

- Positive: <item>
- Negative: <item>
- Follow-up work: <tickets>

## Security Implications

<Authorization, child data, secrets, AI safety, AWS exposure. "None" only if verified.>

## Implementation Impact

<Code, data model and migrations, infrastructure, docs to change; what is not changed.>

## Related Tickets

- `<ticket id>`

## Related ADRs

- ADR-NNN: <amends | supersedes | builds on>

## Owner Approval

<"Pending" until the owner approves. Then: owner, date, where recorded (Trello card or PR), and
any conditions. Agents never write this on the owner's behalf.>
