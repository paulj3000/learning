# 10 — Implementation Phases for Claude Code

## Phase 0 — Baseline and Audit

Deliver:

- baseline command results
- `THREE_LOCATION_DUPLICATION_AUDIT.md`
- exact list of dedicated routes/world views/scenes/regions
- list of current generic utilities
- list of bespoke mechanics requiring extensions

No functional changes.

## Phase 1 — Serializable Manifest Contract

Implement shared types for:

- location metadata
- bounds
- spawn points
- checkpoints
- colliders
- zones
- primitive geometry
- asset placements
- NPC placements
- interactions
- exits
- lighting
- audio
- extension bindings

Add validation and tests.

## Phase 2 — Manifest Registry and Loader

Create a location manifest repository/registry.

Initially source-controlled.

Requirements:

- lookup by stable location slug
- schema version
- validation
- no runtime slug switch
- clear missing-manifest error

## Phase 3 — Generic Scene Builder

Implement reusable builders for common scene content.

Reuse current Three utilities/assets.

Do not migrate a real region until builders are tested.

## Phase 4 — Generic World View

Create one React orchestration component for any manifest-driven location.

Integrate:

- child profile/avatar
- `ChildWorldState`
- checkpoint load/save
- HUD
- world event bus
- NPC conversation
- world actions
- cleanup

## Phase 5 — Reference Region Migration

Convert the selected reference region.

Keep semantic IDs unchanged.

Add parity tests.

## Phase 6 — Generic Routing

Route manifest-driven locations through one route/page.

Maintain old URLs with redirects or wrappers until migration completes.

## Phase 7 — Second Region Migration

Choose a structurally different region.

Any new special behavior must be:

- existing reusable engine behavior, or
- registered extension

No slug conditionals.

## Phase 8 — Interaction Binding Layer

Move direct region/adventure/discovery bindings into declarative manifest bindings where feasible.

Keep existing Adventure/Quest/Discovery engines.

## Phase 9 — Remaining Region Migrations

Migrate all active Three.js regions.

Track each in `IMPLEMENTATION_STATUS.md`.

## Phase 10 — Asset Integration Cleanup

Unify manifest asset references with existing `Asset` / `AssetVersion` and current Three asset loader.

Remove avoidable hard-coded URLs.

## Phase 11 — Admin Location Editor v1

Add forms for:

- metadata
- environment
- spawn/checkpoints
- placements
- NPCs
- zones
- interactions
- extensions

Source-controlled definitions may still be canonical at this point if database publishing is not ready.

## Phase 12 — Versioned Draft/Publish Model

Add persistent draft/published manifest versions.

Use repository interfaces so runtime storage changes without engine changes.

## Phase 13 — Admin 3D Placement Editor

Add interactive placement/rotation/scale editing.

This is an enhancement, not a prerequisite for runtime refactor.

## Phase 14 — Executable Adventure Authoring

Make current `AdventureDefinition` serializable/publishable through Admin.

Preserve version and session semantics.

Do not replace the current engine.

## Phase 15 — Templates

Add content templates:

```text
Blank
Treasure Hunt
Rescue
Mystery
Collection
Exploration
Repair
Defense
```

Templates create data/manifests only.

## Phase 16 — Legacy Cleanup

Remove migrated:

- dedicated WorldViews
- dedicated scene boilerplate
- dedicated route pages
- redundant region data
- dead Phaser paths when approved

Do not remove custom extension modules that still provide real unique mechanics.

## Phase 17 — Extensibility Proof

Create a new test location/adventure without adding:

- route
- WorldView
- scene
- region module
- runtime slug branch

If this fails, fix the abstraction.
