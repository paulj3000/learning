# Family accounts and independent child sign-in (LAI-AUTH-01 to 10)

- **Status:** Development direction approved by the owner (2026-11-27): independent child sign-in
  is the primary authentication model, with a separate child Cognito user pool. The decision
  record, ADR-075 in [DECISIONS.md](../DECISIONS.md), is Proposed; the number is reserved by the
  registry pull request #118 (stacked on #117, which takes 074). Nothing here is deployed,
  live-verified or owner-accepted.
- **Owner:** project owner
- **Last reviewed:** 2026-11-27
- **Trello:** parent #97 "[Subproject] Child Authentication & Family Accounts"; LAI-AUTH-01 to 10
  (#98 to #107)
- **Branch:** `feature/family-child-authentication` from `main` `d812ad71`
- **Related ADRs:** ADR-019 (gates G2, G7, G9, G10), ADR-022, ADR-024, ADR-036, ADR-039, ADR-040,
  ADR-043, ADR-053
- **Supersedes:** the 2026-11-27 morning proposal on this branch (commit `5ed26189`), which made
  parent-led "family login" (mode A) primary. Mode A is deferred (section 9).

## Summary

```text
ParentAccount                       parent Cognito pool (unchanged: email, password, recovery, MFA)
 ├── ChildProfile A ── ChildCredential ── child Cognito pool user (username + password)
 ├── ChildProfile B ── ChildCredential ── child Cognito pool user
 └── ChildProfile C ── ChildCredential ── child Cognito pool user
```

- Every child can have their own sign-in. The parent creates it, sets and resets the password,
  pauses, resumes and removes it, signs the child out everywhere and forgets remembered devices.
  The child has no email or phone number and cannot create accounts, recover their own password,
  reach the parent dashboard or a sibling, or change consent or controls.
- Children live in a **separate child Cognito user pool** (username-only, no public sign-up, no
  self-service recovery). Django creates and manages its users with a narrowly scoped admin
  policy. A child token can never pass a parent check: the parent verifier accepts only the
  parent pool's issuer and client, and the child verifier only the child pool's.
- A child-pool token is used **once**, right after sign-in: Django verifies it, maps
  `(issuer, sub)` to the child's existing `ChildProfile`, checks the sign-in is active and
  consent is given, and opens a **child session**: an HttpOnly, SameSite=Strict cookie bound to
  exactly one child. The browser then discards the Cognito tokens.
- The child session is accepted only on an **allowlist of gameplay routes and methods**, and only
  for the session's own child. Every other route never reads it (401). Django is the revocation
  authority, so suspension, password reset, consent withdrawal and sign-out-everywhere take
  effect on the next request, without waiting for a Cognito token to expire.
- Existing `ParentAccount` and `ChildProfile` rows, ids and every progress record are untouched:
  enabling sign-in adds a `ChildCredential` row and never creates a profile.
- Consent (gate G9) fails closed: without a parent's consent to the currently approved consent
  text (`LAI_CHILD_SIGN_IN_CONSENT_VERSION`, empty by default), no credential can be created and
  no child can sign in.

## 1. Identity mapping

| Identity | Where | Key | Never used as identity |
|---|---|---|---|
| Parent | parent Cognito pool, `ParentAccount` | `cognito_sub` (unchanged) | email |
| Child sign-in | child Cognito pool, `ChildCredential` | `(issuer, subject)`: the pool's issuer URL and the user's immutable `sub`, both from a verified token | login name, Cognito username |
| Child profile and progress | `ChildProfile` and every `ChildOwnedModel` row | `ChildProfile.id` (unchanged) | anything the browser sends |

- The pool's username is an opaque value Django generates (`c-<uuid hex>`, stored as
  `provider_username`) so the admin API can address the user. The child types their **login
  name**, which the pool holds as the `preferred_username` alias. The parent can change the login
  name without changing the identity, the profile or progress.
- At exchange, the token's `username` claim must equal the credential's `provider_username`, as a
  second check on top of `(issuer, sub)`.
- A removed sign-in leaves a tombstone (`status=REVOKED`, login name cleared): the login name is
  free again, and the old `sub` can never map to any child again (unique `(issuer, subject)`).

## 2. Cognito architecture

