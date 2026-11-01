# Django content authoring: ADR-043 impact assessment

Status: **ADR-043 accepted by the owner, 2026-11-01** (answers Q1 to Q4 and eight acceptance
requirements, recorded in the ADR). Implementation in progress on
`feature/adr-043-django-content-authoring`; see section 12 for what is built and how it is
verified. Not merged, pushed or deployed.

This assessment covers what ADR-043 would change in the codebase as it is today. Every claim was
checked against the code on 2026-11-01. Task ids that already exist are reused. New ids are
proposed in section 9 and are not added to the tracker until the ADR is accepted.

## 1. Summary

| Area | Change | Size |
|---|---|---|
| Models | 1 new shared model (`ContentRevision`); `authority` and current-revision fields on about 11 existing models; 1 new regions model (`AreaPuzzle`); revision support for `ChallengeSpec` | M |
| Migrations | Additive only. One data migration creates revision 1 from every existing `source` | M |
| Importer | `_upsert` becomes revision-aware and authority-aware; the release report gains "kept: administrator edits" | M |
| Admin | About 9 read-only screens become draft editors with Publish and Rollback; 2 new screens | L |
| APIs | Published-content reads (LAI-0503); region bootstrap extended with puzzles and band copy; one puzzle-solve route | M |
| React | Django builds read dialogue, quest text and puzzle parameters from the API; no TypeScript content is read at runtime in those builds | M |
| Workflows | `content:export` + `load_content` continue; seeds keep layout only | S |
| Amplify builds | No change until LAI-1301 | none |

## 2. What exists today (verified)

- **Import.** `lai/apps/catalog/importer.py` `_upsert` overwrites every changed content field on
  each import. Catalog fields (`active`, `sort_order`) are set only when a row is created.
  Nothing is deleted. `--force` re-imports an unchanged digest.
- **Admin.**
  - `catalog/admin.py` `CatalogModelAdmin` denies add and delete. Only `active` and
    `sort_order` are editable.
  - `ContentAsset` has a separate path for rows that originate in Django.
  - `regions/admin.py` publishes and retires 3D Areas, edits launch points, and shows layout
    read-only.
  - `ChallengeSpec` is not registered.
  - `core/tests/test_django_admin.py` asserts that no child-owned record is registered.
- **Runtime readers of `source`.** These must keep working:
  - `quests/services.py` (stages, prerequisites, completion, entry stage) and
    `quests/engine.py`.
  - `game_sessions/serializers.py` lines 172, 196 and 364.
  - `game_sessions/discovery.py` line 158.
  - `game_sessions/play_state.py` line 69.
  - `game_sessions/services.py` lines 322 and 366: the step adventure engine grades from
    `AdventureStep.source`.
- **Seed-authored rows** (`ContentStatus`): `WorldRegion`, `ChallengeSpec`,
  `AdventureLaunchPoint`. `TreasureChest`, `SpawnPoint` and `WorldObjectPlacement` have no
  status and follow their region.
- **Not imported into Django:** `stories.json`, `discoveries.json`, `interactions.json`,
  `curriculum.json` and checkpoints.
- **Volume** (export manifest, schema 3): 2 islands, 10 places, 24 adventures, 18 learning
  objectives, 7 quests, 20 items, 15 reward rules, 1 collectible set, 6 NPCs, 114 assets.

## 3. Models

### 3.1 New: `catalog.ContentRevision`

One table for every authorable kind, modelled on `assets.AssetVersion`.

| Field | Notes |
|---|---|
| `id` | UUID |
| `content_type`, `object_id` | The record (Django contenttypes). Each authorable model also gets a reverse relation |
| `kind` | Closed list (`quest`, `npc`, `adventure`, `adventure-step`, `item`, `reward-rule`, `collectible-set`, `learning-objective`, `world`, `location`, `challenge-spec`, `area-copy`, `area-puzzle`) |
| `number` | 1, 2, 3 … per record |
| `body` | JSON in the export's own record shape, validated per kind |
| `status` | `DRAFT`, `PUBLISHED`, `SUPERSEDED`, `DISCARDED` |
| `origin` | `IMPORT`, `ADMIN`, `ROLLBACK` |
| `based_on` | The revision this was edited from (conflict detection) |
| `content_release` | Set for `IMPORT` revisions |
| `created_by`, `created_at`, `published_by`, `published_at` | Audit |
| `validation_report` | The problems found at the last check |

