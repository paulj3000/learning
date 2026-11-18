# Testing Policy

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-020

This is the governance summary of when tests run and who runs them. The canonical rules are
[TESTING_STRATEGY.md](../TESTING_STRATEGY.md), section "When to run which checks" (adopted
2026-10-24). That section stays canonical: if this page and it disagree, TESTING_STRATEGY.md
wins and this page is corrected. Rules tagged **Binding:** TESTING_STRATEGY.md already apply;
untagged rules are proposals under ADR-072.

Purpose of the split: development runs the cheapest checks that establish correctness; the
expensive gates run once, when a merge or release readiness review is explicitly requested. The
development machine is shared, so CPU cost counts.

## 1. The three phases

| Phase | Who asks | What runs |
|---|---|---|
| Development | Every task, automatically | Targeted unit tests, typecheck when TypeScript changed, security tests the change touches |
| Merge readiness | Only on explicit request (owner, or an integration ticket) | Full gates for the changed code |
| Owner QA | Owner, on a build under test | Manual checks on real devices ([qa-checklist.md](templates/qa-checklist.md)) |

## 2. During development

Required for every task. **Binding:** TESTING_STRATEGY.md.

- Vitest for the modified TypeScript, React, engine and audio code and its direct dependents, by
  path: `npx vitest run --maxWorkers=2 <paths>` from `react/` (or `npm test -- <paths>`).
- pytest for modified Django and Python code, by path: `.venv/bin/python -m pytest -q <paths>`.
- `npm run typecheck` whenever TypeScript changed (it also checks `scripts/`, `server/` and
  `infra/`).
- Focused regression tests for behaviour the change can affect.
- New or updated unit tests for new behaviour, with external services mocked or faked (the fake AI
  provider, fake Cognito key sets, fake storage). Engine logic is tested as pure functions.

Always run when the change touches them, because they protect security and privacy, not style.
Never weaken or skip them to save time. **Binding:** TESTING_STRATEGY.md.

- Authorization and tenant isolation: the LAI-0403 child-scoped endpoint checklist and
  `apps/users/tests/test_tenant_isolation.py`.
- Authentication: `apps/users/tests/test_authentication.py`, `test_jwks.py` (these need
  PostgreSQL).
- Privacy-safe logging: `apps/core/tests/test_privacy_logging.py`.
- AI output validation and safety tests in `lai/apps/ai/tests/` and the TypeScript validators.
- `npm run content:check` when exported content sources change.

Resource rules. **Binding:** TESTING_STRATEGY.md.

