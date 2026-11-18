# North Pole client review (NP-037, NP-044)

Scope: how the React/Three.js client presents the North Pole Area (`north-pole-village`) with
data alone and no North Pole code. Read-only review of the code, plus the client test
`react/src/features/region-play/northPoleRegion.test.ts` built on `react/src/test/northPoleFixtures.ts`
(real scene and puzzle snapshots from Django). No browser was run.

All paths are under `react/src/`.

## What works by data alone

| Need | Where it comes from |
| --- | --- |
| Current quest objective | `features/region-play/regionPlayUi.ts:235` `questObjective` picks the first ACTIVE quest and its current stage; `objectiveCue` (`:262`) prints "Stage title: 2 of 5". Wired to the HUD by `features/island-map/three/extensions/regionPlay/RegionPlayCompanion.tsx:172-182` and drawn at `features/island-map/three/WorldHud.tsx:101`. With no ACTIVE quest the cue is "Talk to X to start an adventure" (`regionPlayUi.ts:255-256`). |
| Backpack | `.../regionPlay/ui/BackpackPanel.tsx:34-46` lists served inventory; journal pages at `:47-49`; quest list with status at `:50-70`. |
| Checkpoint feedback | `features/island-map/three/runtime/ThreeLocationWorldView.tsx:366` (`CourseCheckpointReached`, "Safe spot: ...") and `:372-379` (zone checkpoint "found" toast and save). Copy in `features/island-map/three/platforms/platformCopy.ts:8-14`. Resume to the furthest open checkpoint: `.../regionPlay/areaEffectsScene.ts:132` (tested). |
| Zone narration | `ThreeLocationWorldView.tsx:380-383` `zoneEnterMessage`; the 10 zones travel in `scene.platforming.zones` (`region-play/regionManifest.ts:425-431`). |
| Exit control, no arithmetic gate | `WorldHud.tsx:115-119` draws the exit link; set for every Area because `regionManifest.ts:436` sets `interactionAssist`, label from `copy.altNavLabel` (`regionManifest.ts:84`, `:611`). Never gated. |
| Completion celebration | Finale panel for the last quest: `RegionPlayCompanion.tsx:607-614`; answer and quest cues `:321-329`, `:364-365`; star restore sound via `NORTH_POLE_MOMENT_SOUNDS`. |
| Several offered quests | `BackpackPanel.tsx:50-70` shows every quest; accepting is `RegionPlayCompanion.tsx:398-406`. |

## Gaps

1. **Collectible set progress ("Star fragments 3 of 7") is not shown anywhere for an Area.**
   `ItemView.setId` is served (`api/play/types.ts:209`, `api/play/parse.ts:140`) but nothing
   serves a set's name or size to an Area: `PlayerProgress` (`api/play/types.ts:375-382`) has
   no sets, the region `catalog` (`api/play/parse.ts:106`) lists assets only, and the set
   definitions live in the content export (`features/content-export/northPoleContent.ts:374`) or
   the client-only `features/rewards/sets.ts` (island content). A line like "3 of 7" needs the set
   total and display name, which is an API change, so it is documented, not built. Proposed
   contract: add `sets: [{setId, displayName, total}]` to the region bootstrap or progress payload,
   then a generic line in `BackpackPanel.tsx` after `:46` using the `computeSetProgress` wording
   ("3 of 7 found", never "4 missing"). Today the fragments are visible only as quest objectives
   ("Find the star piece ...") and the quest 8 stage count.
2. **The `/quests` journal screen never lists Area quests.** `routes/QuestJournal.tsx:12` and `:94`
   read the bundled `QUEST_DEFINITIONS` (`features/quests/content/index.ts:17-21`: island, Creature
   Care Cove, Clockwork Harbor), so North Pole (and Firepeak) quests appear only in the in-world
   backpack. Fix needs either server quest states on that route or bundling the content; documented.
3. **Backpack quests show title and status only, no objectives.** `BackpackPanel.tsx:56-66`. The
   served `QuestEntry.stages[].objectives` (`api/play/parse.ts:166-176`) is available, so a nested
   objective list is a small follow-up if the owner wants it. With nine sequential quests the HUD
   cue (first ACTIVE quest only, `regionPlayUi.ts:239`) is enough for play.
4. **No in-world jump tutorial prompt.** Only the static `copy.instructions` line is shown
   (`ThreeLocationWorldView.tsx:486`); the North Pole instruction text does not mention jumping.
   The Jump button appears only on touch devices (`WorldHud.tsx:99`, `:141-160`). Data-only fix:
   mention jumping in the seeded `copy.instructions` (Django). Documented.
5. **Pickups ignore `scene.effects.standIns`.** Golden bells and star fragments are drawn by
   `region-play/pickupLook.ts:37-44`, so they show as the neutral GEM, not as the authored
   `LANTERN` and `STAR` stand-ins (`regionManifest.ts:322-343`). Harmless for play; a published
   model replaces it. The test records the exemption.
6. **Seeded puzzle bodies carry no `intro` or `completeMessage`.** Django adds the characters'
   lines when it serves a puzzle (`lai/apps/regions/puzzles.py` docstring, LAI-0817), so the
   fixture mirrors that. If a puzzle had no dialogue node the client would reject observe, place,
   collect and return puzzles (`areaPuzzles.ts` `common` requires `intro`). Worth a Django test
   that every non-choice puzzle has a puzzle line (not checked here).

## NP-044: mobile and accessibility (code reading, no Area-specific code)

- **Touch Jump button**: `WorldHud.tsx:99` (`onJump` and a coarse pointer), pointer down on
  `:141-160`; wired when the engine reports jump enabled, `ThreeLocationWorldView.tsx:534`.
  `regionManifest.ts:437` turns jumping on for every region by default.
- **Touch movement**: drag joystick with walk, run and sprint radii, `pointerControls.ts:57-72`.
- **Sprint toggle**: child setting `ThreeLocationWorldView.tsx:231`, passed to the engine at
  `:505`, radio group at `:620`; engine side `runtime/createLocationEngine.ts:197`.
- **Reduced motion**: snowfall halves its particle count (`runtime/visual/atmosphere.ts:118-123`),
  ribbons and area effects check `reducedMotion || prefersReducedMotion()`
  (`regionPlay/areaEffectsScene.ts:149`, `:183`, `:287`), and moving platforms slow by
  `REDUCED_MOTION_FACTOR` (`platforms/platformSystem.ts:152`, `:432`).
- All buttons are real `button` or `Link` elements with labels (`WorldHud.tsx`). The Area is
  tablet-first through the same shared HUD.
