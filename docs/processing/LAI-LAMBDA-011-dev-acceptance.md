# LAI-LAMBDA-011: DEV live acceptance for the canonical processing release

**Status: checklist only. NOT EXECUTED.** Rewritten 2026-11-17 against the Wave 4 integration
head `48c98a1` (`feature/serverless-processing-wave4`: the canonical PR #42 head plus the Wave 4
kinds). Nothing here has been run against AWS or GitHub. Every command is an **owner-run step**:
Claude does not run AWS, CDK, deploy scripts or workflows (`CLAUDE.md` sections 14 and 18). The
owner runs each step, pastes redacted output into section 14, and judges it against the "Pass"
text. The code wins over this page; every script, flag, workflow input and management command
below was read in the repository at `48c98a1`.

Read with: ADR-055, ADR-061, ADR-062 (B7), ADR-064 in `../DECISIONS.md`; `CANONICAL_PATH.md`;
`ASYNC_MODEL_VALIDATION.md`; `NPC_ANIMATION_INSPECTION.md`; `AUDIO_INSPECTION.md`;
`WAVE4_HANDOFF.md`; `../infrastructure/dev-native-environment.md`; the root `README.md`, "AWS
Development Infrastructure".

## Scope: three tiers

| Tier | Cards | Sections | Needed to accept LAI-LAMBDA-011 |
|---|---|---|---|
| **1. Core required acceptance** | LAI-LAMBDA-001 to 007 (contract library, GLB validator, `asset.validate_model` and `reference.checksum` kinds, `LAI_ASSET_ASYNC_VALIDATION`, Admin) | 0 to 4, 6 to 11, 13, 14 | **Yes** |
| **2. Wave 4 inspection acceptance** | LAI-LAMBDA-008 phase 1 (`asset.process_audio`, header inspection), LAI-LAMBDA-009 (`asset.analyze_animation`) | 5 | Only when the release commit contains the Wave 4 kinds (it does at `48c98a1`); a failure here does not undo a Tier 1 pass, it blocks only the Wave 4 kinds |
| **3. Future native-worker acceptance** | LAI-LAMBDA-008b (transcoding and loudness), 010 (GLB optimization), 013a and 013b (image conversion, GLB thumbnails; the split named in the task brief, the feasibility studies are in `feasibility/`) | 12 | **No.** Blocked on owner approvals (ADRs W4-1 to W4-8); listed so it is never confused with this release and never blocks Tier 1 or 2 |

Step markers: **[OWNER, READ-ONLY]** reads state only; **[OWNER, MUTATING]** changes AWS, GitHub
or data and needs the approval named in section 0; **[OWNER, MANUAL]** has no repository script
or workflow: it is a console or shell-session step, and the page says so instead of inventing a
command.

## The dev release sequence at a glance

Detail and pass criteria are in the section named in brackets. Do not skip a step or reorder.

1. Run the release's own checks locally, no AWS [0.2].
2. Verify the deployment gates and close them before merging [1].
3. Owner merges PR #42, then the Wave 4 branch (approval A1); confirm the merge run deployed
   nothing [1.3].
4. Confirm dev is running and hold the nightly stop [0.3].
5. Read-only dev checks: stacks, RDS, queues and DLQs, IAM, Lambda, alarms [2].
6. Record the rollback baseline [3.1].
7. Open **only** `LAI_DEV_NATIVE_ENABLED` [1.4, 3.2].
8. Deploy Django and its migrations (`jobs 0003`, `0004`, `audio 0005`), the consumer [3.2].
9. Verify Django, the flag is off, sound roles, a non-GLB inspect smoke [3.3].
10. Review and apply the approved IAM change (`ListAssetBucket`), which also deploys the worker
    zip, or deploy the zip alone [3.4].
11. Verify the worker and its compatibility with Django [3.5, 3.7].
12. Switch `LAI_ASSET_ASYNC_VALIDATION` on for the acceptance window [3.6].
13. GLB cases: valid, invalid, duplicate, missing object (404 not 403), oversized, retry,
    near-limit memory [4].
14. Wave 4 inspection: NPC animation, audio, failures [5].
15. Restricted DLQ redrive [6]; approved RDS outage drill [7]; overnight stop and start [8].
16. Monitoring and cost records [9, 10].
17. Flag off, release the hold, close the gates, fill the evidence table [13, 14].
18. Rollback only if a step fails [11].

## Conventions used by the commands

Run from the repository root at the release commit, with credentials for the dev account
(`--profile` or `AWS_PROFILE`) and `LAI_DEV_ACCOUNT_ID` set in `.lai-dev.env` (the scripts then
refuse any other account; `scripts/aws/lib-dev.sh`, which also refuses any name containing
`prod`).

```bash
# [OWNER, READ-ONLY] shell setup used by every later block
export AWS_REGION=us-west-1 AWS_PAGER=""
REPO=paulj3000/learning
STACK=LaiDevPlatform-dev
out() { aws cloudformation describe-stacks --stack-name "$STACK" \
          --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
ARTIFACTS=$(out ArtifactBucketName); ASSETS=$(out AssetBucketName)
AI_Q=$(out LambdaProcessingQueueUrl); MEDIA_Q=$(out LambdaMediaQueueUrl); RESULTS_Q=$(out LambdaResultsQueueUrl)
qurl() { aws sqs get-queue-url --queue-name "$1" --query QueueUrl --output text; }
qarn() { aws sqs get-queue-attributes --queue-url "$(qurl "$1")" --attribute-names QueueArn \
           --query Attributes.QueueArn --output text; }
depth() { aws sqs get-queue-attributes --queue-url "$(qurl "$1")" --attribute-names \
            ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible --output json; }
redact() { sed -E 's/[0-9]{12}/<account>/g'; }   # pipe every pasted output through this
```

The repository has **no script or SSM document that runs an arbitrary `manage.py` command** on
the dev instance. The allowlisted SSM document `lai-dev-native-bootstrap`
(`scripts/aws/native/bootstrap-native.sh`: `check`, `migrate`, `ensure-roles`, `load-content`,
`seed-content`, `publish-seed-content`, `import-assets`) and the read-only
`lai-dev-native-status` are the only ones. Every `lai_manage ...` line below is therefore an
**[OWNER, MANUAL]** step in an SSM shell (`./scripts/aws/manage-dev.sh connect`; it needs the
Session Manager plugin and a running environment, exit 7 otherwise), using exactly the
environment the systemd units use (`deploy/native/systemd/lai-jobs-consumer.service`):

```bash
# [OWNER, MANUAL] define once per SSM session on the instance; use --pty instead of --pipe for an interactive shell
lai_manage() {
  sudo systemd-run --quiet --wait --pipe --collect --uid=lai --gid=lai \
    -p EnvironmentFile=/opt/lai/runtime/django.env -p EnvironmentFile=/opt/lai/current/release.env \
    --setenv=DJANGO_SETTINGS_MODULE=config.settings.production \
    --setenv=DJANGO_TRUST_PROXY_SSL_HEADER=true \
    --working-directory=/opt/lai/current/lai \
    /opt/lai/current/venv/bin/python manage.py "$@"
}
# job rows for one subject (asset version uuid); prints ids and codes only
jobs_for() { lai_manage shell -c "from apps.jobs.models import ProcessingJob as J
for j in J.objects.filter(subject_id='$1').order_by('created_at'):
    print(j.pk, j.kind, j.status, j.error_code or '-', j.subject_outcome or '-', j.attempts, j.deliveries)"; }
version() { lai_manage shell -c "from apps.assets.models import AssetVersion as V
v = V.objects.get(version_id='$1'); print(v.status, v.storage_key, v.size_bytes)"; }
```

Django Admin (Jobs, Processing jobs) shows the same job rows without a shell; prefer it when it
is enough.

Never use `aws sqs receive-message` on any `lai-dev-*` queue during acceptance: a receive by
anyone counts toward the queue's `maxReceiveCount` and can push a valid message into its DLQ.
Use queue attributes and CloudWatch metrics instead.

---

## 0. Prerequisites and approvals

### 0.1 Approvals (each is a separate owner decision)

| # | Approval | Needed for |
|---|---|---|
| A1 | Review and merge of PR #42 (`feature/serverless-processing-canonical`, draft, CI green on `4ca7363`) and then `feature/serverless-processing-wave4` into `main` | Everything |
| A2 | Deploy the Django release to dev (`deploy-dev-native.yml` or `dev-release.sh deploy`) | Section 3 |
| A3 | `LaiDevPlatform-dev` stack update: media worker `s3:ListBucket` on the asset bucket (also deploys the worker code, section 3.4) | Sections 3, 4.5 |
| A4 | Deploy the worker zip (`deploy-dev-lambda.yml` or `dev-release.sh lambda-deploy`) | Section 3 |
| A5 | Switch `LAI_ASSET_ASYNC_VALIDATION=on` in dev for the acceptance window | Section 4 |
| A6 | Temporarily disable and re-enable the media worker's SQS event source mapping (CloudFormation drift until re-enabled) | Sections 4.5, 7, 8 |
| A7 | Stop the dev database outside the schedule (RDS outage drill) | Section 7 |
| A8 | Name the authorized operations administrator(s) for DLQ redrive (ADR-062 B7) | Section 6 |
| A9 | Synthetic test assets only; no child data, photos or audio in any job | Sections 4, 5 |
| A10 | Each rollback in section 11 if it is exercised | Section 11 |
| A11 | Opening and closing the repository variables of section 1 | Sections 1, 3 |

### 0.2 Release content to confirm before starting (repository, no AWS)

At `48c98a1` every item below is on the branch (the three that were pending on sibling branches
at `2333d9e` have merged). Confirm on the commit actually being released:

| Item | Check on the release commit | Expected |
|---|---|---|
| Jobs migrations | `ls lai/apps/jobs/migrations/` | `0003_contract_kinds.py` and `0004_wave4_inspection_kinds.py`; `ls lai/apps/audio/migrations/` includes `0005_audio_file_proxy.py` |
| Contract kinds | `git grep -n "asset.validate_model\|reference.checksum\|asset.analyze_animation\|asset.process_audio" lai/apps/jobs/core/envelope.py` | All four in `KIND_QUEUE`, queue `media` |
| Flag | `git grep -n "LAI_ASSET_ASYNC_VALIDATION" lai/config/settings/base.py lai/config/settings/production.py` | Default `off`; production requires `LAI_JOBS_BACKEND=sqs` |
| Media role `s3:ListBucket` | `git grep -n "ListAssetBucket" infra/lib/devPlatformStack.ts` | A statement on the asset bucket ARN for the media role only |
| GLB limit | `git grep -n "LAI_ASSET_MAX_GLB_BYTES" lai/config/settings/base.py` | Default 52,428,800 (50 MiB), ceiling 52,428,800 |
| Validation retention and retries | `git grep -n "LAI_ASSET_VALIDATION_JOB_RETENTION_DAYS\|LAI_ASSET_VALIDATION_MAX_ATTEMPTS" lai/config/settings/base.py` | 90 days and 5 attempts |
| `processing/lai_processing` in the triggers | `git grep -n "processing/lai_processing" .github/workflows` | The four deploy workflows' path filters, and the file detection in `deploy-site.yml` |

