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
   `avatarKey`, `readingMode`, `sessionMinutes`. Lower sensitivity than
   (1) - no birthdate, legal name, or contact info is collected at all
   (by design, `docs/DATA_MODEL.md`).
4. **AI interaction metadata**: `AIInteractionAudit`, `SafetyEvent` rows.
   Metadata-only by design (no raw child text), but still reveals *that*
   a safety event occurred and its category/severity.
5. **AI system prompt and route configuration**: `chattyPersona.ts`,
   `generateCompanionTurn`'s arguments schema. Not secret in the classic
   sense (it's in the repo), but its *integrity* matters - if an attacker
   could alter what gets sent to Bedrock, they could weaken every safety
   boundary at once.
6. **AWS infrastructure credentials**: IAM roles for the Bedrock data
   source, Cognito app client config, DynamoDB table access. Compromise
   here is catastrophic (full data access) but is AWS/Amplify's
   responsibility to secure at the platform layer, not this app's code.

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
  reach the public sign-up/sign-in/forgot-password screens and the AppSync
  GraphQL endpoint's introspection/unauthenticated surface, but not any
  `allow.owner()`/`allow.authenticated()`-gated data.
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
[Browser: React/Vite client]          <- trust boundary 1 ->
[Amplify client libraries + Cognito session token]
                                        <- trust boundary 2 ->
[AppSync: allow.owner() / allow.authenticated() enforcement]
                                        <- trust boundary 3 ->
[DynamoDB tables]                     [Bedrock via AI Kit generation route]
```

- **Boundary 1 (browser <-> AppSync)**: the browser is fully untrusted.
  Nothing about correctness, authorization, or safety may depend on
  client-side code behaving honestly - CLAUDE.md section 7 already states
  this ("Never call a foundation model directly from the browser",
  "Gameplay correctness must be evaluated by application code whenever
  possible, not by the model") and section 13 ("Validate all external and
  AI-generated data at runtime"). The one confirmed gap against this
  principle is `docs/AUTHORIZATION_REVIEW.md` section 5's "prevention of
  direct progress or world-change forgery" row: a parent's own client
  *is* currently trusted to report correct `stepId`/`correctness` values
  for their own family's rows. Accepted as low severity per that review's
  reasoning (no leaderboard, no cross-family stakes).
- **Boundary 2 (Cognito session <-> owner-scoped data)**: this is the real
  authorization boundary (`docs/AUTHORIZATION_REVIEW.md` section 1-2). Every
  model relies on it; no model grants access beyond it except the two
  documented, low-severity gaps (MAX_CHILD_PROFILES, aiEnabled - both
  self-directed, not cross-family).
- **Boundary 3 (AppSync <-> Bedrock)**: the AI route only ever receives
  the bounded arguments `generateCompanionTurn` declares (age band,
  intent, step summary, max length, learning objective, hint level,
  authored base text, allowed choice IDs) - never a full child profile,
  never parent PII, per `docs/AI_AND_CHILD_SAFETY.md`'s prompt-context
  minimization, enforced by the schema itself (there is no field to smuggle
  more through). Bedrock's *output* is untrusted the moment it returns -
  `validateCompanionTurn` re-checks structure, length, choice-ID
  membership, and content safety before anything reaches a child
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
  (`docs/UX_AND_ACCESSIBILITY.md`, `ParentGate.tsx`) on profile switching
  and sensitive actions - a UX control, not a cryptographic one, matching
  the product's actual threat (sibling mix-ups, not attackers).

### Tampering

- **A parent forges their own child's adventure progress or world
  changes.** Documented gap, accepted as low severity - see boundary 1
  above and `docs/AUTHORIZATION_REVIEW.md` section 5.
- **A parent bypasses their own `aiEnabled: false` setting via a direct
  API call.** Documented gap, accepted as low severity - see
  `docs/AUTHORIZATION_REVIEW.md` section 4.2.
- **The AI system prompt (`chattyPersona.ts`) is altered by a future
  contributor in a way that weakens a safety boundary.** Mitigated by
  application-layer validation (`validateCompanionTurn`) that does not
  trust the prompt alone (CLAUDE.md section 7: "No single model
  instruction is considered sufficient") - even a compromised or poorly
  worded prompt cannot bypass the length, choice-ID, URL, and
  personal-information-request checks in `src/lib/ai/contentSafety.ts`
  and `src/features/companion/schema.ts`. Recommend code-review
  requirement (already implicit in normal PR practice) for any change to
  `chattyPersona.ts` given its safety-critical role; not a new control,
  just calling out why the existing review-before-merge norm matters most
  here.

### Repudiation

- Not a meaningful threat surface for this product - there is no
  transaction, purchase, or dispute-relevant action a user would need to
  deny having taken. `AIInteractionAudit`/`SafetyEvent` provide an audit
  trail for operational/safety review, not for adjudicating user disputes.

### Information disclosure

- **Cross-family data access.** Mitigated by `allow.owner()` on every
  model - see `docs/AUTHORIZATION_REVIEW.md` sections 1-2. This is the
  single most consequential authorization property in the system; it has
  been reviewed and confirmed structurally sound for every model.
- **Child free text or raw AI transcripts appearing in logs.** Mitigated
  by design: `AIInteractionAudit` is metadata-only (CLAUDE.md section 13:
  "Do not log child free-text, audio, names, or identifiers unless
  specifically required and documented" - confirmed by reading its schema
  in `amplify/data/resource.ts`, which has no free-text field at all).
  `StoryArtifact` is the one deliberate, documented exception (it stores
  validated AI-generated prose by design, per
  `docs/IMPLEMENTATION_STATUS.md`'s Phase 5 notes) - every scene in it
  already passed `validateCompanionTurn`'s safety checks before capture.
- **A safety event or audit row leaking to a party other than the
  relevant parent.** Mitigated by `allow.owner()` on `SafetyEvent`/
  `AIInteractionAudit`; no admin group exists yet to leak *to* (see
  `docs/AUTHORIZATION_REVIEW.md` section 4.3 - the flip side of "no admin
  access" is "no admin over-exposure" either, for now).
- **Parent PII (email, display name) reaching the AI model.** Explicitly
  prevented by `generateCompanionTurn`'s fixed argument schema - there is
  no field for it (`docs/AI_AND_CHILD_SAFETY.md` prompt-context
  minimization, confirmed by reading `amplify/data/resource.ts`).

### Denial of service

- **Bedrock cost/quota exhaustion from excessive AI calls** (a single
  compromised or bulk-scripted parent session hammering
  `generateCompanionTurn`). No rate limiting exists today beyond AWS
  account-level Bedrock quotas and standard AppSync throttling. **Not
  mitigated; tracked as an open item under "Load/cost tests" in
  `docs/PILOT_READINESS.md`** - this needs real usage data to size
  correctly and cannot be meaningfully addressed without a deployed
  environment to load-test against.
- **A child's session running indefinitely (no calm stopping point)
  causing excessive engagement rather than infrastructure harm.**
  Mitigated by `sessionMinutes` and the calm-stopping-point requirement in
  `docs/UX_AND_ACCESSIBILITY.md`; this is a product-safety control more
  than a security one, included here because it is this document's closest
  analogue to "availability" threats for a children's product (the harm
  model is child engagement, not server load).

### Elevation of privilege

- **A parent session reaching data or actions reserved for an
  administrator role.** Not applicable - no administrator role exists yet
  in this schema (`docs/AUTHORIZATION_REVIEW.md` section 4.3), so there is
  nothing to escalate *to*. Revisit this section once that role is built.
- **A child's bounded interaction (taps, curated choices, short structured
  input) being used to make the AI take an action outside its intended
  scope** - e.g. prompt injection via a curated-choice label or a
  short-text field, attempting to make Chatty ignore its persona.
  Mitigated by: (1) MVP child input is exclusively taps, ordering, numbers,
  and curated choices (`docs/AI_AND_CHILD_SAFETY.md`'s "Child input
  policy" - there is no free-text renderer built yet, confirmed in
  `docs/IMPLEMENTATION_STATUS.md`'s Phase 4 notes: "no step renderer for
  `SHORT_RESPONSE` exists yet"), which sharply limits the injection
  surface compared to an open chat box; (2) even if the model *were*
  steered off-script, `validateCompanionTurn`'s choice-ID allowlist means
  it can never cause an unauthorized game action - only bad dialogue text,
  which still passes through length/URL/PII/content-safety checks before
  reaching a child. **Residual risk**: `docs/TESTING_STRATEGY.md`'s "AI
  evaluation suite" (fixed test cases including "prompt injection in
  child input") has not been built yet - tracked as an existing, already-
  documented gap (`docs/IMPLEMENTATION_STATUS.md` Phase 4 "Known
  risks/TODOs"), restated here because it is this threat's most direct
  mitigation and remains unbuilt.

## 5. Summary of open items from this review

All of the following were already known from earlier phases; this
document's contribution is organizing them explicitly as a threat model
rather than scattered phase notes, and confirming each by re-reading
current code:

1. Progress/world-change forgery by a parent's own client (accepted, low
   severity) - `docs/AUTHORIZATION_REVIEW.md` section 5.
2. `aiEnabled` bypassable via direct API call (accepted, low severity) -
   `docs/AUTHORIZATION_REVIEW.md` section 4.2.
3. `MAX_CHILD_PROFILES` unenforced server-side (accepted, low severity) -
   `docs/AUTHORIZATION_REVIEW.md` section 4.1.
4. No administrator role/group exists (out of MVP scope, tracked) -
   `docs/AUTHORIZATION_REVIEW.md` section 4.3.
5. AI evaluation suite (including prompt-injection test cases) not built -
   `docs/IMPLEMENTATION_STATUS.md` Phase 4 "Known risks/TODOs".
6. No Bedrock rate limiting/cost control beyond AWS defaults - new to this
   document, tracked in `docs/PILOT_READINESS.md`.

None of these are cross-family data exposure risks, which is the category
this review weighted most heavily given the product's actual users are
families and children. All six should be closed or explicitly re-accepted
before a public (non-closed-pilot) launch.
