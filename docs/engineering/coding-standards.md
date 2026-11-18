# Coding Standards

- **Status:** Mandatory policy (merged to `main` at the owner's direction on 2026-11-18; formal acceptance of ADR-072 pending). Rules restated from CLAUDE.md and accepted ADRs bind through those sources.
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-021, ADR-023, ADR-025, ADR-033, ADR-047, ADR-052, ADR-072
- **Canonical sources:** [CLAUDE.md](../../CLAUDE.md) section 13, `pyproject.toml`, `react/tsconfig.app.json`, `.oxlintrc.json`, `.prettierrc.json`, `Makefile`, [ARCHITECTURE.md](../ARCHITECTURE.md) "Django API conventions"

These rules restate and ground [CLAUDE.md](../../CLAUDE.md) section 13 in the repository's actual
configuration. Follow the conventions already in the code. Do not introduce a new framework,
linter, formatter, state library, ORM layer or test runner. Architecture boundaries are in
[architecture-rules.md](architecture-rules.md); security rules in
[security-policy.md](security-policy.md); when to run checks in
[testing-policy.md](testing-policy.md).

## 1. Tooling as configured

| Language | Tool | Configuration (verified) | Command |
|---|---|---|---|
| Python 3.12 | Ruff lint | `pyproject.toml`: `line-length = 100`, `target-version = "py312"`, rules `E, F, W, I, B, UP, S`; test files may use `assert` and test secrets (per-file ignores) | `make py-lint` |
| Python | Ruff format | same file | `make py-format-check`, fix with `make py-format` |
| Python | pytest + pytest-django | `pyproject.toml`: `DJANGO_SETTINGS_MODULE = "config.settings.test"`, `pythonpath = ["lai"]`, marker `postgres` | `.venv/bin/python -m pytest -q <paths>` |
| Python type checker | None yet | Deferred (Makefile comment, LAI-0204). Use type hints anyway. | n/a |
| TypeScript 5.9 | `tsc -b` | `react/tsconfig.app.json`: `strict`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noFallthroughCasesInSwitch`; `infra/`, `scripts/`, `server/` have their own strict configs | `npm run typecheck` |
| TS / React | oxlint | `.oxlintrc.json`: plugins `react, typescript, oxc, jsx-a11y`; `react/rules-of-hooks` error; `eqeqeq` error; `no-console` warn except `warn`/`error` (off in `scripts/`, `server/`) | `npm run lint` |
| All | Prettier 3 | `.prettierrc.json`: `semi`, `singleQuote`, `trailingComma: "all"`, `printWidth: 100`. `docs/`, `CLAUDE.md` and generated files are in `.prettierignore` | `npm run format:check` |
| Tests | Vitest 4, React Testing Library, Playwright | `react/vite.config.ts` includes `src/**`, `../server/**`, `../infra/**` tests | see [testing-policy.md](testing-policy.md) |

Lint and format gates run at merge readiness, not on every edit ([testing-policy.md](testing-policy.md)).
Write code that would pass them anyway.

## 2. Python and Django

- Layout: each app in `lai/apps/<app>/` has `models.py`, `services.py` (business logic),
  `views.py` (thin), `serializers.py`, `urls.py`, `admin.py`, `migrations/`, `tests/`. Put domain
  rules in services or pure modules (`adventures/engine.py`, `quests/engine.py`,
  `regions/puzzles.py`), not in views or serializers.
- Extend the canonical app that owns a responsibility (ADR-033). Child-owned rows subclass
  `ChildOwnedModel` (`lai/apps/core/models.py`).
- Read `ChildProfile` only through `lai/apps/users/services.py` and the scoping helpers; a
  structural test fails otherwise (`lai/apps/users/tests/test_tenant_isolation.py`).
- Settings: `lai/config/settings/{base,local,production,test}.py`. Read configuration with
  `os.environ` in `base.py` and validate it at import (`ImproperlyConfigured` on bad values, as
  `LAI_GAME_TICKET_TTL_SECONDS` does). Django application code reads configuration only through
  settings; exceptions: management-command secret inputs and Lambda workers (no Django settings).
- No `print(` in application code (a privacy test enforces it). Use module loggers.
- Pin every Python dependency with `==` in `requirements.txt` or `requirements-dev.txt`,
  including transitive ones.

## 3. DRF and API contracts

| Rule | Detail |
|---|---|
| Namespace | All routes under `/api/v1/`, one `include` per app in `lai/config/urls.py`. A test fails otherwise. |
| Versioning | Additive change stays in v1. Breaking change: new `/api/v2/` beside v1, with an ADR. |
| Validation | Serializers with `is_valid(raise_exception=True)`. Never hand-build a 400. Closed request bodies: parent or child ids in bodies and query strings are ignored (LAI-0403 checklist in [TESTING_STRATEGY.md](../TESTING_STRATEGY.md), [security-policy.md](security-policy.md) section 3). |
| Errors | The fixed envelope `{"error": {"code", "message", "details"}, "request_id"}` from `api_exception_handler` (`lai/apps/core/exceptions.py`). `message` is a fixed string, never exception text. |
| Permissions | Default `IsAuthenticated`. Child routes use `ChildScopedMixin` with `<uuid:child_id>`. Another family's child and an unknown id return the identical 404. |
| Success bodies | Plain JSON, not wrapped. Field names match the existing app's convention; keep the React parser (`react/src/api/parse.ts`) in step. |
| Contracts docs | Update [PLAY_API.md](../PLAY_API.md), [AI_SERVICE.md](../AI_SERVICE.md) or the owning doc in the same change. |

## 4. TypeScript and React

- `strict` everywhere; no `any`, no non-null assertions to silence the compiler, no
  `@ts-ignore`. Use `unknown` and validate at runtime (`react/src/api/parse.ts` pattern) for
  every API, storage or AI payload.
- `verbatimModuleSyntax` is on: use `import type` for types.
- Keep domain logic in pure `.ts` modules beside the feature (`react/src/features/<feature>/`),
  tested without React. Components render and dispatch.
- Talk to Django only through `react/src/api/` clients; never call AWS or a model from the
  browser (Cognito sign-in through `react/src/lib/cognito` is the one AWS call).
- Accessible semantic HTML: `<button>` not clickable `<div>`; labels on every control; the
  `jsx-a11y` lint plugin is on. Child-facing text must be readable aloud and localizable; no em
  dashes in user-facing copy.
- Styling: CSS Modules reading `react/src/styles/tokens.css`; Tailwind 4 only in the shells,
  portal and admin entries (ADR-023, ADR-052). Never define `--color-*` outside `tokens.css`.
- Reusable components: check `react/src/components/`, `react/src/features/portal/ui/` and the
  owning feature before writing a new button, card, dialog, HUD element or progress indicator.

## 5. Three.js

- Engine code (`.ts` under `react/src/features/island-map/three/` and `scenes/`) imports only
  `three` (or `phaser` in the transitional `scenes/` worlds) and local engine modules. No React,
  no `api/`, no AWS SDK (`react/src/test/engineBoundary.test.ts`). `.tsx` files there are hosts.
- The engine emits typed events (`worldEngineEvents.ts`); it never validates answers, awards
  progress or calls AI (ADR-020).
- New places are manifests and extensions on the location runtime (`runtime/`), not new
  scenes with their own loop.
- Movement, collision, camera, jumping: use the shared controller. See the pending-merge table
  in [architecture-rules.md](architecture-rules.md) before adding any of these.
- Performance: keep draw calls low. Share geometries and materials and use instancing for
  repeated props ([THREE_WORLD_ASSET_CONVENTIONS.md](../THREE_WORLD_ASSET_CONVENTIONS.md));
  stay within the model limits the asset validator enforces (`lai/apps/assets/validation.py`);
  NPC cost is covered in [NPC_MANAGER_PERFORMANCE.md](../NPC_MANAGER_PERFORMANCE.md). No
  repository-wide draw-call budget is set yet. Never allocate vectors or matrices per frame in
  hot paths.
- Disposal: every engine object that creates geometries, materials, textures, render targets,
  audio nodes or event listeners must release them in its `dispose()`; hosts call it on unmount.
- Respect `prefers-reduced-motion` (`react/src/lib/motionPreference.ts`).

## 6. PostgreSQL and database queries

- Model changes ship with their migration in the same commit; `make migrate-check` must be
  clean. Never edit a merged migration. Data migrations are reversible or say why not.
- Avoid N+1 queries: use `select_related` for foreign keys and `prefetch_related` for reverse or
  many-to-many relations on list endpoints. Pin query counts in tests for hot list routes
  (`django_assert_max_num_queries`).
- Writes that change several rows run in `transaction.atomic()`. Use `select_for_update()` where
  two requests can race (the jobs consumer and onboarding races are the pattern).
- Use constraints (`UniqueConstraint`, `CheckConstraint`) for invariants, not only `clean()`.
- No raw SQL unless the ORM cannot express it; then parameterize, never format strings.

## 7. AWS CDK

- Stacks in `infra/lib/*.ts`, app entry `infra/bin/app.ts`, each with a `*.test.ts` beside it
  (run by Vitest).
- Least-privilege IAM written per resource; no wildcards on actions or resources unless the
  service requires them, with a comment saying why.
- No secrets in stack code or context; reference SSM parameters and Secrets Manager.
- Synthesize locally (`npm run infra:synth:dev`); never deploy or make a live AWS call without explicit per-action owner authorization ([release-policy.md](release-policy.md)).

## 8. Error handling

| Layer | Rule |
|---|---|
| Django | Raise typed exceptions; the handler maps them to the envelope. Domain errors carry a stable `code` (pattern: `PhotoRejected(code)` in `lai/apps/users/photo_validation.py`). Never put child data in exception text: messages are logged (ADR-025). |
| React | Map API error `code` values to safe, fixed copy (`react/src/api/errors.ts`). Never show raw server text, stack traces or ids to a child. Every screen has loading, empty, error and AI-fallback states. |
| AI | Every failure returns authored fallback content (`lai/apps/ai/fallbacks.py`); the child never sees an error caused by the model. |
| Child-facing messages | Calm, short, readable aloud, no blame, no em dashes. |

## 9. Logging

- Never log child free text, audio, names, nicknames, interests, emails, tokens, cookies,
  request bodies, raw paths or query strings. Child UUIDs only where a documented need exists.
- One access line per request from `lai.request` (route pattern, status, duration, request id).
- Exceptions are logged as type and location, never as message (ADR-025).
- AI log lines use the versioned `ai.turn` schema and closed vocabularies (ADR-044 item 12).
- Canonical: [ARCHITECTURE.md](../ARCHITECTURE.md) "Logging and privacy"; tests in
  `lai/apps/core/tests/test_privacy_logging.py`.

## 10. Naming

| Item | Convention |
|---|---|
| Domain terms | Use the CLAUDE.md section 9 names (`ChildProfile`, `AdventureSession`, `WorldChange`, ...). Never call children "users" in child-facing copy. |
| Player-facing hierarchy | "Realm" in copy; code keeps World, Location, WorldRegion. Do not rename code. |
| Python | `snake_case` modules and functions, `PascalCase` classes, `UPPER_SNAKE` settings with the `LAI_` prefix for project settings. |
| TypeScript | `camelCase.ts` modules, `PascalCase.tsx` components, `*.module.css` beside the component, `*.test.ts(x)` beside the source. |
| Routes | Lowercase, hyphenated, plural nouns: `/api/v1/children/<uuid:child_id>/ai/companion-turns/`. |
| Tickets in code comments | Reference the ticket id (`LAI-0403`, `SC-R04-05`) and ADR (`ADR-NNN` form) where a rule comes from. |

## 11. Configuration and environment variables

- Local development: the untracked `.env` at the repository root, templated by `.env.sample`.
  The Makefile passes the listed `DJANGO_ENV_VARS` to the Django targets; Vite reads the same file
  for `VITE_*` and `DJANGO_DEV_PORT`. Django has no dotenv package and must not get one.
- Add a new setting by: reading it in `lai/config/settings/base.py` with a safe default and
  validation, adding it to `.env.sample` with a placeholder, to `DJANGO_ENV_VARS` in the
  `Makefile` if local targets need it, and to the SSM settings list in
  [DJANGO_EC2_DEPLOYMENT.md](../platform/DJANGO_EC2_DEPLOYMENT.md) if deployed environments need it.
- Deployed environments read SSM Parameter Store (`/lai/<env>/...`) and Secrets Manager, never
  `.env`. Tests set their own values in `config.settings.test` and fixtures.
- New feature flags default to off (for example `LAI_SPEECH_PROVIDER` defaults to `disabled`);
  `LAI_AI_ALLOW_CLIENT_AUTHORED` (default on) is a transitional exception (ADR-044).

## 12. Dependencies

- Do not add a dependency silently. Any new runtime dependency (`dependencies` in either
  `package.json`, or `requirements.txt`) needs owner approval and an ADR
  ([architecture-rules.md](architecture-rules.md) section 10).
- A new dev dependency needs a line in the task report explaining why the existing tools do not
  suffice.
- Pin exactly in Python; npm uses the lockfile (`npm ci`). Commit lockfile changes with the
  manifest change, alone where possible.
- Never add Amplify packages or new Phaser usage.

## 13. Comments

- Comment why, not what: the rule, ticket or ADR a non-obvious line enforces, and the invariant
  a test pins. Module docstrings state the module's contract (see
  `lai/apps/users/photo_validation.py` and `lai/apps/ai/retention.py`).
- No commented-out code, no TODO without a ticket id.

## 14. Test organization

| Code | Tests live in |
|---|---|
| Django app | `lai/apps/<app>/tests/test_*.py`; shared fixtures in `lai/conftest.py` |
| Repository rules, deploy scripts, Lambda workers, golden vectors | `tests/repo/`, `tests/deploy/`, `tests/lambda/`, `tests/golden/` |
| React and TypeScript | `*.test.ts(x)` beside the source; cross-cutting guards in `react/src/test/` |
| CDK | `infra/lib/*.test.ts` |
| Browser smoke and acceptance (Playwright) | `react/e2e/`, `react/e2e/acceptance/`; server harness `tests/e2e/` |

Every new behaviour gets a test in the same change. Child-scoped endpoints follow the LAI-0403
checklist in [TESTING_STRATEGY.md](../TESTING_STRATEGY.md).
