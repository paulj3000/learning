# Castle jumping and platforms: integration contract (preparation)

Status: preparation only. Source: `origin/feature/interactive-platforms` (read with `git show`, not merged). Decisions: ADR-055 to ADR-059, `docs/PLATFORMING.md`, `docs/PLAYER_MOVEMENT_AND_JUMPING.md` (both on that branch). Rules: one movement controller, no jumping-only adventures, Three.js only, no Phaser, learning stays primary, every jump is optional.

## 1. Shared API (all paths under `react/src/features/island-map/three/` on the branch)

| Concern | Where | Contract |
|---|---|---|
| Jump config | `jumpConfiguration.ts` | `JumpConfiguration` { enabled, jumpHeight 1.2, gravity 22, airControl 0.65, maxFallSpeed 18, coyoteTimeMs 120, jumpBufferMs 150, allowDoubleJump false }. Per location: `manifest.movement.jump` (partial, clamped by `JUMP_LIMITS`; typos reported by `validateMovementSpec`). Django region: same block inside `scene.movement`. There is NO per-adventure or per-age-band jump field today (see gaps). |
| Run/sprint | `locomotionConfiguration.ts` | `movement.locomotion` { runSpeed, sprintSpeed }. |
| Ground, coyote, buffer, head bump | `firstPersonController.ts` (~L560-580) | Coyote and buffered jump are in config; head bump only against jumpable colliders; landing counts tops a step above the feet. |
| Solids vs jumpable | `locationManifest.ts` `ColliderSpec.jumpable` | Default collider blocks at every height (walls, gates, bounds are never jumpable). `jumpable` needs authored minY/maxY and is rejected on a collider with `requirements`. |
| Recovery | controller `recover('HAZARD')`, `PlayerRecovered` | Non-finite, below recovery depth, or outside bounds plus margin: back to last stood place, position only. |
| Platforms | `platforms/platformSpec.ts`, `platformSystem.ts`, `platformMotion.ts` | `manifest.platforming` { platforms, pressurePlates, checkpoints, hazards, goals, tuning, zones }. Types: static (any y, floating), moving (`motion.path/speed/pauseSeconds/mode`), interactive (`activation` PLATE, SWITCH, ZONE, SIGNAL, WORLD_STATE, `hiddenUntilActive`, `delaySeconds`, `reset`), vanish (TIMED/STAND), bounce (0.5 to 4 m), spin. Limits: top at least 0.8 m, 64 platforms, speed 0.2 to 4, vanish visible at least 1.5 s. Each platform is an ordinary jumpable box in the controller's collider list. |
| Signals | `engine.signalPlatforms(name, on)` (`createLocationEngine.ts` L235, L1569) | React calls it when app code decides a challenge is solved. Bus events: PlatformActivated, PlatformMoving, PlatformStopped, PressurePlatePressed, PlayerBounced, CourseCheckpointReached, PlayerRecovered, PlatformGoalReached (L1381), PlayerJumped, PlayerLanded. |
| Course zones | `platforming.zones` (ZoneSpec with narration), `platforming.checkpoints` | Course checkpoints are distinct from the castle's save checkpoints (`STORYKEEPER_CASTLE_CHECKPOINTS`); use ids prefixed `jump:`. |
| Touch Jump | `WorldHud.tsx`, `ThreeLocationWorldView.tsx` | Button right edge, only where jumping is on and `any-pointer: coarse`; Space, gamepad A. Uses `engine.pressJump()`. |
| Camera, avatar | `playerCamera.ts`, `playerPresentation.ts`, `playerAvatar.ts`, `manifest.player.camera` | Third-person default, switchable; distance, minDistance, maxDistance, heightOffset, maxHeight. |
| Animation | `playerAnimation.ts` | States JUMP_START, airborne, FALLING, LANDING mapped to idle/walk/jump vocabulary; a missing clip never blocks play. |
| Sound | cues `sfx.player.jump`, `sfx.player.land` (landing at 3 m/s or more), `sfx.platform.*`, `sfx.player.recover` | Optional catalogue entries; silence is fine. Per platform `sounds` override. |
| Django tuning | `lai/apps/regions/platforming.py` (`layout_problems`, `tuning_problems`) | `scene.platformTuning` keyed by platform id: enabled, speed, pauseSeconds, bounceHeight, visibleSeconds, hiddenSeconds. Layout is seed-authored (ADR-033, LAI-0805 open). The castle layout stays in TypeScript. |

