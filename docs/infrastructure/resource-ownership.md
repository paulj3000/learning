# Resource ownership and duplicate stack audit (LAI-INFRA-002)

Date: 2026-11-09. Trello: [LAI-INFRA-002](https://trello.com/c/MmdQrT6I). Base: `main` at
`f2aece6` (LAI-INFRA-001 merged). Matrix rows updated by LAI-INFRA-005 (2026-11-09, `main` at
`02820d1`) for the LAI-INFRA-003 and LAI-INFRA-004 outcomes; `reconciliation-report.md` has the
validation. Docs only: no AWS resource, workflow or definition was changed.

Input: `docs/infrastructure/inventory.md` (LAI-INFRA-001); evidence labels are the same
(**[repo]**, **[owner-cli 2026-11-01]**, **[qa 2026-11-07]**, **[inferred]**), plus **[card]** for
statements made only in a Trello card description. Feeds LAI-INFRA-003 (domains, hosting,
security), LAI-INFRA-004 (deployment automation) and LAI-INFRA-005 (reconciliation report).

## 1. Scope and limits

- **The standalone CloudFormation template `lai-dev-complete.yaml` is still missing** (blocker
  B1 in the inventory). The card asks to compare it against CDK. That comparison
  cannot be done. What is known about the template comes only from the
  [DevOps main release card](https://trello.com/c/o6fsCtBN): it defines an EC2/RDS/VPC stack and
  an S3 + CloudFront frontend **[card]**. Section 5 gives the checklist to run once the file is
  supplied. Per the card, this audit **does not assume the template owns any deployed stack**.
- **No live verification.** AWS CLI calls were refused by this session's permission settings,
  as in LAI-INFRA-001. Deployed state is from the dated records only and may be stale.
- Ownership below is a **proposal** for owner approval, not a change. Nothing is imported,
  deleted, renamed or deployed.

## 2. Rules used to pick one owner per resource

1. **Deployed beats proposed.** A resource that exists stays with the stack that created it,
   unless the owner approves an import or a replacement.
2. **Repository IaC beats out-of-band.** Anything deployed from a template that is not in the
   repository (today `LaiAiGuardrailOnly-dev`, and possibly `lai-dev-complete.yaml`) is moved into
   a repository stack or deleted, never left as a second source of truth.
3. **One physical name, one stack.** Most `infra/` resources have fixed physical names
   (section 4). Two stacks that name the same resource cannot both succeed.
4. **Account-wide singletons have one account-wide owner** (GitHub OIDC provider, ECR
   repository, CDK bootstrap), even though the account is shared with other projects.
5. **The Django target owns new backend resources; retained legacy resources stay untouched**
   (CLAUDE.md section 18, ADR-019, ADR-042): the retained legacy DynamoDB tables and S3 buckets
   from the retired backend are not changed or deleted without separate owner approval.

## 3. Ownership matrix

"Deployed" is from **[owner-cli 2026-11-01]** unless marked. "Status": **Evidence** means the
repository and records leave one candidate; **Proposed** means a choice this audit recommends;
**Owner** means it needs an owner decision (section 7).

### 3.1 Network, compute, database, edge

| Resource | Candidate definitions | Deployed today | Proposed owner | Duplicate / risk | Status |
|---|---|---|---|---|---|
| VPC, subnets, security groups | `LaiDjangoEc2-<env>` (`10.40.0.0/16` dev, `10.41.0.0/16` prod); `lai-dev-complete.yaml` **[card]** | No | `LaiDjangoEc2-<env>` | The YAML would create a second VPC with its own EC2 and RDS. VPCs have no fixed names, so it would not fail: it would silently **duplicate** the whole environment | Owner (D1) |
| EC2 instance | `LaiDjangoEc2-<env>` (`lai-django-<env>`, tag-named); YAML **[card]** | No | `LaiDjangoEc2-<env>` | Same as VPC: a silent duplicate. A changed `AmiId` replaces the instance (by design, only with `--refresh-ami`) | Owner (D1) |
| ALB, target group, listeners | `LaiDjangoEc2-<env>` | No | `LaiDjangoEc2-<env>` | Not in the YAML as far as known. Host-based admin routing (INFRA-003) is an in-place listener change | Evidence |
| RDS PostgreSQL 16, Single-AZ, parameter group | `LaiDjangoEc2-<env>` (`instanceIdentifier: lai-django-<env>`, `rds` mode); YAML **[card]** | No | `LaiDjangoEc2-<env>` | Fixed identifier: a second stack with the same identifier fails. A YAML database with another identifier is a silent duplicate. Switching `container` to `rds` mode creates a new database (no data move) | Owner (D1) |
| RDS secret | `LaiDjangoEc2-<env>` (`lai/<env>/django/database`) | No | `LaiDjangoEc2-<env>` | Fixed name | Evidence |
| EBS data volume (`container` mode) | `LaiDjangoEc2-<env>`, dev only | No | `LaiDjangoEc2-<env>` | `SNAPSHOT` on removal | Evidence |
| CloudFront distribution | **`LaiFrontend-<env>`** (`infra/lib/frontendStack.ts`, LAI-INFRA-003); the YAML **[card]** also defines one | No | **`LaiFrontend-<env>`** (us-east-1) | Deploying the YAML's frontend as well would create a second distribution silently (no fixed name) | Defined (INFRA-003); deploy needs approval |
| Frontend S3 bucket | **`LaiFrontend-<env>`**: `lai-web-<env>-<account>-us-east-1`, private, OAC; the YAML **[card]** | No | **`LaiFrontend-<env>`** | Fixed name, `RETAIN` | Defined (INFRA-003) |
| WAF Web ACL (admin login rate) | `LaiDjangoEc2-<env>` (regional, on the ALB) | No | `LaiDjangoEc2-<env>` | A CloudFront-scoped ACL would have to be a separate `CLOUDFRONT` scope ACL in us-east-1 | Evidence |

### 3.2 Identity, certificates, DNS

| Resource | Candidate definitions | Deployed today | Proposed owner | Duplicate / risk | Status |
|---|---|---|---|---|---|
| Cognito user pool, groups `Admins`, `Superusers`, app client | A retained stack from the retired backend; Django only takes its id (`CognitoUserPoolId` parameter); the browser signs in directly (`react/src/lib/cognito`) | Yes [inferred] | The existing pool, until a separately approved move to a CDK stack | Deleting the stack that holds it deletes the pool unless it is retained or detached first, and every parent account is lost | Evidence; long-term owner is Owner (D5) |
| ACM certificate, API and admin hosts (us-west-1) | `LaiDjangoEc2-<env>` (`ApiCertificate`: `ApiDomainName` plus `AdminDomainName`, LAI-INFRA-003) | No | `LaiDjangoEc2-<env>` | Changing either name replaces the certificate; DNS validation must be redone | Evidence |
| ACM certificate, frontend (us-east-1) | **`LaiFrontend-<env>`** (`SiteCertificate`); the YAML **[card]** | No | **`LaiFrontend-<env>`** (stack in us-east-1) | n/a | Defined (INFRA-003) |
| Route 53 hosted zone | None in IaC [repo] | Unknown (U10) | **Outside IaC**: owner-managed, referenced by id | Creating a zone in IaC for a domain that already has one splits DNS | Owner (D6) |
| Route 53 records | `LaiDjangoEc2-<env>` `ApiAlias` and `AdminAlias`, `LaiFrontend-<env>` `SiteAlias` (A and AAAA), only if a zone is given; otherwise manual | No | The stack that owns each target | Manual records and stack records for the same name conflict | Owner (D6) |

### 3.3 Storage

| Resource | Candidate definitions | Deployed today | Proposed owner | Duplicate / risk | Status |
|---|---|---|---|---|---|
| Asset library bucket | `LaiAssetStorage-<env>` (`lai-assets-<env>-<account>-<region>`, `RETAIN`) | No | `LaiAssetStorage-<env>` | Fixed name; `RETAIN`, so a deleted stack leaves the bucket and a redeploy then fails until it is imported | Evidence |
| Child photo bucket (Django) | `LaiChildPhotos-<env>` (`lai-child-photos-<env>-...`, `RETAIN`) | No | `LaiChildPhotos-<env>` (ADR-042) | As above. Never behind a CDN | Evidence |
| Retained legacy S3 bucket `learningAdventureIslandMedia` from the retired backend | Retained stack | Yes [inferred] | **Frozen**; any import or deletion is a separate owner approval (ADR-042) | Holds legacy child photos and admin models; nothing in the repository reads it | Evidence |
| Admin static bucket `lai-admin-static-<env>` | Only named by `scripts/release-admin-static.sh` (LAI-0404); no IaC | No | **None.** The admin host serves its static files through WhiteNoise from the image (LAI-INFRA-003); no CloudFront for the admin | The script writes to a bucket no stack creates: retire or keep unused | Owner (decide to retire the script) |
| ECR repository `lai/django` | `LaiDjangoRelease` (account-wide, `RETAIN`) | No | `LaiDjangoRelease` | Fixed name; `RETAIN` | Evidence |

### 3.4 Functions, queues, AI

| Resource | Candidate definitions | Deployed today | Proposed owner | Duplicate / risk | Status |
|---|---|---|---|---|---|
| Lambda workers (proposed) | LAI-LAMBDA-005 (backlog), no code | No | Future CDK stack, separate from `LaiDjangoEc2` | n/a | Proposed |
| SQS | None anywhere [repo]; LAI-LAMBDA-005 proposes one; LAI-AQS-027 chose PostgreSQL jobs, not SQS | No | Nobody today | n/a | Evidence |
| Bedrock Guardrail `lai-child-safety-dev` | `LaiAiGuardrail-dev` [repo]; out-of-band `LaiAiGuardrailOnly-dev` [qa 2026-11-07] | Yes, by `LaiAiGuardrailOnly-dev` (version 1) | **`LaiAiGuardrail-dev`** | Two stacks, same name. Deploying `LaiAiGuardrail-dev` first either fails on the name or makes a second Guardrail (AWS behaviour not verified here). Either way, delete `LaiAiGuardrailOnly-dev` first, then update the SSM Guardrail id and version (the id changes) | Owner (D3) |
| Bedrock model access | Account-level, no IaC | Yes (QA used it) [qa 2026-11-07] | Account (owner) | Django uses the US profile | Evidence |

### 3.5 IAM, configuration, monitoring

| Resource | Candidate definitions | Deployed today | Proposed owner | Duplicate / risk | Status |
|---|---|---|---|---|---|
| GitHub OIDC provider | `LaiDjangoRelease` when `createOidcProvider` is not `false` | Unknown (U2) | **Whoever already has it**: if it exists, keep it outside the stack and deploy with `LAI_CREATE_OIDC_PROVIDER=false`; if not, `LaiDjangoRelease` | One per account; creating a second fails. `RETAIN`, so it outlives the stack | Owner (D4), after a read-only check |
| Roles `lai-github-image-publisher`, `lai-django-ec2-<env>`, `lai-github-deploy-<env>` | `LaiDjangoRelease`, `LaiDjangoEc2-<env>` | No | Those stacks | Fixed role names | Evidence |
| Role `lai-github-site-deploy-<env>` | `LaiFrontend-<env>` (LAI-INFRA-004) | No | `LaiFrontend-<env>` | Fixed name; trusts the account's GitHub OIDC provider (created by `LaiDjangoRelease`) | Defined |
| Managed policies `lai-django-{asset-storage,child-photos,ai}-<env>` | `LaiAssetStorage`, `LaiChildPhotos`, `LaiAiGuardrail` | No (`ai` not deployed either: the trimmed stack held only the Guardrail) | Those stacks | Fixed names; attached by **name**, not export | Evidence |
| SSM parameters `/lai/<env>/django/*` (11 String) | `LaiDjangoEc2-<env>` | No | `LaiDjangoEc2-<env>` | Fixed names | Evidence |
| Operator-written parameters (`DJANGO_SECRET_KEY` SecureString; AI settings per AI-FU-2) | Operator, not a stack | No | **Operator**, documented | Out of IaC on purpose (CloudFormation cannot create a SecureString) | Evidence |
| SSM documents `lai-django-{deploy,rollback,status,bootstrap,setup}-<env>` | `LaiDjangoEc2-<env>` | No | `LaiDjangoEc2-<env>` | Fixed names | Evidence |
| Log groups `/lai/<env>/*`, RDS log group | `LaiDjangoEc2-<env>` (`RETAIN`) | No | `LaiDjangoEc2-<env>` | `RETAIN` plus fixed names: after a stack delete, a redeploy fails until they are deleted or imported | Evidence |
| SNS `lai-django-alarms-<env>` and Django alarms | `LaiDjangoEc2-<env>`; AI alarms in `LaiAiGuardrail-<env>` | No | Those stacks | Fixed names | Evidence |
| SNS `OperationalAlertsTopic`, alarms, dashboard, Budget | Retained `OperationalMonitoring` stack from the retired backend | Yes [inferred] | Fold into the Django alarm topic, with owner approval | Two alert topics (U6) | Proposed |
| CDK bootstrap `CDKToolkit` | Not used by `infra/` (bootstrapless) | Yes [owner-cli 2026-11-01] | **Account** (shared with other projects); not owned by this project | Deleting it could break other projects' deploys | Evidence |

### 3.6 Pipelines

| Pipeline | Deploys | Proposed owner | Duplicate / risk | Status |
|---|---|---|---|---|
| `deploy-django-ec2.yml` (GitHub OIDC, ECR, SSM) | Django image to `LaiDjangoEc2-<env>` | **The only backend pipeline** | A CodePipeline/CodeBuild backend pipeline (DevOps card) would double-deploy; INFRA-004 decides | Proposed; INFRA-004 |
| `deploy-site.yml` (GitHub OIDC, S3, CloudFront; LAI-INFRA-004) | React build to `LaiFrontend-<env>` | **The only CloudFront site pipeline**; off until `LAI_SITE_DEPLOY_ENABLED` | Same system as the backend; no CodePipeline (owner, 2026-11-09) | Defined, gated |
| `scripts/aws/provision.sh` | Infrastructure stacks 1 to 4, plus `LaiFrontend-<env>` in us-east-1 when `LAI_SITE_DOMAIN` is set (change sets by default) | Operator, with owner approval | `LaiAiGuardrail-<env>` is still not in it (deployed by hand per `docs/AI_SERVICE.md`) | Evidence |
| `lai-dev-complete.yaml` | Unknown | None until supplied (section 5) | A second, unreviewed path to EC2/RDS/VPC | Owner (D1) |

## 4. Duplicate creation and replacement risks

**Fixed physical names.** These `infra/` resources carry explicit names, so a second stack (the
YAML, a renamed stack, or a hand copy like `LaiAiGuardrailOnly-dev`) defining the same name makes
CloudFormation fail the create and roll back:
`lai-assets-*` and `lai-child-photos-*` buckets, `lai/django` ECR repository, roles
`lai-github-image-publisher`, `lai-django-ec2-<env>`, `lai-github-deploy-<env>`, three managed
policies, RDS `lai-django-<env>`, secret `lai/<env>/django/database`, 11 SSM parameters, 5 SSM
documents, log groups, SNS topic `lai-django-alarms-<env>`, alarm names, and the GitHub OIDC
provider. Resources without fixed names (VPC, subnets, security groups, ALB, EC2 instance,
CloudFront) **do not fail**: a second definition silently creates a parallel copy and its cost.

**Retained resources.** Buckets, ECR repository, OIDC provider and log groups are `RETAIN`; the RDS
instance and data volume are `SNAPSHOT`. Deleting their stack leaves them behind, and redeploying
the same stack then fails on the names above. Recovery is a CloudFormation **resource import**
(or deleting the orphan after a backup), and must be approved.

**Name-based cross-stack links, not exports.** `LaiDjangoEc2` attaches the storage policies, the
ECR repository and the OIDC provider by name; `LaiAiGuardrail` finds the EC2 role, log group and
topic by name. CloudFormation therefore does not block deleting a stack something still uses.
Safe order to create: storage, release, EC2, Guardrail. To delete: the reverse.

**Replacements to plan for.**
- Cognito user pool: deleting or replacing the stack that holds it loses all parent accounts.
- API certificate: adding the admin host replaces it (INFRA-003).
- EC2 instance: a new `AmiId` replaces it; the data volume (container mode) survives.
- Guardrail: moving to `LaiAiGuardrail-dev` gives a new Guardrail id; SSM settings must follow.
- Database mode `container` to `rds`: a new, empty database.

## 5. Standalone `lai-dev-complete.yaml`: what to check once it is supplied

Do not deploy it, and do not deploy any `infra/` stack into the same account and region while
its status is unknown. When the file arrives:

1. Check whether a stack from it already exists: `aws cloudformation list-stacks` and
   `get-template` for any stack that is not `Lai*`, `CDKToolkit` or one of the retained stacks from the retired backend.
2. List its resource types and every physical name; compare against section 4. Each match is
   either a create failure (fixed name) or a silent duplicate (no name).
3. Note its region (the frontend certificate must be us-east-1) and parameters.
4. Map each resource to an owner in section 3; recommend import, port into CDK, or drop.
5. Validate YAML (unique keys) and CloudFormation syntax (`cfn-lint`), as LAI-INFRA-005 asks.

## 6. Live dependencies

| Depends on | Used by | Consequence |
|---|---|---|
| Existing Cognito user pool | React sign-in, Django JWT validation (`CognitoUserPoolId`), admin groups | Any change to or deletion of the stack that holds it must keep the pool |
| Retained legacy S3 bucket | Legacy child photos and admin model uploads | Untouched; import or deletion is a separate approval (ADR-042) |
| `LaiAssetStorage`, `LaiChildPhotos`, `LaiDjangoRelease` | `LaiDjangoEc2` (by name) | Deploy first, delete last |
| `LaiDjangoEc2` role, log group, topic | `LaiAiGuardrail` (by name) | `LaiAiGuardrail` cannot deploy before the EC2 stack |
| `LaiAiGuardrailOnly-dev` Guardrail id | Local QA settings (`learning-dev` profile) | Deleting it breaks local live Bedrock QA until the settings point at the new id |
| `CDKToolkit` | Possibly other projects | Leave alone |

## 7. Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| D1 | Which definition owns the dev VPC, EC2 and RDS | `LaiDjangoEc2-dev`. Treat `lai-dev-complete.yaml` as reference only; port anything it has that CDK lacks |
| D2 | Who owns the CloudFront frontend, its bucket, us-east-1 certificate and the admin static bucket | **Done:** `LaiFrontend-<env>` (LAI-INFRA-003, merged). Admin static stays in the image; no admin CloudFront |
| D3 | Guardrail cut-over | After `LaiDjangoEc2-dev` exists: delete `LaiAiGuardrailOnly-dev`, deploy `LaiAiGuardrail-dev`, update SSM (as AI-FU-2 already plans) |
| D4 | GitHub OIDC provider | Run the read-only check (`aws iam list-open-id-connect-providers`). If present, deploy `LaiDjangoRelease` with `LAI_CREATE_OIDC_PROVIDER=false` |
| D5 | Cognito long-term owner | Keep the existing pool; retain it (`RETAIN` policy, deletion protection) and import it into a CDK stack, approved separately |
| D6 | Route 53 | Record the zone and domain (INFRA-003); keep the zone outside IaC; let stacks own only their alias records |

## 8. Read-only verification

Run the commands in `docs/infrastructure/inventory.md` section 8, plus:

```bash
aws cloudformation list-stacks --region us-west-1 --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query "StackSummaries[].StackName"
aws cloudformation list-stacks --region us-east-1 --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query "StackSummaries[].StackName"
aws cloudfront list-distributions --query "DistributionList.Items[].[Id,DomainName,Aliases.Items]"
aws route53 list-hosted-zones --query "HostedZones[].[Name,Id]"
aws acm list-certificates --region us-east-1 --query "CertificateSummaryList[].DomainName"
aws acm list-certificates --region us-west-1 --query "CertificateSummaryList[].DomainName"
aws ec2 describe-vpcs --region us-west-1 --query "Vpcs[].[VpcId,CidrBlock,Tags[?Key=='Name'].Value|[0]]"
aws rds describe-db-instances --region us-west-1 --query "DBInstances[].[DBInstanceIdentifier,MultiAZ]"
```

Any `us-west-1` stack outside `Lai*`, `CDKToolkit` and the retained stacks from the retired backend, or any VPC, RDS instance or
CloudFront distribution not listed in section 3, is a candidate `lai-dev-complete.yaml`
deployment and changes D1 and D2.
