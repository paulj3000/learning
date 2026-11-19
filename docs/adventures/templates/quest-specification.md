# Quest Specification: `<quest name>`

- **Status:** `<Draft | In review | Owner approved>` (template version 1, governed by [`docs/adventures/quest-standard.md`](../quest-standard.md))
- **Owner:** Project owner
- **Last reviewed:** `<YYYY-MM-DD>`

> **How to use.** Copy this file once per quest and replace every `<placeholder>`. Quests are
> `catalog.Quest` content, authored and published as Django Admin revisions (ADR-047) and evaluated
> by the existing quest engine; child state is `quests.QuestProgress`. Do not add a quest model,
> engine or progress store. Write `<TBD: owner decision>` for anything undecided. Read
> [`quest-standard.md`](../quest-standard.md) first.

## 1. Identity

| Field | Value |
|---|---|
| Quest title (child-facing) | `<title>` |
| Quest slug (`catalog.Quest`) | `<slug>` |
| Adventure | `<adventure slug>` |
| Realm and Place | `<island slug> / <place slug>` |
| Trello card | `<card id and title>` |

## 2. Age bands

| Age band | Supported? | Stage count | Notes |
|---|---|---|---|
| Sprouts (3 to 4) | `<yes/no>` | `<count>` | `<notes>` |
| Pathfinders (5 to 6) | `<yes/no>` | `<count>` | `<notes>` |
| Explorers (7 to 8) | `<yes/no>` | `<count>` | `<notes>` |

## 3. Learning objectives

| Objective code | Evidence produced by |
|---|---|
| `<code>` | `<challenge / step>` |

## 4. Offer and acceptance

- Offered by: `<npc id via OFFER_QUEST / launch point / automatic>`
- Prerequisites: `<quest statuses, world changes>`
- Acceptance: the child's own tap through the quests API; never automatic from dialogue.

## 5. Stages and objectives

| Stage | Child-facing instruction | Objective type | Completion signal (server) | Hint path |
|---|---|---|---|---|
| `<n>` | `<text, readable aloud>` | `<objective type>` | `<event>` | `<authored hints>` |

## 6. Branches

`<branch conditions and outcomes, or "None">`

## 7. Completion and consequences

- World change(s): `<keys>`
- Reward rule(s): `<rule ids>`
- NPC reaction (`on_quest_complete`): `<npc id, dialogue key>`
- Sound cue (`on_complete`): `<cue id or none>`

## 8. Failure recovery and resume

| Situation | Behaviour |
|---|---|
| Child leaves mid-quest | `<resume at stage>` |
| Wrong answer in a stage | `<retry with hints; no progress lost>` |
| Content republished mid-quest | `<pinned quest version used>` |

## 9. Accessibility

`<non-jump route, pre-reader path, sound-off path, no timers>`

## 10. Parent-facing summary line

`<what the parent sees, by skill>`

## 11. Acceptance criteria

1. `<criterion>`

## 12. Owner decisions

| Decision needed | Decision and date |
|---|---|
| `<question>` | `<pending>` |

## Checklist

- [ ] Uses `catalog.Quest`, the existing quest engine and `QuestProgress` only.
- [ ] Acceptance is the child's own action; NPCs only offer.
- [ ] Every stage has a server completion signal and an authored hint path.
- [ ] Consequences written by the play services, not by dialogue or the engine.
- [ ] No timers; no progress lost on failure or exit.
- [ ] Objective codes exist in the catalog.