```bash
# [OWNER, local, no AWS] the release's own tests and synthesis
make py-install
.venv/bin/python -m pytest -q tests/processing tests/lambda tests/repo/test_canonical_processing_guard.py \
  lai/apps/jobs/tests lai/apps/assets/tests lai/apps/npcs/tests/test_animation_inspection.py \
  lai/apps/audio/tests/test_audio_inspection.py
npm ci && npm run infra:synth:dev
scripts/aws/package-lambda.sh            # prints build/lambda/jobs-worker-<hash16>.zip; record the name
scripts/processing/local-demo.sh         # optional end-to-end run, in-memory SQS and S3 (needs `make up`)
```

Pass: tests green; synthesis succeeds; the worker zip is under the 2 MiB budget (about 350 KB
plus the Wave 4 modules); record its name, it is the key the release deploys
(`lambda/jobs-worker-<hash16>.zip`, content addressed by `lambda/build.py`).

### 0.3 Environment preconditions

| Check | Command | Pass |
|---|---|---|
| Dev provisioned (README "Complete first-time deployment") | `./scripts/aws/deploy-debug.sh --status` **[OWNER, READ-ONLY]** | All six dev stacks complete |
| Dev running | `./scripts/aws/manage-dev.sh status` **[OWNER, READ-ONLY]** | EC2 running, RDS available, power `running`, readiness 200 |
| No surprise stop during acceptance | `./scripts/aws/manage-dev.sh hold --hours 12` **[OWNER, MUTATING]** | `hold-until` in the future (release it in section 13) |
| Avoid the daily windows | none | Do not run section 7 or 8 near 20:00 UTC (the maintenance timer runs `jobs_sweep`; the RDS backup window is 20:00 to 20:30 UTC) |

---

## 1. Deployment gate verification

Do this **before** the merge (A1), so the merge itself deploys nothing, and again before each
manual dispatch.

### 1.1 Evidence from `main` (2026-11-17, `466a4972`)

Every deploy job was **skipped** on the latest `main` runs:

| Run | Workflow | Result |
|---|---|---|
| 44130009375 | Deploy Django (EC2) | `build`, `deploy-dev`, `deploy-prod` skipped (the AWS-free `test` job ran) |
| 44123030643 | Deploy DEV backend (native) | every job skipped |
| 44004676895 | Deploy DEV Lambda workers | skipped |

Reading, from the `if:` conditions in 1.2:

- `build` skipped means `vars.LAI_DEPLOY_ENABLED == 'true'` was false at job start (or, for a
  dispatch, the other clauses failed).
- The native and Lambda workflows skipped at `test` means `vars.LAI_DEV_NATIVE_ENABLED ==
  'true'` was false.
- `deploy-site.yml` is gated the same way by `vars.LAI_SITE_DEPLOY_ENABLED`.

So the three repository variables `LAI_DEV_NATIVE_ENABLED`, `LAI_DEPLOY_ENABLED` and
`LAI_SITE_DEPLOY_ENABLED` did **not evaluate to the string `true`**. That is the safe state for
a merge, and it is also what the previous version of this page told the owner to set, so a
skipped run is expected, not a defect. But it has a trap: a `workflow_dispatch` against closed
gates ends **green with every job skipped**, which looks like a successful deploy and is not.
After every dispatch, read the job list (`gh run view <id> --json jobs`), not the run color.

Possible reasons a variable does not evaluate to `true` (check each, section 1.4):
unset; set to `false` (by the owner, by the earlier page, or never set by
`scripts/aws/install-debug.sh`, which sets `LAI_DEV_NATIVE_ENABLED=true` only when its GitHub step
runs, not with `--skip-github`); a misspelling or stray space (`true ` is not `true`; GitHub
compares strings case-insensitively but not after trimming); defined **only on an environment**,
which a job-level `if:` cannot see; defined on an organization that does not share it with this
repository (the repository `paulj3000/learning` is user-owned, so organization variables only
matter if it was transferred; `gh api repos/paulj3000/learning --jq .owner.type` says which).

### 1.2 The gates, quoted from the workflows at `48c98a1`

| Workflow (push to `main` paths include) | Job | `if:` condition (quoted) | Runs on merge when |
|---|---|---|---|
| `deploy-dev-native.yml` (`lai/**`, `processing/lai_processing/**`, `scripts/aws/native/**`, ...) | `test` | `vars.LAI_DEV_NATIVE_ENABLED == 'true' && github.ref == 'refs/heads/main' && (github.event_name == 'push' \|\| inputs.action == 'deploy')` | `LAI_DEV_NATIVE_ENABLED` is `true` |
| | `package` | none; `needs: test` | `test` succeeded |
| | `start` | `always() && vars.LAI_DEV_NATIVE_ENABLED == 'true' && github.ref == 'refs/heads/main' && (needs.package.result == 'success' \|\| (...deploy-pending)) && ((github.event_name == 'workflow_dispatch' && inputs.start_if_stopped) \|\| vars.LAI_DEV_STOPPED_DEPLOY == 'start')` | native enabled **and** `LAI_DEV_STOPPED_DEPLOY` is `start` (starts dev from a push) |
| | `deploy` | `always() && needs.package.result == 'success' && (needs.start.result == 'success' \|\| needs.start.result == 'skipped')` | `package` succeeded |
| | `deploy-pending`, `rollback` | `vars.LAI_DEV_NATIVE_ENABLED == 'true' && github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch' && inputs.action == ...` | never on a push |
| `deploy-dev-lambda.yml` (`lambda/**`, `lai/apps/jobs/core/**`, `processing/lai_processing/**`, ...) | `test` | `vars.LAI_DEV_NATIVE_ENABLED == 'true' && github.ref == 'refs/heads/main'` | `LAI_DEV_NATIVE_ENABLED` is `true` |
| | `deploy` | none; `needs: test` | `test` succeeded |
| `deploy-django-ec2.yml` (`lai/**`, `processing/lai_processing/**`, `scripts/aws/**`, ...) | `test` | `github.event_name == 'push' \|\| inputs.action == 'deploy'` | always (tests only, no AWS, no environment) |
| | `build` | `vars.LAI_DEPLOY_ENABLED == 'true' && github.ref == 'refs/heads/main' && (vars.LAI_DEV_NATIVE_ENABLED != 'true' \|\| (github.event_name == 'workflow_dispatch' && inputs.environment == 'prod'))` | `LAI_DEPLOY_ENABLED` is `true` and native dev is **not** enabled |
| | `deploy-dev` | `vars.LAI_DEV_NATIVE_ENABLED != 'true' && (github.event_name == 'push' \|\| (inputs.environment == 'dev' && inputs.action == 'deploy'))`; `needs: build` | `build` succeeded; environment `django-dev` |
| | `deploy-prod` | `always() && needs.build.result == 'success' && ((workflow_dispatch && inputs.environment == 'prod' && inputs.action == 'deploy') \|\| (push && vars.LAI_PROD_AUTO_DEPLOY == 'true' && needs.deploy-dev.result == 'success'))` | build and Docker dev deploy succeeded and `LAI_PROD_AUTO_DEPLOY` is `true`; then waits for the `django-prod` reviewers |
| | `rollback` | `github.event_name == 'workflow_dispatch' && inputs.action == 'rollback' && !(inputs.environment == 'dev' && vars.LAI_DEV_NATIVE_ENABLED == 'true')` | never on a push (**not** gated by `LAI_DEPLOY_ENABLED`; environment `django-<input>`) |
| `deploy-site.yml` (`react/**`, ..., `.github/workflows/deploy-site.yml`; this branch changes that file) | `backend` | `vars.LAI_SITE_DEPLOY_ENABLED == 'true' && github.ref == 'refs/heads/main' && (github.event_name == 'push' \|\| inputs.action == 'deploy')` | `LAI_SITE_DEPLOY_ENABLED` is `true` |
| | `deploy-dev` | `github.event_name == 'push' \|\| inputs.environment == 'dev'`; `needs: backend` | `backend` succeeded; environment `site-dev` |
| | `deploy-prod` | `always() && needs.backend.result == 'success' && (dispatch prod \|\| (push && vars.LAI_PROD_AUTO_DEPLOY == 'true' && needs.deploy-dev.result == 'success'))` | site enabled, dev site succeeded, `LAI_PROD_AUTO_DEPLOY` is `true`; environment `site-prod` |
| `manage-dev-infrastructure.yml` | `manage` | `workflow_dispatch` only | never on a push |
| `ci.yml` | all | no AWS | always (safe) |

The merge touches `lai/`, `lambda/`, `processing/`, `scripts/aws/` and four workflow files, so
**all four deploy workflows trigger** on the merge push and the variables decide what they do.

Facts that matter when reading the gates:

- **A job's `if:` is evaluated before the job enters its GitHub Environment**, so it sees only
  **repository-level** variables (and organization variables, if the repository had an
  organization). An **environment-scoped** variable with the same name gates nothing, and the
  `vars.` values the steps use after entering an environment (`LAI_DEPLOY_ROLE_ARN`,
  `LAI_API_BASE_URL`, `LAI_DEV_BACKEND_ROLE_ARN`) can be environment-level. Check for a stray
  environment copy of a gate variable and delete it to avoid confusion.
- GitHub compares strings in expressions **case-insensitively**: `True` counts as `true`. Use
  `false` or delete the variable to close a gate.
- A push that merged while a gate was closed is **not re-run** by opening the gate afterwards.
  Opening a gate affects only later pushes and dispatches.
- A dispatch deploys the head of `main` at that moment (`github.sha`), not "my" commit: if
  another commit lands first, that one is released. A dispatch from another ref skips every job
  (`github.ref == 'refs/heads/main'`).
- The dispatches in section 3 need `LAI_DEV_NATIVE_ENABLED=true` too. While it is `true`, any
  push to `main` touching their paths also deploys, and a push that touches both path sets starts
  the native and Lambda workflows at the same time (the Lambda one usually finishes first), which
  is **not** consumer first. Keep the window short and push nothing else (section 3.7).
- `scripts/aws/install-debug.sh` (step 4, unless `--skip-github`) sets
  `LAI_DEV_NATIVE_ENABLED=true`. Re-running it re-opens the gate.

### 1.3 Values that make a merge to `main` safe (nothing deploys)

| Variable (repository level) | Safe value at merge | Why (from the conditions above) |
|---|---|---|
| `LAI_DEV_NATIVE_ENABLED` | unset or `false` | Skips `deploy-dev-native.yml` `test`, so `package`, `start` and `deploy` are skipped; skips `deploy-dev-lambda.yml` `test`, so `deploy` is skipped |
| `LAI_DEPLOY_ENABLED` | unset or `false` | Skips `deploy-django-ec2.yml` `build`, so `deploy-dev` and `deploy-prod` are skipped (only the AWS-free `test` job runs) |
| `LAI_SITE_DEPLOY_ENABLED` | unset or `false` | Skips `deploy-site.yml` `backend`, so `deploy-dev` and `deploy-prod` are skipped. Needed for this merge because `deploy-site.yml` itself changed |
| `LAI_PROD_AUTO_DEPLOY` | unset or `false` | Belt and braces: no push path to `django-prod` or `site-prod` |
| `LAI_DEV_STOPPED_DEPLOY` | unset or `defer` | With native enabled, `start` would start dev from a push; irrelevant while native is off |

