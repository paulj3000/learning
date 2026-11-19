# Storykeeper Castle: shared engine integration audit and migration plan

- **Status:** Development audit, 2026-11-18. Branch `feature/storykeeper-castle-completion`. Not merged, not deployed, not owner accepted.
- **Owner rule in force:** jumping is a shared engine capability an adventure may enable; Storykeeper Castle and the Storybook adventures do not need it (owner, 2026-11-18; `docs/adventures/jumping-standard.md`). The castle uses it only for optional pads and views, and every pad answer is also on the HUD card.
- **Related:** `docs/regions/storykeeper_castle_jumping_inventory.md` (SC-JMP), `docs/adventures/scoring-standard.md`, Trello GE-100 (Game Engine Core scoring), `docs/engine/` (generic location runtime).

## 1. What this audit covers

1. SC-R and SC-JMP tasks against source and Git history, with the Trello reconciliation (section 2).
2. Every castle room against the movement criteria: walking, running, jumping, collisions, wall penetration, stairs and elevated surfaces, doors, room transitions, camera collision, avatar animation, safe respawn and accessibility (section 3).
3. What the castle needs from the unified Game Engine Core (Agent 4) and what it offers the scoring service (Agent 6) (sections 4 and 5).
4. Save compatibility and the incremental migration plan for when the Realm SDK exists (section 6).

There is no castle movement, physics, collision or camera code, and this work adds none. The castle is a consumer of the shared runtime on this branch (`createLocationEngine`, `FirstPersonController`, `playerCamera.ts`, `platforms/`), configured by data.

## 2. Task reconciliation (source, Git, Trello)

Git is the evidence for code; Trello for ownership and state. "Branch" means `feature/storykeeper-castle-completion` (89 commits ahead of `main` before this work, `main` merged in at `2786f2b2`).

### 2.1 SC-R (reboot)

| Task | Code evidence | Where | Trello before | Reconciled state | Remaining owner acceptance |
|---|---|---|---|---|---|
| SC-R01-01 to 05 | Docs and contract tests | main | Subproject card | Done (development) | ADR-028 still Proposed |
| SC-R02-01 to 09 | Visual system, eight rooms | main | Subproject card | Done (development); SC-R02-05 partial (reduced-motion tapestry only) | Browser look pass, reduced-motion feel |
| SC-R03-01 to 07 | Layout, hub, Trophy Room, Observatory, Secret Chamber, map, discovery in Django | main | Subproject card | Done (development) | Browser walkthrough |
| SC-R04-00 to 04 | Storybook quest, pages, 3D book, adventure links | main | Gates card says done | Done (development) | Play each adventure |
| SC-R04-05 to 08 | Painted Words, progression, completion, editions (`091d763c`, `32afe8b6`, `6ad0225f`, `bc7a79a3`) | **branch only** | Development Complete | Done (development), **not in main** | Play both word sets; forged world-change POST (integrity prep B) stays open |
| SC-R05-01 to 03 | Quill reconcile, Ember, Professor Orion | branch only | Development Complete, description says "not started" | Done (development); description stale | Confirm Orion; final GLB models |
| SC-R06-01 to 03 | Sound cues, mute, Polly narration | branch only | Development Complete, "not started" | Done (development); description stale | Audio check, audio files, voice consent |
| SC-R07-01 to 04 | Artifacts, pedestals, Hall of Heroes, ranks (flag off) | branch only | Development Complete, "not started" | Done (development); description stale | Keep or drop ranks; run `backfill_castle_keepsakes` |
| SC-R08-01 to 03, SC-R09-01 to 02 | Return visits, chamber finds, Castle Director (ADR-065 Accepted), Quill flavour | branch only | Development Complete, "not started" | Done (development); description stale | Star glint, mouse door visuals |
| SC-R10-01 to 02, SC-final-B | Three.js Writing Room, parity, write-your-story | branch only | Development Complete, "not started" | Done (development); description stale | Play the Writing Room |
| SC-R10-03 | Phaser retirement | not done (gated) | Blocked | Blocked: ADR-020 conditions, LAI-2303, owner | Owner approval |
| SC-R11 engineering | Diagnostics, wall height, accessibility tests | branch only | Development Complete | Done (development) | SC-R11-01 tablet profiling, SC-R11-02 Sprouts playtest (owner) |
| SC-R12-01 to 02 | Acceptance checklist, release notes draft | draft only | Blocked | Blocked on owner | Browser acceptance O-1 to O-19 |

### 2.2 SC-JMP (movement)

