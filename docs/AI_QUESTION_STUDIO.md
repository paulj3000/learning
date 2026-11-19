# AI Question Studio (Phase 28)

Branch `features/studio`, based on the `features/ai` tip (`8764698`). Task IDs `LAI-AQS-001` to
`LAI-AQS-024`. Sections 1 to 8 are the LAI-AQS-001 architecture assessment and design; sections 9
to 13 record what was built, how to run it, and what is verified. Nothing is deployed.

## 1. Corrections to the brief's assumptions

The audit found five places where the repository differs from the brief. Each changes the design.

1. **The brief's the decision numbered 43 on main is not content authoring.** On `main` it is the LAI-0209 recent sign-in guard. No accepted ADR
   covers authored-question drafting or versioning. The Studio therefore needs its own decision:
   proposed **ADR-046** (section 7).
2. **There is no question bank.** Treasure Rush challenges are not stored questions. A
   `ChallengeSpec` row holds parameters (skill, value range, response mode, choice count); the
   server picks a seed and `generate_challenge` builds the question
   (`lai/apps/education/challenges.py`). Operations are only `COUNT`, `ADD`, `SUBTRACT`.
3. **Treasure Rush cannot show a Grade 3 multiplication question today.** `ChallengeAttempt`
   snapshots `operation` (three values), `operands` and `answer` as small integers, and the client
   renders the prompt from `operation` and `operands` through its own strings. A bank question
   (free stem, text choices) has nowhere to live. Also, the curriculum export covers grades 1 to 2
   only, and `SKILL_RULES` has three skills, none of them multiplication.
4. **The Django AI pipeline is child-bound.** `run_turn(child, spec)` and `usage.admit(child, ...)`
   require a `ChildProfile`, write child-keyed audit rows and count against child and family
   limits. A staff authoring call has no child. The reusable part is below that layer.
5. **Grades are not in Django.** The curriculum (Subject, Grade, Domain, Skill) lives in
   `content/exported/curriculum.json` and TypeScript. Django has `LearningObjective` (code, domain,
   title) only.

## 2. Reusable components

| Need | Reuse | Where |
|---|---|---|
| Bedrock call, Guardrail, structured output, timeout, retry | `ModelClient`, `ModelRequest`, `ModelResponse`, `BedrockModelClient`, `FakeModelClient`, `get_model_client()`, `override_model_client()` | `apps/ai/providers/` |
| Model id, region, Guardrail, timeout, attempts | `LAI_AI_MODEL_ID`, `LAI_AI_BEDROCK_REGION`, `LAI_AI_GUARDRAIL_*`, `LAI_AI_TIMEOUT_SECONDS`, `LAI_AI_MAX_ATTEMPTS` | `config/settings/base.py` |
| Cost estimate from configured prices | `estimate_microusd` | `apps/ai/services/costs.py` |
| Kill switch | `AIServiceControl`, `usage.model_calls_enabled()` | `apps/ai/` |
| Safe text policy (URLs, personal-information requests, learning-judgment claims) | `content_safety.py` | `apps/ai/` |
| Publication status | `ContentStatus` (DRAFT, PUBLISHED, RETIRED) | `apps/core/content_status.py` |
| Publish-time validation shared by admin actions | pattern in `regions/publishing.py` | `apps/regions/` |
| Staff permission and audited admin conventions | `catalog/admin_access.py`, `ai/admin.py` | |
| Skills, objectives, age bands | `LearningObjective`, `AgeBand`, `SKILL_RULES` | `catalog`, `users`, `education` |
| Islands, places, adventures | `World`, `Location`, `Adventure` | `apps/catalog/models.py` |
| Server grading and mastery | `grade_answer`, `SkillEvidence`, `SkillProgress`, `ChallengeAttempt` | `education`, `game_sessions` |
| Schema, model and prompt version stamps | audit row fields written by the pipeline | `apps/ai/models.py` |

## 3. Missing infrastructure

