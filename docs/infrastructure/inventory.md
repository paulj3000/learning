# Infrastructure inventory (LAI-INFRA-001)

Date: 2026-11-09. Trello: [LAI-INFRA-001](https://trello.com/c/Bly5qEcy). Base: `main` at
`123ffbd`. Docs only: no AWS resource, workflow or definition was changed.

This is the input for LAI-INFRA-002 (resource ownership and duplicate stack audit) and
LAI-INFRA-005 (reconciliation report). It records what each definition would create, what is
known to be deployed, and where ownership is uncertain. It does not decide ownership; that is
LAI-INFRA-002.

## 1. Evidence and its limits

| Label | Meaning |
|---|---|
| **[repo]** | Read from source on `main` at `123ffbd` in this task |
| **[owner-cli 2026-11-01]** | The owner's own read-only CLI calls, recorded in `docs/IMPLEMENTATION_STATUS.md` ("Child photo dev deployment and acceptance attempt") |
| **[qa 2026-11-07]** | Recorded in `docs/AI_BEDROCK_CHATTY_QA_REPORT.md` ("Live run with the deployed Guardrail") |
| **[inferred]** | Deduced from code comments; not observed |

**No live verification was possible in this task.** The session had no AWS CLI and could not
install one (the package registries and every `*.amazonaws.com` endpoint were refused by the
session's network policy), and the GitHub Actions and environments API paths were refused too.
`.claude/settings.json` also denies `Bash(aws:*)` to Claude Code on the owner's machine. Every
"deployed" claim below therefore comes from the dated records above and may be stale. The
read-only commands in section 8 confirm them.

`infra:synth` was not run either (`npm ci` could not reach the registry). Resource lists for the
CDK stacks are from reading `infra/lib/*.ts`, cross-checked with the resource summary recorded
when the stacks last synthesized on 2026-11-01.

## 2. Account, region and environments

| Item | Value | Evidence |
|---|---|---|
| AWS account | `008331939914` (shared with other Amplify projects; no separate dev account) | [owner-cli 2026-11-01] |
| Region | `us-west-1` everywhere: Amplify sandbox outputs, `provision.sh` default, workflow default (`vars.LAI_AWS_REGION \|\| 'us-west-1'`), Guardrail stack | [repo], [owner-cli 2026-11-01] |
| Principals seen | SSO role `amplify-policy` (owner's CLI); IAM user `learning-dev` (QA, local `make runserver` profile) | [owner-cli 2026-11-01], [qa 2026-11-07] |
| Environments in code | CDK: `dev`, `prod` (`LAI_ENV`). GitHub environments: `django-dev`, `django-prod`. Amplify: Hosting branch `main` plus personal sandboxes | [repo] |
| CloudFormation stacks seen | Only `CDKToolkit` among non-Amplify stacks on 2026-11-01, plus the Amplify backend stacks; then `LaiAiGuardrailOnly-dev` from 2026-11-07 | [owner-cli 2026-11-01], [qa 2026-11-07] |

## 3. Definition sources

| # | Path | Tool | Deploys through | Status |
|---|---|---|---|---|
| 1 | `infra/bin/app.ts`, `infra/lib/*.ts`, `infra/cdk.json` | AWS CDK (bootstrapless synthesizer, no assets) | `scripts/aws/provision.sh <env> [--execute] [--only <stack>]`, or `aws cloudformation deploy` / `cdk deploy` by hand. Never by a push | 5 stacks per env (section 4) |
| 2 | `amplify/backend.ts`, `amplify/{auth,data,storage}/resource.ts`, `amplify/functions/*` | Amplify Gen 2 (CDK underneath) | Amplify Hosting build (`amplify.yml`: `ampx pipeline-deploy` on every build of a connected branch), or `ampx sandbox` | Deployed for `main` [inferred] (section 5) |
| 3 | `amplify.yml`, `customHttp.yml`, `amplify-hosting/custom-rules.json` | Amplify Hosting build spec, headers, rewrites | Amplify Hosting console app | App exists [inferred]; app id unknown |
| 4 | `.github/workflows/deploy-django-ec2.yml`, `.github/actions/django-release/action.yml` | GitHub Actions | Push to `main` on Django paths, or manual dispatch | Workflow present; build/deploy jobs gated by `vars.LAI_DEPLOY_ENABLED == 'true'` |
| 5 | `deploy/ec2/docker-compose.yml`, `deploy/ec2/nginx/default.conf.template` | Docker Compose and nginx on the EC2 host | Copied by the SSM deploy document (`scripts/aws/deploy-django.sh`) | Not running: no EC2 host exists |
| 6 | `scripts/aws/*.sh` | Shell (provision, setup, deploy, rollback, status, bootstrap) | Operator or SSM | `setup-ec2.sh` and `ssm-release-entry.sh` are embedded in the EC2 stack at synth time |
| 7 | `.github/workflows/ci.yml` | GitHub Actions | Push/PR | Tests only; assumes no AWS role |
| 8 | `docker-compose.yml` (root) | Local PostgreSQL 16 | Developer machine | Local only; no AWS |
| 9 | `lai-dev-complete.yaml` (standalone CloudFormation) | CloudFormation | Unknown | **Absent.** Not in the repository, in any of its 30 branches' history (by file name and content), or named in any doc. **Requested from the owner** (section 7, blocker B1) |

There is no other CloudFormation, SAM, Terraform or Serverless definition in the repository.

## 4. CDK app (`infra/`)

All stacks tag `Project=learning-adventure-island`. `prod` stacks have termination protection.
Settings come from CDK context or the environment (`infra/bin/app.ts` header table).

### 4.1 Stack summary

| Stack | Scope | File | Deploy order | Deployed? |
|---|---|---|---|---|
| `LaiAssetStorage-<env>` | per env | `infra/lib/assetStorageStack.ts` | 1 | **No** (dev, prod) [owner-cli 2026-11-01] |
| `LaiChildPhotos-<env>` | per env | `infra/lib/childPhotoStorageStack.ts` | 2 | **No** [owner-cli 2026-11-01] |
| `LaiDjangoRelease` | account | `infra/lib/djangoReleaseStack.ts` | 3 | **No** [owner-cli 2026-11-01] |
| `LaiDjangoEc2-<env>` | per env | `infra/lib/djangoEc2Stack.ts` | 4 (needs 1, 2, 3) | **No** [owner-cli 2026-11-01] |
| `LaiAiGuardrail-<env>` | per env | `infra/lib/aiGuardrailStack.ts` | 5 (needs 4) | **No**; see `LaiAiGuardrailOnly-dev` (4.6) |

`scripts/aws/provision.sh` deploys stacks 1 to 4 only. `LaiAiGuardrail-<env>` is not in the
script; `docs/AI_SERVICE.md` section 9 deploys it by hand.

### 4.2 `LaiAssetStorage-<env>`

| Resource | Name / key settings |
|---|---|
| S3 bucket | `lai-assets-<env>-<account>-<region>`; SSE-S3, versioned, noncurrent versions expire after 30 days, optional CORS from `allowedOrigins`, `RETAIN` |
| IAM managed policy | `lai-django-asset-storage-<env>`; attached to `lai-django-ec2-<env>` by name, or to `djangoRoleArn` |
| Outputs | `AssetBucketName`, `AssetBucketRegion`, `DjangoAssetStoragePolicyArn` |

### 4.3 `LaiChildPhotos-<env>` (ADR-042)

| Resource | Name / key settings |
|---|---|
| S3 bucket | `lai-child-photos-<env>-<account>-<region>`; SSE-S3, TLS 1.2+, versioned, noncurrent expiry `NONCURRENT_RETENTION_DAYS` (7), CORS only if `photoAllowedOrigins`, `RETAIN` |
| IAM managed policy | `lai-django-child-photos-<env>` |
| Outputs | `ChildPhotoBucketName`, `ChildPhotoBucketRegion`, `DjangoChildPhotoPolicyArn` |

### 4.4 `LaiDjangoRelease` (account-wide, termination protected)

| Resource | Name / key settings |
|---|---|
| IAM OIDC provider | `token.actions.githubusercontent.com`, `RETAIN`. Created only when `createOidcProvider` is not `false`; **one per account**, so it collides if another project in the shared account already has it |
| ECR repository | `lai/django`; immutable tags, scan on push, untagged after 7 days, newest 100 kept, `RETAIN` |
| IAM role | `lai-github-image-publisher`; trusts `repo:paulj3000/learning:ref:refs/heads/main`; push to `lai/django` only |
| Outputs | `RepositoryUri`, `ImagePublisherRoleArn`, `GithubOidcProviderArn` |

### 4.5 `LaiDjangoEc2-<env>` (ADR-037; prod termination protected)

Parameters: `ApiDomainName`, `AmiId` (pinned AL2023 x86_64), `InstanceType` (default `t3.medium`),
`CognitoUserPoolId`, `CognitoAllowedClientIds`, `AlarmEmail`. Context: `databaseMode`
(`rds` default; `container` dev only), `multiAz`, `hostedZoneId`/`hostedZoneName`.

| Area | Resources |
|---|---|
| Network | VPC `10.40.0.0/16` (dev) / `10.41.0.0/16` (prod), 2 AZs, public and isolated `data` subnets, **no NAT gateway**; SGs for ALB (80/443 in), instance (8080 from ALB only, 443 out), database (5432 from instance) |
| Compute | EC2 instance `lai-django-<env>`, public subnet with public IP, IMDSv2 (hop limit 2), 30 GiB encrypted gp3 root; user data runs `scripts/aws/setup-ec2.sh` |
| Database (`rds`) | RDS PostgreSQL 16 `lai-django-<env>`, `t4g.micro`, **Single-AZ by default**, gp3 20 to 100 GiB, encrypted, `rds.force_ssl=1`, backups 7 d (dev) / 14 d (prod), deletion protection, `SNAPSHOT` on removal; secret `lai/<env>/django/database` |
| Database (`container`) | 20 GiB encrypted EBS volume on `/dev/sdf` instead of RDS |
| Load balancer | Internet-facing ALB, HTTPS 443 (ACM cert for `ApiDomainName`, DNS validation) and 80 to 443 redirect; target group on 8080, health `/api/v1/health/ready/`; deletion protection in prod |
| DNS | Route 53 alias `ApiDomainName` to the ALB **only if** a hosted zone is given; otherwise a manual CNAME |
| WAF | Regional Web ACL, `admin-login-rate` rule (100 POSTs to `/admin/login` per IP per 5 min), associated with the ALB |
| IAM | Instance role `lai-django-ec2-<env>` (SSM core, ECR pull, SSM `/lai/<env>/...`, logs, metrics, RDS pre-migration snapshots in prod, plus the two storage policies by name). GitHub deploy role `lai-github-deploy-<env>` (trusts `environment:django-<env>`; `ssm:SendCommand` on the deploy/rollback/status documents and this instance only) |
| SSM | 11 String parameters `/lai/<env>/django/*` (hosts, CSRF, Cognito, bucket names). Documents `lai-django-{deploy,rollback,status,bootstrap,setup}-<env>`. `DJANGO_SECRET_KEY` is a SecureString **written by an operator**, not by the stack |
| Logs | `/lai/<env>/{django,proxy,deploy,ssm}`, `/aws/rds/instance/lai-django-<env>/postgresql`; all `RETAIN` |
| Alarms | SNS topic `lai-django-alarms-<env>` (optional e-mail); alarms `lai-django-<env>-{not-ready,target5xx,memory-high,disk-high,system-status-failed}` (EC2 recover action on the last) and `database-storage-low` (rds mode) |
| Outputs | `InstanceId`, `LoadBalancerDnsName`, `ApiBaseUrl`, `DeployRoleArn`, `DeployDocumentName`, `CertificateArn`, `AlarmTopicArn`, `ParameterPrefix`, `AppLogGroup`, `DatabaseEndpoint`, `DatabaseSecretArn` |

Not defined anywhere in IaC: CloudFront, SQS, Lambda (no custom resources by design), Route 53
hosted zones, Secrets Manager secrets other than the RDS one.

### 4.6 `LaiAiGuardrail-<env>` and the out-of-band `LaiAiGuardrailOnly-dev`

`LaiAiGuardrail-<env>` defines Bedrock Guardrail `lai-child-safety-<env>` and version, managed
policy `lai-django-ai-<env>` (InvokeModel on the `us.anthropic.claude-haiku-4-5-20251001-v1:0`
profile and its destinations us-east-1, us-east-2, us-west-1, us-west-2; ApplyGuardrail), metric
filters on `/lai/<env>/django`, and alarms `lai-django-ai-<env>-*` to `lai-django-alarms-<env>`.
It references the EC2 role, log group and topic by name, so it cannot deploy before
`LaiDjangoEc2-<env>`.

**Deployed outside the repository:** on 2026-11-07, to unblock live Bedrock QA, only the
Guardrail and its version were deployed from a hand-trimmed copy of the synthesized template as
stack **`LaiAiGuardrailOnly-dev`** (us-west-1): Guardrail `lai-child-safety-dev`, version `1`,
`READY` [qa 2026-11-07]. That template is not in the repository. Deploying `LaiAiGuardrail-dev`
later would create a **second** Guardrail with the same name unless `LaiAiGuardrailOnly-dev` is
deleted first or the resource is imported. Flagged for LAI-INFRA-002.

## 5. Amplify Gen 2 backend (`amplify/`)

Deployed per branch by Amplify Hosting; stack names follow `amplify-<appId>-<branch>-branch-<hash>`
(sandbox: `amplify-learningadventureisland-<user>-sandbox-<hash>`). App id is not in the repository.

| Category | Resources | Evidence |
|---|---|---|
| Auth | Cognito user pool (email login), groups `Admins`, `Superusers`; identity pool with authenticated/unauthenticated/group roles; app client | [repo] `amplify/auth/resource.ts` |
| Data | AppSync GraphQL API (user-pool auth); **22 models, one DynamoDB table each**: ParentProfile, ChildProfile, CompanionProfile, AdventureSession, AdventureAction, SkillEvidence, SkillProgress, WorldChange, AIInteractionAudit, SafetyEvent, StoryArtifact, ChildStoryProgress, CoopSession, ChildNpcState, ChildInventory, ChildQuestState, ChildWorldState, Asset, AssetVersion, Island, Adventure, AdventureModel; streams on SafetyEvent and AIInteractionAudit | [repo] `amplify/data/resource.ts`, `backend.ts` |
| AI | AI Kit generation routes `generateCompanionTurn`, `generateTutorTurn` on Claude Haiku 4.5 through the **global** inference profile (`grantBedrockInvoke` patch) | [repo] |
| Functions | `claim-coop-slot`, `submit-adventure-answer`, `get-next-learning-activity` (in the `data` nested stack), `operational-metrics` (stream consumer), plus the stream-activation `Trigger` and two `AwsCustomResource` lookups | [repo] |
| Storage | S3 bucket `learningAdventureIslandMedia` (name generated): `child-photos/{entity_id}/*` (owner identity), `assets/*` (`Admins`) | [repo] `amplify/storage/resource.ts` |
| Monitoring (`OperationalMonitoring` stack) | SNS `OperationalAlertsTopic` (`PILOT_ALERT_EMAIL`), alarms AppSync 5xx/4xx, AI validation failures, HIGH SafetyEvent; dashboard `<rootStack>-operations`; AWS Budget `BedrockMonthlyCostBudget` (50 USD default) | [repo] |
| Hosting | Amplify Hosting app, branch `main`, serves `react/dist`; headers `customHttp.yml`; SPA rewrite `amplify-hosting/custom-rules.json` (not `/api/`) | [repo]; deployed [inferred] from the dashboard-name collision recorded in `backend.ts` and the owner's note that the account "holds the deployed LAI Amplify backend" |

Deployed state of individual Amplify resources, the app id, other connected branches and active
sandboxes: **unverified**. `docs/CURRENT_AWS_RESOURCE_INVENTORY.md` holds the earlier (Aug 2026)
migration dispositions; its model count (17) is now out of date.

## 6. Pipelines

### 6.1 `deploy-django-ec2.yml`

| Item | Value |
|---|---|
| Triggers | Push to `main` touching `lai/**`, `content/**`, `react/public/models/**`, Python requirements, `scripts/aws/**`, `deploy/ec2/**`, `tests/deploy/**`, `.dockerignore`, the workflow; `workflow_dispatch` (env `dev`/`prod`, `deploy`/`rollback`, `rollback_to`, `allow_older`, `allow_destructive_migrations`) |
| Jobs | `test` (always on push or deploy) -> `build` (OIDC `vars.LAI_IMAGE_PUBLISHER_ROLE_ARN`, pushes `lai/django:<sha>`, records digest) -> `deploy-dev` (environment `django-dev`) -> `deploy-prod` (manual, or `vars.LAI_PROD_AUTO_DEPLOY == 'true'` after dev). `rollback` job on dispatch |
| Gate | `build` and everything after it run only when `vars.LAI_DEPLOY_ENABLED == 'true'` |
| GitHub configuration it needs | Repo vars `LAI_DEPLOY_ENABLED`, `LAI_AWS_REGION`, `LAI_IMAGE_PUBLISHER_ROLE_ARN`, `LAI_PROD_AUTO_DEPLOY`; per environment `LAI_DEPLOY_ROLE_ARN`, `LAI_API_BASE_URL`. No secrets (OIDC only) |
| Actual values | **Unverified** (Actions API refused). Because `LaiDjangoRelease` does not exist, the build job can only succeed if `LAI_DEPLOY_ENABLED` is unset or false |

### 6.2 Host runtime (`deploy/ec2/`)

Docker Compose services `django` (`${LAI_IMAGE}`, pinned digest), `proxy`
(`public.ecr.aws/nginx/nginx:1.28-alpine`, host port 8080), `db` (PostgreSQL 16, container mode
only) and a one-off `app`. nginx (`default.conf.template`): listens 8080, `/nginx-health`,
`/api/v1/health/(ready/)` forwarded with `Host: ${LAI_API_HOST}`, everything else to
`django:8000`, 55 MB bodies, 35 s read timeout. These match the EC2 stack's target port and
health path.

### 6.3 Others

`ci.yml` runs checks only. `amplify.yml` deploys the Amplify backend on every connected-branch
build unless `LAI_SKIP_BACKEND_DEPLOY=true`.

## 7. Ownership uncertainty and blockers

| # | Item | Why it is uncertain | For |
|---|---|---|---|
| B1 | `lai-dev-complete.yaml` | **File not provided.** Its resources, stack name and region cannot be compared until the owner supplies it | Owner, then INFRA-002 |
| U1 | Guardrail `lai-child-safety-dev` | Owned by out-of-band stack `LaiAiGuardrailOnly-dev`, but `LaiAiGuardrail-dev` defines the same resource | INFRA-002 |
| U2 | GitHub OIDC provider | One per account; the account is shared. Whether one already exists decides `createOidcProvider` | INFRA-002, section 8 query |
| U3 | Cognito user pool | Owned by the Amplify `main` backend; the Django stack only takes its id as a parameter. It must be detached before any Amplify stack deletion | INFRA-002 |
| U4 | Child photos and assets | Two homes: Amplify Storage bucket (live, identity-scoped keys) and `LaiChildPhotos-<env>` / `LaiAssetStorage-<env>` (not deployed) | INFRA-002 |
| U5 | Bedrock access paths | Amplify routes use the **global** profile; Django uses the **US** profile. Both need model access in the account | INFRA-002 |
| U6 | Alarms and SNS | Amplify `OperationalAlertsTopic` and Budget vs. `lai-django-alarms-<env>`: two alerting topics | INFRA-002 |
| U7 | `lai-admin-static-<env>` bucket | Named by `scripts/release-admin-static.sh` (LAI-0404) but defined by no IaC; ADR-026 (Fargate) era | INFRA-002 |
| U8 | `CDKToolkit` stack | Present in the account, but `infra/` is bootstrapless and Amplify uses its own bootstrap; which project owns it is unknown | INFRA-002 |
| U9 | Amplify app id, branches, sandboxes | Not in the repository; other Amplify projects share the account | Owner query |
| U10 | Route 53 zone and API domain | Optional in code; no zone id, domain or certificate is recorded anywhere | Owner |

Observation outside scope: `.claude/settings.json` (committed) contains a test parent's e-mail
and password in an allow-listed command. Worth removing and rotating; not changed here.

## 8. Read-only verification commands (owner to run)

None of these change anything. Run with the `amplify-policy` SSO role in `us-west-1`.

```bash
aws sts get-caller-identity
aws cloudformation list-stacks --region us-west-1 \
  --query "StackSummaries[?StackStatus!='DELETE_COMPLETE'].[StackName,StackStatus,LastUpdatedTime]" --output table
aws cloudformation describe-stack-resources --stack-name LaiAiGuardrailOnly-dev --region us-west-1
aws bedrock list-guardrails --region us-west-1
aws iam list-open-id-connect-providers
aws amplify list-apps --region us-west-1 --query "apps[].[name,appId,defaultDomain]"
aws amplify list-branches --app-id <appId> --region us-west-1
aws cognito-idp list-user-pools --max-results 60 --region us-west-1
aws ecr describe-repositories --region us-west-1 --query "repositories[].repositoryName"
aws s3api list-buckets --query "Buckets[?starts_with(Name,'lai-') || contains(Name,'learning')].Name"
gh variable list -R paulj3000/learning; gh api repos/paulj3000/learning/environments --jq '.environments[].name'
```

More queries (IAM role quota, CDK bootstrap) are in `docs/IAM_ROLE_AUDIT.md` section 5.
