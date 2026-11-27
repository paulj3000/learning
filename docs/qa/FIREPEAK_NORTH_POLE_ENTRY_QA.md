# Firepeak and North Pole: entry from Realms, owner playtest (#98, #100)

Status: **prepared, not executed.** No development session has run these in a browser. Every
check is for the owner. GitHub #98 and #100 stay open until the owner's playtest passes.

Record pass, fail or skip with a note per id. Content checks beyond entry (puzzles, NPCs,
hazards, rewards) are the existing checklists, referenced by id below:
`docs/north-pole/NORTH_POLE_OWNER_QA.md` and `docs/firepeak/FIREPEAK_OWNER_QA.md`.

## 1. What was wrong

| Issue | What the owner saw | Cause | Fix |
|---|---|---|---|
| #98 North Pole | Realms, North Pole, Start Exploring: "We could not find that island." | Start Exploring on any non-home Realm went to the client world hub (`/worlds/<slug>`). That hub only knows worlds registered in the app (home and Creature Care Cove). North Pole is served by Django alone, so the hub found nothing. Django was correct: the Realm is open and its Area available. | A Realm the app registers no hub for is entered like the home Realm: its Places link to their published 3D Areas and Start Exploring opens the first one (`realmCatalog.ts`). Unlock, season and age band stay Django's decision. |
| #100 Firepeak | Firepeak and the Heart of Firepeak could not be entered. | Django counted an Area as available only when a chest had a published challenge for the child's band. Both Firepeak Areas are made of puzzles and have no chests, so they were always "not available", and Realms hid both Places. | An Area is also available when one of its published puzzles has parameters for the child's band (`discovery.has_puzzle_for_band`). |

One root, two defects: the Realms entry path assumed a Treasure Cove style Area (chests) and a
client-registered world hub. Both adventures were tested by opening their Area directly, never
from Realms. The new tests start from Realms.

Also fixed: an Area's `ageBands` in the Realms data now reports the Area's own bands (Firepeak:
Pathfinder and Explorer), and the world hub says "Realm" instead of "island" and links back to
Realms. Route paths and API ids are unchanged.

## 2. Setting up

Branch `feature/firepeak-northpole-playability` (until merged), PostgreSQL 18.

**Fresh database** (`docker compose down -v` deletes local data first):

```bash
make py-install && npm ci && make up && make migrate
cd lai
../.venv/bin/python manage.py load_content
../.venv/bin/python manage.py ensure_content_roles
../.venv/bin/python manage.py seed_firepeak && ../.venv/bin/python manage.py publish_firepeak
../.venv/bin/python manage.py seed_firepeak_heart && ../.venv/bin/python manage.py publish_firepeak_heart
../.venv/bin/python manage.py seed_north_pole && ../.venv/bin/python manage.py publish_north_pole
../.venv/bin/python manage.py seed_seasonal_events
cd .. && make runserver    # and `make web` in another terminal
```

**Existing development data**: no data change is needed. The fix is code only. If Firepeak or
North Pole were never seeded or published in that database, run the matching seed and publish
commands above; seeds never overwrite existing rows.

**Dependency for N1 to N7:** LAI 07's region catalog fix (PR #110, branch
`feature/mvp-realm-asset-support`) adds the North Pole scenery models (`north-pole-snowy-pine`,
`north-pole-lantern`, `north-pole-candy-cane`) to the catalog the 3D Area is served with. Without
it the village may refuse to load with an unknown-asset error once Realms routes there. Run the
North Pole checks on a build that has both fixes.

Children: one Sprout (3 to 4), one Pathfinder (5 to 6), one Explorer (7 to 8) under the test
parent. Firepeak is for Pathfinders and Explorers only, by design (Firepeak A2).

## 3. North Pole (#98)

- [ ] N1 Pathfinder: Realms shows North Pole as open. Open it: the preview shows North Pole
      Village. Press **Start Exploring**: the child arrives at Santa's Landing in North Pole
      Village. No "could not find" message.
- [ ] N2 Same for a Sprout and an Explorer (R3).
- [ ] N3 Explore the village, talk to Jingle, accept Q01 and solve its first puzzle (S1, S2).
      Move and jump on the village tutorial steps (W4).
- [ ] N4 **Exit.** Use "Leave" in the Area: the child returns to Realms, which says the progress
      is saved.
- [ ] N5 **Re-entry.** Open North Pole again: **Continue Adventure** is offered and returns to
      the same place with Q01 progress kept (P2). Start Exploring also works.
- [ ] N6 Finish the quest line through Q09 for one band (S1 to S7): rewards, the Star finale and
      completion show (P1). Re-enter afterwards: the village is still open for replay.
- [ ] N7 Sign out and in, same child: progress is still there (P4).
- [ ] N8 Seasonal rule kept: in Django Admin set the `christmas` event to WINDOW_ONLY. Outside 1
      Dec to 6 Jan (UTC) North Pole is hidden from Realms and the child's saves are kept (T3).
      Set it back to YEAR_ROUND after the check. (The season decides what Realms lists. Opening
      the Area by a typed URL is not checked against the season, as before this fix.)

## 4. Heart of Firepeak and Firepeak Volcano (#100)

- [ ] F-E1 Pathfinder: Realms, Learning Adventure Island. The Places list shows **Firepeak
      Volcano** and **Heart of Firepeak**, each with an "Explore ... in 3D" link (A1).
- [ ] F-E2 Sprout: neither Firepeak Place is offered (A2).
- [ ] F-E3 Enter **Heart of Firepeak**: the child starts at Explorer's Landing and Flint offers
      the quest (A3, D1). Solve the landing map puzzle (E1).
- [ ] F-E4 **Exit** with "Leave": back to Realms. **Re-entry**: Continue Adventure returns to the
      Heart of Firepeak with progress kept (C7).
- [ ] F-E5 Walk the seven places in order, Explorer's Landing, Emberwood Forest, Lava Crossing,
      Crystal Caverns, Ancient Forge, Firepeak Summit, then the Heart Chamber finale, with the
      existing checks: movement and jumping B1 to B6, hazards and checkpoints C1 to C7, NPCs D1
      to D3, puzzles E1 to E8, finale and rewards F1 to F6.
- [ ] F-E6 Explorer: repeat F-E1, F-E3 and F-E4. Questions are harder than the Pathfinder's (E8).
- [ ] F-E7 Enter **Firepeak Volcano** ("The Volcano Awakens") from the same list; it still plays
      as before (A3).

## 5. What is not finished (do not record as a failure of this fix)

- Every 3D model is a stand-in and no audio files exist: audio checks are "skip: no assets".
  Firepeak's puzzle-complete and Heart-restored sounds are not triggered even with audio
  (`docs/firepeak/FIREPEAK_AUDIO_INVENTORY.md`).
- Scoring (XP, coins, levels) is off (`LAI_SCORING_ENABLED=false`) and not part of this QA.
- Home's "Up next" suggestions still list only Areas with unopened chests, so Firepeak is reached
  from Realms, not from that card.
- North Pole's "Featured" chip appears only from 1 Dec (UTC).
