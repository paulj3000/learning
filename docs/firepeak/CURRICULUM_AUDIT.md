# Heart of Firepeak: curriculum audit of puzzle skills (FPV-24, FPV-D10)

Status: **audit done, content not changed yet.** Checked on `main` `1b0a50a3`, 2026-11-23, by
LAI 03 with LAI 06 (scoring and progression). The content change waits for LAI 06's per-variant
contract (below).

Realm: the home Island `learning-adventure-island` (ADR-073: Realm = Island). Place and Area:
`firepeak-heart`. Quest: `the-heart-of-firepeak` (one quest, seven zones). Bands: Pathfinder and
Explorer. Source: `lai/apps/regions/firepeak_heart_content.py`, the `skill` field of each band's
parameters. Variant ids (`v1`, ...) are the ids in that file.

## Findings

1. **10 of 11 skill ids are not learning objectives.** Only `patterns` is valid. The others are:
   `counting-and-groups`, `add-subtract-multiply`, `compare-order-halves`, `shapes-and-geometry`,
   `ordering-and-measurement`, `sequencing-cause-and-effect`, `circuits-and-sharing`,
   `rocks-and-volcanoes`, `earth-processes-sequence` and `reading-comprehension-sequence`. Once
   FPV-D10 records puzzle evidence, these would be skipped, so the parent dashboard would show
   almost nothing for Firepeak.
2. **One code per band does not fit.** Several bands mix skills across variants. For example,
   Explorer lava numbers has 34 + 25, 72 - 18 and 6 x 7, and Explorer forge circuit has circuits
   and 12 shared among 3. These need per-variant overrides.
3. **Not graded** (no skill by design): `fh-landing-map` (OBSERVE_FEATURES), `fh-heart-restore`
   (COLLECT_OBJECT) and `fh-heart-return` (RETURN_TO_NPC). Firepeak has no math chests.
4. **No content is missing.** All 14 puzzles, both bands and every variant exist, with symbols and
   explanations. Nothing needs to be split.

## Contract (LAI 06, 2026-11-23; proposal, not yet owner-approved)

- **Valid codes** are the `catalog.LearningObjective` rows. They come from
  `react/src/features/adventures/content/learningObjectives.ts`, which exports to
  `adventures.json` `learningObjectives`, which `load_content` loads. There are 20 today. Skill
  evidence, the parent dashboard labels and scoring's subject grouping all read these rows.
  `curriculum.json` `skills` is the AI tutor and director skill graph. It is not this list, and
  nothing is added to it here.
- **Per-variant override.** A puzzle band's `skill` stays as the band default. A variant may
  carry its own `skill`, and the server resolves the objective from the variant the child
  actually answered (`PuzzleAttempt.submission.variantId`). The variant keys are closed today, so
  the content change waits for LAI 06's contract commit (FPV-D10, branch
  `fix/FPV-D10-puzzle-skill-evidence`).
- **Who owns what.** LAI 06 authors the new objectives (code, domain, title). Domains stay inside
  the existing set; there is no new "geometry" domain. LAI 03 authors the puzzle content tags.
- **Recording rules** (LAI 06):
  - one evidence row per graded attempt that is not practice; a wrong answer is recorded as INCORRECT;
  - nothing for practice re-grades or for kinds with no skill;
  - an unknown code is skipped, never undoes the solve, and logs a code-only diagnostic;
  - objectives do not depend on the age band.
- **Rule used here:** map by what the prompts actually test, never because two identifiers look
  alike. Where a valid code does not match the intent, the row says so.
- **Status column.** Every row is "confirmed by LAI 06" (2026-11-23, after two review rounds).
  The mapping goes to the owner as LAI 06's reviewed table in the FPV-D10 PR. Nothing here is
  owner-approved.

## New objectives this adventure needs (authored by LAI 06)

LAI 06's full list is 12 new objectives. It also retitles `cause-and-effect` to "Understanding
cause and effect". Codes as LAI 06 sent them, 2026-11-23:

| Code | Domain | Parent-facing title |
|---|---|---|
| `addition-within-100` | numeracy | Addition within 100 |
| `comparing-and-ordering-numbers` | numeracy | Comparing and ordering numbers |
| `earth-science` | science | Rocks, volcanoes and how the land changes |
| `equal-sharing` | numeracy | Sharing equally into groups |
| `halves-and-fractions` | numeracy | Halves and simple fractions |
| `shapes-and-geometry` | numeracy | Naming and describing shapes |
| `simple-circuits` | science | How simple circuits work |
| `subtraction-within-100` | numeracy | Subtraction within 100 |

