# Sound Manager developer guide

Code: `react/src/audio/`. Design: `SOUND_MANAGER_ARCHITECTURE.md`.

## 1. Mount once

```tsx
import { SoundProvider } from './audio/react';

<SoundProvider>
  <App />
</SoundProvider>;
```

The provider uses the page-wide manager and unlocks audio on the first tap, click or key press.

## 2. Register sounds by stable id

```ts
import { getSharedSoundManager } from './audio';

getSharedSoundManager().registerAll([
  { id: 'ui.button.click', assetId: 'audio-ui-click', channel: 'ui' },
  { id: 'treasure.coin.collect', assetId: 'audio-coin', channel: 'sfx' },
  { id: 'treasure.cove.theme', assetId: 'audio-cove', channel: 'music', loop: true, stream: true },
]);
```

Name an `assetId` and let a resolver supply the url. A literal `url` is for tests and bundled files.
Never write a storage host or bucket path. Until the Django audio catalogue exists, pass a
`resolver` to `createSoundManager` or register definitions with a bundled `url`.

## 3. Play

```tsx
const { playSound } = useSound();
<button onClick={() => playSound('ui.button.click')}>Go</button>;
```

`play` never throws or rejects. It resolves a `SoundHandle` or `null` (unknown id, still locked,
failed to load, audio unavailable). Games must not branch on it.

```ts
const handle = await manager.play('treasure.cove.theme', { fadeInMs: 800 });
handle?.setVolume(0.2, 400); // this instance only
handle?.stop({ fadeOutMs: 600 });
await handle?.whenEnded(); // 'finished' | 'stopped' | 'failed' | 'disposed'
```

## 4. Own a game's audio with a scope

```tsx
function TreasureCove() {
  const sound = useSoundScope('treasure-rush');
  useEffect(() => {
    void sound.play('treasure.cove.theme', { fadeInMs: 800 });
  }, [sound]);
  // unmount stops this component's sounds and cancels unfinished loads; UI sounds keep working
}
```

Outside React: `const scope = manager.createScope('name'); ... scope.dispose();`.

## 5. Volume and mute

```ts
manager.setMasterVolume(0.7);
manager.setChannelVolume('music', 0.3);
manager.muteChannel('voice', true); // volume is remembered
manager.setMuted(true); // master
const settings = useSoundSettings(); // in a volume panel
```

## 6. Rules of thumb

- Sound ids are lower case and dotted: `area.thing.action`.
- Give music, ambience and narration the channels that match; priorities follow the channel.
- Do not hold on to a handle after you stop it; calling it is harmless but pointless.
- Do not create managers in components. Use the provider or `getSharedSoundManager()`.
- Do not log or store child text with a sound. Diagnostics carry sound ids and codes only.
- Audio is never the only carrier of meaning: keep the text, add captions for speech.

## 7. Testing code that plays sounds

```ts
const manager = createSoundManager({ engine: new FakeEngine(), definitions });
render(<SoundProvider manager={manager}>...</SoundProvider>);
```

`FakeEngine` lives in `src/audio/testing/fakes.ts` (it exposes the voices that were started).

## 8. Diagnostics

`manager.getDiagnostics()` returns recent `{ code, soundId, message, at, count }` entries. Pass
`onDiagnostic` to `createSoundManager` to forward them (the future telemetry hook).

## 9. Sounds configured in Django (Phase 2)

Staff define sound cues, assign them to events and publish a release in Django Admin
(`PHASE_2_ASSET_INTEGRATION.md`). A game does not register those sounds by hand.

```tsx
const source = useMemo(() => djangoAudioSourceFor(childId), [childId]);
const scope = useMemo(() => ({ type: 'region', id: regionId }) as const, [regionId]);
const audio = useAudioManifest(source, scope); // status: idle | loading | ready | failed

void audio.trigger('on_open', 'chest', chestEntityId); // plays what staff assigned, if anything
void manager.play('sfx.coin.collect'); // or play any manifest sound by its cue id
```

- The manifest sounds are registered while the component is mounted and removed on unmount.
- `trigger` resolves `null` when nothing is assigned, the manifest failed, or the audio is gone.
  Never branch the game on it.
- `djangoAudioSourceFor` is `null` without the Django API; the hook then stays `idle`.
- Cue ids that Django publishes are owned by the manifest. Do not `register` the same id yourself;
  the manifest sound is refused and a diagnostic is recorded.
- Cue settings that Django controls: volume, loop, stream, priority, concurrency limit, cooldown,
  fade in and fade out.

Outside React:

```ts
const sync = createManifestSync({ manager, fetchManifest, resolver });
await sync.load({ type: 'region', id: 'treasure-cove' });
sync.trigger('on_open', 'chest', 'chest-001');
sync.dispose(); // stops its sounds, removes its definitions
```

## 10. A game that plays shared cues by id (Phase 3, Treasure Rush)

Treasure Rush is the first consumer (`react/src/features/region-play/audio/`,
`docs/audio/TREASURE_RUSH_AUDIO.md`). The pattern, reusable by the next game:

- One hook (`useTreasureRushAudio`) loads the region manifest with `useAudioManifest` and plays
  everything inside `useSoundScope('treasure-rush')`, so leaving the game stops it all.
- Cues are **shared** in Django, so the game plays them by cue id and needs no per-target assignment.
- `SoundSlot` keeps "one ambience bed" or "one music track": the same id is a no-op, a change fades,
  a late load stops itself, and a failed cue is retried only when a new manifest arrives.
- The game says WHEN (`playCue`, raised once per server-confirmed result); the hook decides the sound.
- Common educational cue ids other games can reuse: `sfx.learning.correct`, `sfx.learning.retry`,
  `sfx.learning.complete`, `sfx.quest.complete`.

## 11. Music, ducking and preferences (SM-P5, SM-P6)

- Music: `createMusicStates({ player: scope, states, returnTo })` for named states with gap-free
  crossfades, or `createMusicDirector` and playlists directly (`docs/audio/MUSIC_MIXING.md`).
- Ducking: voices lower music to 30 percent automatically; `manager.setDucking(...)` and
  `manager.duck(channel)` configure and hold it. It is never saved as a setting.
- Child mix: mounted once in `App.tsx` (`ChildAudioPreferencesSync`); add `<ManagerAudioControls />`
  to a game's settings panel (`docs/audio/CHILD_AUDIO_PREFERENCES.md`).
