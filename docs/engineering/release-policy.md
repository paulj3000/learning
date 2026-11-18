# Release Policy

- **Status:** Mandatory policy
- **Owner:** project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-017, ADR-019, ADR-037, ADR-047, ADR-055, ADR-064, ADR-072 (proposed engineering governance)
- **Canonical sources:** [docs/infrastructure/deployment-design.md](../infrastructure/deployment-design.md),
  [docs/infrastructure/dev-native-environment.md](../infrastructure/dev-native-environment.md),
  [docs/platform/DJANGO_EC2_DEPLOYMENT.md](../platform/DJANGO_EC2_DEPLOYMENT.md),
  [docs/platform/ENVIRONMENTS_CONFIG_AND_CONTRACT_TESTS.md](../platform/ENVIRONMENTS_CONFIG_AND_CONTRACT_TESTS.md),
  [docs/infrastructure/resource-ownership.md](../infrastructure/resource-ownership.md)

This policy decides who may release what, to which environment, and how a release is checked
and undone. The mechanics (commands, workflow inputs, exit codes) stay in the canonical sources
above; this document does not repeat them.

## Prohibited without explicit owner approval

Agents never do any of the following unless the owner has approved that specific action, for
that environment, in writing (Trello card or pull request), in the current task:

- make live AWS calls that read or change account resources (AWS CLI, SDK, console automation,
  `scripts/aws/*` against a real account);
- deploy code, infrastructure, content or assets to any AWS environment;
- run `cdk deploy`, apply a change set, or run `scripts/aws/provision.sh`;
- dispatch, re-run or approve any `deploy-*` or `manage-dev-infrastructure` workflow;
- change GitHub repository variables, environments or reviewers (for example
  `LAI_DEPLOY_ENABLED`, `LAI_DEV_NATIVE_ENABLED`, `LAI_SITE_DEPLOY_ENABLED`,
  `LAI_PROD_AUTO_DEPLOY`);
- migrate, import or delete production data, or touch the Cognito pool or the retained
  Amplify tables and buckets ([CLAUDE.md](../../CLAUDE.md) section 18).

Approval for one deployment is not approval for the next. Approval to write infrastructure code
is not approval to deploy it.

## Environments

| Environment | State | Definition |
|---|---|---|
| Local development | Implemented (main) | Django on port 8010, PostgreSQL on 5442, Vite on 5183, fake AI and speech providers (`make up`, `make runserver`, `make web`) |
| `dev` (AWS) | Implemented in the repository (main); deployment is owner-run | Native ARM64 EC2, private RDS, Lambda and SQS workers, nightly shutdown (ADR-055, ADR-064). See [dev-native-environment.md](../infrastructure/dev-native-environment.md) |
| Staging | Not established | No staging environment, stack or workflow exists on `main`. Creating one is an owner decision (ADR-017) |
| `prod` (AWS) | Designed in the repository (ADR-037); provisioning and every release are owner-approved | Django on EC2 through ECR and SSM, site on S3 and CloudFront, GitHub Environment reviewers. See [DJANGO_EC2_DEPLOYMENT.md](../platform/DJANGO_EC2_DEPLOYMENT.md) |

Repository state is not deployment state. Whether an AWS environment is provisioned or running
is known only from owner-provided evidence, not from the code.

## How merges relate to deployments

The deploy workflows run on a push to `main` for their paths, and also by manual dispatch:

| Workflow | Releases | Gate variable |
|---|---|---|
| `deploy-dev-native.yml` | Django to native `dev` | `LAI_DEV_NATIVE_ENABLED` |
| `deploy-dev-lambda.yml` | `dev` Lambda workers | `LAI_DEV_NATIVE_ENABLED` |
| `deploy-django-ec2.yml` | Django to the ADR-037 instances (prod by dispatch or `LAI_PROD_AUTO_DEPLOY`) | `LAI_DEPLOY_ENABLED` |
| `deploy-site.yml` | React site to S3 and CloudFront | `LAI_SITE_DEPLOY_ENABLED` |
| `manage-dev-infrastructure.yml` | Power and schedule of `dev` (dispatch only) | owner dispatch |

Whether these variables are on is a GitHub setting not visible in the repository. Therefore:

- treat every merge to `main` as a possible `dev` deployment, and say so in the pull request;
- the owner's merge approval covers the automatic `dev` release that the merge triggers, but no
  other release;
