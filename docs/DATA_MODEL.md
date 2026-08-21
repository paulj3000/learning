# Initial Data Model

This is a conceptual schema. Claude should translate it into Amplify Gen 2 TypeScript and verify relationship/index syntax against the installed Amplify packages.

## Engine ownership (Phase 18)

Per `docs/ARCHITECTURE.md`'s "Platform engine boundaries" section, each
model below is authoritative to exactly one engine. Other engines may read
it but write through the owning engine's functions/api module only.

| Model | Owning engine |
|---|---|
| `ParentProfile`, `ChildProfile`, `ParentConsent` | Account/Platform (no single engine — foundational to all) |
| `CompanionProfile` | AI Tutor Engine |
| `IslandLocation`, `WorldChange`, `ChildWorldState` | World Engine |
| `LearningObjective` | Learning Engine |
| `AdventureTemplate`, `AdventureStepDefinition`, `AdventureSession`, `CoopSession`, `AdventureAction` | Adventure Engine |
| `SkillEvidence`, `SkillProgress` | Mastery Engine |
| `ChildStoryProgress` (and content-pack `StoryDefinition`/`StoryChapter`/`StoryScene`) | Story Engine |
| `ChildNpcState` (and content-pack `NpcDefinition`) | NPC System (Phase 23) |
| `ChildInventory` (and content-pack `ItemDefinition`/`CollectibleSet`/`RewardTable`) | Reward/Economy Engine (Phase 24) |
| `ChildQuestState` (and content-pack `QuestDefinition`) | Quest Engine (Phase 25) |
| `AIInteractionAudit` | AI Tutor Engine |
| `SafetyEvent` | Cross-cutting safety pipeline (`docs/AI_AND_CHILD_SAFETY.md`), not exclusive to any one engine |

The Teaching Engine (Phase 21, a pure derivation over Mastery Engine data —
see `docs/ARCHITECTURE.md`), Interaction Engine (Phase 22), and
Parent/Educator Engine (Phase 30, composes read views only) own no models
listed above.

## ParentProfile
- `id`
- `ownerUserId`
- `displayName`
- `timezone`
- `createdAt`
- `updatedAt`

Authorization: owner only; admin read only when explicitly required.

## ChildProfile
- `id`
- `parentProfileId`
- `nickname` or display alias
- `ageBand`: `SPROUT | PATHFINDER | EXPLORER`
- `birthYearMonth` optional and discouraged unless needed
- `avatarKey`
- `avatarPhotoKey` optional: path in Amplify Storage of a parent-uploaded
  photo used as this child's profile icon, or null when the child uses
  their `avatarKey` character (the default)
- `interests`: string array from curated values
- `readingMode`: `VOICE_FIRST | READ_ALONG | INDEPENDENT`
- `sessionMinutes`
- `active`
- timestamps

Authorization: owning parent. Child-facing client access occurs within the authenticated parent session and must be constrained by application routes.

### Child profile photos

`avatarPhotoKey` is only a pointer. The image itself lives in the Storage
bucket defined in `amplify/storage/resource.ts` under
`child-photos/{entity_id}/<uuid>.jpg`, where `{entity_id}` is the Cognito
identity pool ID of the parent who uploaded it, and the only access rule
on that prefix is `allow.entity('identity').to(['read', 'write',
'delete'])`. No guest rule, no blanket authenticated rule, and - unlike
this model's row-level rules - no `Admins` group rule: an administrator
can read the `ChildProfile` row but resolves no image from it.

Handling rules that the code enforces
(`src/features/child-profile/avatarPhoto.ts`):

- A photo is always optional, parent-uploaded, and removable at any time.
- The browser centre-crops and re-encodes the picture to a 256px JPEG
  before upload, which bounds object size and strips all EXIF metadata,
  including GPS coordinates from a phone camera.
- Nothing is uploaded until the parent saves the profile, so an abandoned
  form stores no photo.
- Replacing a photo writes a new object (fresh UUID) and deletes the old
  one after the profile row is saved, never before.
- Deleting a child profile deletes the photo object first and aborts the
  deletion if that fails (`deleteChildProfileData`), so "delete my child's
  data" cannot report success while the picture survives.
- The photo is never included in AI prompt context, and no AI route or
  backend function is granted access to the bucket.

## ChildQuestState
- `id`
- `childProfileId`
- `questId`: an authored `QuestDefinition.id`
- `status`: `ACTIVE | COMPLETED`
- `currentStageId`
- `completedStageIds`: string array
- `completedObjectiveIds`: string array, including optional objectives
- `startedAt`, `lastUpdatedAt`, `completedAt`

