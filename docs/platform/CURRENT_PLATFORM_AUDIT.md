# Current Platform Audit (Phase 35)

Covers `docs/android/android.md` Phase 0 (Platform Audit) and Phase 1
(Establish the Platform Boundary), grouped in `docs/ROADMAP.md` as "Phase 35
— Platform Audit and Boundary". See ADR-010 in `docs/DECISIONS.md` for the
architectural rule this audit exists to check the codebase against: *Amplify
Gen 2 is the source of truth; the web client and any future Android client
are both clients of the same platform.*

This is a source-level review, written by reading `amplify/` and every
`src/features/*/api.ts` call site, not by exercising a live deployment —
this sandbox has no AWS credentials (the same constraint noted throughout
`docs/IMPLEMENTATION_STATUS.md` and `docs/AUTHORIZATION_REVIEW.md`). No
production code changes accompany this document: Phase 35's job is to find
out where the platform boundary is and is not already clean, not to fix
every gap it finds. Gaps that need code changes are routed to the specific
later phase in `docs/ROADMAP.md` "Phases 35+" that owns them, not fixed here.

## 1. Classification

Every item below is classified as one of:

| Label | Meaning |
|---|---|
| `SHARED_DATA` | An Amplify Data model or piece of state already readable/writable by any authenticated client through the generated Data client — no web-specific transport or shape. |
| `SERVER_LOGIC` | Business logic that runs only on the backend (a Lambda, a custom resolver) and cannot be bypassed by a client. |
| `CLIENT_ONLY` | Code that only ever needs to run in a rendering client (UI state, input handling, presentation) and is correctly *not* backend concern. |
| `STATIC_ASSET` | Content authored in source control (TypeScript modules or files under `public/`) rather than a database row. |
| `NEEDS_MIGRATION` | Logic that currently decides an authoritative gameplay outcome client-side and then writes it directly to an owner-authorized Data model, with no server-side re-validation. This is the category a second, more easily tampered-with client (a rooted Android device) makes newly risky. |

## 2. Backend resources — `SHARED_DATA` / `SERVER_LOGIC`

Every model in `amplify/data/resource.ts` is already `SHARED_DATA`: reachable
by any authenticated client through the generated Amplify Data client with
no web-specific shape, using `allow.owner()` (optionally plus
`allow.group('Admins').to(['read'])`) or, for `CoopSession`,
`allow.ownerDefinedIn('hostParentProfileId').identityClaim('sub')`
(`docs/AUTHORIZATION_REVIEW.md` already reviews every rule in detail; this
audit does not re-derive that). Full model list: `ParentProfile`,
`ChildProfile`, `CompanionProfile`, `AdventureSession`, `AdventureAction`,
`SkillEvidence`, `SkillProgress`, `WorldChange`, `AIInteractionAudit`,
`SafetyEvent`, `StoryArtifact`, `ChildStoryProgress`, `CoopSession`,
`ChildNpcState`, `ChildInventory`, `ChildQuestState`, `ChildWorldState`.

`SERVER_LOGIC` — the two things a client cannot bypass:

- **`generateCompanionTurn` / `generateTutorTurn`** (`amplify/data/resource.ts`)
  — Amplify AI Kit generation routes; the system prompt, model, and
  inference config are fixed server-side and cannot be supplied or
  overridden by a client argument.
- **`claimCoopSlot`** (`amplify/functions/claim-coop-slot/handler.ts`) — the
  one custom mutation backed by a Lambda that re-derives its own
  host/participant/status checks and uses a DynamoDB `ConditionExpression`
  for atomic slot claiming. This is the *only* gameplay write in the entire
  schema that is genuinely server-authoritative today.
- **`operational-metrics`** (`amplify/functions/operational-metrics/handler.ts`)
  — a DynamoDB Streams consumer that turns `SafetyEvent`/`AIInteractionAudit`
  writes into CloudWatch metrics. Not itself an authorization boundary (it
  observes writes after the fact), but it is genuinely server-only logic
  with no client-facing shape at all.

Both Lambda handlers were read in full: neither assumes React, Three.js,
browser `localStorage`, cookies, or DOM APIs, and neither shapes its
input/output for a particular UI (`claimCoopSlot` takes/returns generic
`CoopSession` data; `operational-metrics` emits CloudWatch EMF log lines).
**Phase 1's "backend business logic is client-neutral" acceptance criterion
is already met for every piece of code that actually runs on the backend.**
The finding below in section 3 is that very little authoritative gameplay
logic runs on the backend at all yet — that is a Phase 37 problem, not a
Phase 1 boundary-cleanliness problem.

### API naming is already platform-neutral

