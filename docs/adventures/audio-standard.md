# Audio Standard

- **Status:** Mandatory policy (ADR-072, accepted by the owner 2026-11-18). These standards are the final authority after the owner.
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-033, ADR-035, ADR-044, ADR-045, ADR-048 (Proposed), ADR-049 (Proposed), ADR-050 (Proposed), ADR-053, ADR-054, ADR-064, ADR-072 (Accepted)
- **Canonical sources:** [`docs/audio/SOUND_MANAGER_ARCHITECTURE.md`](../audio/SOUND_MANAGER_ARCHITECTURE.md), [`docs/audio/SOUND_MANAGER_USAGE.md`](../audio/SOUND_MANAGER_USAGE.md), [`docs/audio/PHASE_2_ASSET_INTEGRATION.md`](../audio/PHASE_2_ASSET_INTEGRATION.md), [`docs/audio/SPATIAL_AUDIO.md`](../audio/SPATIAL_AUDIO.md), [`docs/audio/MUSIC_MIXING.md`](../audio/MUSIC_MIXING.md), [`docs/audio/CHILD_AUDIO_PREFERENCES.md`](../audio/CHILD_AUDIO_PREFERENCES.md), [`docs/audio/AMAZON_POLLY_INTEGRATION.md`](../audio/AMAZON_POLLY_INTEGRATION.md), [`docs/DECISIONS.md`](../DECISIONS.md)

Every sound an adventure plays (music, effects, ambience, narration, character voices, interface)
goes through the one shared Sound Manager. This page is the policy; the canonical sources hold the
API and behaviour.

**State.** The Sound Manager (`react/src/audio/`), the Django `audio` app (cues, assignments,
releases, child settings) and the `speech` app (Polly behind a fake client) are **Implemented
(main)**, development only. ADR-048, ADR-049 and ADR-050 are still **Proposed** in the registry;
ADR-054 (Accepted) builds on them. Nothing has been heard in a real browser, no live Polly call has
been made, and live synthesis is off by default (`LAI_SPEECH_PROVIDER=disabled`).

## 1. Rules every adventure follows

| # | Rule | Source |
|---|---|---|
| S1 | Use the shared Sound Manager and one `AudioContext` per page. Never create a manager, context, mixer, music player, `THREE.AudioListener` or `PositionalAudio` in an adventure | SM-D4, ADR-048 item 1 |
| S2 | No third-party audio library (Howler, Tone) | SM-D2, CLAUDE.md section 13 |
| S3 | Play sounds by stable cue id. URLs come only from the resolver; never write a storage host or bucket path | SM-D5, ADR-050 |
| S4 | Which sounds exist, their mix and where they play are Django data, edited only in Django Admin and served as a published release | ADR-050, ADR-045 |
| S5 | Each adventure owns a **scope** and disposes it when the child leaves | SM-D4 |
| S6 | Audio never throws into game code and never blocks play; games do not branch on whether a sound played | SM-D6 |
| S7 | Audio is never the only carrier of meaning. Every spoken line has text; every important sound has a visual cue | CLAUDE.md section 13, ADR-049 item 6 |
| S8 | Games speak only server-approved references. The browser never sends text to synthesize and never calls Polly | ADR-049 item 2 |
| S9 | Diagnostics carry sound ids and codes only; never child text, names or ids | CLAUDE.md section 13 |

## 2. Channels and cue naming

| Channel | Use | Default volume |
|---|---|---|
| `music` | Background music | 0.50 |
| `ambient` | Environmental beds | 0.50 |
| `sfx` | Gameplay effects | 0.80 |
| `voice` | Narration, NPCs, Chatty | 1.00 |
| `ui` | Buttons, menus | 0.70 |

Cue ids are `<channel>.<group>.<name>` (for example `sfx.chest.open`,
`music.treasure_rush.explore`), lower case, at most 80 characters; the first word must match the
channel. An id is a promise to games and releases: never edited, never reused.