Authorization: owning parent; admin read only.

This row is deliberately small because **quest progress is derived, not
reported** (`src/features/quests/types.ts`). Whether an objective is
complete is recomputed from state other engines already own - a completed
`AdventureSession`, a `WorldChange`, a `ChildInventory` item, a
`ChildNpcState` memory flag, a `SkillProgress` status - so this model
records only what cannot be derived: that the child accepted the quest,
which stage they reached, and when they finished.

Three consequences worth keeping when this model changes:

- **Save/resume is free and cannot drift.** There is no event log here to
  fall out of sync with the world, so reopening the journal recomputes the
  child's real position, including credit for work done while the quest sat
  untouched.
- **`AVAILABLE` is not a stored status.** A quest with no row is available
  when its prerequisites pass, so authoring a new quest offers it to every
  eligible child with no backfill.
- **Nothing here is child-authored.** Every stored id is authored content
  (CLAUDE.md section 13); no free text, and nothing a child typed or said.

Quest content itself (`QuestDefinition`, stages, objectives, branches) stays
in source control under `src/features/quests/content/`, matching the
existing preference for authored content over DB rows.

## ParentConsent
- `id`
- `parentProfileId`
- `consentType`
- `version`
- `granted`
- `grantedAt`
- `revokedAt`

## CompanionProfile
- `id`
- `childProfileId`
- `companionType`: initially `CHATTY_PARROT`
- `displayName`
- `cosmeticState` JSON or typed fields
- `lastGreetingAt`

## IslandLocation
Content-managed reference data:
- `id`
- `slug`
- `title`
- `description`
- `minimumAgeBand`
- `status`
- `sortOrder`

## LearningObjective
- `id`
- `domain`: literacy, numeracy, science, creativity, social-emotional, executive-function
- `code`
- `title`
- `description`
- `ageBands`
- `difficultyLevel`

### Curriculum content (Phase 19): the structured successor to this list

`Subject`, `Grade`, `Domain`, and `Skill` (`src/features/curriculum/types.ts`)
are the Learning Engine's structured successor to this flat list, per
`docs/ROADMAP.md` Phase 19: Subject -> Grade -> Domain -> Skill, with
prerequisites, difficulty, and representations. Same "content packs are
not database models" pattern as below: source-controlled content, not DB
rows, queried through pure functions
(`src/features/curriculum/queries.ts`). `Skill.id` values reuse the
existing `code` strings above (already written to `SkillEvidence`/
`SkillProgress` as `learningObjectiveCode`), so no data migration was
needed to add this structure on top. The current seed
(`src/features/curriculum/content/mathGrade1To2.ts`) is one vertical
slice only — grade 1-2 mathematics, enough to cover the numeracy skills
"Repair the Moonlight Bridge" already teaches — not a full curriculum;
the flat list above still governs every other domain until they get the
same treatment.

## AdventureTemplate
- `id`
- `locationId`
- `slug`
- `title`
- `summary`
- `version`
- `status`: draft, review, published, retired
- `ageBands`
- `learningObjectiveIds`
- `estimatedMinutes`
- `entryStepId`
- `safetyTopic`
- `contentConfig`

## AdventureStepDefinition
Prefer content definitions checked into source control for MVP. If persisted:
- `id`
- `templateId`
- `stepType`
- `promptKey`
- `allowedActions`
- `validationConfig`
- `nextStepRules`
- `fallbackContent`

## AdventureSession
- `id`
- `childProfileId`
- `templateId`
- `templateVersion`
- `status`: active, paused, completed, abandoned, safety_stopped
- `currentStepId`
- `difficultyState`
- `coopSessionId` optional, set when this child's session is part of a
  `CoopSession` (see below)
- `startedAt`
- `completedAt`
- `lastActivityAt`

## CoopSession

See `docs/DECISIONS.md` ADR-006. Household-only for v1: all
`participantChildProfileIds` must belong to `hostParentProfileId`, so this
model needs no authorization primitive beyond an owner rule — but it is a
*different* owner rule than every other model uses. Implemented in
`amplify/data/resource.ts` as `allow.ownerDefinedIn('hostParentProfileId').identityClaim('sub')`
rather than the default `allow.owner()`, since the field two children's
clients both need to read/write is an explicit business field, not each
model's usual implicit `owner`. See `docs/AUTHORIZATION_REVIEW.md` section
1a for the full authorization writeup, including why the atomic slot-claim
mutation below bypasses this rule entirely and re-implements its own check.