Constraints:
- Unique on (`content_type`, `object_id`, `number`).
- At most one `PUBLISHED` revision per record (a partial unique constraint).
- A published, superseded or discarded revision is immutable, as with `ImmutableVersion` in
  the asset manager.

A generic table was chosen over one revision table per model so there is one publishing path,
one admin mixin and one test suite. The cost is a weaker database foreign key. Integrity is kept
by the revision service and an on-demand consistency check (`manage.py check_content`), and
covered by tests.

### 3.2 Changed existing models

| Model | Added | Notes |
|---|---|---|
| `World`, `Location`, `Adventure`, `AdventureStep`, `Quest`, `NpcDefinition`, `ItemDefinition`, `CollectibleSet`, `RewardRule`, `LearningObjective` | `authority` (`EXPORT` / `DJANGO`), `published_revision` (FK to `ContentRevision`, nullable during migration) | Projected columns and `source` are rewritten on publish, so the readers in section 2 are unchanged |
| `education.ChallengeSpec` | Same two fields | Keeps `ContentStatus`. Parameters become revisions. `ChallengeAttempt` already snapshots them |
| `regions.WorldRegion` | `published_copy_revision` | Only the non-spatial part of `scene` (`copy`, `environment`). `bounds` stays seed-owned |
| `ContentAsset` | none | Already Django-authorable (ADR-035) |

### 3.3 New: `regions.AreaPuzzle` (needed by Firepeak; reusable)

A spatial puzzle in a 3D Area, the generalisation of `TreasureChest`. Seed-authored fields
(position and entity ids, as for chests) are kept apart from admin-authored fields (parameters,
by revision).

| Field | Owner |
|---|---|
| `region`, `puzzle_id`, `entity_ids` (the placements it uses) | Seed |
| `kind` (closed registry: `OBSERVE_FEATURES`, `PLACE_PLATFORMS`, `VALVE_SEQUENCE`, `COLLECT_OBJECT`) | Seed |
| `parameters` per age band (copy, hints, explanations, solution, tolerances) | Admin revision, validated by the kind's Python schema |
| `requires_change_keys` (stage order), `world_change_key`, `reward_rule` | Admin revision, validated references |
| `status` | `ContentStatus` |

`TreasureChest` is unchanged. Folding it into `AreaPuzzle` is possible later but not part of
this ADR.

### 3.4 Not changed

The progress models (`AdventureSession`, `WorldChange`, `InventoryItem`, `GrantedRule`,
`QuestProgress`, `SkillEvidence`), spatial rows (`SpawnPoint`, `WorldObjectPlacement`), and
everything in `apps/assets`.

## 4. Migrations

All additive. No column is dropped or renamed.

1. `catalog`: create `ContentRevision`. Add `authority` (default `EXPORT`) and a nullable
   `published_revision` to the ten catalog models.
2. `catalog` data migration: for every existing row, create revision 1 (`IMPORT`, `PUBLISHED`,
   body = `source`, `content_release` = `last_seen_release`) and point `published_revision` at
   it. Reversible: the reverse migration clears the pointers and deletes those revisions.
3. `education`: the same fields on `ChallengeSpec`, plus a data migration that builds the body
   from its columns.
4. `regions`: `WorldRegion.published_copy_revision`, then the `AreaPuzzle` table.
5. Optional, after one release: make `published_revision` non-null where every row has one.

Development databases migrate in place; no recreation is needed, unlike ADR-033. No deployed
Django database exists (`docs/CURRENT_AWS_RESOURCE_INVENTORY.md`, LAI-0904 notes), so there is
no production data migration.

## 5. Importer and content workflows

| Workflow | Today | With ADR-043 |
|---|---|---|
| `npm run content:export` | Generates `content/exported/*.json` | Unchanged |
| `npm run content:check` | Export is current | Unchanged |
| `manage.py load_content` | Overwrites content fields | New record: `IMPORT` revision, published. Changed `EXPORT` record: new `IMPORT` revision, published (open question 2: or a draft). `DJANGO` record: untouched; listed as "kept: administrator edits" in `ContentRelease.report`, flagged when the export differs |
| `load_content --dry-run` | Reports counts | Also lists the records whose administrator edits would be kept, and the differences |
| `load_content --force` | Re-imports the same digest | Same, and never overrides `DJANGO` authority |
| `seed_treasure_rush` | Creates layout, chest specs and launch points as DRAFT | Layout only, plus first revisions for specs and copy. Still never overwrites |
| `publish_treasure_rush` (development only) | Flips status | Publishes the current draft revisions through the same service the admin uses |
| Golden vectors (`tests/golden`) | TypeScript and Python rule parity | Unchanged (rules, not content) |
| New: `manage.py export_content` | none | Published revisions written in the export format (decision L). Later task |
| New: `manage.py check_content` | none | Revision and reference consistency report |

