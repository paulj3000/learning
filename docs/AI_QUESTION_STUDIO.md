# AI Question Studio (Phase 28)

Branch `features/studio`, based on the `features/ai` tip (`8764698`). Task IDs `LAI-AQS-001` to
`LAI-AQS-024`. Sections 1 to 8 are the LAI-AQS-001 architecture assessment and design; sections 9
to 13 record what was built, how to run it, and what is verified. Section 14 is the background
queue (LAI-AQS-027, ADR-052, branch `feature/ai-studio-queue`). Nothing is deployed.

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
  -> GenerationBatch + GenerationChunk rows (quota check, advisory lock) -> queue (section 14)
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
- **Long batches.** Batches are split into chunks of at most 5 questions, each one bounded model
  call. The admin request only stores the batch and its chunks; a separate worker process
  (`manage.py studio_worker`, the `studio-worker` compose service) claims it from a
  PostgreSQL-backed queue, runs it chunk by chunk under a lease, and commits each chunk once. A
  crash loses at most the chunk in flight. Decided in ADR-052 (LAI-AQS-027); see section 14.
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

Storykeeper Castle and other step-based adventures run client-side on Amplify sessions with no
Django catalog (LAI-0309, LAI-0603). The Studio does not integrate with them in this phase; the
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
| Worker process not running (LAI-AQS-027) | Batches wait as Queued; nothing is lost | PostgreSQL queue and `studio-worker` service (ADR-052, section 14); `studio_worker_health` exits 1 when work waits with no live worker |
| Live Bedrock (LAI-0705) not accepted | Studio generation is fake-verified only | AQS-024 live gate stays open |
| `features/ai` not merged | The Studio depends on its code | Merge order: `features/ai`, then `features/studio` |
| Curriculum grades 1 to 2 only | Grade 3 has no skills in the export | Internal `studio:` skill codes until curriculum is extended |
| Treasure Rush client lacks `MULTIPLY` | Multiplication cannot render | Localized string and prompt renderer addition (React) |
| Migration `ChallengeAttempt` | Snapshot-immutability guard | Additive nullable fields, tests prove old rows unchanged |

## 9. As built

