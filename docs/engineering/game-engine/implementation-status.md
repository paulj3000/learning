# Game Engine Core: implementation status

- **Status:** Proposed (development only; nothing merged to `main`, nothing owner-accepted)
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-063
- **Related tickets:** GE-001 to GE-090
- **Canonical sources:** `git log origin/core/gameengine`, the GE cards on Trello, [acceptance-requirements.md](acceptance-requirements.md)

States: **Built** (code and unit tests on `core/gameengine`), **In progress** (in a workstream
worktree, not yet merged), **Planned**. No item is Owner Accepted or Complete.

## 1. Work packages

| Card | Item | State | Commit | Evidence |
|---|---|---|---|---|
| GE-002 | `game/` package, workspace, boundary guard | Built | `f10e3a1e`, `0b4c68c3` | Engine suite; LAI-ENG-002 workspace check passes (2 packages, engine first) |
| GE-003 | Core runtime | Built | `f10e3a1e` | `core/*.test.ts` |
| GE-004 | Gameplay claims v1 and contract vectors | Built | `f10e3a1e`, this branch's vector move | 24 valid and 19 invalid vectors (optional `pickupKey` added in v1); Django parity tests pass on `core/ge-scoring` (reported by the scoring lead) |
| GE-005 | Player, physics, environment contracts | Built | `8e5bcb9b` | `contracts/player.test.ts` |
| GE-006 | Owner decisions | Open | | [decisions.md](decisions.md) section 3 |
| GE-007 | Presentation event parity | Built | `8e5bcb9b` | Type-level parity test, `react tsc` clean |
| GE-020 to GE-028 | Movement extraction (git mv + shims), AABB physics provider, surfaces and ice, external forces, swimming, climbing, slope limit, movement capabilities and system | Built | `c8385700`, `3f9fc423` | Moved tests pass unchanged apart from imports; ice stop under 0.9 m at 30, 60 and 144 fps; neutral environment frame-identical to none; island-map/three 1717 passed in the workstream, 1753 after integration |
| GE-030 to GE-035 | Camera extraction (git mv + shims), camera rig and collision avoidance, animation state machine and blending, root-motion correction, avatar and equipment sockets | Built | `aa502cb8`, `1ad00461`, `3f9fc423` | Camera never ends inside a collider (bisect test); root motion stripped on a Mixamo-style rig; Sprouts tap-to-move (GE-035) not built (LAI-2104) |
| GE-040 to GE-046 | Collectibles, chests, doors, portals, plates, switches, platforms (moving, rotating, crumble-then-fall, bounce), hazards (static, telegraphed), puzzles, jump challenges, environment volumes, lighting, weather, particles | Built | `3bc5e63c`, `9c8133d3`, `3f9fc423` | Telegraph at least 1.5 s validated; forces never push into a hazard (definition and query time); accessible route claim equals jump route claim; claims validated |
| GE-050 to GE-056 | Realm and Adventure definitions, age-band profiles, lifecycle, component registry, content compatibility validator, scaffold and validate CLIs, service ports and fakes | Built | `df3545a4`, `2358196c`, `3f9fc423` | Scaffold dry run writes 3 files; validator rejects missing accessible routes, jumpable gates, checkpoints on moving platforms, timer fields, over 64 platforms |
| GE-060 to GE-063 | GameHost, dev-only Playground at `/dev/game-engine`, debug overlay, event log, collision visualization, renderer stats | Built | `297bc29b`, `b475c41c` | GameHost: mount, tick, pause on hidden and blur, dispose, StrictMode, error and retry, invalid claims dropped |
| GE-064 | Standard engine assembly: `createStandardCapabilityRegistry`, `createStandardEngine`, `wireStandardGameplay`, host contract (`engine/host.ts`); Playground runs the real engine | Built | `12c1750f`, `57b3c32f` | 13 assembly tests: wall stop without penetration, jump only with `movement.jump`, ice stops within 1.05 m, accessible route claim, one `PlayerRecovered` with `hazardId`, platform carry, input reset, clean dispose. Avatar and animation wired in `a4d1ebf0` (7 tests: root on the transform, idle outweighs walk at a wall, root motion stripped, clean dispose) |
| GE-065 | Location engine bridge: a `WorldExtension` that runs engine gameplay and environment components inside the live `createLocationEngine`; `FirstPersonController.setEnvironment` | Built | `abd19792`, `8cd84bfe` | 9 bridge tests (degraded mount on today's host, hazard recovery with one `PlayerRecovered` carrying `hazardId`, claim sink, ice reaching `setEnvironment`, collider ids, clean dispose); 3 controller tests. Host-side members land in GE-070 |
| GE-070 | Treasure Rush reference migration | Development Complete on its realm branch | `cd0cbf01` (`feature/GE-070-treasure-rush-engine-migration`) | Reported by the Treasure Rush session: Vitest 3,058 (3 load timeouts, each passing alone), game 578, pytest 1,094, typecheck and docs-check clean. Not merged; owner QA pending |
| GE-070 to GE-076 | Realm migrations, legacy retirement | GE-073, GE-074 in development on realm branches (owner approved 2026-11-19, as reported by the realm leads); others planned | | Realm branches |
| GE-090 | Integration and merge readiness | Planned | | Owner-authorized gates only |

## 2. Checks run (development cadence)

| Check | Result |
|---|---|
| `npm run test:engine` (`game/`, Vitest, Node) | 578 passed (45 files) |
| `npm run typecheck -w @lai/game-engine` | Clean |
| `npx tsc --noEmit -p tsconfig.app.json` in `react/` | Clean |
| `npx vitest run src/features/island-map/three/` in `react/` (baseline after the stack merge) | 1847 passed, 1 failed once then passed on rerun (GE-D1, flaky) |
| `npx vitest run src/test/golden/` in `react/` | 6 passed |
| `react/`: island-map/three, game-engine, engine boundary, golden, app (after all merges) | 1764 of 1765 passed (142 files); the one failure is the GE-D9 flake, reproduced without engine changes |
| LAI-ENG-002 `check_workspace_packages.py` (from `integration/multi-agent-dev`) | 2 packages OK, engine first |
| `npm run golden:check`, `npm run engine:vectors:check` | Up to date |
| `npm run adr:check` | Passed after the `DECISIONS.md` merge resolution |
| `npx tsc --noEmit -p scripts/tsconfig.json` | Clean |
| `make docs-check` equivalent (`python3 scripts/check_engineering_docs.py`) | Run after each docs change |

Deferred to merge readiness (GE-090): full suites, lint, format, build, Playwright, owner QA.