Result with these values: on the merge push only `ci.yml` and the AWS-free `test` job of
`deploy-django-ec2.yml` run; every other job shows "skipped". Verify after the merge:

```bash
# [OWNER, READ-ONLY]
gh run list --repo "$REPO" --commit <merge sha> --json databaseId,workflowName,conclusion,status
gh run view <run id> --repo "$REPO" --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'
```

Pass: no job that assumes an AWS role concluded `success` or `failure`; they are all `skipped`.
The current state on `main` (everything skipped) already satisfies this, so **no variable needs
to change before the merge**; step 1.4 only confirms it.

### 1.4 Exact owner checks

GUI: repository **Settings > Secrets and variables > Actions > Variables**, tab "Repository
variables" (the only values the gates read). Confirm each of `LAI_DEV_NATIVE_ENABLED`,
`LAI_DEPLOY_ENABLED`, `LAI_SITE_DEPLOY_ENABLED`, `LAI_PROD_AUTO_DEPLOY`, `LAI_DEV_STOPPED_DEPLOY`
is absent or `false`/`defer`, with no space around the value. Then **Settings > Environments**,
for each environment:

| Environment | Used by | Check |
|---|---|---|
| `dev-backend` | `deploy-dev-native.yml` (`deploy`, `deploy-pending`, `rollback`), `deploy-dev-lambda.yml` (`deploy`) | Deployment branches `main`; environment variables: none of the gate names |
| `dev-infrastructure` | `deploy-dev-native.yml` (`start`), `manage-dev-infrastructure.yml` | Deployment branches `main`; no gate names |
| `django-dev` | `deploy-django-ec2.yml` (`deploy-dev`) | `main` only; variables `LAI_DEPLOY_ROLE_ARN`, `LAI_API_BASE_URL` only |
| `django-prod` | `deploy-django-ec2.yml` (`deploy-prod`, prod `rollback`) | **Required reviewers set** (the owner; "prevent self-review" off for a solo owner), deployment branches `main`; variables `LAI_DEPLOY_ROLE_ARN`, `LAI_API_BASE_URL` only; **no** gate variable |
| `site-dev` | `deploy-site.yml` (`deploy-dev`) | `main` only |
| `site-prod` | `deploy-site.yml` (`deploy-prod`, prod `rollback`) | **Required reviewers set**, `main` only; no gate variable |

`processing-dev` and `processing-prod` were superseded by ADR-064 and must not exist; the guard
test `tests/repo/test_canonical_processing_guard.py` fails if the code names them.

```bash
# [OWNER, READ-ONLY] repository variables (names and values; none of them is secret)
gh variable list --repo "$REPO"
gh api "repos/$REPO" --jq .owner.type                    # User: no organization variables
# [OWNER, READ-ONLY] environments, protection and reviewers
gh api "repos/$REPO/environments" --jq '.environments[] | {name, protection_rules: [.protection_rules[]? | {type, reviewers: [.reviewers[]?.type]}], deployment_branch_policy}'
# [OWNER, READ-ONLY] variables of each environment the workflows use (a gate name here is a mistake)
for env in dev-backend dev-infrastructure django-dev django-prod site-dev site-prod; do
  echo "== $env"; gh api "repos/$REPO/environments/$env/variables" --jq '.variables[] | "\(.name)=\(.value)"' || echo "(environment missing)"
done
# [OWNER, READ-ONLY] recent runs and what each job did
gh run list --repo "$REPO" --branch main --limit 10 --json databaseId,workflowName,conclusion,event
gh run view 44130009375 --repo "$REPO" --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'
```

### 1.5 Opening and closing a gate for this release (A11) [OWNER, MUTATING]

```bash
# before 3.2: the ONLY gate this release opens (dev native backend and the dev Lambda workers)
gh variable set LAI_DEV_NATIVE_ENABLED --repo "$REPO" --body true
# after 3.5, and again in section 13: close it
gh variable set LAI_DEV_NATIVE_ENABLED --repo "$REPO" --body false
# the others stay closed for this release
gh variable set LAI_DEPLOY_ENABLED --repo "$REPO" --body false
gh variable set LAI_SITE_DEPLOY_ENABLED --repo "$REPO" --body false
gh variable set LAI_PROD_AUTO_DEPLOY --repo "$REPO" --body false
```

`LAI_DEPLOY_ENABLED` stays closed because dev is released by the native workflow, and with native
enabled the Docker `build` only runs for a manual prod dispatch (not part of this release;
LAI-LAMBDA-012).

---

## 2. Verify the dev infrastructure (before the release)

All **[OWNER, READ-ONLY]**. Expected values come from `infra/lib/devPlatformStack.ts`
(`DEV_QUEUES`, `DEV_FUNCTIONS`, the `queue()` and `worker()` helpers) at `48c98a1`.

### 2.1 Identity, stacks, outputs

```bash
aws sts get-caller-identity --query Arn --output text | redact
./scripts/aws/deploy-debug.sh --status
./scripts/aws/deploy-debug.sh --outputs | redact
./scripts/aws/show-endpoints.sh
aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Parameters[?ParameterKey=='EnableLambdaProcessing' || ParameterKey=='WorkerCodeKey' || ParameterKey=='LambdaConcurrencyLimit' || ParameterKey=='LambdaMemorySize']" --output table
```

Pass: every stack `CREATE_COMPLETE` or `UPDATE_COMPLETE`; outputs include
`LambdaProcessingQueueUrl`, `LambdaMediaQueueUrl`, `LambdaResultsQueueUrl`,
`AiWorkerFunctionName=lai-dev-jobs-ai`, `MediaWorkerFunctionName=lai-dev-jobs-media`,
`ArtifactBucketName`, `AssetBucketName`; `EnableLambdaProcessing=true`; record `WorkerCodeKey`.

### 2.2 Queues, DLQs and redrive policies

```bash
for q in lai-dev-jobs-ai lai-dev-jobs-media lai-dev-job-results; do
  for name in "$q" "$q-dlq"; do
    echo "== $name"
    aws sqs get-queue-attributes --queue-url "$(qurl "$name")" --attribute-names \
      VisibilityTimeout MessageRetentionPeriod RedrivePolicy SqsManagedSseEnabled \
      ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible --output json | redact
  done
done
aws sqs get-queue-attributes --queue-url "$RESULTS_Q" --attribute-names Policy --query Attributes.Policy --output text | redact
```

| Queue | VisibilityTimeout | MessageRetentionPeriod | RedrivePolicy | Depth |
|---|---|---|---|---|
| `lai-dev-jobs-ai` | 1800 (6 x 300 s) | 345600 (4 days) | `lai-dev-jobs-ai-dlq`, `maxReceiveCount` 3 | 0 |
| `lai-dev-jobs-media` | 720 (6 x 120 s) | 345600 | `lai-dev-jobs-media-dlq`, 3 | 0 |
| `lai-dev-job-results` | 300 | 1209600 (14 days) | `lai-dev-job-results-dlq`, 5 | 0 |
| each `-dlq` | default | 1209600 | none | 0 |

Pass: values as above; `SqsManagedSseEnabled` true; each queue policy denies
`aws:SecureTransport=false`.

### 2.3 Worker IAM, including `s3:ListBucket`

```bash
for role in lai-dev-jobs-ai-worker lai-dev-jobs-media-worker; do
  echo "== $role"; aws iam list-attached-role-policies --role-name "$role" --output json
  for p in $(aws iam list-role-policies --role-name "$role" --query PolicyNames --output text); do
    aws iam get-role-policy --role-name "$role" --policy-name "$p" --query PolicyDocument --output json | redact
  done
done
ACCOUNT_ARN_PREFIX=$(aws sts get-caller-identity --query Account --output text)   # do not paste
MEDIA_ROLE="arn:aws:iam::${ACCOUNT_ARN_PREFIX}:role/lai-dev-jobs-media-worker"
aws iam simulate-principal-policy --policy-source-arn "$MEDIA_ROLE" \
  --action-names s3:ListBucket --resource-arns "arn:aws:s3:::$ASSETS" \
  --query 'EvaluationResults[].{Action:EvalActionName,Decision:EvalDecision}' --output table
aws iam simulate-principal-policy --policy-source-arn "$MEDIA_ROLE" \
  --action-names s3:PutObject s3:DeleteObject --resource-arns "arn:aws:s3:::$ASSETS/assets/models/x.glb" \
  --query 'EvaluationResults[].{Action:EvalActionName,Decision:EvalDecision}' --output table
```

Pass:
- Each role: its own work queue (receive, delete, change visibility, attributes), `sqs:SendMessage`
  on `lai-dev-job-results` only, `s3:GetObject`/`s3:PutObject` on
  `<artifacts>/jobs/results/*` only, logs on its own `/aws/lambda/<function>` group.
- Media role: `s3:GetObject` on `<asset bucket>/*` (read only), Polly, speech prefix.
- **After the section 3.4 update:** `s3:ListBucket` on the asset bucket is `allowed`
  (statement `ListAssetBucket`, with `StringLikeIfExists` on `s3:prefix` = `assets/*`; the
  simulator may report `allowed` or `implicitDeny` for a condition it cannot evaluate without a
  prefix, so the functional proof is case G4). Before the update, `implicitDeny`: that is the
  known gap (`CANONICAL_PATH.md`, "Asset read errors"). `PutObject` and `DeleteObject` on the
  asset bucket stay `implicitDeny`.
- The functional proof that a missing object now answers 404 and fails as `input_missing`
  (not 403, retried into the DLQ) is case G4 in section 4.5.

### 2.4 Lambda configuration and concurrency

```bash
for fn in lai-dev-jobs-ai lai-dev-jobs-media; do
  aws lambda get-function-configuration --function-name "$fn" --query \
    '{Runtime:Runtime,Arch:Architectures,Handler:Handler,Timeout:Timeout,Memory:MemorySize,Vpc:VpcConfig,CodeSha256:CodeSha256,LastUpdate:LastUpdateStatus,EnvKeys:keys(Environment.Variables)}' --output json
  aws lambda get-function-concurrency --function-name "$fn" --output json
  aws lambda list-event-source-mappings --function-name "$fn" --query \
    'EventSourceMappings[].{UUID:UUID,State:State,Batch:BatchSize,Max:ScalingConfig.MaximumConcurrency,Resp:FunctionResponseTypes}' --output table
done
```

