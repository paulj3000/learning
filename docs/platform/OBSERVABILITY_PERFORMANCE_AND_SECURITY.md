# Observability, Performance, and Security Hardening (Phase 43)

Covers `docs/android/android.md` Phase 22 ("Observability"), Phase 23
("Performance and Cost Review"), and Phase 24 ("Security Hardening"),
scoped per ADR-018 in `docs/DECISIONS.md`. Unlike Phase 42, this phase
ships one real, small, reversible piece of production code (structured
per-request logging) alongside two audits — it is not a single
build-vs-design split, because its three source phases are not the same
kind of question.

## 1. Observability: shipped

`docs/android/android.md` Phase 22 wants every logged request to carry
`requestId`, `eventId`, `userId`, `childProfileId`, `deviceId`,
`platform`, `appVersion`, API version, function name, result, error code,
and duration, so production issues can be filtered by client and
cross-device sync failures stay traceable.

This backend already had one Lambda that turns table writes into
CloudWatch metrics (`amplify/functions/operational-metrics/handler.ts`,
Phase 8), but none of the three synchronous custom resolvers
(`claimCoopSlot`, `submitAdventureAnswer`, `getNextLearningActivity`)
logged anything about their own invocations at all — a failed or slow
call left no trace beyond whatever the Lambda platform captures by
default.

**New: `amplify/functions/shared/requestLog.ts`.** A small, framework-free
module, unit tested (`requestLog.test.ts`) the same way
`claim-coop-slot/handler.ts`'s `decideClaim` and
`submit-adventure-answer/handler.ts`'s `decideSubmission` already are —
pure functions split from the one `console.log` side effect. `withRequestLog`
wraps a resolver's body and emits exactly one JSON line per invocation,
win or lose:

```json
{
  "requestId": "...",
  "functionName": "claimCoopSlot",
  "childProfileId": "...",
  "platform": null,
  "appVersion": null,
  "result": "OK",
  "errorCode": null,
  "durationMs": 42
}
```

Wired into all three resolvers (`claim-coop-slot/handler.ts`,
`submit-adventure-answer/handler.ts`, `get-next-learning-activity/handler.ts`),
each now passing `context.awsRequestId` and its own `functionName`.
`childProfileId` is populated from whichever argument the resolver
already has one for (`claimCoopSlot`, `getNextLearningActivity`);
`submitAdventureAnswer` only learns it partway through its own DynamoDB
lookup, and logs `null` rather than restructuring already-tested control
flow just to capture it a few lines earlier — a real, narrow, explicitly
accepted gap, not an oversight.

**What is genuinely not built yet, and why that is correct scope, not a
miss:** `platform`/`appVersion` read optional `x-app-platform`/
`x-app-version` request headers — real the instant a second client sends
them, `null` today because none does. `deviceId`/`userId`/`eventId`/API
version are not in the log shape at all: `userId` is exactly
`ChildProfile.ownerSub`'s Cognito `sub`, already logged implicitly via
CloudWatch's own execution context and not worth a second copy;
`deviceId` has no subject until `DeviceRegistration` (designed, not
built, ADR-015) exists; `eventId` and API version have no subject until a
`ContentManifest`/versioned API exists (designed, not built, ADR-014).
Same "wire the shape now, populate it once there is something real to
populate it with" pattern every phase since 36 has used for
Android-shaped fields with no current subject.

