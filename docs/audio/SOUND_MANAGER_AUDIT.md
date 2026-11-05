# Sound Manager audit (SM-001)

Audited 2026-11-02 on `feature/sound-manager`, branched from `main` at `be529fe`.

## Verdict

**There is no audio in the application today.** No code plays, loads, mixes or stores a sound, so
Phase 1 builds the first audio foundation and there is nothing to refactor or migrate yet. The
only consumers to plan for are future ones.

## What was searched

Source tree `react/src`, `amplify/`, `server/`, `lai/`, `content/`, `scripts/`, `infra/`, and
`react/public`.

| Question                                                    | Finding                                                                                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `new Audio()` / `HTMLAudioElement`                          | None.                                                                                                                                                                    |
| Web Audio (`AudioContext`, `webkitAudioContext`, `decodeAudioData`) | None.                                                                                                                                                            |
| Three.js `Audio`, `PositionalAudio`, `AudioListener`        | None. `three` 0.185 is installed and ships these classes, unused.                                                                                                        |
| `speechSynthesis` / Polly / text to speech                  | None. Polly is a pending provider decision (`npc/content/islandNpcs.ts`, TR-D19).                                                                                        |
| Third-party audio libraries (Howler, Tone, etc.)            | None installed.                                                                                                                                                          |
| Mute, volume or sound settings                              | None in React state, Django models, or the Amplify schema.                                                                                                               |
| Audio files (`.mp3`, `.ogg`, `.wav`, `.m4a`)               | None in `react/public`, `content/` or `lai/`.                                                                                                                            |
| Audio asset metadata                                        | None. `docs/ASSET_MANAGER.md` AM-13 lists audio as a future non-model asset kind (not started).                                                                          |
| Audio in scenes                                             | Every `.play()` hit in `createLocationEngine.ts`, `regionPlayScene.ts`, `castleTaleScene.ts`, `sandboxScene.ts` is a Three.js `AnimationMixer` clip action, not sound.   |
| Documented intent                                           | `ChattyAvatar.tsx` says "No audio yet"; TR-D19 deferred Treasure Rush audio until a provider and a settings model exist; `UX_AND_ACCESSIBILITY.md` requires captions or text equivalents for meaningful audio. |

## Reusable pieces found

- **`AssetResolver`** (`features/island-map/three/assets/assetResolver.ts`): `resolve(id) -> { id, url }`.
  The Django-backed resolver (`src/api/assets/djangoAssetResolver.ts`) already answers published
  versions for 3D models. The Sound Manager's `SoundAssetResolver` has the same shape on purpose,
  so the same resolver can serve audio once the Django asset catalogue gains an audio kind.
- **`noHardCodedAssetUrls.test.ts`**: forbids literal storage hosts and bundled asset directory
  paths in source. The Sound Manager obeys it (no urls in source; sounds name assets by id).
- **`prefersReducedMotion`** (`src/lib/motionPreference.ts`): the model for a small shared
  user-preference helper. A later audio preference layer can follow the same pattern.
- **Vitest + jsdom + Testing Library**: jsdom has no audio APIs, so audio tests use in-repo fakes
  under `src/audio/testing/`.

## Duplication

None. This is the point at which duplication is cheapest to prevent: Treasure Rush (TR-8, no audio by
decision) and Storykeeper Castle are about to want sound, and each would otherwise invent its own.

## Risks

1. **Autoplay policy.** Browsers keep an `AudioContext` suspended until a user gesture. A game that
   starts music in an effect on load will be silent, and a naive retry can burst stale sounds out
   later. Handled in the foundation (gesture unlock, one-shots dropped while locked).
2. **iOS Safari.** Needs a touch _end_ (not start) to unlock, uses `webkitAudioContext` on older
   versions, supports only the callback form of `decodeAudioData` on old releases, and can set a
   context to `interrupted`. All are handled in code; none is verified on a device in this phase.
3. **React StrictMode.** Mount, cleanup, mount in development. A component that disposes a shared
   manager on cleanup breaks on the second mount. The design never disposes the shared manager from
   a component; scoped sounds use a re-attachable scope.
4. **Unbounded memory.** Caching every decoded `AudioBuffer` is large (about 10 MB per minute of
   stereo audio at 44.1 kHz). The engine caps decoded audio (default 32 MiB, least recently used out)
   and streams long audio through `HTMLAudioElement`.
5. **Late playback.** An asynchronous load that finishes after a child left a scene must not start a
   sound. Pending loads are tracked per scope and aborted on disposal.
6. **Child safety and privacy.** Narration and AI speech will later carry child-adjacent text. The
   foundation stores no text, ids or audio, logs nothing to the console by default, and diagnostics
   hold sound ids and error codes only (CLAUDE.md section 13).
7. **Accessibility.** Audio must never be the only channel for anything. Mute is available per
   channel, and captions or text equivalents remain a content responsibility
   (`UX_AND_ACCESSIBILITY.md`).

## Migration recommendations

| Candidate                                                            | When                                 | Notes                                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Treasure Rush (TR-8 UI, Treasure Cove scene)                         | First integration phase              | A scope per scene; coin, chest and quest cues on `sfx`, Pip on `voice`.                                                       |
| Storykeeper Castle (`castleTaleScene.ts`, `CastleTaleCompanion.tsx`) | After Treasure Rush                  | Narration on `voice` with music ducking, a later phase.                                                                       |
| `ChattyAvatar`                                                       | With narration                       | Mouth animation can follow the `voice` handle's `whenEnded()`.                                                                |
| Three.js `PositionalAudio`                                           | Spatial audio phase                  | Reuse the manager's `AudioContext` via `engine.getContext()` for the `AudioListener` rather than creating a second context. |
| Settings (volume, mute)                                              | Preferences phase                    | Persist `SoundSettings` per child profile through Django; the foundation already exposes `getSettings()` and `applySettings()`. |

Nothing is migrated in Phase 1, by instruction: Treasure Rush and Storykeeper Castle are untouched.