| Field | `lai-dev-jobs-ai` | `lai-dev-jobs-media` |
|---|---|---|
| Runtime, architecture, handler | `python3.12`, `arm64`, `jobs_worker.handler.handle` | same |
| Timeout | 300 | 120 |
| Memory | `LambdaMemorySize` (512) | same |
| VpcConfig | empty (no subnets, no security groups) | empty |
| Environment keys | `LAI_ENV`, `LAI_WORKER_QUEUE`, `LAI_RESULTS_QUEUE_URL`, `LAI_RESULTS_BUCKET`, `LAI_SPEECH_BUCKET`, `LAI_ASSET_BUCKET`, `LAI_SSM_PREFIX`; no database or secret names | same |
| Reserved concurrency | **none set** (empty response): dev does not use reserved concurrency | none |
| Event source mapping | `Enabled`, batch 1, `ReportBatchItemFailures`, `MaximumConcurrency` = `LambdaConcurrencyLimit` (2) | same |

Note for production (LAI-LAMBDA-012): the "reserved concurrency 5" of ADR-062 is not implemented
anywhere; dev limits concurrency with the event source mapping's `MaximumConcurrency`.

### 2.5 RDS reachable privately from EC2 only

```bash
aws rds describe-db-instances --db-instance-identifier lai-dev --query \
  'DBInstances[0].{Status:DBInstanceStatus,Class:DBInstanceClass,Engine:EngineVersion,Public:PubliclyAccessible,MultiAZ:MultiAZ,Encrypted:StorageEncrypted,SGs:VpcSecurityGroups[].VpcSecurityGroupId,Subnets:DBSubnetGroup.Subnets[].SubnetIdentifier}' --output json
aws ec2 describe-security-groups --group-ids <db sg id from above> --query 'SecurityGroups[0].IpPermissions' --output json
aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=<each db subnet id> \
  --query 'RouteTables[].Routes[].{Dest:DestinationCidrBlock,Gw:GatewayId,Nat:NatGatewayId}' --output table
./scripts/aws/dev-release.sh status        # runs the read-only lai-dev-native-status document; includes the database check
```

Pass: `Public=false`, `MultiAZ=false`, `Encrypted=true`, class `db.t4g.micro`, engine 16.x; the
DB security group has exactly one ingress rule, TCP 5432 from the instance security group, and no
CIDR; the isolated subnets' route tables have only the `local` route (no internet or NAT
gateway); the status document reports the database reachable from the instance.

### 2.6 Lambda has no VPC and no database access

```bash
DB_SECRET_ARN=$(out DatabaseSecretArn)
for role in lai-dev-jobs-ai-worker lai-dev-jobs-media-worker; do
  aws iam simulate-principal-policy --policy-source-arn "arn:aws:iam::${ACCOUNT_ARN_PREFIX}:role/$role" \
    --action-names secretsmanager:GetSecretValue rds-db:connect rds:DescribeDBInstances ec2:CreateNetworkInterface \
    --resource-arns "$DB_SECRET_ARN" \
    --query 'EvaluationResults[].{Action:EvalActionName,Decision:EvalDecision}' --output table
done
```

Pass: `VpcConfig` empty (2.4); every action above `implicitDeny`; no `DATABASE_URL` or secret in the
function environment (2.4 lists keys only).

### 2.7 Alarms and the power schedule

```bash
aws cloudwatch describe-alarms --alarm-name-prefix lai-dev- \
  --query 'MetricAlarms[].{Name:AlarmName,State:StateValue,Actions:length(AlarmActions)}' --output table
aws sns list-subscriptions-by-topic --topic-arn "$(aws sns list-topics --query "Topics[?ends_with(TopicArn,':lai-django-alarms-dev')].TopicArn" --output text)" \
  --query 'Subscriptions[].{Protocol:Protocol,Pending:SubscriptionArn}' --output table
./scripts/aws/manage-dev.sh status
```

Pass: `lai-dev-ai-dead-letters`, `lai-dev-media-dead-letters`, `lai-dev-results-dead-letters`,
`lai-dev-memory-high`, `lai-dev-disk-high`, `lai-dev-database-storage-low` exist, each with one
action, in `OK` (or `INSUFFICIENT_DATA` right after creation); the e-mail subscription is
confirmed (not `PendingConfirmation`) if `AlarmEmail` was set; schedules enabled.

---

## 3. Release order (core)

**Consumer first** (ADR-064, `WAVE4_HANDOFF.md` section 3). Django (migrations `jobs/0003` and
`0004`, `audio/0005`, the new kinds and handlers, `jobs_consume_results`) is deployed and
verified **before** the worker zip. The flag stays **off**, and nobody uses "Validate in
background", "Inspect animations in background" or "Inspect audio in background", until both are
verified. Why: Django is the only sender of the new kinds, and a contract-kind message reaching
an old worker is an unknown kind (retried into the media DLQ, its job later times out).

Automatic pushes do not enforce this order (section 1.2). For this release use the manual
sequence below, with `LAI_DEV_NATIVE_ENABLED` as the only open gate and no other push to `main`.

### 3.1 Baseline (record before changing anything) [OWNER, READ-ONLY]

```bash
./scripts/aws/dev-release.sh status                       # running release sha, pending, power state
aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Parameters[?ParameterKey=='WorkerCodeKey'].ParameterValue" --output text
for fn in lai-dev-jobs-ai lai-dev-jobs-media; do aws lambda get-function --function-name "$fn" --query 'Configuration.CodeSha256' --output text; done
aws s3api list-objects-v2 --bucket "$ARTIFACTS" --prefix lambda/ --query 'Contents[].{Key:Key,Modified:LastModified}' --output table
# [OWNER, MANUAL] on the instance (SSM shell):
lai_manage showmigrations jobs audio
lai_manage shell -c "from django.conf import settings as s; print(s.LAI_JOBS_BACKEND, s.LAI_ASSET_ASYNC_VALIDATION, s.LAI_STUDIO_RUN_MODE)"
```

Record: previous Django sha (rollback target), previous `WorkerCodeKey` and both `CodeSha256`
values (worker rollback target; `lambda/` objects are kept 180 days by `LaiDevArtifacts-dev`),
the applied migrations (`main` has `jobs` up to `0002_outbox_dispatch` and `audio` up to
`0004_spatial_audio_settings`), and `sqs off jobs` (flag `off`).

### 3.2 Deploy Django (consumer) [OWNER, MUTATING, A2]

Option A, GitHub (recommended; the release is tested, packaged for aarch64 and recorded):

```bash
gh variable set LAI_DEV_NATIVE_ENABLED --repo "$REPO" --body true   # opens the gate; no other push to main until 3.5
gh workflow run deploy-dev-native.yml --repo "$REPO" --ref main -f action=deploy
gh run watch --repo "$REPO" "$(gh run list --repo "$REPO" --workflow deploy-dev-native.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run view <run id> --repo "$REPO" --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'   # test, package, deploy = success; start = skipped
```

Dispatch inputs (`deploy-dev-native.yml`): `action` (`deploy`, `rollback`, `deploy-pending`),
`start_if_stopped`, `rollback_to`, `allow_older`, `allow_destructive_migrations`. Leave the
last two `false`.

Option B, workstation (`scripts/aws/dev-release.sh`, same steps as the workflow):

```bash
SHA=$(git rev-parse HEAD); EPOCH=$(git log -1 --format=%ct HEAD)
./scripts/aws/dev-release.sh package --git-sha "$SHA" --commit-epoch "$EPOCH"
./scripts/aws/dev-release.sh upload --git-sha "$SHA"
./scripts/aws/dev-release.sh deploy --git-sha "$SHA"
```

If dev is stopped, `deploy` records the release as pending and exits 0 ("deployment pending"):
start dev first (`./scripts/aws/manage-dev.sh start`) or apply it later with
`./scripts/aws/manage-dev.sh deploy-pending`.

Migrations `jobs/0003` (two new columns with a database default of `''`, constraint replaced),
`jobs/0004` (kind choices and the `jobs_kind_valid` check constraint) and `audio/0005`
(`AudioFile` proxy model) are not destructive for the guard in
`scripts/aws/native/deploy-native.sh`, which matches only "Remove field", "Delete model",
"Rename field", "Rename model" and "Raw SQL operation" in the migration plan. **No**
`allow_destructive_migrations` is needed. If the run asks for it, stop: something else is in the
release.

### 3.3 Verify Django [OWNER, READ-ONLY, with MANUAL shell steps]

```bash
./scripts/aws/dev-release.sh status
./scripts/aws/manage-dev.sh logs deploy --since 30m
./scripts/aws/manage-dev.sh logs jobs --since 15m        # jobs-consumer.log: no tracebacks; "jobs.relay" lines at most once a minute when there is work
./scripts/aws/manage-dev.sh urls                         # the site, API and admin URLs
curl -fsS "https://<api host>/api/v1/health/ready/"      # 200
# [OWNER, MANUAL] on the instance:
lai_manage showmigrations jobs audio                     # [X] jobs 0003, 0004 and audio 0005
systemctl is-active lai-gunicorn lai-jobs-consumer       # active active
lai_manage jobs_sweep --dry-run                          # {"deferred":0,"dryRun":true,"pruned":N,"stale":N,"timed_out":0}
lai_manage ensure_sound_roles                            # grants audio.inspect_audiofile (a deploy does not run it)
```

**The flag stays off.** The setting is `LAI_ASSET_ASYNC_VALIDATION` (`off` or `on`; default
`off`; the stack does not write it, so it is unset in dev; production refuses `on` unless
`LAI_JOBS_BACKEND=sqs`). Prove it:

```bash
# [OWNER, READ-ONLY] no SSM parameter, or the value off
aws ssm get-parameter --name /lai/dev/django/LAI_ASSET_ASYNC_VALIDATION --query Parameter.Value --output text   # ParameterNotFound or off
# [OWNER, MANUAL] on the instance
lai_manage shell -c "from django.conf import settings as s; print(s.LAI_JOBS_BACKEND, s.LAI_ASSET_ASYNC_VALIDATION)"   # sqs off
```

A legacy-kind smoke on the **old** worker proves the new consumer applies existing kinds. In
Django Admin, run **Inspect in background** (`asset.inspect`) on a published test version of an
**image or audio** asset, **not a GLB**: for a GLB, Django adds `max_bytes` to the payload and a
worker built before this release refuses it as `invalid_payload` (section 3.7). The job becomes
Completed within about a minute.

Pass: `0003`, `0004` and `0005` applied, both services active, readiness 200, flag `off`, the
non-GLB `asset.inspect` job Completed, all DLQs still 0 (`depth lai-dev-jobs-media-dlq`).

### 3.4 Media role `s3:ListBucket` and the worker code (stack update) [OWNER, MUTATING, A3 and A4]

`scripts/aws/deploy-debug.sh` always packages the worker from the checkout and sets
`WorkerCodeKey` (its steps 9 and 13), so updating `LaiDevPlatform-dev` for the IAM change **also
deploys the worker zip** of the checked-out commit. Run it only after 3.3 passes, from the release
commit, with dev running (`--execute` refuses while stopped, exit 7).

```bash
git checkout <release sha>
./scripts/aws/deploy-debug.sh --plan --only LaiDevPlatform-dev      # review the change set
./scripts/aws/deploy-debug.sh --execute --only LaiDevPlatform-dev
```

