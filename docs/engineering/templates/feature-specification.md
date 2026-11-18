# Feature Specification: <feature title>

> **Status:** Template
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001

Copy this file for a new feature (one that may split into several tasks). Replace every
placeholder. Write "None" with a reason rather than deleting a section. Link canonical documents
instead of copying them. For a Realm, Adventure, Quest or Challenge, use the matching template in
[../../adventures/templates/](../../adventures/templates/adventure-specification.md) as well.

## Feature identifier

- Feature ID: `LAI-<AREA>-<NNN>`
- Title: `<title>`
- Trello card: `<card URL>`
- Author: `<ChatGPT | owner | Claude-NN>`
- Date: `<YYYY-MM-DD>`
- Related ADRs: `ADR-NNN` (or None)

## Objective

`<One paragraph: what the feature does for the child, parent or administrator.>`

## Business or educational value

`<Learning objectives, age bands affected, product pillar served (CLAUDE.md section 4).>`

## Requirements

1. `<requirement>`

## Nonrequirements

- `<explicitly out of scope>`

## Architecture

`<Where it lives (Django app, React feature, Three.js engine), data flow, and which accepted ADRs
constrain it. Name any new ADR needed.>`

## Dependencies

| Dependency | Type (ticket, PR, ADR, owner decision) | Status |
|---|---|---|
| `<id>` | `<type>` | `<merged / open / pending>` |

## Data models

`<New or changed Django models and migrations, by app. "None" if no schema change.>`

## API contracts

`<Endpoints, request and response shapes, versioning, authorization rules.>`

## Frontend changes

`<Routes, components, engine extensions; accessibility and age-band behaviour.>`

## Security implications

`<Authorization, child data, AI safety, logging (no child free text or identifiers), secrets.>`

## Parallel work packages

| Package | Ticket ID | Owned components | Can start when |
|---|---|---|---|
| `<name>` | `LAI-<AREA>-<NNN>` | `<paths>` | `<condition>` |

## Serial work packages

| Order | Package | Ticket ID | Waits for |
|---|---|---|---|
| 1 | `<name>` | `LAI-<AREA>-<NNN>` | `<dependency>` |

## Testing strategy

`<Unit, integration and browser tests; which run during development and which are deferred to merge
verification (see ../../TESTING_STRATEGY.md).>`

## Acceptance criteria

- [ ] `<observable, testable criterion>`

## Deployment implications

`<Which deploy workflows a merge triggers by path, migrations, infrastructure, feature flags. State
"No deployment in scope" if none.>`

## Owner decisions required

- [ ] `<decision needed, options, recommendation>`
