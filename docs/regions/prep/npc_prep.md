# SC-R05 NPC prep (Quill reconcile, Ember visits, Professor Orion)

Read-only prep. SC-R05-03 (a new character) is marked APPROVAL in the roadmap: owner approves Orion before code. Phase paths are under `react/src/features/` unless absolute.

## 1. What exists

**Keeper Quill (done, LAI-NPC-039).**
- Client catalog: `npc/content/islandNpcs.ts` L104-185 (`keeper-quill`, interaction `talk-to-keeper-quill`, nodes `quill-storybook-restored`, `quill-returning-author`, `quill-the-damaged-book`, `quill-greeting`; offers `tell-a-story-together` + 3 `restore-the-great-storybook-<band>`).
- Manifest: `island-map/three/runtime/manifests/storykeeperCastle.ts` L636-651 (`assetId 'npc-quill'`, spot `KEEPER_QUILL_SPOT` (-4.5, 0), `QUILL_FACING_ENTRY_YAW`), collider L271 (half 0.45, height 2).
- Django: `lai/apps/npcs/quill_content.py` (placement `castle-quill`, STATIONARY `facePlayer`, reactions, `REQUIRED_BEHAVIOURS`) and `management/commands/seed_npc_quill.py` (create-only, `--publish`).
- Handover: `extensions/castleTale/useCastleNpcs.tsx`, `castleNpcHandover.ts`, `castleNpcProgress.tsx` (`recordLegacyMeeting`, `acceptLegacyQuest`). The model is `assets/manifest.ts` L302 `npc-quill`, clips Idle/Talk/Wave/Point/Celebrate/ReactConcerned.
- Gaps for SC-R05-01: the `npc-quill.gltf` is a stand-in (asset swap only, same id and clip names). Check the client node `quill-the-damaged-book` and Django `quill_content` nodes stay word-for-word in step (`test_contract_mirror.py`). The Django seed has no SC-R04 premise or restored node.

**Ember.** Single identity `ember-dragon` (islandNpcs.ts L266-340; nodes `ember-forge-thanks`, `ember-runes-all-found`, `ember-runes-hint`, `ember-greeting`, followUp `ember-forge-story`). The interaction is `meet-ember-dragon` (`island-map/worldObjects.ts` L836). Sanctuary manifest `manifests/dragonsSanctuary.ts` L306-322 places her with `assetId 'npc-pip'` (ADR-028 stand-in), spot (0,-16) (`EMBER_ID`, `dragonsSanctuaryRegion.ts` L365). The home-island pack lists `ember-dragon` (`worlds/packs/homeIsland.ts` L87). **Missing:** no castle placement, no castle dialogue, no Django `NpcCharacter` for Ember, no castle `TALK_TO` interaction. `ISLAND_NPCS.ember-dragon.schedule` is sanctuary-only (all three times).

**Orion.** Does not exist anywhere in code; only prose (`docs/regions/storykeeper_castle.md` L409, `docs/ASSET_SOURCING.md` L257 "KayKit Adventurers"). Roadmap row L103 and SC-R05-03.

## 2. Orion edits

Room `setting-tower` floor x 5..10, z 5..10 (`storykeeperCastleRegion.ts` L131-133); arch gap x 4.75..5.25, z 6.5..8.5. Occupied: zones `castle-setting-tower` (5.4-6.2, 6.6-8.4), `tower-window-island` (6.3-8.2, 8.4-9.6), `-mountain` (8.4-9.6, 6.4-8.2), `-cave` (6.3-8.2, 5.4-6.6), `observatory-telescope` (5.4-6.2, 6.08-6.55), `observatory-chart` (5.4-6.2, 8.6-9.6) at L846-849, L875-876; telescope (5.9, 5.8) half 0.25; chart on x=5.29, z 9-9.65; orrery (9.05, 9.05) half 0.4 (`castleRooms/settingTower.ts`).

**Spot: the south-east corner, x 9.1, z 5.9, collider half 0.4 (x 8.7-9.5, z 5.5-6.3).** It touches no zone (E zone starts z 6.4, S zone ends x 8.2), nor telescope, orrery, chart, arch, nor the compass inlay (6.5-8.5). Yaw: face the room centre (towards -x,+z; copy the sign convention from `QUILL_FACING_ENTRY_YAW`). Keep all 0.1 m clear of the windows' approach zones, because zones overlapping would create a double `choose-setting`.

