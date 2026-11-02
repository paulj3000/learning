# Treasure Rush: Roadmap and Readiness

> **Integrated, 2026-10-24 (POST-MERGE-03, ADR-033).** Treasure Rush now runs on the canonical
> Django backbone, not its own. TR-2's catalog apps (`islands`, `adventures`, the loader) were
> replaced by `apps/catalog`, which absorbed its item, collectible-set, reward-rule,
> learning-objective and NPC models and its JSON-schema validator; TR-4's models were folded
> into the canonical progress apps; the play API (TR-5) and the React client (TR-6, TR-7) are
> unchanged in contract. Treasure Rush's quest, Golden Doubloon and reward rule are exported
> (`react/src/features/content-export/treasureRushContent.ts`) and imported like all content;
> the reward rule's trigger is `WORLD_CHANGE` on `TREASURE_RUSH_COVE_CHEST_OPENED`. The cove's
> spatial layout lives in `lai/apps/regions/treasure_rush_seed.py` (app `regions`) as the
> temporary source of truth: **TR-D3 is not adopted** and waits for LAI-0805. Sections below
> describe the branch as built; where they name `islands`, `QuestDefinition`, `load_content`
> from `core`, or `GrantedRewardRule`, read the canonical names in `docs/DATA_MODEL.md`.

**Status (2026-10-24):** TR-0 (this plan), TR-1 (server-side math challenges), TR-2 (catalog
models and loader), TR-4 (progress models and play services), TR-5 (the play API,
`docs/PLAY_API.md`), TR-6 (the typed React client and hooks), and TR-7 (Treasure Cove on the
existing Three.js engine), and TR-8 (the quest, challenge, and reward UI) are done on branch
`feature/treasure-rush-slice`, cut from `main` at `350e11b`. The whole slice is playable end
to end in unit tests: walk the cove, accept Pip's quest, open the chest with a number puzzle,
get the Golden Doubloon, finish the quest. Nobody has played it in a browser yet (TR-9). TR-D3 and TR-D7 are taken as authorised by the Treasure
Rush brief (admin-managed content; no second asset system); the other decisions in section 6
are still **Proposed**.

Treasure Rush is a short Three.js adventure. The child walks to a treasure chest, solves a math
challenge suited to their age band and skill, and the chest opens. A keepsake goes into the
backpack, the open chest stays open on later visits, and a quest-complete screen ends the
adventure. Administrators manage the content in Django admin.

**Update (2026-11-02):** the reboot's development tasks TR-12 to TR-20 are built on
`quest/tr.reboot` (sections 17 to 19); only art, two owner decisions and TR-9 remain. Nothing
has been played in a browser.

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

**TR-4 Progress models (is LAI-0305, the Treasure Rush subset first).** DONE (section 10). Depends: TR-2. Risk M.
Acceptance: `AdventureSession`, a `ChallengeAttempt` (session, spec, seed, correctness, no
child free text), `WorldChange` unique on `(child, location, change_key)`, `InventoryItem`, and
`QuestProgress`, with migrations and tenant-scoped managers.

**TR-5 Treasure Rush play API.** DONE (section 11). Depends: TR-4 (done), LAI-0403 (done). Risk H. Since TR-4,
the transactional work is in `apps/game_sessions/services.py`; TR-5 is the endpoints,
serializers, error envelope, and endpoint-level isolation tests over it, plus deciding when the
quest starts (on session start, or when Pip offers it). Acceptance: child-scoped
endpoints (`ChildScopedMixin`): start or resume a session; issue a challenge (the server picks
the seed and returns `public_challenge` only); submit an answer (`grade_answer`; on success, in
one transaction, record the chest WorldChange, grant the reward by rule id, and complete the
quest, all idempotent). The response is the completion summary. Tests: two-family isolation on
every endpoint, replayed success grants nothing twice, malformed answers return the safe error
envelope, the answer never appears in any response.

**TR-6 Frontend Django client for Treasure Rush (LAI-0501 slice).** DONE (section 12). Depends: TR-5 (done), TR-D8 (accepted). Contract: `docs/PLAY_API.md`.
Risk M. Acceptance: `react/src/api/` module behind `VITE_BACKEND`, typed DTOs, Cognito bearer
token, fallback copy on network failure. No other feature moves.

