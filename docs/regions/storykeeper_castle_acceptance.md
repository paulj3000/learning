# Storykeeper Castle — Acceptance and Test Plan (SC-R01-05)

Two levels of acceptance, kept apart on purpose:

- **Development acceptance**: unit, component, engine, contract and static
  tests, typecheck, Prettier, Ruff and build. These run on every task on
  `adventures/storybook`.
- **Browser / device acceptance**: a real browser, a real tablet, or a real
  child. **None of it is run on this branch (owner instruction)**, and none
  of it may be reported as passed until the owner runs it.

"Unit" below means Vitest in jsdom with test doubles for the renderer (no
WebGL) or pytest. "Browser" means the owner, in a real browser. "Device"
means a target tablet or Chromebook. "Playtest" means a child, under
`docs/PILOT_READINESS.md` section 5b.

## 1. Whole-castle acceptance (the reboot's end state)

| # | Criterion | Unit | Browser | Device / playtest |
| --- | --- | --- | --- | --- |
| A-1 | Every existing interaction still works (ids, actions, gates) | `castleRebootContracts` C-1; `storykeeperCastleParity` | Walk each one | |
| A-2 | Card and 3D choices are equivalent | `castleHudEquivalence`; contract C-4 | Choose by walking and by card in one session | |
| A-3 | Room connectivity: every room reachable from spawn; no sealed archway | `storykeeperCastleRegion.test` flood fill; `storykeeperCastle.engine.test` walls | Walk every archway | |
| A-4 | Puzzle states deterministic: same inputs, same visual state | Engine tests with a stub renderer; seating-puzzle tests | Replay each beat twice | |
| A-5 | No additional progress records (ADR-027) | Story and adventure engine tests; contract C-4 (scene writes nothing) | Inspect records after a 3D chapter and a card chapter | |
| A-6 | Existing story chapters reachable for their band | Contract C-3; `libraryArcAdventures.test` | Explorer plays chapters 1 to 3 | |
| A-7 | Age-band rules preserved; no cross-band claims | Contracts C-2, C-3 | One child per band | Sprouts playtest (SC-R11-02) |
| A-8 | No missing-asset crashes | `missingModelPlaceholders.engine.test`; surface fallback tests (SC-R02-01) | Delete a model file locally and load | |
| A-9 | No unhandled renderer errors | Engine tests assert no rejected tracked work | Console clean through a full visit | |
| A-10 | Reduced motion respected | Unit tests on the motion policy (SC-R02-05) | OS setting on: no sway, no drifting motes, instant state | |
| A-11 | Keyboard: WASD/arrows, E/Enter, Tab through the HUD | `pointerControls` tests; `WorldHud`/`WorldActionPanel` tests | Full visit without a mouse | |
| A-12 | Touch: two-zone drag; the "Things to do" list reaches every objective | `ThreeLocationWorldView` tests | iPad Safari full visit | Tablet |
| A-13 | Model and texture budgets (art direction section 7) | Static budget tests (SC-R02-08) | | |
| A-14 | Tablet performance: 30 fps in the Great Library at MEDIUM; under 8 s to first walkable frame (provisional) | none | | **Device (SC-R11-01)** |
| A-15 | Save / resume: an open session resumes in the room with its choices | `CastleTaleCompanion` resume path (to be unit-covered) | Leave mid-tale, return next day | |
| A-16 | Storybook pages derived correctly per band (SC-R04) | Pure-function tests | Page appears after the source world change | |
| A-17 | Artifacts displayed, never granted, by the castle (SC-R07) | Display-requirement tests | Earned artifact on a pedestal | |
| A-18 | Sound settings respected (SC-R06) | Cue tests with a fake sink | Mute persists | |
| A-19 | AI fallbacks: every AI line has an authored fallback; no live Bedrock in tests (SC-R09) | Fake-model tests | Kill switch on: castle still complete | |
| A-20 | Sprouts can complete their mission on the 3D route | none | | **Playtest (SC-R11-02)** |
| A-21 | Phaser castle retired only after parity and the Sprouts gate (SC-R10) | Parity tests | Route switch verified | Playtest |

The SC-11 gate, carried as SC-R11 (A-14 and A-20), **stays open** until the
owner runs it. Nothing on this branch closes it.

## 2. SC-R02 (visual overhaul) acceptance

### 2.1 Verified by development checks

| # | Criterion | How |
| --- | --- | --- |
| V-1 | All castle interactions, bindings, colliders, zones and spawn unchanged by visual work | Contracts C-1 and C-4; region and engine tests; a test comparing collider and zone rects before and after |
| V-2 | Every new scenery asset id resolves through the registry, or is a declared procedural surface | `locationAssetUsage`, `noHardCodedAssetUrls` and manifest validation |
| V-3 | Material presets validate (known pattern, colours in range, positive repeat) | `validateLocationManifest` tests |
| V-4 | Procedural textures deterministic per seed and tier; sized by tier | Surface texture tests |
| V-5 | Surfaces have world-scaled UVs (one texel size across rooms) | Surface geometry tests |
| V-6 | Missing surface or texture falls back to flat colour; missing model to the placeholder | Engine tests with a failing loader |
| V-7 | Scene disposal releases surface geometries, preset materials and textures | Engine dispose test counting `dispose()` calls |
| V-8 | Quality tiers change appearance only (identical colliders, interactions, bindings) | Engine test across LOW, MEDIUM and HIGH |
| V-9 | Light count within the tier budget | Static budget test |
| V-10 | Reduced motion disables decorative motion; state changes still apply | Motion policy tests |
| V-11 | No new Phaser code; no new dependency | `git diff` review in SC-R02-09; `package.json` unchanged |
| V-12 | Static scene budgets (scenery count, presets, library density) | SC-R02-08 tests |

### 2.2 Owner browser and device checklist for SC-R02 (open)

Open only, never marked passed here:

- [ ] The castle loads at `/island/:childId/explore/storykeeper-castle` with
      no console errors.
- [ ] Floors, walls and ceilings show their patterns with no visible seams,
      moiré or stretching, in every room.
- [ ] Each room is recognisably different (art direction section 5).
- [ ] The Great Library reads as the darkest room but every puzzle object is
      still easy to see. The Storybook dais is the focal point.
- [ ] The Entry Hall reads as a grand entrance, and the path to Quill and
      onward to the library is clear.
- [ ] Interactive objects stand out from scenery; feedback glows are gentle,
      not flashing.
- [ ] Reduced motion on: nothing drifts or sways; outcomes still show.
- [ ] LOW tier on a weak device: still readable; flat colours where textures
      were dropped.
- [ ] A full Pathfinder tale and an Explorer arc complete by walking.
- [ ] Device: frame time in the Great Library and load time recorded (SC-R11).

## 3. What cannot be verified without a browser or device

- That a procedural texture *looks* right: tests prove the pixels and UVs,
  not the impression.
- Lighting exposure and colour balance across rooms.
- That textured imports decode (jsdom stubs image decoding).
- Frame time, memory, thermal behaviour and load time on a tablet.
- Touch ergonomics, and whether a three-year-old can complete a mission.
