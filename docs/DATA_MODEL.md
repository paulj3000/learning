# Initial Data Model

This is a conceptual schema. Claude should translate it into Amplify Gen 2 TypeScript and verify relationship/index syntax against the installed Amplify packages.

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
model needs no authorization primitive beyond the owner rule every other
model already uses.

- `id`
- `hostParentProfileId` — owner; the one `ParentProfile` shared by every
  participant
- `templateId`
- `templateVersion`
- `participantChildProfileIds`: array, 2 for v1
- `status`: active, completed, abandoned
- `sharedState`: JSON — the merged, validated puzzle state (for example,
  which slots are filled and by which child). Written only by the
  deterministic engine from validated `AdventureAction`s, never directly
  from client input.
- `startedAt`
- `completedAt`
- `lastActivityAt`

Each participant keeps their own `AdventureSession` and `AdventureAction`
trail (linked via `coopSessionId`) so `SkillEvidence`/`SkillProgress` stay
attributed to whichever child actually performed the action, per the
existing per-child evidence model — `CoopSession` never becomes the record
of who learned what.

Presence (avatar position, join/leave) is intentionally not a stored model:
it is ephemeral UI state carried by a subscription on `CoopSession`, not
`AIInteractionAudit`- or `SafetyEvent`-relevant, since there is no
expressive content to audit.

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
A compact derived record:
- `id`
- `childProfileId`
- `learningObjectiveId`
- `exposureCount`
- `independentSuccessCount`
- `supportedSuccessCount`
- `recentLevel`
- `lastPracticedAt`

Do not label children with fixed ability judgments.

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