## Existing objectives (20, `main` `1b0a50a3`)

| Code | Domain | Title |
|---|---|---|
| `counting-sets` | numeracy | Counting sets of objects |
| `addition-within-ten` | numeracy | Addition within ten |
| `comparing-lengths` | numeracy | Comparing and ordering lengths |
| `following-instructions` | executive-function | Following ordered instructions |
| `creative-storytelling` | creativity | Creating story characters and settings |
| `reading-comprehension` | literacy | Understanding what a story says |
| `sequencing` | literacy | Sequencing story events |
| `curious-questioning` | science | Asking and exploring curious questions |
| `cause-and-effect` | science | Understanding cause and effect in nature |
| `observation` | science | Careful observation of the natural world |
| `science-comprehension` | science | Understanding a nature explanation |
| `patterns` | numeracy | Recognizing and continuing patterns |
| `animal-science` | science | Learning how animals live and behave |
| `measurement` | numeracy | Measuring and comparing size |
| `empathy` | social-emotional | Understanding another's feelings and perspective |
| `classification` | science | Sorting things by what they are |
| `subtraction-within-ten` | numeracy | Subtraction within ten |
| `vocabulary` | literacy | Learning and using new words |
| `multiplication-facts` | numeracy | Multiplication facts |
| `phonemic-awareness` | literacy | Hearing rhymes and the sounds in words |

## Per-puzzle table

Child-facing goal = the puzzle title the child sees. Parent-facing description = the objective
title or titles shown on the parent dashboard.

