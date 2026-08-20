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
| `AIInteractionAudit` | AI Tutor Engine |
| `SafetyEvent` | Cross-cutting safety pipeline (`docs/AI_AND_CHILD_SAFETY.md`), not exclusive to any one engine |

The Interaction Engine (Phase 22), Reward/Economy Engine (Phase 24), and
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
- `interests`: string array from curated values
- `readingMode`: `VOICE_FIRST | READ_ALONG | INDEPENDENT`
- `sessionMinutes`
- `active`
- timestamps

Authorization: owning parent. Child-facing client access occurs within the authenticated parent session and must be constrained by application routes.

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

**Scoping note (Phase 16, first slice):** this model is still not
implemented as an actual `amplify/data/resource.ts` schema entry.
`unlockedLocations`, `worldChanges`, and `completedStories` are already
fully derivable at read time from the existing `WorldChange` and
`ChildStoryProgress` records — Phase 16's first slice (location unlocking,
proved via a new gated `dragons-sanctuary` location) uses that derivation
directly (`src/features/island/locations.ts`'s `isLocationUnlocked`,
fed by `listAllWorldChanges`) rather than adding a model that would just be
a redundant, dual-write-risk copy of data that already exists (CLAUDE.md
section 13: no premature abstraction). The two fields here that are *not*
yet derivable from anything are `discoveredObjects`/`discoveredCharacters`
— no `OBJECT`/`DISCOVERY`/`NPC` interaction tap is persisted anywhere today,
each is stateless flavor text. Add this model, scoped to just those two
fields, once a real deliverable needs to remember what a child has already
seen or met.

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

