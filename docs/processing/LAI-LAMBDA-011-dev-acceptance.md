# LAI-LAMBDA-011: DEV live acceptance for the canonical processing release

**Status: checklist only. NOT EXECUTED.** Prepared 2026-11-17 from the repository at `2333d9e`
(`feature/serverless-processing-canonical`). Nothing here has been run against AWS or GitHub.
Every command is an **owner-run step**: Claude does not run AWS, CDK, deploy scripts or
workflows (`CLAUDE.md` sections 14 and 18). The owner runs each step, pastes redacted output into
section 14, and judges it against the "Pass" column.

Read with: ADR-055, ADR-061, ADR-062 (B7), ADR-064 in `../DECISIONS.md`; `CANONICAL_PATH.md`;
`ASYNC_MODEL_VALIDATION.md`; `../infrastructure/dev-native-environment.md`; the root `README.md`,
"AWS Development Infrastructure". The code wins over this page.

## Scope

| Part | Sections | Needed to accept LAI-LAMBDA-011 |
|---|---|---|
| **Core release acceptance** | 0 to 4, 6 to 11, 13, 14 | Yes |
| **Optional Wave 4 acceptance** (`asset.analyze_animation`, `asset.process_audio`) | 5 | No; only if those kinds are on the release commit |
| **Future native-runtime acceptance** (container images, Fargate) | 12 | No; not approved, listed so it is not confused with this release |

Step markers: **[OWNER, READ-ONLY]** reads state only; **[OWNER, MUTATING]** changes AWS, GitHub or
data and needs the approval named in section 0. Every step is owner-run.

## Conventions used by the commands

Run from the repository root at the release commit, with credentials for the dev account
(`--profile` or `AWS_PROFILE`) and `LAI_DEV_ACCOUNT_ID` set in `.lai-dev.env` (the scripts then
refuse any other account; `scripts/aws/lib-dev.sh`).

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

On the instance (open a session with `./scripts/aws/manage-dev.sh connect`), run Django commands
with exactly the environment the systemd units use (`deploy/native/systemd/lai-jobs-consumer.service`):

```bash
# [OWNER] define once per SSM session; use --pty instead of --pipe for an interactive shell
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

Never use `aws sqs receive-message` on any `lai-dev-*` queue during acceptance: a receive by
anyone counts toward the queue's `maxReceiveCount` and can push a valid message into its DLQ.
Use queue attributes and CloudWatch metrics instead.

---

## 0. Prerequisites and approvals

### 0.1 Approvals (each is a separate owner decision)

| # | Approval | Needed for |
|---|---|---|
| A1 | Review and merge of `feature/serverless-processing-canonical` into `main` | Everything |
| A2 | Deploy the Django release to dev (`deploy-dev-native.yml` or `dev-release.sh deploy`) | Section 3 |
| A3 | `LaiDevPlatform-dev` stack update: media worker `s3:ListBucket` on the asset bucket (also updates the worker code, section 3.4) | Section 3 |
| A4 | Deploy the worker zip (`deploy-dev-lambda.yml` or `dev-release.sh lambda-deploy`) | Section 3 |
| A5 | Switch `LAI_ASSET_ASYNC_VALIDATION=on` in dev for the acceptance window | Section 4 |
| A6 | Temporarily disable and re-enable the media worker's SQS event source mapping (creates CloudFormation drift until re-enabled) | Sections 4.5, 7, 8 |
| A7 | Stop the dev database outside the schedule (RDS outage drill) | Section 7 |
| A8 | Name the authorized operations administrator(s) for DLQ redrive (ADR-062 B7) | Section 6 |
| A9 | Synthetic test assets only; no child data, photos or audio in any job | Sections 4, 5 |
| A10 | Each rollback in section 11 if it is exercised | Section 11 |

### 0.2 Release content to confirm before starting (repository, no AWS)

On `2333d9e` three items named in the release brief are **not yet in the code**; they are being
made on sibling branches. Acceptance cannot pass until the release commit contains them.

| Item | Check on the release commit | Expected |
|---|---|---|
| Migration `jobs/0003_contract_kinds` (and any later jobs migration) | `ls lai/apps/jobs/migrations/` | `0003_contract_kinds.py` present |
| Contract kinds | `git grep -n "asset.validate_model\|reference.checksum" lai/apps/jobs/core/envelope.py` | Both in `KIND_QUEUE`, queue `media` |
| Flag | `git grep -n "LAI_ASSET_ASYNC_VALIDATION" lai/config/settings/base.py lai/config/settings/production.py` | Default `off`; production requires `LAI_JOBS_BACKEND=sqs` |
| Media role `s3:ListBucket` (pending, `fix/can-s3-missing`) | `git grep -n "ListAssetBucket" infra/lib/devPlatformStack.ts` | A statement on the asset bucket ARN for `mediaRole` |
| Configurable GLB limit (pending, `fix/can-limits`) | `git grep -n "LAI_ASSET_MAX_GLB_BYTES" lai/config/settings/base.py` | Default 52,428,800 (50 MiB), ceiling 50 MiB |
| 90-day retention for validation jobs (pending, `fix/can-retry-retention`) | `git grep -n "RETENTION" lai/apps/jobs/services.py lai/config/settings/base.py` | A separate 90-day rule for `asset.validate_model`; other completed jobs 30 days (`LAI_JOBS_RETENTION_DAYS`) |

```bash
# [OWNER, local, no AWS] the release's own tests (ASYNC_MODEL_VALIDATION.md section 11) and synthesis
make py-install
.venv/bin/python -m pytest -q tests/processing tests/lambda tests/repo/test_canonical_processing_guard.py \
  lai/apps/jobs/tests lai/apps/assets/tests