- A question bank: question, revision, generation batch, validation report, review events.
- A staff-scoped generation path that does not need a child (section 5).
- A Django grade and subject taxonomy (section 4).
- A deterministic answer verifier for bank questions.
- A runtime path that serves a published bank question to a child and grades it.
- A way for Treasure Rush to ask for a bank question without changing its client (section 6).

## 4. Taxonomy (LAI-AQS-002)

Django-owned choice sets, not fabricated standards ids:

- `subject`: `MATH` first. `READING`, `SCIENCE` are accepted values but have no verifier yet.
- `grade`: `K`, `1` to `8`, mapped to `AgeBand` (K to 1 SPROUT or PATHFINDER, 2 to 3 PATHFINDER or
  EXPLORER, 4 and up EXPLORER). The mapping is a table in code with a test.
- `topic`: free slug within a subject, validated against a Django-held list (for example
  `multiplication`).
- `skill`: a `LearningObjective.code` when one exists, otherwise an internal
  `studio:<subject>:<topic>` code. No external standards ids are stored.
- `difficulty`: `EASY`, `MEDIUM`, `HARD`, plus `MIXED` as a request value only (stored per question).
- `question_type`: `MULTIPLE_CHOICE`, `NUMERIC`, `SHORT_ANSWER`. A registry maps type to schema
  validator, verifier and grader, so a new type is one registry entry.

Grade 3 is an Explorer-band grade (ages 7 to 8) in this product. CLAUDE.md age rules apply to
reading volume and response mode; the age-appropriate-language check (AQS-013) uses them.

## 5. Generation path (LAI-AQS-005 to 009)

Reuse everything below `run_turn`. Add `apps/question_studio/` (a new Django app, canonical
conventions, no second AI stack):

```text
Admin action (staff, permission checked)
  -> GenerationBatch (quota check, row lock) -> background task
  -> prompt builder (versioned template, authored inputs fenced as untrusted)
  -> get_model_client().invoke(ModelRequest)        # existing Bedrock adapter and Guardrail
  -> structured parse -> per-question schema validation
  -> QuestionDraft rows + ValidationReport
```

Decisions:

- **Audit.** Studio batches record model id, prompt version, schema version, token counts,
  `estimate_microusd` and failure category on `GenerationBatch`. They do not write
  `AIInteractionAudit` rows, because that table is child-keyed and parent-visible by design.
  A nullable-child extension is the alternative; ADR-046 records the choice and the reason.
- **Limits.** Staff quotas (batches per staff user per day, questions per batch, tokens per day)
  are Django settings with a model override in `AIServiceControl` style, and the existing kill
  switch is honored. Defaults are conservative (batch size 25 maximum).
- **Long batches.** The repository has no task queue. Batches are split into chunks of at most 5
  questions, each one bounded model call, run by a management command or a thread-safe
  `run_batch` the admin triggers without holding the request open. Whether to add a queue is an
  open dependency decision (section 8).
- **Prompt injection.** Staff-entered free text (topic notes) is passed as `untrusted` content
  parts. Output is never trusted: it is parsed, schema-validated and verified before storage.
- **No runtime Bedrock grading.** Bedrock is used only to author drafts.

## 6. Gameplay integration (LAI-AQS-020 to 022)

Open decision, recommended default below. The brief requires published bank questions to be
playable in Treasure Rush without rewriting it.

Recommended: extend, do not replace.

- Add `MULTIPLY` to `Operation` and let a bank question of type NUMERIC or MULTIPLE_CHOICE with
  integer operands and an integer answer be served as a `MathChallenge` (operation, operands,
  choices, answer). This keeps `ChallengeAttempt`, `grade_answer`, mastery evidence and the
  client prompt rendering working. The client needs a `MULTIPLY` string; that is a localized
  string addition, not a Treasure Rush rewrite.
- Add a nullable `bank_revision` reference and `source` marker on `ChallengeAttempt` (backward
  compatible migration, existing rows keep `source="generated"`). The attempt still snapshots
  everything it showed, so republishing never changes history.
