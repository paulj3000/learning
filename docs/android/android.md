# Learning Adventure Island
# Amplify Gen 2 Platform Roadmap for Android Integration

## Purpose

This roadmap describes how to evolve the existing Learning Adventure Island Amplify Gen 2 website/backend into a shared application platform that supports both:

- the existing web client
- a new native Android client

The central architectural rule is:

> **Amplify Gen 2 is the source of truth. The website and Android application are clients of the same platform.**

The Android application should not scrape, proxy through, or depend on the website itself for learning content. Both clients should connect directly to the same authentication, data, APIs, storage, game state, learning state, and server-side business logic.

---

# 1. Target Architecture

```text
                         Learning Adventure Island
                                Platform
                                   |
                 +-----------------+-----------------+
                 |                                   |
            Web Client                         Android Client
         React + Three.js                  Kotlin + Jetpack Compose
                 |                                   |
                 +-----------------+-----------------+
                                   |
                             Amplify Gen 2
                                   |
        +-------------+------------+------------+-------------+
        |             |            |            |             |
      Cognito       AppSync      Lambda         S3        Event Layer
       Auth          Data       Functions      Assets       / Jobs
        |             |            |            |
        +-------------+------------+------------+
                                   |
                         Shared Platform State
                                   |
      +-------------------------------------------------------+
      | Users / Children / Learning / Quests / Inventory     |
      | Stories / World State / Progress / Rewards / Assets  |
      +-------------------------------------------------------+
```

---

# 2. Core Platform Principles

The backend should be designed around the following rules.

## 2.1 One backend, multiple clients

The web and Android clients must use the same:

- Cognito identities
- child profiles
- learning records
- progress
- inventory
- rewards
- quests
- stories
- world definitions
- assets
- APIs
- server-side rules

Do not create a separate Android database or Android-only backend.

---

## 2.2 Clients render, backend decides

Clients should handle:

- presentation
- animations
- input
- navigation
- local caching
- device-specific rendering

The backend should own:

- learning progression
- XP awards
- quest completion
- inventory changes
- unlock conditions
- mastery calculations
- adaptive learning decisions
- authoritative world progression

---

## 2.3 Content is data

Learning content should not live primarily inside React components.

Move reusable content into Amplify-backed models or versioned content files.

Examples:

- lessons
- vocabulary
- math problems
- stories
- quests
- NPC dialogue
- reward definitions
- world definitions
- asset metadata

---

## 2.4 Web is no longer special

The existing website becomes one client among several.

Future clients may include:

- Android
- iOS/iPadOS
- desktop
- TV
- classroom kiosk

Avoid backend assumptions that requests originate from React.

---

# 3. Phase 0 — Platform Audit

## Objective

Identify which parts of the existing project are currently embedded in the web frontend and must become shared platform services.

## Tasks

- Audit all current Amplify Gen 2 resources.
- Audit `amplify/auth`.
- Audit `amplify/data`.
- Audit Lambda functions.
- Audit S3/storage usage.
- Audit all learning data currently hardcoded in React.
- Audit quest logic currently implemented in the browser.
- Audit XP/reward calculations.
- Audit player progression logic.
- Audit Three.js world definitions.
- Audit GLB and media asset paths.
- Audit parent/child account relationships.
- Audit authorization rules.
- Document current API endpoints and GraphQL operations.

## Deliverable

Create:

```text
docs/platform/CURRENT_PLATFORM_AUDIT.md
```

The audit should classify each feature as:

```text
CLIENT_ONLY
SHARED_DATA
SERVER_LOGIC
STATIC_ASSET
NEEDS_MIGRATION
```

## Acceptance Criteria

- Every major feature has an identified owner.
- Web-only business logic has been identified.
- Shared data requirements are documented.
- Android blockers are identified before implementation begins.

---

# 4. Phase 1 — Establish the Platform Boundary

## Objective

Separate the Amplify backend conceptually from the web application.

## Recommended Structure

```text
learning-adventure-island/
├── amplify/
│   ├── auth/
│   ├── data/
│   ├── functions/
│   ├── storage/
│   └── backend.ts
│
├── src/
│   └── web application
│
├── docs/
│   └── platform/
│
└── package.json
```