**TR-7a Placeholder-mesh asset adapter.** DONE (section 16). Depends: LAI-2106 settling (it edits the same
loader and engine files). Risk L. Acceptance: when a prop or NPC
model is missing or fails to load, the runtime shows a primitive mesh of the declared size and
the interaction still works; generic for every region; tests with a failing resolver. Must not
edit LAI-2106 files (check the LAI-2106 branch's file list first).

**TR-7 Treasure Rush region.** DONE (section 13). Depends: TR-6, TR-7a, TR-D2, TR-D4. Risk M. Acceptance: a
manifest loaded from the published snapshot through a `LocationManifestRepository`
implementation, validated by `validateLocationManifest`; chest prop with closed and open
states driven by the WorldChange; spawn from admin data; no slug branching
(`noLocationBranching.test.ts` stays green).

**TR-8 Challenge and quest-complete UI.** DONE (section 14). Depends: TR-7. Risk M. Acceptance: React challenge
card rendering `operation` and `operands` from localizable strings, choices as large buttons
for Sprouts, number entry for older bands, hint path, keyboard and HUD equivalents, a
quest-complete screen with the keepsake and a calm stopping point; loading, empty, error, and
fallback states.

**TR-9 End-to-end and playtest.** Depends: TR-8. Risk M. Acceptance: Playwright journey
(walk, open, answer, reward, revisit shows open chest); a human playtest note per age band.

**TR-10 Integrate LAI-2106.** DONE (section 16). Depends: LAI-2106 merged, TR-7a. Risk M. Acceptance: the adapter
resolves through the shared asset manager; content keeps its ids; placeholders remain the
failure path.

**TR-11 Second chest and quest chain.** Depends: TR-9. Risk L. Acceptance: quest prerequisites
exercised end to end with admin-authored content only, no code change.

## 5. First independently implementable task

TR-1 was chosen because it needs no decision, no model, and nothing from LAI-2106, and every
later backend task builds on it. It is the rule the user asked for in requirement 6
("correct answer validation on the backend") and the parameter set behind admin requirement C.

## 6. Decisions

These are recorded here rather than as numbered ADRs because LAI-2106 is being written on
another branch and may take the next ADR number (ADR registry rule 2). Each accepted one becomes
an ADR, numbered on the integration branch at merge.

**Owner approval, 2026-10-24 (TR-5 brief):** TR-D1, TR-D2, TR-D4, TR-D8, and TR-D11 are
**Accepted**. The same approval restates that the Django backend is authoritative for persistent
gameplay state; that is already ADR-019 and ADR-012's direction and is not a new decision.
TR-D3 and TR-D7 were taken as authorised by the original brief, and TR-D6, TR-D9, and TR-D10
were built as recorded; they stay as written until reviewed at merge. **TR-D5 is still
Proposed** and blocks TR-3 only.

- **TR-D1 (Accepted) The reward is a keepsake, not coins.** ADR-011 rules out a coin economy. Proposal: a
  "Golden Doubloon" `ItemDefinition` (category KEEPSAKE) granted once per chest by reward rule
  id, with no count, no spending, and no shop. A real coin balance would supersede ADR-011 and
  is a product decision.
- **TR-D2 (Accepted) Where Treasure Rush lives.** A new island location is a scope change (CLAUDE.md
  section 5). Proposal: a new region inside Pirate Builder Bay (`locationSlug:
  pirate-builder-bay`), which ADR-032 part D allows, so no new `IslandLocation` is needed.
- **TR-D3 Admin-authored content is authoritative for Treasure Rush.** ADR-031 makes the admin
  catalog an overlay on source content. Treasure Rush would be the first content whose steps,
  placement, and rules live only in PostgreSQL. This is the ADR-019 direction, but it is a
  change to ADR-031 and needs saying out loud.
- **TR-D4 (Accepted) Spawn and checkpoints as data.** ADR-032 part C keeps checkpoints in
  `discovery/checkpoints.ts`. Proposal: a published manifest snapshot may carry its own
  checkpoints, including spawn; source regions keep the current rule.
- **TR-D5 (Accepted 2026-10-25, option b; ADR-034) How administrators sign in to Django admin.** `ParentAccount` has no password and no
  staff flags by design. Options: (a) staff flags on `ParentAccount`, granted out of band,
  with a Cognito sign-in that creates a Django session; (b) a separate local staff login. (a)
  keeps one identity; (b) is faster but adds passwords. Owner decides (LAI-0404).
- **TR-D6 Parameterised challenges.** TR-1 generates challenges from parameters and a seed
  instead of authoring each correct value. The server stores parameters and seed per attempt,
  so any challenge can be reproduced, and never sends the answer. Built because the brief asks
  for it explicitly; recorded for acceptance.
- **TR-D7 LAI-0304 without the `assets` app.** The catalog task is split so its asset models
  are left to LAI-2106. Catalog rows store asset ids only.
- **TR-D8 (Accepted) One feature on Django before cutover.** Treasure Rush would be the first frontend
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

## 10. TR-4 as built

TR-4 is the Treasure Rush subset of LAI-0305. No Django progress models existed on any branch,
so the generic models were ported from the Amplify data model (docs/DATA_MODEL.md, "Django
mapping: progress subset") rather than written for Treasure Rush alone: Treasure Rush is their
first user, not their owner.

| Model or service | Purpose | Key constraints |
|---|---|---|
| `game_sessions.AdventureSession` | A play session: `ADVENTURE` (template) or `REGION` (Treasure Rush) | One open session per child and target (partial unique); kind matches target fields; `completed_at` iff COMPLETED |
| `game_sessions.ChallengeAttempt` | One generated challenge and its outcome | Snapshot immutable; answered attempt immutable; one ISSUED attempt per session and target; outcome fields match status; numbering unique |
| `progression.WorldChange` | The chest opened, and any quest world change | Unique (child, location, key); append-only |
| `inventory.InventoryItem` | An item a child owns | Unique (child, item); no quantity; item PROTECT |
| `inventory.GrantedRewardRule` | A reward rule that fired | Unique (child, rule); claimed before items are added |
| `quests.QuestProgress` | A started or finished quest | Unique (child, quest); `completed_at` iff COMPLETED |
| `education.SkillEvidence` | Practice evidence from each answered attempt | One per attempt (one-to-one) |
| `core.child_owned.ChildOwnedModel` | Same-child check on linked rows | Refuses a link to another child's session or attempt |
| `quests.engine` | Pure port of the client's `advanceQuest` | Credits only objectives the server can prove |
| `game_sessions.services` | Start or resume, issue challenge, submit answer, end session | Row locks; all chest effects in one transaction |

**The chest flow TR-5 calls:** `start_or_resume_region_session` -> `issue_chest_challenge`
(server seed, snapshot, the same attempt on a repeated request) -> `submit_chest_answer`
(locks the attempt, refuses replays, grades with TR-1 on the snapshot, records evidence, and if
correct records the world change, fires the reward rule, and refreshes active quests, all in
one transaction).

**Decisions taken (conservative, reversible):**

- **TR-D9 Sessions have a kind.** A `REGION` session carries a region id instead of a template
  slug. Treasure Rush is not an `AdventureTemplate` (it has no steps), and a separate session
  table would be the duplicate the brief warns against.
- **TR-D10 Skill evidence is written in TR-4's service, for every answered attempt** (correct
  and incorrect, as the client does for graded steps), with `support_level` = hint level. The
  skill id is the learning objective code. `SkillProgress` (derived mastery counters) is not
  ported: its counter semantics belong to the Mastery Engine port, and evidence is enough to
  derive it later.
- **TR-D11 (Accepted) Quests do not start themselves.** `submit_chest_answer` refreshes the child's active
  quests; starting one (`start_quest`, which checks status, age band, and prerequisites) is the
  play API's call, so an NPC offer stays meaningful.
- **Ownership is a set.** One row per child and item, as docs/DATA_MODEL.md "ChildInventory"
  requires. A stackable item would be a product change under ADR-011.
- **Content references.** Progress points at catalog rows that are PROTECT (retire, do not
  delete). Attempts also snapshot ids and parameters, and keep their chest and spec links as
  SET_NULL, so deleting a chest leaves history readable; answering such an attempt opens
  nothing and keeps nothing.
- **No admin registration.** Django admin is not installed (LAI-0404); TR-3 decides what, if
  anything, of child history is admin-readable, read-only.

**Acceptance criteria, all met:** child ownership on every model, with same-child links checked;
attempts snapshot what was shown and stay interpretable after the spec is edited or the chest
deleted; correctness only from `grade_answer`; replayed, repeated, and concurrent requests open
a chest, fire a rule, and start a session once; failure part way keeps nothing; two children
never see each other's state; child deletion removes only that child's progress.

**Tests:** 88 new; `pytest lai tests`: 390 passed. They include three real two-connection
races. Four mutations (no replay check, no child scoping, no transaction, no reward claim) were
each confirmed to fail a test. Unit tests only, per the development testing policy.

## 11. TR-5 as built

The play API: thin DRF views in `lai/apps/game_sessions/views.py` over the TR-4 services, with
read models in `play_state.py` and closed request bodies and camelCase responses in
`serializers.py`. The contract, with request and response examples, is `docs/PLAY_API.md`.

| Route (under `/api/v1/children/{childId}/`) | Service |
|---|---|
| `GET regions/{regionId}/` | `play_state.region_bootstrap` |
| `POST regions/{regionId}/session/` | `start_or_resume_region_session` |
| `GET sessions/{id}/`, `POST sessions/{id}/{pause,resume,complete,abandon}/` | `get_child_session`, `change_session_status` |
| `POST sessions/{id}/chests/{entityId}/challenge/` | `issue_chest_challenge` |
| `POST attempts/{id}/answer/` | `submit_chest_answer` |
| `POST quests/{questId}/accept/` | `quests.services.start_quest` |
| `GET progress/` | `play_state.child_progress` |

**Additions to earlier tasks, both additive:**

- TR-2: `WorldRegion.offered_quests` (migration `islands.0002`), the quests an NPC in the region
  offers. Pip's exported `quest_offers` could not carry it: `load_content` overwrites exported
  rows, so an admin edit there would be lost on reload. The seed links the Treasure Rush quest.
- TR-4: `change_session_status` and `get_child_session`, the lifecycle the API exposes, with
  the transition table in `SESSION_ACTIONS`. `end_session` is unchanged.

**Decisions (TR-D12, TR-D13; conservative, reversible):**

- **TR-D12 A replayed answer is `409 attempt_already_answered`**, not a repeat of the first
  response. Nothing is re-granted either way; the client re-reads state. Returning the stored
  outcome would need a stored response, which no other endpoint keeps.
- **TR-D13 Retired content mid-play.** A challenge issued before retirement can still be answered
  while its session is open (the child is not punished for an admin edit); nothing new starts
  in retired content. A deleted chest opens nothing.

**Acceptance criteria, all met:** every route authenticated and child-scoped (the existing route
checker enforces it); another family's or a sibling's records are `404`; no response contains an
answer, seed, URL, or admin field; client-supplied outcomes are refused; string, float, and
boolean answers are refused; correct and incorrect answers, replay, quest acceptance (never
automatic), progress, and every lifecycle transition are covered.

**Tests:** `game_sessions/tests/test_play_api.py`, 36 tests through HTTP with locally signed
tokens. Four mutations (closed bodies off, answer added to the challenge, session lookup not
scoped, lenient integer answer) each failed a test; the last one first survived and led to a
stronger test. Unit tests only, per the development testing policy.

## 12. TR-6 as built

The React side of the play API, with no UI and no Three.js. Contract and usage: the "Frontend
client" section of `docs/PLAY_API.md`.

| Module | Purpose |
|---|---|
| `react/src/api/config.ts` | `VITE_BACKEND=django` turns the Django API on; `VITE_DJANGO_API_BASE` (empty = same-origin; https only outside `vite dev`) |
| `react/src/api/auth.ts` | The Cognito **access** token from Amplify, asked for per request, never stored (ADR-024 A1) |
| `react/src/api/client.ts` | JSON transport: bearer header, one forced-refresh retry on 401, error envelope to `ApiError` |
| `react/src/api/errors.ts` | `ApiError` with `kind` (invalid_request, unauthenticated, forbidden, not_found, conflict, unavailable, server, network, invalid_response, aborted, disabled) and the server `code` |
| `react/src/api/parse.ts` | Runtime response checking (CLAUDE.md section 13), no dependency |
| `react/src/api/play/{types,parse,playApi}.ts` | DTOs field for field from the TR-5 serializers, their readers, and one function per route, scoped to a child |
| `react/src/features/region-play/regionPlayState.ts` | Pure reducer: server-only truth, stale-reply rejection by scope, rewards shown once |
| `react/src/features/region-play/useRegionPlay.ts` | Load, start or resume, lifecycle, accept quest, request challenge, submit answer, refresh |
| `react/src/features/region-play/usePlayerProgress.ts` | `GET progress/` for the selected child |
| `react/src/features/region-play/sceneModel.ts` | The TR-7 boundary: bootstrap to plain entities by id, no Three.js |

**Rules the code enforces (each with a test, four confirmed by mutation):** a reply for a child or
region the screen has moved away from is dropped, and the request is aborted; a double-tapped
answer is sent once; a replayed answer (409) adds no reward and triggers a re-read; rewards,
chest state, and quest state only ever come from server responses; the answer body carries only
`answer`, `hintLevel`, `durationMs`; a 401 is retried once with a refreshed token, a second
401 calls `onUnauthenticated`, and a 503 never does.

**Decisions TR-7 needs (not taken here):**

- **TR-D14 (Accepted 2026-10-24) Dev routing to Django.** Django has no CORS by design, so `vite dev` needs a
  `server.proxy` for `/api` to the local Django, or `VITE_DJANGO_API_BASE` with a dev-only
  CORS allowance. Recommendation: the proxy (no backend change). Touches `react/vite.config.ts`.
- **TR-D15 (Accepted 2026-10-24) How the region reaches the runtime.** Recommendation: a `LocationManifestRepository`
  implementation that builds the manifest from `toRegionSceneModel` and validates it with
  `validateLocationManifest`, under the existing `/island/:childId/explore/:regionId` route, so
  `noLocationBranching.test.ts` stays green. Needs a check of which runtime files LAI-2106 owns.
- **Wiring:** `onUnauthenticated` to `AuthContext.refresh()`, so `RequireParent` sends the
  parent to sign in as elsewhere.

**Tests:** 65 Vitest unit tests in `react/src/api/` and `react/src/features/region-play/`.

## 13. TR-7 as built

Treasure Cove runs on the existing engine (`createLocationEngine`, `ThreeLocationWorldView`,
the one `/island/:childId/explore/:regionId` route). No renderer, route, view, or runtime file
was added or changed; the region arrives through the two seams the engine already has, a
manifest repository and a registered extension.

**How a visit works**

```text
/island/:childId/explore/treasure-rush-cove
  -> LocationWorldPage: regionRepositoryForChild(childId)       (VITE_BACKEND=django only)
  -> ThreeLocationWorldView -> repository.getPublished(regionId)
       source region?  -> the source manifest, unchanged
       otherwise       -> GET regions/{regionId}/ -> toRegionSceneModel -> buildRegionManifest
                          -> publishRegionCheckpoints (Django spawn into the World State catalogue)
                          -> validateLocationManifest (same registries as every source manifest)
  -> createLocationEngine: spawns at the Django spawn point, places Pip, chest, scenery
       region-play scene half: draws the chest open or closed from the child's server state
  -> region-play Companion (useRegionPlay): starts or resumes the session, never accepts a quest,
       keeps chests matching the server, turns Pip and chest interactions into events for TR-8
```

| File | Purpose |
|---|---|
| `features/region-play/regionManifest.ts` | Pure builder: scene model to `ThreeLocationManifest` plus the region's checkpoints |
| `features/region-play/regionManifestRepository.ts` | `LocationManifestRepository` for one child: source regions unchanged, others from Django, validated |
| `features/region-play/regionRepositoryForChild.ts` | The page's repository: the source one when Django is off |
| `features/region-play/regionPlayConfig.ts` | Parser for the extension binding's config |
| `features/region-play/regionPlayInteractions.ts` | Pure: interaction id to a TR-8 event (`npc` with quests, `chest` with state), chest diffs |
| `island-map/three/extensions/regionPlay/regionPlayScene.ts` | Scene half: chests (catalogue model and `Open` clip, or a built chest), placeholder figures |
| `island-map/three/extensions/regionPlay/RegionPlayCompanion.tsx` | View half: session start, chest sync, events, the TR-7 notice TR-8 replaces |
| `discovery/checkpoints.ts` | `publishRegionCheckpoints` / `unpublishRegionCheckpoints` (engine gap 2, for published regions) |
| `api/devProxy.ts`, `react/vite.config.ts` | TR-D14: `/api` to a loopback Django in `vite dev` only |
| `routes/LocationWorldPage.tsx` | Uses `regionRepositoryForChild` |
| `extensions/index.ts` | Registers `region-play` |

**Asset handling (existing contract only).** NPC with a catalogue model: a real NPC placement.
NPC without: a prop the extension fills with a placeholder figure. Chest: always extension-drawn;
the catalogue model (`treasure-chest`) held on its `Open` clip when open, or a built chest
(box, hinged lid, gold inside) when there is no model, it fails to load, or it has no open clip.
Object: `MODEL` scenery with a model, `BOX` scenery of the admin's placeholder size without.
Ground: the bundled `ground-tile` unless `scene.groundAssetId` names another. The seed now
gives Pip's placement `npc-pip`.

**Decisions taken (TR-D16 to TR-D18, conservative and reversible):**

- **TR-D16 Published checkpoints join the World State catalogue at runtime.** The engine reads
  spawn and checkpoint triggers from `discovery/checkpoints.ts` and `createLocationEngine`
  is LAI-2106's, so the Django spawn is published into that catalogue (namespaced
  `{regionId}:{checkpointId}`). It can never move a source region. Published checkpoints are not
  saved to Amplify (`KNOWN_CHECKPOINT_IDS` stays source-only), so a child re-enters at the
  spawn; saving a position server-side is later work.
