# Great Storybook integrity prep (audit, no code changed)

Branch feature/storykeeper-castle-completion, after 091d763c. Read-only audit.

## A. Previously completed Storybooks

Evidence
- `pages.ts` STORYBOOK_PAGES (l.~70 `page-painted-words`, `bands: ['PATHFINDER']`, `required: true`) and the mirror `lai/apps/regions/great_storybook_pages.json` raised the Pathfinder required set from 1 to 2.
- `great_storybook.progress()` computes `complete = restored_required == len(required)` (last lines), purely derived, so a finished child flips to `complete: false`. `summarize()` in `pages.ts` does the same.
- The quest is NOT affected: `quests/engine.py advance_quest` returns unchanged when `state.status == "COMPLETED"`, so QuestProgress stays COMPLETED, the `GREAT_STORYBOOK_RESTORED` WorldChange and `great-storybook-seal` stay. The inconsistency is only `quest.status == COMPLETED` next to `complete == false` in the API/HUD/scene.
- Active (unfinished) Pathfinder quests are fine: the new BUILD objective is simply required.

Minimal backward-compatible design (existing models only, no migration)
1. Add `since: 1 | 2` (book edition) to each page. Original pages `since: 1`; `page-painted-words` `since: 2`. Add `EDITION = 2`. Mirror in JSON; extend `pagesContract.test.ts`.
2. Milestones are WorldChanges at location `storykeeper-castle`: `GREAT_STORYBOOK_RESTORED` (edition 1, unchanged, already exists) and new `GREAT_STORYBOOK_RESTORED_V2`.
3. Derived state (pure, in `pages.ts` and `great_storybook.progress()`), new field `edition`:
   - `restoredEdition1` = `GREAT_STORYBOOK_RESTORED` present OR all `since<=1` required pages restored.
   - `complete` (all required pages, strict) stays as is; add `state`: `IN_PROGRESS` | `RESTORED_MORE_PAGES` (edition 1 done, `complete` false) | `RESTORED` (complete).
   - Existing clients reading `complete` still work; new UI reads `state`.
4. Follow-up quest `restore-the-great-storybook-pathfinders-more` (QuestDefinition in `islandQuests.ts`): prerequisite `QUEST_COMPLETED` for the original (server engine supports it) plus WORLD_CHANGE absence of V2; objectives: BUILD `STUDIO_PAGE_MENDED`; completion worldChanges `[GREAT_STORYBOOK_RESTORED_V2]`. No seal reward; optionally a new small item via a new reward rule. Seal and old rewards are never touched.
5. New Pathfinder players: the original quest's `completion.worldChanges` becomes `[RESTORED, RESTORED_V2]` (so no second quest is offered); they complete both in one go.
6. Sprout/Explorer: unchanged (`since:1` only).

Files and functions to change
- `react/src/features/great-storybook/pages.ts`: `StorybookPage.since`, `StorybookProgress.state/edition`, `summarize`, `storybookProgress`, `withRestored`.
- `react/src/features/great-storybook/scene.ts` `toSceneState` (add `moreFound`), `pageStates.ts` (no change expected).
- `lai/apps/regions/great_storybook_pages.json` (`since`, `edition`), `great_storybook.py` `progress()` (add `state`, `edition`, keep `complete`; return `moreQuest` status).
- `react/src/features/quests/content/islandQuests.ts`: `greatStorybookQuest` (completion changes), new follow-up quest, `GREAT_STORYBOOK_QUEST_IDS` extension; then re-run content export (`content/exported/quests.json`) and `load_content`.
- `lai/apps/game_sessions/castle_views.py` `StorybookView.get` (passes through; serializer shape only).
- 3D: `three/extensions/castleTale/castleTaleScene.ts` and the book prop (show sealed cover plus one new loose page when `RESTORED_MORE_PAGES`), `StorybookSection.tsx` (l.42-46 text: "The book is restored. A new page was found!" instead of "N of M missing pages", never "incomplete").
- Rewards: no change; optional new rule in `islandItems.ts` / reward seeds.

Tests
- `great_storybook` Django: child with COMPLETED quest + RESTORED + seal, no STUDIO_PAGE_MENDED -> `state == RESTORED_MORE_PAGES`, `complete False`, quest COMPLETED, seal still owned, WorldChange count unchanged (asking is read-only).
- Same child then records STUDIO_PAGE_MENDED -> `RESTORED`; follow-up quest completes once; replay is idempotent (no second seal, no duplicate V2).
- New Pathfinder: finishing both pages gives RESTORED and V2 in one completion; seal granted once.
- Sprout/Explorer unaffected; refresh does not re-open COMPLETED quest.
- Vitest: pages `state` table, `pagesContract.test.ts` (JSON vs TS incl. `since`), `quests.test.ts` (follow-up quest, no seal), `scene.test.ts`, `StorybookSection` text with no "missing" wording for edition-1 children.

## B. World-change key matching

