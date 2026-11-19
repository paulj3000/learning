# SC-R11 and castle quality stream: prep work list

Paths are under `react/src/features/island-map/three/` (abbrev. `T/`) unless noted. No measurements exist; every number below is provisional.

## 1. Instrumentation: existing vs missing

Existing:
- Static estimates only: `T/runtime/manifests/storykeeperCastleBudgets.test.ts` (`estimateDrawCalls` L24-31, scenery, lights, motes, 6000 triangles, texture bytes). Comment L11-13 says SC-R11-01 replaces them.
- Tier presets `T/runtime/visual/renderQuality.ts` L22-26 (pixel ratio, lights, motes); "provisional until SC-R11" L9.
- Frame delta is computed (`createLocationEngine.ts` L1064-1072, `MAX_FRAME_SECONDS` clamp) but never recorded.
- `assets/assetLoader.ts` L49-60 has `AssetLoadEvent`/`AssetLoadObserver` (load events and byte progress); `npc-manager/engine/npcModelCache.ts` L30-39 `stats()` (loads, hits, evictions, entries, inUse).
- `runtime/e2eProbe.ts`, installed only in `vite --mode e2e` (L1124-1131): no perf data.

Missing: `renderer.info` (calls, triangles, geometries, textures; `RendererLike` L120-128 does not expose `info`), frame-time stats, asset load duration roll-up, time to first walkable frame, active mixer count (`mixers` L286), disposal counts, scene transition duration.

