# Game Engine Core: acceptance requirements

- **Status:** Proposed
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-053, ADR-063
- **Related tickets:** GE-001 to GE-090
- **Canonical sources:** [definition of done](../definition-of-done.md), [jumping standard](../../adventures/jumping-standard.md) acceptance checklist, [accessibility standard](../../adventures/accessibility-standard.md), [TESTING_STRATEGY](../../TESTING_STRATEGY.md)

An agent reaches **Development Complete** only. Integration, owner acceptance, merge and
deployment are separate gates.

## 1. Every work package

- [ ] Code only in the package's owned paths; shared-file edits listed on the card.
- [ ] Unit tests for new behaviour; existing tests unchanged and green.
- [ ] `npm run test:engine` and `npm run typecheck -w @lai/game-engine` pass.
- [ ] When island-map files changed: `npx vitest run --maxWorkers=2 src/features/island-map/three/`
      and `npx tsc --noEmit -p tsconfig.app.json` in `react/` pass.
- [ ] Boundary guard passes: `game/` imports only `three` and itself.
- [ ] No new dependency; no Phaser; no physics library.
- [ ] No child data in events, diagnostics or logs.
- [ ] Docs in this set and `docs/IMPLEMENTATION_STATUS.md` updated.

## 2. Per area

| Area | Acceptance |
|---|---|
| Runtime (GE-003) | Lifecycle transitions as specified; dispose idempotent and complete; dispose during start wins; fixed step independent of frame rate; long frames clamped |
| Contracts (GE-004, GE-005, GE-007) | Golden vectors pass in TypeScript and Django; strict validation; parity test with `WorldEngineEventMap` |
| Movement (GE-020 to GE-028) | Extraction changes no behaviour; defaults reproduce current movement exactly; jump limits enforced; no double jump by default; gates never jumpable; ice stops within about 1 m; forces never win against walking out; recovery never touches progress |
| Camera and character (GE-030 to GE-035) | Third-person default with first-person option; camera never inside a collider; boundary colliders ignored; no landing dip under reduced motion; avatar never moves except by the canonical transform; root motion stripped |
| Components (GE-040 to GE-046) | No timers on required routes; no loss on failure; vanishing and moving platforms only on optional routes; each hazard has a checkpoint; telegraph at least 1.5 s; accessible route claim equals the jump route claim; claims validate |
| SDK (GE-050 to GE-056) | Definitions validate with the same resolver the runtime uses; validator rejects missing accessible routes, jumpable gates, checkpoints on moving platforms, timer fields, over 64 platforms; profiles within limits per band; ports never grade or grant |
| Host and tools (GE-060 to GE-063) | Mount, start, pause on hidden, dispose on unmount, StrictMode safe; invalid claims dropped and counted; Playground absent from production builds; overlays dev-only |

## 3. Merge-readiness gates (only when the owner authorizes, GE-090)

Full Vitest for `react` and `game`; `npm run typecheck`; `npm run lint`; `npm run format:check`;
`npm run build` (no playground chunk, one `three`); `npm run adr:check`; `make docs-check`;
`make workspace-check`; Playwright smoke; owner QA on desktop and a touch device per age band.
