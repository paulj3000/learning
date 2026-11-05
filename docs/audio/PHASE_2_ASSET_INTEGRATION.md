# Sound Manager Phase 2: Django sound library and published manifests (SM-P2)

Status: development complete and unit-tested on `feature/sound-manager` (2026-11-02). Not verified
in a browser, with audible output, against AWS, or on a deployed Django. Decision record: ADR-047
(Proposed).

Phase 1 (`react/src/audio/`) built the playback engine. Phase 2 makes Django the authority for
*which* sounds exist, what they are called, how they are mixed, and where in the game they play,
without adding a second asset library or a React staff screen.

## 1. Audit of the existing Asset Library (SM-P2-01)

### Branch finding that shaped the work

`main` (`be529fe`) has **no audio support**: its asset library accepts glTF models only. Audio
(MP3, WAV, Ogg), images, the audio preview player, rollback, reactivation and stored-file
verification exist on `origin/feature/asset-manager` (AM-13, AM-17, ADR-045, 16 commits ahead of
`main`, not merged). Phase 2 cannot extend what `main` lacks, so that branch was merged into
`feature/sound-manager` (merge commit `ded1135`; the only conflicts were two append-only docs,
`tasks/TASK_TRACKER.md` and `docs/IMPLEMENTATION_STATUS.md`, both kept in full). This branch
therefore carries the Asset Library branch's commits as well as its own. Landing order is covered in
section 14.

### What exists and is reused unchanged

| Question | Finding |
|---|---|
| Audio support | `apps/assets/formats.py`: `mp3` (Layer III), `wav` (PCM or float), `ogg` (Vorbis or Opus); family `audio`; runtime kind `audio`; category choices `sound` and `music`. Validation in `validation_media.py` reads duration, sample rate and channels from the bytes, never from the name. Limits: 20 MB, mono or stereo, 8 to 96 kHz, 15 minutes. |
| Definition vs binary | `catalog.ContentAsset` is the stable definition (`asset_id`, `kind`, `category`, `default_version`, `status`). `assets.AssetVersion` is one immutable stored file. |
| Publishing workflow | Version lifecycle `DRAFT, VALIDATED, PUBLISHED, RETIRED` (plus `REJECTED`); only `apps.assets.services` moves it; publish re-reads the stored bytes and re-validates; a published version's bytes and metadata can never change (`ImmutableVersion`). Rollback, reactivation, retire and verify exist (AM-17). |
| Storage layout | Private bucket, key family `assets/audio/...`; memory and local backends for tests and development; `LAI_ASSET_STORAGE` selects. |
| Resolution API | `GET /api/v1/children/<child>/assets/?ids=a,b@2`: child-scoped, published only, `asset@n` pins a version, returns `family`, `format`, `media` (duration, rate, channels), a **signed expiring url**, and a stable `cache.key`. Drafts, storage keys and uploader are never returned. |
| Delivery | Signed token (`django` delivery) or presigned S3 URL. Retiring stops new URLs at once (django delivery re-checks on every fetch). |
| Permissions | Django groups `Asset editors` and `Asset publishers` (`ensure_asset_roles`); permission-based admin (`assets.publish_assetversion`, `assets.retire_assetversion`); staff authenticate to the Django Admin only (ADR-040). No asset write API exists (ADR-045). |
| Audio metadata | `AssetVersion.metadata`: `durationSeconds`, `sampleRate`, `channels`; `ContentAsset.category`, `tags`, `display_name`, `description`. |
| Audio preview | `apps/assets/preview.py`: a staff-only signed media route and an `<audio controls>` element. Reused as is on the cue page. |
| Admin audit | Django `LogEntry` history on every admin change. |

### Gap analysis

