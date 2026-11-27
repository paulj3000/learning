# Game Engine Core: dependency matrix

- **Status:** Proposed
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-059, ADR-060, ADR-063
- **Related tickets:** GE-001, GE-090, LAI-ENG-002
- **Canonical sources:** `game/package.json`, root `package.json`, [architecture.md](architecture.md)

## 1. Package dependencies

| Package | Depends on | Kind | Notes |
|---|---|---|---|
| `@lai/game-engine` (`game/`) | `three` `^0.185.1` | peer | The only runtime dependency. No new dependency was added |
| `@lai/game-engine` tests | `vitest`, `typescript`, Node built-ins, `jsdom` (opt-in per file) | dev (hoisted from the root) | Already in the root `devDependencies` |
| `learning-adventure-island-react` (`react/`) | `@lai/game-engine` `0.2.0` | workspace | The app depends on the engine, never the reverse |

Lockfile change: the workspace link entries only.

## 2. Module dependencies inside `game/src`

```text
contracts ──> core
movement  ──> contracts, core, physics
input     ──> movement (MoveInput), core
physics   ──> contracts, core
camera    ──> contracts, core            (reads PlayerTransform, PhysicsProvider)
animation ──> contracts, core            (reads PlayerTransform)
character ──> animation, contracts, core
components──> contracts, core, environment
environment─> contracts, core
sdk       ──> core, contracts            (takes any CapabilityRegistry; imports no feature module)
services  ──> core, contracts
debug     ──> contracts, core
```

`core` depends on nothing but itself. No module imports `react/`.

## 3. Work-package dependencies

| Card | Needs |
|---|---|
| GE-020 to GE-028 movement | GE-005 |
| GE-030 to GE-035 camera and character | GE-005 |
| GE-040 to GE-046 components | GE-004, GE-005 |
| GE-050 to GE-056 SDK and services | GE-003, GE-004 |
| GE-060 to GE-063 host and tools | GE-003 |
| GE-070 Treasure Rush | GE-020 to GE-056 merged on `core/gameengine` |
| GE-071 to GE-075 | GE-070 |
| GE-076 legacy retirement | GE-070 to GE-075 |
| GE-090 integration | PR #26 to #36 merged; LAI-2003 approval |
| GE-104, GE-108 scoring intake and HUD | GE-004 (published, `f10e3a1e`) |

## 4. Branch dependencies

```text
main 8bd19fb7 ─┐
               ├─ core/gameengine (merge 5b300e30)
420f1afd (PR #36, contains #26 #27 #28 #29 #37) ─┘
core/ge-scoring  merges core/gameengine for the contracts
realm branches   merge core/gameengine at a migration-ready SHA
```

`core/gameengine` merges after the movement stack. A stacked branch is brought up to date by
merging `main` into it; it is never rebased (integration policy).
