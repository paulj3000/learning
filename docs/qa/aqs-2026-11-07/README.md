# AI Question Studio: automated owner-acceptance QA (2026-11-07)

Trello card "[Subproject] AI Question Studio" (Owner QA). Baseline `main` at `5222b690`. QA
branch `qa/aqs-acceptance-20261107`, not merged. Final owner acceptance is the owner's call.

## Status by gate

| Gate | Status | Basis |
|---|---|---|
| LAI-AQS-001 to 023 (implementation) | **PASS** (re-verified, 3 defects fixed) | 164 Studio tests, full Python suite, browser suite |
| **LAI-AQS-025** live Bedrock | **BLOCKED** | No AWS credentials in the QA environment (STS rejects the placeholder keys with `InvalidClientTokenId`; no network secrets configured); `LAI_AI_GUARDRAIL_ID`, the price settings and the region are unset; the task needs owner approval for cost and must run on the deployed host under the instance role. No Bedrock call was made. **Not replaced by mocks.** |
| **LAI-AQS-026** Admin browser pass | **PASS** (automated, Chromium) | 38 passed, 0 failed (+1 thread-mode pass); one layout defect found and fixed (D3) |
| LAI-AQS-024 (closes when 025 and 026 do) | **OPEN** | blocked by 025 |
| LAI-AQS-027 task queue | Not in scope; reported separately below | |

**Recommendation: NOT READY** for final acceptance, solely because live Bedrock (AQS-025) has not
run. Everything that can be verified without AWS passes after the fixes below.

## Test results

| Suite | Before fixes (`5222b690`) | After fixes |
|---|---|---|
| Full Python suite, PostgreSQL 16 required (`LAI_REQUIRE_POSTGRES=1 pytest -q`) | 1881 passed, 0 failed, 0 skipped | 1917 passed, 0 failed, 0 skipped |
| Question Studio app (`pytest lai/apps/question_studio`) | 128 passed | 164 passed (36 new in `test_qa_acceptance.py`) |
| Browser acceptance (`npm run test:acceptance`, desktop + tablet) | n/a (new spec) | 38 passed, 0 failed, 2 skipped by design* |
| Thread run mode (`LAI_E2E_STUDIO_RUN_MODE=thread`, `--grep @thread`) | n/a | 1 passed |
| Ruff lint and format, `makemigrations --check`, `tsc -b`, oxlint, Prettier | | pass |

\* The skips are the touch test on the desktop project (tablet-only) and the thread-mode check in
an inline-mode run.

First runs failed for reasons fixed in this branch and recorded here for honesty: the 390px
overflow (D3, a real defect), and a count in `question-studio.spec.ts` that counted every revision
row and broke once another spec published questions (selector narrowed to its own Grade 3 rows).
Environment only: the container's Chromium build (1243) differed from the pinned Playwright's
expected build (1234); a symlink in `/opt/pw-browsers` fixed it, nothing in the repository.

## Defects found and fixed

| Id | Severity | Expected | Actual (before) | Fix | Regression tests |
|---|---|---|---|---|---|
| **QA-AQS-D1** | Medium (integrity) | A retired or superseded question stays withdrawn; `reopen` refuses a once-published question | `workflow.edit` moved any REJECTED question to DRAFT, so a retired question, or a superseded original, could be approved and republished; the superseded case left **two ACTIVE revisions** (original beside its correction) | `edit` refuses a REJECTED question with revisions; its Admin page is view-only like a published one | `test_d1_*` (3 tests), browser "a retired question stays read-only" |
| **QA-AQS-D2** | High (child safety, age fit) | A child never gets numbers beyond the question's grade range | The grade range is only a WARNING, so an approver could publish a Grade K `30 + 20 = 50`, and `to_challenge` served it to a **Sprout** (authored Sprout challenges stop at 5) | `to_challenge` refuses any revision whose answer, operands or choices exceed `taxonomy.max_answer_for(grade)` | `test_d2_*` (2 tests) |
| **QA-AQS-D3** | Low (usability) | The Generate Questions page fits a 390px phone | The form table scrolled the page 31px sideways | Small stylesheet (`static/question_studio/admin/generate.css`) stacks the form under 768px | browser "the generate, list and review pages work at 390px" |

## Coverage matrix

Key: **U** unit/integration (pytest, PostgreSQL), **B** browser (Playwright, Chromium),
**L** live AWS. New tests are in `lai/apps/question_studio/tests/test_qa_acceptance.py` and
`react/e2e/acceptance/question-studio-qa.spec.ts`; the rest pre-existed.

