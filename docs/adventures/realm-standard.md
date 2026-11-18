# Realm Standard

- **Status:** Mandatory policy (merged to `main` at the owner's direction on 2026-11-18; formal acceptance of ADR-072 pending). Rules restated from CLAUDE.md and accepted ADRs bind through those sources.
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-009, ADR-031, ADR-032, ADR-033, ADR-041, ADR-047, ADR-054
- **Canonical sources:** [docs/DECISIONS.md](../DECISIONS.md) (ADR-041 for the hierarchy), [docs/DATA_MODEL.md](../DATA_MODEL.md) ("Island, Place, 3D Area and AdventureLaunchPoint"), [lai/apps/catalog/models.py](../../lai/apps/catalog/models.py), [lai/apps/regions/models.py](../../lai/apps/regions/models.py), [react/src/features/realms/realmCatalog.ts](../../react/src/features/realms/realmCatalog.ts)

This standard covers the spatial and catalog levels above an adventure: the Realm, its Places,
and each Place's optional 3D Area. It also holds the terminology mapping and identifier rules
that the other adventure standards use.

## Terminology mapping

The standard terms are the owner's vocabulary. The model column is what exists in `main`. Do not
rename models, tables, routes, API fields or content ids to match the standard terms: a rename
needs its own ADR and migration plan (the "naming migration" noted in
[realmCatalog.ts](../../react/src/features/realms/realmCatalog.ts) is not approved work).

| Standard term | Model or code in `main` | Legacy and alternative names | Notes |
|---|---|---|---|
| Realm | `catalog.World` | Island (ADR-041 labels, Django Admin), `WorldDefinition`, world pack, `IslandSummary`, `/children/<id>/islands/` | "Realm" is the child-facing word since AP-03 (Realm Explorer). One Realm may be the home (`World.is_home`) |
| Place | `catalog.Location` | `IslandLocation`, location, `locationSlug`, `location_slug` | Belongs to one Realm. Owns its step adventures (`Adventure.location`) |
| 3D Area | `regions.WorldRegion` | region, `region_id`, region manifest, world view, "location" in engine docs | Zero or one per Place (`regions_one_area_per_place`). Layout is seed or manifest authored |
| Area zone | `scene` rectangles, `platforming.zones` (pending merge), checkpoints | zone, room (castle) | A named part of a 3D Area; not a model |
| Adventure (primary) | No single row. A Place and its 3D Area, plus the quests, area puzzles, chests and launch points that make one experience | "adventure" in roadmaps (Treasure Rush, Firepeak) | See the [adventure standard](adventure-standard.md) |
| Step adventure | `catalog.Adventure` + `catalog.AdventureStep`; played as `game_sessions.AdventureSession` | `AdventureTemplate`, `AdventureDefinition`, "Adventure" in ADR-041 and on Place pages | CLAUDE.md section 9 calls it `AdventureTemplate`. A challenge-bearing part of a primary adventure, or a card-route activity |
| Launch point | `regions.AdventureLaunchPoint` | `START_ADVENTURE` interaction (TypeScript manifests) | Starts a step adventure from an object in a 3D Area (ADR-041 C) |
| Quest | `catalog.Quest`; child state `quests.QuestProgress` | `QuestDefinition`, `ChildQuestState` | Owned by the Realm (`Quest.world`); may span Places (ADR-041 D) |
| Challenge | `AdventureStep` (answerable types), `regions.TreasureChest` + `education.ChallengeSpec` (+ `ChallengeAttempt`), `regions.AreaPuzzle` (+ `PuzzleAttempt`), pickups on `WorldObjectPlacement` | puzzle, chest, encounter, activity | See the [challenge standard](challenge-standard.md) |
| World consequence | `progression.WorldChange` | world change, change key | Append-only and child-scoped (ADR-005) |
| Story | `catalog.Story`; child state `progression.StoryProgress` | `StoryDefinition`, `ChildStoryProgress` | Story Engine keeps sole ownership of progress (ADR-027) |

Known terminology conflicts, recorded rather than resolved here:

- ADR-041 and Django Admin say **Island**; the child-facing app says **Realm** for the same
  `World` row. Both are correct in their place.
- Some branch documents call a 3D Area a "Realm" (for example "the existing Treasure Cove Realm" in
  the Pirate's Leap document). Treasure Cove is a 3D Area in the Place Pirate Builder Bay, not a
  Realm. Use the mapping above.
- The child's exit button still says **"Leave island"** (AP-04; `portal/exit/copy.ts`,
  `IslandLayout.tsx`). It is legacy child-facing copy and is not renamed to "Realm" without an
  approved copy change.
- "Adventure" means two things: the owner's primary adventure and the catalog's step adventure.
  Specifications must say which one they mean.
- [docs/DATA_MODEL.md](../DATA_MODEL.md) "Exported game content" records an approved hierarchy
  "Island > Adventure > Quests, Objectives, Challenges, Rewards" and notes that Quests are not
  nested in Adventures in code. That is still true: a quest belongs to the Realm and points at
  what it needs.

## Identifiers

Identifiers are stable, authored and never generated at runtime. They are content ids, not
database primary keys. Formats found in `main`:

| Identifier | Format | Examples in `main` |
|---|---|---|
| Realm, Place, step adventure, quest, story slugs | kebab-case `SlugField`, unique | `pirate-builder-bay`, `firepeak-volcano`, `the-volcano-awakens`, `three-planks-for-the-bridge` |
| 3D Area `region_id` | kebab-case slug, unique | `treasure-rush-cove`, `firepeak-volcano` |
| Ids inside one 3D Area (`checkpoint_id`, `entity_id`, `puzzle_id`, `launch_id`) | kebab-case slug, unique within the Area | `cove-landing`, `cove-chest`, `firepeak-telescope`, `signpost-<adventure-slug>` |
| Quest stage and objective ids | kebab-case | `meet-professor-ember`, `<stage>-done` |
| World change keys | UPPER_SNAKE_CASE with an adventure prefix | `TREASURE_RUSH_COVE_CHEST_OPENED`, `FIREPEAK_CROSSING_REPAIRED` |
| World change keys, namespaced exception | `<namespace>:<id>` | `castle-room:<roomId>` with type `ROOM_DISCOVERED` (ADR-051) |
| Items, reward rules, NPCs, learning objectives | kebab-case | `golden-doubloon`, `reward-firepeak-telescope`, `professor-ember`, `counting-sets` |
| Asset ids | flat kebab-case slug | `firepeak-volcano-main` |
| Sound cue ids | dotted lower case | `music.cove.explore` |
| Enumerations | UPPER_SNAKE_CASE | `SPROUT`, `PATHFINDER`, `EXPLORER`; `DRAFT`, `PUBLISHED`, `RETIRED` |

Rules for new content:

1. Use the format in the table. Do not mix formats inside one id family.
2. Prefix ids inside a 3D Area and world change keys with a short adventure or Area name
   (`firepeak-`, `FIREPEAK_`), so ids never collide when content is merged.
3. Never reuse or repurpose an id that has shipped: progress rows reference it by string.
4. Check uniqueness against the export and the seeds before choosing an id
   (`npm run content:check` covers exported content).

## Required fields

| Level | Required | Source |
|---|---|---|
| Realm | `slug`, `title`, `tagline`, `description`, `supported_age_bands`, `pack_version`, `is_home`, `active`, `sort_order`; optional travel requirement (kept in `World.source`) | `catalog.World` |
| Place | `slug`, `world`, `title`, `tagline`, `description`, `active`, `sort_order` | `catalog.Location` |
| 3D Area | `region_id`, `location`, `title`, `version`, `scene`, `status`, `age_bands`, at least one `SpawnPoint` with `is_default` | `regions.WorldRegion`, `regions.SpawnPoint` |

A specification for a new Realm, Place or 3D Area also states its theme, its age bands, how a
child reaches it (travel requirement), its picture assets, and which adventures it will hold.
Use the [Realm specification template](templates/realm-specification.md).

## Relationships

- A Realm has many Places. A Place belongs to one Realm.
- A Place has zero or one 3D Area. A Place stays valid without one (ADR-041 B).
- Step adventures belong to a Place. Quests belong to a Realm and may span its Places.
- A 3D Area offers quests (`WorldRegion.offered_quests`) and launches step adventures of the
  **same Place** only (ADR-041 C).
- Placements, chests, puzzles, spawn points and launch points belong to one 3D Area.

## Ownership

- **Content authority.** Content first reaches Django through the TypeScript export and
  `manage.py load_content`. After import Django is authoritative and administrators edit it as
  versioned revisions; an import never silently overwrites an administrator's edit
  (ADR-033 as amended by ADR-047, CLAUDE.md section 20). Do not add a second catalog, loader or
  progress model for one Realm or adventure.
- **Spatial layout.** Positions, spawn points and placements are not Django-administered until
  LAI-0805's ADR. Shipped regions keep their TypeScript manifests; Treasure Cove's layout stays in
  [lai/apps/regions/treasure_rush_seed.py](../../lai/apps/regions/treasure_rush_seed.py)
  (CLAUDE.md section 20). NPC placement is the owner-approved exception (ADR-054).
- **Assets.** Staff author assets in Django Admin only; React consumes published assets
  (ADR-045). Content references assets by id.

## Publication

- Catalog rows use `active`; authorable content uses `ContentRevision` statuses (DRAFT,
  SUBMITTED, REJECTED, PUBLISHED, SUPERSEDED, DISCARDED). 3D Areas, launch points and area
  puzzles use `ContentStatus` (DRAFT, PUBLISHED, RETIRED). Only published, active content is
  served.
- The server decides visibility: `GET /children/<id>/islands/` returns only what this child may
  see for their age band ([docs/PLAY_API.md](../PLAY_API.md)). The client never filters
  unpublished content itself.
- A session pins the content revision it started with (LAI-0813), so a publish never changes an
  activity mid-play.
- Publishing to any shared or deployed environment needs owner approval.

## Progress tracking

A Realm stores no progress of its own. What a child has done is read from canonical records:
`WorldChange` keys (including travel requirements and Place unlocks), `WorldState` (last
checkpoint, discoveries), `QuestProgress`, `AdventureSession`, `InventoryItem`. The Realm card
shows Places explored, never points or a score.

## Naming

- Child-facing names are short, readable aloud, localizable and free of em dashes
  (CLAUDE.md section 13).
- Do not use a real brand, product or third-party character name.
- The slug is derived from the name once and then fixed, even if the title changes.

## Acceptance checklist

- [ ] Uses existing models; no new catalog, loader or progress model (ADR-033).
- [ ] Ids follow the identifier table and are unique.
- [ ] Every required field is authored; age bands are declared.
- [ ] Each Place has zero or one 3D Area; layout is seed or manifest authored (LAI-0805).
- [ ] Visibility, age-band filtering and travel requirements are decided by the server.
- [ ] Child-facing copy uses Realm and Place, not "user", "region" or "world" (the legacy "Leave island" exit copy stays until an approved copy change).
- [ ] Content export and import checks pass for the new rows.
- [ ] Owner approved the Realm specification before build.