| Quest | Puzzle (child-facing goal) | Band | Current skill id | Matches an objective? | Intended skill | Proposed objective (band default) | Variant overrides | Parent-facing description | Status |
|---|---|---|---|---|---|---|---|---|---|
| `the-heart-of-firepeak` | `fh-emberwood-pattern` "Finish the crystal pattern" | Pathfinder | `patterns` | yes | Recognizing and continuing patterns | `patterns` | none | Recognizing and continuing patterns | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-emberwood-pattern` "Finish the crystal pattern" | Explorer | `patterns` | yes | Number sequences, including doubling and counting back. | `patterns` | none | Recognizing and continuing patterns | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-emberwood-count` "Count the embers" | Pathfinder | `counting-and-groups` | **no** | v1 and v2 compare two quantities. v3 counts on (continuing a sequence). v4 is 5 + 2. | `comparing-and-ordering-numbers` (new) | v3: `patterns`; v4: `addition-within-ten` | Comparing and ordering numbers; Recognizing and continuing patterns; Addition within ten | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-emberwood-count` "Count the embers" | Explorer | `counting-and-groups` | **no** | Equal groups (3 baskets of 4) are multiplication. Counting by 5s and 2s continues a sequence. | `multiplication-facts` | v1: `patterns`; v3: `patterns` | Multiplication facts; Recognizing and continuing patterns | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-lava-numbers` "Build the lava bridge" | Pathfinder | `add-subtract-multiply` | **no** | Addition within ten | `addition-within-ten` | v2: `subtraction-within-ten`; v4: `subtraction-within-ten` | Addition within ten; Subtraction within ten | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-lava-numbers` "Build the lava bridge" | Explorer | `add-subtract-multiply` | **no** | Addition within 100 | `addition-within-100` (new) | v2: `subtraction-within-100`; v3: `multiplication-facts`; v5: `multiplication-facts` | Addition within 100; Subtraction within 100; Multiplication facts | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-lava-compare` "Choose the right path" | Pathfinder | `compare-order-halves` | **no** | Comparing and ordering numbers | `comparing-and-ordering-numbers` (new) | none | Comparing and ordering numbers | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-lava-compare` "Choose the right path" | Explorer | `compare-order-halves` | **no** | Half of 20 and half of 18 are about parts of a whole. | `comparing-and-ordering-numbers` (new) | v3: `halves-and-fractions`; v4: `halves-and-fractions` | Comparing and ordering numbers; Halves and simple fractions | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-caverns-shapes` "Match the cave shapes" | Pathfinder | `shapes-and-geometry` | **no** | Naming and describing shapes | `shapes-and-geometry` (new) | none | Naming and describing shapes | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-caverns-shapes` "Match the cave shapes" | Explorer | `shapes-and-geometry` | **no** | v3 asks how many equal parts quarters make. | `shapes-and-geometry` (new) | v3: `halves-and-fractions` | Naming and describing shapes; Halves and simple fractions | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-caverns-arrange` "Arrange the cave crystals" | Pathfinder | `ordering-and-measurement` | **no** | v1 and v3 order crystals by size (existing `measurement`: measuring and comparing size). v2 and v4 order numbers. | `measurement` | v2: `comparing-and-ordering-numbers`; v4: `comparing-and-ordering-numbers` | Measuring and comparing size; Comparing and ordering numbers | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-caverns-arrange` "Arrange the cave crystals" | Explorer | `ordering-and-measurement` | **no** | v2 and v3 order fractions. v1 orders by number of sides. v4 orders numbers. | `halves-and-fractions` (new) | v1: `shapes-and-geometry`; v4: `comparing-and-ordering-numbers` | Halves and simple fractions; Naming and describing shapes; Comparing and ordering numbers | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-forge-switches` "Wake the forge machines" | Pathfinder | `sequencing-cause-and-effect` | **no** | The prompt states the order. | `following-instructions` | none | Following ordered instructions | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-forge-switches` "Wake the forge machines" | Explorer | `sequencing-cause-and-effect` | **no** | Reasoning from constraints: what must happen before what. LAI 06 will retitle `cause-and-effect` to drop "in nature" (owner table). | `cause-and-effect` | none | Understanding cause and effect in nature | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-forge-circuit` "Light the forge lamp" | Pathfinder | `circuits-and-sharing` | **no** | How simple circuits work | `simple-circuits` (new) | none | How simple circuits work | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-forge-circuit` "Light the forge lamp" | Explorer | `circuits-and-sharing` | **no** | How simple circuits work | `simple-circuits` (new) | v2: `equal-sharing`; v3: `equal-sharing`; v4: `equal-sharing` | How simple circuits work; Sharing equally into groups | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-summit-rocks` "Name the rocks" | Pathfinder | `rocks-and-volcanoes` | **no** | Rocks, volcanoes and how the land changes | `earth-science` (new) | none | Rocks, volcanoes and how the land changes | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-summit-rocks` "Name the rocks" | Explorer | `rocks-and-volcanoes` | **no** | Rocks, volcanoes and how the land changes | `earth-science` (new) | none | Rocks, volcanoes and how the land changes | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-summit-island` "Tell the story of the island" | Pathfinder | `earth-processes-sequence` | **no** | Ordering the steps of a process. The objective is the science; it is not story sequencing. | `earth-science` (new) | none | Rocks, volcanoes and how the land changes | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-summit-island` "Tell the story of the island" | Explorer | `earth-processes-sequence` | **no** | Rocks, volcanoes and how the land changes | `earth-science` (new) | none | Rocks, volcanoes and how the land changes | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-heart-crystals` "Set the elemental crystals" | Pathfinder | `reading-comprehension-sequence` | **no** | The child orders the events of their own journey. | `sequencing` | none | Sequencing story events | confirmed by LAI 06 |
| `the-heart-of-firepeak` | `fh-heart-crystals` "Set the elemental crystals" | Explorer | `reading-comprehension-sequence` | **no** | The answer depends on reading the clue (v2 has relative-order clues). | `reading-comprehension` | none | Understanding what a story says | confirmed by LAI 06 |

## Next steps

1. LAI 06 lands the per-variant contract commit. The variant key is an optional lowercase `skill`
   next to `id`, `prompt`, `options` or `items`, `answer` and `explanation`; the band default
   stays required.
2. LAI 03 updates the content tags on its adventure branch, based on that commit, with tests:
   - every band and variant `skill` is a `LearningObjective` code, checked with
     `manage.py puzzle_skill_report --strict` (LAI 06) after the import and the seeds;
   - no band mixes objectives without an override.
3. LAI 06's FPV-D10 PR carries the new objectives and the reviewed mapping table for the owner.
4. Backfilling earlier solves is an owner decision (FPV-D10).
