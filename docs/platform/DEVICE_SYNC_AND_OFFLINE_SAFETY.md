# Device Registration, Cross-Device Sync, and Offline Safety (Phase 40)

Covers `docs/android/android.md` Phases 13-15 ("Device Registration",
"Cross-Device Synchronization", "Offline-Safe API Design"), scoped per
ADR-015 in `docs/DECISIONS.md`. Splits the same way Phase 39 did: real
audit work where this product already has a real subject (sync behavior,
retry safety of its existing mutations), design-only where it does not
(device registration, an offline request queue). **No model is added to
`amplify/data/resource.ts` and no production code changes this phase.**

## 1. Device Registration — design-only, genuinely nothing to build against

`docs/android/android.md` Phase 13's `DeviceRegistration` (userId,
childProfileId, deviceId, platform, appVersion, lastSeenAt, pushToken,
active) exists to serve app-version tracking, telemetry, sync debugging,
push notifications, security review, and stale-device cleanup. None of
those have a subject today: there is exactly one platform (`WEB`), no push
notification feature exists anywhere in this codebase, and "security
review"/"stale-device cleanup" both presume multiple concurrent device
sessions per child, which this product has never had reason to track.
Target shape, for whenever a second platform is real:

```ts
DeviceRegistration: a.model({
  childProfileId: a.id().required(),
  platform: a.string().required(),      // 'WEB' | 'ANDROID' | 'IOS'
  appVersion: a.string().required(),
  lastSeenAt: a.datetime().required(),
  pushToken: a.string(),
  active: a.boolean().required().default(true),
}).authorization((allow) => [allow.owner()]),
```

`userId` from android.md's suggestion is dropped: this schema's owner
model already ties every row to the signed-in parent implicitly
(`allow.owner()`), so a separate `userId` column would duplicate what
Amplify Data already tracks for free.

## 2. Cross-device sync: mostly already true, and precisely so — a real audit finding

`docs/android/android.md` Phase 14 lists what should synchronize across
devices: `lesson progress, skill mastery, XP, levels, coins, quests,
adventures, inventory, achievements, world unlocks, avatar, settings`.
Four of those (`XP`, `levels`, `coins`, and by extension any
achievement/leaderboard economy built on them) do not exist in this
product at all — ADR-011 already rejected them. Of what remains, every
single one is already an Amplify Data model, not client-cached state:
`SkillProgress`, `AdventureSession`, `ChildInventory`, `ChildQuestState`,
`ChildWorldState` (world unlocks are derived from `WorldChange`,
`docs/platform/CURRENT_PLATFORM_AUDIT.md` section 1), `ChildProfile`
(avatar, settings). The Phase 35 audit already confirmed there is no
`localStorage`/`sessionStorage` anywhere in `src/`. This means:

**"Completing content on one client appears on another" already holds —
*sequentially*.** A device that loads any of these routes always fetches
fresh from Amplify Data; there is nothing cached locally to go stale.
Two browser tabs signed into the same parent account today, opened one
after the other, already see consistent state with zero code written for
this phase.

**What does *not* hold: live, concurrent push between two open
sessions.** A full-tree search
(`grep -rn "onUpdate\|onCreate\|observeQuery\|subscribe"`) found exactly
one GraphQL live subscription anywhere in `src/`:
`client.models.CoopSession.onUpdate` (`src/features/coop/api.ts`, Phase
17), used only for the household co-op presence/slot-claim UI. If a
child had this product open on two devices *at the same time*, a
`WorldChange` written on device A would not appear on device B until B's
own next fetch (a route change, or an explicit refresh) — there is no
mechanism today that pushes it. Given this product's actual usage pattern
(one child playing at a time, on one device at a time — CLAUDE.md's
calm-engagement pillar and the product's whole design point away from
simultaneous multi-device play), this gap is unlikely to matter in
practice, but it is a precise, honest answer rather than an assumption:
**sequential cross-device consistency is already correct by construction;
concurrent live sync exists only for the one feature that was
specifically designed around two devices needing it (co-op).**

**"Duplicate event processing is idempotent"** — see section 3, which
treats this claim engine by engine rather than as a single yes/no.

## 3. Offline-safe retries: what is already idempotent, and what is not

