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

## 4. Resource-by-resource decision (stage 0 run 2026-11-11)

Source: `scripts/aws/amplify-inventory.sh` and `scripts/aws/verify-dev.sh`, run by the owner on
2026-11-11 in account `008331939914`, `us-west-1`, 7-day traffic window. The account also holds
other projects' Amplify apps (pjsgreek, pjsstocks, naughtychess, wildrydes-site, myscyfi) and
developer sandboxes; only the rows below belong to this app.

**The `main` branch backend** (unused, see the findings) is Amplify Hosting app `d30vskv2ivdal9` ("learning adventure
island"), branch `main`, root stack `amplify-d30vskv2ivdal9-main-branch-ede190a103`.

| Resource | Real name / id | Measured | Proposed decision | Before deletion |
|---|---|---|---|---|
| Cognito user pool | `us-west-1_GPc9YEEqu` (groups `Admins`, `Superusers`), web client `47bvht0ddlu2l7hl4hectbt1lo` | **0 estimated users**; deletion protection off | Delete with the stack: unused (D1 keeps the sandbox pool `us-west-1_3LU3RSjuH`) | Stage 6 |
| Cognito identity pool | `us-west-1:2fc2262a-b81d-4101-9d17-70f31bf5655b` | n/a | Delete with the stack | Nothing to copy (see Storage) |
| 22 DynamoDB tables | `<Model>-vhinkkredfavbb5jfzypzkry6e-NONE` | **0 items in every table**; deletion protection off; PITR off | Delete with the stack; one on-demand backup each first (cheap) | Confirm 0 with `scan --select COUNT` on `ParentProfile` and `ChildProfile` (ItemCount lags up to 6 h) |
| AppSync API | `vhinkkredfavbb5jfzypzkry6e` | **0 requests in 7 days** | Delete with the stack | Stage 5 window |
| Storage bucket | `amplify-d30vskv2ivdal9-ma-learningadventureislandm-lsdlusavaakk` | Unknown: the first run skipped empty or unreadable prefixes (fixed in the script) | Delete after a rerun shows 0 objects, or after the AMP-04 copy | Rerun the inventory |
| Codegen and schema buckets | `amplify-d30vskv2ivdal9-ma-amplifydataamplifycodege-g4a2ccdbxpnm`, `amplify-d30vskv2ivdal9-ma-modelintrospectionschema-1p5iomsp8dyk` | Build artefacts | Delete with the stack | n/a |
| Lambda functions | `amplify-d30vskv2ivdal9-ma-*` (Director, co-op, answer, metrics, table manager, custom resources) | 0 invocations, except one CDK custom-resource provider (`AWS679f53fac...`, 60), which runs at deploy time, not for users | Delete with the stack | Stage 5 window |
| Alert topic, budget, dashboard | `...OperationalAlertsTopicEBC37167-OeQw5VnGu5lg`, `BedrockMonthlyCostBudget-us-west-1-1792946950738-kswTxJl4LIKZ`, dashboard `amplify-d30vskv2ivdal9-main-branch-ede190a103-operations` | n/a | Delete once the AMP-05 CDK alarms are live | AMP-05 deploy |
| Amplify Hosting app | `d30vskv2ivdal9` | Serving the live site | Delete after DNS moves | Stage 4 |
| `CDKToolkit` | account-wide | n/a | **Keep** | n/a |

### Stage 0 findings

**Correction (owner, 2026-11-11): the pool in use is `us-west-1_3LU3RSjuH`.** It belongs to the
developer sandbox `amplify-learningadventureisland-pdimitriu-sandbox-d82df21cc1`, not to the
`main` branch backend. That sandbox, not `main`, is the backend with real use and data:

| Sandbox resource | Real name / id | Measured |
|---|---|---|
| Cognito user pool | `us-west-1_3LU3RSjuH` (groups `Admins`, `Superusers`), client `1nv9h1a00pe3t2u6c7hg3krq7r` | 1 estimated user; **deletion protection off** |
| Identity pool | `us-west-1:b2e34e5a-33cf-4ffc-9125-78b948ef0fe5` | n/a |
| AppSync API | `msc2dcivzjeklbumcf5de5pfyy` | **810 requests in 7 days** |
| Tables `<Model>-msc2dcivzjeklbumcf5de5pfyy-NONE` | 22 | ParentProfile 2, ChildProfile 3, CompanionProfile 4, AdventureSession 18, AdventureAction 51, SkillEvidence 29, SkillProgress 14, WorldChange 15, ChildQuestState 6, ChildWorldState 4, ChildInventory 3, ChildNpcState 2, ChildStoryProgress 2, AIInteractionAudit 22; the rest 0 |
| Media bucket | `amplify-learningadventure-learningadventureislandm-lbvh0ewlhlx2` | Unknown (rerun the inventory) |

What this changes:

1. **The sandbox is the thing to protect, and it is the most fragile.** A sandbox stack is
   deleted, pool and tables included, by `npx ampx sandbox delete`, and its resources use the
   default `DeletionPolicy: Delete`. Until its data is in Django: never run `ampx sandbox delete`
   or let a sandbox session tear it down, and turn on the pool's deletion protection from the
   Cognito console (Overview, Deletion protection). Do not use `aws cognito-idp
   update-user-pool` for this: it resets every attribute the call leaves out.
2. **D1 is answered: the Django site keeps `us-west-1_3LU3RSjuH`** (your account, its groups and
   password). Stage 3's `RETAIN` lines apply to this sandbox's auth stack, deployed with
   `npx ampx sandbox --once` from this repository, before any later CDK import.
3. **G8 is not needed (D4).** Profiles import with `import_amplify_profiles`. The play history
   (sessions, actions, skill evidence and progress, world changes, quests, inventory, NPC, story
   and world state) is not carried over: the children start fresh in Django.
4. **The `main` branch backend is unused**: pool `us-west-1_GPc9YEEqu` (0 users), API
   `vhinkkredfavbb5jfzypzkry6e` (0 requests), 22 tables with 0 items. It can be deleted with the
   Amplify Hosting app at stage 6 with no data step, after an exact `scan --select COUNT` on its
   two profile tables.
5. **The other learning sandbox** `amplify-learningadventureislandroot-pdimitriu-sandbox-93eee1e2ac`
   (pool `us-west-1_FuPf8rRor`, 2 parent and 1 child profiles, API
   `6mcik4j4uzejbfvjqggtlkm65y`) is older test data; owner decision D2.
6. **Django is not deployed.** `verify-dev.sh` found no `LaiAssetStorage-dev`,
   `LaiChildPhotos-dev`, `LaiDjangoRelease` or `LaiDjangoEc2-dev`, and `LaiAiGuardrailOnly-dev`
   still exists. Stages 2 and 4 wait for the LAI-1002/1004 deployment.
7. **Stage 1 state unknown**: the first run read the wrong Hosting app's branch (now fixed).
   Stage 1 matters less now: the `main` backend holds nothing; what must not change is the
   sandbox, which only a developer's `ampx sandbox` command deploys.
8. **Two non-Amplify pools** `us-west-1_UVZeN8Cie` ("learningadventureisland", 2 users,
   deletion protection on) and `us-west-1_vi1lvKQs2` ("learning_dev", 0 users): purpose not in
   the repository; owner decision D3.

### Owner decisions from stage 0

| # | Decision | Status |
|---|---|---|
| D1 | Which pool the Django site signs parents in with | **Answered 2026-11-11: `us-west-1_3LU3RSjuH`** (sandbox `d82df21cc1`). Protect it as in finding 1 |
| D2 | Older sandbox `93eee1e2ac` (pool `us-west-1_FuPf8rRor`) | **Answered 2026-11-11: discard.** Nothing is imported from it; it is deleted at stage 6 (`npx ampx sandbox delete` from its checkout, or its root stack `amplify-learningadventureislandroot-pdimitriu-sandbox-93eee1e2ac`) |
| D3 | `us-west-1_UVZeN8Cie` and `us-west-1_vi1lvKQs2` | Say what they are for |
| D4 | Progress history in sandbox `d82df21cc1` | **Answered 2026-11-11: not carried over.** Only profiles are imported (`import_amplify_profiles`); the children start fresh in Django. G8 importers are not built. The owner then asked for the history to be wiped now: `scripts/aws/wipe_amplify_history.py msc2dcivzjeklbumcf5de5pfyy` (dry run), then with `--confirm-delete msc2dcivzjeklbumcf5de5pfyy`. It backs up each of the 12 history tables, the AI interaction audit and the safety events first, then deletes their items (the owner added the last two on 2026-11-11); profiles and companion choices are kept |

## 5. Owner signoff

The card is complete only when: stages 0 to 6 have their evidence on the card, the table above
is filled with real names and each row has the owner's decision, and the owner has authorized the
deletion separately from approving this plan.
