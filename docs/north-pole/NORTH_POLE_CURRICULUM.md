# North Pole curriculum map (NP-005, NP-024, NP-043)

Source of truth for the content: `lai/apps/regions/north_pole_puzzles.py` (pure data, checked by
`lai/apps/regions/tests/test_north_pole_puzzles.py`). Contract: `NORTH_POLE_DESIGN.md` section 5.
Skill slugs that exist in `content/exported/curriculum.json` are used as they are
(`counting-sets`, `addition-within-ten`, `subtraction-within-ten`, `multiplication-facts`,
`patterns`, `measurement`, `comparing-lengths`, `classification`, `observation`,
`cause-and-effect`, `animal-science`). A slug not in that file (for example `sight-words`,
`fractions`, `symmetry`, `earth-and-space`) is a descriptive label on the puzzle only; it is not
a curriculum skill row and is not yet tracked in `SkillProgress`.

## Difficulty by age band

| Band | Options | Content |
|---|---|---|
| SPROUT (3 to 4) | 2 to 3, each with a `symbol` | picture-first, one step, counting to 5, colours, shapes, big/small, simple facts, 3-item orders; first hint after 1 attempt |
| PATHFINDER (5 to 6) | 3 | add and subtract within 10, AB/ABC patterns, counting by 1s and 2s, simple sight-word signs, basic facts, 4-item orders; first hint after 2 attempts |
| EXPLORER (7 to 8) | 4 (3 on `np-lake-sums`, whose options are the three floes) | two-digit add and subtract, groups (multiplication), sharing (division), halves and quarters, cm and m, reading 2 to 3 sentence signs and recipes, science reasoning, 5 to 6 item orders |

The band comes from the child profile; the client picks one variant per session. Every band has
3 to 7 variants and 2 hints. Wrong choices are never scored as failures; the explanation says why
the right answer works.

## Puzzles

Presentation / subject in brackets. Each cell starts with the band's `skill`, a catalog learning
objective (re-tagged for FPV-D10, 2026-11-23). Variants that practise another objective carry
their own `skill`; `CURRICULUM_AUDIT.md` lists each one with its reason.

| Puzzle | Sprout | Pathfinder | Explorer |
|---|---|---|---|
| `np-welcome-look` OBSERVE (3/4/5 landmarks) | observation: tree, snowman, lantern | observation: adds gifts | observation: all five landmarks (adds cottage) |
| `np-workshop-count` [CARDS, MATH] | counting-sets: "Tinker lined up 4 toy drums. How many?" | addition-within-ten: "4 trains and 3 robots, how many in all?" | multiplication-facts: "4 boxes with 3 toys each" |
| `np-workshop-sort` [SHAPES, LOGIC] | classification: round, square, colour, big/small | classification: odd one out | classification: material, two rules (red AND square) |
| `np-workshop-pattern` [CARDS, LOGIC] | patterns: AB with colours | patterns: AB, ABC, AAB, growing | patterns: AAB, ABB, ABCD, growth |
| `np-workshop-assemble` ORDER [SWITCHES, LOGIC] | following-instructions: 3 steps told in the prompt | following-instructions: 4 steps by reasoning | following-instructions: read a 4 to 5 step instruction |
| `np-forest-sequence` [PATHS, MATH] | counting-sets: next number to 5 | patterns: counting by 1s and 2s, back by 2 | patterns: by 5s, 10s, 3s, 4s, back by 10 |
| `np-forest-signs` [PATHS, LITERACY] | phonemic-awareness: first sounds, rhyme | sight-words: GO LEFT, STOP, UP | reading-comprehension: 3-sentence signs |
| `np-forest-stripes` ORDER [PATH, LOGIC] | following-instructions: colour, size, dots (3) | measurement: size, rainbow, count by 2 (4) | comparing-lengths: cm lengths, by 10s, fractions, doubling (4 to 5) |
| `np-lake-sums` [PLATFORMS, MATH] | number-recognition: numeral 1 to 5, 1+1 | addition-within-ten: 4+3, 9-4 | addition-within-100: 38+15, 64-28 |
| `np-lake-order` ORDER [PATH, MATH] | comparing-and-ordering-numbers: 3 floes, 1 to 5 | comparing-and-ordering-numbers: 4 floes, to 20 | comparing-and-ordering-numbers: two and three digit |
| `np-lake-shapes` [SHAPES, MATH] | shapes-and-geometry: circle, triangle, square | shapes-and-geometry: sides, corners, half, quarter | halves-and-fractions: half and quarter of a number |
| `np-stables-facts` [CARDS, LIFE_SCIENCE] | animal-science: antlers, 4 legs, hooves | animal-science: fur, antlers on both, herd | animal-science: wide hooves, antlers shed yearly, trapped air |
| `np-stables-tracks` [PATHS, LOGIC] | observation: print size, direction | observation: where prints lead, running vs walking | measurement: steps times cm, speeding up |
| `np-stables-supplies` [SAMPLES, LIFE_SCIENCE] | animal-science: grass, moss, water | animal-science: lichen, plant eaters | animal-science: lichen, division and groups, herbivores |
| `np-ginger-shapes` [SHAPES, MATH] | shapes-and-geometry: circle, triangle, square, star, heart | shapes-and-geometry: sides, corners, hexagon | shapes-and-geometry: pentagon, sphere, cube |
| `np-ginger-symmetry` [SHAPES, MATH] | symmetry: copy the left side | symmetry: mirror twin, fold | symmetry: lines of symmetry (square 4, rectangle 2, heart 1) |
| `np-ginger-recipe` [CARDS, LITERACY] | vocabulary: tools | reading-comprehension: 3-line recipe | reading-comprehension: card with quantities |
| `np-ginger-measure` [SAMPLES, MATH] | comparing-lengths: longer, shorter | comparing-lengths: units of paper clips | measurement: cm and m, how much taller |
| `np-ginger-build` PLACE_PLATFORMS | beam sizes with outlines | same, with outlines | same, beams labelled in cm, no outlines |
| `np-mountain-weather` [CARDS, EARTH_SCIENCE] | observation: cold, melt, snow | cause-and-effect: melt, freeze, snow from clouds | cause-and-effect: 0 degrees C, solid/liquid/gas, six-armed snowflakes |
| `np-obs-stars` [CARDS, EARTH_SCIENCE] | observation: stars at night | earth-and-space: the Sun is a star | earth-and-space: stars hidden by sunlight, Polaris stays near the same place |
| `np-obs-constellation` [SHAPES, EARTH_SCIENCE] | shapes-and-geometry: join dots | earth-and-space: Big Dipper, 7 stars | earth-and-space: pointer stars to Polaris, Ursa Major |
| `np-obs-sequence` ORDER [STORY, EARTH_SCIENCE] | sequencing: day to night (3) | earth-and-space: sunset to many stars (4) | earth-and-space: evening, night and dawn (4 to 5) |
| `np-obs-fragments` ORDER [CRYSTALS, LOGIC] | sequencing: workshop, forest, lake | sequencing: six fragments in journey order | sequencing: forward and reversed journey |
| `np-obs-final` [CARDS, MATH] | counting-sets: count to 5 | subtraction-within-ten: "7 found, 3 set, how many more?" | subtraction-within-ten: two-step take-away word problems within ten |
| `np-stables-return`, `np-eve-sleigh-bell` | no questions | no questions | no questions |

