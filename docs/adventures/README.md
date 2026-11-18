# Adventure Development Standards

- **Status:** Mandatory policy (in effect once merged to `main` with owner approval; governance decision ADR-072, Proposed)
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-005, ADR-011, ADR-020, ADR-027, ADR-033, ADR-041, ADR-047, ADR-051, ADR-053, ADR-072 (proposed engineering governance); pending merge: ADR-056 to ADR-060, ADR-063
- **Canonical sources:** [CLAUDE.md](../../CLAUDE.md), [docs/DECISIONS.md](../DECISIONS.md), [docs/ADVENTURE_ENGINE.md](../ADVENTURE_ENGINE.md), [docs/DATA_MODEL.md](../DATA_MODEL.md), [docs/UX_AND_ACCESSIBILITY.md](../UX_AND_ACCESSIBILITY.md)

These standards say what every new or reworked adventure must have before it is built, tested
and shown to the owner. They are policy and pointers. Where a rule already lives in a canonical
document, these files summarise it and link to it. Conflicts follow
[Precedence when documents conflict](../engineering/README.md#precedence-when-documents-conflict).

## Index

### Standards

| Standard | Covers |
|---|---|
| [Adventure standard](adventure-standard.md) | Everything one adventure must define, with the acceptance checklist |
| [Realm standard](realm-standard.md) | Realms (catalog `World`), Places and 3D Areas |
| [Quest standard](quest-standard.md) | Quests, stages and objectives |
| [Challenge standard](challenge-standard.md) | Learning, exploration, movement and puzzle activities |
| [Jumping standard](jumping-standard.md) | Meaningful jumping in every primary adventure, with accessible routes |
| [Scoring standard](scoring-standard.md) | Achievement, completion, mastery, rewards and what is prohibited |
| [Accessibility standard](accessibility-standard.md) | Controls, presentation, alternatives, exits, no time limits |
| [Asset standard](asset-standard.md) | Models, textures, placeholders and licences |
| [NPC standard](npc-standard.md) | Characters, dialogue and NPC releases |
| [Audio standard](audio-standard.md) | Sound cues, music, narration and speech |
| [Educational content standard](educational-content-standard.md) | Learning objectives, age bands and question content |

### Templates

| Template | Use it for |
|---|---|
| [Realm specification](templates/realm-specification.md) | A new Realm, or a new Place or 3D Area in one |
| [Adventure specification](templates/adventure-specification.md) | A new primary adventure or a major rework |
| [Quest specification](templates/quest-specification.md) | A new quest or a change to a quest's stages |
| [Challenge specification](templates/challenge-specification.md) | A new challenge or puzzle kind, or new challenge content |

Engineering process (branches, testing cadence, Trello, definition of done) is in
[docs/engineering/](../engineering/README.md).

## Hierarchy summary

The owner's working vocabulary has four levels. The code has more, with older names. Use the
standard term in specifications and child-facing copy, and the model name in code and tickets.
Nothing is renamed: model classes, tables, API routes and field names stay as they are
(ADR-041 decision A). The full mapping and identifier rules are in the
[realm standard](realm-standard.md#terminology-mapping).

```text
Realm                 catalog.World (shown as "Island" in ADR-041 and Django Admin)
  Place               catalog.Location
    3D Area           regions.WorldRegion (zero or one per Place)
      Adventure       the playable experience in a Place, usually in its 3D Area:
                      its quests, area puzzles, chests, launch points and step adventures
        Quest         catalog.Quest (owned by the Realm, may span Places; adventures
                      reference it) + quests.QuestProgress
          Challenge   one activity: an AdventureStep, a chest challenge (ChallengeSpec),
                      an AreaPuzzle, a pickup or discovery, or a platforming course (pending merge)
Consequence           progression.WorldChange (append-only, child-scoped)
```

| Term | One-line meaning |
|---|---|
| Realm | A larger themed world a child chooses to visit (Learning Adventure Island; North Pole on a branch) |
| Adventure | A structured gameplay and educational experience with a story, a goal and a world consequence |
| Quest | An objective-driven sequence of stages, owned by a Realm and referenced by the adventures that use it |
| Challenge | One learning, exploration, movement or puzzle activity |

"Realm" is the player-facing word (Realm Explorer, AP-03). "Island", "IslandLocation", "world",
"region" and "location" remain in code, older documents and API names; the realm standard says
how to read each.

## Lifecycle

Every adventure, quest and challenge follows the same lifecycle. A step is not skipped because
a later one looks easy.

| # | Step | Output | Trello list |
|---|---|---|---|
| 1 | Specification | A filled template from [templates/](templates/adventure-specification.md), with acceptance criteria and age bands | Backlog |
| 2 | Template review | The spec is checked against these standards (identifiers, jumping, accessibility, scoring, reuse) | Backlog |
| 3 | Owner approval | The owner approves scope, age bands, decisions and any ADR; the card records "Owner approvals - date" | Ready for Development |
| 4 | Build | Smallest coherent change on a feature branch, on the shared engine and Django backbone | In Development |
| 5 | Unit tests | Development checks from [docs/TESTING_STRATEGY.md](../TESTING_STRATEGY.md) "When to run which checks"; results recorded, not assumed | Development Complete |
| 6 | Owner QA | The owner plays it against the spec's QA checklist, per age band | Owner QA (then Rework Required or Ready to Merge) |

Status words are kept apart, as on existing cards: *Development complete*, *Unit tests passed*,
*Owner QA required*, *Accepted*, *Merged*, *Deployed*. None implies the next. Merging and
deployment need explicit owner approval (CLAUDE.md sections 14, 15 and 18).

## Labels used in these documents

- **Implemented (main):** in `main` at the review date, verified in code.
- **Pending merge (branch):** built on an open branch, not in `main`. Never described as available.
- **Approved future:** the owner approved it; nothing is built.
- **Proposed:** a recommendation that needs owner approval.
- **Retired:** removed by decision; do not reintroduce.

## Current adventures (2026-11-18)

| Adventure | Realm, Place, 3D Area | Status |
|---|---|---|
| Treasure Rush: Pip's Missing Treasure | Learning Adventure Island, Pirate Builder Bay, `treasure-rush-cove` | Implemented (main), development complete and unit tested; browser playtest TR-9 not done ([roadmap](../TREASURE_RUSH_ROADMAP.md)) |
| Treasure Rush: Pirate's Leap | Same 3D Area | Pending merge (`feature/pirates-leap`) |
| Firepeak Volcano: The Volcano Awakens | Learning Adventure Island, `firepeak-volcano` | Implemented (main) for Pathfinders and Explorers; owner played it locally 2026-11-01; automated browser scenarios not run ([roadmap](../FIREPEAK_VOLCANO_ROADMAP.md)). Further Firepeak work pending merge (`feature/firepeak-volcano-adventure`) |
| Storykeeper Castle: the Great Storybook | Learning Adventure Island, Storykeeper Castle | Implemented (main) in part per the SC-R tracker; later SC-R tasks open ([roadmap](../regions/STORYKEEPER_CASTLE_REBOOT_ROADMAP.md)); castle jumping is work in progress (`wip/sc-jmp-castle-jumping`) |
| North Pole: The Missing Christmas Star | Realm `north-pole`, Place and 3D Area `north-pole-village` | Pending merge (`feature/north-pole-adventure`), in development |
| Wonderwild Forest, Clockwork Harbor, Dragon's Sanctuary | Learning Adventure Island | Shared-engine locations on main; see their own documents under [docs/regions/](../regions/clockwork.md) |
