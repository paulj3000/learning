# Deployment design (LAI-INFRA-004)

Date: 2026-11-09. Trello: [LAI-INFRA-004](https://trello.com/c/ehsOJaqJ). Base: `main` at
`3b78951` (LAI-INFRA-003 merged). Inputs: `docs/infrastructure/resource-ownership.md` (section 3.6),
`docs/infrastructure/domains-and-hosting.md`, ADR-037.

**Status: design plus gated code, nothing switched on.** The new site workflow does nothing until
the repository variable `LAI_SITE_DEPLOY_ENABLED` is `'true'`. Until then Amplify Hosting stays the
only frontend publisher, and no second deploy system is active (as the card requires). No AWS
resource was created or changed.

## 1. Decisions

| # | Decision | Source |
|---|---|---|
| P1 | **One system for releases: GitHub Actions with GitHub OIDC.** CodePipeline/CodeBuild (proposed on the DevOps card) is **not** adopted. It would be a second system with its own roles, artifact bucket and GitHub connection, and it would need cross-pipeline coordination to ship backend and frontend from one commit | Owner, 2026-11-09, on this card |
| P2 | This PR delivers the design and gated code. The site job and its OIDC role exist but stay off | Owner, 2026-11-09 |
| P3 | Infrastructure (CDK stacks) is never deployed by a push. `scripts/aws/provision.sh` creates change sets, and the owner applies them | ADR-037, unchanged |

## 2. One owner per component

| Component | Owner | Trigger | Gate | Status |
|---|---|---|---|---|
| Django on EC2 (`LaiDjangoEc2-<env>`) | `.github/workflows/deploy-django-ec2.yml`: test, image to ECR, SSM release | Push to `main` on backend paths; dispatch for prod and rollback | `LAI_DEPLOY_ENABLED` | Exists (ADR-037) |
| React site on CloudFront (`LaiFrontend-<env>`) | **`.github/workflows/deploy-site.yml`** (new): build, S3, invalidate | Push to `main` on frontend paths; dispatch for prod and rollback | **`LAI_SITE_DEPLOY_ENABLED`** (new, off) | This PR |
| Amplify Gen 2 backend (Cognito, AppSync, DynamoDB) | Amplify Hosting, `amplify.yml` (`ampx pipeline-deploy`) | Every build of the connected `main` branch | Amplify console | Unchanged until cutover (section 7) |
| React site on Amplify Hosting | Amplify Hosting, `amplify.yml` frontend phase | Same build | Amplify console | Transitional (section 7) |
| AWS infrastructure (6 CDK stacks) | Operator, `scripts/aws/provision.sh` | Manual | Owner approval of each change set | Unchanged |
| Tests only | `.github/workflows/ci.yml` | Every push and PR | n/a | Unchanged; no AWS role |

## 3. Backend and frontend from the same commit

Both release workflows trigger on the same push to `main`. Each builds from `github.sha` and
nothing else, so a commit's site and API are always the same commit.

- **Order.** If a push changes a path the Django workflow releases (its `paths` list), the site
  job **waits** for that commit's Django run and **stops** if the run did not succeed. The new API
  is live before the new site calls it. A site-only push does not wait.
  - `tests/deploy/test_site_workflow.py` keeps the site's path pattern in step with the Django
    workflow's `paths`.
- **Compatibility in the other direction.** The API is versioned (`/api/v1/`), and destructive
  migrations need their own approved release (section 4). The site that is still running
  therefore keeps working against the new backend while the new site publishes.
- **Newest wins.** Each environment has one concurrency group per workflow (`deploy-django-<env>`,
  `deploy-site-<env>`). The Django release also skips itself when a newer backend commit is
  already on `main`.
- **Prod.** Both workflows reach prod only by manual dispatch, or on a push when
  `LAI_PROD_AUTO_DEPLOY` is `'true'`, behind each GitHub Environment's required reviewers.
  Release the backend to prod before the site (same commit).

## 4. Safe migrations (existing, unchanged)

`scripts/aws/deploy-django.sh`, run through SSM:
1. Preflight: `check --deploy`, `migrate --plan`, and a destructive-operation guard. Removing or
   renaming a column or table is refused unless the dispatch sets `allow_destructive_migrations`,
   as a separate release after the code no longer uses it (expand, then contract).
2. In prod, when migrations are pending, an **RDS snapshot first**
   (`lai-<env>-pre-<sha>-<time>`). If the snapshot fails, nothing is migrated.
3. `migrate` runs **once**, with the new image, before the new containers start.
4. Health check: live, ready (no pending migrations), right image. An unhealthy release rolls
   back to the previous image automatically. **Migrations are never reversed**: the release record
   flags the database for a person to review.

The site pipeline runs no migrations and never touches the database.

## 5. Versioned rollback

| Component | What a release is | Rollback |
|---|---|---|
| Django | An immutable ECR digest (tag = full SHA; tags immutable) plus its compose bundle on the host | `workflow_dispatch` `action=rollback` with an optional SHA: SSM `lai-django-rollback-<env>`, which restarts an earlier healthy image. No database change |
| Site | `assets/*` with content-hashed names (never deleted) plus the HTML shells, also stored as `_releases/<sha>/index.html` (and `game/index.html`) | `deploy-site.yml` dispatch `action=rollback`, `rollback_to=<sha>`: copies that release's shells back and invalidates them. **No rebuild**, about a minute. S3 versioning (30 days for noncurrent versions) is the second net |

Because assets are never deleted, a browser tab opened on the previous release keeps loading its
scripts after a release or a rollback. Pruning old assets is a separate, later, owner-approved
task. The bucket grows by about one build per release.

## 6. S3 caching and invalidation

`scripts/aws/publish-site.sh` (tested in `tests/deploy/test_publish_site.py`):

| Objects | Cache-Control | Upload order |
|---|---|---|
| `assets/*` (Vite, hashed) | `public, max-age=31536000, immutable` | 1st (sync, no delete) |
| Other `react/public` files (`models/`, `fonts/`, icons) | `public, max-age=3600` | 2nd (sync, no delete) |
| `index.html`, `game/index.html` | `no-cache` | **Last**, so no shell names a file not yet uploaded |

- These match the headers Amplify Hosting sends today (`customHttp.yml`).
- CloudFront's `CachingOptimized` policy honours `Cache-Control`.
- Only the shells are invalidated (`/index.html`, plus `/game/index.html` when present). The SPA
  rewrite maps every route to those keys before the cache lookup, so one invalidation covers every
  route. Hashed files never need invalidating.

## 7. Avoiding duplicate pipelines

- **No CodePipeline/CodeBuild** (P1). One system, one OIDC provider, one role per job and
  environment.
- **The site workflow is off** until the owner sets `LAI_SITE_DEPLOY_ENABLED=true`. Its two entry
  jobs check the variable, and the release jobs run only after the gated wait job succeeds
  (tested).
- **Transition (intended, temporary).** Once the site workflow is on, `main` reaches two frontend
  hosts:
  - Amplify Hosting on its own domain;
  - CloudFront on `lai.<domain>`.

  They are different hosts, so neither overwrites the other. DNS for `lai.` decides what users
  get, and nothing switches by accident.
- **After acceptance** (owner decision, later card), one of:
  - (a) keep the Amplify Hosting app only for `ampx pipeline-deploy` of the Gen 2 backend, and
    ignore its frontend artifact;
  - (b) move `ampx pipeline-deploy` into GitHub Actions and disconnect Amplify Hosting.

  (b) puts every release in one system but needs an Amplify deploy role. Until the Django cutover
  retires Amplify Data, the Gen 2 backend still needs one of the two.
- The Django and site workflows never deploy infrastructure. `provision.sh` never deploys code.

## 8. Environment separation

| | dev | prod |
|---|---|---|
| GitHub Environments | `django-dev`, `site-dev` | `django-prod`, `site-prod` (required reviewers) |
| OIDC roles (trust only their own environment) | `lai-github-deploy-dev`, `lai-github-site-deploy-dev` | `lai-github-deploy-prod`, `lai-github-site-deploy-prod` |
| Account-wide (`main` branch only) | `lai-github-image-publisher` (one ECR repository, immutable tags) | same |
| Stacks | `LaiDjangoEc2-dev`, `LaiFrontend-dev` | `LaiDjangoEc2-prod`, `LaiFrontend-prod` (termination protected) |
| Database | RDS Single-AZ, 7-day backups | RDS, 14-day backups, pre-migration snapshots |
| Auto release | Every qualifying push | Only with `LAI_PROD_AUTO_DEPLOY='true'`, otherwise manual |

All environments share the Amplify `main` backend's Cognito pool (inventory U3). That is today's
state, not a new coupling.

### GitHub configuration the site workflow needs (none of it secret)

| Scope | Variable | From |
|---|---|---|
| Repository | `LAI_SITE_DEPLOY_ENABLED` | `'true'` to switch on (owner) |
| Repository | `LAI_AMPLIFY_APP_ID` | `aws amplify list-apps` (inventory U9) |
| `site-<env>` | `LAI_SITE_DEPLOY_ROLE_ARN` | `LaiFrontend-<env>` output `SiteDeployRoleArn` |
| `site-<env>` | `LAI_SITE_BUCKET` | output `WebBucketName` |
| `site-<env>` | `LAI_SITE_DISTRIBUTION_ID` | output `DistributionId` |
| `site-<env>` | `LAI_SITE_URL` | output `SiteUrl` |

## 9. Switching it on (owner, in order)

1. Deploy `LaiFrontend-dev` with `provision.sh` (`LAI_SITE_DOMAIN`, `LAI_AMPLIFY_APP_ID`).
   Change sets first, then `--execute`.
2. Create the `site-dev` GitHub Environment and the variables in section 8. Leave
   `LAI_SITE_DEPLOY_ENABLED` unset.
3. Set `LAI_SITE_DEPLOY_ENABLED=true` and run `deploy-site.yml` by hand for dev.
   - **Unverified:** the exact IAM actions `ampx generate outputs` needs are not confirmed
     (`ReadAmplify*` statements in `infra/lib/frontendStack.ts`). If the run fails with
     AccessDenied, add only the action it names, then re-run.
4. Check the smoke test, then sign-in, play and asset loading on `lai.<domain>` in a browser
   (`domains-and-hosting.md` section 7).
5. Repeat for prod with `site-prod` (required reviewers).

## 10. The changeset

| File | Change |
|---|---|
| `.github/workflows/deploy-site.yml` (new) | Gated jobs: wait for the same commit's Django release, release to dev, release to prod with approval, roll back |
| `.github/actions/site-release/action.yml` (new) | `npm ci`, `ampx generate outputs` for the `main` backend (read-only), build with `VITE_BACKEND=django` and same-origin `/api/`, publish, smoke test |
| `scripts/aws/publish-site.sh` (new) | Publish (ordered, no delete, per-release shells, invalidate) and rollback |
| `infra/lib/frontendStack.ts` | `AmplifyAppId` parameter. Role `lai-github-site-deploy-<env>`: trusts `environment:site-<env>` only; S3 list/get/put on the site bucket (**no delete**); invalidation on its distribution; read-only Amplify `main` backend access. New output `SiteDeployRoleArn` |
| `infra/bin/app.ts`, `scripts/aws/provision.sh` | Pass `githubRepository` and `LAI_AMPLIFY_APP_ID` |
| Tests | `tests/deploy/test_publish_site.py` (8), `tests/deploy/test_site_workflow.py` (4), and a new role test in `infra/lib/frontendStack.test.ts` |
| Docs | This file, `docs/infrastructure/domains-and-hosting.md` section 6, `docs/IMPLEMENTATION_STATUS.md` |

## 11. Open items

- The exact `ampx generate outputs` permissions (section 9, step 3).
- Choosing between options (a) and (b) for the Amplify Gen 2 backend pipeline after acceptance
  (section 7).
- A later pruning task for old site assets.
- Release-SHA visibility. Neither the site nor `/api/v1/health/` reports which commit it runs, so
  the site job cannot check that the backend serving it is the same commit. Section 3's ordering
  covers dev; for prod it relies on releasing the backend first.
