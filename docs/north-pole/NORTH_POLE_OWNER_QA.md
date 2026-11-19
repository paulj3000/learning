# North Pole: local startup and owner acceptance checklist (NP-060)

Status: development complete at unit level on `feature/north-pole-adventure`. **Not owner-tested,
not browser-verified, not merged, not deployed.** Nothing in this checklist has been ticked by
the development session; every item is for the owner.

## 1. Local startup (no AWS)

From the repository root, with Docker running (`make up` starts PostgreSQL 16 on port 5442):

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

**Branch order:** this branch contains the Treasure Rush movement branch and the Firepeak branch.
It merges after both.

## 2. What is placeholder

Every North Pole model is a stand-in shape (46 asset definitions,
`NORTH_POLE_ASSET_MANIFEST.md`). Every North Pole sound cue needs an uploaded, licensed recording
(`NORTH_POLE_AUDIO_INVENTORY.md`); until then the Area is silent except shared cues. Voices are
captions only until Polly is enabled with owner approval.

## 3. Owner acceptance checklist

Realm and entry
- [ ] The Realm Explorer shows "North Pole" with the winter picture and a Seasonal chip; between
      Dec 1 and Jan 6 it also shows Featured.
- [ ] Entering North Pole Village needs no arithmetic; leaving needs none either.
- [ ] Sprout, Pathfinder and Explorer profiles can all enter.

World and movement (NP-010 to NP-019, NP-036)
- [ ] All nine locations are reachable and recognisable: Santa's Landing, Christmas Village,
      Santa's Workshop, Candy Cane Forest, Frozen Lake, Reindeer Stables and Pine Hollow,
      Gingerbread Village, Snowflake Mountain, the Observatory (plus the North Road).
- [ ] Snow falls, fog fades the distance into the twilight sky, the aurora waves; with reduced
      motion the snow slows and the aurora is still. Low-end devices drop snow and aurora.
- [ ] Snowdrift gates open in story order and never block a child who has done the work.
- [ ] The jump tutorial steps at the village work, and the snow stairs beside them reach the
      fragment without jumping.
- [ ] Every required step can be done without jumping (stairs, ramps, bridges).
- [ ] Falling into the lake's open water returns the child to the nearest bank checkpoint, keeping
      everything; Snowflake Mountain falls only drop one terrace.
- [ ] The child never walks through buildings, snowbanks or platforms, and the camera keeps the
      child visible next to tall walls (Treasure Rush fixes, ADR-060).
- [ ] Touch: drag to move, Jump button, sprint toggle work on a tablet.

Story and learning (NP-025 to NP-033)
- [ ] Q01 to Q09 each play in order with their guide; Jingle, Tinker, Peppermint, Frosty, Noel,
      Ginger, Mrs. Claus, Polaris and Santa speak age-appropriate lines.
- [ ] Choice and order puzzles: a wrong answer keeps the same question with kind feedback; hints
      appear after attempts; solved puzzles can be practised again for fun.
- [ ] Workshop gift chest and the two mountain lever boxes ask arithmetic suited to the band; the
      lever boxes raise walkable bridges.
- [ ] Snowball follows the child home after the collar is found (NPC Manager FOLLOW); if not, the
      return to Noel still works.
- [ ] The observatory accepts the fragments in journey order; the Star appears and lights up.
- [ ] Ringing Santa's sleigh bell starts the celebration and the sleigh flies away.
- [ ] After the finale, the ice cave behind Santa's Landing opens with golden bells, and the two
      practice chests can be replayed.

Rewards and persistence (NP-034, NP-035, NP-038)
- [ ] Badges, the Christmas Star trophy, cosmetics (owned, not equippable yet) and journal pages
      appear in the backpack once each, never twice; all ten snowflakes add the snowflake scarf.
- [ ] Leaving mid-way and returning resumes at the furthest zone reached with everything kept.
- [ ] Quests appear in the in-world backpack (see the known gap about the `/quests` page).

Staff (NP-048, Django Admin)
- [ ] Puzzles, chests, challenge specs, placements, NPC records, sound cues and the seasonal
      event are editable in Django Admin; an edit reaches new visits only.
- [ ] Enabling a Question Studio pool for a chest serves published bank questions there.
- [ ] Setting the `christmas` event to WINDOW_ONLY hides the Realm outside its window and never
      removes a child's saves.

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
7. Several curriculum skill slugs (fractions, symmetry, sight words, earth and space) are labels,
   not curriculum rows, so they do not yet feed SkillProgress.
8. Fragment, restoration, reindeer and sleigh-bell cues have no North Pole-specific call point
   yet. Found 2026-11-18: `RegionPlayCompanion` raises `crystalCollect` for every pickup with new
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
- Waiting: ice traction, snow and ice footsteps, engine weather (after atmosphere parity) and the one
  checkpoint list need the location engine bridge (GE-065) and the Treasure Rush host additions
  (GE-070). Nothing in play has changed.

