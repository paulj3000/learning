# Android API Contract (LAI-ANDROID-API-001)

The Django REST API a native Kotlin Android app uses. The React app uses the same API, so none of
these routes is specific to Android. Decision: ADR-036 in `docs/DECISIONS.md`. Related docs:
`ANDROID_AUTH_FLOW.md` (sign-in and provisioning) and `ANDROID_GAME_LAUNCH.md` (the game-only
WebView).

## Status at a glance

| Area | Status |
|---|---|
| Cognito bearer authentication, `POST/GET /api/v1/me/` | **Existed** (LAI-0402); reused unchanged |
| Child profiles: list, create, read, update | **Added** |
| Child profile photo: read, upload or replace, remove, bytes | **Added** (LAI-0904, ADR-042); client contract below (LAI-0905) |
| Child deletion | **Added** behind a recent sign-in (LAI-0602, LAI-0209; implemented on its feature branch, not yet merged or live-verified) |
| Child home summary | **Added** |
| Region list, region adventures | **Added** |
| Region bootstrap, region session, sessions, chests, attempts, quests | **Existed** (TR-5, `docs/PLAY_API.md`); now also reachable by the game runtime cookie, only for its own child and region |
| Progress | **Existed**; unchanged |
| Inventory | **Added** (the same rows as `progress.inventory`) |
| Game launch, ticket redemption, revoke, runtime context, runtime end | **Added** |
| Standalone `/game/` runtime bundle | **Not built.** Frontend dependency, see `ANDROID_GAME_LAUNCH.md` |
| Shared children with the deployed website | **Not yet in production.** A React build with the Django API keeps every profile in Django (LAI-CHILD-001, ADR-039); the deployed build (no Django API) still uses Amplify until the controlled import and cutover (docs/platform/AMPLIFY_PROFILE_IMPORT.md, Phase 11/12) |

## Conventions

- **Base path** `/api/v1/`. Changes that add something stay in v1.
- **Authentication:** `Authorization: Bearer <Cognito access token>` on every route except the
  game runtime routes. Tokens are verified against the pool's JWKS (RS256), and the issuer,
  expiry, `token_use=access` and an allow-listed `client_id` are all checked. Details are in
  `ANDROID_AUTH_FLOW.md`.
- **JSON keys are camelCase**, as in the play API. Request bodies are **closed**: an unknown
  field is a 400 `validation_error`. So a client-supplied `parent`, `childId`, `correct` or
  `reward` can never be applied.
- **Identifiers:** child, session and attempt ids are UUID strings. Regions, adventures, quests
  and items use stable content slugs (`treasure-rush-cove`, `repair-the-moonlight-bridge`).
- **Ownership:** a child id in the URL is resolved through the signed-in parent. A child in
  another family gets the same 404 as an id that does not exist. The owner is never read from
  the body or the query string.
- **Pagination:** none. Every list has a fixed bound (regions 50, adventures 50, quests 50, home
  lists 5, inventory 500 with `truncated`). Treat the lists as complete unless `truncated` is
  `true`.
- **Assets** are ids, never URLs (ADR-030). Resolve them through
  `GET /children/{id}/assets/?ids=`. Every `thumbnailAssetId` is `null` today, because no catalog
  row has an illustration yet. Show a local placeholder.
- **Caching:** launch and runtime responses are `Cache-Control: no-store`.

## Errors

Every error uses one envelope:

```json
{"error": {"code": "not_found", "message": "Not found."}, "request_id": "d78969a0..."}
```

`message` is a fixed English string, never internal detail. Branch on `code`, and use your own
localized copy for anything shown to a child. Validation errors add `details`, keyed by field
name:

```json
{"error": {"code": "validation_error", "message": "Invalid request.",
  "details": {"sessionMinutes": [{"message": "Choose between 5 and 8 minutes for this age band.",
                                   "code": "session_minutes_out_of_range"}]}}}
```

