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
- `startedAt`
- `completedAt`
- `lastActivityAt`

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

