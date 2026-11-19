# ADR-NNN (draft): Universal scoring and progression economy

- **Status:** Proposed. Draft for owner decision. **The number is not reserved**: per
  [multi-agent-workflow.md](../engineering/multi-agent-workflow.md#adr-number-reservation) the owner
  or coordinator reserves it on `main` before this text moves into `docs/DECISIONS.md`.
  Number 073 is not available: by owner decision it belongs to Heart of Firepeak
  (feature/firepeak-volcano-adventure 5caec70e). As of 2026-11-19, numbers 074 to 079 were unused
  on every branch (reported by the Firepeak lead; re-check before reserving).
- **Ticket:** GE-100 (GE-101 to GE-110)
- **Supersedes, if accepted:** ADR-011 part A ("No `PlayerProfile` with level/XP/coins").
- **Amends, if accepted:** [docs/adventures/scoring-standard.md](../adventures/scoring-standard.md)
  "Prohibited" bullet 1, and the related lines of `react/src/features/rewards/types.ts` ("there
  is no currency and no sink").

## Context

GE-100 (P0, Ready for Development) asks for a unified scoring engine with XP, Learning Points,
coins, levels, stars, achievements and personal bests, and says "values and level thresholds
provisional; do not activate unapproved economy".

Two accepted, mandatory sources forbid this today:

- ADR-011 part A rejects a level/XP/coins model, because "the world itself is the record of
  achievement".
- The scoring standard (ADR-072, accepted 2026-11-18) prohibits "XP, coins, currency, levels or a
  numeric score as the centre of play" and "an adventure-specific reward table, currency or counter".

Under the precedence in `AGENTS.md`, the GE-100 card does not override them. Only an owner
decision does. This ADR is that decision, written down for the owner to accept or reject.

## Decision (proposed)

1. Adopt a Django-authoritative scoring engine (`apps.scoring`) whose numbers sit **beside**
   the world, never in place of it. The world change stays the main reward of every adventure.
2. Keep every prohibition except the numeric one. That means no loot boxes, randomness, rarity
   pressure, leaderboards or comparisons, streaks, timers or time bonuses, and no loss of any
   kind. There are no purchases, shop, sink, trade or real-money value. Coins are earn-only.
3. Hints, supported answers, alternative routes, falls and respawns never cost or reduce
   anything. The decision function has no input for them.
4. Every award is derived by Django from its own records, is idempotent per source, and is
   never repeatable. Replay earns nothing new.
5. Values and level thresholds are configuration (versioned `ScoringPolicy`), not code. Nothing
   awards in a deployed environment until the owner records approval of a specific policy
   version (`economy_approved_at`). Development fixture values can never be approved.
6. Achievements, trophies and collectibles stay the existing catalog items (ADR-033). The
   engine projects them and creates no parallel model.

## Consequences

- If accepted: ADR-011 part A is marked superseded, and the scoring standard's "Prohibited" list
  and "Approved and implemented behaviour" table are updated to describe the engine. The owner
  then approves a non-fixture policy version, and sets `LAI_SCORING_ENABLED` per environment.
- If rejected: the code stays dormant (it is off by default and creates no child-visible
  numbers). Either it is removed, or only the parts that need no economy are kept (stars as
  exploration progress, the parent per-adventure summary listed in the standard's proposed
  enhancements).

## Alternatives considered

- Keep the world-only model (ADR-011). This is the default if the ADR is rejected.
- Client-computed scores. Rejected: unverifiable, and against "the 3D engine never grants anything".
- A per-realm points table. Rejected: duplicates, and is against ADR-033.
