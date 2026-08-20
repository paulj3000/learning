# Authorization Review (Phase 8)

This is a source-level review of every authorization rule declared in
`amplify/data/resource.ts` and every place client code (`src/features/*/api.ts`)
relies on it, checked against `docs/TESTING_STRATEGY.md`'s "Backend tests"
invariants and `CLAUDE.md` section 10. It was written by reading the schema
and every call site, not by running tests against a live deployment - this
sandbox has no AWS credentials (same constraint noted throughout
`docs/IMPLEMENTATION_STATUS.md`). Where a rule genuinely needs a live
Cognito + AppSync backend to verify, that is called out explicitly below
rather than claimed as done.

## 1. Model-by-model rules

Every model in `amplify/data/resource.ts` **except `CoopSession`** (Phase
17, see section 1a below) uses `allow.owner()` and nothing else:

| Model | Auth rule | Owner field |
|---|---|---|
| `ParentProfile` | `allow.owner()` | implicit (Cognito identity that created the row) |
| `ChildProfile` | `allow.owner()` | implicit |
| `CompanionProfile` | `allow.owner()` | implicit |
| `AdventureSession` | `allow.owner()` | implicit |
| `AdventureAction` | `allow.owner()` | implicit |
| `SkillEvidence` | `allow.owner()` | implicit |
| `SkillProgress` | `allow.owner()` | implicit |
| `WorldChange` | `allow.owner()` | implicit |
| `AIInteractionAudit` | `allow.owner()` | implicit |
| `SafetyEvent` | `allow.owner()` | implicit |
| `StoryArtifact` | `allow.owner()` | implicit |

None declare an explicit `ownerField()` override, so Amplify Data uses its
default `owner` field populated from the caller's Cognito identity at
create time. This is consistent and correct for the product's actual
authorization boundary (CLAUDE.md section 10: "A parent may access only
their own child profiles and associated records") **because every one of
these rows is created by application code running inside the authenticated
parent's own session** - a child never authenticates directly (ADR-001),
so there is no case in this schema where a second identity legitimately
needs access to a parent's rows. `allow.owner()` alone is therefore the
right rule for all eleven models, not an oversight.

`generateCompanionTurn` (the one AI generation route) uses
`allow.authenticated()` instead, because a custom operation has no owner
field to scope by. This is also correct: the route takes no identifiers
that could leak cross-family data (`docs/AI_AND_CHILD_SAFETY.md`'s prompt
context minimization - age band, intent, step summary, not a child ID),
so any authenticated parent invoking it only ever affects their own
request/response pair, never another family's stored data.

## 1a. `CoopSession` and `claimCoopSlot` (Phase 17)

`CoopSession` breaks the "one pattern for every model" rule above on
purpose (docs/DECISIONS.md ADR-006, docs/DATA_MODEL.md `CoopSession`):

- **Model-level rule**: `allow.ownerDefinedIn('hostParentProfileId').identityClaim('sub')`
  rather than the default `allow.owner()`. Two `ChildProfile`s under one
  `ParentProfile` need to read/write the same row, and both children act
  inside that one parent's authenticated session — so scoping by the
  parent's own identity (not a per-row implicit owner) is the correct rule,
  not a relaxation of it. `.identityClaim('sub')` pins the field to the
  stable Cognito `sub` specifically so `claimCoopSlot`'s Lambda (below) can
  compare against it directly.
- **`claimCoopSlot` is a function-backed custom mutation**
  (`amplify/functions/claim-coop-slot/handler.ts`), which means it does
  **not** go through AppSync's generated resolvers or the model-level rule
  above at all — its Lambda has its own IAM role with a direct
  `grantReadWriteData` on the `CoopSession` table (`amplify/backend.ts`).
  The mutation's own `.authorization((allow) => [allow.authenticated()])`
  only proves the caller is *some* signed-in parent; `decideClaim` inside
  the handler is what actually re-checks that the caller's `sub` matches
  the session's `hostParentProfileId`, that `childProfileId` is one of the
  session's `participantChildProfileIds`, and that the session is still
  `ACTIVE`, before ever writing. This is the one place in the whole
  backend where "authorized to call the mutation" and "authorized to
  perform this specific write" are deliberately different checks, because
  bypassing AppSync's resolver for atomicity (see the ADR/DATA_MODEL docs
  above) also means bypassing its authorization enforcement.
