# Storykeeper Castle sound and narration (SC-R06-01 to SC-R06-03)

Status: development complete and unit-tested on `work/sc-r06` (2026-11-17), from
`feature/storykeeper-castle-completion` (`77731284`). **Nothing has been heard.** No browser,
Playwright or live playback was run, and no AWS call was made: behaviour is proved with the fake
audio engine (Vitest) and the fake Polly provider (pytest). The castle stays silent until audio
files are uploaded, assigned and published through Django Admin, and its narration stays caption
only until speech is switched on for an environment (`LAI_SPEECH_PROVIDER`). Contract:
`docs/regions/prep/sound_prep.md`. Pattern copied: `docs/audio/TREASURE_RUSH_AUDIO.md`.

## 1. What plays and when (SC-R06-01)

Everything is on the shared Sound Manager, in one scope `castle` (`useCastleAudio`, mounted by
`CastleTaleCompanion` for the visit) plus the speech scope `castle-speech` (`useCastleSpeech`).
Leaving the castle disposes both, so nothing from the castle plays after.

The manifest is the published audio manifest for the **Place** `storykeeper-castle`
(`GET .../audio/manifests/places/storykeeper-castle/`): its Island and Place assignments plus the
shared cues. Staff assign castle sounds to the Place, not to a 3D Area. The castle has no Django
3D Area (its layout is a TypeScript manifest, ADR-033), so the region route answers 404 for it;
the client asked for that route until GE-090-D7, which left the castle silent. Cue ids are
logical (`castleSounds.ts`, Django `apps/audio/castle_cues.py`; a pytest test holds the two lists
equal); a missing cue is silent (or plays its listed fallback) and play goes on.

| Moment | Raised by | Cue | Channel | Placed |
|---|---|---|---|---|
| Room bed | The room the child stands in (`scene.currentRoomId()`, re-read every 400 ms) | `ROOM_AMBIENCE` (below), 1500 ms crossfade, one bed | ambient | no |
| Room change | The same read, on a change between two rooms (not a doorway) | `ui.castle.door` | ui | no |
| Castle music | Mount | `music.castle.explore`; `music.castle.story` while the castle guide (the Storybook) is open | music | no |
| Storybook open / close | `CastleGuide` `onOpenChange` | `sfx.castle.book_open` / `sfx.castle.book_close` | sfx | no |
| Page restored | `useGreatStorybook` `onPageRestored` (derived from the records) | `sfx.castle.page_restore`, else shared `sfx.treasure.reveal` | sfx | no |
| Quest start | The tale, the secret-door story, or a new Painted Words run starts | `sfx.castle.quest_start` | sfx | no |
| Quest complete | Each of the three sessions completes; the Storybook is whole | shared `sfx.quest.complete` | sfx | no |
| NPC greet | `NpcApproached` for any entity (Quill today; Professor Orion and others once SC-R05 lands, no castle change needed) | `sfx.castle.npc_greet` | sfx | Quill only, 2.5 / 20 m |
| Right | The server grades an answer `correct` (`useCastleAnswerCues`) | shared `sfx.learning.correct` | sfx | no |
| Try again | The server grades an answer `incorrect` | shared `sfx.learning.retry` (Sprouts: silent) | sfx | no |
| Hint | The server's hint level rises on the same step | `sfx.castle.hint_chime` | sfx | no |
| Artifact found | `CollectiblePickedUp` in the castle | `sfx.castle.artifact_found`, else shared `sfx.reward.collect` | sfx | no (no reader yet) |
| Jump, land, platforms | The shared platforms runtime's events (SC-JMP course) | shared `sfx.player.*`, `sfx.platform.*` | sfx | no |

Room beds: hall (`entry-hall`, `story-hall`, `east-corridor`), gallery, costume, tower, studio,
library, trophy, secret. A room whose bed has no audio falls back to the hall bed; with no hall
bed it is silence. Staff zone assignments keyed by room id override the built-in beds.

Not done on purpose: speech does not stop on a room change (narration is flat and on screen, and
cutting a sentence in a doorway helps nobody); ambience is not ducked under speech (the shared
default ducks music only, which the contract allows).

Seed: `manage.py seed_castle_sound [--dry-run]` reuses the Treasure Rush seed command with the
castle table. It is idempotent, creates a cue only for a published audio asset whose id is the cue
id with dashes, reports `ASSET NEEDED` otherwise, never publishes, never assigns, and never
touches a shared cue (`seed_treasure_rush_sound` owns those).

## 2. Mute, volume and Sprouts (SC-R06-02)

- Mute and volume are the child's own mix in the Sound Manager (SM-P5); the castle never changes
  them. The castle guide now has a **Sound** section with the shared `ManagerAudioControls`.
- Sprouts hear no try-again sound (the card still says it gently) and keep the soft hint chime.
- Sprouts get reduced intensity (music and ambience at half) as a **session default only**:
  `PreferenceSync.applySessionDefault` applies it only when the server says the child has no saved
  mix (`saved: false`, a new read-only field on `GET /children/<id>/audio/settings/`), and only if
  the child has changed nothing yet. It is not saved on its own and is undone when the castle is
  left. If the child then changes their mix, the mix they see (including the calmer setting) is
  what is saved, which is their choice. An older server, a failed load, or a saved mix: never
  applied.

