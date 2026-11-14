# Amplify final removal and Django-only cutover (AMP-01 to AMP-08)

Status: **source complete; AWS deployment and legacy data acceptance deferred.** Branch
`feature/amplify-final-removal`, 2026-11-14.

The owner deleted the Amplify app and disabled Amplify Hosting, and authorized removing every
Amplify dependency from the source (2026-11-14). This document records what was removed, what
replaced it, how the remaining references are classified, and what is still owed in AWS. Earlier
records stay as history: `AMPLIFY_EXIT_MATRIX.md`, `AMPLIFY_EXIT_STATUS.md`,
`AMPLIFY_FUNCTIONS_EXIT.md`, `AMPLIFY_HOSTING.md`, `AMPLIFY_STORAGE_CUTOVER.md`,
`AMPLIFY_DECOMMISSION.md`, `AMPLIFY_PROFILE_IMPORT.md`. Where they describe a `VITE_BACKEND`
switch, an Amplify branch, an Amplify rollback or the sandbox, this document supersedes them.

## 1. Reconciliation (Phase 0)

- **Base.** Latest `main` (`2389348`, the MVP stabilization merge, PRs #31 to #34).
- **PR #15** (Amplify exit, AMP-02 to AMP-08) was written against an older `main`. It was merged
  onto current `main` as one merge commit, never fast-forwarded over it. Conflicts were resolved
  in favour of newer `main` wherever `main` had moved on (Adventure Portal, Realm Explorer, the
  child homepage, NPC dialogue, the P0 Cognito environment and timeout fixes), and in favour of
  PR #15 where it removed Amplify. PR #15 is superseded by this branch and closed with a
  reference to it, not merged.
- **Not touched:** PRs #26 to #29, AP-05, every other open PR and every feature branch.
- **Cognito.** The existing user pool and web app client stay the only parent identity. Checked
  without credentials: the pool's JWKS endpoint answers, and `InitiateAuth` (USER_SRP_AUTH) with
  the web client id answers with a challenge or a user error, never `ResourceNotFoundException`,
  so the pool and client exist and the client allows SRP. No user, client or pool setting was
  created or changed.
- **Retained Amplify data.** The sandbox stack's DynamoDB tables and the media bucket are not
  listed here (this session's IAM cannot read them); `AMPLIFY_DECOMMISSION.md` holds the
  inventory. Nothing was deleted. The import tools stay (section 6).

## 2. What was removed

| Area | Removed | Replaced by |
|---|---|---|
| Packages | `aws-amplify`, `@aws-amplify/backend`, `@aws-amplify/backend-cli` (root and `react/`); lockfile regenerated (1,229 packages fewer) | `react/src/lib/cognito` (direct SRP, no SDK) |
| Backend | `amplify/` (auth, data, storage, four functions, `backend.ts`, persona files, tsconfig) | Django apps in `lai/apps/*` |
| Hosting | `amplify.yml`, `customHttp.yml`, `amplify-hosting/custom-rules.json` and their test | `infra/lib/frontendStack.ts` (S3 + CloudFront, `SPA_REWRITE_FUNCTION`), `.github/actions/site-release`, `infra/lib/spaRewrite.test.ts` |
| Configuration | `react/src/lib/amplify-config.ts`, `amplify_outputs.json` reading, `VITE_BACKEND`, `react/src/api/backend.ts`, the `disabled` API error kind, every "Realms are not open" and Amplify fallback | `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_DJANGO_API_BASE` (`react/src/api/apiBase.ts`, refused at build time if invalid) |
| Data clients | `react/src/lib/data-client.ts`, Amplify profile, catalog, admin and asset clients | Django clients in `react/src/api/*` and the feature `django*` modules |
| React admin pages | The Amplify-backed island and adventure catalog pages under `/admin` | Django Admin (ADR-034, ADR-043); `/admin` keeps the Cognito `Admins` gate and links there |
| Room server | `server/multiplayer/appSyncChildProfiles.ts` | `server/multiplayer/djangoChildProfiles.ts` (child ownership from Django) |
| Scripts | `scripts/live-smoke.ts`, `npm run sandbox`, `ampx`, outputs generation, the `amplify` typecheck project | `scripts/ai-red-team.ts` (Django target only) |
| CI | Amplify build and sandbox steps | Django, Vitest, Playwright and CDK synth jobs; site deploy gated by `LAI_SITE_DEPLOY_ENABLED` |

Gameplay that used to depend on Amplify now runs on Django in every build: the child homepage,
Realm Explorer, solo template adventures (`DjangoAdventureRunner`), co-op launches (the classic
runner over Django co-op routes), castle rooms, discoveries, storybook, NPC dialogue and hints,
companion and tutor turns, speech, assets, profiles and photos.

## 3. Amplify Functions parity (AMP-05)

Every Lambda and AI route had a tested Django replacement before it was removed
(`AMPLIFY_FUNCTIONS_EXIT.md`, table 1):

| Amplify | Django | Tests |
|---|---|---|
| `get-next-learning-activity` | `GET children/<id>/next-learning-activity/` (`apps/education/director.py`) | `education/tests/test_director.py`; `features/director/api.test.ts` |
| `claim-coop-slot`, `CoopSession` model and subscription | `children/<id>/coop-sessions/...` (`apps/game_sessions/coop.py`), polling | `game_sessions/tests/test_coop_api.py` (real two-thread race); `features/coop/api.test.ts` |
| `submit-adventure-answer` | `POST children/<id>/sessions/<id>/answers/` | `game_sessions/tests/test_answers_api.py` |
| `operational-metrics` | `ai.turn v1`, `ai.safety v1` metric filters and alarms (`LaiAiGuardrail`) | `infra/lib/aiGuardrailStack.test.ts` |
| AI Kit `generateCompanionTurn`, `generateTutorTurn` | `children/<id>/ai/companion-turns/`, `tutor-turns/` | `ai/tests`, `companion/api.test.ts`, `tutor/api.test.ts` |
| Persona files `amplify/data/*Persona.ts` | `lai/apps/ai/prompts/` (verified equal at version 2, now pinned by hash) | `ai/tests/test_prompts.py` |

Bedrock and Polly configuration, IAM and the fake providers are unchanged. The browser never
calls Bedrock or Polly: `react/src/test/noAmplify.test.ts` refuses any `@aws-sdk/*` import in
the React app, and any Amplify package, import or backend file anywhere in the source.

## 4. Cognito without Amplify (AMP-02)

`react/src/lib/cognito` implements sign-in (SRP), sign-up, confirmation, resend, forgot and reset
password, sign-out, refresh, session restore and expiry, access tokens for Django, groups from
the ID token, and the recent sign-in check (LAI-0209) against the existing pool. Tokens stay in
the localStorage keys Amplify v6 used, so a parent signed in before the cutover stays signed in.
Reads of the session are time-bounded (`AUTH_CHECK_TIMEOUT_MS`, `TOKEN_TIMEOUT_MS`), and a
timeout shows "unavailable", not a sign-in loop. Django verifies the same pool's access tokens
(`COGNITO_ALLOWED_CLIENT_IDS`) and provisions the parent on `POST /api/v1/me/`; child ownership
is the Django foreign key.

Live sign-in with a real parent account is an **owner check** (no credentials in this session).

## 5. Hosting without Amplify (AMP-06)

Prepared and tested, **not deployed**:

- **Build.** `.github/actions/site-release` builds with `VITE_COGNITO_USER_POOL_ID` and
  `VITE_COGNITO_CLIENT_ID` from the workflow inputs (refused if malformed) and
  `VITE_DJANGO_API_BASE` empty (same-origin).
- **SPA routing.** `SPA_REWRITE_FUNCTION` sends every client route (Realms, adventures, 3D Areas,
  dashboards, sign-in pages) to `index.html` and serves real files as themselves
  (`spaRewrite.test.ts`).
- **API routing.** CloudFront's `/api/*` behaviour goes to the Django load balancer, uncached,
  with `Authorization` forwarded; `VITE_DJANGO_API_BASE` can instead name an `https://` origin.
- **Django Admin** stays on the API host (`api.<domain>/admin/`, WAF rate rule), never behind
  the site distribution.
- `deploy-site.yml` runs nothing until `LAI_SITE_DEPLOY_ENABLED` is `true`. While Amplify Hosting
  is off and this is not deployed, **no frontend is published**.

## 6. Remaining references, classified (AMP-08)

| Class | Where | Why it stays |
|---|---|---|
| 1. Runtime dependency | none | removed |
| 2. Obsolete configuration | `.gitignore` `amplify_outputs.json`; `scripts/check-adrs.ts` skips `.amplify` and `amplify_outputs.json` | defensive: an old checkout may still hold those files, and they must never be committed or scanned |
| 2. Obsolete configuration, not editable here | `react/.env.example` and `.env.sample` | a deny rule in this environment blocks reading `.env*` files; `react/.env.example` still mentions `VITE_BACKEND`, which nothing reads now. **Owner edit** |
| 3. Historical documentation | `docs/` (ADRs, roadmaps, QA reports, the Amplify platform docs above), `tasks/`, `docs/IMPLEMENTATION_STATUS.md` history | the decision record; superseded by this document |
| 3. Historical code comments | `lai/apps/*` ("mirrors the Amplify model", "unchanged from Amplify"), `react/src` (`awsJson.ts`, `submission.ts`, `summary.ts`, `reachability.ts`, `companion/schema.ts`, `tutor/types.ts`), `infra/lib/*` | explain why a Django rule or field has its shape; no code path reads Amplify |
| 3. Test guards | `react/src/test/noAmplify.test.ts`, `react/src/test/engineBoundary*.ts`, `avatarPhoto.test.ts`, `assetService.test.ts`, `e2e/acceptance/p0-navigation.spec.ts` | assert that Amplify is **not** imported or mentioned |
| 3. Compatibility | localStorage token key names (`react/src/lib/cognito`, e2e `fixtures.ts`) | keep existing parents signed in |
| 4. Legacy data migration and rollback | `lai/apps/users/amplify_import.py`, `amplify_photo_migration.py`, `import_amplify_profiles`, `migrate_amplify_child_photos`, `lai/apps/assets/.../migrate_amplify_asset_objects`, `lai/apps/core/legacy_bucket.py`, model fields that keep Amplify ids, `scripts/aws/amplify-inventory.sh`, `scripts/aws/wipe_amplify_history.py` | read-only import of retained data, and the decommission inventory |

## 7. Deferred AWS and data tasks (owner approvals)

1. **Protect the Cognito pool.** Its deletion protection is off and it lives in the Amplify
   sandbox CloudFormation stack (DeletionPolicy Delete). Turn deletion protection on, or retain
   the pool, before anyone deletes that stack. AWS change: APPROVAL.
2. **Live Cognito check** with a real test parent: sign-in, refresh, sign-out, forgot password.
3. **Deploy** `LaiDjangoEc2-<env>`, `LaiAiGuardrail-<env>` and `LaiFrontend-<env>`, then set
   `LAI_SITE_DEPLOY_ENABLED` and run the site release and `scripts/aws/verify-dev.sh`. Until then
   there is no hosted frontend. APPROVAL, deploy.
4. **Legacy data.** Count the retained tables and media bucket (`scripts/aws/amplify-inventory.sh`
   with read access), then plan and approve `import_amplify_profiles`,
   `migrate_amplify_child_photos` and `migrate_amplify_asset_objects`. Co-op, NPC state and
   progress rows have no importer yet. APPROVAL, data.
5. **Delete the retained Amplify resources** (sandbox stack, tables, buckets, Lambdas, alarms,
   budget) only after 1 and 4. APPROVAL, later; not part of this change.
6. **Env templates**: remove `VITE_BACKEND` from `react/.env.example` (section 6).
