# Implementation Status

## Current state

Phase 0 foundation, Phase 1 (parent accounts and child profiles), and Phase 2
(island shell) are complete. The island is navigable with a chosen companion,
but no adventures are playable yet — that's Phase 3.

## Current phase

Phase 2 — Island Shell: complete.

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
- **Phase 1 — Auth backend** (`amplify/auth/resource.ts`): Cognito email/password
  login for parent accounts only (ADR-001); no child identities.
- **Phase 1 — Data backend** (`amplify/data/resource.ts`): `ParentProfile` and
  `ChildProfile` models per `docs/DATA_MODEL.md`, both owner-authorized so
  `.list()`/`.get()` are automatically scoped to the signed-in parent. Wired into
  `amplify/backend.ts` alongside auth.
- **Phase 1 — Auth UI** (`src/features/auth/`): custom sign-up, email confirmation
  (with resend), sign-in, and forgot/reset-password forms built directly against
  `aws-amplify/auth` (no new dependency); an `AuthProvider`/`useAuth` context
  backed by `getCurrentUser` and a Hub listener; a `RequireParent` route guard
  with distinct loading/unauthenticated/"backend not connected" states; Cognito
  errors mapped to plain-language, readable-aloud copy (`errors.ts`).
- **Phase 1 — Child profile UI** (`src/features/child-profile/`): create/edit
  form (nickname, age band, avatar, up to 5 curated interests, reading mode,
  session-minute bounds per age band from CLAUDE.md section 3), a dashboard list
  with deactivate/reactivate and "Enter island", and a `ParentGate` arithmetic
  challenge component used before deactivating a profile and before leaving
  child mode.
- **Phase 1 — Routes** (`src/routes/`, wired in `src/app/AppRoutes.tsx`):
  `/sign-up`, `/confirm`, `/sign-in`, `/forgot-password`, `/parent` (dashboard),
  `/parent/children/new`, `/parent/children/:childId/edit`, and a placeholder
  `/island/:childId` child-mode shell establishing the parent/child route split
  ahead of Phase 2's real island content. `Home.tsx` rewritten as a landing page
  with sign-up/sign-in CTAs (or a calm "backend not connected" notice when
  `amplify_outputs.json` is absent).
- **Phase 1 — Amplify config loading** (`src/lib/amplify-config.ts`): loads
  `amplify_outputs.json` via `import.meta.glob` (zero-match-safe) instead of a
  static import, since that file is gitignored and does not exist in CI or in a
  fresh checkout; `isAmplifyConfigured` is `false` when it's missing, so
  `dev`/`build`/`test`/`test:e2e` all still work with no deployed backend.
  **Fixed after initial Phase 1 delivery:** `Amplify.configure()` now runs as a
  side effect of importing this module, rather than via an exported function a
  caller had to remember to invoke. The original version required `App.tsx` to
  call `configureAmplify()`, but ES module evaluation order meant
  `src/lib/data-client.ts`'s `generateClient()` always ran first regardless of
  route, breaking every screen that touched the data client (surfaced as
  "Client could not be generated..." on `/parent`). `data-client.ts` now
  imports `amplify-config.ts` directly, immediately before calling
  `generateClient()`, which guarantees correct ordering no matter what else is
  going on in the wider import graph.
- Unit/component tests added alongside every Phase 1 module (validators, forms,
  `ParentGate`, `ChildProfileForm`, `ChildProfileList`); `App.test.tsx` and
  `e2e/smoke.spec.ts` updated for the new landing page and extended with
  render-only checks for `/sign-up` and `/sign-in`.
- **Phase 2 — Data backend** (`amplify/data/resource.ts`): added
  `CompanionProfile` (owner-authorized, same pattern as `ChildProfile`), plus
  a `hasOne`/`belongsTo` relationship between `ChildProfile` and
  `CompanionProfile`. `cosmeticState` from `docs/DATA_MODEL.md` was
  intentionally left off the model — it's marked optional there and nothing
  in Phase 2 reads or writes it yet.
