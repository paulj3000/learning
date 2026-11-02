# Recent sign-in verification for sensitive actions (LAI-0209)

Decision: ADR-043 (builds on ADR-024 A3 and ADR-040). Code: `lai/apps/users/recent_auth.py`,
`RequiresRecentAuthentication` in `lai/apps/users/permissions.py`, and
`react/src/features/auth/recentSignIn/`.

| Item | Implemented | Unit tested | Live Cognito verified | Browser verified | Deployed | Accepted |
|---|---|---|---|---|---|---|
| Django guard (`auth_time`, session anchor, Cognito `GetUser`) | Yes | pytest | **No** (gate L1 to L6 below) | n/a | No | No |
| `DELETE /api/v1/children/<id>/` (LAI-0602) | Yes | pytest | No | No | No | No |
| ~~Asset administrator mutations (AM-14)~~ | Removed 2026-11-02 (ADR-045): assets are managed in Django Admin | n/a | n/a | n/a | n/a | n/a |
| React reauthentication dialog (child deletion; the AM-15 asset pages were removed, ADR-045) | Yes | Vitest | No | **No** | No | No |

## 1. Contract

A valid Cognito session is enough for ordinary requests. A **sensitive action** also needs proof,
checked by Django on every request, that the parent completed an interactive Cognito sign-in in
the last `LAI_RECENT_AUTH_MAX_AGE_SECONDS` (default **300**, allowed 60 to 900).

- Django decides. React only reacts to Django's answer and can never assert or extend recency.
- Only the cryptographically verified Cognito access token is read. No header, body field,
  cookie or client timestamp is ever consulted (tested with forged `X-Auth-Time` headers and body
  fields).
- Missing, malformed, inconsistent, stale or unverifiable evidence is refused.
- A token refresh never counts as a sign-in.
- An ordinary session stays valid when its recent-sign-in window has passed: reads and
  non-sensitive writes keep working.

## 2. Evidence and checks (in this order)

The guard runs after authentication and after the endpoint's own authorization (`IsProvisionedParent`,
`IsAssetAdministrator`), so a caller who may not do the action is refused as unauthorized and is
never invited to sign in again. Recent sign-in never grants a right.

1. **Principal.** `request.auth` must be a verified Cognito access token (`VerifiedToken`) and
   `request.user` an active, provisioned `ParentAccount`.
2. **Evidence present.** `auth_time` and `iat` must be integers and `origin_jti` a non-empty
   string. Text, floats and booleans are not evidence.
3. **Clock skew, conservatively.** `auth_time` more than 30 s (the authentication leeway) in the
   future is refused; within that it counts as now. `iat` earlier than `auth_time - 30 s` is
   inconsistent and refused. The window itself is never widened by the leeway.
4. **Recency.** `now - auth_time <= LAI_RECENT_AUTH_MAX_AGE_SECONDS`.
5. **Scope.** The token must carry `aws.cognito.signin.user.admin`, which Cognito requires for
   `GetUser`. Without it the revocation check cannot run, so the action is refused (503).
6. **Session anchor (refresh cannot move `auth_time`).** Cognito ties `origin_jti` to the sign-in
   session's refresh token, and every refreshed token carries the same value. Django stores
   the first `auth_time` it sees for each session (`AuthSessionAnchor`: account, SHA-256 of
   `origin_jti`, `auth_time`, first seen). `POST /api/v1/me/`, which the web and Android apps
   call right after every sign-in, records it; so does the first sensitive request. A later
   token of the same session presenting a different `auth_time` is refused. This holds whatever
   Cognito does with `auth_time` on refresh. Anchors are pruned after 35 days and deleted with
   the account.
7. **Revocation-aware check.** Django calls Cognito `GetUser` with the presented access token
   (an unsigned call authorized by the token itself; Django needs no AWS credentials or IAM
   permission for it; 3 s connect and 5 s read timeouts, no retry). Cognito refuses a token
   whose session was signed out or whose refresh token was revoked. The returned `sub` must be
   the token's `sub` and the account's `cognito_sub`. If the call cannot complete, the action is
   refused (fails closed).

Local checks (1 to 6) run before the network call, so a stale request never reaches Cognito.

