# Treasure Rush: Owner Playtest Checklist

For the owner's manual playthrough of Treasure Cove on branch `quest/tr.reboot`. Nothing below
has been verified in a browser: the development checks were unit, API and typecheck only
(`docs/TREASURE_RUSH_ROADMAP.md` section 20). A tick here is what turns "pending owner
playtesting" into a result. **TR-9 and final acceptance stay open until you record them.**

Setup: `docs/TREASURE_RUSH_LOCAL_DEV.md` (local Django on PostgreSQL, `VITE_BACKEND=django`,
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

## Feel (write down what you notice)

- [ ] The cove takes about 10 to 15 minutes at your pace. How long did it take? _____
- [ ] Fireflies, shimmering water, Pip's hop or wave: pleasant, or too much? Any motion sickness? With reduced motion on, does everything hold still?
- [ ] Is anything too small to tap, too fast, or hard to find for the younger bands?
- [ ] Frame rate on the tablet you care about: ______ (the cove draws many things)
- [ ] The aim assist numbers (3 m, 40 degrees): comfortable?
- [ ] Sound: there is none yet. Do you want it (TR-19), and where should the setting live (TR-D26)?

Record results beside each item, and anything surprising, in `docs/IMPLEMENTATION_STATUS.md`
under TR-9.
