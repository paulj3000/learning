# Privacy and Child-Safety Review (Phase 8)

This document checks the current implementation against every requirement
in `docs/AI_AND_CHILD_SAFETY.md` and the relevant parts of CLAUDE.md
sections 6-7, 10, and 13, by reading the actual code rather than
re-describing the spec. As `docs/AI_AND_CHILD_SAFETY.md` itself states,
this is a product requirements review, not legal advice - obtain qualified
privacy and child-safety review before a public launch.

## 1. Safety architecture (10 layers)

`docs/AI_AND_CHILD_SAFETY.md` lists ten layers and says "No single model
instruction is considered sufficient." Status of each, as implemented:

1. **Curated adventure and topic boundaries** - implemented. Every
   adventure is source-controlled content (`src/features/adventures/content/`),
   not open-ended; Wonderwild Forest's Wonder Wall additionally has its
   own curated question catalog with a documented source-review workflow
   (`docs/CONTENT_SOURCES.md`).
2. **Limited child input modes and lengths** - implemented for MVP scope.
   Every step renderer built so far is taps/choice/number/ordering
   (`src/features/adventures/steps/`); no `SHORT_RESPONSE` or free-text
   renderer exists yet, so the "short words or sentences" and "optional
   speech converted to ephemeral text" input modes `docs/AI_AND_CHILD_SAFETY.md`
   allows for are simply not exercised yet, not unsafely handled.
3. **Input normalization and classification** - not applicable yet, for
   the same reason as (2): there is no child free-text input path to
   normalize or classify. Revisit when one is built.
4. **Prompt templates with explicit age and content constraints** -
   implemented. `chattyPersona.ts`'s fixed system prompt plus
   `generateCompanionTurn`'s typed arguments (age band, intent, max
   length) constrain every call.
5. **Structured output schemas** - implemented. `CompanionTurn`'s shape is
   declared in the AI route (`amplify/data/resource.ts`) and re-validated
   independently in application code (`schema.ts`).
6. **Provider safety controls where available** - not separately
   configured beyond Bedrock's platform defaults; no explicit Bedrock
   Guardrails resource is provisioned in `amplify/backend.ts`. **Open
   item**: evaluate Amazon Bedrock Guardrails as an additional layer
   before wider release - not attempted this session since it requires a
   live deploy to configure and test.
7. **Application-level output validation** - implemented and the
   strongest layer in the stack today: `validateCompanionTurn` checks
   structure, intent match, length, URL presence, personal-information
   requests, and choice-ID membership before anything reaches a child.
8. **Allowlisted UI components and actions** - implemented via the
   `allowedChoiceIds` mechanism: the model can only ever offer choices
   the caller already authorized, verified in `schema.ts`.
9. **Authored fallback content** - implemented. `fallback.ts` provides one
   authored `CompanionTurn` per intent; `requestCompanionTurn` always
   falls back on any validation failure, non-`ALLOW` disposition, or
   thrown error, and never throws itself.
