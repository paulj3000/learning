# Sound Manager architecture (SM-002)

Status: Phase 1 foundation, implemented and unit-tested. Phase 2 (Django sound library and
manifests) is implemented and documented in `PHASE_2_ASSET_INTEGRATION.md`. Not verified in a real
browser (see "Verification limits"). Code: `react/src/audio/`, `lai/apps/audio/`.

## Goals and non-goals

One reusable audio service for every game and screen, so audio is centralized, cleaned up when a
child leaves a scene, and can never block an adventure.

Not in Phase 1: Django audio models, Django Admin workflows, S3 upload, playlists, spatial audio,
narration, text to speech, persisted preferences, ducking. Each is designed for below and not built.

## Decisions (SM-D1 to SM-D6)

These are scoped to this feature, like TR-D*. They do not override any accepted ADR: ADR-020
(Three.js only, engine emits typed events), ADR-033 (one Django backbone), ADR-035 and ADR-042
(Django-controlled private asset storage). These are recorded formally in ADR-050 (Proposed).

| ID | Decision | Why |
|---|---|---|
| SM-D1 | Web Audio API for mixing and short sounds; `HTMLAudioElement` (routed into the same graph) for long-form audio | Gain nodes give real channels, mute and fades. Streaming avoids decoding minutes of music into memory. |
| SM-D2 | No new dependency | The needed surface is small. Howler/Tone would add weight and a second lifecycle model. |
| SM-D3 | The manager owns policy; an `AudioEngine` interface owns output | Tests use a fake engine. Another engine (a different backend, a native bridge) can replace the Web Audio one. |
| SM-D4 | One shared manager and `AudioContext` per page; games own *scopes*, not managers | Browsers limit contexts and unlock them once. Scopes give per-game cleanup without a second context. |
| SM-D5 | Sounds are named by stable id; urls come only from a resolver | Matches `noHardCodedAssetUrls`, and lets Django publishing change files without a deploy. |
| SM-D6 | Audio never throws into game code | `play` resolves `null`; every control on a handle is a safe no-op once ended. |

## Layers

```text
React components / Three.js scenes / game logic
        |  play("sfx.coin.collect")         (stable sound ids)
        v
  SoundManager  (SoundManager.ts)           policy: registry, scopes, volumes, mute, limits, diagnostics
     |        \
     |         AudioRegistry                 id -> SoundDefinition
     |         LifecycleRegistry             instances and pending loads, by scope
     |         SoundAssetResolver ---------> (later) Django asset resolver -> published url
     v
  AudioEngine (interface)                   output: load, decode, voices, gains
     |
  createWebAudioEngine (AudioEngine.ts)     AudioContext graph, buffer cache, streaming
     |
  Browser: AudioContext, fetch, HTMLAudioElement
```

The core (`index.ts`) imports no React. React bindings are in `audio/react/` and import the core,
never the reverse.

## Identifiers

- **Sound id** (`ui.button.click`): names a `SoundDefinition`. Stable, dotted, lower case.
- **Instance id** (`snd-17`): names one `SoundHandle`. Every `play` call makes a new one, so the same
  effect can overlap itself and stopping one instance leaves its siblings alone.
- **Scope id**: names the owner of a set of instances and pending loads.

## Channels

| Channel | Purpose | Default volume | Default priority |
|---|---|---|---|
| `music` | Background music | 0.50 | 60 |
| `ambient` | Environmental soundscapes | 0.50 | 40 |
| `sfx` | Gameplay effects | 0.80 | 20 |
| `voice` | Narration, NPCs, companion | 1.00 | 80 |
| `ui` | Buttons, menus | 0.70 | 30 |

The graph is `voice source gain -> channel gain -> master gain -> destination`. Muting a channel or
the master sends only that node's gain to zero; the configured volume is stored in `SoundSettings`
and is restored by unmuting. Gain changes ramp over about 15 ms to avoid clicks. Priority only
matters when the voice limit (24) is reached: the lowest priority, then oldest, instance is stolen
by an equal or higher one, and a lower-priority newcomer is dropped.

Ducking later means a manager-level rule that ramps the `music` and `ambient` channel gains while a
`voice` instance is alive. It needs no new node, only a settings layer on top of the channel gains.

## Playback flow

1. `play(id, options)` checks the manager and scope are open, looks up the definition, and returns
   `null` (with a diagnostic) for an unknown id or an unavailable engine.
2. It registers a **pending load** under the scope and resolves a url (`assetId` through the
   resolver, with a literal `url` as fallback).
3. The engine fetches and decodes (shared between concurrent callers, cached with a byte cap), or for
   `stream: true` definitions only checks that an audio element can be made.
4. After every `await` it re-checks cancellation. A disposed scope or manager, `stop(id)`, or an
   abort means no voice is ever created.
5. If audio is locked, a **one-shot is dropped** (it would otherwise burst out later) and a **loop is
   allowed to queue**, because a loop starting at unlock is correct for music.
6. The voice limit is applied, the engine voice is created, and a `SoundHandle` is returned.

## Lifecycle and resource ownership