## Rules

No backend function should assume:

```text
React
Three.js
browser localStorage
browser cookies
DOM APIs
```

Use platform-neutral inputs and outputs.

For example:

Bad:

```text
POST /api/web/completeLesson
```

Preferred:

```text
completeActivity(activityId, childId)
```

## Acceptance Criteria

- Backend business logic is client-neutral.
- Shared APIs have platform-neutral naming.
- Android can call backend APIs without browser dependencies.

---

# 5. Phase 2 — Canonical Identity Model

## Objective

Separate Cognito authentication from Learning Adventure Island application identity.

## Model

```text
Cognito User
     |
     v
ParentAccount
     |
     +----------------------+
     |                      |
     v                      v
ChildProfile              ChildProfile
     |                      |
     v                      v
PlayerProfile             PlayerProfile
```

## Suggested Models

```text
ParentAccount
ChildProfile
PlayerProfile
DeviceRegistration
```

## ParentAccount

Suggested fields:

```text
id
ownerUserId
displayName
email
createdAt
updatedAt
```

## ChildProfile

Suggested fields:

```text
id
parentAccountId
displayName
avatarId
ageBand
gradeBand
active
createdAt
updatedAt
```

## PlayerProfile

Suggested fields:

```text
id
childProfileId
level
xp
coins
currentWorldId
currentZoneId
lastPlayedAt
createdAt
updatedAt
```

## Important Rule

Do not store most gameplay information inside Cognito attributes.

Cognito identifies the account.

Amplify Data stores application state.

## Acceptance Criteria

- A Cognito user may own multiple child profiles.
- Each child has independent learning and gameplay state.
- Both web and Android resolve the same child identity.

---

# 6. Phase 3 — Canonical Learning Content Model

## Objective

Move learning knowledge into shared backend models.

## Suggested Hierarchy

```text
Subject
  |
Course
  |
Unit
  |
Lesson
  |
Activity
  |
Question
```

## Suggested Models

```text
Subject
Course
Unit
Lesson
Activity
Question
AnswerOption
LearningObjective
Skill
```

## Example Lesson

```json
{
  "id": "lesson-math-001",
  "title": "Multiplication Basics",
  "subject": "MATH",
  "gradeBand": "GRADE_3_4",
  "difficulty": 2
}
```

## Example Activity

```json
{
  "id": "activity-math-001",
  "lessonId": "lesson-math-001",
  "type": "MULTIPLE_CHOICE",
  "prompt": "What is 7 × 6?",
  "rewardXp": 15
}
```

## Content Types

Support activities such as:

```text
MULTIPLE_CHOICE
TRUE_FALSE
NUMBER_ENTRY
WORD_ENTRY
MATCHING
SORTING
LISTEN_AND_SELECT
READ_AND_RESPOND
INTERACTIVE_WORLD
NPC_DIALOGUE
PUZZLE
```

## Acceptance Criteria

- The web client can render backend-defined lessons.
- Android can retrieve the same lessons.
- Learning content is no longer duplicated per client.

---

# 7. Phase 4 — Learning State and Mastery Models

## Objective

Store durable learning progress independent of device.

## Suggested Models

```text
LessonProgress
ActivityAttempt
SkillMastery
LearningSession
LearningEvent
```

## LessonProgress

Suggested fields:

```text
id
childProfileId
lessonId
status
startedAt
completedAt
score
attemptCount
lastActivityId
```

## SkillMastery

Suggested fields:

```text
id
childProfileId
skillId
masteryScore
confidence
lastPracticedAt
nextReviewAt
```

## LearningEvent

Suggested fields:

```text
id
childProfileId
eventType
lessonId
activityId
skillId
value
deviceId
createdAt
```

Examples:

```text
LESSON_STARTED
ACTIVITY_STARTED
QUESTION_ANSWERED
ANSWER_CORRECT
ANSWER_INCORRECT
HINT_REQUESTED
LESSON_COMPLETED
SKILL_MASTERED
```

