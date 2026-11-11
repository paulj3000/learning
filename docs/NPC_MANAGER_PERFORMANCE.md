# NPC Manager performance (LAI-NPC-037)

Scope: the NPC engine (`react/src/features/npc-manager/engine/`), the animator
(`animation/npcAnimator.ts`) and the model loader (`api/npcModelLoader.ts`). Rendering cost
(draw calls, skinning, shaders) belongs to the host scene and is not covered here.

## Targets

| Target                                                          | Value                                                                          | How it is checked                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| NPCs per scene on a tablet                                      | 20 animated, moving NPCs                                                       | Unit test (fakes) and owner device profiling                      |
| Engine update per frame (`runtime.update`), excluding rendering | under 1 ms on the reference tablet                                             | Owner device profiling; unit test only guards against regressions |
| Network loads per asset version                                 | at most one per app session while cached, across all NPCs, remounts and visits | Unit tests with a counting loader                                 |
| Per-frame network calls                                         | none                                                                           | Unit test (counting loader across 300 frames)                     |
| Per-frame scene traversal                                       | none                                                                           | Unit test (spy on `Object3D.prototype.traverse`)                  |
| Far NPC movement                                                | same distance and route as a near NPC over time                                | Unit test (patrol, mixed frame times)                             |

## What the engine does

### Model caching

- `engine/npcModelCache.ts`: a reference-counted cache keyed by `assetId@version` (prefixed by
  a scope: Django base URL and child, or `bundled`). Concurrent and later requests share one
  load. Each `acquire` is a lease; a source is never evicted or disposed while a lease is held.
  Released sources stay warm in a bounded least-recently-used set (default 8; the app-wide
  `SHARED_NPC_MODEL_CACHE` keeps 12). A failed load is forgotten so the next request retries.
- `npcModelLoaderFor` uses the app-wide cache, so walking back into a scene reuses parsed models.
  Each miss loads through a single-use asset loader, so the cache is the only holder of the
  source and may dispose an evicted idle source (geometries, materials, textures, skeletons, each
  exactly once).
- Each NPC gets a `cloneAssetScene` copy (skeleton-safe). `LoadedNpcModel.release()` (optional,
  additive) disposes the skeletons the clone owns, once, and returns the lease. The runtime calls
  it exactly once: when the NPC is removed, when the runtime is disposed, or when a model arrives
  after its NPC is gone. The runtime never disposes shared geometry, materials or textures.

### Incremental mount

`mount(spawns)` compares each spawn with the mounted one (same placement key and identical
data). Unchanged NPCs keep their root, model, animation, behaviour progress, visibility and
proximity state; no reload, no events. Changed or removed NPCs are disposed (with `npc.left` when
near); new ones get a placeholder and a load (a cache hit when the asset version is known).

### Per-frame update

- No allocation in the runtime's loop: a stable update list replaced only on mount, a listener
  snapshot replaced only on (un)subscribe, distances by `Math.sqrt`, clip resolution cached per
  state in the animator, and the built-in stationary controller reuses one frame object. The
  behaviour engine (`behavior/`) still returns one small frame object per call (not changed
  here).
- Distance-aware updates: beyond `farDistance` (default 30 m) behaviour runs every
  `reducedUpdateSeconds` (default 0.1 s). The accumulated time is applied in steps of at most
  `MAX_STEP_SECONDS` (0.25 s, the controller's clamp), so far NPCs do not slow down; every step's
  events and scripted `play` animation are applied. Proximity is checked every frame.
- The animation mixer updates every frame only for near, visible, on-screen NPCs. Far, hidden
  (`set_visible false`) or off-screen NPCs (the host's optional `isOnScreen(root, key)` culling
  answer) advance their mixer at the reduced rate with the accumulated time, so one-shots still
  finish and report `npc.animation_finished`.

### Disposal

Removing an NPC or disposing the runtime aborts its pending load, clears its timeout, stops its
mixer (`stopAllAction`), uncaches its clips and root, disposes its behaviour, detaches its root
and releases its model once. Runtime-owned placeholder geometry and material are disposed once
with the runtime. Listeners are cleared; every call after `dispose` is a no-op.

## Measured in unit tests (fakes, no WebGL)

`engine/npcRuntimePerformance.test.ts`, `engine/npcModelCache.test.ts`,
`api/npcModelLoader.test.ts`:

- 20 NPCs (15 patrolling, 5 stationary), models with three clips, 600 frames at 1/60 s: about
  **0.035 ms per frame** on the development machine (Node, jsdom). The test fails above 8 ms per
  frame, a ceiling chosen so it cannot flake; it catches gross regressions, not device budgets.
- 20 NPCs over two asset versions, a remount, a remount with one more NPC on a new version, and
  a second runtime: **3 loads** in total (one per asset version).
- Remounting 20 identical placements: no load, no rebuilt root, no event.
- 300 frames with 20 NPCs: **0** scene traversals and **0** loader calls.
- One near and one far NPC, 60 frames: the far one's behaviour runs at most 10 times, each step
  at most 0.25 s, keeping all the time; a far patrol covers the same distance as a near one
  (to 0.05) with frames alternating 0.09 s and 0.24 s.
- Hidden or off-screen: at most 10 mixer updates in 60 frames; a one-shot still finishes.
- Disposal: clone-owned skeletons disposed once, shared geometry and skeletons never; evicted
  owned sources disposed once each; a model arriving late is released; a throwing `release`
  does not break disposal.

## Needs owner device profiling

Unit tests cannot measure these; profile on the reference tablet with the WebGL renderer:

- Engine update time per frame for 20 NPCs (target under 1 ms), and total frame time with
  rendering (skinned meshes, shadows, draw calls).
- GC pauses: confirm no steady per-frame garbage from the engine (the behaviour frame object
  and three.js mixer internals are the known small sources).
- Memory after several visits: the warm cache holds up to 12 idle NPC models; confirm GPU
  memory returns after eviction and after leaving a scene.
- Whether `farDistance` 30 m and the 0.1 s reduced rate look right in each region, and whether
  the host should pass `isOnScreen` from its frustum culling.
