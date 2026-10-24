# Learning Adventure Island — Expansion Architecture Roadmap
## Revised Against the 2026-10-04 Source Tree

This roadmap was written after inspecting the supplied `learning.tgz` codebase.

It **supersedes the earlier generic rebuild roadmap**. The current project already contains substantial architecture that should be preserved. This is therefore a **targeted consolidation and migration**, not a greenfield rewrite.

## Read This First

Claude Code must inspect the repository itself before changing anything, then read these files in order:

1. `00_CURRENT_SOURCE_AUDIT.md`
2. `01_TARGET_ARCHITECTURE.md`
3. `02_CONTENT_MODEL_STRATEGY.md`
4. `03_GENERIC_3D_WORLD_RUNTIME.md`
5. `04_ADVENTURE_AND_STORY_INTEGRATION.md`
6. `05_QUEST_NPC_DISCOVERY_INTEGRATION.md`
7. `06_ASSET_SYSTEM.md`
8. `07_ADMIN_AUTHORING.md`
9. `08_LEARNING_AND_ADAPTIVE_SYSTEMS.md`
10. `09_MIGRATION_PLAN.md`
11. `10_IMPLEMENTATION_PHASES.md`
12. `11_ACCEPTANCE_TESTS.md`
13. `12_FILE_BY_FILE_GUIDANCE.md`
14. `13_CLAUDE_EXECUTION_PROMPT.md`

## The Actual Problem

The codebase has already achieved much of the intended content/engine separation:

- deterministic Adventure Engine
- Story Engine
- Quest Engine
- Discovery Engine
- rewards/inventory
- NPC content
- adaptive learning/director
- world content packs
- canonical content documentation
- Three.js foundation
- Asset/AssetVersion database models
- Island/Adventure admin catalog
- admin authorization and superuser deletion rules

The primary expansion bottleneck is now the **3D location implementation**.

Today, adding a major Three.js region still tends to require combinations of:

- a dedicated route page
- a dedicated `*WorldView.tsx`
- a dedicated `*Scene.ts`
- a dedicated `*Region.ts`
- custom interaction/binding code
- additions to route imports
- additions to world/content registries

Examples in the current tree include Storykeeper Castle, Wonderwild Forest, Pirate Builder Bay, Dragon's Sanctuary, Clockwork Harbor, and others.

## New Non-Negotiable Goal

> **A normal new location/adventure using existing mechanics must be addable primarily through manifests/content and Admin, without creating a new route component, WorldView, renderer, or scene engine.**

New source code is acceptable only when adding a genuinely new reusable mechanic or a uniquely authored visual/gameplay system that cannot reasonably be expressed through the supported manifest vocabulary.

## Do Not Rebuild Working Engines

Do **not** replace these simply to match this roadmap:

- `src/features/adventures/engine/`
- `src/features/story/`
- `src/features/quests/`
- `src/features/discovery/`
- `src/features/rewards/`
- `src/features/adaptive/`
- `src/features/mastery/`
- `src/features/learning-profile/`
- existing safety/tutor systems
- existing child progress/session history
- world pack ownership/invariant tests

Refactor their integration points only where necessary.

## Migration Philosophy

1. Preserve behavior.
2. Add generic infrastructure beside current region-specific Three.js code.
3. Convert one existing 3D region as the reference implementation.
4. Prove parity.
5. Convert remaining regions incrementally.
6. Make Admin authoring possible in stages.
7. Remove region-specific pages/renderers only after migration.
8. Preserve saved child history and progress.

## Final Definition of Success

Create a new small playable location/adventure using:

- an existing environment/asset vocabulary
- existing NPC/dialogue behavior
- existing quest/adventure mechanics
- existing learning mechanics
- existing rewards

and publish it without creating a new:

- route component
- `*WorldView.tsx`
- `*Scene.ts`
- `*Region.ts`
- Adventure-specific runtime branch
