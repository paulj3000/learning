# Pull Request: <title>

> **Status:** Template
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001

Copy everything below the line into the pull request description. Fill every section; write
"None" with a reason when a section does not apply. Rules: [../branch-policy.md](../branch-policy.md),
[../integration-policy.md](../integration-policy.md), [../definition-of-done.md](../definition-of-done.md).

---

## Summary

`<What this pull request changes and why, in two to four sentences.>`

## Ticket

- Ticket: `LAI-<AREA>-<NNN>`
- Trello card: `<card URL>`
- Parent PR (stacked branches only): `#<n>`, which must merge first
- Related ADRs: `ADR-NNN` (or None)

## Changes

- `<change>`

## Tests executed

| Command | Result |
|---|---|
| `<command>` | `<result from the actual run>` |

## Deferred checks

`<Checks deferred to merge verification (for example make check, npm run test:e2e,
npm run test:acceptance, build), per ../../TESTING_STRATEGY.md.>`

## Shared component changes

`<Shared components changed (../integration-policy.md section 5) and who agreed. "None" if none.>`

## Migrations

`<Each new migration file, whether additive or destructive, and the expand/contract plan. "None"
if none.>`

## Security and privacy

`<Authorization, child data, AI safety, logging, secrets. "No impact" with a reason if none.>`

## Documentation

`<Docs updated, including docs/IMPLEMENTATION_STATUS.md and any ADR.>`

## Deployment impact

`<Which deploy workflows this merge triggers by path (deploy-django-ec2, deploy-dev-native,
deploy-dev-lambda, deploy-site) and whether their gate variables are on, per
../release-policy.md section 3. "No deployment" only when no deploy path changes.>`

## Owner actions

- [ ] `<review, QA, merge authorization, decisions, post-merge steps>`

<!-- Attribution: a pull request body created by Claude ends with the Claude Code attribution line
supplied by the session (for example the "Generated with Claude Code" line). Do not add attribution
a tool did not produce. -->
