# Amplify Hosting for the React app

Status: repository configuration complete (2026-10-25). Nothing has been deployed, pushed, or
changed in AWS. Section 9 lists the console steps, all of which need owner approval.

The frontend is React 19 + Vite + Three.js, hosted by Amplify Hosting. The backend is still
Amplify Gen 2 (Cognito, AppSync, DynamoDB, S3, Lambda). Django (ADR-019) is built but
switched off in the browser, and has no deployed environment.

## 1. What already exists

Established from the repository. The AWS CLI was not available to this task, so the
live state is still marked unverified, as in `docs/CURRENT_AWS_RESOURCE_INVENTORY.md`.

| Item | Finding |
| --- | --- |
| Amplify Hosting app | **Very likely exists, with `main` connected.** `amplify/backend.ts` records a sandbox failure against stack `amplify-<appId>-main-branch-...`, which only a Hosting branch build creates. App id, region, and other branches: unverified. Do not create a second app. |
| Build spec | `amplify.yml` at the repository root existed before this task. Its backend phase runs `ampx pipeline-deploy`, so **every build of a connected branch deploys that branch's backend**. |
| App root | The repository root. It holds the npm workspace root (`workspaces: ["react"]`), the only `package-lock.json`, and `amplify/`. `react/` has no lockfile of its own; dependencies install from the root. |
| Build | `npm run build` at the root runs the `react` workspace: `tsc -b && vite build`, output `react/dist`. |
| Static files | `react/public` (`models/` with `.gltf`/`.glb`, `fonts/` with `.woff2`, `favicon.svg`) is copied to the root of `react/dist`. Vite's hashed output goes to `react/dist/assets/`. |
| Backend config in the browser | `react/src/lib/amplify-config.ts` reads the gitignored `amplify_outputs.json` at build time through `import.meta.glob`. `pipeline-deploy` (or `ampx generate outputs`) writes it. Without it the app still builds but has no Cognito or data. |
| Cognito | Email and password through SRP (`amplify/auth/resource.ts`). No Hosted UI, no OAuth, so **no callback or sign-out URLs** depend on the hosting domain. |
| Storage | Signed S3 URLs from Amplify Storage (`getUrl`) for admin models and child photos. Cross-origin GETs depend on the bucket's CORS rule, which Gen 2 creates. |
| Router | `BrowserRouter` routes such as `/home/children/:childId/dashboard` and `/island/:childId/world/storykeeper-castle-3d`. A refresh on these needs the rewrite in section 3. |
| Source maps | Vite's default (`build.sourcemap` unset, so off). No `.map` files ship. |

## 2. Build specification (`amplify.yml`)

Changes from the previous spec:
- `npm ci` instead of `npm install`, so builds use exactly the lockfile. This needed the lockfile
  fix in section 8.
- `nvm install 22` and `nvm use 22`: Vite 8 needs Node 22.12 or later, and the build image
  default is not guaranteed.
- `LAI_SKIP_BACKEND_DEPLOY` (section 6). When it is unset the build behaves as before.
- The frontend fails early if `amplify_outputs.json` is missing, instead of publishing a site
  with no backend.
- The cache keeps only `.npm-cache`; `npm ci` deletes `node_modules` anyway.

Unchanged: the root is the app root, `npm run build`, `baseDirectory: react/dist`. Git-based
branch builds are Amplify Hosting's default; which branches build is a console setting.

## 3. SPA rewrites (`amplify-hosting/custom-rules.json`)

Amplify Hosting keeps rewrites in the app settings, not in `amplify.yml`. The rule file holds
the exact rule to configure in the console (Hosting, Rewrites and redirects, Manage, JSON) or
with `aws amplify update-app --custom-rules`.

One rule: any path without a file extension, or with one that is not a static file type, is
answered with `/index.html` and status 200. So a refresh on a nested route returns the app,
and React Router renders the route.
- Paths under `/api/` are excluded, so they return 404 now and never the app's HTML. The
  future Django route (section 7) goes in front of this rule.
- `react/src/app/hostingRewrites.test.ts` checks the rule against real routes, Vite output, and
  every file type in `react/public`. Adding a new asset type to `react/public` fails the test
  until the type is added to the rule.

## 4. Response headers (`customHttp.yml`)

Amplify Hosting reads `customHttp.yml` from the app root on each build.