## Acceptance Criteria

- Progress follows the child between web and Android.
- Learning state does not depend on browser storage.
- Adaptive learning has durable server-side inputs.

---

# 8. Phase 5 — Adventure and Quest Data Model

## Objective

Make adventures and quests shared platform resources.

## Suggested Models

```text
Adventure
Quest
QuestObjective
QuestReward
PlayerAdventure
PlayerQuest
```

## Adventure

Suggested fields:

```text
id
title
description
worldId
minimumLevel
storyId
active
```

## Quest

Suggested fields:

```text
id
adventureId
title
description
questType
requiredLevel
prerequisiteQuestIds
rewardDefinitionId
```

## QuestObjective

Suggested fields:

```text
id
questId
objectiveType
targetId
requiredCount
sequence
```

Objective types may include:

```text
COMPLETE_LESSON
ANSWER_CORRECTLY
COLLECT_ITEM
VISIT_LOCATION
TALK_TO_NPC
DEFEAT_CREATURE
SOLVE_PUZZLE
DISCOVER_SECRET
```

## Acceptance Criteria

- Android and web receive the same quest structure.
- Quest state is stored server-side.
- Quest completion cannot be forged by simply editing client state.

---

# 9. Phase 6 — Server-Authoritative Gameplay Actions

## Objective

Move sensitive game-state mutations out of the client.

## Create Backend Operations

Examples:

```text
startAdventure()
startQuest()
completeQuestObjective()
completeActivity()
submitAnswer()
awardReward()
unlockZone()
grantInventoryItem()
spendCoins()
equipItem()
```

## Pattern

```text
Client
   |
   v
Backend Operation
   |
   +--> validate request
   |
   +--> read player state
   |
   +--> apply rules
   |
   +--> persist changes
   |
   +--> record event
   |
   v
Response
```

## Example

Instead of:

```javascript
player.xp += 100
```

use:

```text
completeQuestObjective(...)
    |
    v
Backend validates objective
    |
    v
Reward Engine
    |
    +--> XP
    +--> coins
    +--> inventory
    +--> unlocks
```

## Acceptance Criteria

- Clients cannot directly award themselves major rewards.
- Rewards are calculated server-side.
- Gameplay transactions are auditable.

---

# 10. Phase 7 — Inventory and Reward Platform

## Objective

Create one inventory system shared by all clients.

## Suggested Models

```text
ItemDefinition
PlayerInventoryItem
RewardDefinition
AchievementDefinition
PlayerAchievement
```

## ItemDefinition

Fields may include:

```text
id
name
description
itemType
rarity
assetId
stackable
tradable
metadata
```

## Item Types

```text
CLOTHING
TOOL
PET
MOUNT
KEY
QUEST_ITEM
COLLECTIBLE
DECORATION
CONSUMABLE
BOOK
BADGE
```

## Acceptance Criteria

- Items earned on web appear on Android.
- Inventory changes are server-authoritative.
- Asset references are platform-independent.

---

# 11. Phase 8 — Shared World Definition

## Objective

Move world structure out of Three.js-specific code where practical.

## Suggested Models

```text
WorldDefinition
ZoneDefinition
LocationDefinition
SpawnDefinition
NPCDefinition
PortalDefinition
InteractionDefinition
```

## Example

```json
{
  "id": "dragon-mountain",
  "name": "Dragon Mountain",
  "locations": [
    "wizard-tower",
    "lava-bridge",
    "dragon-cave"
  ]
}
```

## Rendering Separation

```text
World Definition
      |
      +-------------------+
      |                   |
      v                   v
 Three.js Web        Android Renderer
```

The data defines:

- what exists
- where it exists
- what it does

The client renderer defines:

- shaders
- lighting
- camera
- animation quality
- effects
- controls

## Acceptance Criteria

- The same zone definition can be interpreted by both clients.
- World progression is not tied to Three.js implementation details.

---

# 12. Phase 9 — Shared Asset Catalog

## Objective

Create a centralized asset system for GLB files, textures, audio, images, and other media.

## S3 Structure

