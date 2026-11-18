# Scoring Standard

- **Status:** Mandatory policy (merged to `main` at the owner's direction on 2026-11-18; formal acceptance of ADR-072 pending). Rules restated from CLAUDE.md and accepted ADRs bind through those sources.
- **Scope note:** The "Proposed future enhancements" section is Proposed only.
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-005, ADR-011, ADR-013, ADR-016, ADR-033, ADR-051, ADR-053
- **Canonical sources:** [CLAUDE.md](../../CLAUDE.md) section 4 pillar 7, [docs/ADVENTURE_ENGINE.md](../ADVENTURE_ENGINE.md) ("Adaptation", "Hint ladder"), [lai/apps/education/mastery.py](../../lai/apps/education/mastery.py), [react/src/features/mastery/status.ts](../../react/src/features/mastery/status.ts), [react/src/features/rewards/types.ts](../../react/src/features/rewards/types.ts), [lai/apps/catalog/models.py](../../lai/apps/catalog/models.py) (`ItemDefinition`, `RewardRule`), [lai/apps/inventory/models.py](../../lai/apps/inventory/models.py)

"Scoring" here means how an adventure recognises what a child has achieved. This product has no
points economy: **the world itself is the record of achievement** (ADR-005, ADR-011). This
standard introduces no new formula; every rule below is either already in code or an ADR, or is
listed as a proposal that needs owner approval.

## Prohibited (mandatory)

Never build, in any adventure:

- XP, coins, currency, levels or a numeric score as the centre of play (ADR-011).
- Loot boxes, random drops, drop rates or rarity pressure (ADR-013; CLAUDE.md pillar 7). Item
  `rarity` is descriptive only; nothing reads it when deciding what to grant.
- Public leaderboards, rankings between children, or anything comparing one child to another.
- Streaks, daily login rewards, "don't break your streak" messages or anxiety-driven returns.
- Timers, countdowns, time-based scores or time-based bonuses (ADR-053).
- Loss on failure: no lives, no lost items, no lost progress, no score deductions.
- Purchases, advertising, or rewards that push toward either (CLAUDE.md section 12).
- Infinite loops of rewards designed to keep a child playing; replay is offered, never pushed.

## Approved and implemented behaviour

| Area | Behaviour | Where |
|---|---|---|
| Educational achievement | Each answered challenge records typed evidence (`SkillEvidence`) with result and support level. Independent and supported success are counted separately; guided completion counts as participation, not mastery | `education.SkillEvidence`, `SkillProgress`; [ADVENTURE_ENGINE.md](../ADVENTURE_ENGINE.md) "Hint ladder"; ADR-016 |
| Skill progression and mastery | `SkillStatus` LOCKED, INTRODUCED, DEVELOPING, PROFICIENT, MASTERED, from counters, with review decay. The thresholds are documented as initial and not pedagogically validated; change them only in the shared mastery modules, in TypeScript and Python together, with golden vectors | [mastery/status.ts](../../react/src/features/mastery/status.ts), [education/mastery.py](../../lai/apps/education/mastery.py), `tests/golden/mastery.json` |
| Quest completion | `QuestProgress.status` COMPLETED; completion world changes and quest reward rules fire once | [quest standard](quest-standard.md) |
| Adventure completion | A visible, persistent `WorldChange` (a bridge repaired, a passage opened, a chest left open) | ADR-005; `progression.WorldChange` |
| Exploration | Discoveries and castle rooms are world state, recorded once; exploring grants nothing by itself | ADR-051; `WorldState.discovered_objects` |
| Progress display | A Realm shows Places explored, never points; an adventure HUD may show "1 of 4" for its own goals | [realmCatalog.ts](../../react/src/features/realms/realmCatalog.ts); Treasure Rush TR-14 |
| Collectibles and rewards | Deterministic `RewardRule` triggers (adventure, quest, world change and others) grant `ItemDefinition` items (keepsakes, badges, journal entries). `GrantedRule` makes each grant once per child | `catalog.RewardRule`, `inventory.InventoryItem`, `inventory.GrantedRule` |
| Replay incentives | Replay activities are repeatable and grant nothing permanent (`REPLAY` chests). Completion is never locked out | `ChestPresentation.REPLAY` (TR-20) |
| Difficulty adjustment | Modest, explainable adaptation (fewer choices, narration, smaller numbers, smaller steps, more specific hints) and the five-rung hint ladder. Per-band parameters are authored content. The Adaptive Adventure Director ranks next activities deterministically from mastery status; no AI | [ADVENTURE_ENGINE.md](../ADVENTURE_ENGINE.md); [education/director.py](../../lai/apps/education/director.py) |
| Parent reporting | Parents see activity summarised by skill (mastery overview, weekly summary), never raw chat transcripts | CLAUDE.md section 11 item 10; `react/src/features/parent-dashboard/` |

Specified but check the tracker before relying on it: Storykeeper Castle's five rank titles are
**derived, presentational** descriptions of pages restored, never stored, compared, lost or tied
to time ([castle roadmap](../regions/STORYKEEPER_CASTLE_REBOOT_ROADMAP.md) section 4.4). If the
owner prefers no ranks, nothing depends on them.

## Rules for a new adventure

1. Name the world consequence first; it is the main reward.
2. Use reward rules, items and collectible sets from the catalog. No adventure-specific reward
   table, currency or counter.
3. Every grant is idempotent and server-side; the 3D engine never grants anything.
4. Record evidence only for learning challenges, with honest support levels.
5. Present progress as "what you have done" ("2 of 4 pages"), never as a total score or a rank
   against others.
6. Celebrate effort and outcome in words a child can hear; no shame copy on a wrong answer.

## Proposed future enhancements (need owner approval)

None of these is approved or built. Each needs a specification and, where it changes behaviour
or data, an ADR.

- Granting a collectible set's completion item on the server (the North Pole audit on its branch
  notes that set completion items are not granted server-side today).
- Equipping cosmetic items (ownership exists; equipping does not).
- Harder replay variants of movement courses (Pirate's Leap lists them as future content on its
  branch).
- A per-adventure progress summary in the parent dashboard (activities completed, skills
  practised), built from existing records.
- Retuning mastery thresholds after a pedagogical review.

## Acceptance checklist

- [ ] No prohibited mechanic appears anywhere in the adventure or its copy.
- [ ] The adventure's achievement is a persistent, visible world change.
- [ ] Rewards use catalog reward rules and items; each grant is once per child and server-side.
- [ ] Evidence separates independent from supported success.
- [ ] Replay is available and grants nothing permanent.
- [ ] Progress copy shows what was done, never points or comparisons.
- [ ] Parent-facing reporting is by skill, without transcripts or child free text.
- [ ] No new formula or threshold was added outside the shared mastery and director modules.
