# Current AWS Resource Inventory

Status: **Repository evidence only.** No deployed account was queried (the AWS CLI was not
available to the session that wrote this). Treat every row as "what is known from the
repository", not "what exists". See `docs/DJANGO_MIGRATION_ASSESSMENT.md` for context.

The resources the repository defines and deploys (the CDK stacks in `infra/`, the release
workflows and the EC2 host runtime) are inventoried in `docs/infrastructure/inventory.md`, with
ownership in `docs/infrastructure/resource-ownership.md`. This document lists only what the
repository does **not** define: the existing Cognito user pool, the retained legacy DynamoDB tables
and S3 buckets from the retired backend, and account-level items.

Evidence labels: **[repo]** source files; **[deployed]** none collected.

Disposition legend: **KEEP**, **RETAINED** (left untouched; any import or deletion is a separate
owner approval), **UNKNOWN**.

## 1. Account and region

| Item | Finding | Evidence |
|---|---|---|
| Region | `us-west-1` for the Cognito pool and the CDK stacks. Production region **UNKNOWN** | [repo] |
| Client configuration | Build-time variables `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID` and `VITE_DJANGO_API_BASE`; no generated configuration file | [repo] `react/src/lib/cognito/config.ts`, `react/src/api/apiBase.ts` |

## 2. Resources outside `infra/`

### Cognito

| Resource | Use | Disposition |
|---|---|---|
| User pool, email login, email verification | Parent accounts. The browser signs in directly (`react/src/lib/cognito`); Django verifies the tokens | **KEEP**. It lives in a retained stack from the retired backend: retain it or turn on deletion protection before that stack is ever deleted |
| User pool groups `Admins`, `Superusers` | Administrator gate | **KEEP** |
| Web app client | Public browser client (SRP) | **KEEP** |

### Retained legacy data

| Resource | Disposition |
|---|---|
| Retained legacy DynamoDB tables from the retired backend (one per former model, for example ParentProfile, ChildProfile, AdventureSession, SkillProgress, WorldChange, AIInteractionAudit, SafetyEvent, CoopSession, ChildInventory, ChildQuestState) | **RETAINED** |
| Retained legacy S3 bucket `learningAdventureIslandMedia` from the retired backend (`child-photos/{entity_id}/*`, `assets/*`) | **RETAINED** |

### Monitoring and cost

| Resource | Disposition |
|---|---|
| SNS topic `OperationalAlertsTopic` and AWS Budget `BedrockMonthlyCostBudget` (retained monitoring stack) | **KEEP** until folded into the Django alarm topic with owner approval (`docs/infrastructure/inventory.md` U6) |
| Custom metric namespaces `LearningAdventureIsland/AI`, `.../Safety` | **KEEP** the names so dashboards and alarms keep working |

### Account level

| Item | Disposition |
|---|---|
| Bedrock model access / Marketplace subscription | **UNKNOWN** (must be confirmed in the target account) |
| CDK bootstrap (`cdk-hnb659fds-*` roles/bucket) | **UNKNOWN**; `infra/` is bootstrapless |
| Secrets | None in the repository (`.env*` files are gitignored) |

## 3. Unknowns that need a human or a read-only AWS session

1. Is there any real family data in the retained legacy DynamoDB tables, and how much?
2. Is Bedrock model access enabled in the target account/region?
3. Current IAM role count and quota headroom (see `docs/IAM_ROLE_AUDIT.md` for the queries).
4. Whether the Cognito pool has `DeletionProtection` and whether user accounts exist beyond the developer.

Read-only commands to answer these are listed in `docs/IAM_ROLE_AUDIT.md` section 5.