`docs/android/android.md` Phase 15 wants every mutating call safe to
retry (a client-generated `requestId` a queued, retried Android action
can carry), specifically to avoid duplicate XP, rewards, or quest
completion. This product has no offline queue today, so nothing can
actually trigger a duplicate retry in practice — but the *content-level*
idempotency this phase asks for already exists, independently authored,
engine by engine, well before "Android" was ever a consideration
(`docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and every engine's own doc
comments already use the word "idempotent"). A careful pass through every
write path:

| Engine | Write | Already idempotent? | How |
|---|---|---|---|
| Rewards | `grantRewards` (`ChildInventory`) | **Yes** | Checks `grantedRuleIds` before granting; already documented as "the engine's idempotency key" (`docs/DATA_MODEL.md`) |
| World changes | `recordWorldChangeOnce` (`WorldChange`) | **Yes** | Checks for an existing row with the same `changeKey` before creating |
| Quests | `syncQuestProgress` (`ChildQuestState`) | **Yes, structurally** | Recomputed from other engines' state on every call rather than appended to — "there is no event log here to fall out of sync" (the model's own doc comment) |
| Discovery | `recordDiscovery`/`recordCharacterMet`/`saveCheckpoint` (`ChildWorldState`) | **Yes** | `addDiscoveredId`/array-membership checks before appending (`src/features/discovery/discovery.ts`) |
| NPC relationships | `recordDialogueNode` (`ChildNpcState`) | **Yes** | `dialogueOutcome` checks `seenNodeIds` before awarding relationship points for a node already seen |
| Mastery | `upsertSkillProgress` (`SkillProgress`) | **Partially** | Idempotent in the sense that re-running it with the *same* evidence recomputes the same counters from a full read, but it increments rather than sets — two genuinely-duplicate calls (not just a network retry of one) would double-count, the same way any accumulator does |
| Adventure sessions | `submitAdventureAnswer` (`AdventureSession.currentStepId`) | **Accidentally, safely** | A retry re-reads the (now-already-advanced) session and re-validates the same answer against what is now a *different* step's presentation — `validateStepAnswer` throws on a kind mismatch rather than silently re-applying, so a retry fails loudly instead of double-advancing |
| **Adventure actions** | `recordAction` (`AdventureAction.create`) | **No** | Plain, unconditional create; a retried request produces two rows |
| **Skill evidence** | `recordSkillEvidence` (`SkillEvidence.create`) | **No** | Same — plain create |
| **Story artifacts** | `saveStoryArtifact` (`StoryArtifact.create`) | **No** | Same — and deliberately so today: "unlike `recordWorldChangeOnce`, this is not deduplicated by key: each play-through is a distinct new story" (the function's own doc comment) |

**The three non-idempotent writes share a property that matters: they are
append-only audit/evidence rows, not aggregated state.** A duplicate
`AdventureAction` row does not grant a duplicate reward, mark a skill more
mastered than it is, or complete a quest twice — every engine that
*could* be fooled by a duplicate already guards itself independently, per
the table above. The actual cost of a duplicate is a slightly inflated
attempt count on `src/features/parent-dashboard/adventureSupport.ts`'s
independent-vs-hinted reporting, or one extra, indistinguishable copy of
a saved story. Low severity, and — worth stating plainly — this is a
better answer than either "everything is already idempotent" (not quite
true) or "nothing is" (also not true): the specific, narrow gap is three
named append-only writes, not the whole write surface.

**A natural dedup key already exists for `AdventureAction`, just
unenforced.** `sessionId` + `stepId` + `attemptNumber` is already a
locally-computed, monotonically-increasing tuple per step
(`useAdventureSession.ts`'s `attemptNumber = (currentProgress?.attemptNumber
?? 0) + 1`) — a genuine retry of the same attempt would carry the exact
same tuple. Amplify Data has no built-in composite-uniqueness constraint
to enforce this without a custom resolver, so nothing rejects a duplicate
today; a future implementation could either add a
`requestId`-based `ProcessedCommand` model (android.md's own suggestion)
or reuse this already-present tuple as the dedup key, avoiding a new
concept for a gap this narrow.

## 4. Proposed `requestId` design (not built)

```ts
ProcessedCommand: a.model({
  requestId: a.id().required(),   // client-generated UUID
  childProfileId: a.id().required(),
  commandType: a.string().required(), // 'RECORD_ACTION' | 'RECORD_SKILL_EVIDENCE' | 'SAVE_STORY_ARTIFACT'
  processedAt: a.datetime().required(),
}).authorization((allow) => [allow.owner()]),
```

A caller includes `requestId` on the three append-only writes identified
above; the backend checks for an existing `ProcessedCommand` with that id
before creating the row, and records one after. Not built this phase:
there is no offline queue in this codebase to generate a `requestId` from,
and adding a check-then-write step to every append-only write for a retry
scenario that cannot happen yet (this app has no offline mode) would be
speculative infrastructure with no way to test it meaningfully in this
sandbox.

## 5. What this document does not do

- It does not add `DeviceRegistration` or `ProcessedCommand` to
  `amplify/data/resource.ts`.
- It does not add any subscription beyond `CoopSession`'s existing one.
- It does not change `recordAction`/`recordSkillEvidence`/
  `saveStoryArtifact` to accept or check a `requestId`.
- It does not address `upsertSkillProgress`'s accumulator-style
  duplicate-call sensitivity (section 3) — that is a pre-existing property
  of the Mastery Engine unrelated to offline retries specifically (it
  would also double-count from, say, an accidental double form submission
  today), and is out of scope for this document.
