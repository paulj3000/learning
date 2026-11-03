# Treasure Rush audio (Sound Manager Phase 3, SM-P3-01 to SM-P3-10)

Status: development complete and unit-tested on `feature/sound-manager` (2026-11-03). **Nothing has
been heard.** No browser, Playwright or live playback was run; behavior is proved with the fake
audio engine only. A complete Phase 3 stays silent until audio files are uploaded, assigned
and published through Django Admin.

Tracker note: the repository tracker already used `SM-P3` for "sound library reporting" and `SM-P4`
for "Treasure Rush integration". This work is the tracker's **SM-P4**; its ten sub-tasks keep the
brief's names `SM-P3-01` to `SM-P3-10`. The reporting task keeps the id `SM-P3` and is not done.

## 1. Audit: what Treasure Rush really has (SM-P3-01)

Treasure Rush is Treasure Cove, the `region-play` 3D area (`treasure-rush-cove`). The React half is
`RegionPlayCompanion.tsx`; the server decides every outcome through the Django play API.

| Question | Finding |
|---|---|
| Entry and exit | The companion mounts for the visit and is remounted per child and region (`key`). Mount starts or resumes the session; unmount ends the visit. |
| Scene load and disposal | Owned by the Three.js location view, not by sound. Sound follows the companion's lifetime. |
| Zones | Four zones in `treasure_cove_layout.py`: `cove-zone-landing` (Pirate Landing), `cove-zone-grove` (Palm Tree Grove), `cove-zone-beach` (Shipwreck Beach), `cove-zone-ruins` (Ancient Treasure Ruins). The engine emits `PlayerEnteredZone` on the region bus when the child steps in (also on the first frame, at the spawn). There is **no exit event**. |
| Lookout Point | Reached over a bridge laid after the first quest. It has **no zone**, so no event says the child is there. |
| Chests | Server-owned. The companion asks for a challenge, sends the answer, and the server says `correct`, `chestOpened`, rewards and quest updates. |
| Pickups | Only the brass key is picked up (`collectPickup`); the server answers `pickedUp` and `newItems`. |
| NPC | Pip. `talkToNpc` returns quest updates; `justCompleted` brings the finale. |
| Rune puzzle | A PUZZLE-presentation chest: the server's numbers sit on three stones; touching a stone submits the answer. |
| Replay | The spyglass chest (REPLAY presentation) is practice: a right answer is a kind note, "Play again" requests a fresh challenge. |
| Coins, gems | **No coin or gem pickup mechanic exists.** Coins are numbers in math questions. A chest reward ("Golden Doubloon") is an item in a reveal panel. |
| Existing sound logic | TR-19 left `region-play/soundCues.ts`: seven named moments raised through `playCue(cue)` into one optional sink. Nothing registered a sink, so the cove was silent. Phase 3 registers that sink; it did not add a second mechanism. |

### Event map: gameplay moment to cue

Moments are raised by the companion from authoritative results, after the server confirmed them,
once per attempt or event (the existing guards: `celebrated`, `submittedAttempt`, `setUnlocked`
returning true, `lastPickup.pickedUp`, `justCompleted`).

| Moment (`SoundCue`) | Raised when | Sound cues played |
|---|---|---|
| `answerRight` | A chest answer is server-confirmed correct, for an attempt submitted in this visit | `sfx.learning.correct` |
| `chestOpen` | The same outcome has `chestOpened` | `sfx.chest.open`, `sfx.treasure.reveal` |
| `celebrate` | A correct answer that did not open a chest | `sfx.reward.collect` |
| `questComplete` | The answer's `questUpdates` has `justCompleted`, or Pip's reply does | `sfx.quest.complete`, and the victory music |
| `answerRetry` | A chest or practice answer is server-confirmed wrong | `sfx.learning.retry` |
| `stoneRight` | The rune puzzle is solved (server verdict) | `sfx.learning.complete` |
| `stoneWrong` | A wrong rune stone | `sfx.learning.retry` |
| `replayWin` | A right answer on the spyglass practice | `sfx.learning.correct` |
| `keyPickup` | `pickedUp` with new items | `sfx.key.discover` |
| `bridgeOpen` | The scene opened the gate for the first time this visit | `sfx.world.bridge_open` |

Not implemented because no mechanic exists: `sfx.coin.collect`, `sfx.gem.collect`,
`sfx.item.pickup`. They are listed as optional cues. "Objective completed" has no event separate
from a quest stage advancing, so it has no cue of its own; `sfx.learning.complete` is used for
the solved puzzle only.