| Feature (task) | Acceptance check | Where | Result |
|---|---|---|---|
| Taxonomy, grades to age bands (002) | every grade maps to a band; K is Sprout and Pathfinder; 3+ Explorer only | U `test_every_grade_maps…` | PASS |
| Difficulty (002, 007) | each requested difficulty is stored; MIXED never stored | U `test_each_requested_difficulty…`, `test_mixed…` | PASS |
| Invalid input (004, 015) | 7 invalid fields refused with stable codes, no model call | U `test_invalid_generation_input…`; B form validation | PASS |
| Generation and persistence (005, 007, 009) | drafts with provenance, events and reports; never published | U `test_generated_drafts_carry…`, existing generation tests | PASS (fake model) |
| Safety (013) | URL and personal-information content blocks approval and publishing | U `test_unsafe_generated_content…`, `test_safety_findings_block` | PASS |
| Validation, answer checks, duplicates (010 to 014) | blocking findings, revalidation, wrong key fails | U existing; B "editing a question revalidates it" | PASS |
| Retries and provider errors (008) | THROTTLED/UNAVAILABLE retried; ACCESS_DENIED/CONFIGURATION fail fast and store nothing; Guardrail stores nothing; malformed output | U new + existing | PASS (fake model) |
| Logs (008, ADR-025) | batch logs contain no staff notes or question text | U `test_batch_logs_never_contain…` | PASS |
| Admin approve and reject (016, 017) | reviewer, time and event recorded; rejected cannot publish; mixed bulk results reported | U `test_admin_reject…`; B reviewer test | PASS |
| Permissions (017) | anonymous to login; no-perms and non-staff 403; author cannot approve; reviewer cannot publish; author cannot see revisions or pools | U + B | PASS |
| Publish, unpublish, versions (019) | revision immutable; retire withdraws; correction supersedes, one ACTIVE | U + B | PASS after **D1** |
| Published-content query (019, 020) | ACTIVE revisions list shows only the 3 published, not the rejected one | B publisher test | PASS |
| Children get only published questions (020, 021) | draft, needs review, approved, rejected, retired, superseded never served | U existing + `test_unplayable_questions_leave…` (4 cases) | PASS |
| Age band fit (021) | grade-to-band gate; grade number range at serve time | U `test_band_mismatch…`, `test_d2_*` | PASS after **D2** |
| Precedence over fallback (020) | a usable pool beats the authored challenge; no pool, too small, disabled or exhausted falls back | U + B (Explorer gets ADD from the bank, SUBTRACT after retiring) | PASS |
| Outcomes and rewards (022) | correct and wrong answers graded by Django; evidence recorded; chest opens; world change only on success | U `test_generate_review_publish_play_and_grade`; B existing spec plays it in the 3D cove | PASS |
| Mobile 390px (026) | generate, list, review pages and a list action | B | PASS after **D3** |
| Thread run mode (007, 026) | a 7-question batch completes in a background thread (2 chunks) | B `@thread` | PASS |
| Live Bedrock (025) | 5 real requests, Guardrail, schema, cost | L | **BLOCKED** |

Automatable without credentials: everything except AQS-025. Needs credentials: AQS-025. Needs
human judgement: educational quality of real model output, and the owner decisions below.

## Security and safety findings

- No credential, staff note or question text appears in Studio logs (tested). The Studio never
  sends child data to the model (prompts are built from staff parameters only).
- D2 was the one child-facing safety gap: an approver could accept the range warning and the
  number reached a Sprout. Fixed at serve time.
- Open, owner decision (not changed here):
  1. **Band number limits.** Bank questions follow the grade range, not the authored band limits
     (Sprout 5, Pathfinder 10, Explorer 20). A Grade K answer of 6 to 10 can still reach a Sprout,
     and Grade 3 multiplication (to 1000) reaches Explorers by design (the existing tests assume it).
  2. **Editing a never-published rejected question** returns it to DRAFT without
     `approve_question` (the `reopen` action needs it). Approval is still required before
     publishing, so nothing reaches a child.
  3. `selection.to_challenge` relies on `eligible_revisions` for the grade-to-band check; adding
     it inside `to_challenge` too would be cheap defence in depth.
  4. `acceptedAnswers` is not scanned by the safety checks. It is not shown to children or served
     today; scan it before short-answer serving (AQS-028).
  5. At desktop width the question list's review-status column is clipped inside the table's
     horizontal scroll (Django's default); consider fewer `list_display` columns.

## AQS-027 (reported separately)

Not needed for current acceptance: the `thread` mode batch completes. The known risk stands: a
worker restart mid-batch strands it as RUNNING until someone runs it again after 15 minutes. Decide
on AQS-027 before long batches in production.

## Remaining manual or credentialed steps for the owner

1. **AQS-025 live Bedrock** on the deployed host (approval for cost and Guardrail):
   `manage.py ai_live_check … --warm-up --guardrail-probe`, then one 5-question
   `studio_run_batch` with `LAI_AI_PROVIDER=bedrock`, scored from the stored rows (status, model
   id, tokens, cost, per-question validation); set the price settings; confirm the deliberate
   Guardrail probe stores nothing. Cover at least two grades or difficulties.
2. Judge the educational quality of the real questions from step 1 (no automated check can).
3. Decide the open items 1 and 2 above.
4. Optional: a short look at the screenshots in `evidence/`, and a Safari/Firefox glance (the
   suite installs Chromium only).

## How to reproduce

```bash
make py-install && LAI_REQUIRE_POSTGRES=1 .venv/bin/python -m pytest -q   # PostgreSQL 16 on 5432
npm ci && npm run test:acceptance
LAI_E2E_STUDIO_RUN_MODE=thread npx -w react playwright test -c playwright.acceptance.config.ts --grep @thread --project desktop
```

Evidence: `evidence/*.png` (per test and step), `evidence/*.json` (browser problems per test: all
empty), `evidence/playwright-*.txt` (run logs).
