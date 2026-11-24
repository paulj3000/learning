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
| A-4 | Puzzle states deterministic: same inputs, same visual state | Engine tests with a stub renderer; seating and binding-lectern tests (`storykeeperCastle.engine`, `castleBindingLectern`) | Replay each beat twice | |
| A-5 | No additional progress records (ADR-027) | Story and adventure engine tests; contract C-4 (scene writes nothing) | Inspect records after a 3D chapter and a card chapter | |
| A-6 | Existing story chapters reachable for their band | Contract C-3; `libraryArcAdventures.test` | Explorer plays chapters 1 to 3 | |
| A-7 | Age-band rules preserved; no cross-band claims | Contracts C-2, C-3 | One child per band | Sprouts playtest (SC-R11-02) |
| A-8 | No missing-asset crashes | `missingModelPlaceholders.engine.test`; surface fallback tests (SC-R02-01) | Delete a model file locally and load | |
| A-9 | No unhandled renderer errors | Engine tests assert no rejected tracked work | Console clean through a full visit | |
| A-10 | Reduced motion respected | Unit tests on the motion policy (SC-R02-05) | OS setting on: no sway, no drifting motes, instant state | |
| A-11 | Keyboard: WASD/arrows, E/Enter, Tab through the HUD | `game/src/input/pointerControls.test`; `WorldHud`, `worldHudAccessibility` and `WorldActionPanel` tests | Full visit without a mouse | |
| A-12 | Touch: two-zone drag; the "Things to do" list reaches every objective | `ThreeLocationWorldView` tests | iPad Safari full visit | Tablet |
| A-13 | Model and texture budgets (art direction section 7) | Static budget tests (SC-R02-08) | | |
| A-14 | Tablet performance: 30 fps in the Great Library at MEDIUM; under 8 s to first walkable frame (provisional; not measured, not results) | Diagnostics exist (`runtime/diagnostics/`, `?lai-diag=1`) and are unit-tested; they measure nothing by themselves | Profile a release build on the target tablet (PILOT_READINESS 5b); results blank until measured | **Device (SC-R11-01)** |
| A-15 | Save / resume: an open session resumes in the room with its choices | `CastleTaleCompanion.npc.test` ("a session left open resumes as before") | Leave mid-tale, return next day | |
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

Built on `feature/storykeeper-castle-completion`, which is now entirely in `main` (castle head
`df376878`, GE-090 step 20c; reconciled against `main` `aa8adb33` on 2026-11-23, section 4.4).
Run these checks on `main` (GE-090-D7 merged at `1b0a50a3`). Every item below has unit-test evidence in
`tasks/TASK_TRACKER.md` and **none has been run in a browser, on a device or with a child**. Tick
an item only after you have played it yourself. Run the local stack with fake providers (no live
AWS) unless a line says otherwise.

### 4.0 Before you start (local data the castle reads)

Ember, Quill's progress lines and Professor Orion come from NPC Manager content in Django; Quill
and Orion fall back to the manifest, but Ember appears only once its content is published. Run,
from `lai/`, against your local database only:

