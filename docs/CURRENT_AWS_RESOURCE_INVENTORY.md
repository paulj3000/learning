# Current AWS Resource Inventory

Status: **Repository and synthesized-template evidence only.** No deployed account was
queried (the AWS CLI was not available to the session that wrote this). Treat every row as
"what the code would create", not "what exists". See `docs/DJANGO_MIGRATION_ASSESSMENT.md`
for context.

Evidence labels: **[repo]** source files; **[synth]** `.amplify/artifacts/cdk.out`
(gitignored, 27 Aug 2026, stack `amplify-learningadventureisland-pdimitriu-sandbox-d82df21cc1`);
**[deployed]** none collected.

Disposition legend: **KEEP**, **MIGRATE**, **REPLACE**, **RETIRE LATER**, **UNKNOWN**.

## 1. Amplify generation and environments

| Item | Finding | Evidence |
|---|---|---|
| Generation | Amplify **Gen 2** (code-first). `@aws-amplify/backend` ^1.24.0, `@aws-amplify/backend-cli` ^1.9.0, `aws-amplify` ^6.20.0, `aws-cdk-lib` ^2.263.0 | [repo] `package.json` |
| Backend entry | `amplify/backend.ts` (594 lines) with `defineBackend({ auth, data, storage, operationalMetrics, claimCoopSlot, submitAdventureAnswer, getNextLearningActivity })` | [repo] |
| Environments | One personal **sandbox** (`pdimitriu`) is evidenced. A hosting **branch** deployment is referenced in `backend.ts` comments ("Amplify Hosting branch deployment already owns `learning-adventure-island-operations`") and `amplify.yml` uses `$AWS_BRANCH`/`$AWS_APP_ID`. Number of branches and app ids: **UNKNOWN** | [repo], [synth] |
| Region | Sandbox outputs: `us-west-1`. Production region **UNKNOWN** | [repo] local `amplify_outputs.json` (gitignored) |
| Hosting | Amplify Hosting; `amplify.yml` runs `npx ampx pipeline-deploy` (backend) then `npm run build`, serves `dist/` | [repo] |
| Generated config | `amplify_outputs.json` (92 KB, gitignored, loaded by `src/lib/amplify-config.ts` via `import.meta.glob`) | [repo] |
| Other generated | `.amplify/` (tsbuildinfo, `artifacts/cdk.out`, `generated/env`), gitignored | [repo] |

## 2. Resources by service

### Cognito

| Resource | Definition | Disposition |
|---|---|---|
| User pool, email login, email verification | `amplify/auth/resource.ts` | **KEEP** (retained for Django JWT). Must be detached from the Amplify stack before that stack is deleted. |
| User pool group `Admins` | same | **KEEP** |
| Identity pool + authenticated/unauthenticated roles + `Admins` group role | Amplify auth construct [synth] `amplifyAuthauthenticatedUserRole`, `amplifyAuthunauthenticatedUserRole`, `amplifyAuthAdminsGroupRole` | **RETIRE LATER** (identity pool exists to give S3/AppSync identities; Django does not need it once presigned URLs replace identity-scoped S3 access) |
| User pool client(s) | Amplify-generated | **KEEP** (a new Django-facing app client is preferable to reusing the Amplify one) |

### AppSync and DynamoDB

| Resource | Definition | Disposition |
|---|---|---|
| AppSync GraphQL API, `userPool` default auth | `amplify/data/resource.ts` `defineData({ authorizationModes: { defaultAuthorizationMode: 'userPool' } })` | **REPLACE** (Django REST API) |
| 17 DynamoDB tables (one per model: ParentProfile, ChildProfile, CompanionProfile, AdventureSession, AdventureAction, SkillEvidence, SkillProgress, WorldChange, AIInteractionAudit, SafetyEvent, StoryArtifact, ChildStoryProgress, CoopSession, ChildNpcState, ChildInventory, ChildQuestState, ChildWorldState) | [repo], [synth] nested stack per model | **MIGRATE** data to PostgreSQL, then **RETIRE LATER** |
| DynamoDB Streams on `SafetyEvent` and `AIInteractionAudit` | `backend.ts` `enableModelTableStream` | **REPLACE** (application-level metrics) |
| Amplify Table Manager custom resource (on-event, is-complete, waiter state machine) | [synth] `AmplifyTableManager` stack | **RETIRE LATER** |
| AppSync data-source roles/resolvers (per model, per function, per AI route) | generated | **RETIRE LATER** |

### Lambda

| Function | Purpose | Reads/writes | Disposition |
|---|---|---|---|
| `claim-coop-slot` (10 s, 256 MB) | Atomic first-write-wins slot claim, `ConditionExpression` | `CoopSession` r/w | **REPLACE** (Django service with DB row lock or conditional update) |
| `submit-adventure-answer` (10 s, 256 MB) | Server-authoritative answer check; imports TS engine and content from `src/features` | `AdventureSession` r/w, `ChildProfile` r | **REPLACE** (Python rules + golden vectors) |
| `get-next-learning-activity` (10 s, 256 MB) | Adaptive "what next" query; imports director, curriculum, mastery from `src/features` | `AdventureSession`, `WorldChange`, `SkillProgress`, `ChildProfile` read-only | **REPLACE** |
| `operational-metrics` (30 s, 256 MB) | DynamoDB Streams consumer to CloudWatch EMF lines | stream read | **REPLACE** |
| `DynamoStreamActivationDelay` (inline Lambda, 90 s sleep) plus CDK `Trigger` provider | Works around stream-enable timing | none | **RETIRE LATER** (existence is itself an Amplify workaround) |
| `AwsCustomResource` `*LiveStreamArn` (x2) and their singleton provider Lambda | Look up live stream ARNs at deploy | `dynamodb:DescribeTable` | **RETIRE LATER** |
| `shared/requestLog.ts` | Structured request log helper | n/a | **MIGRATE** (concept; reimplement as Django middleware logging) |