| Task | State before | Evidence now | Reconciled state | Blocked on |
|---|---|---|---|---|
| SC-JMP (umbrella, jumping in primary adventures) | Ready for Development | merge `c81ee466` and `7afcc039`; inventory doc | **Development Complete** (was stale) | Owner: play each adventure jumping and not jumping |
| SC-JMP-01 Shared movement in all rooms | Ready | `castleEngineProfile.ts`, `castleMovementAudit.engine.test.ts` (this work) | Development Complete for the current shared runtime; re-run on the Game Engine Core when it exists | GE core contract (Agent 4) for the migration half |
| SC-JMP-02 Collisions and jumpable surfaces | Ready | same audit; `castleEngineProfile.test.ts` (no jumpable wall, gate or door) | Development Complete for the current runtime | as SC-JMP-01 |
| SC-JMP-03 Painted Words jumping | Development Complete | `castlePlatformAnswers.ts`, `usePadAnswers.ts` | unchanged | Owner play |
| SC-JMP-04 Storybook 3D portals | Ready | none | Not started: needs a story-world scene lifecycle from the engine core | Agent 4 contract, SC-JMP-05 |
| SC-JMP-05 Reusable story-world template | Ready | none | Not started: this is engine-core scope (scene lifecycle, spawn, return contract), not a castle file | Agent 4 |
| SC-JMP-06 Movement tutorial | Ready | `castleMovementTutorial.ts` reducer and tests (this work) | Prepared: pure, optional, skippable, timer-free; not shown in the world | Owner: where (the castle has no courtyard; Entry Hall proposed) and whether; "assisted mode" needs a spec and ADR |
| SC-JMP-07 Lost Pages / Book Jumper | Backlog | none | Backlog: new educational brief needs owner approval | Owner |
| SC-JMP-08 Story fragments and progression | Backlog | `castleScoringSources.ts` (this work) | Prepared: fragments are the existing Storybook pages, named for GE-100; no fragment currency | Owner (currency is a proposal); GE-100 adapter |
| SC-JMP-09 Jumping in the existing five adventures | Ready | inventory doc: Tale, picture story, Painted Words A and B, Secret Door 1 and 2, pathway | **Development Complete** by SC-JMP (was stale) | Owner play |
| SC-JMP-10 to 17 New stories | Backlog | none | Backlog: proposals, owner approves curriculum | Owner |
| SC-JMP-18 Accessibility and age-band movement | Ready | `CASTLE_MOVEMENT_BY_BAND` and its tests (this work) | Development Complete: bands stated as content, checked against the manifest; no new setting | Owner Sprouts playtest (SC-R11-02) |
| SC-JMP-19 Django Admin story-world authoring | Backlog | none | Backlog: layouts are not Django-administered until LAI-0805's ADR (CLAUDE.md section 20) | LAI-0805, LAI-JMP-14 |
| SC-JMP-20 Movement acceptance | Backlog | audit, profile, save contract, scoring and tutorial tests (this work) | Unit part done; browser part deferred | Owner browser and device acceptance (SC-R12-01) |

## 3. Room-by-room engine audit (SC-JMP-01, SC-JMP-02)

Every row is proven by unit tests on the real shared runtime, in both worlds (before and after the tapestry nook is found), unless marked owner. Key: **A** `castleMovementAudit.engine.test.ts`, **P** `castlePlatforms.test.ts`, **N** `castleNavigationRegression.test.ts`, **T** `thirdPerson.engine.test.ts`, **H** `castleHudEquivalence.test.tsx`, **E** `castleEngineProfile.test.ts`.

### 3.1 Criteria common to every room

| Criterion | Finding | Tests |
|---|---|---|
| Walking, running, sprinting | Shared controller; castle tuning run 4.8, sprint 5.6 m/s (gentler indoors) | A, `runningIntegration.engine.test.ts` |
| Jumping | Shared controller, jump height 0.9 m; apex eye under the 3.1 m ceiling slabs in every room; 0.5 m pad + jump + eye = 3.0 m | A, E |
| Collision geometry | Walls, props, NPCs and the dais are solid boxes; no wall, door frame or gate is jumpable | A, E, N |
| Wall penetration | Sprinting with repeated jumps into twelve headings per room never enters a solid or leaves the floor (mutation-checked) | A |
| Stairs and elevated surfaces | No stairs, upper floors, lifts or bounce pads by design. Elevated surfaces are static platforms with tops at most 0.5 m | P, E |
| Doors and portals | Nine archways, all open except the secret passage, which is a solid seal until the nook is found; the castle exits (harbor, Writing Room) are interactions, never arithmetic-gated | A, N, `castleExitsNoArithmetic.test.ts` |
| Room transitions | Every open doorway crossed in both directions, walking and with a jump in the doorway, lands in the other room | A, N |
| Camera collision | Third-person camera, a full turn in every room, never inside a wall, never above 2.95 m, never inside a sealed room | A, T |
| Avatar animation | Movement states (idle, sprint, jump start, airborne, landing) each map to a clip; the stand-in avatar keeps its ground clip in the air | A, `playerAnimation.test.ts` |
| Safe respawn | Leaving the playable area or an invalid position returns the child to the last floor they stood on; position only, no record changed. Saved checkpoints resume on entry | A, N |
| Accessibility | Every pad answer is on the HUD card in the same words; Sprouts get flat markers and no reticle; the accessible tour reaches every room without walking | H, P, N, `castleSproutNoAim.test.ts` |