Edits:
1. `storykeeperCastleRegion.ts`: add `export const PROFESSOR_ORION_ID = 'professor-orion'` and `PROFESSOR_ORION_SPOT: EntitySpot = { entityId, x: 9.1, z: 5.9 }` near L391. Add the spot to the NPC-spot list used for tests.
2. `manifests/storykeeperCastle.ts`: second `npcs` entry `{ entityId: 'professor-orion', npcId: 'professor-orion', assetId: <see 5>, position {9.1, 5.9}, yaw, label 'Professor Orion', idleClip 'Idle', placeholderColor 0x3d4f6e, interactionId 'talk-to-professor-orion' }`; collider `standingCollider('collider:professor-orion', spot, 0.4, 2)` beside L271; `handovers` list in the castle companion gets `{ entityId: 'professor-orion', npcId: 'professor-orion' }`.
3. `island-map/worldObjects.ts` (beside L649): `{ id: 'talk-to-professor-orion', type: 'NPC', trigger: 'TAP', title: 'Professor Orion', targetId: 'professor-orion', requirements: [{type:'ALWAYS'}], action: { kind: 'TALK_TO', npcId: 'professor-orion' } }`. Add it to the castle's interaction list and to `castleRebootContracts.test.ts` L34 fixture list.
4. `npc/content/islandNpcs.ts`: new `professor-orion` (`homeLocationSlug 'storykeeper-castle'`, schedule all `storykeeper-castle`, `questOffers: []`). Nodes (most specific first, no em dashes, `narration` fallbacks):
   - `orion-story-told` if `MEMORY_FLAG finishedAStory`: "Your story has its own star now. Shall we find the one that fits it?"
   - `orion-storybook-restored` if `MEMORY_FLAG restoredTheStorybook`: warm thanks, sets `metOrionAfterRestore`.
   - `orion-returning` if `RELATIONSHIP_AT_LEAST ACQUAINTANCE`: ask the child to count the gold stars on the chart (matches `OBSERVATORY_CHART_STAR_COUNT` 5; never mark an answer wrong).
   - `orion-greeting` ALWAYS, sets `metOrion`, +1 point; choices "What do you see?" -> followUp `orion-telescope`.
   Age-band lines: the client `NpcDefinition` has no AGE_BAND condition (`npc/types.ts` L98-103). Band variation goes in Django (`{"type":"AGE_BAND","in":[...]}`), authored as three Django nodes (Sprouts: one short sentence; Pathfinders: two; Explorers: names planets/constellations).
5. `lai/apps/npcs/orion_content.py` (mirror of `quill_content.py`): `NPC_ID 'professor-orion'`, `PLACEMENT_KEY 'castle-orion'`, `PLACE_SLUG 'storykeeper-castle'`, `SPOT (9.1, 0.0, yaw)`, `INTERACTION_RADIUS 2.5`, `BEHAVIOR` STATIONARY `{facePlayer: True, reactions: {...}}`, `ROLE` (existing `NpcRole`; pick an educator/guide value after reading `vocabulary.py` L17), `REQUIRED_BEHAVIOURS` greet/return_visit/fallback. Add `management/commands/seed_npc_orion.py` (copy `seed_npc_quill.py`: prerequisites check `NpcDefinition`, `ContentAsset`, `Location`; create-only; `--publish`) and `tests/test_castle_orion_seed.py` (copy `test_castle_quill_seed.py`).
6. Export/load: content `npcs.json` is generated from `ISLAND_NPCS`; re-run the content export (never hand edit `content/exported/*`), then `manage.py load_content`, `seed_npc_orion --publish`. The export needs: `homeIsland.ts` `npcIds` (add `professor-orion` next to L87, or `packs.test.ts` reports the id unclaimed) and the asset in `assets.json`. Releases are global, so publishing also ships other READY characters.
7. Admin: Django Admin NPC characters, variant, dialogues, nodes, choices, behaviour and placement are staff-editable; create-only seeds never overwrite staff edits. Editing text goes through versioned revisions (ADR-047) and a new NPC release (ADR-054); no model call decides dialogue.

