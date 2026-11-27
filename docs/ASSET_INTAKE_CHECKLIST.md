# Asset intake checklist: missing audio and models

Status: sourcing checklist (LAI 07, 2026-11-27, `main` `d812ad71`). Docs only: no file is
sourced, uploaded or published by this document, and nothing here changes code or seeds.

This is one list of every audio file and model the shipped and seeded realms ask for and that no
environment has yet: Treasure Rush (30 cues), Storykeeper Castle (18 cues), Firepeak (19 cues, 38
models) and North Pole (25 cues, 46 assets). It adds nothing new. Each row comes from the realm's
own inventory and from the Python table that the seed commands read. **When this file and a
source disagree, the source wins** and this file is corrected:

| Realm | Audio source of truth | Model source of truth | Realm inventory |
|---|---|---|---|
| Treasure Rush | `lai/apps/audio/treasure_rush_cues.py` | none needed (stand-ins; `docs/qa/MVP_REALM_ASSET_SUPPORT_2026-11-26.md`) | `docs/audio/TREASURE_RUSH_AUDIO_INVENTORY.md` |
| Storykeeper Castle | `lai/apps/audio/castle_cues.py` | none (bundled castle kit) | `docs/audio/STORYKEEPER_CASTLE_AUDIO.md` section 4 |
| Firepeak | `lai/apps/audio/firepeak_cues.py` | `lai/apps/regions/firepeak_seed.py` `FIREPEAK_ASSETS` (volcano), `lai/apps/regions/firepeak_heart_layout.py` `ASSET_DEFS` (Heart) | `docs/firepeak/FIREPEAK_AUDIO_INVENTORY.md`, `FIREPEAK_ASSET_INVENTORY.md`, `docs/regions/firepeak_assets.md` |
| North Pole | `lai/apps/audio/north_pole_cues.py` | `lai/apps/regions/north_pole_assets.py` `ASSETS` | `docs/north-pole/NORTH_POLE_AUDIO_INVENTORY.md`, `NORTH_POLE_ASSET_MANIFEST.md` |

Totals: **92 audio files** (none exist) and **84 model or image definitions** (none has a
version). Missing audio is silent and a missing model draws a labelled stand-in, so **nothing
here blocks play**. "Required" below means the game raises that sound or places that model today,
so the realm's audio check or art pass cannot pass without it. "Optional" means nothing raises
it yet, or the realm is complete and calm without it.

## 1. Rules that apply to every row

### 1.1 Formats and limits

| Type | Accepted (enforced by validation) | Target (realm guidance) |
|---|---|---|
| **Audio** (`kind` audio; category `sound` for sfx, ambient, ui; `music` for music) | MP3 (Layer III), WAV (PCM or float), Ogg (Vorbis or Opus). At most 20 MB (`LAI_ASSET_MAX_AUDIO_BYTES`), at most 15 minutes, mono or stereo, 8 to 96 kHz (`apps/assets/validation_media.py`) | Loops seamless; effects mono and short; nothing harsh, never a buzzer for a wrong answer. See 1.3 for the open format and loudness question |
| **Model** (`character`, `prop`, `collectible`, `kit-piece`) | GLB, or a self-contained `.gltf` (every buffer and image a `data:` URI). At most 50 MiB (`LAI_ASSET_MAX_UPLOAD_BYTES`, and `LAI_ASSET_MAX_GLB_BYTES` for GLB). Embedded images PNG or JPEG only (no WebP). No Draco, no meshopt, no external URI. A default scene with geometry. Clip names unique (`docs/ASSET_LIBRARY.md` sections 4 and 5) | Under 2 MB; metres, +Y up, front faces +Z, origin at the base centre, identity root; one material where possible; the realm's triangle budget. Clip names from the vocabulary `Idle Walk Talk Wave Point Celebrate ReactHappy ReactConcerned Open Close Activate Run Jump Fall Land` (anything else is an `unknown_clip` warning and is never played by name) |
| **Image** (`texture`) | PNG, JPEG or WebP | Strip location and camera metadata before upload: validation warns, it does not strip (`docs/ASSET_LIBRARY.md` section 27) |

The asset id is fixed by the seed or the cue table. For audio it is always the cue id with dots
and underscores turned into dashes (`CueSpec.asset_id`): `sfx.firepeak.crystal_collect` is
uploaded as `sfx-firepeak-crystal-collect`. A seed command creates a cue only for a **published**
audio asset of the right kind and channel, so a misspelt id is reported as `ASSET NEEDED`, never
guessed.

