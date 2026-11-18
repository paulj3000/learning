# QA Checklist Template

- **Status:** Guidance (template)
- **Owner:** project owner
- **Last reviewed:** 2026-11-18
- **Canonical sources:** [definition-of-done.md](../definition-of-done.md),
  [docs/UX_AND_ACCESSIBILITY.md](../../UX_AND_ACCESSIBILITY.md),
  [docs/AI_AND_CHILD_SAFETY.md](../../AI_AND_CHILD_SAFETY.md)

Prepared by the agent for Owner QA; executed and signed off by the owner. The agent fills the
setup and steps; only the owner fills results and sign-off.

---

# QA: <ticket id> <title>

## Build Under Test

- Branch or commit: `<branch>` at `<full SHA>`
- Environment: `<local | dev>` (`<URL or "make up, make runserver, make web">`)
- Test data: `<fixtures or seed commands>`

## Setup

1. <step>

## Acceptance Criteria

| # | Criterion | Steps | Expected | Result (owner) |
|---|---|---|---|---|
| 1 | <criterion> | <steps> | <expected> | <pass / fail / not run> |

## Product Quality

| Check | Expected | Result (owner) |
|---|---|---|
| Child flow | Works as specified for the target age band | |
| Parent flow | Works as specified | |
| Loading, empty and error states | Shown and readable | |
| AI fallback | Code-authored fallback appears when AI is unavailable | |
| Age bands | Sprouts, Pathfinders, Explorers each behave as specified | |
| Accessibility | Keyboard and touch reachable, readable aloud, large targets | |
| No play-time limits | No countdowns, stop nudges or cutoffs (ADR-053) | |
| Tablet layout | Usable at tablet width | |
| Movement and jumping (if gameplay) | Accessible non-jump route, safe recovery, no progress loss | |

## Regression

- <area that could be affected>: <result (owner)>

## Defects Found

- <link to defect card, or "None">

## Owner Sign-off

- Result: `<Accepted | Rework Required>`
- Date: `<yyyy-mm-dd>`
- Notes: <owner notes>