| Need | Existing | New in Phase 2 |
|---|---|---|
| A logical, stable sound name ("sfx.chest.open") separate from a file | No. Games name assets, not sounds. | `SoundCue` |
| Mix settings per sound (volume, loop, priority, concurrency, cooldown, fades, stream) | No | `SoundCue` fields |
| Attach a sound to a game event on a thing in the world | No | `SoundAssignment` + controlled vocabulary |
| Draft vs live separation for sound configuration | Only for files | `SoundRelease` immutable snapshots |
| A game-facing description of the sounds in an Island, Place or 3D Area | No | Manifest API |
| Roll back sound configuration | Only for files | Release rollback |
| React loading of that configuration into the Phase 1 registry | No | `audio/manifest/`, `api/audio/`, `useAudioManifest` |
| Audio upload, validation, versions, signed delivery, preview | **Yes** | Nothing; reused |

### Required migrations and compatibility risks

One new app, `apps.audio`, one migration (`0001_initial`), three tables. It adds foreign keys to
`catalog.ContentAsset`, `assets.AssetVersion`, `catalog.World`, `catalog.Location` and
`regions.WorldRegion`, all `PROTECT`. No existing table or column changes.

Risks and how they are handled:

- Retiring an asset that a cue uses. The cue's `PROTECT` foreign key does not block retiring (the
  asset is not deleted); instead publishing refuses and the live manifest drops the sound (section 6).
- Changing an asset's category after a cue is made. The category is re-checked at publish time.
- Phase 1 contract changes are additive only: new optional `SoundDefinition` fields and new manager
  methods. The original 94 Phase 1 tests are unchanged and pass.
- The merge of the Asset Library branch into this one (section 14).

## 2. Data model (SM-P2-02, SM-P2-04, SM-P2-05)

Three layers, kept deliberately separate:

```text
catalog.ContentAsset (kind audio) --< assets.AssetVersion      owned by the Asset Library
        ^
        | PROTECT
   audio.SoundCue            working copy: name, channel, asset, mix settings, enabled
        ^
        | PROTECT
   audio.SoundAssignment     working copy: scope + target + event -> cue
        |
        v  publish
   audio.SoundRelease        immutable snapshot, exactly one LIVE; games read only this
```

`SoundCue` (`cue_id` unique): `name`, `description`, `channel`, `asset`, optional `pinned_version`,
`volume` 0 to 1, `loop`, `stream`, `priority` 0 to 100 or channel default, `max_concurrent` 1 to 32,
`cooldown_ms`, `fade_in_ms`, `fade_out_ms`, `shared`, `enabled`, `created_by/at`, `updated_at`.
Database constraints: channel valid, the id starts with the channel, ranges. The model forbids a
cue's channel changing after creation. A cue stores no url, bucket or storage key.

`SoundAssignment`: scope as real foreign keys (`world` = Island, `location` = Place,
`region` = 3D Area; none means everywhere; at most one, enforced in the database), `target_type`,
`target_id`, `event`, `cue`, a copy of the cue's `channel`, `enabled`, `note`. One cue per scope,
target, event **and channel** (a unique constraint with `nulls_distinct=False`).

`SoundRelease`: `number`, `status` (`LIVE` or `SUPERSEDED`; a partial unique constraint allows one
`LIVE`), `revision` (sha256 of the snapshot), `snapshot` (JSON), `note`, `rolled_back_from`,
`published_by/at`. Fields cannot be changed after creation and a release can never be deleted.

### Cue naming convention

`<channel>.<group>.<name>` with one to four lower-case words, digits or underscores after the
channel, at most 80 characters: `sfx.chest.open`, `ambient.ocean.waves`,
`music.treasure_rush.explore`, `voice.storykeeper.greeting`, `ui.menu.select`. The first word is the
mixer channel and must match. An id is a promise to games and published releases: it cannot be edited
once created (read-only in the admin) and should never be reused for a different sound.

Audio asset categories must suit the channel: `music` and `voice` accept `music` or `other`;
`ambient` accepts `sound`, `music` or `other`; `sfx` and `ui` accept `sound` or `other`.

### Event and target vocabulary

Closed sets, in `apps/audio/vocabulary.py`; no expression is ever evaluated.