- **Phase 2 — Island shell** (`src/features/island/`, new): `locations.ts`
  (static content for the three MVP locations — Pirate Builder Bay,
  Wonderwild Forest, Storykeeper Castle — since `docs/DATA_MODEL.md`'s
  `IslandLocation` is "content-managed reference data" for an admin role that
  doesn't exist yet); `events.ts` (a small curated, date-deterministic "today
  on the island" message, no AI/backend); `api.ts`
  (`getOrCreateCompanionProfile`/`getCompanionProfile`, same shape as the
  Phase 1 child-profile API); `IslandLayout.tsx` (shared header/nav +
  parent-gated exit for every child-mode screen, reusing the existing
  `ParentGate` component rather than duplicating it); `CompanionIntro.tsx`
  (first-visit "Meet Chatty the Parrot" companion-selection card).
- **Phase 2 — Routes**: replaced the Phase 1 `ChildModePlaceholder` with
  `WelcomeHarbor` (`/island/:childId` — companion intro on first visit, then
  the map, today's event, and a log link, matching
  `docs/PRODUCT_VISION.md`'s description of Welcome Harbor as the map/event/
  companion/log hub), `IslandLocationPage`
  (`/island/:childId/locations/:locationSlug` — static, described, not yet
  playable), and `AdventureLog` (`/island/:childId/log` — empty-state shell;
  real entries arrive with Phase 3's adventure sessions).
- Unit/component tests added for the new island module (`events.test.ts`,
  `CompanionIntro.test.tsx`).

## Next task

Begin Phase 3 (Deterministic Adventure Engine) per `docs/ROADMAP.md`: the
typed adventure definition format, state machine and transition validation,
hint ladder, session persistence, skill-evidence and world-change events, and
one complete Pirate Builder Bay adventure authored without AI — filling in
the `/island/:childId/locations/pirate-builder-bay` shell added in Phase 2.

## Verification (this session)

- `npm run typecheck` — passed.
- `npm run lint` — passed (same 2 pre-existing-style warnings as Phase 1, not
  errors: `AuthContext.tsx` exports both a component and a hook from one
  file, and `ParentGate.tsx` uses `role="dialog"` on a `div` rather than a
  native `<dialog>`; both are deliberate, common, low-risk patterns, kept as
  warnings rather than "fixed" into more complexity than needed).
- `npm run format:check` — passed.
- `npm run test` — passed (10 files, 40 tests).
- `npm run build` — passed (same informational chunk-size warning for the
  `aws-amplify` SDK bundle as Phase 1; still not addressed, still a premature
  optimization for an MVP with no traffic yet).
- `npm run test:e2e` — passed (3 tests, Chromium; unchanged from Phase 1 —
  the new island routes require a signed-in parent against a real deployed
  backend, which isn't reachable in this sandbox, so no new e2e coverage was
  added for them).
- `npx ampx sandbox` was **not** run against a real AWS account this session (requires
  AWS credentials; `.claude/settings.json` denies `aws:*` commands in this environment,
  and deploying cloud resources is a user decision). The backend was verified
  structurally instead: `amplify/auth/resource.ts` and `amplify/data/resource.ts`
  type-check under `amplify/tsconfig.json`.

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
- Found and fixed three `node_modules` packages this session that were installed
  with most of their `dist` output missing (`@aws-amplify/data-schema`,
  `@testing-library/user-event`, and the `graphql@15.8.0` nested under
  `@aws-amplify/api-graphql`) — each had its CJS build intact but was missing
  its type declarations and/or ESM build, which broke `tsc`/`vite build`
  respectively. A plain `npm install` did not restore them; a targeted
  `npm install <pkg>@<version> --no-save --force` (run inside the nested
  package's own directory for the `graphql` case) did. Root cause looks like
  the same class of bundled-dependency install instability already documented
  above for `npm ci`. If a fresh `npm install` on another machine hits similar
  missing-file errors from `tsc` or `vite build`, this is the fix; consider a
  postinstall integrity check if it recurs.
- **Owner-authorization backend tests are not runnable in this environment.**
  `docs/TESTING_STRATEGY.md` calls for testing "owner isolation between parent
  accounts" and "child profile CRUD authorization," but that requires a
  deployed `ampx sandbox` (real Cognito + AppSync) — unavailable here (no AWS
  credentials, `.claude/settings.json` denies `aws:*`). What shipped instead:
  `amplify/data/resource.ts` declares `allow.owner()` on `ParentProfile`,
  `ChildProfile`, and (as of Phase 2) `CompanionProfile`, and the feature
  `api.ts` modules rely on that (no manual owner filtering client-side). A
  real test, once someone runs `ampx sandbox` with credentials, would: sign up
  two parent users, have each create a child profile (and, for
  `CompanionProfile`, a companion), and assert that parent A's authenticated
  client cannot `get`/`list`/`update` parent B's records for any of the three
  models (expect an authorization error or empty result, not the data).
- `MAX_CHILD_PROFILES` (3) is enforced only in `ChildProfileList.tsx`
  (client-side UI). There is no server-side guard, so a direct API call could
  create a fourth profile. Low severity (no cross-user exposure), but worth a
  custom mutation if this ever needs to be a real limit rather than a UI nudge.

## Decisions pending

- Final visual design direction and art pipeline.
- Bedrock model selection by region, capability, latency, and cost.
- Text-to-speech provider and voice consent model.
- Formal curriculum framework mapping.
- Legal/privacy review and retention schedule.

