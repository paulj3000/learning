# Canonical Content Model Design (Phase 36)

Covers `docs/android/android.md` Phase 3 ("Canonical Learning Content
Model"), scoped down per ADR-011 in `docs/DECISIONS.md`. **This is a design
document, not a migration.** No content moves out of TypeScript this phase,
and no new Amplify Data model is added to `amplify/data/resource.ts`. The
goal is to record a concrete target schema so a future migration (Phase 37
or later, once there is a real reason to pay the runtime and content-
authoring cost — see ADR-011) has something to build against, without
paying that cost today.

## 1. Why this is scoped to curriculum vocabulary, not "all content"

`docs/android/android.md` Phase 3 suggests a generic
`Subject -> Course -> Unit -> Lesson -> Activity -> Question` hierarchy and
lists `Subject, Course, Unit, Lesson, Activity, Question, AnswerOption,
LearningObjective, Skill` as suggested models. `docs/ROADMAP.md`'s Phase
36-38 split already carves this product's actual content into three
different later phases, and this document only covers the first:

| android.md concept | This product's equivalent | Owning phase |
|---|---|---|
| `Subject`/`Course`/`Unit`/`Lesson` | `Subject`/`Grade`/`Domain`/`Skill` (`src/features/curriculum/`), plus the flat `LearningObjective` list (`src/features/adventures/content/learningObjectives.ts`) | **Phase 36 (this document)** |
| `Activity`/`Question`/`AnswerOption` | `AdventureTemplate`/`AdventureStepDefinition` (`src/features/adventures/content/`) | Phase 37 ("adventures and quests as shared platform resources") |
| (not in android.md's generic list) | `StoryDefinition`, `Quest`, `ItemDefinition`, `DiscoveryDefinition`, NPC content, world/zone definitions | Phase 37 (quests) and Phase 38 ("world schema and asset catalog") |

`LearningObjective` and the curriculum `Skill` graph are the right starting
point for three reasons: they are the only two content types CLAUDE.md
section 9's "Required Domain Concepts" list names explicitly; every other
engine already references them only by an opaque `code`/`id` string
(`learningObjectiveCode` appears on `SkillEvidence`, `SkillProgress`,
`AdventureAction`'s step definitions, `QuestObjective`, tutor context, and
the parent dashboard's weekly summary) rather than by any richer object, so
promoting the thing behind that string to a real model changes nothing
about any caller's shape; and they are by far the smallest content area
(252 lines across `src/features/curriculum/content/`, 18 entries in
`learningObjectives.ts`) — the cheapest place to prove the pattern later.

## 2. Current state

Two parallel, partially-overlapping vocabularies exist today, both source-
controlled (`docs/DATA_MODEL.md`: "prefer content definitions checked into
source control for MVP"):

- **`LearningObjective`** (`src/features/adventures/content/learningObjectives.ts`)
  — flat, 18 entries, fields `code` / `domain` (one of six string literals:
  `literacy`, `numeracy`, `science`, `creativity`, `social-emotional`,
  `executive-function`) / `title`. This is the complete-coverage list:
  every `objectiveIds` value any adventure step or quest objective
  currently names exists here.
- **`Skill`** graph (`src/features/curriculum/types.ts`,
  `src/features/curriculum/content/`) — `Subject -> Grade -> Domain ->
  Skill`, added at Phase 19 to add structure (`prerequisiteSkillIds`,
  `difficulty`, `representations`, optional `standardsRefs`) on top of
  evidence already being recorded. `Skill.id` values are drawn from the
  same `code` vocabulary as `LearningObjective.code` — confirmed by
  cross-checking both content files: every current `Skill.id` (e.g.
  `counting-sets`, `observation`, `classification`, `cause-and-effect`,
  `animal-science`, `comparing-lengths`, `addition-within-ten`, `patterns`,
  `measurement`, `subtraction-within-ten`) already appears as a
  `LearningObjective.code`. The graph is a **partial, structured subset**:
  8 of `LearningObjective`'s 18 skills have no `Skill` graph entry yet
  (`following-instructions`, `creative-storytelling`,
  `reading-comprehension`, `sequencing`, `curious-questioning`,
  `science-comprehension`, `empathy`, `vocabulary`) — they exist only as
  the flat entry.

Neither is a database model; both are read purely in-process by
`src/features/curriculum/queries.ts` and by whatever adventure/quest/tutor
content imports `LEARNING_OBJECTIVES`.

## 3. Proposed canonical schema

The recommendation is to **stop maintaining two vocabularies** and let the
`Skill` graph absorb `LearningObjective` entirely: every skill gets the
graph's structural fields, but `prerequisiteSkillIds`, `difficulty`,
`representations`, and `standardsRefs` become optional so an
not-yet-fully-authored skill (today's flat-only entries) can exist with
just the fields `LearningObjective` already has. This avoids the two lists
silently drifting apart as more content is authored, which is the actual
risk of leaving both in place indefinitely — not a risk this design
document needs to fix today, but one worth resolving in the same migration
that would create these models, rather than migrating both lists as-is and
inheriting the duplication permanently.

Proposed models (illustrative Amplify Data shape, not yet added to
`amplify/data/resource.ts`):

```ts
Subject: a.model({
  slug: a.string().required(), // stable content id, e.g. 'mathematics' — NOT the row id
  title: a.string().required(),
}),

Grade: a.model({
  slug: a.string().required(),
  subjectSlug: a.string().required(),
  title: a.string().required(),
  ageBands: a.ref('AgeBand').array().required(),
}),

Domain: a.model({
  slug: a.string().required(),
  gradeSlug: a.string().required(),
  title: a.string().required(),
}),

Skill: a.model({
  slug: a.string().required(),        // today's LearningObjective.code / Skill.id
  domainSlug: a.string().required(),
  title: a.string().required(),
  description: a.string(),
  prerequisiteSkillSlugs: a.string().array(),
  difficulty: a.integer(),            // 1-5, optional until authored
  representations: a.string().array(), // CurriculumRepresentation values
  standardsRefs: a.string().array(),
  contentVersion: a.integer().required(), // Phase 39's per-content-type version number
}),
```

Design notes:

- **`slug`, not the Amplify-generated `id`, is the stable identifier.**
  Every existing reference (`learningObjectiveCode` on `SkillEvidence`/
  `SkillProgress`/adventure step `objectiveIds`/quest `LEARN` objectives)
  is a human-authored string like `'counting-sets'`, not a UUID. Those
  columns keep their current string type and meaning unchanged by this
  design; a migration would populate `Skill.slug` to match them exactly; a
  client resolves `learningObjectiveCode` to a `Skill` by querying on
  `slug`, not by treating the code as the row's own `id`.
- **`contentVersion` anticipates Phase 39** ("Manifest, Versioning, and
  Authorization"), so a client can request only what changed rather than
  the full curriculum on every launch — added to the design now so Phase
  39 does not have to retrofit it onto four models at once.
- **No `AnswerOption`/`Question` model is proposed.** Grading in this
  product is deterministic application code
  (`src/features/adventures/engine/validators.ts`'s `validateStepAnswer`,
  per CLAUDE.md section 7: "gameplay correctness must be evaluated by
  application code"), not a stored correct-answer row a client compares
  against locally — that shape belongs to Phase 37's `AdventureStepDefinition`
  design, together with the server-authoritative rework
  `docs/ROADMAP.md` Phase 37 already calls for, not to this one.
- **Authorization**: read-only, `allow.authenticated()` (or fully public —
  curriculum content carries no child-specific or otherwise private data,
  unlike every other model in this schema). Writes would belong to the
  still-nonexistent admin/content-designer workflow every prior phase's
  "Known risks" section already flags as missing (`docs/AUTHORIZATION_REVIEW.md`
  section 4.3, CLAUDE.md section 2) — not something this phase can build a
  real answer for, so a real migration should not attempt direct
  parent/child writes to these models at all.

## 4. What this document does not do

- It does not add these models to `amplify/data/resource.ts`.
- It does not change `src/features/curriculum/` or
  `src/features/adventures/content/learningObjectives.ts` — both remain the
  live source of truth today.
- It does not resolve how seed content gets from these TypeScript files
  into the models above (a one-time backfill script, most likely) — that
  belongs to whichever future phase actually performs the migration.
- It does not attempt Phase 37's `AdventureTemplate`/`AdventureStepDefinition`
  design or Phase 38's world/item/NPC design; those need their own
  documents when those phases are picked up.
