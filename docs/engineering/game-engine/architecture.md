# Game Engine Core: architecture

- **Status:** Proposed
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-033, ADR-059, ADR-060, ADR-063; engine core decision ADR-NNN (draft in [decisions.md](decisions.md))
- **Related tickets:** GE-001 to GE-063, LAI-2003, LAI-2101 to LAI-2104
- **Canonical sources:** [audit.md](audit.md), [public-contracts.md](public-contracts.md), [architecture rules](../architecture-rules.md), `docs/infrastructure/game-engine-package.md` on `integration/multi-agent-dev` (LAI-ENG-002, Proposed)

## 1. Layers

```text
Django (authoritative)            content, grading, progress, rewards, ownership, scoring ledger
   ^  REST (react/src/api)            ^ gameplay claims (lai.gameplay-event v1), confirmed by Django
React host (react/)               GameHost, HUD, menus, panels, Playground; implements service ports
   ^  typed events  |  ports in
@lai/game-engine (game/)          runtime, movement, camera, animation, components, SDK
   ^
three                             rendering and math (the only runtime dependency, a peer)
```

- The engine imports only `three` and itself (`game/src/boundary.test.ts`, plus LAI-ENG-002's
  `scripts/check_workspace_packages.py`).
- React provides service implementations (Asset Manager, Sound Manager, NPC Manager, Question
  Studio, quests, inventory, rewards, published content) through typed **ports**.
- The engine emits two kinds of events: **presentation** events (sound, animation, HUD; nothing
  depends on them) and **gameplay claims** (facts for Django to confirm).

## 2. Module map

| Directory | Contents | Card |
|---|---|---|
| `game/src/core/` | Lifecycle, fixed-timestep clock, entities and components, systems, event bus, resources, services, capabilities, diagnostics, runtime | GE-003 |
| `game/src/contracts/` | Gameplay events v1, presentation events, player transform, physics and environment ports | GE-004, GE-005, GE-007 |
| `game/src/movement/` | Shared controller (extracted), jump and gait config, footprint, surfaces, forces, swimming, climbing, slopes, checkpoints, movement system, capabilities | GE-020 to GE-028 |
| `game/src/input/` | Keyboard, pointer, touch, gamepad (extracted) | GE-020 |
| `game/src/physics/` | AABB `PhysicsProvider` over the controller's live collider list | GE-021 |
| `game/src/camera/` | Camera (extracted), rig, collision avoidance, capabilities | GE-030, GE-031 |
| `game/src/animation/` | State machine, blending, root-motion correction, Three.js driver | GE-032, GE-033 |
| `game/src/character/` | Avatar contract, follow system, equipment | GE-034 |
| `game/src/components/` | Collectibles, chests, doors, gates, portals, switches, plates, platforms, hazards, puzzles, jump challenges, atmosphere | GE-040 to GE-046 |
| `game/src/environment/` | Environment volumes composed into one `EnvironmentQuery` | GE-043 |
| `game/src/sdk/` | Realm and Adventure definitions, profiles, lifecycle, component registry, compatibility validator, scaffold templates | GE-050 to GE-055 |
| `game/src/services/` | Service ports, tokens and in-memory fakes | GE-056 |
| `game/src/debug/` | Collision visualization, gizmos, renderer stats | GE-062, GE-063 |
| `react/src/features/game-engine/` | `GameHost`, hooks, debug overlay, event log, Playground | GE-060 to GE-062 |
| `scripts/game-engine/` | Scaffold and validate CLIs | GE-055 |

## 3. Runtime and lifecycle

`createEngineRuntime({ id, timestep, diagnostics })` composes one of each core service. It owns no
render loop: the host calls `tick(frameSeconds)` from `requestAnimationFrame`.

```text
created --start(requests, setup)--> starting --> running <--pause/resume--> paused
                                                   any live state --dispose--> disposing --> disposed
```

- `start` resolves capability requests (dependencies first, validated, cycles rejected), installs
  each, then awaits an optional `setup` (scene and asset loading). A failure disposes what was
  installed and rethrows. A `dispose` during `start` wins.
- `tick` advances the fixed-timestep clock (default 1/60 s steps, clamped long frames, at most 8
  steps per frame; the movement controller still substeps at 1/120 s internally) and runs systems
  by phase: `input`, `simulation`, `postSimulation` per step, then `presentation` once per frame
  with the interpolation `alpha`.
- `resume` resets the accumulator so a pause never replays as a burst.
- `dispose` is idempotent: capabilities uninstall in reverse, systems dispose, resource scopes
  dispose children first and then resources in reverse order, entities and services clear.