| | Parent pool (existing) | Child pool (new, `infra/lib/childIdentityStack.ts`) |
|---|---|---|
| Sign-in | Email + password, SRP | Login name (`preferred_username` alias) + password, SRP |
| Sign-up | Public (parents register) | **None** (`AllowAdminCreateUserOnly`) |
| Recovery | Email code (existing) | **None** (`AccountRecovery.NONE`): the parent sets a new password through Django |
| Attributes | email | none required; no email, no phone; no client-writable attribute |
| MFA, recent sign-in | Existing pool settings; recent sign-in for sensitive actions (ADR-043) | MFA off (children) |
| App client | Existing web client (unchanged) | One public SRP-only client, no secret, no OAuth, token revocation on, access and ID tokens 5 minutes, refresh 60 minutes (the minimum) |
| Who administers | Cognito and the parent | Django only, policy `lai-django-child-identity-<env>` with the eight admin actions it calls, on this pool's ARN |
| Verified by | `CognitoJWTAuthentication` (every parent route) | `verify_child_access_token`, only at `POST /api/v1/child-auth/session/` |

Why separate: the parent pool uses email as its username attribute, which Cognito cannot change
after creation, and it has public sign-up and email recovery a child must not have. A separate
issuer also means a forgotten check can never let a child token through as a parent. Settings
refuse a child pool equal to the parent pool or sharing an app client with it.

The stack is defined only when `LAI_ENABLE_CHILD_POOL=1` (`infra/bin/app.ts`) and is never
deployed by this branch. Live creation is an owner approval (G7, OD-3).

## 3. Django model and migration

Migration `users/0009_child_sign_in` is create-only (five new tables; no change to any existing
table, id or progress row). It replaces this branch's unmerged `0009_family_child_authentication`,
which never left the branch (LAI 05 confirmed no `users/0009` on `main` or the integration branch).

| Model | Purpose | Key rules |
|---|---|---|
| `ChildCredential` | The child's sign-in, mapped to the profile | One live per child; `(issuer, subject)` unique forever; login name case-insensitively unique among live rows and format-checked; active and suspended rows always have an identity; `tokens_valid_after` revocation line; `provider_cleanup_pending` for a pool deletion still to finish |
| `ChildDevice` | A remembered device ("remember me") | Opaque cookie, SHA-256 stored; one child only; rotated on every use; revocable by the parent; no device name, user agent or IP |
| `ChildPlaySession` | The restricted child session | Opaque cookie, SHA-256 stored; one child; absolute and idle expiry; ends on any revocation |
| `ParentConsent` | Consent for one purpose for one child (`CHILD_INDEPENDENT_SIGN_IN`) | Records the approved policy text version; one live per purpose; withdrawal ends sessions at once |
| `ChildAccountEvent` | Audit of the parent's changes | Action code and time only: never a password, token, login name or device detail |

Retention: credentials, devices, sessions, consents and events are child-owned and cascade when
the child is deleted. Deletion deletes the pool user first (like photo objects) and keeps the
child if the pool cannot be reached (`503 child_deletion_incomplete`, safe to retry).

## 4. Sign-in and sessions

```text
child browser                       child Cognito pool                 Django
  login name + password ── SRP ───▶  verifies password
                         ◀── access token (5 min) ─
  POST /child-auth/session/ (Bearer child token, {remember})  ───────▶  verify signature, issuer,
                                                                         client, token_use, expiry;
                                                                         auth_time ≤ 5 min old;
                                                                         (iss, sub) → ChildCredential;
                                                                         username = provider_username;
                                                                         ACTIVE; auth_time after the
                                                                         revocation line; child and
                                                                         parent active; consent given
                         ◀──── Set-Cookie lai_child_session (and lai_child_device if remembered)
  discard Cognito tokens
  gameplay calls with the cookie + X-LAI-Child-CSRF on writes ───────▶  allowlisted route + method,
                                                                         own child only
```

| Setting | Default | Bounds | Meaning |
|---|---|---|---|
| `LAI_CHILD_SESSION_MAX_SECONDS` | 12 h | 1 h to 24 h | Absolute session lifetime |
| `LAI_CHILD_SESSION_IDLE_SECONDS` | 2 h | 15 min to 4 h | Idle timeout (not above the maximum) |
| `LAI_CHILD_DEVICE_REMEMBER_SECONDS` | 30 days | 1 to 90 days | How long "remember me" lasts |
| `LAI_CHILD_SIGN_IN_MAX_AGE_SECONDS` | 5 min | 1 to 15 min | How fresh the Cognito sign-in must be at exchange |
| `LAI_CHILD_SIGN_IN_RATE`, `LAI_CHILD_ACCOUNT_RATE` | 20/min, 30/min | | Throttles on the child-auth and parent management routes |
| `LAI_CHILD_IDENTITY_PROVIDER` | `disabled` (`fake` in local and test) | `cognito`, `fake`, `disabled` | Production refuses `fake` |
| `LAI_CHILD_SIGN_IN_CONSENT_VERSION` | empty | | The approved consent text; empty closes child sign-in |