## 3. Narration (SC-R06-03)

Provider: Amazon Polly, chosen by the owner, through the existing Django speech pipeline only
(`apps/speech`, `docs/audio/AMAZON_POLLY_INTEGRATION.md`); the fake provider locally and in tests.
The browser asks Django by reference and never calls Polly or holds a credential. No AI-made
utterance is added by this task.

- Painted Words pronunciations: `SpeechLine` `castle-word-<word>`, text exactly the bank word
  (`lai/apps/speech/castle_speech_words.json`, a mirror of `paintedWordsBank.ts`; Vitest fails if
  they differ). "Hear <word>" buttons under the Studio card say the words on the pads.
- Great Storybook pages: `SpeechLine` `castle-page-<page id>`, text `"<title>. <restoredText>"`
  from `lai/apps/regions/great_storybook_pages.json`, read when a page comes back.
- Seed: `manage.py seed_castle_speech_lines [--dry-run]` (voice profile `narrator`, context
  `castle`). Idempotent; never overwrites a line staff edited (reports `DIFFERS`); synthesizes
  nothing.
- One utterance at a time (the shared `SpeechPlayer` replaces the line speaking), and the same line
  asked for again while it is still being fetched or spoken is dropped.
- Any failure (speech off, 404, 422, offline, blocked audio) leaves the same text on screen as the
  caption, and play continues.

### Consent gating

Castle narration is gated exactly like the castle's existing authored narration (Keeper Quill's
lines): the environment switch `LAI_SPEECH_PROVIDER` (off by default), the per-voice and per-line
`enabled` flags, the child's own voice volume and mute, and child scoping (another family's child
is a 404). The parent's AI switch (`ChildProfile.ai_enabled`) silences AI-made speech only;
authored lines are not AI and are still spoken, as for Quill. **There is no parent voice consent
or "narration on/off" setting in the product today.** None was invented here; "parent voice
consent review" is recorded as an owner acceptance item in `tasks/TASK_TRACKER.md`.

## 4. Assets still needed (none are committed)

Upload to the Asset Library with these ids, publish a version, run `seed_castle_sound`, then
publish a sound release. MP3, 44.1 kHz stereo, -16 LUFS for effects, -20 LUFS for music and beds.

| Asset id | What | Length |
|---|---|---|
| `ambient-castle-hall` | Warm stone hall, soft fire (also the fallback bed) | 30 to 60 s seamless loop |
| `ambient-castle-gallery` | Quiet gallery | 30 to 60 s loop |
| `ambient-castle-costume` | Fabric rustles | 30 to 60 s loop |
| `ambient-castle-tower` | High wind, gentle shimmer | 30 to 60 s loop |
| `ambient-castle-studio` | Brushes, paint taps | 30 to 60 s loop |
| `ambient-castle-library` | Pages, hushed room | 30 to 60 s loop |
| `ambient-castle-trophy` | Calm room, faint chime | 30 to 60 s loop |
| `ambient-castle-secret` | Low crystal hum | 30 to 60 s loop |
| `music-castle-explore` | Calm castle theme | 90 s loop |
| `music-castle-story` | Softer story theme | 90 s loop |
| `sfx-castle-book-open` | Heavy cover opening | 1 s |
| `sfx-castle-book-close` | Soft book thump | 0.8 s |
| `sfx-castle-page-restore` | Page flutters home | 2 s |
| `sfx-castle-quest-start` | Bright call to adventure | 1.5 s |
| `sfx-castle-npc-greet` | Friendly chime | 1 s |
| `sfx-castle-hint-chime` | Soft warm chime, never a buzzer | 0.8 s |
| `sfx-castle-artifact-found` | Sparkle | 1.5 s |
| `ui-castle-door` | Soft wooden door | 1 s |

Right, try again, quest complete, the reveal and reward fallbacks, and the movement cues reuse the
shared assets. Word and page narration are Polly clips made on first request and cached, not files.

## 5. Tests

- Vitest: `castleSounds.test.ts` (every room has a bed and priority, cue ownership, word list and
  page text parity), `useCastleAudio.test.tsx` (manifest, beds and crossfade, doorway, fallback bed,
  story music, every moment, shared-cue reuse, NPC greet for any NPC, jump and land, mute and
  volume, Sprout session default and no retry, unmount, failed and absent manifest, StrictMode),
  `useCastleSpeech.test.tsx` (word and page references, no repeat, one at a time, caption on 404,
  text only without speech), `useCastleAnswerCues.test.tsx`, `CastleGuide.test.tsx`,
  `CastlePaintedWordsSession.test.tsx`, `AudioPreferencesSync.sessionDefault.test.ts`.
- pytest: `apps/audio/tests/test_castle_seed.py` (table, React parity, idempotent, never publishes),
  `apps/audio/tests/test_child_audio_settings.py` (`saved`), `apps/speech/tests/test_castle_speech_lines.py`
  (text parity, idempotent, staff edits kept, fake Polly once then cached and shared, other family
  404, AI off still speaks authored lines, speech switch off is 503, disabled line 404).
