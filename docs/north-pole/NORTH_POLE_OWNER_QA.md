# North Pole: local startup and owner acceptance checklist (NP-060)

Status: **on `main`** (GE-090 step 22, PR #44; re-checked at `aa8adb33` on 2026-11-23, and the
FPV-D10 re-tag at `f0de1087` on 2026-11-24). Unit
tested only. **Not owner-tested, not browser-verified, not deployed.** Nothing in this checklist
has been ticked by a development session; every item is for the owner. Record pass, fail or skip
per id.

## 1. Local startup (no AWS)

From the repository root of `main` (at or after `f0de1087`, for skill evidence), with Docker running.
`make up` starts PostgreSQL 18 (an old PostgreSQL 16 volume cannot be reused; set
`POSTGRES_PORT` if 5432 is taken):

```sh
make up
make migrate                                     # includes seasons.0001_initial and regions 0007
cd lai
../.venv/bin/python manage.py load_content       # Realm north-pole, Place, NPCs, 9 quests, items, rules
../.venv/bin/python manage.py seed_north_pole    # Area, placements, 27 puzzles, 5 chests, assets (DRAFT)
../.venv/bin/python manage.py publish_north_pole # development only: DEBUG on (local default) and a loopback DB
../.venv/bin/python manage.py seed_speech_voices
../.venv/bin/python manage.py seed_npc_north_pole --publish    # NPC Manager characters (captions without speech)
../.venv/bin/python manage.py seed_north_pole_sound --dry-run  # lists the cues still needing audio
../.venv/bin/python manage.py seed_seasonal_events             # 'christmas': year-round, featured Dec 1 to Jan 6
cd ..
make runserver   # Django on 8010
make web         # Vite on 5183, proxying /api
```

Speech stays fake or disabled locally (`LAI_SPEECH_PROVIDER`); AI hints use the fake provider.
Nothing calls Bedrock, Polly, S3 or Cognito beyond the existing local sign-in configuration.
Scoring (XP, coins, levels) is off by default (`LAI_SCORING_ENABLED=false`) and is not part of
this QA; rewards here are the North Pole badges, trophy, cosmetics, fragments and journal pages.

Suggested order (about 60 to 90 minutes): one Pathfinder full playthrough (sections 3a to 3d),
then a Sprout and an Explorer through Q01 to Q03 only (band differences), then staff (3e).

## 2. What is placeholder

Every North Pole model is a stand-in shape (46 asset definitions,
`NORTH_POLE_ASSET_MANIFEST.md`). Every North Pole sound cue needs an uploaded, licensed recording
(`NORTH_POLE_AUDIO_INVENTORY.md`); until then the Area is silent except shared cues. Voices are
captions only until Polly is enabled with owner approval.

## 3. Owner acceptance checklist

Realm and entry
- [ ] R1 The Realm Explorer shows "North Pole" with the winter picture and a Seasonal chip; between
      Dec 1 and Jan 6 it also shows Featured.
- [ ] R2 Entering North Pole Village needs no arithmetic; leaving needs none either.
- [ ] R3 Sprout, Pathfinder and Explorer profiles can all enter.

World and movement (NP-010 to NP-019, NP-036)
- [ ] W1 All nine locations are reachable and recognisable: Santa's Landing, Christmas Village,
      Santa's Workshop, Candy Cane Forest, Frozen Lake, Reindeer Stables and Pine Hollow,
      Gingerbread Village, Snowflake Mountain, the Observatory (plus the North Road).
- [ ] W2 Snow falls, fog fades the distance into the twilight sky, the aurora waves; with reduced
      motion the snow slows and the aurora is still. Low-end devices drop snow and aurora.
- [ ] W3 Snowdrift gates open in story order and never block a child who has done the work.
- [ ] W4 The jump tutorial steps at the village work, and the snow stairs beside them reach the
      fragment without jumping.
- [ ] W5 Every required step can be done without jumping (stairs, ramps, bridges).
- [ ] W6 Falling into the lake's open water returns the child to the nearest bank checkpoint, keeping
      everything; Snowflake Mountain falls only drop one terrace.
