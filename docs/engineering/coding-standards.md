# Coding Standards

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-021, ADR-025, ADR-033

These standards describe how code is written in this repository today, derived from its
configuration and established patterns. The first rule governs all the others: **follow the
convention already in the code you are changing.** Do not introduce a new framework, library,
state manager, styling system, test runner or code generator to solve a local problem.
**Binding:** CLAUDE.md §13 ("Do not silently introduce a new dependency").

Rules tagged **Binding** already apply; untagged rules are proposals under ADR-072. Architecture
choices are in [architecture-rules.md](architecture-rules.md); security rules in
[security-policy.md](security-policy.md); test rules in [testing-policy.md](testing-policy.md).

## 1. Tooling configuration (source of truth)

| Concern | File | Key settings |
|---|---|---|
| Python lint | `pyproject.toml` `[tool.ruff]` | line length 100, `py312`, rules `E F W I B UP S`; `S` (bandit) relaxed only in tests, settings star imports and migration line length |
| Python format | `ruff format` (same config) | `make py-format`, checked by `make py-format-check` |
| Python tests | `pyproject.toml` `[tool.pytest.ini_options]` | `DJANGO_SETTINGS_MODULE=config.settings.test`, `testpaths = ["tests", "lai"]`, marker `postgres`, files `test_*.py` |
| TypeScript | `react/tsconfig.app.json` | `strict`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noFallthroughCasesInSwitch` |
| JS/TS lint | `.oxlintrc.json` | plugins `react`, `typescript`, `oxc`, `jsx-a11y`; `rules-of-hooks` error, `eqeqeq` error, `no-console` warn (warn and error allowed; off in `scripts/` and `server/`) |
| Formatting | `.prettierrc.json` | semicolons, single quotes, trailing commas, print width 100; `docs/` and generated files are in `.prettierignore` |
| Vitest | `react/vite.config.ts` `test` | `jsdom`, globals, setup `src/test/setup.ts`; includes `src/**/*.{test,spec}.{ts,tsx}`, `../server/**/*.test.ts`, `../infra/**/*.test.ts` |
| Python version | CI, `pyproject.toml` | Python 3.12 (`requires-python >= 3.12`) |
| Node version | `package.json` `engines` | Node 22 or later |

Do not weaken these settings to make code pass. Changing them is a shared-component change that
needs owner approval.

## 2. Python and Django

- Keep the app layout: `models.py`, `services.py` (business operations), `views.py` or
  `views_*.py`, `serializers.py`, `urls.py`, `admin.py`, `tests/`, `management/commands/`. Pure
  rules live in plain modules with no Django imports (`apps/adventures/engine.py`,
  `apps/quests/engine.py`) so they are testable without a database.
- Business logic goes in services, not views or serializers. Views authenticate, scope, validate
  and call one service.
- Extend the canonical app that owns the concept. Child-owned rows inherit `ChildOwnedModel`
  (`lai/apps/core/models.py`). **Binding:** ADR-033, CLAUDE.md §20.
- Do not query `ChildProfile.objects` outside `apps/users/services.py`; a structural test fails if
  you do. **Binding:** TESTING_STRATEGY.md (LAI-0403).
- Model `__str__` and `__repr__` use ids only, never nicknames. **Binding:** ADR-022.
- Use `TextChoices` for enumerations, `UUIDField` primary keys for externally visible ids,
  database constraints where a rule can be expressed in SQL, and `transaction.atomic` plus
  `select_for_update` where a write races (see `game_sessions.services.submit_answer`).
- No `print(` in application code; a test enforces it. **Binding:** TESTING_STRATEGY.md (LAI-0208).
- Type-hint public functions. There is no Python type checker yet (Makefile note, LAI-0204); do not
  add one without a decision.

## 3. Django REST Framework and API contracts

- Every route is under `/api/v1/` through one `include` per app in `lai/config/urls.py`.
  **Binding:** ARCHITECTURE.md "Django API conventions" (LAI-0205), ADR-014.
- Defaults come from `REST_FRAMEWORK` in `lai/config/settings/base.py`: Cognito JWT
  authentication, `IsProvisionedParent` permission, JSON only. A view that opts out must justify it;
  only the health view is public. **Binding:** CLAUDE.md §10, LAI-0205 tests.
- Validate with serializers and `is_valid(raise_exception=True)`; never hand-build a 400.
  Request bodies are closed: unknown fields are rejected, ids in bodies or query strings are
  ignored for scoping.
- Request and response field names follow the existing endpoint family (the play and answers
  APIs use camelCase bodies to match their earlier contract). Do not mix styles within one
  endpoint family.
- Changes are additive within v1. Removing or renaming a field, or changing its meaning, is a
  breaking change: it needs `/api/v2/` beside v1 and an ADR. Contracts shared with Android are in
  [ANDROID_API_CONTRACT.md](../android/ANDROID_API_CONTRACT.md); a change there is a shared API
  contract change.
- Document new endpoints in the relevant contract doc (for example [PLAY_API.md](../PLAY_API.md)).

## 4. Error handling

- API errors use the one envelope from `lai/apps/core/exceptions.py`:
  `{"error": {"code", "message", "details?"}, "request_id"}`. `code` is a stable lowercase id;
  `message` is a fixed, safe string, never exception text. Add new codes to `_CODED` through the
  exception class's `default_code`. **Binding:** LAI-0205.
- Raise domain exceptions with a stable code (for example `ChildProfileNotFound`,
  `PhotoRejected(code)`) and map them at the view. A missing id and a foreign id raise the same
  error. **Binding:** ADR-022.
- Never put child data, names, free text or ids in exception messages. **Binding:** ADR-025.
- TypeScript: return or throw typed errors (`ApiError` in `react/src/api/errors.ts`,
  `CognitoError`, `TimeoutError`) and show safe, child-appropriate copy. Every AI path has an
  authored fallback. **Binding:** CLAUDE.md §7, §13.
- Do not swallow errors silently. Either handle them with a defined fallback state or let them
  reach the boundary that logs type and location.

## 5. Logging

- Exceptions are logged as type and `file:line in function`, never message, source line or
  locals. Request lines use the matched route pattern, never the raw path or query string.
  **Binding:** ADR-025 (`lai/apps/core/privacy.py`).
- Never log child free text, audio, nicknames, names, emails, tokens, request bodies or
  identifiers unless specifically required and documented. **Binding:** CLAUDE.md §13, ADR-025.
- Use a named module logger (`logging.getLogger("lai.<area>")`); log events and counts, not
  content. Example in use: `lai.admin_audit`, `ai.retention`.
- Frontend: `console.warn` and `console.error` only (oxlint), with no child data.
- Raw tracebacks are a local-only opt-in (`LAI_LOG_RAW_EXCEPTIONS=1` under local settings).

## 6. TypeScript and React

- Strict mode; avoid `any`. Use `unknown` plus a runtime validator for external data. **Binding:**
  CLAUDE.md §13.
- Validate every external and AI-generated value at runtime (see `react/src/api/parse.ts`,
  `features/companion/schema.ts`). **Binding:** CLAUDE.md §7, §13.
- Keep domain logic out of components: pure functions and small services under `features/<x>/`,
  components only render and dispatch. **Binding:** CLAUDE.md §13.
- Feature folders: `react/src/features/<feature>/` with colocated `*.test.ts(x)`, CSS Modules
  (`*.module.css`) and an `api.ts` for server calls. Shared UI in `components/`, cross-cutting code
  in `lib/` and `api/`.
- Accessible semantic HTML: real `<button>` elements, labels, focus management; `jsx-a11y` is on.
  **Binding:** CLAUDE.md §13.
- All child-facing text is readable aloud and localizable, uses "Realm", never calls a child a
  "user", and avoids em dashes. **Binding:** CLAUDE.md §9, §13.
- Reuse before creating: check `components/`, `features/portal/ui/` (portal pages only, ADR-052),
  `features/npc-manager`, `audio/` and the engine runtime before writing a new component.

## 7. Three.js engine code

- One renderer, one controller, one runtime (see
  [architecture-rules.md](architecture-rules.md) section 3). Region behaviour goes in a manifest
  or a view extension, never a branch on location id in shared code. **Binding:** ADR-020, ADR-032.
- The engine emits typed events and never grades, awards or calls AI. **Binding:** ADR-020 item 6.
- Dispose geometries, materials, textures and listeners on teardown. Reuse geometries and
  materials across instances. Keep per-frame work allocation-free (reuse `Vector3`, `Box3`).
- Load assets only through the asset resolver; load audio only through the Sound Manager.
- Respect `react/src/lib/motionPreference.ts` for reduced motion.
- New engine modules import nothing from React, Django clients or AWS SDKs, so they move into
  `game/` unchanged.

## 8. PostgreSQL and queries

- Use the ORM. Raw SQL needs a reason in a comment and parameterized values only.
- Avoid N+1 queries: use `select_related` for foreign keys and `prefetch_related` for reverse or
  many-to-many relations on any list endpoint or admin changelist (patterns in
  `apps/quests/services.py`, `apps/ai/services/context.py`). Pin query counts on hot endpoints with
  `CaptureQueriesContext` as `apps/users/tests/test_children_api.py` does.
- Scope first, then filter: child-owned querysets start from the parent-resolved child.
- Add indexes for new lookup paths in the migration that introduces them.
- Tests that need PostgreSQL behaviour carry the `postgres` marker.

## 9. AWS CDK

- Stacks live in `infra/lib/*.ts` with a colocated `*.test.ts` (Vitest), entry `infra/bin/app.ts`,
  environment from `LAI_ENV` (`dev`, `prod`).
- Tag resources `Project=learning-adventure-island`; keep prod termination protection; retain
  data buckets.
- Least-privilege IAM: name exact actions and resources; no wildcard actions on data.
- Synthesize with `npm run infra:synth:dev` or `npm run infra:synth:prod` (no deploy). Deploys are
  owner-approved only. **Binding:** CLAUDE.md §8, §18.

## 10. Configuration and environment variables

- Django reads settings from environment variables in `lai/config/settings/base.py`, with
  `local.py`, `test.py`, `production.py` and build variants. Names use `DJANGO_*` for framework
  settings and `LAI_*` for application settings (for example `LAI_AI_PROVIDER`,
  `LAI_ASSET_STORAGE`, `LAI_CHILD_PHOTO_MAX_BYTES`). Use the `env_bool` and `env_list` helpers.
- Validate configuration at startup and fail with `ImproperlyConfigured` on unsafe values (see
  `LAI_RECENT_AUTH_MAX_AGE_SECONDS`). Defaults are safe and local: fake AI provider, local storage.
- Local values come from the untracked root `.env` (template `.env.sample`), passed by the
  Makefile. Deployed environments read SSM, never `.env`.
- The browser sees only `VITE_*` values: `VITE_DJANGO_API_BASE`, `VITE_COGNITO_USER_POOL_ID`,
  `VITE_COGNITO_CLIENT_ID`, `VITE_DJANGO_ADMIN_URL`, `VITE_MULTIPLAYER_*`. Never put a secret in a
  `VITE_*` variable; everything there ships to the client.
- A new variable is documented where its siblings are (settings comment, `.env.sample`, the
  relevant platform doc) and, if it reaches local Django, in the Makefile's `DJANGO_ENV_VARS`.

## 11. Dependencies

- Python: pin every direct and transitive dependency with `==` in `requirements.txt` (runtime) or
  `requirements-dev.txt` (tooling), with a comment naming the ticket or ADR that added it.
- Node: npm workspaces; add to the correct `package.json` (`react/` for the app, root for scripts
  and tooling). Commit `package-lock.json`.
- Every new dependency is stated in the task's plan and the PR "Changes" section, with the reason
  an existing dependency does not serve. **Binding:** CLAUDE.md §13.
- Never add Amplify packages or new `phaser` usage. **Binding:** CLAUDE.md §18, §19.

## 12. Naming

- Domain terms from CLAUDE.md §9 and the content hierarchy: Realm (`catalog.World`), Place
  (`catalog.Location`), 3D Area (`regions.WorldRegion`), Adventure, Quest, Challenge. Do not rename
  existing models or routes outside an approved naming migration (ADR-041).
- Python: `snake_case` modules and functions, `PascalCase` classes, `UPPER_CASE` settings.
- TypeScript: `camelCase` modules and functions, `PascalCase` components and their files,
  `*.module.css` beside the component, `*.test.ts(x)` beside the code.
- Tickets `LAI-<AREA>-<NNN>`; reference them in docstrings and commit messages where useful.

## 13. Comments and documentation

- Module docstrings state purpose, the ticket or ADR, and the rules the module enforces (see
  `lai/apps/users/photo_validation.py`, `lai/apps/ai/retention.py`).
- Comment why, not what. Reference the ADR when a choice looks surprising.
- Update docs in the same change when architecture, schema, privacy behaviour or scope changes.
  **Binding:** CLAUDE.md §13. See [documentation-policy.md](documentation-policy.md).

## 14. Performance

- Frontend: lazy-load routes and 3D regions; do not ship a region's assets to a page that does not
  render it. Keep draw calls and texture sizes within the region's budget
  ([asset-standard.md](../adventures/asset-standard.md)).
- ADR-020's frame-rate figures are planning targets, not release requirements.
- Backend: bounded reads, paginated lists, no unbounded loops over child rows in a request; long
  work goes to `apps.jobs` (ADR-064).

## 15. Test organization

| Code | Tests live in | Run with |
|---|---|---|
| Django apps | `lai/apps/<app>/tests/test_*.py`; shared fixtures in `lai/conftest.py` | `.venv/bin/python -m pytest -q <paths>` |
| Repository, golden, Lambda | `tests/repo/`, `tests/golden/`, `tests/lambda/` | same |
| React, engine, audio | colocated `react/src/**/*.test.ts(x)`; helpers in `react/src/test/` | `npx vitest run --maxWorkers=2 <paths>` from `react/` |
| Multiplayer server, CDK | `server/**/*.test.ts`, `infra/**/*.test.ts` | Vitest (included by `react/vite.config.ts`) |
| Browser journeys | `react/e2e/` | gated; see [testing-policy.md](testing-policy.md) |

Every feature adds tests with it. **Binding:** CLAUDE.md §13.
