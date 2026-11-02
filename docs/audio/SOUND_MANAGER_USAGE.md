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
