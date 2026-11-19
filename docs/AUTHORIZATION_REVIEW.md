# Authorization Review

This is a source-level review of the application's authorization rules on the Django + DRF
backend (`lai/`) and of the React client code that relies on them, checked against
`docs/TESTING_STRATEGY.md`'s backend invariants and `CLAUDE.md` section 10. It was written by
reading the code and its tests. Where a rule still needs a live Cognito pool and a deployed
Django to verify, that is called out explicitly below rather than claimed as done.

Architecture references: `docs/ARCHITECTURE.md` "Authentication architecture", "Cognito-only API
authentication", "Profile authority" and "Tenant isolation".

## 0. Multi-client data classification (Phase 39)

`docs/android/android.md` Phase 12 asks every model to be classified against
`PUBLIC | AUTHENTICATED | OWNER | PARENT | CHILD | ADMIN | SYSTEM` so no privileged mutation
depends merely on being authenticated, ahead of a second client that could call these same APIs.

**One classification the taxonomy assumes does not apply here.** android.md treats `CHILD` as a
distinct authenticated actor. This product has no such actor: ADR-001 means a child never
authenticates. Every read and write happens inside the signed-in parent's own session
(CLAUDE.md section 10). Every row that might read "PARENT + CHILD" in a generic mobile-game
taxonomy is `OWNER` here; `CHILD` never appears as an independent grant, and should not until a
decision changes ADR-001 itself. (The native game WebView's ticket cookie, ADR-036, is a narrow
grant for one child and one region, not a child identity.)

| Resource | Classification | Rule |
|---|---|---|
| `users.ParentAccount` | OWNER | `request.user`, resolved from the verified Cognito access token's `sub` (`CognitoJWTAuthentication`); `IsProvisionedParent` is the API-wide default permission |
| `users.ChildProfile` | OWNER, ADMIN (read-only metadata) | reached only through the authenticated parent (`apps/users/scoping.py`); Django Admin shows profile metadata read-only and audited (ADR-039) |
| Child-owned progress (`game_sessions`, `education`, `progression`, `inventory`, `quests`) | OWNER | every model extends `core.ChildOwnedModel` and is read and written only through `ChildScopedMixin.scoped` / `get_scoped_object`; Django Admin registers none of them |
| `ai.AIInteractionAudit`, `ai.SafetyEvent` | OWNER (parent history and clearing), SYSTEM (write) | written only by `apps/ai/services/auditing.py`; no browser writes |
| `CoopSession`, `CoopParticipant` | OWNER (host parent), SYSTEM (slot claims) | section 1a |
| Companion and tutor turns | OWNER | child-scoped routes (`ChildScopedAPIView`); the server reads the child's age band and AI switch itself (section 4.2) |
| Adventure answers | OWNER, SYSTEM (grading) | section 1b |
| Catalog, assets, sound, NPC releases (authoring) | ADMIN | Django Admin with Django permissions and groups (ADR-034, ADR-045); no React staff asset manager and no administrator asset API |
| Published assets (read) | OWNER | the read-only, child-scoped resolver (ADR-035, ADR-045) |
| Asset file and speech clip delivery | SYSTEM (signed token) | short-lived signed tokens minted by the child-scoped routes authorize these two file routes; no bearer token is read (`apps/assets/views.py` `AssetFileView`, `apps/speech/views.py`) |

**No model is `PUBLIC`.** Every data route requires a verified Cognito access token, except the
health checks, the two signed-token file routes above, and the game runtime's ticket-redeemed
cookie routes (ADR-036), which are pinned by a structural test in
`apps/users/tests/test_tenant_isolation.py`.

**Acceptance criteria check:**

- *"No privileged mutation depends merely on being authenticated."* True: every child-scoped
  route resolves the child through the authenticated parent, and grading, rewards and progress
  are computed by Django services, never accepted from the client.
- *"Parent-child ownership is enforced server-side."* True for who can read and write
  (`ChildScopedMixin`, tested in `test_tenant_isolation.py`). Whether a written value is true is
  a separate question, answered per engine by server-side rules (ADR-012; section 5).

## 1. Model-by-model rules