## 3. Music, SFX and ambient

| Need | Use | Canonical |
|---|---|---|
| Background music and transitions | `createMusicStates` (states `exploration`, `puzzle`, `suspense`, `victory`, `narration`, `idle`) over the shared `MusicDirector`; true crossfades, one stream at a time | [`MUSIC_MIXING.md`](../audio/MUSIC_MIXING.md) |
| Playlists | `PlaylistDefinition` (sound ids only, no URLs) | Same |
| Effects | `scope.play('<cue id>')` from engine events, in the hosting view or scene loop | [`SOUND_MANAGER_USAGE.md`](../audio/SOUND_MANAGER_USAGE.md) |
| Ambient beds | Sound assignments on Island, Place or 3D Area scope; zones for overlapping beds | [`PHASE_2_ASSET_INTEGRATION.md`](../audio/PHASE_2_ASSET_INTEGRATION.md), [`SPATIAL_AUDIO.md`](../audio/SPATIAL_AUDIO.md) |

Assignments attach a cue to a closed set of events on a target (`scope`, `adventure`, `quest`,
`npc`, `object`, `chest`, `reward`, `zone`). The deepest scope replaces a more general one for the
same target, event and channel. The engine emits typed events; it does not play sounds or import
the audio package's React bindings (ADR-020).

Calm design: no anxiety-building countdown sounds, no loss or failure stings that shame, no
repetitive reward loops (CLAUDE.md section 4, pillar 7). Correct and retry feedback stays gentle.

## 4. Spatial audio (ADR-048, Proposed)

- A positional voice is `source > gain > PannerNode > channel` on the shared context, so volume,
  mute, reduced intensity and ducking still apply.
- Positions are plain `[x, y, z]` metres read through functions (`objectPositionReader`,
  `fixedPosition`, `createCameraListener`); the audio package imports nothing from `three`.
- Use `createSpatialEmitters` for placed sources and `createAudioZones` for beds; feed the
  listener once per frame from the scene loop, not React state.
- Staff set positional mode, distances and cones per cue in Django; the game supplies positions.
- Limits: 12 positional sounds, equal-power panning, no occlusion, reverb or doppler. Invalid
  options play flat; unsupported engines play flat.
- **Instructions, narration, correct and retry feedback, rewards and music stay flat.** Essential
  meaning never depends on where the child stands.

## 5. Narration and Polly (ADR-049, Proposed)

| Rule | Detail |
|---|---|
| Django synthesizes | `apps/speech` `PollyClient` with a deterministic fake; `disabled` by default; production never defaults to live Polly |
| References, not text | Requests name an `utterance` (an `ApprovedUtterance` from a validated AI turn, per child, short-lived), a `line` (staff `SpeechLine`), an `npcNode`, or an `npcDialogueNode` (from the ACTIVE NPC release). Text is re-checked with the AI output rules at request time |
| Voices | Staff `VoiceProfile` rows in Django Admin from an explicit allowed voice, language and engine table |
| AI off | If the parent turned AI off, AI text is not spoken |
| Cache and store | Separate speech store, hashed keys with no child id or text, signed expiring delivery, child clips purged on child deletion; generated speech never enters the Sound Library automatically |
| Limits | Per-child and global daily caps, a concurrency gate, a kill switch |
| Playback | `SpeechPlayer` / `useSpeech` play clips as temporary `voice` sounds in a scope; `SpeechCaption` shows text first |
| Opt-in | A world speaks only where it registers a speech binding and staff enable a voice |

Recorded narration that is reusable belongs in the Asset Library as an audio asset with a cue; it is
never a file committed to Git (see [`asset-standard.md`](asset-standard.md) section 11). There is no
word-level timing and no word highlighting from this path.

## 6. Volume controls and child audio preferences

