# Testing Policy

Status: Mandatory policy
Owner: project owner
Last reviewed: 2026-11-18
Related ADRs: ADR-020, ADR-072
Canonical sources: [TESTING_STRATEGY.md](../TESTING_STRATEGY.md) section "When to run which checks" (adopted 2026-10-24), `Makefile`, `package.json`, `.github/workflows/ci.yml`

[TESTING_STRATEGY.md](../TESTING_STRATEGY.md) "When to run which checks" is the canonical
testing cadence. This page restates it for agents as rules and commands. If the two ever differ,
TESTING_STRATEGY.md wins and this page is corrected. What a test must cover (authorization
checklist, privacy logging, golden vectors, content export) is defined there too.

## 1. During feature development (every task)

Summary of TESTING_STRATEGY.md "During development (every task)"; the canonical list is there.

- Vitest by path with capped workers, run from `react/`: `npx vitest run --maxWorkers=2 <paths>`
  (`1` when the machine is busy).
- pytest by path: `.venv/bin/python -m pytest -q <paths>`.
- `npm run typecheck` when any TypeScript changed; focused regression tests by path; new or
  updated tests in the same change; fake AI, Polly, storage and Cognito keys instead of AWS.
- Always, when touched, the security and privacy tests (never skipped or weakened): the LAI-0403
  authorization checklist and `lai/apps/users/tests/test_tenant_isolation.py`, authentication
  (`test_authentication.py`, `test_jwks.py`), `lai/apps/core/tests/test_privacy_logging.py`,
  `lai/apps/ai/tests/`, and `npm run content:check` when content sources change.
- PostgreSQL tests skip when it is unreachable (`make up` starts it). A skip is not a pass.

## 2. Not run during development

Unless the owner explicitly authorizes it for this task, or the task is an approved acceptance
phase: no Playwright or other browser automation (`npm run test:e2e`, `npm run test:acceptance`),
WebGL checks, live AWS or deployment checks (`npm run ai:red-team`, `speech_live_smoke`,
`ai_live_check`), full lint and format gates, `npm run build`, full suites or `make check`. Code
should still pass them; they run once, at merge readiness.

## 3. Task completion

TESTING_STRATEGY.md "Task completion" says a task may be "marked COMPLETE"; in these standards
that means the **Development Complete** gate ([definition-of-done.md](definition-of-done.md)), not
the owner's Complete. Its exceptions (ADR gates such as Phaser world deletion and the Sprouts
gate, APPROVAL and AWS tasks) apply unchanged. The status entry lists everything **deferred to
merge verification**.

## 4. Merge readiness (only when explicitly requested)

Run for the changed code, record the results, and fix relevant failures before recommending the
merge ([integration-policy.md](integration-policy.md)).

| Gate | Command | What it runs |
|---|---|---|
| Python gates | `make py-check` | `py-lint` (Ruff), `py-format-check`, `django-check`, `migrate-check`, `py-test` |
| Python against PostgreSQL | `make up` then `make py-test-db` | pytest with `LAI_REQUIRE_POSTGRES=1`: PostgreSQL tests fail instead of skipping |
| Migrations | `make migrate-check` | `makemigrations --check --dry-run` |
| JavaScript gates | `make js-check` | `npm run adr:check`, `make docs-check`, `npm run admin-preview:check`, `npm run typecheck`, `npm run lint` (oxlint), `npm run format:check` (Prettier), `npm test` (full Vitest), `npm run build` |
| Everything above | `make check` | `py-check` + `js-check` (use `make py-test-db` as well; `py-check` runs plain `py-test`) |
| ADR registry | `npm run adr:check` | Registry, headings and every `ADR-NNN` reference |
| Engineering docs | `make docs-check` | Required governed docs, `Status:` lines, relative links, template sections, conflict markers (`scripts/check_engineering_docs.py`, standard-library Python; its tests are `tests/repo/test_check_engineering_docs.py`) |
| Content export | `npm run content:check` | Committed `content/` equals a fresh export |
| Golden vectors | `npm run golden:check` | `tests/golden/*.json` are current |
| Admin preview bundle | `npm run admin-preview:check` | Committed bundle matches its source |
| Production build | `npm run build` | `tsc -b` and `vite build` |
| Browser smoke | `npm run test:e2e` | Playwright smoke suite (section 5) |
| Browser acceptance | `npm run test:acceptance` | Playwright acceptance suite, when the change needs it (section 5) |
| Infrastructure synth (when `infra/` changed) | `npm run infra:synth:dev`, `npm run infra:synth:prod` | Local synthesis only; never deploy |
| Deferred checks | As recorded by each task being merged | |

`content:check` and `golden:check` are not part of `make check`; the Vitest suites
`contentExport.test.ts` and `goldenVectors.test.ts` also fail when the files are stale, but run
the commands explicitly when content or rules changed.

