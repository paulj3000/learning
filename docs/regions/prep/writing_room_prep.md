# Writing Room Three.js prep (SC-R10-01/02)

Read-only prep. Phaser retirement (SC-R10-03) stays gated on ADR-020 parity, LAI-2303 and owner approval. Nothing here deletes Phaser.

## 1. What "parity" means

The Phaser room is thin. Its whole behaviour, in `react/src/features/island-map/worldObjects.ts` `CASTLE_WRITING_ROOM_INTERACTIONS`, is:
- `writing-room-desk` (DISCOVERY, TAP): SHOW_MESSAGE "You solved it, so it is yours to use..."
- `writing-room-bookshelf` (OBJECT, TAP): SHOW_MESSAGE "Shelf after shelf of blank books..."
- `writing-room-castle-exit` (LOCATION, APPROACH): NAVIGATE `world/storykeeper-castle`.

There are no NPCs, no adventure, no write action and no progress event. Chapter 3 content lives elsewhere. `story/content/theCastlesSecretDoor.ts` chapter `what-was-waiting` has three scenes: `the-room-revealed` (branches on flag `whatIsBehind`), `quill-hands-over-the-room`, and the REFLECTION `secret-door-reflection` (objective `curious-questioning`). It is rendered by `three/extensions/castleTale/CastleSecretDoorStory.tsx` through `AdventureStepCard`, and it records `THE_CASTLES_SECRET_DOOR_COMPLETE`.

So parity means:
- Same interactions, ids, messages, requirements and exit.
- Same unlock gate and same fail-closed behaviour.
- Same rewards (none new).
- Chapter 3 stays where it is.
- The room must not invent a writing activity, because a "write the first story" mechanic would be new scope and needs an owner decision.

| Feature | Phaser today | Three.js target |
|---|---|---|
| Learning objectives | None in room. `curious-questioning` and creative writing belong to chapter 3. `locations.ts` lists skills "Curiosity, Creative writing". | Unchanged. No new objective. |
| Activities | Read two messages, walk out | Same two plus exit. Optionally a "Things to do here" list (reuse `ThreeLocationWorldView`). |
| Inputs | Arrows/WASD, tap-to-walk, "Things to do here" list, location-page link | Engine controls plus the existing React overlay (`WorldActionPanel`). Keep the "Prefer not to walk?" link to `/island/:childId/locations/castle-writing-room`. |
| Progress/rewards | None recorded | None recorded. |
| Age bands | No band gate in room (the story is EXPLORER only; Sprouts keep Phaser and card route) | Same. Sprouts guided profile is a LAI-2303 question. |
| Accessibility | Panel `role="dialog"`, list alternative, instruction line | Keep panel and list. Add focusable labels per ADR-020 and the engine's focus contract. Message text unchanged. |
| Content contracts | `locations.ts` slug `castle-writing-room`, `homeIsland.ts` pack, `realmThemes.ts`, `islandNpcs.ts` schedule entry (afternoon), `CASTLE_EXITS` `writing-room` -> `locations/castle-writing-room` | Same slug and ids. Manifest `regionId` and `locationSlug` both `castle-writing-room`. |
| Completion/persistence | Unlock only via world change key; `isLocationUnlocked` shows "not discovered yet" | Same check, through manifest requirements. |

Note `islandNpcs.ts:112` schedules an NPC at this location, but the Phaser scene sets `npcs: []`. Flag this to the owner before parity. The safe reading is that the NPC is not placed, so the Three.js room places none either.

## 2. Manifest design

Round room as in the roadmap (`STORYKEEPER_CASTLE_REBOOT_ROADMAP.md` line 106): one window, desk, shelves of blank books.

- Registry: `ThreeLocationManifest` with `regionId` `castle-writing-room`, `locationSlug` `castle-writing-room`, `worldSlug` `HOME_WORLD_SLUG`, `version` 1.
- Bounds: a small interior, `halfExtentX` and `halfExtentZ` about 5 (a 10 by 10 room, approximated round by four corner colliders), with a 3.2 high wall.
- Surfaces: carpet floor, wall ring, ceiling, using the `castleVisualKit.ts` pattern.
- Environment: warm interior, one window light (`lights`), a window prop.
- Entities:
  - Desk at about (2.5, -1), bookshelves along the back arc, and the one ajar secret door at the west wall, which is also the exit.
  - Props reuse castle assets from `ASSET_MANIFEST`. A missing model falls back to the engine placeholder.
- Zones: `writing-room-castle-exit` (west door), `writing-room-desk`, `writing-room-bookshelf`, each as a `RectZone` keyed by interaction id (Phaser keys zones the same way).
- Interactions: reuse `CASTLE_WRITING_ROOM_INTERACTIONS` verbatim (same ids, messages, `requirements`).
  - Change the exit action to `NAVIGATE` `explore/storykeeper-castle` only if `WorldActionPanel` resolves it like other converted regions. Otherwise keep `world/storykeeper-castle`, which the legacy redirect already forwards.
  - Do not edit the shared array in place while Phaser still uses it. Both views import the same constant, so parity holds by construction.
