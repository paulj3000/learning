# Game Engine Core: public contracts

- **Status:** Proposed (v1 contracts published on `core/gameengine`; changes go through the GE-004 card)
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-053, ADR-060, ADR-063
- **Related tickets:** GE-004, GE-005, GE-007, GE-100 to GE-110
- **Canonical sources:** `game/src/contracts/*.ts` (the code is the contract; this page explains it), `tests/contracts/gameplay-events-v1.json`, [scoring standard](../../adventures/scoring-standard.md)

## 1. Versioning

| Interface | Version | Where |
|---|---|---|
| Package API | `ENGINE_API_VERSION` `0.1.0` | `game/src/version.ts`, `game/package.json` |
| Gameplay claims | `lai.gameplay-event` v1 | `game/src/contracts/gameplayEvents.ts` |
| Capability configs | Semver per capability (`definition.version`) | Each capability definition |

- **Additive** (new optional field, new event type, new capability, new export): minor bump,
  same contract version. Consumers ignore event types they do not handle.
- **Breaking** (remove or rename a field, change a meaning, make a field required): a new
  contract version beside the old one (v2 with v1), a migration note here, and every consumer
  updated in the same pull request.
- While the package is `0.x`, the `react` dependency names the exact version.

## 2. Gameplay claims v1 (`lai.gameplay-event`)

Facts the engine reports for Django to confirm. **Claims, never awards.**

```ts
interface GameplayEvent<T> {
  schema: 'lai.gameplay-event';
  version: 1;
  type: T;
  eventId: string;          // unique per emission; transport dedupe only
  occurredAt: string;       // ISO 8601 UTC ending in Z
  sessionRef: string | null; // Django AdventureSession UUID
  realmId: string;
  adventureId: string;
  areaId: string | null;
  payload: GameplayEventPayloads[T];
}
```

| Family | Type | Payload |
|---|---|---|
| Learning questions | `learning.question.presented` | `learningRef` |
| | `learning.answer.submitted` | `learningRef`, `choiceId` (authored option id or null) |
| Exploration | `exploration.area.entered` | `areaId` |
| | `exploration.discovery.found` | `discoveryId` |
| Collectibles | `collectible.collected` | `collectibleId`, `setId` or null, optional `pickupKey` (server pickup change key) or null |
| Jump challenges | `jump.challenge.started` | `challengeId` |
| | `jump.challenge.completed` | `challengeId`, `routeId` (jump **or** accessible route) |
| | `jump.alternative.used` | `challengeId`, `routeId` (informational only) |
| Platform courses | `course.checkpoint.reached` | `courseId`, `checkpointId` |
| | `course.completed` | `courseId`, `goalId` |
| Puzzles | `puzzle.completed` | `puzzleId` |
| NPCs | `npc.interaction.completed` | `npcId`, `interactionId` |
| Quests | `quest.step.completed` | `questId`, `stepId` |
| | `quest.completed` | `questId` |
| Adventures | `adventure.started`, `adventure.completed` | (empty) |
| Realm milestones | `realm.milestone.reached` | `milestoneId` |

`learningRef` is exactly one of `ADVENTURE_STEP {stepId}`, `CHEST_CHALLENGE {chestEntityId,
challengeAttemptId}`, `AREA_PUZZLE {puzzleId, challengeAttemptId}` or `QUESTION_ITEM {questionId,
challengeAttemptId}`. These are the ids Django already grades against.

Rules (agreed with the GE-100 scoring lead, 2026-11-18):

