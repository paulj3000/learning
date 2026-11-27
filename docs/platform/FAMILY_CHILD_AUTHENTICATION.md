# Family accounts and child authentication (LAI-AUTH-01)

- **Status:** Proposal for owner decision. Decision record: ADR-NNN in [DECISIONS.md](../DECISIONS.md)
  (number 074 requested; not reserved on `main` yet). Nothing here is accepted, deployed or
  live-verified.
- **Owner:** project owner
- **Last reviewed:** 2026-11-27
- **Trello:** parent #97 "[Subproject] Child Authentication & Family Accounts"; LAI-AUTH-01 to 10
  (#98 to #107)
- **Branch:** `feature/family-child-authentication` from `main` `d812ad71`
- **Related ADRs:** ADR-019 (gates G2, G7, G9, G10), ADR-022, ADR-024 (A1, A3, A6), ADR-036,
  ADR-039, ADR-040, ADR-043, ADR-053
- **Code (this branch, not wired to any route):** `lai/apps/users/models.py` (`FamilyDevice`,
  `ChildPin`, `ChildCredential`, `ChildPlaySession`), `lai/apps/users/family_auth.py`,
  migration `0009_family_child_authentication`, `lai/apps/users/tests/test_family_auth.py`

The goal is to support two ways a child gets into the island, and have both resolve to the
**same** `ChildProfile` and therefore the same progress:

- **Mode A, family login.** A parent signs in with Cognito, picks a child from a profile picker,
  and the child plays in a restricted session. An optional per-child PIN guards sibling switching.
- **Mode B, independent child login.** A parent creates a username and password for a child,
  who signs in on their own (for example on a second device). No child email or phone number.

## Summary of the recommendation

1. **One child principal for both modes: a Django `ChildPlaySession`**, carried by an opaque,
   HttpOnly, Secure, SameSite=Strict cookie and bound to exactly one child. It is accepted only
   by child gameplay routes that opt in (the ADR-036 allowlist pattern, generalized from "one
   child, one region" to "one child"). Parent routes never accept it.
2. **Mode A hands the device to the child.** Opening family play needs a recent parent sign-in
   (ADR-043) and creates a `FamilyDevice` credential; the React app then **removes the parent's
   Cognito tokens from the device**. The device credential can only list the family's children and
   open a child session. Any parent function needs a fresh Cognito sign-in.
3. **Mode B uses a separate Cognito user pool for children**, username-only, admin-created, with
   no self-sign-up. A child's verified access token is exchanged once for a `ChildPlaySession`.
   The parent pool is not changed.
4. **Django is the revocation authority.** Suspension, reset and revocation take effect in
   PostgreSQL first (`tokens_valid_after`, session revocation), so they never wait for a Cognito
   token to expire.
5. **Schema is additive.** Four new tables; no change to `ParentAccount`, `ChildProfile` or any
   progress table, so existing child ids and progress are preserved by construction.
6. **Consent fails closed.** Mode B cannot open a session until LAI-0308 (gate G9) records
   parental consent for it.

---

## 1. Existing authentication architecture audit

Audited at `main` `d812ad71` (2026-11-27).

| Area | What exists | Source |
|---|---|---|
| Identity provider | One Cognito user pool for parents, **email as username**, SRP from the browser, public SPA client, open email sign-up | ADR-024 evidence table; `react/src/lib/cognito/`, `SignUpForm.tsx` |
| Token storage | Access, ID and refresh tokens in `localStorage` (Amplify-compatible keys); refresh default 30 days (deployed value unverified, G1) | `react/src/lib/cognito/auth.ts`; ADR-024 A1 open |
| API credential | Cognito **access token** as `Authorization: Bearer`; RS256 via JWKS, `iss`, `exp`/`nbf`, `token_use=access`, `client_id` allow-list, known `kid`; 30 s leeway; fails closed | `lai/apps/users/authentication.py`, `jwks.py` (ADR-024, ADR-040) |
| Identity mapping | Verified `sub` maps to `ParentAccount.cognito_sub` (unique, immutable); unprovisioned users are a non-row principal | `models.py`, `authentication.py` |
| Children | `ChildProfile` owned by one parent (FK `PROTECT`), max three, **no login of any kind** (ADR-022: "Children never authenticate") | `models.py`, `services.py` |
| Authorization | Default permission `IsProvisionedParent`; child routes under `/api/v1/children/<uuid:child_id>/` use `ChildScopedMixin`, which resolves the child through `request.user`; another family's child is the same 404 as a missing one | `permissions.py`, `scoping.py` |
| Structural guards | Every route is public, parent-scoped or child-scoped; `ChildProfile.objects` only in `services.py`/`models.py`; no parent read from request data; cookie routes pinned | `apps/users/tests/test_tenant_isolation.py`, `apps/core/tests/test_api_conventions.py` |
| Child-scoped credential | **Android WebView only**: single-use 60 s launch ticket redeemed for `lai_game_session` cookie (HttpOnly, Secure, SameSite=Strict, `/api/v1/`, 60 min), **one child and one region**, CSRF header `X-LAI-Game-CSRF`, opt-in routes only | `apps/game_sessions/launch.py`, `runtime_auth.py` (ADR-036, **Proposed**) |
| Recent sign-in | `auth_time` within 300 s, per-session anchor, Cognito `GetUser` revocation check; guards child deletion | `recent_auth.py` (ADR-043, **Proposed**, live gate open) |
| Web child mode | `/island/:childId/...` routes run on the **parent's bearer token**. Leaving child mode uses `ParentGate`, an adult check that asks for the sum of two numbers from 2 to 8 | `react/src/app/AppRoutes.tsx`, `features/child-profile/ParentGate.tsx` |
| Parent dashboard child switch | `ChildSwitcher` changes which child the parent dashboard shows; not a sign-in | `features/child-profile/ChildSwitcher.tsx` |
| Sign-out | Local only (revokes this device's refresh token); no global sign-out | ADR-024 evidence |
| Rate limiting | DRF scope `game_launch` (30/min) only. No `CACHES` setting, so DRF throttles use per-process LocMem: they are per worker and reset on restart | `config/settings/base.py` |
| Consent | `ParentConsent` not implemented (LAI-0308, gate G9) | ADR-019, ADR-022 |
| Progress records | Every child-owned record extends `ChildOwnedModel` with a `child` FK to `ChildProfile` (CASCADE) | `apps/core/models.py` |

## 2. Security and privacy gap analysis

| # | Gap | Severity | Addressed by |
|---|---|---|---|
| S1 | **A child playing on the web holds the parent's full privileges.** Gameplay uses the parent's bearer token; the same token can change profiles, upload photos, toggle AI, start co-op, manage settings. Only child deletion needs recent sign-in. The arithmetic `ParentGate` is the only barrier, and many 5 to 8 year olds can pass it. | High | Child principal (section 5); mode A device hand-off |
| S2 | Parent refresh token (about 30 days) stays in `localStorage` on a shared family device. | High on shared devices | Mode A removes parent tokens on hand-off |
| S3 | No server-side notion of "which child is playing". Any child id the parent owns works on every request, so a sibling can play as another sibling. | Medium | Session bound to one child; optional PIN |
| S4 | Cognito access tokens cannot be revoked before expiry from Django's side (A6 open). | Medium | Django revocation line (`tokens_valid_after`, session revocation) |
| S5 | No durable rate limit: DRF throttles are per process. A PIN guarded only by them could be brute-forced across workers. | Medium | PIN lockout in PostgreSQL rows (implemented) |
| S6 | Child login is prohibited by the standards (`security-policy.md` section 5, `architecture-rules.md` section 6.1, ADR-022). The owner's LAI 08 brief asks for it. | Governance conflict | Reported; resolved only by owner acceptance of ADR-NNN, which then amends those documents |
| S7 | Consent design missing (G9). Mode B adds child-held credentials and child-initiated sessions without a parent present. | Blocking for mode B live use | Fail-closed consent check (implemented); LAI-0308 |
| S8 | Infrastructure logs carry child UUIDs in URL paths (G10). A child session does not change that. | Existing | Unchanged; noted |
| S9 | Recent sign-in (ADR-043) and the ADR-036 cookie are Proposed, not accepted. This design builds on both. | Dependency | Owner decision OD-4 |
| S10 | Parent pool allows open sign-up with email usernames. Children placed there would need emails and would share a client allow-list with parents. | Design constraint | Separate child pool (section 3) |
| P1 | A login name is new child personal data. | Privacy | Minimized: 4 to 20 chars, not the nickname, never logged, hidden in Django Admin, deleted with the credential |
| P2 | Avatars and photos on a profile picker are shown to whoever holds the device. | Privacy | Picker shows only the device parent's active children; photos via the existing signed-URL path (LAI 07 coordination) |
| P3 | Session expiry could be mistaken for a play-time limit (ADR-053 forbids those). | Product rule | Expiry is a security control; a family device reopens the session silently, with no countdown or message |

## 3. Cognito identity architecture: shared or separate pool

Mode A needs no new Cognito resource: it reuses the parent pool exactly as it is.

Mode B needs Cognito users for children. Two options:

| Criterion | A. Children in the existing parent pool | B. Separate child pool (recommended) |
|---|---|---|
| Username without email | **Not possible as configured.** The pool uses email as the username, and Cognito cannot change username attributes after a pool is created | Username-only pool, case-insensitive |
| Self-sign-up | Open in the parent pool; children would inherit it unless the whole pool changes | `AllowAdminCreateUserOnly`: only Django, on a parent's request, creates child users |
| Privilege separation | A child token has the same issuer and could carry an allowed `client_id`. Parent routes would have to exclude children **explicitly**. That is a default-allow failure mode: one missed check gives a child parent rights | Different issuer. Parent verification rejects child tokens by construction (`iss` mismatch), with no new check on parent routes |
| Password policy | One policy for adults and children | Child-appropriate policy (length over complexity), no MFA prompts a child cannot satisfy |
| User enumeration | Parent pool setting applies to both | `PreventUserExistenceErrors` on the child client |
| Recovery | Email reset flows built for adults | No self-service recovery; parent resets through Django |
| Blast radius | A misconfiguration affects parent sign-in, which is accepted and must not regress | Parent pool untouched (#97: "do not regress or reopen it") |
| Cost and operations | No new resource | One more pool, app client, JWKS issuer and IAM scope; Cognito charges per monthly active user in both cases |
| Owner approval | Changing the live parent pool: G2 and G7 | Creating a new pool and IAM policy: G7 (CDK code can be written without deploying) |

**Recommendation: B.** The username constraint alone rules out A without migrating every parent.
The privilege argument settles it: in B, a child token cannot reach a parent route even if a
parent route forgets a check.

Child pool shape (for LAI-AUTH-04, CDK code only until deployment is approved):

- Sign-in with username, case-insensitive; no email, phone or other required attributes; no
  standard attributes written.
- `AllowAdminCreateUserOnly`; no hosted UI, no OAuth flows, no identity pool, no federation.
- One public app client (SRP), no secret, `PreventUserExistenceErrors=ENABLED`, token revocation
  enabled, access token 60 minutes, short refresh token (owner decision OD-5; the client
  exchanges and then discards it).
- Django's IAM permissions limited to this pool's ARN: `AdminCreateUser`, `AdminSetUserPassword`,
  `AdminDisableUser`, `AdminEnableUser`, `AdminUserGlobalSignOut`, `AdminDeleteUser`. Nothing on
  the parent pool.
- Cognito username = the parent-chosen login name. With existence errors suppressed, a wrong
  username and a wrong password look identical to the child.

## 4. Django identity model and migration plan

New tables (implemented on this branch, migration `users/0009`):

| Model | Purpose | Key rules |
|---|---|---|
| `FamilyDevice` | Mode A device credential, owned by a parent | Only SHA-256 of the cookie value stored; `remembered` selects 30-day or 12-hour lifetime (settings, bounded); revocable; dies with the parent account; no device name, user agent or IP |
| `ChildPin` | Optional switching PIN per child | Django password hash; four ASCII digits; `failed_attempts` and `locked_until` in PostgreSQL under a row lock (5 tries, then 15 minutes, both bounded settings); a new PIN clears the lockout |
| `ChildCredential` | Mode B mapping: child pool issuer and `sub` to `ChildProfile` | One live credential per child; login name unique case-insensitively among live rows; `(issuer, subject)` unique; `ACTIVE` requires both; status `PROVISIONING`/`ACTIVE`/`SUSPENDED`/`REVOKED`; `tokens_valid_after` is Django's revocation line |
| `ChildPlaySession` | The child principal for both modes | Bound to one child and its parent; `source` must match exactly one of `family_device` or `credential` (check constraint); absolute (12 h) and idle (2 h) expiry; revocable; re-validated on every use |

Rules preserved:

- `ParentAccount` and `ChildProfile` keep their columns and constraints. Child ids do not change.
- Every progress, inventory, scoring and reward record keeps its `child` FK to `ChildProfile`. A
  session only names the child; it owns nothing. Both modes reach the same rows by construction
  (test `test_both_modes_reach_the_same_child_profile`).
- Children still have no Django login and no password in Django. Mode B passwords live only in
  Cognito.
- Deleting a child cascades its PIN, credential and sessions (test). The child deletion service
  (LAI-0602) must also delete the Cognito child user: follow-up in LAI-AUTH-05.

Migration:

| Step | What | Reversible |
|---|---|---|
| 1 | `users/0009`: create four empty tables with constraints and indexes. No data migration, no backfill, no change to existing rows | Yes: reverse migration drops empty tables |
| 2 | Routes and authenticators (LAI-AUTH-02/03), behind `LAI_FAMILY_LOGIN_ENABLED` (off by default) | Yes: flag off |
| 3 | Child pool CDK and verifier (LAI-AUTH-04), behind `LAI_CHILD_LOGIN_ENABLED` (off) and the consent gate | Yes: flag off; pool deletable while empty |
| 4 | React family entry; the bearer path keeps working during transition | Yes |
| 5 | After parity (LAI-AUTH-09) and owner QA: child routes stop accepting the parent bearer for gameplay writes | Owner decision; only after the web app no longer depends on it |

Existing profiles need nothing: a profile created before this change opens a family session
with no data change (test `test_existing_profiles_need_nothing_to_use_family_login`). Legacy
Amplify data import (ADR-039) is unaffected.

## 5. Child-scoped session design

```text
Mode A                                         Mode B
Parent: Cognito sign-in (parent pool)          Child: username + password (child pool, SRP)
  -> POST /family/devices/  [recent sign-in]     -> POST /child-auth/sessions/ (child bearer)
  -> device cookie; React clears parent tokens      Django: verify iss/aud/sig/exp, map
Device: GET /family/profiles/ (picker)                (issuer, sub) -> ChildCredential, status,
  -> POST /family/profiles/<id>/play/ {pin?}            tokens_valid_after, consent (G9)
           \                                      /  React discards the child's Cognito tokens
            `-> ChildPlaySession cookie (one child) <-'
                 -> opted-in gameplay routes under /api/v1/children/<that child>/...
```

Credential properties:

| Property | `FamilyDevice` cookie | `ChildPlaySession` cookie |
|---|---|---|
| Name and path | `lai_family_device`, `Path=/api/v1/family/` | `lai_child_session`, `Path=/api/v1/` |
| Flags | HttpOnly, Secure, SameSite=Strict, host-only | HttpOnly, Secure, SameSite=Strict, host-only |
| Value | 256-bit random; SHA-256 stored | 256-bit random; SHA-256 stored |
| Lifetime | 30 days remembered, 12 hours otherwise | 12 hours absolute, 2 hours idle |
| CSRF on writes | `X-LAI-Family-CSRF` (HMAC of the device) and `Origin` check | `X-LAI-Child-CSRF` (HMAC of the session, `session_csrf_token`) and `Origin` check, as ADR-036 |
| Can do | List the parent's active children; open a session for one; forget the device | Gameplay for its own child only |
| Never | Any parent route, any child data beyond the picker | Account, child management, photos upload, settings, AI toggle, co-op creation, credentials, PIN, consent, deletion, dashboard summaries, any other child |

Web topology: CloudFront sends `/api/*` to Django on the same origin (`infra/lib/frontendStack.ts`),
so SameSite=Strict, host-only cookies work for the React app, as ADR-036 already relies on for
the WebView.

Authorization (LAI-AUTH-03):

1. `ChildSessionAuthentication` is never a default authenticator. A view opts in with a
   `ChildSessionAccessMixin`, as `GameRuntimeAccessMixin` does today, and a structural test pins
   the full list of routes that accept it.
2. `ChildScopedMixin` learns one rule: for a child principal, the URL `child_id` must equal the
   session's child, otherwise the identical 404. The parent path is unchanged.
3. `request.user` stays the owning `ParentAccount` for model ownership, and `request.auth` is a
   `ChildSessionGrant`, so existing views keep working. `IsProvisionedParent` rejects a child
   grant, so every route that does not opt in stays parent-only. This is the deny-by-default
   property, and it holds without touching parent routes.
4. A child id in a body or query string is ignored, as today.
5. Every use re-checks: not revoked, not expired, not idle, parent active, child active and still
   the parent's, device live (mode A), credential active and not reset since the session began
   (mode B). Implemented in `family_auth.session_for_value`.

Sibling switching, logout and recovery:

- **Switch player:** `POST /child-session/end/`, back to the picker; another child (PIN if set).
  Opening a session on a device ends that device's previous session (implemented), so the
  previous child's cookie is dead even if kept.
- **Logout (child):** ends the child session; the device stays for the family.
- **Forget this device:** ends the device and every session opened from it.
- **Grown-ups:** a normal Cognito sign-in. The arithmetic `ParentGate` is no longer the way out
  of child mode (owner decision OD-12).
- **Parent dashboard:** sign out every family device; end a child's sessions on all devices.
- **Expiry during play:** on a family device the React client reopens the session for the same
  child (no PIN prompt for the same child within the device's life). The child never sees a
  countdown or a "time is up" message (ADR-053).

Rate limits (all counted in PostgreSQL rather than a per-process cache): PIN lockout per child
(implemented); device creation and mode B exchange limits per parent and per credential, in
LAI-AUTH-03/04. Cognito applies its own sign-in throttling to the child pool.

## 6. API and frontend changes

API (none of these exist yet; each needs the LAI-0403 eight-test checklist):

| Route | Credential | Guard |
|---|---|---|
| `POST /api/v1/family/devices/` `{remembered}` | Parent bearer | Recent sign-in; sets device cookie |
| `GET /api/v1/family/devices/`, `DELETE .../<id>/`, `POST .../revoke-all/` | Parent bearer | Own devices only |
| `GET /api/v1/family/profiles/` | Device cookie | Ids, nickname, avatar key, photo flag, `pinRequired` |
| `POST /api/v1/family/profiles/<uuid>/play/` `{pin?}` | Device cookie and CSRF | PIN lockout; sets child session cookie |
| `POST /api/v1/family/device/forget/` | Device cookie and CSRF | Ends device |
| `GET /api/v1/child-session/` | Child session | Returns child id, CSRF value, source |
| `POST /api/v1/child-session/end/` | Child session and CSRF | |
| `PUT`, `DELETE /api/v1/children/<uuid>/pin/` | Parent bearer | Recent sign-in |
| `POST /api/v1/children/<uuid>/sessions/revoke/` | Parent bearer | |
| `GET`, `POST`, `PATCH`, `DELETE /api/v1/children/<uuid>/credential/` | Parent bearer | Recent sign-in for changes; create, reset password, suspend, resume, revoke |
| `POST /api/v1/child-credentials/name-check/` | Parent bearer | Throttled; availability only |
| `POST /api/v1/child-auth/sessions/` | Child-pool bearer | Verifies child issuer; consent; sets child session cookie |
| Gameplay routes under `/api/v1/children/<uuid>/...` | Parent bearer **or** child session (opt-in) | The child session reaches only its own child |

The opt-in gameplay set starts as the routes the game cookie already accepts (pinned in
`test_the_game_cookie_is_accepted_only_by_the_game_runtime_routes`) plus the child-facing reads
the web island needs (home, discovery, quests, inventory read, adventure log, avatars, audio,
speech, companion turns). Owners of those routes confirm the list: LAI 01 to 04 and LAI 06.

Frontend (React, existing components and tokens):

| Screen | Notes |
|---|---|
| Entry: "Grown-up sign in" and "I have my own login" | Large targets, readable aloud |
| Family profile picker (`/family`) | `ChildAvatar` tiles; only the device parent's children; "Grown-ups" leads to Cognito sign-in |
| PIN pad | Large digit buttons, four dots, no hint of the PIN; after a lockout: "Ask a grown-up to help." Never "try again in N minutes" |
| Child sign-in (`/child-sign-in`) | Username and password, show-password toggle, one non-enumerating error: "That name and password did not match. Ask a grown-up for help." |
| Parent: "Play on this device" | Recent sign-in dialog (existing `recentSignIn`), "Remember this device" checkbox, then hand-off |
| Parent: child sign-in settings (`/home/children/:id/sign-in`) | Enable independent login, choose login name (availability check), set or reset password, suspend, resume, remove; set or clear PIN |
| Parent: devices (`/home/settings`) | List devices (created, last used, remembered), forget one, forget all |

Client changes: an API client mode that sends cookies with `credentials: 'same-origin'` and the
child CSRF header and **never** attaches a bearer token in child mode; a `ChildSessionContext`;
a route guard for `/island/:childId/*` that accepts a child session for that child (the parent
path stays during transition); after hand-off, Cognito tokens are cleared (local sign-out).
The URL shape `/island/:childId/...` is unchanged, so gameplay code (LAI 01 to 04) is untouched.

## 7. Existing Trello ticket reconciliation

All ten cards are in Backlog with one-paragraph scopes and no ticket block. They cover the
work; **no new card is needed**. Adjustments recommended for the owner:

| Card | Fit with this design | Recommended change |
|---|---|---|
| #97 Subproject | Matches | Add dependency on LAI-0308 (G9) for mode B go-live, and on ADR-043/ADR-036 acceptance |
| #98 AUTH-01 Architecture and migration | This branch | Acceptance: ADR-NNN accepted and the additive migration |
| #99 AUTH-02 Family login and avatar selection | Device APIs and picker | Include retiring `ParentGate` as the child-mode exit (OD-12) |
| #100 AUTH-03 Child-scoped sessions | Child principal, authenticator, route allowlist | **Do before AUTH-02's UI**: the picker needs the session |
| #101 AUTH-04 Independent Cognito login | Child pool (CDK, no deploy), verifier, exchange | Blocked for live use on G9 and pool creation approval (G7) |
| #102 AUTH-05 Credentials and recovery | Django-side state done here; Cognito admin calls with a fake | Add: delete the child pool user on child deletion (LAI-0602) |
| #103 AUTH-06 Remembered device, PIN, switching | PIN and device rules done here | Routes and UI only |
| #104 AUTH-07 Parental controls | Device, session and credential management | Remove "purchase/chat restrictions": no purchases or chat exist (CLAUDE.md section 12). Consent/legal item belongs to LAI-0308 |
| #105 AUTH-08 Child login UI | As section 6 | None |
| #106 AUTH-09 Progress parity | Same child id by construction; audit shared-device caches | None |
| #107 AUTH-10 Security QA | As written | None |

## 8. Dependency-ordered development plan

```text
AUTH-01  ADR + additive schema + domain rules + tests        (this branch)
   |
   +-- owner: accept ADR-NNN, reserve 074, OD-1..OD-13
   |
AUTH-03  child principal: authenticator, mixin, ChildScopedMixin rule, route allowlist test
   |        (coordinate the opt-in route list with LAI 01-04, LAI 06; LAI 05 integration)
   |
AUTH-02  device APIs + React picker + hand-off      AUTH-06  PIN APIs/pad, remembered device, switch
   \______________________________________________________/
                     |
AUTH-07 (part)  parent device/session management UI
                     |
AUTH-04  child pool CDK (no deploy) + verifier + exchange   [live use blocked: G7 pool, G9 consent]
   |
AUTH-05  credential management with a faked Cognito admin client
   |
AUTH-08  child sign-in UI and recovery copy
   |
AUTH-09  parity audit across realms and caches  ->  AUTH-10 security QA (merge readiness)
```

Mode A (AUTH-01, 03, 02, 06, part of 07) does not depend on any new AWS resource and can reach
owner QA on its own. Mode B waits for G9.

## 9. Required owner decisions

| # | Decision | Recommendation |
|---|---|---|
| OD-1 | Accept ADR-NNN and reserve number 074 for it on `main` | Accept |
| OD-2 | Child pool: separate or shared | Separate (section 3) |
| OD-3 | Mode A hand-off: clear parent tokens from the device when family play starts | Yes |
| OD-4 | Accept ADR-036 (Proposed) and ADR-043 (Proposed), which this design builds on; allow a second cookie credential under ADR-024 item 2 | Accept |
| OD-5 | Lifetimes: device 30 days or 12 hours; child session 12 hours absolute, 2 hours idle; child pool refresh token as short as Cognito allows | As listed (bounded settings) |
| OD-6 | PIN policy: optional, four digits, five tries then 15 minutes, parent reset | As listed |
| OD-7 | Login name rules: 4 to 20 of `a-z 0-9 . _ -`, not the nickname, globally unique, it is the Cognito username | As listed |
| OD-8 | Mode B recovery: parent sets a new permanent password (no temporary password a young child must replace) | Yes |
| OD-9 | Consent (G9): what LAI-0308 must record before mode B is live | Consent per child for independent login, recorded by the parent with recent sign-in |
| OD-10 | Live AWS: create the child pool and the Django IAM policy for it | Later, per action |
| OD-11 | Amend `security-policy.md` section 5, `architecture-rules.md` section 6.1 and ADR-022 ("children never authenticate") once ADR-NNN is accepted | Yes, in the same branch after acceptance |
| OD-12 | Retire the arithmetic `ParentGate` as the exit from child mode | Yes; a Cognito sign-in replaces it |
| OD-13 | Move AUTH-02, 03 and 06 to Ready for Development after OD-1 to OD-6 | Yes |

## 10. Safe development that can proceed now

Done on this branch (inert: no route, authenticator or setting reads them outside the module):

- Additive models and migration `users/0009` (create-only, verified by test).
- `apps.users.family_auth`: PIN hashing and PostgreSQL lockout; device and session lifecycle;
  every-use re-validation; sibling-switch revocation; credential suspend, resume, revoke and
  reset with `tokens_valid_after`; login-name validation; fail-closed consent gate.
- Bounded settings in `config/settings/base.py`.
- 81 unit tests on PostgreSQL 18 (`apps/users/tests/test_family_auth.py`).

Can proceed without further approval (still unwired):

- A fake Cognito admin client interface for AUTH-05, mirroring `recent_auth`'s injectable client.
- A second-issuer verifier in a new module, with locally generated keys, not registered as an
  authenticator.
- React pure validators and copy (PIN shape, login name), with Vitest.

Must wait for owner decisions: any route, authenticator, `ChildScopedMixin` change, React flow,
CDK child pool, live Cognito call, or edit to the standards documents named in OD-11.