- `id`
- `hostParentProfileId` — owner (`.identityClaim('sub')`); the one
  `ParentProfile` shared by every participant. Not `.required()` — the
  client never supplies it; AppSync's owner-authorization resolver
  auto-populates it from the caller's identity on create, same as every
  other model's implicit `owner` field.
- `templateSlug` (named to match `AdventureSession.templateSlug` and every
  adventure-content module, not `templateId`)
- `templateVersion`
- `participantChildProfileIds`: array, 2 for v1
- `status`: `ACTIVE`, `COMPLETED`, `ABANDONED`
- `sharedState`: JSON, shaped `{ slots: Record<slotKey, childProfileId>,
  presence: string[] }`. `slots` is written only by the `claimCoopSlot`
  function-backed mutation (`amplify/functions/claim-coop-slot/`), which
  does an atomic, conditional DynamoDB write keyed on the specific slot
  path — never a plain client update, and never overwritten by a second
  claim once a slot is filled. `presence` (see below) is a plain,
  last-write-wins client update instead, since it carries no conflict risk
  worth the same guarantee.
- `startedAt`
- `completedAt`
- `lastActivityAt`

Each participant keeps their own `AdventureSession` and `AdventureAction`
trail (linked via `AdventureSession.coopSessionId`) so `SkillEvidence`/
`SkillProgress` stay attributed to whichever child actually performed the
action, per the existing per-child evidence model — `CoopSession` never
becomes the record of who learned what. In practice this means each
child's own `useAdventureSession` (`src/features/adventures/`) independently
writes its own `WorldChange` when *that child* reaches a shared
`WORLD_CHANGE` step, giving "one `WorldChange` per participating child"
without `CoopSession` itself needing any dual-write logic.

Presence (avatar position, join/leave) is intentionally not a stored
model: it is ephemeral UI state carried by a subscription on
`CoopSession` — specifically, `sharedState.presence` above, updated by
`src/features/coop/api.ts`'s `setCoopPresence` and observed by every
participant through the model's own generated `onUpdate` subscription — not
`AIInteractionAudit`- or `SafetyEvent`-relevant, since there is no
expressive content to audit. Per ADR-006, this is join/leave only, not
continuous avatar-position telemetry.

## AdventureAction
Store the minimum evidence required:
- `id`
- `sessionId`
- `stepId`
- `actionType`
- `normalizedAnswer` when needed
- `correctness`: correct, incorrect, partial, not_applicable
- `hintLevel`
- `attemptNumber`
- `durationMs` (optional; Phase 22 Interaction Engine "duration capture"
  deliverable — no caller before that phase measured or set it)
- `createdAt`

Avoid storing raw audio or unrestricted free text by default.

## SkillEvidence
- `id`
- `childProfileId`
- `sessionId`
- `learningObjectiveId`
- `evidenceType`
- `result`
- `difficulty`
- `supportLevel`
- `durationMs` (optional, same Phase 22 deliverable as `AdventureAction.durationMs`)
- `observedAt`

## SkillProgress
A compact derived record, owned by the Mastery Engine
(`src/features/mastery/`, docs/ROADMAP.md Phase 20):
- `id`
- `childProfileId`
- `learningObjectiveId`
- `exposureCount`
- `independentSuccessCount`
- `supportedSuccessCount`
- `recentLevel`: `SkillStatus` (`LOCKED | INTRODUCED | DEVELOPING | PROFICIENT | MASTERED`),
  computed by `src/features/mastery/status.ts`'s `computeSkillStatus`. A
  row's own stored value is never `LOCKED` — that status only exists at
  read time for skills with no evidence yet and unmet prerequisites (see
  `resolveSkillStatuses`); a row implies exposure, which is never locked.
- `consecutiveIndependentCorrect`: streak of unsupported correct results,
  most recent first; resets on any supported or incorrect/partial result.
- `errorPattern`: `ErrorPattern` (`NONE | NEEDS_SUPPORT | INCONSISTENT | STALLED`),
  a count-derived signal, computed by `src/features/mastery/errorPattern.ts`.
  Not a semantic misconception taxonomy.
- `lastPracticedAt`

