# IAM Role Audit

Status: **Repository and synthesized-template evidence. No deployed IAM data was queried.**
The AWS CLI was not available to the session that wrote this, so no account-wide role count
is claimed. See `docs/CURRENT_AWS_RESOURCE_INVENTORY.md` and `docs/DJANGO_MIGRATION_ASSESSMENT.md`.

## 1. Framing

The IAM Roles quota (default 1,000 per account) is reachable when several Amplify Gen 2
projects, each with sandboxes and branches, share one account. The quota can be raised, so
this audit treats role count as **one input** to the Django decision, not the reason for it.

Evidence classes:

- **repository evidence**: what `amplify/**` declares.
- **synthesized evidence**: `.amplify/artifacts/cdk.out`, a local CloudFormation synth of one
  sandbox on 27 Aug 2026. Counted by parsing each template for `AWS::IAM::Role` resources.
- **deployed evidence**: none collected.

## 2. Roles explicitly defined in the repository

| Source | Role | Evidence |
|---|---|---|
| `backend.ts` `new CdkLambdaFunction(... 'DynamoStreamActivationDelay')` | One Lambda execution role | repo |
| `backend.ts` `new Trigger(...)` | Trigger custom-resource provider role | repo, synth |
| `backend.ts` `new AwsCustomResource(...)` x2 | Shared singleton provider Lambda role (CDK id `AWS679f53fac002430cb0da5b7982bd2287ServiceRole`) | repo, synth |
| `backend.ts` `PolicyStatement` added to AI Kit role | Adds statements to an existing role, not a new role | repo |
| `defineStorage` | Auto-delete objects provider role | repo, synth |

No `new Role(...)` is written by hand anywhere; all other roles are generated.

## 3. Roles generated indirectly (synthesized count)

Parsed from the 27 Aug 2026 synth: **40 `AWS::IAM::Role` resources for one environment.**
(A raw `grep` over the directory reports 80, probably because it also scans the large metadata JSON next to the
templates; the per-template parse below is the reliable number.)

| Group | Roles | Mechanism |
|---|---|---|
| One per Amplify Data model (17) | 17 | Each model nested stack creates an `<Model>IAMRole` for the AppSync data source |
| Amplify Table Manager | 3 | On-event, is-complete, waiter state machine roles |
| AppSync function data sources | 3 | One data-source service role per Lambda resolver |
| Lambda execution roles for resolvers | 3 | `claimcoopslot`, `submitadventureanswer`, `getnextlearningactivity` |
| Lambda execution role, metrics | 1 | `operationalmetrics` |
| AI Kit generation routes | 4 | Per route: one `DataSourceServiceRole` plus one `IAMRole` (2 routes x 2) |
| Auth | 3 | Authenticated, unauthenticated, and `Admins` group role |
| Data-stack helpers | 2 | S3 auto-delete provider, `BucketDeployment` provider |
| Storage | 1 | S3 auto-delete provider |
| Monitoring stack | 3 | Stream delay Lambda, Trigger provider, `AwsCustomResource` singleton |
| **Total** | **40** | |

Caveats: this is a single stale synth; roles added after 27 Aug (none are evident from `git
log` of `amplify/`, but not verified) are not counted; CloudFormation custom-resource
providers sometimes create roles only at deploy time.

## 4. Sources of role multiplication

1. **Per-model data-source roles.** Amplify Data creates one IAM role per model. Adding one
   DynamoDB model adds one role. This project has 17 models, so 17 of 40 roles (42.5%) exist
   just to let AppSync read each table. A relational database behind Django has zero
   per-entity roles. This is the structural reason the project's role count grows with
   product scope, which matches the brief's concern.
2. **Per-function roles.** Each Lambda adds an execution role and, when it is an AppSync
   resolver, a data-source role (2 per resolver).
3. **Per-AI-route roles.** Each AI Kit generation route adds 2 roles. Adding a route also
   requires a manual `grantBedrockInvoke` call in `backend.ts` (a past bug, documented in
   that file).
4. **CDK helper constructs.** `Trigger`, `AwsCustomResource`, `BucketDeployment`, and
   auto-delete S3 each add provider roles. Several of these exist only to work around
   Amplify behavior (stream activation delay, live stream ARN lookup).
5. **Per-environment multiplication.** Every `ampx sandbox` (per developer) and every
   hosted branch is a separate stack with its own full set. `~40 x (sandboxes + branches)`
   per project. With several Amplify projects in one account, this is how an account-wide
   quota is approached. The number of environments is **unknown**.
6. **Not counted here:** Amplify Hosting service role(s), CDK bootstrap roles, and any
   roles from the other Amplify projects in the account.

## 5. Read-only queries to obtain deployed evidence

Run with an authenticated, read-only profile. None of these modify anything.

```text
aws iam get-account-summary --query 'SummaryMap.{Roles:Roles,RolesQuota:RolesQuota}'
aws iam list-roles --query 'Roles[?contains(RoleName, `learningadventureisland`)].RoleName' --output text | wc -w
aws iam list-roles --query 'Roles[].RoleName' --output text | tr '\t' '\n' | sed -E 's/^(amplify-[a-z0-9]+)-.*/\1/' | sort | uniq -c | sort -rn | head -20
aws amplify list-apps --query 'apps[].{name:name,id:appId,region:defaultDomain}'
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query 'StackSummaries[?starts_with(StackName, `amplify-`)].StackName'
```

The third query groups by the Amplify project prefix so the per-project share of the quota
is visible. Record the results in this file under a new section "Deployed evidence" with the
date, account alias (not account id), and region.

## 6. What Django changes, honestly

| Item | Amplify | Django on ECS/EC2 |
|---|---|---|
| Roles that scale with model count | 17 and growing | 0 |
| Roles that scale with function/route count | 2 per resolver, 2 per AI route | 0 (code in one service) |
| Roles per environment | about 40 | about 6-10 (task execution role, task role, deploy roles, RDS monitoring, CodeDeploy, ECR build) estimated, not measured |
| Roles added by "create a new island/adventure" | 0 today (content is code), but any new persisted model adds 1 | 0 (data rows) |

This is an estimate for the target and must be re-measured after LAI-0900 series. Raising
the quota remains the lower-effort fix if IAM pressure alone were the issue.

## 7. Recommendation

- Request the quota increase now, independent of this migration. It is cheap and removes the
  time pressure from the Django decision.
- Delete unused sandboxes (`npx ampx sandbox delete`, human-approved) for this and other
  Amplify projects to reclaim roles immediately. Not done by this task.
- Keep this audit's counts as a baseline to compare after cutover.
