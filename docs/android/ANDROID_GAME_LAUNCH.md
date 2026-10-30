# Android Game Launch: the game-only WebView (LAI-ANDROID-API-001, ADR-036)

The native Kotlin app owns sign-in, navigation and every parent and child screen. An Android
`WebView` is used **only** for the standalone Three.js game. This document specifies the
contract between Kotlin, Django and the game runtime.

**Status.** The Django side (tickets, redemption, the game session cookie, runtime routes,
logout, and opening the play API to the cookie) is **implemented and unit-tested**. The
standalone game runtime at `/game/` is **not built**. It is a frontend deliverable: today the
Three.js engine (`react/src/features/island-map/three/`) runs only inside the React app. Until it exists, Android can
complete every step up to loading `gameUrl` and no further.

## Components

```text
Kotlin app (native)                Django (/api/v1/)                  WebView: /game/ (to build)
-------------------                -----------------                  -------------------------
Cognito tokens (Keystore)  ---->   bearer routes
                                   game-launches/ (ticket)
                                   game-launches/redeem/ (cookie)
CookieManager <- Set-Cookie
loadUrl(gameUrl)  ------------------------------------------------>   Three.js runtime only
                                   game-session/ (context, CSRF) <--  cookie
                                   play routes (own child+region) <--  cookie + X-LAI-Game-CSRF
WebMessage lifecycle <---------------------------------------------   ready/paused/exit/fatal
```

The WebView never loads the React parent dashboard, child management, account pages or island
navigation. It holds no Cognito token.

## Step 1: launch (native, bearer)

```http
POST /api/v1/children/{childId}/game-launches/
Authorization: Bearer <access token>
Content-Type: application/json

{"regionId": "treasure-rush-cove"}
```

`regionId` comes from `GET /children/{id}/regions/`. Keys are camelCase, as in every route of
this API, and the body is closed. Django checks the bearer token, that the child is the parent's
own, that the child is active, and that the region is `PUBLISHED` in an active location and
world that supports the child's age band.

```json
201 Cache-Control: no-store
{
  "ticket": "Jt3q...43 url-safe characters",
  "expiresAt": "2026-10-25T10:01:00Z",
  "childId": "8d1f...",
  "regionId": "treasure-rush-cove",
  "redeemUrl": "/api/v1/game-launches/redeem/",
  "gameUrl": "/game/"
}
```

Errors: 404 `not_found` (the child is not yours, or the region is unknown, unpublished or not
for this age band), 409 `child_inactive`, 400 `validation_error`, 429 `throttled`
(`LAI_GAME_LAUNCH_RATE`, default 30 a minute per account).

The ticket is 256 bits of randomness (`secrets.token_urlsafe(32)`), stored only as a SHA-256
hash, and bound to the parent, the child and the region. It expires after
`LAI_GAME_TICKET_TTL_SECONDS` (default 60, allowed range 10 to 300).

## Step 2: redeem (native, bearer)

The native app redeems the ticket with its own HTTP client, never through the WebView:

```http
POST /api/v1/game-launches/redeem/
Authorization: Bearer <access token>

{"ticket": "Jt3q..."}
```

```http
201 Cache-Control: no-store
Set-Cookie: lai_game_session=<opaque>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/; Max-Age=3600

{"childId": "8d1f...", "regionId": "treasure-rush-cove", "expiresAt": "...",
 "gameUrl": "/game/", "cookie": {"name": "lai_game_session", "path": "/api/v1/"}}
```

- **Single use, atomic.** One conditional `UPDATE ... WHERE consumed_at IS NULL AND
  expires_at > now AND parent = <caller>` claims the ticket. Of any number of concurrent
  redemptions exactly one succeeds (tested with six parallel requests).
- **Bound to the parent.** Another parent's bearer token gets 409 and does not use up the ticket.
- **Re-checked.** The child must still be owned and active, and the region still visible. A
  ticket that fails these checks stays used.