## 6. Django Admin screens

| Screen | Today | After |
|---|---|---|
| Islands, Places | `active`/`sort_order` | Draft editor (title, tagline, description, age bands), publish, history, rollback |
| Adventures + steps | Read-only | Step editor per step type: prompts, choices, hints by band, objectives. The correct answer is validated per step type |
| Quests | Read-only | Stage and objective editor with reference pickers (items, change keys, adventures); prerequisite and branch editor over the closed condition vocabulary |
| NPCs | Read-only | Dialogue node editor: text, choices, conditions and AI narration fallback. Narration stays bounded per ADR-003 and AI_AND_CHILD_SAFETY |
| Items, collectible sets, reward rules | Read-only | Editors; triggers from the closed trigger vocabulary |
| Learning objectives | Read-only | Editor |
| Challenge specs | Not registered | Registered; parameters validated by `validate_parameters` |
| 3D Areas | Publish/retire; layout read-only | Plus a copy and environment draft editor. Layout stays read-only |
| 3D Area puzzles (new) | none | Parameter editor generated from each puzzle kind's schema, per age band. Positions read-only |
| Content revisions (new) | none | History, side-by-side difference against the current version and the latest export, "Use the exported version" |
| Child progress | Not registered (test guard) | **Not part of ADR-043.** The request's "inspect child progress" would need an ADR-039-style read-only, audited view. Proposed as its own task |

Permissions: new Django permissions `change_draft` and `publish` per kind, granted through two
groups (Content editors, Content publishers). Superusers have both. See open question 1.

## 7. APIs

| Route | Change |
|---|---|
| `GET children/<c>/regions/<r>/` (bootstrap) | Additive: band-resolved copy, NPC dialogue for the child's band, `puzzles[]` (kind, entity ids, band parameters without solutions, solved state), `contentRevisions` ids |
| `POST children/<c>/sessions/<s>/puzzles/<puzzle_id>/solve/` (new) | Server grades against the revision snapshotted when the session started (or the first attempt), records the world change, grants the reward, refreshes quests. Same transaction pattern as `submit_chest_answer` |
| LAI-0503 catalog reads | Adventures, steps (without answers), quests, items for the child's band. Published only |
| `GET children/<c>/progress/` | Unchanged |
| Everything else | Unchanged |

All new routes are child-scoped (`ChildScopedAPIView`), deny by default, and are covered by
the authorization matrix (LAI-0403).

## 8. React and engine

- Django builds take Treasure Rush copy, Pip's dialogue, quest text and puzzle parameters from
  the bootstrap.
- `regionPlayUi.ts` `PLAY_COPY` keeps only interface chrome (button labels), not content.
- The step-adventure runner in Django builds needs LAI-0806's open follow-up (a Django-backed
  runner) before admin-edited step content reaches children. Until then, edited steps take
  effect only where the Django runner is used.
- The engine stays content-free. Extensions receive validated parameters through the manifest
  binding `config`, as today.

## 9. Risks

1. **Grading drift mid-session.** The step engine reads the live `AdventureStep.source`. A
   publish during a session would change grading. Mitigation: snapshot the revision on
   `AdventureSession` when it starts, and grade from it (decision E).
2. **Export and Django drift.** After administrator edits, the TypeScript modules no longer
   describe production. Mitigation: the `--dry-run` difference report, and `export_content`
   (decision L). Long term, Django becomes the only source and the TypeScript modules are
   frozen.
3. **Amplify builds** still read TypeScript content and will not show Django edits. This is
   accepted until LAI-1301.
4. **Admin editor complexity** (dialogue graphs, quest branches) is the largest cost. It is
   staged so that plain fields ship first.
5. **Safety of authored copy.** Child-facing text is no longer reviewed in a pull request.
   Mitigation: publish-time validation (decision D), the publisher permission, and the admin log.

## 10. Tasks (in the tracker since acceptance)