Review the change set before `--execute`. Pass: only `MediaWorkerRoleDefaultPolicy...` (the new
`ListAssetBucket` statement) is `Modify`, plus the two worker functions (`Code` from the new
`WorkerCodeKey`); **no** `Replacement: True` and nothing on RDS, EC2, the Elastic IP or the
queues (`deploy-debug.sh` also refuses a change set that would replace RDS unless
`LAI_ALLOW_DB_REPLACEMENT=true`; never set it). Anything else: stop and review. Settings come
from `.lai-dev.env`; an unset setting reuses the deployed stack's value.

If the IAM change is not approved yet, deploy the worker alone instead (case G4 then fails with
403 by design, section 4.5):

```bash
gh workflow run deploy-dev-lambda.yml --repo "$REPO" --ref main     # Option A (no inputs; needs LAI_DEV_NATIVE_ENABLED=true)
./scripts/aws/dev-release.sh lambda-deploy                          # Option B (packages, uploads lambda/<name>.zip, updates both functions)
./scripts/aws/dev-release.sh lambda-deploy --zip build/rollback/jobs-worker-<hash16>.zip   # a specific, already built zip
```

### 3.5 Verify the worker [OWNER, READ-ONLY]

```bash
for fn in lai-dev-jobs-ai lai-dev-jobs-media; do
  aws lambda get-function --function-name "$fn" --query '{Sha:Configuration.CodeSha256,Status:Configuration.LastUpdateStatus}' --output json
done
aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Parameters[?ParameterKey=='WorkerCodeKey'].ParameterValue" --output text
./scripts/aws/manage-dev.sh logs lambda-media --since 15m
```

Pass: `LastUpdateStatus` `Successful`; `WorkerCodeKey` (or the zip name `lambda-deploy` printed)
equals the name from 0.2; repeat the non-GLB `asset.inspect` smoke, Completed; DLQs 0. Close the
gate now so no later push deploys on its own:
`gh variable set LAI_DEV_NATIVE_ENABLED --repo "$REPO" --body false` (reopen it only for a
later dispatch).

### 3.6 Switch the flag on for acceptance [OWNER, MUTATING, A5]

The flag is an SSM parameter under `/lai/dev/django/` (the renderer
`scripts/aws/native/render-env-native.sh` accepts `LAI_*` names and refuses `LAI_ENVIRONMENT`,
`DATABASE_URL` and `AWS_*`); it takes effect when the runtime configuration is re-rendered, which
a deploy of the running commit does (`deploy-native.sh` step 3; the same commit is not "older",
so it is accepted). Dispatching `deploy-dev-native.yml` needs the gate open again; the
workstation command does not.

```bash
aws ssm put-parameter --name /lai/dev/django/LAI_ASSET_ASYNC_VALIDATION --type String --value on --overwrite
./scripts/aws/dev-release.sh deploy --git-sha <running sha>     # the release deployed in 3.2; re-renders the configuration
# [OWNER, MANUAL] on the instance
lai_manage shell -c "from django.conf import settings as s; print(s.LAI_ASSET_ASYNC_VALIDATION)"   # on
```

### 3.7 Worker and consumer compatibility [OWNER, READ-ONLY]

What each combination does, from the code (`ASYNC_MODEL_VALIDATION.md` section 13, `tasks.py`,
`lai/apps/assets/jobs.py`):

| Django | Worker | Behaviour | Action |
|---|---|---|---|
| new (`3.2`) | old (until `3.4`) | Legacy kinds (`speech.synthesize`, `studio.generate_chunk`, `asset.inspect` of an image or audio file) work. **`asset.inspect` of a GLB** carries `max_bytes`; the old worker answers a failed job `invalid_payload`, nothing else breaks. Contract kinds (`asset.validate_model`, `reference.checksum`, `asset.analyze_animation`, `asset.process_audio`) reach an old worker as an unknown kind: retried 3 times into the media DLQ, the job later times out | Between 3.2 and 3.4 use no background action and keep the flag off; do 3.4 right after 3.3 in the same sitting |
| old | new (`3.4` before `3.2`) | Safe: Django never sends the new kinds; the new worker accepts old payloads (an old `asset.inspect` payload without `max_bytes` keeps the 64 MiB ceiling) | Not the planned order; acceptable if 3.2 is delayed |
| new | new | The accepted state | Proceed to 3.6 |

Why consumer first still holds for this release: the migrations, handlers and `jobs_sweep`
knowledge of the new kinds must exist before any such job or result can, and Django is the only
sender. The one cross-over (`max_bytes`) is why the window is kept short and why 3.3 uses a
non-GLB smoke. `ASYNC_MODEL_VALIDATION.md` section 13 words it as "worker before, or with,
Django" for that single payload; the two statements agree once no GLB inspect is run in the
window.

---

## 4. GLB acceptance cases (core)

### 4.1 Preparation

- In Django Admin create a **synthetic** test asset (for example `lai011-acceptance-model`), never
  linked to a child, region or published content. Use a staff account with upload, view and
  publish permissions on asset versions.
- Files (local, no AWS). The repository has no committed animated or near-limit GLB, so the test
  builders (`tests/processing/glb_builder.py`, `tests/processing/audio_builder.py`) generate them:

  ```bash
  mkdir -p /tmp/lai011
  # valid: react/public/models/kenney-rock-small.glb (checked in, 23,796 bytes)
  # invalid but synchronously acceptable (non-finite node translation, the local demo's case 9)
  python3 - react/public/models/kenney-rock-small.glb /tmp/lai011/broken.glb <<'PY'
  import json, struct, sys
  data = open(sys.argv[1], 'rb').read()
  jlen, = struct.unpack_from('<I', data, 12)
  doc = json.loads(data[20:20 + jlen]); rest = data[20 + jlen:]
  doc['nodes'][0].pop('matrix', None); doc['nodes'][0]['translation'] = [10**400, 0, 0]
  j = json.dumps(doc, separators=(',', ':')).encode(); j += b' ' * (-len(j) % 4)
  out = struct.pack('<4sII', b'glTF', 2, 20 + len(j) + len(rest)) + struct.pack('<II', len(j), 0x4E4F534A) + j + rest
  open(sys.argv[2], 'wb').write(out)
  PY
  # oversized: a GLB header followed by padding, 53,000,000 bytes (above the 52,428,800 limit,
  # below nginx's client_max_body_size 55m = 57,671,680, so Django, not nginx, refuses it)
  python3 -c "import struct; n=53_000_000; open('/tmp/lai011/oversized.glb','wb').write(struct.pack('<4sII', b'glTF', 2, n) + b'\0'*(n-12))"
  # near the limit: a valid static model with an unused 49 MiB buffer view (51,381,388 bytes,
  # 1,047,412 under the limit; validated clean locally in the standard library validator)
  PYTHONPATH=tests/processing:processing .venv/bin/python - <<'PY'
  import glb_builder as g
  doc, binary = g.static_model(); n = 49 * 1024 * 1024
  doc['buffers'] = [{'byteLength': len(binary) + n}]
  doc['bufferViews'] = list(doc['bufferViews']) + [{'buffer': 0, 'byteOffset': len(binary), 'byteLength': n}]
  open('/tmp/lai011/near-limit.glb', 'wb').write(g.glb(doc, binary + b'\0' * n))
  PY
  ```

  Check the broken file locally first: `LAI_JOBS_BACKEND=inline LAI_ASSET_ASYNC_VALIDATION=on make
  runserver`, upload it; it must end `REJECTED` (not refused at upload). If it is refused
  synchronously, pick another validator-only finding from `GLB_VALIDATION.md`.
- Helpers for every case: the job id is on the version's "Background validation" section and in
  Admin, Jobs, Processing jobs; on the instance `jobs_for <version uuid>` and `version <version uuid>`
  (**[OWNER, MANUAL]**).

### 4.2 G1: valid upload, DRAFT, validated, explicit publish [OWNER, MUTATING]

1. Upload the valid GLB as a new version of the test asset.
2. Immediately try **Publish**: refused with `not_validated` (the version is still a draft). The
   second gate, `processing_required`, refuses a GLB without a passing job for exactly this file
   (`ASYNC_MODEL_VALIDATION.md` section 8).
3. Wait about a minute; refresh.
4. Publish explicitly.

```bash
version <uuid>; jobs_for <uuid>                                                  # [OWNER, MANUAL]
aws s3api head-object --bucket "$ARTIFACTS" --key "jobs/results/<job id>.json" --query '{Size:ContentLength}' --output json
./scripts/aws/manage-dev.sh logs lambda-media --since 10m | grep '<job id>'    # job.finished status succeeded
./scripts/aws/manage-dev.sh logs jobs --since 10m
```

Pass: right after upload the version is `DRAFT` with one `asset.validate_model` job
(`pending`/`running`); then the job is `completed`, `subject_outcome=version_validated`, version
`VALIDATED`; the Admin section shows verdict pass, processor `asset.glb_validator` 1.0.0, profile
`glb-default` v1, and model facts; publish succeeds only after the validation and only by the
staff action; nothing was published by the job; DLQs 0.

### 4.3 G2: invalid GLB, REJECTED [OWNER, MUTATING]

Upload `/tmp/lai011/broken.glb`. Pass: upload accepted as `DRAFT`; job `completed` (a bad model
is a successful job with verdict `fail`), `subject_outcome=version_rejected`, version `REJECTED`,
findings appended to the validation report with `source: processing`; Publish refused; DLQs 0.

### 4.4 G3: duplicate-result handling, and a duplicate submission [OWNER, MUTATING]

Duplicate **result** (needs the owner's administrator credentials; the instance and GitHub roles
cannot send to the results queue). There is no repository command that replays a result, so this
is plain AWS CLI, **[OWNER, MANUAL]**:

```bash
aws s3 cp "s3://$ARTIFACTS/jobs/results/<G1 job id>.json" /tmp/lai011/dup.json
wc -c /tmp/lai011/dup.json      # must be under 200 KB (otherwise the worker sent a pointer; then skip)
aws sqs send-message --queue-url "$RESULTS_Q" --message-body file:///tmp/lai011/dup.json --query MessageId --output text
./scripts/aws/manage-dev.sh logs jobs --since 5m          # "jobs.result duplicate id=<G1 job id>"
```

Duplicate **submission**: select the G1 version and run **Validate in background** again.

Pass: the consumer logs `duplicate` and deletes the message (results queue back to 0, results DLQ
0); the G1 version and its `validated_at` are unchanged; the Admin action reports the existing job
for the same file (no second job: `jobs_for <G1 uuid>` still lists one validation job).

### 4.5 G4: missing object (expects 404 and `input_missing`, not 403) [OWNER, MUTATING, A6]

The media worker is held back so the object can disappear between upload and validation. There
is no repository command for the mapping or the delete marker: plain AWS CLI, **[OWNER, MANUAL]**.

```bash
MEDIA_ESM=$(aws lambda list-event-source-mappings --function-name lai-dev-jobs-media --query 'EventSourceMappings[0].UUID' --output text)
aws lambda update-event-source-mapping --uuid "$MEDIA_ESM" --no-enabled --query State --output text
aws lambda get-event-source-mapping --uuid "$MEDIA_ESM" --query State --output text      # repeat until Disabled
```

