# Adventure Standards

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-020, ADR-033, ADR-041, ADR-047

This folder holds the shared standards every new Realm, Adventure, Quest and Challenge follows,
and the specification templates used to propose one. Region documents in `docs/regions/` and the
per-region roadmaps (`docs/*_ROADMAP.md`) describe one place each; these standards describe what
all of them have in common.

The documents are Proposed while ADR-072 is Proposed. Rules that already bind today are tagged
inline with their source (for example `**Binding:** ADR-047`). Untagged rules are proposals.

## Index

### Content hierarchy

| Document | Covers |
|---|---|
| [realm-standard.md](realm-standard.md) | Realms (catalog `World`), Places (`Location`), 3D Areas (`WorldRegion`); legacy Island naming |
| [adventure-standard.md](adventure-standard.md) | The full checklist for a new Adventure, from objectives to acceptance criteria |
| [quest-standard.md](quest-standard.md) | Quests (`catalog.Quest`, `quests.QuestProgress`) and the quest engine |
| [challenge-standard.md](challenge-standard.md) | Challenges (`education.ChallengeSpec`, `regions.AreaPuzzle`, `question_studio.Question`, adventure steps) |

### Cross-cutting standards

| Document | Covers |
|---|---|
| [jumping-standard.md](jumping-standard.md) | Jumping in adventures, the shared jump controller (pending merge), checkpoints and safe recovery |
| [scoring-standard.md](scoring-standard.md) | Achievement, mastery, rewards and parent reporting without an XP, coin or level economy |
| [accessibility-standard.md](accessibility-standard.md) | Controls, exits, motion, audio and text alternatives, forgiving play |
| [asset-standard.md](asset-standard.md) | Models, textures, asset ids and the Asset Manager |
| [npc-standard.md](npc-standard.md) | Characters through the NPC Manager |
| [audio-standard.md](audio-standard.md) | Sound cues, music, speech and captions through the Sound Manager |
| [educational-content-standard.md](educational-content-standard.md) | Learning objectives, age-band content, copy rules |

### Templates

| Template | Use it for |
|---|---|
| [templates/realm-specification.md](templates/realm-specification.md) | A new Realm, or a new Place or 3D Area in an existing one |
| [templates/adventure-specification.md](templates/adventure-specification.md) | A new Adventure |
| [templates/quest-specification.md](templates/quest-specification.md) | A new Quest |
| [templates/challenge-specification.md](templates/challenge-specification.md) | A new Challenge or puzzle kind |

Engineering process templates (task, handoff, pull request, QA checklist) live in
[../engineering/README.md](../engineering/README.md).

## Hierarchy summary

```text
Realm            catalog.World            (legacy "Island"; islands.json)
 └─ Place        catalog.Location         (legacy IslandLocation)
     └─ 3D Area  regions.WorldRegion      (zero or one per Place, ADR-041)
 └─ Adventure    catalog.Adventure + AdventureStep, owned by a Place; played as AdventureSession
 └─ Quest        catalog.Quest, owned by the Realm; may span Places; progress in QuestProgress
     └─ Challenge   education.ChallengeSpec, regions.AreaPuzzle, question_studio.Question,
                    or a graded AdventureStep
```

- A Realm is a content pack, not a code path or a second identity. **Binding:** ADR-009
- Adventures belong to a Place; Quests belong to the Realm and may span Places.
  **Binding:** ADR-041 (decisions C and D)
- A Challenge is any activity whose answer the server grades. **Binding:** CLAUDE.md §7

Details and model fields: [realm-standard.md](realm-standard.md).

## Lifecycle of a new adventure

| Stage | What happens | Where it is recorded |
|---|---|---|
| 1. Specification | Copy the matching template from `templates/`, fill every section, list owner decisions | The spec file in the feature branch, linked from the Trello card |
| 2. Ticket | Create a Trello card with a `LAI-<AREA>-<NNN>` id and the machine-readable ticket block | Trello ([../engineering/trello-workflow.md](../engineering/trello-workflow.md)) |
| 3. Owner decisions | Scope additions (a new Place or Realm), age bands, new puzzle kinds, new reward types | Spec "Owner decisions required"; an ADR when the decision is architectural |
| 4. Implementation | Build on the shared systems only: canonical catalog, quest engine, region play, shared movement controller, NPC Manager, Sound Manager, Asset Manager | Feature branch and worktree ([../engineering/development-workflow.md](../engineering/development-workflow.md)) |
| 5. Development checks | Targeted unit tests and typecheck | [../TESTING_STRATEGY.md](../TESTING_STRATEGY.md) |
| 6. Integration and QA | Integration branch if it depends on unmerged work; owner QA with the QA checklist | [../engineering/integration-policy.md](../engineering/integration-policy.md), [../engineering/templates/qa-checklist.md](../engineering/templates/qa-checklist.md) |
| 7. Publication | Content reaches Django through the export and `manage.py load_content` (or a code seed for layout); staff publish versioned revisions in Django Admin | [../platform/DJANGO_CONTENT_AUTHORING.md](../platform/DJANGO_CONTENT_AUTHORING.md) |
| 8. Done | Every gate in the definition of done | [../engineering/definition-of-done.md](../engineering/definition-of-done.md) |

Publication rules that already bind:

- Content first reaches Django through the export and `manage.py load_content`; after import,
  Django is authoritative and an import never silently overwrites an administrator's published
  edit. **Binding:** ADR-047, CLAUDE.md §20
- Spatial layout (positions, spawn points, placements) stays seed-authored or TypeScript-authored
  until LAI-0805 is decided. NPC placement is the one exception. **Binding:** ADR-033, ADR-047,
  ADR-054, CLAUDE.md §20
- Deployment, production data migration and changes to deployed AWS resources need explicit owner
  approval. **Binding:** CLAUDE.md §18

## Mandatory standards for every new adventure

Every new Adventure must satisfy, and its specification must reference:

1. [adventure-standard.md](adventure-standard.md): the whole checklist.
2. [realm-standard.md](realm-standard.md): it belongs to an existing Realm and Place, or the
   specification asks the owner for a new one.
3. [quest-standard.md](quest-standard.md) and [challenge-standard.md](challenge-standard.md):
   for every quest and graded activity it adds.
4. [accessibility-standard.md](accessibility-standard.md): no exception.
5. [scoring-standard.md](scoring-standard.md): no economy, rewards through `RewardRule`.
6. [jumping-standard.md](jumping-standard.md): for every free-roaming 3D adventure (proposed
   requirement; the controller is pending merge).
7. [educational-content-standard.md](educational-content-standard.md),
   [npc-standard.md](npc-standard.md), [audio-standard.md](audio-standard.md),
   [asset-standard.md](asset-standard.md): where the adventure has the matching content.

## What these standards do not do

- They do not rename anything. "Island" stays in model verbose names, API routes and fields
  (`/children/<id>/islands/`) until an approved naming migration. See
  [realm-standard.md](realm-standard.md).
- They do not accept any Reserved or Proposed ADR. Work that is pending merge is described as
  such, with its pull request.
- They do not replace region roadmaps. A region roadmap records decisions for one place; where it
  conflicts with a standard, raise it with the owner rather than editing either silently.
