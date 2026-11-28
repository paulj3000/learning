# Area puzzle skill identifiers to learning objectives (FPV-D10)

- **Status:** proposal for owner review. Agreed by LAI 06 (scoring and progression) and LAI 03
  (Firepeak and North Pole), 2026-11-23. Not owner-approved.
- **Ticket:** FPV-D10 (<https://trello.com/c/P1S0CXpL>).
- **Variant-level detail:** LAI 03's per-puzzle audits, each row with its reason:
  - [docs/firepeak/CURRICULUM_AUDIT.md](../firepeak/CURRICULUM_AUDIT.md) at `5019f142` on
    `feature/firepeak-volcano-adventure` (22 band rows);
  - [docs/north-pole/CURRICULUM_AUDIT.md](../north-pole/CURRICULUM_AUDIT.md) at `320adb0a` on
    `feature/north-pole-adventure` (69 band rows).

## Why this exists

An Area puzzle of kind CHOOSE_ANSWER or ORDER_SEQUENCE names the skill it practises in each age
band's `skill` parameter. Until FPV-D10 nothing read it, so the identifiers were never checked
against the curriculum: 10 of the 11 Heart of Firepeak identifiers and 9 of the North Pole ones
are not `catalog.LearningObjective` codes. FPV-D10 records skill evidence from those puzzles,
and evidence can only name a catalog objective. An unknown code is skipped (the solve and its
reward are kept) and listed by `manage.py puzzle_skill_report`.

### Issue #102 additions

Three more quiz kinds name a band `skill` the same way: `NAVIGATE_ROUTE`, `SORT_ITEMS` and
`SHARE_ITEMS`. `PLACE_PLATFORMS` and `VALVE_SEQUENCE` may now name an optional `skill` when the
grader checks a concept (a stone matching its gap, steam reaching the vent). Without one they
stay accomplishments and record no evidence. `puzzle_skill_report` checks all of them and skips
a movement puzzle that names none. The rules below apply unchanged. See
[../scoring/INTERACTIVE_LEARNING.md](../scoring/INTERACTIVE_LEARNING.md).

## Rules used

1. Map by what the prompts actually test, not by a similar name. Some valid codes were wrong for
   their puzzle (for example `following-directions` on a recipe that tests recall from text), and
   they are re-tagged too.
2. Map to an existing objective only when its parent-facing title is accurate for the task.
   Otherwise add an objective. Do not add one where an existing one is accurate.
3. A band that mixes skills across its variants keeps a band default `skill` and gives the
   other variants their own `skill` (the per-variant override FPV-D10 adds). The server records
   the objective of the variant the child actually answered.
4. Domains stay in the existing set (literacy, numeracy, science, creativity, social-emotional,
   executive-function). Scoring groups subject mastery by domain, so a new domain would change
   it.
5. Objectives are band-agnostic: the band changes only the parameters.
6. Objectives are added to `react/src/features/adventures/content/learningObjectives.ts` only. They
   are not added to `curriculum.json` `skills`: that is the AI tutor and director skill graph,
   and adding a skill there would let the director select it, which is outside FPV-D10.

## New objectives (12)

| Code | Domain | Parent-facing title | Needed for | Reason it is new |
|---|---|---|---|---|
| `number-recognition` | numeracy | Recognizing written numbers | np-lake-sums (Sprout) | "Which floe says 3" tests reading a numeral. "Counting sets of objects" would be an inaccurate label |
| `comparing-and-ordering-numbers` | numeracy | Comparing and ordering numbers | fh-emberwood-count, fh-lava-compare, fh-caverns-arrange, np-lake-order, np-forest-stripes | Only `comparing-lengths` exists, which is about length, not number |
| `addition-within-100` | numeracy | Addition within 100 | fh-lava-numbers (Explorer), np-lake-sums (Explorer) | Two-digit sums such as 34 + 25. Split by operation like the existing within-ten pair |
| `subtraction-within-100` | numeracy | Subtraction within 100 | fh-lava-numbers (Explorer), np-lake-sums (Explorer) | 72 - 18. Same split |
| `equal-sharing` | numeracy | Sharing equally into groups | fh-forge-circuit (Explorer), np-stables-supplies (Explorer) | "12 shared among 3" is early division. `multiplication-facts` is the inverse and is not accurate |
| `halves-and-fractions` | numeracy | Halves and simple fractions | fh-lava-compare, fh-caverns-shapes, fh-caverns-arrange, np-lake-shapes, np-forest-stripes | Parts of a whole. No existing objective covers it |
| `shapes-and-geometry` | numeracy | Naming and describing shapes | fh-caverns-shapes, fh-caverns-arrange, np-lake-shapes, np-ginger-shapes, np-obs-constellation | Keeps Firepeak's identifier. No shape objective exists |
| `symmetry` | numeracy | Finding symmetry | np-ginger-symmetry | A distinct early geometry skill, kept separate from naming shapes |
| `sight-words` | literacy | Reading common sight words | np-forest-signs (Pathfinder) | Reading GO, LEFT, STOP on signs. It is neither `phonemic-awareness` nor `reading-comprehension` |
| `simple-circuits` | science | How simple circuits work | fh-forge-circuit | No physical-science objective exists |
| `earth-science` | science | Rocks, volcanoes and how the land changes | fh-summit-rocks, fh-summit-island | One objective for rock types and land-forming processes. For ages 3 to 8, separate "materials" and "processes" objectives add labels without adding meaning |
| `earth-and-space` | science | The Sun, Moon and stars | np-obs-stars, np-obs-constellation, np-obs-sequence | Sky knowledge. `observation` and `cause-and-effect` were near misses |

**Changed existing title (1):** `cause-and-effect`, "Understanding cause and effect in nature",
becomes "Understanding cause and effect". The forge machines (fh-forge-switches, Explorer) are
cause and effect, but they are not in nature. The broader title stays accurate for the existing
Wonderwild uses. The code is unchanged, so existing evidence and progress keep their meaning.

**Considered and not added:**
- `skip-counting`: equal groups map to `multiplication-facts` and continuing a sequence maps to
  `patterns`.
- `early-word-reading`: this is `sight-words`.
- Separate `earth-materials` and `earth-processes`: these are `earth-science`.
- A `geometry` domain: rule 4.

## Source identifier to objective

One row per identifier the shipped content uses today (main `1b0a50a3`). "Per variant" means
the band default is the first objective listed and the variants that test something else carry
an override (LAI 03's tables list each one).

| Source identifier | Where | Canonical objective(s) | Parent-facing label(s) | Reason |
|---|---|---|---|---|
| `counting-and-groups` | fh-emberwood-count | Pathfinder: `comparing-and-ordering-numbers`, per variant `patterns`, `addition-within-ten`. Explorer: `multiplication-facts`, per variant `patterns` | Comparing and ordering numbers; Recognizing and continuing patterns; Addition within ten; Multiplication facts | Compare two quantities; count on; 5 + 2; 3 baskets of 4; count by 5s and 2s |
| `add-subtract-multiply` | fh-lava-numbers | Pathfinder: `addition-within-ten`, per variant `subtraction-within-ten`. Explorer: `addition-within-100`, per variant `subtraction-within-100`, `multiplication-facts` | Addition within ten; Subtraction within ten; Addition within 100; Subtraction within 100; Multiplication facts | One identifier covered three operations |
| `compare-order-halves` | fh-lava-compare | `comparing-and-ordering-numbers`, Explorer per variant `halves-and-fractions` | Comparing and ordering numbers; Halves and simple fractions | Half of 20 is a part of a whole, not a comparison |
| `shapes-and-geometry` | fh-caverns-shapes | `shapes-and-geometry` (new), Explorer per variant `halves-and-fractions` | Naming and describing shapes; Halves and simple fractions | "How many quarters make a whole" |
| `ordering-and-measurement` | fh-caverns-arrange | Pathfinder: `measurement`, per variant `comparing-and-ordering-numbers`. Explorer: `halves-and-fractions`, per variant `shapes-and-geometry`, `comparing-and-ordering-numbers` | Measuring and comparing size; Comparing and ordering numbers; Halves and simple fractions; Naming and describing shapes | Order by size, by number, by fraction, by number of sides |
| `sequencing-cause-and-effect` | fh-forge-switches | Pathfinder: `following-instructions`. Explorer: `cause-and-effect` | Following ordered instructions; Understanding cause and effect | Pathfinder prompts state the order. Explorer reasons about what must happen first |
| `circuits-and-sharing` | fh-forge-circuit | `simple-circuits` (new), Explorer per variant `equal-sharing` | How simple circuits work; Sharing equally into groups | Closed circuits; 12 shared among 3 |
| `rocks-and-volcanoes` | fh-summit-rocks | `earth-science` (new) | Rocks, volcanoes and how the land changes | Rock types |
| `earth-processes-sequence` | fh-summit-island | `earth-science` (new) | Rocks, volcanoes and how the land changes | The objective is the science, not story sequencing |
| `reading-comprehension-sequence` | fh-heart-crystals | Pathfinder: `sequencing`. Explorer: `reading-comprehension` | Sequencing story events; Understanding what a story says | Pathfinder orders their own journey. Explorer must read the clue |
| `patterns` | fh-emberwood-pattern, np-workshop-pattern, np-forest-sequence | `patterns`, except np-forest-sequence Sprout: `counting-sets` | Recognizing and continuing patterns; Counting sets of objects | Valid. For ages 3 to 4, "1, 2, 3, _" is rote counting (nearest objective) |
| `number-order` | np-lake-order | `comparing-and-ordering-numbers` (new) | Comparing and ordering numbers | Not a catalog code |
| `addition-two-digit` | np-lake-sums (Explorer) | `addition-within-100` (new), per variant `subtraction-within-100` | Addition within 100; Subtraction within 100 | Not a catalog code; mixed operations |
| `counting-sets` | np-workshop-count, np-lake-sums, np-obs-final (Sprout) | `counting-sets`, except np-lake-sums Sprout: `number-recognition` (new), per variant `addition-within-ten` | Counting sets of objects; Recognizing written numbers; Addition within ten | Valid code, but np-lake-sums Sprout asks which floe says N |
| `addition-within-ten`, `subtraction-within-ten` | np-workshop-count, np-lake-sums, np-obs-final | Unchanged, with per-variant operation overrides | Addition within ten; Subtraction within ten | Valid; variants mix the two operations |
| `multiplication-facts` | np-workshop-count (Explorer), np-obs-final (Explorer) | np-workshop-count: unchanged. np-obs-final Explorer: `subtraction-within-ten`, and its mixed-operation variants are rewritten | Multiplication facts; Subtraction within ten | np-obs-final prompts are multi-step subtraction ("7 found, 3 set, 2 set") |
| `shapes` | np-lake-shapes, np-ginger-shapes, np-obs-constellation (Sprout) | `shapes-and-geometry` (new); np-obs-constellation Sprout per variant `earth-and-space` | Naming and describing shapes; The Sun, Moon and stars | Not a catalog code |
| `shapes-and-halves` | np-lake-shapes (Pathfinder) | `shapes-and-geometry`, per variant `halves-and-fractions` | Naming and describing shapes; Halves and simple fractions | Not a catalog code; two skills |
| `fractions` | np-lake-shapes (Explorer) | `halves-and-fractions` (new) | Halves and simple fractions | Not a catalog code |
| `symmetry` | np-ginger-symmetry | `symmetry` (new) | Finding symmetry | Not a catalog code until FPV-D10 |
| `sight-words` | np-forest-signs (Pathfinder) | `sight-words` (new) | Reading common sight words | Not a catalog code until FPV-D10 |
| `phonemic-awareness`, `reading-comprehension` | np-forest-signs, np-ginger-recipe (Explorer) | Unchanged; np-forest-signs Sprout per variant `observation` | Hearing rhymes and the sounds in words; Understanding what a story says; Careful observation of the natural world | Valid; one Sprout variant reads a picture sign |
| `following-directions` | np-ginger-recipe (Sprout, Pathfinder) | Sprout: `vocabulary`. Pathfinder: `reading-comprehension` | Learning and using new words; Understanding what a story says | Not a catalog code. The prompts name tools (Sprout) or recall the text ("How long do they bake?") |
| `sequencing` | np-workshop-assemble, np-forest-stripes, np-obs-sequence (Sprout), np-obs-fragments | np-workshop-assemble: `following-instructions`. np-forest-stripes: per band and variant `following-instructions`, `measurement`, `comparing-lengths`, `comparing-and-ordering-numbers`, `patterns`, `halves-and-fractions`. Others unchanged | Following ordered instructions; Measuring and comparing size; and the others named | Valid code, wrong intent where the prompt states the order or the order is by size or number |
| `classification` | np-workshop-sort | Unchanged, Sprout per variant `measurement` | Sorting things by what they are; Measuring and comparing size | Valid; one variant sorts by size |
| `animal-science` | np-stables-facts, np-stables-supplies | Unchanged; np-stables-supplies per variant `addition-within-ten`, `equal-sharing`, `multiplication-facts` | Learning how animals live and behave; plus the arithmetic labels | Valid; some supply variants are arithmetic |
| `observation` | np-stables-tracks, np-mountain-weather (Sprout), np-obs-stars (Sprout), np-obs-constellation (Pathfinder) | Unchanged, except np-obs-constellation Pathfinder: `earth-and-space`, per variant `observation`, `counting-sets`. np-mountain-weather Sprout per variant `cause-and-effect` | Careful observation of the natural world; The Sun, Moon and stars; Counting sets of objects | Mostly sky knowledge, two variants count stars |
| `measurement`, `comparing-lengths` | np-stables-tracks (Explorer), np-ginger-measure | Unchanged, with per-variant `observation`, `measurement`, `subtraction-within-ten` | Measuring and comparing size; Comparing and ordering lengths | Valid; a few variants are observation or arithmetic |
| `cause-and-effect` | np-mountain-weather, np-obs-stars (Pathfinder), np-obs-sequence (Pathfinder, Explorer) | np-mountain-weather: unchanged, per variant `observation`, `classification`. np-obs-stars and np-obs-sequence: `earth-and-space` | Understanding cause and effect; The Sun, Moon and stars | "The Sun is a..." and the order of sky changes are space knowledge, not cause and effect |
| `earth-and-space` | np-obs-stars, np-obs-constellation (Explorer) | `earth-and-space` (new) | The Sun, Moon and stars | Not a catalog code until FPV-D10 |

## Puzzles with no skill (by design)

The mechanical kinds record no skill evidence: OBSERVE_FEATURES, PLACE_PLATFORMS,
VALVE_SEQUENCE, COLLECT_OBJECT and RETURN_TO_NPC. On main these are 3 Heart of Firepeak puzzles,
5 Firepeak Volcano puzzles and 4 North Pole puzzles. They still give world changes, rewards and
scoring sources as before.

## Order of changes

1. FPV-D10 (LAI 06): the 12 objectives, the retitle, the per-variant `skill` contract and the
   evidence service.
2. LAI 03, on branches based on FPV-D10: re-tag both adventures to these codes and rewrite
   np-obs-final Explorer. Their gate is `manage.py puzzle_skill_report --strict` after the
   content import and the seeds.

Either order is safe for play: until both are in, a puzzle with an unmapped code simply records
no evidence.
