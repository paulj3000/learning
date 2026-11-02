# AI Question Studio (Phase 28)

Branch `features/studio`, based on the `features/ai` tip (`8764698`). Task IDs `LAI-AQS-001` to
`LAI-AQS-024`. This document is the LAI-AQS-001 architecture assessment plus the design the later
tasks build on. Nothing here is implemented beyond what the status table says.

## 1. Corrections to the brief's assumptions

The audit found five places where the repository differs from the brief. Each changes the design.

1. **The brief's the decision numbered 43 on main is not content authoring.** On `main` it is the LAI-0209 recent sign-in guard. No accepted ADR
   covers authored-question drafting or versioning. The Studio therefore needs its own decision:
   proposed **ADR-045** (section 7).
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
  A nullable-child extension is the alternative; ADR-045 records the choice and the reason.
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

Storykeeper Castle and other step-based adventures run client-side on Amplify sessions with no
Django catalog (LAI-0309, LAI-0603). The Studio does not integrate with them in this phase; the
`QuestionPool` link is by `Adventure.slug` so they can adopt it later.

## 7. Proposed ADR-045

"AI Question Studio is a staff-only Django app that drafts questions through the ADR-044 model
client, stores them in a Django question bank with immutable published revisions, and serves
published integer-answer questions to Treasure Rush through the existing challenge and grading
path." Status **Proposed**; owner acceptance is needed before AQS-003 migrations merge. It
amends nothing; it builds on ADR-019, ADR-033, ADR-034 and ADR-044.

## 8. Dependencies, blockers and risks

| Item | Effect | Handling |
|---|---|---|
| ADR-045 not accepted | Models and migrations are a foundational addition | Implement on this branch only; flag in the report |
| No task queue | Long batches cannot run off-request cleanly | Chunked bounded calls plus a management command; queue is a decision |
| Live Bedrock (LAI-0705) not accepted | Studio generation is fake-verified only | AQS-024 live gate stays open |
| `features/ai` not merged | The Studio depends on its code | Merge order: `features/ai`, then `features/studio` |
| Curriculum grades 1 to 2 only | Grade 3 has no skills in the export | Internal `studio:` skill codes until curriculum is extended |
| Treasure Rush client lacks `MULTIPLY` | Multiplication cannot render | Localized string and prompt renderer addition (React) |
| Migration `ChallengeAttempt` | Snapshot-immutability guard | Additive nullable fields, tests prove old rows unchanged |

## 9. Status

| Task | Status |
|---|---|
| LAI-AQS-001 | DONE (this document) |
| LAI-AQS-002 to 024 | TODO |