### 1.2 Licence rules

These rules come from `docs/ASSET_LICENCES.md`, ADR-028 and the realm inventories. They are the
same for audio and models.

- **L1 (all rows).** Allowed: CC0 1.0; work the owner made or commissioned, with a written
  assignment or licence that allows modification and redistribution inside the app; or a paid
  licence whose terms allow shipping the file inside an app.
- **L2 (all rows).** Not allowed today: **CC-BY**, until ADR-028's parent-reachable attribution
  surface exists (the `feather` precedent). Avoid NC, ND and SA terms and "free" libraries that
  forbid redistributing the file. No files ripped from games or marketplaces. AI-generated audio
  or models only with the owner's agreement and terms that grant redistribution.
- **L3 (all rows).** Before publishing, record each file in `docs/ASSET_LICENCES.md`: asset id,
  source URL, author, licence, licence evidence, retrieval date, SHA-256, attribution owed and
  any modification. Put the same in the asset's licence and provenance fields in Django Admin.
  `ASSET_LICENCES.md` has sections for models but **none for audio yet**: the first audio intake
  adds an "Audio: served from the asset library, never in this repository" section beside the
  model sections.
- **L4 (North Pole only).** No trademarked or film likeness (no red-nosed or glowing-nosed
  reindeer, no film or TV snowman, no branded Santa, no named third-party elves). No religious
  symbols, lyrics or vocals. A public-domain carol tune is not a licence for a modern recording,
  arrangement or performance of it: the recording itself must be licensed or self-made.
- **L5 (all audio).** Calm and child friendly: no sudden loud peaks, nothing frightening.

### 1.3 Open questions for the owner (reported, not resolved)

The realm documents disagree on two points. This checklist does not pick a side:

1. **Delivery format.** Treasure Rush recommends MP3 (44.1 or 48 kHz; 128 kbps mono effects,
   192 kbps stereo music and ambience), because MP3 plays in every browser the tablet-first app
   targets, Safari on iPad included. Firepeak and North Pole prefer Ogg Vorbis and accept MP3.
   Validation accepts all three formats. One rule for the whole island would stop each realm
   sourcing differently. **Recommendation:** MP3 everywhere, with a WAV master kept for each file,
   unless LAI 05 confirms Ogg playback on the target iPads.
2. **Loudness.** Treasure Rush: music -18 LUFS, ambience -20 LUFS, effects peak -3 dBFS.
   Storykeeper Castle: effects -16 LUFS, music and beds -20 LUFS. Firepeak and North Pole set no
   level. Until `LAI_AUDIO_TRANSCODING` (LAI-LAMBDA-008b) normalises on upload, files must arrive
   at the agreed level.

## 2. Commands once a file exists

There is **no command-line upload for a single new file**. `import_assets --from-bundled` only
imports export-origin definitions that have a bundled file under `react/public`. The pack
importers (`import_treasure_rush_environment`, `import_treasure_rush_palm_trees`) only import
their own declared packs, with SHA-256 pinned in `apps/assets/model_packs.py`. Every row below is
therefore uploaded in **Django Admin**, and a seed command then wires it in. A North Pole or
Firepeak pack command could be added like the Treasure Rush ones. None is built, and none is
proposed here.

All commands run from `lai/` with the project's Python (`python` below). Run them locally or on
staging only: deploying, and any step against AWS, needs the owner's authorization.

**U. Upload and publish (every row).**

1. Once per environment: `python manage.py ensure_asset_roles` and `python manage.py
   ensure_sound_roles`. Uploaders need **Asset editors**; publishing needs **Asset publishers**.
2. Seeded definitions (Firepeak, North Pole) already exist after the realm seed. Audio
   definitions do not exist: in the Asset Library choose **Add asset**, kind Audio, the asset id
   from the table, category `music` or `sound`.
3. **Asset library > Asset versions > Add**: pick the asset id and upload the file. Validation
   runs at once; a refused file is not stored.
4. Optional for models: **Preview**, then **Show collision**.
5. Select the version and run **Publish selected versions**. The first published version becomes
   the default; for a later one, also run **Make the selected version the default**.
6. Record the licence (L3) before step 5.

**Audio recipes** (after U):