## 3. HTTP contract

| Situation | Status | `error.code` |
|---|---|---|
| No token, or an invalid, expired or wrong-pool token | 401 | `not_authenticated` / `authentication_failed` |
| Cognito says the token is revoked, or names a different user | 401 | `authentication_failed` |
| Valid token, account not provisioned | 403 | `account_not_provisioned` |
| Valid token, not allowed to do this at all (for example not an administrator) | 403 | `permission_denied` |
| Valid token, allowed, but sign-in not recent enough or evidence missing or bad | **403** | **`recent_auth_required`** |
| Allowed and recent, but the child is another family's or unknown | 404 | `not_found` |
| The revocation check could not run (network, throttling, missing scope) | 503 | `recent_auth_unavailable` |
| Child photo storage could not be emptied; the child is kept | 503 | `child_deletion_incomplete` |
| Child deleted | 204 | (no body) |

`recent_auth_required` is deliberately **not 401**: the web client answers a 401 with one forced
token refresh, and a refresh can never satisfy this check, so 401 would cause a pointless refresh
and then a sign-out. It never carries `WWW-Authenticate`. 503 answers are never treated as
signed out.

**No existence leak.** Recency is checked before the child is looked up, so a stale sign-in gets
the same `recent_auth_required` for the parent's own child, another family's child and an unknown
id (tested). After a recent sign-in, another family's child and an unknown id are both 404.

## 4. Protected endpoints

| Endpoint | Before the guard | Guard |
|---|---|---|
| `DELETE /api/v1/children/<id>/` | `IsProvisionedParent` | `RequiresRecentAuthentication`, then the child is resolved through the parent |

The `/api/v1/admin/assets/` routes that were guarded here were removed by ADR-045; only child deletion is guarded today.

Asset administration happens in Django Admin (staff session, Django permissions), so there is no
asset endpoint to guard here. Account
deletion and consent changes have no Django endpoint yet; when they arrive they declare
`SensitiveActionBlocked` until their own specification picks this guard.

**Django Admin is a separate boundary.** It uses local staff passwords and a Django session
(ADR-034, ADR-040). The DRF guard neither applies to it nor can be reached through it, and a
Django session never authenticates the API. Django Admin's own asset actions do not require a
recent sign-in; adding a re-authentication step there is an open item (section 8).

## 5. Child deletion (LAI-0602)

After the guard, `lai/apps/users/deletion.py` runs unchanged: photo objects are deleted first,
the child and every child-owned row are deleted only once storage reports every object gone, a
storage failure keeps the child (503 `child_deletion_incomplete`, safe to retry), a photo
uploaded during deletion stops the cascade, and a repeated `DELETE` of a deleted child is 404.
React treats that 404 as already deleted.

## 6. React reauthentication flow

`useSensitiveAction` wraps a sensitive request. When Django answers `recent_auth_required`:

1. A modal dialog explains that a fresh sign-in is needed and that nothing has changed yet.
2. The parent enters their password. Amplify `signOut` ends the current session (and revokes its
   refresh token), then Amplify `signIn` (SRP) signs in again **as the same account** (the login
   id is taken from the current session, not typed). The password goes only to Cognito, is held
   only in the input until submitted, and is never stored, logged or put in a URL. Amplify does
   not allow `signIn` while a session exists, which is why the old session is ended first.
3. `AuthContext` ignores the deliberate sign-out and sign-in events while this runs and re-reads
   the session quietly afterwards, so the page (form fields, a chosen file, upload state) stays
   mounted.
4. If the new sign-in is a different account, it is signed out again and the attempt ends.
5. After a successful sign-in, the dialog names the action ("Delete Bramble's profile") and asks
   for an explicit confirmation. Nothing is retried before that.
6. On confirmation the request runs **once more**. A second `recent_auth_required` ends the
   attempt with a message; there is no loop.
7. Cancel or Escape at any step closes the dialog and changes nothing. Cancelling after a failed
   password attempt leaves the parent signed out (the old session was already ended), and the
   app returns to the sign-in page.
8. An already-expired session shows "Your sign-in has ended" instead of a password field.
   A Cognito challenge (for example a required new password) ends the attempt and points to the
   sign-in page.

