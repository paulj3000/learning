# SC-R06 castle sound: implementation contract (prep)

Status: historical prep contract, written before SC-R06 was built. Where it differs from the
code, the code and `docs/audio/STORYKEEPER_CASTLE_AUDIO.md` (canonical) win. Reconciled with
`main` `1b0a50a3` on 2026-11-23 (SC-R12, LAI 02). The as-built differences:

- The manifest is the **Place** manifest (`GET /api/v1/children/<id>/audio/manifests/places/storykeeper-castle/`),
  never a region manifest. The castle has no `WorldRegion`, so the region route answers 404 for
  it; the client asked for it until GE-090-D7 (PR #63), which left the castle silent.
- One scope, `castle`, holds the beds, music and cues; speech is the separate scope
  `castle-speech`. There is no `castle-ambience` scope.
- The hook is `useCastleAudio.tsx`, mounted by `CastleTaleCompanion` (not by
  `castleTaleViewExtension.tsx`).
- Ducking uses the shared default (voice ducks music to 0.3; ambience is not ducked). No
  castle-specific `setDucking` call was added.
- Cooldowns as built (`lai/apps/audio/castle_cues.py`): 400 ms on `sfx.castle.npc_greet`,
  `sfx.castle.hint_chime` and `ui.castle.door`. Effects have `max_concurrent` 4, and `ui.castle.door` has 2.

Nothing in this file is evidence that any castle sound has been heard: no castle audio files
exist yet, and no browser or device listening check has been run.

## 1. Reuse and the pattern to copy
- Engine: `react/src/audio/` SoundManager, AudioRegistry (`replaceOwned`), AudioChannels (music 60, ambient 40, sfx 20, voice 80, ui 30), `reducedIntensity` (halves music+ambient), DEFAULT_DUCKING (voice ducks music to 0.3 only, NOT ambient; add `targets:['music','ambient']` via `manager.setDucking` for the castle scope or keep ambience under music).
- `react/src/audio/music/musicStates.ts` (`createMusicStates`, gap-free crossfade), `react/src/audio/world/AudioZones.ts` (`createAudioZones`, priority beds), `react/src/audio/manifest/AudioManifestSync.ts`, `react/src/audio/react` (`useAudioManifest`, `useSoundScope`), child prefs `react/src/audio/preferences/` (mounted in App; add `<ManagerAudioControls />` to castle settings).
- Reusable shared cue ids (already in `lai/apps/audio/treasure_rush_cues.py`, shared): `sfx.learning.correct`, `sfx.learning.retry`, `sfx.learning.complete`, `sfx.quest.complete`, `sfx.reward.collect`, `sfx.treasure.reveal`. Reuse these; do not duplicate.
- Pattern to copy: `react/src/features/region-play/audio/{treasureRushSounds.ts,useTreasureRushAudio.ts,treasureRushMusic.ts,treasureRushAudio.test.tsx}` (id table, ZONE_AMBIENCE, ZONE_PRIORITY, POSITIONAL_CUES, CUE_SOUNDS, scope `'treasure-rush'`, 1500 ms ambience fade) and Django `lai/apps/audio/treasure_rush_cues.py` + `management/commands/seed_treasure_rush_sound.py` + `tests/test_treasure_rush_seed.py`. Doc to mirror: `docs/audio/TREASURE_RUSH_AUDIO.md`.

## 2. Event map (scope `castle`; all flat unless noted; fallback = silent, text/visual unchanged)
Rooms (CASTLE_ROOM_IDS in `react/src/features/island-map/three/castleLayout.ts`): beds are `ambient`, loop, stream, vol 0.5, fade 1500, scope `castle-ambience`, priority = ambient 40 (+zone priority for overlaps).
| Event | Cue id | Ch | Pri | Loop | Fallback |
|---|---|---|---|---|---|
| entry-hall, story-hall, character-gallery, costume-room, east-corridor | `ambient.castle.hall` (hall/corridor), `ambient.castle.gallery`, `ambient.castle.costume` | ambient | 40 | y | keep previous bed, else silence |
| setting-tower | `ambient.castle.tower` | ambient | 42 | y | `ambient.castle.hall` |
| illustration-studio | `ambient.castle.studio` | ambient | 40 | y | hall |
| great-library | `ambient.castle.library` | ambient | 42 | y | hall |
| trophy-room | `ambient.castle.trophy` | ambient | 40 | y | hall |
| secret-chamber | `ambient.castle.secret` | ambient | 45 | y | tower |
| Castle theme | `music.castle.explore` (+`.story` while storybook open) | music | 60 | y | none |
| Storybook open / close | `sfx.castle.book_open` / `sfx.castle.book_close` | sfx | 20 | n | none |
| Page restoration | `sfx.castle.page_restore` | sfx | 25 | n | `sfx.treasure.reveal` |
| Quest start / complete | `sfx.castle.quest_start` / `sfx.quest.complete` | sfx | 25 | n | none |
| NPC interaction (Quill, Orion) | `sfx.castle.npc_greet` (spatial, 2.5/20 m like useCastleSpeech) | sfx | 20 | n | none |
| Right / hint / try again | `sfx.learning.correct` / `sfx.castle.hint_chime` / `sfx.learning.retry` (Sprouts: no retry sound, soft hint only) | sfx | 20 | n | none |
| Artifact discovery | `sfx.castle.artifact_found` (positional via POSITIONAL_CUES) | sfx | 25 | n | `sfx.reward.collect` |
| Room transition | `ui.castle.door` + bed crossfade (stop old bed 1500 fadeOut, start new fadeIn) | ui | 30 | n | crossfade only |
Max concurrent 4 for sfx; cooldown 400 ms on `hint_chime`, `npc_greet`.

## 3. Registry, seed, release
- New `react/src/features/island-map/three/extensions/castleTale/castleSounds.ts` (CASTLE_SOUND, ROOM_AMBIENCE: Record<CastleRoomId,string>, ROOM_PRIORITY, POSITIONAL_CUES, CUE_SOUNDS per event) and `useCastleAudio.ts` modelled on `useTreasureRushAudio`: `useSoundScope('castle')`, `useAudioManifest` with the Place scope `{ type: 'place', id: 'storykeeper-castle' }` (as built, GE-090-D7; the castle has no `WorldRegion`, so a region manifest is a 404), createAudioZones keyed by room floor rects, createMusicStates, Sprouts: `setSettings({reducedIntensity:true})` only as a session default when the child has no saved pref, skip `retry`. Mount in `castleTaleViewExtension.tsx`; cleanup on room change = replace bed, on unmount = `scope.dispose()`, `speech.stop()`, zones/emitters dispose.
- Django: `lai/apps/audio/castle_cues.py` (CueSpec table, import `CueSpec` from `treasure_rush_cues`), `management/commands/seed_castle_sound.py` (copy of seed_treasure_rush_sound, same asset-id rule `ambient-castle-hall`, never publishes), `tests/test_castle_seed.py`. Staff attach castle `SoundAssignment`s to the Place `storykeeper-castle` (zone overrides keyed by room id); there is no region scope for the castle. Canonical: `docs/audio/STORYKEEPER_CASTLE_AUDIO.md`.
- Publishing: seed creates shared SoundCue rows only; staff publish a `SoundRelease` in Django Admin; client reads the Place manifest `GET /api/v1/children/<id>/audio/manifests/places/storykeeper-castle/` (as built; this line said `.../region/...` before GE-090-D7). Never auto-publish; deploy needs owner approval.

## 4. Narration (existing Django speech only)
Client: `useCastleSpeech` + `speakLine`/`speakNpcNode`/`speakCompanionTurn` (`react/src/audio/speech/adapters.ts`). One `SpeechPlayer` per scope guarantees one utterance at a time: `speak()` must stop/replace the current one; add a guard dropping a repeat of the same reference within the current playback.
- Quill/Orion dialogue: `npcNode` (`npc:<id>:<node>`, shared AUTHORED clip) or `npcDialogueNode` for active NPC release; pregenerate with `lai/apps/npcs/management/commands/npc_pregenerate_speech.py`. Quill spatial, Orion flat.
- Painted Words pronunciations: `SpeechLine` rows `castle-word-<word>` (voice `narrator`, context `castle`), text from `paintedWordsBank.ts`; add a seed/loader command `seed_castle_speech_lines` (idempotent, text exactly equal to the bank word, test asserts parity). Syllable parts are text-only.
- Storybook page text: `SpeechLine` `castle-page-<pageId>` from `lai/apps/regions/great_storybook_pages.json`, flat.
- Cache key: `services.cache_key` (version, text, voice, engine, language, rate, "shared" or child pk). AI utterances stay CHILD scope and need `child.ai_enabled`; authored lines are shared.
- Permissions: server only; child-scoped route `/children/<id>/audio/speech/` (parent Cognito resolves child), `speech_enabled()`, `ai_enabled`, text_problem, usage limits. No browser-to-Polly.
- Fallback: any SpeechError/404/422/offline resolves to `showText` caption; story proceeds. Voice channel ducks music during playback.

## 5. Unit tests
- `castleSounds.test.ts`: every CastleRoomId has an ambience and priority, ids exist in cue table, no em dashes.
- `useCastleAudio.test.tsx` (mock engine like treasureRushAudio.test): room change crossfades, one bed active, unmount stops scope, mute/volume/reducedIntensity respected, Sprouts omit retry, missing manifest = no throw, ducking active during speech.
- `useCastleSpeech.test.tsx` extension: no overlap, same reference not repeated, stop on room transition/unmount, 404 falls back to caption.
- Django: `test_castle_seed.py` (idempotent, reports ASSET NEEDED, never publishes), speech-line seed parity with word bank and pages JSON, `speak()` with `FakePollyClient` (cache hit second call, ai_enabled off refuses utterance, other family 404).

## 6. Assets needed (Asset Library ids = cue id with dashes; mp3 44.1 kHz stereo -16 LUFS, music/ambience -20)
Ambience loops 30-60 s seamless (9): `ambient-castle-{hall,gallery,costume,tower,studio,library,trophy,secret}` + `music-castle-explore` (loop 90 s), `music-castle-story` (loop 90 s). One-shots: `sfx-castle-book-open` 1 s, `-book-close` 0.8 s, `-page-restore` 2 s, `-quest-start` 1.5 s, `-npc-greet` 1 s, `-hint-chime` 0.8 s, `-artifact-found` 1.5 s, `ui-castle-door` 1 s. Quest-complete, correct, retry reuse existing. Word clips are Polly, not files.