| Recipe | Commands | Then |
|---|---|---|
| **A-TR** (Treasure Rush, and the shared `sfx.learning.*`, `sfx.quest.complete`, `sfx.reward.collect`, `sfx.treasure.reveal`, `sfx.player.*`, `sfx.platform.*` cues every realm reuses) | `python manage.py seed_treasure_rush_sound --dry-run`, then `python manage.py seed_treasure_rush_sound` | Django Admin, Sound library: **Publish the sound library** (a new sound release) |
| **A-SC** (Storykeeper Castle) | `python manage.py seed_castle_sound --dry-run`, then `python manage.py seed_castle_sound` | Publish a sound release. The cues are created shared and the Place manifest `storykeeper-castle` serves them, so no assignment is needed |
| **A-FP** (Firepeak) | `python manage.py seed_firepeak_sound --dry-run`, then `python manage.py seed_firepeak_sound`. Run it again after `seed_firepeak_heart`, so the zone ambience and music assignments for the 3D Area `firepeak-heart` are created | Publish a sound release; check the manifest for the Area |
| **A-NP** (North Pole) | `python manage.py seed_north_pole_sound --dry-run`, then `python manage.py seed_north_pole_sound`. Run it again after `seed_north_pole`, for the `north-pole-village` zone assignments | Publish a sound release |

Every seed is idempotent. It never overwrites a cue or assignment that staff changed, never makes
a placeholder and never publishes. A file reaches children only through the published sound
release.

**Model recipes** (after U):

