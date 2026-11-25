# Treasure Rush: audio asset inventory

Status: inventory for the release playthrough (LAI 01, 2026-11-25, `main` `05b54d8a`). It lists
what Treasure Cove and Pirate's Leap can play, what is missing, and what each file must be. No
audio file exists for any cue today, so the game is silent. **No audible check has passed.**

Sources of truth: the cue specs in `lai/apps/audio/treasure_rush_cues.py` (30 cues), the cue ids
the game plays in `react/src/features/region-play/audio/treasureRushSounds.ts`, and the wiring
in `docs/audio/TREASURE_RUSH_AUDIO.md`. This file adds the format, availability and licence
columns and does not change any of them.

## 1. Availability today

`seed_treasure_rush_sound --dry-run`, run against a freshly seeded database on `main` `05b54d8a`
(migrate, `load_content`, `seed_treasure_rush`, `publish_treasure_rush`, `seed_npc_pip --publish`),
reports:

```text
Would create 0 cue(s): none
Already present (untouched): 0
ASSET NEEDED <cue>: upload an audio asset with id '<asset id>'     (30 lines, one per cue)
```

No audio asset is in the repository, in `load_content`, or in any seed. The repository has no
licensed audio source to import from. Every row below is therefore **Missing**. To get the live
picture of a database, run the dry run (section 5).

## 2. Required cues (16): needed for the audio part of the release playthrough

All 16 are raised by the game today. Without them the game is complete but silent at that moment.