```text
assets/
├── characters/
├── creatures/
├── buildings/
├── environments/
├── props/
├── collectibles/
├── animations/
├── audio/
├── music/
├── textures/
└── ui/
```

## Asset Model

Suggested fields:

```text
id
name
assetType
s3Key
version
checksum
fileSize
platform
qualityLevel
metadata
createdAt
updatedAt
```

## Asset Types

```text
GLB
TEXTURE
IMAGE
AUDIO
MUSIC
VIDEO
ANIMATION
JSON
```

## Device Variants

Example:

```text
dragon-high.glb
dragon-medium.glb
dragon-low.glb
```

Metadata:

```text
WEB_DESKTOP -> high
ANDROID_TABLET -> medium
ANDROID_PHONE -> low/medium
```

## Acceptance Criteria

- Web and Android reference assets by asset ID.
- Asset URLs are not hardcoded throughout clients.
- Assets support versioning and quality tiers.

---

# 13. Phase 10 — Content Manifest and Incremental Updates

## Objective

Allow mobile clients to efficiently determine what content has changed.

## Create ContentManifest

Suggested structure:

```json
{
  "manifestVersion": 42,
  "contentSchemaVersion": 4,
  "worldSchemaVersion": 3,
  "generatedAt": "2026-08-24T00:00:00Z"
}
```

Include version information for:

```text
lessons
stories
quests
worlds
zones
assets
NPC dialogue
reward definitions
```

## Android Flow

```text
Android local manifest: 41
          |
          v
Server manifest: 42
          |
          v
Request delta
          |
          v
Download changed content only
```

## Acceptance Criteria

- Mobile does not redownload the entire content library on every launch.
- Manifest changes are deterministic.
- Clients can cache content safely.

---

# 14. Phase 11 — API Versioning

## Objective

Protect installed mobile applications from backend changes.

Unlike the website, Android versions may remain installed for months.

## Create Platform Configuration

Example:

```json
{
  "apiVersion": 3,
  "minimumAndroidVersion": "1.2.0",
  "recommendedAndroidVersion": "1.5.0",
  "minimumWebVersion": null,
  "contentSchemaVersion": 4,
  "worldSchemaVersion": 3
}
```

## Version Rules

Breaking changes require:

```text
new API version
or
backward-compatible resolver
```

Never silently change response formats expected by released Android versions.

## Acceptance Criteria

- Backend can identify unsupported Android versions.
- Android clients receive actionable upgrade information.
- API schema changes have a compatibility strategy.

---

# 15. Phase 12 — Authorization Review

## Objective

Rework Amplify authorization rules for a multi-client environment.

## Data Classification

Every model should be classified as one or more of:

```text
PUBLIC
AUTHENTICATED
OWNER
PARENT
CHILD
ADMIN
SYSTEM
```

## Example Policies

### Lesson

```text
Authenticated users: read
Admins: create/update/delete
```

### ChildProfile

```text
Parent owner: read/write
System: read/write
```

### PlayerProgress

```text
Parent: read
Child session: read
Backend services: write
```

### RewardDefinition

```text
Authenticated users: read
Admins: write
```

### PlayerInventory

```text
Child/Parent: read
Backend: mutation authority
```

## Acceptance Criteria

- No privileged mutation depends merely on being authenticated.
- Parent-child ownership is enforced server-side.
- Android and web use identical authorization rules.

---

# 16. Phase 13 — Device Registration

## Objective

Track clients without making device identity the source of truth.

## Suggested Model

```text
DeviceRegistration
```

Fields:

```text
id
userId
childProfileId
deviceId
platform
appVersion
lastSeenAt
pushToken
active
```

Platforms:

```text
WEB
ANDROID
IOS
```

## Uses

- app-version tracking
- telemetry
- sync debugging
- push notifications
- security review
- stale-device cleanup

## Acceptance Criteria

- Devices can be registered and revoked.
- Player identity remains account-based, not device-based.

---

# 17. Phase 14 — Cross-Device Synchronization

## Objective

Ensure progress is consistent when children switch between devices.

## Example

