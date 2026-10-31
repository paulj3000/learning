# Android Authentication Flow (LAI-ANDROID-API-001)

How the native Kotlin app signs a parent in and gets that parent's Django account. **Nothing
here is new server behaviour.** The Android app reuses the Cognito bearer authentication of
LAI-0402 (ADR-024) and the `POST /api/v1/me/` provisioning call that the React app already makes.
ADR-036 records the decision.

## Identities

| Identity | Where it lives | Notes |
|---|---|---|
| Cognito user | Amazon Cognito user pool | Signs in with email and password. Only the immutable `sub` is used by Django |
| `ParentAccount` | Django (`users.ParentAccount`) | Keyed by the Cognito `sub`. Created once by `POST /api/v1/me/` |
| `ChildProfile` | Django (`users.ChildProfile`) | Owned by one parent. **No login, no Cognito identity, no email** |
| Django Admin staff | Django (`ParentAccount` with `admin_username`) | Local password, created only by `manage.py create_admin_account` (ADR-034). Cognito never grants it |

## What Django verifies on every request

`apps/users/authentication.py` (`CognitoJWTAuthentication`) checks each token:

1. Only the header `Authorization: Bearer <token>` is accepted. A token in a query string or a
   cookie is never read.
2. The header must say `alg=RS256` and name a `kid` that is in the pool's JWKS
   (`https://cognito-idp.<region>.amazonaws.com/<pool>/.well-known/jwks.json`). The key set is
   cached, refreshed with a cooldown when an unknown key appears, and fails closed: if the keys
   cannot be fetched, the answer is 503 `authentication_unavailable`.
3. The signature, `exp` (30 seconds of leeway), and `iss` must match the configured pool.
4. `token_use` must be `access`. An ID token is rejected.
5. `client_id` must be in `COGNITO_ALLOWED_CLIENT_IDS`. **The Android app client must be added
   to that list.** It can share the web app client, or use its own public client with no secret
   and the PKCE hosted UI. Creating a Cognito app client is an AWS change that needs approval
   (CLAUDE.md section 18).
6. The `sub` is the identity. Groups (`cognito:groups`) are read but **never** give API or admin
   rights.

Every failure gives the same 401 `authentication_failed` with `WWW-Authenticate: Bearer`. The
log gets a reason code only, never the token or its claims.

## Sequence

```text
Kotlin app                       Cognito                     Django
    | sign in (SRP or PKCE)       |                           |
    |---------------------------->|                           |
    |<---- access, id, refresh ---|                           |
    | POST /api/v1/me/  Authorization: Bearer <access>        |
    |-------------------------------------------------------->| verify (steps 1-6)
    |                                                         | get_or_create(sub)
    |<---------------- 201 {id, django_admin:false} (first time) or 200 (later)
    | GET /api/v1/children/  Bearer                           |
    |-------------------------------------------------------->| children of request.user only
```

- **First sign-in:** `POST /api/v1/me/` returns 201, and the account is created from the `sub`
  alone. No body is read, so a request body cannot set `is_staff`, another `sub`, or an id.
- **Every later sign-in or refresh:** the same call returns 200 with the same `id`. Two
  concurrent first calls still create exactly one account: `cognito_sub` is unique, and
  `get_or_create` retries after a conflict.
- **`GET /api/v1/me/`** never creates an account. Before provisioning, every other route answers
  403 `account_not_provisioned`, so the app should always POST once after signing in.
- **Deactivated parent** (`is_active=false`): 403 `permission_denied` everywhere, and every game
  session is refused.

## Token handling in the app

- Keep tokens in the Android Keystore (or EncryptedSharedPreferences). Never put them in a
  WebView, a URL, a JavaScript interface, logs, or crash reports.
- On a 401, refresh once and retry, as the React client does (`react/src/api/client.ts`). A
  second 401 means signing in again. A 503 is "try later", not "signed out".
- Revocation lag: an access token stays valid until it expires (Cognito's default is one hour).
  Global sign-out in Cognito does not reach Django before then. This is an open ADR-024 gate that
  applies to the web app too. The game session cookie is revoked on the server at once
  (`ANDROID_GAME_LAUNCH.md`).

## Staff separation

Cognito sign-in never grants Django Admin access. Provisioning sets no `is_staff`,
`is_superuser`, `admin_username` or usable admin credential. The admin backend accepts only
active staff rows that have an admin username, so a Cognito parent can never sign in there. The
`django_admin` flag in `/me/` only tells a client whether to show an "Admin" link. Django Admin
checks its own session every time and never trusts the flag. Tests:
`apps/users/tests/test_android_auth_flow.py` and `test_authentication.py`.

## Configuration

| Setting | Purpose |
|---|---|
| `COGNITO_REGION`, `COGNITO_USER_POOL_ID` | Issuer and JWKS URL |
| `COGNITO_ALLOWED_CLIENT_IDS` | Comma-separated allow-list. Add the Android client id here |

If any of these is empty, every token is rejected.

## Testing against a local backend (ADR-038)

Every AWS environment authenticates the API with Cognito only (`AUTH_PROVIDER=cognito`); nothing
in this flow changes. A local Django defaults to `AUTH_PROVIDER=django`, where bearer tokens are
**not** read. Two ways to point a debug build at a local backend:

1. **Keep Cognito (no app change).** Start the local Django with `AUTH_PROVIDER=cognito` and the
   test pool's `COGNITO_*` values, with the Android client id in `COGNITO_ALLOWED_CLIENT_IDS`. The
   app signs in as usual and sends its access token. This is the recommended path today.
2. **Local Django sign-in (needs app work, not built).** The repository has no Kotlin code yet, so
   nothing was changed. A debug-only build flavor would need: a cookie jar scoped to the local
   host (OkHttp `CookieJar`), `GET /api/v1/auth/csrf/` then `POST /api/v1/auth/login/` with
   `{"username", "password"}` and `X-CSRFToken` plus an `Origin` header matching the host,
   `X-CSRFToken` on every later POST (fetched again after login, which rotates it), and
   `POST /api/v1/auth/logout/` to sign out. No `Authorization` header in that mode. It must never
   be compiled into a release build; the production API answers 404 to those routes anyway.

The game launch (`docs/android/ANDROID_GAME_LAUNCH.md`) works in both modes: the launch call is
authenticated by whichever provider the backend runs, and the WebView's game cookie is unchanged.
