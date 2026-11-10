# Infrastructure reconciliation report (LAI-INFRA-005)

Date: 2026-11-09. Trello: [LAI-INFRA-005](https://trello.com/c/TiDQBFa0). Base: `main` at
`02820d1`.

**For owner review. Nothing is deployed, merged or marked done by this task.** The only
definition change is one verified-safe fix (section 3).

The card names branch `infra/reconcile-definitions`. This session may push only to
`claude/lai-infra-001-pr-kwauv3`, so the work is on that branch.

## 1. Inputs

| Task | Deliverable | Merged |
|---|---|---|
| LAI-INFRA-001 | `docs/infrastructure/inventory.md` | `f2aece6` (paulj3000/learning#7) |
| LAI-INFRA-002 | `docs/infrastructure/resource-ownership.md` | `a268ac5` (paulj3000/learning#8) |
| LAI-INFRA-003 | `docs/infrastructure/domains-and-hosting.md` and the CDK, nginx and script changeset | `3b78951` (paulj3000/learning#9) |
| LAI-INFRA-004 | `docs/infrastructure/deployment-design.md` and the gated site release | `02820d1` (paulj3000/learning#10) |

## 2. Validation evidence

Run on 2026-11-09 against this branch. No AWS or GitHub Actions call was made: the session's
permission settings refuse the AWS CLI.

| Check | Tool | Scope | Result |
|---|---|---|---|
| YAML unique keys and syntax | PyYAML with a loader that rejects duplicate keys | All 9 tracked `*.yml`/`*.yaml` (workflows, actions, `amplify.yml`, `customHttp.yml`, both compose files) | **0** duplicates or errors |
| JSON unique keys and syntax | `json` with a duplicate-key hook | 51 tracked `*.json` (excluding `package-lock.json`; `tsconfig*.json` are JSONC and skipped) | **0** |
| CDK synth | `npm run infra:synth`, `LAI_ENV=dev` and `prod`, concrete account and region (as `provision.sh` runs it) | 6 stacks × 2 environments = 12 templates | All synthesize. No file assets and no Lambda; one IAM role in `LaiFrontend` |
| CloudFormation syntax and best practice | `cfn-lint` 1.60.0, each template in its own region | 12 templates | 10 clean. `LaiDjangoEc2-{dev,prod}`: W3010 (fixed, section 3), W3691 and W3005 (section 5) |
| Cross-stack references | **New** `infra/lib/crossStackReferences.test.ts` (18 cases, dev and prod) | Policies attached by name, the role named by the Guardrail policy, the log group and topic used by metric filters and alarms, bucket names in SSM, the ECR repository, the GitHub OIDC provider | All resolve to a resource some stack creates. A deliberate misspelling of a policy name or log group makes the test fail |
| Naming and tags | Same test | Physical bucket, role, policy, topic, log group, alarm and repository names across all stacks | All unique; all `lai-` prefixed; every stack tagged `Project=learning-adventure-island` |
| Regions | Same test, plus a `git grep` for region and account literals | Stacks, scripts, workflows | us-west-1 everywhere (overridable defaults). us-east-1 only for `LaiFrontend`, its certificate, publishing and rollback, plus the Bedrock US profile's destination list. No account id in code |
| Secrets in definitions | Template scan, plus `git grep` for keys, tokens and password literals | 12 templates; `infra/`, `scripts/`, `deploy/`, `.github/`, `.claude/`, `amplify/` | Templates hold none. The RDS password is generated in Secrets Manager and resolved at deploy time (`{{resolve:secretsmanager:...}}`); there are no `NoEcho` or SecureString parameters. **One finding** in `.claude/settings.json` (section 5, C9) |
| Workflow syntax | `actionlint` | `deploy-django-ec2.yml`, `deploy-site.yml` | Clean |
| Unit tests | `vitest` (infra), `pytest` (`tests/deploy`) | Infra stacks; release, publish, nginx and workflow-guard tests | Infra **82 passed**; `tests/deploy` **81 passed** |
| Doc references | Script over `docs/infrastructure/*.md` | Repository paths cited in backticks | All exist (the only misses were a build output and an ECR repository name) |
| Typecheck, lint, format | `npm run typecheck`, `npm run lint`, Prettier, ruff | Repository | Clean (lint shows only existing warnings in React files) |

The full Django suite, Playwright and the React unit suite are not re-run here (no Django or
React code changed); the PR's CI runs them.

## 3. Definitions adjusted (verified safe)

| Change | Why | Why it is safe |
|---|---|---|
| `LaiDjangoEc2-<env>` takes its two Availability Zones from `Fn::GetAZs` (`infra/lib/djangoEc2Stack.ts`) | `cfn-lint` W3010 showed subnets in **`dummy1a`/`dummy1b`**. CDK uses those placeholders when it synthesizes for a concrete account without a context lookup, which is how `provision.sh` synthesizes. **The first `provision.sh dev` would have failed** creating the VPC subnets | Nothing is deployed (`LaiDjangoEc2-*` does not exist, inventory section 4.1). Re-synthesized, the templates lint clean of W3010. A new test fails without the fix and passes with it |

Nothing else was changed in a definition. The new cross-stack test adds checks, not behaviour.

## 4. Resource ownership matrix

The matrix is `docs/infrastructure/resource-ownership.md` section 3, updated here for the
LAI-INFRA-003 and LAI-INFRA-004 outcomes. Summary of who owns what now:

| Area | Owner |
|---|---|
| VPC, EC2, ALB (API and admin hosts), RDS Single-AZ (dev), WAF, SSM settings and documents, Django alarms | `LaiDjangoEc2-<env>` (us-west-1) |
| Asset bucket; child photo bucket | `LaiAssetStorage-<env>`; `LaiChildPhotos-<env>` |
| ECR `lai/django`, GitHub OIDC provider, image publisher role | `LaiDjangoRelease` (account-wide) |
| Child-safety Guardrail, Django AI policy, AI alarms | `LaiAiGuardrail-<env>`, **after** `LaiAiGuardrailOnly-dev` is retired (C2) |
| CloudFront, site bucket, us-east-1 certificate, site deploy role | `LaiFrontend-<env>` (us-east-1) |
| Cognito, AppSync, DynamoDB, Amplify Storage, Amplify monitoring | Amplify Gen 2 `main` backend until cutover |
| Releases | GitHub Actions only: `deploy-django-ec2.yml` (on), `deploy-site.yml` (gated off). Amplify Hosting for the Gen 2 backend |
| Infrastructure changes | Operator through `provision.sh` change sets, with owner approval |

## 5. Conflicts and open items

| # | Item | State | Needs |
|---|---|---|---|
| **B1** | **`lai-dev-complete.yaml` is still missing.** It is not in the repository or any branch's history. Its EC2/RDS/VPC and CloudFront would silently duplicate `LaiDjangoEc2` and `LaiFrontend` (resource-ownership section 4) | **Blocker** for comparing it; reference only (D1) | The owner attaches the file; then run resource-ownership section 5 |
| C2 | Guardrail `lai-child-safety-dev` is owned by the out-of-band `LaiAiGuardrailOnly-dev` while `LaiAiGuardrail-dev` defines the same name | Open | Approval to delete it before deploying `LaiAiGuardrail-dev`, and to update the SSM Guardrail id (D3, AI-FU-2) |
| C3 | GitHub OIDC provider: one per account, and the account is shared | Unknown | Run `aws iam list-open-id-connect-providers`; if one exists, set `LAI_CREATE_OIDC_PROVIDER=false` (D4) |
| C4 | Cognito pool owned by Amplify; any Amplify stack change must keep it | Open by design | Detach-and-import plan at cutover (D5) |
| C5 | Is `pauldimitriu.com` in Route 53? Domain names per environment | Unknown (U10) | Owner answer (D6; `domains-and-hosting.md` section 7) |
| C6 | Two alert topics (Amplify `OperationalAlertsTopic`, `lai-django-alarms-<env>`) | Open | Fold into one at cutover (U6) |
| C7 | `scripts/release-admin-static.sh` writes to `lai-admin-static-<env>`, which no stack creates; the admin now serves static files itself | Open | Approve retiring the script (U7) |
| C8 | `CDKToolkit` in the shared account: owner unknown; `infra/` does not use it | Leave alone | n/a (U8) |
| C9 | **`.claude/settings.json` (committed) holds a test parent's e-mail and password** in two allow-listed commands | **Security** | Approval to remove those lines; rotate the password (it stays in git history) |
| C10 | `cfn-lint` W3691: PostgreSQL `EngineVersion: "16"` (major only) is flagged as unusable for new instances | Unverified | `aws rds describe-db-engine-versions --engine postgres --region us-west-1 --query "DBEngineVersions[?starts_with(EngineVersion,'16')].EngineVersion"`. If RDS rejects a major-only version, pin a listed minor (`rds.PostgresEngineVersion.of(...)`) |
| C11 | `cfn-lint` W3005: redundant `DependsOn` on the instance (the database and secret are already referenced) | Harmless | None |
| C12 | `ampx generate outputs` IAM actions for the site role are a best guess | Unverified | The first gated dev run (`deployment-design.md` section 9) |
| C13 | React test `RegionPlayCompanion` "double-tapped answer" failed once in CI (paulj3000/learning#8), then passed; not reproduced locally | Intermittent | A separate task to make it deterministic |

## 6. Approval requests

1. Review and merge this PR (the AZ fix, the cross-stack test, the matrix update and this report).
2. Supply `lai-dev-complete.yaml` (B1), or confirm it is retired.
3. Answer C3 and C5, then approve `provision.sh dev`: change sets first, reviewed, then
   `--execute` (LAI-1002/1004).
4. Approve C2 (Guardrail switch) once `LaiDjangoEc2-dev` exists.
5. Approve C9 (remove the committed test credential) and rotate it.
6. Decide C7. Run the C10 check before the first RDS create.

## 7. Limits

- No live state was read: every "deployed" statement comes from the dated records in the
  inventory.
- No change set was created and nothing was deployed.
- Validators ran locally from a scratch install: `cfn-lint`, `actionlint`, PyYAML. None was added
  to the repository's dependencies.