```bash
python manage.py migrate
python manage.py load_content
python manage.py seed_npc_quill --publish
python manage.py seed_npc_ember --publish
python manage.py seed_npc_orion --publish
python manage.py seed_castle_sound
python manage.py seed_castle_speech_lines
python manage.py import_castle_events
python manage.py backfill_castle_keepsakes          # dry run; add --apply to grant
```

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
| O-19 | Secret Chamber finds: a brighter star in the north-wall mural and a mouse-sized door low on the east wall, each found by walking up, never listed, only after the tapestry nook; chamber return-visit lines mention them afterwards | All | Find the nook, enter the chamber, then revisit | |
| O-15 | Three.js Writing Room at `explore/castle-writing-room`: open to every child with no prior story (the old Secret Door gate and its arithmetic are gone), same two messages (the desk now reads "This desk is yours to use") and exit as Phaser; two optional low steps; none for Sprouts; Keeper Quill stands near the desk | All | "Try the 3D room (preview)" and "Write a story" on the location page (also listed on the island map for every child) | |
| O-15a | Writing Room write-your-story: tap the open book on the desk (or "Write a story" on the location page). Sprouts tap a picture, a character and a word; Pathfinders build 2 or 3 sentences from word tiles; Explorers pick a starter and type a short paragraph. Story is saved once, shows in the adventure log and the parent's Story Keepsakes, and Keeper Quill's "Hear it" reads each prompt | One child per band | Walk to the desk, then also use the location page | |
| O-15b | Writing Room safety: an Explorer paragraph with a phone number, an email, a link or a rude word is refused with a kind line, nothing is saved, and the text is not repeated | Explorer | Type each | |
| O-15c | A child who already finished the Secret Door arc keeps the library bookshelf door, their key and keepsake, exactly as before | Explorer | Existing profile | |
| O-15d | Sprouts can walk in, use large targets, flat markers (no jump steps), and finish the tap story by themselves | Sprout | Playtest | |
| O-15e | Keeper Quill's afternoon line ("Afternoons are for writing...") is heard once, in an afternoon, after he has met the child; his other lines are unchanged | Any | Talk to him twice in an afternoon | |
| O-16 | Harbor exit is always reachable and never behind arithmetic, in every room | All | Try to leave from each room | |
| O-17 | Keyboard-only visit (Tab order exit, prompt, backpack; no focus trap) and an iPad Safari touch visit | All | | |
| O-18 | Reduced motion at the OS level (read at mount; reload after changing it) | All | | |

### 4.2 Device and playtest gates (SC-R11)

| # | Check | How | Result |
| --- | --- | --- | --- |
| D-1 | Real-tablet profiling of a release build with `?lai-diag=1` | `docs/PILOT_READINESS.md` 5b; fill the blank tables | |
| D-2 | Sprouts playtest, one SPROUT per session, adult observer, `quills-picture-story` | `docs/PILOT_READINESS.md` 5b | |

### 4.3 Owner decisions this branch carries

1. RESOLVED: ADR-065 (Castle Director) is Accepted (owner, 2026-11-18), and the event catalog is
   the ADR-047 revisioned Django model (`regions.0008`, `0009`).
2. Where Quill flavour (SC-R09-02, service only) surfaces, if at all.
3. RESOLVED (SC-final-B, owner approved): the Writing Room has a write-your-story action, Keeper Quill
   is placed there, Sprouts can enter, and `entryRequirements` stays in the shared manifest schema
   (documented in `docs/engine/03_GENERIC_3D_WORLD_RUNTIME.md`).
4. Ranks (O-12).
5. `assetLoader.trim`, live reduced-motion handling, kit-piece scaling before any 4 m room.
6. RESOLVED (SC-final-B): the Writing Room no longer waits on the Explorer secret-door arc (chapter 1
   has a `number-input` step); it is open to every child, and earned progress keeps its own door.
7. Draw-call estimate is now 300 of 300 (SC-R08-02): raise the budget or merge decor before any more
   castle scenery, including optional chamber platforms. Chamber proposals not built: a graded puzzle
   at the sealed round door and a second hidden Storybook page (deferred, needs owner curriculum
   approval; see the reboot roadmap section 8). Final F built one optional reward: the mouse door find
   grants `tiny-brass-knob` once through the existing DISCOVERY reward rule (no new pedestal; the star
   find stays quiet).
8. SC-R07 deviations: the six gold plates removed for the draw budget; Hall of Heroes 3D plates
   deferred (scenery 159 of 160, draws then 298 of 300, now 300): raise the budget or merge decor.
9. Earlier Secret Door finishers get no `secret-door-key` without an approved backfill.
10. Retirement (SC-R10-03): Phaser castle and Writing Room stay until parity is visually confirmed
   and LAI-2303 (Sprouts gate) allows it.
