# Pilot Readiness (Phase 8)

Four of `docs/ROADMAP.md`'s Phase 8 deliverables - load and cost tests,
the AI red-team test suite, operational dashboards and alarms, and the
closed parent pilot itself - cannot be executed in this environment: there
are no AWS credentials available here, no deployed `ampx sandbox`, and (for
the pilot) no real families. This is the same constraint every prior
phase's `docs/IMPLEMENTATION_STATUS.md` verification notes have already
recorded for anything requiring a live backend. Rather than skip these
items silently, this document is the concrete runbook for each one, ready
to execute the moment a deployable AWS environment and, eventually, real
pilot participants exist.

## 1. Load and cost tests

**Why blocked here**: needs a deployed AppSync API, real DynamoDB tables,
and a real Bedrock model subscription to generate meaningful load and cost
numbers against - synthetic numbers produced without a live backend would
not reflect real AppSync resolver latency, DynamoDB on-demand billing, or
actual Bedrock per-token cost, and could give a false sense of readiness.

**Runbook, once a sandbox is deployed**:

1. **Establish a cost baseline per interaction.** From
   `amplify/data/resource.ts`, the only metered AI call is
   `generateCompanionTurn` (Bedrock, `Claude Haiku 4.5`,
   `maxTokens: 300`). Using AWS's published Bedrock pricing for the
   resolved model/region, compute cost per call from
   `AIInteractionAudit.latencyMs` and a rough input/output token estimate
   (the system prompt + arguments for input; `maxLength` as an output
   ceiling). Multiply by expected calls-per-session (roughly one HINT
   escalation per stuck step, one CELEBRATE per correct answer, one
   NARRATE per Storykeeper Castle scene / Wonderwild Forest shrink) to get
   a per-session AI cost estimate.