Gaps to decide before use: no per-adventure jump override and no age-band override. Proposal: keep the manifest as the only config; derive "reduced jumping" (Sprouts, or parent setting) in app code by passing the Sprouts-safe variant (`jump.enabled:false` is a location-wide switch, so prefer hiding the optional platforms rather than disabling jump).

## 2. Castle files and edits

Main today: castle manifest has no `movement`, `player` or `platforming`. On merge the branch itself adds (manifest `manifests/storykeeperCastle.ts` +27, near `adventureBindings`/`extensions`): `movement: { jump: { jumpHeight: 0.9 }, locomotion: { runSpeed: 4.8, sprintSpeed: 5.6 } }` and an indoor third-person `player.camera` (maxHeight 2.95 under the 3.1 m slabs). So jumping and the third-person camera switch on for the whole castle at merge, with no further edit. `castle-tale` HUD and bindings are untouched.

Safety arithmetic (verified in source): `WALL_HEIGHT = 3` (`sceneKit.ts` L31); wall colliders are `minY 0, maxY WALL_HEIGHT` and not jumpable; ceiling slab bottom at `WALL_HEIGHT + 0.1`; eye 1.6 m. A 0.9 m jump gives feet 0.9 m, eye 2.5 m, under 3.1. Standing on a 0.6 m platform and jumping gives feet 1.5 m, eye 3.1 m: touches the slab. So cap platform tops at 0.5 m in the castle; never add bounce (up to 4 m) or lifts here. No jump can clear a 3 m wall or leave the 16 x 10 bounds; `bounds` plus `PlayerRecovered` backstops it. Required interactions are ground-plane zones, so jumping over one still enters it.

Edits to enable platforms:
1. `runtime/manifests/storykeeperCastle.ts`: add `platforming` built from a new module (below). Keep platform colliders out of `COLLIDERS` (the platform system owns them).
2. New `runtime/manifests/castleRooms/castlePlatforms.ts` exporting `CASTLE_PLATFORMING` and per-room slices, imported by that manifest (avoids growing the 777-line file; each `castleRooms/<room>.ts` can export its own `*_PLATFORMS`).
3. `storykeeperCastleRegion.ts`: a comment at L539-543 says "no vertical traversal"; update it. Room floors and spots are read only, never changed.
4. Docs: `docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` note, `IMPLEMENTATION_STATUS.md`.
5. Adventure bridge: the castle-tale extension calls `signalPlatforms(name)` only after app code grades.

Guards to add as castle tests: no platform top above 0.5 m; every platform footprint inside one room floor, at least 0.6 m from any wall rect and clear of doorway gaps (`CASTLE_DOORS`, `DOOR_ENTRY_OFFSET_METERS`); no platform covers an interaction zone or blocks `safeSpot`.

## 3. Per-room designs (all optional; floors from `storykeeperCastleRegion.ts` L108-170)

Rule: platforms are enrichment and a second way to give the same answer. Every platform is 1.2 x 1.2 m minimum, top 0.3 to 0.5 m, static, no vanish in the castle. The answer always remains reachable on the ground (see section 4).