**Dashboards and alarms** (android.md's other Phase 22 deliverable) are
not built this phase: `operational-metrics`' existing CloudWatch EMF
metrics and alarms (Phase 8, `docs/PILOT_READINESS.md` section 3) already
cover the safety/AI half; a dashboard over these new per-request log
lines would need a CloudWatch Logs Insights query or metric filter wired
in `amplify/backend.ts`, real infrastructure this phase did not add —
tracked as follow-up once there is a real deploy to point one at (no AWS
credentials in this sandbox, the same recurring constraint noted
throughout `docs/IMPLEMENTATION_STATUS.md`).

## 2. Performance and cost review: audited, nothing changed

`docs/android/android.md` Phase 23 asks for a review of GraphQL query
shapes, pagination, Lambda cold starts, and asset sizes, with the
acceptance criteria "major Android screens use bounded queries" and
"assets have mobile-appropriate sizes." There is no Android screen yet,
so this reviews the equivalent web-client query shapes any Android
screen would inherit from the same backend operations.

**Every `.list()` call in this codebase is unbounded** — no `limit`, no
pagination token consumed. Grepping `src/` and `amplify/` for
`.list(` finds every call site owner-scoped to a single family (`.list()`
under owner authorization returns only that caller's own rows —
`src/features/adventures/api.ts`, `src/features/mastery/api.ts`,
`src/features/quests/api.ts`, `src/features/rewards/api.ts`,
`src/features/npc/api.ts`, `src/features/discovery/api.ts`,
`src/features/child-profile/deletion.ts`, `src/features/story/api.ts`,
`src/features/island/api.ts`, `src/features/parent-dashboard/api.ts`) —
at this product's actual data shape (tens of rows per child: adventure
sessions, skill progress rows, quest states), an unbounded `.list()` is
not a real cost or latency problem. The one exception is already tracked,
not new: `src/features/admin/api.ts`'s `listAllParentProfiles`/
`listAllChildProfiles` return *every* family's rows with no pagination at
all (`docs/IMPLEMENTATION_STATUS.md`'s existing "Known risks" entry,
Phase 39) — the only `.list()` call in this codebase whose result size
scales with total user count rather than one family's data, and so the
only one a real pagination pass would need to fix first.

`get-next-learning-activity/handler.ts` already documents its own
`Scan`+`FilterExpression` (rather than a `Query` against a
`childProfileId`-keyed GSI) as a known, accepted tradeoff at this data
volume (Phase 41) — this review does not find a new instance of that
pattern, `claim-coop-slot` and `submit-adventure-answer` both use
`GetCommand`/`UpdateCommand` by primary key.

**Subscriptions**: exactly one live subscription exists in this codebase,
`CoopSession.onUpdate` (Phase 17, audited for cross-device sync in Phase
40/ADR-015) — no new subscription surface to review.

