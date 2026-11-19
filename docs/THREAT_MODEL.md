# Threat Model (Phase 8)

Scope: the MVP as implemented through Phase 7 plus the Phase 8 data-deletion
flow, against the architecture in `docs/ARCHITECTURE.md` and the data model
in `docs/DATA_MODEL.md`. This document is a product-engineering threat
model, not a legal or compliance certification - `docs/AI_AND_CHILD_SAFETY.md`
already says as much for AI/safety specifically, and the same caveat applies
here: obtain qualified security and privacy review before a public launch,
especially given this product's users include children.

## 1. Assets

Ranked by sensitivity, most sensitive first:

1. **Child behavioral/learning data**: `AdventureAction`, `SkillEvidence`,
   `SkillProgress`, `WorldChange`, `StoryArtifact` content, session
   history. Reveals a specific child's reading level, response patterns,
   and (via `StoryArtifact`) actual generated text tied to their choices.
2. **Parent account credentials and identity**: Cognito login, email,
   `ParentProfile.displayName`.
3. **Child profile metadata**: `nickname`, `ageBand`, `interests`,
   `avatarKey`, `readingMode`, and the optional profile photo. Lower sensitivity than
   (1) - no birthdate, legal name, or contact info is collected at all
   (by design, `docs/DATA_MODEL.md`).
4. **AI interaction metadata**: `AIInteractionAudit`, `SafetyEvent` rows.
   Metadata-only by design (no raw child text), but still reveals *that*
   a safety event occurred and its category/severity.
5. **AI system prompt and route configuration**: the Chatty and tutor
   prompts (`lai/apps/ai/prompts/`) and the AI routes' request schema
   (`lai/apps/ai/serializers.py`). Not secret in the classic
   sense (it's in the repo), but its *integrity* matters - if an attacker
   could alter what gets sent to Bedrock, they could weaken every safety
   boundary at once.
6. **AWS infrastructure credentials**: the Django workload role (Bedrock,
   Polly, S3), the database secret, Cognito app client config. Compromise
   here is catastrophic (full data access) and is secured by AWS IAM
   practice and the CDK definitions in `infra/`, not by application code.

## 2. Actors

- **Legitimate parent**: signs in with their own Cognito credentials,
  should only ever reach their own family's data.
- **Child, via a parent's authenticated session**: never authenticates
  independently (ADR-001); every action a child takes runs inside their
  parent's already-authenticated browser session. The child is *not* a
  distinct authorization principal in this system - a meaningful
  simplification that also means the child inherits whatever the parent's
  session can do.
- **Malicious or curious signed-in parent**: a real, authenticated parent
  who attempts to access another family's data, forge their own child's
  progress, or bypass their own account's controls (e.g. the `aiEnabled`
  kill switch). See `docs/AUTHORIZATION_REVIEW.md` sections 4-5 for the
  specific gaps this actor could exploit today.
- **Unauthenticated internet attacker**: no valid Cognito session. Can
  reach the public sign-up/sign-in/forgot-password screens and Django's
  unauthenticated surface (health checks, signed-token file routes), but
  not any data route, which needs a verified Cognito access token.
- **A child interacting with Chatty directly**: distinct from "child via
  parent session" above in one respect - this is the threat of a child
  *steering the AI itself* toward unsafe territory (prompt injection via
  whatever bounded input channels exist), not accessing unauthorized data.
- **Compromised or over-privileged AWS operator** (out of scope for this
  document beyond noting it): whoever holds deploy/admin AWS credentials
  has database-level access to everything. Mitigated by AWS IAM practice,
  not application code.

## 3. Trust boundaries

Matches `docs/ARCHITECTURE.md`'s system diagram:

```text
[Browser: React/Vite client + Cognito session token (react/src/lib/cognito)]
                                        <- trust boundary 1 ->
[Django + DRF: token verification, IsProvisionedParent, child scoping]
                                        <- trust boundary 2 ->
[PostgreSQL, S3]                      <- trust boundary 3 -> [Bedrock, Polly]
```

