# Sound library reporting (SM-P3)

Status: development complete and unit-tested on `feature/sound-manager` (2026-11-03). Not
checked against a real library: this branch's database has no audio, so every Treasure Rush cue is
reported as missing until you upload, seed and publish.

The report answers one question for staff: **why is this game not producing sound yet?** It is
read-only and computed from the real tables on every call (no counters, no caches). It changes
nothing and publishes nothing. There is no React staff screen and no new authentication.

Two views of the same code (`lai/apps/audio/reporting.py`):

- **Django Admin:** Sound library, **Library report** (`/admin/audio/soundlibraryreport/`).
- **Command:** `python manage.py audio_library_report`.

## 1. What "ready" means

A cue is ready for a game only when every dependency of runtime playback is present:

1. the sound cue exists and is enabled;
2. its audio asset exists, is audio, is active, and has a published version (the cue's pinned version, else the asset's default);
3. the cue is in the **live** sound release;
4. the live release serves it in the game's manifest: shared, or assigned to the game's 3D Area (a retired version is dropped there).

A `SoundCue` row alone proves none of that, so the report never counts it as ready.

## 2. Admin page

Anyone who may view sound cues (Sound editors, Sound publishers, superusers) can open it. Add and
change are refused for everyone; a POST changes nothing.

- **Library inventory:** audio assets (total, published, draft or unpublished, retired), sound cues (total, enabled), cues in the live release, unassigned cues, cues whose audio is not published, releases, live release, last published date.
- **Game coverage:** for the chosen game, every required cue with its purpose, audio asset status, cue status, assignment status, release status, manifest status, ready or not, and **what to do**. Optional cues are listed separately and never block readiness. Treasure Rush is the first game (`reporting.GAMES`); a game is added by giving it a `GameSpec` with its 3D Area id and cue table.
- **Coverage by scope:** every Island, Place and published 3D Area with its assignment count, the sounds its manifest would serve, and invalid assignments; plus Adventures that have sound assigned.
- **Problems and what to do:** the diagnostics below, errors first.
- **Filters:** game, show all or not-ready only, errors or warnings, and a search box (cue id, asset id or problem text). Tables have captions and column headers, and status is shown with words and symbols, not colour alone.

## 3. Diagnostics

| Code | Level | Meaning | Remedy shown |
|---|---|---|---|
| `empty-library` | error | no sound cues | upload audio, add cues or seed |
| `no-live-release` | error | nothing published; every game is silent | publish the sound library |
| `unpublished-asset`, `retired-asset`, `bad-asset` | error | a cue's audio cannot play | publish or reactivate the audio, or change the asset |
| `invalid-assignment` | error | fails the same checks as publishing | fix or delete it in Sound assignments |
| `game-area-missing` | error | the game's 3D Area is not in the database | seed and publish the game's content |
| `missing-cue` | error | a required cue does not exist | upload the named asset, run the seed command |
| `game-cue-not-ready` | error | a required cue exists but cannot play (reasons listed) | per reason |
| `unassigned-cue` | warning | not shared and no enabled assignment | share it, assign it or disable it |
| `not-in-release` | warning | ready, but newer than the live release | publish |
| `orphaned-release-cue` | warning | the live release serves a cue that is gone or disabled | recreate or re-enable it, or publish a new release |
| `assignment-of-disabled-cue` | warning | the assignment is skipped | enable the cue or the assignment |

Output order is deterministic (errors first, then code, then subject).

## 4. Command

```bash
python manage.py audio_library_report                          # inventory, every game, problems
python manage.py audio_library_report --game treasure-rush     # one game
python manage.py audio_library_report --island <slug> --place <slug>   # narrow the scope table
python manage.py audio_library_report --game treasure-rush --strict    # exit status 2 if not ready
```

Read-only: it never publishes, never edits a cue or assignment, and never writes. The text is
deterministic, so it can be diffed between runs. `--strict` exits **2** when any required cue of the
chosen game(s) cannot play or any error-level problem exists (otherwise 0), so a release check can
rely on it. Without `--strict` a missing library still exits 0.

Typical use before testing Treasure Rush:

```bash
python manage.py seed_treasure_rush_sound --dry-run
python manage.py audio_library_report --game treasure-rush
```

## 5. Tests

`apps/audio/tests/test_library_report.py` (22): empty library, complete library with correct counts,
unpublished audio, retired asset, a cue added after the last release, unshared cue without an
assignment, assignment to the game's area, disabled cue, orphaned release cue, invalid assignment,
optional cues, the real 15-cue requirement, deterministic read-only command, strict exit status 2,
strict pass, scope filters, admin permissions (editor and superuser allowed, others 403), filters and
search, POST changes nothing, and the page listed under Sound library. The game table is reduced to
two required cues in most tests so they stay quick.

## 6. Limits

- Only Treasure Rush has a game spec. Other games need a `GameSpec` (3D Area id and cue table).
- Adventure coverage lists Adventures that have sound assigned; it does not know which sounds an Adventure should have.
- The report checks that a cue can be served, not that the audio sounds right. Listening is a human check.
- The manifest check builds the manifest per scope on every page load; fine for a small library, not tuned for a large one.