| Target type | Id is | Valid events |
|---|---|---|
| `scope` | none (the Island, Place or 3D Area itself) | `on_enter`, `on_exit` |
| `adventure` | `Adventure.slug` | `on_enter`, `on_success`, `on_retry`, `on_complete` |
| `quest` | `Quest.slug` | `on_enter`, `on_complete` |
| `npc` | `NpcDefinition.npc_id` | `on_approach`, `on_interact`, `on_dialogue_start`, `on_exit` |
| `object` | `entity_id` of a placement in the 3D Area | `on_approach`, `on_interact`, `on_collect` |
| `chest` | `entity_id` of a treasure chest in the 3D Area | `on_approach`, `on_interact`, `on_open`, `on_close`, `on_success`, `on_retry` |
| `reward` | `RewardRule.rule_id` | `on_collect` |

Validation (`targets.py`, shared by the model, the admin and the publish check): the event must be
valid for the target type; the target must exist; objects and chests need a 3D Area scope and must
exist in that exact area; an adventure must belong to the scope's Place or Island; a quest to the
scope's Island. Examples of rejected input: `chest` + `on_enter`; an unknown adventure; a chest id
from another area; a `scope` sound with no Island, Place or 3D Area.

## 3. Django Admin workflows (SM-P2-03)

All under **Sound library** in Django Admin; no React screen exists or was added.

1. Upload and publish the audio file in the **Asset library** (existing workflow, existing groups).
2. **Sound cues, Add**: choose a channel and id, an audio asset (the list shows active audio assets
   only), optional pinned version, and the mix settings. The page embeds the Asset Library's audio
   player for the version it will use and shows the publishing status.
3. **Sound assignments, Add**: choose where (Island, Place or 3D Area), what (target type and id),
   which event and which cue. Invalid combinations are refused with the reason.
4. **Sound releases, Publish the sound library**: shows every problem (or, when clean, what will be
   published), takes an optional note, and creates the next release atomically.
5. **Roll back**: select a release, apply the action; it re-publishes that snapshot as a new release.

Cue list: filter by channel, enabled and shared; search by id, name, description and asset id; the
Publishing status column reads `Not published`, `Published`, `Changes not yet published`,
`Disabled`, and flags a blocked reference ("retired", "no published default version"). Enable and
disable actions apply at the next release. Django's history page lists every change; publish and
rollback also write a history entry on the release.

Roles (`manage.py ensure_sound_roles`, idempotent like `ensure_asset_roles`): **Sound editors**
create and edit cues and assignments and view releases; **Sound publishers** also publish and roll
back. Neither can upload or publish audio files; that stays with the Asset Library groups.

## 4. Publishing and version consistency (SM-P2-05)

- Editing a cue or an assignment changes **nothing** a child hears. Only a release does.
- `publish` validates every enabled cue and assignment (full model validation, asset category,
  asset active, pinned or default version `PUBLISHED`). If anything is wrong the whole publish is
  refused with every problem listed and the live release is untouched. An empty library is refused.
- A release pins each cue to an exact `AssetVersion` (cue's pinned version, else the asset's default
  at publish time). Asset versions are immutable, so no second version system is needed. Moving the
  asset's default later does not alter a published release.
- A disabled cue is left out; an assignment of a disabled cue is skipped with a warning, not a
  blocker.
- Creating a release is one transaction: lock, demote the live release, insert the new one. A
  concurrent publisher loses to the unique `LIVE` constraint and gets "another publish is in
  progress".
- **Retirement after publishing.** The live manifest re-checks that each pinned version is still
  `PUBLISHED` and its asset active, and silently drops any cue (and its assignments) that is not. The
  revision changes accordingly. The next publish is refused until the cue is fixed or disabled.
- **Rollback** (`rollback_to`) re-publishes an earlier snapshot as a **new** release (history stays
  append-only; `rolled_back_from` records the source). It is refused if the target is already live,
  or if any version it pinned has since been retired. Identical content gives the identical
  revision.

## 5. Assignment resolution

For one manifest, take every live assignment whose scope is in the requested scope's ancestry
(everywhere, its Island, its Place, its 3D Area). For the same **target, event and channel**, the
**deepest scope wins and replaces** the general one; assignments do not stack. Different channels
never override each other, so a Place can start an ambient bed while its 3D Area starts music for
the same `on_enter`. Shared cues (`shared = true`) are included in every manifest whether or not
anything is assigned, for sounds the UI triggers directly.