Expiry is a security control, never a play-time limit (ADR-053): with "remember me", an expired
session is reopened from the remembered device without interrupting the child.

**Revocation.** Every parent change that should stop access moves `tokens_valid_after` and revokes
the child's sessions and remembered devices in the same transaction; every request re-checks the
session, its device, the credential status, the revocation line, consent and that child and
parent are active. The pool follow-up (disable, global sign-out, delete) is best effort after
Django's change and reported as `providerSynced`.

**Shared devices.** One child per browser. Signing in as another child ends the previous child's
session and forgets their remembered device on that browser, so switching always needs the other
child's own name and password. A remembered device reopens only its own child and is rotated on
every use, so a copied cookie and the real one cannot both keep working. Signing out ends the
session and forgets the device. No profile picker, PIN or parent-authenticated switching exists.

**Session fixation and CSRF.** Values are 256-bit server-generated; a cookie the server did not
issue is never adopted, and any cookie the browser presents at sign-in is revoked. Cookies are
HttpOnly, SameSite=Strict, Secure outside local HTTP; the session cookie is scoped to `/api/v1/`,
the device cookie to `/api/v1/child-auth/` only. Writes need `X-LAI-Child-CSRF` (an HMAC of the
session only same-origin script can read) and a same-origin `Origin` when one is sent; the
restore and sign-out routes need `X-LAI-Child-Sign-In: 1`.

**Rate limiting.** Password guessing is limited by the child pool (Cognito's built-in failed
sign-in lockout); Django throttles the exchange, restore and management routes. The Django
throttles use the per-process cache (no shared cache exists yet), so they are a speed bump, not
a guarantee (risk R2).

## 5. Authorization

- `apps.users.child_session.CHILD_SESSION_ROUTES` is the whole of a child's API: about 80 child
  gameplay routes with their methods (play, answers, hints, quests, stories, inventory, rewards,
  scoring reads, skill progress, assets, audio manifests, NPCs, AI companion and tutor turns,
  speech, the child's own profile read and companion choice). `ChildScopedMixin` adds the child
  authenticator only on those routes and methods; the child in the URL must be the session's own
  (a sibling and a stranger get the same 404).
- Never on the list: `me/`, `children/`, profile edits and deletion, photos, game launches,
  sign-in management, consent, AI history and safety events, audio settings writes, every
  `DELETE` (resets), and co-op sessions (they span siblings; LAI 04 to review).
- `request.user` on a child session is the child's parent (so the existing scoping resolves the
  child through its owner) and `request.auth` is a `ChildSessionGrant`; the allowlisted views
  were checked to act only on `self.child`. Tests pin the list (`test_child_session_routes.py`).
- A child-pool token presented as a bearer token anywhere is 401 (wrong issuer). A child session
  on any parent route is 401 (the cookie is not read there).
- The Android game cookie (ADR-036) is unchanged and independent.

## 6. Parent dashboard API

| Route | Method | Recent sign-in | Effect |
|---|---|---|---|
| `children/<id>/sign-in/` | GET | no | Overview: consent, status, username, dates, session and device counts, recent changes |
| `children/<id>/consents/child-sign-in/` | POST / DELETE | POST yes / DELETE no | Give consent to the approved text / withdraw (ends sessions at once) |
| `children/<id>/sign-in/` | POST `{username, password}` | yes | Enable sign-in for this existing child |
| `children/<id>/sign-in/` | PATCH `{username}` | yes | Change the login name (identity unchanged) |
| `children/<id>/sign-in/password/` | POST `{password}` | yes | Parent-managed reset; ends every session and device |
| `children/<id>/sign-in/suspend/` | POST | no | Pause at once |
| `children/<id>/sign-in/resume/` | POST | yes | Resume; old tokens stay refused |
| `children/<id>/sign-in/sign-out-everywhere/` | POST | no | End every session and device |
| `children/<id>/sign-in/devices/` and `.../<device_id>/` | GET / DELETE | no | List / forget remembered devices |
| `children/<id>/sign-in/` | DELETE | yes | Remove sign-in; profile and progress stay |

