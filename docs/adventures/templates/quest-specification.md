# Quest Specification: <Quest title>

> **Status:** Template
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001

*Copy this file, replace every `<placeholder>`, and delete the italic hints. Follow
[../quest-standard.md](../quest-standard.md). Use `TBD` for undecided values.*

| Field | Value |
|---|---|
| Ticket | `<LAI-AREA-NNN>` |
| Specification status | Draft / In review / Approved by owner |
| Author | `<agent ID or person>` |

## Quest identifier

- Quest id (`catalog.Quest`): `<quest-id>`
- Child-facing title: `<title>`

## Adventure association

- Adventure: `<adventure-slug>`; Realm: `<realm-slug>`; Place: `<place-slug>`
- Offered by: `<npc-id>` (NPC `OFFER_QUEST`; the child accepts with their own tap) or `<other>`

## Objective

*One sentence a child would understand, and the learning objective code it serves.*

## Steps

| # | Stage or objective | Child action | Learning objective | Age-band differences |
|---|---|---|---|---|
| 1 | `<stage>` | `<action>` | `<objective-code>` | `<differences>` |

## Completion conditions

*Evaluated by the quest engine on the server. List each condition precisely.*

## Rewards

*Items, world changes, collectibles. No XP, coins or levels (ADR-011). Awarded by play services,
never by an NPC choice or the engine.*

## Progress tracking

*What `quests.QuestProgress` records, which `SkillEvidence` is written, and how a returning child
resumes.*

## Failure recovery

*What happens if the child leaves, retries, or gets stuck. No timers or penalties.*

## Acceptance criteria

- [ ] `<criterion>`