- Questions that need a free text stem or text choices (SHORT_ANSWER, non-integer answers) are
  stored and published but not served by Treasure Rush until the client and the attempt model
  support a text prompt. Those become a documented follow-up, not a silent fallback.
- Selection falls back to the existing `ChallengeSpec` generator when the pool for the chest is
  empty or too small, so current behavior is unchanged when no questions are published.

Storykeeper Castle and other step-based adventures had no Django story catalog when this was
written (LAI-0309, LAI-0603). The Studio does not integrate with them in this phase; the
`QuestionPool` link is by `Adventure.slug` so they can adopt it later.

## 7. ADR-046 (proposed here; accepted by the owner 2026-11-02)

"AI Question Studio is a staff-only Django app that drafts questions through the ADR-044 model
client, stores them in a Django question bank with immutable published revisions, and serves
published integer-answer questions to Treasure Rush through the existing challenge and grading
path." Status **Accepted** (owner, 2026-11-02, "proceed as proposed", in answer to the design in
this section). It amends nothing; it builds on ADR-019, ADR-033, ADR-034 and ADR-044.

## 8. Dependencies, blockers and risks

| Item | Effect | Handling |
|---|---|---|
| ADR-046 not accepted | Models and migrations are a foundational addition | Implement on this branch only; flag in the report |
| No task queue | Long batches cannot run off-request cleanly | Chunked bounded calls plus a management command; queue is a decision |
| Live Bedrock (LAI-0705) not accepted | Studio generation is fake-verified only | AQS-024 live gate stays open |
| `features/ai` not merged | The Studio depends on its code | Merge order: `features/ai`, then `features/studio` |
| Curriculum grades 1 to 2 only | Grade 3 has no skills in the export | Internal `studio:` skill codes until curriculum is extended |
| Treasure Rush client lacks `MULTIPLY` | Multiplication cannot render | Localized string and prompt renderer addition (React) |
| Migration `ChallengeAttempt` | Snapshot-immutability guard | Additive nullable fields, tests prove old rows unchanged |

## 9. As built

```text
Django Admin (staff, permission-gated)
  Generate Questions form -> generation.create_batch (permission, input, quotas, kill switch,
                                                      approved model)  -> GenerationBatch QUEUED
  start_batch (thread | manual command | inline)
  run_batch -> chunks of <= 5 -> ADR-044 ModelClient (Bedrock, Guardrail, structured output)
            -> parse_item -> Question (draft) -> validation.run_validation -> ValidationFinding
  Review page: edit -> workflow.edit (revalidate, history)  -> approve / reject
  Publish (separate permission) -> immutable QuestionRevision (ACTIVE)
  QuestionPool (region + chest) ----> selection.pick_bank_challenge
Treasure Rush issue_chest_challenge -> pool? -> BANK attempt (snapshot) : ChallengeSpec (as before)
submit_chest_answer -> grade_answer (integers, Django) -> SkillEvidence (existing mastery path)
```

Modules (`lai/apps/question_studio/`): `taxonomy` (types, grades, topics, grade to band),
`models` (bank, batches, findings, events, revisions, pools, limits), `contracts` (request,
schema, untrusted item parsing), `prompts` (versioned, `studio-q-v1`), `generation` (service),
`validation` (deterministic checks and reports), `workflow` (state machine, publishing, bulk),
`selection` (pool and conversion to `MathChallenge`), `regeneration`, `forms`, `admin`, and
`manage.py studio_run_batch`. Outside the app: `Operation.MULTIPLY` in
`education/challenges.py`; `source` and `bank_revision_id` on `ChallengeAttempt` (migration
`game_sessions/0005`, additive, old rows read `GENERATED`); a studio reply in
`ai/providers/fake.py`; the pick hook in `game_sessions/play.py`; and a multiplication picture,
hints and parser entry in the React play client.

### Decisions made while building