- Per-child mix (master, five channels, per-channel mute, reduced intensity) is stored by Django
  (`apps.audio.ChildAudioSettings`, child-scoped `GET|PATCH /children/<id>/audio/settings/`) and
  applied once by `ChildAudioPreferencesSync` in `App.tsx`. No row means defaults.
- An adventure adds controls with `<ManagerAudioControls />` inside its own panel (Treasure Rush
  uses a HUD Sound button that stays reachable in full screen). It never stores its own volume.
- Parents set the same mix on the child's edit page. Adventures never override saved preferences.
- Reduced intensity halves music and ambience without touching saved volumes.

## 7. Ducking

Automatic: a `voice` sound ducks `music` to about 30 percent (attack 250 ms, release 700 ms) until
every voice ends for any reason. Ducking is a temporary multiplier, never a saved preference. Use
`manager.duck()` holds only for a documented reason, and always release them.

## 8. Audio accessibility

| Need | Requirement |
|---|---|
| Captions | Every spoken line shows its text before and regardless of audio (muted, blocked, slow, failed) in a polite live region |
| Visual cues | Every sound that carries gameplay meaning (a correct answer, a found item, an opened gate) has a visible equivalent |
| Replay | "Hear it again" only when a voice is audible and a speech source exists |
| Mute | Master and per-channel mute work everywhere; muted voice means text only, with no speech request |
| Autoplay | Audio unlocks on the child's first ordinary tap; no permission screen; one-shots before unlock are dropped, loops queue |
| Reduced intensity | Honoured for music and ambience |
| Pre-readers | Sprouts are voice-first, so narration is expected where available, but the text and picture path must still work with sound off |

## 9. Versioning: sound releases (ADR-050, Proposed)

1. Upload and publish the audio file in the Asset Library.
2. Create a `SoundCue` (channel, id, audio asset, optional pinned version, mix settings).
3. Create `SoundAssignment` rows (scope, target, event, cue).
4. Publish the sound library: validation runs over everything; on success one immutable
   `SoundRelease` pins each cue to an exact `AssetVersion`. Exactly one release is live.
5. Roll back by re-publishing an earlier snapshot as a new release.

Editing a cue changes nothing a child hears until a release. Retiring an asset drops its cue from
the live manifest silently and blocks the next publish until fixed. Roles come from
`manage.py ensure_sound_roles`. Games read `GET /children/<id>/audio/manifests/{islands,places,regions}/<id>/`
and resolve `asset-id@version` through the shared asset resolver.

Background audio processing (transcoding, loudness, LAI-LAMBDA-008) is pending on branches only
(Reserved ADR-067); do not depend on it.

## 10. Failure behaviour: silent and graceful

| Failure | Behaviour |
|---|---|
| Web Audio missing or blocked | Whole system becomes an inert no-op; the adventure plays silently |
| Unknown id, missing asset, HTTP or decode error, voice limit | `play` resolves `null` with a diagnostic; nothing thrown |
| No manifest (build without the Django API, or none published) | Only sounds the application registers itself play |
| Retired audio asset | Its cue drops from the live manifest; play continues |
| Music cannot play | Current music continues; `onUnavailable` fires once |
| Speech disabled, rate-limited, rejected or failed | Caption stays; quiet "text only" state, never a dialog |
| Scope disposed mid-load | No voice is ever created |

## 11. Checklist for an adventure's audio

- [ ] Every sound is a published cue played by id through the adventure's scope; scope disposed on exit.
- [ ] No new audio context, manager, library, mixer or volume store.
- [ ] Every spoken line has a caption; every meaningful sound has a visual cue.
- [ ] Instructions, feedback and rewards are flat, not positional.
- [ ] Speech uses server-approved references only; AI-off path tested.
- [ ] Child mix respected; controls reachable in full screen.
- [ ] Silent-failure paths covered by tests with the fake engine.
- [ ] No audio file committed to Git.
- [ ] Owner audible check listed as manual QA (not claimed as done).