## Entity binding decisions

Entity ids come from the layout (`north_pole_layout.PUZZLE_ENTITIES` and `PUZZLE_ENTITY_MAPS`),
which is authoritative; `north_pole_puzzles.ENTITY_IDS` is that same object and a test checks every
reference.

- `np-welcome-look`: features are `np-landmark-*` ids; Sprouts observe tree, snowman and lantern,
  Pathfinders add gifts, Explorers observe all five (a subset of the entity ids is valid).
- `np-lake-order`: option keys `a b c d` map to `np-lake-order-floe-a..d` (Sprouts use `a b c`).
  Each variant paints its own numbers on the floes; the answer is the floes sorted by number.
- `np-obs-fragments`: order items are capped at 6, so the village fragment is the centre piece
  Jingle sets first and the map has the six keys workshop, forest, lake, stables, gingerbread,
  mountain. Sprouts order workshop, forest and lake only. All 7 sockets stay in the puzzle's
  entity ids (the authoring cross-check only requires mapped entities to be among them); the
  client lights the unordered sockets when the puzzle is solved.
- `np-lake-sums`: options `a b c` map to `np-lake-floe-a|b|c` in every band (Explorers get 3
  options here).
- `np-ginger-build`: stones `np-ginger-stone-1..3`, slots `np-ginger-slot-1..3`.
- Other choice and order puzzles bind one board entity from the layout and no per-option entity.

## Chest challenge specs (contract section 5)

`ChallengeSpec` slugs `np-<chest>-<band>`: SPROUT `counting-sets` 1..5 CHOICE 3; PATHFINDER
`addition-within-ten` 1..10 CHOICE 4; EXPLORER `subtraction-within-ten` 2..10 CHOICE 4. The lever
chests `np-mountain-lever-1` and `np-mountain-lever-2` use EXPLORER `addition-within-ten`.
Chests: `np-workshop-gift-chest`, `np-mountain-lever-1`, `np-mountain-lever-2`; REPLAY chests
`np-replay-workshop-sums`, `np-replay-lake-count`.

## Question Studio

- Each math chest gets a disabled-by-default `QuestionPool` scoped to `region_id
  north-pole-village` and `entity_id <chest>`. A published Question Studio set wins when staff
  enable it (ADR-046); the `ChallengeSpec` is the fallback. No live Bedrock call is needed.
- Choice and order puzzles are authored variants checked by the shared validators. A
  CHOOSE_ANSWER puzzle naming a Question Studio pool is a documented extension point (as in
  Firepeak section 11) and is not built here.
- Administrators can edit these bodies as versioned revisions (ADR-047); seeding never
  overwrites an edited puzzle.