- [ ] W7 The child never walks through buildings, snowbanks or platforms, and the camera keeps the
      child visible next to tall walls (Treasure Rush fixes, ADR-060).
- [ ] W8 Touch: drag to move, Jump button, sprint toggle work on a tablet.

Story and learning (NP-025 to NP-033)
- [ ] S1 Q01 to Q09 each play in order with their guide; Jingle, Tinker, Peppermint, Frosty, Noel,
      Ginger, Mrs. Claus, Polaris and Santa speak age-appropriate lines.
- [ ] S2 Choice and order puzzles: a wrong answer keeps the same question with kind feedback; hints
      appear after attempts; solved puzzles can be practised again for fun.
- [ ] S3 Workshop gift chest and the two mountain lever boxes ask arithmetic suited to the band; the
      lever boxes raise walkable bridges.
- [ ] S4 Snowball follows the child home after the collar is found (NPC Manager FOLLOW); if not, the
      return to Noel still works.
- [ ] S5 The observatory accepts the fragments in journey order; the Star appears and lights up.
- [ ] S6 Ringing Santa's sleigh bell starts the celebration and the sleigh flies away.
- [ ] S7 After the finale, the ice cave behind Santa's Landing opens with golden bells, and the two
      practice chests can be replayed.
- [ ] S8 Band check: the same Q02 and Q04 puzzles are clearly simpler for a Sprout (pictures, one step) than for an Explorer; no Sprout route needs a jump or meets the open water.

Rewards and persistence (NP-034, NP-035, NP-038)
- [ ] P1 Badges, the Christmas Star trophy, cosmetics (owned, not equippable yet) and journal pages
      appear in the backpack once each, never twice; all ten snowflakes add the snowflake scarf.
- [ ] P2 Leaving mid-way and returning resumes at the furthest zone reached with everything kept.
- [ ] P3 Quests appear in the in-world backpack (see the known gap about the `/quests` page).
- [ ] P4 Sign out, sign in, open the same child: badges, trophy, fragments and completed quests are still there, and replaying a solved puzzle says "Practice" and grants nothing new.
- [ ] P5 Parent dashboard: after a playthrough the child's activity by skill lists North Pole learning (for example "Counting sets of objects" for a Sprout, "Addition within ten" for a Pathfinder), not only the chests. Replays add nothing.

Staff (NP-048, Django Admin)
- [ ] T1 Puzzles, chests, challenge specs, placements, NPC records, sound cues and the seasonal
      event are editable in Django Admin; an edit reaches new visits only.
- [ ] T2 Enabling a Question Studio pool for a chest serves published bank questions there.
- [ ] T3 Setting the `christmas` event to WINDOW_ONLY hides the Realm outside its window and never
      removes a child's saves.

Engine checks (GE-074; details in section 5)
- [ ] E1 Ice: the Frozen Lake east bank feels slippery but fair; a child stops quickly and never slides into the open water.
- [ ] E2 Footsteps: the step sound changes between snow and the ice bank (skip if the snow and ice recordings are not uploaded).
- [ ] E3 Snow falls wherever the child walks, including Snowflake Mountain; with a low render quality there is none; with reduced motion it is fewer and slower.
- [ ] E4 Water recovery: fall into the lake from each bank; the child returns to the bank last touched with a kind message and keeps everything.

## 4. Known gaps (development found, documented, not fixed)

From `NORTH_POLE_CLIENT_REVIEW.md` and the workstream reports:

1. No "Star fragments 3 of 7" progress line: the served items carry `setId` only, so this needs a
   small API addition (proposed in the review).
2. The `/quests` journal page reads the bundled quest definitions, so North Pole quests show in
   the in-world backpack only (also true for Firepeak).
3. The backpack shows quest titles and status, not objectives.
4. Pickups draw the generic gem, not their stand-in shape (fragments, bells).
5. Cosmetics can be owned but not equipped (a shared gap). Collectible-set completion items are
   now granted by the server (merged from Firepeak, FPV-18): the tenth snowflake gives the
   snowflake scarf once (`test_the_tenth_snowflake_completes_the_set_and_gives_the_scarf_once`).
6. Snowball's resting spot in the stable uses the NPC seed's fallback position (46, 20); confirm
   it looks right or add an `np-snowball-stable` placement.