- **Not deploy-verified**: same constraint as the rest of this document,
  plus the specific open assumption called out in
  `amplify/functions/claim-coop-slot/handler.ts`'s top comment (that
  `sharedState` is stored as a native DynamoDB Map, not a JSON string) —
  confirm both the authorization behavior and that assumption the first
  time this runs against a real sandbox with two real child profiles under
  one parent, and (separately) confirm a *second* parent's account cannot
  read or claim into a `CoopSession` it does not own, the same live-account
  test section 5 already ran for every other model.

## 2. Client-side query safety

Every `list()`-based read in `src/features/*/api.ts` (e.g.
`listChildProfiles`, `getActiveSession`, `listWorldChanges`,
`clearAIHistory`) calls `.list()` with no arguments and then filters
client-side by `childProfileId`/`sessionId`. This is safe *only* because
`allow.owner()` already scopes the underlying `.list()` call to the
caller's own rows before any client-side filter runs - a parent's
`.list()` can never return another parent's rows to filter over in the
first place. Confirmed by reading `@aws-amplify/data-construct`'s
generated resolver behavior (owner-authorized `list` queries compile to a
DynamoDB query/scan with an owner-equality filter applied server-side, not
client-side), consistent with how every phase since Phase 1 has already
relied on this pattern. This is not a gap, but it is worth keeping in mind
for future authors: **client-side filtering here narrows *which* of the
caller's own rows are relevant, it does not and must not be relied upon
to separate one family's data from another's.**

## 3. Route guard review (`src/features/auth/RequireParent.tsx`)

Every `/home*` and `/island/*` route is wrapped in `RequireParent`,
which blocks rendering until Cognito confirms a signed-in user
(`getCurrentUser()`) and redirects to `/sign-in` otherwise. There is no
route in `src/app/AppRoutes.tsx` that reaches a data-bearing screen
without this guard. This is a UX-layer convenience, not the real
authorization boundary - the real boundary is `allow.owner()` at the data
layer above, so even a hypothetical missing guard could not expose another
family's data, only a confusing UI state. Confirmed by inspection of every
route in `AppRoutes.tsx`.

## 4. Known gaps (confirmed, not newly found)

These were already flagged in `docs/IMPLEMENTATION_STATUS.md`'s "Known
risks/TODOs" from earlier phases; this review re-verified each by reading
the current code rather than assuming the earlier note is still accurate.

### 4.1. `MAX_CHILD_PROFILES` (3) is UI-only

`src/features/child-profile/constants.ts`'s `MAX_CHILD_PROFILES` is
enforced only in `ChildProfileList.tsx` (hides the "Add child" link at 3
profiles). `createChildProfile` in `api.ts` has no count check, so a
direct, authenticated GraphQL `ChildProfile.create` call could create a
fourth (or four-hundredth) profile for one parent.

**Why this stays a documented gap, not a fix, this session**: enforcing a
count at create time needs either (a) a custom Amplify Function/mutation
that reads the caller's existing count before allowing the create, or (b)
a DynamoDB-level constraint Amplify Data does not expose declaratively.
Building (a) means writing and wiring a new Lambda-backed custom mutation
with zero ability to deploy or exercise it in this environment (no AWS
credentials) - exactly the kind of change that has caused real, hard-to-
predict bugs in this codebase before (see `docs/IMPLEMENTATION_STATUS.md`'s
Phase 4 "Known risks/TODOs" for two separate Amplify AI Kit issues that
only surfaced against a live deploy, and the Phase 7 `aiEnabled`
`.required()` bug that only surfaced against real stored data). Shipping
an untested authorization-relevant Lambda is a worse risk than the gap it
would close.