Evidence
- `great_storybook._restored` and `pages.ts isPageRestored` match `changeKey` only. `source.locationSlug` is present in the data but never compared (`progression/services.py world_change_keys` returns `values_list("change_key")`, location dropped). Quest BUILD (`quests/engine.py` l.53-54) also matches key only.
- Uniqueness is `(child, location_slug, change_key)` (`WorldChange` constraint `world_change_once`), so the same key at two locations makes two rows and either one satisfies a page. No collision exists in current content: each of the 5 page keys is written only by its own adventure/story (grep: `STUDIO_PAGE_MENDED` only in thePaintedWords and the Studio interactions). It is by convention only; nothing enforces it.
- The server does NOT validate the producer. `progression/views.py WorldChangeListView.post` (l.~93-120) accepts any `locationSlug`, `changeType`, `changeKey` matching `CHANGE_KEY` regex with no allow-list. `sourceSessionId` is only checked to be the child's own session (any session, any template, any status) or a label matching `SOURCE_LABEL` (`quest|discovery|story|world|tide-trial:`). So a parent-authenticated client can POST `FIRST_STORY_TOLD` or `STUDIO_PAGE_MENDED` and restore a page without playing. Server-written paths (`play.py`, `quests/services.py`, `game_sessions/services.py _apply_world_change_step`, castle_rooms) are authoritative; only the generic POST is weak. The quest `PATCH` view also takes client stage lists (validated only for transition shape), the same class of gap.

Recommendation (backward compatible)
1. Page source match = (locationSlug, changeKey) with a legacy fallback: in `great_storybook.progress` and `isPageRestored`, accept a row whose location equals `source.locationSlug`; also accept a row with any location only if no row exists for that key anywhere with a different location (i.e. do not reject existing data). Concretely add `world_change_pairs(child)` in `progression/services.py` returning `(location, key)`; keep `world_change_keys` for other callers.
2. Producer check, additive: add `producer` (adventure template slug or story id) to each page source (TS and JSON). When a row has a `source_session_id` that parses to a session, require the session's template slug to equal the producer and status COMPLETED; rows with a label (`quest:`, `story:`) or empty source (legacy) remain accepted. New rows written by the server paths already set `source_session`.
3. Close the generic POST: a reserved-key registry (all page keys, `GREAT_STORYBOOK_RESTORED*`) rejects POST with 400 `reserved_change_key` unless source session is a COMPLETED session of the producing template. Existing rows are untouched.
4. Test that every `changeKey` in exported content is unique across (location, key) pairs and across producers (content test, fails on a second producer).

Tests: collision (same key at another location does not restore the page; legacy row with empty source still does); forged POST of a page key without a session -> 400; POST with another child's session -> 404; POST with the wrong template's completed session -> 400; duplicate completion (two concurrent writes, replay) -> one row, one reward, `created False`; content-uniqueness test above.

## C. Phaser zone `castle-painted-wall`

Evidence
- `storykeeperCastleZones.test.ts` l.15-27: every walk-in (APPROACH/ENTER) interaction in `STORYKEEPER_CASTLE_INTERACTIONS` must have `STORYKEEPER_CASTLE_ZONES[zoneId ?? id]`, and no orphan zones. The two Studio interactions in `worldObjects.ts` (l.~730-756) are `trigger: 'APPROACH'` with `zoneId: 'castle-painted-wall'`, so the zone test forced `PAINTED_WALL_TILE_RECT` (`storykeeperCastleTilemap.ts`, col 17 row 2, 2x2) and the entry in `storykeeperCastleZones.ts` (l.53-58). The 3D region has its own copy (`three/storykeeperCastleRegion.ts` l.853, `castle-painted-wall` x 8.7 to 9.5).
- Interactions are shared by the Phaser fallback and the 3D region (the tilemap comment says so), so the shared list cannot hold a walk-in interaction without a legacy zone.

Avoidable? Yes, without growing 2D: give these interactions `trigger: 'INTERACT'` or move them into the Three.js-only manifest (`three/runtime/manifests/storykeeperCastle.ts`) so they are not in the shared walk-in list; or add an explicit `threeOnly: true` flag that the test filters on (test change is small and documents intent; ADR-029 says new regions are 3D only). Cost: the 2D fallback route loses the Painted Words spot, which is acceptable because Sprouts/Explorers do not use it and Pathfinders reach it in 3D; confirm with the 2D fallback policy.

Blocker to removal: not removable by deleting the zone while the interaction stays shared. The zone and the `PAINTED_WALL_TILE_RECT` constant go away only when either (a) the interaction is made 3D-only (above) or (b) the Phaser castle scene (`scenes/StorykeeperCastleScene.ts`, `storykeeperCastleZones.ts`, tilemap) is deleted, which per ADR-020 / CLAUDE.md section 19 needs Three.js parity tests, visual validation, and the Sprouts gate LAI-2303 (`docs/DJANGO_MIGRATION_ROADMAP.md` l.786). Until then keep as a bug-fix-level shim; do not add more Phaser zones.
