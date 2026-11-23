# Heart of Firepeak: local launch and owner QA checklist (FPV-24)

Status: **prepared, not executed.** The Heart of Firepeak is on `main` (GE-090, PR #44; checked
again at `aa8adb33`, 2026-11-23). Nothing here has been run in a browser by a development session.
Every check is for the owner. FPV-24 is never marked Complete without the owner's own acceptance.

Each line has an id, what to do, and what passes. Record pass, fail or skip with a note per id.
"Both bands" means once as a Pathfinder and once as an Explorer.

## 1. Launch locally (about 10 minutes)

Prerequisites, Cognito settings and the Django Admin account: `docs/TREASURE_RUSH_LOCAL_DEV.md`
sections 1, 3 and 5. Branch: `main` (or any branch at or after `aa8adb33`). The database is
PostgreSQL 18 (`make up`); an old PostgreSQL 16 volume cannot be reused.

```bash
make py-install && make up && make migrate      # repository root; regions 0007 adds the puzzle kinds
cd lai
../.venv/bin/python manage.py load_content                # includes the Heart of Firepeak export
../.venv/bin/python manage.py seed_firepeak_heart         # the 3D Area, puzzles, pickups, assets (DRAFT)
../.venv/bin/python manage.py publish_firepeak_heart      # development only: validates, then publishes
../.venv/bin/python manage.py seed_firepeak_sound         # optional: cues need published audio assets
../.venv/bin/python manage.py seed_npc_firepeak           # optional: NPC Manager characters (DRAFT)
../.venv/bin/python manage.py ensure_content_roles        # Content editors and publishers
cd ..
make runserver                                            # Django on 127.0.0.1:8010
make web                                                  # the app (another terminal)
```

Sign in as the test parent and create or choose a **Pathfinder (5 to 6)** and an **Explorer
(7 to 8)** child. Open the Realm Explorer and choose **Heart of Firepeak**, or go to
`/island/<childId>/explore/firepeak-heart`. Re-running `seed_firepeak_heart` never overwrites
rows; the scene ships as `firepeakHeartVersion` 5, which the seed upgrades in place.

Scoring (XP, coins, levels) is off by default (`LAI_SCORING_ENABLED=false`) and is not part of
this QA. Rewards here are the Firepeak crystals, shards, badges and journal entries.

Audio: without `seed_firepeak_sound` and published audio assets every cue is silent by design
(the cue ids are wired; no audio files are committed). Mark audio lines "skip: no assets" in
that case.

## 2. Checklist

### A. Discovery and entry
- [ ] A1 Realm Explorer: Heart of Firepeak shows the volcano theme, "1 adventure", no "coming soon".
- [ ] A2 A Sprouts child does not see the Area or its adventure.
- [ ] A3 Entering puts the child at Explorer's Landing. Firepeak Volcano (The Volcano Awakens) still plays as before.

### B. Movement, jumping, camera (desktop, touch, gamepad)
- [ ] B1 Walk, run, sprint. The camera stays with the child. The child cannot pass gates, cave walls or rocks.
- [ ] B2 Space, the Jump button or gamepad A jumps once (no double jump). Landing on logs and platforms is reliable.
- [ ] B3 **No-jump route.** Play the whole required route without pressing jump: walk around the landing log, cross the lava on the basalt bridge, use the cavern stairs and the summit stairs. The quest completes.
- [ ] B4 The optional lava stepping stones (east side, x about 18) can be reached.
- [ ] B5 After the forge switches, the forge lift rises. The summit hop route and the moving platform are optional.
- [ ] B6 The child cannot leave the playable area at any edge.

### C. Hazards, checkpoints and recovery
- [ ] C1 **Lava.** Walk into the lava. Pass: "Whoa, the lava is too hot!" shows with a short fade, the child is back at the last checkpoint reached (the near bank if none), and nothing earned is lost.
- [ ] C2 Jump from stone to stone over the lava: no respawn while in the air.
- [ ] C3 **Crumbling stone** (`fh-stone-vanish`, optional stepping stones). Stand on it. Pass: it shakes for about 1 s, falls, is gone about 2.5 s, then comes back. Falling with it into the lava is a normal C1 recovery.
- [ ] C4 **Steam.** Before the forge is restored, walk into the steam in front of the summit gate. Pass: a gentle push back toward the Forge (walking still wins), never toward the lava. After the forge is restored the steam is gone and the gate opens.
- [ ] C5 **Falling rocks** (optional summit hop route only). Pass: each rock gives a visible ground mark and a rumble about 2 s before it lands, only one gap is active at a time, and standing on a hop is always safe. A hit says "Oops, a pebble tumbled down!" and returns the child to the foot of the summit. The summit stairs never see a rock.
- [ ] C6 **Reduced motion** (OS setting). Lava and steam are still, gears do not spin, the steam push is half as strong, and the respawn fade clears (does not stay on screen).
- [ ] C7 **Resume.** Leave mid-adventure, after the lava bridge, and come back. Pass: the child starts at the furthest checkpoint reached (one of the eight: Landing, Emberwood, near bank, far bank, Caverns, Forge, foot of the summit, Heart Chamber). Built bridges stay built.