### 3.2 Per room

| Room | Elevated surfaces (optional) | Doors | Notes |
|---|---|---|---|
| Entry Hall | none | to Story Hall; harbor exit | Spawn and checkpoint `storykeeper-castle:entrance`; candidate place for the SC-JMP-06 tutorial |
| Story Hall | three story stones (Tale ordering), Sprouts flat markers | Entry Hall, Gallery, Costume Room, East Corridor, secret passage (sealed) | Hub; Quill and lectern solid |
| Character Gallery | none | Story Hall | Portrait zones answer `choose-hero`; walk-in route only |
| Costume Room | none | Story Hall, Trophy Room | |
| Trophy Room | none | Costume Room | Pedestals show owned keepsakes; walk-up descriptions only |
| East Corridor | none | Story Hall, Tower, Studio, Library | Narrow passage; camera held close |
| Setting Tower (Observatory) | two star stones (flavour) | East Corridor | Window zones answer `choose-setting`; stones kept clear of them; Orion solid |
| Illustration Studio | three painted pads (Painted Words) | East Corridor | Pads answer only while a choice step is open |
| Great Library | clue books, pattern stones, rod stones, Storybook page pathway | East Corridor; secret door to the Writing Room | Deepest room; pathway pads appear only when a page record exists |
| Secret Chamber | two stones and a ledge (view toast only) | Story Hall via the sealed passage | Unlisted until found; never reached by the camera or a jump while sealed |

### 3.3 Findings

No defect was found in the current shared runtime as the castle configures it. Two limits are recorded, not fixed here:

1. The player has no footprint radius on this branch (ADR-060 is reserved for `feature/treasure-rush-palm-trees`). The audit therefore checks the player's centre against solids. When the footprint arrives through the engine core, the same audit runs unchanged and also proves the body clears the 2 m archways.
2. The castle has no hazards, so `recoveryPoint` (course checkpoints) is never used; recovery is the last safe floor. That is correct for a castle with flat floors and must stay true after migration.

## 4. What the castle needs from the Game Engine Core (Agent 4)

The castle is ready to be consumed by the shared engine through one profile and one manifest. It asks the engine core for these contracts; it will not implement any of them itself.

| Need | Today (shared runtime on this branch) | Contract asked of the engine core |
|---|---|---|
| Movement tuning per location | `manifest.movement` (`MovementSpec`) | Accept `CASTLE_ENGINE_PROFILE.movement` unchanged, within the existing jump and locomotion limits |
| Indoor camera | `manifest.player.camera` incl. `maxHeight` | Keep a ceiling cap and solid-collider camera collision |
| Colliders | `ColliderSpec` boxes, solid by default, gated colliders never jumpable | Same semantics: solid by default; `requirements` never jumpable |
| Per-band platforming | `manifest.platformingByBand` + `manifestForBand` | Keep a per-band platform variant (Sprouts flat markers) |
| Zones | Ground-plane zones entered by x and z | Keep zones 2D, so a jump never skips a story zone |
| Events | `PlayerEnteredZone`, `PlayerJumped`, `PlayerLanded`, `PlayerGaitChanged`, `PlayerRecovered`, `ObjectInteracted` | Same names and payloads, or a documented mapping; the castle pads, tutorial and scoring sources read only these |
| Recovery | Last safe ground; saved checkpoint on entry | Position-only recovery, never touching progress |
| Extension seam | `castle-tale` world extension and view extension | An extension or Realm SDK hook with the same lifecycle (scene built, world state changed, disposed) |
| Test harness | `runtime/testing/engineHarness.ts` | A headless harness, so `castleMovementAudit.engine.test.ts` runs unchanged on the core |

## 5. What the castle offers the scoring service (Agent 6, GE-100)

`react/src/features/great-storybook/castleScoringSources.ts` names the castle's existing records as typed events. It is not a points system: no values, multipliers, levels or thresholds. The GE ledger decides any award, server-side, under owner-approved policy.