A reloaded, already-finished state raises nothing: the guards above only fire for an attempt or
change made in this visit.

## 2. How it is wired

```text
Django Admin: audio asset (Asset Library) -> sound cue -> publish a sound release
    -> GET /children/<id>/audio/manifests/regions/<region id>/      (read-only, no urls)
    -> useAudioManifest (shared Sound Manager registry, asset@version -> signed url)
    -> useTreasureRushAudio (scope "treasure-rush")
         -> slot "ambience"  <- PlayerEnteredZone (bus)
         -> slot "music"     <- puzzle out / quest complete
         -> sink for playCue <- RegionPlayCompanion (authoritative moments)
```

New files, all under `react/src/features/region-play/audio/`:

- `treasureRushSounds.ts`: cue ids, the zone-to-ambience map, the moment-to-cue map. No urls, no filenames.
- `soundSlot.ts`: "one sound in one place" over the shared manager (ambience, music).
- `treasureRushMusic.ts`: explore, puzzle and victory state over one slot.
- `useTreasureRushAudio.ts`: the hook the companion calls once.

Changed: `RegionPlayCompanion.tsx` (mounts the hook, three new moments, reports "puzzle out"),
`soundCues.ts` (three new moments: `answerRight`, `answerRetry`, `questComplete`). No game rule,
reward, question, placement or navigation changed. The play API was not touched.

Shared Sound Manager parts used as is: `useAudioManifest`, `useSoundScope`, the manager's
registry, asset resolver, channels, fades, unlock and diagnostics.

### Manifest loading (SM-P3-02)

- Scope: `{ type: 'region', id: <manifest region id> }`; the source is `djangoAudioSourceFor(childId)`,
  which uses the Cognito client, so authentication and child scoping are the existing ones.
- A build without the Django API (no source) requests nothing and the game is silent.
- One load per mount. `useAudioManifest` shares an in-flight request, replaces (never duplicates)
  its definitions on refresh, and disposes them on exit.
- A failed, invalid or empty manifest leaves the game silent and records a developer diagnostic
  (`manifest-failed`, `invalid-manifest`, `missing-sound`). The game never waits for it.
- A manifest that arrives after the game started gives waiting ambience and music their audio
  (`reapply`). A cue that fails is **not** retried on its own.
- Sounds are played by cue id, so the cues must be in the manifest. Staff mark them **shared**
  (the seed command does), which includes them in every manifest without a per-target assignment.

## 3. Ambience (SM-P3-03)

| Zone | Cue |
|---|---|
| Pirate Landing (`cove-zone-landing`) | `ambient.treasure_rush.ocean` |
| Palm Tree Grove (`cove-zone-grove`) | `ambient.treasure_rush.jungle` |
| Shipwreck Beach (`cove-zone-beach`) | `ambient.treasure_rush.ocean` |
| Ancient Treasure Ruins (`cove-zone-ruins`) | `ambient.treasure_rush.cave` |
| Before any zone event (spawn is Pirate Landing) | `ambient.treasure_rush.ocean` |
| Lookout Point | not mapped: no zone exists (see limitations). `ambient.treasure_rush.wind` is optional and unwired |

One bed at a time: entering a zone fades the old bed out (1.5 s) and the new one in. A zone that
shares the current bed (Landing to Beach) or the same zone again changes nothing. Entering a zone
with no mapping keeps the current bed. Leaving a zone has no event, so a bed ends when the next
zone is entered or the game is left. No spatial audio.

## 4. Music (SM-P3-05)

| State | Cue | Loops | When |
|---|---|---|---|
| Explore | `music.treasure_rush.explore` | yes | From entry; restored after puzzle or victory |
| Puzzle | `music.treasure_rush.puzzle` | yes | While the server's challenge for a PUZZLE chest (the ruins runes) is out |
| Victory | `music.treasure_rush.victory` | no | Once, when a quest is completed; then back to explore (or puzzle) when it ends, or at once if it has no audio |

Treasure discovery, the replay and ordinary chest questions keep the exploration music; they have
their own effects. Changes are true crossfades (SM-P6, `docs/audio/MUSIC_MIXING.md`): the new track fades in over 1.2 s and the
old one fades out over the same time once the new one is audible. Music stops when the
visit ends.

## 5. Cleanup and fallback (SM-P3-07, SM-P3-08)