- production is released only by the owner or with the owner's approval through the
  `*-prod` GitHub Environments.

## Release candidates

A release candidate is a specific commit of `main` (full SHA) that the owner names for a
release. It has:

- passed the merge-readiness checks in [docs/TESTING_STRATEGY.md](../TESTING_STRATEGY.md);
- completed Owner QA for the tickets it contains ([definition-of-done.md](definition-of-done.md));
- release notes drafted from [templates/release-notes.md](templates/release-notes.md);
- a migration plan and a rollback plan (sections below).

Integration branches and feature branches are never released.

## Deployment approvals

- Each deployment needs explicit owner approval naming the environment and the commit.
- Agents may prepare: release notes, migration plans, rollback plans, `npm run infra:synth*`
  output, and a list of the workflow inputs the owner would use.
- The owner runs, or explicitly authorizes an agent to run, the dispatch. The authorization is
  recorded on the Trello card with date and scope.

## Database migrations

Plan migrations as expand and contract:

1. **Expand:** add tables or nullable columns, backfill, and ship code that works with both the
   old and new schema.
2. **Migrate readers and writers:** release code that uses only the new schema.
3. **Contract:** remove or rename the old column or table in a later, separate release. The
   deploy scripts refuse destructive operations unless dispatched with
   `allow_destructive_migrations` (exit 45), which needs its own owner approval.

Migrations are never reversed by a rollback. Each release that applies migrations names them in
the release notes. See section 4 of [deployment-design.md](../infrastructure/deployment-design.md).

## Infrastructure changes

- Writing or changing CDK code in `infra/` is development work. It is not authorization to
  deploy it.
- Agents may run local synthesis (`npm run infra:synth`, `npm run infra:synth:dev`,
  `npm run infra:synth:prod`) and the infrastructure unit tests. Synthesis must not need live
  AWS credentials; if it would, stop and ask.
- `cdk deploy`, change sets and `scripts/aws/provision.sh` are run by the owner, or with the
  owner's explicit approval, one change set at a time.
- Infrastructure changes are recorded with their stack names and expected cost impact in the
  pull request.

## Asset and content publication

- Staff assets are authored and published in Django Admin only (ADR-045). React consumes
  published assets.
- Content first reaches Django through the export and `manage.py load_content`; after import
  Django is authoritative and an import never silently overwrites administrator edits (ADR-047).
- Publishing to a deployed environment is a release step and needs owner approval like code.
- Adding binary assets to `react/public/models/` triggers backend release paths on `main`; list
  them in the pull request.

## Backward compatibility

- The API is versioned (`/api/v1/`). Do not break a published response shape; add fields or a
  new version ([MANIFEST_AND_API_VERSIONING.md](../platform/MANIFEST_AND_API_VERSIONING.md)).
- Release the backend before the site from the same commit (deployment design section 3).
- A site still open in a browser must keep working against the new backend.
- Removing a model field, endpoint or content key needs a deprecation step first.

## Health checks

A release is healthy only when the platform reports it healthy: Django liveness
(`/api/v1/health/`), readiness (`/api/v1/health/ready/`, no pending migrations) and the expected
release running, as described in the canonical deployment docs. A workflow run that is green but
reports "deployment pending" (stopped `dev`) has not deployed.

## Rollback

- Automatic: an unhealthy release is switched back to the previous healthy release by the
  deploy scripts.
- Manual: the owner (or an agent the owner authorizes) dispatches the workflow's rollback
  action with the target SHA.
- Code on `main` is reverted with `git revert` through a pull request
  ([branch-policy.md](branch-policy.md)).
- A rollback never reverses migrations. If later releases applied migrations, the record asks
  for a manual database review; the owner decides between rolling forward and restoring a
  snapshot.

## Release notes

Every release to an AWS environment has release notes based on
[templates/release-notes.md](templates/release-notes.md): commit SHA, tickets, migrations,
infrastructure changes, assets and content published, known issues, rollback target and
verification results. Notes record only evidence that was actually observed.

## Post-deployment verification

After an approved deployment, the person who ran it records:

- the workflow run link and the deployed SHA;
- health and readiness results;
- the release record status (for example `healthy`, or `manual_db_review_required`);
- the owner's smoke test of the affected flows;
- any follow-up defects as cards ([templates/defect-report.md](templates/defect-report.md)).

Deployment completion is recorded on the Trello card separately from merge completion
([trello-workflow.md](trello-workflow.md)).
