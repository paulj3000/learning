# Treasure Rush: Roadmap and Readiness

**Status (2026-10-24):** TR-0 (this plan), TR-1 (server-side math challenges), and TR-2
(catalog models and loader) are done on branch `feature/treasure-rush-slice`, cut from `main`
at `350e11b`. Nothing is playable yet. TR-D3 and TR-D7 are taken as authorised by the Treasure
Rush brief (admin-managed content; no second asset system); the other decisions in section 6
are still **Proposed**.

Treasure Rush is a short Three.js adventure. The child walks to a treasure chest, solves a math
challenge suited to their age band and skill, and the chest opens. A keepsake goes into the
backpack, the open chest stays open on later visits, and a quest-complete screen ends the
adventure. Administrators manage the content in Django admin.

This roadmap has its own task ids, **TR-0** to **TR-11**, following the precedent of
`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` (SC-n). It does not add a second system beside the
migration. Where a TR task needs a generic Track A or Track B task, **it is that task**, and
Treasure Rush is the first content that task serves. Those rows name the LAI id, and the
tracker entry for that id is what gets ticked.

## 1. What the inspection found

- **Branch and worktree.** Branch `treasure-rush` is a separate worktree
  (`../learning-treasure-rush`), created from `d13dba9`, the tip that contains every other local
  and remote branch. The main worktree has another session's uncommitted multiplayer files
  (`src/`, `server/multiplayer/regionBounds*`). They were not touched.
- **LAI-2106 is not visible here.** It is not in `tasks/TASK_TRACKER.md` (Phase 21 stops at
  LAI-2105), not on any local or remote branch, and not in any worktree of this clone. This
  plan therefore assumes nothing about its API. Section 7 says what Treasure Rush needs from it.
- **No Treasure Rush task existed** in any document on any branch.
- **The Django backend** has `core`, `users` (ParentAccount, ChildProfile, Cognito JWT, tenant
  harness), and now `education` (TR-1). It has no catalog, no progress models, no gameplay
  endpoint, and **no Django admin at all**: `django.contrib.admin`, `auth`, and `sessions` are
  not installed, and `ParentAccount` deliberately has no staff or superuser flags (LAI-0404 owns
  admin access).
- **The Three.js runtime is ready to host the world** (ADR-032): one route
  (`/island/:childId/explore/:regionId`), one view (`ThreeLocationWorldView`), one engine
  (`createLocationEngine`), and a plain-JSON `ThreeLocationManifest` with props, NPCs,
  collectibles, zones, interactions, and `adventureBindings`. A `treasure-chest` model with an
  `Open` clip already exists and is used as a prop in Pirate Builder Bay.
- **Reusable domain code** (TypeScript, Amplify-backed today): the adventure engine
  (`validateStepAnswer`, `number-input` and `choice` steps, hints), `ItemDefinition` and
  `RewardRule` with `resolveRewards`, quests (`QuestDefinition`, `advanceQuest`), NPC dialogue
  (`NpcDefinition`, `NpcConversation.tsx`), `recordWorldChangeOnce`, `WorldActionPanel`
  (START_ADVENTURE hand-off), and `WorldHud`. The content export (LAI-0302) already writes
  islands, adventures, quests, rewards, NPCs, interactions, curriculum, and assets as JSON.
- **Governance that shapes the plan:** ADR-011 (no coins or XP economy), ADR-020 (the engine
  never grades or awards, new worlds are Three.js), ADR-030 (content refers to assets by id),
  ADR-031 (admin catalog is an overlay on source content), ADR-032 (checkpoints and spawn stay
  in source), ADR-019 (Django direction accepted, gates open).

