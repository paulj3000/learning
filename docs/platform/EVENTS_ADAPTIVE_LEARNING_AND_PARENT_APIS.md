# Events, Adaptive Learning, and Parent APIs (Phase 41)

Covers `docs/android/android.md` Phase 16 ("Event Architecture"), Phase 17
("Adaptive Learning Service"), and Phase 18 ("Parent Platform APIs"),
scoped per ADR-016 in `docs/DECISIONS.md`. Splits three ways: Event
Architecture is design-only (this product's typed models already are its
event log, under different names); Adaptive Learning is real, shipped code
(`getNextLearningActivity`, a new Lambda-backed query); Parent APIs is an
audit finding (the underlying logic is already pure and portable, and
parent authorization already server-enforced — no new Lambda built this
phase).

## 1. Event Architecture — design-only; this product already has an event log, just not one by that name

`docs/android/android.md` Phase 16 asks for a standardized event
vocabulary and envelope (`eventId`, `eventType`, `childProfileId`,
`deviceId`, `source`, `timestamp`, `payload`) so `adaptive learning,
analytics, progress tracking, recommendations, debugging, parent reports`
all read the same shape. This product does not have a generic event
system, and — after checking every example event type android.md lists —
should not build one: it already has purpose-built, strongly-typed models
that record the same facts, each already read by exactly the systems that
need it.

| android.md event type | Already recorded as | Reads it today |
|---|---|---|
| `LESSON_STARTED` / `LESSON_COMPLETED` | `AdventureSession` create / `status: 'COMPLETED'` update | Parent dashboard, Adaptive Adventure Director |
| `QUESTION_ANSWERED` | `AdventureAction` create, correctness server-verified (Phase 37) | Parent dashboard's support reporting |
| `QUEST_STARTED` / `QUEST_COMPLETED` | `ChildQuestState` status | Quest UI, reward engine |
| `ITEM_COLLECTED` | `ChildInventory.ownedItemIds` update | Backpack UI |
| `LOCATION_DISCOVERED` | `ChildWorldState.discoveredObjects` / a `WorldChange` arrival row | Exploration telemetry, parent dashboard |
| `NPC_INTERACTION` | `ChildNpcState` update | NPC dialogue engine |
| `ACHIEVEMENT_EARNED` | No direct equivalent — closest is a `CollectibleSet` completion, already inside `ChildInventory` | — |
| `SESSION_STARTED` / `SESSION_ENDED` | No equivalent — this product has no app-usage-session concept distinct from an `AdventureSession` (one adventure play-through), and none of CLAUDE.md section 11's "session time controls" are implemented as a loggable start/end event today | — |

A model write already carries more than android.md's generic envelope
would: strong per-field typing instead of an untyped `payload`, and
`childProfileId` scoping enforced by `allow.owner()` rather than trusted
metadata. What the envelope has that no model carries today is
`deviceId`/`source` — but that is exactly `docs/platform/DEVICE_SYNC_AND_OFFLINE_SAFETY.md`'s
already-deferred `DeviceRegistration` territory (Phase 40), not a reason
to build a second, parallel event system to re-solve.

**Decision: no new event model or event-emission code this phase.**
Building a generic `Event` table that every write also had to populate
would duplicate data already recorded, with weaker typing, for a set of
consumers (adaptive learning, analytics, parent reports) that already read
the typed models directly today.

## 2. Adaptive Learning — real, shipped: `getNextLearningActivity`

Unlike device registration or a content manifest, this product already had
a complete, working answer to `docs/android/android.md` Phase 17's
`getNextLearningActivity(childProfileId)` example: the Adaptive Adventure
Director (Phase 28, `src/features/director/`), a pure, deterministic,
already-tested ranking engine. It was real, existing logic running only in
the browser bundle — exactly the `NEEDS_MIGRATION` shape
`docs/platform/CURRENT_PLATFORM_AUDIT.md` catalogued for other engines,
just for a read instead of a write, and with no security consequence to a
wrong answer (worst case: a child sees a less well-ordered list of
adventures they could already play).

**What shipped**: `getNextLearningActivity`, a Lambda-backed custom query
(`amplify/functions/get-next-learning-activity/handler.ts`) that imports
the Director's exact same pure modules (`select.ts`, `needs.ts`, and a new
`reachability.ts` extracted from the old client-only `listReachableAdventures`
— see below) unchanged, assembles their input from DynamoDB, and returns
a ranked, flattened result. `src/routes/ChildDashboard.tsx` — the only
caller — now calls this query instead of running the ranking client-side;
the old `buildDirectorContext`/`listReachableAdventures`/`suggestNextAdventure`
functions are gone from `src/features/director/api.ts`, replaced by one
thin wrapper that reconstructs the wire response into the `SelectionRecord[]`
shape `explain.ts` already knows how to render.