CI (`.github/workflows/ci.yml`) repeats the gates on pushes to `main` and on pull requests only,
with read-only permissions and no secrets: job `checks` (ADR check, engineering docs check, admin preview,
typecheck, oxlint, Prettier, Vitest, build), job `e2e` (Playwright smoke), job `python` (Ruff,
Ruff format, Django check, migration check, `py-test-db` on PostgreSQL 16). A push to any other
branch runs no CI, so the merge readiness review is the gate for branch work.

**A merge to `main` may deploy.** Besides CI, pushes to `main` start the deploy workflows by path,
each gated by a repository variable:

| Workflow | Starts on pushes to `main` that change | Gate variable |
|---|---|---|
| `deploy-site.yml` | `react/**`, `package.json`, `package-lock.json`, `scripts/aws/publish-site.sh`, its action and workflow | `LAI_SITE_DEPLOY_ENABLED` |
| `deploy-dev-native.yml` | `lai/**`, `content/**`, `react/public/models/**`, `requirements*.txt`, `pyproject.toml`, `scripts/aws/native/**`, `deploy/native/**` and related scripts | `LAI_DEV_NATIVE_ENABLED` |
| `deploy-django-ec2.yml` | `lai/**`, `content/**`, `react/public/models/**`, `requirements*.txt`, `pyproject.toml`, `scripts/aws/**`, `deploy/ec2/**`, `tests/deploy/**`, `.dockerignore` (its test job runs even when the gate is off) | `LAI_DEPLOY_ENABLED` (dev also follows `LAI_DEV_NATIVE_ENABLED`) |
| `deploy-dev-lambda.yml` | `lambda/**`, `lai/apps/ai/providers/**`, `lai/apps/jobs/core/**`, `scripts/aws/package-lambda.sh`, `tests/lambda/**` | `LAI_DEV_NATIVE_ENABLED` |

When a gate variable is `'true'`, merging a change under those paths releases it. Merging to
`main` is therefore an owner decision ([release-policy.md](release-policy.md)); agents never
merge, change the gate variables or dispatch these workflows.

## 5. Browser and acceptance testing (separately gated)

Both suites run only at explicitly requested merge or release readiness (or in CI for the smoke
suite), never during development.

| Suite | Command | Gate |
|---|---|---|
| Smoke (backend-free) | `npm run test:e2e` | Part of every explicitly requested merge or release readiness run, and CI |
| Browser acceptance (real app and Django Admin, desktop and `@tablet`) | `npm run test:acceptance` | Part of merge or release readiness for changes relevant to it (always for Treasure Rush, AI Question Studio or the Asset Library), or an approved acceptance phase. Needs Docker PostgreSQL, `.venv` and Playwright Chromium; one worker. |

Neither suite covers live Cognito, live Bedrock, live Polly, S3 storage or signed CloudFront
delivery. Those stay pending until an owner-approved live verification.

## 6. Owner QA (manual)

Owner QA happens in the Trello Owner QA list after Development Complete. The tester uses
[templates/qa-checklist.md](templates/qa-checklist.md) and covers the areas the change can
affect:

| Area | Examples of what to check |
|---|---|
| Desktop | Keyboard and mouse, window resize, focus order |
| Tablet (primary) | Touch controls, landscape and portrait, iPad-size viewport |
| Mobile | Phone width, no horizontal scroll, touch targets |
| Gameplay | Objectives clear, no dead ends, failure recovery |
| Jumping | Accessible non-jump route, no forced timers, safe recovery after a fall, no lost learning progress (shared controller pending merge) |
| Camera | No clipping into geometry, comfortable motion, reduced-motion respected |
| Collision | Cannot leave the playable area or get stuck |
| Accessibility | Screen reader labels, contrast, narration, readable aloud, reduced motion |
| Audio | Volume and mute, narration and music balance, spatial audio, no autoplay surprises |
| Educational content | Correct answers, age band fit, hints useful, no misleading facts |
| Rewards | Earned only by the server, no loot-box or pressure mechanics |
| Progress persistence | Reload and resume, world changes persist, other devices agree |
| Parent controls | Profiles, voice and AI settings, dashboard summaries by skill, deletion |

## 7. Reporting results and evidence

- **Never fabricate results.** Report only what you ran and saw. If a check was not run, say
  "not run" and why.
- Record, for every check: the exact command, the commit SHA it ran against, the outcome, and the
  counts (passed, failed, skipped). Example layout:
  `npx vitest run --maxWorkers=2 <paths>` at `<sha>`: `<n> passed, <n> failed, <n> skipped`.
- Report infrastructure failures separately from test failures (a worker that never starts,
  Vitest "Timeout waiting for worker to respond", out of memory, a missing database). Rerun only
  the affected files.
- Do not rerun tests whose code has not changed.
- Skipped PostgreSQL tests are reported as skipped, not passed.
- Put the evidence in the handoff ([templates/agent-handoff.md](templates/agent-handoff.md)) and
  completion report ([templates/completion-report.md](templates/completion-report.md)), with
  everything deferred to merge verification listed.
- Screenshots or recordings for Owner QA contain synthetic profiles only.