| Id | Task | Depends |
|---|---|---|
| LAI-0810 | ContentRevision model, migrations, revision service, `check_content` | ADR-043 accepted |
| LAI-0811 | Authority-aware importer and release report | 0810 |
| LAI-0801 (existing, widened) | Admin draft, publish and rollback editors, staged: plain fields, then challenge specs, then quests and dialogue | 0810, 0404 |
| LAI-0812 | `AreaPuzzle`, puzzle-kind registry and Python graders, solve route | 0810 |
| LAI-0503 (existing) | Published-content read endpoints | 0810 |
| LAI-0813 | Session snapshot of gradable revisions (risk 1) | 0810 |
| LAI-0814 | `export_content` and environment promotion (decision L) | 0811 |
| LAI-0815 | Read-only audited child-progress inspection in Admin (needs its own ADR-039-style decision) | separate |
| FP-n | Firepeak Volcano on the new architecture | 0810, 0811, 0812, 0801 first stage |

These ids were checked as unused on 2026-11-01. Treasure Rush and Storykeeper Castle move onto
revisions automatically through the data migration (LAI-0810). Their admin editors arrive with
LAI-0801's stages. Neither needs a content rewrite.

## 11. Firepeak Volcano decisions already made by the owner (2026-11-01)

Recorded here so nothing is lost before the Firepeak roadmap is written after acceptance:

- **FP-D1 (owner-directed).** Firepeak Volcano is a new Place, approved by the owner's request.
  This is a scope addition under CLAUDE.md section 5.
- **FP-D2 (owner-decided).** Age bands:
  - Pathfinders (5 to 6) and Explorers (7 to 8). Sprouts are excluded for now.
  - Band-specific dialogue, hints, explanations and puzzle difficulty come through Django
    content (ADR-043 G).
  - Pathfinders get more visual guidance, simpler puzzles and shorter text. Explorers get
    harder puzzles and more independence.
  - One shared Three.js environment and set of mechanics.
  - No arithmetic unrelated to the activity.
  - Ages 9 to 12 are a future platform-wide age-band decision.
- **FP-D3 (constraint from ADR-029).** The camera is first-person, the engine's only
  controller, not third-person.
- **FP-D4 (constraint from the asset id rules).** Asset ids are flat slugs, such as
  `firepeak-volcano-main` rather than `firepeak/volcano-main`.

## 12. Build status (2026-11-01)

Implementation and verification are separate columns. "pytest" or "Vitest" means unit and
integration tests on this branch only. No merge-gate suite, browser or deployment run has
happened unless it is listed.

| Task | Implemented | Verified |
|---|---|---|
| LAI-0810 | `catalog.ContentRevision` and the `Authorable` fields on ten catalog models, `ChallengeSpec` and `WorldRegion`. The authoring service (`apps/catalog/authoring.py`) handles kinds, drafts, validation (schema, references, copy rules), publish, rollback and discard. Version 1 is migrated from `source`. | pytest (`catalog/tests/test_authoring.py`) |
| LAI-0811 | Authority-aware `load_content`. Export-owned records get a new published `IMPORT` version on change. Django-owned records are never changed; a differing export is kept as a draft and reported under `conflicts`. Count keys gain `skipped` and `conflicts` (documented change to the command's output). | pytest |
| LAI-0813 | `AdventureSession.pinned_revisions`. Pins are made at session start for step adventures (grading and hints from the pinned step), region copy, puzzles, NPC dialogue, offered quests and chest challenge specs; quest refresh uses the pinned quest. A session started before pinning keeps the old refusal. Reward rules resolve at grant time (a deliberate choice: a stale rule is never granted). | pytest, including rewritten `TestContentVersions` |
| LAI-0812 | `regions.AreaPuzzle`, the puzzle-kind registry and Python graders (`apps/regions/puzzles.py`), `PuzzleAttempt`, the solve route, bootstrap `puzzles`, `catalog` and NPC `dialogue`. `area-puzzles` golden vectors keep the TypeScript and Python rules identical. | pytest, golden vectors (both sides), Vitest |
| LAI-0801 stage 1 | Content versions in Django Admin: start, edit (JSON), discard, publish and restore. `ensure_content_roles` creates the Content editors and Content publishers groups. Challenge specs and puzzles are registered. | pytest (`test_authoring_admin.py`) |
| LAI-0814 | Not started | none |
| LAI-0815 | Deferred by the owner | none |
| LAI-0503 | Not started; the region bootstrap carries what Firepeak needs | none |

**Known limitations:**
- Drafts are edited as JSON in this first stage; structured editors per kind are later
  LAI-0801 stages.
- Administrator edits do not move between environments yet (LAI-0814).
- NPC dialogue has no age-band field in the export schema, so band-specific lines live in
  puzzle parameters (FP-D9).
- The Amplify build still reads TypeScript content.
