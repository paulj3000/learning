# Amplify exit: status by card (AMP-01 to AMP-08)

Date: 2026-11-10. Branch `ccr-a0f9421a-g0ifoe` (based on `main` `a037629`, with the AMP-01 audit
`419766c`). Nothing here is deployed; no AWS resource was read or changed.

**Merge gate.** Merging this branch is the frontend cutover: the app no longer reads Amplify
Data, Storage or Functions, so it works only where `/api/` reaches Django and the build has
`VITE_COGNITO_*` and `VITE_BACKEND=django` (the CloudFront release, `deploy-site.yml`). Follow
`AMPLIFY_DECOMMISSION.md` stages 1 to 4 before merging.

| Card | Code state on the branch | Evidence | Open (owner or live) |
|---|---|---|---|
| AMP-01 | Audit, merged (PR #14) | `AMPLIFY_EXIT_MATRIX.md` | None: the live counts came from the AMP-08 stage 0 run |
| AMP-02 | Done in code | Section AMP-02 below | Browser and live-pool acceptance |
| AMP-03 | Done in code | `PLAY_API.md` "Per-child state outside region play"; Django tests listed below | DynamoDB importers (G8) if live data exists; Django Admin parity sign-off (G10); reconcile with `dev20261103` step runner (G2) |
| AMP-04 | Done in code; migration commands built | `AMPLIFY_STORAGE_CUTOVER.md` | G9 consent gate; buckets deployed; copy run and reconciled |
| AMP-05 | Done in code; alarms in CDK | `AMPLIFY_FUNCTIONS_EXIT.md` | `cdk diff` and deploy; co-op reading of ADR-026 |
| AMP-06 | Done in code | Section AMP-06 below | `LaiFrontend` change set; repository variables; DNS; smoke tests |
| AMP-07 | Done for the app; backend definition kept on purpose | Section AMP-07 below | Final removal in AMP-08 stage 6 |
| AMP-08 | Runbook only | `AMPLIFY_DECOMMISSION.md` | Every stage needs owner approval |

## AMP-02: Amplify Auth replaced, Cognito kept

- `react/src/lib/cognito/`: `srp.ts` (Cognito `USER_SRP_AUTH` on Web Crypto and `BigInt`),
  `service.ts` (the user pool JSON API), `auth.ts` (session, refresh, sign-out, account calls),
  `config.ts` (`VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`).
- The existing app client allows only SRP (and refresh), so no AWS change is needed. The password
  never leaves the browser.
- Tokens stay in the `localStorage` keys Amplify v6 used, so signed-in parents stay signed in and
  ADR-024 gate A1 is unchanged. Refresh happens a minute before expiry; concurrent callers share
  one refresh; a refused refresh token ends the session. Sign-out revokes the refresh token.
- Switched: `AuthContext`, sign-in, sign-up (with auto sign-in after confirmation while the page
  is open), confirmation, forgot password, recent sign-in verification (LAI-0209), account
  settings, the Django access token, account deletion, the multiplayer token,
  `scripts/ai-red-team.ts` and `scripts/grant-admin.ts`. `scripts/live-smoke.ts` (Amplify Data
  only) is removed.
- Tests: `srp.test.ts` pins the proof to a vector produced by the Amplify v6 client and checks a
  full round trip against a simulated SRP server; `auth.test.ts` runs sign-in, refresh, sign-out
  and every account call against a fake Cognito that verifies the SRP proof.
- Django Admin staff sign-in is unchanged and separate.

## AMP-06: no Amplify read in the site release

- `.github/actions/site-release` builds with `VITE_COGNITO_*` from the repository variables
  `LAI_COGNITO_USER_POOL_ID` and `LAI_COGNITO_CLIENT_ID`; `ampx generate outputs` is gone.
- `LaiFrontend` loses the `AmplifyAppId` parameter and every Amplify statement on the site
  deploy role; `scripts/aws/provision.sh` no longer asks for `LAI_AMPLIFY_APP_ID`.
- The S3 and CloudFront hosting itself, SPA fallback, caching and invalidation were built in
  LAI-INFRA-003 and 004 (`docs/infrastructure/deployment-design.md`).
- The multiplayer room server reads environment variables only and checks child ownership through
  Django (`docs/multiplayer/MULTIPLAYER_SERVER.md`).

## AMP-07: build dependencies

Removed: `aws-amplify` (root and `react/`; 46 packages leave the lockfile),
`react/src/lib/amplify-config.ts`, `react/src/lib/data-client.ts`, `npm run sandbox`, the
acceptance suite's synthetic `amplify_outputs.json`, Amplify mocks in tests, and the README's
sandbox instructions. The production bundle contains no Amplify code (checked by searching
`react/dist` for `aws-amplify`, `appsync` and `amplify_outputs`).

Kept on purpose until AMP-08 stage 6, because they define live resources and Amplify Hosting
still runs `ampx pipeline-deploy` from `amplify.yml`: `amplify/`, `amplify.yml`,
`customHttp.yml`, `amplify-hosting/`, `@aws-amplify/backend`, `@aws-amplify/backend-cli` and the
`amplify/tsconfig.json` typecheck. Removing the backend definition while that pipeline runs could
make CloudFormation delete the user pool and tables.

Not done: the `VITE_BACKEND` switch still exists (a build without `VITE_BACKEND=django` calls
same-origin Django and degrades to authored fallbacks); making Django the default is a small
follow-up once the Amplify Hosting build is gone.

## Checks run on the merged branch

- `npm run typecheck` (app, scripts, server, infra, legacy `amplify/`) and `npm run build`: pass.
- Vitest, full suite: 390 files, 4311 tests passed.
- pytest, full suite against a local PostgreSQL 16 (`LAI_REQUIRE_POSTGRES=1`): 2638 passed,
  3 skipped. `ruff check`, `ruff format --check` and `makemigrations --check`: clean.
- Prettier `--check .`: clean. oxlint: no errors.
- Not run (merge or release readiness): Playwright browser suites, live Cognito, AWS deploys.