`docs/android/android.md` Phase 1 warns against web-shaped naming like
`POST /api/web/completeLesson` in favor of `completeActivity(activityId,
childId)`. A full-tree search of `src/` found **no REST-style `fetch()`,
`axios`, or `/api/...` calls anywhere** — every backend interaction goes
through the generated Amplify Data client (`client.models.*`,
`client.mutations.*`, `client.generations.*`, and one
`CoopSession.onUpdate` subscription). The three custom operations are
already named platform-neutrally: `claimCoopSlot`, `generateCompanionTurn`,
`generateTutorTurn`. **No renaming or restructuring was needed to satisfy
this criterion** — the existing GraphQL/Amplify-Data architecture was
client-neutral from the start, which is favorable for an Android client
using the same generated client libraries.

## 3. Client-side gameplay logic — the real audit finding

Every gameplay engine in `src/features/` follows the same shape: a **pure
decision module** (no I/O, unit-tested) paired with an **impure `api.ts`**
that reads the current row, re-derives the outcome, and writes it straight
to an owner-authorized Data model. Only `claimCoopSlot` (section 2) goes
through a server-side re-check. Everything below writes on the strength of
the client's own computation alone.

This was always an acceptable risk for a single web client running code the
product itself shipped. It becomes a real risk once a second client type
exists — particularly Android, where a modified or rooted client can call
the same Amplify Data operations directly with arbitrary arguments. This is
the "Android blockers" this audit exists to surface (`docs/android/android.md`
Phase 0's acceptance criteria); fixing it is Phase 37's job
("Server-Authoritative Actions" in `docs/ROADMAP.md`), not this phase's.

| Feature | Pure decision (stays `CLIENT_ONLY`) | Write path (`NEEDS_MIGRATION`) | What a hostile client could forge |
|---|---|---|---|
| Adventure Engine | `src/features/adventures/engine/validators.ts` (`validateStepAnswer`), `transitions.ts`, `hints.ts` | `src/features/adventures/api.ts`: `recordAction`, `recordSkillEvidence`, `recordWorldChangeOnce`, `startSession`/`advanceSession`/`completeSession` | Answer correctness, session completion, world unlocks — the foundation every other engine below builds on |
| Skill Mastery | `src/features/mastery/status.ts`, `summary.ts`, `errorPattern.ts` (display projections only) | `src/features/mastery/api.ts`: `upsertSkillProgress` | Exposure/success counters that drive `SkillStatus` (MASTERED etc.) |
| Rewards/Inventory | `src/features/rewards/rewardTable.ts` (`resolveRewards` — no randomness, by design), `inventory.ts`, `sets.ts` | `src/features/rewards/api.ts`: `grantRewards` | Arbitrary items granted to `ChildInventory` |
| Quests | `src/features/quests/quest.ts`, `objectives.ts` | `src/features/quests/api.ts`: `syncQuestProgress` (cascades into world-change, NPC-memory, and reward writes) | Quest/objective completion, plus everything it cascades into |
| NPC relationships | `src/features/npc/relationship.ts`, `dialogue.ts`, `memory.ts` | `src/features/npc/api.ts`: `recordDialogueNode`, `setNpcMemoryFlagsForQuest` | Relationship points/level, memory flags |
| Discovery | `src/features/discovery/discovery.ts` (`resolveDiscovery`) | `src/features/discovery/api.ts`: `recordDiscovery` (cascades into world-change/reward/quest writes) | Discovery/exploration progress; `recordCharacterMet`/`saveCheckpoint` are mitigated somewhat by validating against a closed authored-id vocabulary before writing, but still an unchecked client write |

`src/features/mastery/status.ts`/`summary.ts` (read-only mastery display)
and `src/features/island/events.ts`/`locations.ts` (static flavor
content/a pure unlock predicate) are correctly `CLIENT_ONLY` — they only
ever project already-stored state for display and do not themselves write
anything.

**Not in scope for this phase.** Migrating any of the write paths above to
a server-authoritative mutation (a validating Lambda, following the
`claimCoopSlot` precedent) is `docs/ROADMAP.md` Phase 37's deliverable. This
audit's job is to make the list above complete and explicit so Phase 37 has
a concrete backlog instead of having to rediscover it.

## 4. Content authored in source control (`STATIC_ASSET` / `CLIENT_ONLY`)

None of the following are database models — all are plain TypeScript
modules shipped inside the web client's JS bundle:

| Content type | Location |
|---|---|
| `IslandLocation` | `src/features/island/locations.ts` |
| `AdventureTemplate`/`AdventureStepDefinition` | `src/features/adventures/content/` (one file per adventure, plus `learningObjectives.ts`) |
| `StoryDefinition` | `src/features/story/content/` |
| `ItemDefinition` | `src/features/rewards/content/` |
| `DiscoveryDefinition` | `src/features/discovery/content/` |
| NPC dialogue/relationship content | `src/features/npc/content/` |
| NPC world-placement/visual data | `src/features/island-map/npcs.ts` |
| Quest definitions | `src/features/quests/content/` |
| World/zone definitions | `src/features/worlds/worlds.ts`, `src/features/worlds/packs/`; per-world pixel-rect zone geometry in `src/features/island-map/*Zones.ts` (7 files) and matching tilemap/decor files |
| Curriculum/skill graph | `src/features/curriculum/content/` |
| Reward rule table | `src/features/rewards/rewardTable.ts`, `sets.ts` |
| 3D asset manifest | `src/features/island-map/three/assets/manifest.ts` (`ASSET_MANIFEST`), pointing at `public/models/*.gltf`, generated by `scripts/generate-world-assets.ts` |
| Discovery checkpoints | `src/features/discovery/checkpoints.ts` |
| Tutor scaffolding content | `src/features/tutor/content/` |

**Android blocker.** A second client written in Kotlin cannot import a
TypeScript module. Every row in this table currently means "this content
exists only inside the web client's bundle" — an Android client would have
to duplicate all of it by hand, and the two copies could drift. This is the
problem `docs/ROADMAP.md` Phase 36 ("Canonical Identity and Content Models")
and Phase 39 ("Manifest, Versioning") exist to solve by moving this content
into shared, backend-served models; this audit only establishes that the
problem is real and lists every location it would need to migrate from.

## 5. Browser/DOM-dependent code (`CLIENT_ONLY`, genuinely web-specific)

A full-tree search of `src/` found **no `localStorage`, `sessionStorage`,
or `indexedDB` usage anywhere** — every piece of persistent state already
goes through Amplify Data (section 2). Nothing needs migrating off browser
storage, which is a favorable starting point for a second client.

`window`/`document` usage that does exist, all legitimately `CLIENT_ONLY`
today but each a concrete point where an Android client needs its own,
different implementation rather than a portable abstraction:

- `src/features/island-map/three/pointerControls.ts`,
  `sandboxScene.ts`, `WelcomeHarborWorldView.tsx` — mouse/pointer-lock input
  for the first-person Three.js controller. Desktop/browser input model;
  Android would need a touch-based control scheme, not a shared module.
- `src/features/island-map/three/assets/assetLoader.ts` — uses
  `window.location` only to resolve a relative `/models/...` path to an
  absolute URL for `GLTFLoader.load()`. A resource-loading detail, not
  state.
- `src/features/child-profile/avatarPhoto.ts` — uses `document`/`Image`/
  canvas APIs to resize/crop an avatar photo client-side before upload to
  Storage. Android would need its own native image-processing path.
- `src/lib/motionPreference.ts` — reads
  `window.matchMedia('(prefers-reduced-motion)')`. Android has its own
  system-level reduced-motion setting; this check is not portable as
  written, but the *policy* ("respect the user's motion preference") is.
- `src/features/companion/ChattyAvatar.tsx` — DOM element refs for the
  companion avatar's own animation. Presentation only.

None of these are backend concerns and none need to change for this phase;
they are listed so a future Android-client design does not have to
rediscover where the web client's input/rendering assumptions live.

## 6. Acceptance criteria

Per `docs/android/android.md` Phase 0 and Phase 1:

- [x] Every major feature has an identified owner — sections 2-5 above.
- [x] Web-only business logic has been identified — section 5 (input
      handling, avatar photo processing, motion-preference reads).
- [x] Shared data requirements are documented — section 2 (every Amplify
      Data model is already `SHARED_DATA`).
- [x] Android blockers are identified before implementation begins —
      section 3 (client-authoritative gameplay writes) and section 4
      (content that exists only as bundled TypeScript).
- [x] Backend business logic is client-neutral — confirmed for the code
      that actually runs on the backend today (section 2); the deeper
      finding is that most gameplay-outcome logic doesn't run on the
      backend yet at all (section 3), which is Phase 37's problem to fix,
      not a boundary-cleanliness defect in what already exists there.
- [x] Shared APIs have platform-neutral naming — confirmed, no changes
      needed (section 2).
- [x] Android can call backend APIs without browser dependencies — true
      for the Data/AI/Lambda surface itself (generic Amplify Data client,
      no REST/web-shaped endpoints); **not** yet true in the sense that an
      Android client would need to reimplement the client-side decision
      logic in section 3 itself (and could compute different, exploitable
      results) rather than simply calling a server-authoritative API for
      it — flagged for Phase 37, not resolved by this phase.

## 7. Forward pointers

This audit does not change any code; it is the input the following phases
consume:

- **Phase 36** — move the section-4 content tables into shared,
  backend-served models instead of bundled TypeScript.
- **Phase 37** — move the section-3 write paths behind server-authoritative
  mutations, generalizing the `claimCoopSlot` precedent.
- **Phase 39** — content manifest/versioning for whatever Phase 36 produces;
  authorization-rule rework for a multi-client environment.