- **One live game session per parent.** Redeeming revokes the parent's earlier game sessions.
- Every failure is 409 `launch_ticket_invalid` (unknown, expired, replayed, revoked, or someone
  else's), so the answer says nothing about which. Kotlin should start again from step 1.
- The cookie value is not in the body. Kotlin copies the `Set-Cookie` header as it is:
  `CookieManager.getInstance().setCookie(apiOrigin, setCookieHeader)`, then `flush()`. Do not
  parse, store or log the value.

### Cookie attributes

| Attribute | Value | Why |
|---|---|---|
| Name | `lai_game_session` | |
| `HttpOnly` | yes | Page script cannot read it |
| `Secure` | yes in production (forced). `LAI_GAME_COOKIE_SECURE` may turn it off only in local settings, for plain-HTTP `runserver` | |
| `SameSite` | `Strict` | No cross-site request carries it |
| `Path` | `/api/v1/` | Sent only to the API, not to `/game/` assets |
| `Domain` | none (host-only) | Only the API host receives it |
| `Max-Age` | `LAI_GAME_SESSION_TTL_SECONDS` (default 3600, allowed range 300 to 14400) | |

**Origin requirement.** The game page and the API must share one origin (CloudFront path
routing, as `docs/DJANGO_TARGET_ARCHITECTURE.md` plans for the web app). There is no CORS. A
`gameUrl` on another origin would not receive the cookie on its API calls.

## Step 3: load the game (WebView)

```kotlin
webView.settings.javaScriptEnabled = true
webView.settings.allowFileAccess = false
webView.settings.allowContentAccess = false
webView.webViewClient = object : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) =
        request.url.toString().let { !it.startsWith(apiOrigin + "/game/") } // block navigation away
}
webView.loadUrl(apiOrigin + gameUrl)
```

- No `addJavascriptInterface` that exposes tokens or account actions. Use `WebMessagePort` with
  the lifecycle messages below, and check the origin of every message.
- Keep navigation inside `/game/`. Open links elsewhere outside the WebView, or ignore them.

## Step 4: the runtime's calls (cookie)

### `GET /api/v1/game-session/`

The only thing the runtime needs to start. It accepts the cookie only. A bearer token, or no
cookie, gets 401.

```json
200 Cache-Control: no-store
{
  "childId": "8d1f...",
  "regionId": "treasure-rush-cove",
  "ageBand": "PATHFINDER",
  "readingMode": "READ_ALONG",
  "sessionMinutes": 10,
  "aiEnabled": true,
  "expiresAt": "...",
  "csrfHeader": "X-LAI-Game-CSRF",
  "csrfToken": "<hex>",
  "endpoints": {
    "region": "/api/v1/children/8d1f.../regions/treasure-rush-cove/",
    "startSession": "/api/v1/children/8d1f.../regions/treasure-rush-cove/session/",
    "session": "/api/v1/children/8d1f.../sessions/{sessionId}/",
    "sessionAction": "/api/v1/children/8d1f.../sessions/{sessionId}/{action}/",
    "chestChallenge": "/api/v1/children/8d1f.../sessions/{sessionId}/chests/{entityId}/challenge/",
    "attemptAnswer": "/api/v1/children/8d1f.../attempts/{attemptId}/answer/",
    "questAccept": "/api/v1/children/8d1f.../quests/{questId}/accept/",
    "assets": "/api/v1/children/8d1f.../assets/",
    "end": "/api/v1/game-session/end/"
  }
}
```

The response has no nickname, no parent id and no token. `sessionMinutes` sets the calm
stopping point (the region's `scene.copy.calmStop`).

### Play API routes the cookie can reach

These are the existing TR-5 routes (`docs/PLAY_API.md`), unchanged for bearer callers:
region bootstrap, start or resume a session, session read, `pause`, `resume`, `complete` and
`abandon`, chest challenge, attempt answer, quest accept, and the asset resolver. With the cookie
they also enforce these rules:

- **Its child only.** A sibling or another family's child is 404.
- **Its region only.** Another region, a session in another region, an attempt from another
  region's session, or a quest the region does not offer is 404.
- **Writes need CSRF proof.** The `X-LAI-Game-CSRF: <csrfToken>` header is required, or the
  answer is 403 `game_csrf_failed`. When the WebView sends `Origin`, it must be the API's own
  origin or one listed in `LAI_GAME_ALLOWED_ORIGINS` (https only).
- **The server stays authoritative.** Bodies are closed (`{"answer": 3}` only), answers are
  graded on the server, and rewards, world changes and quest progress are decided there.
  Nothing the runtime sends can grant a reward, change the child, or raise privileges.

The cookie is **refused (401)** by: `/me/`, `/children/`, `/children/{id}/`, `home/`,
`regions/` (the list), `regions/{id}/adventures/`, `progress/`, `inventory/`, `game-launches/`,
`game-launches/redeem/` and `game-launches/revoke/`. A structural test
(`test_the_game_cookie_is_accepted_only_by_the_game_runtime_routes`) fails if any other route
starts accepting it.

## Lifecycle contract (runtime and Kotlin)

Gameplay state is the server's: pause and resume are the session actions above. The two sides
exchange only these messages over a `WebMessagePort`, as JSON. Neither side ever sends a token,
an account action, a child id to switch to, or a reward.

| Direction | `type` | Payload | Meaning |
|---|---|---|---|
| runtime to Kotlin | `ready` | `{}` | Bootstrap loaded, scene visible |
| runtime to Kotlin | `paused` | `{"sessionId"}` | After `POST .../pause/` succeeded |
| runtime to Kotlin | `resumed` | `{"sessionId"}` | After `POST .../resume/` succeeded |
| runtime to Kotlin | `exit` | `{"reason": "CHILD_EXIT" \| "CALM_STOP" \| "COMPLETED"}` | The runtime has called `POST /api/v1/game-session/end/` |
| runtime to Kotlin | `fatal` | `{"code": "BOOTSTRAP_FAILED" \| "SESSION_EXPIRED" \| "WEBGL_UNAVAILABLE" \| "NETWORK"}` | Kotlin shows a native error and closes the WebView |
| Kotlin to runtime | `pause` | `{}` | The app went to the background. The runtime pauses its session |
| Kotlin to runtime | `resume` | `{}` | The app came back. The runtime resumes, or reports `fatal` `SESSION_EXPIRED` |
| Kotlin to runtime | `exit` | `{}` | The parent or system closes the game. The runtime ends its session, then sends `exit` |

Kotlin treats every message as untrusted data. It changes only native UI and never makes an
authorization decision because of one. If the game session cookie expires mid-play, the play
routes answer 401. The runtime then sends `fatal` `SESSION_EXPIRED`, and Kotlin may start a new
launch.

## Logout and revocation

| Trigger | Call | Effect |
|---|---|---|
| The child or game exits | Runtime: `POST /api/v1/game-session/end/` (cookie plus CSRF header) | This session is revoked; the cookie is cleared (`Max-Age=0`) |
| Parent signs out, or Kotlin closes the game | Native: `POST /api/v1/game-launches/revoke/` (bearer) | Every game session of the parent is revoked and every unused ticket voided. Returns `{"revokedSessions": n}` and clears the cookie. Then call `CookieManager.removeAllCookies()` |
| Parent turns the child off (`PATCH active=false`) or the account is deactivated | none | The next cookie request is refused |
| Expiry | none | Refused after `expiresAt` |

Revocation is checked on every request, so it takes effect at once.

## Threat model summary

| Threat | Mitigation |
|---|---|
| A Cognito token leaks through the WebView | The WebView never has one. The cookie is game-scoped and HttpOnly |
| A ticket is replayed | Single-use conditional UPDATE, 60-second expiry, hashed at rest |
| A ticket is stolen and redeemed elsewhere | Redemption needs the same parent's bearer token |
| Concurrent redemption | Exactly one UPDATE wins (tested) |
| Cross-child or cross-family access | The grant is bound to child and region. Everything else is 404 |
| CSRF from another site | SameSite=Strict, a custom header that same-origin script must read, an Origin check, no CORS |
| A login-CSRF ("plant my session in your WebView") | Redemption is a bearer API call, not a form navigation |
| The runtime grants itself rewards | Closed bodies and server-side grading, unchanged from TR-5 |
| A stolen cookie is replayed | Host-only, Secure, short lifetime, server-side revocation. One live session per parent |
| Tickets or cookies in logs | Never logged (tested). Only reason codes such as `game_session_invalid` are |

## Frontend dependencies (not done)

1. **A standalone game entry point** (`/game/`): a small Vite entry that boots the Three.js
   region runtime without React routing, auth context or the parent UI. It reads
   `GET /api/v1/game-session/` and drives the play API with `credentials: 'same-origin'` and the
   CSRF header. Today the play client (`react/src/api/play/`) assumes bearer tokens.
2. **Hosting** of `/game/` on the API origin (CloudFront behaviour), plus `LAI_GAME_ENTRY_URL`.
3. **The `WebMessagePort` bridge** for the lifecycle table above.
4. **The Kotlin app** itself (sign-in, screens, `CookieManager`, WebView hardening).