## 3. Ember castle visits (no second identity)

- Same `NpcDefinition ember-dragon`; one Django `NpcCharacter` (new `seed_npc_ember` / `ember_content.py`) with two `NpcPlacement`s: existing sanctuary spot, plus castle Place placement `castle-ember` (`region null`, `location` = Place `storykeeper-castle`).
- Eligibility: `spawn_conditions` `[{"type":"WORLD_CHANGE", ...}]` for the dragon story world change (`DRAGON_OF_EMBER_MOUNTAIN_COMPLETE`) AND `QUEST_STATUS` for `restore-the-great-storybook-<band>` completed; add `RETURN_VISIT` to limit to a revisit. Exact keys must be read from `lai/apps/npcs/conditions.py` L71-140 before writing.
- Locations: a Story Hall perch beside the hearth (not near Quill's lectern collider) and the tower window area for SC-R08 flyby; start with one: hearth, STATIONARY `facePlayer` with `reactions` reusing the Quill-style map. Do not add WANDER until SC-R08.
- Dialogue (new castle-only nodes, Django): "I smelled a story. May I curl up by your fire?" plus a Sprouts-short and an Explorers variant; the client `ember-greeting` stays word for word; the existing sanctuary lines and flags (`metEmber`, `forgeLit`) are shared state, so no new memory flags.
- Persistence: only the existing NPC conversation state and relationship points (`npcs/state.py`); no new table. The `TALK_TO` interaction is `meet-ember-dragon`, reused by id in the castle interaction list.
- Model: the sanctuary uses `npc-pip` as a stand-in (clips Idle/Talk/Wave); Ember's variant must reuse the same asset so there is one Ember visually.

## 4. Tests

Existing: `npc/content/islandNpcs.test.ts`, `islandNpcs.test.ts` conventions (ordering, no em dash, narration fallbacks); `castleRebootContracts.test.ts` L34 (interaction list), L223; `storykeeperCastleBudgets.test.ts` (draw calls <= 300 via `estimateDrawCalls`, +1 NPC adds 1; scenery budgets unaffected); `storykeeperCastleParity.test.tsx` L319-357 and `storykeeperCastle.engine.test.ts` L225 (proxy); `castleRoomsContract.test.ts`, `castleNavigationRegression.test.ts`, `storykeeperCastleRegion.test.ts` (zones must not overlap; add Orion clear of zones); `CastleTaleCompanion.npc.test.tsx`, `castleNpcProgress.test.ts`, `npcApproachBridge.test.ts`; Django `test_castle_quill_seed.py`, `test_contract_mirror.py`, `test_dialogue_validation.py`. Updates needed: interaction fixture list (L34), any `npcs.length === 1` assertion in parity/budget tests, `homeIsland` pack test, content export golden `tests/golden/director-content.json` if NPC ids appear there, and new tests for Orion seed, collider clearance (no overlap with zones or telescope, orrery, chart), and Ember placement eligibility.

## 5. Assets

- Orion placeholder: `npc-professor-ticktock` (clips Idle/Walk/Wave, `assets/manifest.ts` L123) until commissioned. The in-game stand-in is acceptable per ASSET_SOURCING (KayKit Adventurers/Quaternius). Final: new id `npc-professor-orion`, `kind: 'character'`, GLB, humanoid ~1.4 to 1.6 m (child-friendly, a scholar with hat/robe and a small telescope prop), ground pivot, no textures over 1024, clips closed vocabulary `Idle`, `Talk`, `Wave`, `Point` (to the telescope), `Celebrate`; no `Walk` (stationary). Add to `assets/manifest.ts`, `content/exported/assets.json`, and the variant's `animation_map` (`idle`/`talk`/`wave`/`point`/`celebrate`).
- Quill upgrade keeps id `npc-quill` and clip names Idle/Talk/Wave/Point/Celebrate/ReactConcerned.
- Ember: dragon rig (ADR-028) will later replace `npc-pip` behind `ember-dragon`; ~1.2 m tall, clips Idle/Talk/Wave/Celebrate at least.
- Budget: each NPC is one draw call in `estimateDrawCalls`; a multi-part model costs more, so verify the 300 ceiling after adding Orion and Ember.
