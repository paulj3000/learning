# Educational Content Standard

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-011, ADR-016, ADR-020, ADR-033, ADR-044, ADR-046, ADR-047, ADR-064

How learning objectives, challenge content, hints and questions are authored, validated, reviewed,
published, graded and recorded as progress. It applies to hand-authored content and to anything
drafted with AI. The canonical detail lives in:

| Topic | Canonical document |
|---|---|
| Age bands, AI interaction model, coding rules | [CLAUDE.md](../../CLAUDE.md) sections 3, 7, 13 |
| AI Question Studio | [AI_QUESTION_STUDIO.md](../AI_QUESTION_STUDIO.md), ADR-046 |
| Django content authoring and revisions | [platform/DJANGO_CONTENT_AUTHORING.md](../platform/DJANGO_CONTENT_AUTHORING.md), ADR-047 |
| Factual claims and source review | [CONTENT_SOURCES.md](../CONTENT_SOURCES.md) |
| AI safety and prompts | [AI_AND_CHILD_SAFETY.md](../AI_AND_CHILD_SAFETY.md), [PROMPT_AND_SCHEMA_GUIDE.md](../PROMPT_AND_SCHEMA_GUIDE.md), [AI_SERVICE.md](../AI_SERVICE.md) |
| Adventure engine and steps | [ADVENTURE_ENGINE.md](../ADVENTURE_ENGINE.md) |
| Decisions | [DECISIONS.md](../DECISIONS.md) |

Related standards: [challenge-standard.md](challenge-standard.md),
[adventure-standard.md](adventure-standard.md), [quest-standard.md](quest-standard.md),
[scoring-standard.md](scoring-standard.md), [npc-standard.md](npc-standard.md),
[accessibility-standard.md](accessibility-standard.md).

Rules tagged **Binding** already apply through the cited source. Untagged rules are proposals of
ADR-072.

## 1. Principles

1. Every challenge serves a named learning objective. No objective, no challenge.
2. **Binding:** CLAUDE.md §7, ADR-020, ADR-046 item 3. Application code grades. A model never
   decides whether a child's answer is correct, and the game engine never validates answers.
3. **Binding:** CLAUDE.md §3. Difficulty, reading volume, response mode and interaction length
   derive from the child's age band and demonstrated ability.
4. **Binding:** ADR-045, ADR-046, ADR-047. Nothing reaches a child unpublished. AI-drafted
   content is never served until it has passed validation, staff review and publication.
5. Every AI-backed moment has an authored fallback written in code or in published content
   (**Binding:** CLAUDE.md §7).
6. Learning has consequences in the world, without an XP, coin or level economy
   (**Binding:** ADR-011; see [scoring-standard.md](scoring-standard.md)).

## 2. Learning objectives

- The canonical model is `catalog.LearningObjective` (`code`, `domain`, `title`). `code` is the
  stable slug every challenge, evidence row and progress row refers to.
- **Binding:** ADR-047 decision B. Learning objectives are authorable in Django Admin through
  versioned revisions; they also arrive through the content export and `manage.py
  load_content`. An import never silently overwrites an administrator edit (**Binding:**
  CLAUDE.md §20, ADR-047 decision J).
- **Binding:** CLAUDE.md §20, ADR-033. Do not add a second objective table, curriculum or skill
  catalog for one feature. Question Studio internal codes (`studio:<subject>:<topic>`) are not
  objectives; the Studio serves only questions whose skill is a catalog objective.
- Name objectives as observable skills a child shows ("compare two lengths"), not topics
  ("measurement").
- No external standards identifiers are stored unless the owner approves a mapping.

## 3. Age-appropriate content

**Binding:** CLAUDE.md §3 sets the bands:

| Band | Ages | Interaction | Reading |
|---|---|---|---|
| Sprouts | 3 to 4 | One-step decisions, voice-first and picture-first | No required reading |
| Pathfinders | 5 to 6 | Two- or three-step quests | Narrated text, optional highlighting |
| Explorers | 7 to 8 | Multi-stage missions | More independent reading |

- **Binding:** ADR-047 decisions D and G. Copy, hints and parameters that vary by band are keyed
  by band in the revision body; an adventure does not appear for a band it does not list;
  publishing enforces per-band maximum lengths, no em dashes and plain text only.
