# Treasure Rush: Owner Playtest Checklist

## Release playthrough (LAI 01, 2026-11-23): do this section first

**Status: not yet played.** Nobody has done this playthrough. The checks behind it are unit,
API and engine tests only (see "LAI 01" in `docs/IMPLEMENTATION_STATUS.md`). Final child-facing
acceptance stays open until you record your results here.

Build: `main` at or after `1b0a50a3` (PR #63, the GE-090-D7 fix for Pip's "Talk to"). Setup is in
`docs/TREASURE_RUSH_LOCAL_DEV.md`. For real palms, barrels, logs, the campfire and vegetation,
run the asset import in `docs/GAMEPLAY_ENVIRONMENT_QA.md`; otherwise the cove shows its
stand-ins. Allow about 30 minutes. Play on a tablet with one Pathfinders child (5 to 6) and,
if you can, a second pass with a Sprouts child (3 to 4). Write pass or fail, the device, and a
note beside each item.

### Starting the adventure
1. [ ] Choose a child, then Island, Pirate Builder Bay, Treasure Cove. **Expected:** you arrive
   at the dock in the third-person view, facing inland toward Pip's camp, and hear "Pirate
   Landing. This is Pip's camp."
2. [ ] Walk through Palm Tree Grove, Shipwreck Beach and the Ancient Treasure Ruins.
   **Expected:** each zone announces its name once as you enter. The ruins gate and the
   channel to Lookout Point are closed.

### Moving and jumping
3. [ ] Walk, run (hold Shift, or use the run setting) and press Jump (Space, or the touch
   Jump button). **Expected:** you hop onto barrels and logs and walk along their tops. Walls,
   the shipwreck, the ruins gate and the edge of the world stop you at any height, and running
   doesn't get you past them.
4. [ ] Walk into a wall and into the edge of the world, in both views. **Expected:** the child
   stops and the camera stops with them. You never see the camera stay put while the child
   keeps walking, and the camera never shows the inside of a wall.
5. [ ] Pirate's Leap with jumping: Learn to Leap, Barrel Crossing, the Fallen Log Trail (run,
   then jump), the Moving Dock, then the gold plate that wakes the Pirate Lift up to the crow's
   nest. **Expected:** after a fall you come back gently, with no penalty and no lost progress.
6. [ ] Pirate's Leap without jumping, with a fresh child: walk round the pool to reach the
   crow's nest. Solve Pip's riddle drum. **Expected:** the plank bridge over the barrel pool
   appears straight away, without leaving the area.

### Talking to Pip
7. [ ] Walk up to Pip in the third-person view. **Expected:** "Talk to Pirate Pip" appears (this
   was the GE-090-D7 blocker), and tapping it, tapping Pip, or pressing E opens his conversation.
   He turns to face you. On a first visit he greets you once; on later visits he says
   welcome back.
8. [ ] Choose "Maybe later", then talk again and choose "Yes, I will help!". **Expected:**
   "Maybe later" starts nothing. "Yes" starts Pip's Missing Treasure, and the HUD shows
   "Find Pip's treasures: 0 of 4". Captions show for every line.

### Completing quest objectives, opening chests and answering questions
9. [ ] Open the Landing chest, then the Grove chest. Pick up the key at Shipwreck Beach and
   open the locked chest. At the ruins, read the pedestal and touch a rune stone. **Expected:**
   each chest asks a question suited to the child's age band. The locked chest says it needs a
   key until you have it. The count goes 1 to 4.
10. [ ] Give one wrong answer at a chest and touch one wrong stone. **Expected:** nothing opens,
   the message is kind, and new numbers appear. Asking a chest early, or touching a stone
   before reading the pedestal, is refused kindly.
11. [ ] Take the treasure back to Pip. **Expected:** the quest ends once. A message says the
   bridge is mended, the gate's bars rise, and a lit bridge appears. You can walk to Lookout
   Point and back without stepping off the sides.

### Earning points and rewards
12. [ ] Open the backpack. **Expected:** four Golden Doubloons and the Explorer Badge, each once.
   Replay, or opening a chest again, never adds a second.
13. [ ] Points. **Expected with the default settings:** no points, stars, XP or coins appear.
   The XP and coins economy (`LAI_SCORING_ENABLED`) is off and not yet owner-approved, and the
   server records completion for scoring. Only if you turn scoring on locally should a score
   notice appear, and it should appear after the server confirms, not on the tap.
14. [ ] Realm Explorer. **Expected:** both quests (Pip's Missing Treasure and Pirate's Leap) count
   as completed for this child only. A second child on the account starts at zero, and the
   bridge is shut for them.

### Replay behavior
15. [ ] Before the quest ends, try the spyglass at Lookout Point (if you can reach it).
   **Expected:** "not yet".
16. [ ] After the quest, look through the spyglass twice and answer once wrong and once right.
   **Expected:** each look asks a new question, a wrong answer can be retried, and a right one
   thanks you and offers "Play again". It never opens like a chest, gives no reward, and the
   backpack doesn't change.

### Returning safely to the hub
17. [ ] Leave mid-quest by "Go back to the harbor", then by the adult exit (one confirmation).
   Come back each time. **Expected:** you land at the harbor, and on return the opened chests,
   the key and the quest stage are kept. Nothing is celebrated twice.
18. [ ] On the tablet in full screen, open Pip's panel. **Expected:** "Exit full screen" and the
   harbor link can still be tapped, and "Maybe later" can be reached.

### Audio, camera and HUD
19. [ ] Sound. **Expected:** zone ambience, Pip's voice, chest and pickup cues, and the victory
   music at the finale. The sound panel's mute silences everything at once and stays muted
   after a reload. Closing Pip's panel stops his voice.
20. [ ] The camera button ("View: ... Change view") is on the HUD in the cove and Pirate's Leap.
   **Expected:** it switches third-person and first-person, and the action prompt still names
   the one thing you face ("Open: Treasure chest").
21. [ ] Models. **Expected:** after the asset import, the palms, barrels, logs and campfire draw
   as real models, with Pip and the chests always real. The feather key stays a stand-in until
   you accept its CC-BY-4.0 licence. Rocks, ferns, coconuts, the key, the pedestal, the
   bridge and the lanterns are tidy stand-ins, not holes.
22. [ ] Feel. Frame rate on your tablet: ____. Is anything too small, too fast, or too hard for
   the youngest band? With reduced motion on, Pip doesn't hop and the water and fireflies hold
   still.

### Known issues (expected; don't fail the playthrough for these)
- **Phones in full screen (proposed GE-090-D8, owned by LAI 05).** At 375 by 667, Pip's panel
  covers "Exit full screen". Closing the panel uncovers it. This is not a tablet issue.
- **Missing art:** the treasure key, the pedestal, rocks, ferns, coconuts, the bridge and the
  lanterns are stand-ins. Pip waves instead of cheering or pointing (no Cheer or Point clips yet).
- **Feather licence:** CC-BY-4.0, held unpublished until you decide.
- **Legacy quest** `treasure-rush-cove` is still `active=True`. It earns no score, but it is a
  content decision for you.
- **Browser runs on the dev VM are unreliable right now:** the network adapter cycles, so
  Playwright can fail for network reasons. That doesn't affect a manual playthrough on your
  own device.

The older checklist below still applies for detail. Ignore two stale lines in it: the
`quest/tr.reboot` branch, and "Sound: there is none yet" (sound is implemented, TR-19).

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