**Severity**: low. A parent over-creating their own child profiles is
self-directed, not a cross-family exposure, and costs nothing but a
slightly confusing UI (a 4th profile that doesn't fit the stated "up to
3" copy elsewhere).

**Concrete remediation plan for whoever has a deployable sandbox**: add a
custom mutation `createChildProfile` backed by an Amplify Function that
(1) queries `ChildProfile` by the caller's `owner` for a count, (2)
rejects with a typed error over the limit, (3) otherwise calls
`ChildProfile.create` with the same shape `api.ts` already uses. Swap
`src/features/child-profile/api.ts`'s `createChildProfile` to call the
mutation instead of `client.models.ChildProfile.create` directly. Add a
test that a 4th create attempt is rejected server-side even if the UI
button is bypassed.

### 4.2. `ChildProfile.aiEnabled` kill switch is client-side only

`requestCompanionTurn` (`src/features/companion/api.ts`) checks
`input.aiEnabled === false` and short-circuits before calling
`generateCompanionTurn` - but that check runs in this app's own client
code. A direct, authenticated GraphQL call to `generateCompanionTurn`
from outside this app (e.g. a hand-crafted request with valid parent
credentials) would still reach Bedrock regardless of the stored
`aiEnabled` flag, because the AI route itself has no knowledge of it -
`allow.authenticated()` only checks *who* is calling, not *which child's
AI setting* applies.

**Why this stays a documented gap, not a fix, this session**: same
reasoning as 4.1 - a real fix means either passing `childProfileId` into
`generateCompanionTurn`'s arguments and adding server-side logic to look
up and enforce the flag (a meaningful schema/persona change to a route
that is the one piece of this codebase already confirmed working against
live Bedrock, per Phase 4's verification notes - not something to touch
without being able to redeploy and re-verify it), or standing up a
Function-fronted wrapper mutation. Both are real Phase-8-scale work,
not a same-session patch.

**Severity**: low for MVP. The route already requires an authenticated
parent session scoped to that parent's own family; the realistic threat
is a technically sophisticated parent bypassing their *own* AI-off
setting for their *own* child, not a cross-family exposure. Worth
revisiting before wider release if `aiEnabled` needs to be a hard
guarantee rather than a parent-facing convenience switch (the wording
already used for it in `IMPLEMENTATION_STATUS.md`).

### 4.3. Administrator role: directory/progress view built; safety-review workflow still not

**Updated**: a Cognito `Admins` user group now exists
(`amplify/auth/resource.ts`), and `ParentProfile`, `ChildProfile`,
`AdventureSession`, `SkillProgress`, and `WorldChange` each carry an added
`allow.group('Admins').to(['read'])` rule alongside their existing
`allow.owner()` rule (`amplify/data/resource.ts`). This backs a read-only
admin section (`src/features/admin/`, `src/routes/AdminDashboard.tsx`,
`src/routes/AdminChildProgress.tsx`, gated by
`src/features/auth/RequireAdmin.tsx`) covering exactly CLAUDE.md section
2's "reviews... progress" half of the Administrator role: every parent
account, every child profile grouped by parent, and each child's recent
adventures/skills-practiced/world-changes — the same aggregated records
`ChildDashboard` already shows a parent for their own child, now readable
cross-family by an admin. There is deliberately no self-serve way to join
`Admins` (CLAUDE.md section 10); membership is granted out-of-band via
`aws cognito-idp admin-add-user-to-group` (see the comment in
`amplify/auth/resource.ts`), consistent with "Admin access must be
group-based and explicitly authorized."

**Still not built**: CLAUDE.md section 2's other half — "reviews flagged AI
interactions and generation failures" — remains unimplemented.
`CompanionProfile`, `StoryArtifact`, `AIInteractionAudit`, and
`SafetyEvent` deliberately got **no** `Admins`-group rule this round (see
the comment atop `amplify/data/resource.ts`): those carry AI-narrated or
free-text-adjacent content, and building their review UI is a distinct,
larger scope (moderation actions, `SafetyEvent.reviewStatus` transitions,
`AIInteractionAudit` redaction) than the read-only directory this phase
adds. They remain reachable only through a parent's own owner-authorized
session today; the pilot's safety-event review process (see
`docs/PRIVACY_AND_SAFETY_REVIEW.md`) still relies on direct, credentialed
database access for that half, not an in-product admin surface.