**Update (TR-2 session).** LAI-2106 has since landed on `main` as `350e11b` ("Asset loader
reliability": skeleton-safe cloning, failed-load eviction, load events). It changes
`react/src/features/island-map/three/assets/assetLoader.ts`, `cloneAsset.ts`, and
`runtime/createLocationEngine.ts`. Those are exactly the files TR-7a would touch, so TR-7a now
waits until the LAI-2106 owner confirms the shared asset work is finished there, and TR-2 (no
frontend files) was done first instead.

## 2. Gap analysis

| # | MVP requirement | Exists today | Gap |
|---|---|---|---|
| 1 | Three.js island environment | Generic manifest runtime and route | A Treasure Rush manifest, served from Django instead of source (TR-7) |
| 2 | Controllable player | First-person controller, pointer and touch controls | None for the slice. Tap-to-move for Sprouts is LAI-2104 |
| 3 | One chest in the world | `treasure-chest` model, `PropSpec` | Chest placement as admin data (TR-2, TR-7) |
| 4 | Interaction with the chest | `ObjectInteracted` event, interactions, `WorldActionPanel` | A challenge hand-off action from the chest (TR-8) |
| 5 | Skill-appropriate math challenge | Authored `number-input`/`choice` steps, curriculum skills | **TR-1 done:** parameterised, seeded challenges with age-band and skill limits |
| 6 | Backend answer validation | Amplify `submitAdventureAnswer`; **TR-1** `grade_answer` | Django endpoint that stores the challenge and grades it (TR-5) |
| 7 | Chest unlocks | `recordWorldChangeOnce`, prop `requirements`, `interactClip` | Server-side WorldChange write in Django (TR-4, TR-5) |
| 8 | Coin or collectible reward | `ItemDefinition`, `RewardRule`, inventory | Decision TR-D1 (no coins); Django inventory write (TR-4, TR-5) |
| 9 | Persistent progression | Amplify progress models | Django progress models, LAI-0305 (TR-4) |
| 10 | Quest-complete screen | Adventure `complete` step, quests journal | A completion screen fed by the server result (TR-8) |
| A | Admin: adventure name, description, availability | Amplify catalog overlay (ADR-031) | Django catalog models (LAI-0304) and admin (LAI-0404, LAI-0801) |
| B | Admin: quests and prerequisites | TS `QuestDefinition` | Same as A |
| C | Admin: math skills, difficulty, parameters | **TR-1** `ChallengeParameters` | A model row per challenge slot, validated by TR-1 (TR-2) |
| D | Admin: chests and locations | None as data | TR-2 |
| E | Admin: rewards and collectibles | TS `ItemDefinition`, `RewardRule` | LAI-0304 inventory catalog |
| F | Admin: NPCs and dialogue | TS `NpcDefinition` | LAI-0304 scope addition (TR-2) |
| G | Admin: player spawn | Source checkpoints only (ADR-032 C) | Decision TR-D4 |
| H | Admin: world object placement | Source manifests only | Published manifest snapshots (TR-2, decision TR-D3) |
| I | Admin: progression rules | TS reward rules and quest conditions | LAI-0304 and LAI-0605 |

## 3. Dependency map

```text
TR-1 challenges (DONE) ---------------------------------------+
                                                              v
TR-2 = LAI-0304 catalog (no assets app) --> TR-4 = LAI-0305 progress --> TR-5 play API
        needs TR-D3, TR-D7                                                  |
TR-3 = LAI-0404 admin access + LAI-0801 admin  (needs TR-D5)                |
                                                                            v
TR-6 frontend Django client (LAI-0501 slice, needs TR-D8) -----------> TR-7 Treasure Rush region
TR-7a placeholder-mesh asset adapter (can start now) -----------------^     |
                                                                            v
                                                     TR-8 challenge and completion UI
                                                                            v
                                                     TR-9 end-to-end and playtest
LAI-2106 shared asset management (other branch) ---> TR-10 swap the adapter for the real resolver
```

**Can be done now, with no further approval:** TR-1 and TR-2 (done), TR-4. TR-7a once LAI-2106 settles. **Needs a decision
first:** TR-2 (TR-D3, TR-D7), TR-3 (TR-D5), TR-6 (TR-D8), TR-7 (TR-D2, TR-D4). **Waits for
LAI-2106:** TR-10 only. Nothing else depends on it, because every TR task refers to assets by
id through the adapter.

## 4. Tasks

Format: **Depends** | **Risk** | **Approval**. Every task follows `CLAUDE.md` section 14.

**TR-0 Plan.** DONE. This document.

**TR-1 Server-side math challenges.** DONE (section 8). Depends: none. Risk L. Approval: none.

**TR-2 Catalog models for adventure content (is LAI-0304, without `assets`).** DONE (section 9). Depends: TR-D3,
TR-D7, LAI-0302, LAI-0301. Risk M. Acceptance: LAI-0304's acceptance (islands, adventures,
quests, inventory `ItemDefinition` and reward rules, education `LearningObjective`, idempotent
`load_content` that validates against the JSON Schema, row counts equal the export), plus three
additions for Treasure Rush: an NPC catalog with dialogue nodes; a `ChallengeSpec` row (TR-1
`ChallengeParameters` plus age band, validated with `validate_parameters` on save); and a
`LocationManifestSnapshot` holding an ADR-032 manifest as validated JSON with a draft or
published status. Asset references are plain `asset_id` strings (section 7). Tests: loader
idempotency, schema rejection, `ChallengeSpec` rejects every TR-1 error code.

