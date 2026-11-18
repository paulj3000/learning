# Firepeak and Storykeeper's Castle: integration contract (FPV-22)

Status: **Firepeak's side defined, castle registration pending** (2026-11-18). The Storykeeper
completion branch (`feature/storykeeper-castle-completion`) is under active development and is not
imported or modified here.

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

## What the castle must change (Storykeeper branch, not done here)

1. `great_storybook_pages.json` and `react/src/features/great-storybook/pages.ts`: add the page
   (kept in sync by their drift test).
2. `react/src/features/great-storybook/adventureMapping.ts` `producersOf`: accept a quest producer;
   today it only knows step Adventures and Stories and would report the page as a broken reference.
3. `castleTrophies.ts` `trophyDisplay`: look items up in the served catalog, not the source
   `ISLAND_ITEMS`; Firepeak keepsakes are export-only and would render as open pedestals.
4. Bind one of the four open pedestals (reserved for SC-R07) to `fh-badge-heart-of-firepeak`.

## Order of work

Merge Firepeak first (the page source must exist), then the castle change. Until then Firepeak is
fully playable and its keepsakes show in the backpack and the parent summary; only the castle
page and pedestal are missing.
