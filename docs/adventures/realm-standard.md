# Realm Standard

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-009, ADR-031, ADR-032, ADR-033, ADR-041, ADR-047, ADR-054

This standard fixes the terminology for the content hierarchy and the rules for Realms, Places and
3D Areas. Adventures, Quests and Challenges have their own standards:
[adventure-standard.md](adventure-standard.md), [quest-standard.md](quest-standard.md),
[challenge-standard.md](challenge-standard.md).

## 1. Terminology

| Standard term | Child-facing word | Django model | Admin label today | Legacy names |
|---|---|---|---|---|
| Realm | Realm | `catalog.World` | "island" (verbose name) | Island, world, `islands.json` |
| Place | Place | `catalog.Location` | "place" | `IslandLocation`, location, region |
| 3D Area | (the Place's explorable space) | `regions.WorldRegion` | "3D Area" | region, play region |
| Adventure | Adventure | `catalog.Adventure`, `catalog.AdventureStep` | "adventure" | `AdventureTemplate` |
| Quest | Quest | `catalog.Quest` | "quest" | `QuestDefinition`, `ChildQuestState` |
| Challenge | (the activity's own name: puzzle, chest, question) | see [challenge-standard.md](challenge-standard.md) | per model | |

Rules:

- Use **Realm** in all new player-facing text and new documentation. "Realm" is the child-facing
  word for an Island since the Realm Explorer (AP-03, `react/src/features/realms/realmCatalog.ts`).
- ADR-041 decision A made World read as "Island" in Django Admin, copy and documentation. AP-03
  later changed the child-facing word to Realm without an ADR. Django Admin still says "island".
  Until the owner records the naming decision, staff-facing Admin labels stay as they are.
- Never call a child profile a "user" in child-facing copy. **Binding:** CLAUDE.md §9
- Do not rename any model, table, field, content id or API route in this initiative. Class,
  table, primary key, content id and API names are unchanged by design. **Binding:** ADR-041
  (decision A)

### Legacy compatibility

| Surface | Legacy name kept | Notes |
|---|---|---|
| API route | `GET /children/<id>/islands/` | Returns Island > Place > 3D Area for the child (ADR-041); the Realm Explorer is built only from it |
| API fields | `locationSlug`, `region_id`, `autoSelectIslandId` | Unchanged |
| Model fields | `Adventure.world`, `Quest.world` (verbose name "island"), `WorldRegion.location` | Unchanged |
| Content export | `islands.json`, `locations.json` | Unchanged |
| CLAUDE.md | "island", `IslandLocation` | Recorded as outdated in [../engineering/initial-audit.md](../engineering/initial-audit.md) |

A repository-wide rename needs its own owner-approved naming migration and ADR.

## 2. Realm (`catalog.World`)

A Realm is a themed world: a content pack, not a code path or a second identity.
**Binding:** ADR-009

| Aspect | Rule |
|---|---|
| Identifier | `World.slug`: lowercase kebab-case, unique, at most 100 characters (`learning-adventure-island`, `creature-care-cove`) |
| Fields | `title`, `tagline`, `description`, `is_home`, `supported_age_bands`, `pack_version`; travel requirement in `source` |
| Child identity | One `ChildProfile`, one inventory, every Realm. No per-Realm profile, inventory or progress row. **Binding:** ADR-009 |
| Arrival | "Having been somewhere" is a `WorldChange`, not a new model. **Binding:** ADR-009 |
| Reachability | A Realm is open when it is active, authored for the child's band and its travel requirement is met by one of the child's `WorldChange` keys (`education/director.py`; Realm Explorer states `AVAILABLE`, `LOCKED`, `UNAVAILABLE`) |
| Content pack | Every Place, Adventure, Quest, item, set, NPC, discovery and story belongs to exactly one Realm's pack. **Binding:** ADR-009 |

A new Realm is a scope addition. It needs an owner decision before work starts
(CLAUDE.md §5: future locations are not MVP scope unless approved). Use
[templates/realm-specification.md](templates/realm-specification.md).

## 3. Place (`catalog.Location`)

| Aspect | Rule |
|---|---|
| Identifier | `Location.slug`: kebab-case, unique (`pirate-builder-bay`, `firepeak-volcano`) |
| Parent | `Location.world`: exactly one Realm |
| Fields | `title`, `tagline`, `description`, `skills`; `active`, `sort_order` are Django-owned |
| Adventures | A Place owns its Adventures (`Adventure.location`). **Binding:** ADR-041 (decision C) |
| Story-only places | An Adventure may name a `location_slug` with no `Location` row; it then belongs to no Realm for reachability |

## 4. 3D Area (`regions.WorldRegion`)

| Aspect | Rule |
|---|---|
| Identifier | `WorldRegion.region_id`: kebab-case slug, unique, at most 80 characters (`treasure-rush-cove`, `firepeak-volcano`) |
| Cardinality | Zero or one per Place, enforced by the constraint `regions_one_area_per_place`. A Place is valid without one. **Binding:** ADR-041 (decision B) |
| Renderer | Three.js only; new playable environments are never Phaser. **Binding:** ADR-020, ADR-029, CLAUDE.md §19 |
| Age bands | `WorldRegion.age_bands`; empty means every band the Realm supports |
| Publication | `status` (`DRAFT`, `PUBLISHED`, `RETIRED`, `ContentStatus`); only `PUBLISHED` is served to a child |
| Launching Adventures | Through `regions.AdventureLaunchPoint`, bound to a placement in the same 3D Area and an Adventure of the same Place. **Binding:** ADR-041 (decision C) |
| Offered quests | `WorldRegion.offered_quests`; accepting a quest is always the child's choice |
| Checkpoints | `regions.SpawnPoint` (`checkpoint_id`, one default per region) |

### Ownership of a 3D Area's data

| Data | Owner | Source |
|---|---|---|
| Bounds, layout, placements, spawn points, colliders, effects | Code seed (for example `lai/apps/regions/treasure_rush_seed.py`, `firepeak_seed.py`) or a TypeScript manifest for shipped regions | **Binding:** ADR-033 (item 4), ADR-047 (decision H), CLAUDE.md §20 |
| Title, copy and environment settings (non-spatial `scene`) | Django Admin, versioned revisions | **Binding:** ADR-047 |
| Puzzle parameters (`AreaPuzzle`) | Django Admin, versioned revisions; mechanic and placements stay seed | **Binding:** ADR-047 |
| Launch points | Django Admin | **Binding:** ADR-041 (decision E) |
| NPC placement | Django Admin through the NPC Manager (numeric fields, validated against Realm, Place and 3D Area) | **Binding:** ADR-054 (exception to LAI-0805, NPCs only) |

There is no visual layout editor before LAI-0805 is decided. Do not add spatial fields to the
catalog. **Binding:** ADR-041 (decision E)

Shipped TypeScript regions keep their manifests (`react/src/features/island-map/three/runtime/manifests/`),
described by the serializable location manifest. **Binding:** ADR-032

## 5. Ownership and publication

| Record | Before import | After import |
|---|---|---|
| Realm, Place, Adventure, step, Quest, NPC definition, item, set, reward rule, learning objective | TypeScript content modules, exported by `npm run content:export` | Django is authoritative; staff edit published content through versioned `ContentRevision`s. **Binding:** ADR-047 |
| `active`, `sort_order` | Set by the importer on create only | Django-owned |
| Challenge specs, 3D Area copy, puzzle parameters | Code seed, recorded as a first `SEED` revision | Django Admin revisions |

- Every successful import is a `ContentRelease`. Nothing is deleted by an import; a record the
  latest export no longer has keeps its row (`last_seen_release`).
- A record whose content an administrator has published becomes `authority = DJANGO`; no import
  changes it. **Binding:** ADR-047 (decision J)
- A session pins the published revisions it started with, so a publish never changes a visit in
  progress. **Binding:** ADR-047 (acceptance requirement 1, LAI-0813)
- Do not add a second catalog, content loader, child-owned base or progress model for one Realm
  or feature. **Binding:** ADR-033, CLAUDE.md §20

## 6. Progress tracking

Realm and Place progress is derived, never stored on a per-Realm row:

| Fact | Where it lives |
|---|---|
| Arrived at a Realm, unlocked a path, opened a chest | `progression.WorldChange` (unique per child, place and key) |
| Discoveries, last checkpoint | `progression.WorldState` |
| Adventures completed | `game_sessions.AdventureSession` with status `COMPLETED` |
| Quests | `quests.QuestProgress` |
| Items | `inventory.InventoryItem` |
| Skills | `education.SkillProgress` |

## 7. Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Realm, Place, Adventure, Quest slugs | lowercase kebab-case | `the-volcano-awakens` |
| 3D Area id, checkpoint id, launch id, puzzle id, entity id | lowercase kebab-case, unique within their 3D Area | `cove-landing` |
| World change keys | UPPER_SNAKE_CASE, prefixed by the place | `FIREPEAK_CROSSING_REPAIRED` |
| Asset ids | flat kebab-case slugs | see [asset-standard.md](asset-standard.md) |
| Child-facing titles | Plain, readable aloud, no em dashes | **Binding:** CLAUDE.md §13 |

## 8. Implemented examples on `main`

| Realm | Places with a 3D Area | Notes |
|---|---|---|
| `learning-adventure-island` (home) | Treasure Cove (`treasure-rush-cove`, Pirate Builder Bay's 3D Area); Firepeak Volcano (`firepeak-volcano`) | Treasure Cove is seed-authored (TR-13 to TR-20). Firepeak "The Volcano Awakens" (FP-2 to FP-10) is seeded as `DRAFT`, published by a development-only command |

Storykeeper Castle, Welcome Harbor, Wonderwild Forest and other shipped locations run on
TypeScript manifests. Unmerged work (Heart of Firepeak on `feature/firepeak-volcano-adventure`,
North Pole on `feature/north-pole-adventure`, Castle Director on
`feature/storykeeper-castle-completion`) is not part of `main`.

## 9. Acceptance criteria for a new Realm, Place or 3D Area

- [ ] Owner decision recorded for the scope addition.
- [ ] Specification from [templates/realm-specification.md](templates/realm-specification.md).
- [ ] Records added through the export (and a code seed for layout), not by hand in production.
- [ ] Every id belongs to exactly one content pack; content-pack tests pass.
- [ ] At most one 3D Area per Place; age bands set; `DRAFT` until owner QA.
- [ ] Exits reachable everywhere ([accessibility-standard.md](accessibility-standard.md)).
- [ ] Assets, NPCs and audio follow [asset-standard.md](asset-standard.md),
  [npc-standard.md](npc-standard.md) and [audio-standard.md](audio-standard.md).
