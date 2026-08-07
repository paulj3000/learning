# Implementation Status

## Current state

Phase 0 foundation is scaffolded. No product features exist yet.

## Current phase

Phase 0 — Foundation: complete.

## Completed

- Product concept documented.
- Initial architecture documented.
- Initial domain model documented.
- AI and child-safety requirements documented.
- MVP roadmap documented.
- React + Vite + strict TypeScript scaffold (`src/`, `index.html`, `vite.config.ts`,
  `tsconfig*.json`).
- Amplify Gen 2 backend scaffold (`amplify/backend.ts`) with no resources defined yet;
  auth and data are deferred to Phase 1 by design.
- oxlint (linting) and Prettier (formatting) configured.
- Vitest + React Testing Library configured, with a smoke test for the application shell.
- Playwright configured, with a smoke end-to-end test for the home route.
- GitHub Actions CI workflow running typecheck, lint, format check, unit tests, build,
  and end-to-end tests.
- Base design tokens (`src/styles/tokens.css`) and an accessible application shell
  (routing, error boundary, skip link) with a placeholder home route. No island map,
  auth, or adventure features.
- Repository folder skeleton for `src/features/*`, `src/lib`, `src/components` per
  `CLAUDE.md` section 8 (empty, `.gitkeep` placeholders only).
- Local development and Amplify sandbox setup documented in `README.md`.
- `amplify.yml` build spec added at repo root so Amplify Hosting builds the frontend
  (`dist/`) and runs `ampx pipeline-deploy` for the backend.
- `amplify.yml` caching tightened: `npm install` now points at a repo-local
  `.npm-cache` directory (via `npm config set cache`) and runs with
  `--prefer-offline`, and that directory is added alongside `node_modules` to the
  Amplify Hosting `cache.paths`. Amplify was already caching `node_modules`, but
  `node_modules` cache-misses (e.g. any lockfile change) previously forced a full
  re-download from the npm registry on every build; caching the npm download cache
  too means those installs resolve from local disk instead.

## Next task

Begin Phase 1 (Parent Accounts and Child Profiles) per `docs/ROADMAP.md`: Cognito auth,
`ParentProfile`/`ChildProfile` schema, and owner-authorization tests.

## Verification (this session)

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format:check` — passed.
- `npm run test` — passed (1 file, 2 tests).
- `npm run build` — passed.
- `npm run test:e2e` — passed (1 test, Chromium).
- `npx ampx sandbox` was **not** run against a real AWS account this session (requires
  AWS credentials; `.claude/settings.json` denies `aws:*` commands in this environment,
  and deploying cloud resources is a user decision). The backend was verified
  structurally instead: `amplify/backend.ts` type-checks under `amplify/tsconfig.json`,
  and `npx ampx sandbox --help` resolves correctly, confirming the CLI is wired up.

## Known risks / TODOs

- `npm ci` fails with a false-positive `EUSAGE`/"Missing: X from lock file" error
  (`@opentelemetry/core@2.0.0`, `yaml@1.10.3`) even against a freshly generated
  `package-lock.json`. Root cause: `@aws-amplify/data-construct` and
  `@aws-amplify/graphql-api-construct` (pulled in transitively via
  `@aws-amplify/backend-cli` → `aws-cdk-lib`) ship `bundledDependencies` with exact
  pinned versions that npm's lockfile-integrity check for `npm ci` cannot reconcile.
  `npm install` resolves and installs the same tree without error. Both
  `.github/workflows/ci.yml` and the new `amplify.yml` were changed from `npm ci` to
  `npm install` to work around this; revisit and switch back to `npm ci` once upstream
  (`npm` or `@aws-amplify/*`) fixes the bundled-dependency/lockfile interaction.
- `npm audit` reports vulnerabilities in dev-only transitive dependencies of the
  official `@aws-amplify/backend-cli` toolchain (GraphQL codegen and Relay-compiler
  packages: `lodash`, `immutable`, `brace-expansion`, etc.). These run only when
  invoking `ampx` commands locally/in CI and are not part of the shipped browser
  bundle. No upstream fix is available yet without downgrading Amplify tooling;
  revisit when AWS publishes updated releases.
- `react-router-dom@7.18.2` carries a high-severity advisory (RSC Mode CSRF Bypass,
  GHSA-qwww-vcr4-c8h2). This app uses React Router only as a client-side SPA router
  (no RSC/SSR/single-fetch server actions), so the advisory's attack surface does not
  apply here. Confirmed the alternative (pinning to the last unaffected 7.11.0) trades
  this for several other unpatched high-severity issues, so staying on latest is the
  safer choice. Revisit when a patched release is available.
- Amplify sandbox has not been deployed against a live AWS account; first real deploy
  and credential setup remain for whoever provisions the AWS environment.
- No visual design system, Bedrock model selection, or TTS provider yet (unchanged
  from before this phase).

## Decisions pending

- Final visual design direction and art pipeline.
- Bedrock model selection by region, capability, latency, and cost.
- Text-to-speech provider and voice consent model.
- Exact parent gate mechanism.
- Formal curriculum framework mapping.
- Legal/privacy review and retention schedule.