11. RESOLVED: formatting. GE-090-D6 (PR #50) ran Prettier and Ruff across the repository, castle
   files included, with no change to behaviour.

### 4.4 Focused owner QA on `main` (2026-11-23)

The castle is now on `main`. This is the short pass for desktop, touch and accessibility. It
points at the O-items above rather than repeating them. Tick a line only after you have played
it yourself. Use the local stack with fake providers and run section 4.0 first.

**Before you start: sound setup.** GE-090-D7 (PR #63, merged into `main` at `1b0a50a3` on
2026-11-23) fixed the two castle defects that blocked this pass. The castle now loads its sound
from the Place `storykeeper-castle` (it used to request a region manifest that answered 404).
Keeper Quill's "Talk to" reach is now measured from the child rather than the trailing camera.
For sound, assign the castle cues to the **Place** `storykeeper-castle` in Django Admin (not to a
3D Area), then publish a sound release. With no assignment the castle is silent by design, and
captions still appear.

**Desktop (Chrome, keyboard and mouse)**

- [ ] Q-1 Load `/island/:childId/explore/storykeeper-castle`: no console errors, no failed
      `/api/v1` request (A-9).
- [ ] Q-2 Walk every doorway both ways, Entry Hall to Secret Chamber, in both camera views (the
      "View" button) (A-3, SC-JMP-20).
- [ ] Q-3 Leave from every room, the Writing Room included: the harbor exit is always there and
      never behind arithmetic (O-16).
- [ ] Q-4 Pathfinder: The Painted Words, both word sets, page `page-painted-words` restored, with
      wrong answers on purpose (O-1, O-2, O-3).
- [ ] Q-5 Each primary adventure once by jumping on pads and once by the HUD card only. Every
      answer must be reachable without a jump (O-6).
- [ ] Q-6 Writing Room, one child per band: write and save a story, check it in the adventure log
      and in the parent's Story Keepsakes, then try the Explorer safety refusals (O-15 to O-15b).
- [ ] Q-7 Keepsakes: brush, lens and key on the Trophy Room pedestals. The mouse door in the
      Secret Chamber gives the Tiny Brass Knob once, with no new pedestal (O-10, O-19).
- [ ] Q-8 Quill, Ember and Orion lines before and after restoring a page, in third-person view (O-7;
      D7 reach fix).
- [ ] Q-9 Sound: room beds crossfade, mute and volume persist, captions stay when speech is
      turned off (O-8, O-9; needs the
      Place assignment above).
- [ ] Q-10 Leave mid-tale and return: the tale resumes in its room with its choices (A-15).

**Touch (iPad Safari, or Chrome's tablet emulation as a first pass only)**

- [ ] Q-11 A full Pathfinder visit by touch alone: two-zone drag, the "Things to do" list reaches
      every objective, and the pads and the HUD card both answer (A-12, O-17).
- [ ] Q-12 Sprout: walk in, use the large targets and flat markers (no jump steps), and finish the
      picture story and the Writing Room tap story without help (O-15d, A-20).
- [ ] Q-13 Full screen at phone size (375 x 667): check that an NPC panel does not cover "Exit
      full screen". GE-090-D7 found that it can (`portal-adult-exit:142`, proposed GE-090-D8).

**Accessibility**

- [ ] Q-14 Keyboard only: a full visit with no mouse. Tab order is exit, prompt, backpack, with no
      focus trap, and focus returns to "Talk" after a dialogue closes (A-11, O-17).
- [ ] Q-15 Screen reader (VoiceOver or NVDA): HUD prompts, the session status region and "Back to
      the map" on an error are announced (`5946204f`).
- [ ] Q-16 Reduced motion at the OS level, then reload: nothing sways or drifts, and outcomes still
      show (A-10, O-18).
- [ ] Q-17 Speech off and sound muted: every line is still on screen as a caption, and no step
      needs sound (O-9).
- [ ] Q-18 No timers anywhere: wrong answers loop calmly and no line counts down or says "come
      back tomorrow" (O-2, O-13).

**Device and playtest (unchanged, SC-R11):** D-1 tablet profiling and D-2 Sprouts playtest.

### 4.5 Owner playthrough by area (P-1 to P-16, SC-R12-01)

This is the same pass as 4.4, ordered by castle area, for the owner playthrough on `main`
`1b0a50a3`. Each row says what you should see and what is a known limitation, not a defect.
Every "Expected" line is backed only by unit tests (section 1 and `tasks/TASK_TRACKER.md`).
**None of these rows has been played in a browser, on a device or with a child.** Leave
"Result" blank until you have played the row yourself. Anything that differs from "Expected"
becomes a defect card linked to SC-R12.

Setup: section 4.0 data, the Place sound assignment from 4.4, one child profile per band
(Sprout, Pathfinder, Explorer), and `/island/:childId/explore/storykeeper-castle`.

| # | Area | How | Expected | Known limitations | Covers | Result |
| --- | --- | --- | --- | --- | --- | --- |
| P-1 | Castle entry and hub navigation | Load the castle, walk from the Entry Hall into the Story Hall, open the castle guide | You arrive in the Entry Hall. The Story Hall is the hub. The guide lists the rooms you can see, and no failed `/api/v1` request appears | The castle's sound is silent until castle audio files are uploaded and assigned to the Place (none exist yet) | A-1, A-3, A-9, Q-1 | |
| P-2 | Room transitions | Walk every archway both ways, in both camera views | Each archway is open, nothing seals behind you, the room bed changes in a room (not in a doorway), and the Secret Chamber stays hidden until the tapestry nook is found | The door sound plays only when assets exist | A-3, Q-2 | |
| P-3 | Great Library | Explorer: the clue wall (order the clues), the bookshelf secret door, the Storybook dais | Clues are seated by walking or by the HUD card, the secret-door arc runs chapters 1 to 3, and earlier finishers keep their door and key | Earlier finishers do not get `secret-door-key` without an approved backfill (4.3 item 9) | A-6, O-15c | |
| P-4 | Trophy Room | Before and after earning keepsakes | Earned keepsakes (brush, lens, key and the existing three) stand on their pedestals, and an unearned pedestal is bare with a calm line. The castle shows keepsakes and never grants them | Hall of Heroes 3D plates are deferred (draw budget); the Hall of Heroes is the text list in the guide | A-17, O-10, O-11, Q-7 | |
| P-5 | Observatory (in the Setting Tower) | Walk up to the telescope, the orrery and the star chart; talk to Professor Orion | Each object gives a short read-aloud message with nothing graded. Orion stands in the corner behind the second star stone, not on it | Orion uses the `npc-professor-ticktock` stand-in model until a commissioned one replaces it; owner confirms Orion (SC-R05) | O-7, O-6 | |
| P-6 | Planner (the guide's "Go to" map) | Use "Go to" for every room, including a room behind a shut door, and the room you are in | You are placed in the room, facing its middle. A shut door gives its hint, a hidden room says "That room is not on the map.", and the room you are in says "You are already in" that room | Discovery does not gate travel on purpose: arriving marks a room discovered | A-11, A-12 | |
| P-7 | Great Storybook in 3D | Look at the book on the Great Library dais before and after restoring a page | The cover is torn until the band's required pages are back, then whole. Each restored page shows in its slot, and the hidden bonus page shows once found. A book restored in an earlier edition keeps its sealed cover, and the new page is drawn loose | The book shows three required slots and one bonus slot (a test holds the registry to this) | A-16, O-3, O-4 | |
| P-8 | The Painted Words | Pathfinder in the Illustration Studio: rhyme gallery, beginning-sound hunt, syllable workshop, restoration; then replay | The page `page-painted-words` comes back. The replay serves the second word set, and wrong answers loop calmly with no timer | Pad answers need standing still for 0.7 s, so a hop answers nothing (by design) | O-1, O-2, Q-4 | |
| P-9 | Story pages and replay | Open the guide's Storybook section; replay a finished adventure | Each page shows one of four states: Not found yet, You know where to look, You have started this one, Back in the book. A replay does not re-grant a page or a keepsake. A session left open resumes in its room with its choices | Pages are derived from records only; there is no page store to inspect | A-5, A-15, A-16, O-3, Q-10 | |
| P-10 | Jumping and third-person movement | Each primary adventure once by jumping onto pads and once by the HUD card only; switch "View" | The hop is lower than outdoors, the camera stays under the ceiling and inside the room, and every answer can be given without a jump. Sprouts see flat floor markers and no jump steps | Jumping is optional in the castle by owner direction; the movement tutorial (SC-JMP-06) is not shown | O-6, Q-5, SC-JMP-20 | |
| P-11 | Collision handling | Walk into walls, NPCs, furniture and door frames; try to jump over a wall; step off a pad | Nothing passes through a wall or a door frame, and no wall is jumpable. Keeper Quill and Professor Orion have colliders. A fall or an invalid position returns you to the last safe floor, and recovery never changes progress | The shared engine's GE-L16 change (#59, raised Solid clearance) is in `main`, and the castle's engine and movement tests pass with it; it has not been walked in a browser | A-3, SC-JMP-02 | |
| P-12 | NPC interactions | Talk to Keeper Quill (Story Hall), Ember (beside the hearth, once she visits) and Professor Orion, before and after restoring a page, in third-person view | The "Talk to" prompt appears when you stand next to the character, and lines follow progress. Quill's afternoon line is heard once, in an afternoon | Ember appears only after `seed_npc_ember --publish` and her progress gate; final models and clips are owner TODOs | O-7, O-15e, Q-8 | |
| P-13 | Audio cues | With the Place assignment and a sound release: walk every room, open the Storybook, answer right and wrong, mute, change volume, turn speech off | Room beds crossfade (one at a time), the story theme plays while the Storybook is open, and right, hint and try-again cues play (Sprouts hear no try-again sound). Mute and volume persist, and captions stay with speech off | **No castle audio files exist yet** (`docs/audio/STORYKEEPER_CASTLE_AUDIO.md` section 4), so beds and castle cues are silent and only shared cues can be heard. Ambience is not ducked under speech by design. Voice consent is an open owner decision | A-18, O-8, O-9, Q-9, Q-17 | |
| P-14 | Rewards and progression | Finish The Painted Words and the Secret Door arc; find the mouse door in the Secret Chamber | Keepsakes are granted once by the server's reward rules. The mouse door gives the Tiny Brass Knob once, with no new pedestal. A forged world-change POST for a page key is refused | Ranks ship switched off (`CASTLE_RANKS.enabled = false`): keep or drop is an owner decision. `backfill_castle_keepsakes --apply` is run per environment by the owner | A-17, O-5, O-10, O-12, O-19 | |
| P-15 | Returning to the hub | From each room, use the guide's "Go to" for the Story Hall; leave the Writing Room by its door; come back from the map | You arrive in the Story Hall. The Writing Room's exit returns you to the castle. Coming back later resumes at your saved checkpoint | Storybook 3D adventure portals (SC-JMP-04) are not built: pages lead to their room, not into a story world | A-15, O-15, Q-3 | |
| P-16 | Child-safe adult exit | From every room: "Leave island", then the adult exit; once mid-encounter and once mid-answer; at phone size (375 x 667) in full screen | "Leave island" is always reachable and never behind arithmetic. It asks "Leave the island now?" only while an encounter is open, saves before leaving, and goes to the Realm Explorer. The adult exit goes to the parent space (no check, owner decision 2026-11-10). After leaving mid-answer and coming back, the answer is recorded once or not at all, never twice | At phone size in full screen an NPC panel can cover "Exit full screen" (`portal-adult-exit:142`, proposed GE-090-D8, shared portal code, not castle code) | O-16, Q-3, Q-13 | |