- **TR-D17 Published objects are scenery in TR-7.** Django has no interaction vocabulary for
  them yet; only NPCs and chests are interactive.
- **TR-D18 The region is read twice per visit** (once by the repository to build the scene,
  once by the companion for live state). Simple and always fresh; a shared read is an
  optimisation for later.

**Not done here:** the conversation, quest acceptance UI, and challenge card (TR-8); a person
playing it (TR-9); the shared asset manager (TR-10). The Amplify reads the generic view makes
(world state, inventory, companion) still run and are harmless here; they show nothing for a
Django region.

**Tests:** 65 new Vitest unit tests (published checkpoints 7, builder 11, repository 10,
interactions 5, engine 11, companion and registration 11, generic view 6, dev proxy 4),
including Treasure Cove on the real runtime through `engineHarness.ts`.

## 14. TR-8 as built

The game UI, replacing TR-7's notice inside the `region-play` companion. No engine, runtime,
asset-loader, or LAI-2106 file changed; everything is in the extension and `features/region-play/`.

| Piece | File | What it does |
|---|---|---|
| Rules | `features/region-play/regionPlayUi.ts` | Copy, coin pictures from `operation`/`operands`, number-free strategy hints, typed-answer parsing, "celebrate once" rule, error to child-facing message, control keys |
| Dialog shell | `extensions/regionPlay/ui/GameDialog.tsx` | Focus to heading on open and back on close, Escape closes, no focus trap, movement and interact keys kept from the controls |
| Pip | `ui/PipDialog.tsx` | Name, the server's quest summary as Pip's offer, "Yes, I will help!" (disabled while sending), the quest's steps ticked from server state, thanks when complete |
| Chest | `ui/ChestChallengePanel.tsx` | The server's challenge as coins and a question; big choice buttons or a number field; "Help me" hints; "Checking..." with inputs disabled; encouraging wrong-answer feedback and "Try again" (a new attempt from the server) |
| Reward | `ui/RewardReveal.tsx` | "Click! The chest is open!", a popping, spinning doubloon (no animation when the device asks for reduced motion), the item and reward message, "Quest complete!" from the server's update |
| Backpack | `ui/BackpackPanel.tsx` | Items and quests from `GET progress/` (TR-6), coin and tick icons with words; a corner button with an item count |
| Styles | `ui/RegionPlayPanels.module.css` | Island tokens: paper panel, lip buttons, sun and lime for celebration only |
| World | `extensions/regionPlay/regionPlayScene.ts` | A chest opened mid-visit now swings its lid open over 0.7 s with gold sparkles rising (the model chest plays its `Open` clip); a chest already open on entry is drawn open without animating |

