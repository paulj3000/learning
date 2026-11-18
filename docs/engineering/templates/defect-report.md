# Defect Report Template

- **Status:** Guidance (template)
- **Owner:** project owner
- **Last reviewed:** 2026-11-18
- **Canonical sources:** [trello-workflow.md](../trello-workflow.md),
  [branch-policy.md](../branch-policy.md)

One defect per card. Fixes use a `fix/<ticket>-<slug>` branch. Do not include child names,
free text, audio, emails or secrets.

---

# <ticket id>: <short defect title>

## Summary

<One sentence: what is wrong.>

## Found In

- Parent ticket: `<ticket id>`
- Commit or branch: `<full SHA or branch>`
- Environment: `<local | dev | prod>`
- Found by and date: `<owner | agent id>`, `<yyyy-mm-dd>`

## Severity

`<S1 blocks release | S2 major, workaround exists | S3 minor | S4 cosmetic>`; required for acceptance: `<yes | no>` (owner decides)

## Steps to Reproduce

1. <step>

## Expected Result

<what should happen>

## Actual Result

<what happens, as observed>

## Evidence

- <screenshot, log excerpt with no sensitive data, failing test name>

## Affected Components

- `<path or area>`; shared component: `<yes | no>`

## Suspected Cause

<optional; mark as a hypothesis>

## Fix

- Branch: `<fix/ticket-slug>`
- Commit: `<full SHA, once it exists>`
- Regression test: `<test path>`
