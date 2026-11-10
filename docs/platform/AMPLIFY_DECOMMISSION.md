# Amplify exit acceptance and safe AWS decommission (AMP-08)

Date: 2026-11-10. Trello: [AMP-08](https://trello.com/c/utgOtKEZ). Inputs:
[`AMPLIFY_EXIT_MATRIX.md`](AMPLIFY_EXIT_MATRIX.md) (AMP-01),
[`resource-ownership.md`](../infrastructure/resource-ownership.md) (LAI-INFRA-002) and the
per-card documents listed in section 2.

**Nothing in this document has been run.** Every stage below changes or deletes AWS resources and
needs the owner's explicit approval, stage by stage. The code side of the exit (AMP-02 to AMP-07)
is on a branch; this is the order in which the owner turns it into a live change, and the evidence
each stage must leave before the next one starts.

## 1. The one rule

**No Amplify stack is deleted while it still owns something that must survive.** Deleting an
Amplify Gen 2 branch backend deletes its nested stacks, and with them the Cognito user pool (every
parent account), the DynamoDB tables and the Storage bucket, unless each of those was retained or
detached first. So the order is: stop new writes, copy and reconcile, retain or detach what
survives, prove zero traffic, then delete what is left.

## 2. Code readiness (the branch)

| Card | What the branch does | Evidence document |
|---|---|---|
| AMP-01 | Inventory and parity matrix | `AMPLIFY_EXIT_MATRIX.md` |
| AMP-02 | Direct Cognito sign-in in the app and scripts (`react/src/lib/cognito`) | `AMPLIFY_EXIT_STATUS.md` section AMP-02 |
| AMP-03 | Every React data call goes to Django | `AMPLIFY_EXIT_STATUS.md` section AMP-03 |
| AMP-04 | Photos and assets only through Django; legacy object copy command | `AMPLIFY_STORAGE_CUTOVER.md` |
| AMP-05 | Director, co-op and AI on Django; metrics and alarms in CDK | `AMPLIFY_FUNCTIONS_EXIT.md` |
| AMP-06 | Site release and `LaiFrontend` need no Amplify read | `deployment-design.md`, this document stage 4 |
| AMP-07 | `aws-amplify` and the app's Amplify config removed | `AMPLIFY_EXIT_STATUS.md` section AMP-07 |

**Merging that branch is itself the frontend cutover.** The app on it cannot read Amplify Data any
more, so a site built from it only works where `/api/` reaches Django (CloudFront, `LaiFrontend`).
An Amplify Hosting build of it would publish a site whose data calls fail. Stages 1 to 4 therefore
come **before** the merge to `main`.

## 3. Stages

Each stage lists what to run, what evidence to keep on the AMP-08 card, and how to roll back.

### Stage 0. Read-only inventory (no change)

Run `scripts/aws/amplify-inventory.sh [--app-id <amplify app id>] [--days 7]` with credentials for
the account (read-only; `tests/deploy/test_amplify_inventory.py` enforces that it only calls
describe, get and list operations, and never reads table items, user attributes or object keys).
It prints, in `us-west-1` unless `AWS_REGION` says otherwise:

1. the caller identity;
2. the Amplify Hosting app, its branches and domains, and whether `LAI_SKIP_BACKEND_DEPLOY` is
   set on `main`;
3. every `amplify-*` stack and its resources;
4. each Cognito user pool (estimated users, deletion protection, groups, client ids) and the
   identity pools;
5. each AppSync API with its request count over the window, and its DynamoDB tables with item
   counts, deletion protection and point-in-time recovery;
6. each `amplify-*` bucket, versioning, and object counts and bytes per prefix (`child-photos/`,
   `assets/` and the Amplify access-level prefixes);
7. each Amplify Lambda function and its invocations over the window;
8. the alert topics, budgets and dashboards;
9. a draft of the section 4 table.

Also run `scripts/aws/verify-dev.sh` for the Django side. Paste both outputs on the AMP-08 card,
then fill section 4 with the real names.

Evidence: the counts and the stack/resource list. Rollback: none needed.

### Stage 1. Stop Amplify backend deploys

Set the Amplify Hosting environment variable `LAI_SKIP_BACKEND_DEPLOY=true` on the `main` branch
(`docs/platform/AMPLIFY_HOSTING.md` section 6). From then on an Amplify build only reads the
existing backend and never changes it, so no later commit can alter or delete an Amplify resource
by accident.

Evidence: the next Amplify build log shows `ampx generate outputs`, not `pipeline-deploy`.
Rollback: unset the variable.

### Stage 2. Django serving and data copied

1. Django dev and prod are deployed and pass `docs/infrastructure/dev-acceptance.md`.
2. Profiles: `manage.py import_amplify_profiles` (`AMPLIFY_PROFILE_IMPORT.md`).
3. Other per-child records: only if stage 0 found real family data in progress tables (gap G8 in
   the matrix). The importers for them are not written; if the counts are non-zero, that is a
   blocker for this stage and needs its own card.
4. Photos and admin models: `AMPLIFY_STORAGE_CUTOVER.md` (inventory, copy, checksum reconcile).
5. Before any of this, take an on-demand backup of every table:
   `aws dynamodb create-backup --table-name <t> --backup-name amp08-<t>-<date>`, and export each to
   S3 if point-in-time recovery is on (`aws dynamodb export-table-to-point-in-time`).

Evidence: importer reports, reconciled counts and checksums, backup ARNs.
Rollback: the Django rows created by the importers are listed in their reports; Amplify data is
untouched by this stage.

### Stage 3. Retain what survives (one small Amplify deploy, approved separately)

The Cognito user pool outlives Amplify (INFRA-002 decision D5). Before any deletion, mark it
`RETAIN` so a later stack deletion orphans it instead of deleting it. In `amplify/backend.ts`:

```ts
import { RemovalPolicy } from 'aws-cdk-lib';
backend.auth.resources.cfnResources.cfnUserPool.applyRemovalPolicy(RemovalPolicy.RETAIN);
backend.auth.resources.cfnResources.cfnUserPoolClient.applyRemovalPolicy(RemovalPolicy.RETAIN);
```

This changes only the CloudFormation `DeletionPolicy`, never the pool itself. Deploy it once with
`LAI_SKIP_BACKEND_DEPLOY` unset for that one build, check the change set shows **no replacement**
of `AWS::Cognito::UserPool`, then set the variable back. Do the same for the Storage bucket
(`backend.storage.resources.cfnResources.cfnBucket`) if any object was not copied in stage 2, and
turn on DynamoDB deletion protection for every table whose data was not imported:
`aws dynamodb update-table --table-name <t> --deletion-protection-enabled`.

Evidence: the change set (no `Replacement: True`), the stack template showing
`DeletionPolicy: Retain`. Rollback: remove the lines and redeploy (policies only).

### Stage 4. Frontend cutover

1. `LaiFrontend-<env>` updated from this branch (`scripts/aws/provision.sh`, change set reviewed):
   it no longer takes `AmplifyAppId`.
2. Repository variables `LAI_COGNITO_USER_POOL_ID` and `LAI_COGNITO_CLIENT_ID` set to the `main`
   pool and its web client (the values in Amplify's current `amplify_outputs.json`).
3. Merge the exit branch; `deploy-site.yml` (with `LAI_SITE_DEPLOY_ENABLED=true`) publishes it.
4. Browser acceptance on the CloudFront host: sign-in, sign-out, refresh after an hour, forgot
   password, account settings, child profiles, play, photos, AI turns, admin (Django Admin).
5. The owner moves DNS to CloudFront, then disconnects the `main` branch in Amplify Hosting (or
   turns off its auto build). A parent signed in on the old host keeps their session on the new
   host only if it is the same origin; otherwise they sign in once.

Evidence: the acceptance checklist, CloudFront logs showing traffic, Amplify Hosting showing no
new builds. Rollback: DNS back to Amplify Hosting and redeploy its last good build (the previous
`main` commit), which still talks to the untouched Amplify backend.

### Stage 5. Zero Amplify traffic

Watch for at least 7 days, read-only:

- AppSync: `aws cloudwatch get-metric-statistics --namespace AWS/AppSync --metric-name Requests --dimensions Name=GraphQLAPIId,Value=<apiId> ...` is 0.
- The four Amplify Lambdas: `Invocations` is 0 (except the operational-metrics stream consumer,
  which only runs on table writes; with no writes it is 0 too).
- Cognito identity pool: no new identities.
- Amplify Storage bucket: S3 request metrics or CloudTrail data events show no reads or writes
  outside the stage 2 copy.

Evidence: the metric screenshots or outputs. Rollback: not needed; if traffic appears, find the
caller before going on.

### Stage 6. Delete (owner authorizes each resource)

With the section 4 table filled and signed off, delete the Amplify Gen 2 branch backend, which is
the `amplify-<appId>-main-branch-*` root stack and its nested stacks. Before executing, create the deletion as a change set or review
`list-stack-resources` and confirm every resource marked **Retain** in section 4 has
`DeletionPolicy: Retain`. Then delete the Amplify Hosting app once DNS has moved.

After the stack is gone, the retained Cognito pool can be imported into a CDK stack
(`cdk import`), approved separately (D5).

Then remove the repository's last Amplify files in one commit: `amplify/`, `amplify.yml`,
`customHttp.yml`, `amplify-hosting/`, the `@aws-amplify/backend` and `@aws-amplify/backend-cli`
dev dependencies, the `amplify/tsconfig.json` typecheck, and `npm run sandbox` (AMP-07, deferred
part; see `AMPLIFY_EXIT_STATUS.md`).

Evidence: CloudFormation `DELETE_COMPLETE` with the retained resources still present
(`aws cognito-idp describe-user-pool`). Rollback: tables can be restored from the stage 2 backups
(`aws dynamodb restore-table-from-backup`); the pool and any retained bucket were never deleted.

## 4. Resource-by-resource decision (fill in at stage 0)

| Resource (Amplify `main` backend) | Decision | Before deletion |
|---|---|---|
| Cognito user pool, groups `Admins` and `Superusers`, web app client | **Retain** (permanent) | Stage 3 `DeletionPolicy: Retain`; later CDK import |
| Cognito identity pool and its roles | Delete | Stage 2 photo copy verified (only Amplify Storage used it) |
| 22 DynamoDB tables | Delete after backup; **retain** any with non-imported family data | Stage 2 backups; deletion protection on retained ones |
| AppSync API | Delete | Stage 5 zero requests |
| Amplify Storage bucket `learningAdventureIslandMedia` | Delete after copy; retain if any object was not copied | Stage 2 reconcile |
| Lambdas (4 functions, table manager, custom resources) | Delete | Stage 5 zero invocations |
| `OperationalAlertsTopic`, Bedrock budget, dashboard | Delete once the CDK alarms (AMP-05) are deployed and subscribed | AMP-05 alarms live |
| Amplify-generated IAM roles | Delete with the stacks | n/a |
| Amplify Hosting app | Delete after DNS moved | Stage 4 |
| `CDKToolkit` bootstrap stack | **Keep** (account-wide, other projects) | n/a |

## 5. Owner signoff

The card is complete only when: stages 0 to 6 have their evidence on the card, the table above
is filled with real names and each row has the owner's decision, and the owner has authorized the
deletion separately from approving this plan.