**TR-3 Django admin access and catalog admin (is LAI-0404, then LAI-0801).** Depends: TR-2,
TR-D5. Risk M. **APPROVAL** (admin identity and login, TR-D5). Acceptance: LAI-0404 and
LAI-0801 as written; Treasure Rush content (adventure, quest, challenge specs, chest
placement, reward, NPC, spawn, manifest publish) editable; deny-by-default tests; no child data
models registered.

**TR-4 Progress models (is LAI-0305, the Treasure Rush subset first).** Depends: TR-2. Risk M.
Acceptance: `AdventureSession`, a `ChallengeAttempt` (session, spec, seed, correctness, no
child free text), `WorldChange` unique on `(child, location, change_key)`, `InventoryItem`, and
`QuestProgress`, with migrations and tenant-scoped managers.

**TR-5 Treasure Rush play API.** Depends: TR-4, LAI-0403. Risk H. Acceptance: child-scoped
endpoints (`ChildScopedMixin`): start or resume a session; issue a challenge (the server picks
the seed and returns `public_challenge` only); submit an answer (`grade_answer`; on success, in
one transaction, record the chest WorldChange, grant the reward by rule id, and complete the
quest, all idempotent). The response is the completion summary. Tests: two-family isolation on
every endpoint, replayed success grants nothing twice, malformed answers return the safe error
envelope, the answer never appears in any response.

**TR-6 Frontend Django client for Treasure Rush (LAI-0501 slice).** Depends: TR-5, TR-D8.
Risk M. Acceptance: `react/src/api/` module behind `VITE_BACKEND`, typed DTOs, Cognito bearer
token, fallback copy on network failure. No other feature moves.