7. **Resolved on `main` `f0de1087` (2026-11-24).** Area puzzle solves now record
   `SkillEvidence` (FPV-D10, PR #73), and every quiz band and variant names a catalog objective
   (re-tag, PR #69; `CURRICULUM_AUDIT.md`). `puzzle_skill_report --strict` finds nothing unmapped
   after seeding, and `test_every_quiz_solve_records_skill_evidence_for_the_dashboard` plays every
   band through the API and checks the parent's skill view. Check it in the playthrough with P5.
   A database seeded before `f0de1087` keeps the old skill ids (the seed never overwrites
   authored revisions): start QA from a fresh database.
8. Fragment, restoration, reindeer and sleigh-bell cues have no North Pole-specific call point
   yet. Found 2026-11-18, still true on `main` `aa8adb33`: `RegionPlayCompanion` raises `crystalCollect` for every pickup with new
   items, so every collectible (snowflakes, candy canes, cookies) also plays the star-fragment
   sound. Firepeak relies on this for its shards. The fix needs a per-region rule for which
   pickups are special (for example, item category `QUEST_ITEM`) in `regionAudio.ts`. Not changed
   yet.
9. The client lights only the fragment sockets it orders; the village socket is pre-set by story.

## 5. Game Engine Core migration (GE-074, owner-approved 2026-11-19)

- Done: `core/gameengine` @ e4148949 merged (via Firepeak, 0f8f6d1e). `defineRealm` and
  `defineAdventure` data in `react/src/features/region-play/northPole/northPoleEngineDefinition.ts`,
  validated with the standard capability registry; the scene snapshot passes the engine content
  compatibility checks and `npm run engine:validate`. No North Pole file imports an island-map shim.
- Ice traction (layout version 2): the east bank of the Frozen Lake, where Frosty skates and the floe
  puzzles sit, is ice through the engine bridge (`scene.engineBridge`, `environment.volumes`):
  friction 0.3 (gentler than the engine's 0.15 preset), top speed unchanged, and 2 m clear of the
  open water so a slide never reaches it. Rerunning `seed_north_pole` upgrades an older
  local database in place (`upgrade_north_pole`, version-gated like the Heart); authored copy and
  staff platform tuning are kept, and children's saves are rows the upgrade never touches. Owner check: the bank feels slippery but fair,
  and a child still stops quickly.
- One checkpoint list (layout version 3): the nine zone checkpoints, the two lake-bank checkpoints
  and the open-water hazard run in the engine bridge (`scene.engineBridge`), and the platforming and
  effects lists are gone. A returning child still resumes at the furthest zone they reached; a fall
  in the water returns them to the bank they last touched. The sled back to Santa's Landing carries
  its destination. Owner check: resume after leaving mid-story; fall in the lake from each bank.
- Snow and ice footsteps (layout version 4): snow underfoot everywhere (sound only; grip and speed
  unchanged) and ice on the lake bank, through the engine bridge's surface footsteps; region audio
  plays `sfx.north_pole.snow_step` or `sfx.north_pole.ice_step` instead of the default, one sound
  per step. Silent until those recordings are uploaded (audio inventory). Owner check: footsteps
  change when stepping onto the lake bank.
- Snow on the engine (layout version 5, GE-074, after the parity test
  `region-play/northPole/northPoleWeatherParity.test.ts`):
  - The falling snow is now the engine's `environment.weather` (`SNOW`, replacing the engine
    preset with the North Pole look), drawn by the bridge in a 40 x 24 x 40 m box that follows the
    child, so it snows from the village to Snowflake Mountain.
  - The Area atmosphere keeps only the night fog and the aurora, so it snows once. An existing
    layout 4 database drops only the atmosphere's SNOW on upgrade; staff-authored fog stays.
  - Render tier: the same snow as before on every setting: none on LOW, 360 flakes on MEDIUM,
    720 on HIGH (the snow takes 0.6 of the tier budget, as the atmosphere's density did).
  - Reduced motion: fewer, slower flakes, as before.
  - Owner check: snow falls everywhere you walk, including the mountain, under the same dark-blue
    fog; with a low-quality setting there is no snow.