- Every game sound is played in the `treasure-rush` scope. Leaving the game disposes the scope:
  playing instances stop, queued and loading sounds are cancelled. Global and interface sounds
  are not in that scope and are not touched.
- A start that finishes after the visit ended, or after the cue was replaced, stops itself
  (generation check in `soundSlot.ts`). A manifest that arrives after exit registers nothing.
- StrictMode: the scope re-attaches, the slots re-activate with their remembered state, and the
  sink is registered once per live mount. Tested.
- The next visit builds fresh slots; nothing from the earlier visit can play.
- The educational text, toasts and panels are unchanged and never depend on sound.
- Handled silently: no manifest, network error, empty manifest, missing cue, missing or retired
  asset (the asset route refuses it), expired url (one refresh and retry in the manager), blocked or
  suspended audio context, decode failure, muted channel. Developers see diagnostics via
  `manager.getDiagnostics()`.
- A missing file is never replaced by another file and no placeholder is created.

## 6. Setting it up in Django Admin (SM-P3-10)

```bash
python manage.py migrate
python manage.py ensure_asset_roles
python manage.py ensure_sound_roles
```

1. **Asset library**: upload each audio file as an audio asset whose **Asset id is the cue id with
   dashes**, for example `sfx-chest-open` for `sfx.chest.open`, `ambient-treasure-rush-ocean` for
   `ambient.treasure_rush.ocean`. Categories: `sound` for effects and ambience, `music` for music.
   Validate and **publish** each version.
2. Create the cues, either by hand (Sound library, Sound cues, Add) or with the idempotent seed:

   ```bash
   python manage.py seed_treasure_rush_sound --dry-run   # what would happen
   python manage.py seed_treasure_rush_sound
   ```

   The command creates a cue only when its audio asset exists, is audio, has a published default
   version and suits the channel. Existing cues are never changed. It marks cues **shared**, sets
   loop, stream, volume and fades from `apps/audio/treasure_rush_cues.py`, creates no assignment,
   touches nothing for other games and **never publishes**. Anything missing is printed as
   `ASSET NEEDED <cue>: <what to upload>`; nothing is substituted.
3. Sound library, **Publish the sound library**. Until a release is published the cove is silent.
4. Optional later: scope assignments (for example Place or 3D Area `on_enter`) are supported by the
   library but Phase 3 does not need any; the game plays shared cues by id.

## 7. Audio content checklist

Legend: **Have** means a cue-ready asset exists in the Asset Library today (not checked here:
this branch has no database content, so every row is **missing** until you upload); **Publish**
means the cue must be created and a release published.

All cues are required for a full pass, except the optional ones.

| # | Cue id | Asset id to upload | Channel / category | Loop | Needed for |
|---|---|---|---|---|---|
| 1 | `ambient.treasure_rush.ocean` | `ambient-treasure-rush-ocean` | ambient / sound | yes | Landing, Beach, entry |
| 2 | `ambient.treasure_rush.jungle` | `ambient-treasure-rush-jungle` | ambient / sound | yes | Grove |
| 3 | `ambient.treasure_rush.cave` | `ambient-treasure-rush-cave` | ambient / sound | yes | Ruins |
| 4 | `music.treasure_rush.explore` | `music-treasure-rush-explore` | music / music | yes | Always |
| 5 | `music.treasure_rush.puzzle` | `music-treasure-rush-puzzle` | music / music | yes | Rune puzzle |
| 6 | `music.treasure_rush.victory` | `music-treasure-rush-victory` | music / music | no | Quest complete |
| 7 | `sfx.chest.open` | `sfx-chest-open` | sfx / sound | no | Chest opens |
| 8 | `sfx.treasure.reveal` | `sfx-treasure-reveal` | sfx / sound | no | Reward appears |
| 9 | `sfx.key.discover` | `sfx-key-discover` | sfx / sound | no | Key pickup |
| 10 | `sfx.reward.collect` | `sfx-reward-collect` | sfx / sound | no | Reward without a chest |
| 11 | `sfx.world.bridge_open` | `sfx-world-bridge-open` | sfx / sound | no | Lookout bridge |
| 12 | `sfx.learning.correct` | `sfx-learning-correct` | sfx / sound | no | Right answer |
| 13 | `sfx.learning.retry` | `sfx-learning-retry` | sfx / sound | no | Wrong answer (soft, never a buzzer) |
| 14 | `sfx.learning.complete` | `sfx-learning-complete` | sfx / sound | no | Rune puzzle solved |
| 15 | `sfx.quest.complete` | `sfx-quest-complete` | sfx / sound | no | Quest finished |
| opt | `ambient.treasure_rush.wind` | `ambient-treasure-rush-wind` | ambient / sound | yes | Lookout Point; unwired (no zone) |
| opt | `sfx.coin.collect`, `sfx.gem.collect`, `sfx.item.pickup` | `sfx-coin-collect`, `sfx-gem-collect`, `sfx-item-pickup` | sfx / sound | no | No mechanic yet; unwired |

