# Realm Specification: <Realm name>

> **Status:** Template
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001

*Copy this file to the Realm's documentation folder, replace every `<placeholder>`, and delete
the italic hints. Follow [../realm-standard.md](../realm-standard.md). Keep `TBD` where a value
is not decided yet; never write evidence that does not exist.*

| Field | Value |
|---|---|
| Ticket | `<LAI-AREA-NNN>` |
| Specification status | Draft / In review / Approved by owner |
| Author | `<agent ID or person>` |
| Related ADRs | `ADR-NNN` or none |
| Branch | `<branch>` |

## Realm identifier

*Stable slug of the catalog `World` row (called "Island" in older APIs), and the child-facing
name.*

- Slug: `<realm-slug>`
- Child-facing name: `<name>`

## Theme and story

*Two to five sentences. What the child is helping with and how learning makes this Realm grow.
Plain words, no em dashes.*

## Catalog mapping

| Concept | Model | Identifier |
|---|---|---|
| Realm | `catalog.World` | `<slug>` |
| Places | `catalog.Location` | `<slug>`, `<slug>` |
| 3D Areas | `regions.WorldRegion` | `<region-id>` or none |
| Adventures | `catalog.Adventure` | `<slug>` |
| Travel requirement | `World.source` / `WorldChange` key | `<key>` or none |

## Places and 3D Areas

*One row per Place. At most one 3D Area per Place (ADR-041).*

| Place | 3D Area | Purpose | Spawn point | Layout source |
|---|---|---|---|---|
| `<place>` | `<region-id>` / none | `<purpose>` | `<spawn id>` | `<seed or manifest file>` |

## Adventures

| Adventure | Place | Age bands | Learning objectives | Specification |
|---|---|---|---|---|
| `<adventure-slug>` | `<place>` | `<bands>` | `<objective codes>` | `<link>` |

## Age bands

*Which of Sprouts, Pathfinders, Explorers the Realm supports, and what differs per band.*

| Band | Supported | Differences |
|---|---|---|
| Sprouts (3 to 4) | Yes / No | `<differences>` |
| Pathfinders (5 to 6) | Yes / No | `<differences>` |
| Explorers (7 to 8) | Yes / No | `<differences>` |

## Navigation and exits

*How the child arrives, moves between Places, and always returns to the map. Name every exit.*

## Assets

*Asset ids, kinds, source (generated, imported, Asset Library), licence, placeholder status. See
[../asset-standard.md](../asset-standard.md).*

| Asset id | Kind | Source | Licence | Placeholder |
|---|---|---|---|---|
| `<asset-id>` | `<kind>` | `<source>` | `<licence>` | Yes / No |

## NPCs

*Characters by `npc_id`, role, Place, dialogue mode. See [../npc-standard.md](../npc-standard.md).*

| NPC id | Role | Place | Dialogue mode |
|---|---|---|---|
| `<npc-id>` | `<role>` | `<place>` | AUTHORED / HYBRID / AI |

## Audio

*Music states, ambient zones, key cues, speech. See [../audio-standard.md](../audio-standard.md).*

## Accessibility

*Reduced motion, captions, touch targets, pre-reader support, keyboard. See
[../accessibility-standard.md](../accessibility-standard.md).*

## Acceptance criteria

- [ ] `<criterion>`

## Owner decisions required

- `<decision>` or none
