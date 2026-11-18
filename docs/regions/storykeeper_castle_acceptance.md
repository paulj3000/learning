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
| A-14 | Tablet performance: 30 fps in the Great Library at MEDIUM; under 8 s to first walkable frame (provisional; not measured, not results) | Diagnostics exist (`runtime/diagnostics/`, `?lai-diag=1`) and are unit-tested; they measure nothing by themselves | Profile a release build on the target tablet (PILOT_READINESS 5b); results blank until measured | **Device (SC-R11-01)** |
| A-15 | Save / resume: an open session resumes in the room with its choices | `CastleTaleCompanion` resume path (to be unit-covered) | Leave mid-tale, return next day | |
| A-16 | Storybook pages derived correctly per band (SC-R04) | Pure-function tests | Page appears after the source world change | |
| A-17 | Artifacts displayed, never granted, by the castle (SC-R07) | Display-requirement tests | Earned artifact on a pedestal | |
| A-18 | Sound settings respected (SC-R06) | Cue tests with a fake sink | Mute persists | |
| A-19 | AI fallbacks: every AI line has an authored fallback; no live Bedrock in tests (SC-R09) | Fake-model tests | Kill switch on: castle still complete | |
| A-20 | Sprouts can complete their mission on the 3D route | `castleSproutNoAim.test.ts` (every picture-story answer is a place to stand or a pad; reticle hidden); `castleExitsNoArithmetic.test.ts` | One SPROUT per session with an adult observer (PILOT_READINESS 5b); results blank until observed | **Playtest (SC-R11-02)** |
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

## 4. Owner acceptance checklist for SC-R04-05 to SC-R11 (SC-R12-01, open)

Branch `feature/storykeeper-castle-completion`. Every item below has unit-test evidence in
`tasks/TASK_TRACKER.md` and **none has been run in a browser, on a device or with a child**. Tick
an item only after you have played it yourself. Run the local stack with fake providers (no live
AWS) unless a line says otherwise.

### 4.1 Play checks (browser, one child profile per band)

| # | Check | Band | How | Result |
| --- | --- | --- | --- | --- |
| O-1 | The Painted Words plays in the Studio room: rhyme gallery, beginning-sound hunt, syllable workshop, restoration; page `page-painted-words` appears | Pathfinder | Play once, then replay and see the second word set (`the-painted-words-again`) | |
| O-2 | Wrong answers loop calmly; no timers, no shame wording | Pathfinder | Answer wrong on purpose at each station | |
| O-3 | Storybook page states (undiscovered, discovered, in progress, restored), celebration, offline and retry | All | Watch the guide's Storybook section before and after O-1; stop Django and reopen | |
| O-4 | A child who finished the book before `page-painted-words` keeps the seal and sees "more pages", not "missing" | Pathfinder | Seed an edition-1 completion, then open the castle | |
| O-5 | A forged world-change POST for a page key is refused | Any | `POST world-changes/` with `STUDIO_PAGE_MENDED` and no session (curl, parent token) | |
| O-6 | Jumping: each primary adventure once by jumping and once without; Sprouts see flat markers only; every pad answer is on the HUD card | All | Tale, Picture Story, Painted Words A and B, Secret Door chapters 1 and 2, Storybook pathway, Observatory stones | |
| O-7 | Keeper Quill lines reflect progress; Ember visits; Professor Orion in the Observatory (confirm the spot moved off the star stone) | All | Walk up before and after restoring pages | |
| O-8 | Room ambience crossfades; cues; ducking under narration; mute and volume persist; Sprouts get no retry sound | All | Walk through every room with sound on, then muted | |
| O-9 | Narration through Django speech (fake Polly locally; live Polly only with explicit approval) and captions always on screen | All | Turn speech off mid-line: the caption stays | |
| O-10 | Keepsakes appear on Trophy Room pedestals once earned (brush, lens, key, existing three); bare pedestal when not | Explorer, Pathfinder | Finish Painted Words and the Secret Door arc | |
| O-11 | Hall of Heroes text list in the guide | All | Before and after completing stories | |
| O-12 | Ranks (off by default, `CASTLE_RANKS.enabled`): decide keep or drop, four titles or five, and the "Castle Pathfinder" name | Owner decision | Turn on locally to look | |
| O-13 | Ambient return-visit line in the guide; it changes across visits, never says "come back tomorrow", never counts down | All | Open the castle several times | |
| O-14 | Castle Director with AI off (parent toggle) and with the kill switch: the castle still shows the authored default | All | Toggle each | |
| O-15 | Three.js Writing Room at `explore/castle-writing-room`: locked before the Secret Door arc, same two messages and exit as Phaser after; two optional low steps; none for Sprouts | Explorer | "Try the 3D room (preview)" link on the location page | |
| O-16 | Harbor exit is always reachable and never behind arithmetic, in every room | All | Try to leave from each room | |
| O-17 | Keyboard-only visit (Tab order exit, prompt, backpack; no focus trap) and an iPad Safari touch visit | All | | |
| O-18 | Reduced motion at the OS level (read at mount; reload after changing it) | All | | |

### 4.2 Device and playtest gates (SC-R11)

| # | Check | How | Result |
| --- | --- | --- | --- |
| D-1 | Real-tablet profiling of a release build with `?lai-diag=1` | `docs/PILOT_READINESS.md` 5b; fill the blank tables | |
| D-2 | Sprouts playtest, one SPROUT per session, adult observer, `quills-picture-story` | `docs/PILOT_READINESS.md` 5b | |

### 4.3 Owner decisions this branch carries

1. ADR-065 (Castle Director), Proposed: accept, amend or reject. Promote the event catalog to an
   ADR-047 revisioned admin model, or keep the JSON mirror.
2. Where Quill flavour (SC-R09-02, service only) surfaces, if at all.
3. Writing Room: a write-your-story action (new scope), the NPC `islandNpcs.ts` schedules there,
   Sprouts access, and `entryRequirements` in the shared manifest schema.
4. Ranks (O-12).
5. `assetLoader.trim`, live reduced-motion handling, kit-piece scaling before any 4 m room.
6. The optional Writing Room is unlocked by the Explorer secret-door arc, whose chapter 1 has a
   `number-input` step. Acceptable?
7. SC-R07 deviations: the six gold plates removed for the draw budget; Hall of Heroes 3D plates
   deferred (scenery 159 of 160, draws 298 of 300): raise the budget or merge decor.
8. Earlier Secret Door finishers get no `secret-door-key` without an approved backfill.
9. Retirement (SC-R10-03): Phaser castle and Writing Room stay until parity is visually confirmed
   and LAI-2303 (Sprouts gate) allows it.
10. Formatting: `prettier --write` and Ruff on the touched files at merge readiness.