- **Boundary 1 (browser <-> Django)**: the browser is fully untrusted.
  Nothing about correctness, authorization, or safety may depend on
  client-side code behaving honestly - CLAUDE.md section 7 already states
  this ("Never call a foundation model directly from the browser",
  "Gameplay correctness must be evaluated by application code whenever
  possible, not by the model") and section 13 ("Validate all external and
  AI-generated data at runtime"). Django grades answers and
  writes progress from its own grade (`docs/AUTHORIZATION_REVIEW.md`
  section 1b); the remaining client-authored paths are tracked in ADR-012
  and ADR-044 (`docs/AUTHORIZATION_REVIEW.md` section 5).
- **Boundary 2 (verified parent <-> child-scoped data)**: this is the real
  authorization boundary (`docs/AUTHORIZATION_REVIEW.md` sections 1-2):
  every child record is reached only through the authenticated parent
  (`ChildScopedMixin`). The child-profile cap and the AI switch are
  enforced server-side (`docs/AUTHORIZATION_REVIEW.md` sections 4.1, 4.2).
- **Boundary 3 (Django <-> Bedrock)**: the model only ever receives the
  bounded context Django builds (age band, intent, step summary, length
  limit, learning objective, hint level, authored base text, allowed choice
  IDs) - never a full child profile, never parent PII, per
  `docs/AI_AND_CHILD_SAFETY.md`'s prompt-context minimization, enforced by
  the request schema itself (there is no field to smuggle more through).
  Bedrock's *output* is untrusted the moment it returns - Django's
  contract validation and output policy (`docs/AI_SERVICE.md` section 3)
  re-check structure, length, choice-ID membership, and content safety
  before anything reaches a child
  (CLAUDE.md section 13), and any failure falls back to authored content
  (CLAUDE.md section 7).

## 4. Threats and mitigations

Organized loosely by STRIDE, listing only threats meaningfully applicable
to this product's actual shape (a bounded, structured-generation
children's app - not a general chat product).

### Spoofing

- **A user claims to be a different parent.** Mitigated by Cognito
  authentication; not further reviewed here (Cognito's security model is
  AWS's responsibility, not this app's).
- **A child's device is shared, and one child accesses another child's
  profile within the same parent account.** Mitigated by the parent gate
  (`docs/UX_AND_ACCESSIBILITY.md`, `ParentGate.tsx`) on sensitive profile
  actions such as deactivation and reactivation - a UX control, not a
  cryptographic one, matching
  the product's actual threat (sibling mix-ups, not attackers).
- **A child opens the parent space from child mode.** Accepted risk (owner
  decision 2026-11-10, AP-04): the adult exit ("Adults: exit to parent
  space") no longer has the arithmetic `ParentGate`, so one tap from any
  child screen reaches `/home` and the parent pages (profiles and
  settings). The parent must still be signed in on the device.
  Deactivating or reactivating a profile keeps its `ParentGate`.

### Tampering

- **A parent forges their own child's adventure progress or world
  changes.** Mitigated for graded paths: Django grades answers and writes
  progress from its own grade; remaining client-authored paths are
  tracked (boundary 1 above, `docs/AUTHORIZATION_REVIEW.md` section 5).
- **A parent bypasses their own `aiEnabled: false` setting via a direct
  API call.** Mitigated: the AI pipeline reads the switch server-side
  (`docs/AUTHORIZATION_REVIEW.md` section 4.2).
- **The AI system prompt (`lai/apps/ai/prompts/`) is altered by a future
  contributor in a way that weakens a safety boundary.** Mitigated by
  server-side validation (Django's contracts and output policy) that does not
  trust the prompt alone (CLAUDE.md section 7: "No single model
  instruction is considered sufficient") - even a compromised or poorly
  worded prompt cannot bypass the length, choice-ID, URL, and
  personal-information-request checks in `lai/apps/ai/contracts.py`,
  `lai/apps/ai/content_safety.py` and `lai/apps/ai/services/safety.py`. Recommend code-review
  requirement (already implicit in normal PR practice) for any change to
  the prompts given its safety-critical role; not a new control,
  just calling out why the existing review-before-merge norm matters most
  here.

### Repudiation

- Not a meaningful threat surface for this product - there is no
  transaction, purchase, or dispute-relevant action a user would need to
  deny having taken. `AIInteractionAudit`/`SafetyEvent` provide an audit
  trail for operational/safety review, not for adjudicating user disputes.

### Information disclosure

- **Cross-family data access.** Mitigated by child scoping through the
  authenticated parent on every child route (`ChildScopedMixin`, tested
  in `lai/apps/users/tests/test_tenant_isolation.py`) - see
  `docs/AUTHORIZATION_REVIEW.md` sections 1-2. This is the
  single most consequential authorization property in the system; it has
  been reviewed and confirmed structurally sound for every model.
- **Child free text or raw AI transcripts appearing in logs.** Mitigated
  by design: `AIInteractionAudit` is metadata-only (CLAUDE.md section 13:
  "Do not log child free-text, audio, names, or identifiers unless
  specifically required and documented" - confirmed by reading its model
  in `lai/apps/ai/models.py`, which has no prompt, model text or child
  input column).
  `StoryArtifact` is the one deliberate, documented exception (it stores
  validated AI-generated prose by design, per
  `docs/IMPLEMENTATION_STATUS.md`'s Phase 5 notes) - every scene in it
  already passed the companion turn's safety checks before capture.
- **A safety event or audit row leaking to a party other than the
  relevant parent.** Mitigated by child scoping on the parent's AI history
  routes; Django Admin registers no child-owned record, so staff cannot
  read them in the product either (`docs/AUTHORIZATION_REVIEW.md` section
  4.3).
- **Parent PII (email, display name) reaching the AI model.** Explicitly
  prevented by the AI routes' fixed request schema and Django's context
  builder - there is no field for it (`docs/AI_AND_CHILD_SAFETY.md`
  prompt-context minimization, confirmed by reading
  `lai/apps/ai/serializers.py`).

### Denial of service

- **Bedrock cost/quota exhaustion from excessive AI calls** (a single
  compromised or bulk-scripted parent session hammering the AI routes).
  Mitigated in code: Django applies shared AI limits and a runtime kill
  switch (`lai/apps/ai/services/usage.py`, `docs/AI_SERVICE.md` section 5),
  with token and request-spike alarms (`docs/AI_SERVICE.md` section 6).
  The limits still need sizing against real usage ("Load/cost tests" in
  `docs/PILOT_READINESS.md`).
- **A child's session running indefinitely
  causing excessive engagement rather than infrastructure harm.**
  Accepted by the owner (ADR-053, 2026-11-11): the platform imposes no
  play-time limit, countdown or forced stop. What remains is the calm-
  engagement design itself (no streaks, loot boxes, leaderboards or
  come-back pressure) and the parent's own supervision; this is a product-safety control more
  than a security one, included here because it is this document's closest
  analogue to "availability" threats for a children's product (the harm
  model is child engagement, not server load).

### Elevation of privilege

- **A parent session reaching data or actions reserved for an
  administrator role.** Administration is Django Admin, with its own staff
  sign-in and Django permissions (`docs/AUTHORIZATION_REVIEW.md` section
  4.3). A parent's Cognito token never authenticates Django Admin, and
  there is no self-serve way to become staff. Staff see profile metadata
  read-only and audited; no child-owned record is registered.
- **A child's bounded interaction (taps, curated choices, short structured
  input) being used to make the AI take an action outside its intended
  scope** - e.g. prompt injection via a curated-choice label or a
  short-text field, attempting to make Chatty ignore its persona.
  Mitigated by: (1) MVP child input is exclusively taps, ordering, numbers,
  and curated choices (`docs/AI_AND_CHILD_SAFETY.md`'s "Child input
  policy"), and Django screens client text for prompt injection before
  any model call (`lai/apps/ai/services/safety.py`), which sharply limits the injection
  surface compared to an open chat box; (2) even if the model *were*
  steered off-script, Django's choice-ID allowlist means
  it can never cause an unauthorized game action - only bad dialogue text,
  which still passes through length/URL/PII/content-safety checks before
  reaching a child. **Residual risk**: the AI red-team suite
  (`scripts/ai-red-team.ts --target django` and the Django red-team tests)
  has not yet been run against live Bedrock through Django (LAI-0705).

## 5. Summary of open items from this review

All of the following were already known from earlier phases; this
document's contribution is organizing them explicitly as a threat model
rather than scattered phase notes, and confirming each by re-reading
current code:

1. Remaining client-authored progress and AI-context paths (low severity,
   self-directed) - ADR-012, ADR-044, `docs/AUTHORIZATION_REVIEW.md`
   section 5.
2. Administrator safety-event/AI-audit review is still not built -
   `docs/AUTHORIZATION_REVIEW.md` section 4.3.
3. The AI red-team suite has not been run live against Bedrock through
   Django (LAI-0705).
4. AI rate limits and cost alarms exist in code but are not yet sized
   against real usage or deployed - `docs/PILOT_READINESS.md`.

Closed since the first version of this review, by server-side enforcement:
the `MAX_CHILD_PROFILES` cap (`lai/apps/users/services.py`) and the
`aiEnabled` switch (`lai/apps/ai/services/pipeline.py`).

None of the open items are cross-family data exposure risks, which is the
category this review weighted most heavily given the product's actual
users are families and children. All should be closed or explicitly
re-accepted before a public (non-closed-pilot) launch.
