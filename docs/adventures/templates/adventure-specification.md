# Adventure Specification: <Adventure title>

> **Status:** Template
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001

*Copy this file, replace every `<placeholder>`, and delete the italic hints. Follow
[../adventure-standard.md](../adventure-standard.md). Use `TBD` for undecided values; never
record test results or evidence that do not exist.*

| Field | Value |
|---|---|
| Ticket | `<LAI-AREA-NNN>` |
| Specification status | Draft / In review / Approved by owner |
| Author | `<agent ID or person>` |
| Related ADRs | `ADR-NNN` or none |
| Branch | `<branch>` |

## Adventure identifier

- Slug (`catalog.Adventure`): `<adventure-slug>`
- Child-facing title: `<title>`

## Realm association

- Realm: `<realm-slug>`; Place: `<place-slug>`; 3D Area: `<region-id>` or none
- Launch point: `<launch point id>` or none
- Realm specification: `<link>`

## Educational objectives

*Catalog `LearningObjective` codes only. See
[../educational-content-standard.md](../educational-content-standard.md).*

| Objective code | What the child shows | Evidence type |
|---|---|---|
| `<objective-code>` | `<observable skill>` | `<evidence type>` |

## Age bands

| Band | Supported | Steps | Reading | Response mode |
|---|---|---|---|---|
| Sprouts (3 to 4) | Yes / No | `<n>` | `<none / narrated>` | `<mode>` |
| Pathfinders (5 to 6) | Yes / No | `<n>` | `<level>` | `<mode>` |
| Explorers (7 to 8) | Yes / No | `<n>` | `<level>` | `<mode>` |

## Story progression

*Beginning, problem, steps, consequence in the world. One line per beat.*

1. `<beat>`

## Environment

*Scene, lighting, landmarks, interactable objects, colliders. Layouts stay seed-authored or in the
TypeScript manifest (CLAUDE.md section 20).*

## Quests

| Quest id | Objective | Specification |
|---|---|---|
| `<quest-id>` | `<objective>` | `<link to quest specification>` |

## Challenges

| Challenge id | Type | Objective | Specification |
|---|---|---|---|
| `<challenge-id>` | `<type>` | `<objective-code>` | `<link to challenge specification>` |

## Movement and jumping

*Walking only, or jumping and platforms through the shared controller (pending merge, PR #26).
See [../jumping-standard.md](../jumping-standard.md). State `None` if not used.*

## Collectibles and rewards

*Items, collectible sets, reward rules and world changes. No XP, coins or levels (ADR-011). See
[../scoring-standard.md](../scoring-standard.md).*

| Reward | Model | Trigger |
|---|---|---|
| `<item or world change>` | `<RewardRule / WorldChange / ItemDefinition>` | `<trigger>` |

## NPCs

| NPC id | Role | Triggers used | Dialogue mode | AI hints |
|---|---|---|---|---|
| `<npc-id>` | `<role>` | `<triggers>` | `<mode>` | Yes / No |

## Audio

| Cue id or music state | Channel | Event |
|---|---|---|
| `<cue-id>` | `<channel>` | `<event>` |

## Accessibility

*Reduced motion, captions, touch targets, non-reading alternatives, keyboard. See
[../accessibility-standard.md](../accessibility-standard.md).*

## Failure recovery

*What happens after a wrong answer, a fall, a lost connection, an AI failure, an asset failure.
Every path keeps the child playing.*

## Progress persistence

*What is saved, where (session, quest progress, skill evidence, world change), and how a
returning child resumes.*

## Parent-facing progress

*What the parent dashboard shows, by skill. No transcripts.*

## Assets

| Asset id | Kind | Source | Licence | Placeholder |
|---|---|---|---|---|
| `<asset-id>` | `<kind>` | `<source>` | `<licence>` | Yes / No |

## Performance

| Budget | Target | Measured |
|---|---|---|
| Draw calls | `<n>` | TBD |
| Triangles | `<n>` | TBD |
| Texture memory | `<MB>` | TBD |
| Download size | `<MB>` | TBD |
| Frame rate on reference tablet | `<fps>` | TBD |

## Acceptance criteria

- [ ] `<criterion>`

## Owner decisions required

- `<decision>` or none
