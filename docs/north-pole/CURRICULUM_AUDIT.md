# North Pole: curriculum audit of puzzle skills (SEA-04, FPV-D10)

Status: **audit done, content not changed yet.** Checked on `main` `1b0a50a3`, 2026-11-23, by
LAI 03 with LAI 06 (scoring and progression). The content change waits for LAI 06's per-variant
contract (below).

Realm: `north-pole`. Place and Area: `north-pole-village`. Quests: `np-q01-welcome` to
`np-q09-christmas-eve`. Bands: Sprout, Pathfinder and Explorer. Source:
`lai/apps/regions/north_pole_puzzles.json` (the `skill` field of each band). Variant ids are the
ids in that file.

## Findings

1. **9 skill ids are not learning objectives.** These are `sight-words`, `addition-two-digit`,
   `number-order`, `fractions`, `shapes-and-halves`, `shapes`, `symmetry`,
   `following-directions` and `earth-and-space`. This corrects the earlier count of 5 (SEA-04
   comment, 2026-11-23).
2. **Valid codes that do not match the intent.** These bands use a real objective whose meaning
   differs from what the prompts test:
   - `np-workshop-assemble` (`sequencing`; the prompts state the order to follow);
   - `np-forest-stripes` (`sequencing`; size, colour and number ordering);
   - `np-obs-stars` Pathfinder and `np-obs-sequence` Pathfinder and Explorer (`cause-and-effect`;
     sky knowledge and order);
   - `np-obs-constellation` Pathfinder (`observation`);
   - `np-obs-final` Explorer (`multiplication-facts`; mostly mixed multi-step operations).
3. **Content to change.** In `np-obs-final` Explorer only v1 fits its band. v2 to v5 mix
   operations (for example 4 x 6 - 5). Replace them with in-range multi-step subtraction (LAI 06
   agreed, 2026-11-23). This is the only puzzle where content changes, not just tags.
4. **Not graded** (no skill by design): `np-welcome-look` (OBSERVE_FEATURES), `np-stables-return`
   (RETURN_TO_NPC), `np-ginger-build` (PLACE_PLATFORMS) and `np-eve-sleigh-bell` (COLLECT_OBJECT).
5. **Math chests are already valid.** `np-workshop-gift-chest`, `np-mountain-lever-1` and
   `np-mountain-lever-2`, plus the two practice chests, use `counting-sets`, `addition-within-ten`
   and `subtraction-within-ten` (`north_pole_seed.py` `_WORKSHOP`, `_LEVER` and `_PRACTICE`).
   Chests already record evidence.
