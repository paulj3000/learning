# Audio Standard

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-020, ADR-035, ADR-044, ADR-045, ADR-048, ADR-049, ADR-050, ADR-054

How music, sound effects, ambience, spatial sound, narration and speech are added to any Realm,
Place or Adventure. Every sound goes through the shared Sound Manager.

**Decision status.** The Sound Manager's decisions are ADR-050 (cues and releases), ADR-048
(spatial audio) and ADR-049 (Polly speech). All three are **Proposed**: the code is on `main`,
but the owner has not accepted them, and live Polly and audible browser verification are open.
This standard describes the implementation as it stands. Rules that rest only on those ADRs are
current practice, not Binding; they become Binding if the owner accepts the ADRs.

| Topic | Canonical document |
|---|---|
| Architecture, channels, autoplay, error recovery (SM-D1 to SM-D6) | [audio/SOUND_MANAGER_ARCHITECTURE.md](../audio/SOUND_MANAGER_ARCHITECTURE.md) |
| Developer usage | [audio/SOUND_MANAGER_USAGE.md](../audio/SOUND_MANAGER_USAGE.md) |
| Cues, assignments, releases, manifest | [audio/PHASE_2_ASSET_INTEGRATION.md](../audio/PHASE_2_ASSET_INTEGRATION.md) |
| Music and ducking | [audio/MUSIC_MIXING.md](../audio/MUSIC_MIXING.md) |
| Child audio preferences | [audio/CHILD_AUDIO_PREFERENCES.md](../audio/CHILD_AUDIO_PREFERENCES.md) |
| Spatial audio | [audio/SPATIAL_AUDIO.md](../audio/SPATIAL_AUDIO.md) |
| Polly speech | [audio/AMAZON_POLLY_INTEGRATION.md](../audio/AMAZON_POLLY_INTEGRATION.md), [audio/POLLY_DEPLOYMENT_RUNBOOK.md](../audio/POLLY_DEPLOYMENT_RUNBOOK.md) |
| Worked example | [audio/TREASURE_RUSH_AUDIO.md](../audio/TREASURE_RUSH_AUDIO.md) |

Code: `react/src/audio/` (`SoundManager.ts`, `sharedSoundManager.ts`, `spatial.ts`, `music/`,
`preferences/`, `speech/`, `world/`, `ui/`), `lai/apps/audio` (cues, assignments, releases,
`ChildAudioSettings`) and `lai/apps/speech` (voices, approved utterances, clips).

Related standards: [asset-standard.md](asset-standard.md), [npc-standard.md](npc-standard.md),
[accessibility-standard.md](accessibility-standard.md),
[adventure-standard.md](adventure-standard.md).

## 1. One Sound Manager

- Use the one shared manager per page (`getSharedSoundManager()` or the React provider). Do not
  create a manager, an `AudioContext`, a `THREE.AudioListener` or `PositionalAudio` in a game.
  Games own **scopes**, not managers; a scope disposes its sounds on unmount (SM-D4, ADR-048
  item 1).
- No third-party audio library (SM-D2). **Binding:** CLAUDE.md §13: do not silently add a
  dependency.
- **Binding:** ADR-020. The game engine never plays audio by calling backends; it emits typed
  events that a world adapter maps to cue ids.
- Sounds are named by stable dotted ids (`sfx.chest.open`, `ui.button.click`); URLs come only
  from a resolver (SM-D5). **Binding:** ADR-035: no hard-coded asset URLs.

## 2. Channels

| Channel | Use for | Default volume |
|---|---|---|
| `music` | Background music | 0.50 |
| `ambient` | Environmental beds | 0.50 |
| `sfx` | Gameplay effects | 0.80 |
| `voice` | Narration, NPCs, Chatty, speech clips | 1.00 |
| `ui` | Buttons and menus | 0.70 |

Put every sound on the channel that matches its purpose; priorities follow the channel. The voice
limit is 24 concurrent instances; lower-priority sounds are dropped first.

## 3. Sound cues and releases (Django)

Current implementation (ADR-050, Proposed):
- A `SoundCue` is a logical name plus playback settings pointing at a `catalog.ContentAsset` of
  kind `audio`. The binary, its versions and delivery stay in the Asset Library
  ([asset-standard.md](asset-standard.md)).
- A `SoundAssignment` attaches a cue to a closed set of events on a target (scope, adventure,
  quest, NPC, object, chest, reward, zone) inside a Realm, Place or 3D Area. The deepest scope
  wins for the same target, event and channel.
- Publishing freezes cues and assignments into one immutable `SoundRelease` pinned to exact
  `AssetVersion`s. One release is live; rollback republishes an earlier snapshot.
- Games read a read-only, child-scoped manifest
  (`GET /api/v1/children/<id>/audio/manifests/{islands,places,regions}/<id>/`) that names audio
  as `asset-id@version` and resolve it through the asset resolver.
- **Binding:** ADR-045. Staff author sounds in Django Admin only; React has no sound editor and
  no write endpoint.

Adding a sound to a world: upload and publish the audio asset, create a cue, assign it, publish a
release. No deploy is needed. A build without the Django API plays only sounds the application
registers itself.

## 4. Music, SFX and ambience

- Music uses named states with gap-free crossfades (`createMusicStates`, `createMusicDirector`).
  Long audio streams through media elements routed into the same graph (SM-D1).
- Music is calm and loopable, without sudden loud peaks. No countdown, urgency or "hurry" music
  (**Binding:** CLAUDE.md §4 pillar 7, calm engagement; ADR-053 retired play-time limits).
- SFX confirm an action within about 100 ms. Wrong-answer sounds are gentle, never a buzzer
  or a shaming sting.