```text
Web
 |
 | complete quest
 v
Amplify
 |
 | persist PlayerQuest
 | award reward
 | update progression
 v
Android opens
 |
 v
reads latest state
```

## Synchronize

```text
lesson progress
skill mastery
XP
levels
coins
quests
adventures
inventory
achievements
world unlocks
avatar
settings
```

## Recommended Strategy

Server should remain authoritative.

Local clients may cache state but should reconcile with the backend.

## Acceptance Criteria

- Completing content on web appears on Android.
- Completing content on Android appears on web.
- Duplicate event processing is idempotent.

---

# 18. Phase 15 — Offline-Safe API Design

## Objective

Prepare backend APIs for Android offline mode.

Android may queue actions while offline.

## Require Idempotency

Example request:

```json
{
  "requestId": "device-generated-uuid",
  "childProfileId": "child-123",
  "activityId": "activity-456",
  "answer": "42"
}
```

If Android retries the request, the backend should recognize the same `requestId`.

## Avoid

```text
duplicate XP
duplicate rewards
duplicate quest completion
duplicate purchases
```

## Suggested Models

```text
ProcessedCommand
ClientSyncCheckpoint
```

## Acceptance Criteria

- Safe retry semantics exist.
- Duplicate queued operations do not duplicate rewards.
- Sync conflicts are documented.

---

# 19. Phase 16 — Event Architecture

## Objective

Standardize events generated by web and Android.

## Example Event Types

```text
SESSION_STARTED
SESSION_ENDED
LESSON_STARTED
LESSON_COMPLETED
QUESTION_ANSWERED
QUEST_STARTED
QUEST_COMPLETED
ITEM_COLLECTED
LOCATION_DISCOVERED
NPC_INTERACTION
ACHIEVEMENT_EARNED
```

## Event Envelope

```json
{
  "eventId": "uuid",
  "eventType": "QUESTION_ANSWERED",
  "childProfileId": "child-123",
  "deviceId": "android-xyz",
  "source": "ANDROID",
  "timestamp": "2026-08-24T18:00:00Z",
  "payload": {}
}
```

## Uses

- adaptive learning
- analytics
- progress tracking
- recommendations
- debugging
- parent reports

## Acceptance Criteria

- Web and Android emit the same event vocabulary.
- Event payloads are versioned.
- Sensitive child information is minimized.

---

# 20. Phase 17 — Adaptive Learning Service

## Objective

Move adaptive learning decisions behind shared APIs.

## Inputs

```text
recent answers
skill mastery
attempt history
response time
hints
difficulty
lesson completion
review schedule
```

## Outputs

```text
next lesson
next activity
difficulty adjustment
review recommendation
quest integration
NPC teaching prompt
```

## Example API

```text
getNextLearningActivity(childProfileId)
```

Response:

```json
{
  "activityId": "activity-902",
  "reason": "REVIEW_WEAK_SKILL",
  "difficulty": 3
}
```

## Acceptance Criteria

- Web and Android receive the same adaptive decisions.
- Recommendation logic is not duplicated in clients.

---

# 21. Phase 18 — Parent Platform APIs

## Objective

Make parent features available independently from the website.

Potential Android parent features may later use the same platform.

## Shared Parent Data

```text
child progress
learning time
recent achievements
mastery overview
course progress
settings
content restrictions
notifications
```

## Backend Operations

Examples:

```text
getChildDashboard()
getWeeklyProgress()
updateChildSettings()
setLearningGoals()
```

## Acceptance Criteria

- Parent functionality can be consumed by any authorized client.
- Parent authorization is enforced server-side.

---

# 22. Phase 19 — Environment Strategy

## Objective

Ensure Android never accidentally points to the wrong Amplify backend.

## Environments

```text
development
staging
production
```

## Mapping

```text
Web local
    -> Amplify development

Android debug
    -> Amplify development

Android QA
    -> Amplify staging

Web staging
    -> Amplify staging

Play Store
    -> Amplify production

Production website
    -> Amplify production
```

## Acceptance Criteria

- Each build clearly identifies its environment.
- Production data cannot be accessed accidentally by development builds.

---

# 23. Phase 20 — Generated Client Configuration

