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
| Child deletion | **Blocked** (403 `sensitive_action_unavailable`) until the deletion service (LAI-0602) and recent-auth checks (LAI-0209) exist |
| Child home summary | **Added** |
| Region list, region adventures | **Added** |
| Region bootstrap, region session, sessions, chests, attempts, quests | **Existed** (TR-5, `docs/PLAY_API.md`); now also reachable by the game runtime cookie, only for its own child and region |
| Step-adventure sessions: availability, start or resume, read, answer, hint, complete | **Added** (LAI-0608; answers and hints existed, LAI-0601). Same routes as React; contract in `docs/PLAY_API.md`, "Step adventures" |
| Rewards: earned on answers and completion (`rewards`), history list and one grant | **Added** (LAI-0604). Server-granted only; `docs/PLAY_API.md`, "Rewards" |
| Mastery: list, one objective | **Added** (LAI-0603). Read-only, server-computed from graded answers; `docs/PLAY_API.md`, "Mastery" |
| Progress | **Existed**; gains an additive `mastery` status summary (LAI-0603) |
| Inventory | **Added** (the same rows as `progress.inventory`) |
| Game launch, ticket redemption, revoke, runtime context, runtime end | **Added** |
| Standalone `/game/` runtime bundle | **Not built.** Frontend dependency, see `ANDROID_GAME_LAUNCH.md` |
| Shared children with the deployed website | **Not yet.** The deployed React app still stores children in Amplify; Django children are separate until the Phase 11 data migration (ADR-019 gates). A React build with `VITE_BACKEND=django` uses these same child routes and ids (LAI-0501A), with no React-only endpoint |

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
| 409 | `child_inactive` | The child profile is turned off, so it cannot be launched or start an adventure |
| 409 | `adventure_unavailable` | A step adventure cannot be started; `GET .../availability/` gives the reasons |
| 409 | `session_not_complete`, `session_not_active`, `content_version_changed`, `step_not_current` | Step-session conflicts (`docs/PLAY_API.md`, "Step adventures") |
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
201 {"id": "3f3e9508-3f06-4ee3-bd95-52a2e7bb463a", "django_admin": false}
```

### `GET /api/v1/me/` (existed)

`200` with the same body, or `403 account_not_provisioned`. It never creates an account.

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

The photo's storage path is never returned (`hasPhoto` only). There is no photo upload route.

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

Always `403 sensitive_action_unavailable`. Deletion must also remove the S3 photo and cascade
records under the retention rules, and needs recent authentication. That is LAI-0602 and
LAI-0209.

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
- **Step adventures are played natively** through the step-session routes (LAI-0608): `GET
  /children/{id}/adventures/{adventureId}/availability/`, then `POST .../sessions/` (201 new, 200
  resumed), `GET .../sessions/{sessionId}/` for the step to render, `POST
  /children/{id}/sessions/{sessionId}/answers/` for each answer, and `POST
  .../sessions/{sessionId}/complete/` at a COMPLETE step. The game runtime (WebView) still
  launches regions only. The step body never carries answers, so the app renders it as given.
- Quests are the region's offered quests for the child's age band. `status` is `LOCKED` (its
  `prerequisites` do not hold yet, with `lockedReason: "PREREQUISITES_NOT_MET"`), `AVAILABLE`,
  `ACTIVE` or `COMPLETED`. A quest is accepted inside the game
  (`POST /children/{id}/quests/{questId}/accept/`).

## Progress and inventory

### `GET /api/v1/children/{childId}/progress/` (existed, unchanged)

Recent sessions (20), world changes, opened chests, inventory, quests and practice counts.
Schema: `docs/PLAY_API.md`.

### `GET /api/v1/children/{childId}/mastery/` and `.../mastery/{objectiveId}/` (added, LAI-0603)

The same routes and values the React app reads. Objective ids are the catalog's learning
objective codes, which are also the step's `objectiveIds`. `hasEvidence: false` with `status:
null` means not practised yet, not a low score. Mastery cannot be written from the app: it moves
only when an answer resolves a step. The shape and rules are in `docs/PLAY_API.md`, "Mastery".

### Rewards (added, LAI-0604)

The app never grants anything. What a step answer or a completion earned arrives on that same
response as `rewards: {grants, newItems}`. Show `newItems` as just found. A replayed request
returns `newlyGranted: false` and empty `newItems`, so do not celebrate twice. The history is
`GET /children/{id}/rewards/` and `GET /children/{id}/rewards/{grantId}/`. Item ids are the
catalog's, the same ones `inventory/` returns. Items are owned or not, with no quantities. The
rules are in `docs/PLAY_API.md`, "Rewards".

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
   **Step adventure (native):** `GET .../adventures/{adventureId}/availability/`, `POST
   .../adventures/{adventureId}/sessions/`, then answer through `POST
   /children/{id}/sessions/{sessionId}/answers/` with a new `requestId` per attempt (reuse it on
   a retry of the same attempt), re-reading `GET .../sessions/{sessionId}/` for the next step.
   Finish with `POST .../sessions/{sessionId}/complete/` when `allowedActions` is
   `["COMPLETE"]`, or simply read the session once an answer has completed it.
9. **Sign out:** `POST /api/v1/game-launches/revoke/`, clear the WebView cookies, then sign out
   of Cognito.

Every 401 `authentication_failed`: refresh the Cognito session once and retry, as the React
client does. A second 401 means signing in again.