- **Audit.** Batches carry model, prompt and schema version, attempts, tokens and estimated cost.
  `AIInteractionAudit` is not written (it is child-keyed and parent-visible). Revisit if the owner
  wants one audit table for all model calls.
- **Superseded and retired questions become `REJECTED`** (with a `superseded` or `retired` event),
  because the brief's five states have no "retired". The revision keeps the precise status.
- **Duplicates.** The older question is the original, so two copies are never both blocked.
  Rejected questions do not count. A correction does not collide with the question it replaces.
  Near duplicates (word-trigram Jaccard 0.8 on up to 200 same-topic questions) only warn.
- **Quality checks are heuristics.** There is no AI-based quality judgement; reading length, answer
  range, hint leaks and the existing ADR-044 safety patterns are checked, and a human approves.
- **Served questions are integer only.** Multiple choice and numeric questions with `ADD`,
  `SUBTRACT` or `MULTIPLY` operands (division is stored but not served). The arithmetic is
  re-verified at serve time, so a bad key cannot be graded. Text and short-answer questions are
  stored and publishable but not served to children yet.
- **Skill must be a catalog objective to be served.** Treasure Rush records evidence against
  `LearningObjective`, which the content export creates and administrators can author in Django
  Admin (ADR-033 as amended by ADR-047). The Studio warns when a
  skill code is not in the catalog and the selector skips such revisions.

## 10. Operating it

Staff need Django permissions, not `is_staff` alone. `python manage.py ensure_studio_roles`
creates or resets these groups idempotently (it never changes membership; the dev bootstrap
`ensure-roles` task and `install-debug.sh` run it); add staff to them on the Admin accounts page.
Groups: **Question authors** (also `cancel_generationbatch` and `retry_generationbatch`)
(`add_generationbatch`, `view_generationbatch`, `view_question`, `add_question`, `change_question`),
**Question reviewers** (`view_question`, `change_question`, `approve_question`,
`view_questionrevision`), **Question publishers** (reviewer rights plus `publish_question`,
`retire_revision`), and **Pool managers** (`view/add/change_questionpool`). Studio limits are the
`StudioLimits` row (batch size 25, 10 batches per user per day, 200 questions and 200,000 tokens
per day by default); the ADR-044 `AIServiceControl` kill switch also stops generation.

| Setting | Default | Meaning |
|---|---|---|
| `LAI_STUDIO_RUN_MODE` | `thread` (production: `manual`) | `jobs` (Lambda/SQS chunk jobs), `manual` (use `studio_run_batch`), `thread` and `inline` (local and tests only; production refuses them). See section 14 |
| `LAI_STUDIO_CHUNK_SIZE` | 5 | Questions per model call |
| `LAI_STUDIO_MAX_ATTEMPTS` | 2 | Attempts per chunk (retry timeout, throttle, unavailable, bad shape) |
| `LAI_STUDIO_MAX_OUTPUT_TOKENS` / `LAI_STUDIO_TEMPERATURE` | 2500 / 0.7 | Per call |
| `LAI_STUDIO_TIMEOUT_SECONDS` | 60 | Bedrock read timeout for authoring calls |
| `LAI_STUDIO_MODEL_ID`, `LAI_STUDIO_APPROVED_MODEL_IDS` | ADR-044 model | A model outside the list is refused |

Bedrock region, Guardrail, credentials and prices are the ADR-044 settings. With
`LAI_AI_PROVIDER=fake` the Studio produces valid sample questions locally.

To put a question in front of children: publish questions whose skill is a catalog objective,
then add an enabled **Question pool** naming the region (for example `treasure-rush-cove`) and
chest entity (`cove-chest`), with a minimum pool size. Disabling the pool restores the authored
challenge at once. Already issued attempts keep their snapshot.

### Live five-question batch (LAI-AQS-025 readiness, 2026-11-04)

Tooling for the owner-run test; the steps are in `docs/AI_BEDROCK_ACCEPTANCE.md` section 3. No batch
was run against Bedrock.

