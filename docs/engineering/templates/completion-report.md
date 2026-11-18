# Completion Report: <ticket ID>

> **Status:** Template
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001

Written by the implementing agent when a ticket reaches Development Complete
([../definition-of-done.md](../definition-of-done.md)). State the gate reached precisely. Copy
results from actual runs; never fabricate evidence.

Gate reached: `<Development Complete | Integration Complete>`; merged: `<no | sha>`; deployed: `<no
| environment and release>`

## Original scope

`<scope as specified in the ticket>`

## Implemented scope

- `<item>`

## Deferred scope

- `<item, reason, follow-up ticket>`

## Test evidence

| Command | Result |
|---|---|
| `<command>` | `<result>` |

Deferred to merge verification: `<checks>`

## Commits

- `<sha>` `<subject>`

## Pull requests

- `#<n>` `<title>` (or "PR text prepared for the owner to open")

## Documentation updates

- `<path>`

## Trello updates

`<card moved to, ticket block fields updated, dated entry added>`

## Integration requirements

`<dependencies to merge first, shared components touched, migrations to coordinate. "None" if none.>`

## Owner QA requirements

`<what the owner must test, on which build, with which checklist>`

## Deployment status

`<"Not deployed" unless an authorized deployment was performed and verified; then environment,
release and release notes link.>`
