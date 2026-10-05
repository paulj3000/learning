# 09 — Migration Plan

## Reference Migration Choice

Use a current Three.js region that is representative but not the most complicated.

Recommended first candidate:

**Welcome Harbor** if its current Three.js implementation is sufficiently complete and comparatively generic.

Alternative:

**Pirate Builder Bay** if Welcome Harbor has special hub responsibilities that make it atypical.

Do not choose Storykeeper Castle first because it has several bespoke spatial Adventure bindings.

Do not choose Dragon's Sanctuary first because it has bespoke region state/dragon interactions.

## Migration Sequence

### 1. Baseline

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Record pre-existing failures before changing code.

### 2. Inventory Repeated World Code

Create:

```text
docs/platform/THREE_LOCATION_DUPLICATION_AUDIT.md
```

Compare all:

```text
*WorldView.tsx
*Scene.ts
*Region.ts
dedicated route pages
```

Classify each piece:

```text
GENERIC
MANIFEST_DATA
REUSABLE_EXTENSION
REGION_SPECIFIC_CONTENT
LEGACY
```

### 3. Add Manifest Types

No region behavior changes yet.

### 4. Add Generic Runtime

Build it beside existing region implementations.

### 5. Convert Reference Region

Represent its:

- geometry/environment
- entities
- NPCs
- zones
- checkpoints
- interactions
- exits
- audio
- lighting

through the manifest.

### 6. Route Reference Region Through Generic Page

Keep old route as redirect/compatibility alias if necessary.

### 7. Verify Parity

Compare:

- movement
- collision
- NPC conversation
- checkpoints
- discoveries
- quests
- Adventures
- HUD
- world changes
- accessibility

### 8. Convert Second Region

Choose a region with different mechanics.

This proves the manifest isn't overfit to the first.

### 9. Extract Extensions

When the second/third migration encounters bespoke mechanics, create explicit extension handlers rather than adding slug branches.

### 10. Convert Remaining Three.js Regions

Suggested order after audit:

```text
Welcome Harbor
Pirate Builder Bay
Wonderwild Forest
Clockwork Harbor
Dragon's Sanctuary
Storykeeper Castle
```

Adjust based on actual complexity/tests.

### 11. Remove Dedicated Route Components

Only after each location is generic.

### 12. Retire Phaser Paths

Only when Three.js parity and current project decisions say Phaser is no longer needed.

Do not combine the Phaser retirement with the first generic-runtime refactor.

### 13. Admin Manifest Editing

After runtime stability, allow Admin to edit draft manifests.

### 14. Database-Published Definitions

After source-controlled manifest parity, add versioned database publishing.

## Saved Data

Never rewrite child history just to match new route/component names.

Preserve semantic IDs:

- location slugs
- Adventure slugs
- quest IDs
- discovery IDs
- item IDs
- world-change keys
- checkpoint IDs

Changing these requires explicit migration.
