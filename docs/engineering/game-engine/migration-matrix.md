# Game Engine Core: migration matrix

- **Status:** Proposed
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-033, ADR-051, ADR-080 (Reserved); Firepeak's Heart of Firepeak decision takes number 073 (owner settlement 2026-11-19; `feature/firepeak-volcano-adventure` `5caec70e`; its Reserved row on `main` is pending)
- **Related tickets:** GE-070 to GE-076
- **Canonical sources:** [architecture.md](architecture.md) section 9, [integration policy](../integration-policy.md)

## 1. Order

1. **Treasure Rush** (GE-070): reference implementation.
2. **Pirate's Leap** (GE-071).
3. **Storykeeper's Castle** (GE-072).
4. **Firepeak** (GE-073).
5. **North Pole** (GE-074), stacked on Firepeak.
6. **Remaining locations** (GE-075).
7. **Legacy retirement** (GE-076), last.

Once GE-070 is merged and the contracts are stable, GE-071 to GE-075 may run in parallel on
their own realm branches. A realm migrates by merging `core/gameengine` into its branch at a
"migration-ready" SHA the engine lead publishes (currently `e4148949`), then switching imports and adopting SDK
definitions. **Nothing legacy is removed before its consumers migrate and regression evidence
exists.**

## 2. Matrix

| Realm / location | Branch | Owner session | Engine pieces adopted | Legacy kept until | Evidence required | State |
|---|---|---|---|---|---|---|
| Treasure Rush (Treasure Cove) | `feature/treasure-rush-palm-trees` | treasure-rush-c8 | Movement, jump, camera, avatar follow, collectibles, chests, platforms, claims | GE-076 | Existing TR unit tests unchanged; drift and penetration regressions; validator on the seed | Development Complete (`cd0cbf01`, not merged, owner QA pending): imports on `@lai/game-engine`, host contract, bridge wiring, Treasure Cove `AdventureDefinition` validated against the seed, v1 claims through one per-visit sink. Evidence and handoff on that branch (section 5 of this file there) |
| Pirate's Leap | `feature/pirates-leap` (inside Treasure Rush) | treasure-rush-c8 | Jump challenges (equal routes), course checkpoints and goals, platforms | GE-076 | Course tests; validator: every required step has a non-jump route | Backlog |
| Storykeeper's Castle | `feature/storykeeper-castle-completion` | storybook-dc | Runtime, camera, movement (jump optional), discovery claims, SDK hooks | GE-076 | Castle tests unchanged; page ids, objectives and progress unchanged | Backlog; `createLocationEngine` edits reconciled first |
| Firepeak (Heart of Firepeak) | `feature/firepeak-volcano-adventure` | firepeak-86 | Hazards (lava, telegraphed rocks), steam forces, crumble-then-fall, one checkpoint system, traction, footsteps | GE-076 | Firepeak tests unchanged; one checkpoint list | In development (owner approved 2026-11-19). One checkpoint list done (`d97f20c4`): 8 Heart checkpoints gated by `world:<key>` signals and the lava static hazard run on the bridge; the platforming and region-play lists and the platforming hazard were deleted in the same commit. Telegraphed rocks, steam and crumble-then-fall wait on an owner design call |
| North Pole | `feature/north-pole-adventure` | firepeak-86 | Ice traction, snow and ice footsteps, weather as data, optional jump routes | Atmosphere parity | NP tests unchanged; atmosphere parity | In development (owner approved 2026-11-19). Carries the Firepeak bridge wiring (`4b9c3a4d`); next: one checkpoint list (9 zone and 2 lake-course checkpoints) and the lake water hazard on the bridge |
| Welcome Harbor, Pirate Builder Bay, Clockwork Harbor, Dragon's Sanctuary, Wonderwild Forest and Hive, Explorer Cove, sandbox | `main` regions | engine lead | Location definitions with capability requests | GE-076 | One location per commit; parity tests unchanged | Backlog |
| Phaser worlds | `main` | (conversion tasks LAI-2201+) | None. No new Phaser features (ADR-020) | Their conversion | Out of scope | n/a |

## 3. Realm inputs recorded

| Realm | Input | Parity evidence the migration must keep |
|---|---|---|
| Treasure Rush, Pirate's Leap | `docs/engine/TREASURE_RUSH_ENGINE_HANDOFF.md` on `feature/treasure-rush-palm-trees` @ `6818f74b` (sections 6.4, 7.2, 8) | Section 8 guard tests; mid-visit world refresh never rebuilds the engine; `signalPlatforms('world:<key>')` |
| Storykeeper's Castle | `docs/regions/storykeeper_castle_engine_integration.md` sections 4 and 6 on `feature/storykeeper-castle-completion` @ `25d5f7d6`; `castleEngineProfile.ts` (movement and camera settings, types only from the shimmed modules) | `runtime/manifests/castleMovementAudit.engine.test.ts` runs unchanged against the SDK harness; `castleSaveContract.test.ts` pins every saved castle id |
| Firepeak, North Pole | `docs/firepeak/REALM_ENGINE_REQUIREMENTS.md` on `feature/firepeak-volcano-adventure` @ `3e2b513c`; `platforming.recoveryLead` (`645b7373`, `821c8085`) | Existing realm tests; one checkpoint list; `recoveryLead` carried by hazard recovery copy |

## 4. Per-migration checklist

- [ ] Merge `core/gameengine` at the published migration-ready SHA (no rebase).
- [ ] Imports move from the island-map shims to `@lai/game-engine`.
- [ ] An `AdventureDefinition` (or location definition) declares capability requests.
- [ ] `npm run engine:validate` passes on the realm's content.
- [ ] Gameplay claims are emitted for the realm's learning, exploration, collectibles, jump,
      course, puzzle, NPC, quest and completion facts, and the host forwards them.
- [ ] Existing realm unit tests pass unchanged. New tests cover the definition.
- [ ] No child progress, content, page id or learning objective changed.
- [ ] Evidence (commits, test counts) recorded here and on the card.