## Objective

Create a repeatable way for Android to obtain the correct Amplify configuration.

Use Amplify Gen 2 client outputs generated from the existing backend.

Example process:

```bash
npx ampx generate outputs \
  --app-id <AMPLIFY_APP_ID> \
  --branch <BRANCH_NAME> \
  --out-dir <ANDROID_OUTPUT_DIRECTORY>
```

Do not manually maintain duplicated:

```text
AppSync endpoints
Cognito IDs
Identity Pool IDs
S3 bucket names
regions
```

## Acceptance Criteria

- Android configuration can be regenerated automatically.
- Environment-specific configuration is reproducible.

---

# 24. Phase 21 — Cross-Platform Contract Tests

## Objective

Prevent one client from silently breaking the other.

## Required Tests

### Authentication

```text
Web-created account -> Android login succeeds
Android-created session -> backend identity resolves
```

### Child profiles

```text
Web creates child -> Android sees child
Android updates permitted field -> web sees update
```

### Learning

```text
Android completes lesson -> web sees completion
Web completes lesson -> Android sees completion
```

### Inventory

```text
Web earns item -> Android inventory contains item
Android equips item -> web reflects equipped item
```

### Quests

```text
Android completes objective -> web quest state updates
```

### World

```text
Web unlocks zone -> Android sees zone unlocked
```

## Acceptance Criteria

These become release-blocking integration tests.

---

# 25. Phase 22 — Observability

## Objective

Make multi-client problems diagnosable.

## Record

```text
requestId
eventId
userId
childProfileId
deviceId
platform
appVersion
API version
function name
result
error code
duration
```

## Dashboards

Track:

```text
API errors by platform
authentication failures
sync failures
Lambda latency
AppSync errors
asset failures
content-manifest failures
unsupported app versions
```

## Acceptance Criteria

- Production issues can be filtered by Android vs web.
- Cross-device sync failures are traceable.

---

# 26. Phase 23 — Performance and Cost Review

## Objective

Optimize Amplify usage for mobile traffic.

Review:

```text
GraphQL query sizes
nested queries
pagination
subscriptions
Lambda cold starts
S3 asset sizes
image sizes
GLB sizes
content caching
CloudFront behavior
```

## Mobile Optimization

Prefer APIs that return exactly what the screen needs.

Avoid loading:

```text
entire worlds
entire lesson libraries
full inventory history
all event history
```

when only a summary is required.

## Acceptance Criteria

- Major Android screens use bounded queries.
- Large data sets are paginated.
- Assets have mobile-appropriate sizes.

---

# 27. Phase 24 — Security Hardening

## Objective

Assume released Android applications can be inspected and modified.

Never trust the client for:

```text
XP values
currency awards
quest completion
inventory grants
premium unlocks
skill mastery
achievement qualification
```

## Security Controls

Implement:

```text
server-side validation
least-privilege authorization
rate limits where appropriate
idempotency
audit events
input validation
ownership validation
resource-level authorization
```

## Acceptance Criteria

- Modifying Android local state cannot permanently alter authoritative progress.
- Sensitive operations are validated in backend functions.

---

# 28. Phase 25 — Migration of Existing Web Content

## Objective

Move current website knowledge into the platform without breaking the existing experience.

## Migration Order

Recommended order:

```text
1. learning content
2. stories
3. quests
4. rewards
5. inventory definitions
6. NPC definitions
7. world definitions
8. asset catalog
```

For each migration:

```text
Hardcoded web data
      |
      v
Amplify model/content store
      |
      +----------------+
      |                |
      v                v
Web Client        Android Client
```

## Acceptance Criteria

- No major content set has separate web and Android copies.
- Web behavior remains functional throughout migration.

---

# 29. Phase 26 — Web Client Refactor

## Objective

Prove the shared platform architecture by having the existing web client consume it.

Replace direct frontend business logic with shared APIs.

Examples:

Before:

```text
React computes reward
React unlocks quest
React chooses next lesson
```

After:

```text
React calls backend
Backend computes result
React renders result
```

## Acceptance Criteria

