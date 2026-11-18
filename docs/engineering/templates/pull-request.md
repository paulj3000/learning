# Pull Request Template

- **Status:** Guidance (template)
- **Owner:** project owner
- **Last reviewed:** 2026-11-18
- **Canonical sources:** [branch-policy.md](../branch-policy.md),
  [integration-policy.md](../integration-policy.md), [release-policy.md](../release-policy.md)

Copy below the line into the pull request description. The PR title follows the commit summary
style: imperative, at most 72 characters. Add any trailer lines the session harness requires
at the end of the description.

---

## Summary

<What this changes and why, in two to four sentences.>

## Ticket

- Ticket: `<ticket id>` (<Trello card link>)
- Parent: `<parent ticket id or none>`
- Agent: `<Claude-0N | owner>`

## Branch

- Branch: `<branch>` into `<main | integration/yyyymmdd-topic>`
- Baseline SHA: `<full SHA>`
- Stacked on: `<branch or none>`

## Changes

- `<path>`: <change>

## Shared Components and Migrations

- Shared components touched: <list or "None">
- Migrations: <app and number, expand or contract, or "None">
- ADR changes: <reserved `ADR-NNN` and registry row, or "None">

## Tests

- Run during development: `<command>`: <observed result>
- Deferred to merge verification: <checks>

## Deployment Impact

- Deploy workflows this merge can trigger: <deploy-dev-native | deploy-dev-lambda | deploy-django-ec2 | deploy-site | none> (by changed paths)
- Infrastructure changed: <stacks or "None">
- Live AWS deployment authorized: <no | yes, by owner on yyyy-mm-dd for environment>

## Owner Approvals

- <approval quoted with date and where it was given, or "None yet">

## Known Limitations

- <item or "None">

## Checklist

- [ ] Development Complete criteria met ([definition-of-done.md](../definition-of-done.md))
- [ ] Branch up to date with base; conflicts resolved without discarding others' work
- [ ] `npm run adr:check` passes if ADRs or ADR references changed
- [ ] Status docs updated ([docs/IMPLEMENTATION_STATUS.md](../../IMPLEMENTATION_STATUS.md))
- [ ] Trello card updated with this PR link
- [ ] No secrets, child data or fabricated evidence in code, docs or this description