- `studio_run_batch --dry-run` is free: the model, whether it is approved, the token quota, the kill
  switch and, per queued batch, the worst-case number of model calls (chunks x
  `LAI_STUDIO_MAX_ATTEMPTS` x `LAI_AI_MAX_ATTEMPTS`). With Bedrock the command refuses to run a
  batch without `--confirm-paid-calls`; the fake provider needs no flag.
- Set `LAI_STUDIO_RUN_MODE=manual` for the test so the Admin Generate button only queues a batch.
- `studio_batch_report --id <uuid> [--show-text]` is read-only: status, failure category, model,
  chunks, attempts, tokens, estimated cost, estimated cost per question, per-question review
  status and validation findings (check and severity), and the count published (must be 0). The
  cost counts only calls that returned usage; a timed-out or blocked call may be billed and is not
  in it.
- Review confirmed in code and tests: the model must be on the approved list (refused, never
  substituted); batches are chunked and bounded (retry on timeout, throttle, unavailable, bad
  shape, never on access or configuration); quotas and the kill switch stop a running batch;
  arithmetic, contradictory-key, duplicate and child-safety checks are deterministic; generated
  rows are drafts, and approval and publishing are separate, permissioned, recorded steps; a
  published question is served through the existing `ChallengeAttempt`, `grade_answer` and
  `SkillEvidence` path, so Python grades it and records evidence (which now also updates
  `SkillProgress`, LAI-0603). No defect was found in these paths in this pass.

## 11. Verification

See the status table and `docs/IMPLEMENTATION_STATUS.md` for the exact commands and results.
Verified here: Python unit, API and Admin tests against PostgreSQL 16 with the fake model,
including an end-to-end test (generate 25, approve, publish, play, grade, evidence) and a
two-thread publish race, and the React multiplication picture (Vitest, typecheck, prettier).
**Not verified:** live Bedrock (LAI-0705 approval gate), a browser session in Django Admin, and
any deployment.

## 12. Known limitations

- The curriculum holds one Grade 3 skill, `multiplication-facts` (Explorers only), added so Studio
  questions have an objective to record progress against. The rest of Grade 3 is not authored,
  and other topics need their own catalog objective (exported or authored in Django Admin, ADR-047)
  before Treasure Rush will serve them.
- Only Treasure Rush chests consume the bank. Storykeeper Castle and the step-based
  adventures are unchanged; pools are keyed by region and chest, with the adventure link kept on
  each revision for later adoption.
- Locally, batches run on a background thread by default, so a restart can strand a batch
  (reclaimed after 15 minutes when it is run again, or cancelled by staff). Deployed
  environments use the Lambda/SQS jobs or the manual command (section 14).
- Near-duplicate detection is a bounded word-overlap check, not semantic.
- `SHORT_ANSWER` is authorable but unverifiable by code and not served to children.

## 13. Status

See `tasks/TASK_TRACKER.md` (Phase 28) for per-task status.
Open gates are tracked as LAI-AQS-025 (live Bedrock, APPROVAL), 026 (Admin browser pass) and 028
(other adventures adopt the bank). LAI-AQS-027 (task queue) is superseded by the ADR-055
Lambda/SQS jobs path; its useful features were folded into that path (section 14).

## 14. Background processing, cancel and retry

**One processing architecture.** In AWS, generation runs on the ADR-055 Lambda/SQS jobs
(`LAI_STUDIO_RUN_MODE=jobs`, `LAI_JOBS_BACKEND=sqs`; `docs/infrastructure/dev-native-environment.md`
section 9). Each chunk is one `studio.generate_chunk` job; the next chunk is submitted only after
the previous result was applied (`generation.apply_chunk_job`, under the job and batch row locks),
so a batch never has two chunks in flight. The EC2 web process never runs a batch: production
settings accept only `jobs` or `manual` (unset is `manual`, for an operator's
`manage.py studio_run_batch`) and refuse `thread` and `inline`.