- Cap workers: `--maxWorkers=2`, or `1` when the machine is busy.
- Do not rerun tests whose code has not changed.
- Report an infrastructure failure (a worker that never starts, such as Vitest's "Timeout waiting
  for worker to respond", out of memory, a missing database service) as infrastructure,
  separately from test failures, and rerun only the affected files.

## 3. Not run during development

Not run routinely. **Binding:** TESTING_STRATEGY.md.

- Playwright, other browser automation, WebGL rendering checks, end-to-end and acceptance suites
  (`npm run test:e2e`, `npm run test:acceptance`).
- Full lint and format gates: Ruff (`make py-lint`, `make py-format-check`), Prettier
  (`npm run format:check`), oxlint (`npm run lint`).
- Full test suites (`npm test` with no paths, `make py-test`) and `npm run build`.
- Deployment verification.

Also not run without explicit owner authorization (proposed, consistent with CLAUDE.md §18):
anything that calls live AWS (Cognito, Bedrock, Polly, S3), including `npm run ai:red-team` and the
live mode of `manage.py ai_live_check` (its `--dry-run` makes no AWS call), and any deploy or
provisioning script.

## 4. Task completion

A task may be reported as Development Complete when the implementation is finished, the
development checks above pass, typecheck passes (if applicable), acceptance criteria are met at
the unit or integration level, and docs and the tracker are updated. The status entry lists
everything **deferred to merge verification**. **Binding:** TESTING_STRATEGY.md "Task completion".
Gates and states: [definition-of-done.md](definition-of-done.md).

Exceptions that keep stronger checks. **Binding:** TESTING_STRATEGY.md.

- A gate an accepted ADR makes a gate stays one: deleting a Phaser world requires its Three.js
  replacement to pass parity tests, visual validation and the Sprouts gate (ADR-020, LAI-2303).
- APPROVAL tasks and anything touching AWS stop for approval.

## 5. Merge or release readiness (only when explicitly requested)

Run the comprehensive gates for the changed code and report each result. **Binding:**
TESTING_STRATEGY.md "Merge or release readiness".

| Check | Command |
|---|---|
| All merge gates | `make check` (= `make py-check` + `make js-check`) |
| Python gates | `make py-check`: Ruff, Ruff format check, `manage.py check`, migration check, pytest |
| JS gates | `make js-check`: `npm run adr:check`, `npm run admin-preview:check`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build` |
| PostgreSQL-required tests | `make up`, then `make py-test-db` (fails instead of skipping when the database is down) |
| Migration validation | `make migrate-check` (`makemigrations --check --dry-run`), included in `make py-check` |
| Content export | `npm run content:check` |
| Golden vectors | `npm run golden:check` |
| ADR registry | `npm run adr:check` |
| Documentation checks | as added by LAI-ENG-001 (see [documentation-policy.md](documentation-policy.md)) |
| API compatibility | Review that changes under `/api/v1/` are additive; the LAI-0205 conventions tests and the contract docs ([PLAY_API.md](../PLAY_API.md), [ANDROID_API_CONTRACT.md](../android/ANDROID_API_CONTRACT.md)) are current |
| Integration tests | pytest suites that drive real HTTP through the Django test client (the PostgreSQL run above) |
| Security checks | the security tests of section 2, run in full, plus reading every new endpoint |
| CDK synthesis (infrastructure changes only) | `npm run infra:synth:dev`, `npm run infra:synth:prod` (no deploy) |

Browser and WebGL checks (`npm run test:e2e`, `npm run test:acceptance`, other browser
automation) are gated separately: run them only with explicit owner authorization or inside an
approved acceptance phase, even during a merge readiness review.

Report failures and fix the relevant ones before recommending a merge. CI repeats the full gates
on pushes to `main` and on pull requests only; a push to any other branch runs no CI, so the merge
readiness review is the gate for branch work. **Binding:** TESTING_STRATEGY.md.

## 6. Owner QA

The owner performs manual QA on a build under test, recorded with
[qa-checklist.md](templates/qa-checklist.md). Agents prepare the build and the checklist; they do
not mark owner QA passed.

| Area | What the owner checks |
|---|---|
| Desktop | Keyboard and mouse play, layout, frame rate feel |
| Tablet | Touch controls, tablet-first layout (the primary target) |
| Mobile | Phone-width layout, touch, no horizontal scroll |
| Gameplay | Adventure flow, challenges, hints, failure recovery |
| Jumping | Only once the shared jump controller is merged (pending merge, PR #26) |
| Camera | Look and follow behaviour; third-person pending merge (PR #27) |
| Collision | No walking through solid objects, no stuck states |
| Accessibility | Large targets, narration, reduced motion, focus, readable copy |
| Audio | Music, effects, voice, volume and mute settings |
| Educational content | Age-band fit, correctness, reading level |
| Rewards | Collectibles and world changes appear as specified |
| Progress persistence | Progress survives reload and device change |
| Parent controls | Parent dashboard summaries, profile edits, parent gate |

Owner QA results are evidence only when the owner records them. A defect found in QA is filed with
[defect-report.md](templates/defect-report.md).

## 7. Reporting results

- Report the exact command, the scope (paths), and the result line (passed, failed, skipped,
  counts) as printed.
- List checks not run and why (deferred to merge readiness, gated, blocked by infrastructure).
- **Never fabricate or infer a result.** A check that was not run is reported as not run. A
  result from an earlier commit is labelled with that commit.
- Infrastructure failures are reported separately from test failures.
- Use the "Tests executed" and "Deferred checks" sections of
  [pull-request.md](templates/pull-request.md) and the agent handoff template.

## 8. Test placement

Where tests live and how to run them is in [coding-standards.md](coding-standards.md) section 15.
Test-type specifics (component, backend, AI evaluation, golden vectors, browser acceptance) are in
[TESTING_STRATEGY.md](../TESTING_STRATEGY.md).