10. **Metadata audit and human review workflow** - partially implemented.
    `AIInteractionAudit`/`SafetyEvent` rows are written on every call
    (metadata only). The "human review workflow" half does not exist yet
    - there is no admin role or review UI (see
    `docs/AUTHORIZATION_REVIEW.md` section 4.3). For a closed pilot, the
    interim process is direct, credentialed inspection of `SafetyEvent`
    rows with `reviewStatus: OPEN` (e.g. via the AWS console or a signed-
    in parent's own dashboard for their own family) - documented here as
    the actual, honest process rather than implying a review UI exists.

## 2. Child input policy

"MVP preferred inputs" (taps, multiple choice, ordering, numbers, short
words, curated curiosity prompts, optional speech-to-ephemeral-text) -
confirmed correct: every step type implemented so far
(`src/features/adventures/engine/types.ts`) is `NARRATIVE`, `CHOICE`,
`NUMBER_INPUT`, `ORDERING`, `CREATIVE_CHOICE` (curated options, not free
text - confirmed in `theStorykeepersTale.ts`), and `REFLECTION`. None of
the "reject or redirect" categories (contact details, precise location,
school name, passwords, sexual content, etc.) can currently be *typed by a
child* at all, because no free-text child input exists yet. This makes
the "reject or redirect" rules currently unreachable rather than
satisfied by active enforcement - an important distinction for whoever
builds the first free-text/short-response step (expected use case:
Storykeeper Castle's own name-your-character prompts, if that's ever
added, or Wonderwild Forest's "ask your own question"). At that point,
`docs/AI_AND_CHILD_SAFETY.md`'s reject/redirect list needs an actual input
classifier, not just output validation - **flagged as a hard prerequisite
for any future free-text child input feature**, not a Phase 8 gap in
current scope.

## 3. Companion boundaries

Every prohibited behavior in `docs/AI_AND_CHILD_SAFETY.md`'s "Companion
boundaries" list is addressed at least at the prompt layer
(`chattyPersona.ts`, confirmed by reading its text) and, where the
behavior would manifest as detectable text, also at the validation layer:

- Requests for contact info / photos / location / school / full name -
  caught by `requestsPersonalInformation` (`contentSafety.ts`) as a
  second layer beyond the prompt instruction.
- Secrecy requests, "only/best friend" dependency framing, shame/fear/
  romantic language, purchase encouragement, claiming certainty when
  unsure - **prompt-layer only**, with no dedicated pattern-based
  detector in `contentSafety.ts` beyond the general personal-info/URL
  checks. This matches `docs/TESTING_STRATEGY.md`'s still-unbuilt "AI
  evaluation suite" gap (already tracked since Phase 4) - there is no
  automated check today that would catch, say, a model response that
  says "I'll always be here for you and no one else." The layered-defense
  principle (layer 7 above) still applies in that any egregious version
  of this would likely also trip length/tone expectations informally
  reviewed in the single live Bedrock sample from Phase 4, but this is
  observation, not a systematic guarantee. **Open item, restated from
  Phase 4**: build the AI evaluation suite before wider release.
- Simulating a real or deceased person - prompt-layer only, same
  reasoning as above; no detector exists (nor would a simple regex
  meaningfully catch this class of failure - this one likely needs the
  eval suite's human-reviewed fixed cases rather than a heuristic).

## 4. Prompt context minimization

Confirmed correct by reading `generateCompanionTurn`'s argument list in
`amplify/data/resource.ts`: `ageBand`, `intent`, `stepSummary`,
`maxLength`, and optional `learningObjectiveCode`/`hintLevel`/
`authoredBaseText`/`allowedChoiceIds`. There is no argument for parent
email, child legal name, exact birthdate, or raw free-text history -
structurally impossible to send them by accident, since the schema has no
field for them. This is the strongest privacy property in the system: it
holds regardless of what any future caller intends, because it's enforced
by the type system, not a runtime check someone could forget to call.

## 5. Structured response validation rules

All five rules in `docs/AI_AND_CHILD_SAFETY.md` ("strict maximum length by
age band", "no URLs", "no requests for personal information", "choices
must match server-authorized action IDs", "invalid output invokes
deterministic fallback") are implemented in `validateCompanionTurn`,
confirmed by direct code reading (section 5 of this document mirrors that
function's actual checks line-for-line). The sixth rule, "no markup
except supported narration tokens", is **not implemented** - there is no
narration-token system yet (nothing in the codebase parses or restricts
markup in `spokenText`), and no markup-stripping or allowlist check
exists. Low risk today since `spokenText` is rendered as plain text in
`CompanionBubble.tsx` (confirmed by reading it - no `dangerouslySetInnerHTML`
or HTML parsing anywhere in the companion rendering path), so even
unexpected markup characters would render inertly as literal text rather
than executing as markup. **Open item**: revisit if/when a real narration-
token system (e.g. for TTS emphasis or pacing) is built - the "no markup
except supported tokens" rule matters once there's a token parser that
could be exploited, not before.

## 6. Parent transparency

`docs/AI_AND_CHILD_SAFETY.md` lists five things parents should be able to
see. Status:

- **Which AI features are enabled** - implemented (`ChildDashboard`'s AI
  on/off toggle and status text).
- **Plain-language descriptions of AI use** - partially implemented. The
  dashboard states *whether* AI is on, but there is no dedicated "how we
  use AI" explainer screen. Low priority for MVP; worth adding before a
  public pilot announcement, not blocking a closed pilot with informed
  participants.
- **Learning summaries** - implemented (`ChildDashboard`'s weekly summary,
  skills-practiced, recent-adventures sections; deliberately skill-based,
  not raw transcripts, per CLAUDE.md section 9).
- **Data controls and deletion options** - implemented as of this phase.
  Previously (`docs/IMPLEMENTATION_STATUS.md` Phase 7) this covered only
  per-story deletion and AI-history clearing; this phase added full,
  cascading child-profile deletion and full parent-account deletion (see
  `docs/IMPLEMENTATION_STATUS.md`'s Phase 8 entry and
  `src/features/child-profile/deletion.ts`). This is the single largest
  concrete gap this review closed.
- **Safety events requiring attention, using carefully reviewed language**
  - **implemented this session.** `SafetyEvent` rows were already written
    and owner-scoped, but had no dashboard surface. Added
    `listSafetyEvents` (`src/features/parent-dashboard/api.ts`) and a
    "Safety check-ins" section on `ChildDashboard.tsx` showing severity,
    date, what happened (`actionTaken`, already a plain-language authored
    string - e.g. "Replaced with authored fallback content"), and review
    status in calm, non-alarming copy, with an explanation that Chatty
    always substitutes a pre-written reply rather than showing an
    unchecked one. Read-only - review/dismissal of an event stays an
    admin workflow that does not exist yet
    (`docs/AUTHORIZATION_REVIEW.md` section 4.3), same as noted
    throughout this document. This was the single most-recommended open
    item from this review, since a parent previously had no in-product
    way to learn a `STOP`/`REDIRECT` disposition occurred for their
    child.

## 7. Data retention principle

"Keep the least data for the shortest useful time. Separate operational
telemetry from child content. Document retention and deletion behavior
before collecting free text or audio." Status:

- Least-data principle - upheld structurally (no birthdate, legal name,
  contact info, or raw audio collected anywhere in the schema, confirmed
  by reading `amplify/data/resource.ts` in full). **Amended after this
  review**: the optional child profile photo (`ChildProfile.avatarPhotoKey`
  plus the object in Amplify Storage) is the first personal *content*
  about a child, as opposed to metadata, that this product can store -
  and a photograph of a child under 8 is the most sensitive item in it.
  It stays consistent with least-data only because every part of it is
  opt-in and parent-controlled: no profile requires a photo, the picture
  is re-encoded in the browser to a 256px JPEG that carries no EXIF or GPS
  data, the object is readable only by the uploading parent's own Cognito
  identity (not by other parents, not by the `Admins` group, not by any
  Lambda or AI route), and a parent can remove it in one click. See
  `docs/DATA_MODEL.md` "Child profile photos" for the full handling rules.
- Operational telemetry vs. child content separation - upheld:
  `AIInteractionAudit`/`SafetyEvent` are metadata-only; `StoryArtifact` is
  the one deliberate, documented content-bearing model, already reviewed
  and flagged as such since Phase 5.
- Deletion behavior - now documented and implemented at three
  granularities: per-story (`StoryKeepsakes.tsx`, Phase 5), per-child
  AI-history (`clearAIHistory`, Phase 7), and, new this phase, full
  per-child and full per-account deletion (`deletion.ts`). Child profile
  photos are covered by the last of these, and deliberately fail loudly:
  `deleteChildProfileData` deletes the stored image *before* the row that
  points at it and aborts the whole deletion if the object cannot be
  removed, rather than reporting success over a photo that still exists. **No free text
  or audio is collected at all yet**, so the "before collecting free text
  or audio" precondition in this principle has not yet been triggered -
  revisit this section specifically when/if a free-text or voice input
  feature is built, since that is the point at which this principle's
  full weight applies.
- **No automated retention schedule exists** (e.g. auto-delete after N
  months of inactivity). This was already an explicit "Decisions pending"
  item before this phase (`docs/IMPLEMENTATION_STATUS.md`) and remains
  one - a closed pilot with a defined, communicated end date does not
  need an automated schedule; a public launch likely does.

## 8. Summary and priority recommendations

Ranked by what most directly affects the product's actual child-safety
posture, not by ease of implementation:

1. ~~**Highest priority**: surface `SafetyEvent` rows to parents in the
   dashboard (section 6).~~ **Done this session** - see section 6.
2. **High priority, recommended before wider (non-closed) release**:
   build the AI evaluation suite (`docs/TESTING_STRATEGY.md`) covering
   dependency/secrecy language, real-person simulation, and prompt
   injection - the least-covered class of harms in the current pipeline.
3. **Medium priority**: a dedicated "how we use AI" parent-facing
   explainer; evaluate Bedrock Guardrails as an added layer.
   Also, now that child profile photos can be stored (section 7), the
   parent-facing privacy explanation and any consent copy shown before a
   pilot must name that category explicitly - the in-product field text
   states where the photo goes and who can see it, but that is not a
   substitute for the account-level disclosure.
4. **Low priority / defer until relevant**: narration-token markup
   restriction (no token system exists yet to protect); free-text input
   classification (no free-text input exists yet to classify); automated
   retention schedule (fine for a closed, time-bounded pilot).

Nothing in this review found a violation of an already-implemented rule -
every remaining gap above is either an already-tracked, accepted
limitation or a requirement that is not yet *reachable* because the
feature it would apply to (free text, narration tokens, an admin review
UI) does not exist yet. The one concrete, actionable gap this review
found beyond what was already known (item 1) was closed in the same
session, not just documented.