**TR-7a Placeholder-mesh asset adapter.** Depends: LAI-2106 settling (it edits the same
loader and engine files). Risk L. Acceptance: when a prop or NPC
model is missing or fails to load, the runtime shows a primitive mesh of the declared size and
the interaction still works; generic for every region; tests with a failing resolver. Must not
edit LAI-2106 files (check the LAI-2106 branch's file list first).

**TR-7 Treasure Rush region.** Depends: TR-6, TR-7a, TR-D2, TR-D4. Risk M. Acceptance: a
manifest loaded from the published snapshot through a `LocationManifestRepository`
implementation, validated by `validateLocationManifest`; chest prop with closed and open
states driven by the WorldChange; spawn from admin data; no slug branching
(`noLocationBranching.test.ts` stays green).

**TR-8 Challenge and quest-complete UI.** Depends: TR-7. Risk M. Acceptance: React challenge
card rendering `operation` and `operands` from localizable strings, choices as large buttons
for Sprouts, number entry for older bands, hint path, keyboard and HUD equivalents, a
quest-complete screen with the keepsake and a calm stopping point; loading, empty, error, and
fallback states.

**TR-9 End-to-end and playtest.** Depends: TR-8. Risk M. Acceptance: Playwright journey
(walk, open, answer, reward, revisit shows open chest); a human playtest note per age band.

**TR-10 Integrate LAI-2106.** Depends: LAI-2106 merged, TR-7a. Risk M. Acceptance: the adapter
resolves through the shared asset manager; content keeps its ids; placeholders remain the
failure path.

**TR-11 Second chest and quest chain.** Depends: TR-9. Risk L. Acceptance: quest prerequisites
exercised end to end with admin-authored content only, no code change.

## 5. First independently implementable task

TR-1 was chosen because it needs no decision, no model, and nothing from LAI-2106, and every
later backend task builds on it. It is the rule the user asked for in requirement 6
("correct answer validation on the backend") and the parameter set behind admin requirement C.

## 6. Decisions that need approval (Proposed)

These are recorded here rather than as numbered ADRs because LAI-2106 is being written on
another branch and may take the next ADR number (ADR registry rule 2). Each becomes an ADR,
numbered on the integration branch, once accepted.

- **TR-D1 The reward is a keepsake, not coins.** ADR-011 rules out a coin economy. Proposal: a
  "Golden Doubloon" `ItemDefinition` (category KEEPSAKE) granted once per chest by reward rule
  id, with no count, no spending, and no shop. A real coin balance would supersede ADR-011 and
  is a product decision.
- **TR-D2 Where Treasure Rush lives.** A new island location is a scope change (CLAUDE.md
  section 5). Proposal: a new region inside Pirate Builder Bay (`locationSlug:
  pirate-builder-bay`), which ADR-032 part D allows, so no new `IslandLocation` is needed.
- **TR-D3 Admin-authored content is authoritative for Treasure Rush.** ADR-031 makes the admin
  catalog an overlay on source content. Treasure Rush would be the first content whose steps,
  placement, and rules live only in PostgreSQL. This is the ADR-019 direction, but it is a
  change to ADR-031 and needs saying out loud.
- **TR-D4 Spawn and checkpoints as data.** ADR-032 part C keeps checkpoints in
  `discovery/checkpoints.ts`. Proposal: a published manifest snapshot may carry its own
  checkpoints, including spawn; source regions keep the current rule.
- **TR-D5 How administrators sign in to Django admin.** `ParentAccount` has no password and no
  staff flags by design. Options: (a) staff flags on `ParentAccount`, granted out of band,
  with a Cognito sign-in that creates a Django session; (b) a separate local staff login. (a)
  keeps one identity; (b) is faster but adds passwords. Owner decides (LAI-0404).
- **TR-D6 Parameterised challenges.** TR-1 generates challenges from parameters and a seed
  instead of authoring each correct value. The server stores parameters and seed per attempt,
  so any challenge can be reproduced, and never sends the answer. Built because the brief asks
  for it explicitly; recorded for acceptance.
- **TR-D7 LAI-0304 without the `assets` app.** The catalog task is split so its asset models
  are left to LAI-2106. Catalog rows store asset ids only.
- **TR-D8 One feature on Django before cutover.** Treasure Rush would be the first frontend
  feature to read from Django behind `VITE_BACKEND`, local only until a dev environment exists
  (LAI-1004).

## 7. Asset integration contract (what Treasure Rush needs from LAI-2106)

Treasure Rush assumes nothing about the LAI-2106 API. It needs these properties, and the
adapter (TR-7a) provides them from the bundled manifest until LAI-2106 lands.

1. **Reference by id.** Content stores an `assetId` string in the same namespace as the bundled
   `ASSET_MANIFEST` ids (ADR-030). It never stores a URL, bucket, key, or CloudFront host.
2. **Resolve on the client.** One function: `resolve(assetId) -> { url, kind, clips, version }`
   or "not available". Kinds used: `character` (player, NPC), `prop` (chest), `collectible`
   (reward model), `kit-piece` (scenery), plus a 2D image for the reward in the HUD and on the
   completion screen.
3. **Published only.** A child's session resolves published assets only; drafts and admin
   metadata are never readable by a parent token.
4. **Immutable versions.** A resolved URL never changes bytes; a new upload is a new version.
5. **Named clips.** The chest needs `Open` (it has one today). Characters need `Idle` and
   `Walk` if animated. A missing clip falls back to a static pose.
6. **Server-side existence check.** When an admin saves Treasure Rush content, Django checks that
   each `assetId` exists and has the right kind. Until LAI-2106 provides that check, it is made
   against `content/exported/assets.json`.
7. **Failure is not fatal.** A missing or failed asset shows a placeholder mesh of the declared
   size, and the interaction still works (TR-7a).
8. **Licences** are recorded per `docs/ASSET_LICENCES.md`, whichever system stores the file.

## 8. TR-1 as built

`lai/apps/education/challenges.py`, a pure module in the new, model-free `education` app
(the app the target architecture names for skills and objectives).

**Acceptance criteria, all met:**

1. Parameters (skill, value range, response mode, choice count) are checked against the skill's
   rule and the age band, and every broken rule is reported as a stable code.
2. Skills and their bands match `content/exported/curriculum.json`. A test fails on drift.
3. Sprouts get choices only (at most three, values to 5); Pathfinders and Explorers may type
   answers.
4. Generation is deterministic for a seed, and every generated challenge is well formed
   (sweep over every valid parameter combination).
5. Choices are distinct and ascending, include the answer, and the answer's position varies.
6. The client shape (`public_challenge`) never contains the answer.
7. Grading returns the TypeScript engine's `correct` or `incorrect`, and rejects malformed
   input (booleans, floats, strings, out of range, a choice that was not offered) as an error
   rather than a wrong answer.
8. No child-facing copy on the server: the client renders prompts from `operation` and
   `operands`.

**Tests:** `lai/apps/education/tests/test_challenges.py`, 35 tests. Two mutations (leak the
answer, accept booleans) were confirmed to fail them.

## 9. TR-2 as built

Four new apps (`islands`, `inventory`, `adventures`, `quests`) and two models in `education`.
Exported content keeps its ids as slug columns; nested structures the engines interpret (steps,
stages, prerequisites, dialogue conditions and choices, a region's bounds and environment) stay
JSON in the exported shape; what an administrator edits one at a time is a row (dialogue
lines, spawn points, placements, chests, challenge specs).

The TR-2 acceptance asked for a `LocationManifestSnapshot` holding a whole manifest as JSON.
That was replaced by rows (`WorldRegion`, `SpawnPoint`, `WorldObjectPlacement`,
`TreasureChest`), because the brief asks for chest locations, spawn points, and object placement
to be edited in admin, which a JSON blob does badly. TR-7 assembles the manifest from the rows
and validates it with `validateLocationManifest`; `WorldRegion.scene` holds the parts not yet
modelled (bounds, environment, copy).

**Acceptance criteria, all met:**

1. Catalog models for islands, locations, adventures, quests, items, collectible sets, reward
   rules, learning objectives, and NPCs with dialogue lines; no `assets` app (TR-D7).
2. `manage.py load_content` validates every file against `content/schema/content.schema.json`
   before writing; one invalid file loads nothing.
3. Idempotent: a second run creates nothing, and row counts equal the export.
4. Admin overlay (ADR-031): status is set only on create, so a retirement survives a reload;
   rows not in the export are never touched.
5. `ChallengeSpec` refuses every TR-1 error code, on `clean()` and on `save()`.
6. Chests: one challenge per age band, each checked to be for that band; at least one; unique
   world change key. Entity ids are unique per region across placements and chests. One
   default spawn per region (database constraint).
7. Asset references are ids checked by kind against the bundled manifest; URLs are rejected.
8. `manage.py seed_treasure_rush` creates the Treasure Cove starter content as DRAFT, once.

**Tests:** `core/tests/test_content_schema.py`, `core/tests/test_content_loader.py`,
`education/tests/test_challenge_spec.py`, `islands/tests/test_world_models.py` (56 new; 299 in
`pytest lai`).

**Next:** TR-4 (progress models, LAI-0305 subset) needs no decision. TR-3 needs TR-D5.