2. **Load-test AppSync/DynamoDB**, not Bedrock, for the deterministic
   paths (adventure start/action/complete, world-change writes) - these
   are the higher-volume, non-AI-gated operations. A simple concurrent-
   session script (N simulated children playing "Repair the Moonlight
   Bridge" end to end in parallel) exercising `src/features/adventures/api.ts`
   against a real deployed backend would surface DynamoDB throttling or
   AppSync request-rate issues before any real pilot traffic does.
3. **Load-test the Bedrock path separately and conservatively** - Bedrock
   quotas are typically tighter than AppSync/DynamoDB's, and this app's
   own `docs/THREAT_MODEL.md` section 4 flags "no rate limiting beyond
   AWS account-level Bedrock quotas" as an open risk. Confirm the
   account's actual Bedrock TPS/TPM quota for the resolved model and size
   a closed pilot's expected concurrent AI-call volume against it before
   inviting more than a handful of families at once.
4. **Set a cost alarm before, not after, the pilot** - see section 3
   below; a Bedrock cost alarm should exist before real usage begins, not
   be added reactively after an unexpectedly large bill.

## 2. AI red-team / evaluation suite

**Why blocked here**: `docs/TESTING_STRATEGY.md`'s "AI evaluation suite"
needs to observe *real model behavior* under adversarial and edge-case
inputs (prompt injection, requests for personal information, dependency-
language elicitation, requests to simulate a real/deceased person,
graceful-uncertainty prompts) - none of which can be meaningfully judged
against a mock or a unit test of the validator alone. This has been a
known, explicitly tracked gap since Phase 4
(`docs/IMPLEMENTATION_STATUS.md` "Known risks/TODOs") and is restated
here as Phase 8's version of "AI red-team tests" from `docs/ROADMAP.md`.

**Runbook, once a sandbox is deployed with live Bedrock access**:

1. **Build the fixed test-case set** `docs/TESTING_STRATEGY.md` already
   specifies, organized by age band: output length, vocabulary
   complexity, personal-information requests, secrecy/dependency
   language, unsafe topics, prompt injection in child input (once a
   free-text input path exists - see
   `docs/PRIVACY_AND_SAFETY_REVIEW.md` section 2), invalid action IDs,
   misleading educational content, excessive praise/shame, correct hint-
   level use, graceful uncertainty.
2. **Red-team the system prompt directly**: for each `CompanionIntent`,
   attempt to elicit a boundary violation from `docs/AI_AND_CHILD_SAFETY.md`'s
   "Companion boundaries" list (e.g. craft an `authoredBaseText` or
   `stepSummary` that tries to steer Chatty toward secrecy language or
   claiming to be a real/deceased person) and confirm
   `validateCompanionTurn` either passes safe output or the response
   correctly falls back.
3. **Assert on structure and safety properties, not exact prose**
   (`docs/TESTING_STRATEGY.md`'s explicit guidance for AI snapshots) -
   each fixture should assert things like "response length <= age-band
   max," "no URL pattern match," "no personal-info pattern match," "if
   safetyDisposition != ALLOW, fallback content was used," not string-
   equality against a specific model response.
4. **Re-run this suite on any future model change.** Bedrock model
   selection is still a "Decisions pending" item
   (`docs/IMPLEMENTATION_STATUS.md`); this suite is the concrete gate for
   approving a model swap, not just a one-time check.

## 3. Operational dashboards and alarms

**Why blocked here**: needs real CloudWatch log groups and metrics from a
deployed backend to build dashboards/alarms against - there is nothing to
point a dashboard at without a live environment.

**Runbook, once a sandbox is deployed**:

1. **Metrics to track**, per `docs/ARCHITECTURE.md`'s "Observability"
   section and what's already captured in `AIInteractionAudit`: AI route
   latency (`latencyMs`), validation-failure rate
   (`validationStatus != VALID`), fallback rate (`fallbackUsed`), safety-
   disposition breakdown (`safetyDisposition`), and `SafetyEvent` volume
   by `severity`. All of this is already structured, queryable data in
   DynamoDB (owner-scoped per family) - the work here is building
   CloudWatch dashboards/metric filters over the Lambda/AppSync resolver
   logs that back these writes, plus (separately) a small scheduled
   aggregation if cross-family operational visibility is needed (which,
   per `docs/AUTHORIZATION_REVIEW.md` section 4.3, has no admin role to
   view it through yet either - these two gaps are linked).
2. **Alarms to configure**:
   - Bedrock cost/budget alarm (AWS Budgets or Cost Anomaly Detection) -
     the most important one to have *before* a pilot begins, not after,
     given `docs/THREAT_MODEL.md`'s open "Bedrock cost/quota exhaustion"
     risk.
   - AppSync 4xx/5xx error-rate alarm.
   - `generateCompanionTurn` validation-failure-rate alarm (a sudden
     spike would suggest either a Bedrock behavior change or a prompt/
     schema regression - actionable and specific, unlike a generic error
     rate).
   - `SafetyEvent` volume alarm at `severity: HIGH` (a spike here is the
     single most safety-relevant signal this system produces and should
     page a human, not wait for a scheduled review).
3. **This is also the natural point to finally build the human-review
   half of `docs/AI_AND_CHILD_SAFETY.md`'s "Metadata audit and human
   review workflow"** (layer 10, `docs/PRIVACY_AND_SAFETY_REVIEW.md`
   section 1) - an alarm without anyone positioned to act on it is
   incomplete. Even for a closed pilot, this can be "the alarm emails the
   one person running the pilot," not a full admin role/UI - that remains
   appropriately deferred (`docs/AUTHORIZATION_REVIEW.md` section 4.3).

## 4. Closed parent pilot

**Why blocked here**: needs real AWS infrastructure, the above three
items in place first, and real recruited families - none of which this
environment can provide.

**Readiness checklist for whoever runs it**, cross-referencing what
Phase 8's other documents already established:

- [ ] Sections 1-3 above complete (load/cost understanding, red-team
      suite passing, cost alarm and safety-event alarm live).
- [ ] `docs/AUTHORIZATION_REVIEW.md` section 5's live-backend owner-
      isolation test actually run against two real parent accounts (the
      one invariant from `docs/TESTING_STRATEGY.md` that most directly
      protects pilot families from each other).
- [ ] `docs/PRIVACY_AND_SAFETY_REVIEW.md` section 8's priority list
      reviewed; item 1 (parent-visible safety events) is done, item 2
      (AI evaluation suite) should be done via section 2 above before
      pilot start.
- [ ] `docs/ACCESSIBILITY_AUDIT.md` section 3's "not covered" items
      (live screen-reader pass in particular) completed for at least the
      parent-facing sign-up/dashboard flow, since pilot parents are real
      users, not test fixtures.
- [ ] A defined pilot end date and explicit data-handling commitment
      communicated to participating families, given
      `docs/IMPLEMENTATION_STATUS.md`'s "Decisions pending: Legal/privacy
      review and retention schedule" remains open - a closed, time-boxed
      pilot with informed participants and the new full-deletion flow
      (`src/features/child-profile/deletion.ts`) available to them on
      request is a reasonable interim position; a public launch is not,
      until that decision is actually made.
- [ ] A qualified privacy/child-safety review obtained per
      `docs/AI_AND_CHILD_SAFETY.md`'s opening disclaimer ("Obtain
      qualified privacy and child-safety review before public launch") -
      everything in this repository's `docs/` is product-engineering
      analysis, not a substitute for that.

None of the four items in this document were attempted this session
beyond producing the runbooks above; each genuinely requires
infrastructure or people this sandbox does not have access to.