| # | Asset id to upload | Cue id | Purpose | Trigger or location | Channel, loop | Recommended file | Available |
|---|---|---|---|---|---|---|---|
| 1 | `ambient-treasure-rush-ocean` | `ambient.treasure_rush.ocean` | Waves and gulls | Entry (spawn), Pirate Landing, Shipwreck Beach | ambient, loop | Stereo, 30 to 90 s seamless loop | Missing |
| 2 | `ambient-treasure-rush-jungle` | `ambient.treasure_rush.jungle` | Birds and rustling palms | Palm Tree Grove | ambient, loop | Stereo, 30 to 90 s seamless loop | Missing |
| 3 | `ambient-treasure-rush-cave` | `ambient.treasure_rush.cave` | Low echoing air | Ancient Treasure Ruins | ambient, loop | Stereo, 30 to 90 s seamless loop | Missing |
| 4 | `ambient-treasure-rush-wind` | `ambient.treasure_rush.wind` | Open sky wind | Lookout Point (after the bridge) | ambient, loop | Stereo, 30 to 90 s seamless loop | Missing |
| 5 | `music-treasure-rush-explore` | `music.treasure_rush.explore` | Calm exploration theme | From entry; returns after puzzle and victory | music, loop | Stereo, 60 to 120 s seamless loop | Missing |
| 6 | `music-treasure-rush-puzzle` | `music.treasure_rush.puzzle` | Gentle focused theme | While the ruins rune puzzle is out | music, loop | Stereo, 30 to 90 s seamless loop | Missing |
| 7 | `music-treasure-rush-victory` | `music.treasure_rush.victory` | Short happy finale | Once, when a quest completes | music, once | Stereo, 3 to 8 s | Missing |
| 8 | `sfx-chest-open` | `sfx.chest.open` | Lid creak and sparkle | A chest the server confirms open | sfx, once | Mono, under 2 s | Missing |
| 9 | `sfx-treasure-reveal` | `sfx.treasure.reveal` | Soft shimmer | The reward appears (with #8) | sfx, once | Mono, under 2 s | Missing |
| 10 | `sfx-key-discover` | `sfx.key.discover` | Key found | Brass key picked up at Shipwreck Beach | sfx, once | Mono, under 2 s | Missing |
| 11 | `sfx-reward-collect` | `sfx.reward.collect` | Reward without a chest | A correct answer that opens no chest | sfx, once | Mono, under 2 s | Missing |
| 12 | `sfx-world-bridge-open` | `sfx.world.bridge_open` | Gate rises, bridge laid | First time the gate opens in a visit | sfx, once | Mono, 1 to 3 s | Missing |
| 13 | `sfx-learning-correct` | `sfx.learning.correct` | Warm, short "right" | A server-confirmed right answer; spyglass right answer | sfx, once | Mono, under 1 s | Missing |
| 14 | `sfx-learning-retry` | `sfx.learning.retry` | Gentle "try again", never a buzzer | A wrong answer or a wrong rune stone | sfx, once | Mono, under 1 s | Missing |
| 15 | `sfx-learning-complete` | `sfx.learning.complete` | Challenge solved | The rune puzzle is solved | sfx, once | Mono, under 2 s | Missing |
| 16 | `sfx-quest-complete` | `sfx.quest.complete` | Quest finished | A quest completes (with #7) | sfx, once | Mono, under 2 s | Missing |

## 3. Optional cues (14)

The first 11 are raised by the game but are optional by design: a missing file is silent, and
jumping, running and the platforms are complete without them. The last 3 are reserved ids for
mechanics that do not exist, and nothing raises them.

| Asset id to upload | Cue id | Purpose | Trigger or location | Raised today | Available |
|---|---|---|---|---|---|
| `sfx-player-jump` | `sfx.player.jump` | Light hop | The child presses Jump | Yes | Missing |
| `sfx-player-land` | `sfx.player.land` | Soft thump | A firm landing (3 m/s or more) | Yes | Missing |
| `sfx-player-footstep` | `sfx.player.footstep` | One soft footstep | Repeated at walk, run or sprint pace | Yes | Missing |
| `sfx-platform-activate` | `sfx.platform.activate` | Platform starts | Pirate's Leap moving platforms, Pirate Lift | Yes | Missing |
| `sfx-platform-move` | `sfx.platform.move` | Soft creak | A platform sets off | Yes | Missing |
| `sfx-platform-stop` | `sfx.platform.stop` | Gentle bump | A platform stops | Yes | Missing |
| `sfx-platform-plate` | `sfx.platform.plate` | Click underfoot | The gold pressure plate | Yes | Missing |
| `sfx-platform-bounce` | `sfx.platform.bounce` | Springy boing | A bounce pad (not confirmed that Pirate's Leap has one) | Yes | Missing |
| `sfx-platform-checkpoint` | `sfx.platform.checkpoint` | Cheerful chime | A Pirate's Leap checkpoint | Yes | Missing |
| `sfx-player-recover` | `sfx.player.recover` | Soft whoosh | Back to safety after a fall | Yes | Missing |
| `sfx-platform-goal` | `sfx.platform.goal` | Short fanfare | The Pirate's Leap goal | Yes | Missing |
| `sfx-coin-collect` | `sfx.coin.collect` | Coin | No coin pickup mechanic | No | Missing (not needed) |
| `sfx-gem-collect` | `sfx.gem.collect` | Gem | No gem pickup mechanic | No | Missing (not needed) |
| `sfx-item-pickup` | `sfx.item.pickup` | Generic pickup | Only keys are picked up today | No | Missing (not needed) |

Recommended files for the optional effects: mono, under 1 s (fanfare under 3 s), soft. Footsteps
repeat many times a minute, so they need to be very short and quiet.

## 4. Not an asset: Pip's voice

Pip's lines are spoken by Amazon Polly through Django (`docs/audio/AMAZON_POLLY_INTEGRATION.md`),
not from the Asset Library. Locally `LAI_SPEECH_PROVIDER` defaults to `disabled`, so Pip
speaks in captions only. Hearing Pip needs `LAI_SPEECH_PROVIDER=polly` and AWS credentials,
which is a live AWS service. It is outside a local playthrough unless you choose to enable it.
Captions are shown in every case, so no child-facing text depends on audio.

## 5. File requirements

**What the Asset Library accepts** (`apps/assets/formats.py`, `docs/audio/PHASE_2_ASSET_INTEGRATION.md`):
MP3 (Layer III), WAV (PCM or float), Ogg (Vorbis or Opus); at most 20 MB, mono or stereo, 8 to
96 kHz, at most 15 minutes. Categories: `sound` for effects and ambience, `music` for music.

**Recommended format (LAI 01's recommendation):**
- Deliver **MP3, 44.1 or 48 kHz**: 128 kbps mono for effects, 192 kbps stereo for ambience and
  music. MP3 plays in every browser the tablet-first app targets, including Safari on iPad. Keep a
  WAV master (48 kHz, 16- or 24-bit) for each file so it can be re-encoded later.
- The Ogg Opus and MP3 transcode and loudness normalisation path (LAI-LAMBDA-008b) needs
  `LAI_AUDIO_TRANSCODING`, which is off locally. Until it is used, upload files already at
  these levels: music -18 LUFS, ambience -20 LUFS, effects peak -3 dBFS.
- Loops (#1 to #6) must be seamless. Listen for a gap or click at the loop point after upload,
  because MP3 encoders can add a short silence at the start. If a loop clicks, upload that file
  as WAV: a 60 s stereo WAV at 48 kHz is about 11 MB, inside the 20 MB limit.
- Never a buzzer or a harsh sound for a wrong answer (#14): ages 3 to 8, calm engagement.

**Licensing requirements:**
- Allowed: CC0 1.0, or audio the project owns or commissioned with written rights to use it in
  the app. This matches every third-party model shipped so far.
- **Not allowed today: CC-BY.** ADR-028 requires a parent-reachable attribution surface first,
  and there is none (the same reason the feather model stays a stand-in).
- LAI 01's recommendation: avoid NC, ND and SA licences, and "free" libraries whose terms forbid
  redistributing the file inside an app. Ask before using AI-generated audio.
- For every file, record the source URL, author, licence, licence evidence and SHA-256 in
  `docs/ASSET_LICENCES.md`, the same way as the models.

## 6. Getting from missing to audible (Django Admin, local)

From `docs/audio/TREASURE_RUSH_AUDIO.md` section 6:

```bash
cd lai
../.venv/bin/python manage.py ensure_asset_roles
../.venv/bin/python manage.py ensure_sound_roles
```

1. Asset library: upload each file as an audio asset with the asset id in the tables above,
   then validate and **publish** its version.
2. `../.venv/bin/python manage.py seed_treasure_rush_sound --dry-run`, then the same without
   `--dry-run`. It creates a cue only for an uploaded, published audio asset, and prints
   `ASSET NEEDED` for the rest. It never publishes.
3. Django Admin, Sound library: **Publish the sound library**. Until a sound release is
   published, the cove is silent.

## 7. What happens while audio is missing

The game never waits for audio and never shows an error to the child. These are covered by unit
tests (`treasureRushAudio.test.tsx`, `RegionPlayCompanion.test.tsx`, `apps/audio/tests/`):

- No sound release, empty manifest, failed request, missing cue, retired asset, expired link,
  decode failure, blocked audio: silent, with a developer diagnostic only.
- A missing file is never replaced by another file or a placeholder.
- Every message, caption, question and reward panel shows whether or not sound plays.

The release playthrough checklist marks every audible item **Blocked: audio assets missing**
until the 16 required files are published. Those items cannot pass on silence.