## 6. Manifest API (SM-P2-06)

```text
GET /api/v1/children/<child_id>/audio/manifests/islands/<slug>/
GET /api/v1/children/<child_id>/audio/manifests/places/<slug>/
GET /api/v1/children/<child_id>/audio/manifests/regions/<region_id>/
```

(`/api/v1/` and the child segment follow the repository's play and asset routes instead of the
brief's illustrative `/api/audio/...`.) Read-only: `POST`, `PUT`, `PATCH`, `DELETE` answer 405.

```json
{
  "schemaVersion": 1,
  "scope": { "type": "region", "id": "treasure-cove" },
  "sounds": [
    {
      "id": "sfx.chest.open",
      "assetId": "chest-creak@1",
      "channel": "sfx",
      "volume": 0.85,
      "loop": false,
      "maxConcurrent": 2,
      "cooldownMs": 150
    }
  ],
  "assignments": [
    { "event": "on_open", "targetType": "chest", "targetId": "chest-001",
      "soundId": "sfx.chest.open" }
  ],
  "revision": "9c1e...64 hex characters"
}
```

Optional sound fields (`stream`, `priority`, `maxConcurrent`, `cooldownMs`, `fadeInMs`,
`fadeOutMs`) appear only when set. `assetId` is an `asset-id@version` reference, which is exactly
what the existing asset resolver accepts.

- **Authorization.** Same as every child route: the caller is the parent of that child (Cognito
  bearer token) or the game runtime for its own child. Unauthenticated: 401. Another family's
  child: refused with no child data. Only active Islands and Places, and published 3D Areas, have a
  manifest (otherwise 404, indistinguishable from unknown).
- **Before the first release** the manifest is a valid, empty document (200), so a game without
  sound configured behaves like one with sound switched off.
- **Versioning and caching.** `revision` is a hash of the served content; `ETag` is that revision and
  `If-None-Match` answers 304. `Cache-Control: private, no-cache` makes clients revalidate every
  time, so a rollback is seen at the next load. The manifest contains **no url**.
- **Asset URL resolution.** The client resolves each `assetId` through the existing child-scoped
  `/children/<id>/assets/?ids=...`, which issues a fresh signed url when the sound is about to load.
  A stale cached manifest therefore can never point at an expired url.
- **What it never contains:** drafts, disabled or unpublished cues, retired audio, storage keys,
  checksums, version ids, names, notes, who edited or published, or any other child's data.

## 7. Asset delivery

Unchanged: `django` delivery (`/api/v1/asset-files/<token>/audio.<format>`, re-checked on every
fetch, `nosniff`, sandbox CSP) or presigned S3. No public S3 URL is built anywhere in Phase 2.

## 8. Security and audit (SM-P2-08)

- Authoring is staff-only, permission-based, and only in Django Admin (ADR-045). No write API.
- Publishing and rollback need their own permissions (`publish_soundrelease`,
  `rollback_soundrelease`); editors cannot publish (tested: 403).
- Releases cannot be added, changed or deleted from the admin; the model refuses edits and deletes.
- Closed vocabularies; ids are looked up as data; manifest routes take slugs only (anything else 404).
- The React parser copies known fields only and requires `asset@n` references, so a url or key in a
  manifest cannot reach the engine. Unsupported schema versions are refused.
- Unsupported content: only audio assets of a channel-appropriate category can be used by a cue;
  file types remain the Asset Library's byte-level validation.
- Audit: Django admin history on cues, assignments, releases; each release records `published_by`,
  `published_at`, a note and its source on rollback.
- No new authentication provider, no new AWS service, no new dependency.

## 9. React integration (SM-P2-07)

Phase 1's engine is not rewritten. Additions:

- `audio/manifest/parseManifest.ts`: validates a manifest. A wrong document is refused whole
  (`invalid-manifest`); a wrong entry is skipped and counted.
- `audio/manifest/AudioManifestSync.ts`: `createManifestSync({ manager, fetchManifest, resolver })`
  with `load(scope)`, `refresh()`, `soundFor(event, targetType, targetId)`,
  `trigger(...)` and `dispose()`.
  Definitions are registered under the sync's own *owner*, so refreshing replaces exactly what the
  manifest put there and never the application's own sounds. A scope change stops the old scope's
  sounds and replaces its definitions. Concurrent loads of one scope share a request; for different
  scopes the latest wins and the earlier request is aborted. A failed or invalid manifest keeps the
  last good sounds for the same scope and leaves silence for a new scope. Nothing throws.
- `api/audio/audioManifestApi.ts`: `manifestPath`, `createDjangoAudioSource`, `djangoAudioSourceFor`.
  Uses the shared Cognito API client and the existing `createDjangoAssetResolver` (family `audio`,
  no bundled fallback). `null` for a build without the Django API.
- `audio/react/useAudioManifest.ts`: `useAudioManifest(source, scope)` returns
  `{ status, revision, trigger, refresh }`; cleanup disposes the sync; StrictMode-safe.
- Additive Phase 1 changes: `SoundDefinition` gained `maxConcurrent`, `cooldownMs`, `fadeInMs`,
  `fadeOutMs`; the manager gained `replaceDefinitions`, `releaseDefinitions`, `setAssetResolver`,
  `reportIssue`; the resolver contract returns an optional `cacheKey` so the decoded audio is cached
  once per published version instead of once per signed url; `AudioError.status` carries an HTTP
  status. **Expired-url recovery:** if loading fails with 401, 403, 404 or 410 and the sound has an
  asset id, the manager asks the resolver once for a fresh answer (`forceRefresh`) and retries.

Not wired into any game. Treasure Rush and Storykeeper's Castle are untouched.

```tsx
const source = useMemo(() => djangoAudioSourceFor(childId), [childId]);
const scope = useMemo(() => ({ type: 'region', id: regionId }) as const, [regionId]);
const audio = useAudioManifest(source, scope);
// on a chest opening:
void audio.trigger('on_open', 'chest', chestEntityId);
```

## 10. Test results

Django `apps/audio`: 101 tests; React `src/audio`: 180; `src/api/audio`: 12. The full run, the two unrelated failures and what was not run are recorded in `docs/IMPLEMENTATION_STATUS.md` ("Sound Manager Phase 2"). No browser or audible check has been done.

## 11. Known limitations

- **Not heard.** No audio was played in a browser; engine behavior is proved with fakes only.
- Publishing is library-wide (one live release for everything), not per Island. It keeps rollback
  and consistency simple; per-scope releases can be added later without changing the manifest.
- A cue's `stream` flag is set by staff, not derived from duration.
- The manifest is revalidated on every request; there is no CDN caching of it yet.
- `ETag` support exists server-side; the shared API client does not expose response headers yet, so
  the React client does not send `If-None-Match`.
- Streamed sounds (`HTMLAudioElement`) cannot detect an expired url before playback.
- Spatial placement, footsteps, playlists, ducking, narration and preference screens are later phases.
- The merge of `feature/asset-manager` is carried here until that branch lands (section 14).

## 12. Phase 3 candidates

Treasure Rush integration (first consumer: a region manifest and chest `on_open`, coin `on_collect`,
Pip `on_dialogue_start`), a sound-library report in Django Admin (unassigned and orphaned cues),
per-child preferences, then playlists and ducking.

## 13. Operating it

```bash
python manage.py migrate
python manage.py ensure_asset_roles
python manage.py ensure_sound_roles
```

Add staff to **Sound editors** or **Sound publishers** on the Admin accounts page. Publish at least
one release before expecting a non-empty manifest.

## 14. Branch relationship

`feature/sound-manager` = Phase 1 + a merge of `origin/feature/asset-manager` + Phase 2. The old
`origin/feature/sound` points at the Phase 1 tip (`3e78229`), an ancestor of this branch, so it can be
deleted once `feature/sound-manager` is the reference. Because this branch contains the Asset Library
branch's commits, merging this branch before `feature/asset-manager` also lands those; merging
`feature/asset-manager` first leaves only the Sound Manager commits.