1. Upload the valid GLB again (a new `DRAFT`); `depth lai-dev-jobs-media` shows 1 visible.
2. Hide the object (the asset bucket is versioned; this adds a delete marker, recoverable):

   ```bash
   KEY=<storage_key from: version <uuid>>
   aws s3api delete-object --bucket "$ASSETS" --key "$KEY" --query '{Marker:DeleteMarker,MarkerVersion:VersionId}' --output json   # record MarkerVersion
   ```

3. Release the worker: `aws lambda update-event-source-mapping --uuid "$MEDIA_ESM" --enabled`.
4. After about a minute: `jobs_for <uuid>; version <uuid>; depth lai-dev-jobs-media-dlq`.

Pass (with the `ListAssetBucket` statement from 3.4): one delivery; the job `failed` with
`error_code=input_missing`, `subject_outcome=processing_failed`; the version stays `DRAFT`; the
media DLQ stays 0; the worker log shows `job.finished` with status `failed`. The classification
table is in `CANONICAL_PATH.md`, "Asset read errors".

Fail signature (no effective `s3:ListBucket`): S3 answers **403**, which the worker reports as
`access_denied` and Django as `permission_denied`, and not as missing; the job fails at once with
that code (permanent, not retried). If instead the log shows `job.retry` with a storage code and
the message lands in `lai-dev-media-dead-letters`, the 403 was read as a transient storage
fault: record it and report it as a defect. Either way clear the DLQ through section 6 after the
IAM fix. (Earlier revisions of this page expected the retry-into-DLQ signature; the current
classifier fails 403 immediately.)

Confirm the mapping is `Enabled` again before continuing (A6: the template says `Enabled: true`).

### 4.6 G5: oversized [OWNER, MUTATING]

Upload `/tmp/lai011/oversized.glb`. Pass: refused synchronously with `too_large` (the message
names the 52,428,800-byte GLB limit); no version row, no new job (Admin, Processing jobs), and no
new object under the asset's prefix:

```bash
aws s3api list-objects-v2 --bucket "$ASSETS" --prefix "assets/models/<asset id>/" --query 'Contents[].{Key:Key,Size:Size}' --output table
```