**Asset sizes**: every GLTF in `public/models/` is a hand-built
placeholder (`docs/IMPLEMENTATION_STATUS.md`'s Phase 31-34 entries), 4-16
KB each, ~124 KB total across all eighteen files — not remotely
representative of a real art pass, and Phase 34 ("3D Art and Asset
Pipeline") is the phase that owns compression, LOD, and texture-size
budgets once real art exists. Reviewing mobile-appropriate sizing against
placeholder geometry would produce a number with no bearing on the real
asset pipeline's eventual output; this review does not fabricate one.

**Nothing changed this phase.** Every finding above describes an already
either-fine-at-current-scale or already-tracked situation; introducing
pagination or query narrowing for its own sake, with no second client and
no evidence of an actual latency/cost problem, would be scope this
product does not need yet (CLAUDE.md's "don't design for hypothetical
future requirements").

## 3. Security hardening: audited against the existing ADR-012 gap, confirmed unchanged

`docs/android/android.md` Phase 24's acceptance criteria — "modifying
[client] local state cannot permanently alter authoritative progress" and
"sensitive operations are validated in backend functions" — restate
ADR-002's existing rule for the Adventure Engine and AI companion, this
time platform-wide: XP/currency, quest completion, inventory grants,
skill mastery, and achievement qualification must all be re-validated
server-side.

**One of six flagged write paths already is** (`submitAdventureAnswer`,
Phase 37/ADR-012). This phase re-audited the other five with exact
citations, to confirm ADR-012's "five remaining `NEEDS_MIGRATION` write
paths" claim is still exactly true rather than assuming it:

| Write path | Model | Write function | Client call site | Status |
|---|---|---|---|---|
| Skill mastery | `SkillProgress` | `upsertSkillProgress` (`src/features/mastery/api.ts:36`) | `src/features/adventures/useAdventureSession.ts:174`, with client-held `correctness`/`supportLevel` | Client-authoritative |
| Rewards | `ChildInventory` | `grantRewards` (`src/features/rewards/api.ts:86`) | `src/features/island-map/NpcConversation.tsx`, resolved against a static reward table client-side | Client-authoritative |
| Quests | `ChildQuestState` | `startQuest`/`syncQuestProgress` (`src/features/quests/api.ts:127`, `:182`) | `src/features/island-map/NpcConversation.tsx:213`/`:223`, progress recomputed client-side via `advanceQuest` | Client-authoritative |
| NPC relationships | `ChildNpcState` | `recordDialogueNode` (`src/features/npc/api.ts:87`) | `src/features/island-map/NpcConversation.tsx:126`, client-selected dialogue node drives `relationshipPoints` | Client-authoritative |
| Discovery | `ChildWorldState` | `recordDiscovery`/`recordCharacterMet` (`src/features/discovery/api.ts:141`/`:243`) | explorable-world scene components, client-supplied discovery/checkpoint id | Client-authoritative |

Every one of these five models carries only `allow.owner()` (plus
`allow.group('Admins').to(['read'])`) authorization in
`amplify/data/resource.ts` — **ownership** is enforced server-side (a
parent cannot write another family's rows), but **correctness of the
value written** is not: nothing stops a raw GraphQL call from writing any
`relationshipPoints`, any `ownedItemIds` entry, or any quest `status` a
caller chooses, the same category of gap `submitAdventureAnswer` closed
for adventure-step correctness specifically. Confirmed: no dormant or
stub custom mutation exists for any of the three write actions above —
`amplify/data/resource.ts` defines exactly two Lambda-backed custom
mutations (`claimCoopSlot`, `submitAdventureAnswer`) and one Lambda-backed
query (`getNextLearningActivity`); these five paths rely entirely on
generated per-model CRUD.

**Not closed this phase.** Migrating all five to server-authoritative
Lambda resolvers is real, substantial production code — comparable in
scope to Phase 37's own single-path pilot, not a documentation-plus-small-
utility change. ADR-012 already scoped Phase 37 down to one pilot
deliberately, and that scoping decision is unchanged by this audit;
widening it to all five is tracked as concrete, well-specified follow-up
(this table *is* the spec — model, current write function, and client
call site to replace) rather than attempted here. Building five more
resolvers on this phase's authority alone would also outrun what a single
phase can realistically ship and verify without a live backend to test
against (no AWS credentials in this sandbox, same constraint as every
prior phase in this range).

**Other Phase 24 controls** (rate limits, idempotency, audit events on
sensitive operations): idempotency already exists independently for the
migrated path (`submitAdventureAnswer` is a plain overwrite of
`currentStepId`, safe to retry) and for reward/world-change/quest/
discovery writes generally (`grantedRuleIds`, `changeKey`, and
recompute-rather-than-log patterns, audited in Phase 40/ADR-015). Rate
limiting is not implemented anywhere in this backend and is not specific
to this phase's five write paths — AppSync's default account-level
throttling is the only control in place today, the same as every other
mutation in this schema; a per-caller rate limit has no clear subject
until real abuse patterns or a real second client exist to motivate one.

## 4. What this document does not do

- It does not migrate skill mastery, rewards, quests, NPC relationships,
  or discovery writes to server-authoritative Lambda resolvers — table 3
  above is the tracked spec for that follow-up, not a completed migration.
- It does not add pagination to any `.list()` call, including the
  already-tracked admin directory gap.
- It does not build a CloudWatch dashboard or alarm over the new
  per-request log lines.
- It does not add rate limiting anywhere in this backend.
