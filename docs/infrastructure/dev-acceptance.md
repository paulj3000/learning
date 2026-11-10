# AWS dev infrastructure acceptance (LAI-1002/1004)

Date: 2026-11-10. Trello: [LAI-1002/1004](https://trello.com/c/NIbMspLz). Base: `main` at
`89d1172` (LAI-INFRA-001 to 005 merged).

**Status: ready for the owner to run. Not accepted.** This session cannot reach AWS:
`.claude/settings.json` denies `Bash(aws:*)` to Claude, and that rule is kept (owner,
2026-11-10). So the owner runs every AWS step and the read-only check script, and pastes the
output into section 6. Claude then judges pass or fail against section 4. The last record of the
account (2026-11-01, updated 2026-11-07) shows no `LaiDjangoEc2` stack and no `/lai/*` SSM
parameters. This file does not count as current AWS evidence.

## 1. What acceptance covers

The card asks to verify each of these:
- CDK synth;
- the dev stacks;
- RDS and EC2;
- SSM;
- the asset and child-photo buckets;
- Django, Cognito and progress connectivity.

Since then, LAI-INFRA-003 added host isolation (`api.` and `ladm.`) and LAI-INFRA-004 added the
gated site release. Both are checked too.

## 2. Before anything changes in AWS (no AWS change)

| # | Step | Where |
|---|---|---|
| P1 | Decide the dev host names: API, admin and (later) site. The card's `pauldimitriu.com` names fit one environment; dev can use `dev-api.`, `dev-ladm.` | `domains-and-hosting.md` section 7.1 |
| P2 | Is `pauldimitriu.com` a Route 53 zone in `008331939914`? If yes, set `LAI_HOSTED_ZONE_ID` and `LAI_HOSTED_ZONE_NAME` and DNS is automatic | `reconciliation-report.md` C5 |
| P3 | `aws iam list-open-id-connect-providers`: if `token.actions.githubusercontent.com` is listed, set `LAI_CREATE_OIDC_PROVIDER=false` | C3 |
| P4 | Confirm no stack from `lai-dev-complete.yaml` exists (any non-`Lai*`, non-`amplify-*`, non-`CDKToolkit` stack in us-west-1) | B1 |
| P5 | Run `aws rds describe-db-engine-versions --engine postgres --region us-west-1 --query "DBEngineVersions[?starts_with(EngineVersion,'16')].EngineVersion"`. If RDS rejects a major-only `16`, Claude pins a listed minor before step A2 | C10 |
| P6 | Collect `LAI_COGNITO_USER_POOL_ID` and `LAI_COGNITO_CLIENT_IDS` from the Amplify `main` backend (`amplify_outputs.json`, `auth.user_pool_id` and `auth.user_pool_client_id`) | `DJANGO_EC2_DEPLOYMENT.md` 5.1 |
| P7 | Synth and review: `LAI_ENV=dev npm run infra:synth`, then read `infra/cdk.out/*.template.json` | Already validated in LAI-INFRA-005 (12 templates, `cfn-lint`) |

## 3. Provision and first release (each step needs owner approval)

| # | Step | Where |
|---|---|---|
| A1 | Export the step-2 values, plus `LAI_API_DOMAIN` and `LAI_ADMIN_DOMAIN` | `DJANGO_EC2_DEPLOYMENT.md` 5.2 |
| A2 | `scripts/aws/provision.sh dev` creates **change sets only**. Review them in the CloudFormation console: everything should be a create, because nothing exists yet | 5.2 |
| A3 | `scripts/aws/provision.sh dev --execute`. While `LaiDjangoEc2-dev` waits, add the ACM validation CNAMEs (both names, one certificate) | 5.2, 5.3, `domains-and-hosting.md` section 3 |
| A4 | DNS for the API and admin hosts, unless Route 53 did it | 5.4 |
| A5 | Write the secrets: `DJANGO_SECRET_KEY` (SecureString), and the AI settings only once AI is in scope | 5.5 |
| A6 | GitHub: the `django-dev` environment, its variables, and `LAI_DEPLOY_ENABLED=true` | 5.7 |
| A7 | First release, by dispatching `deploy-django-ec2.yml` for dev. It creates the schema | 5.8 |
| A8 | First-time Django tasks through the bootstrap document (`load_content`, admin account) | 5.9 |
| A9 | Later, and separate: retire `LaiAiGuardrailOnly-dev` and deploy `LaiAiGuardrail-dev` (C2, AI-FU-2). Then deploy `LaiFrontend-dev` and switch on the site release (`deployment-design.md` section 9) | |

## 4. Acceptance checks

Run on the owner's machine, signed in to the account (read-only):

```bash
scripts/aws/verify-dev.sh dev
```

For the signed-in checks, add a test parent's Cognito **access** token (Django accepts access
tokens only) and, optionally, one of that parent's child ids:

```bash
LAI_TEST_ACCESS_TOKEN='<access token>' LAI_TEST_CHILD_ID='<child uuid>' scripts/aws/verify-dev.sh dev
```

Getting the token: sign in to the app as the test parent. The browser's local storage key
`CognitoIdentityServiceProvider.<client id>.<user>.accessToken` holds it. The token lasts about an
hour and is never printed by the script. The one write the script makes is `POST /api/v1/me/`,
which creates that parent's Django account the first time, as the app itself does.

| Area | The script checks | Pass means |
|---|---|---|
| Identity | `sts get-caller-identity` | The expected account (`008331939914`) |
| Stacks | `LaiAssetStorage-dev`, `LaiChildPhotos-dev`, `LaiDjangoRelease`, `LaiDjangoEc2-dev` | `CREATE_COMPLETE` or `UPDATE_COMPLETE` |
| Guardrail | `LaiAiGuardrail-dev` vs `LaiAiGuardrailOnly-dev` | WARN, not FAIL, until A9 |
| EC2 | Instance state and IMDS; SSM agent | `running`, IMDSv2 `required`, `Online` |
| Load balancer | Target health; HTTPS listener default | All targets `healthy`; default action `fixed-response` (unknown hosts get a 404) |
| RDS | `lai-django-dev` | `available`, not public, encrypted, deletion protected, **Single-AZ** |
| SSM | Names under `/lai/dev/django` (values never decrypted) | All 12 required, including `DJANGO_SECRET_KEY` |
| Buckets | Asset and child-photo buckets named in SSM | Both reachable, all four public-access blocks on, versioned, encrypted, and **two different buckets** (ADR-042) |
| Cognito | The pool in `COGNITO_USER_POOL_ID`; its JWKS | Pool exists; JWKS 200 |
| Hosts | `https://<api>/api/v1/health/ready/`, `https://<api>/admin/`, `https://<admin>/`, `https://<admin>/admin/login/`, `https://<admin>/api/v1/health/` | 200, 404, 302 to `/admin/`, 200, 404 |
| Signed in (token) | `POST /api/v1/me/`, `GET /api/v1/children/`, `GET /api/v1/children/<id>/home/` | 200 or 201, 200, 200: Django verifies the Cognito token and reads progress from RDS |
| Site (optional) | `LaiFrontend-dev` in us-east-1; `https://<site>/` and `https://<site>/api/v1/health/` | Skipped until A9 |

The card is accepted when the run shows **0 FAIL** with the token checks included. Every WARN must
be explained: the Guardrail WARN is expected until A9. Exit code 0 means no FAIL.

Not covered by the script (do once by hand, record in section 6):
- Sign-in, child selection and one adventure in the browser, against Django
  (`VITE_BACKEND=django` on a branch, `AMPLIFY_HOSTING.md` section 7).
- One admin sign-in on the admin host.
- A deliberate rollback dispatch (`DJANGO_EC2_DEPLOYMENT.md` section 8).

## 5. The script

`scripts/aws/verify-dev.sh [dev|prod]`:
- **Read-only.** It calls only AWS `describe-*`, `get-*`, `list-*` and `head-*` operations, and
  never `--with-decryption`. `tests/deploy/test_verify_dev.py` fails if that ever changes.
- It prints one PASS, FAIL, WARN or SKIP line per check, a summary, and exits 1 on any FAIL. It
  stops early, with a FAIL, when credentials or `LaiDjangoEc2-<env>` are missing.
- Tested against fake `aws` and `curl` (9 tests): a healthy environment, a missing stack, the
  out-of-band Guardrail, a public database and an open bucket, a missing setting, broken host
  isolation, no credentials, the token never printed, and the read-only guard.

## 6. Evidence (owner pastes, Claude judges)

| Date (UTC) | Who ran it | Command | Result | Judged by |
|---|---|---|---|---|
| | | | | |

Paste the full output of each run below, newest first.
