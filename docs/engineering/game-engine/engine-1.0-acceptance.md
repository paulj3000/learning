# Game Engine Core 1.0: acceptance

- **Status:** Proposed (prepared for GE-090; not executed. Browser, Playwright and owner QA run only when the owner authorizes them)
- **Owner:** Project owner
- **Last reviewed:** 2026-11-19
- **Related ADRs:** ADR-020, ADR-053, ADR-063 (Reserved on `main`), engine core decision ADR-NNN (draft, [decisions.md](decisions.md))
- **Related tickets:** GE-090, GE-001 to GE-076, GE-100 to GE-110
- **Canonical sources:** [acceptance-requirements.md](acceptance-requirements.md), [definition of done](../definition-of-done.md), [TESTING_STRATEGY](../../TESTING_STRATEGY.md), [integration-baseline.md](integration-baseline.md)

Engine 1.0 means the public contracts are stable enough to freeze (package version `1.0.0`,
claims `lai.gameplay-event` v1), every shipped 3D location and realm runs on or through the
engine, and the owner has accepted it. The owner alone records acceptance.

## 1. Entry criteria (all required before the owner starts QA)

- [ ] Movement stack PR #26 to #36: merged to `main` first, or merged through `core/gameengine` (owner decision O9). Merged alone, PR #36 adds a second `## ADR-055` heading and fails `npm run adr:check`; `core/gameengine` already resolves it (decision E9).
- [ ] GE-070 owner QA passed (it is part of `core/gameengine`).
- [ ] GE-066, GE-071, GE-072, GE-073, GE-074 and GE-075 at Development Complete with evidence.
- [ ] Owner decisions O1 to O8 in [decisions.md](decisions.md) recorded (at least O1 LAI-2003, O2 the ADR number, O3 the ADR-063 resolution, O4 merge order).
- [ ] Scoring (GE-100 to GE-110) integrated, or explicitly deferred, with the economy off unless approved.
- [ ] No open defect above Low in [known-defects.md](known-defects.md).

## 2. Merge-readiness gates (run by the owner's authorization, GE-090)

| Gate | Command | Pass condition |
|---|---|---|
| Engine unit tests | `npm run test:engine` | All pass |
| Full frontend unit tests | `python3 scripts/dev/test_gate.py --full -- npm test` (host-wide slots, LAI-ENG-002) | All pass. A failure under the gated run is a failure; only a run the gate reports as INFRASTRUCTURE may be rerun (GE-D9-class flakes are not waived) |
| Backend tests | `make py-test`, `make py-test-db` | All pass, including on PostgreSQL 18 |
| Migrations | `make migrate-check` on PostgreSQL 18; `python3 scripts/dev/migration_audit.py` | Clean; no DIVERGENT, REWRITE or STALE PARENT |
| Content | `npm run content:check` | Exported content up to date |
| Python lint and format | `make py-lint py-format-check` | Clean |
| Typecheck | `npm run typecheck` | Clean |
| Lint and format | `npm run lint`, `npm run format:check` | Clean |
| Build | `npm run build` | Succeeds; no Playground chunk; exactly one `three` copy |
| Contracts | `npm run engine:vectors:check`, `npm run golden:check` | Up to date |
| Governance | `npm run adr:check`, `make docs-check`, `make workspace-check` | Pass |
| Browser smoke | `npm run test:e2e` (Playwright smoke) | Pass |

## 2a. Deployment impact (merging is not deploying)

Merging `core/gameengine` to `main` matches the paths of `deploy-site` (`react/**`, `package*.json`,
and `game/**` once LAI-ENG-002's B10 change is accepted) and of `deploy-dev-native` and
`deploy-django-ec2` (`lai/**`, `content/**`). Each needs its own owner deploy approval, and an RDS
snapshot before migrating any deployed database ([release policy](../release-policy.md)).

CI after merge: LAI-ENG-002 adds "Engine unit tests" (`npm run test:engine`) and "Engine contract
vectors" (`npm run engine:vectors:check`) steps to `ci.yml`. These script names are stable
contracts; do not rename them.

## 3. Owner QA checklist (browser, desktop and a touch device, per age band)

| Area | Check |
|---|---|
| Movement | Walk, run, sprint feel unchanged; jump with Space, the touch button and gamepad A; no double jump; coyote time and jump buffer feel forgiving |
| Collision | No wall penetration; the avatar never drifts when blocked; the camera never ends inside a wall; tall walls lift the camera |
| Checkpoints | A missed jump, water or lava returns the child to the latest checkpoint with a kind message; nothing is lost; a returning child resumes at the furthest earned checkpoint |
| Accessibility | Every required route works without jumping; reduced motion removes the landing dip, sprint zoom and blinking; keyboard reaches every interaction; touch Jump never covers other controls |
| Hazards | Telegraphed hazards warn at least 1.5 s before; force volumes never push into a hazard; ice stops within about 1 m |
| Realms | Treasure Cove, Pirate's Leap, Storykeeper's Castle, Heart of Firepeak and North Pole play as before, with every learning activity and reward intact |
| Locations | Welcome Harbor, Pirate Builder Bay, Clockwork Harbor, Dragon's Sanctuary, Explorer Cove and the sandbox unchanged |
| Claims | Each collectible, checkpoint, puzzle, quest step and completion is claimed once; nothing is claimed on a fall or respawn; scoring shows pending then confirmed awards |
| Privacy | Diagnostics, logs and claims carry no child names, free text, audio or identifiers |
| Performance | ADR-020 provisional targets (desktop 60 FPS, tablet and phone 30 FPS) measured with the LAI-2105 method; record numbers, not impressions |

## 4. Freeze at 1.0

- `game/package.json` and `ENGINE_API_VERSION` move to `1.0.0` in the same pull request as every consumer.
- After 1.0, a breaking change needs a new contract version beside the old one
  ([public-contracts.md](public-contracts.md) section 1).
- GE-076 retirement continues after 1.0 under [legacy-retirement-plan.md](legacy-retirement-plan.md).

## 5. Evidence to attach on GE-090

Command outputs with counts; the SHA tested; the device list; per-age-band QA notes; open defects
with severity; the owner's acceptance line, written by the owner.
