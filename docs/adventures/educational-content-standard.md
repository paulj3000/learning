# Educational Content Standard

- **Status:** Mandatory policy (merged to `main` at the owner's direction on 2026-11-18; formal acceptance of ADR-072 pending). Rules restated from CLAUDE.md and accepted ADRs bind through those sources.
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-019, ADR-033, ADR-044, ADR-046, ADR-047, ADR-053, ADR-054, ADR-064, ADR-072 (Proposed)
- **Canonical sources:** [`CLAUDE.md`](../../CLAUDE.md) sections 3, 7 and 13, [`docs/AI_QUESTION_STUDIO.md`](../AI_QUESTION_STUDIO.md), [`docs/AI_AND_CHILD_SAFETY.md`](../AI_AND_CHILD_SAFETY.md), [`docs/PROMPT_AND_SCHEMA_GUIDE.md`](../PROMPT_AND_SCHEMA_GUIDE.md), [`docs/platform/DJANGO_CONTENT_AUTHORING.md`](../platform/DJANGO_CONTENT_AUTHORING.md), [`docs/ADVENTURE_ENGINE.md`](../ADVENTURE_ENGINE.md), [`docs/PLAY_API.md`](../PLAY_API.md), [`docs/DECISIONS.md`](../DECISIONS.md)

This standard governs the learning in an adventure: what a child is asked, how hard it is, how the
answer is judged, how content is authored, reviewed, published and versioned, and how AI may help.
It complements [`challenge-standard.md`](challenge-standard.md) (challenge mechanics) and
[`scoring-standard.md`](scoring-standard.md) (rewards).

## 1. Rules every adventure follows

| # | Rule | Source |
|---|---|---|
| E1 | Every adventure names one or more learning objectives that exist in the catalog (`catalog.LearningObjective`) | CLAUDE.md section 1 |
| E2 | Correctness is decided by Django application code (for example `education.challenges.grade_answer`). Never by a model, never by the engine, never by the browser alone | CLAUDE.md section 7, ADR-019, ADR-046 item 3 |
| E3 | Difficulty, reading volume, response mode and interaction length derive from the child's age band and demonstrated ability, set by the server | CLAUDE.md section 3 |
| E4 | Django Admin is the authoring system. Content is versioned (ADR-047 `ContentRevision`; Question Studio `QuestionRevision`); published versions are never edited | ADR-047, ADR-046 |
| E5 | AI-generated questions and other gradable content reach a child only after validation, staff review and publication (ADR-046). Runtime AI phrasing of dialogue and hints goes only through the ADR-044 pipeline (Guardrail, schema, output policy, authored fallback) and never changes a rule or an answer. | ADR-046, ADR-044 |
| E6 | Every learning interaction has an authored fallback written in code or content, so play continues when AI, a pool or a service is unavailable | CLAUDE.md section 7 |
| E7 | Use the canonical progress models (`SkillEvidence`, `SkillProgress`, `ChallengeAttempt`, `WorldChange`, `QuestProgress`). No per-adventure progress, mastery or question store | ADR-033 |
| E8 | No time pressure: no countdowns, nudges to stop or cut-offs | ADR-053 |

## 2. Learning objectives

- Objectives (`LearningObjective`: code, domain, title) first reach Django through the content
  export and `manage.py load_content`. After import they are an authorable kind edited through
  versioned revisions in Django Admin; an import never silently overwrites an admin edit (ADR-047).
- An adventure specification lists objective codes; it never invents a code that the catalog
  does not hold. A missing objective is added through the content export first.
- Each objective used must say how evidence is recorded (challenge attempt, step result, quest
  objective) and which world consequence follows (CLAUDE.md section 4, pillar 2).
- Curriculum on `main` covers grades 1 and 2 plus one Grade 3 skill (`multiplication-facts`);
  anything beyond needs exported objectives before it can record progress.

## 3. Age-appropriateness and difficulty bands

| Age band | Ages | Interaction | Reading and response | AI style limits |
|---|---|---|---|---|
| Sprouts (`SPROUT`) | 3 to 4 | One-step decisions, voice-first, picture-first | Pictures and narration; taps; counting, classification, cause and effect | One or two short sentences; at most two choices |
| Pathfinders (`PATHFINDER`) | 5 to 6 | Two- or three-step quests | Narrated text with optional highlighting; early reading, number sense, sequencing | Two or three short sentences; one question; at most three choices |
| Explorers (`EXPLORER`) | 7 to 8 | Multi-stage missions | More reading and independent choices; arithmetic, comprehension, measurement | Up to four concise sentences; at most four choices |

Rules:

- Difficulty within a band comes from authored parameters (for example `ChallengeSpec` value
  range, response mode, choice count, validated per band by `validate_parameters`) and the
  Question Studio `difficulty` (`EASY`, `MEDIUM`, `HARD`), not from client choice.
- The server derives the band from the child profile; the client never sends it as trusted input.
- Content for a band must be playable by that band without reading help it cannot get
  (Sprouts never depend on reading).
- Copy is plain, readable aloud, localizable, free of em dashes, and within per-band length
  limits (enforced on publish by ADR-047 decision D).

## 4. AI Question Studio integration (ADR-046)

The Studio (`lai/apps/question_studio`) is **Implemented (main)**, staff-only in Django Admin; live
Bedrock acceptance (LAI-AQS-025) is an open APPROVAL gate.

```text
Generate (Question authors) -> GenerationBatch -> chunks of at most 5 -> ADR-044 ModelClient
  -> parse -> Question (DRAFT) -> deterministic validation -> findings
Review (Question reviewers): edit (revalidates), approve or reject
Publish (Question publishers, separate permission) -> immutable QuestionRevision (ACTIVE)
QuestionPool (region + chest) -> selection -> MathChallenge -> ChallengeAttempt -> grade_answer
```

| Rule | Detail |
|---|---|
| Staff roles | `manage.py ensure_studio_roles`: Question authors, Question reviewers, Question publishers, Pool managers. Django permissions, not `is_staff` alone |
| Background runs | Deployed environments use the canonical jobs path (ADR-064); `thread` and `inline` run modes are local only |
| Limits | `StudioLimits` quotas and the ADR-044 kill switch |
| Prompt safety | Staff free text is fenced as untrusted; output is parsed and validated, never trusted |
| Served today | Integer-answer `MULTIPLE_CHOICE` and `NUMERIC` with `ADD`, `SUBTRACT`, `MULTIPLY`, re-verified at serve time. `SHORT_ANSWER`, text and division are stored but not served |
| Objective required | A revision is served only when its skill is a catalog `LearningObjective` |
| Consumers | Treasure Rush chests only. Other adventures adopt the bank by pool, not by a new store (LAI-AQS-028 open) |

## 5. Validation

| Content | Validation | Where |
|---|---|---|
| Catalog content and `ChallengeSpec` revisions | JSON Schema of the kind, every reference, model `clean()`, copy rules (length per band, no em dashes, plain text, no URLs) on save and again on publish | `apps/catalog/authoring.py`; [`DJANGO_CONTENT_AUTHORING.md`](../platform/DJANGO_CONTENT_AUTHORING.md) |
| Studio questions | Schema, arithmetic re-computed, answer range, reading length, hint leaks, duplicates, ADR-044 safety patterns; blocking findings stop approval | `question_studio/validation.py` |
| Child-facing text safety | Shared `apps.ai.content_safety` patterns (URLs, personal information requests, learning-judgment claims) | `apps/ai/content_safety.py` |
| Exported content | `npm run content:check` when exported content changes | [`TESTING_STRATEGY.md`](../TESTING_STRATEGY.md) |

Quality checks are deterministic heuristics; a human approves. No AI judges another AI's output.

## 6. Staff review and publishing

1. Author or generate a draft. Drafts are never served.
2. Validate; fix every blocking finding.
3. A reviewer with the right permission approves (or rejects with a reason).
4. A publisher (separate permission) publishes, creating an immutable revision.
5. Every action is recorded in Django Admin history or the revision's own events.

Separation of duties is configured by groups; an adventure never adds a bypass, a React staff page
or a write API for content.

## 7. Versioning (ADR-047)

- Published revisions are never edited or deleted; rollback publishes an earlier body as a new
  `ROLLBACK` revision.
- A session keeps the rules it began with: gradable content is pinned at session start
  (`AdventureSession.pinned_revisions`, LAI-0813) and snapshotted on `ChallengeAttempt`, so a
  mid-adventure publish never regrades a child.
- Studio revisions keep their own lifecycle (`ACTIVE`, `SUPERSEDED`, `RETIRED`); a served attempt
  records `bank_revision_id`.

## 8. AI-generated question and hint safety

- Bedrock is used only to author drafts and, at runtime, to phrase companion and tutor turns or
  NPC hints through the ADR-044 pipeline (Guardrail mandatory, structured output, Django output
  policy, rate limits, server-written audit, authored fallback).
- AI-generated questions and other gradable content reach a child only after validation, staff
  review and publication (ADR-046, rule E5). Runtime phrasing never creates a question, and never
  changes a rule or an answer.
- No runtime model grades, scores, awards, or decides mastery. Tutor turns may not claim mastery,
  levels, grades or comparisons, and may not use vocabulary outside the skill's authored list.
- No child free text, profile id, nickname, exact age or history in model context; age band and
  authored content only ([`AI_AND_CHILD_SAFETY.md`](../AI_AND_CHILD_SAFETY.md)).
- Every AI request carries an adventure template id, age band, allowed topic, learning objective
  and maximum output length (CLAUDE.md section 7).

## 9. Educational progress

| Concern | Owner |
|---|---|
| Answer correctness | `grade_answer` (Django) |
| Evidence and mastery | `education.SkillEvidence`, `SkillProgress` (mastery engine) |
| Quest and world consequence | `quests.QuestProgress`, `progression.WorldChange` |
| Parent view | Activity summarized by skill, never raw transcripts; summaries come from verified session evidence. `ParentAdventureSummary` is the documented schema in [`PROMPT_AND_SCHEMA_GUIDE.md`](../PROMPT_AND_SCHEMA_GUIDE.md); the parent dashboard on `main` uses [`weeklySummary.ts`](../../react/src/features/parent-dashboard/weeklySummary.ts) and [`educatorReport.ts`](../../react/src/features/parent-dashboard/educatorReport.ts) |

A wrong answer never removes earned progress. Retrying is always possible and encouraged.

## 10. Replay variation

- Generated challenges vary by a server-chosen seed per attempt (`generate_challenge`); the seed
  is never stored on the spec and never chosen by the client.
- Bank questions are picked from a pool by the server; a pool that is empty or too small falls back
  to the authored `ChallengeSpec` generator.
- AI may vary phrasing of dialogue and hints, never the rule or the answer.
- Variation must stay within the band's limits and the same objective.

## 11. Authored fallbacks

| Failure | Fallback |
|---|---|
| No usable question pool | `ChallengeSpec` generator |
| AI disabled, limited, blocked or invalid | Authored hint ladder and persona fallback lines |
| Speech unavailable | Text and pictures |
| Content service unreachable | Calm, safe message from code; no progress lost; the child can retry |

## 12. Checklist for an adventure's educational content

- [ ] Objective codes listed and present in the catalog.
- [ ] Correctness rule implemented and tested in Django; engine and browser only display.
- [ ] Band variants defined for every supported age band.
- [ ] All content authored and published through Django Admin revisions or the Question Studio.
- [ ] AI-generated questions and gradable content validated, reviewed and published before any child sees it; runtime AI phrasing only through the ADR-044 pipeline with an authored fallback.
- [ ] Authored fallback for every AI and pool path; AI-off path tested.
- [ ] Session pinning respected; no regrading on publish.
- [ ] Progress written only through canonical models; parent summary by skill.
- [ ] No timers, countdowns or shaming feedback.