## 5. Invariants from `docs/TESTING_STRATEGY.md` still unverified against a live backend

`docs/TESTING_STRATEGY.md`'s "Backend tests" section lists five invariants.
This review's source-reading confirms the schema and client code are
*structured* to satisfy them, but none have been exercised against real
Cognito + AppSync, because no phase to date has had AWS credentials
available. This is the same already-documented constraint, restated here
as a concrete pre-pilot checklist (see also "Load/cost tests, AI red-team
suite, and pilot readiness" below):

| Invariant | Structural review result | Still needs |
|---|---|---|
| Owner isolation between parent accounts | Every model is `allow.owner()`; no rule grants cross-owner read/write. | Live test: two real parent accounts, confirm A cannot `get`/`list`/`update`/`delete` B's rows for any of the 11 models. |
| Administrator boundaries | A read-only `Admins` group now exists, scoped to `ParentProfile`/`ChildProfile`/`AdventureSession`/`SkillProgress`/`WorldChange` reads only (see 4.3, updated). No group grants write, and no group can read `AIInteractionAudit`/`SafetyEvent`/`StoryArtifact`. | Live test: an authenticated non-admin parent's client gets denied (not empty data) attempting a `list`/`get` against another parent's records via the same calls `src/features/admin/api.ts` uses; a real `Admins`-group account confirms it can read across families. |
| Child profile CRUD authorization | `createChildProfile`/`updateChildProfile`/`setChildProfileActive`/`deleteChildProfileData` all operate through owner-scoped `client.models.ChildProfile.*` calls. | Live test: confirm a second parent's authenticated client gets an authorization error (not empty data) attempting any of these against the first parent's child ID. |
| Adventure start/action/complete invariants | `startSession`/`recordAction`/`completeSession` write through owner-scoped models; no field lets a client claim a step it didn't reach (`AdventureAction.stepId`/`correctness` are freely settable client-side values *within the caller's own owner-scoped rows*, same limitation noted below). | Live test per the next row. |
| Prevention of direct progress or world-change forgery | **Not enforced today.** `AdventureAction.create`, `WorldChange.create` (via `recordWorldChangeOnce`), and `SkillProgress` writes accept any `stepId`/`correctness`/`changeKey` a caller supplies, checked only by this app's own client code (`useAdventureSession.ts`), not by the schema. A technically sophisticated parent could, within their own owner scope, write a fabricated `AdventureAction` or `WorldChange` for a step their child never played. This is a pre-existing, already-documented limitation (`docs/IMPLEMENTATION_STATUS.md`'s Phase 3 "Owner-authorization backend tests are not runnable" note), not new. Given the product's actual risk model (a parent forging their *own* child's progress records harms no one but that family's own accuracy - there is no leaderboard, no cross-family comparison, no grading), this is accepted as low severity for MVP rather than built out with server-side step-sequence validation this session. |

## 6. Summary

No new authorization gap was found beyond what earlier phases already
flagged; this review's contribution is confirming those notes are still
accurate against current code, adding the two closed-form remediation
plans above (4.1, 4.2) for whenever a deployable sandbox exists, and
turning `docs/TESTING_STRATEGY.md`'s abstract "Backend tests" list into a
concrete pre-pilot checklist (section 5). No code changes were made as
part of this review beyond the data-deletion flow shipped alongside it
(see `docs/IMPLEMENTATION_STATUS.md`), since every fix identified above
requires either a live deploy to verify or a Lambda-backed mutation this
sandbox cannot safely build untested.
