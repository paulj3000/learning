# Firepeak and North Pole: advanced gameplay requirements for the Game Engine Core

Status: inventory for the engine lead (core/gameengine, `@lai/game-engine` in `game/`), 2026-11-18.
Written on `feature/firepeak-volcano-adventure`; North Pole lines refer to
`feature/north-pole-adventure` (stacked on this branch). Nothing here adds physics, movement,
collision or camera code: every gap below is engine scope.

Paths are relative to `react/src/features/island-map/three/` unless they start with `react/`,
`lai/` or `docs/`. "NP" marks code that exists only on the North Pole branch.

## 1. How the realms reach the engine today

A Django `WorldRegion.scene` becomes a `ThreeLocationManifest` in
`react/src/features/region-play/regionManifest.ts` (`buildRegionManifest`). That manifest runs in
the generic `runtime/createLocationEngine.ts`. The region-play extension
(`extensions/regionPlay/regionPlayScene.ts`, `areaEffectsScene.ts`, `areaPuzzleScene.ts`) owns
lava, steam, the backdrop, effect checkpoints, openings, rope-lift returns, light gates, stand-ins
and the puzzle visuals.

Realm data:
- Heart of Firepeak: `lai/apps/regions/firepeak_heart_layout.py` (geometry), `firepeak_heart_content.py`.
- The Volcano Awakens: `lai/apps/regions/firepeak_seed.py`.
- North Pole: `lai/apps/regions/north_pole_layout.py`, `north_pole_puzzles.py` (NP).

## 2. Capability inventory

