# Release Policy

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-017, ADR-019, ADR-037, ADR-055, ADR-064

How code becomes a release in an environment, who authorizes it, and how it is verified and
rolled back. Operational detail lives in the canonical runbooks; this policy links to them rather
than copying them:

- [../platform/DJANGO_EC2_DEPLOYMENT.md](../platform/DJANGO_EC2_DEPLOYMENT.md) (ADR-037: Django on EC2, prod)
- [../infrastructure/dev-native-environment.md](../infrastructure/dev-native-environment.md) (ADR-055: native dev)
- [../infrastructure/deployment-design.md](../infrastructure/deployment-design.md) (site release, migrations, rollback)
- [../../README.md](../../README.md), "AWS Development Infrastructure - Deployment and Operations"

Untagged rules are proposals under ADR-072. Rules tagged **Binding:** already apply today.

## 1. Prohibitions

These apply to every agent, always:

1. **No unauthorized live AWS calls.** Agents do not run AWS commands that create, change, start,
   stop or delete resources. `.claude/settings.json` denies `aws * create-*`, `delete-*`, `put-*`,
   `update-*`, `deploy*`, `start-*`, `stop-*`, `run-*` and similar to Claude Code.
2. **No deployments without explicit owner approval.** This includes `cdk deploy`, CloudFormation
   change sets, `scripts/aws/*` deploy or rollback commands, `workflow_dispatch` of any deploy or
   infrastructure workflow, and merging to `main` while a deploy workflow is switched on.
   **Binding:** CLAUDE.md §8, §18; ADR-017; ADR-037; ADR-055
3. **Never delete or change deployed AWS resources** (the Cognito pool and retained Amplify tables
   and buckets included) and never migrate production data without explicit approval.
   **Binding:** CLAUDE.md §18
4. **Never reintroduce Amplify.** **Binding:** CLAUDE.md §18
5. Never put secrets in the repository, Trello, pull requests or release notes. Runtime secrets
   live in SSM Parameter Store and Secrets Manager.

## 2. Environments

| Environment | What it is | Status | Source |
|---|---|---|---|
| local | `make up` (PostgreSQL), Django dev server, Vite; fake AI, speech and processing providers | In use | CLAUDE.md §7, README.md |
| dev | Native Django on one ARM64 EC2 instance, private RDS PostgreSQL 16, Lambda and SQS workers, CloudFront site; nightly shutdown (00:00 stop, 07:35 start, Pacific) by the `lai-dev-power` state machine | Implemented in the repository; the docs record that nothing has been deployed. Provisioning and every deploy are owner-approved | ADR-055, ADR-064, dev-native-environment.md |
| prod | Django in Docker on EC2 from ECR by digest, ALB with ACM, WAF, RDS with pre-migration snapshots; CloudFront site | Repository side only; provisioning and every deploy are owner-approved | ADR-037, DJANGO_EC2_DEPLOYMENT.md |
| staging | None | **Does not exist.** A stable staging environment is a proposed, future owner decision. ADR-017 records that provisioning any new environment is an explicit human decision | ADR-017 |

Do not describe dev as operational until a live deployment and acceptance run have succeeded
(dev-native-environment.md). Live state is known only from dated owner records; check with the
owner before stating what is deployed.

## 3. How a release is triggered

`ci.yml` runs on pull requests and pushes to `main`. Five workflows release or operate
environments. Four of them run on **push to `main`** when their paths change and their repository
variable is on; all five accept `workflow_dispatch`.

| Workflow | Push to `main` paths | Gate variable | Dispatch |
|---|---|---|---|
| `deploy-django-ec2.yml` | `lai/**`, `content/**`, `react/public/models/**`, requirements, `scripts/aws/**`, `deploy/ec2/**`, and others | `LAI_DEPLOY_ENABLED` (otherwise only tests run). Dev is skipped when `LAI_DEV_NATIVE_ENABLED` is on. Prod on push only with `LAI_PROD_AUTO_DEPLOY` and dev success; prod uses the `django-prod` GitHub Environment with reviewers | deploy or rollback, dev or prod |
| `deploy-dev-native.yml` | `lai/**`, `content/**`, `react/public/models/**`, requirements, `scripts/aws/native/**`, `deploy/native/**`, and others | `LAI_DEV_NATIVE_ENABLED`. A stopped environment defers the release (`LAI_DEV_STOPPED_DEPLOY`) | deploy, rollback, deploy-pending |
| `deploy-dev-lambda.yml` | `lambda/**`, `lai/apps/ai/providers/**`, `lai/apps/jobs/core/**`, and others | `LAI_DEV_NATIVE_ENABLED` | yes |
| `deploy-site.yml` | `react/**`, `package.json`, `package-lock.json`, and others | `LAI_SITE_DEPLOY_ENABLED`. Prod with `LAI_PROD_AUTO_DEPLOY` or manual dispatch | deploy or rollback, dev or prod |
| `manage-dev-infrastructure.yml` | none (dispatch only) | `dev-infrastructure` GitHub Environment | start, stop, hold, status, deploy-pending, and others |

Consequence: **a merge to `main` is a release action** whenever a gate variable is on. Only the
owner sets these variables and dispatches these workflows. Read the workflow files for the exact
path lists before predicting what a merge triggers.

## 4. Release candidates

