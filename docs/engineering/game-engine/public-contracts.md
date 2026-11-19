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

Capability, SDK and service-port APIs are listed in [implementation-status.md](implementation-status.md)
as each work package merges.