| Capability | Where it lives now | What the realms use | Tests (evidence) | Engine Core? |
|---|---|---|---|---|
| Jumping | `firstPersonController.ts` (`FirstPersonController`, `tryJump`, `stepVertical`; 120 Hz substep), `jumpConfiguration.ts` (`DEFAULT_JUMP_CONFIGURATION`: height 1.2, gravity 22, coyote 120 ms, buffer 150 ms) | Defaults only: neither realm authors `scene.movement`. Every jump route has a walk-around (FPV-D7, NP-D5) | `firstPersonController.jump.test.ts`, `jumpConfiguration.test.ts`, `runtime/jumpIntegration.engine.test.ts`, `runtime/validateMovement.test.ts`; `lai/apps/regions/tests/test_firepeak_heart_layout.py` (hop limits), NP `test_north_pole_layout.py` (`JUMP_ROUTES`, gap at most 1.6 m, rise at most 0.6 m) | Yes (being extracted) |
| Moving platforms | `platforms/platformSpec.ts` (`PlatformSpec`, `PlatformMotionSpec` LOOP/PING_PONG/ONCE, triggers ALWAYS/PLATE/SWITCH/ZONE/SIGNAL/WORLD_STATE), `platforms/platformMotion.ts`, `platforms/platformSystem.ts`; rider carry in `FirstPersonController.carry` / `inheritVelocity` | FP: `fh-forge-lift` (SIGNAL), `fh-summit-shuttle`, `fh-lava-bridge`. NP: `np-plat-lake-floe-ride`, a ONCE lift, `np-plat-trampoline` (bounce), `np-lake-bridge` (SIGNAL) | `platforms/platformMotion.test.ts`, `platforms/platformSystem.test.ts`, `runtime/platforms.engine.test.ts`, `extensions/regionPlay/piratesLeap.engine.test.ts`, `lai/apps/regions/tests/test_platforming.py` | Yes |
| Falling / unstable platforms | `PlatformVanishSpec` (TIMED or STAND, warning window), `platformSystem.ts`, blink or dim under reduced motion in `platforms/platformPresentation.ts` | FP `fh-stone-vanish`; NP `np-plat-lake-thin-ice` ("thin ice") | `platformSystem.test.ts`, `platforms.engine.test.ts` | Yes. **Gap:** vanish only, nothing physically falls |
| Lava and hazards | (a) `HazardSpec` (rect + `belowY`) in `platformSystem.ts`, `player.recover('HAZARD')`; (b) region-play lava `areaEffectsScene.ts` (`isInDangerousLava`, shader plane, `LavaConfig.safe[]`, `visualOnly`) | FP Heart: `effects.lava` visualOnly + `platforming.hazards` `fh-lava-hazard`. Volcano Awakens: dangerous lava with a safe crossing. NP: `np-hazard-lake-water` | `extensions/regionPlay/firepeakEffects.engine.test.ts`, `platformSystem.test.ts`, `piratesLeap.engine.test.ts` | (a) yes; (b) should become a generic "hazard surface" visual + the (a) rule |
| Safe respawn | `FirstPersonController.teleport`, `teleportTo` (collision-checked), `recover`; `isSafeGround` / `recoveryPoint` options; `runtime/extensionRegistry.ts` `teleportPlayer`; respawn vignette `.respawnFlash` (`extensions/regionPlay/ui/AreaPuzzlePanels.module.css`) | FP-D10 and NP: back to the last safe checkpoint, nothing lost, no lives | `firstPersonController.test.ts`, `firepeakEffects.engine.test.ts` (reduced motion), `platforms.engine.test.ts` | Yes. See gaps 6 to 8 |
| Checkpoints | (1) `CourseCheckpointSpec` (platforms, `CourseCheckpointReached`); (2) region-play `effects.checkpoints` (`CheckpointConfig`, `whenChangeKey`, resume at the furthest earned one, 3 m reach); (3) discovery spawn checkpoints on zone enter (`runtime/ThreeLocationWorldView.tsx`) | FP Heart authors the same `CHECKPOINTS` in both (1) and (2). NP: 9 effect checkpoints, 2 course checkpoints on the lake banks | `firepeakEffects.engine.test.ts`, NP `react/src/features/region-play/northPoleRegion.test.ts`, `test_firepeak_heart_layout.py`, NP `test_north_pole_layout.py` | Yes: one checkpoint system |
| Environmental puzzles | Server-graded kinds in `lai/apps/regions/puzzles.py` (`RULES`: OBSERVE_FEATURES, PLACE_PLATFORMS, VALVE_SEQUENCE, COLLECT_OBJECT, RETURN_TO_NPC, CHOOSE_ANSWER, ORDER_SEQUENCE); client `react/src/features/region-play/areaPuzzles.ts`; visuals `extensions/regionPlay/areaPuzzleScene.ts`; world effects only through change keys (`effects.openings`, steam gates, SIGNAL platforms) | 14 FP Heart puzzles, 5 Volcano Awakens, 27 NP | `lai/apps/regions/tests/test_puzzles.py`, `test_puzzle_kinds.py`, NP `test_north_pole_puzzles.py`, `areaPuzzleChoice.test.ts`, `AreaPuzzleLayer*.test.tsx` | Kinds stay Django (server grading, ADR-020: the engine never grades). The engine owns generic interactables (plates, switches, signals) |
| Lighting | Ambient and sun from `environment.lighting`; point lights `effects.lights` (`regionManifest.ts readLights`, gated in `createLocationEngine.ts`); NP adds `readLighting` colours and `effects.lightGates` | FP: 7 glows, no `environment.lighting`. NP: lighting colours, 11 lights, the Star light gated on `NORTH_POLE_STAR_RESTORED` | NP `extensions/regionPlay/areaAtmosphere.engine.test.ts`, `northPoleRegion.test.ts` | Yes |
| Particles | Steam (`areaEffectsScene.ts`, 48 points, still cone under reduced motion); motes `runtime/visual/motes.ts`; NP precipitation `runtime/visual/atmosphere.ts` (budget from `runtime/visual/renderQuality.ts`: 0 / 600 / 1200) | FP Heart: 2 forge plumes; Volcano Awakens: passage steam; NP: snow at 0.6 | `firepeakEffects.engine.test.ts`, `runtime/visual/motes.test.ts`, NP `runtime/visual/atmosphere.test.ts` | Yes: one particle emitter with tier and reduced-motion budgets |
| Weather | NP `runtime/visual/atmosphere.ts` (`readAtmosphere`, linear fog, `SNOW` precipitation, up to 4 sky ribbons); validated in `runtime/validateLocationManifest.ts`; spec `docs/engine/AREA_ATMOSPHERE.md` (NP) | NP only. Decorative | NP `atmosphere.test.ts`, `areaAtmosphere.engine.test.ts` | Yes. Only `SNOW` exists |
| Environmental audio | `react/src/audio/world/AudioZones.ts` (zone ambience by priority), `SpatialEmitters.ts` (looping `add`, one-shot `playAt`); registry `react/src/features/region-play/audio/regionAudio.ts` (`REGION_AUDIO`, `FIREPEAK_ZONE_AMBIENCE`, NP table); cue specs `lai/apps/audio/firepeak_cues.py`, NP `north_pole_cues.py` | Zone ambience and moment cues. No looping positional source is ever added | `react/src/audio/world/AudioZones.test.ts`, `SpatialEmitters.test.ts`, `region-play/audio/regionAudio.test.ts`, NP `lai/apps/audio/tests/test_north_pole_cues.py` | Yes |
| Wind / external forces | **Does not exist.** Only `launch` (bounce) and platform `carry` move the player. Vegetation lean (`regionPlayScene.ts`) is visual | NP uses wind audio only | none | Engine gap |
| Surface friction / ice | **Does not exist.** `SurfaceSpec` (`runtime/locationManifest.ts`) is decorative | NP fakes ice: thin ice is a STAND vanish platform; "slide down a little" is copy only; invisible snow-lip fences keep falls to one terrace | none | Engine gap |
| Telegraphed moving hazards | **Does not exist** (no projectiles or timed danger zones) | FP Heart deferred falling rocks and timed steam pushes (FPV-17); NP's mountain has no hazard by design | none | Engine gap |
| Collision | `playerCollision.ts`, `runtime/locationManifest.ts` `ColliderSpec` (`minY`, `maxY`, `jumpable`), `regionManifest.ts readColliders` (FP shared fix), `runtime/derivedColliders.ts`, `createLocationEngine.ts removeCollider` | FP `_jumpable` logs, gate colliders, openings; NP ledge/wall/fence/solid builders | `runtime/derivedColliders.test.ts`, `collisionProfiles.engine.test.ts`, `playerFootprint*.test.ts`, `placeChild.engine.test.ts` | Yes (being extracted) |
| Camera | `playerCamera.ts` (first and third person, obstruction probe, reduced-motion rates), `cameraHeightFollower.ts` | No per-realm data | `playerCamera.test.ts`, `cameraHeightFollower.test.ts`, `runtime/thirdPerson.engine.test.ts` | Yes |
| Event bus | `worldEngineEvents.ts` (`WorldEngineEventMap`): Jumped, Landed, Footstep, Recovered, platform and course events | Firepeak audio and sound cues | `worldEngineEvents.test.ts` | Yes (being extracted). See gap 8 |

