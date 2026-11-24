# Firepeak and Storykeeper's Castle: integration contract (FPV-22)

Status: **Firepeak's side done; castle registration not done and needs owner decisions**
(reconciled with `main` `aa8adb33` on 2026-11-23). Both Firepeak and the Storykeeper completion
work are now on `main`. Firepeak's contract (`storybookContract.ts`) and its test still pass. The
castle registers no Firepeak page or pedestal. Firepeak is fully playable without them.

## What Firepeak provides

`react/src/features/region-play/firepeak/storybookContract.ts` exports the data below as typed
constants (unit-tested against the content export), so the castle can register it without
re-deriving ids:

| Contract | Value |
|---|---|
| Storybook page id | `firepeak-heart` |
| Page title | "The Heart of Firepeak" |
| Bands | PATHFINDER, EXPLORER |
| Required | false (Firepeak is optional; adding a required page would change every band's completion) |
| Source | `{"kind": "WORLD_CHANGE", "changeKey": "FIREPEAK_HEART_COMPLETE", "locationSlug": "firepeak-heart"}` |
| Producer | quest `the-heart-of-firepeak` (completion world change) |
| Hint | "Help the Heart of Firepeak glow again." |
| Restored text | "The explorer carried four crystals up the mountain, and the Heart of Firepeak glowed again." |
| Discovery (launch) | Place `firepeak-heart`, Area route `/island/<childId>/explore/firepeak-heart` |
| Progress | quest stage index from the quest API; zone checkpoints from world changes |
| Trophies | `fh-badge-heart-of-firepeak` (primary), `fh-badge-volcano-scientist`, `fh-badge-crystal-collector`, `fh-badge-master-explorer` |
| Observatory | optional flavour line: "Far away, Firepeak glows warm and calm." when `FIREPEAK_HEART_COMPLETE` |

## Reconciliation with the merged castle (main `aa8adb33`)

| Contract step (2026-11-18) | State on main | Still needed |
|---|---|---|
| 1. Add the page to `great_storybook_pages.json` and `pages.ts` | Not done. The book is edition 2 with six pages (five required, the tapestry page optional). | Yes, if the owner wants the page. Adding an optional page is a content-edition change in the castle (drift test, `edition`). |
| 2. `producersOf` accepts a quest producer | Not done. It still joins step Adventures and Stories only (`adventureMapping.ts`). A Firepeak page today would be reported as a broken reference. | Yes, with step 1. |
| 3. `trophyDisplay` reads the served catalog | Not done. It still reads the source `ISLAND_ITEMS`. | Yes, if a Firepeak keepsake is shown. |
| 4. Bind one of the four open pedestals (SC-R07) | **Superseded.** SC-R07-02 bound all six pedestals to the six castle keepsakes (`CASTLE_KEEPSAKE_IDS`). No pedestal is free. The trophy code still supports an open seventh. | Owner decision: add a seventh pedestal for `fh-badge-heart-of-firepeak`, or show Firepeak only in the backpack. |

## Owner decisions

1. Whether Firepeak gets a Great Storybook page at all (it would be optional and not change any
   band's completion).
2. If yes, whether a seventh Trophy Room pedestal is added for the Heart of Firepeak badge.

Either way the work belongs to the castle owner (the Storykeeper session), as a separate ticket
after FPV-24. It is not needed for Firepeak owner QA or release: the keepsakes already show in
the backpack, and the observatory line stays optional.
