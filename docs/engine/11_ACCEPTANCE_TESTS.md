# 11 — Acceptance Tests

## Preserve Existing Test Suite

All existing relevant Vitest/Playwright tests must remain passing or be intentionally migrated with equivalent coverage.

## Architecture

### A1 Generic Route

Two unrelated locations render through the same route/page and generic world component.

### A2 No Slug Branching

Search generic runtime for known location slugs.

FAIL on runtime behavior like:

```ts
if (locationSlug === 'storykeeper-castle')
```

### A3 Serializable Manifest

A manifest can be serialized to JSON and reloaded without losing executable meaning.

No functions/Three objects/React components are embedded.

### A4 Source Repository Swap

Generic runtime can obtain a manifest through a repository interface rather than importing a specific region directly.

## Existing System Preservation

### P1 Adventure Engine

Existing Adventure Engine tests continue passing.

### P2 Story Engine

Story progression remains functional.

### P3 Quest Engine

Existing quests continue to progress from world events.

### P4 Discovery

Existing discoveries remain obtainable.

### P5 Adaptive/Mastery

No new parallel mastery state is introduced.

### P6 Child History

Existing AdventureSession/history identifiers remain valid.

## World Runtime

### W1 Spawn

Manifest spawn point works.

### W2 Checkpoint

Existing authored checkpoint ID persists and restores correctly.

### W3 Collision

Manifest collision prevents invalid traversal.

### W4 Zone

Entering a manifest zone emits the expected semantic event.

### W5 NPC

Approaching an NPC opens the existing NPC conversation flow.

### W6 Interaction

Raycast interaction resolves by semantic entity ID.

### W7 Cleanup

Repeated mount/unmount does not duplicate:

- render loops
- listeners
- audio
- controls
- scene objects

## Bindings

### B1 Adventure Entrance

Manifest interaction can open/start an existing Adventure by slug.

### B2 Discovery

Manifest entity/zone can trigger an existing DiscoveryDefinition.

### B3 World Change

Existing world-change keys remain unchanged.

### B4 Extension

A bespoke mechanic runs through the extension registry without generic-runtime location checks.

## Assets

### AS1 Existing Asset Models

No duplicate asset database model is introduced.

### AS2 Asset Resolution

Manifest asset ID resolves through centralized asset handling.

### AS3 Missing Asset

Missing optional asset fails gracefully; invalid required asset fails validation/publish.

## Admin

### AD1 Existing Auth

Admin/Superuser rules remain enforced.

### AD2 404

Unauthorized admin route keeps required 404 behavior.

### AD3 Draft Isolation

Editing a draft location/adventure does not mutate published content.

### AD4 Publish Validation

Broken references cannot publish.

## Final Expansion Test

Using existing mechanics, create:

```text
Test Explorer Cove
```

with:

- environment
- spawn
- checkpoint
- one NPC
- one discovery
- one existing Adventure entrance
- one reward/quest path
- exit/travel binding

No new route, WorldView, Scene, Region, or runtime conditional may be added.

PASS means the platform is materially easier to expand.