1. Semantic ids only (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`). No spaces, so no free text.
2. No child data. Envelope and payload are **strict**: an unknown key fails validation.
3. The engine never grades learning: no `correct`, score, support level, attempt index,
   difficulty or age band. Django holds those.
4. A jump challenge completed by its accessible route is the **same** claim with that route's
   id. Consumers must never value it lower.
5. Falls and respawns are not claims. They can never cost anything.
6. `eventId` dedupes transport only. Award idempotency belongs to the consumer, keyed on the
   source record.

Chests: opening a chest is not a claim. The host reports the child's answer with
`ChestsApi.submitAnswer`, which emits `learning.answer.submitted` with a `CHEST_CHALLENGE`
learning ref. `exploration.discovery.found` is for authored discoveries only.

Golden vectors `tests/contracts/gameplay-events-v1.json` are shared by the TypeScript validator and
the Django intake (`lai/apps/scoring/engine_events.py` on `core/ge-scoring`). Change them only
together.

## 3. Presentation events

`EnginePresentationEventMap` (`game/src/contracts/engineEvents.ts`): `PlayerJumped`,
`PlayerLanded`, `PlayerGaitChanged`, `PlayerFootstep`, `PlayerRecovered`, `PlayerEnteredZone`,
`PlayerLeftZone`, `CourseCheckpointReached`, `PlatformGoalReached`, `PlayerBounced`,
`PressurePlatePressed`, `PressurePlateReleased`. Their payloads equal the island-map runtime's
`WorldEngineEventMap`, and a type-level test keeps them equal. Requested addition (Firepeak):
`PlayerRecovered.hazardId`, which lands in both maps together.

## 4. Player, physics and environment

| Contract | File | Summary |
|---|---|---|
| `PlayerTransform`, `PlayerTransformComponent` | `contracts/player.ts` | Canonical transform; movement writes, everything else reads |
| `PhysicsProvider`, `ColliderSpec`, `PhysicsProviderService` | `contracts/physics.ts` | AABB collider list; `SOLID`, `JUMPABLE`, `TRIGGER`; gates never jumpable; raycast for camera; `cameraIgnores` for boundaries |
| `EnvironmentQuery`, `SurfaceProfile`, `ExternalForce`, `ClimbableInfo`, `EnvironmentQueryService` | `contracts/physics.ts` | Surface friction and speed, forces, water, climbables |

## 5. Core APIs

| API | File |
|---|---|
| `createEngineRuntime`, `EngineRuntime`, `RuntimeEventMap` | `core/runtime.ts` |
| `createCapabilityRegistry`, `CapabilityDefinition`, `resolveCapabilities` | `core/capabilities.ts` |
| `createEntityWorld`, `defineComponent` | `core/entities.ts` |
| `createSystemScheduler`, `EngineSystem` | `core/systems.ts` |
| `createEventBus`, `TypedEventBus` | `core/eventBus.ts` |
| `createResourceScope` | `core/resources.ts` |
| `createServiceRegistry`, `defineService` | `core/services.ts` |
| `createFixedTimestepClock` | `core/fixedTimestep.ts` |
| `createDiagnostics` | `core/diagnostics.ts` |
| `EngineError`, `ValidationResult` | `core/errors.ts` |

## 6. Capability catalogue (v1.0.0 each)

Each capability validates its config (never throws; unknown keys are issues) and is resolved by
`resolveCapabilities`, so SDK validation and the runtime agree.

| Capability | Requires | Config (summary) |
|---|---|---|
| `movement.locomotion` | | Walk, run and sprint speeds and accelerations (`LocomotionConfiguration` limits) |
| `movement.jump` | `movement.locomotion` | `enabled`, `jumpHeight` 0.2 to 2.5, `gravity` 5 to 80, `airControl` 0 to 1, `maxFallSpeed` 2 to 60, `coyoteTimeMs` and `jumpBufferMs` 0 to 400, `allowDoubleJump` (default false) |
| `movement.surfaces` | | Surface profiles (friction, speed multiplier), `maxWalkableSlope` |
| `movement.externalForces` | | `reducedMotionScale` |
| `movement.swimming`, `movement.climbing` | | `enabled` and tuning |
| `camera.thirdPerson` (default), `camera.firstPerson` | | Camera limits from `CAMERA_LIMITS` |
| `camera.collision` | `camera.thirdPerson` | `enabled`, `safetyRadius` |
| `character.avatar` | | Avatar limits from `AVATAR_LIMITS` |
| `character.animation` | `character.avatar` | Clip map, transitions, crossfades |
| `gameplay.checkpoints` | | Checkpoints and course goals (the one checkpoint system) |
| `gameplay.collectibles`, `gameplay.chests`, `gameplay.doors`, `gameplay.portals`, `gameplay.triggers` | | Placements by authored id |
| `gameplay.platforms` | | Moving, rotating, falling, bounce, appearing; `route` REQUIRED or OPTIONAL |
| `gameplay.hazards` | `gameplay.checkpoints` | Static and telegraphed hazards, each linked to a checkpoint |
| `gameplay.puzzles`, `gameplay.jumpChallenges` | | World-mechanics puzzles; jump and accessible routes |
| `environment.volumes` | | Surfaces, forces, water, ladders; provides `EnvironmentQueryService` |
| `environment.lighting`, `environment.weather`, `environment.particles` | | Presets and kinds as data; particle budget tiers |

## 7. SDK and service ports

| API | File |
|---|---|
| `defineRealm`, `validateRealm` | `sdk/realm.ts` |
| `defineAdventure`, `validateAdventure`, `profileFor` | `sdk/adventure.ts` |
| `resolveProfile`, `AGE_BANDS` (`SPROUT`, `PATHFINDER`, `EXPLORER`), `JUMP_LIMIT_RANGES` | `sdk/profiles.ts` |
| `loadAdventure` (adventure session: `enterArea`, `leaveArea`, `complete`, hooks) | `sdk/lifecycle.ts` |
| `createComponentRegistry` | `sdk/componentRegistry.ts` |
| `checkContentCompatibility` | `sdk/contentCompatibility.ts` |
| `scaffoldAdventure` (and `npm run engine:scaffold`) | `sdk/scaffold.ts` |
| Ports and fakes: `ASSET_MANAGER`, `SOUND_MANAGER`, `NPC_MANAGER`, `QUESTION_STUDIO`, `QUEST_SERVICE`, `INVENTORY`, `REWARDS`, `SAVE_RESTORE`, `PUBLISHED_CONTENT`, `MULTIPLAYER`; `provideFakeServices` | `services/*.ts` |

The inventory and rewards ports have no grant method. Question Studio's `submitAnswer` returns
a server verdict that the engine never interprets. Save and restore keeps presentation state
only, and the server wins. Multiplayer is disabled (shared presence is deferred by ADR-020).

## 8. Region-play scene key `engineBridge` (GE-065)

A 3D Area that still runs on the live `createLocationEngine` turns on engine components with
seed-authored scene data. Like `scene.platforming`, this is layout (LAI-0805), versioned with
the seed:

```json
{
  "engineBridge": {
    "capabilities": [{ "id": "gameplay.hazards", "config": {} }],
    "allowEnginePlatforms": false
  }
}
```

| Field | Rule |
|---|---|
| `capabilities` | `[{ id, config? }]`, validated by the engine's capability registry (`bridgeCapabilityRequests`, then `resolveCapabilities`). `movement.*`, `camera.*` and `character.*` are refused, because the live runtime owns them |
| `allowEnginePlatforms` | Optional, default false. `gameplay.platforms` is refused unless true (the live platform system owns platforms until GE-076). Use it only in an Area whose engine platforms have no live counterpart |

Wiring (GE-070): `regionManifest.ts` passes `scene.engineBridge` through as the config of an
`engineBridge` extension entry, the extension is registered beside region play, and Django checks
the block's structure at publish. The engine validates fully on the client.

Claims from the bridge: `EngineBridgeOptions.claims` is a `ClaimsBinding` or a function returning
one (or null) at emit time. A bridge registered once at module load uses the function form, since
the visit's `sessionRef` exists only after mount. While unbound it emits no claim
(`api.unboundClaims()` counts them).

Bridge API for the host (`api` on the mounted bridge):

| Member | Purpose |
|---|---|
| `resume(checkpointIds)` | A returning child: marks the earned checkpoints reached (authored order, no events, no claims) and places the child at the furthest through the host's checked, silent teleport. Returns `{ placedAt, unknown }` |
| `setSignals(signalIds)` | Feeds world changes as signals (convention `world:<changeKey>`, as `signalPlatforms` uses). Gates `requiresSignalId` checkpoints, doors and platforms. Switches off only the signals it fed earlier |
| `droppedClaims()`, `unboundClaims()` | Diagnostics counts |
| `support` | Which optional host members the bridge found (`playerState`, `setEnvironment`, `scene`, `carryLaunch` and more over time). **Additive:** new fields appear as the bridge gains capabilities, so consumers compare it by subset (`toMatchObject`), never by deep equality; "nothing refused" is `issues` being empty |
| `isSafeGround(x, y, z)` | False on top of a present moving, rotating, falling or bounce engine platform; the live controller combines it with the live platform system (GE-068) |
| `platforms()` | `{ id, phase, position, size, kind }[]` in config order, for realm parity tests (GE-068) |
| Forwarded platform sound events | `PlatformActivated`, `PlatformMoving`, `PlatformStopped` `{ platformId, cue? }` from engine moving platforms, same semantics as the live platform system; cues from the platform's `sounds` (`activated`, `moving`, `stopped`). No vanish or appear events: engine falling platforms use `PlatformPhaseChanged` (GE-069) |
| Weather area | `environment.weather` config `area: { mode: 'AT_START' \| 'FOLLOW_PLAYER', halfX, halfZ, height }` (5 to 60 m halves, 4 to 40 m height). Default `AT_START`, 25 x 25 x 15 m round the start. `FOLLOW_PLAYER`: the bridge moves the precipitation box with the child each frame (GE-L14) |
| Mixed platforms | An Area may run live platforms (`scene.platforming`) and engine platforms (`gameplay.platforms`, `allowEnginePlatforms`) together; each platform id in one system only (Django refuses an id in both). Safe ground and staff tuning cover both |

The bridge forwards `CourseCheckpointReached { checkpointId, label }` to the host bus, so the
host's "Safe spot" toast works for engine checkpoints.