Rule: actions that grant or restore access need a recent parent sign-in; protective actions do
not, so a parent can act immediately (OD-5). Bodies are closed; passwords are write-only, marked
sensitive, validated (8 to 64 characters, not containing the login name) and never returned,
stored, logged or audited. Creating a child profile, AI permissions, educational settings,
progress views and child deletion are the existing dashboard features and are reused.

Child-side routes: `POST /api/v1/child-auth/session/` (exchange), `GET` (who is signed in plus
the CSRF value), `POST .../restore/` (remembered device), `POST .../end/` (sign out). Every
refusal is one calm answer, `403 child_sign_in_unavailable` ("Please ask your grown-up"); the
cause is logged as a reason code only.

## 7. Frontend

Built on this branch in `react/src`: one authentication landing page with two distinct
experiences (child: username, password, "remember me", "Start my adventure", ask-your-grown-up
recovery text; parent: the existing email sign-in, registration and recovery), a child session
provider, a child mode in the API client (no `Authorization` header, same-origin cookies, the
CSRF header on writes, one restore attempt on 401), routing by the identity the server verified,
and a per-child sign-in management panel in the parent dashboard. The child's Cognito tokens
are kept in memory only and dropped after the exchange.

## 8. Consent (gate G9)

`ParentConsent` is deliberately narrow: it records that this parent consented, for this child, to
the approved text version, and when it was withdrawn. It does not design consent: the legal text,
verification method and any other purposes remain LAI-0308 (G9). With
`LAI_CHILD_SIGN_IN_CONSENT_VERSION` empty (the default everywhere), nobody can consent and child
sign-in stays closed. A changed text version requires a new consent.

## 9. Reconciliation with commit `5ed26189`