| Path | Cache-Control | Reason |
| --- | --- | --- |
| `assets/**` | `public, max-age=31536000, immutable` | Vite adds a content hash to every name |
| `models/**`, `fonts/**` | `public, max-age=3600` | Fixed names in `react/public`; a replaced model reaches browsers within an hour |
| HTML and everything else | Amplify default | `index.html` must not be cached long, or users keep old asset names after a release |

Every response also gets `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, and `Referrer-Policy: strict-origin-when-cross-origin`.

A Content-Security-Policy is deliberately not set yet. It must list the Cognito, AppSync
(including its WebSocket), S3, and multiplayer origins of each environment. A wrong policy
breaks sign-in, so it needs a browser test against a deployed branch first. Tracked in section 10.

## 5. Environment variables

Vite compiles every `VITE_` variable into the JavaScript bundle. Anyone can read it. Never put
a password, AWS key, token, database URL, or other secret in one.

### Set in the Amplify Console (per branch, App settings, Environment variables)

| Variable | Used by | Development | Preview or staging | Production (`main`) |
| --- | --- | --- | --- | --- |
| `VITE_BACKEND` | React (`react/src/api/config.ts`) | unset, or `django` locally | **unset** | **unset** |
| `VITE_DJANGO_API_BASE` | React | empty (same-origin through the Vite proxy) | unset | unset |
| `VITE_MODEL_MAX_UPLOAD_MB` | React, admin model upload | optional, default 50 | optional | optional |
| `VITE_MODEL_WARN_UPLOAD_MB` | React, admin model upload | optional, default 10 | optional | optional |
| `LAI_SKIP_BACKEND_DEPLOY` | `amplify.yml` only (not in the bundle) | n/a | `true` once its backend exists | see section 6 |
| `PILOT_ALERT_EMAIL` | Gen 2 backend synth (`amplify/backend.ts`) | sandbox shell | as needed | as already set |
| `PILOT_MONTHLY_BEDROCK_BUDGET_USD` | Gen 2 backend synth | sandbox shell | as needed | as already set |

`VITE_BACKEND` stays unset in every hosted branch until the Django migration tasks enable it.
Unset means `readDjangoApiConfig` returns `disabled` and every call stays on Amplify.

### Not variables

- Cognito user pool, client, and identity pool ids, the AppSync endpoint, and the S3 bucket all
  come from the generated `amplify_outputs.json`. They are public identifiers by design. No
  replacement variables are needed.
- 3D models are same-origin static files under `/models/`. Admin-uploaded models use signed S3
  URLs from Amplify Storage.
- Amplify sets `AWS_APP_ID`, `AWS_BRANCH`, and `AWS_JOB_ID` itself.
- `DJANGO_DEV_PROXY_TARGET` is for `vite dev` only and accepts a loopback origin only.

## 6. Branches and what a build changes in AWS

**Connecting a branch, or pushing to one that is connected, deploys its backend.** With
`LAI_SKIP_BACKEND_DEPLOY` unset, the build runs `ampx pipeline-deploy`, a CloudFormation
deployment of that branch's Cognito pool, AppSync API, DynamoDB tables, S3 bucket, Lambdas,
alarms, and dashboard. For `main` this updates production. For a new branch it **creates** a
complete new backend, at cost.

Recommended setup:
- **`main`**: the only branch with auto-build on. It keeps deploying its own backend, because
  backend changes on `main` reach production only that way. Anything merged to `main` and
  pushed is a production backend deployment, so review `amplify/` diffs as infrastructure.
- **Feature branches**: not connected. Use `npm run dev` and `ampx sandbox` locally. Turn
  **off** branch auto-detection (App settings, Branch settings), so a pushed branch never
  creates a backend.
- **Optional `staging`**: only with owner approval. The first build creates an isolated
  backend with no production data. After that, keep `LAI_SKIP_BACKEND_DEPLOY` unset while you
  want backend changes tested there.
- **Frontend-only release of `main`**: set `LAI_SKIP_BACKEND_DEPLOY=true` on `main` for the
  build. It fetches the outputs of `main`'s existing backend and changes no AWS resource. Remove
  it afterwards, or backend changes stop deploying.
- **Preview builds for pull requests**: keep off. Each preview would create a full backend.

Never point a preview or staging frontend at the production backend. Its sign-ins would be
real parent accounts and its writes would be real child data.

## 7. Future Django route

The client already expects the deployed shape: `VITE_BACKEND=django` with an empty
`VITE_DJANGO_API_BASE` calls same-origin `/api/v1/...`. Django has no CORS on purpose (TR-D14),
so the API must sit on the same origin as the site.

1. **LAI-1005 (target).** CloudFront serves the React build and routes `/api/*` to the Django
   load balancer. Same origin, no CORS, one TLS certificate. This replaces Amplify Hosting for
   the frontend, as `docs/CURRENT_AWS_RESOURCE_INVENTORY.md` plans ("RETIRE LATER").
2. **Interim, if Amplify Hosting stays.** Add a 200 proxy rewrite **above** the SPA rule:
   `{"source": "/api/<*>", "target": "https://<django-host>/api/<*>", "status": "200"}`.
   Before relying on it, confirm on a staging branch that `Authorization` reaches Django, that
   request size and timeout limits suit the play API, and that Django trusts the forwarded host
   and protocol only from the proxy.

Either way the React code does not change. The prerequisites: the Django service is deployed
(LAI-1004), the parity tasks are done, and the owner approves setting `VITE_BACKEND=django` on
a branch. The `/api/` exclusion in today's rule means no existing Amplify route changes.

## 8. The `npm ci` failure and its fix

`npm ci` failed with `zod@3.24.2 does not satisfy zod@3.25.17` and `Missing:
@opentelemetry/core@2.0.0`. Both come from `@aws-amplify/data-construct` and
`@aws-amplify/graphql-api-construct`. They publish bundled dependencies whose versions
disagree with one another, for example a bundled `@opentelemetry/resources@2.0.0` that requires
`@opentelemetry/core@2.0.0` next to a bundled `@opentelemetry/core@2.8.0`. `npm install`
tolerated the old lockfile; `npm ci` does not.

The fix is `npm install --package-lock-only`, run with no package version changes. It adds the
lock entries npm expects inside those two bundles, plus optional `@tailwindcss/oxide-wasm32-wasi`
entries. No top-level or direct dependency version changed. The installed bundled code is the
same, because bundled files come from the published tarballs. `npm ci` now passes on Node 22
and npm 10.9; CI uses it too.

`jsdom@30` warns that it wants Node 22.22.2 or later. It is a test-only dependency. The warning
does not stop an install.

## 9. Console setup (each step needs owner approval)

1. Confirm the app: `aws amplify list-apps`, then `aws amplify list-branches --app-id <id>`.
   Record the app id, region, connected branches, and the build image's Node version in
   `docs/CURRENT_AWS_RESOURCE_INVENTORY.md`.
2. Branch settings: turn off branch auto-detection and pull request previews. Keep auto-build
   only on `main`.
3. Environment variables: check that `VITE_BACKEND` is not set on `main`. Keep `PILOT_*`
   as they are.
4. Rewrites and redirects: replace the rules with `amplify-hosting/custom-rules.json`. If the
   app has the default `/<*>` to `/index.html` 404-200 rule, this replaces it.
5. Build settings: confirm the app uses the repository's `amplify.yml` and no console
   override.
6. Deploy: a push to `main` builds and runs `pipeline-deploy`. For the first build on the new
   spec with no backend change wanted, set `LAI_SKIP_BACKEND_DEPLOY=true` on `main` first.
7. After the deploy: open a nested route and refresh, sign in, open a child's island and a 3D
   world, and check the `curl -I` headers on `/`, `/assets/<file>.js`, and
   `/models/<file>.gltf`.

## 10. Risks and open items

- **Unverified live state.** The app, branches, Node version, and any console build-spec
  override are inferred from the repository. Step 1 of section 9 settles them.
- **Push to `main` deploys the backend.** This was already true. The new spec makes it
  explicit and adds the opt-out.
- **`nvm install 22`** picks the newest 22.x at build time. It needs network access in the build
  container, which `npm ci` needs anyway.
- **Rewrite replacement.** A console rule that already exists may differ from the file. Compare
  them before replacing.
- **No Content-Security-Policy yet** (section 4).
- **S3 CORS** for signed URLs from a new domain relies on the Gen 2 default rule. Check it on the
  first deployed branch with a custom domain.
- **Task id.** `docs/DJANGO_MIGRATION_ROADMAP.md` uses LAI-1001 for "CDK app and environment
  config" (`infra/**`). This hosting task does not do that; the CDK task stays open.