- Web uses the same APIs intended for Android.
- Platform behavior is validated before Android depends on it.

---

# 30. Phase 27 — Android Readiness Gate

Do not begin full Android feature development until the platform satisfies this checklist.

## Required

- [ ] Shared authentication works.
- [ ] Parent and child identity models exist.
- [ ] Learning content is available through shared APIs.
- [ ] Lesson progress is persisted server-side.
- [ ] Quest models exist.
- [ ] Reward mutations are server-authoritative.
- [ ] Inventory is backend-managed.
- [ ] Shared asset catalog exists.
- [ ] API versioning exists.
- [ ] Content manifest exists.
- [ ] Android configuration can be generated.
- [ ] Cross-device integration tests exist.
- [ ] Dev/staging/prod environments are separated.
- [ ] Idempotent mobile mutation strategy exists.

---

# 31. Recommended Implementation Sequence

The following order minimizes rework.

```text
Phase 0   Platform audit
Phase 1   Platform boundary
Phase 2   Identity model
Phase 3   Learning content
Phase 4   Learning progress
Phase 5   Adventures and quests
Phase 6   Server-authoritative actions
Phase 7   Inventory and rewards
Phase 8   Shared world schema
Phase 9   Asset catalog
Phase 10  Content manifest
Phase 11  API versioning
Phase 12  Authorization review
Phase 13  Device registration
Phase 14  Cross-device sync
Phase 15  Offline-safe APIs
Phase 16  Event architecture
Phase 17  Adaptive learning
Phase 18  Parent APIs
Phase 19  Environments
Phase 20  Generated client config
Phase 21  Contract tests
Phase 22  Observability
Phase 23  Performance
Phase 24  Security hardening
Phase 25  Content migration
Phase 26  Web refactor
Phase 27  Android readiness gate
```

---

# 32. Suggested Documentation Additions

Add the following files to the repository:

```text
docs/platform/
├── ANDROID_PLATFORM_INTEGRATION_ROADMAP.md
├── PLATFORM_ARCHITECTURE.md
├── PLATFORM_API_CONTRACT.md
├── CONTENT_MODEL.md
├── LEARNING_STATE_MODEL.md
├── ADVENTURE_DATA_MODEL.md
├── WORLD_SCHEMA.md
├── ASSET_PIPELINE.md
├── AUTHORIZATION_MODEL.md
├── SYNC_STRATEGY.md
├── API_VERSIONING.md
├── OFFLINE_COMMAND_MODEL.md
└── CROSS_PLATFORM_TESTING.md
```

---

# 33. Definition of Done

The Amplify Gen 2 platform is ready for Android when:

1. The website is no longer the source of truth for learning content or gameplay state.
2. Amplify owns authoritative application data.
3. Android can authenticate against the same Cognito environment.
4. Android can retrieve the same child profiles as the web client.
5. Android can retrieve lessons, adventures, quests, worlds, and assets.
6. Android can submit learning actions through server-controlled APIs.
7. Progress synchronizes across web and Android.
8. Rewards and inventory cannot be forged by clients.
9. API and content schemas are versioned.
10. Mobile clients can safely cache and retry operations.
11. Production observability distinguishes client platform and app version.
12. The web client itself has been refactored to use the same platform APIs.

---

# Final Architecture Principle

The desired end state is:

```text
                    Learning Adventure Island Platform
                                   |
             +---------------------+---------------------+
             |                                           |
         Web Client                                  Android App
             |                                           |
             +---------------------+---------------------+
                                   |
                         Shared Amplify Gen 2 Backend
                                   |
        +--------------------------+--------------------------+
        |             |             |            |           |
      Cognito       AppSync       Lambda         S3       Events
        |             |             |            |           |
        +--------------------------+--------------------------+
                                   |
                            Shared Game State
                                   |
                +------------------+------------------+
                |                  |                  |
             Learning           Adventure           World
                |                  |                  |
             Progress            Quests            Assets
             Mastery             Rewards           NPCs
             Lessons             Inventory         Zones
```

The website and Android application may look and behave differently, but they should always operate on the same underlying Learning Adventure Island universe.