### D. Story, NPCs and dialogue
- [ ] D1 Flint greets, explains the map and offers "The Heart of Firepeak". Accepting starts the quest.
- [ ] D2 Kindle (Emberwood, Heart Chamber), Professor Basalt (Caverns, Summit), Cinder (Forge) and Ignis (Heart Chamber) speak lines that fit the child's age. Basalt's facts start from real science, and magic is called island magic.
- [ ] D3 Captions show when voice is off or unavailable. No NPC claims to be a person or asks private questions.
- [ ] D4 Only if a Firepeak NPC release was published: Flint's "Yes, I will help!" accepts the quest, and Ignis still offers the return step.

### E. Learning encounters (both bands)
- [ ] E1 Landing map: tap the places Flint asks for.
- [ ] E2 Emberwood pattern and counting: every option shows a symbol and a label (never colour alone).
- [ ] E3 Lava numbers: choose the stone with the right answer (tap it in the world or use the panel). The basalt bridge appears.
- [ ] E4 A wrong answer gives kind feedback and keeps the same question. A hint appears after two tries or on request. "Try a different one" changes the question.
- [ ] E5 Lava compare, cavern shapes, crystal arrangement (ordering with tap, undo and clear; the keyboard works).
- [ ] E6 Forge switches (switch sounds if audio is present) and circuit path. The forge is restored and the summit gate opens.
- [ ] E7 Summit rock samples and island story. Professor Basalt's science note shows on success.
- [ ] E8 Pathfinder questions are clearly easier and shorter than Explorer questions.

### F. Finale, rewards and replay
- [ ] F1 Heart Chamber: order the four crystals, watch the restoration (a fade under reduced motion), return to Ignis. Celebration, the Heart of Firepeak badge, quest complete.
- [ ] F2 The backpack shows the four elemental crystals, the badges (First Steps, Emberwood Explorer, Master of the Forge, Volcano Scientist, Heart of Firepeak, Crystal Collector) and the journal entries.
- [ ] F3 Collect all seven ember shards (hidden, elevated, Lava Jumper, Summit Explorer). Firepeak Master Explorer appears once.
- [ ] F4 Re-solving a finished puzzle says "Practice" and gives no new rewards. Re-entering after completion allows free exploration.
- [ ] F5 **Persistence.** Sign out, sign in, open the same child: crystals, badges and the completed quest are still there. The parent dashboard shows the activity by skill.
- [ ] F6 The return portal takes the child back to the Landing. "Leave" returns to the Realm Explorer, which shows "Completed".

### G. Staff authoring (Django Admin)
- [ ] G1 Under 3D Area puzzles, edit a Heart of Firepeak puzzle as a draft (change a variant's prompt), validate and publish. A child mid-visit keeps the pinned version.
- [ ] G2 A non-staff account cannot open or publish puzzles.
- [ ] G3 Content assets with tag `firepeak-heart` are listed. Uploading a GLB per `FIREPEAK_ASSET_INVENTORY.md` replaces the stand-in on the next visit.

### H. Devices and performance
- [ ] H1 Tablet (touch): stick, look, Jump button, large puzzle buttons, no page scroll.
- [ ] H2 The frame rate is acceptable on the target tablet across the whole Area (no measurement has been made).

### I. Not in this QA (known, by decision)
- Great Storybook page and Trophy Room pedestal for Firepeak: not registered in the castle
  (`STORYKEEPER_INTEGRATION.md`, owner decision pending).
- Production GLBs and audio: stand-ins and silent cues until the owner supplies assets.

## 3. After QA

Report failures by id. Browser E2E (Playwright), Ruff, Prettier, ESLint, full suites and builds
are merge or release gates and run only when authorised.
