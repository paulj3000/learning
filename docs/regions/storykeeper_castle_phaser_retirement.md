# Storykeeper Castle and Writing Room: Phaser retirement readiness (SC-R10-03)

Status: **blocked, not started.** Audit only (final engineering wave, 2026-11-18). Nothing Phaser is
deleted or switched. ADR-020 decision 2 and 7 and `docs/DJANGO_MIGRATION_ROADMAP.md` Phase 23 govern.

## 1. What ADR-020 requires before a world's Phaser view is deleted

| # | Condition | Source | State for the castle and Writing Room |
|---|-----------|--------|----------------------------------------|
| C1 | Parity tests pass: every Phaser interaction id reachable in 3D, unlock gating equal, world-change keys alter the scene, adventure start fires the same action (LAI-2301 harness) | ADR-020 (2); LAI-2301 | **Met (unit level).** `storykeeperCastleParity.test.tsx` and `castleWritingRoomParity.test.tsx` on the shared harness. The Writing Room 3D view now has more than Phaser (the write-your-story activity and Quill, WS-B); parity is a floor, not equality. |
| C2 | Visual validation of the 3D world | ADR-020 (2) | **Open, owner.** Acceptance O-1 to O-19 in `storykeeper_castle_acceptance.md` section 4 (browser). |
| C3 | Sprouts gate: guided Three.js profile passes a real playtest with 3 to 4 year olds and parental consent | ADR-020 (7); LAI-2303 (APPROVAL, human); ADR-008 | **Open, owner.** D-2. Until it passes, the card hub and the Phaser view stay the Sprouts primary route. A failed playtest blocks removal for Sprouts; it never silently falls back to Phaser. |
| C4 | Performance budgets pass on the owner's listed real devices | LAI-2302 (APPROVAL, devices) | **Open, owner.** D-1. The castle has estimates only (241 of 300 draw calls, WS-C/F); real-device tables in `docs/PILOT_READINESS.md` 5b are blank. |
| C5 | Owner authorization for this world's retirement | ADR-020; SC-R10-03 | **Open, owner.** |

LAI-2304 (removing the `phaser` dependency) is a separate, later, island-wide task that also needs
2201 to 2208, 2301 to 2303 and its own approval. Retiring the castle does not remove Phaser.

## 2. Exact change set once C2 to C5 are recorded (prepared, not applied)

Kept in one commit, separate from any feature work, so it reverts cleanly.

1. **Routes** (`react/src/app/AppRoutes.tsx`): replace the elements of
   `/island/:childId/world/storykeeper-castle` and `/island/:childId/world/castle-writing-room` with
   `LegacyLocationWorldRedirect` to `STORYKEEPER_CASTLE_REGION_ID` and
   `CASTLE_WRITING_ROOM_REGION_ID` (the pattern already used for `storykeeper-castle-3d`), so
   bookmarks keep working.
2. **Location page** (`react/src/routes/IslandLocationPage.tsx`): drop the "Try exploring the castle
   (new!)" and "Try exploring the room (new!)" Phaser links; rename the 3D links to the primary
   wording. Update `IslandLocationPage.test.tsx`.
3. **Delete** (castle and Writing Room only):
   - `routes/StorykeeperCastleWorldPage.tsx`, `routes/CastleWritingRoomWorldPage.tsx`
   - `features/island-map/StorykeeperCastleWorldView.tsx` (+ test), `CastleWritingRoomWorldView.tsx` (+ test)
   - `features/island-map/scenes/StorykeeperCastleScene.ts`, `scenes/CastleWritingRoomScene.ts`
   - `features/island-map/storykeeperCastleTilemap.ts`, `storykeeperCastleZones.ts`,
     `storykeeperCastleDecor.ts`, `castleWritingRoomTilemap.ts`, `castleWritingRoomZones.ts`,
     `castleWritingRoomDecor.ts` and their tests; the castle entries in `decor.ts`.
4. **Keep**: `worldObjects.ts` `STORYKEEPER_CASTLE_INTERACTIONS` and
   `CASTLE_WRITING_ROOM_INTERACTIONS` (the 3D manifests import them); the 2D shim zone id
   `castle-painted-wall` stays as an interaction `zoneId` because the 3D platforms
   (`castlePlatforms.ts`) and `usePadAnswers` use the id, only its 2D pixel rectangle goes.
5. **Tests to retarget**: `test/engineBoundary.test.ts` (castle entries), comments in
   `theStorykeepersTale.test.ts`, `CastleTaleSession.tsx`, `CastleSecretDoorStory.tsx`,
   `castleWritingRoom.ts` that name the Phaser view.
6. **Verification** (merge-readiness gate, not this wave): full Vitest and Django suites, typecheck,
   build, the parity tests, and `grep -r "StorykeeperCastleScene\|CastleWritingRoomScene" react/src`
   empty.

## 3. Conditions that authorize removal

Removal of the Phaser castle and Writing Room is authorized when, and only when, all of these are
recorded in `tasks/TASK_TRACKER.md` with a date and the owner's name:

1. C2: O-1 to O-19 executed in a browser with no open defect against the 3D castle or Writing Room.
2. C3: LAI-2303 Sprouts playtest run and recorded as passed for the guided Three.js profile.
3. C4: D-1 real-device results recorded in `docs/PILOT_READINESS.md` 5b within budget.
4. C5: an explicit owner instruction to retire SC-R10-03.
5. The parity tests (C1) still pass on the commit that removes the views.