| Event kind | Source record | Authority | Idempotency key |
|---|---|---|---|
| `STORY_COMPLETED` | Adventure or story completion world change (one per record, per band) | server | `storykeeper-castle:STORY_COMPLETED:<slug>` |
| `LEARNING_STEP_COMPLETED` | Adventure Engine decision on a castle step, with `INDEPENDENT`, `SUPPORTED` or `GUIDED` support and the step's objectives; a retry produces nothing | server (SkillEvidence) | `...:<adventure>/<step>` |
| `STORY_FRAGMENT_RECOVERED` | A Storybook page's record, limited to the child's band | server | `...:<page-id>` |
| `READING_MILESTONE` | `GREAT_STORYBOOK_RESTORED`, `GREAT_STORYBOOK_RESTORED_V2` | server | `...:<key>` |
| `PLACE_EXPLORED` | `castle-room:<id>` world change | server | `...:<room-id>` |
| `HIDDEN_FIND` | Tapestry nook, chamber star, mouse door discoveries | server | `...:<discovery-id>` |
| `ACHIEVEMENT_EARNED` | Castle keepsake owned (granted once by its reward rule) | server | `...:<item-id>` |
| `MOVEMENT_EXPLORATION` | Chamber ledge view zone entered | **client signal**: a policy must not grant from it alone | `...:view:chamber:ledge` |

Not events, by design: a pad answer (it is the same step answer as the card, so it counts once through `LEARNING_STEP_COMPLETED`), a missed jump, a hint, a wrong answer, time spent, and rank titles (derived descriptions, flag off).

## 6. Save compatibility and migration plan

**Persisted ids** are pinned in `castleSaveContract.test.ts`: the five checkpoint ids, the ten room keys (in step with Django's `castle_rooms.json`), six page ids and their records, both edition keys, seven completion records, three discovery ids and six keepsake ids. Ids are only ever appended; a change needs an owner decision recorded here.

**Migration, once the Realm SDK exists** (each step is its own reviewable commit, unit tests only during development):

0. **Merge order (agreed with the engine lead, 2026-11-18).** `core/gameengine` became migration-ready at `dcc45032`. GE-072 needs the owner's approval and follows GE-070. A read-only merge preview conflicts in `createLocationEngine.ts` and `sceneLayout.ts`, but every change to those files comes from the Treasure Rush movement stack (PR #36, `feature/treasure-rush-palm-trees` up to `420f1afd`: camera at tall walls, player footprint `e50fd17f`, avatar on the resolved position, instanced vegetation), not from the engine. So: PR #36 merges to `main` first, then `main` merges into this branch, keeping both sides (the castle changes and the owner-QA'd movement fixes, which must not be dropped). Hunk intent is asked of the Treasure Rush lead (`treasure-rush-c8`). After that, `core/gameengine` brings only engine files and shims. Generated files (`content:export`, `golden:generate`) are regenerated, never hand-merged. The footprint in `e50fd17f` closes the limit in section 3.3 item 1, and the movement audit must still pass with it.
1. Run `castleMovementAudit.engine.test.ts`, `castleEngineProfile.test.ts` and the navigation regression against the SDK's harness, unchanged. Any failure is an SDK gap reported to Agent 4, not a castle workaround.
2. Hand the SDK the castle's `ThreeLocationManifest` and `CASTLE_ENGINE_PROFILE` through its location adapter. No room geometry, id or zone changes.
3. Move the `castle-tale` extension onto the SDK's extension hook, keeping its claims contract (C-2) and HUD equivalence (C-3).
4. Wire `castleScoringSources` into the GE-100 adapter, read-only first (project and compare, award nothing), then under owner-approved policy.
5. Prove save compatibility on a seeded child with every record (the save contract plus a projection before and after).
6. Retire the castle's use of the old runtime only when steps 1 to 5 pass and the owner accepts in a browser (SC-R12-01).

**Status on 2026-11-18:** `core/gameengine` and `core/ge-scoring` are at `main` with no engine or scoring code yet, and there is no Realm SDK card or contract. Steps 1 to 6 are blocked on that; the castle side is ready.

## 7. Open owner decisions

1. SC-JMP-06: show the tutorial, and where (Entry Hall proposed). Assisted mode needs a specification and an ADR.
2. SC-JMP-08: the proposed fragment currency stays unapproved; the castle's fragments are its pages.
3. SC-JMP-04, 05, 07, 10 to 17: story worlds and new stories need the engine core and approved educational briefs.
4. An agent id for this session (the merge and commits carry `Agent: unassigned`).