| Status | `code` | Meaning for the app |
|---|---|---|
| 400 | `validation_error`, `parse_error` | Fix the request. Show the field errors from `details` |
| 401 | `not_authenticated` | No token was sent. Sign in |
| 401 | `authentication_failed` | The token is invalid or expired. Refresh it once, then sign in again |
| 403 | `account_not_provisioned` | Call `POST /api/v1/me/`, then retry |
| 403 | `permission_denied` | The account is deactivated |
| 403 | `sensitive_action_unavailable` | The action is deliberately unavailable (child deletion) |
| 403 | `game_csrf_failed` | Game runtime only: a missing or wrong `X-LAI-Game-CSRF` header, or an unapproved `Origin` |
| 404 | `not_found` | Unknown, not yours, unpublished, or not for this child's age band |
| 405 | `method_not_allowed` | |
| 409 | `child_profile_limit_reached` | The parent already has three profiles, active or not |
| 409 | `child_inactive` | The child profile is turned off, so it cannot be launched |
| 409 | `launch_ticket_invalid` | The ticket is expired, already used, revoked, unknown, or another parent's. Start a new launch |
| 409 | `content_unavailable`, `session_not_open`, `chest_already_open`, `attempt_already_answered`, `quest_unavailable`, `invalid_transition` | Play API state conflicts (`docs/PLAY_API.md`) |
| 429 | `throttled` | Too many launches. Wait for the `Retry-After` header |
| 503 | `authentication_unavailable` | Cognito keys are unreachable. Retry later. This is not a sign-out |
| 500 | `server_error` | |

## Account

### `POST /api/v1/me/` (existed)

Provisions the account on first sign-in (201) and returns the same account afterwards (200). No
request body is read.

```json
201 {"id": "3f3e9508-3f06-4ee3-bd95-52a2e7bb463a", "displayName": "", "timezone": "", "django_admin": false}
```

`displayName` and `timezone` were added by LAI-CHILD-001 (additive; `""` when unset).

### `GET /api/v1/me/` (existed)

`200` with the same body, or `403 account_not_provisioned`. It never creates an account.

### `PATCH /api/v1/me/` (LAI-CHILD-001)

The parent's own profile: `displayName` (1 to 80 characters, trimmed) and `timezone` (an IANA
name such as `Europe/Bucharest`, or `""` to clear it), either or both. The body is closed: any
other key (`id`, `cognito_sub`, `is_staff`, `django_admin`, ...) is `400 validation_error`, and so
is an empty body. `200` with the account body. An unprovisioned identity gets
`403 account_not_provisioned`; nothing is created.

## Child profiles (added)

A profile object:

```json
{
  "id": "8d1f...",
  "nickname": "Bramble",
  "ageBand": "SPROUT",
  "avatarKey": "OWL",
  "hasPhoto": false,
  "interests": ["Space", "Ocean"],
  "readingMode": "VOICE_FIRST",
  "sessionMinutes": 6,
  "active": true,
  "aiEnabled": true,
  "createdAt": "2026-10-25T10:00:00Z",
  "updatedAt": "2026-10-25T10:00:00Z"
}
```

Allowed values come from `react/src/features/child-profile/constants.ts`:

- `ageBand`: `SPROUT`, `PATHFINDER`, `EXPLORER`.
- `readingMode`: `VOICE_FIRST`, `READ_ALONG`, `INDEPENDENT`.
- `avatarKey`: `FOX`, `OWL`, `OTTER`, `DRAGON`, `ROBOT`, `MERMAID`.
- `interests`: up to 5 different values from Animals, Space, Dinosaurs, Ocean, Vehicles, Art,
  Music, Cooking, Sports, Nature, Robots, Fantasy.
- `sessionMinutes` must fall in the age band's range: Sprouts 5 to 8, Pathfinders 8 to 12,
  Explorers 10 to 18.

The photo's storage path is never returned (`hasPhoto` only). The photo itself has its own
routes, below.

### `GET /api/v1/children/`

`200 {"children": [profile, ...]}`, in creation order. Only the signed-in parent's children are
listed.

### `POST /api/v1/children/`

Required: `nickname` (up to 30 characters, not blank), `ageBand`, `avatarKey`, `readingMode`,
`sessionMinutes`. Optional: `interests`, `active`, `aiEnabled`.

```json
POST {"nickname": "Bramble", "ageBand": "SPROUT", "avatarKey": "OWL",
      "interests": ["Space"], "readingMode": "VOICE_FIRST", "sessionMinutes": 6}
201 profile
409 child_profile_limit_reached
400 validation_error
```

### `GET /api/v1/children/{childId}/`

`200 profile`, or `404`.

### `PATCH /api/v1/children/{childId}/`

Any subset of the writable fields, with at least one field. The age band and session length
are checked together, so changing `ageBand` may also need a new `sessionMinutes`. Turning
`active` or `aiEnabled` off is a parental control and takes effect at once. For example, while
`active` is off, the child cannot be launched and any open game session is refused on its next
request.

