# SC-R07 preparation: artifacts, pedestals, Hall of Heroes, ranks

## 1. Reuse; migration needed: none
- Items and rules: `lai/apps/catalog/models.py` `ItemDefinition` (item_id, display_name, description, category, rarity, hidden, collectible_set) and `RewardRule` (rule_id, trigger JSON, items M2M, message). Authored in `react/src/features/rewards/content/islandItems.ts` (`ISLAND_ITEMS`, rules list), exported to `content/exported/rewards.json` (`items`, `rewardRules`, `collectibleSets`), loaded by `manage.py load_content`; admin edits via ADR-047 revisions (import never overwrites).
- Grants: `lai/apps/inventory/services.py` `grant_reward_rule` (idempotent through `GrantedRule`), `owned_item_ids`; read: `GET children/{id}/rewards/` (`ownedItemIds`, `grantedRuleIds`).
- Trigger types already in use: WORLD_CHANGE, DISCOVERY, QUEST_COMPLETED, ADVENTURE_COMPLETED. No new trigger type is needed.
- Pages: `great-storybook/pages.ts` mirrored by `lai/apps/regions/great_storybook_pages.json`; server `regions/great_storybook.progress(child)`, `GET .../castle/storybook/`. Pedestals: `island-map/three/castleTrophies.ts` (`TROPHY_SLOTS`, `trophyDisplay`), `runtime/manifests/castleRooms/trophyRoom.ts`. Gallery: `runtime/manifests/castleRooms/characterGallery.ts`.
- Already earned: `storykeepers-quill` (ADVENTURE_COMPLETED the-storykeepers-tale), `blank-page-storybook` (DISCOVERY castle-tapestry-stair), `great-storybook-seal` (QUEST_COMPLETED, all 3 great-storybook quests). Pedestals 1 and 2 are bound to the first two; 4 are open.
- Migration: none. Achievements are not a model (ADR-033: no second achievement model; `game_sessions/discovery.py` says so). "Canonical achievements" = ItemDefinition/InventoryItem. Optional later: hidden items only via `hidden=True`, still no schema change.

## 2. Artifacts (the pedestal count is six, so six slots)
Category KEEPSAKE (QUEST_ITEM kept for the two existing). All child-facing text readable aloud, no em dashes.

| Slot | item_id | Name | Rule (trigger) | Adventure / realm | Rarity |
|---|---|---|---|---|---|
| 1 | storykeepers-quill (exists) | Storykeeper's Quill | ADVENTURE_COMPLETED the-storykeepers-tale | Tale, Story Hall | UNCOMMON |
| 2 | blank-page-storybook (exists) | Book with a Blank Page | DISCOVERY castle-tapestry-stair | Tapestry nook, Entry Hall/stair | UNCOMMON |
| 3 | great-storybook-seal (exists) | The Great Storybook's Seal | QUEST_COMPLETED (3 quests) | Great Storybook, all bands | RARE |
| 4 | painted-words-brush | Painted Words Brush | ADVENTURE_COMPLETED the-painted-words | Illustration Studio, Pathfinder | UNCOMMON |
| 5 | three-clues-lens | Clue Finder's Lens | WORLD_CHANGE SECRET_DOOR_CLUES_COLLECTED | Great Library, Explorer | UNCOMMON |
| 6 | secret-door-key | Silver Keeper's Key | WORLD_CHANGE THE_CASTLES_SECRET_DOOR_COMPLETE | Secret Chamber, Explorer | RARE |

Rule ids: `reward-painted-words-brush`, `reward-three-clues-lens`, `reward-secret-door-key`. Bands without a given artifact see slot 4/5/6 as `waiting` (names only, never shamed). Confirm the exact changeKey strings in the great_storybook_pages.json before authoring (page-what-was-waiting uses THE_CASTLES_SECRET_DOOR_COMPLETE per roadmap 4.1). Set `collectibleSets` `castle-keepsakes` (6 items), completion item none. Update `BOUND_ITEMS` in castleTrophies.ts, add `treasure()` meshes keyed by item id, keep golden `tests/golden/director-content.json` and content export in step.

