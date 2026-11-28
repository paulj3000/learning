# Game Engine Core

- **Status:** Proposed (development on `core/gameengine`; not merged, not owner-accepted)
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020 (Accepted), ADR-033 (Accepted), ADR-053 (Accepted), ADR-072 (Accepted); movement stack Reserved on `main`: ADR-056, ADR-057, ADR-058, ADR-059, ADR-060, ADR-063; engine core decision ADR-NNN (number not yet reserved)
- **Related tickets:** GE-001 (parent), GE-002 to GE-090, GE-100 to GE-110 (scoring), LAI-2003 (APPROVAL), LAI-2101, LAI-2102, LAI-2103, LAI-ENG-002
- **Canonical sources:** [ADR-020 in DECISIONS](../../DECISIONS.md), [jumping standard](../../adventures/jumping-standard.md), [scoring standard](../../adventures/scoring-standard.md), [architecture rules](../architecture-rules.md), [THREEJS_ENGINE_CONVERSION](../../THREEJS_ENGINE_CONVERSION.md)

The Game Engine Core is the one reusable Three.js engine that every Realm and Adventure consumes.
It lives in the top-level [`game/`](../../../game/package.json) directory as the npm workspace
package `@lai/game-engine` (ADR-020 item 4). React hosts it; Django stays authoritative for
content, grading, progress, rewards and ownership.

This set is a subsystem document set under `docs/engineering/` because the owner asked for it
here. It is **Proposed**, not Mandatory policy: where it disagrees with a mandatory standard, the
standard wins and this set is corrected.

## Documents

| Document | What it holds |
|---|---|
| [integration-baseline.md](integration-baseline.md) | The current engine baseline SHA realm branches and scoring merge, with its verification and open gaps |
| [audit.md](audit.md) | Phase 1 audit: existing engine code, duplication, what is extracted and what is rewritten |
| [architecture.md](architecture.md) | Layers, module map, canonical player transform, lifecycle, capabilities, boundaries |
| [public-contracts.md](public-contracts.md) | Versioned public interfaces: gameplay events v1, presentation events, player, physics, environment, capabilities, SDK |
| [decisions.md](decisions.md) | Engine decisions taken, the draft ADR and the owner decisions still needed |
| [migration-matrix.md](migration-matrix.md) | Per realm and location: what moves, in what order, with what evidence |
| [dependency-matrix.md](dependency-matrix.md) | Package, module and branch dependencies |
| [agent-ownership.md](agent-ownership.md) | Who owns which files and the merge sequence |
| [implementation-status.md](implementation-status.md) | What is built, tested and pushed, with commits |
| [known-defects.md](known-defects.md) | Known defects, risks and flaky tests |
| [bundled-asset-references.md](bundled-asset-references.md) | GE-247: shipped-scene asset ids in Asset Library dependency reporting |
| [raised-solid-clearance.md](raised-solid-clearance.md) | GE-L16: raised Solid collision and walk-under clearance (audit, root cause, rule, tests) |
| [legacy-retirement-plan.md](legacy-retirement-plan.md) | GE-076: shims, duplicated live code, leaked content, and the gates for removing each |
| [phaser-retirement-audit.md](phaser-retirement-audit.md) | Phaser retirement: completion measure, runtime dependencies, eight-world parity matrix, engine gaps, Phase 2 tasks and sequence |
| [guided-movement.md](guided-movement.md) | LAI-2104S B1: Sprouts tap-to-walk: walk grid, path search, reachability helper for realm tests, guided steering, assisted camera, live wiring and limits |
| [engine-1.0-acceptance.md](engine-1.0-acceptance.md) | GE-090: entry criteria, merge-readiness gates and the owner QA checklist for Engine 1.0 |
| [acceptance-requirements.md](acceptance-requirements.md) | Acceptance criteria per work package and the merge gates |

## Quick start

```bash
npm ci                                   # once per worktree
npm run test:engine                      # the engine's own Vitest run (Node)
npm run typecheck -w @lai/game-engine    # strict typecheck of game/
npm run engine:scaffold -- --realm <realm-id> --adventure <adventure-id> --jump --dry-run
```

The development-only Game Engine Playground is at `/dev/game-engine` under `npm run dev` (it is
not part of production builds).

## Rules that never bend

- Three.js is the only gameplay renderer. No Phaser features. No physics library without an ADR
  and owner approval.
- The engine imports no React, Django client, Amplify or AWS SDK (`game/src/boundary.test.ts`).
- The engine emits events. It never grades answers, grants rewards, scores, or decides mastery.
- Jumping is a standard capability any adventure may enable. Every required route works without
  jumping. No timers, lives, or loss of progress.
- No child names, free text, audio or identifiers in events, diagnostics or logs.