One parent is the ownership boundary (no households, no sharing). `ChildScopedMixin` (and
`ChildScopedAPIView`) resolves `self.child` from `<uuid:child_id>` through the authenticated
parent, so the order of answers is 401, then 403 (`account_not_provisioned`), then 404. A foreign
child and an unknown child take the same code path and give the same `not_found` response.
A nested id from the URL is never looked up alone. This is correct for the product's
authorization boundary (CLAUDE.md section 10: "A parent may access only their own child profiles
and associated records") because a child never authenticates directly (ADR-001), so no second
identity legitimately needs access to a parent's rows.

The AI routes are child-scoped like every other child route. They persist only `ai_*` audit and
safety rows and send the model a minimized context (`docs/AI_AND_CHILD_SAFETY.md`), never a child
id or nickname.

## 1a. Co-op sessions (Phase 17, ADR-006)

Household only: the host parent owns both children, and nobody else can see the session. Slot
claims run in `lai/apps/game_sessions/coop.py`, which locks the session row
(`select_for_update`), so two near-simultaneous claims are serialised and exactly one wins. A
second claim by the same child changes nothing; only an ACTIVE session accepts claims. Nothing a
child types crosses to the other child: the shared state holds step ids and child ids only.
Tests: `lai/apps/game_sessions/tests/test_coop_api.py`.

## 1b. Authoritative adventure answers (Phase 37, LAI-0601, ADR-012)

Django grades every answer (`docs/ARCHITECTURE.md` "Authoritative adventure answers"). The client
sends the step and its answer; the server checks that the session belongs to the child and that
the step is the session's current step, escalates hints only from the level it recorded
(`AdventureSession.hint_levels`), deduplicates retries by request id, and records evidence from
its own grade. A client-claimed grade is ignored.

## 2. Client-side query safety

React reaches data only through the typed Django clients (`react/src/api/` and feature `api.ts`
modules). Any client-side filtering narrows which of the caller's own records are relevant; it is
never relied upon to separate one family's data from another's. That separation is the server's
`ChildScopedMixin`.

## 3. Route guard review (`react/src/features/auth/RequireParent.tsx`)

Parent and child routes are wrapped in `RequireParent`, which blocks rendering until the Cognito
session is confirmed and redirects to `/sign-in` otherwise. This is a UX-layer convenience, not
the authorization boundary: the boundary is Django's authentication and child scoping, so a
missing guard could not expose another family's data, only a confusing UI state. `RequireAdmin`
gates the React admin section the same way and shows the ordinary `NotFound` page to
non-admins; the backend refuses admin reads and writes independently.

## 4. Known gaps, re-verified

### 4.1. `MAX_CHILD_PROFILES` (3): enforced server-side (closed)

`lai/apps/users/services.py` locks the parent row and refuses a fourth profile with
`409 child_profile_limit_reached` (`MAX_CHILD_PROFILES` in `lai/apps/users/models.py`, mirrored by
`react/src/features/child-profile/constants.ts` for the UI). Test:
`lai/apps/users/tests/test_children_api.py`.

### 4.2. `ChildProfile.ai_enabled`: enforced server-side (closed)

The AI pipeline reads the child's `ai_enabled` switch itself (`lai/apps/ai/services/pipeline.py`,
step 1 in `docs/AI_SERVICE.md` section 3): when it is off, the route returns authored content with
no model call, whatever the client sends.

### 4.3. Administrator role: directory built; safety-review workflow still not

Administration is Django Admin (LAI-0404, ADR-034), with its own staff sign-in and Django
permissions and groups. There is no self-serve way to become an administrator (CLAUDE.md
section 10). `ParentRecord` and `ChildProfile` are read-only for staff with
`users.view_childprofile`, without nicknames, interests or identity mappings, and each view is
logged to `lai.admin_audit`. Child-owned progress models are not registered until an audited
cross-family read path exists (ADR-024 A4).

**Still not built:** CLAUDE.md section 2's "reviews flagged AI interactions and generation
failures". The pilot's safety-event review process (`docs/PRIVACY_AND_SAFETY_REVIEW.md`) still
relies on direct, credentialed database access for that half, not an in-product admin surface.

## 5. Invariants still unverified against a live deployment

The Django test suite exercises these against PostgreSQL with test tokens. None has been
exercised against the real Cognito pool and a deployed Django.

| Invariant | Structural and test result | Still needs |
|---|---|---|
| Owner isolation between parent accounts | `ChildScopedMixin`; `test_tenant_isolation.py` | Live test with two real parent accounts |
| Administrator boundaries | Django Admin only; child-owned models unregistered | Live check of a staff account and a non-staff parent |
| Child profile CRUD authorization | Parent-scoped views (`apps/users/views.py`); deletion needs a recent sign-in (ADR-043) | Live test: a second parent gets 404 for the first parent's child |
| Asset management is staff-only | Django Admin owns asset authoring (ADR-045); the only asset API is the child-scoped read resolver | Live check |
| Adventure start/action/complete invariants | Django step runner and server grading (section 1b) | Authenticated browser pass |
| Prevention of direct progress or world-change forgery | Progress, rewards and world changes are written by Django services from server-graded evidence; the remaining client-authored paths are tracked in ADR-012 and ADR-044 (`CLIENT_AUTHORED` AI context) | Live test per engine |

## 6. Summary

Authorization is enforced by Django: Cognito access tokens verified against the pool JWKS,
`IsProvisionedParent` by default, child scoping through the authenticated parent, server-side
grading, and Django Admin for staff. The two earlier documented gaps (the child-profile cap and
the AI switch) are closed server-side. Live verification against the real pool and a deployed
Django remains open.
