# 13 — Prompt to Give Claude Code

Use this after placing this roadmap directory into the repository.

---

You are modifying the existing Learning Adventure Island codebase.

Read:

1. `CLAUDE.md`
2. `START_HERE.md`
3. existing architecture/data/decision/implementation-status documentation
4. all files in this roadmap package

Do not treat this as a greenfield rewrite.

The supplied project already has working Adventure, Story, Quest, Discovery, Reward, NPC, adaptive-learning, mastery, world-pack, asset, safety, and admin systems. Preserve those systems unless the roadmap explicitly identifies an integration refactor.

The main architectural goal is to make the Three.js world layer manifest-driven so adding an ordinary location/adventure no longer requires a dedicated route, WorldView, Scene, or Region implementation.

Before coding:

1. run the baseline typecheck, lint, tests, and build
2. record pre-existing failures
3. inspect every current Three.js `*WorldView`, `*Scene`, and `*Region`
4. create `docs/platform/THREE_LOCATION_DUPLICATION_AUDIT.md`
5. classify duplicated code as:
   - GENERIC
   - MANIFEST_DATA
   - REUSABLE_EXTENSION
   - REGION_SPECIFIC_CONTENT
   - LEGACY
6. propose the exact Phase 1 file changes before making broad refactors

Implementation rules:

- do not create a second Adventure Engine
- do not create a second Quest Engine
- do not create a second Learning Engine
- do not create a duplicate Asset model
- preserve stable slugs, IDs, checkpoint IDs, world-change keys, and saved child history
- preserve current admin authorization and 404 behavior
- preserve world-pack ownership/invariant tests
- keep manifests JSON-serializable
- generic runtime may not branch on location slug
- bespoke mechanics must use registered extensions
- migrate one region at a time
- keep old routes as compatibility wrappers/redirects until parity is proven
- update `docs/DECISIONS.md` for major architectural decisions
- update `docs/IMPLEMENTATION_STATUS.md` at the end of each phase

Do not implement all phases in one giant change.

Begin with Phase 0 from `10_IMPLEMENTATION_PHASES.md`, report the audit and baseline, then proceed to Phase 1 only after the architecture is clear.

---
