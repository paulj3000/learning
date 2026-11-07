# Child audio preferences (SM-P5)

Status: development complete and unit-tested on `feature/sound-manager` (2026-11-03). Not used in
a browser, not heard, not deployed.

A child's audio mix (master, five channels, per-channel mute, reduced intensity) is saved on the
server per child, loaded when the child's island opens, applied to the shared Sound Manager, and
changed by the child in Treasure Rush or by a parent on the child's edit page.

## 1. Audit (SM-P5-01)

| Question | Finding |
|---|---|
| Where do child settings live? | `users.ChildProfile` (nickname, age band, reading mode, session minutes, AI switch). Django is the authority; `GET|PATCH /api/v1/children/<id>/`. |
| Existing audio state | Only the Sound Manager's in-memory `SoundSettings`. Nothing persisted. |
| Tenancy | `ChildScopedAPIView`: the parent from the token, the child from the URL resolved through that parent, another family's child is a 404. `ChildOwnedModel` rows cascade with the child. |
| Reuse | Reused the child scoping, the child-owned base, the Cognito API client and the Sound Manager's `applySettings`/`subscribe`. No new settings database or audio state manager. |
| Decision | A small child-owned table in `apps.audio` rather than eight columns on `ChildProfile`, so the profile model, its serializer and the Amplify mirror stay untouched. |

## 2. Server (SM-P5-02)

`apps.audio.ChildAudioSettings(ChildOwnedModel)`, migration `0002_child_audio_settings`: master
volume and mute, volume and mute for `music`, `ambient`, `sfx`, `voice`, `ui`, and
`reduced_intensity`. Volumes and mutes are separate columns, so muting never loses the remembered
volume. One row per child (unique constraint) and volumes are checked 0 to 1 in the database.
Defaults equal the Sound Manager's calm defaults; **no row means defaults** and a GET never
creates one.

```text
GET   /api/v1/children/<child_id>/audio/settings/   -> the mix (defaults when never saved)
PATCH /api/v1/children/<child_id>/audio/settings/   -> partial update, returns the mix
```

```json
{ "masterVolume": 1, "masterMuted": false, "reducedIntensity": false,
  "channels": { "music": {"volume": 0.5, "muted": false}, "ambient": {...}, "sfx": {...},
                "voice": {...}, "ui": {...} } }
```

Strict: unknown fields or channels, volumes outside 0 to 1, and non-booleans are a 400 and save
nothing. Parent bearer token only (no game-runtime cookie write). 401 without a token, 404 for
another family's child, 405 for other verbs. The model is not in Django Admin (child data stays
off the admin; `test_no_child_owned_record_is_registered...` still holds).

## 3. Client behavior (SM-P5-02, SM-P5-05)

- `react/src/api/audio/audioSettingsApi.ts`: typed client, whole-answer validation (a bad answer is refused entirely and volumes are clamped).
- `react/src/audio/preferences/AudioPreferencesSync.ts`: one sync per child.
  - Starts by resetting the manager to the defaults, so one child's mix never carries to the next on a shared device, then loads this child's mix.
  - A change made before the load answers wins and is saved over the old mix.
  - Saves 500 ms after the last change (a slider drag is one request), one save at a time; a change made while saving is saved after.
  - A failed load plays with the defaults; a failed save keeps the live mix; neither retries in a loop, the next change tries again.
  - Applying a saved mix does not trigger a save.
  - Dispose saves a pending change for its own child, resets the manager and ignores any late answer, so a stale response cannot overwrite a newer child's mix.
- `useChildAudioPreferences(childId)`: StrictMode-safe (the simulated unmount only schedules disposal; the remount reuses the sync, so one GET). A different or null child disposes the old sync first.
- `ChildAudioPreferencesSync` is mounted once in `App.tsx`. It follows `/island/:childId/...`, which covers every game and adventure, so the mix survives navigation, and a scene being disposed never touches it. Account pages mount nothing (the Sound Manager is not even created there). Builds without the Django API do not load or save; the mix lives for the page only.
- Reduced intensity is a manager setting (`reducedIntensity`): music and ambience play at half level; saved volumes are untouched.

## 4. Interface (SM-P5-03, SM-P5-04)

- `react/src/audio/ui/AudioMixControls.tsx`: pure controls over a `SoundSettings` value. A labelled range slider (5 percent steps, at least 2.75 rem high) and a mute toggle (`aria-pressed`, label "Mute Music", shows On or Off) for Everything, Music, Ambient, Sound effects, Voice and Interface, plus the "Quieter music and background sounds" checkbox. Native elements: keyboard and screen readers work. A muted row dims its slider and keeps its value.
- `ManagerAudioControls`: the same controls bound to the Sound Manager (`useSoundSettings`, `applySettings`). A change applies to what is playing immediately and never restarts it.
- Treasure Rush: a **Sound** button in the HUD (in the stage slot, so it stays in full screen) opens `SoundPanel`, the same dialog shell as the backpack. Escape or Close returns to play. Nothing else in the game changed.
- Parent: `ParentAudioSettings` on the child's edit page (`/home/children/:childId/edit`) reads and saves only that child through the same route, with a Save button, calm error messages, and no live preview. The child's device picks the saved mix up the next time they play.
- Another game adds the controls with `<ManagerAudioControls />` inside its own panel.

## 5. Tests

- Django (`test_child_audio_settings.py`, 16): defaults without a row, partial update and persistence, mute keeps volume, per-child isolation, every invalid body refused and nothing saved, another family's child 404 for read and write, 401, 405, database range and one-per-child constraints.
- React: API client (parse, clamp, path, body, null without Django); sync (load, defaults reset, no save on apply, load failure, touched-before-load, debounce, master mute and restore, save failure without a loop, no restart of playing music, flush on dispose, stale answer ignored, idempotent dispose); hook (StrictMode single GET, child switch with a stale answer, save goes to the right child, reset on leaving); controls (labels, patches, muted state, keyboard, disabled, live manager effect, master mute and unmute, reduced intensity); parent panel; and a companion test that the Sound button sits in the stage slot, opens the controls and closes them.

## 6. Limits

- Not heard; the engine is proved with the fake engine.
- Anyone signed in as the parent can change the child's mix from the child screen; there is no PIN on it (the app has no child-side gate for it either).
- The game-runtime cookie can read but this route is parent-token only, so a game opened only with the runtime cookie plays the defaults.
- No per-game mixes, and no sound preview on the parent page.
- Reduced intensity is a fixed 50 percent on music and ambience.