| Part of `5ed26189` | Decision |
|---|---|
| `ChildCredential` (status, `tokens_valid_after`, identity constraints, login-name rules) | **Kept and revised**: added `provider_username`, `password_set_at`, `provider_cleanup_pending`; tombstones clear the login name; suspended rows must also have an identity |
| `ChildPlaySession` | **Kept and revised**: always tied to a credential, optionally to a remembered device; `parent` and `source` removed (mode A gone) |
| `FamilyDevice` | **Replaced** by `ChildDevice` (one child, not a parent's device) |
| `ChildPin`, PIN hashing and lockout | **Removed**: no profile picker means no PIN. The PostgreSQL lockout pattern is in git history (`5ed26189`) if mode A returns |
| `family_auth.py` | **Replaced** by `child_auth.py` (same rules: digests only, re-check on every use, ownership through the parent, fail-closed consent, CSRF HMAC) |
| Migration `0009_family_child_authentication` | **Replaced** by `0009_child_sign_in` (unmerged, branch only; history verified) |
| Settings | Kept: session max and idle. Removed: family device and PIN settings. Added: device remember, sign-in age, cookies, child pool, provider, consent version, throttles |
| 81 tests in `test_family_auth.py` | PIN, family device and mode A tests removed with their code. Session expiry, revocation, cross-family, constraints, logging and identity tests rewritten against the new model (`test_child_sign_in.py`, `test_child_session_routes.py`) |

Deferred mode A (the owner may request it again): parent-authenticated profile picker, PIN,
family device hand-off. No parent impersonation of a child exists. A restricted "parent preview"
of the child view is not built; OD-9 asks whether it is wanted.

## 10. ADR and policy reconciliation

| Source | Conflict | Resolution on this branch |
|---|---|---|
| ADR-022 "children never authenticate" | Direct | ADR-075 supersedes that sentence (proposed amendment note on ADR-022). `ParentAccount` stays the Django user model; a child is still not a Django user |
| ADR-019 (Cognito for authentication; G2, G7, G9, G10) | None in principle | A second pool is a new Cognito resource (G7 owner approval); G9 consent gates child sign-in |
| ADR-024 (Django validates bearer access tokens) | Extends | The child token is verified with the same checks, but only to open a session; the session cookie is a second non-bearer credential like ADR-036's |
| ADR-036 (game cookie for the Android WebView) | Compatible | Reuses its pattern (opt-in authenticator, CSRF header, SameSite=Strict); the game cookie is unchanged |
| ADR-040 (Cognito the sole authentication provider for application users) | Compatible | Children authenticate with Cognito (the child pool); Django still never verifies a password |
| ADR-043 (recent sign-in, Proposed) | Depends | The management matrix in section 6 uses it |
| `security-policy.md` section 5 "Child login: not decided, do not add" | Direct | Row rewritten to the owner's 2026-11-27 decision, with the child-pool and session rules; for owner review in the pull request |
| `architecture-rules.md` sections 6 and 6.1 | Direct | Row moved out of "Not decided"; `ChildProfile` row updated; for owner review in the pull request |

ADR numbering: 074 went to LAI 07 (#117); by owner instruction this decision uses the next free
number, 075, reserved through the registry pull request #118 (stacked on #117).

## 11. Agent coordination

| Agent | Needs |
|---|---|
| LAI 04 (engine, gameplay) | Confirm web gameplay works with the child session (API client child mode); review co-op routes before they join the allowlist |
| LAI 06 (scoring, progression) | Nothing changes in scoring; scoring reads are allowlisted read-only, resets are parent-only |
| LAI 07 (assets) | `assets/` resolve is allowlisted read-only for the own child; child photos stay parent-only until LAI 07 reviews private-asset access for children |
| LAI 05 (integration) | ADR reservation, migration `users/0009` (no collision), CDK stack is opt-in, eventual integration |
| LAI 01, 02, 03 (realms) | Validate their realm routes are on the allowlist once the contract is stable |

## 12. Owner decisions

| # | Decision | Recommendation |
|---|---|---|
| OD-1 | Merge the reservation #118 (after #117) and accept ADR-075 | Accept |
| OD-2 | Approve the consent text and set `LAI_CHILD_SIGN_IN_CONSENT_VERSION` (G9, LAI-0308) | Needed before any real child signs in |
| OD-3 | Create the child pool and Django policy in dev, then prod (G7) | Dev first, per action |
| OD-4 | Accept ADR-043 (recent sign-in) and ADR-036 (cookie pattern) | Accept |
| OD-5 | Recent sign-in for granting actions only; protective actions immediate | As in section 6 |
| OD-6 | Child password policy: 8 to 64 characters, no composition rules, not containing the login name | As listed |
| OD-7 | Login name rules: 4 to 20 of `a-z 0-9 . _ -`, not the nickname, unique, changeable | As listed |
| OD-8 | Lifetimes: session 12 h absolute, 2 h idle; remember me 30 days; sign-in freshness 5 min | As listed |
| OD-9 | Is a restricted parent preview of the child view wanted? (no impersonation either way) | Not now |
| OD-10 | Close R1 and R3: Cognito threat protection (paid) and/or a pre-token Lambda or server-side child sign-in | Decide with cost |
| OD-11 | Approve the `security-policy.md` and `architecture-rules.md` edits in the pull request | Approve with ADR-075 |
| OD-12 | Retire the arithmetic `ParentGate` (child mode no longer uses the parent's token) | Yes |
| OD-13 | Mode A (family login) stays deferred | Yes |
| OD-14 | May a child session read the child's own photo (`photo/content/` GET)? | Parent-only for now (LAI 07 agrees: personal data, no child feature needs it). If allowed later: GET of the own photo only, per-child scoping tests, private no-store caching, nothing logged |
| OD-15 | Co-op sessions for signed-in children | Off for now (401). LAI 04's proposed rule if allowed: creating stays parent-only; a child may read and act on a co-op session only while seated in it (views must check participation) |

## 13. Risks and known limitations

- **R1.** For the few minutes before the exchange, the child's own Cognito access token is in the
  page's memory. With it, Cognito's self-service API lets that user change their own password or
  delete their own pool user (the `aws.cognito.signin.user.admin` scope). Neither reaches parent
  privileges, a sibling or another family; deletion only locks the child out. OD-10.
- **R2.** Django throttles are per process until a shared cache exists.
- **R3.** Cognito's built-in lockout after failed passwords is the brute-force control; it is not
  tunable without threat protection (OD-10).
- **R4.** Local development has no child-pool SRP endpoint: provisioning uses the in-memory fake,
  and child sign-in is exercised by unit tests with locally signed tokens.
- **R5.** Pool follow-ups after a protective change are best effort; Django's refusal holds
  regardless, and removal retries via `provider_cleanup_pending`.
- **R6.** Production settings checks (fake provider refused, pool and client separation) are not
  covered by a unit test (settings modules are evaluated at import).
