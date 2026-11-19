# Game Engine Core: agent ownership

- **Status:** Proposed
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-072
- **Related tickets:** GE-001
- **Canonical sources:** [multi-agent workflow](../multi-agent-workflow.md), [integration policy](../integration-policy.md), [AGENTS.md](../../../AGENTS.md)

Agent ids are owner-assigned; sessions are named here by their working names. The owner has not
assigned numbers to these sessions, so none are claimed.

## 1. Sessions

| Session | Role | Branch | Owns |
|---|---|---|---|
| gameengine-54 | Engine lead: integration and shared interfaces | `core/gameengine` | `game/src/core/**`, `game/src/contracts/**`, `game/src/index.ts`, `game/package.json`, `game/tsconfig.json`, `game/vitest.config.ts`, `tests/contracts/gameplay-events-v1.json`, `docs/engineering/game-engine/**`, root and `react/` manifest edits |
| scoring-cb | Scoring and progression (GE-100 to GE-110) | `core/ge-scoring` | Ledger, policy, achievements, currency, scoring UI, Django intake |
| treasure-rush-c8 | Treasure Rush and Pirate's Leap; movement stack owner | `feature/treasure-rush-palm-trees` | GE-070, GE-071 |
| storybook-dc | Storykeeper's Castle | `feature/storykeeper-castle-completion` | GE-072 |
| firepeak-86 | Firepeak and North Pole | `feature/firepeak-volcano-adventure`, `feature/north-pole-adventure` | GE-073, GE-074 |
| integration-fa | Infrastructure and integration (LAI-ENG-002) | `integration/multi-agent-dev` | Workspace checks, integration plan |

## 2. Engine workstreams (subagent worktrees under the engine lead)

Each workstream runs in its own git worktree from `8e5bcb9b`, commits locally and never pushes.
The engine lead merges them.

| Workstream | Owned paths (exclusive) | Shared files touched |
|---|---|---|
| Movement and physics (GE-020 to GE-028) | `game/src/movement/**`, `game/src/input/**`, `game/src/physics/**` | Six island-map modules become shims |
| Camera, character, animation (GE-030 to GE-035) | `game/src/camera/**`, `game/src/animation/**`, `game/src/character/**` | Four island-map camera modules become shims |
| Gameplay components (GE-040 to GE-046) | `game/src/components/**`, `game/src/environment/**` | none |
| SDK and services (GE-050 to GE-056) | `game/src/sdk/**`, `game/src/services/**`, `scripts/game-engine/**` | `scripts/tsconfig.json` (reported, lead edits) |
| Host and tools (GE-060 to GE-063) | `react/src/features/game-engine/**`, `game/src/debug/**` | `react/src/app/AppRoutes.tsx` (one dev-only route) |

No two workstreams own the same file. Exports are added to `game/src/index.ts` by the lead only.

## 3. Merge sequence into `core/gameengine`

1. Movement and physics (the other workstreams' tests run without it, so it can go first).
2. Camera, character and animation.
3. Gameplay components.
4. SDK and services.
5. Host and tools, then the lead wires the Playground to the merged capabilities.

After each merge the lead runs the engine suite, the island-map/three suite and both
typechecks before the next.

## 4. Rules

- Never edit another session's branch or worktree. Coordinate by message and on the card.
- A change to a moved module is requested from the engine lead, not made on a realm branch.
- Contract changes (`game/src/contracts/**`, golden vectors) go through GE-004 and the
  scoring lead.