- Illustration Studio (floor x 5..10, z -1..3; easel 7.5,1; paint table 9.1,2.0). Painted Words: three painted stepping pads on the floor arc in front of the easel, one per choice, clear of the easel and paint table (9.1,2.0, half 0.4 by 0.6): (6.2,2.2), (7.5,2.6), (8.6,-0.2). Each pad shows the picture card and word text from `PAINTED_WORD_BANK` (`pictureId`, `word`). Labels and which pad is correct come from the active `PaintedWordsSet` chosen by `selectPaintedWordsSlug(worldChangeKeys)` (set A first, set B replay). Pads are generated from the current step's options, never hardcoded words. Standing on a pad (zone ZONE or an Answer button on the HUD) only selects; the existing adventure step grades via the state machine. No word outside the bank.
- Great Library (x 5..15, z -10..-2; dais 12.9,-4.55 half 1 height 0.24; rod rack 10.2,-9.4). Enchanted books as low static platforms (0.3 m): row at z -4, x 7,8.6,10.2 (clear of shelves on walls; verify against `LIBRARY_BOOKSHELF_SPOTS` and `LIBRARY_READING_TABLE_SPOTS` before final). Each carries a story fragment label for sequencing (first, then, last); order graded by app code from the existing pattern/clue modules (`castleLibraryClues.ts`, `castlePatternLock.ts`). A SIGNAL `library-fragments-ordered` lifts nothing dangerous: it only lights the books.
- Observatory (Setting Tower; x 5..10, z 5..10; telescope 5.9,5.8; orrery 9.05,9.05; chart x 5.29 z 9..9.65). Star stepping stones: five 1.0 m stones at y 0.3, x 6.6 to 8.6, z 6.8 to 8.4 in an arc away from telescope and orrery, numbered or patterned for sequencing (count, odd/even, pattern continuation). Correctness from `castleObservatory.ts` rules.
- Great Storybook dais (x 11.9..13.9, z -5.55..-3.55, height 0.24, already a solid decor collider). A pathway appears per restored page: up to six 1.0 m platforms (`hiddenUntilActive`, trigger WORLD_STATE with the page's WorldChange requirement) at y 0.24 approaching from the west side, x 11.0 to 11.7. Page progress comes from `great-storybook/pageStates.ts`; the platforms only reflect it.
- Story Hall (x -9..3, z -6..6; Quill -4.5,0; lectern 1,2). A single optional "story stones" row at z -4.5, x -6..-2, tops 0.3, for the hero/setting/problem choice visuals bound to existing portraits. No effect on bindings.
- Character Gallery (x -8..-1, z 6..10): low plinth steps under each of three portraits, purely a vantage; no signal.
- Costume Room (x -8..-1, z -10..-6): none needed; optional dress-up step stool only if art asks.
- Trophy Room (x -1..3, z -10..-6): none. Pedestals stay solid.

## 4. Accessibility and reward safety

- Non-jumping route: every platform-linked answer also exists as the current HUD choice, portrait, window or plate binding (`castleChoiceBindings.ts`, `adventureBindings`). Standing on a platform and pressing the Answer action are equivalent. Moving into the zone by walking works. A jump is never the only way to progress.
- Sprouts: platforms render as flat floor markers (height 0, not colliders), identical interaction. Parents' setting or age band toggles this; no new age logic in the engine.
- Rewards: platform events only call `signalPlatforms` or enter zones. Rewards come from server idempotent paths (`GrantedRule`, `grant_reward_rule`, `WorldChange`); no client path grants anything. A repeated landing, a signal firing twice, or a reload cannot grant twice.
- Missed jump: the floor is flat inside the room, so the worst case is landing on the floor. `PlayerRecovered` moves only position. Quest state, selected pad and progress are untouched.
- Reduced motion: no moving platforms indoors; vanish unused.

## 5. Unit tests to write

1. `castlePlatforms.test.ts`: every platform inside its room floor, clear of walls, doors, safeSpot, colliders, interaction zones; top at or below 0.5; size at least 0.8; unique ids.
2. Manifest passes `validateLocationManifest` with platforming; no `bounce`, `vanish`, `motion`.
3. Apex guard: jumpHeight + max platform top + 1.6 eye stays below slab bottom 3.1 (fails if a platform is raised).
4. No wall or gate collider is jumpable.
5. Painted Words pads: words come only from `PAINTED_WORD_BANK`; set A then set B per `selectPaintedWordsSlug`; the correct pad is derived from the question, one correct option.
6. Grading is app code: standing on a wrong pad does not advance; ground answer and pad answer give the same transition.
7. Idempotence: double signal or revisit does not emit a second reward request.
8. Page pathway: WORLD_STATE platforms appear one per restored page and persist on reload.
9. Sprouts variant has no colliders.
10. Castle engine test: jump from room edge never leaves bounds; recovery restores last position and leaves progress.
11. Parity: castle still passes `storykeeperCastleParity.test.tsx` and `castleNavigationRegression.test.ts` with third-person default.

## 6. Merge-conflict risks

Branch: 33 commits since merge base 155f07438; current branch: 7. Real overlaps:
- `docs/DECISIONS.md`, `docs/IMPLEMENTATION_STATUS.md`: both sides edit; expect textual conflicts, resolve by keeping both.
- `manifests/storykeeperCastle.ts`: branch +27 near `adventureBindings`; this branch does not touch that file (it changed `storykeeperCastleRegion.ts`), so low risk; but the new `platforming` edit should land after merge to avoid a conflict.
- `storykeeperCastleRegion.ts`: only this branch edits it; fine.
- Semantic: the branch switches the castle to third-person and jump at merge. Castle HUD, `CastleGuide`, parity and engine tests may need updates; walls at 3 m and 0.9 jump are safe. Camera `maxHeight 2.95` must stay under slab at 3.1.
- Large shared files changed only on the branch (`createLocationEngine.ts`, `firstPersonController.ts`, `WorldHud.tsx`): no overlap with this branch's changes.
