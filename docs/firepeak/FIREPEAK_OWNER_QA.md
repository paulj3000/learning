# Heart of Firepeak: local launch and owner QA checklist (FPV-24)

Status: **prepared, not executed.** Nothing here has been run in a browser by the development
session. Every check below is for the owner. Do not mark FPV-24 complete without the owner's own
acceptance.

## 1. Launch locally

Prerequisites, Cognito settings and Django Admin account: as `docs/TREASURE_RUSH_LOCAL_DEV.md`
sections 1, 3 and 5. Branch: `feature/firepeak-volcano-adventure`.

```bash
make py-install && make up && make migrate      # repository root; migration regions 0007 adds the new puzzle kinds
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

Sign in as the test parent, create or choose a **Pathfinder (5 to 6)** or **Explorer (7 to 8)**
child (Sprouts children do not see the Area, by design), then open the Realm Explorer and choose
**Heart of Firepeak**, or go to `/island/<childId>/explore/firepeak-heart`.

Re-running `seed_firepeak_heart` never overwrites rows; a layout change ships as a new
`firepeakHeartVersion`, which the seed upgrades in place.

## 2. Checklist

Record pass or fail and notes per line. "Both bands" means once as a Pathfinder and once as an Explorer.

### A. Discovery and entry
- [ ] A1 Realm Explorer shows Heart of Firepeak with the volcano theme, "1 adventure", no "coming soon".
- [ ] A2 A Sprouts child does not see the Area or its adventure.
- [ ] A3 Entering shows Explorer's Landing; Firepeak Volcano (The Volcano Awakens) still works unchanged.

### B. Movement, jumping, camera (desktop, touch, gamepad)
- [ ] B1 Walk, run, sprint; the camera never separates from the child; no walking through gates, cave walls or rocks.
- [ ] B2 Space / Jump button / gamepad A jumps once (no double jump); landing on logs and platforms is reliable.
- [ ] B3 Every required route can be completed **without jumping** (landing log has a walk-around; summit has stairs; lava has the bridge).
- [ ] B4 The optional lava stepping stones (east, x about 18) are reachable; the wobbly stone sinks while stood on and comes back.
- [ ] B5 The forge lift rises after the switches puzzle; the summit hop route and moving platform are optional.
- [ ] B6 The child cannot leave the playable area at any edge.

### C. Hazards and checkpoints
- [ ] C1 Stepping into lava shows a short, kind message and returns the child to the last checkpoint touched; nothing earned is lost.
- [ ] C2 Jumping over lava from stone to stone does not trigger a respawn mid-air.
- [ ] C3 Steam vents block the summit gate until the forge is restored, then disappear.
- [ ] C4 With reduced motion on (OS setting): lava and steam are still, gears do not spin, the respawn flash fades away (does not stay on screen).
- [ ] C5 Leave mid-adventure and come back: the child starts at the furthest zone reached; built bridges stay built.

### D. Story, NPCs and dialogue
- [ ] D1 Flint greets, explains the map, offers "The Heart of Firepeak"; accepting starts the quest.
- [ ] D2 Kindle (Emberwood and Heart Chamber), Professor Basalt (Caverns and Summit), Cinder (Forge), Ignis (Heart Chamber) speak age-appropriate lines; Basalt's facts start from real science and magic is called island magic.
- [ ] D3 Captions show when voice is off or unavailable; no NPC claims to be a person or asks private questions.
- [ ] D4 If a Firepeak NPC release has been published: Flint's "Yes, I will help!" accepts the quest, and Ignis still offers the return step.

### E. Learning encounters (both bands)
- [ ] E1 Map: tap the map places Flint asks for.
- [ ] E2 Emberwood pattern and counting: options show a symbol and a label (never colour alone).
- [ ] E3 Lava numbers: choose the stone with the right answer (tap the stone in the world or use the panel); the basalt bridge appears.
- [ ] E4 A wrong answer gives supportive feedback and keeps the same question; a hint appears after two tries or on request; "Try a different one" changes the question.
- [ ] E5 Lava compare, cavern shapes, crystal arrangement (ordering with tap, undo and clear; keyboard works).
- [ ] E6 Forge switches (switch sounds if audio is present) and circuit path; the forge restores and the summit gate opens.
- [ ] E7 Summit rock samples and island story; Professor Basalt's science note shows on success.
- [ ] E8 Pathfinder questions are clearly easier and shorter than Explorer questions.

### F. Finale, rewards and replay
- [ ] F1 Heart Chamber: order the four crystals, watch the restoration (fade under reduced motion), return to Ignis; celebration, Heart of Firepeak badge, quest complete.
- [ ] F2 Backpack shows the four elemental crystals, badges (First Steps, Emberwood Explorer, Master of the Forge, Volcano Scientist, Heart of Firepeak, Crystal Collector), journal entries.
- [ ] F3 Collect all seven ember shards (hidden, elevated, Lava Jumper, Summit Explorer): Firepeak Master Explorer appears once.
- [ ] F4 Re-solving a finished puzzle says "Practice" and gives no new rewards; re-entering after completion allows free exploration.
- [ ] F5 The return portal takes the child back to the Landing; "Leave" returns to the Realm Explorer, which shows "Completed".

### G. Staff authoring (Django Admin)
- [ ] G1 Under 3D Area puzzles, a Heart of Firepeak puzzle can be edited as a draft (change a variant's prompt), validated and published; a child mid-visit keeps the pinned version.
- [ ] G2 A non-staff account cannot open or publish puzzles.
- [ ] G3 Content assets with tag `firepeak-heart` are listed; uploading a GLB per `FIREPEAK_ASSET_INVENTORY.md` replaces the stand-in on the next visit.

### H. Devices and performance
- [ ] H1 Tablet (touch): stick, look, Jump button, large puzzle buttons, no page scroll.
- [ ] H2 Frame rate acceptable on the target tablet across the long Area (no measurement has been made).

## 3. After QA

Report failures with the checklist id. Browser E2E (Playwright), Ruff, Prettier, ESLint, full
suites and builds are deferred to merge readiness and run only when authorised.