A silent token refresh is never used as re-authentication.

## 7. Configuration

| Setting | Default | Notes |
|---|---|---|
| `LAI_RECENT_AUTH_MAX_AGE_SECONDS` | 300 | 60 to 900, enforced at start-up. Same in every environment unless an ADR changes it |
| `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_ALLOWED_CLIENT_IDS` | none | Existing (ADR-024). `GetUser` goes to `cognito-idp.<COGNITO_REGION>.amazonaws.com` |

No Cognito secret is involved. The Django host needs outbound HTTPS to the Cognito endpoint
(it already fetches the JWKS from the same host).

**Cognito requirements (not changed by this task; verify live):**

- Access tokens must carry `aws.cognito.signin.user.admin`. Tokens from Cognito API sign-in
  (Amplify SRP, the web app) always do. An Android hosted-UI (PKCE) client must request that
  scope, and should use `prompt=login` for re-authentication so a managed-login cookie cannot
  sign the parent in without credentials.
- Token revocation should be enabled on the app client (`EnableTokenRevocation`, gate A6), so a
  sign-out revokes the session's tokens for `GetUser`.

## 8. Security assumptions, limits and open items

- **Unverified until the live gate: Cognito keeps `auth_time` unchanged on refresh.** AWS
  documents `auth_time` as the time the user completed authentication and `origin_jti` as
  bound to the refresh token, but does not state the refresh case outright. The session anchor
  makes the guard safe either way for any session whose first token Django saw. If Cognito did
  move `auth_time` on refresh, a session whose first token Django never saw could be accepted
  after a refresh; the live gate settles this.
- A stolen access token less than 5 minutes after sign-in can perform a sensitive action until
  the parent signs out (bearer-token property). Sign-out revokes it for `GetUser` (with token
  revocation enabled).
- Concurrent sensitive requests: each is checked independently; the anchor insert handles races
  with the unique constraint; deletion itself is idempotent and locks the child.
- Replay: replaying the same recent token inside its window is the legitimate holder's
  capability, not an escalation; outside the window it is refused; after sign-out `GetUser`
  refuses it.
- Django Admin asset actions have no recent sign-in step (separate staff password session).
- During verification the old session is ended before the new sign-in succeeds; a wrong
  password then leaves the parent signed out if they cancel. This is an Amplify constraint.

## 9. Local test approach

- pytest: `lai/apps/users/tests/test_recent_auth.py` (guard, child deletion, revocation adapter
  with `botocore` Stubber), `lai/apps/assets/tests/test_admin_api.py` (administrator vs.
  non-administrator, stale administrator, fail-closed). Tokens are signed with local RSA keys;
  `GetUser` is the `cognito_revocation` fake in `lai/conftest.py`. Nothing contacts AWS.
- Vitest: `react/src/features/auth/recentSignIn/*.test.ts(x)`, `AuthContext.test.tsx`,
  `djangoAssetPages.test.tsx`, `djangoProfiles.test.ts`. Amplify is mocked.

These prove the logic, **not** Cognito's behaviour.

## 10. Live Cognito acceptance gate (separate, not done)

Run against a non-production pool with a test parent (no production pool or setting changed):

- **L1** Fresh sign-in: decode the access token; `auth_time` is within seconds of the sign-in,
  `origin_jti` and `aws.cognito.signin.user.admin` are present.
- **L2** Refresh (`fetchAuthSession({ forceRefresh: true })` after a few minutes): the new token
  has a new `iat`, the **same `auth_time`** and the same `origin_jti`.
- **L3** After L2 with the original sign-in older than 300 s, `DELETE` a test child: 403
  `recent_auth_required`.
- **L4** Re-authenticate through the dialog: the new token has a new `origin_jti` and a fresh
  `auth_time`; the confirmed `DELETE` returns 204.
- **L5** Sign out (or revoke the refresh token), then replay a still-unexpired access token from
  before: `GetUser` refuses it and the guard answers 401.
- **L6** Read the app client's `EnableTokenRevocation` and access-token lifetime (gate A6),
  read-only.

Browser verification of the dialog (keyboard, screen reader labels, phone width) is a separate
gate, as is deployment.