1. A release candidate is a commit on `main` (deploy workflows release only `main`).
2. Before the owner merges a candidate that will trigger a release, the merge-readiness gates run
   on it: `make check`, plus `npm run test:e2e`, `npm run test:acceptance` and other browser checks
   relevant to the change, `npm run content:check`, and the deferred checks of every task included.
   **Binding:** TESTING_STRATEGY.md ("Merge or release readiness")
3. Prepare release notes from [templates/release-notes.md](templates/release-notes.md) before the
   release, listing included tickets, migrations, infrastructure changes and the rollback plan.
4. Bundle related merges into one candidate where the owner prefers, by merging them while the gate
   variables are off or the environment is stopped, then releasing once.

## 5. Approvals

| Action | Who approves | Where recorded |
|---|---|---|
| Merge to `main` | Owner | Pull request, Trello card (`Owner approvals — YYYY-MM-DD` entry) |
| Turn on a deploy gate variable or GitHub Environment | Owner | Trello card, IMPLEMENTATION_STATUS.md |
| Deploy or roll back dev | Owner | Workflow run, release notes |
| Deploy or roll back prod | Owner, through `django-prod` and `site-prod` required reviewers | Workflow run, release notes |
| Infrastructure stack change (CDK, CloudFormation) | Owner | Release notes, Trello card |
| Destructive migration (`allow_destructive_migrations`) | Owner, after reading the migration plan | Release notes |
| Production data import or migration | Owner | ADR-019 gates, Trello card |

An agent may prepare everything (code, synth output, release notes, commands for the owner to run)
but does not execute the release step.

## 6. Migration planning

The deploy scripts already enforce safe migrations (deployment-design.md, section 4): preflight
`migrate --plan`, a destructive-operation guard (exit 45), an RDS snapshot before migrating in
prod, `migrate` once before the new release starts, and no automatic reversal.

Policy on top of that:

1. Every pull request lists its migrations; release notes list every migration in the release.
2. Use expand then contract: additive migration and code first; removal in a later release.
3. A release with migrations names who reviews the database if a rollback is needed
   (`manual_db_review_required`).
4. Data migrations and imports of retained Amplify data are owner approvals.
   **Binding:** CLAUDE.md §18

## 7. Infrastructure changes

1. Infrastructure code is not authorization to deploy it. **Binding:** ADR-037, ADR-055
2. Safe, local and allowed: `npm run infra:synth`, `npm run infra:synth:dev`,
   `npm run infra:synth:prod` (synthesis into `infra/cdk.out/`, no AWS change), and the `infra/`
   unit tests.
3. Not allowed without explicit owner approval: `cdk deploy`, creating or executing change sets,
   `scripts/aws/*` commands that change AWS, and any workflow dispatch.
4. Infrastructure pull requests use an `infra/` branch and state the stacks affected, the change
   set the owner should expect, and the cost impact.

## 8. Asset publication

1. Staff publish assets, sound releases and NPC releases through Django Admin.
   **Binding:** ADR-045, ADR-047
2. Seed and content publishing scripts that write to a deployed environment (for example the
   Treasure Rush model publication step in DJANGO_EC2_DEPLOYMENT.md) are owner-run operations.
3. Published asset versions are never overwritten in place; publish a new version.
4. Site assets use content-hashed names and are never deleted by a release, so rollback keeps
   working (deployment-design.md, section 5).

## 9. Backward compatibility

1. Backend and frontend from one commit ship API first: the site workflow waits for that commit's
   Django release (deployment-design.md, section 3).
2. API changes stay compatible with the previous site build until the next site release lands.
3. Content and manifest schemas carry versions; do not remove a field a published release reads.
4. Migrations follow section 6, so the previous release keeps running against the new schema.

## 10. Health checks and post-deployment verification

The release scripts check live, ready and the expected release before recording success, and an
unhealthy release rolls back automatically. After any owner-approved release:

1. Confirm the workflow run is green and the release record shows `healthy`
   (`scripts/aws/ssm-run.sh <env> status`, run by the owner).
2. Check `GET /api/v1/health/ready/` on the environment's API host.
3. Run the acceptance checklist relevant to the change (README.md "Acceptance checklist" for dev).
4. Smoke-test the parent sign-in, child profile selection and one Adventure touched by the release.
5. Record results in the release notes "Verification" section and on the Trello card. Do not mark
   Deployed without this evidence.

## 11. Rollback

| Component | Procedure (owner-run) |
|---|---|
| Django prod or Docker dev | `deploy-django-ec2.yml` dispatch with `action=rollback` (optional `rollback_to=<full sha>`) |
| Django native dev | `deploy-dev-native.yml` dispatch with `action=rollback` |
| Site | `deploy-site.yml` dispatch with `action=rollback`, `rollback_to=<sha>` (no rebuild) |
| Code on `main` | `git revert` through a pull request (branch-policy.md, section 8) |
| Database | Migrations are never reversed. Roll forward with a fix, or restore the pre-migration snapshot (DJANGO_EC2_DEPLOYMENT.md, section 9) with owner approval |

Every release note contains a rollback plan before the release starts.

## 12. Release notes

Use [templates/release-notes.md](templates/release-notes.md). Release notes are written for each
deployment to dev or prod, link each included pull request and ticket, and record approvals and
verification evidence. A completed implementation is never described as a release; a release
exists only when an authorized deployment was performed and verified
([definition-of-done.md](definition-of-done.md)).
