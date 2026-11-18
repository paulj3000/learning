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
| Realm that owns it (`Quest.world`) | `<island slug>` |
| Places its objectives span | `<place slugs>` |
| Adventures that reference it | `<3D Area region ids and step adventure slugs>` |
| Offered by 3D Area (`WorldRegion.offered_quests`) | `<region ids, or none>` |
| Giver NPC (`giver_npc_id`) | `<npc id, or none; must match that NPC's quest offer>` |
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
- Prerequisites (closed `QuestCondition` list): `<ALWAYS / QUEST_COMPLETED / WORLD_CHANGE / ITEM_OWNED / OBJECTIVE_COMPLETED / RELATIONSHIP_AT_LEAST>`
- Acceptance: the child's own tap through the quests API; never automatic from dialogue.

## 5. Stages and objectives

| Stage | Child-facing instruction | Objective kind | Completion signal (server) | Hint path |
|---|---|---|---|---|
| `<n>` | `<text, readable aloud>` | `<objective kind>` | `<record the server proves>` | `<authored hints>` |

Objective kinds the server can prove today ([quests/engine.py](../../../lai/apps/quests/engine.py)):
`BUILD` (world change), `FIND` and `CRAFT` (item owned), `COLLECT` (items owned), `SOLVE` (a
COMPLETED step adventure session), `TALK_TO` (an NPC memory flag), `DISCOVER` (a recorded
discovery). `HELP_NPC`, `DELIVER`, `EXPLORE`, `LEARN` and the `RELATIONSHIP_AT_LEAST` condition
evaluate as not yet complete on the server; a required objective of those kinds needs its engine
port first (an owner decision in section 12).

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
| Content republished mid-quest | `<the quest revision pinned on the REGION session's AdventureSession.pinned_revisions when the 3D Area offers it (pin_region_content); state the behaviour for quests not offered by a 3D Area>` |

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
- [ ] Owning Realm, Places and referencing adventures stated; required objectives use server-provable kinds.
