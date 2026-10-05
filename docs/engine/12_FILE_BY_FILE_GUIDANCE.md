# 12 — File-by-File Guidance

This is directional. Claude must inspect actual code before editing.

## Preserve / Build Around

### `src/features/adventures/engine/`

KEEP.

Only add adapters/interfaces needed for spatial bindings.

### `src/features/adventures/content/`

KEEP during early phases.

Later make repository-backed/versioned authoring possible.

### `src/features/worlds/`

KEEP.

Extend `WorldContentPack` carefully if manifests require ownership/version metadata.

### `src/features/story/`

KEEP.

Do not fold into world renderer.

### `src/features/quests/`

KEEP.

World emits facts/events; quest system evaluates them.

### `src/features/discovery/`

KEEP.

Bind manifest entities/zones to existing discovery IDs.

### `src/features/npc/`

KEEP.

Manifest references NPC IDs.

### `src/features/adaptive/`, `mastery/`, `learning-profile/`, `curriculum/`

KEEP.

No replacement learning engine.

### `src/features/island-map/three/assets/`

REUSE/CONSOLIDATE.

Integrate with the existing database Asset pipeline.

### `src/features/island-map/three/worldEngineEvents.ts`

KEEP/EXTEND.

This is a valuable renderer-neutral boundary.

## Refactor Targets

### `src/features/island-map/three/*WorldView.tsx`

MIGRATE toward one generic manifest-driven WorldView.

Do not delete until parity.

### `src/features/island-map/three/*Scene.ts`

CLASSIFY.

- common scene creation -> generic builder
- placement/configuration -> manifest
- truly unique mechanics -> extension module

### `src/features/island-map/three/*Region.ts`

MIGRATE serializable region facts into manifests.

Preserve semantic IDs.

### Dedicated 3D route pages under `src/routes/`

MIGRATE to generic route.

Keep redirects/wrappers during transition.

### `src/app/AppRoutes.tsx`

SIMPLIFY after migrations.

Do not remove current routes prematurely.

## Amplify

### `amplify/data/resource.ts`

KEEP current models and semantics during early phases.

Later add versioned location/adventure-definition persistence additively.

Do not redefine `Asset`.

Do not silently convert catalog `Adventure` into canonical executable content without an ADR and migration.

## Admin

### `src/features/admin/`
### `src/routes/Admin*`

EXTEND.

Do not create a separate `/admin2` or parallel design system.

## Documentation

Update existing:

```text
docs/ARCHITECTURE.md
docs/DATA_MODEL.md
docs/ADVENTURE_ENGINE.md
docs/DECISIONS.md
docs/IMPLEMENTATION_STATUS.md
docs/ISLAND_ADVENTURE_MANAGEMENT.md
docs/platform/CANONICAL_CONTENT_MODEL.md
```

Avoid creating contradictory architecture descriptions.

## Phaser

Do not remove Phaser just because Three.js is now the target.

Follow the repository's existing migration decision and remove Phaser only after parity/coverage confirms it is no longer required.