```json
PATCH {"ageBand": "SPROUT", "sessionMinutes": 7}
200 profile
```

### `DELETE /api/v1/children/{childId}/`

Deletes the child, its photo objects and every child-owned record (LAI-0602). A sensitive action:
the access token must come from an interactive Cognito sign-in less than 300 seconds ago
(LAI-0209, `docs/platform/RECENT_SIGN_IN.md`). Answers:

| Status | `error.code` | Client action |
|---|---|---|
| 204 | | Deleted |
| 403 | `recent_auth_required` | Re-authenticate (a real sign-in, never a token refresh), confirm with the parent, retry once |
| 403 | `account_not_provisioned` | `POST /api/v1/me/` first |
| 404 | `not_found` | Already deleted, another family's, or unknown |
| 401 | `authentication_failed` | Token invalid or revoked: sign in again |
| 503 | `recent_auth_unavailable` | Try again later; do not sign out |
| 503 | `child_deletion_incomplete` | Nothing lost; retry later |

Android requirements: call `POST /api/v1/me/` after every sign-in (it anchors the session's
sign-in time); access tokens must carry `aws.cognito.signin.user.admin` (SRP sign-in always does;
a hosted-UI PKCE client must request it); re-authenticate with SRP or the hosted UI with
`prompt=login`, never with a refresh token. The archival alternative stays
`PATCH {"active": false}`.

## Child profile photo (added, LAI-0904; client contract LAI-0905)

Optional. A parent may set one photo per child as the child's profile icon. Full server design:
`docs/platform/CHILD_PHOTO_STORAGE.md` section 4. Every route is scoped to the signed-in parent:
another family's child and an unknown id are the same `404`.

| Route | Result |
|---|---|
| `GET /api/v1/children/{childId}/photo/` | `200 {"photo": null}` or `200 {"photo": photo}` |
| `PUT /api/v1/children/{childId}/photo/` | Upload or replace. `200 {"photo": photo}` |
| `DELETE /api/v1/children/{childId}/photo/` | `204`, whether or not there was a photo |
| `GET /api/v1/children/{childId}/photo/content/` | The JPEG bytes, with the bearer token |

```json
{"photo": {"id": "5b0c...", "contentType": "image/jpeg", "byteSize": 18234,
           "width": 256, "height": 256, "uploadedAt": "2026-10-31T10:00:00Z",
           "delivery": "presigned", "url": "https://...", "urlExpiresAt": "2026-10-31T10:05:00Z"}}
```

### What the app must send

The app prepares the picture on the device. The server checks it again and rejects anything
outside the limits; it never resizes.

1. **Decode** the picked image with its EXIF orientation applied (for example
   `ImageDecoder` with the default orientation handling, or `ExifInterface` rotation before
   drawing), because the metadata that carries it is removed below.
2. **Crop** the largest centered square and **scale** it to **256 x 256** pixels. That matches
   the website (`react/src/features/child-profile/avatarPhoto.ts`, `ICON_PIXEL_SIZE`).
3. **Encode** a fresh baseline JPEG (for example `Bitmap.compress(JPEG, 85, ...)`). Re-encoding a
   bitmap writes no EXIF, so no GPS position, camera model or capture time leaves the device.
   Never upload the camera file, a HEIC, a PNG or a WebP, even renamed.
4. **Limits** (server defaults): at most **1 MB** (`LAI_CHILD_PHOTO_MAX_BYTES`) and at most
   **1024 px** on each side (`LAI_CHILD_PHOTO_MAX_DIMENSION`); 8-bit, grayscale or color. A
   256 px JPEG at quality 85 is typically 15 to 40 KB.
5. **Send** the bytes as the whole request body: `PUT` with `Content-Type: image/jpeg` and the
   bearer token. No multipart, no file name, no other field. Never put the child's name, the
   file name or any device metadata in a header.

The server still strips EXIF, XMP, ICC, IPTC, comments and thumbnails before storage, but the app
must not rely on that: the contract is that metadata never leaves the device.

### Errors

| Status and code | Meaning | Show the parent |
|---|---|---|
| `400 photo_invalid`, `400 photo_dimensions`, `413 photo_too_large`, `415 photo_type_unsupported` | The bytes were not an acceptable JPEG | "We could not read that image. Please try a different one." |
| `503 photo_storage_unavailable` | Photo storage is off or failing; nothing changed | "We could not save that photo. Please try again." (or "...delete..." for `DELETE`) |
| `404 not_found` | Not this parent's child | The same save or delete message |
| `401` after one token refresh | Signed out | "Please sign in again." |

