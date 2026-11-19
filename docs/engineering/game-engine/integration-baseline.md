# Game Engine Core: integration baseline

- **Status:** Proposed (development baseline on `core/gameengine`; not merged to `main`, not owner-accepted)
- **Owner:** Project owner
- **Last reviewed:** 2026-11-19
- **Related ADRs:** ADR-020, ADR-063 (Reserved on `main`)
- **Related tickets:** GE-001 to GE-090, GE-100 to GE-110
- **Canonical sources:** `git log origin/core/gameengine`, [implementation-status.md](implementation-status.md), [known-defects.md](known-defects.md)

The one commit realm branches and scoring merge to take the engine. Merge it (never rebase), then
run `npm install` for the `game/` workspace.

## Current baseline

**`cbe43a8e`** (Wave 2, 2026-11-19): `fc5c71cf` plus GE-075's six location definitions, the GE-065
companion bridge hooks (merged from the Firepeak split branch at `70cd5781`) and renderer stats
moved out of `debug/`. Development Complete for its contents; GE-066 (bridge Wave 2) is not in it yet.

Previous Wave 2 baseline: `fc5c71cf690a2b6b5bf40f8cdad4c475cbe796d5` (verification below was run at
it; `cbe43a8e` re-ran engine 582 and the affected React suites).

| Contains | Card |
|---|---|
| Engine foundation, core runtime, contracts v1 (claims, presentation, player, physics, environment) | GE-002 to GE-007 |
| Movement and physics, camera, character and animation | GE-020 to GE-035 |
| Gameplay components and environment | GE-040 to GE-046 |
| Realm and Adventure SDK, service ports, and SDK location definitions | GE-050 to GE-056, GE-075 (SDK part) |
| GameHost, Playground, debug, standard engine assembly with avatar and animation | GE-060 to GE-064 |
| Location engine bridge, lazy claims, `resume`, `setSignals` | GE-065 |
| Treasure Rush reference migration and its shared runtime: extension host contract, `gameplayClaimSink`, `nearestStandableSpot`, `scene.engineBridge` mapping, Django `engine_bridge` check, region-play claims | GE-070 (merged at owner approval, 2026-11-19) |
| Movement stack it is stacked on | PR #26 to #36 (`feature/treasure-rush-palm-trees`), not yet on `main` |

Consequence of absorbing GE-070: `core/gameengine` reaches `main` only after PR #36 and after GE-070's
owner QA.

## Verification at the baseline (unit tests only)

| Check | Result |
|---|---|
| `npm run test:engine` | 582 passed (46 files) |
| React: game-engine, island-map/three, region-play, engine boundary, golden, app | 2072 passed. 2 failed under load (average about 11 on 4 cores) and passed alone, 20 of 20: GE-D9 class |
| `npm run typecheck` parts: engine, React app, scripts | Clean |
| `engine:vectors:check`, `golden:check`, `adr:check`, docs check, LAI-ENG-002 workspace check | Pass |

Deferred to merge readiness (GE-090): lint, format, build, Playwright, owner QA.

## Open contracts and gaps at this baseline

| Gap | Asked by | Plan |
|---|---|---|
| The bridge does not forward `HazardTelegraph`, `PlatformPhaseChanged`, `SurfaceFootstep` | Firepeak | Wave 2: add to both presentation maps (parity test) and forward |
| The bridge draws nothing (engine platforms, telegraph warnings, weather, lighting, particles) | Firepeak, Pirate's Leap, North Pole | Wave 2: bridge presentation layer |
| Engine platforms do not carry or launch the live controller | Pirate's Leap | Wave 2: optional host members for carry and launch |
| No inverse signal gate ("active until restored") | Firepeak | Wave 2: `inactiveWhenSignalId` on forces, hazards and platforms |
| The live controller's fall recovery does not know bridge checkpoints | Pirate's Leap | Wave 2: expose the latest bridge checkpoint for the host's `recoveryPoint` |
| Companion bridge hooks (`extensionApi`, checkpoint labels, resume and gating effect) live on the Firepeak branch | Castle, Pirate's Leap | Firepeak pushes a generic branch off this baseline; the engine lead merges it into core |
| Sound Manager port not wired (positional loops, per-surface footsteps) | Firepeak, North Pole | Forwarded events first; port wiring after |
| Remaining locations not yet declared as engine locations | GE-075 | Wave 2: one location per commit |

## Previous baselines

| SHA | Note |
|---|---|
| `3be6e8e8` | Engine with bridge `resume` and `setSignals`, before GE-070 |
| `e9caa3d8` | Lazy bridge claims |
| `2728e428` | Location engine bridge, optional jump-only challenges |
| `e4148949` | Chest claims |
| `dcc45032` | First migration-ready SHA |