**Flow.** Interacting with Pip opens the dialogue; the child accepts or not. Interacting with a
closed chest (in a session, with a challenge for the child's band) asks the server for the
challenge once per opening; an outstanding one comes back the same. The answer goes to
`submitAnswer`; the panel never knows the right answer. Wrong: encouragement and "Try again".
Right: the hook re-reads the region, the companion sees the chest open on the server and tells the
scene (the lid swings, sparkles rise), the reward reveal opens, and progress is re-read so the
backpack count updates. Closing returns to exploring.

**Server-authoritative rules, each tested and five confirmed by mutation:** no reward, open chest,
or quest change before the server confirms; the reveal shows once per attempt, only for an attempt
submitted in this visit, so a replay (409) or a later visit never celebrates again; a double tap
sends one accept or one answer; the chest in the world changes only from server state; quest
completion is the server's `questUpdates` and quest status; switching child remounts the game
(`key`), dropping everything.

**Decisions (TR-D19 to TR-D21):**

- **TR-D19 No audio in TR-8.** There is no Polly or speech system in the app to reuse (Polly is a
  pending provider decision, `npc/content/islandNpcs.ts`), and no mute or volume setting. All
  copy is plain text written to be read aloud, the coin picture has a spoken text alternative, and
  nothing plays sound. Voice is a later task once the provider is chosen.
- **TR-D20 Pip's lines come from the quest.** The play API does not serve NPC dialogue nodes, so
  Pip's offer is the server's quest summary plus fixed, localizable lines per quest state. Serving
  the Django dialogue nodes is a later API addition.
- **TR-D21 Movement is held, not paused.** The engine has no pause hook for extensions; the view
  already releases pointer lock on a claimed interaction, and the panels stop the controls' keys
  (WASD, arrows, space, E, Enter) from reaching the window. Touch movement is unaffected while a
  panel is open; a panel covers the lower part of the stage only.

**Tests:** 40 new Vitest unit tests (UI rules 21, companion flow 17 more, chest animation 2); 68 across the four TR-8 test files; 1,503 passing across every affected area. Unit tests only.

## 15. TR-8a: making it runnable (after "TR-9 is not ready")

TR-6 to TR-8 were tested against a faked API, which hid that a real playthrough fails: the
child in `/island/:childId` is an Amplify id with no Django `ChildProfile`, the parent is never
set up in Django, the content is DRAFT, and there was no run recipe. The owner chose the real
child-profile migration (LAI-0501, LAI-0502, LAI-0602, on a separate branch) for the first gap
and these fixes for the rest:

- **Automatic account setup.** The API client (`provisionAccount`, on for the play API) answers a
  `403 account_not_provisioned` with the explicit onboarding call, `POST /api/v1/me/`, then retries
  once; concurrent requests share one call. A failed setup is `forbidden` / `account_setup_failed`.
- **Correct 403 messages.** A signed-in parent is never told to sign in again: account setup gets
  "We are still getting your island ready", any other 403 "not open for you right now".
- **`publish_treasure_rush`** (dev only): refused unless `DEBUG` and a loopback database; checks
  every row with `full_clean()` and that the region is playable; all or nothing; never touches
  exported content. After POST-MERGE-03 it publishes the region and its challenge specs only
  (the rows with a `ContentStatus`) and requires the catalog location, world, and offered quests
  to be `active` already (`lai/apps/regions/treasure_rush_publish.py`).
- **`docs/TREASURE_RUSH_LOCAL_DEV.md`**: the startup procedure, including an interim, local-only
  step that mirrors one test child into Django with the same id until LAI-0602.

**Tests:** 6 client provisioning tests, 1 message test, 8 publish tests; two mutations on the
publish safety rules (no DEBUG gate, no validation) each failed a test.

## 16. TR-7a and TR-10 as built (2026-10-30)

**TR-7a.** Generic, in `createLocationEngine.ts`: a model that cannot be resolved or loaded leaves
a primitive box instead of nothing. NPCs keep their stand-in, now sized by `placeholderSize`;
props, collectibles and `MODEL` scenery get a `missing-model:<asset id>` box (loud pink,
`placeholderSize` or 0.6 m); a failed `TILED_GROUND` becomes one plain plane. Focus, labels and
interaction belong to the entity root, so a stand-in can still be found and used. Every failure
is logged by the runtime's existing `track` warning; the region-play chest keeps its built chest
and now logs why instead of swallowing the error. `buildRegionManifest` passes the admin's
placeholder size (`placeholder_width/height/depth` times scale); a non-positive size uses the
default instead of failing validation. Tests: `missingModelPlaceholders.engine.test.ts`.

**TR-10.** `features/region-play/regionAssets.ts` (`regionAssetsFor`) gives a region served by
the play API `createAssetLoader(djangoAssetResolverFor(childId))`, built once per visit by
`LocationWorldPage` and passed to `ThreeLocationWorldView` as `assets`. Source regions and builds
without `VITE_BACKEND=django` keep the bundled loader. Content keeps its ids (`npc-pip`,
`treasure-chest`, `ground-tile`); unpublished ids use the bundled files; ids neither knows draw
the TR-7a placeholder. The resolver now reports why an id fell back, so an auth or scope
failure is never mistaken for "not published". Tests: `regionAssets.test.ts` (the real cove
manifest on the engine with the Django resolver and shared loader; only HTTP and the GLTF fetch
are fakes) and `lai/apps/assets/tests/test_treasure_rush_assets.py` (import, publish, replace,
make default, cache headers, scoping). Operations, deployment and rollback:
`docs/ASSET_MANAGER.md` sections 15 and 19.

Not done: any browser or WebGL run (owner, after deployment), and TR-9. A deployed environment
still needs TR-3's region admin to publish the cove and LAI-0502/0602 for real children
(`docs/ASSET_MANAGER.md` 19.3, steps 5 and 9).

## 17. Gameplay reboot: Pip's Missing Treasure (2026-10-31)

The owner's reboot brief ("Treasure Rush Gameplay Reboot") turns the one-chest slice into a
10 to 15 minute adventure for ages 6 to 10: four different treasure encounters across four zones,
Pip as a real quest giver, and a bridge that opens for good at the end. It is a gameplay reboot,
not a rewrite: Django stays authoritative for quests, challenges, rewards, inventory, world
changes and unlocks (ADR-019, ADR-033); Three.js presents (ADR-020); no Phaser, no new engine.
The brief as received stops partway through section 7 ("Replayability"); anything after that
is not yet known and is not planned here.

The brief makes **Stage A (controls and interaction)** the first priority. It is TR-12, below.

### TR-12 as built: child-friendly interaction and guidance

| Brief item | What was built | Where |
|---|---|---|
| Forgiving targeting, no precise crosshair | When the centre ray misses, the nearest interactable within 3 m and 40 degrees of straight ahead (measured on the ground, so looking up or down does not matter) takes focus. Aiming at something still wins | `createLocationEngine.ts` (`nearestAhead`, `ASSIST_*`) |
| Context-sensitive prompt; disappears out of range | The focus label becomes one large button naming the action and the thing ("Open: Treasure chest", "Talk: Pirate Pip"). It shows only while something has focus | `WorldHud.tsx`, `manifestBindings.ts` (`focusPrompt`) |
| Keyboard, mouse, touch | The button works by tap or click; E and Enter still work. The E key cap shows only with a fine pointer, so a tablet or the Android WebView never shows a key it does not have | `WorldHud.tsx` (`hasFinePointer`) |
| Object highlighting | A gold marker bobs over whatever has focus (one mesh, one draw call) | `createLocationEngine.ts` (`FOCUS_MARKER_NAME`) |
| Recognisable interactables | A gold star turns and bobs over every closed chest and goes when the server opens it | `regionPlayScene.ts` (`BEACON_NAME`) |
| Objective display | The HUD cue shows the server's quest state: "Talk to Pirate Pip to start an adventure", then "Treasure Rush: 0 of 1", then "all done!" | `regionPlayUi.ts` (`questObjective`, `objectiveCue`), `RegionPlayCompanion.tsx` |
| Hint system that does not interrupt | A Hint button; the hint names the next step from server state (find the giver, find a star, go back to the giver) and only appears when asked | `regionPlayUi.ts` (`nextStepHint`) |
| Exit without arithmetic, progress kept | Already true: LAI-0807 added the ungated "Leave island" link, and the region's own exit is a plain link. Progress is server-side, so leaving loses nothing | `IslandLayout.tsx` (LAI-0807) |

All of it is behind one manifest flag, `interactionAssist`, which `buildRegionManifest` turns on
for every server-published region. Source regions keep their exact behaviour, so their parity
tests ("Pip: press E to talk") are untouched. Turning it on for other regions is a one-line
change each, worth doing once a person has played it in the cove.

**Contract changes.** `ThreeLocationManifest.interactionAssist`; optional `action` (the prompt
verb) on NPC, prop and collectible specs; optional `setQuestCue` on companion props. All
optional, all additive.

**Not verified in a browser.** No person has played this yet (TR-9). The forgiving-aim numbers
(3 m, 40 degrees) are a first guess to tune in that playtest.

### TR-13 as built: the four-zone Treasure Cove (2026-11-01)

The cove grows from an 18 m square with three objects to a 72 x 88 m island in four zones,
joined by paths and a loop, with everything TR-14 to TR-17 need already framed.

| Zone | What is there | Encounter spot it frames |
|---|---|---|
| **Pirate Landing** (centre) | The dock you arrive on and the rowboat at its end, Pip's camp (tent, campfire with seats and a warm light), crate and barrel stacks, a black pirate flag, six torches, waymarker signposts at each exit | The first chest (seeded, 0, -6), in sight of the spawn point |
| **Palm Tree Grove** (west) | 19 palms, a tree line, a jungle scattered beyond the edge, bushes, ferns, boulders, fallen logs; a trail of flowers off the grove path, butterflies circling its end | Hidden chest (-30, 20): a ring of bushes open to the south-east, boulders screening it from the path |
| **Shipwreck Beach** (east) | Sand and shallows, the wreck at 1.5 times its size and listing, washed-up crates, barrels on their side, drift planks, rope, a broken pier, rocks, seven palms, gulls circling | Locked chest (21, 22) among the cargo by the bow; key (31, 0) on an X of crossed planks in the sand |
| **Ancient Treasure Ruins** (south) | Stone floor, broken walls of varied height, the archway in, a ring of eight pillars (some broken), three rune stones, the glowing pedestal with a light, torches, a dais; a locked gate in the south wall | Pedestal (0, -26) for TR-16's puzzle; final chest (0, -32) on the dais |
| **Lookout Point** (beyond) | Across a channel, past the gate and a sunken bridge: a tall gold flag and two palms, visible from the ruins and unreachable | TR-17's unlock destination |

**How it is carried.** The layout is `WorldRegion.scene["layout"]` in the manifest's own
vocabulary (decision **TR-D24**, below), authored in `lai/apps/regions/treasure_cove_layout.py`
and written by the seed. The builder (`regionLayout.ts`, `regionManifest.ts`) turns it into
scenery, colliders, zones, ambient movers and lights, so the cove uses what the engine already
draws and collides with. Models the catalogue lacks are `procedural` entries the region-play
extension draws from primitives (`proceduralScenery.ts`): palms are instanced (three draw calls
for 28), the rest share geometry and materials. The asset audit and replacement list is
`docs/TREASURE_RUSH_ASSET_REQUIREMENTS.md`.

**Upgrading an existing region.** The seed still never overwrites a row, with one exception it
owns: when `scene.layoutVersion` is older than `LAYOUT_VERSION`, it replaces the layout and
bounds, bumps the region's version, and turns the landing spawn to face inland if it still has
the old default facing. Title, copy, placements, chests and status are untouched. Pip, the first
chest and the signpost keep their seeded positions; the landing was laid out round them.

**Environment animation.** Palms sway, flames flicker, flags wave, the rowboat bobs, the
pedestal's gem pulses and turns, gulls and butterflies circle; all of it holds still when the
device asks for reduced motion (TR-12's beacons now do too).

**Full-screen controls.** TR-12's note that Backpack and Hint vanish in full screen was wrong on
inspection: the element that goes full screen is the view's wrapper, and those fixed buttons
were its children. The real gaps were that the region's exit link is hidden in full screen and
the cove showed two backpacks (the HUD's Amplify one, always empty there, and region-play's).
Fixed: companions get a control slot inside the stage (`hudSlot`), where region-play now puts
Backpack, Hint and the hint bubble; the HUD draws the exit on the stage under
`interactionAssist`; and the HUD leaves its backpack out when a companion owns one
(`ownsBackpack`). Objective, prompt, Backpack, Hint and Exit are all on the stage now.

**Decision taken (conservative, reversible):**

- **TR-D24 The cove's layout travels as `scene.layout`, in manifest vocabulary.** The model
  already documents `scene` as holding what is not yet modelled as rows, in the manifest's own
  field names. No new model, no admin UI, nothing LAI-0805 has to undo: when it decides how
  layouts are authored, this JSON is what it migrates. The client reader is strict and names
  the path of anything malformed, and the assembled manifest still goes through
  `validateLocationManifest`.

**Not verified in a browser.** The engine tests walk the cove (zones announce themselves, the
archway lets you in, the gate and channel hold) but nobody has looked at it. In particular the
sizes, colours and the draw-call count on a tablet need a real look (TR-9). The bootstrap grows
by about 40 KB of layout JSON.

### TR-14 as built: Pip's Missing Treasure (2026-11-01)

The cove becomes a complete adventure: Pip's quest, four encounters that each play differently,
a key, a rune-stone puzzle and a finale, all decided by Django.

**The sequence a child plays.**

1. **Pirate Landing.** Pip offers "Pip's Missing Treasure" (accepting is the child's choice).
   The landing chest (seeded since TR-7) opens with the existing challenge; Golden Doubloon.
   HUD: "Find Pip's treasures: 1 of 4". Pip's clue now points at the grove.
2. **Palm Tree Grove.** The hidden chest is not drawn until the landing chest is open, then
   appears in the ring of bushes at the end of the flower trail, with a beacon. Its own
   challenge (a different skill per band from the landing chest); Palm Grove Pearl. 2 of 4.
3. **Shipwreck Beach.** The locked chest says it needs a key and gives Pip's clue (the X in the
   sand). The Old Brass Key floats over the X at (31, 0); picking it up goes through the server
   and lands in the backpack. With it, the chest's challenge; Shipwreck Compass. 3 of 4.
4. **Ancient Treasure Ruins.** Reading the glowing pedestal issues a three-choice challenge;
   its numbers appear on the three rune stones and the child walks to one and touches it (the
   panel's buttons are an accessible alternative). Django grades the touched stone's number. A
   wrong stone says so and brings new numbers; the right one unlocks the golden chest, whose
   own challenge gives the Sunstone. 4 of 4; the HUD turns to "Bring the treasure back to Pip".
5. **Finale.** Talking to Pip completes the quest on the server: it records
   `TREASURE_COVE_QUEST_COMPLETE` (TR-17's signal), grants the Treasure Cove Explorer Badge,
   and the finale shows Pip's thanks and the badge.

Progress is server state throughout: leaving and coming back keeps every opened chest, the key
and the quest stage; nothing is granted twice.

**How it is built.**

- **Content.** Items, reward rules and the quest are export content
  (`treasureRushContent.ts`), loaded with `load_content`. Chests, challenge specs (15 new), the
  key and rune stones are seed rows (`lai/apps/regions/pips_treasure_seed.py`), created only if
  absent; an existing region switches its offered quest from the one-chest quest to Pip's once,
  by `scene["adventureVersion"]`. The one-chest quest stays in the catalog, so a child's
  progress on it is kept. Layout v3 turns the rune stones into placements.
- **Model (migration `regions.0003`).** `TreasureChest`: `presentation`, `sort_order`,
  `required_world_change_key`, `required_item`, `answer_entity_ids`, `clue`.
  `WorldObjectPlacement`: `pickup_change_key`, `pickup_reward_rule`. Admin validation refuses a
  puzzle whose challenges are not CHOICE with one choice per answer object, answer objects not
  placed in the region, answer objects on a non-puzzle, a chest requiring itself, and a pickup
  on anything but a collectible.
- **Rules (`apps/game_sessions/play.py`).** `chest_lock` (progress first, then the item);
  `issue_chest_challenge` refuses a locked chest (`409 chest_locked`); `collect_pickup`;
  `talk_to_npc`; every path that can finish a quest fires its `QUEST_COMPLETED` reward rules.
  The quest engine now proves `TALK_TO` from `NpcRelationship.memory_flags`. Accepting a quest
  walks it forward at once.
- **API.** Two routes and additive fields (`docs/PLAY_API.md`, "Pip's Missing Treasure").
- **Client.** The builder draws the key and rune stones as claimed props and leaves a collected
  key out; the scene hides a hidden chest until it may be found, beacons only what the child
  may do next, draws the key, and puts the puzzle's numbers on the stones; the companion talks
  to the server on every visit to Pip, picks up through the API, says why a chest is locked,
  and answers the puzzle with the stone touched. The HUD cue follows the quest's current stage,
  and the hint is the server's clue for the next encounter.

**Decisions taken (TR-14 brief):**

- **TR-D22 (taken) The key is a pickup.** A collectible placement with a pickup world change
  and a reward rule; the route records the change and fires the rule, so the key is ordinary
  inventory and the lock checks ownership. Reusable for any found object.
- **TR-D23 (taken) Puzzles are graded by Django.** A puzzle is a chest row with `PUZZLE`
  presentation whose CHOICE challenge is answered by touching objects; the engine shows numbers
  and reports touches, never grades.
- **TR-D25 TALK_TO is provable on the server** from `NpcRelationship.memory_flags`, set only
  for an objective of an active quest's current stage. No schema change.

**Native API.** The region list's chest counts leave puzzles out (the cove reports 4).

### Reboot task status (updated 2026-11-02)

Development completion is kept apart from acceptance. "Unit/API verified" means the Django,
Vitest and typecheck results recorded in section 20; **no browser has been used**. Every task
below that touches what a child sees is **pending browser acceptance and owner playtesting**
(TR-9). Nothing here is accepted.

| Task | Development | Unit/API verified | Still pending |
|---|---|---|---|
| TR-12 Child-friendly interaction | Complete | Yes | Browser acceptance, owner playtest, tuning of the aim numbers |
| TR-13 Four-zone cove | Complete | Yes | Browser acceptance (sizes, colours, tablet draw calls) |
| TR-14 Four chests, "Pip's Missing Treasure" | Complete | Yes | Browser acceptance, owner playtest |
| TR-15 Locked chest and key | Complete (section 19) | Yes | A finished `treasure-key` model (art); browser acceptance |
| TR-16 Ruins puzzle | Complete for the "touch the answer" puzzle; stone animation done (section 19) | Yes | Ordering and matching puzzle kinds (decision TR-D27, proposed); a finished pedestal model (art); sound (TR-19) |
| TR-17 Completion and the bridge | Complete (section 18) | Yes | Finished bridge and gate models (art); browser acceptance |
| TR-18 A living cove | Complete with the existing Pip clips (section 19) | Yes | Pip `Cheer` and `Point` clips (art); browser acceptance of the look |
| TR-19 Sound | Cue hook only (section 19) | Yes | **Blocked on owner decision TR-D26**: the player, the mute control and where the setting lives |
| TR-20 Replay | Complete (section 18) | Yes | Browser acceptance |
| TR-11 Second chest and quest chain | Superseded by TR-14 in substance (section 19, "TR-11 evidence") | n/a | **Owner confirmation** that it is closed |
| TR-9 End-to-end and playtest | **Not started, by owner instruction** | n/a | Everything: a browser journey, a playtest note per age band |

### Assets to replace with finished artwork

| Placeholder | Used for | Wanted |
|---|---|---|
| Gold cone (`interaction-assist:focus-marker`) | Focus marker | A small animated arrow or sparkle sprite |
| Gold octahedron (`region-play:beacon:*`) | Closed-chest beacon | A glowing star or shimmer effect |
| Built box chest (TR-8) | Any chest without a model | `treasure-chest` with an `Open` clip (exists; variants for hidden, locked and final chests) |
| Green cylinder figure | An NPC without a model | An animated Pip with Idle, Talk, Cheer clips |

## 18. TR-17 and TR-20 as built: the bridge, Lookout Point and the replay (2026-11-02)

**What the child meets.** Talking to Pip after the fourth treasure completes the quest. Django
records `TREASURE_COVE_QUEST_COMPLETE`; the cove answers on the same visit: the gate's bars rise,
the sinking planks go, a lamplit bridge is laid across the channel, and a toast says so. A child
who comes back later finds the bridge already there (the cove is built open from the world
changes in the region read). Across it is **Lookout Point**: a sand and stone plaza under the gold
flag, two palms, lanterns, and a spyglass. Looking through the spyglass asks a fresh counting
question each time; a right answer gets a kind note and "Play again", never a chest or a
reward.

**Who decides what.**

| Question | Decided by |
|---|---|
| Has the child earned the way across? | Django: `TREASURE_COVE_QUEST_COMPLETE` is a world change recorded by the quest's completion rewards |
| May the child use the spyglass? | Django: `chest_lock` refuses (`409 chest_locked`) until that world change exists. Walking over the bridge is not checked; the lock is on the thing beyond it |
| Is an answer right? | Django (`grade_answer`), as for every chest |
| Did a replay pay out? | Django: `submit_chest_answer` returns before any world change, reward or quest step for a `REPLAY` chest |
| What the cove looks like | The client, from the world changes in the region read (`unlock.unlocked`) or told live (`setUnlocked`) |

**Movement and safety.** The channel's collider is three rectangles (`cove-channel-west`, `-gap`,
`-east`). The gate and the gap are the only ones opened (`layout.unlock.openColliders`); the sides
stay, so the bridge (3.2 m wide, exactly the gap) is the only way across and nobody can step off it
into the water. The deck runs from the gate's threshold to the far bank, so the walkable gap is
always bridged. Lookout Point lies inside the island bounds, clear of every collider, and the
bridge can be crossed both ways. `lookoutPoint.engine.test.ts` walks all of this on the real
collision code: gate and water hold when closed; open live; open on a later visit; back across;
off the sides; into the sea beyond.

**How it is built.**

- **Layout v4** (`treasure_cove_layout.py`): `UNLOCK` (what opens), the new `BROKEN_PLANKS`,
  `BRIDGE`, `LANTERNS` and `SPYGLASS` procedural shapes, Lookout sand and plaza, and `AMBIENCE`
  (section 19). The seed upgrades an existing region's layout once (`layoutVersion`).
- **Model (migration `regions.0004`).** `ChestPresentation.REPLAY`. `TreasureChest.clean()`
  refuses a replay with a reward rule or without the encounter it follows
  (`required_world_change_key`).
- **Rules (`apps/game_sessions/play.py`).** A replay is never "open"; it issues a new attempt each
  time, grades it, records skill evidence, and returns `chestOpened: false` with no items. Even a
  reward rule added later by bypassing `clean()` grants nothing, tested.
- **Seed (`pips_treasure_seed.py`).** `cove-lookout-spyglass` (sort order 5), locked behind the
  quest, with a counting challenge for each age band. Created only if absent.
- **Counts.** A replay is not a chest anyone counts: the region list, the native API and the
  quest keep reporting four.
- **Client.** `RegionPlaySceneApi.setUnlocked`; the companion calls it when the region read's
  world changes include the key for this location, and shows `ReplayDonePanel` for a right
  answer at a `REPLAY` chest. The hint after the quest points across the bridge.

**Decisions taken (conservative, reversible):**

- **TR-D26 and TR-D27 are in section 19.** Neither is needed for this work.
- **TR-D28 (taken) The Lookout is gated by a lock, not by a wall of rules.** Whether the child
  may walk to Lookout Point is the world's geometry (the bridge is laid or not); whether they may
  do anything there is Django's lock. A client that lays the bridge early gets a nice view and
  a `409`.
- **TR-D29 (taken) A replay records skill evidence.** It is practice on skills the cove already
  teaches. It writes no world change, item, achievement or quest progress.

## 19. TR-15, TR-16, TR-18, TR-19 and TR-11 (2026-11-02)

**TR-15, the locked chest and its key.** The contract shipped in TR-14 (TR-D22). Added here:

- **Pickups are not the cove's alone.** `collect_pickup` and its route take any collectible
  placement with a `pickup_change_key` in any region; a test proves it in a second region, that
  its world change is recorded against that region's Place, and that another region's session
  cannot reach it.
- **The admin sees counts, not children.** The 3D Area page lists every pickup and chest with how
  many children have reached it (`apps/regions/activity.py`). No child identifier, name or profile
  appears (CLAUDE.md sections 2 and 13). A replay shows "repeatable, records nothing".
- **Not done: a finished `treasure-key` model.** It is an art asset (see
  `TREASURE_RUSH_ASSET_REQUIREMENTS.md`). The built key remains the fallback by design.

**TR-16, the ruins puzzle.**

- Rune stones sink under the child's touch (0.18 m, half a second) and every stone flashes green
  for the server's "right" or orange for "try again". Presentation only: Django grades.
  `prefers-reduced-motion` skips the dip; the toast still says what happened.
- **Not done: ordering and matching puzzle kinds.** They are a new challenge kind (TR-1 knows
  `CHOICE` and `NUMBER_INPUT`), a grading rule, and a design the owner has not given.
  **TR-D27 (Proposed)**: do them only if playtest says "touch the answer" is too thin. Nothing
  in the shipped cove needs them.
- **Not done: the finished pedestal model** (art). Sound for the stones is TR-19.

**TR-18, a living cove.**

- **Water** (`cove-channel`, `cove-north-shallows`, `cove-east-shallows`) shimmers: each mesh gets
  its own clone of the material and the colour drifts a few percent lighter and darker. Shared
  materials are never touched.
- **Fireflies**: three clouds (grove, ruins, Lookout Point), 68 lights in a single `Points` draw
  call, each on its own path, capped at 200 per cloud so a typo cannot reach the GPU.
- **Pip reacts** with the clips `npc-pip` has: `Talk` when the child talks to him and `Wave` to
  cheer a find, a pickup, a replay win or the finale. A figure drawn without a model hops
  instead. No `Cheer` or `Point` clips exist (art), so `Wave` stands in.
- Palms, flames, flags, the boat, the gem and the new lanterns already moved (TR-13). **All of
  it holds still under reduced motion.**

**TR-19, sound. Blocked on an owner decision.** No audio exists in the app (TR-D19), and the
repository has no volume or mute setting to reuse. Where that setting lives is a product
decision with privacy and parent-control consequences, so it is **not made here**.

- **TR-D26 (Proposed, not accepted) Where the sound setting lives.** Options:
  (A) a device-local mute in the game HUD, in browser storage, no server state;
  (B) a per-child setting a parent controls on the profile, enforced in the game;
  (C) both: a parent-level switch that can force sound off, and a device-local mute under it.
  **Recommended default: C, with the parent switch defaulting to on and effects synthesised in the
  browser (no audio files, no voices, nothing recorded, no AI).** A is quick but ignores
  CLAUDE.md section 2, which gives parents control of voice and microphone; B needs a profile
  field and parent UI. Short effects only; every effect keeps a text equivalent already on
  screen (`docs/UX_AND_ACCESSIBILITY.md`).
- **Done, and independent of the decision:** `soundCues.ts` names the moments (chest opens, key
  found, stone right or wrong, bridge opens, celebration, replay win), the companion raises them,
  and nothing is audible until a player registers as the sink. Removing or changing it later
  costs nothing.
- **Pending the decision:** the player, the mute control, the setting and its parent UI.

**TR-11, a second chest and quest chain.** Its words: "quest prerequisites exercised end to end
with admin-authored content only, no code change", dependent on TR-9.

- **Evidence it is superseded in substance.** TR-14 is a quest chain with prerequisites between
  encounters (`required_world_change_key`, `required_item`), four chests, a key, a puzzle, and a
  two-stage quest, played end to end through the API in `test_pips_treasure.py` (ordering,
  locks, leaving and returning, no double rewards).
- **Evidence it is not identical.** TR-11 asked for *no code change*; TR-14 needed code. The
  part that stays open is "an administrator can build the next chain without a developer", which
  is TR-3's region admin, and it waited on TR-9.
- **Status: superseded by TR-14, proposed.** Owner confirmation is required to close it; it is
  not recorded as closed here. No duplicate implementation was written.

## 20. Verification and owner playtest (2026-11-02)

**Browser tests were not run, per owner instruction.** No Playwright, Cypress, browser
automation or visual check was used, and nothing here says the game works in a real browser.
The engine tests drive the real collision and scene code with a fake renderer, in jsdom.

| Check | Command (from the repo root) | Result |
|---|---|---|
| Django: regions, game sessions, quests, inventory | `cd lai && LAI_REQUIRE_POSTGRES=1 ../.venv/bin/python -m pytest -q apps/regions apps/game_sessions apps/quests apps/inventory` (PostgreSQL 16, database `lai_trreboot`) | 335 passed, 2 failed; both failures were stale expectations I then fixed (`test_publish.py` count 19 to 22, a response-key assertion in my own test), and the two files re-ran green (23 passed) |
| Django: core, education, progression, users, treasure assets | same, `apps/core apps/education apps/progression apps/users apps/assets/tests/test_treasure_rush_assets.py` | 575 passed, 1 failed: `test_tenant_isolation.py::test_the_game_cookie...` was already stale from TR-14; allow-list updated, file re-ran green (32 passed) |
| Django system checks | `manage.py check`; `manage.py makemigrations --check --dry-run` | No issues; no changes detected |
| Ruff | `ruff check lai/apps`; `ruff format lai/apps` | Clean |
| Vitest | `cd react && node ../node_modules/vitest/vitest.mjs run src/features/region-play src/features/island-map src/api/play src/features/content-export src/test` | 131 files, 1,534 tests: 1,532 passed, 2 failed. Both fail the same way on the untouched branch (`goldenVectors.test.ts`, `assetLoader.test.ts`), most likely because dependencies were installed without the lockfile (`npm ci` refused it) |
| Typecheck | `cd react && tsc -b` | Clean |
| Prettier | `prettier --check` on every changed `.ts`, `.tsx`, `.md`, `.json` | Clean |
| oxlint | `oxlint react/src` | 0 errors; warnings only, including the existing baseline |
| Production build | `cd react && vite build` | Passes |

Not run, on purpose or for lack of means: Playwright and every browser test; the full Vitest and
pytest suites (only the areas this work touches, plus their neighbours); `content:check` and
`golden:check` (the golden failure above is baseline); deployment of any kind.

**Commits on `quest/tr.reboot` for this work:** `8ec45cc` (backend), `076292c` (frontend), and the
documentation commit that follows them.

**Status words used above.** *Development complete* means built and unit-tested. *Unit/API
verified* means the results in this table. Neither means accepted. **TR-9, browser acceptance and
final owner approval are not done.** The owner playtest checklist is
`docs/TREASURE_RUSH_PLAYTEST_CHECKLIST.md`.

### Genuine blockers and open items

- **TR-D26 (sound).** Owner decision: where the setting lives. Recommended default is in
  section 19.
- **TR-11.** Owner confirmation that TR-14 closes it.
- **TR-D27 (ordering and matching puzzles).** Owner decision, only if playtest wants more than
  "touch the answer".
- **Art:** `treasure-key`, the pedestal, the bridge and lantern models, an animated Pip with
  `Cheer` and `Point`. Everything has a working fallback.
- **TR-9.** The browser journey and a playtest note per age band.
- **Deployment:** the migration `regions.0004`, `seed_treasure_rush` (layout v4, the spyglass)
  and `publish_treasure_rush` are needed wherever the cove already exists. Nothing was deployed.

