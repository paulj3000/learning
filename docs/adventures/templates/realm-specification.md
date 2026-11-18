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
| Realm display name (child-facing, `World.title`) | `<name>` |
| Island slug (`World.slug`) | `<slug>` |
| Tagline (`World.tagline`) | `<one line, readable aloud>` |
| Description (`World.description`) | `<short text, readable aloud>` |
| Pack version (`World.pack_version`) | `<integer>` |
| Home Realm? (`World.is_home`) | `<yes/no>` |
| Sort order (`World.sort_order`) | `<integer>` |
| Active at launch? (`World.active`) | `<yes/no>` |
| Trello card(s) | `<card id and title>` |
| Branch | `<branch name>` |
| Related ADRs | `<ADR-NNN, ...>` |
| Status label | `<Proposed | Approved future | Pending merge | Implemented (main)>` |

## 2. Purpose and theme

- Child-facing promise: `<one sentence a child could hear>`
- Theme and art direction: `<theme; link to art direction doc if any>`
- Learning domains covered: `<domains>`

## 3. Age bands

Supported bands are stored as `World.supported_age_bands`.

| Age band | Supported? | Notes |
|---|---|---|
| Sprouts (3 to 4) | `<yes/no>` | `<notes>` |
| Pathfinders (5 to 6) | `<yes/no>` | `<notes>` |
| Explorers (7 to 8) | `<yes/no>` | `<notes>` |

## 4. Places and 3D Areas

| Place slug (`catalog.Location`) | Place title and tagline | Sort order | 3D Area id (`regions.WorldRegion`, or none) | Adventures launched here | Secret or locked? |
|---|---|---|---|---|---|
| `<slug>` | `<title; tagline>` | `<integer>` | `<region id or none>` | `<adventure slugs>` | `<rule>` |

For each 3D Area:

| 3D Area id (`region_id`) | Title | Version | Status | Age bands | Default `SpawnPoint` (`checkpoint_id`, `is_default`) |
|---|---|---|---|---|---|
| `<region id>` | `<child-facing title>` | `<integer>` | `<DRAFT / PUBLISHED>` | `<bands>` | `<checkpoint id>` |

## 5. Travel and unlock rules

- Realm travel requirement (kept in `World.source`, evaluated by Django): `<rule, or none>`
- Place unlock rules: `<rules, each tied to a WorldChange or quest status>`

## 6. Realm-owned Quests

Quests belong to the Realm (`Quest.world`) and may span Places; adventures reference them. One
[quest specification](quest-specification.md) per quest.

| Quest slug | Places it spans | Adventures that reference it | Spec |
|---|---|---|---|
| `<slug>` | `<place slugs>` | `<region ids, step adventure slugs>` | `<path>` |

## 7. Shared characters and NPCs

| `npc_id` | Role | Places | Notes |
|---|---|---|---|
| `<npc id>` | `<NpcRole>` | `<places>` | `<notes>` |

## 8. Audio identity

- Realm-scope ambient and music cues: `<cue ids, published through a sound release>`

## 9. World changes and persistence

| World change key | Caused by | Visible consequence |
|---|---|---|
| `<key>` | `<adventure or quest>` | `<what the child sees>` |

## 10. Shared components used

`<Asset Library, NPC Manager, Sound Manager, shared movement and jump controller (pending merge), quest engine, ...>`

## 11. Assets and licensing

`<asset ids needed, fallback behaviour, ledger rows required>`

## 12. Dependencies and owner decisions

| Item | Type (dependency or owner decision) | State |
|---|---|---|
| `<item>` | `<type>` | `<open/decided, date>` |

## 13. Acceptance criteria

1. `<criterion>`

## Checklist

- [ ] Uses the existing Island, Place and 3D Area hierarchy; no new model or level.
- [ ] Every Place's adventures reference existing learning objectives.
- [ ] Unlock rules evaluated by Django, tied to world changes or quests.
- [ ] NPCs through the NPC Manager; audio through the Sound Manager; assets through the Asset Library.
- [ ] Age bands stated for every Place.
- [ ] Every required `World`, 3D Area and default `SpawnPoint` field filled; Realm-owned quests listed.
- [ ] No play-time limits (ADR-053).
- [ ] Owner decisions listed, none assumed.