These are the website's messages (`react/src/features/child-profile/photoMessages.ts`).

Retries: `503`, `5xx` and network failures may be retried (the parent taps "try again"; no
automatic loop). A `400`/`413`/`415` photo rejection will fail again with the same bytes: ask for a
different picture. `PUT` is safe to repeat, since each upload replaces the current photo, and
`DELETE` is idempotent.

### Showing the photo

- `delivery: "presigned"`: `url` is a short-lived S3 URL (about 5 minutes) that works without
  credentials. Load it with the image loader and **no** `Authorization` header. Do not cache it
  past `urlExpiresAt`, or on disk at all: ask `GET .../photo/` again for a new one.
- `delivery: "api"`: `url` is the content route. Call `GET .../photo/content/` on the configured
  API base with the bearer token, never by sending the token to whatever host `url` names. Keep
  the bytes in memory only.
- A failed load shows the authored avatar character (`avatarKey`), never an error.

### Order on the profile form

A photo belongs to a saved child, so for a new child: `POST /children/` first, then `PUT` the
photo with the new id. If the photo fails after the profile saved, say so ("The profile was saved,
but the photo was not.") and retry the photo against the saved child, never `POST` again.

## Child home (added)

### `GET /api/v1/children/{childId}/home/`

```json
{
  "child": { "...profile..." },
  "lastRegion": { "...region entry or null..." },
  "resume": [ { "...region entries with an open session..." } ],
  "nextRegions": [ { "...playable regions with unopened chests and no open session..." } ],
  "progress": {"completedSessions": 1, "worldChanges": 1, "items": 1,
               "questsCompleted": 0, "questsActive": 1},
  "recentItems": [{"item": {"itemId": "golden-doubloon", "displayName": "Golden Doubloon",
                            "description": "...", "category": "...", "assetId": ""},
                   "grantedAt": "2026-10-25T10:05:00Z"}],
  "recentActivities": [{"type": "SESSION_COMPLETED", "kind": "REGION",
                        "regionId": "treasure-rush-cove", "adventureId": "",
                        "at": "2026-10-25T10:06:00Z"}],
  "recentWorldChanges": [{"locationSlug": "pirate-builder-bay", "changeType": "...",
                          "changeKey": "TREASURE_RUSH_COVE_CHEST_OPENED", "payload": {},
                          "createdAt": "..."}],
  "restrictions": {"active": true, "sessionMinutes": 10, "aiEnabled": true,
                   "readingMode": "READ_ALONG"}
}
```

Everything here comes from the existing sessions, world changes, inventory and quest progress.
There is no XP, coin or achievement system, and none was added. `restrictions` is every parental
control the model has today. There are no daily limits or schedules. `sessionMinutes` is the
calm stopping point the game shows, not a hard cut-off.

## Islands and adventures (added)

The hierarchy is kept as it is: **World** (a themed island) > **Location** > **WorldRegion**
(an explorable 3D region, the only thing the game launches) and **Location** > **Adventure** (a
step-based adventure). Only Treasure Cove (`treasure-rush-cove`, in Pirate Builder Bay) is a
published region today. Locations without a region (for example Wonderwild Forest and
Storykeeper Castle) are not listed, because the game runtime cannot launch them yet.

A region is visible to a child only when all of these hold: it is `PUBLISHED`, its location and
world are active, and the world supports the child's age band. Drafts, retired content and
other age bands are never returned.

### `GET /api/v1/children/{childId}/regions/`

```json
{"regions": [{
  "regionId": "treasure-rush-cove",
  "title": "Treasure Cove",
  "description": "Counting, measuring, and building with Pirate Pip.",
  "world": {"slug": "learning-adventure-island", "title": "Learning Adventure Island"},
  "location": {"slug": "pirate-builder-bay", "title": "Pirate Builder Bay"},
  "ageBands": ["SPROUT", "PATHFINDER", "EXPLORER"],
  "available": true,
  "lockedReason": null,
  "status": "NOT_STARTED",
  "chestsTotal": 1,
  "chestsOpened": 0,
  "thumbnailAssetId": null,
  "prerequisites": [],
  "resume": null,
  "lastPlayedAt": null
}]}
```

- `status` is `NOT_STARTED`, `IN_PROGRESS` (an open session, described in `resume`), or `VISITED`.
- `available` is `false` with `lockedReason: "NO_CHALLENGE_FOR_AGE_BAND"` when no chest has a
  published challenge for this child's band.
- `resume` is `{"sessionId", "status": "ACTIVE" | "PAUSED", "lastActivityAt"}` or `null`.

### `GET /api/v1/children/{childId}/regions/{regionId}/adventures/`

```json
{
  "region": { "...region entry..." },
  "adventures": [{
    "adventureId": "repair-the-moonlight-bridge", "kind": "STEP_ADVENTURE",
    "title": "Repair the Moonlight Bridge", "description": "", "ageBands": ["PATHFINDER"],
    "skillDomain": "...", "available": true, "lockedReason": null,
    "status": "AVAILABLE", "thumbnailAssetId": null, "prerequisites": [], "resume": null
  }],
  "quests": [{
    "questId": "treasure-rush-cove", "title": "...", "summary": "...", "giverNpcId": "pirate-pip",
    "status": "AVAILABLE", "currentStageId": null, "completedAt": null, "stages": [ ... ],
    "available": true, "lockedReason": null, "prerequisites": []
  }]
}
```

- Adventures are the region's location's active adventures for the child's age band. `status`
  is `AVAILABLE`, `IN_PROGRESS` or `COMPLETED`. Step adventures have no prerequisites in the
  content export.
- **Step adventures cannot be started by the Android app yet.** No Django route starts an
  `ADVENTURE` session, and the game runtime launches regions only. Kotlin should show them for
  information, or hide them.
- Quests are the region's offered quests for the child's age band. `status` is `LOCKED` (its
  `prerequisites` do not hold yet, with `lockedReason: "PREREQUISITES_NOT_MET"`), `AVAILABLE`,
  `ACTIVE` or `COMPLETED`. A quest is accepted inside the game
  (`POST /children/{id}/quests/{questId}/accept/`).

## Progress and inventory

### `GET /api/v1/children/{childId}/progress/` (existed, unchanged)

Recent sessions (20), world changes, opened chests, inventory, quests and practice counts.
Schema: `docs/PLAY_API.md`.

### `GET /api/v1/children/{childId}/inventory/` (added)

```json
{"items": [{"item": {"itemId": "golden-doubloon", "displayName": "Golden Doubloon",
                     "description": "...", "category": "...", "assetId": ""},
            "grantedAt": "2026-10-25T10:05:00Z"}],
 "truncated": false}
```

The newest item comes first. These are the same rows and the same item shape as
`progress.inventory`. Rewards are still granted only by the server, when a chest's challenge is
answered correctly (Treasure Rush's reward rule fires once per child).

## Game launch

`POST /api/v1/children/{childId}/game-launches/`, `POST /api/v1/game-launches/redeem/`,
`POST /api/v1/game-launches/revoke/`, `GET /api/v1/game-session/` and
`POST /api/v1/game-session/end/` are specified in `ANDROID_GAME_LAUNCH.md`.

## Native integration sequence

1. **Sign in** with Cognito (the Amplify Android library or the hosted UI with PKCE), using an
   app client listed in `COGNITO_ALLOWED_CLIENT_IDS`. Keep tokens in the Android Keystore or
   EncryptedSharedPreferences.
2. **`POST /api/v1/me/`** after every sign-in. 201 or 200 means the Django account exists.
3. **`GET /api/v1/children/`.** With an empty list, show the create flow (`POST /api/v1/children/`).
4. The parent picks a child (the parent gate is native UI).
5. **`GET /children/{id}/home/`** for the home screen.
6. **`GET /children/{id}/regions/`**, then **`GET /children/{id}/regions/{regionId}/adventures/`**
   for the selection screens.
7. **Launch:** `POST /children/{id}/game-launches/`, then `POST /game-launches/redeem/`, copy the
   `Set-Cookie` into the WebView `CookieManager`, and load `gameUrl` (`ANDROID_GAME_LAUNCH.md`).
8. On return from the game: `GET /children/{id}/home/` or `/progress/` to refresh.
9. **Sign out:** `POST /api/v1/game-launches/revoke/`, clear the WebView cookies, then sign out
   of Cognito.

Every 401 `authentication_failed`: refresh the Cognito session once and retry, as the React
client does. A second 401 means signing in again.