## 3. Requirements for the Game Engine Core (both realms)

Each item is additive and default-off, so today's realms keep working unchanged.

1. **External forces (wind, steam push).** A force-volume component: an axis-aligned box or
   cylinder, a direction and a strength in m/s added to horizontal velocity, ramp-in time,
   optional `whenChangeKey` gate. It never pushes a child into a hazard: the engine clamps the
   result to safe ground or omits the volume next to a hazard edge. Reduced motion: halved
   strength. Firepeak: timed steam pushes in the Forge (FPV-17, deferred). North Pole: mountain
   gusts (audio only today).
2. **Surface friction.** A per-surface `traction` (1 = today, below 1 = ice) that affects
   acceleration and deceleration only, never top speed, and is capped so a child always stops
   within about 1 m. Surfaces are authored as rect zones or collider tags. North Pole: Frozen Lake
   ice and Snowflake Mountain snow. Per-surface footsteps: NP's `snowStep` and `iceStep` cues
   exist and nothing plays them.
3. **Telegraphed moving hazards.** A hazard whose rect follows a schedule (warn, then active, then
   rest) with a visible and audible warning at least 1.5 s ahead. Contact recovers the child like
   any hazard (respawn to the checkpoint, nothing lost). No damage, no lives, no timers shown to
   the child. Firepeak: falling rocks on the Summit path (deferred). Optional per realm.