Optional (only if the owner wants to see the configurable limit): set
`/lai/dev/django/LAI_ASSET_MAX_GLB_BYTES` to a smaller value (at least 1,048,576), redeploy the
running commit as in 3.6, and confirm a GLB above that size is refused; then delete the parameter
and redeploy again. Values above 50 MiB are refused at startup (the profile's ceiling).

### 4.7 G6: retry and resubmission [OWNER, MUTATING]

Continue from G4 (**[OWNER, MANUAL]** AWS CLI):

```bash
aws s3api delete-object --bucket "$ASSETS" --key "$KEY" --version-id <MarkerVersion>   # removes the delete marker: the object is back
aws s3api head-object --bucket "$ASSETS" --key "$KEY" --query ContentLength
```

Then select the G4 version and run **Validate in background**.

Pass: a **new** job id (a `failed` job may be resubmitted; same idempotency key, new attempt id;
at most `LAI_ASSET_VALIDATION_MAX_ATTEMPTS`, 5, per file and processor version); it completes
with `version_validated`; the version moves `DRAFT` to `VALIDATED`; the failed G4 job stays as
history; explicit publish now succeeds.

### 4.8 G7: a GLB near the limit (memory and time) [OWNER, MUTATING]

Goal: show the 512 MB media worker copes with the largest allowed model and size the
production memory (LAI-LAMBDA-012 section 10). Upload `/tmp/lai011/near-limit.glb` (51,381,388
bytes, under the 52,428,800 limit and under nginx's 55 MiB).

```bash
version <uuid>; jobs_for <uuid>                                                  # [OWNER, MANUAL]
# the Lambda REPORT line of that invocation carries Duration, Memory Size and Max Memory Used
aws logs filter-log-events --log-group-name /aws/lambda/lai-dev-jobs-media --filter-pattern '"REPORT"' \
  --start-time <epoch ms of the upload> --query 'events[].message' --output text | tail -3
aws logs start-query --log-group-name /aws/lambda/lai-dev-jobs-media --start-time <epoch s> --end-time <epoch s> \
  --query-string 'filter @type = "REPORT" | stats max(@maxMemoryUsed / 1048576) as max_mb, max(@duration) as max_ms, count(*) as n'
aws logs get-query-results --query-id <id>
```

Pass: job `completed`, `version_validated`, DLQs 0, no `Task timed out` and no
`Runtime exited` (out of memory) in the log; record `Max Memory Used` and `Duration`. Healthy:
`Max Memory Used` at most about 80 percent of 512 MB and `Duration` well under 90 s (the request's
execution budget) and 120 s (the function timeout). If memory is higher, raise it with
`LAI_LAMBDA_MEMORY` in `.lai-dev.env` and `deploy-debug.sh --plan` then `--execute --only
LaiDevPlatform-dev` (parameter `LambdaMemorySize`), and record it as a production sizing input.
A local baseline of the standard-library validator on this file is about 76 MB peak resident
and under a second, so a large gap would point at the worker's read path (`read_asset` ranged
reads) and is worth reporting.

### 4.9 Retention

```bash
# [OWNER, MANUAL]
lai_manage jobs_sweep --dry-run
```

Pass: the JSON has the keys `dryRun`, `stale`, `timed_out` (0 in a dry run), `deferred` and
`pruned`; `pruned` counts completed jobs older than `LAI_JOBS_RETENTION_DAYS` (30) and completed
`asset.validate_model` jobs older than `LAI_ASSET_VALIDATION_JOB_RETENTION_DAYS` (90). On a new
dev release `pruned` is expected to be small. Failed jobs are never deleted by the sweep.

### 4.10 Close the GLB session

Retire the test asset in Admin (do not delete published versions). Keep the flag `on` only for
sections 5 to 8, then switch it off as in 11.1.

---

## 5. Wave 4 inspection acceptance (Tier 2: NPC animation and audio inspection)

**Not part of core acceptance, and a failure here does not undo section 4.** The kinds are on
the release commit (`asset.analyze_animation`, LAI-LAMBDA-009; `asset.process_audio` phase 1,
LAI-LAMBDA-008); they share migration `jobs.0004_wave4_inspection_kinds`, ship in the same Django
release and the same worker zip as Tier 1 (one release, one sequence), and need **no flag**:
nothing submits them except a staff Admin action. Rules from `WAVE4_HANDOFF.md`: standard library
only, no artifact writes, no native tools, no child audio, results never rewrite a published
version. Run after section 4 (the flag may stay on; it does not affect these kinds), with the
worker deployed (3.5).

### 5.1 Preparation (local, no AWS)

```bash
mkdir -p /tmp/lai011
PYTHONPATH=tests/processing:processing .venv/bin/python - <<'PY'
import glb_builder as g, audio_builder as a
open('/tmp/lai011/animated.glb', 'wb').write(g.skinned_glb(("idle", "walk")))   # 2 clips, 1 skin
open('/tmp/lai011/tone.wav', 'wb').write(a.wav(1.0))
open('/tmp/lai011/tone.mp3', 'wb').write(a.mp3_cbr())
open('/tmp/lai011/tone.ogg', 'wb').write(a.ogg_vorbis(1.0))
PY
# a file the upload check accepts but the inspector fails (the Asset Library's minimal Ogg: no page checksums)
PYTHONPATH=lai .venv/bin/python -c "from apps.assets.tests.media_files import ogg_bytes; open('/tmp/lai011/lenient.ogg','wb').write(ogg_bytes())"
```

All files are synthetic (A9). Upload them in Django Admin, Asset Library, as new synthetic assets
(`lai011-npc-model`, `lai011-tone-wav`, `lai011-tone-mp3`, `lai011-tone-ogg`, `lai011-lenient-ogg`).
Give the staff account the Sound editors group (`audio.inspect_audiofile`; granted by
`ensure_sound_roles`, run in 3.3) and the NPC editors group (`npcs.change_npcmodelvariant`).

### 5.2 Checks

| # | Check | Command or action | Pass |
|---|---|---|---|
| W0 | Kinds, migrations and permissions on the release | `lai_manage showmigrations jobs audio` **[OWNER, MANUAL]**; Admin shows **Audio files (inspection)** and **NPC model variants** | `jobs 0004` and `audio 0005` applied; both pages open for the staff account |
| W1 | Zip stays within budget and standard library | `scripts/aws/package-lambda.sh` and `.venv/bin/python -m pytest -q tests/lambda/test_jobs_worker_package.py tests/processing/test_processing_runtime_independence.py` | Size under 2 MiB; tests green |
| W2 | Order | Sections 3.2 to 3.5 done once for all kinds | Django (with `0004`) first, then the worker |
| W3 | NPC animation inspection | NPC Manager, **NPC model variants**: create a synthetic character and variant whose model is `lai011-npc-model`'s validated version (pin it; if the form refuses an unpublished pin, publish the synthetic asset first and expect `result_recorded` instead of `inspection_stored`), note `animation_map`, then run the list action **Inspect animations in background** | Job `completed`; `subject_outcome` `inspection_stored` (never published) or `result_recorded` (published); the variant's **Animation inspection** section lists clips `idle` and `walk` with exact names, durations, channels, the skin, and the **"Suggestion only"** mapping helper marks `idle` and `walk` as `exact`; `animation_map` is byte-for-byte the value noted before; a published version is unchanged |
| W3b | GLB validator version unchanged | In Admin open the G1 version (validated, unpublished) after W3 and publish it | Publish succeeds; no `processor_outdated` refusal (the animation inspector must not bump `asset.glb_validator` 1.0.0) |
| W4 | Audio inspection | Sound Manager, **Audio files (inspection)**: select the WAV, MP3 and Ogg versions, run **Inspect audio in background** | Each job `completed`, `subject_outcome=inspection_recorded`; the file page shows verdict `pass`, format, container, codec, duration with its kind (`exact` or `estimated`), sample rate, channels, and the limitations `header_only`, `playback_not_verified`, `loudness_not_measured`; the version row is unchanged; no object was written (list the prefix before and after); upload and publish stay in the Asset Library |
| W4b | Cue page | Sound cues: run the same action on a cue that resolves to one of those versions | The cue page shows the latest inspection; nothing published or changed |
| W5 | Failure paths | Inspect `lai011-lenient-ogg`; run the animation action on a GLB with no animations (`react/public/models/kenney-rock-small.glb` in a variant) | A completed job with verdict `fail` (Ogg: `ogg_crc_mismatch` and `ogg_vorbis_header_invalid`) or a `no_animations` warning; never a retry loop; DLQs 0 |
| W5b | Refused before a job | Try the audio action on a GLB version; try a truncated WAV upload (`wav_bytes()[:-500]` style) | Refused with a message (`not_audio`) or refused at upload; no new job row |
| W5c | Authorization | As a staff user without `audio.inspect_audiofile`, open the Audio files page | No action offered; direct POST refused |
| W6 | Duplicate handling | Run the audio action again on a recorded version; replay a result as in 4.4 | The Admin reports the existing job (no new row); the replay is logged `duplicate` |
| W7 | Rollback | Section 11 | As core; the kinds fail closed on an older worker, see 11.2 |

Local equivalent of W3 to W5 with no AWS: `scripts/processing/local-demo.sh` steps 10 to 17
(packaged worker zip, in-memory SQS and S3); it is a rehearsal, not acceptance.

---

## 6. Restricted DLQ redrive (ADR-062 B7, ADR-064 decision 6)

Only the administrator(s) named in A8 run this, after the cause is fixed. Ordinary staff, the
GitHub roles, the instance role and the worker roles must not be able to.

### 6.1 Prove the restriction [OWNER, READ-ONLY]

No role in `infra/` grants `sqs:StartMessageMoveTask`; the restriction relies on that.

```bash
DLQ_ARN=$(qarn lai-dev-job-results-dlq)
for role in lai-django-ec2-dev lai-dev-jobs-ai-worker lai-dev-jobs-media-worker \
            "$(out BackendDeploymentRoleArn | sed 's#.*/##')" "$(out InfrastructureManagementRoleArn | sed 's#.*/##')"; do
  aws iam simulate-principal-policy --policy-source-arn "arn:aws:iam::${ACCOUNT_ARN_PREFIX}:role/$role" \
    --action-names sqs:StartMessageMoveTask sqs:CancelMessageMoveTask --resource-arns "$DLQ_ARN" \
    --query "EvaluationResults[].{Role:'$role',Action:EvalActionName,Decision:EvalDecision}" --output table
done
```

Pass: every decision `implicitDeny`. Also list who else holds broad SQS rights (IAM console,
Access Analyzer or `aws iam list-entities-for-policy --policy-arn arn:aws:iam::aws:policy/AmazonSQSFullAccess`)
and record that only the named administrators remain.

### 6.2 Redrive drill [OWNER, MUTATING, A8]

Source: a message left in `lai-dev-jobs-media-dlq` by an earlier fault, or one
deliberately produced by sending a malformed body to the media work queue with administrator
credentials (`aws sqs send-message --queue-url "$MEDIA_Q" --message-body '{"schema":1}'`: the
worker reports a batch item failure, 3 receives, DLQ). Then:

1. Read the cause in the logs (`manage-dev.sh logs lambda-media --since 1h`), fix it.
2. Decide per message whether redrive is useful: a work message for a job that `jobs_sweep`
   already failed only produces a result Django ignores; a request older than 72 hours fails with
   `job_expired`. Staff resubmission (Validate in background) is usually better for work queues;
   redrive is the right tool for the **results** DLQ.
3. Move and watch:

```bash
SRC=$(qarn lai-dev-jobs-media-dlq)          # or lai-dev-job-results-dlq
aws sqs start-message-move-task --source-arn "$SRC" --max-number-of-messages-per-second 1 --query TaskHandle --output text
aws sqs list-message-move-tasks --source-arn "$SRC" --query 'Results[].{Status:Status,Moved:ApproximateNumberOfMessagesMoved,ToMove:ApproximateNumberOfMessagesToMove,Failure:FailureReason}' --output table
depth lai-dev-jobs-media-dlq
```

Pass: the task ends `COMPLETED`; the DLQ is 0; the redriven message is handled (result applied,
ignored as duplicate, or failed with a contract code); the alarm returns to `OK`. Malformed test
messages end back in the DLQ by design; purge only them, only with approval
(`aws sqs purge-queue --queue-url "$(qurl lai-dev-jobs-media-dlq)"`).

---

## 7. RDS outage drill [OWNER, MUTATING, A6 and A7]

Goal: while PostgreSQL is unreachable, `jobs_consume_results` does **not receive** from
`lai-dev-job-results` (so no receive count and no DLQ allowance is spent), results wait, and they
are applied when the database returns (ADR-064 decision 3).

Preconditions: hold active (0.3); not near 20:00 UTC; flag on (or use Inspect in background);
results queue and DLQ at 0.

1. Hold the media worker: `aws lambda update-event-source-mapping --uuid "$MEDIA_ESM" --no-enabled`;
   wait for `Disabled`.
2. Submit work while the database is up: upload a valid GLB (`DRAFT`, job `pending`, 1 message in
   `lai-dev-jobs-media`). Record the job id and the time `T0`.
3. Take the database away. Option A (preferred):
   `aws rds stop-db-instance --db-instance-identifier lai-dev`, then poll
   `aws rds describe-db-instances --db-instance-identifier lai-dev --query 'DBInstances[0].DBInstanceStatus'`
   until `stopped` (the consumer already backs off while it is `stopping`). Option B (only if a stop is not allowed): revoke the DB security group's
   ingress rule from the instance group and re-add the identical rule afterwards (CloudFormation
   drift; record the rule JSON first with `describe-security-groups`).
4. Release the worker: `aws lambda update-event-source-mapping --uuid "$MEDIA_ESM" --enabled`. The
   worker runs (no database needed) and sends `running` and the final result. Record `T1`.
5. Wait at least 15 minutes (three times the 300 s results visibility timeout). Observe, never
   receive:

```bash
depth lai-dev-job-results            # ApproximateNumberOfMessages >= 1 (running + final), NotVisible 0
depth lai-dev-job-results-dlq        # 0
aws cloudwatch get-metric-statistics --namespace AWS/SQS --metric-name NumberOfMessagesReceived \
  --dimensions Name=QueueName,Value=lai-dev-job-results --start-time <T1 ISO> --end-time <now ISO> \
  --period 300 --statistics Sum --output table          # 0 in every period while the DB is down
./scripts/aws/manage-dev.sh logs jobs --since 30m       # repeated "jobs.consumer database_error type=OperationalError", backing off (cap 60 s)
```

6. Restore: `aws rds start-db-instance --db-instance-identifier lai-dev` (or re-add the rule);
   poll until `available`. The consumer recovers by itself (no restart).
7. Within a few minutes: results queue 0, DLQ 0, `jobs_for <uuid>` shows `completed`,
   `version_validated`, the version `VALIDATED`, `deliveries` as expected.

Pass: `NumberOfMessagesReceived` 0 for the results queue for the whole outage; results DLQ 0
throughout; the job applied after recovery without manual action; alarm
`lai-dev-results-dead-letters` never fired. Also check readiness returned to 200 and that
`/lai/dev/power/state` is still `running` (the drill bypasses the power state machine).

---

## 8. Overnight stop and start recovery [OWNER, MUTATING, A6]

Proves that results produced while dev is stopped wait in the queue and are applied at the next
start, and that a release pushed while stopped is deferred and applied.

1. Release the hold: `./scripts/aws/manage-dev.sh release-hold`.
2. Before the stop: disable the media mapping (as in 7.1) and upload a valid GLB (`DRAFT`, job
   pending, message in the media queue).
3. Stop: let the 00:00 Pacific schedule run, or run it now:
   `./scripts/aws/manage-dev.sh stop` (or `gh workflow run manage-dev-infrastructure.yml --repo paulj3000/learning --ref main -f operation=stop`).
4. While stopped: enable the mapping; within minutes `depth lai-dev-job-results` shows the
   messages waiting; `depth lai-dev-job-results-dlq` 0.
5. Optional, deferred release: with `LAI_DEV_NATIVE_ENABLED=true` and `LAI_DEV_STOPPED_DEPLOY=defer`,
   dispatch `deploy-dev-native.yml` (`-f action=deploy`). Pass: the run succeeds with "deployment
   pending"; `aws ssm get-parameter --name /lai/dev/deploy/pending` names the commit.
6. Start: the 07:35 Pacific schedule, or `./scripts/aws/manage-dev.sh start`.
7. After `running`:

```bash
./scripts/aws/manage-dev.sh status
aws ssm get-parameter --name /lai/dev/power/last-result --query Parameter.Value --output text
depth lai-dev-job-results; depth lai-dev-job-results-dlq
# on the instance: jobs_for <uuid>; version <uuid>
```

Pass: the stop ran quiesce (consumer and gunicorn stopped), EC2 then RDS stopped, state
`stopped`; the start reached `running` (not `degraded`); the verify step started
`lai-jobs-consumer`; the queued results were applied (job `completed`, version `VALIDATED`);
results DLQ 0; a pending release (if step 5 ran) was applied and `/lai/dev/deploy/pending` is
`none`. The 20:00 UTC `jobs_sweep` later deferred no timeouts for this job (it was already
applied).

---

## 9. Monitoring and alarms (what to check during and after acceptance)

| Signal | Where | Healthy |
|---|---|---|
| DLQ depth | Alarms `lai-dev-ai-dead-letters`, `lai-dev-media-dead-letters`, `lai-dev-results-dead-letters` (`ApproximateNumberOfMessagesVisible` >= 1, 5 min) | `OK`, except during deliberate drills |
| Queue backlog and age | `AWS/SQS` `ApproximateNumberOfMessagesVisible`, `ApproximateAgeOfOldestMessage` per queue | Near 0 while dev runs; results age grows only while stopped |
| Receives during outages | `AWS/SQS` `NumberOfMessagesReceived` on `lai-dev-job-results` | 0 while the database is down |
| Worker health | `AWS/Lambda` `Invocations`, `Errors`, `Throttles`, `Duration` (p99), `ConcurrentExecutions` for both functions | Errors 0 outside drills; media `Duration` well under 120,000 ms; REPORT `Max Memory Used` (case G7) at most about 80 percent of 512 MB; no throttles |
| Instance | `LearningAdventureIsland/DevEC2` `mem_used_percent`, `disk_used_percent`; `AWS/EC2` `CPUCreditBalance` | Below the 90% and 85% alarms; credits not draining |
| Database | `AWS/RDS` `FreeStorageSpace`, `DatabaseConnections`, `CPUCreditBalance` for `lai-dev` | Above 2 GB free; connections stable |
| Logs | `/lai/dev/jobs` (consumer, relay), `/lai/dev/django`, `/lai/dev/deploy`, `/lai/dev/nginx`, `/aws/lambda/lai-dev-jobs-media`, `/aws/lambda/lai-dev-jobs-ai`, `/aws/vendedlogs/states/lai-dev-power`, `/aws/rds/instance/lai-dev/postgresql` | No tracebacks; ids and codes only, no names or content |

```bash
# [OWNER, READ-ONLY] examples
aws cloudwatch describe-alarms --alarm-name-prefix lai-dev- --state-value ALARM --query 'MetricAlarms[].AlarmName'
aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Errors --dimensions Name=FunctionName,Value=lai-dev-jobs-media \
  --start-time <start> --end-time <end> --period 3600 --statistics Sum --output table
aws logs start-query --log-group-name /aws/lambda/lai-dev-jobs-media --start-time <epoch> --end-time <epoch> \
  --query-string 'fields @timestamp, event, job, status, code | filter event in ["job.finished","job.retry","job.redelivered","job.invalid_envelope"] | sort @timestamp desc | limit 50'
aws logs get-query-results --query-id <id>
aws logs filter-log-events --log-group-name /lai/dev/jobs --start-time <epoch ms> --filter-pattern '"jobs.consumer"'
```

Gaps to record (not acceptance failures): there are no alarms on Lambda `Errors` or `Throttles`
or on results-queue age; DLQ alarms are the only processing alarms in `LaiDevPlatform-dev`.
`jobs/results/` objects expire after 7 days (`LaiDevArtifacts-dev`) while the results queue keeps
messages 14 days: a result over 200 KB that waits more than 7 days (a week-long stop) would point
at a deleted object and end in the results DLQ.

---

## 10. Cost measurement (record, do not estimate)

Activate the cost allocation tag `Environment` (Billing, Cost allocation tags) before the window;
data appears about 24 hours later. Each Cost Explorer API request is billed (about $0.01).

| Record | Command or source |
|---|---|
| Daily cost by service for the acceptance week and a quiet week after | `aws ce get-cost-and-usage --time-period Start=<YYYY-MM-DD>,End=<YYYY-MM-DD> --granularity DAILY --metrics UnblendedCost --filter '{"Tags":{"Key":"Environment","Values":["dev"]}}' --group-by Type=DIMENSION,Key=SERVICE` |
| Lambda invocations and duration (GB-seconds = sum of Duration in s x 0.5 GB at 512 MB) | `AWS/Lambda` `Invocations` and `Duration` (Sum) per function, daily |
| SQS requests (the idle consumer long-polls 20 s: about 3 requests a minute while dev runs) | `AWS/SQS` `NumberOfEmptyReceives`, `NumberOfMessagesSent`, `NumberOfMessagesReceived`, `NumberOfMessagesDeleted` per queue, daily |
| S3 requests and bytes for `jobs/results/` and `lambda/` | `aws s3api list-objects-v2 --bucket "$ARTIFACTS" --prefix jobs/results/ --query 'length(Contents)'`; S3 Storage Lens or Cost Explorer usage type |
| CloudWatch Logs ingestion | `AWS/Logs` `IncomingBytes` per log group |
| EC2 and RDS hours actually run (schedule effect) | `/lai/dev/power/last-result` history; Cost Explorer usage types `BoxUsage` and `InstanceUsage` |
| Budget status | AWS Budgets, the `LaiDevPlatform-dev` monthly budget (`MonthlyBudgetUsd`, 40) |

Compare with `dev-native-environment.md` section 12 (about $30 a month with the schedule; Lambda
and SQS under $1 at dev volume). Prices: verify current pricing in the AWS Pricing Calculator.

---

## 11. Rollback

Order: flag off first, then the worker, then Django. Each step is **[OWNER, MUTATING, A10]**.

### 11.1 Flag off (always first; reversible in minutes)

```bash
aws ssm put-parameter --name /lai/dev/django/LAI_ASSET_ASYNC_VALIDATION --type String --value off --overwrite
# or delete it: aws ssm delete-parameter --name /lai/dev/django/LAI_ASSET_ASYNC_VALIDATION
./scripts/aws/dev-release.sh deploy --git-sha <running sha>      # re-renders the configuration
```

Effect: new GLB uploads are synchronous again; existing `DRAFT` versions keep their jobs, which
still complete; the publication gate stops applying. Do not use the Wave 4 Admin actions or
Validate in background from here on. Wait until no contract-kind job (`asset.validate_model`,
`reference.checksum`, `asset.analyze_animation`, `asset.process_audio`) is `pending` or `running`
(Admin, Processing jobs, filter by kind) and the media and results queues are 0 before 11.2.

### 11.2 Previous worker zip

```bash
PREV=lambda/jobs-worker-<previous hash16>.zip                    # from 3.1
aws s3api head-object --bucket "$ARTIFACTS" --key "$PREV" --query ContentLength
mkdir -p build/rollback && aws s3 cp "s3://$ARTIFACTS/$PREV" build/rollback/
./scripts/aws/dev-release.sh lambda-deploy --zip "build/rollback/$(basename "$PREV")"   # supported path
# or directly, per function:
for fn in lai-dev-jobs-ai lai-dev-jobs-media; do
  aws lambda update-function-code --function-name "$fn" --s3-bucket "$ARTIFACTS" --s3-key "$PREV" --query LastUpdateStatus
done
```

The stack's `WorkerCodeKey` still names the new zip until the next `deploy-debug.sh` run, which
packages its checkout again: run that from the commit you want, or the rollback is undone. A
`deploy-dev-lambda.yml` dispatch deploys `main`'s HEAD, so it cannot roll back by itself. The IAM
statement `ListAssetBucket` may stay; it is harmless to the old worker. With the old worker and
the new Django, a GLB **Inspect in background** fails `invalid_payload` and the contract kinds are
unknown to it (3.7): keep the actions unused.

### 11.3 Django rollback

```bash
gh workflow run deploy-dev-native.yml --repo "$REPO" --ref main -f action=rollback                     # previous healthy release
gh workflow run deploy-dev-native.yml --repo "$REPO" --ref main -f action=rollback -f rollback_to=<full sha>
./scripts/aws/dev-release.sh rollback [--to <full sha>]                                                # workstation equivalent
```

The rollback job needs `LAI_DEV_NATIVE_ENABLED=true` and dev running (exit 7 otherwise). It
re-renders configuration, switches `/opt/lai/current`, restarts and checks health. Migrations are
never reversed; the record says `manual_db_review_required` when later releases applied any. The
first ever dev deployment has nothing to roll back to (exit 63).

**Is the schema backward compatible? For inserts, yes.** `jobs/0003`'s two new columns
(`idempotency_key`, `subject_outcome`) carry `db_default=""`, so a code-only rollback keeps
inserting `ProcessingJob` rows (Question Studio chunks, speech pre-generation, `asset.inspect`).
`0004` and `audio/0005` change only the kind choices, the check constraint and a proxy model.
**What breaks is the kinds, not the columns.** The earlier release knows neither the new kinds
nor their handlers, so before rolling Django back:

1. flag off (11.1) and no Wave 4 actions;
2. wait for the media and results queues to drain;
3. mark every unfinished contract-kind job failed (Django Admin, Jobs, Processing jobs, "mark
   failed"); otherwise the older `jobs_sweep` and outbox relay stop on the first such job
   (`KeyError` for an unknown kind, `ASYNC_MODEL_VALIDATION.md` section 13);
4. reversing a jobs migration is refused while rows of the new kinds exist (a clear error, not a
   constraint violation); delete them first only if the schema must go back, which is not
   recommended. Prefer **rolling forward** (a fix on top of the release).

Confirm before the release (local, no AWS): `cd lai && ../.venv/bin/python manage.py sqlmigrate jobs 0003`
shows the columns added with `DEFAULT ''`.

---

## 12. Future native-worker acceptance (Tier 3: not in scope, not approved, never blocks Tier 1 or 2)

Listed only to keep it apart from this release. Workloads that need native tools or artifact
writes have their own cards and need their own ADR first (`WAVE4_HANDOFF.md` decisions W4-1 to
W4-8; proposals in `proposals/`, feasibility in `feasibility/`):

| Card | Workload | Blocked on |
|---|---|---|
| LAI-LAMBDA-008b | Audio transcoding and loudness (FFmpeg) | W4-1 (container ADR), W4-4 (durable derived files), W4-5 (loudness target, `ASYNC_FORMATS`) |
| LAI-LAMBDA-010 | GLB and texture optimization (`gltfpack`, `toktx`) | W4-1, W4-4, W4-6 (loader and validator support for meshopt, Draco, KTX2; ADR-020 engine decision) |
| LAI-LAMBDA-013a, 013b | Image conversion, GLB thumbnails (the split named in the task brief) | W4-1 or a zip-fit measurement, W4-2 (renderer), W4-4, W4-7 |

Dev has no ECR (ADR-064). When such an ADR exists, its acceptance adds: the image source,
registry and immutable digest; scanning; cold start and size; arm64 build; tool licences; no
network in the processing sandbox; time, memory and `/tmp` bounds below the job limits; a
decision for durable derived files (W4-4); and the same consumer-first, DLQ, outage and rollback
checks as sections 3, 6, 7 and 11. Nothing in this checklist covers that, and **no step in
sections 0 to 11 depends on it**.

---

## 13. Close out [OWNER, MUTATING]

```bash
./scripts/aws/manage-dev.sh release-hold
aws lambda get-event-source-mapping --uuid "$MEDIA_ESM" --query State --output text           # Enabled
aws ssm get-parameter --name /lai/dev/django/LAI_ASSET_ASYNC_VALIDATION --query Parameter.Value --output text   # off (or ParameterNotFound), unless the owner keeps it on
gh variable list --repo "$REPO"                                                               # gates back to the owner's chosen values (section 1.3)
for q in lai-dev-jobs-ai-dlq lai-dev-jobs-media-dlq lai-dev-job-results-dlq; do depth "$q"; done
```

---

## 14. Evidence capture

Rules: pipe every output through `redact` (12-digit account ids become `<account>`); never paste
secrets, tokens, `django.env`, `DATABASE_URL`, presigned URLs or e-mail addresses; job and version
UUIDs, commit SHAs, queue names and codes are fine. Keep raw transcripts outside the repository;
paste only the redacted lines that prove each "Pass".

| Step | Tier | Date (UTC) | Run by | Command or run URL | Result (Pass/Fail/Skipped) | Evidence (redacted excerpt or link) | Judged by |
|---|---|---|---|---|---|---|---|
| 0.2 Release content and local tests | 1 | | | | | | |
| 1.3 to 1.4 Gates safe at merge, environments | 1 | | | | | | |
| 2.1 to 2.7 Infrastructure | 1 | | | | | | |
| 3.1 Baseline | 1 | | | | | | |
| 3.2 to 3.3 Django, flag off | 1 | | | | | | |
| 3.4 to 3.5 IAM and worker | 1 | | | | | | |
| 3.7 Compatibility | 1 | | | | | | |
| 4.2 G1 valid | 1 | | | | | | |
| 4.3 G2 invalid | 1 | | | | | | |
| 4.4 G3 duplicate | 1 | | | | | | |
| 4.5 G4 missing object (404) | 1 | | | | | | |
| 4.6 G5 oversized | 1 | | | | | | |
| 4.7 G6 retry and resubmission | 1 | | | | | | |
| 4.8 G7 near-limit memory and time | 1 | | | | | | |
| 4.9 Retention | 1 | | | | | | |
| 5 W0 to W7 Wave 4 | 2 | | | | | | |
| 6 DLQ redrive | 1 | | | | | | |
| 7 RDS outage | 1 | | | | | | |
| 8 Overnight stop and start | 1 | | | | | | |
| 9 Monitoring | 1 | | | | | | |
| 10 Cost | 1 | | | | | | |
| 11 Rollback (if exercised) | 1 | | | | | | |

LAI-LAMBDA-011 is accepted when every Tier 1 row is Pass (or Skipped with an owner-signed
reason), no DLQ holds an unexplained message, and the flag and gates are at the owner's chosen
values. Tier 2 rows are accepted separately and gate only the Wave 4 kinds. Tier 3 has no rows.