- Ambience uses zones (`createAudioZones`) with priority and fallback beds.
- Sources: [ASSET_SOURCING.md](../ASSET_SOURCING.md) lists vetted CC0 audio packs. Licences go in
  [ASSET_LICENCES.md](../ASSET_LICENCES.md) (**Binding:** ADR-028) or in the ticket for Asset
  Library uploads.
- Format and limits are the Asset Library's (MP3, WAV, Ogg; 20 MB; 15 minutes), see
  [asset-standard.md](asset-standard.md) section 5.

## 5. Spatial audio

Current implementation (ADR-048, Proposed):
- A positional voice is a panner on the shared context; positions are plain `[x, y, z]` metres.
  `src/audio` imports nothing from `three`; Three.js is reached through structural adapters.
- Emitters read positions through functions and are removed with their scope.
- Django configures cue-level distances and zone priority; all optional in the manifest.
- Keep essential narration, instructions and feedback **flat** (not positional). Only a
  character's conversational line may be positional.
- Failure degrades to flat sound or silence, never an error.

## 6. Narration and speech (Polly)

Current implementation (ADR-049, Proposed):
- Django synthesizes through a `PollyClient` interface with a deterministic fake. Live synthesis
  is disabled by default; enabling it is an owner approval.
- **Games speak only server-approved references**: an `ApprovedUtterance` (from a validated AI
  turn), an enabled staff `SpeechLine`, or an NPC dialogue node from the ACTIVE release
  (**Binding** for NPCs: ADR-054 item 8). The client never sends text to synthesize. Text is
  re-checked with the AI output rules at request time.
- Voices are staff configuration limited to an explicit voice, language and engine table.
- Clips play as temporary `voice` sounds in a scope, so mute, volume, ducking and cleanup apply.
- Use `useSpeech` and `speakLine(speech, id, fallbackText)`, `speakNpcNode`,
  `speakCompanionTurn`, `speakTutorTurn`. A world opts in by registering a `SpeechBinding`.
- **Binding:** CLAUDE.md §12. No voice cloning of a child or family member.
- **Binding:** CLAUDE.md §7, ADR-044. Never call Polly or Bedrock from the browser.

## 7. Volume controls and child audio preferences

- `apps.audio.ChildAudioSettings` stores one mix per child: master and per-channel volume and
  mute (separate columns, so mute keeps the volume) and `reduced_intensity`.
  `GET`/`PATCH /api/v1/children/<child_id>/audio/settings/`, parent token only, strict
  validation. No row means defaults.
- `ChildAudioPreferencesSync` is mounted once in `App.tsx`. It resets the manager to defaults
  before loading a child's mix, so one child's mix never carries to the next on a shared device.
- Every game with sound offers the shared controls (`<ManagerAudioControls />`) in its own
  settings panel. Do not build a second volume UI.
- Reduced intensity plays music and ambience at half level without changing saved volumes.
- **Binding:** CLAUDE.md §2. Parents control voice and microphone features; parent screens edit
  the child's saved mix.
- The model stays out of Django Admin (child data).

## 8. Ducking

- Voices lower music to 30 percent automatically. Configure with `manager.setDucking(...)` and
  hold with `manager.duck(channel)`. Ducking is never saved as a setting.
- Do not hand-roll ducking by changing channel volumes; that overwrites the child's mix.

## 9. Accessibility

- **Audio is never the only carrier of meaning.** Every spoken line has visible text; speech
  has captions (`<SpeechCaption />`) that show while loading, muted or failed. Every sound that
  carries information (correct, not yet, item found) has a visual equivalent
  (SOUND_MANAGER_USAGE.md section 6; NPC captions are **Binding** through ADR-054 item 8).
- Captions come first and do not depend on audio (ADR-049 item 6).
- Replay ("Hear it again") is offered for spoken lines where a voice is available, hidden when
  muted.
- No flashing tied to sound, no sudden loud events, no audio that starts before the first child
  gesture (the context unlocks on the first tap).
- Full requirements: [accessibility-standard.md](accessibility-standard.md) and
  [UX_AND_ACCESSIBILITY.md](../UX_AND_ACCESSIBILITY.md).

## 10. Versioning

- Audio binaries are versioned by the Asset Library (`AssetVersion`, immutable once published).
- Mix and placement configuration is versioned by `SoundRelease` (immutable; rollback
  republishes).
- Speech clips are cached by text, voice, engine, language, rate and cache version; changing a
  voice or line makes a new key, never an overwrite.
- Cue ids are stable. Renaming a sound means a new cue; never repoint a cue to an unrelated
  sound.

## 11. Failure behaviour

**Silent failure must never block gameplay.**
- `play` resolves `null` on any failure and never throws into game code (SM-D6). Handles are
  safe no-ops once ended.
- Missing Web Audio, a locked context, a decode failure, a missing asset, an expired URL, a
  retired asset or speech failure all degrade to silence plus a diagnostic; the adventure
  continues and every line stays readable.
- Diagnostics carry sound ids and codes only. **Binding:** ADR-025, CLAUDE.md §13: never log
  child text, names or ids with a sound.
- No retry loops: a failed preference save keeps the live mix; the next change retries.
- Gameplay logic never waits on audio completion without a timeout.

## 12. Tests and checks

Follow [TESTING_STRATEGY.md](../TESTING_STRATEGY.md). Unit tests use the fake engine and fake
`AudioContext`; they prove control flow, not audible output. Targeted examples:

```bash
cd react && npx vitest run --maxWorkers=2 src/audio
.venv/bin/python -m pytest -q lai/apps/audio lai/apps/speech
```

Audible output, autoplay on iOS Safari, latency and live Polly are verified by the owner in a
browser and device pass; record them as deferred checks, never as passed.
