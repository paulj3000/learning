# Realm Specification: `<realm name>`

- **Status:** `<Draft | In review | Owner approved>` (template version 1, governed by [`docs/adventures/realm-standard.md`](../realm-standard.md))
- **Owner:** Project owner
- **Last reviewed:** `<YYYY-MM-DD>`

> **How to use.** Copy this file to the feature's documentation folder (or attach it to the Trello
> card) and replace every `<placeholder>`. Do not invent data:
> write `<TBD: owner decision>` where a value is not decided. "Realm" is the child-facing word for
> an Island (`catalog.World`, ADR-041); a Realm holds Places (`catalog.Location`), each with at most
> one 3D Area (`regions.WorldRegion`). Do not rename models or add a new hierarchy level. Read
> [`realm-standard.md`](../realm-standard.md) and [`adventure-standard.md`](../adventure-standard.md) first.

## 1. Identity

| Field | Value |
|---|---|
| Realm display name (child-facing) | `<name>` |
| Island slug (`catalog.World`) | `<slug>` |
| Tagline (child-facing) | `<one short line, readable aloud>` |
| Description (child-facing) | `<two or three sentences, readable aloud>` |
| `sort_order` | `<integer>` |
| `is_home` | `<yes / no>` |
| Picture assets | `<asset ids for the Realm card and preview, or TBD>` |
| Trello card(s) | `<card id and title>` |
| Branch | `<branch name>` |
| Related ADRs | `<ADR-NNN, ...>` |
| Status label | `<Proposed | Approved future | Pending merge | Implemented (main)>` |

## 2. Purpose and theme

- Child-facing promise: `<one sentence a child could hear>`
- Theme and art direction: `<theme; link to art direction doc if any>`
- Learning domains covered: `<domains>`

## 3. Age bands

| Age band | Supported? | Notes |
|---|---|---|
| Sprouts (3 to 4) | `<yes/no>` | `<notes>` |
| Pathfinders (5 to 6) | `<yes/no>` | `<notes>` |
| Explorers (7 to 8) | `<yes/no>` | `<notes>` |

## 4. Places and 3D Areas

| Place slug (`catalog.Location`) | Place name | 3D Area id (`regions.WorldRegion`, or none) | Adventures launched here | Secret or locked? |
|---|---|---|---|---|
| `<slug>` | `<name>` | `<region id or none>` | `<adventure slugs>` | `<rule>` |

## 5. Travel and unlock rules

- Realm availability rule: `<rule, evaluated by Django>`
- Place unlock rules: `<rules, each tied to a WorldChange or quest status>`

## 6. Shared characters and NPCs

| `npc_id` | Role | Places | Notes |
|---|---|---|---|
| `<npc id>` | `<NpcRole>` | `<places>` | `<notes>` |

## 7. Audio identity

- Realm-scope ambient and music cues: `<cue ids, published through a sound release>`

## 8. World changes and persistence

| World change key | Caused by | Visible consequence |
|---|---|---|
| `<key>` | `<adventure or quest>` | `<what the child sees>` |

## 9. Shared components used

`<Asset Library, NPC Manager, Sound Manager, shared movement and jump controller (pending merge), quest engine, ...>`

## 10. Assets and licensing

`<asset ids needed, fallback behaviour, ledger rows required>`

## 11. Dependencies and owner decisions

| Item | Type (dependency or owner decision) | State |
|---|---|---|
| `<item>` | `<type>` | `<open/decided, date>` |

## 12. Acceptance criteria

1. `<criterion>`

## Checklist

- [ ] Uses the existing Island, Place and 3D Area hierarchy; no new model or level.
- [ ] Every Place's adventures reference existing learning objectives.
- [ ] Unlock rules evaluated by Django, tied to world changes or quests.
- [ ] NPCs through the NPC Manager; audio through the Sound Manager; assets through the Asset Library.
- [ ] Age bands stated for every Place.
- [ ] No play-time limits (ADR-053).
- [ ] Owner decisions listed, none assumed.
