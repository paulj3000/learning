# Treasure Rush: Owner Playtest Checklist

## Release playthrough (LAI 01, updated 2026-11-26 for the redesign): do this section first

**Status: not yet played. Treasure Rush is not owner-accepted.** The 2026-11-26 gameplay redesign
(issue #102, Trello #258) replaced the chest questions with five play stages: **play section F
first**; it replaces the old A8, B1 and B2. The design is in
[TREASURE_RUSH_GAME_DESIGN.md](TREASURE_RUSH_GAME_DESIGN.md). The checks behind this list are
unit, API and engine tests, and static checks. Final child-facing acceptance (TR-21) stays open
until you record your results here.

**Build:** `main` with the redesign PR (`feature/treasure-rush-gameplay-redesign`) merged, or that
branch itself. Before the merge you can check out the branch in step 1 instead of `main`. It
includes D7 (#63), D8 (#67), TR-D9 (#74) and the Asset Library work (#80 to #90). Allow about 45 minutes. Play on a tablet with one Pathfinders
child (5 to 6). If you can, do a second pass with a Sprouts child (3 to 4), and a third with an
Explorers child (7 to 8) for the questions. Write pass, fail or blocked beside each item, with
the device and a note.

### What this playthrough cannot check yet

These items are marked **Blocked** below. Don't record them as passed or failed until their
dependency exists.

| Blocked item | Why | What unblocks it |
|---|---|---|
| Every audible check (section D, items D1 to D6) | No audio file exists for any of the 16 required cues; `seed_treasure_rush_sound --dry-run` reports `ASSET NEEDED` for all 30 cues. The game is silent by design until audio is published. | Licensed files uploaded and a sound release published: `docs/audio/TREASURE_RUSH_AUDIO_INVENTORY.md` |
| Pip's spoken voice (D5) | Pip's lines are spoken by Amazon Polly through Django, a live AWS service. Locally speech is `disabled`, so Pip shows captions only. | Your decision to run with `LAI_SPEECH_PROVIDER=polly` (AWS) |
| Real palms, barrels, logs, campfire and vegetation (C3) | These models are external, owner-supplied GLB packs (`docs/GAMEPLAY_ENVIRONMENT_QA.md`, "External GLB files"); none are in Git. | The optional import in setup step 5 |
| Points, XP and coins (B5, optional) | `LAI_SCORING_ENABLED` is off by default and the economy is not owner-approved. | Only if you choose to turn it on locally |

Not blocked, but needs an outside service: sign-in uses the existing Amazon Cognito user pool
with a **test** parent account (ADR-040). That is your own browser sign-in, not an agent call.

### Setup (copy and paste)

Run from the repository root of your main checkout unless a step says otherwise.

**1. Check out the right commit**

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git log --oneline -1          # expect 05b54d8a or later
```

**2. Python environment and PostgreSQL 18**

```bash
make py-install               # first time only: creates .venv
make up                       # PostgreSQL 18 on 127.0.0.1:5432 (docker compose service db)
```

**3. Django migrations**

```bash
make migrate
```

**4. Content, Treasure Cove, Pirate's Leap and Pip**

```bash
cd lai
../.venv/bin/python manage.py load_content
../.venv/bin/python manage.py seed_treasure_rush          # Treasure Cove and Pirate's Leap, as drafts
../.venv/bin/python manage.py publish_treasure_rush       # validates, then publishes them
../.venv/bin/python manage.py seed_npc_pip --publish      # the managed Pip (NPC release 1)
../.venv/bin/python manage.py ensure_asset_roles
../.venv/bin/python manage.py ensure_sound_roles
../.venv/bin/python manage.py seed_treasure_rush_sound --dry-run   # expect ASSET NEEDED for every cue
cd ..
```

On a fresh database, `seed_treasure_rush` reports 70 rows and `publish_treasure_rush` reports 39
(the 11 stage puzzles are among them: `published puzzle cove-map-piece-1` and so on). Both are
safe to run again. On a database seeded before the redesign, `seed_treasure_rush` adds the stage
objects and puzzles and reports `adventure v2`; then run `publish_treasure_rush` again. Children's
progress is kept. Check the stage skills with `../.venv/bin/python manage.py
puzzle_skill_report --strict` (expect `0 unmapped puzzle skill(s).`).

**5. Local asset storage**

Nothing to configure. With no `LAI_ASSET_STORAGE` set, files go to `lai/.asset-storage/` and are
served by Django (`LAI_ASSET_DELIVERY=django`). Make sure your root `.env` does not set
`LAI_ASSET_STORAGE=s3`. Pip, the chests and the ground always fall back to the bundled models.

Optional: create a Django Admin account (it asks for a username and password):

```bash
make createsuper
```

Optional: serve Pip, the chest and the ground tile from the Asset Library instead of the bundle.
Afterwards, publish the three versions in Django Admin (Asset library, Asset versions, Publish
selected versions):

```bash
cd lai && ../.venv/bin/python manage.py import_assets --from-bundled --ids npc-pip,treasure-chest,ground-tile && cd ..
```

Optional: if you have the environment packs, import the real palms, barrels, logs, campfire and
vegetation. Do the dry run first. Add `--licence-confirmed --licence-confirmation "<who, when, where>"`
only for packs whose licence you have confirmed. The feather stays a stand-in either way.

```bash
cd lai && ../.venv/bin/python manage.py import_treasure_rush_environment --source /path/to/environment-assets --category all --dry-run && cd ..
cd lai && ../.venv/bin/python manage.py import_treasure_rush_environment --source /path/to/environment-assets --category all --publish && cd ..
```

**6. Start Django** (terminal 1)

The root `.env` needs the test pool's `COGNITO_REGION`, `COGNITO_USER_POOL_ID` and
`COGNITO_ALLOWED_CLIENT_IDS` (`docs/TREASURE_RUSH_LOCAL_DEV.md` step 3). Then:

```bash
make runserver                # http://127.0.0.1:8010
```
```bash
curl http://127.0.0.1:8010/api/v1/health/
```

**7. Start the React frontend** (terminal 2)

```bash
npm install                   # first time only
make web                      # http://localhost:5183/, proxies /api to Django on 8010
```

Check the `[lai] dev` lines: the proxy target is 8010, Django answered, and Cognito is configured.

**8. Parent and children**

1. Open http://localhost:5183/ and sign in as the **test** parent from the Cognito pool.
2. Parent dashboard, **Add a child profile**: a made-up name (for example "Tester P"), age band
   **Pathfinders (ages 5-6)**. Save.
3. Add a second child, "Tester S", **Sprouts (ages 3-4)**. It is used for the second pass and the
   isolation checks. Optional: a third, "Tester E", **Explorers (ages 7-8)**. A parent can have
   at most three children.
4. Use made-up names only; nothing about a real child goes into a test account.

**9. Enter Treasure Rush**

Choose the child, then **Island**, **Pirate Builder Bay**, **Treasure Cove**. The direct address
is `http://localhost:5183/island/<childId>/explore/treasure-rush-cove` (the child id is in the
address bar).

**10. Play the sections below in order.** Starting over: in Django Admin, or with
`make down && docker volume rm <project>_lai_pg18data`, then repeat from step 2. Nothing is
lost that you didn't create for the test.

### F. The redesigned adventure (#102): play this first

Play with a **new** Pathfinders child. Walk to each object and use the button that appears
(Touch, Pick up). Nothing here has a timer. Stand-in shapes (a marker, a stone, a lantern) are
expected where no model exists yet; the signs and crates are real models.

- [ ] **F1.** **No chest asks a question.** Before doing anything else, walk to the chest at the landing
   and open it. **Expected:** "This chest opens by itself when you finish the challenge nearby",
   with Pip's clue about his torn map. No number question, no coins to count.
- [ ] **F2.** **Stage 1, the missing map.** Find the three torn map pieces round the landing (by the
   tent, near the crates, on the way to the dock). **Expected:** each one glows, flies to you and
   says "You found piece 1 of Pip's map!"; it is gone when you come back. Then walk to the
   waymarker sign the map points to and touch it, and choose. **Expected:** the sign glows when
   chosen; the right sign opens the landing chest and shows the Golden Doubloon. The sign's
   options show a symbol (star, circle, triangle) as well as words.
- [ ] **F3.** **Stage 2, Crocodile Creek.** On the grove path, find the creek with stepping stones and
   Snappy the crocodile. Touch the stones in the order the prompt asks (for Pathfinders, numbers
   smallest to biggest, or counting by twos). **Expected:** each stone glows as you add it; Undo
   and Start again work; the right order opens the hidden chest in the grove (the Palm Grove
   Pearl). Stepping into the water does nothing bad: you just walk out.
- [ ] **F4.** **Stage 3, the supply dock.** At Shipwreck Beach, try the cargo crates before you have
   the key. **Expected:** it says to finish the part before this one first, and the chest says it
   needs a key. Pick up the brass key on the X, then walk to the crate that answers Pip's cargo
   question (sharing, adding a load, what is missing, or sorting). **Expected:** the right crate
   opens the locked chest (the Shipwreck Compass).
- [ ] **F5.** **Stage 4, the forgotten cave.** In the ruins, find the three carvings in the corners.
   **Expected:** each says what it shows ("a carved star with 1 dot", "a moon with 2 dots", "a
   triangle with 3 dots"). Then press the three rune stones in the order the riddle gives.
   **Expected:** a wrong order opens nothing and lets you try again; after two wrong tries the hint
   reminds you of the dots; the right order lights the pedestal.
- [ ] **F6.** **Stage 5, Pip's lost treasure.** Light the four torches round the golden chest in the
   order of the adventure (map, creek, dock, cave), or the order the prompt asks. **Expected:** the
   golden chest opens by itself with the Sunstone. It feels like an ending: every clue you found
   was needed.
- [ ] **F7.** **Back to Pip.** Talk to Pip. **Expected:** the quest completes once, with the explorer
   badge, and the bridge to Lookout Point opens (as A9).
- [ ] **F8.** **Age bands.** Replay stages 2, 3 and 5 with a **Sprouts** child, then an **Explorers**
   child. **Expected:** Sprouts cross on 3 stones with dots, fish or frogs, pick crates by simple
   counts or "which has food", and light 3 torches; Explorers cross on 5 stones (add 3, count back
   by 5, doubling), balance and share at the dock, and solve two-step riddles. The island is the
   same for everyone.
- [ ] **F9.** **Kind retries and hints.** Make one wrong choice at the creek and one at the dock.
   **Expected:** nothing opens, the message is kind (no "wrong" in red, no buzzer), you can try
   again or choose "Try a different one"; Hint gives a helpful next step.
- [ ] **F10.** **Replay.** After finishing, go back to the creek and the dock. **Expected:** you can
   play them again as practice, often with different numbers and the answer on a different stone
   or crate; nothing new is added to the backpack, and the score (if on) does not grow from
   practice.
- [ ] **F11.** **Leave and come back mid-adventure.** Leave after stage 2 and come back. **Expected:**
   the map pieces stay found, the landing and grove chests stay open, and the dock is where you
   carry on.
- [ ] **F12.** **An existing child.** With a child who opened chests before the redesign, enter the
   cove. **Expected:** the chests they opened are still open and those stages show as done; they
   carry on from the next chest; their backpack and quest progress are unchanged.
- [ ] **F13.** **Full screen.** Play one stage in full screen on the tablet. **Expected:** the stage's
   panel and the reward appear over the game, and "Exit full screen" still works (LAI 04's
   fullscreen work, #101, keeps these panels as fixed layers).
- [ ] **F14.** **Fun.** Write down, in a sentence, whether it felt like an adventure rather than a quiz,
   and which stage was the best and the weakest.

**Blocked in F:** none. **Not in this build** (deferred; don't fail F for them): jumping onto the
creek's stones (it is walk-and-touch for now), dragging map pieces together, Pip speaking each
stage's intro aloud, and a cave interior ([design, "Deferred"](TREASURE_RUSH_GAME_DESIGN.md)).

### A. Functional gameplay

- [ ] **A1.** **Arrival.** **Expected:** you arrive at the dock in the third-person view, facing inland
   toward Pip's camp, and **see** "Pirate Landing. This is Pip's camp." on screen. It is an
   on-screen message, not a spoken line.
- [ ] **A2.** **Zones.** Walk through Palm Tree Grove, Shipwreck Beach and the Ancient Treasure Ruins.
   **Expected:** each zone shows its name once as you enter. The ruins gate and the channel to
   Lookout Point are closed.
- [ ] **A3.** **Moving and jumping.** Walk, run (hold Shift, or use the run setting) and press Jump
   (Space, or the touch Jump button). **Expected:** you hop onto barrels and logs and walk along
   their tops. Walls, the shipwreck, the ruins gate and the edge of the world stop you at any
   height, and running doesn't get you past them.
- [ ] **A4.** **Camera at walls.** Walk into a wall and into the edge of the world, in both views.
   **Expected:** the child and the camera stop together. The camera never stays put while the
   child walks on, and never shows the inside of a wall.
- [ ] **A5.** **Camera button.** "View: ... Change view" is on the HUD in the cove and in Pirate's
   Leap. **Expected:** it switches between third-person and first-person, and the action prompt
   still names the one thing you face ("Open: Treasure chest").
- [ ] **A6.** **Talking to Pip.** Walk up to Pip in the third-person view. **Expected:** "Talk to
   Pirate Pip" appears (the D7 fix). Tapping it, tapping Pip or pressing E opens his
   conversation, and he turns to face you. On a first visit he greets you once; later visits get
   "welcome back". Captions show for every line.
- [ ] **A7.** **Accepting the quest.** Choose "Maybe later", then talk again and choose "Yes, I will
   help!". **Expected:** "Maybe later" starts nothing. "Yes" starts Pip's Missing Treasure. Pip
   confirms it and shows its steps and clue (the TR-D9 fix), not the Pirate's Leap offer, and the
   HUD shows "Find Pip's treasures: 0 of 4".
- [ ] **A8.** **Chests in order.** Replaced by section F (the redesign): the chests now open at the
   end of each stage.
- [ ] **A9.** **Finale.** Take the treasure back to Pip. **Expected:** the quest ends once. A message
   says the bridge is mended, the gate's bars rise, and a lit bridge appears. You can walk to
   Lookout Point and back without stepping off the sides.
- [ ] **A10.** **Pirate's Leap with jumping.** Learn to Leap, Barrel Crossing, the Fallen Log Trail
   (run, then jump), the Moving Dock, then the gold plate that wakes the Pirate Lift up to the
   crow's nest. **Expected:** after a fall you come back gently, with no penalty and no lost
   progress. Pip offers Pirate's Leap only after Pip's Missing Treasure is finished.
- [ ] **A11.** **Pirate's Leap without jumping**, with the second child: walk round the pool to the
   crow's nest and solve Pip's riddle drum. **Expected:** the plank bridge over the barrel pool
   appears straight away, without leaving the area. No arithmetic gate stops you leaving.
- [ ] **A12.** **Leaving and coming back.** Leave mid-quest by "Go back to the harbor", then by the adult
   exit (one confirmation). **Expected:** you land at the harbor each time and can come back in.
- [ ] **A13.** **Full screen on the tablet.** Open Pip's panel in full screen. **Expected:** "Exit full
   screen" and the harbor link can still be tapped, and "Maybe later" can be reached. Repeat on
   a phone if you have one (375 by 667): since D8 (#67), Pip's panel no longer covers "Exit
   full screen".
- [ ] **A14.** **Missing assets.** **Expected:** nothing is a hole or a pink box. Pip and the chests are
   always real models. Rocks, ferns, coconuts, the key, the pedestal, the bridge, the lanterns
   and the feather are tidy stand-ins.

### B. Educational outcomes

- [ ] **B1.** **Learning suits the age band.** Replaced by F8 (the redesign): no chest asks a question
   any more.
- [ ] **B2.** **Wrong answers are kind.** Replaced by F9 (the redesign).
- [ ] **B3.** **Hints.** Use Hint once. **Expected:** it gives the next step and never pops up on its
   own.
- [ ] **B4.** **Parent view of learning.** After the play, open the parent dashboard for that child.
   **Expected:** "Skills practiced" and "Mastery by area" include the skills the child answered
   (counting, addition or subtraction within ten), right and wrong answers both counted. There
   is no transcript of what the child typed. (Not yet checked in a browser.)
- [ ] **B5.** **Points (optional).** **Expected with the default settings:** no points, stars, XP or
   coins appear. **Blocked** for the XP economy itself: it is off and not owner-approved. Only if
   you turn scoring on locally should a score notice appear, after the server confirms, not on
   the tap.
- [ ] **B6.** **Calm engagement.** **Expected:** no timers, countdowns, streaks or nudges to stop.

### C. Visual quality

- [ ] **C1.** **Look and frame rate.** Frame rate on your tablet: ____. Note anything too small, too fast
   or too hard to find for the youngest band.
- [ ] **C2.** **Reduced motion.** Turn it on. **Expected:** Pip doesn't hop, and the water and fireflies
   hold still.
- [ ] **C3.** **Real models.** **Blocked** unless you did the optional pack import in setup step 5.
   After the import, the palms, barrels, logs and campfire draw as real models, with the right
   size and nothing floating or sunk.
- [ ] **C4.** **Pip's animations.** **Expected:** Pip idles, talks and waves. He waves instead of
   cheering or pointing; there are no Cheer or Point clips yet (known).
- [ ] **C5.** **Text and tap sizes.** Read every panel on the tablet. **Expected:** large buttons, no
   cut-off text, captions readable, no em dashes in child-facing copy.

### D. Audio

**All of section D is Blocked today**: no Treasure Rush audio file exists
(`docs/audio/TREASURE_RUSH_AUDIO_INVENTORY.md`). Record "Blocked: audio assets missing". Do not
pass these on silence. D0 is the one audio check you can do now.

- [ ] **D0.** **Silence is safe (can be done now).** Play the whole of section A without audio.
   **Expected:** nothing waits for sound, nothing errors, every message and caption shows.
- [ ] **D1.** **Blocked.** Zone ambience: ocean at the Landing and Beach, jungle in the Grove, cave in
   the Ruins, wind at Lookout Point. One bed at a time, never doubled.
- [ ] **D2.** **Blocked.** Music: exploration from entry, puzzle music at the runes, victory once at
   the finale, then exploration again.
- [ ] **D3.** **Blocked.** Effects: chest open and reveal once together, key found, a soft correct, a
   gentle retry (never a buzzer), puzzle solved, quest complete, bridge open.
- [ ] **D4.** **Blocked.** The Sound button: mute silences everything at once and stays muted after a
   reload; leaving the cove stops its sound.
- [ ] **D5.** **Blocked (Amazon Polly).** Pip's voice: closing Pip's panel stops his voice.
- [ ] **D6.** **Blocked.** Optional effects: jump, landing, footsteps and platforms are soft and not
   tiring.

### E. Persistence and replay

- [ ] **E1.** **Progress is kept.** After A12, **expected:** on return the opened chests, the key and
   the quest stage are kept. Nothing is celebrated twice.
- [ ] **E2.** **Backpack.** Open the backpack. **Expected:** the four treasures and the Explorer Badge,
   each once. Replaying, or opening a chest again, never adds a second.
- [ ] **E3.** **Spyglass before the quest.** **Expected:** "not yet" (if you can reach it).
- [ ] **E4.** **Spyglass replay.** After the quest, look twice and answer once wrong and once right.
   **Expected:** each look asks a new question, a wrong answer can be retried, and a right one
   thanks you and offers "Play again". It never opens like a chest, gives no reward, and the
   backpack doesn't change.
- [ ] **E5.** **Coming back later.** Sign out, sign in, and enter the cove again. **Expected:** the
   bridge is already there with no new celebration, and Pip doesn't ask you to start the
   finished quest again.
- [ ] **E6.** **Another child.** Switch to the second child. **Expected:** they start at zero: no
   bridge, no treasures, Pip's quest offered fresh. Realm Explorer counts Pip's Missing Treasure
   and Pirate's Leap as completed only for the child who finished them.

### Known issues (expected; don't fail the playthrough for these)

- **No audio files:** section D is blocked (above). This is tracked separately from gameplay
  defects.
- **Stand-in art:** the treasure key, the pedestal, rocks, ferns, coconuts, the bridge and the
  lanterns. Pip has no Cheer or Point clips.
- **Feather:** stays a stand-in until a properly licensed replacement is published (owner decision
  2026-11-25). The CC-BY-4.0 model is not published.
- **Legacy quest** `treasure-rush-cove` is still active. No child is offered it. Retirement is
  prepared in `docs/TREASURE_RUSH_LEGACY_QUEST_RETIREMENT.md`, to run only after you authorize it
  following this playthrough.
- **The dev VM's browser runs are unreliable** (the network adapter cycles). That doesn't affect a
  manual playthrough on your own device.

### Recording results

Write pass, fail or blocked beside each item, then tell LAI 01. A failure gets a defect with
evidence. Results go under TR-21 in Trello and in `docs/IMPLEMENTATION_STATUS.md`.

The older checklist below is kept for history and detail. Two lines in it are stale: the
`quest/tr.reboot` branch, and "Sound: there is none yet" (sound is implemented, TR-19, but no
audio file exists yet).

## Original checklist (2026-11-02)

For the owner's manual playthrough of Treasure Cove on branch `quest/tr.reboot`. Nothing below
has been verified in a browser: the development checks were unit, API and typecheck only
(`docs/TREASURE_RUSH_ROADMAP.md` section 20). A tick here is what turns "pending owner
playtesting" into a result. **TR-9 and final acceptance stay open until you record them.**

**Automated since 2026-11-02 (POST-MERGE-05).** `npm run test:acceptance`
(`react/e2e/acceptance/treasure-rush.spec.ts`) now plays the whole adventure in Chromium against a
local Django, desktop and tablet: quest offer and acceptance, all four encounters in order with a
wrong answer and a wrong stone, the early-chest and early-stone refusals, the key, the finale,
the gate before it and the bridge after it (walked, sides holding), the spyglass replay with no
reward, the backpack, persistence after a reload, keyboard, tap and touch-drag control, full
screen, and exit. What it cannot judge is yours: how it feels, motion, frame rate on your tablet,
tap sizes for the youngest band, timing, and sound. Leave the boxes for your own playthrough.

Setup: `docs/TREASURE_RUSH_LOCAL_DEV.md` (local Django on PostgreSQL,
`publish_treasure_rush`). An existing local cove gets layout v4 from `seed_treasure_rush` and a
new migration (`regions.0004`) from `migrate`. Use one child per age band if you can: Sprouts
(3 to 4), Pathfinders (5 to 6), Explorers (7 to 8).

## Movement and controls

- [ ] You arrive at the dock facing inland, Pip's camp ahead, and can walk with keys, mouse, or touch.
- [ ] Walls, the ruins, the shipwreck and the water stop you. You cannot walk off the island.
- [ ] A big action button names what you face ("Talk: Pirate Pip", "Open: Treasure chest"). It goes when you walk away.
- [ ] Hint gives the next step and does not pop up on its own. Backpack, Hint and Exit work, in full screen too.
- [ ] Leaving by Exit and coming back keeps everything below.

## The adventure

- [ ] Pip offers the quest; accepting is your choice. The HUD shows "Find Pip's treasures: 0 of 4".
- [ ] Pirate Landing: the first chest opens after a number puzzle for your age; you get a Golden Doubloon (1 of 4).
- [ ] Palm Tree Grove: the hidden chest appears only after the first; the flowers lead to it (2 of 4).
- [ ] Shipwreck Beach: the locked chest says it needs a key; the key on the X in the sand goes in the backpack; then the chest opens (3 of 4).
- [ ] Ancient Treasure Ruins: read the pedestal; numbers appear on the three stones; a wrong stone says so and gives new numbers; the right stone opens the golden chest (4 of 4).
- [ ] The HUD says to bring the treasure back to Pip; talking to him ends the quest and gives the Explorer Badge.
- [ ] Asking a chest early, or touching a stone before reading the pedestal, is refused kindly.

## Rewards and progress

- [ ] Each treasure is a separate keepsake in the backpack; none appears twice, however often you return.
- [ ] A wrong answer opens nothing and lets you try again with new numbers.
- [ ] Quitting mid-quest and returning keeps opened chests, the key, and the quest stage.

## The bridge and Lookout Point

- [ ] Before the quest ends the gate is shut and the channel stops you. Two planks sink in the water.
- [ ] Right after Pip's finale a message says the bridge is mended; the gate's bars rise and a lit bridge appears.
- [ ] You can walk the bridge to Lookout Point and back, and cannot step off its sides into the water.
- [ ] Lookout Point has the gold flag, palms, lanterns and a spyglass; nothing there traps you.
- [ ] Leave, return later: the bridge is already there with no new celebration.
- [ ] A second child on the same account does not see the bridge until they finish.

## The spyglass (replay)

- [ ] Before the quest ends the spyglass says "not yet" (if you can reach it at all).
- [ ] After: each look asks a new counting question for your age; a right answer thanks you and offers "Play again".
- [ ] It never opens like a chest, shows no reward, and the backpack does not change.

## Pip from the NPC Manager (LAI-NPC-010, -015, -016, -018)

Set up: `seed_npc_pip --publish` (see `docs/NPC_MANAGER_IMPLEMENTATION_PLAN.md`, section 7).

- [ ] There is exactly one Pip at his camp at Pirate Landing; he turns to face you as you come close.
- [ ] Walking up shows "Talk to Pirate Pip"; tapping it, tapping Pip, or choosing him from the list all open the same conversation.
- [ ] First visit: Pip greets you once. Later visits: he says welcome back instead.
- [ ] Pip asks for help; "Yes, I will help!" starts Pip's Missing Treasure (the HUD shows it); "Maybe later" does not.
- [ ] Pip's lines never cover a chest panel or a reward reveal; after you close one, he may say one line (a find, a hint, the finale).
- [ ] Rewards, keys, the finale and the bridge are exactly as without the NPC Manager: nothing twice.
- [ ] With the NPC release retired (or Django off) the old Pip and his old panel are back and the adventure still works.
- [ ] Captions show for every line; with sound muted nothing plays, and closing the panel stops Pip's voice.
- [ ] With reduced motion on, Pip does not hop or wander.

## Feel (write down what you notice)

- [ ] The cove takes about 10 to 15 minutes at your pace. How long did it take? _____
- [ ] Fireflies, shimmering water, Pip's hop or wave: pleasant, or too much? Any motion sickness? With reduced motion on, does everything hold still?
- [ ] Is anything too small to tap, too fast, or hard to find for the younger bands?
- [ ] Frame rate on the tablet you care about: ______ (the cove draws many things)
- [ ] The aim assist numbers (3 m, 40 degrees): comfortable?
- [ ] Sound: there is none yet. Do you want it (TR-19), and where should the setting live (TR-D26)?

Record results beside each item, and anything surprising, in `docs/IMPLEMENTATION_STATUS.md`
under TR-9.