Status today: cues already available **none verified**; cues configured but missing audio **all
15**; cues needing publication **all 15**; optional **4**. Run the seed with `--dry-run` for the
live picture of your database.

## 8. Manual verification checklist (to be done by a person with sound)

Preparation: complete section 6 for at least the cues you want to hear, publish a release, sign in
as a parent with a child, open Treasure Cove. Cues without a published file are silent by design;
a step is only "needs asset" for the cue named. Nothing below has been done yet.

1. **Start.** Open Treasure Cove. Tap once anywhere (browsers need a tap). Expect ocean ambience
   (#1) and exploration music (#4).
2. **Zones.** Walk to the grove west: jungle (#2) replaces ocean. To the ruins south: cave (#3).
   Back to the beach east: ocean again. The same bed should never double.
3. **Chest.** Talk to Pip, accept the quest, open the chest, answer correctly. Expect soft correct
   (#12), chest open (#7) and reveal (#8) together, once.
4. **Treasure and key.** Pick up the brass key: key discover (#9). A reward without a chest: #10.
5. **Wrong answer.** Answer wrongly: a gentle retry (#13), once, and the "try again" text.
6. **Rune puzzle.** Open the pedestal puzzle: music changes to puzzle (#5). A wrong stone: retry
   (#13). A right stone: complete (#14); music returns to exploration (#4).
7. **Objective and quest.** Return to Pip to finish the quest: quest complete (#15) and the victory
   music (#6) plays once, then exploration music returns. The bridge opening plays #11.
8. **Replay.** Use the spyglass at Lookout Point: a right answer plays correct (#12); "Play again"
   asks a new question with no duplicate loops.
9. **Exit.** Leave the cove (browser back or map). All Treasure Rush sound should stop within the
   fade. Enter again: one bed and one track, nothing doubled.
10. **Volume and mute.** Use the Sound Manager settings (there is no volume screen yet: from the
    console, `getSharedSoundManager()` is not exposed; in a test build use a dev settings panel if
    present). Expect mute to silence without restarting the loops. If there is no control, record
    that as a Phase 4 item (parent/child preferences, SM-P5).
11. **No audio.** Unpublish or use a child with no release: the game must work fully with every
    message still shown.

## 9. Tests

`react/src/features/region-play/audio/treasureRushAudio.test.tsx` (hook, fake engine, no browser):
manifest registration and scope, late manifest, signed-url resolution, ambience transitions and
no restarts, every moment's cues, overlap of rapid pickups, re-render safety, music
puzzle/victory/restore, fades, scope cleanup on exit, late manifest after exit, app sounds left
alone, replay, rapid entry and exit, StrictMode, failed and empty manifest, missing cue, no source,
no retry loops, suspended context, mute and volume. `RegionPlayCompanion.test.tsx` adds moment
tests (wrong answer once, correct then open once, no repeat on reload, finale once).
Django: `apps/audio/tests/test_treasure_rush_seed.py`.

## 10. Known limitations

- Not heard anywhere. Autoplay unlock, streaming, fades and mixing were not tested in a browser.
- The child's volume and mute controls are the Sound button in the game (SM-P5, `docs/audio/CHILD_AUDIO_PREFERENCES.md`).
- Crossfades use linear fades (SM-P6); ducking engages only if a voice cue is played, and none exists.
- Lookout Point has no zone, so no wind bed; leaving a zone has no event. A Lookout zone is a
  layout change (Django seed and TypeScript manifest) and was not made here.
- No coin, gem or generic item-pickup mechanic exists, so those cues are not wired.
- "Objective completed" and "challenge completed" share what the game exposes: the puzzle solve
  and the quest completion. No separate stage-advance moment is raised.
- Leaving the game stops sounds immediately (the scope is disposed); only track changes fade.
- Music state "treasure discovery" is not a separate track; it uses sound effects over exploration.
- Spatial audio (SM-P7), playlists and ducking (SM-P6) and narration (SM-P8) are later phases.