4. **Crumble then fall.** An option on `PlatformVanishSpec` that drops the platform visually before
   it hides (the collider still empties at the same moment). Firepeak `fh-stone-vanish`, North Pole
   thin ice.
5. **One checkpoint and one hazard system.** Merge course checkpoints and region-play effect
   checkpoints (change-key gating plus resume at the furthest earned) into one engine component,
   and make region-play lava a visual layered on a standard `HazardSpec`. Firepeak Heart authors
   both today; the merge must keep the layout data readable (a reader for both shapes).
6. **Respawn presentation for every recovery.** The respawn vignette and the supportive toast must
   follow every hazard recovery, not only region-play lava. Today FP Heart's lava and NP's lake
   recover through `HazardSpec` and get the generic toast only. The client mapping of a recovery
   to copy is realm data. **Done on the realm side (2026-11-18, agreed with the engine lead):**
   `platforming.recoveryLead` carries the realm's words ("Whoa, the lava is too hot!"), and
   `AreaPuzzleLayer` plays the fade on every `HAZARD` recovery from the existing bus event. No
   controller change. The engine adds `hazardId` to `PlayerRecovered` in both event maps.
7. **Bus events for hazards and weather.** Add `HazardEntered` / `PlayerRecovered{reason,
   checkpointId}` (the `Recovered` event exists; it needs the hazard id) and `AtmosphereChanged`.
   Lava respawn is a private `AreaEffectsApi.subscribe({respawned})` today.
8. **Looping positional audio.** Wire `SpatialEmitters.add` from manifest data (an emitter per
   lava pool, steam vent, waterfall or lake) with LOW-tier and mute fallbacks.
9. **Weather kinds.** Keep `SNOW`; reserve `ASH` (Firepeak summit embers) and `RAIN` as data, not
   code branches. Firepeak may author fog and `environment.lighting` once the reader is shared.
10. **Terrain height.** `groundHeightAt` is flat; slopes are 0.2 m stair colliders. A heightfield
    or ramp collider would remove NP's stair stacks. Optional.
11. **Realm-agnostic engine files.** `runtime/noLocationBranching.test.ts` guards `runtime/` only.
    Extend it to `platforms/`, `extensions/regionPlay/` and the extracted `game/` package. Known
    realm wording in engine files: comments citing "Firepeak FP-D10" in
    `firstPersonController.ts` and `runtime/extensionRegistry.ts`; the lava type and crater colour
    in `areaEffectsScene.ts`; realm audio tables in `region-play/audio/regionAudio.ts` (data that
    should move to Django cue rows or SDK definitions).

## 4. What stays realm content

Firepeak: zone geometry, puzzle bodies and band variants, NPC lines, lava and steam placement,
crystal and shard placement, the volcano backdrop colours, cue choices. North Pole: snow density,
aurora colours, the Christmas decorations and stand-in shapes, the `christmas` seasonal event,
seasonal rewards. The seasons app (`lai/apps/seasons`, ADR-081, NP) is a platform service, not
engine code, and holds no holiday names in engine paths.

## 5. Migration plan (agreed with the engine lead, 2026-11-18)

- The engine extracts the pure modules (`firstPersonController`, `jumpConfiguration`,
  `locomotionConfiguration`, `playerCollision`, `gamepadInput`, `pointerControls`,
  `worldEngineEvents`) into `game/` with `git mv` and re-export shims at the old paths. It does not
  touch `runtime/createLocationEngine.ts`, `platforms/*`, `runtime/visual/*` or realm files.
- Order: Treasure Rush (reference), Pirate's Leap, Storykeeper, Firepeak, North Pole. Firepeak and
  North Pole may start as soon as the contracts (`game/src/contracts/`, v1) are stable.
- Each realm migration happens on its own branch: merge `core/gameengine`, switch imports to
  `@lai/game-engine`, adopt the SDK definitions, run the realm's targeted tests (section 2). North
  Pole merges Firepeak first, as now. No backend domain change rides with a migration (CLAUDE.md
  section 19).
- Preserved through migration: every layout, puzzle, reward rule and saved progress row. The
  engine never grades answers or grants progress.
- Changes the realms need in moved modules are requested from the engine lead, not edited on the
  realm branches.