| Resource | Owner | Released by |
|---|---|---|
| `AudioContext`, mixer graph, buffer cache | The engine, created lazily on first use | `manager.dispose()` |
| Decoded buffers | The engine cache (32 MiB cap, least recently used out) | Eviction, dispose |
| Source and gain nodes of an instance | The instance's engine voice | End, `stop`, scope or manager disposal |
| Pending loads | The scope that asked | Completion, `stop(id)`, scope or manager disposal (aborts the fetch when no waiter remains) |
| Gesture listeners | The manager | The first successful unlock, `dispose` |
| The shared manager | The page | Never disposed by components |

A game takes a scope (`manager.createScope('treasure-rush')`) when its scene mounts and calls
`scope.dispose()` when the child leaves. That stops its music, ambience and effects and cancels its
unfinished loads, and leaves the application's `ui` sounds and other scopes playing. `manager.stop(id)`
and `manager.stopAll()` are global; `scope.stop` and `scope.stopAll` are limited to the scope.

Repeated initialization is safe: the context is created once, failure to create it is remembered and
not retried, `installGestureUnlock` is idempotent per target, and `dispose` can be called repeatedly.

## Browser autoplay and unlocking

The context starts `suspended`. `installGestureUnlock()` listens (capture phase) for `pointerdown`,
`touchend`, `keydown` and `click`; on the first one it calls `context.resume()` inside the gesture and
removes the listeners only once the context is actually running. `resume()` is raced against a timeout
so a browser that never settles cannot hang a caller. Safari's `interrupted` state is treated as
locked and recovers on the next gesture. There is no permission screen. A child's first tap unlocks
audio as a side effect of ordinary play.

## Error recovery

Every failure becomes `null` plus a diagnostic and never an exception: unknown sound id, missing
asset, HTTP error, decode failure, unsupported format or element, context creation failure, locked
audio, voice limit, a browser rejecting a control call, and playback ending in failure. Cancellation
is not an error and is not reported. Diagnostics are `{ code, soundId, message, at, count }` in a
50-entry ring, repeats are counted instead of re-emitted, and an optional `onDiagnostic` sink is the
future telemetry hook. Nothing is written to the console by default and no child text, names or ids
are recorded.

When Web Audio is missing or blocked, the whole system becomes an inert no-op and the adventure
proceeds silently. There is deliberately no second playback path through bare `HTMLAudioElement`, so
behavior stays predictable.

## React integration

```tsx
<SoundProvider>            // once, near the app root: shared manager + gesture unlock
  ...
  const { playSound } = useSound();           // stable, fire and forget, app-owned sounds
  const sound = useSoundScope('treasure-rush');  // sounds stop on unmount
  const settings = useSoundSettings();        // re-renders on setting or status changes only
```

The provider never disposes a manager, which is what makes StrictMode's mount, cleanup, mount cycle
safe. `useSoundScope` returns a re-attachable scope: cleanup disposes the underlying scope, and the
remount attaches a fresh one. `useSoundSettings` and `useAudioStatus` use `useSyncExternalStore`
against snapshots that change identity only when settings or status change, so high-frequency
playback never re-renders React.

## Three.js integration (future)

Game engine code under `game/` must not import React (ADR-020) and the engine never validates
answers or awards progress. Audio fits that rule: a scene, or the React view that hosts it, calls
`SoundPlayer.play(id)` in response to the engine's typed events. For positional sound, a later phase
adds a spatial voice type that reuses `engine.getContext()` as the `AudioListener`'s context, so there
is still one `AudioContext`. Nothing in Phase 1 depends on Three.js.

## Django integration (built in Phase 2)

Implemented; see `PHASE_2_ASSET_INTEGRATION.md` and ADR-050. The paragraph below is the original
plan, kept for the record.

## Django Admin integration (original plan)

Per the project rules there is no React audio administration. Phases 2 and 3 add an audio asset kind
to the Django asset catalogue (`docs/ASSET_MANAGER.md` AM-13), managed only in Django Admin: upload,
metadata (channel, loop, default volume, priority, stream flag, tags, license, captions), versions,
publish and retire, on the existing private S3 bucket. The published catalogue is served to the
client, which registers `SoundDefinition`s with `assetId` set and a resolver that is the Django asset
resolver. React games consume only published audio. The `SoundDefinition` fields were chosen to be the
shape of that catalogue row.

## Settings persistence (future)

`SoundSettings` is plain serializable data. `getSettings()` reads it and `applySettings(patch)` loads
it (bad values are clamped or ignored). A later phase stores it per child profile through Django
(parent-controlled, as CLAUDE.md requires for voice and session controls) and passes it as the
manager's `settings` option at startup.

## Voice narration and accessibility (future)

Narration plays on the `voice` channel through a streamed or buffered voice; `handle.whenEnded()` lets
captions, word highlighting and Chatty's animation follow the audio. Audio is never the only carrier of
meaning: every spoken line keeps its text. Ducking, reduced-sound modes and per-channel parental limits
are manager settings layered on the channel gains.

## Verification limits

Phase 1 is verified with Vitest using fake `AudioContext`, `fetch` and audio element objects. That
proves the control flow, gain scheduling calls, cancellation, caching and cleanup. It does **not**
prove audible output, real decoding, autoplay behavior, iOS Safari quirks, or latency. Those need a
real browser and device pass, planned for the integration phases.
