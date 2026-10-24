# 00 — Current Source Audit

## Technology Confirmed

From the supplied source:

- React 19
- TypeScript 5.9
- Vite 8
- React Router 7
- AWS Amplify Gen 2
- Three.js 0.185
- Phaser 4 remains installed during the Three.js migration
- Vitest
- Playwright
- Tailwind 4
- Node >= 22

## Existing Architecture Worth Preserving

### Adventure Engine

Current code:

```text
src/features/adventures/
  AdventureRunner.tsx
  useAdventureSession.ts
  engine/
    types.ts
    transitions.ts
    validators.ts
    hints.ts
  steps/
  content/
```

`AdventureDefinition` is already deterministic, versioned, location-aware, age-band-aware, and optionally skill-domain/skill-level-aware.

Current step vocabulary includes:

```text
NARRATIVE
CHOICE
NUMBER_INPUT
ORDERING
MATCHING
SHORT_RESPONSE
CREATIVE_CHOICE
REFLECTION
WORLD_CHANGE
COMPLETE
```

Do not replace this with a second Adventure Engine.

### World Packaging

Current code:

```text
src/features/worlds/
  types.ts
  validate.ts
  worlds.ts
  travel.ts
  packs/
    homeIsland.ts
    creatureCareCove.ts
```

`WorldContentPack` already formalizes ownership of:

- locations
- adventures
- quests
- items
- collectible sets
- NPCs
- discoveries
- stories

Tests assert pack completeness and uniqueness.

Preserve this invariant.

### Existing Gameplay Systems

The source already has:

```text
src/features/quests/
src/features/discovery/
src/features/rewards/
src/features/npc/
src/features/story/
src/features/adaptive/
src/features/mastery/
src/features/learning-profile/
src/features/curriculum/
src/features/tutor/
src/features/interaction/
src/features/session/
```

The rebuild must integrate these systems rather than fork them.

## Current 3D Bottleneck

Current Three.js implementation is under:

```text
src/features/island-map/three/
```

It contains shared infrastructure such as:

- `ThreeGameContainer.tsx`
- `WorldHud.tsx`
- `worldEngineEvents.ts`
- asset loader/manifest code
- interaction bridges
- shared movement/rendering utilities

But it also contains many region-specific files such as:

```text
StorykeeperCastleWorldView.tsx
storykeeperCastleScene.ts
storykeeperCastleRegion.ts

WonderwildForestWorldView.tsx
wonderwildForestScene.ts
wonderwildForestRegion.ts

PirateBuilderBayWorldView.tsx
pirateBuilderBayScene.ts
pirateBuilderBayRegion.ts

DragonsSanctuaryWorldView.tsx
dragonsSanctuaryScene.ts
dragonsSanctuaryRegion.ts

ClockworkHarborWorldView.tsx
clockworkHarborScene.ts
clockworkHarborRegion.ts
```

There are also dedicated route components under `src/routes/`.

This is now the main source of expansion cost.

## Current Routing Bottleneck

`src/app/AppRoutes.tsx` lazy-loads multiple dedicated world pages.

Examples include dedicated pages for:

- Dragon's Sanctuary
- Pirate Builder Bay 3D
- Storykeeper Castle 3D
- Wonderwild Forest 3D
- Clockwork Harbor

Target state:

```text
/island/:childId/location/:locationSlug
```

or the closest existing generic route, resolved through a shared world player.

Do not add another dedicated page for a normal location.

## Current Amplify Catalog

The schema already includes:

```text
Asset
AssetVersion
Island
Adventure
AdventureModel
```

Important: comments in `amplify/data/resource.ts` explicitly state that `Island` and `Adventure` are currently **catalog overlays**, not the canonical playable content.

Current `Adventure.slug` joins to source-controlled `ADVENTURE_TEMPLATES`.

Current `Island.slug` joins to source-controlled locations.

Do not silently change this contract.

## Current Asset Model

`Asset` / `AssetVersion` already exist and are admin-managed.

The new roadmap should extend this rather than create a duplicate asset table.

## Existing Documentation

The repository already has significant architectural documentation, including:

```text
docs/ADVENTURE_ENGINE.md
docs/ARCHITECTURE.md
docs/DATA_MODEL.md
docs/DECISIONS.md
docs/IMPLEMENTATION_STATUS.md
docs/ISLAND_ADVENTURE_MANAGEMENT.md
docs/THREE_WORLD_ASSET_CONVENTIONS.md

docs/platform/CANONICAL_CONTENT_MODEL.md
docs/platform/CURRENT_PLATFORM_AUDIT.md
docs/platform/ENVIRONMENTS_CONFIG_AND_CONTRACT_TESTS.md
docs/platform/MANIFEST_AND_API_VERSIONING.md
docs/platform/WORLD_ITEM_AND_ASSET_MODEL.md
```

Claude must reconcile changes with these files rather than create conflicting documentation.

## Existing Design Strengths

Preserve:

1. source-controlled deterministic educational content
2. child-scoped identity/progress across worlds
3. stable semantic IDs
4. authored checkpoints instead of raw coordinate persistence
5. engine-neutral world events
6. safety boundaries
7. adaptive-learning separation
8. content-pack validation
9. versioned Adventures
10. existing admin authorization

## Architectural Smells to Remove Gradually

1. region-specific route components
2. region-specific WorldView orchestration
3. repeated scene setup
4. repeated region geometry/zone structures that can be represented as data
5. direct region-specific quest/adventure bindings
6. source additions required for ordinary world content
7. duplicated Phaser/Three world paths once Three migration is complete
