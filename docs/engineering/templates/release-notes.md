# Release Notes Template

- **Status:** Guidance (template)
- **Owner:** project owner
- **Last reviewed:** 2026-11-18
- **Canonical sources:** [release-policy.md](../release-policy.md),
  [docs/platform/DJANGO_EC2_DEPLOYMENT.md](../../platform/DJANGO_EC2_DEPLOYMENT.md),
  [docs/infrastructure/dev-native-environment.md](../../infrastructure/dev-native-environment.md)

Drafted by an agent for an owner-approved release; verification results are filled only after
they are observed.

---

# Release <environment> <yyyy-mm-dd>

## Release

- Environment: `<dev | prod>`
- Commit: `<full SHA of main>`
- Previous release: `<full SHA>`
- Owner approval: `<date and where recorded>`
- Run by: `<owner | agent id with owner authorization>`

## Included Tickets

| Ticket | Title | PR |
|---|---|---|
| `<ticket id>` | <title> | #<n> |

## Changes for Parents and Children

- <plain-language change>

## Database Migrations

| App | Migration | Kind (expand / contract) | Destructive approval |
|---|---|---|---|
| <app> | `<number_name>` | <kind> | <not needed / approved yyyy-mm-dd> |

## Infrastructure Changes

- <stack and change, or "None">

## Assets and Content Published

- <asset or content release, or "None">

## Known Issues

- <issue, or "None known">

## Rollback Plan

- Target: `<full SHA>`
- Method: `<workflow rollback dispatch | revert PR>`
- Migrations not reversible: <list or "None">

## Verification

- Workflow run: `<link>`
- Health (`/api/v1/health/`): `<result>`
- Readiness (`/api/v1/health/ready/`): `<result>`
- Release record status: `<healthy | pending | manual_db_review_required>`
- Owner smoke test: `<result>`