## 3. Reusable pedestal (Three.js)
Path: `react/src/features/island-map/three/artifactPedestal.ts` (engine-adjacent, no React/Django).
```ts
type PedestalState = 'empty' | 'loading' | 'occupied' | 'failed';
interface ArtifactPedestalOptions { id; position; itemId?: string; modelRef?: AssetRef; targetHeight?: number /*0.3*/; reducedMotion: boolean }
createArtifactPedestal(opts): { group; setState(next); dispose() }
```
- State machine: `empty` (gold plate, no item bound or item not owned) -> `loading` (owned, asset resolving; plate plus soft placeholder) -> `occupied` (model shown); `loading -> failed` on asset error or timeout; `failed` shows the existing primitive `box` treasure fallback (never blank, never an error to the child); `occupied/failed -> empty` only if inventory shrinks (parent clears backpack). Transitions are a pure `nextPedestalState(state, event)`.
- Scale normalization: compute bounding box, uniform scale so max(width, depth) fits 0.36 and height `targetHeight`, centre on plate, base on y = plate top; apply once at load.
- Reduced motion: no spin, no float, no sparkle; static pose. Otherwise a slow spin (<= 0.2 rad/s) and gentle bob under 0.03. Dispose geometry/materials on room exit. Accessible text stays in `trophyDisplay` and CastleGuide.
- Display state still derives from `ITEM_OWNED`/`ITEM_ABSENT`; the pedestal grants nothing.

## 4. Hall of Heroes (derived, read-only)
Prefer client composition (no endpoint): `rewards` + `castle/storybook/` + `world-changes/` + `stories/`. A Django endpoint is only justified for one round trip:
`GET /api/children/{child_id}/castle/hall-of-heroes/` (ChildScopedAPIView, GET only, 404 for another parent's child, no writes, no chat text):
```json
{ "band":"PATHFINDER", "rank":{"id":"page-keeper","title":"Page Keeper"},
  "stories":[{"slug":"the-storykeepers-tale","title":"...","completed":true}],
  "pages":[{"id":"page-first-story","title":"...","restored":true}],
  "artifacts":[{"itemId":"storykeepers-quill","name":"...","description":"..."}],
  "accomplishments":[{"changeKey":"FIRST_STORY_TOLD","text":"..."}] }
```
Builds from `great_storybook.progress`, `owned_item_ids`, StoryProgress completions, WorldChange keys. Plates hang in the gallery; list text is the accessible equivalent. Seasonal (SEA-07): no SEA docs exist in the repo, so assume only that a seasonal reward is an ordinary permanent ItemDefinition plus RewardRule that never expires; the pedestal and hall read from item catalog, so they need no change, and a season never removes items (permanence).

## 5. Rank titles (pure, content-configurable)
Discrepancy: roadmap 4.4 lists five titles (Story Explorer, Page Finder, Tale Keeper, Story Guardian, Master Storykeeper); the task lists four. Spec uses four, config-driven.
```ts
rankFor(restoredRequired: number, requiredTotal: number, ranks = RANKS): RankTitle | null
RANKS = [{id:'story-explorer',min:0},{id:'page-keeper',min:0.34},{id:'castle-pathfinder',min:0.67},{id:'master-storykeeper',min:1}]
```
Fraction = restoredRequired / requiredTotal for the child's band (bonus page excluded). Highest title whose `min` <= fraction; total 0 returns the first title; sort and validate ranks (ascending, first min 0, last 1) at load; unknown input returns null. Thresholds and names live in content (`rewards.json`-style config, an owner-optional flag disables the feature). Never stored, never time-based, never compared between children; the same inputs always give the same title.

## 6. Tests
- Python: rules import idempotently (`load_content` twice, no edit overwritten); `grant_reward_rule` once per rule; Hall endpoint scoping (other parent 404, read-only 405 for POST), band-correct pages, no extra queries growth; no migration (`makemigrations --check`).
- Vitest: `trophyDisplay` for six items (owned/waiting/open); manifest requirements per slot; `ISLAND_ITEMS` and rewards.json parity; `nextPedestalState` transitions; scale normalization on fixture bounds; reduced motion produces no animation; `rankFor` boundaries (0, 0.34, 0.67, 1, zero total, config invalid); Hall composition with empty inventory; castle contract tests (`castleRoomsContract`, budgets, golden director-content).
- Playwright/WebGL deferred to merge: pedestal visible after earning.