**Locally, no AWS is needed.** `thread` (default), `manual` and `inline` run the same chunk code in
process; `jobs` with `LAI_JOBS_BACKEND=inline` runs the worker's task code in process through
`apps.jobs`, exactly as the Lambda would.

**Slots make results idempotent.** A batch fills slots `0..requested_count-1`; each stored draft
holds its slot under the unique constraint `studio_question_one_per_batch_slot` (batch, slot).
Every chunk fills one contiguous window of empty slots. In jobs mode the window is the payload's
`requested_before` (its start) and `want` (its size), so the worker contract is unchanged and a
result applied twice finds its window taken and stores nothing. This sits behind the existing
guards (a finished `ProcessingJob` ignores a redelivered result; a result whose `chunk_index` is
not the batch's next chunk is ignored).

**Cancel** (`cancel_generationbatch`; Admin button on the batch page and a bulk action). A QUEUED
batch, or a RUNNING one with nothing working on it (jobs mode with no unfinished chunk job, or an
in-process run older than 15 minutes), ends `CANCELLED` at once. Otherwise the request is recorded
(`cancel_requested_at`, `cancelled_by`) and every runner checks it before the next chunk: no further
model call is made and no further chunk job is submitted. A chunk already in flight is **still
accounted**: its tokens were spent, so they count against the daily quota, and its drafts are kept
(they are drafts, reviewed like any other). A failed or timed-out in-flight job also ends the batch
`CANCELLED`. A cancel that arrives after the last chunk was applied leaves the batch `COMPLETED`.

**Retry** (`retry_generationbatch` plus `add_generationbatch`; Admin button and bulk action). Only a
`FAILED` or `PARTIAL` batch, at most three times, and only while the prompt version, approved
model, Studio switch, kill switch and daily token quota allow. The batch goes back to `QUEUED` and
is started in the configured mode; the run walks the slots from 0 and asks only for the empty
ones (failed chunks and short answers). Stored drafts are never asked for again and never
duplicated. Batches generated before slots existed are refused (`legacy_batch`).

**Failure detail.** Admin shows a fixed message per failure category
(`generation.failure_message`), never provider, worker or model text, next to the progress
("n of m questions, c of t chunks") and the batch's chunk jobs.

**Duplicate submit.** The Generate form carries a hidden `submission_key`; a second submit of the
same form (double click, browser resubmit) returns the first batch instead of queuing another
(unique constraint `studio_batch_one_per_submission`).

**Statuses.** `QUEUED`, `RUNNING`, `COMPLETED`, `PARTIAL`, `FAILED` and the new `CANCELLED`.
Migration `question_studio/0002_batch_cancel_retry_slots` is additive (new nullable or defaulted
columns, two partial unique constraints, two permissions); existing rows are untouched.

### What was taken from LAI-AQS-027 (branch `feature/ai-studio-queue`) and what was not

Taken, adapted to the jobs path: cooperative cancellation and its permission; staff retry of
failed work only, never duplicating drafts (a slot per draft instead of `GenerationChunk` rows);
fixed, sanitized failure messages; the duplicate-submit key; Admin progress, Cancel and Retry
buttons and bulk actions behind permissions; the `CANCELLED` status; production refusing
`thread` and `inline`.

Deliberately not taken: the PostgreSQL lease/claim queue, `manage.py studio_worker` and
`studio_worker_health`, `StudioWorker` check-ins, the `studio-worker` compose service and ADR-052
(a second, competing production processing path on EC2); per-batch leases, heartbeats and
fencing tokens (the jobs framework's row locks, ordered single in-flight chunk and `jobs_sweep`
timeout cover them); in-worker exponential backoff (chunk attempts are bounded by
`LAI_STUDIO_MAX_ATTEMPTS` inside the job; SQS redrive and the sweep handle the rest); the
`GenerationChunk` model; and the status rename to `SUCCEEDED` / `PARTIALLY_FAILED` (churn without
benefit).