## 4. Composition, not inheritance

- **Entities** are numeric handles with an optional authored **semantic id** (durable state is
  keyed by semantic ids, never Three.js UUIDs, ADR-008). Components are plain data under typed
  tokens (`defineComponent<T>('gameplay.collectible')`).
- **Systems** are plain objects with `id`, `phase`, `order` and `update`.
- **Capabilities** are named, versioned, validated units of behaviour (`movement.jump`,
  `camera.thirdPerson`, `gameplay.platforms`, `environment.weather`). An adventure turns them on
  with data. Each declares `defaults`, `validate` (never throws), `requires`, and `install`, which
  adds systems and components and returns an uninstall.
- Jumping is a capability like any other, not a separate platforming category. Its config keeps
  the jumping standard's limits.

## 5. Canonical player transform

One `PlayerTransform` (`game/src/contracts/player.ts`) on the `player` entity:

- the **movement system writes it once per simulation step**: feet position after collision,
  previous position, yaw, pitch, achieved velocity, grounded, movement state, gait, support id;
- **collision, camera, avatar, animation, audio and components only read it**.

This keeps the two owner-QA'd fixes structural rather than incidental:

| Fix | How the architecture preserves it |
|---|---|
| Avatar drift when blocked (P0) | The avatar root sits exactly at the interpolated transform; root motion is stripped from the root/hips bone (GE-033); gait and animation follow *achieved* velocity, so walking into a wall plays idle, not walk |
| Wall penetration | Only the controller moves the player, through its sub-stepped, escape-only cylinder collision; the camera follows the collided position and shortens its boom by raycast (GE-031), skipping invisible boundary colliders |

## 6. Physics provider

The collision model is unchanged: axis-aligned boxes in one live list, solid by default,
jumpable only where authored, gates never jumpable, triggers entered by x/z. `PhysicsProvider`
names it as a port so doors, platforms and the camera share one API. The default provider is
AABB over the controller's live arrays. **No physics dependency is added.** Tilting, seesaw,
rolling and rope mechanics stay out of scope until an ADR approves a physics library (jumping
standard).

`EnvironmentQuery` tells movement about surfaces (friction, speed, footstep cue), forces
(wind, currents, conveyors, updrafts), water and climbables. Volume components provide it, and
movement consumes it, so neither knows the other.

## 7. Gameplay claims and scoring

The engine builds claims with `createGameplayEventFactory` and emits them on the runtime bus as
`gameplay.event`. `GameHost` validates each claim and forwards it to the host, which sends it to
Django. Scoring (GE-100) owns the ledger, policy, achievements, currency and UI. The engine has
none of them. Contract details: [public-contracts.md](public-contracts.md).

## 8. Dependency boundaries and ownership

| Rule | Enforced by |
|---|---|
| `game/` imports only `three` and itself; no `.tsx` | `game/src/boundary.test.ts`; `check_workspace_packages.py` (LAI-ENG-002) |
| React consumes the engine by package name, never by relative path | `react/package.json` dependency `@lai/game-engine` |
| One `three` copy | `three` is a peer of the engine with the same range as `react` |
| Presentation events stay in step with `WorldEngineEventMap` | `react/src/features/island-map/three/engineEventParity.test.ts` |
| Claims carry no child data and no extra fields | Strict validator + golden vectors |

File ownership and merge sequencing are in [agent-ownership.md](agent-ownership.md).

## 9. Migration strategy

1. Extract pure modules with `git mv` and leave re-export shims at the old paths, so existing
   importers on every branch compile unchanged (no realm branch edits the moved files).
2. Build engine-side equivalents for modules that cannot move yet (avatar, animation,
   platforms), each with a source note.
3. Migrate realms through the SDK in the agreed order: Treasure Rush (reference), Pirate's Leap,
   Storykeeper's Castle, Firepeak, North Pole, then the remaining locations. Compatible
   migrations run in parallel once the contracts are stable.
4. Remove shims and duplicated legacy logic only after every consumer has migrated and
   regression evidence exists (GE-076).

Realms still on the live `createLocationEngine` get engine components through the **location
engine bridge** (GE-065, `react/src/features/game-engine/bridge/`). It is a `WorldExtension` that
runs an engine runtime inside the live runtime. It reads the player state, adds colliders with
`engine:` ids, gives the live controller the engine's `EnvironmentQuery`, recovers hazards
through the host's teleport, and sends claims to the decision-E15 sink. Movement, camera,
character and platforms stay with the live runtime until GE-076, so nothing runs twice.

Per-realm detail: [migration-matrix.md](migration-matrix.md).