Do not label children with fixed ability judgments. `recentLevel` is a
read-time, decayable signal (`applyReviewDecay`, `docs/ROADMAP.md` Phase
20's "review/decay rules"), not a permanent label: a status earned long
ago and not practiced recently is presented one level lower without ever
rewriting or discarding the underlying evidence.

A success only counts as independent (`independentSuccessCount`) when the
result is `correct` **and** no hint was used; a supported (hinted) correct
result counts toward `supportedSuccessCount` instead; an incorrect,
partial, or not-applicable result increments neither, only
`exposureCount`. (Before Phase 20, this distinction was based on hint
level alone rather than on `correctness`, which meant a final incorrect
answer on a step with no hint policy — and a story `REFLECTION` scene's
always-`not_applicable` result — were both miscounted as independent
successes; fixed as part of this phase since the fix lives in the exact
function this phase extends.)

## WorldChange
- `id`
- `childProfileId`
- `locationId`
- `changeType`
- `changeKey`
- `payload`
- `sourceSessionId`
- `createdAt`

Examples: bridge repaired, dragon hatched, garden planted, new path unlocked.

When a `CoopSession` completes, persist one `WorldChange` per participating
child (same `changeType`/`changeKey`/`payload`, each with its own
`childProfileId` and `sourceSessionId` pointing at that child's own
`AdventureSession`), so both children's islands reflect the shared outcome.
No shared or merged island world state is introduced.

## ChildWorldState

Added for the explorable-world roadmap
(`docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 26,
Phase 9+ in `docs/ROADMAP.md`). Separates permanent world progression (what
the child's island physically looks like — "My Island") from individual
story progress (`ChildStoryProgress`, below) and from the append-only
`WorldChange` event log, of which this is the derived, queryable current
view.

- `id`
- `childProfileId` — owner-scoped, one record per child
- `unlockedLocations`: array of location/region IDs
- `worldChanges`: array of `WorldChange.changeKey` currently in effect
- `discoveredObjects`: array of world-object IDs the child has interacted
  with at least once (roadmap section 17, "environmental curiosity")
- `discoveredCharacters`: array of NPC/character IDs met
- `completedStories`: array of `StoryDefinition.id`
- `updatedAt`

Deliberately avoids numeric experience points as the emotional center of
the product (roadmap section 27) — the world state itself, not a score, is
the record of achievement.

**Scoping note (Phase 26):** this model now exists in
`amplify/data/resource.ts`, scoped to exactly two of the fields listed
above:

```ts
ChildWorldState: {
  childProfileId, discoveredObjects, discoveredCharacters, updatedAt
}
```

`unlockedLocations`, `worldChanges`, and `completedStories` are deliberately
still *not* stored. They are fully derivable at read time from the existing
`WorldChange` and `ChildStoryProgress` records — Phase 16 uses that
derivation directly (`src/features/island/locations.ts`'s
`isLocationUnlocked`, fed by `listAllWorldChanges`), and a stored copy would
be a redundant, dual-write-risk duplicate of data that already exists
(CLAUDE.md section 13: no premature abstraction).

`discoveredObjects`/`discoveredCharacters` were the two fields that were not
derivable from anything, which is why Phase 16's note deferred the model
until "a real deliverable needs to remember what a child has already seen or
met". Phase 26 (Exploration and Secrets) is that deliverable:

- `discoveredObjects` holds authored `DiscoveryDefinition.id` values
  (`src/features/discovery/content/`), which are also the `discoveryKey`
  values a quest's `DISCOVER` objective names — one vocabulary rather than
  two, so a quest cannot name a key no secret produces.
- `discoveredCharacters` holds authored NPC ids, recorded when a child meets
  a character in an explorable scene. Distinct in job from `ChildNpcState`,
  which is the relationship and memory a *dialogue* builds up and is written
  only by the NPC engine.

Both columns are closed vocabularies validated on read (`parseKnownIds`,
`src/features/discovery/discovery.ts`) rather than trusted as stored, the
same treatment `ChildNpcState.memoryFlags` gets. That is what makes it
structurally impossible for this model to accumulate anything a child typed,
said, or drew (CLAUDE.md section 13); an id this build does not define is
dropped rather than surfaced. Deleted by `deleteChildProfileData` along with
every other per-child model.

## ChildStoryProgress

Long-form stories (Phase 12, Story Engine) span multiple play sessions and
need their own resumable progress record, distinct from the single-session
`AdventureSession`.

- `id`
- `childProfileId`
- `storyId` — a `StoryDefinition.id` (content-authored, not a DB model; see
  "Content packs" below)
- `currentChapterId`
- `completedChapterIds`: array
- `storyFlags`: JSON — bounded, authored flags only (for example, "dragon
  revealed as protective, not evil"), never free-form child text
- `startedAt`
- `lastPlayedAt`
- `completedAt` optional

Chatty may summarize prior chapters when a child resumes, but only from
these stored, authored flags and IDs — never from a persisted free-form
transcript (ADR-004 still applies inside stories).

### Content packs are not database models

`StoryDefinition`, `StoryChapter`, `StoryScene`, and map/tile data are
authored content, checked into source control (or later, a validated
content-pack format per roadmap sections 21–22), the same way
`AdventureTemplate`/`AdventureStepDefinition` content is today. They are
identified by stable string IDs that the models above reference, but are
never themselves rows a child or parent account can write.

## ChildNpcState

Per-child, per-NPC memory and friendship (Phase 23, Persistent NPC System).
One row per (child, NPC), created the first time a child talks to that
character.

- `id`
- `childProfileId`
- `npcId` — an `NpcDefinition.id` (content-authored, not a DB model; see
  "Content packs" above)
- `relationshipPoints`: integer — the source of truth for friendship
- `relationshipLevel`: `STRANGER | ACQUAINTANCE | FRIEND | TRUSTED_FRIEND`
  — derived from `relationshipPoints` and recomputed on every write, stored
  only so parent/admin reads do not need the threshold table
- `memoryFlags`: JSON — bounded, authored boolean flags only (for example
  `bridgeQuestCompleted`), never free-form child text, exactly the same
  constraint `ChildStoryProgress.storyFlags` carries
- `seenNodeIds`: array — dialogue nodes already reached, so one-time
  relationship awards stay one-time
- `firstMetAt`
- `lastInteractedAt`

Friendship is monotonic: `relationshipPoints` never decreases and a level
can never be lost, so a child who stops visiting is never penalized
(CLAUDE.md pillar 7, calm engagement). Clearing this data is a parent-facing
retention action (`clearNpcState`), never a game mechanic.

Authored `NpcDefinition`, `DialogueNode`, and `NpcQuestOffer` content are
content packs, not database models, under the same rule as
`StoryDefinition` above.

## ChildInventory

A child's backpack (Phase 24, Reward/Economy Engine). One row per child,
created the first time anything is granted.

- `id`
- `childProfileId`
- `ownedItemIds`: array — authored `ItemDefinition.id` strings
- `grantedRuleIds`: array — `RewardRule.id`s that have already fired for
  this child
- `updatedAt`

`ownedItemIds` is a **set**, not a quantity map: an item is owned or it is
not. That rules out duplicate-farming and "you need 47 more" grind by
construction. Phase 25's `COLLECT` quest primitive counts distinct items in
a set rather than stacks of one item, which is the same thing a child
actually experiences ("find all five shells") without the grind.

`grantedRuleIds` is the engine's idempotency key: `grantRewards` skips a
rule that already fired, so replaying an adventure grants nothing a second
time and shows no second celebration.

Nothing is ever removed from `ownedItemIds` by gameplay. There is no
currency, no sink, no consumption, no trading, and no expiry, so no child
can be made to feel poorer than another
(`docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 19:
"avoid systems designed around envy, rarity pressure, or leaderboards").
`clearInventory` is a parent-facing retention action, never a game mechanic.

Deliberately one row per child rather than one row per item: a backpack is
read whole every time it is shown, and a child owns tens of items rather
than thousands. Revisit if items ever become numerous enough to page.

Authored `ItemDefinition`, `CollectibleSet`, and `RewardTable` content are
content packs, not database models, under the same rule as
`StoryDefinition` above. An `ItemDefinition` deliberately has no learning
objective field: per the roadmap's Phase 24 design rule, "some treasure is
simply treasure."

## AIInteractionAudit
Metadata only by default:
- `id`
- `childProfileId` pseudonymous reference
- `sessionId`
- `stepId`
- `routeName`
- `promptTemplateVersion`
- `modelId`
- `inputCategory`
- `outputSchemaVersion`
- `validationStatus`
- `safetyDisposition`
- `fallbackUsed`
- `latencyMs`
- timestamp

## SafetyEvent
- `id`
- `sessionId`
- `category`
- `severity`
- `source`: input, output, system
- `actionTaken`
- `reviewStatus`
- timestamps

Sensitive content should be redacted or stored separately with strict retention only when genuinely necessary for review.