This is genuinely lower-risk than Phase 37's `submitAdventureAnswer`: it
is read-only, so there is no session-state mutation to guard, no retry
double-application to worry about, and a stale or wrong ranking has no
security consequence — the value here is entirely about *not duplicating,
and risking silent divergence of, the same ranking algorithm* across web
and a future Android client, not about closing a tampering gap.

**Ownership check reuses Phase 37's `ChildProfile.ownerSub`.** A query has
no owned row of its own, so `childProfileId` is a required argument, and
the handler re-verifies it against the caller's own `sub` before reading
anything else — the same pattern `submitAdventureAnswer` established,
reused rather than re-invented.

**Data access is `Scan` + `FilterExpression`, not `Query` against a GSI**,
for `AdventureSession`/`WorldChange`/`SkillProgress` — documented in the
handler's own comment as a known, deliberate simplification: Amplify
Data's relationship fields likely generate a `childProfileId`-keyed index
on each table, but this sandbox cannot confirm the generated index name
without a live deploy, and a `Scan` needs no such knowledge. Acceptable at
this product's actual data volume (tens of rows per child); revisit once a
real deploy can confirm the index name.

**A small, real architecture fix fell out of this work**:
`src/features/mastery/summary.ts`'s `indexProgressBySkill` used to take
`Schema['SkillProgress']['type']` (imported, even if only as a type, from
the *impure* `src/features/mastery/api.ts`, which pulls in the browser
Amplify Data client and `import.meta.glob`). A Lambda program that reaches
that type transitively fails to typecheck (`amplify/tsconfig.json` has no
Vite types). Rather than adding Vite types to the Lambda project's
tsconfig — a broader, less targeted fix — `summary.ts` now declares its
own minimal structural `SkillProgressLike` type, decoupling this pure
engine module from the impure client module at the type level too, not
just the import-graph level. No existing caller needed to change: every
real `SkillProgress` row already satisfies the narrower shape.

**Behavioral note**: the old code's `listReachableAdventures` degraded
specifically-a-`WorldChange`-read failure to "home-only reachable worlds"
(via its own `.catch(() => [])`), while a `sessions`/`skillProgress` read
failure propagated up to `suggestNextAdventure`'s outer try/catch (which
already returned "no suggestion" for those). The new Lambda reads all
three tables in one `Promise.all` with no per-table fallback, so *any*
read failure now degrades uniformly to "no suggestion shown" — a
coarser, but still safe and non-breaking, version of an already-existing
fallback contract. Not considered a regression worth extra code to avoid.

## 3. Parent APIs — audited, not newly built: already pure, already server-authorized

`docs/android/android.md` Phase 18 asks for `getChildDashboard()`/
`getWeeklyProgress()`-style operations, independent of the website, with
parent authorization enforced server-side. Checking this product's actual
parent-dashboard code
(`src/features/parent-dashboard/weeklySummary.ts`, `masteryOverview.ts`,
`adventureSupport.ts`, `educatorReport.ts`): every one is already a pure,
framework-free function that takes already-fetched Amplify Data rows as
input and returns plain data/strings — the same shape the Director was in
before this phase, just not yet promoted to a shared Lambda query.

**"Parent authorization is enforced server-side" already holds** for the
data itself: every model these functions read (`AdventureSession`,
`SkillProgress`, `WorldChange`, `StoryArtifact`, `AdventureAction`) is
`allow.owner()`-authorized, so a parent can only ever fetch their own
child's rows regardless of which client assembles the dashboard from them
— confirmed already in `docs/AUTHORIZATION_REVIEW.md` section 0.

**Not promoted to a Lambda query this phase.** Unlike the Director, a
"shared parent dashboard query" would need to read six or more tables
(every one the four assembly functions above draw from) in a single
Lambda, a meaningfully larger surface than `getNextLearningActivity`'s
four. Given this phase already shipped one full, tested,
production-shaped read query proving the pattern, spreading the same
effort across a second, larger Lambda in the same phase was judged lower
value than doing the one well — same "smallest coherent change" reasoning
Phase 37 already applied by piloting a single write path rather than all
six at once. The four assembly functions remain exactly where they are;
promoting them to a shared query is a natural, well-scoped follow-up
whenever an actual second client exists to benefit from it.

## 4. What this document/phase does not do

- It does not add an `Event`/`ContentManifest`-style generic event model.
- It does not add `deviceId`/`source` tracking — that stays Phase 40's
  deferred `DeviceRegistration`.
- It does not promote `weeklySummary`/`masteryOverview`/`adventureSupport`/
  `educatorReport` to shared Lambda-backed queries.
- It does not change the Director's actual ranking rules — `select.ts`
  and `needs.ts` are byte-for-byte unchanged; only where they run and how
  their output reaches the client changed.