- **Binding:** CLAUDE.md §13. Child-facing text is readable aloud and localizable.
- Sprouts content never requires reading to answer; every choice has a picture and narration.
- Question Studio grades map to bands through a table in code (`taxonomy.py`, see
  AI_QUESTION_STUDIO.md section 4). Ages 9 to 12 are not supported (ADR-047 decision G).

## 4. Difficulty bands

- Challenge parameters live in `education.ChallengeSpec` per age band (skill, value range,
  response mode, choice count). `ChallengeSpec.clean()` runs `validate_parameters`, so a row can
  never hold parameters the generator would refuse.
- Question Studio difficulty is `EASY`, `MEDIUM` or `HARD` per question (`MIXED` is a request
  value only).
- Adaptation chooses among published content using `SkillProgress` (the Adaptive Director,
  `lai/apps/education/director.py`, ADR-016). It never generates new difficulty rules at
  runtime.
- **Binding:** ADR-047 decision F. A new puzzle or challenge kind is a code change with a Python
  parameter schema and grader; Django Admin edits parameters only within that schema.
- State in each challenge specification which band and difficulty the content targets and what
  "one step easier" looks like (see [challenge-standard.md](challenge-standard.md)).

## 5. AI Question Studio

**Binding:** ADR-046. The Studio (`lai/apps/question_studio`) is staff-only and lives in Django
Admin.

| Model | Role |
|---|---|
| `GenerationBatch` | One staff generation request: model, prompt and schema version, tokens, estimated cost, status |
| `Question` | A staff-owned draft. Never served to a child |
| `ValidationFinding` | Deterministic check results (`BLOCKING`, `WARNING`, `INFO`) |
| `ReviewEvent` | Every edit, approval, rejection, publish and retirement |
| `QuestionRevision` | The published, immutable form: the only thing a child can be served |
| `QuestionPool` | Which published revisions a Treasure Rush chest may draw from, with a minimum size |

Flow:

```text
Generate (staff, quota, kill switch) -> GenerationBatch -> chunks via ADR-044 model client
  -> parse untrusted output -> Question (DRAFT) -> validation -> NEEDS_REVIEW
  -> reviewer approves or rejects -> publisher publishes -> QuestionRevision (immutable)
  -> enabled QuestionPool -> served as a snapshot through ChallengeAttempt -> graded by Django
```

- **Binding:** ADR-046 item 3, ADR-064. Generation, validation, approval and publishing are
  separate operations behind separate Django permissions (groups from `manage.py
  ensure_studio_roles`). Background generation runs on the canonical `apps.jobs` path
  (`LAI_STUDIO_RUN_MODE=jobs`) or the manual command; no second job system.
- Staff-entered notes are passed to the model as untrusted content. Model output is parsed and
  schema-validated before storage.
- An empty or too-small pool falls back to the authored `ChallengeSpec` generator, so
  disabling a pool restores authored behaviour at once.
- Only integer-answer multiple choice and numeric questions are served today. `SHORT_ANSWER`
  and text questions are stored but not served until code can verify them.

## 6. Content validation

Validation is deterministic application code, never a model judgement.
- Schema: the record kind's JSON Schema (`content/schema/content.schema.json`) on every save and
  again at publish (**Binding:** ADR-047 decision D).
- References: objectives, items, quests, assets and launch points must exist and be of the right
  kind.
- Correctness: answers are re-verified by code (the Studio recomputes integer arithmetic at
  serve time, so a bad key cannot be graded).
- Safety and language: the shared child-facing text checks in `apps.ai.content_safety`, reading
  length per band, no em dashes, no markup or URLs, no hint that leaks the answer.
- Duplicates: exact duplicates block; near duplicates warn.
- Run `npm run content:check` after changing exported content.

## 7. Staff review and publishing

- A human reviewer approves every AI-drafted item. Heuristic checks do not replace review
  (AI_QUESTION_STUDIO.md, "Quality checks are heuristics").
- Reviewers check: the objective is served, the answer is correct, wording fits the band, there
  is one defensible answer, distractors are plausible but not tricky, and no fact is unsourced.