| Recipe | Commands and steps | Then |
|---|---|---|
| **M-FV** (Firepeak Volcano, FP-3) | Definitions come from `python manage.py seed_firepeak` (local: `publish_firepeak`). Nothing to re-run after an upload | The child's next visit loads the model instead of the stand-in |
| **M-FH** (Heart of Firepeak) | Definitions come from `python manage.py seed_firepeak_heart` (local: `publish_firepeak_heart`). For a character, then run `python manage.py seed_npc_firepeak --promote --publish` | For a platform model: add `"assetId"` to that platform in `firepeak_heart_layout.py`, bump `firepeakHeartVersion` and re-run `seed_firepeak_heart` (a code change, the realm owner's) |
| **M-NP** (North Pole) | Definitions come from `python manage.py seed_north_pole` (local: `publish_north_pole`). For a character, then run `python manage.py seed_npc_north_pole --promote --publish` | Add `animation_map` entries in the NPC Manager only for clips that do not use the standard names |
| **C** (collision, any model) | **Assets > Collision profiles > Add**: the shape and behaviour in the row; leave sizes empty unless one is given (they come from the measured bounds) | Check "What the game uses". `python manage.py collision_clearance_audit` lists raised Solid parts (read only) |

`publish_*` commands are refused unless `DEBUG` is on and the database is on loopback. On a
shared environment, staff publish in Django Admin instead.

## 3. Audio: 92 files

Columns: **Req** R required, O optional (definitions above). **Cmd** the recipe in section 2.
All rows: type audio, licence L1 to L3 and L5 (plus L4 for North Pole). Lengths are the realm's
recommendation.

### 3.1 Treasure Rush (30; 16 required)

Cue specs in `treasure_rush_cues.py`. The `sfx.*` effects in rows 8 to 16 and the movement and
platform cues are **shared**: the castle and the other realms play the same files.

| Asset id | Cat. | Length, file | Raised by | Req | Cmd |
|---|---|---|---|---|---|
| `ambient-treasure-rush-ocean` | sound | 30 to 90 s seamless loop, stereo | Entry, Pirate Landing, Shipwreck Beach | R | A-TR |
| `ambient-treasure-rush-jungle` | sound | 30 to 90 s loop, stereo | Palm Tree Grove | R | A-TR |
| `ambient-treasure-rush-cave` | sound | 30 to 90 s loop, stereo | Ancient Treasure Ruins | R | A-TR |
| `ambient-treasure-rush-wind` | sound | 30 to 90 s loop, stereo | Lookout Point | R | A-TR |
| `music-treasure-rush-explore` | music | 60 to 120 s loop, stereo | From entry | R | A-TR |
| `music-treasure-rush-puzzle` | music | 30 to 90 s loop, stereo | Rune puzzle | R | A-TR |
| `music-treasure-rush-victory` | music | 3 to 8 s, once | Quest complete | R | A-TR |
| `sfx-chest-open` | sound | under 2 s, mono | Chest confirmed open | R | A-TR |
| `sfx-treasure-reveal` | sound | under 2 s | Reward appears (castle page fallback) | R | A-TR |
| `sfx-key-discover` | sound | under 2 s | Brass key found | R | A-TR |
| `sfx-reward-collect` | sound | under 2 s | Reward without a chest (castle artifact fallback) | R | A-TR |
| `sfx-world-bridge-open` | sound | 1 to 3 s | Gate opens | R | A-TR |
| `sfx-learning-correct` | sound | under 1 s | Right answer (also castle) | R | A-TR |
| `sfx-learning-retry` | sound | under 1 s, gentle, never a buzzer | Wrong answer (also castle) | R | A-TR |
| `sfx-learning-complete` | sound | under 2 s | Rune puzzle solved | R | A-TR |
| `sfx-quest-complete` | sound | under 2 s | Quest complete (also castle) | R | A-TR |
| `sfx-player-jump` | sound | under 1 s | Jump | O | A-TR |
| `sfx-player-land` | sound | under 1 s | Firm landing | O | A-TR |
| `sfx-player-footstep` | sound | very short, quiet (repeats) | Walk, run, sprint | O | A-TR |
| `sfx-platform-activate` | sound | under 1 s | Moving platforms, Pirate Lift | O | A-TR |
| `sfx-platform-move` | sound | under 1 s | Platform sets off | O | A-TR |
| `sfx-platform-stop` | sound | under 1 s | Platform stops | O | A-TR |
| `sfx-platform-plate` | sound | under 1 s | Pressure plate | O | A-TR |
| `sfx-platform-bounce` | sound | under 1 s | Bounce pad | O | A-TR |
| `sfx-platform-checkpoint` | sound | under 1 s | Checkpoint | O | A-TR |
| `sfx-player-recover` | sound | under 1 s | Back to safety after a fall | O | A-TR |
| `sfx-platform-goal` | sound | under 3 s | Pirate's Leap goal | O | A-TR |
| `sfx-coin-collect` | sound | under 1 s | Nothing (no coin mechanic) | O | A-TR |
| `sfx-gem-collect` | sound | under 1 s | Nothing (no gem mechanic) | O | A-TR |
| `sfx-item-pickup` | sound | under 1 s | Nothing (only keys today) | O | A-TR |

Pip's voice is Amazon Polly through Django, not an asset.

### 3.2 Storykeeper Castle (18; all required)

Cue specs in `castle_cues.py`; all are raised today. A room whose bed is missing falls back to
`ambient-castle-hall`, so that file comes first. The castle also uses the shared Treasure Rush
effects (3.1). Word and page narration are Polly lines, not files.

| Asset id | Cat. | Length | What | Cmd |
|---|---|---|---|---|
| `ambient-castle-hall` | sound | 30 to 60 s loop | Warm stone hall, soft fire; the fallback bed | A-SC |
| `ambient-castle-gallery` | sound | 30 to 60 s loop | Quiet gallery | A-SC |
| `ambient-castle-costume` | sound | 30 to 60 s loop | Fabric rustles | A-SC |
| `ambient-castle-tower` | sound | 30 to 60 s loop | High wind, gentle shimmer | A-SC |
| `ambient-castle-studio` | sound | 30 to 60 s loop | Brushes, paint taps | A-SC |
| `ambient-castle-library` | sound | 30 to 60 s loop | Pages, hushed room | A-SC |
| `ambient-castle-trophy` | sound | 30 to 60 s loop | Calm room, faint chime | A-SC |
| `ambient-castle-secret` | sound | 30 to 60 s loop | Low crystal hum | A-SC |
| `music-castle-explore` | music | 90 s loop | Calm castle theme | A-SC |
| `music-castle-story` | music | 90 s loop | Softer story theme (Storybook open) | A-SC |
| `sfx-castle-book-open` | sound | 1 s | Heavy cover opening | A-SC |
| `sfx-castle-book-close` | sound | 0.8 s | Soft book thump | A-SC |
| `sfx-castle-page-restore` | sound | 2 s | Page flutters home | A-SC |
| `sfx-castle-quest-start` | sound | 1.5 s | Bright call to adventure | A-SC |
| `sfx-castle-npc-greet` | sound | 1 s | Friendly chime | A-SC |
| `sfx-castle-hint-chime` | sound | 0.8 s | Soft warm chime, never a buzzer | A-SC |
| `sfx-castle-artifact-found` | sound | 1.5 s | Sparkle | A-SC |
| `ui-castle-door` | sound | 1 s | Soft wooden door (room change) | A-SC |

### 3.3 Firepeak (19; 17 required)

Cue specs in `firepeak_cues.py`; the zone ambience goes to the 3D Area `firepeak-heart`. Jump,
landing and footsteps reuse the shared `sfx-player-*` files (3.1).

| Asset id | Cat. | Length | What | Req | Cmd |
|---|---|---|---|---|---|
| `music-firepeak-realm` | music | 90 to 180 s loop | Theme for the whole volcano | R | A-FP |
| `music-firepeak-finale` | music | 10 to 25 s, once | The Heart is restored | R | A-FP |
| `ambient-firepeak-landing` | sound | 30 to 60 s loop | Explorer's Landing (entry bed) | R | A-FP |
| `ambient-firepeak-forest` | sound | 30 to 60 s loop | Emberwood Forest | R | A-FP |
| `ambient-firepeak-lava` | sound | 30 to 60 s loop | Lava Crossing | R | A-FP |
| `ambient-firepeak-cave` | sound | 30 to 60 s loop | Crystal Caverns | R | A-FP |
| `ambient-firepeak-forge` | sound | 30 to 60 s loop | Ancient Forge | R | A-FP |
| `ambient-firepeak-summit-wind` | sound | 30 to 60 s loop | Firepeak Summit | R | A-FP |
| `ambient-firepeak-heart` | sound | 30 to 60 s loop | Heart Chamber | R | A-FP |
| `sfx-firepeak-crystal-collect` | sound | 0.5 to 1.5 s | Ember shard picked up | R | A-FP |
| `sfx-firepeak-switch` | sound | 0.2 to 0.6 s | Switch flipped | R | A-FP |
| `sfx-firepeak-puzzle-complete` | sound | 0.8 to 2 s | Puzzle solved | R | A-FP |
| `sfx-firepeak-checkpoint` | sound | 0.5 to 1.5 s | Checkpoint | R | A-FP |
| `sfx-firepeak-lava-respawn` | sound | 0.5 to 1.5 s | Gentle return after lava | R | A-FP |
| `sfx-firepeak-rock-rumble` | sound | 0.8 to 1.5 s | Falling-rock warning (Summit) | R | A-FP |
| `sfx-firepeak-restore` | sound | 2 to 5 s | The Heart relights | R | A-FP |
| `sfx-firepeak-complete` | sound | 2 to 4 s | Adventure complete | R | A-FP |
| `sfx-firepeak-machinery` | sound | 1 to 3 s | Forge powers up (no call point) | O | A-FP |
| `voice-firepeak-npc-greet` | music | 1 to 3 s | Optional greeting sting (no call point) | O | A-FP |

`FIREPEAK_AUDIO_INVENTORY.md` says `puzzleComplete` and `restoration` are never called. On
`main` `d812ad71` they are: `RegionPlayCompanion` plays `puzzleSolveCues` (`soundCues.ts`) on a
server-confirmed solve (from `af68bee5`). That inventory note is stale; the realm owner (LAI 03)
corrects it. The voice category (`music`) is what that inventory says; the seed checks the
channel, so follow its `ASSET NEEDED` report if it disagrees.

### 3.4 North Pole (25; 19 required)

Cue specs in `north_pole_cues.py`; the zone ambience goes to the 3D Area `north-pole-village`.
L4 applies to every row. Jump and landing reuse the shared `sfx-player-*` files (3.1).

| Asset id | Cat. | Length | What | Req | Cmd |
|---|---|---|---|---|---|
| `music-north-pole-village` | music | 90 to 180 s loop | Explore and puzzle theme | R | A-NP |
| `music-north-pole-celebration` | music | 10 to 25 s, once | Star restored, sleigh lifts off | R | A-NP |
| `music-north-pole-forest` | music | 60 to 120 s loop | Candy Cane Forest (reserved for a zone assignment) | O | A-NP |
| `ambient-north-pole-landing` | sound | 30 to 60 s loop | Santa's Landing and Christmas Village (entry bed) | R | A-NP |
| `ambient-north-pole-workshop` | sound | 30 to 60 s loop | Santa's Workshop | R | A-NP |
| `ambient-north-pole-forest` | sound | 30 to 60 s loop | Candy Cane Forest | R | A-NP |
| `ambient-north-pole-lake` | sound | 30 to 60 s loop | Frozen Lake | R | A-NP |
| `ambient-north-pole-stables` | sound | 30 to 60 s loop | Reindeer Stables | R | A-NP |
| `ambient-north-pole-gingerbread` | sound | 30 to 60 s loop | Gingerbread Village | R | A-NP |
| `ambient-north-pole-mountain-wind` | sound | 30 to 60 s loop | Snowflake Mountain | R | A-NP |
| `ambient-north-pole-observatory` | sound | 30 to 60 s loop | Observatory | R | A-NP |
| `ambient-north-pole-wind` | sound | 30 to 60 s loop | North Road | R | A-NP |
| `sfx-north-pole-collect` | sound | 0.5 to 1.5 s | Any pickup | R | A-NP |
| `sfx-north-pole-fragment` | sound | 1 to 2.5 s | Star fragment picked up | R | A-NP |
| `sfx-north-pole-answer-right` | sound | 0.8 to 2 s | Right answer | R | A-NP |
| `sfx-north-pole-answer-retry` | sound | 0.5 to 1.5 s, soft | Try again | R | A-NP |
| `sfx-north-pole-quest-complete` | sound | 2 to 4 s | Quest complete | R | A-NP |
| `sfx-north-pole-checkpoint` | sound | 0.5 to 1.5 s | Checkpoint | R | A-NP |
| `sfx-north-pole-respawn` | sound | 0.5 to 1.5 s | Return to the checkpoint | R | A-NP |
| `sfx-north-pole-star-restored` | sound | 2 to 5 s | The Star relights | R | A-NP |
| `sfx-north-pole-snow-step` | sound | 0.1 to 0.4 s | Footstep on snow (no call point) | O | A-NP |
| `sfx-north-pole-ice-step` | sound | 0.1 to 0.4 s | Footstep on ice (no call point) | O | A-NP |
| `sfx-north-pole-reindeer` | sound | 0.5 to 2 s | Reindeer snort (no call point) | O | A-NP |
| `sfx-north-pole-sleigh-bells` | sound | 1 to 3 s | Sleigh bells (no call point) | O | A-NP |
| `voice-north-pole-npc-greet` | music | 1 to 3 s | Optional greeting sting | O | A-NP |

Two discrepancies for LAI 03 (reported, not changed). `regionAudio.ts` maps `crystalCollect` to
`sfx.north_pole.fragment` and `restoration` to `sfx.north_pole.star_restored`, and both moments
are raised on `main`. But `north_pole_cues.py` marks both `wired=False`, so the seed reports them
as optional, and the inventory says "No". Also, `crystalCollect` fires on **every** confirmed
pickup together with `keyPickup` (`RegionPlayCompanion.tsx`), so a candy cane may play both the
collect and the fragment sound. They are listed as required here because the client plays them.

## 4. Models: 84 definitions

All rows: type model unless marked, format and limits 1.1, licence L1 to L3 (plus L4 for North
Pole). Each definition already exists with no version, so the client draws its stand-in.
**Collision** is the realm inventory's recommended profile (recipe C); "none" means do not add
one, and "not specified" means the inventory gives none (the realm owner decides).

### 4.1 Firepeak (38 unique; FP-3 Volcano and the Heart of Firepeak)

Budget (FPV-16): at most 2 MB and 10,000 triangles per prop, 15,000 per character, 20,000 for
the backdrop. Clips from the vocabulary.

| Asset id | Kind | W x H x D m | Collision | Clips | Req | Cmd |
|---|---|---|---|---|---|---|
| `firepeak-volcano-main` | kit-piece | ~60 x 34 x 60 | none | none | R | M-FV, M-FH (both seeds) |
| `firepeak-crystal-pedestal` | prop | 1.2 x 1.0 x 1.2 | Box | none | R | M-FV, M-FH |
| `firepeak-base-camp` | prop (building) | tent (stand-in TENT) | not specified | none | R | M-FV |
| `firepeak-professor-ember` | character | figure (stand-in) | not specified | Idle, Talk, Wave, Celebrate | R | M-FV |
| `firepeak-telescope` | prop | (stand-in) | not specified | none | R | M-FV |
| `firepeak-stone-platform` | prop | about 1 m wide, 0.4 m high (length scaled by size) | not specified | none | R | M-FV |
| `firepeak-steam-valve` | prop | 1 m tall; wheel node `valve-wheel` | not specified | Activate | R | M-FV |
| `firepeak-steam-pipe` | prop | (stand-in) | not specified | none | R | M-FV |
| `firepeak-crystal-cavern` | kit-piece | (stand-in) | not specified | none | R | M-FV |
| `firepeak-heart-crystal-fragment` | collectible | (stand-in) | not specified | none | R | M-FV |
| `firepeak-lava-crossing` | kit-piece | not placed (lava is a shader) | not specified | none | O | M-FV |
| `firepeak-flint` | character | 0.6 x 1.7 x 0.5 | none (NPC) | Idle, Walk, Talk, Wave, Point, Celebrate | R | M-FH + `seed_npc_firepeak` |
| `firepeak-kindle` | character | 0.5 x 0.9 x 0.5 | none (NPC) | Idle, Talk, Celebrate, ReactHappy | R | M-FH + `seed_npc_firepeak` |
| `firepeak-professor-basalt` | character | 0.6 x 1.7 x 0.5 | none (NPC) | Idle, Talk, Point, Celebrate | R | M-FH + `seed_npc_firepeak` |
| `firepeak-cinder` | character | 0.7 x 1.6 x 0.6 | none (NPC) | Idle, Talk, Activate, Celebrate | R | M-FH + `seed_npc_firepeak` |
| `firepeak-ignis` | character | 1.2 x 2.4 x 1.0 | none (NPC) | Idle, Talk, Wave, Celebrate | R | M-FH + `seed_npc_firepeak` |
| `firepeak-ember-shard` | collectible | 0.3 x 0.5 x 0.3 | none | none | R | M-FH |
| `firepeak-heart-crystal` | prop | 0.8 x 1.4 x 0.8 | none | optional Activate | R | M-FH |
| `firepeak-map-sign` | prop | 2.0 x 2.0 x 0.3 | Box | none | R | M-FH |
| `firepeak-sign` | prop | 0.8 x 1.4 x 0.2 | Box | none | R | M-FH |
| `firepeak-campfire` | prop | 1.2 x 0.8 x 1.2 | Cylinder | none | R | M-FH |
| `firepeak-tree` | prop | 2.5 x 6 x 2.5 | Cylinder, Solid (trunk) | none | R | M-FH |
| `firepeak-log` | prop | 3.0 x 0.45 x 0.7 | Box, Jumpable | none | R | M-FH |
| `firepeak-rock` | prop | 1.5 x 1.2 x 1.5 | Box | none | R | M-FH |
| `firepeak-stream` | prop | 2 x 0.05 x 10 | Box, Walkable | none | R | M-FH |
| `firepeak-ember-crystal` | prop | 0.5 x 0.9 x 0.5 | none | none | R | M-FH |
| `firepeak-count-card` | prop | 0.8 x 1.0 x 0.1 | none | none | R | M-FH |
| `firepeak-lava-stone` | prop | 1.0 x 0.4 x 1.0 | none (platforms collide) | none | R | M-FH |
| `firepeak-path-marker` | prop | 0.5 x 1.2 x 0.5 | none | none | R | M-FH |
| `firepeak-shape-stone` | prop | 0.9 x 1.0 x 0.9 | none | none | R | M-FH |
| `firepeak-cave-crystal` | prop | 1.0 x 2.0 x 1.0 | Box | none | R | M-FH |
| `firepeak-forge-switch` | prop | 0.6 x 1.2 x 0.6 | Box | Activate | R | M-FH |
| `firepeak-gear` | prop | 2.0 x 2.0 x 0.4 | none (out of reach) | none | R | M-FH |
| `firepeak-circuit-lamp` | prop | 0.6 x 1.6 x 0.6 | Box | optional Activate | R | M-FH |
| `firepeak-rock-sample` | prop | 0.6 x 0.5 x 0.6 | none | none | R | M-FH |
| `firepeak-story-stone` | prop | 0.9 x 1.1 x 0.3 | none | none | R | M-FH |
| `firepeak-arch` | prop | 4 x 4 x 1 | **none** (see below) | none | R | M-FH |
| `firepeak-return-portal` | prop | 2 x 3 x 0.5 | none | optional idle | R | M-FH |

`firepeak-arch`: the inventory suggests a two-pillar Compound profile, but since GE-L17 the gate
colliders in the scene are its jambs and opening, and the arch gets no Asset Library box
(`docs/IMPLEMENTATION_STATUS.md`, GE-L17). Add no profile. If it is ever placed as a plain model
elsewhere, use one box per pillar (`ASSET_COLLISION_PROFILES.md`, "Pieces with an opening").

Optional Heart models with **no definition yet** (each needs a seed change by the realm owner
before it can be uploaded): `firepeak-steam-vent`, `firepeak-bridge-wood`,
`firepeak-bridge-stone`, `firepeak-platform-basalt`, `firepeak-cave-wall`,
`firepeak-ancient-pillar`, `firepeak-ruin`, `firepeak-forge-machine`,
`firepeak-checkpoint-marker` (`FIREPEAK_ASSET_INVENTORY.md`).

### 4.2 North Pole (46; 45 required)

The full table, with dimensions, triangle budgets, materials, animations and collision for each
id, is `docs/north-pole/NORTH_POLE_ASSET_MANIFEST.md`. It is not copied here, to keep one source.
Intake summary by group (all recipe M-NP, then C):

| Group | Asset ids | Type | Collision (recipe C) | Notes |
|---|---|---|---|---|
| Characters (11) | `north-pole-santa`, `north-pole-mrs-claus`, `north-pole-elf-jingle`, `-tinker`, `-peppermint`, `-frosty`, `-noel`, `-ginger`, `-polaris`, `north-pole-reindeer`, `north-pole-reindeer-calf` | model, character | Capsule Solid r 0.3 (Santa, Mrs. Claus), r 0.25 (elves); reindeer Box Solid; **calf None, Decorative** (a follower never blocks) | The seven elves come from one base rig. Then `seed_npc_north_pole --promote --publish`. L4 applies |
| Buildings (6) | `north-pole-workshop`, `-observatory`, `-cottage`, `-stable`, `-gingerbread-house`, `-christmas-tree` | model, prop | Compound Solid, one box per wall, doorway open (tree: Cylinder Solid r 1) | Workshop and observatory at most a 2048 px atlas |
| Scenery and props (16) | `north-pole-snowman`, `-snowy-pine`, `-candy-cane-tall`, `-workshop-machine`, `-toy-train`, `-toy-blocks`, `-present`, `-sleigh`, `-lantern`, `-telescope`, `-christmas-star`, `-signpost`, `-snowbank`, `-ice-formation`, `-christmas-lights`, `-bridge` | model, prop or kit-piece | As the manifest; `north-pole-bridge` Walkable (a required path) | Moving parts as separate nodes with `Activate`; the present's `Open`; no baked text; lights never flash |
| Platforms (4) | `north-pole-ice-platform`, `-snow-platform`, `-cookie-platform`, `-peppermint-platform` | model, prop | Box Jumpable (matches the layout collider) | |
| Collectibles (7) | `north-pole-candy-cane`, `-ornament`, `-star-fragment`, `-snowflake`, `-golden-bell`, `-gingerbread-cookie`, `-snowball-collar` | model, collectible | None, Decorative (pickups never block) | |
| Ground (1) | `ground-tile-snow` | model, kit-piece (**not** an image) | None, Decorative | 4 x 4 m tile at y = 0, seamless edges |
| Texture (1, optional) | `north-pole-snow-texture` | image, 1024 px seamless sRGB | none | No runtime consumer yet. Strip metadata first |

## 5. What is out of this list

- **Treasure Rush models.** The cove is playable with bundled and stand-in models; replacing the
  stand-ins is LAI 01's art decision (`docs/TREASURE_RUSH_ASSET_REQUIREMENTS.md`). The `feather`
  keeps its stand-in until a licensed replacement is published (owner, 2026-11-25).
- **Bolt's Workshop and Fossil Ridge Camp.** Not converted yet; their asset plan is on Trello
  #247 (LAI-2206, LAI-2208) and goes into this file when a realm owner starts the conversion.
- **Speech.** Pip, Keeper Quill and the castle narration are Polly lines through Django, never
  Asset Library files.

## 6. Sourcing order (recommendation)

1. The 16 required Treasure Rush cues (3.1). Five of them (`sfx-learning-correct`, `-retry`,
   `sfx-quest-complete`, `sfx-treasure-reveal`, `sfx-reward-collect`) are also the castle's, so
   this batch serves two realms.
2. `ambient-castle-hall`, then the rest of the castle (3.2).
3. Settle 1.3 (format and loudness) before the Firepeak and North Pole batches.
4. Firepeak and North Pole audio, required rows first.
5. Models by realm owner priority. For each character, run the NPC seed with `--promote` after
   publishing.

After each batch, the dry run of that realm's seed lists what is still `ASSET NEEDED`. That
report is the live status; this file only says what each file must be.