```text
Django Admin (staff, permission-gated)
  Generate Questions form -> generation.create_batch (permission, input, quotas, kill switch,
                             approved model, one-time form key) -> GenerationBatch QUEUED
                                                                 + GenerationChunk rows PENDING
  start_batch: worker (production) | manual | thread (dev) | inline (tests)
studio-worker service (manage.py studio_worker, separate process, section 14)
  jobs.claim_next (advisory lock + SKIP LOCKED, running cap) -> lease + fencing token
  jobs.process -> next PENDING chunk (backoff honoured, heartbeat renews the lease)
            -> ADR-044 ModelClient (Bedrock, Guardrail, structured output)
            -> one transaction: parse_item -> Question (draft, unique chunk slot)
               -> validation.run_validation -> ValidationFinding; chunk SUCCEEDED; counters
  -> SUCCEEDED | PARTIALLY_FAILED | FAILED | CANCELLED   (Admin: Retry failed chunks, Cancel)
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
`selection` (pool and conversion to `MathChallenge`), `regeneration`, `forms`, `admin`, `jobs`
(the queue engine, LAI-AQS-027), and `manage.py studio_worker`, `studio_worker_health` and
`studio_run_batch`. Outside the app: `Operation.MULTIPLY` in
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
  `LearningObjective`, which only the content export can create (ADR-033). The Studio warns when a
  skill code is not in the catalog and the selector skips such revisions.

## 10. Operating it

Staff need Django permissions, not `is_staff` alone. Suggested groups: **Question authors**
(`add_generationbatch`, `view_generationbatch`, `view_question`, `add_question`, `change_question`),
**Question reviewers** (`view_question`, `change_question`, `approve_question`,
`view_questionrevision`), **Question publishers** (reviewer rights plus `publish_question`,
`retire_revision`), **Pool managers** (`view/add/change_questionpool`), and **Batch operators**
(`view_generationbatch`, `cancel_generationbatch`, `retry_generationbatch`,
`view_studioworker`; authors usually get `cancel_generationbatch` for their own work too). Studio
limits are the
`StudioLimits` row (batch size 25, 10 batches per user per day, 200 questions and 200,000 tokens
per day by default); the ADR-044 `AIServiceControl` kill switch also stops generation.

| Setting | Default | Meaning |
|---|---|---|
| `LAI_STUDIO_RUN_MODE` | `thread` (base), `worker` (production) | `worker` (queue only; `studio_worker` runs it), `manual` (use `studio_run_batch`), `thread` (development), `inline` (tests). Production accepts only `worker` and `manual` |
| `LAI_STUDIO_CHUNK_SIZE` | 5 | Questions per model call |
| `LAI_STUDIO_MAX_ATTEMPTS` | 2 | Each chunk's attempt budget (retryable: timeout, throttle, unavailable, bad shape, cut off). A staff retry raises the budget of each failed chunk by this much |
| `LAI_STUDIO_LEASE_SECONDS` | 300 | How long a worker owns a running batch without renewing. At least 3 heartbeats and at least twice the timeout |
| `LAI_STUDIO_HEARTBEAT_SECONDS` | 30 | Lease renewal interval during a model call |
| `LAI_STUDIO_WORKER_POLL_SECONDS` | 5 | Idle wait between claim attempts |
| `LAI_STUDIO_WORKER_CONCURRENCY` | 1 | Claim loops (threads) per worker process, 1 to 8 |
| `LAI_STUDIO_MAX_RUNNING_BATCHES` | 2 | Batches owned at once across every worker, 1 to 20 |
| `LAI_STUDIO_RETRY_BACKOFF_SECONDS` / `LAI_STUDIO_RETRY_BACKOFF_MAX_SECONDS` | 30 / 900 | Delay before a chunk's next attempt: base * 2^(attempt - 1), capped |
| `LAI_STUDIO_MAX_BATCH_RETRIES` | 3 | Staff retries of one batch's failed chunks, 0 to 10 |
| `LAI_STUDIO_WORKER_HEALTH_FILE` | `/tmp/lai-studio-worker.alive` | Heartbeat file the worker touches; the container health check reads its age |
| `LAI_STUDIO_MAX_OUTPUT_TOKENS` / `LAI_STUDIO_TEMPERATURE` | 2500 / 0.7 | Per call |
| `LAI_STUDIO_TIMEOUT_SECONDS` | 60 | Bedrock read timeout for authoring calls |
| `LAI_STUDIO_MODEL_ID`, `LAI_STUDIO_APPROVED_MODEL_IDS` | ADR-044 model | A model outside the list is refused |

Bedrock region, Guardrail, credentials and prices are the ADR-044 settings. With
`LAI_AI_PROVIDER=fake` the Studio produces valid sample questions locally.

To put a question in front of children: publish questions whose skill is a catalog objective,
then add an enabled **Question pool** naming the region (for example `treasure-rush-cove`) and
chest entity (`cove-chest`), with a minimum pool size. Disabling the pool restores the authored
challenge at once. Already issued attempts keep their snapshot.

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
  and other topics need their own exported objective before Treasure Rush will serve them.
- Only Treasure Rush chests consume the bank. Storykeeper Castle and the Amplify-session
  adventures are unchanged; pools are keyed by region and chest, with the adventure link kept on
  each revision for later adoption.
- A chunk whose model call returns fewer questions than asked is stored as SUCCEEDED with what it
  got; the shortfall is not topped up, and the batch ends PARTIALLY_FAILED (`SHORT_RESPONSE`).
  Generate a further batch for the missing questions.
- The daily token quota sums the tokens of batches created that day (UTC day of creation), so a
  batch queued before midnight and run after it counts against the earlier day.
- One worker process per instance by default (`LAI_STUDIO_WORKER_CONCURRENCY=1`), so a second
  batch waits as Queued until the first finishes or parks. Throughput is bounded on purpose.
- A worker kill on a real EC2 instance, live Bedrock under the worker, and a browser pass of the
  queue Admin pages are not yet verified (LAI-AQS-027 owner acceptance).
- Near-duplicate detection is a bounded word-overlap check, not semantic.
- `SHORT_ANSWER` is authorable but unverifiable by code and not served to children.

## 13. Status

See `tasks/TASK_TRACKER.md` (Phase 28) for per-task status.
Open gates are tracked as LAI-AQS-025 (live Bedrock, APPROVAL), 026 (Admin browser pass), 027
(background queue) and 028 (other adventures adopt the bank). LAI-AQS-027 is development complete
on `feature/ai-studio-queue` (ADR-052 Proposed); owner acceptance is pending (ADR acceptance, a
deploy of the `studio-worker` service, a kill test on a real instance). 025, 026 and 028 are not
started.

## 14. Background queue (LAI-AQS-027, ADR-052)

Branch `feature/ai-studio-queue`. PostgreSQL is the queue: a `GenerationBatch` is the job, its
`GenerationChunk` rows are the work items, and a worker owns a batch only while it holds a lease on
it. The engine is `lai/apps/question_studio/jobs.py`; the worker is `manage.py studio_worker`,
deployed as the `studio-worker` compose service. Operators: `docs/platform/STUDIO_WORKER_RUNBOOK.md`.

### 14.1 Batch states

| From | To | When |
|---|---|---|
| QUEUED | RUNNING | A worker (or an in-process run) claims it |
| QUEUED | CANCELLED | Staff cancel before any worker claims it |
| RUNNING | SUCCEEDED | Every chunk SUCCEEDED and the requested count was produced |
| RUNNING | PARTIALLY_FAILED | Some questions stored, some chunks failed or came back short |
| RUNNING | FAILED | No question stored |
| RUNNING | CANCELLED | The owner saw a cancel request before its next chunk, or no worker owned it |
| FAILED, PARTIALLY_FAILED | QUEUED | Staff "Retry failed chunks" only |

SUCCEEDED and CANCELLED are final. The allowed moves are `BATCH_TRANSITIONS` in `models.py`, and a
check constraint keeps the status column to these six values. Admin shows a finer **display
state** for a RUNNING batch (`jobs.display_state`):

| Display state | Meaning |
|---|---|
| Running | A worker holds a live lease |
| Stalled | The lease has expired with an owner still named: the worker stopped without releasing it. The next claim recovers it |
| Waiting to retry | Every remaining chunk is waiting out a backoff; the batch is parked with no owner until the earliest retry time |
| Waiting for a worker | No owner and no future wake time, for example after a graceful worker shutdown released it; any worker claims it next |
| Cancelling | A cancel was requested; the owner stops before its next chunk |

### 14.2 Chunk states

`PENDING` (not run yet, or waiting for a retry: `next_attempt_at`), `RUNNING` (one attempt in
flight, `claim_token` set), `SUCCEEDED` (its questions are stored), `FAILED` (attempt budget spent,
a non-retryable failure, or never run because the batch stopped: `NOT_RUN`, `KILL_SWITCH`,
`TOKEN_QUOTA` and similar), `CANCELLED`. Each chunk has `attempts` and `max_attempts` (its budget,
`LAI_STUDIO_MAX_ATTEMPTS`), tokens, `failure_category` and a sanitized `last_error`. The batch's
`chunks_done` is derived from its chunks (succeeded, or failed after at least one attempt), never
counted up, so retries and recoveries cannot skew it.

### 14.3 Claim, lease, fencing and idempotency

- **Claim.** `claim_next` takes the advisory transaction lock, refuses when
  `LAI_STUDIO_MAX_RUNNING_BATCHES` batches already hold a live lease, then selects the oldest
  claimable batch (QUEUED, or RUNNING with an expired lease) `FOR UPDATE SKIP LOCKED`. The claim
  writes a new `lease_token`, `lease_owner`, `lease_expires_at` and `heartbeat_at`.
  `claim_batch(id)` takes one named batch the same way, for the in-process modes and
  `studio_run_batch --id`; it is not limited by the running cap.
- **Lease and heartbeat.** The owner renews the lease at every step, and a heartbeat thread renews
  it every `LAI_STUDIO_HEARTBEAT_SECONDS` while a model call is in flight. A lease lasts
  `LAI_STUDIO_LEASE_SECONDS`; settings refuse a lease shorter than three heartbeats or twice the
  studio timeout.
- **Recovery.** A claim of a RUNNING batch whose lease expired is a recovery (`recovered_count`).
  Its RUNNING chunk goes back to PENDING with the attempt already counted; a chunk that has used
  its whole budget this way fails as `WORKER_LOST`, so a chunk that crashes every worker cannot
  loop forever.
- **Fencing.** Every write re-reads the row-locked batch and checks the lease token, and the
  chunk's `claim_token`. A worker that was paused, partitioned or overtaken raises `LeaseLost` and
  commits nothing.
- **Idempotent commit.** A chunk's questions, validation findings, review events, its SUCCEEDED
  status, the token counts and the batch counters commit in one transaction. Each question records
  its `(chunk, chunk_position)` slot under the unique constraint
  `studio_question_once_per_chunk_slot`, and each chunk asks the model for the same slots on every
  attempt.
- **Duplicate submits.** The Generate form carries a hidden one-time key; a second submit of the
  same form returns the first batch instead of queueing another. Submissions are serialized by a
  second advisory lock so two at once cannot both pass the daily quotas.

**What a crash loses.** A hard kill (SIGKILL, out of memory, instance loss) loses at most the chunk
in flight: its model call and the tokens it used. Committed questions are never lost and never
stored twice. The batch continues when a worker claims it after the lease expires (at most
`LAI_STUDIO_LEASE_SECONDS` later). A graceful stop (SIGTERM) lets the chunk in flight commit,
then releases the lease so the batch is claimable at once.

**Legacy batches.** Migration `0002` gives a batch that was RUNNING on the old thread path an
expiring `legacy-thread` lease (its start plus the old 15 minutes). On its first claim it gets
chunk rows; the chunks it had already finished count as done and are not re-run.

### 14.4 Retries and backoff

A retryable failure (`TIMEOUT`, `THROTTLED`, `UNAVAILABLE`, `INVALID_RESPONSE`, `TRUNCATED`)
returns the chunk to PENDING with `next_attempt_at = now + min(base * 2^(attempt - 1), cap)`, where
base is `LAI_STUDIO_RETRY_BACKOFF_SECONDS` (30) and cap `LAI_STUDIO_RETRY_BACKOFF_MAX_SECONDS`
(900), until the chunk's attempt budget is spent. These attempts are on top of the ADR-044
adapter's own retries inside one call (`LAI_AI_MAX_ATTEMPTS`). When every remaining chunk is
waiting, the worker parks the batch (no owner, expiry set to the earliest retry) and moves on.
The in-process modes (`thread`, `inline`, `studio_run_batch`) retry at once, since nothing would
come back for a parked batch.

`CONFIGURATION`, `ACCESS_DENIED`, `GUARDRAIL`, `DISABLED`, `INTERNAL` and `PROMPT_CHANGED` stop the
batch: its remaining chunks fail as `NOT_RUN` rather than cost more. Before each chunk the worker
also checks the prompt version, the ADR-044 kill switch, `StudioLimits.generation_enabled` and the
daily token quota; any of them fails the remaining chunks with that category.

**Staff retry** ("Retry failed chunks", permission `retry_generationbatch`) applies to a FAILED or
PARTIALLY_FAILED batch with at least one FAILED chunk. It refuses after
`LAI_STUDIO_MAX_BATCH_RETRIES` rounds, when the prompt version changed, or when the kill switch,
generation switch or token quota would stop it anyway. It sets only the FAILED chunks back to
PENDING, raises each one's budget by `LAI_STUDIO_MAX_ATTEMPTS`, and queues the batch. SUCCEEDED
chunks and their questions are untouched.

### 14.5 Cancellation

"Cancel" (permission `cancel_generationbatch`) is cooperative. A QUEUED batch, or a RUNNING batch
no worker currently owns (stalled, parked, released), is CANCELLED at once; clearing its lease also
fences off a worker that might still wake up holding it. A batch with a live owner shows
Cancelling until the worker checks before its next chunk (at most one chunk call). Pending and
running chunks become CANCELLED. Questions already stored stay as drafts for review. A finished
batch cannot be cancelled.

### 14.6 Run modes

| Mode | Who runs the batch | Use |
|---|---|---|
| `worker` | `manage.py studio_worker` (the `studio-worker` service); the request only queues | Production default; local development with a worker running |
| `manual` | `manage.py studio_run_batch [--id UUID]`, once, in that process | Operator one-off; production fallback without a worker |
| `thread` | A daemon thread in the web process, through the same claim and lease | Base default for local development; refused in production |
| `inline` | The admin request itself | Tests only; refused in production |

Every mode claims through `jobs`, so a batch an in-process run abandons (the web process restarted)
is recovered by any worker or `studio_run_batch` once its lease expires.

### 14.7 Status rename

Migration `question_studio/0002_job_queue` renames `COMPLETED` to `SUCCEEDED` and `PARTIAL` to
`PARTIALLY_FAILED`, adds `CANCELLED`, the chunk and worker tables, the lease, retry and cancel
fields, the two permissions and the claim index. It is reversible: going back renames the statuses
and maps `CANCELLED` to `FAILED`, which had no equivalent before.

### 14.8 Logging

Logger `lai.studio.queue`, one line per event in `studio.queue event=<name> key=value` form:

| Event | Fields |
|---|---|
| `submitted` | batch, staff (user id), count, chunks |
| `claimed` | batch, worker, claims |
| `recovered` | batch, worker, previous owner, recoveries |
| `parked` | batch, until |
| `chunk` | batch, chunk index, status, attempt/budget, failure category |
| `finished` | batch, status, produced/requested, attempts, failure category |
| `released` | batch, worker |
| `lease_lost` | batch, worker |
| `cancel` | batch, staff, outcome (`cancelled` or `cancelling`) |
| `retry` | batch, staff, chunks, round |
| `internal_error` | batch, exception type |

Lines carry ids, counts, statuses and failure categories only. Never a prompt, staff notes, model
output, an exception message or any child data (ADR-025). The worker command adds its own start,
stop and idle lines under the same rules.

### 14.9 Staff-facing error messages

`last_error` on a batch or chunk is always one of these fixed strings, chosen by failure category.
Nothing from a provider error or a model response is stored.

| Category | Message |
|---|---|
| `TIMEOUT` | The model did not answer in time. |
| `THROTTLED` | The model service asked us to slow down. |
| `UNAVAILABLE` | The model service was unavailable. |
| `INVALID_RESPONSE` | The model's answer did not have the expected shape. |
| `TRUNCATED` | The model's answer was cut off. |
| `CONFIGURATION` | The model is not configured correctly for this environment. |
| `ACCESS_DENIED` | This environment is not allowed to call the model. |
| `GUARDRAIL` | The safety Guardrail blocked the request or the answer. |
| `DISABLED` | AI generation is not configured in this environment. |
| `KILL_SWITCH` | AI model calls were switched off. |
| `GENERATION_DISABLED` | Generation was switched off in Studio limits. |
| `TOKEN_QUOTA` | The daily token limit was reached. |
| `WORKER_LOST` | The worker stopped while running this chunk too many times. |
| `NOT_RUN` | Not run: an earlier chunk failed in a way that stops the batch. |
| `PROMPT_CHANGED` | The prompt version changed after this batch was queued. |
| `SHORT_RESPONSE` | The model returned fewer questions than asked. |
| `INTERNAL` | An internal error stopped this chunk. See the worker log. |

### 14.10 Admin

Django Admin only. The batch list shows the display state and progress (chunks done of total,
produced of requested). The batch page shows the chunks inline, the sanitized `last_error`, the
lease owner, expiry, last heartbeat, claim, recovery and retry counts, and refreshes itself every
10 seconds while the batch is active. "Cancel" and "Retry failed chunks" are POST buttons on the
page and bulk actions on the list, each behind its permission. **Studio workers** is a read-only
list (`view_studioworker`) of worker check-ins with an alive flag.