- **Binding:** ADR-047 decision D. Publishing is atomic, permission-gated, revalidates fully and
  is recorded in the admin log and on the revision. Editing a draft and publishing are separate
  permissions.
- Factual (science, nature, history) content needs a traceable source and review per
  [CONTENT_SOURCES.md](../CONTENT_SOURCES.md).

## 8. Versioning

- **Binding:** ADR-047 decision E. Published revisions are never edited or deleted. Rollback
  publishes an earlier body as a new revision. A started session keeps the rules it began with;
  gradable content is snapshotted on the attempt or session.
- **Binding:** ADR-046. `QuestionRevision` content never changes after publishing; a correction
  is a new revision, and attempts that snapshotted the old one stay intact.
- The Question Studio lifecycle is separate from `ContentRevision` (ADR-047, "Relationship to
  ADR-045 and ADR-046"); do not merge them.

## 9. AI-generated content safety

- **Binding:** CLAUDE.md §7, ADR-044. Every model call goes through `lai/apps/ai` (Bedrock with
  the child-safety Guardrail, or the deterministic fake provider locally and in tests). Never
  from the browser.
- Requests carry the template, age band, allowed topic, objective and maximum output length.
- Output is untrusted: schema-validated, safety-checked, and replaced by an authored fallback on
  any failure.
- Runtime AI (Chatty, NPC hints) may rephrase or hint around authored content; it never
  introduces new factual claims, new answers or new rules ([CONTENT_SOURCES.md](../CONTENT_SOURCES.md)).
- Studio batches do not write child-keyed `AIInteractionAudit` rows; runtime child turns do
  (**Binding:** ADR-046 item 2, ADR-044).
- No child data is sent to the Studio model. Studio prompts contain only staff inputs.

## 10. Correctness and grading

- **Binding:** ADR-046 item 3, ADR-047 decision F. Django grades (`grade_answer`, the puzzle
  kind's Python grader) against the snapshot on the attempt.
- **Binding:** ADR-020. The Three.js engine emits typed answer events; it never decides
  correctness or awards progress.
- Client-side checks may give instant feedback only when the server remains authoritative for
  progress.
- Every challenge specification states its correctness rule in a form a test can check
  ([templates/challenge-specification.md](templates/challenge-specification.md)).

## 11. Progress

- Evidence: `education.SkillEvidence` (objective code, evidence type, difficulty, result,
  support level, duration), linked to exactly one source (adventure session, story progress or
  challenge attempt).
- Aggregate: `education.SkillProgress` per child and objective (exposures, independent and
  supported successes, streak, recent level, error pattern), maintained by the mastery rules in
  `education/mastery.py`.
- Record whether a hint was used (support level); supported success is progress, not failure.
- **Binding:** CLAUDE.md §11 item 10. Parents see activity summarized by skill, not raw
  transcripts.
- **Binding:** CLAUDE.md §4 pillar 7, ADR-011. No public leaderboards, streak pressure or
  shaming.

## 12. Replay variation

- Variation comes from published pools and server-chosen seeds (the server picks a seed per
  `ChallengeSpec` attempt), not from runtime generation of new questions.
- A replay must not repeat the identical item when the pool allows another; pools have a
  minimum size for this reason.
- AI may vary wording of authored lines through the pipeline; the gradable content stays the
  same.

## 13. Authored fallbacks

| Failure | Fallback |
|---|---|
| Question pool empty, disabled or too small | Authored `ChallengeSpec` generator |
| AI hint unavailable, refused or rate-limited | Authored hint ladder or persona fallback lines |
| AI narration unavailable | The authored base text |
| Content fails to load | A calm message and a way back; never a blank screen |

## 14. Content sources

Follow [CONTENT_SOURCES.md](../CONTENT_SOURCES.md): every real-world claim in authored text has
a checkable source and a last-checked date, and AI variation never adds claims.

## 15. Tests and checks

Follow [TESTING_STRATEGY.md](../TESTING_STRATEGY.md). Targeted examples:

```bash
.venv/bin/python -m pytest -q lai/apps/question_studio lai/apps/education
npm run content:check
```

New content kinds add tests for validation, age-band filtering, grading and the fallback path.
CLAUDE.md §11 item 14 requires tests for age adaptation and AI validation.
