# MVP playability: owner browser QA (2026-11-26 playtest follow-up)

For the owner's browser playthrough of `main`. It covers GitHub #98 to #103 (Trello #254 to
#259), whose PRs #104 to #111 are all merged. The integration candidate
`integration/20261126-mvp-playability` that first carried them is retired (2026-11-28).
Every box starts unticked. Only the owner ticks a box, and no box is ticked from unit tests.

Record the `main` commit SHA, browser, device and viewport for each run.

## Setup (local, fresh database)

1. Follow `README.md` steps 1 to 10. Step 7 must seed **and** publish every Realm:
   `load_content`, then each pair: `seed_treasure_rush`/`publish_treasure_rush`,
   `seed_firepeak`/`publish_firepeak`, `seed_firepeak_heart`/`publish_firepeak_heart` and
   `seed_north_pole`/`publish_north_pole`.
2. Create three children from the parent dashboard: one Sprout, one Pathfinder and one Explorer.
3. For an existing database, run `make migrate` and then rerun step 7. Seeds never overwrite
   staff edits, so check that the 3D Areas are PUBLISHED in Django Admin.
4. Optional, for Treasure Rush's palms, bushes, logs, barrels and campfire:
   `import_treasure_rush_environment` and `import_treasure_rush_palm_trees`. Both need the source
   asset packs (`--source`); see `docs/ASSET_LIBRARY.md` and
   `docs/TREASURE_RUSH_PLAYTEST_CHECKLIST.md`. Without them those pieces are drawn as stand-ins.
   That is expected and is not a defect for this pass.

## A. Realms page (#103, PR #104)

| # | Check | Pathfinder | Sprout | Phone |
|---|---|---|---|---|
| A-1 | The child navigation's Realms link opens a page whose heading reads **Explore the Realms** | [ ] | [ ] | [ ] |
| A-2 | The product name stays in the branding and the page title, not as the page heading | [ ] | [ ] | [ ] |
| A-3 | Treasure Rush, Storykeeper's Castle, Firepeak Volcano, Heart of Firepeak and North Pole each appear **once** as an illustrated card (Sprouts get no Firepeak, by design) | [ ] | [ ] | [ ] |
| A-4 | No two cards share a title | [ ] | [ ] | [ ] |
| A-5 | A locked Realm (Creature Care Cove) shows its lock and hint, and has no button | [ ] | [ ] | [ ] |
| A-6 | Subject and age filters change the cards without reloading the page | [ ] | | [ ] |
| A-7 | Two columns on desktop, one column on a phone, and no sideways scrolling at 320 px | [ ] | | [ ] |
| A-8 | No card or button leads to an error page | [ ] | [ ] | [ ] |

## B. North Pole (#98)

| # | Check | Sprout | Pathfinder | Explorer |
|---|---|---|---|---|
| B-1 | Realms → North Pole → Start Exploring opens the North Pole 3D Area, not "could not find" | [ ] | [ ] | [ ] |
| B-2 | Arrival at North Pole Village; the first activity can be started | [ ] | [ ] | [ ] |
| B-3 | Exit returns to Realms (or the Realm preview); the copy says realm, not island | [ ] | [ ] | [ ] |
| B-4 | Re-entering offers Continue and keeps the progress | [ ] | [ ] | [ ] |

## C. Storykeeper's Castle (#99)

| # | Check | Sprout | Pathfinder | Explorer |
|---|---|---|---|---|
| C-1 | Realms → Storykeeper's Castle → Enter the castle opens the 3D castle hub | [ ] | [ ] | [ ] |
| C-2 | An available Storybook adventure can be entered from the hub | [ ] | [ ] | [ ] |
| C-3 | Sprouts: the card adventure is offered first, and the 3D castle is a plainly worded second option | [ ] | n/a | n/a |
| C-4 | Exit and re-entry work, and progress is kept | [ ] | [ ] | [ ] |
| C-5 | Note the exact failure, if any, with a screenshot (the original failure was never captured) | [ ] | [ ] | [ ] |

## D. Heart of Firepeak (#100)

| # | Check | Pathfinder | Explorer |
|---|---|---|---|
| D-1 | Realms shows a Heart of Firepeak card (and Firepeak Volcano, with its own title) | [ ] | [ ] |
| D-2 | The card opens the 3D Area at Explorer's Landing | [ ] | [ ] |
| D-3 | An available activity can be started and solved | [ ] | [ ] |
| D-4 | Exit and re-entry work, and progress is kept | [ ] | [ ] |
| D-5 | A Sprout sees no Firepeak card and cannot reach it by URL | [ ] | [ ] |

## E. Treasure Rush (#101, #102)

| # | Check | Desktop | Phone landscape | Phone portrait |
|---|---|---|---|---|
| E-1 | In full screen the game fills the viewport, with no half-height panel | [ ] | [ ] | [ ] |
| E-2 | Camera and sprint sit behind a **Settings** button, and the list of things to do behind a **Things to do** button. Both start closed, open a panel and close with **Close** | [ ] | [ ] | [ ] |
| E-3 | Exit and touch controls work in full screen | [ ] | [ ] | [ ] |
| E-4 | The adventure has at least three different puzzle types, not repeated coin-count chests | [ ] | | |
| E-5 | Hints help, a wrong answer is never shamed, and replay rewards nothing twice | [ ] | | |
| E-6 | Existing progress from before the change is kept | [ ] | | |

For the full-screen pass across devices (tablet, keyboard only, reduced motion, iPhone Safari,
phone 375 x 667 portrait and 667 x 375 landscape), follow the 14 steps in
`docs/engineering/game-engine/gameplay-ui-contract.md` section 7, in every Realm, not only
Treasure Rush.

## Sign-off

| Item | Result |
|---|---|
| `main` SHA | |
| Browser and devices | |
| Open defects (issue numbers) | |
| Owner acceptance | Not given until the owner writes it here |