6. **Numeral recognition** (Sprout `np-lake-sums` v1, v3 and v5, "which floe says 3") had no
   objective. LAI 06 is adding `number-recognition` ("Recognizing written numbers"), so no
   inaccurate label is shown to parents.

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
| `earth-and-space` | science | The Sun, Moon and stars |
| `equal-sharing` | numeracy | Sharing equally into groups |
| `halves-and-fractions` | numeracy | Halves and simple fractions |
| `number-recognition` | numeracy | Recognizing written numbers |
| `shapes-and-geometry` | numeracy | Naming and describing shapes |
| `sight-words` | literacy | Reading common sight words |
| `subtraction-within-100` | numeracy | Subtraction within 100 |
| `symmetry` | numeracy | Finding symmetry |

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
| `np-q02-toy-workshop` | `np-workshop-count` "Count the toys" | Sprout | `counting-sets` | yes | Counting sets of objects | `counting-sets` | none | Counting sets of objects | confirmed by LAI 06 |
| `np-q02-toy-workshop` | `np-workshop-count` "Count the toys" | Pathfinder | `addition-within-ten` | yes | Addition within ten | `addition-within-ten` | none | Addition within ten | confirmed by LAI 06 |
| `np-q02-toy-workshop` | `np-workshop-count` "Count the toys" | Explorer | `multiplication-facts` | yes | Equal groups. | `multiplication-facts` | none | Multiplication facts | confirmed by LAI 06 |
| `np-q02-toy-workshop` | `np-workshop-sort` "Sort the presents" | Sprout | `classification` | yes for the band; some variants differ | v4 picks the big teddy (comparing size). | `classification` | v4: `measurement` | Sorting things by what they are; Measuring and comparing size | confirmed by LAI 06 |
| `np-q02-toy-workshop` | `np-workshop-sort` "Sort the presents" | Pathfinder | `classification` | yes | Sorting things by what they are | `classification` | none | Sorting things by what they are | confirmed by LAI 06 |
| `np-q02-toy-workshop` | `np-workshop-sort` "Sort the presents" | Explorer | `classification` | yes | Sorting things by what they are | `classification` | none | Sorting things by what they are | confirmed by LAI 06 |
| `np-q02-toy-workshop` | `np-workshop-pattern` "Fix the belt pattern" | Sprout | `patterns` | yes | Recognizing and continuing patterns | `patterns` | none | Recognizing and continuing patterns | confirmed by LAI 06 |
| `np-q02-toy-workshop` | `np-workshop-pattern` "Fix the belt pattern" | Pathfinder | `patterns` | yes | Recognizing and continuing patterns | `patterns` | none | Recognizing and continuing patterns | confirmed by LAI 06 |
| `np-q02-toy-workshop` | `np-workshop-pattern` "Fix the belt pattern" | Explorer | `patterns` | yes | Recognizing and continuing patterns | `patterns` | none | Recognizing and continuing patterns | confirmed by LAI 06 |
| `np-q02-toy-workshop` | `np-workshop-assemble` "Assemble a toy" | Sprout | `sequencing` | yes, intent differs | Valid code today (`sequencing`), but the intent does not match. Every prompt states the order to follow ("first the wheels, then..."). `sequencing` is "Sequencing story events". | `following-instructions` | none | Following ordered instructions | confirmed by LAI 06 |
| `np-q02-toy-workshop` | `np-workshop-assemble` "Assemble a toy" | Pathfinder | `sequencing` | yes, intent differs | As for SPROUT. | `following-instructions` | none | Following ordered instructions | confirmed by LAI 06 |
| `np-q02-toy-workshop` | `np-workshop-assemble` "Assemble a toy" | Explorer | `sequencing` | yes, intent differs | As for SPROUT. | `following-instructions` | none | Following ordered instructions | confirmed by LAI 06 |
| `np-q03-candy-cane-forest` | `np-forest-sequence` "Number trail" | Sprout | `counting-sets` | yes | Nearest; rote counting. Valid code today. Continuing 1, 2, 3 at ages 3 to 4 is rote counting; LAI 06's sequence rule (patterns) applies from Pathfinder up. | `counting-sets` | none | Counting sets of objects | confirmed by LAI 06 |
| `np-q03-candy-cane-forest` | `np-forest-sequence` "Number trail" | Pathfinder | `patterns` | yes | Recognizing and continuing patterns | `patterns` | none | Recognizing and continuing patterns | confirmed by LAI 06 |
| `np-q03-candy-cane-forest` | `np-forest-sequence` "Number trail" | Explorer | `patterns` | yes | Recognizing and continuing patterns | `patterns` | none | Recognizing and continuing patterns | confirmed by LAI 06 |
| `np-q03-candy-cane-forest` | `np-forest-signs` "Read the forest signs" | Sprout | `phonemic-awareness` | yes for the band; some variants differ | v5 asks what a picture sign shows. | `phonemic-awareness` | v5: `observation` | Hearing rhymes and the sounds in words; Careful observation of the natural world | confirmed by LAI 06 |
| `np-q03-candy-cane-forest` | `np-forest-signs` "Read the forest signs" | Pathfinder | `sight-words` | **no** | Reading common sight words | `sight-words` (new) | none | Reading common sight words | confirmed by LAI 06 |
| `np-q03-candy-cane-forest` | `np-forest-signs` "Read the forest signs" | Explorer | `reading-comprehension` | yes | Understanding what a story says | `reading-comprehension` | none | Understanding what a story says | confirmed by LAI 06 |
| `np-q03-candy-cane-forest` | `np-forest-stripes` "Candy stripe pattern" | Sprout | `sequencing` | yes, intent differs | Valid code today (`sequencing`), but the intent does not match. v1 and v4 give the colour order. v2 orders by size. v3 orders dot counts. | `following-instructions` | v2: `measurement`; v3: `comparing-and-ordering-numbers` | Following ordered instructions; Measuring and comparing size; Comparing and ordering numbers | confirmed by LAI 06 |
| `np-q03-candy-cane-forest` | `np-forest-stripes` "Candy stripe pattern" | Pathfinder | `sequencing` | yes, intent differs | v1 and v4 order by size. | `measurement` | v2: `following-instructions`; v3: `patterns`; v5: `comparing-and-ordering-numbers` | Measuring and comparing size; Following ordered instructions; Recognizing and continuing patterns; Comparing and ordering numbers | confirmed by LAI 06 |
| `np-q03-candy-cane-forest` | `np-forest-stripes` "Candy stripe pattern" | Explorer | `sequencing` | yes, intent differs | v1 and v2 order sticks by length. | `comparing-lengths` | v3: `comparing-and-ordering-numbers`; v4: `halves-and-fractions`; v5: `patterns` | Comparing and ordering lengths; Comparing and ordering numbers; Halves and simple fractions; Recognizing and continuing patterns | confirmed by LAI 06 |
| `np-q04-frozen-lake` | `np-lake-sums` "Hop the ice floes" | Sprout | `counting-sets` | yes, intent differs | v1, v3 and v5 ask which floe shows a numeral (new objective, LAI 06). v2 and v4 add one more. | `number-recognition` (new) | v2: `addition-within-ten`; v4: `addition-within-ten` | Recognizing written numbers; Addition within ten | confirmed by LAI 06 |
| `np-q04-frozen-lake` | `np-lake-sums` "Hop the ice floes" | Pathfinder | `addition-within-ten` | yes for the band; some variants differ | Addition within ten | `addition-within-ten` | v2: `subtraction-within-ten`; v4: `subtraction-within-ten`; v6: `subtraction-within-ten` | Addition within ten; Subtraction within ten | confirmed by LAI 06 |
| `np-q04-frozen-lake` | `np-lake-sums` "Hop the ice floes" | Explorer | `addition-two-digit` | **no** | Replaces invalid `addition-two-digit`. | `addition-within-100` (new) | v3: `subtraction-within-100`; v5: `subtraction-within-100`; v6: `subtraction-within-100` | Addition within 100; Subtraction within 100 | confirmed by LAI 06 |
| `np-q04-frozen-lake` | `np-lake-order` "Floes in number order" | Sprout | `number-order` | **no** | Replaces invalid `number-order`. | `comparing-and-ordering-numbers` (new) | none | Comparing and ordering numbers | confirmed by LAI 06 |
| `np-q04-frozen-lake` | `np-lake-order` "Floes in number order" | Pathfinder | `number-order` | **no** | Comparing and ordering numbers | `comparing-and-ordering-numbers` (new) | none | Comparing and ordering numbers | confirmed by LAI 06 |
| `np-q04-frozen-lake` | `np-lake-order` "Floes in number order" | Explorer | `number-order` | **no** | Comparing and ordering numbers | `comparing-and-ordering-numbers` (new) | none | Comparing and ordering numbers | confirmed by LAI 06 |
| `np-q04-frozen-lake` | `np-lake-shapes` "Shapes and parts on the lake" | Sprout | `shapes` | **no** | Replaces invalid `shapes`. | `shapes-and-geometry` (new) | none | Naming and describing shapes | confirmed by LAI 06 |
| `np-q04-frozen-lake` | `np-lake-shapes` "Shapes and parts on the lake" | Pathfinder | `shapes-and-halves` | **no** | Replaces invalid `shapes-and-halves`. | `shapes-and-geometry` (new) | v3: `halves-and-fractions`; v5: `halves-and-fractions` | Naming and describing shapes; Halves and simple fractions | confirmed by LAI 06 |
| `np-q04-frozen-lake` | `np-lake-shapes` "Shapes and parts on the lake" | Explorer | `fractions` | **no** | Replaces invalid `fractions`. | `halves-and-fractions` (new) | none | Halves and simple fractions | confirmed by LAI 06 |
| `np-q05-missing-reindeer` | `np-stables-facts` "Reindeer facts" | Sprout | `animal-science` | yes | Learning how animals live and behave | `animal-science` | none | Learning how animals live and behave | confirmed by LAI 06 |
| `np-q05-missing-reindeer` | `np-stables-facts` "Reindeer facts" | Pathfinder | `animal-science` | yes | Learning how animals live and behave | `animal-science` | none | Learning how animals live and behave | confirmed by LAI 06 |
| `np-q05-missing-reindeer` | `np-stables-facts` "Reindeer facts" | Explorer | `animal-science` | yes | Learning how animals live and behave | `animal-science` | none | Learning how animals live and behave | confirmed by LAI 06 |
| `np-q05-missing-reindeer` | `np-stables-tracks` "Follow the tracks" | Sprout | `observation` | yes | Careful observation of the natural world | `observation` | none | Careful observation of the natural world | confirmed by LAI 06 |
| `np-q05-missing-reindeer` | `np-stables-tracks` "Follow the tracks" | Pathfinder | `observation` | yes | Careful observation of the natural world | `observation` | none | Careful observation of the natural world | confirmed by LAI 06 |
| `np-q05-missing-reindeer` | `np-stables-tracks` "Follow the tracks" | Explorer | `measurement` | yes for the band; some variants differ | v3 and v4 are inferences from the prints, not measuring. | `measurement` | v3: `observation`; v4: `observation` | Measuring and comparing size; Careful observation of the natural world | confirmed by LAI 06 |
| `np-q05-missing-reindeer` | `np-stables-supplies` "Supplies for the reindeer" | Sprout | `animal-science` | yes | Learning how animals live and behave | `animal-science` | none | Learning how animals live and behave | confirmed by LAI 06 |
| `np-q05-missing-reindeer` | `np-stables-supplies` "Supplies for the reindeer" | Pathfinder | `animal-science` | yes for the band; some variants differ | v4: 2 bags a day for 2 days. | `animal-science` | v4: `addition-within-ten` | Learning how animals live and behave; Addition within ten | confirmed by LAI 06 |
| `np-q05-missing-reindeer` | `np-stables-supplies` "Supplies for the reindeer" | Explorer | `animal-science` | yes for the band; some variants differ | Learning how animals live and behave | `animal-science` | v2: `equal-sharing`; v3: `multiplication-facts` | Learning how animals live and behave; Sharing equally into groups; Multiplication facts | confirmed by LAI 06 |
| `np-q06-gingerbread-mystery` | `np-ginger-shapes` "Match the shapes" | Sprout | `shapes` | **no** | Replaces invalid `shapes`. | `shapes-and-geometry` (new) | none | Naming and describing shapes | confirmed by LAI 06 |
| `np-q06-gingerbread-mystery` | `np-ginger-shapes` "Match the shapes" | Pathfinder | `shapes` | **no** | Naming and describing shapes | `shapes-and-geometry` (new) | none | Naming and describing shapes | confirmed by LAI 06 |
| `np-q06-gingerbread-mystery` | `np-ginger-shapes` "Match the shapes" | Explorer | `shapes` | **no** | Naming and describing shapes | `shapes-and-geometry` (new) | none | Naming and describing shapes | confirmed by LAI 06 |
| `np-q06-gingerbread-mystery` | `np-ginger-symmetry` "Finish the window" | Sprout | `symmetry` | **no** | Finding symmetry | `symmetry` (new) | none | Finding symmetry | confirmed by LAI 06 |
| `np-q06-gingerbread-mystery` | `np-ginger-symmetry` "Finish the window" | Pathfinder | `symmetry` | **no** | Finding symmetry | `symmetry` (new) | none | Finding symmetry | confirmed by LAI 06 |
| `np-q06-gingerbread-mystery` | `np-ginger-symmetry` "Finish the window" | Explorer | `symmetry` | **no** | Finding symmetry | `symmetry` (new) | none | Finding symmetry | confirmed by LAI 06 |
| `np-q06-gingerbread-mystery` | `np-ginger-recipe` "Mrs. Claus's recipe" | Sprout | `following-directions` | **no** | Replaces invalid `following-directions`. Naming the tool or place. | `vocabulary` | none | Learning and using new words | confirmed by LAI 06 |
| `np-q06-gingerbread-mystery` | `np-ginger-recipe` "Mrs. Claus's recipe" | Pathfinder | `following-directions` | **no** | Replaces invalid `following-directions`. Recall from a read recipe; not `following-instructions`, despite the similar name. | `reading-comprehension` | none | Understanding what a story says | confirmed by LAI 06 |
| `np-q06-gingerbread-mystery` | `np-ginger-recipe` "Mrs. Claus's recipe" | Explorer | `reading-comprehension` | yes for the band; some variants differ | v4: 3 cups per batch, 2 batches. | `reading-comprehension` | v4: `multiplication-facts` | Understanding what a story says; Multiplication facts | confirmed by LAI 06 |
| `np-q06-gingerbread-mystery` | `np-ginger-measure` "Measure the gingerbread" | Sprout | `comparing-lengths` | yes | Comparing and ordering lengths | `comparing-lengths` | none | Comparing and ordering lengths | confirmed by LAI 06 |
| `np-q06-gingerbread-mystery` | `np-ginger-measure` "Measure the gingerbread" | Pathfinder | `comparing-lengths` | yes for the band; some variants differ | v4 asks for the best unit. v5 is 9 - 5 with no length comparison. | `comparing-lengths` | v4: `measurement`; v5: `subtraction-within-ten` | Comparing and ordering lengths; Measuring and comparing size; Subtraction within ten | confirmed by LAI 06 |
| `np-q06-gingerbread-mystery` | `np-ginger-measure` "Measure the gingerbread" | Explorer | `measurement` | yes | Measuring and comparing size | `measurement` | none | Measuring and comparing size | confirmed by LAI 06 |
| `np-q07-snowflake-mountain` | `np-mountain-weather` "Snow, ice and water" | Sprout | `observation` | yes for the band; some variants differ | v2: ice melting in the sun. | `observation` | v2: `cause-and-effect` | Careful observation of the natural world; Understanding cause and effect in nature | confirmed by LAI 06 |
| `np-q07-snowflake-mountain` | `np-mountain-weather` "Snow, ice and water" | Pathfinder | `cause-and-effect` | yes for the band; some variants differ | v4: which one is a solid. | `cause-and-effect` | v4: `classification` | Understanding cause and effect in nature; Sorting things by what they are | confirmed by LAI 06 |
| `np-q07-snowflake-mountain` | `np-mountain-weather` "Snow, ice and water" | Explorer | `cause-and-effect` | yes for the band; some variants differ | v3: the three states of water. | `cause-and-effect` | v2: `observation`; v3: `classification` | Understanding cause and effect in nature; Careful observation of the natural world; Sorting things by what they are | confirmed by LAI 06 |
| `np-q08-restore-the-star` | `np-obs-stars` "About stars" | Sprout | `observation` | yes | Careful observation of the natural world | `observation` | none | Careful observation of the natural world | confirmed by LAI 06 |
| `np-q08-restore-the-star` | `np-obs-stars` "About stars" | Pathfinder | `cause-and-effect` | yes, intent differs | Replaces `cause-and-effect`, which does not match the intent ("The Sun is a..."). | `earth-and-space` (new) | none | The Sun, Moon and stars | confirmed by LAI 06 |
| `np-q08-restore-the-star` | `np-obs-stars` "About stars" | Explorer | `earth-and-space` | **no** | The Sun, Moon and stars | `earth-and-space` (new) | none | The Sun, Moon and stars | confirmed by LAI 06 |
| `np-q08-restore-the-star` | `np-obs-constellation` "Find the constellation" | Sprout | `shapes` | **no** | Replaces invalid `shapes`. v1 and v2 join dots into a shape. | `shapes-and-geometry` (new) | v3: `earth-and-space`; v4: `earth-and-space` | Naming and describing shapes; The Sun, Moon and stars | confirmed by LAI 06 |
| `np-q08-restore-the-star` | `np-obs-constellation` "Find the constellation" | Pathfinder | `observation` | yes, intent differs | Valid code today (`observation`), but most variants are about the sky. | `earth-and-space` (new) | v1: `observation`; v2: `counting-sets`; v5: `counting-sets` | The Sun, Moon and stars; Careful observation of the natural world; Counting sets of objects | confirmed by LAI 06 |
| `np-q08-restore-the-star` | `np-obs-constellation` "Find the constellation" | Explorer | `earth-and-space` | **no** | The Sun, Moon and stars | `earth-and-space` (new) | none | The Sun, Moon and stars | confirmed by LAI 06 |
| `np-q08-restore-the-star` | `np-obs-sequence` "The night sky in order" | Sprout | `sequencing` | yes | Events of a day in order. | `sequencing` | none | Sequencing story events | confirmed by LAI 06 |
| `np-q08-restore-the-star` | `np-obs-sequence` "The night sky in order" | Pathfinder | `cause-and-effect` | yes, intent differs | Valid code today (`cause-and-effect`), but these order the sky changes; nothing causes anything. | `earth-and-space` (new) | none | The Sun, Moon and stars | confirmed by LAI 06 |
| `np-q08-restore-the-star` | `np-obs-sequence` "The night sky in order" | Explorer | `cause-and-effect` | yes, intent differs | As for PATHFINDER. | `earth-and-space` (new) | none | The Sun, Moon and stars | confirmed by LAI 06 |
| `np-q08-restore-the-star` | `np-obs-fragments` "Set the star fragments" | Sprout | `sequencing` | yes | Order of their own journey, as in fh-heart-crystals. | `sequencing` | none | Sequencing story events | confirmed by LAI 06 |
| `np-q08-restore-the-star` | `np-obs-fragments` "Set the star fragments" | Pathfinder | `sequencing` | yes | Sequencing story events | `sequencing` | none | Sequencing story events | confirmed by LAI 06 |
| `np-q08-restore-the-star` | `np-obs-fragments` "Set the star fragments" | Explorer | `sequencing` | yes | Sequencing story events | `sequencing` | none | Sequencing story events | confirmed by LAI 06 |
| `np-q08-restore-the-star` | `np-obs-final` "The final star challenge" | Sprout | `counting-sets` | yes | Counting sets of objects | `counting-sets` | none | Counting sets of objects | confirmed by LAI 06 |
| `np-q08-restore-the-star` | `np-obs-final` "The final star challenge" | Pathfinder | `subtraction-within-ten` | yes for the band; some variants differ | Subtraction within ten | `subtraction-within-ten` | v6: `addition-within-ten` | Subtraction within ten; Addition within ten | confirmed by LAI 06 |
| `np-q08-restore-the-star` | `np-obs-final` "The final star challenge" | Explorer | `multiplication-facts` | yes, intent differs | Replaces `multiplication-facts`. Only v1 is in range. v2 (4 x 6 - 5), v3 (3 + 2 x 2), v4 (20 / 4 - 3) and v5 (30 - 3 x 9) are mixed multi-step operations: replace them with in-range multi-step subtraction (confirmed by LAI 06, 2026-11-23). | `subtraction-within-ten` | v2: **rewrite**; v3: **rewrite**; v4: **rewrite**; v5: **rewrite** | Subtraction within ten | confirmed by LAI 06, content change needed |

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
