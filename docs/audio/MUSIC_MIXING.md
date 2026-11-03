# Music mixing, ducking and playlists (SM-P6)

Status: development complete and unit-tested on `feature/sound-manager` (2026-11-03) with the fake
audio engine. **Not heard.** Real crossfade smoothness, ducking depth and streamed-music behavior
need your ears in a browser.

Nothing here replaces the Phase 1 engine. It adds one engine hook (a ramp time on channel gain),
one manager feature (ducking), and a shared music package (`react/src/audio/music/`) built on the
manager's existing scopes, handles and fades. No game has its own mixing code.

## 1. Crossfades (SM-P6-01)

`createMusicDirector({ player, crossfadeMs })` plays music through a `SoundPlayer` (use a scope, so
leaving a game stops it).

| Behavior | How |
|---|---|
| True overlap | The new track loads and starts with a fade-in; **only when it is audible** the old track fades out over the same time. No gap, even if the new file is slow. |
| Length | `crossfadeMs` (default 1200); per call with `play(target, { crossfadeMs })`; 0 cuts. |
| Volume | Fades are on each sound's own gain, so master and music-channel volume apply unchanged. |
| Mute | Muting is the channel's gain, separate from the fades: a mute during a transition keeps silence and unmute restores the level. |
| Rapid requests | Each request supersedes the last. A track that finishes loading after it was superseded stops itself and never fades in; only the latest request wins. |
| No duplicates | Asking for the track that already plays does nothing. |
| No orphans | The director tracks the playing track and every track fading out (`director.sounding`); `deactivate` stops all of them at once, including late loads. |
| Streaming | Whatever the cue says (`stream: true` in Django) is honored; the director adds nothing. |
| Missing audio | If the requested music cannot play, the current music keeps going and `onUnavailable` fires once. Nothing retries on its own; `retry()` tries the wanted music again (call it when a new manifest arrives). |

## 2. Ducking (SM-P6-02)

A temporary multiplier inside the Sound Manager, applied where channel gain is computed:
`channel gain = saved volume x mute x ducking`. It is never a preference: the saved volume and the
settings object are untouched, and there is exactly one place gains are computed, so ducking cannot
compete with other fades.

```ts
manager.setDucking({ level: 0.3, attackMs: 250, releaseMs: 700, targets: ['music'] }); // defaults
const hold = manager.duck('music', { level: 0.25 }); // manual hold
hold.release();
```

- **Automatic.** When a sound on a trigger channel (default `voice`) starts, the target channels (default `music`) are ducked to `level` of their current effective level (default 30 percent, within the 25 to 35 percent target), over `attackMs`. The hold is released when that voice's handle ends **for any reason**: finished, stopped, interrupted, stolen, failed, or its scope disposed.
- **Overlapping voices.** Holds stack by taking the lowest level; the music returns only when every hold is released, over `releaseMs`.
- **Mute and volume.** A muted channel stays 0 through a duck; unmuting while ducked restores the ducked level; changing the volume while ducked scales the ducked level.
- **Configurable.** `setDucking` changes `enabled`, `triggers`, `targets`, `level`, `attackMs`, `releaseMs` for later voices. `getDucking()` reads it.
- Engine: `setChannelGain(channel, gain, rampMs?)` ramps for the attack and release time (default is the short 15 ms smoothing).
- No voice assets exist yet, so this has only been proved with the fake engine.

## 3. Playlists (SM-P6-03)

`PlaylistDefinition { id, tracks: logical sound ids, mode }`, data only, no urls.

| Mode | Behavior |
|---|---|
| `sequential` | In order, once, then finished |
| `shuffle` | A shuffled order, reshuffled each round, never repeating a track back to back |
| `loop-all` | In order, forever |
| `repeat-one` | The first track, forever |
| `one-shot` | The first track, once, then finished |

Playlist tracks play as plain one-shots (the cue's loop flag is overridden) so the next can follow.
A missing track is skipped; if none can play the music already playing continues. Shuffle takes an
injected `random`, so tests are deterministic. A finished playlist calls `onFinished`.
`createPlaylistCursor` is pure and usable on its own.

## 4. Music states (SM-P6-04)

`createMusicStates({ player, states, playlists, crossfadeMs, returnTo })` gives games a vocabulary:
`exploration`, `puzzle`, `suspense`, `victory`, `narration`, `idle`. A game maps only the states it
uses to `{ sound }` or `{ playlist }`; an unmapped state is ignored (returns false) and the music
keeps playing. `idle` is a fade to silence. `returnTo(finished)` says where a one-shot (victory)
goes when it ends, or when it has no audio.

```ts
const music = createMusicStates({
  player: scope,
  states: { exploration: { sound: 'music.game.explore' }, victory: { sound: 'music.game.win' } },
  returnTo: (finished) => (finished === 'victory' ? 'exploration' : null),
});
void music.setState('exploration');
```

## 5. Treasure Rush (SM-P6-05)

`treasureRushMusic.ts` is now a thin mapping onto `createMusicStates`: exploration, puzzle and
victory cues. Exploration to puzzle, puzzle to exploration, exploration to victory and victory back
to exploration (or puzzle, if a puzzle is out) are true crossfades. One music stream at a time.
Event wiring is unchanged and no gameplay event was added. No voice cue or NPC dialogue was invented;
ducking engages automatically if a voice cue is ever played.

Behavior difference from the first version: the old track now keeps playing until the new one is
audible, and a victory theme that has no audio simply leaves the exploration music running.

## 6. Tests

`music/playlist.test.ts` (modes, determinism, boundaries, empty), `music/MusicDirector.test.ts`
(crossfade timing and gap-free overlap, per-call length, no duplicates, streaming, rapid
cancellation, bursts, mute during transitions, deactivate with late loads, scope disposal,
playlists in order, loop, shuffle, missing and empty), `music/musicStates.test.ts`,
`SoundManager.ducking.test.ts` (30 percent, saved volume, overlapping and interrupted voices, scope
disposal, failure, mute, volume change, other channels, config, manual holds, disposal), and the 39
Treasure Rush audio tests unchanged.

## 7. Limits

- Not heard. Streamed music through `HTMLAudioElement` may differ from the fake engine.
- A crossfade overlaps in time but not in loudness law: both tracks use linear fades, so the middle can dip or bump slightly. An equal-power curve is a later refinement.
- A track change inside a playlist is not a crossfade (a track ends, then the next fades in).
- Ducking applies to channels, not to individual music tracks.
- Ducking depth is global; there is no per-voice amount yet.
- The music director has no UI and saves nothing.