- Checkpoints: one, `castle-writing-room-entry`, in `discovery/checkpoints.ts`. The save-compatibility rule applies: append only.
- Entry from the castle: `CASTLE_EXITS` `writing-room` keeps `to: 'locations/castle-writing-room'`. The Phaser interaction `castle-last-bookshelf` is the same entry. SC-R03-01 explicitly kept the door navigating until SC-R10.
- Runtime: `ThreeLocationWorldView` with `createLocationEngine`, no new engine code. Input and dialogs are React overlays: `WorldActionPanel`, the location link, the "not discovered" gate. No answer validation, no AI, no progress in the engine.

### Files to create
- `react/src/features/island-map/three/castleWritingRoomRegion.ts` (constants, pure, no three)
- `react/src/features/island-map/three/runtime/manifests/castleWritingRoom.ts` (`CASTLE_WRITING_ROOM_MANIFEST`)
- `.../manifests/castleWritingRoom.test.ts` (validation)
- `.../manifests/castleWritingRoom.engine.test.ts`
- `.../manifests/castleWritingRoomParity.test.tsx`
- `react/src/features/discovery/checkpoints.ts`: add `CASTLE_WRITING_ROOM_REGION_ID` and checkpoint (edit)
- `manifests/index.ts`: register in `SOURCE_LOCATION_MANIFESTS` (edit)
- `docs/IMPLEMENTATION_STATUS.md` (edit)

### Route coexistence
- Keep `/island/:childId/world/castle-writing-room` on `CastleWritingRoomWorldPage` (Phaser) until the gates clear.
- The Three.js room is served at the generic `explore/castle-writing-room` (`LOCATION_WORLD_ROUTE`), which needs no new route.
- Add a "Try exploring the room (new!)" link in `IslandLocationPage.tsx` beside the existing walk link (line 260), the same way the Dragon's Sanctuary did (line 247).
- The Three.js room does not become the default, and `world/` is not turned into `LegacyLocationWorldRedirect` until parity, LAI-2303 and owner sign-off. That switch is the one-line change in `AppRoutes.tsx:248` that belongs to SC-R10-03.

## 3. Shared progress contract

Neither room records anything today, so the contract is "neither writes a world change":
- Unlock and the only record: `THE_CASTLES_SECRET_DOOR_COMPLETE`, `changeType` `STORY_COMPLETED`, `locationSlug` `castle-secret-passage`, written by the Story engine at chapter 3.
- Great Storybook page `page-what-was-waiting` (`great-storybook/pages.ts:111`) sources from the same key.
- Both views read `WorldInteractionContext.worldChangeKeys` through `useExplorableWorld`. Neither calls `recordWorldChangeOnce`.
- If a "first story written" record is later wanted, it is a new key defined once in the Django catalog and the shared TypeScript constants, never per renderer.

## 4. Unit-test plan

- `castleWritingRoom.test.ts`: passes `validateLocationManifest` against `SOURCE_MANIFEST_REGISTRIES`. The manifest interaction ids equal `CASTLE_WRITING_ROOM_INTERACTIONS` ids. Every zone resolves to an interaction. Entity positions sit inside bounds and clear of the spawn and the exit.
- `castleWritingRoom.engine.test.ts`: uses the `engineHarness` to check spawn, a collider keeps the child inside, the exit zone fires its `NAVIGATE`, and the desk and bookshelf fire the same messages as Phaser.
- `castleWritingRoomParity.test.tsx` (modelled on `dragonsSanctuaryParity.test.tsx`, mocking `createLocationEngine`): port each assertion from `CastleWritingRoomWorldView.test.tsx`:
  - the locked state shows "has not been discovered yet" and no engine is built;
  - an unlocked child gets the engine;
  - desk and bookshelf messages render in the panel;
  - the exit link goes to the castle;
  - "Things to do here" lists the same titles.
- Contract tests: `CASTLE_EXITS` `writing-room` still requires `THE_CASTLES_SECRET_DOOR_COMPLETE`. `locations.ts` and the manifest agree on the unlock key. Neither view calls `recordWorldChangeOnce`. The Phaser files stay present and the old test files stay green.
- Not testable by unit tests: visual validation and the Sprouts playtest, which remain owner steps (LAI-2303).

## Open questions for the owner
1. Should the Three.js room add a "write the first story" action? It is new scope and would need its own world-change key.
2. Should it place the NPC that `islandNpcs.ts` schedules here?
3. Should Sprouts reach this room at all, given that chapter 3 is EXPLORER only?
