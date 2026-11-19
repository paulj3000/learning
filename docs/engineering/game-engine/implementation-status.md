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
| GE-004 | Gameplay claims v1 and contract vectors | Built | `f10e3a1e`, this branch's vector move | 22 valid and 17 invalid vectors; Django parity tests pass on `core/ge-scoring` (reported by the scoring lead) |
| GE-005 | Player, physics, environment contracts | Built | `8e5bcb9b` | `contracts/player.test.ts` |
| GE-006 | Owner decisions | Open | | [decisions.md](decisions.md) section 3 |
| GE-007 | Presentation event parity | Built | `8e5bcb9b` | Type-level parity test, `react tsc` clean |
| GE-020 to GE-028 | Movement and physics | In progress | | Workstream worktree |
| GE-030 to GE-035 | Camera, character, animation | In progress | | Workstream worktree |
| GE-040 to GE-046 | Gameplay components | In progress | | Workstream worktree |
| GE-050 to GE-056 | SDK and services | In progress | | Workstream worktree |
| GE-060 to GE-063 | GameHost, Playground, debug | In progress | | Workstream worktree |
| GE-070 to GE-076 | Realm migrations, legacy retirement | Planned | | Waits on the migration-ready SHA |
| GE-090 | Integration and merge readiness | Planned | | Owner-authorized gates only |

## 2. Checks run (development cadence)

| Check | Result |
|---|---|
| `npm run test:engine` (`game/`, Vitest, Node) | 86 passed |
| `npm run typecheck -w @lai/game-engine` | Clean |
| `npx tsc --noEmit -p tsconfig.app.json` in `react/` | Clean |
| `npx vitest run src/features/island-map/three/` in `react/` (baseline after the stack merge) | 1847 passed, 1 failed once then passed on rerun (GE-D1, flaky) |
| `npx vitest run src/test/golden/` in `react/` | 6 passed |
| `npm run golden:check`, `npm run engine:vectors:check` | Up to date |
| `npm run adr:check` | Passed after the `DECISIONS.md` merge resolution |
| `npx tsc --noEmit -p scripts/tsconfig.json` | Clean |
| `make docs-check` equivalent (`python3 scripts/check_engineering_docs.py`) | Run after each docs change |

Deferred to merge readiness (GE-090): full suites, lint, format, build, Playwright, owner QA.
