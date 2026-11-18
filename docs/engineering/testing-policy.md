# Testing Policy

- **Status:** Mandatory policy (ADR-072, accepted by the owner 2026-11-18). These standards are the final authority after the owner.
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-072
- **Canonical sources:** [TESTING_STRATEGY.md](../TESTING_STRATEGY.md) section "When to run which checks" (adopted 2026-10-24), `Makefile`, `package.json`, `.github/workflows/ci.yml`

[TESTING_STRATEGY.md](../TESTING_STRATEGY.md) "When to run which checks" is the canonical
testing cadence. This page restates it for agents as rules and commands. If the two ever differ,
TESTING_STRATEGY.md wins and this page is corrected. What a test must cover (authorization
checklist, privacy logging, golden vectors, content export) is defined there too.

## 1. During feature development (every task)

Run the cheapest checks that prove correctness. The development machine is shared, so CPU counts.

| Check | Command | When |
|---|---|---|
| Vitest, by path, capped workers | `npx vitest run --maxWorkers=2 <paths>` (use `1` when the machine is busy) | Modified TypeScript or React code and its direct dependents |
| pytest, by path | `.venv/bin/python -m pytest -q <paths>` | Modified Django or Python code |
| Typecheck | `npm run typecheck` | Any TypeScript changed (includes `infra/`, `scripts/`, `server/`) |
| Focused regression | Vitest or pytest by path | Code the change can affect |
| New or updated unit tests | In the same change | Every new behaviour |
| Mocked service tests | Fake AI provider, fake Polly client, in-memory storage, local RSA keys for Cognito | Any code that would call AWS |

Always run, when the change touches them, because they protect security and privacy (never skip
or weaken them to save time):

| Area | Tests |
|---|---|
| Authorization and tenant isolation | The LAI-0403 checklist; `lai/apps/users/tests/test_tenant_isolation.py` |
| Authentication | `lai/apps/users/tests/test_authentication.py` (needs PostgreSQL), `test_jwks.py` (does not) |
| Privacy-safe logging | `lai/apps/core/tests/test_privacy_logging.py` |
| AI output validation and safety | `lai/apps/ai/tests/` and the affected React validators |
| Exported content | `npm run content:check` when content sources change |

Tests that need PostgreSQL skip when it is unreachable; start it with `make up`. A skip is not a
pass: report it.

## 2. Not run during development

Unless the owner explicitly authorizes it for this task, or the task is an approved acceptance
phase, do not run:

- Playwright, any browser automation, end-to-end or acceptance suites (`npm run test:e2e`,
  `npm run test:acceptance`), WebGL rendering checks;
- live AWS verification, deployment tests, deploy workflows, `npm run ai:red-team` (calls live
  endpoints), `speech_live_smoke`, `ai_live_check`;
- full lint and format gates (Ruff, Ruff format, Prettier, oxlint), `npm run build`, full test
  suites, `make check`.

Code should still pass these; they simply run once, at merge readiness.

## 3. Task completion

A task may be marked complete (Trello: Development Complete) when the implementation is
finished, the development checks pass, typechecking passes where TypeScript changed, the
acceptance criteria are met at unit and integration level, and documentation and tracker are
updated. The status entry lists everything **deferred to merge verification**.

Two exceptions keep stronger checks:

- A check an accepted ADR makes a gate stays a gate: deleting a Phaser world still needs its
  Three.js replacement to pass parity tests and visual validation, and the Sprouts gate
  (ADR-020, LAI-2303).
- APPROVAL tasks and anything touching AWS stop for owner approval.

See [definition-of-done.md](definition-of-done.md).

## 4. Merge readiness (only when explicitly requested)

Merge readiness includes the canonical gates in
[TESTING_STRATEGY.md](../TESTING_STRATEGY.md) "Merge or release readiness", including
`npm run test:e2e` and `npm run test:acceptance`. Those two are browser suites and run only on
explicit owner authorization or in an approved acceptance phase (section 5). It also includes
`make docs-check`. This page does not narrow that list. Note that `make check` runs plain
`py-test`; run `make py-test-db` for PostgreSQL.

Run for the changed code, record the results, and fix relevant failures before recommending the
merge ([integration-policy.md](integration-policy.md)). The commands behind the gates:

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
each gated by repository variables. The trigger paths, gate variables and approval rule (a merge
approval is not a deployment approval) are in
[release-policy.md](release-policy.md#how-merges-relate-to-deployments).

## 5. Browser and acceptance testing (separately gated)

| Suite | Command | Gate |
|---|---|---|
| Smoke (backend-free) | `npm run test:e2e` | Merge readiness when explicitly requested, or CI |
| Browser acceptance (real app and Django Admin, desktop and `@tablet`) | `npm run test:acceptance` | Explicit owner authorization or an approved acceptance phase. Required for changes to Treasure Rush, AI Question Studio or the Asset Library at merge readiness. Needs Docker PostgreSQL, `.venv` and Playwright Chromium; one worker. |

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
| Jumping (adventures that use it) | Accessible non-jump route, no forced timers, safe recovery after a fall, no lost learning progress (shared controller pending merge) |
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
