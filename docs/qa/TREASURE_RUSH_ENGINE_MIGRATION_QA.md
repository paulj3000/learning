# Treasure Rush on the Game Engine Core: owner QA checklist

- **Status:** Ready for owner QA. Development only: not merged, not deployed, never seen in a browser.
- **Branch:** `feature/GE-070-treasure-rush-engine-migration` (Trello GE-070, GE-071, defect
  9OdaKlbs). The owner chose to keep GE-071 and the audio fix on this branch (2026-11-19).
- **Last reviewed:** 2026-11-19.
- **Related:** [MOVEMENT_CAMPFIRE_FEATHER_QA.md](../MOVEMENT_CAMPFIRE_FEATHER_QA.md) (movement,
  camera, campfire, feather), [P1_PLATFORMING_QA.md](../P1_PLATFORMING_QA.md) (jumping, platforms,
  Pirate's Leap), [TREASURE_RUSH_LOCAL_DEV.md](../TREASURE_RUSH_LOCAL_DEV.md) (local setup),
  `docs/engineering/game-engine/migration-matrix.md` section 5 (evidence).

This guide covers what changed for the engine migration and gives one checklist for a browser
session. Earlier guides stay valid; follow them for their own items.

## 1. What changed for a child

Nothing should look or play differently. The aim of these changes was no visible change:

- **GE-070:** Treasure Cove runs on the shared engine package. Chest answers, pickups, talking
  to Pip and quest steps are reported as engine "claims" for scoring. Scoring is off by default,
  so nothing new appears.
- **GE-071:** Pirate's Leap's checkpoints, water pools and finish line now run in the engine. The
  platforms, the gold plate and the lift are still drawn and ridden as before. The engine also
  notes which way a child crossed each section (jumping or walking), and both count the same.
- **Audio tests:** test-only isolation. No sound behaviour changed.

## 2. Local setup

Follow [TREASURE_RUSH_LOCAL_DEV.md](../TREASURE_RUSH_LOCAL_DEV.md), then refresh the cove, which
upgrades Pirate's Leap from course version 1 to 2 (it keeps staff tuning):

```bash
cd lai
../.venv/bin/python manage.py seed_treasure_rush
../.venv/bin/python manage.py publish_treasure_rush   # local development only
make runserver            # from the repository root
make web                  # Vite, in a second terminal
```

Sign in as a parent, choose a child, then go to the island, Pirate Builder Bay, and Treasure Cove.

## 3. Owner QA checklist (browser)

Tick each item. Use a Pathfinder or Explorer child for the full course and a Sprout child for item 9.

**Movement, jumping, camera, avatar**

1. [ ] Walk, run and sprint around the landing. The avatar stays under the camera, idles when
   still, and never drifts away when you walk into a wall.
2. [ ] Walk forwards, backwards and sideways into the palm trees, barrels, logs and the campfire.
   The body stops at the edge and never half-enters them.
3. [ ] Back into the north boundary in third person. The camera keeps you in view and never
   zooms up at the world's edge.
4. [ ] Jump on and off a low log and a barrel. One press, one jump, no double jump.

**Pip, chests and collectibles**

5. [ ] Talk to Pip. Accept Pip's Missing Treasure, open the landing chest, follow the flowers to
   the hidden chest, find the brass key, open the beach chest, solve the rune stones, and open the
   golden chest. Return to Pip: the bridge to Lookout Point appears.
6. [ ] A wrong chest answer is encouraged and offers another try. Nothing is lost.
7. [ ] Pick up the shell and the feather in Pirate's Leap. Each is revealed once; the feather
   looks like a feather.

**Pirate's Leap (GE-071)**

8. [ ] Pip offers Pirate's Leap. Walk into each section and hear Pip's narration as before.
9. [ ] With a Sprout child, reach the crow's-nest treasure **without jumping**: walk round each
   pool, ride the ferry and the lift (step on the gold plate first). Open the chest: the quest
   completes.
10. [ ] Fall into a pool on purpose. You come back to the last checkpoint you reached, with
    "Splash! Back to *the training yard*. Have another go!" (the place name must be there). The
    "Safe spot: ..." toast appears when you reach a checkpoint.
11. [ ] Standing on a barrel or log over the water never counts as falling in.
12. [ ] Bounce on the drum up to the ledge. Answer Pip's riddle at the drum: the plank bridge
    over the barrel pool rises straight away, without leaving the cove.
13. [ ] Leave the cove and come back. Opened chests stay open, collected items stay collected,
    the quest stays complete, and nothing is celebrated a second time.

**Sound**

14. [ ] Ambience changes between the landing, grove, ruins, beach and Lookout Point. Chest,
    key, reward, jump and landing sounds play once. The Sound button mutes and sets volume.

**Scoring (off by default)**

15. [ ] With scoring off, nothing new appears on screen. (Scoring's own QA belongs to GE-100.)

Record any defect as a Trello defect card linked from GE-070 or GE-071.

## 4. Regression coverage (automated, unit level)

Each area below is guarded by these tests. The counts are the tests in each file.

| Area | Guard tests |
|---|---|
| Player movement | `game/src/movement/firstPersonController.test.ts` (12), `.running.test.ts` (14), `runtime/runningIntegration.engine.test.ts` (5) |
| Jumping | `game/src/movement/firstPersonController.jump.test.ts` (32), `runtime/jumpIntegration.engine.test.ts` (8), `regionPlay/piratesLeap.engine.test.ts` (9) |
| Avatar synchronization | `avatarSync.test.ts` (21), `runtime/avatarSync.engine.test.ts` (1), `regionPlay/treasureCoveThirdPerson.engine.test.ts` (5) |
| Wall penetration | `game/src/movement/playerFootprint.test.ts` (16), `runtime/playerFootprint.engine.test.ts` (5) |
| Asset collisions | `runtime/derivedColliders.test.ts` (16), `runtime/collisionProfiles.engine.test.ts` (2), `runtime/extensionHostContract.engine.test.ts` (12), `regionPlay/campfire.engine.test.ts` (6), `test_gameplay_prop_packs.py` (13) |
| NPCs | `regionPlay/RegionPlayCompanion.npc.test.tsx` (9), `test_treasure_pip_seed.py` (13) |
| Chests and collectibles | `regionPlay/RegionPlayCompanion.test.tsx` (67), `regionPlay/pickups.engine.test.ts` (7), `regionPlay/pipsTreasure.engine.test.ts` (6), `test_chest_play.py` (25), `test_pips_treasure.py` (22) |
| Quest progression | `test_pips_treasure.py`, `test_pirates_leap.py` (16), `test_lookout_replay.py` (14), `quests/tests/test_progress.py` (10), `regionPlay/lookoutPoint.engine.test.ts` (13) |
| Audio | `region-play/audio/treasureRushAudio.test.tsx` (50 test cases, 59 runs with tables), `test_treasure_rush_seed.py` (6) |
| Scoring event delivery | `region-play/regionPlayClaims.test.ts` (8), `runtime/gameplayClaimSink.test.ts` (4), `regionPlay/piratesLeap.claims.engine.test.ts` (5), the claims tests in `RegionPlayCompanion.test.tsx` (3), `game-engine/bridge/engineBridge.test.ts` (15) |
| Save and restore | `region-play/useRegionPlay.test.tsx` (20), `region-play/regionPlayState.test.ts` (10), `region-play/regionManifest.test.ts` (24), `test_play_api.py` (30), `regionPlay/lookoutPoint.engine.test.ts` (revisit) |
| Engine definition | `region-play/treasureCoveAdventure.test.ts` (8), `test_treasure_cove_adventure.py` (9), `test_engine_bridge.py` (5) |

All Python tests need PostgreSQL. Without a database they are skipped, which is not a pass.

## 5. Known limits

- **Platforms stay in the live system.** Pirate's Leap's platforms, plate and lift are still drawn
  and carried by the live runtime. The engine's platform drawing and carrying (GE-066) are
  delayed. Once they land, the platforms move in a later GE-071 step.
- **Recovery after a fall below the ground** uses the live controller's last safe ground, not a
  checkpoint. The cove is flat, so this never happens there.
- **Course checkpoints are per visit.** They are not saved, exactly as before. A returning child
  starts at the cove's spawn, and only signal-gated checkpoints would be resume targets.
- **Not done:** browser, device, gamepad and Playwright checks; GE-D5 and GE-D8 (the engine lead's
  GE-075 and GE-076).
