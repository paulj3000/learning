# Release Notes: <release identifier>

> **Status:** Template
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001

Prepared before an owner-authorized deployment and completed after verification
([../release-policy.md](../release-policy.md)). A release exists only when an authorized deployment
was performed. Never record secrets here.

## Release identifier

- Release: `<env>-<YYYY-MM-DD>-<short sha>`
- Commit on `main`: `<full sha>`
- Workflow runs: `<run URLs>`

## Environment

`<dev | prod>`; components: `<Django | site | Lambda workers | infrastructure>`

## Included changes

| Ticket | Pull request | Summary |
|---|---|---|
| `LAI-<AREA>-<NNN>` | `#<n>` | `<summary>` |

## Migrations

| App | Migration | Additive or destructive | Notes |
|---|---|---|---|
| `<app>` | `<file>` | `<additive / destructive>` | `<expand/contract step>` |

## Infrastructure changes

`<Stacks and resources changed, change set reviewed by the owner, cost impact. "None" if none.>`

## Known issues

- `<issue, or None>`

## Rollback plan

`<Workflow and target SHA for each component; database plan, since migrations are never reversed.>`

## Verification

- [ ] Workflow runs green; release record `healthy`.
- [ ] `/api/v1/health/ready/` passes on the API host.
- [ ] Acceptance or smoke checks: `<list, with results>`

## Approvals

| Approval | By | Date | Where recorded |
|---|---|---|---|
| Deployment | `<owner>` | `<YYYY-MM-DD>` | `<Trello card or run>` |
