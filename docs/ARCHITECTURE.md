# Architecture

## System overview

```text
React/Vite client
  |
  | Amplify client libraries
  v
Amplify Auth ---- Cognito parent accounts
Amplify Data ---- AppSync + DynamoDB
Amplify Storage - S3 approved media
Amplify AI Kit -- AppSync AI routes + Amazon Bedrock
Amplify Functions - orchestration, privileged mutations, reports, safety processing
  |
  v
CloudWatch logs and operational metrics
```

## Frontend boundaries

- `app`: providers, routing, bootstrap, global error handling.
- `features/auth`: parent authentication.
- `features/child-profile`: profile selection and parent-managed settings.
- `features/island-map`: the explorable world (Phaser boundary, avatar
  controller, camera, world event bus, interaction/object registry) and
  world state/navigation. See "World engine layering" below.
- `features/adventures`: rendering and adventure state transitions.
- `features/companion`: Chatty presentation, narration queue, AI response display.
- `features/parent-dashboard`: progress summaries and controls.
- `features/safety`: client-safe reporting and fallback UI.
- `lib`: typed clients, runtime validators, logging adapters, utilities.

## Backend boundaries

### Auth
Parent accounts only. Child profiles are application records owned by parent accounts.

### Data
Use owner-based authorization for parent-owned records and explicit group authorization for administrators. Prefer narrow custom operations for actions that update several records atomically or require validation.

### Storage
Use path-based access rules. Store only approved assets and generated artifacts. Do not allow arbitrary public uploads in the MVP.

### Functions
Potential functions:
- `startAdventureSession`
- `submitAdventureAction`
- `generateCompanionTurn`
- `completeAdventureSession`
- `buildParentSummary`
- `processSafetyEvent`

Functions should be added only when direct Data operations or AI routes cannot safely enforce the workflow.

### AI
Use generation routes for structured, single-turn content such as:
- companion dialogue;
- age-banded hints;
- bounded story variations;
- curiosity-adventure scene content;
- parent-facing summary drafts.

A long-lived conversation route may be evaluated later, but the MVP should favor controlled generation calls tied to explicit adventure steps.

## World engine layering

Per `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 40
and ADR-007 in `docs/DECISIONS.md`:

```text
World Engine (Phaser: movement, maps, animation, collision)
     -> Story Engine (chapters, scenes, narrative state, bounded choices)
     -> Adventure Engine (deterministic challenge progression, validation, hints)
     -> Learning Rules / AI Companion (evaluation / narration, never both)
     -> World State (permanent consequences, unlocks, discoveries)
```

Each layer only talks to its direct neighbors, and only the layer named
"Learning Rules" ever decides correctness. The World Engine communicates
upward through a plain, Phaser-free world event bus (`worldEvents.ts` in
`features/island-map`), not by calling adventure or AI code directly from
inside a Phaser scene.

## State ownership

- Canonical adventure state lives on the server.
- The client may optimistically animate safe presentation changes but cannot award completion or progress without server validation.
- World changes are append-only events where practical, with a derived current world view.
- Learning progress is derived from evidence events, not model opinions alone.

## Environment strategy

- Local developer sandbox through Amplify Gen 2.
- Separate preview environments per branch where practical.
- Production environment with restricted administrator access.
- Secrets stored through Amplify secret management or approved AWS mechanisms, never committed.

## Observability

Track operational metadata without storing unnecessary child content:
- route/function name;
- request correlation ID;
- adventure template and step IDs;
- age band;
- latency;
- model/provider identifier;
- schema-validation result;
- safety disposition;
- fallback reason.

Do not put child names, raw voice, or free-form answers in routine logs.