Design (new `T/runtime/diagnostics/`, gated by `import.meta.env.DEV || ?lai-diag=1`, compiled out of prod like the e2e probe):
- `frameStats.ts`: pure reducer `reduceFrame(state, deltaMs) -> {count, mean, p95, worst, over33msCount}` using a fixed-size ring buffer. Tests: ordering, ring wrap, p95, empty state, NaN or negative delta ignored.
- `rendererSnapshot.ts`: pure `snapshotInfo(info: {render:{calls,triangles}, memory:{geometries,textures}})`. Add optional `info?` to `RendererLike`; test doubles stay valid.
- `loadTimeline.ts`: reducer over named marks (`mount`, `assetsSettled` = the engine's `ready` promise L1134, `firstWalkableFrame` = first `frame()` after ready) giving durations. Asset durations come from `AssetLoadObserver`.
- `lifecycleCounts.ts`: counters for mixers created, mixers stopped, geometries and materials disposed; a test asserts created equals released after `dispose()`.
- Surface: console table plus `window.__laiDiag` in the gated build only. Nothing is sent anywhere and nothing child-identifying is recorded (CLAUDE.md s13).

## 2. Disposal and lifecycle gaps

`dispose()` is `createLocationEngine.ts` L1093-1115. Fine: frame cancel, controls, extensions, mixers, owned geometry and materials, material library, motes, `renderer.dispose()`.
Gaps:
1. `renderer.forceContextLoss()` is not called. Repeated castle mounts can exhaust Chromebook WebGL contexts. Add it (optional on `RendererLike`) and test with a spy.
2. `scene.clear()` L1110 detaches children but skeleton bone textures (`cloneAsset.ts` L21-23, "released with that renderer") live until the renderer is gone, which is fine once 1 is done.
3. Mixers: L1102-1105 stops them but `mixers` is never emptied. Add `mixers.length = 0` (idempotence is already guarded by `disposed`).
4. Cached glTF is shared by design (L16-18). No hook releases it when leaving the castle for good. Propose `assetLoader.trim(ids)`, called by diagnostics only. Needs an owner decision, not a quick fix.
5. Promise callbacks after dispose are guarded (`addWhenLive` L270-274). Add a test that a late `loadModel` resolve adds nothing and creates no mixer. The mixer push in `loopIdle` L275-281 is called after `addWhenLive` returns true, so it is safe; verify by test.

## 3. Collision and camera; WALL_HEIGHT 3 to 4

- The controller is 2D: `firstPersonController.ts` L100-117 resolves X and Z separately and slides along walls. `collidesAt` uses `Box3.containsPoint` at `position.y`, which is 0 (set L7 `teleport`). So collider `maxY` only matters if above 0: `toBox3` default `maxY = WALL_HEIGHT` (`sceneKit.ts` L41), `sceneLayout.ts` L409/415/508. Raising WALL_HEIGHT cannot change walking results, since ground Y=0 is inside any box with maxY > 0.
- Camera: eye 1.6 (`EYE_HEIGHT`), near 0.1, far 150 (`createLocationEngine.ts` L302-308), fixed pitch limit about 1.52 rad. Looking up, a 4 m ceiling is farther from view and cannot clip. A raised ceiling and lamps still sit inside far.
- Player animation: not applicable. The camera is first person, with no avatar, mixer or walk cycle. On a blocked axis, velocity is zeroed (L108, L115) so the view stops cleanly. Only NPC and prop mixers exist.
- Depends on 3 m (all must follow a configurable value):
  - `storykeeperCastleVisuals.ts` L72 `CEILING_SURFACE_Y`, wall faces L262, cornice L281/361, secret seal face L350.
  - `storykeeperCastle.ts` L268 wall collider `maxY`, L309 room lamp `y: WALL_HEIGHT - 0.4`, L351 ceiling slabs `WALL_HEIGHT + 0.1`.
  - `castleRooms/greatLibrary.ts` L64 `BEAM_BOTTOM`, L158.
  - `sceneLayout.ts` L159 building heightScale (outdoor, but changes if the constant changes globally).
  - `assets/manifest.ts` L187 comment: kit pieces are authored 3 m tall, so wall and `ceiling-tile` models would not reach 4 m without a scale or a second piece. This is the real blocker.
  - Not tied to the constant but implicitly to 3 m: the test `storykeeperCastleRegion.test.ts` L471-473 hardcodes `< 3` for wall-mounted spots; `sceneKit.test.ts` L8; fixed light `y` of 2 and 1.2 (`storykeeperCastle.ts` L321, L330); `RACK_HEIGHT` 1.7 and `BEAM_BOTTOM`; tower windows "floor-to-ceiling" (L493); door heights come from the archway kit asset (check `ARCHWAYS` in `castleLayout.ts`/`storykeeperCastleRegion.ts`; not verified here).
- Recommendation: make height a manifest/region value (`ThreeLocationManifest.wallHeight?`, default 3) and keep `WALL_HEIGHT = 3` as that default. Thread it through the visuals, lamp, slab, beam and collider sites. Replace the literal 3 in L471 with the value. Add tests: default output is byte-identical to today (golden), and at 4 every ceiling and lamp, cornice and beam is at or below it, with no collider `maxY` below it. Gate 4 m behind the kit-piece scaling decision (SC art direction), not before.

## 4. Accessibility gaps

Present: HUD exit `min-height 2.75rem` (`WorldHud.module.css` L38), action prompt 3.5rem (L102), fullscreen 44px (`WorldStage.module.css` L16), focus-visible rings, `aria-label` on prompt (`WorldHud.tsx` L99), `aria-pressed` fullscreen, `aria-expanded` backpack, kbd hints only on fine pointer (L38-42). Reduced motion reaches the engine (`createLocationEngine.ts` L200, L808, L1040) via `lib/motionPreference.ts` `prefersReducedMotion()`.
Gaps to test or fix:
1. `pointerControls.ts` has no keyboard focus path for the canvas (click only requests pointer lock, L38-43). Check that Tab reaches the canvas, the prompt, exit and backpack in order, and that pointer-lock Esc does not trap.
2. Touch move radius is fixed 40 px (L81) and look gain 8; there is no UI affordance and no minimum target. Verify with a unit test of the vector clamp (extract to a pure function). Two-zone split is not discoverable for Sprouts.
3. Reduced motion is read once at mount; no live change handling (not verified).
4. Audio-independent path: `castleHudEquivalence.test.tsx` proves every learning step has a HUD card. Confirm each narrated line has text visible (not audited here).
5. Sprouts: reticle hidden, approach only (PILOT_READINESS 5b step 2); add a test that no interaction needs aim at SPROUT.
6. Hints: reuse the adventure hint path, not new 3D UI.
Reuse: `prefersReducedMotion`, the shared `WorldHud` classes and tokens (`--color-focus-ring`, `--space-*`), and `interactionAssist` (engine L227-229) for approach focus.

## 5. Navigation: exit with no arithmetic gate

Confirmed by code: `CASTLE_EXITS[0]` (`castleLayout.ts` L341-350) has `requirements: [{type:'ALWAYS'}]`, destination Welcome Harbor, zone `castle-harbor-exit`; the HUD `exitLink` is "Never gated (LAI-0807)" (`WorldHud.tsx` L32-35) and drawn on the stage even in full screen; `castleLayout.test.ts` L244 checks the exit mirrors the NAVIGATE interaction. Writing Room exit is gated only by a world change, not arithmetic. `ANSWERABLE_KINDS` including `number-input` (`castleHudEquivalence.test.tsx` L52) applies to learning steps, not exits. Missing test to add: `openExits` with an empty world state always includes `harbor`, and no route or exit interaction carries a `number-input` step.

## 6. Documentation-only instructions

Edit `docs/PILOT_READINESS.md` 5b (L314-360) and acceptance A-14/A-20 (`docs/regions/storykeeper_castle_acceptance.md` L34, L40):
- Profiling: target tablet or Chromebook only, release build (not dev server), device and browser version, quality tier shown, battery saver off, airplane-free normal network. Record: time to first walkable frame (cold and warm cache); Great Library stand-still frame time (mean, p95, worst) and `renderer.info` calls and triangles; the hub-to-library walk worst frame; JS heap if available. Use Chrome DevTools remote debugging or the diagnostics table once built. Leave results blank in the doc until measured; do not copy provisional budgets (30 fps, 8 s) as results.
- Sprouts playtest: one SPROUT per session with an adult observer, `quills-picture-story`, no coaching; log beat completion, duration, disorientation or discomfort, tapestry nook discovery, whether the exit was found. Consent and no child identifiers in notes.