npm ci && npm run infra:synth:dev
scripts/aws/package-lambda.sh            # prints build/lambda/jobs-worker-<hash16>.zip; record the name
```

Pass: tests green; synthesis succeeds; record the worker zip name, it is the key the release
deploys (`lambda/jobs-worker-<hash16>.zip`, content addressed by `lambda/build.py`).

### 0.3 Environment preconditions

| Check | Command | Pass |
|---|---|---|
| Dev provisioned and installed (README "Complete first-time deployment") | `./scripts/aws/deploy-debug.sh --status` **[OWNER, READ-ONLY]** | All six dev stacks complete |
| Dev running | `./scripts/aws/manage-dev.sh status` **[OWNER, READ-ONLY]** | EC2 running, RDS available, power `running`, readiness 200 |
| No surprise stop during acceptance | `./scripts/aws/manage-dev.sh hold --hours 12` **[OWNER, MUTATING]** | `hold-until` in the future (release it in section 13) |
| Avoid the daily windows | none | Do not run section 7 or 8 near 20:00 UTC (maintenance timer runs `jobs_sweep`; RDS backup window 20:00 to 20:30 UTC) |

---

## 1. Deployment gate verification

Do this **before** the merge (A1), so the merge itself deploys nothing, and again before each
manual dispatch.

### 1.1 The gates, quoted from the workflows

| Workflow (push to `main` paths include) | Job | `if:` condition (quoted) | Runs on merge when |
|---|---|---|---|
| `deploy-dev-native.yml` (`lai/**`, `processing/lai_processing/**`, `scripts/aws/native/**`, ...) | `test` | `vars.LAI_DEV_NATIVE_ENABLED == 'true' && github.ref == 'refs/heads/main' && (github.event_name == 'push' \|\| inputs.action == 'deploy')` | `LAI_DEV_NATIVE_ENABLED` is `true` |
| | `package` | none; `needs: test` | `test` succeeded |
| | `start` | `always() && vars.LAI_DEV_NATIVE_ENABLED == 'true' && github.ref == 'refs/heads/main' && (needs.package.result == 'success' \|\| (...deploy-pending)) && ((github.event_name == 'workflow_dispatch' && inputs.start_if_stopped) \|\| vars.LAI_DEV_STOPPED_DEPLOY == 'start')` | native enabled **and** `LAI_DEV_STOPPED_DEPLOY` is `start` (starts dev from a push) |
| | `deploy` | `always() && needs.package.result == 'success' && (needs.start.result == 'success' \|\| needs.start.result == 'skipped')` | `package` succeeded |
| | `deploy-pending`, `rollback` | `... github.event_name == 'workflow_dispatch' && inputs.action == ...` | never on a push |
| `deploy-dev-lambda.yml` (`lambda/**`, `lai/apps/jobs/core/**`, `processing/lai_processing/**`, ...) | `test` | `vars.LAI_DEV_NATIVE_ENABLED == 'true' && github.ref == 'refs/heads/main'` | `LAI_DEV_NATIVE_ENABLED` is `true` |
| | `deploy` | none; `needs: test` | `test` succeeded |
| `deploy-django-ec2.yml` (`lai/**`, `processing/lai_processing/**`, `scripts/aws/**`, ...) | `test` | `github.event_name == 'push' \|\| inputs.action == 'deploy'` | always (tests only, no AWS, no environment) |
| | `build` | `vars.LAI_DEPLOY_ENABLED == 'true' && github.ref == 'refs/heads/main' && (vars.LAI_DEV_NATIVE_ENABLED != 'true' \|\| (github.event_name == 'workflow_dispatch' && inputs.environment == 'prod'))` | `LAI_DEPLOY_ENABLED` is `true` and native dev is **not** enabled |
| | `deploy-dev` | `vars.LAI_DEV_NATIVE_ENABLED != 'true' && (github.event_name == 'push' \|\| ...)`; `needs: build` | `build` succeeded |
| | `deploy-prod` | `always() && needs.build.result == 'success' && (... \|\| (github.event_name == 'push' && vars.LAI_PROD_AUTO_DEPLOY == 'true' && needs.deploy-dev.result == 'success'))` | build and Docker dev deploy succeeded and `LAI_PROD_AUTO_DEPLOY` is `true` (then waits for `django-prod` reviewers) |
| | `rollback` | `github.event_name == 'workflow_dispatch' && inputs.action == 'rollback' && !(...)` | never on a push (note: **not** gated by `LAI_DEPLOY_ENABLED`) |
| `deploy-site.yml` (`react/**`, ..., `.github/workflows/deploy-site.yml`; **this branch changes that file**) | `backend` | `vars.LAI_SITE_DEPLOY_ENABLED == 'true' && github.ref == 'refs/heads/main' && (github.event_name == 'push' \|\| inputs.action == 'deploy')` | `LAI_SITE_DEPLOY_ENABLED` is `true` |
| | `deploy-dev` | `github.event_name == 'push' \|\| inputs.environment == 'dev'`; `needs: backend` | `backend` succeeded |
| | `deploy-prod` | `always() && needs.backend.result == 'success' && (... \|\| (github.event_name == 'push' && vars.LAI_PROD_AUTO_DEPLOY == 'true' && needs.deploy-dev.result == 'success'))` | site enabled, dev site succeeded, `LAI_PROD_AUTO_DEPLOY` is `true` |
| `manage-dev-infrastructure.yml` | `manage` | `workflow_dispatch` only | never on a push |
| `ci.yml` | all | no AWS | always (safe) |

The merge of this branch touches `lai/`, `lambda/`, `processing/`, `scripts/aws/`,
`pyproject.toml` and four workflow files (`deploy-dev-lambda.yml`, `deploy-dev-native.yml`,
`deploy-django-ec2.yml`, `deploy-site.yml`), so **all four deploy workflows trigger** on the merge
push and the variables decide what they do.

Facts that matter when reading the gates:
- GitHub compares strings in expressions **case-insensitively**: `True` or `TRUE` counts as `true`.
  Use `false` or delete the variable.
- A job's `if:` is evaluated before the job enters its GitHub Environment, so only
  **repository-level** values gate these jobs (the repository is user-owned, so there are no
  organization variables). An environment-level variable with the same name gates nothing; check
  for one anyway and delete it to avoid confusion.
- `scripts/aws/install-debug.sh` (step 4, unless `--skip-github`) **sets
  `LAI_DEV_NATIVE_ENABLED=true`**. Re-running it re-opens the gate.
- The dispatches in section 3 need `LAI_DEV_NATIVE_ENABLED=true` too (the native and Lambda
  workflows check it on `workflow_dispatch` as well). While it is `true`, any push to `main` that
  touches their paths also deploys.

### 1.2 Commands

```bash
# [OWNER, READ-ONLY] repository variables (names and values; none of them is secret)
gh variable list --repo paulj3000/learning
# [OWNER, READ-ONLY] environments and their protection
gh api repos/paulj3000/learning/environments --jq '.environments[] | {name, protection_rules: [.protection_rules[]?.type], deployment_branch_policy}'
# [OWNER, READ-ONLY] variables of each environment the workflows use
for env in dev-backend dev-infrastructure django-dev django-prod site-dev site-prod; do
  echo "== $env"; gh api "repos/paulj3000/learning/environments/$env/variables" --jq '.variables[] | "\(.name)=\(.value)"' || echo "(environment missing)"
done
# [OWNER, READ-ONLY] equivalent per environment
gh variable list --repo paulj3000/learning --env dev-backend
```

GUI: repository **Settings > Secrets and variables > Actions > Variables** (tab "Repository
variables" for the gates; environment variables are listed per environment) and **Settings >
Environments** (`dev-backend`, `dev-infrastructure`, `django-dev`, `django-prod`, `site-dev`,
`site-prod`: deployment branches `main`; required reviewers on `django-prod` and `site-prod`).
These are the existing environments; `processing-dev` and `processing-prod` were superseded by
ADR-064 and must not be created.

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
gh run list --repo paulj3000/learning --commit <merge sha> --json workflowName,conclusion,status
gh run view <run id> --repo paulj3000/learning --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'
```

Pass: no job that assumes an AWS role concluded `success` or `failure`; they are all `skipped`.

```bash
# [OWNER, MUTATING] close the gates before merging (only the ones currently true)
gh variable set LAI_DEV_NATIVE_ENABLED --repo paulj3000/learning --body false
gh variable set LAI_DEPLOY_ENABLED --repo paulj3000/learning --body false
gh variable set LAI_SITE_DEPLOY_ENABLED --repo paulj3000/learning --body false
gh variable set LAI_PROD_AUTO_DEPLOY --repo paulj3000/learning --body false
```

---

## 2. Verify the dev infrastructure (before the release)

All **[OWNER, READ-ONLY]**. Expected values come from `infra/lib/devPlatformStack.ts`
(`DEV_QUEUES`, `DEV_FUNCTIONS`, the `queue()` and `worker()` helpers) at `2333d9e`.

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
  (statement `ListAssetBucket`). Before it, `implicitDeny`: that is the known gap
  (`CANONICAL_PATH.md`, "Remaining work"). `PutObject` and `DeleteObject` on the asset bucket stay
  `implicitDeny`.
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

**Consumer first.** Django (migration `jobs/0003` and any later jobs migration, the new kinds and
handlers, `jobs_consume_results`) is deployed and verified **before** the worker zip. The flag
stays `off`, and nobody uses "Validate in background", until both are verified (a contract-kind
message reaching an old worker is an unknown kind: retried into the media DLQ, its job later
times out).

Automatic pushes do not enforce this order: with `LAI_DEV_NATIVE_ENABLED=true` a push that touches
both path sets starts `deploy-dev-native.yml` and `deploy-dev-lambda.yml` at the same time, and
the Lambda run usually finishes first. That is harmless only while the flag is off and the Admin
action is unused. For this release use the manual sequence below.

### 3.1 Baseline (record before changing anything) [OWNER, READ-ONLY]

```bash
./scripts/aws/dev-release.sh status                       # running release sha, pending, power state
aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Parameters[?ParameterKey=='WorkerCodeKey'].ParameterValue" --output text
for fn in lai-dev-jobs-ai lai-dev-jobs-media; do aws lambda get-function --function-name "$fn" --query 'Configuration.CodeSha256' --output text; done
aws s3api list-objects-v2 --bucket "$ARTIFACTS" --prefix lambda/ --query 'Contents[].{Key:Key,Modified:LastModified}' --output table
# on the instance:
lai_manage showmigrations jobs
lai_manage shell -c "from django.conf import settings as s; print(s.LAI_JOBS_BACKEND, s.LAI_ASSET_ASYNC_VALIDATION, s.LAI_STUDIO_RUN_MODE)"
```

Record: previous Django sha (rollback target), previous `WorkerCodeKey` and both `CodeSha256`
values (worker rollback target; `lambda/` objects are kept 180 days by `LaiDevArtifacts-dev`),
`jobs` migrations applied (expect up to `0002_outbox_dispatch`), `sqs off jobs` (flag `off`).

### 3.2 Deploy Django (consumer) [OWNER, MUTATING, A2]

Option A, GitHub (recommended; the release is tested, packaged for aarch64 and recorded):

```bash
gh variable set LAI_DEV_NATIVE_ENABLED --repo paulj3000/learning --body true   # opens the gate; no other push to main until 3.5
gh workflow run deploy-dev-native.yml --repo paulj3000/learning --ref main -f action=deploy
gh run watch --repo paulj3000/learning "$(gh run list --repo paulj3000/learning --workflow deploy-dev-native.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Option B, workstation (`scripts/aws/dev-release.sh`, same steps as the workflow):

```bash
SHA=$(git rev-parse HEAD); EPOCH=$(git log -1 --format=%ct HEAD)
./scripts/aws/dev-release.sh package --git-sha "$SHA" --commit-epoch "$EPOCH"
./scripts/aws/dev-release.sh upload --git-sha "$SHA"
./scripts/aws/dev-release.sh deploy --git-sha "$SHA"
```

Migration `0003` removes and re-adds the `jobs_kind_valid` check constraint and adds two
columns; the destructive-operation guard in `scripts/aws/native/deploy-native.sh` matches only
"Remove field", "Delete model", "Rename field", "Rename model" and "Raw SQL operation", so **no**
`allow_destructive_migrations` is needed. If the run asks for it, stop: something else is in the
release.

### 3.3 Verify Django [OWNER, READ-ONLY]

```bash
./scripts/aws/dev-release.sh status
./scripts/aws/manage-dev.sh logs deploy --since 30m
./scripts/aws/manage-dev.sh logs jobs --since 15m        # jobs-consumer.log: no tracebacks; "jobs.relay" lines at most once a minute when there is work
# on the instance:
lai_manage showmigrations jobs                           # [X] 0003_contract_kinds (and later)
systemctl is-active lai-gunicorn lai-jobs-consumer       # active active
lai_manage jobs_sweep --dry-run                          # JSON counts; no error
curl -fsS https://<api host>/api/v1/health/ready/        # via the site: https://<site>/api/v1/health/ready/
```

Then a legacy-kind smoke on the **old** worker (proves the consumer applies existing kinds): in
Django Admin, on a published test GLB version, run **Inspect in background** (`asset.inspect`);
the job becomes Completed within about a minute.

Pass: `0003` applied, both services active, readiness 200, the `asset.inspect` job Completed,
all DLQs still 0 (`depth lai-dev-jobs-media-dlq`).

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
queues. Anything else: stop and review.

If the IAM change is not approved yet, deploy the worker alone instead (case G4 is then expected
to fail with 403, section 4.5):

```bash
gh workflow run deploy-dev-lambda.yml --repo paulj3000/learning --ref main     # Option A
./scripts/aws/dev-release.sh lambda-deploy                                     # Option B
```

### 3.5 Verify the worker [OWNER, READ-ONLY]

```bash
for fn in lai-dev-jobs-ai lai-dev-jobs-media; do
  aws lambda get-function --function-name "$fn" --query '{Sha:Configuration.CodeSha256,Status:Configuration.LastUpdateStatus,Location:Code.RepositoryType}' --output json
done
aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Parameters[?ParameterKey=='WorkerCodeKey'].ParameterValue" --output text
./scripts/aws/manage-dev.sh logs lambda-media --since 15m
```

Pass: `LastUpdateStatus` `Successful`; `WorkerCodeKey` equals the name from 0.2; repeat the
`asset.inspect` smoke, Completed; DLQs 0. Close the gate if you want no further automatic
deploys: `gh variable set LAI_DEV_NATIVE_ENABLED --repo paulj3000/learning --body false`.

### 3.6 Switch the flag on for acceptance [OWNER, MUTATING, A5]

The flag is an SSM parameter under `/lai/dev/django/` (the renderer accepts `LAI_*` names); it
takes effect when the runtime configuration is re-rendered, which a deploy of the running commit
does (`deploy-native.sh` step 3; the same commit is not "older", so it is accepted).

```bash
aws ssm put-parameter --name /lai/dev/django/LAI_ASSET_ASYNC_VALIDATION --type String --value on --overwrite
./scripts/aws/dev-release.sh deploy --git-sha <running sha>     # the release deployed in 3.2
lai_manage shell -c "from django.conf import settings as s; print(s.LAI_ASSET_ASYNC_VALIDATION)"   # on
```

---

## 4. GLB acceptance cases (core)

### 4.1 Preparation

- In Django Admin create a **synthetic** test asset (for example `lai011-acceptance-model`), never
  linked to a child, region or published content. Use a staff account with upload, view and
  publish permissions on asset versions.
- Files (local, no AWS):
  - **valid:** `react/public/models/kenney-rock-small.glb` (checked into the repository);
  - **invalid but synchronously acceptable** (the validator refuses a non-finite node
    translation, the local demo's case 9):

    ```bash
    python3 - react/public/models/kenney-rock-small.glb /tmp/lai011-broken.glb <<'PY'
    import json, struct, sys
    data = open(sys.argv[1], 'rb').read()
    jlen, = struct.unpack_from('<I', data, 12)
    doc = json.loads(data[20:20 + jlen]); rest = data[20 + jlen:]
    doc['nodes'][0].pop('matrix', None); doc['nodes'][0]['translation'] = [10**400, 0, 0]
    j = json.dumps(doc, separators=(',', ':')).encode(); j += b' ' * (-len(j) % 4)
    out = struct.pack('<4sII', b'glTF', 2, 20 + len(j) + len(rest)) + struct.pack('<II', len(j), 0x4E4F534A) + j + rest
    open(sys.argv[2], 'wb').write(out)
    PY
    ```

    Check it locally first: `LAI_JOBS_BACKEND=inline LAI_ASSET_ASYNC_VALIDATION=on make runserver`,
    upload it; it must end `REJECTED` (not refused at upload). If it is refused synchronously,
    pick another validator-only finding from `GLB_VALIDATION.md`.
  - **oversized:** a GLB header followed by padding, 53,000,000 bytes (above the 52,428,800-byte
    limit, below nginx's `client_max_body_size 55m` = 57,671,680 bytes, so Django, not nginx,
    refuses it):

    ```bash
    python3 -c "import struct; n=53_000_000; open('/tmp/lai011-oversized.glb','wb').write(struct.pack('<4sII', b'glTF', 2, n) + b'\0'*(n-12))"
    ```

- Helpers for every case: the job id is on the version's "Background validation" section and in
  Admin, Jobs, Processing jobs; on the instance `jobs_for <version uuid>` and `version <version uuid>`.

### 4.2 G1: valid upload, DRAFT, validated, explicit publish [OWNER, MUTATING]

1. Upload the valid GLB as a new version of the test asset.
2. Immediately try **Publish**: refused with `not_validated` (the version is still a draft). The
   second gate, `processing_required`, refuses a GLB without a passing job for exactly this file
   (`ASYNC_MODEL_VALIDATION.md` section 8).
3. Wait about a minute; refresh.
4. Publish explicitly.

```bash
version <uuid>; jobs_for <uuid>
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

Upload `/tmp/lai011-broken.glb`. Pass: upload accepted as `DRAFT`; job `completed` (a bad model is
a successful job with verdict `fail`), `subject_outcome=version_rejected`, version `REJECTED`,
findings appended to the validation report with `source: processing`; Publish refused; DLQs 0.

### 4.4 G3: a duplicate result, and a duplicate submission [OWNER, MUTATING]

Duplicate **result** (needs the owner's administrator credentials; the instance and GitHub roles
cannot send to the results queue):

```bash
aws s3 cp "s3://$ARTIFACTS/jobs/results/<G1 job id>.json" /tmp/lai011-dup.json
wc -c /tmp/lai011-dup.json      # must be under 200 KB (otherwise the worker sent a pointer; then skip)
aws sqs send-message --queue-url "$RESULTS_Q" --message-body file:///tmp/lai011-dup.json --query MessageId --output text
./scripts/aws/manage-dev.sh logs jobs --since 5m          # "jobs.result duplicate id=<G1 job id>"
```

Duplicate **submission**: select the G1 version and run **Validate in background** again.

Pass: the consumer logs `duplicate` and deletes the message (results queue back to 0, results DLQ
0); the G1 version and its `validated_at` are unchanged; the Admin action reports the existing job
for the same file (no second job: `jobs_for <G1 uuid>` still lists one validation job).

### 4.5 G4: missing object (expects 404 and `input_missing`, not 403) [OWNER, MUTATING, A6]

The media worker is held back so the object can disappear between upload and validation.

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

Pass (with the `ListAssetBucket` statement): one delivery; the job `failed` with
`error_code=input_missing`, `subject_outcome=processing_failed`; the version stays `DRAFT`; the
media DLQ stays 0; the worker log shows `job.finished` with status `failed`.

Fail signature (no `s3:ListBucket`): S3 answers 403, the worker logs `job.retry` with a storage
code, the message is received 3 times and lands in `lai-dev-jobs-media-dlq` (alarm
`lai-dev-media-dead-letters` fires), and the job stays `running` until `jobs_sweep` fails it as
`timeout`. Record it, then clear the DLQ through section 6 after the IAM change.

Confirm the mapping is `Enabled` again before continuing (A6: the template says `Enabled: true`).

### 4.6 G5: oversized [OWNER, MUTATING]

Upload `/tmp/lai011-oversized.glb`. Pass: refused synchronously with `too_large` (the message names
the 52,428,800-byte GLB limit); no version row, no new job (Admin, Processing jobs), and no new
object under the asset's prefix:

```bash
aws s3api list-objects-v2 --bucket "$ASSETS" --prefix "assets/models/<asset id>/" --query 'Contents[].{Key:Key,Size:Size}' --output table
```

Optional (only if the owner wants to see the configurable limit): set
`/lai/dev/django/LAI_ASSET_MAX_GLB_BYTES` to a smaller value (at least 1,048,576), redeploy the
running commit as in 3.6, and confirm a GLB above that size is refused; then delete the parameter
and redeploy again. Values above 50 MiB are refused at startup (the profile's ceiling).

### 4.7 G6: retry and resubmission [OWNER, MUTATING]

Continue from G4:

```bash
aws s3api delete-object --bucket "$ASSETS" --key "$KEY" --version-id <MarkerVersion>   # removes the delete marker: the object is back
aws s3api head-object --bucket "$ASSETS" --key "$KEY" --query ContentLength
```

Then select the G4 version and run **Validate in background**.

Pass: a **new** job id (a `failed` job may be resubmitted; same idempotency key, new attempt id);
it completes with `version_validated`; the version moves `DRAFT` to `VALIDATED`; the failed G4
job stays as history; explicit publish now succeeds.

### 4.8 Retention (requires the 90-day rule on the release commit)

```bash
lai_manage jobs_sweep --dry-run
```

Pass: the JSON reports the timeouts and deletions it would make, with validation jobs counted
under the 90-day rule and other completed kinds under `LAI_JOBS_RETENTION_DAYS` (30). Record
the field names the landed code prints. Failed jobs are never deleted by the sweep.

### 4.9 Close the GLB session

Retire the test asset in Admin (do not delete published versions). Keep the flag `on` only for
sections 6 to 8, then switch it off as in 11.1.

---

## 5. Optional Wave 4 acceptance (NPC animation and audio inspection)

**Not part of core acceptance.** Only if the release commit contains the Wave 4 kinds
(`asset.analyze_animation`, LAI-LAMBDA-009; `asset.process_audio` phase 1, LAI-LAMBDA-008). On
`2333d9e` neither exists; both are on the Wave 4 integration branch
`feature/serverless-processing-wave4` (migration `jobs.0004_wave4_inspection_kinds`), not merged. Rules from `WAVE4_HANDOFF.md`: one jobs migration (`0004_...`) for the Wave 4 kinds,
consumer first, standard library only, no artifact writes, no child audio.

| # | Check | Command or action | Pass |
|---|---|---|---|
| W0 | Kinds and migration on the release | `ls lai/apps/jobs/migrations/`; `git grep -n "analyze_animation\|process_audio" lai/apps/jobs/core/envelope.py` | `0004_*` present; both kinds mapped to `media` |
| W1 | Zip stays within budget and standard library | `scripts/aws/package-lambda.sh` and `.venv/bin/python -m pytest -q tests/lambda/test_jobs_worker_package.py tests/processing/test_processing_runtime_independence.py` | Size under 2 MiB; tests green |
| W2 | Release order | Section 3 again (Django with `0004` first, then the worker) | As section 3 |
| W3 | NPC animation inspection | Submit the kind for a synthetic rigged GLB through the action the landed branch documents | Job `completed`; clip names, durations, targets and skins reported; Django's comparison to `apps.npcs.vocabulary.ANIMATION_STATES` shown; **no** change to `NpcModelVariant.animation_map`; a published version gets `result_recorded` only; GLB validator version unchanged (no `processor_outdated` at the publication gate) |
| W4 | Audio inspection | Submit for a synthetic WAV, Ogg and MP3 (staff content only) | Header facts reported; no transcoding, no loudness, nothing written; audio still on the synchronous upload path (`ASYNC_FORMATS` is GLB only) |
| W5 | Failure paths | A truncated audio file; a GLB with no animations | Failed or `fail` verdict with a contract code; DLQs 0 |
| W6 | Rollback | Section 11 | Same as core |

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

Source: the message left in `lai-dev-jobs-media-dlq` by G4 without `ListBucket`, or one
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
| Worker health | `AWS/Lambda` `Invocations`, `Errors`, `Throttles`, `Duration` (p99), `ConcurrentExecutions` for both functions | Errors 0 outside drills; media `Duration` well under 120,000 ms; no throttles |
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
./scripts/aws/dev-release.sh deploy --git-sha <running sha>      # re-renders the configuration
```

Effect: new GLB uploads are synchronous again; existing `DRAFT` versions keep their jobs, which
still complete; the publication gate stops applying. Wait until no `asset.validate_model` job is
`pending` or `running` (Admin, Processing jobs, filter by kind) and the media queue is 0 before
11.2.

### 11.2 Previous worker zip

```bash
PREV=lambda/jobs-worker-<previous hash16>.zip                    # from 3.1
aws s3api head-object --bucket "$ARTIFACTS" --key "$PREV" --query ContentLength
for fn in lai-dev-jobs-ai lai-dev-jobs-media; do
  aws lambda update-function-code --function-name "$fn" --s3-bucket "$ARTIFACTS" --s3-key "$PREV" --query LastUpdateStatus
done
# or: aws s3 cp "s3://$ARTIFACTS/$PREV" build/rollback/ && ./scripts/aws/dev-release.sh lambda-deploy --zip "build/rollback/$(basename "$PREV")"
```

The stack's `WorkerCodeKey` still names the new zip until the next `deploy-debug.sh` run, which
packages its checkout again: run that from the commit you want, or the rollback is undone. A
`deploy-dev-lambda.yml` dispatch deploys `main`'s HEAD, so it cannot roll back by itself. The IAM
statement `ListAssetBucket` may stay; it is harmless to the old worker.

### 11.3 Django rollback

```bash
gh workflow run deploy-dev-native.yml --repo paulj3000/learning --ref main -f action=rollback                     # previous healthy release
gh workflow run deploy-dev-native.yml --repo paulj3000/learning --ref main -f action=rollback -f rollback_to=<full sha>
./scripts/aws/dev-release.sh rollback [--to <full sha>]                                                          # workstation equivalent
```

The rollback job needs `LAI_DEV_NATIVE_ENABLED=true` and dev running (exit 7 otherwise). It
re-renders configuration, switches `/opt/lai/current`, restarts and checks health. Migrations are
never reversed; the record says `manual_db_review_required` when later releases applied any.

**Is `jobs/0003` backward compatible? Not for writes.** `0003` adds `idempotency_key` and
`subject_outcome` as `CharField(blank=True)` with no database default. Django adds such a column
with a temporary default for existing rows and then drops the default, so the column ends
`NOT NULL` without a default. Code from before `0003` does not know these columns, so its
`ProcessingJob` inserts (Question Studio chunks, speech pre-generation, `asset.inspect`) would fail
with a not-null violation after a Django rollback. Reads and updates of existing rows still work,
the kind constraint still admits the old kinds, and the old consumer would leave results of the
new kinds unapplied (unknown handler, results DLQ after 5 receives).

Confirm before the release (local, no AWS): `cd lai && ../.venv/bin/python manage.py sqlmigrate jobs 0003`
shows `ADD COLUMN ... DEFAULT '' NOT NULL` followed by `ALTER COLUMN ... DROP DEFAULT`.

Consequences:
- Prefer **roll forward** (a fix on top of the release) over a Django rollback past `0003`.
- If a rollback past `0003` is unavoidable: switch Studio to `manual` and stop using background
  actions, or (owner-approved database change, recorded) give both columns a database default
  of `''` so the old code can insert:
  `ALTER TABLE jobs_processingjob ALTER COLUMN idempotency_key SET DEFAULT '', ALTER COLUMN subject_outcome SET DEFAULT '';`
  (through `manage-dev.sh db-tunnel`). Remove the defaults again before rolling forward, or
  leave them; they do not conflict with the new code.
- A follow-up code change could make `0003` safe by declaring `db_default=""` on both fields; this
  is a recommendation for the release owner, not part of this document.
- The first ever dev deployment has nothing to roll back to (exit 63).

---

## 12. Future native-runtime acceptance (not in scope, not approved)

Listed only to keep it apart from this release. Workloads that need native tools (GLB
optimization, LAI-LAMBDA-010; audio transcoding and loudness, LAI-LAMBDA-008 phase 2; possibly
image conversion and thumbnails, LAI-LAMBDA-013) need their own ADR first (`WAVE4_HANDOFF.md`
decisions W4-1 to W4-4). Dev has no ECR (ADR-064). When such an ADR exists, its acceptance would
add: the image source, registry and immutable digest; scanning; cold start and size; arm64 build;
tool licences; no network in the processing sandbox; time, memory and `/tmp` bounds below the
job limits; a decision for durable derived files (W4-4); and the same consumer-first, DLQ, outage
and rollback checks as sections 3, 6, 7 and 11. Nothing in this checklist covers that.

---

## 13. Close out [OWNER, MUTATING]

```bash
./scripts/aws/manage-dev.sh release-hold
aws lambda get-event-source-mapping --uuid "$MEDIA_ESM" --query State --output text           # Enabled
aws ssm get-parameter --name /lai/dev/django/LAI_ASSET_ASYNC_VALIDATION --query Parameter.Value --output text   # off, unless the owner keeps it on
gh variable list --repo paulj3000/learning                                                    # gates back to the owner's chosen values
for q in lai-dev-jobs-ai-dlq lai-dev-jobs-media-dlq lai-dev-job-results-dlq; do depth "$q"; done
```

---

## 14. Evidence capture

Rules: pipe every output through `redact` (12-digit account ids become `<account>`); never paste
secrets, tokens, `django.env`, `DATABASE_URL`, presigned URLs or e-mail addresses; job and version
UUIDs, commit SHAs, queue names and codes are fine. Keep raw transcripts outside the repository;
paste only the redacted lines that prove each "Pass".

| Step | Date (UTC) | Run by | Command or run URL | Result (Pass/Fail/Skipped) | Evidence (redacted excerpt or link) | Judged by |
|---|---|---|---|---|---|---|
| 0.2 Release content | | | | | | |
| 1.3 Gates safe at merge | | | | | | |
| 2.1 to 2.7 Infrastructure | | | | | | |
| 3.2 to 3.3 Django | | | | | | |
| 3.4 to 3.5 IAM and worker | | | | | | |
| 4.2 G1 valid | | | | | | |
| 4.3 G2 invalid | | | | | | |
| 4.4 G3 duplicate | | | | | | |
| 4.5 G4 missing object | | | | | | |
| 4.6 G5 oversized | | | | | | |
| 4.7 G6 retry and resubmission | | | | | | |
| 4.8 Retention | | | | | | |
| 5 Wave 4 (optional) | | | | | | |
| 6 DLQ redrive | | | | | | |
| 7 RDS outage | | | | | | |
| 8 Overnight stop and start | | | | | | |
| 9 Monitoring | | | | | | |
| 10 Cost | | | | | | |
| 11 Rollback (if exercised) | | | | | | |

LAI-LAMBDA-011 is accepted when every core row is Pass (or Skipped with an owner-signed reason),
no DLQ holds an unexplained message, and the flag and gates are at the owner's chosen values.
