# Game Engine Core: migration matrix

- **Status:** Proposed
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-033, ADR-051, ADR-070 (Reserved, collision), ADR-080 (Reserved)
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
"migration-ready" SHA the engine lead publishes, then switching imports and adopting SDK
definitions. **Nothing legacy is removed before its consumers migrate and regression evidence
exists.**

## 2. Matrix

| Realm / location | Branch | Owner session | Engine pieces adopted | Legacy kept until | Evidence required | State |
|---|---|---|---|---|---|---|
| Treasure Rush (Treasure Cove) | `feature/treasure-rush-palm-trees` | treasure-rush-c8 | Movement, jump, camera, avatar follow, collectibles, chests, platforms, claims | GE-076 | Existing TR unit tests unchanged; drift and penetration regressions; validator on the seed | Backlog; waits on the migration-ready SHA |
| Pirate's Leap | `feature/pirates-leap` (inside Treasure Rush) | treasure-rush-c8 | Jump challenges (equal routes), course checkpoints and goals, platforms | GE-076 | Course tests; validator: every required step has a non-jump route | Backlog |
| Storykeeper's Castle | `feature/storykeeper-castle-completion` | storybook-dc | Runtime, camera, movement (jump optional), discovery claims, SDK hooks | GE-076 | Castle tests unchanged; page ids, objectives and progress unchanged | Backlog; `createLocationEngine` edits reconciled first |
| Firepeak (Heart of Firepeak) | `feature/firepeak-volcano-adventure` | firepeak-86 | Hazards (lava, telegraphed rocks), steam forces, crumble-then-fall, one checkpoint system, traction, footsteps | GE-076 | Firepeak tests unchanged; one checkpoint list | Backlog; ADR-070 collision first |
| North Pole | `feature/north-pole-adventure` | firepeak-86 | Ice traction, snow and ice footsteps, weather as data, optional jump routes | Atmosphere parity | NP tests unchanged; atmosphere parity | Backlog |
| Welcome Harbor, Pirate Builder Bay, Clockwork Harbor, Dragon's Sanctuary, Wonderwild Forest and Hive, Explorer Cove, sandbox | `main` regions | engine lead | Location definitions with capability requests | GE-076 | One location per commit; parity tests unchanged | Backlog |
| Phaser worlds | `main` | (conversion tasks LAI-2201+) | None. No new Phaser features (ADR-020) | Their conversion | Out of scope | n/a |

## 3. Per-migration checklist

- [ ] Merge `core/gameengine` at the published migration-ready SHA (no rebase).
- [ ] Imports move from the island-map shims to `@lai/game-engine`.
- [ ] An `AdventureDefinition` (or location definition) declares capability requests.
- [ ] `npm run engine:validate` passes on the realm's content.
- [ ] Gameplay claims are emitted for the realm's learning, exploration, collectibles, jump,
      course, puzzle, NPC, quest and completion facts, and the host forwards them.
- [ ] Existing realm unit tests pass unchanged. New tests cover the definition.
- [ ] No child progress, content, page id or learning objective changed.
- [ ] Evidence (commits, test counts) recorded here and on the card.