### Bedrock / AI

| Resource | Definition | Disposition |
|---|---|---|
| `generateCompanionTurn`, `generateTutorTurn` AI Kit generation routes, model `anthropic.claude-haiku-4-5-20251001-v1:0` (global inference profile), temp 0.4, max 300 tokens | `amplify/data/resource.ts`, personas in `amplify/data/{chattyPersona,tutorPersona}.ts` | **REPLACE** with a Django `ai` service calling Bedrock via boto3. **Prompts and personas are MIGRATE** (copy verbatim, version them). |
| Per-route Bedrock data-source IAM role + service role, plus the custom cross-Region inference patch in `backend.ts` (`grantBedrockInvoke`) | [repo], [synth] | **RETIRE LATER**. The Django task role needs one policy with the same three ARNs (inference-profile, regional foundation-model, unscoped foundation-model). |
| Bedrock model access / Marketplace subscription | Account-level, not in repo | **UNKNOWN** (must be confirmed in the target account) |

### S3 / Storage

| Resource | Definition | Disposition |
|---|---|---|
| Amplify Storage bucket `learningAdventureIslandMedia`, path `child-photos/{entity_id}/*`, identity-scoped read/write/delete | `amplify/storage/resource.ts` | **MIGRATE** objects to a Django-managed private bucket (key rewrite from identity id to child/parent id), then **RETIRE LATER** |
| S3 auto-delete custom resource provider | [synth] | **RETIRE LATER** |
| Game models `public/models/*.gltf` (78 files, 596 KB) | Vite `public/`, served by Hosting | **KEEP** as static files now; **MIGRATE** to S3+CloudFront only when real art lands |

### Monitoring and cost

| Resource | Definition | Disposition |
|---|---|---|
| SNS topic `OperationalAlertsTopic`; optional email subscription via `PILOT_ALERT_EMAIL` | `backend.ts` | **KEEP** (reuse in new stack) |
| CloudWatch alarms: AppSync 5xx, AppSync 4xx, AI validation failures, HIGH-severity SafetyEvent | `backend.ts` | **MIGRATE** (keep the intent; AppSync alarms become ALB/API alarms) |
| CloudWatch dashboard `<rootStack>-operations` | `backend.ts` | **MIGRATE** |
| AWS Budget `BedrockMonthlyCostBudget` (default 50 USD, `PILOT_MONTHLY_BEDROCK_BUDGET_USD`) | `backend.ts` | **KEEP** (account-level cost control, independent of backend) |
| Custom metric namespaces `LearningAdventureIsland/AI`, `.../Safety` | `operational-metrics/handler.ts` | **KEEP** the names so dashboards and alarms keep working |

### CI/CD and secrets

| Item | Finding | Disposition |
|---|---|---|
| `.github/workflows/ci.yml` | typecheck (app, amplify, scripts), oxlint, prettier, vitest, build, Playwright | **MIGRATE** (add Python jobs; paths change with `react/` move) |
| Amplify Hosting build (`amplify.yml`) | Backend deploy + frontend build | **RETIRE LATER** after CloudFront/S3 hosting |
| Environment variables referenced | `PILOT_ALERT_EMAIL`, `PILOT_MONTHLY_BEDROCK_BUDGET_USD`, `AWS_JOB_ID`, `AWS_BRANCH`, `AWS_APP_ID`; Lambda env `COOP_SESSION_TABLE_NAME`, `ADVENTURE_SESSION_TABLE_NAME`, `CHILD_PROFILE_TABLE_NAME`, `WORLD_CHANGE_TABLE_NAME`, `SKILL_PROGRESS_TABLE_NAME` | **REPLACE** with Django settings from env/Secrets Manager |
| Secrets | None found in the repo (`amplify_outputs.json` and `.env*` are gitignored; the local file contains pool ids and endpoints, not credentials) | n/a |
| CDK bootstrap (`cdk-hnb659fds-*` roles/bucket) | Account-level; presence **UNKNOWN** | **UNKNOWN** |

## 3. Unknowns that need a human or a read-only AWS session

1. Does a deployed `main` branch app exist, and in which account/region?
2. How many Amplify apps and sandboxes share this account, and how many belong to this project?
3. Is there any real family data in the deployed DynamoDB tables, and how much?
4. Is Bedrock model access enabled in the target account/region?
5. Current IAM role count and quota headroom (see `docs/IAM_ROLE_AUDIT.md` for the queries).
6. Whether the Cognito pool has `DeletionProtection` and whether user accounts exist beyond the developer.

Read-only commands to answer these are listed in `docs/IAM_ROLE_AUDIT.md` section 5.
