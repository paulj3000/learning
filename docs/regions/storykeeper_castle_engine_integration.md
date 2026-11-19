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
| SC-JMP-08 Story fragments and progression | Backlog | v1 claims (`castleGameplayClaims.ts`, GE-072); `castleRecords.ts` | Prepared: fragments are the existing Storybook pages, named for GE-100; no fragment currency | Owner (currency is a proposal); GE-100 adapter |
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
| Setting Tower (Observatory) | one star stone (flavour; GE-072 dropped the first) | East Corridor | Window zones answer `choose-setting`; stones kept clear of them; Orion solid |
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

**Superseded by GE-072 (section 9):** the castle now emits the shared `lai.gameplay-event` v1 claims (`extensions/castleTale/castleGameplayClaims.ts`), and `castleScoringSources.ts` is retired, so there is no second vocabulary. The table below is kept as the record of what was mapped; the record catalog lives on in `great-storybook/castleRecords.ts`. It is not a points system: the GE ledger decides any award, server-side, under owner-approved policy.

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
4. (Done in GE-072: v1 claims.) Wire the castle's claims into the GE-100 intake, read-only first (project and compare, award nothing), then under owner-approved policy.
5. Prove save compatibility on a seeded child with every record (the save contract plus a projection before and after).
6. Retire the castle's use of the old runtime only when steps 1 to 5 pass and the owner accepts in a browser (SC-R12-01).

**Status on 2026-11-18:** `core/gameengine` and `core/ge-scoring` are at `main` with no engine or scoring code yet, and there is no Realm SDK card or contract. Steps 1 to 6 are blocked on that; the castle side is ready.

## 7. Open owner decisions

1. SC-JMP-06: show the tutorial, and where (Entry Hall proposed). Assisted mode needs a specification and an ADR.
2. SC-JMP-08: the proposed fragment currency stays unapproved; the castle's fragments are its pages.
3. SC-JMP-04, 05, 07, 10 to 17: story worlds and new stories need the engine core and approved educational briefs.
4. An agent id for this session (the merge and commits carry `Agent: unassigned`).

## 8. GE-072 preparation (2026-11-19)

The owner assigned GE-072. The engine lead asked the castle to wait for **one** baseline commit on `core/gameengine` that will also contain GE-070's generic runtime pieces (extension host contract, `gameplayClaimSink`, `nearestStandableSpot`, the region manifest mapping, Django's `engine_bridge` check) and Firepeak's generic companion hooks. The castle copies none of them from a realm branch. A trial merge of `core/gameengine` at `3be6e8e8` was made locally to measure the work, then aborted (nothing pushed). Everything below comes from that trial.

### 8.1 The castle's `engineBridge` entry (to add once the baseline lands)

Movement, camera and character stay with the live runtime until GE-076, and the bridge refuses them. The castle's first bridge capability is the **one checkpoint system**. It replaces `manifest.checkpoints` in the same commit, so there is never a second checkpoint list:

```ts
// storykeeperCastle.ts, manifest.extensions (beside castle-tale)
{
  extensionId: 'engineBridge',
  config: {
    capabilities: [
      {
        id: 'gameplay.checkpoints',
        config: {
          // From STORYKEEPER_CASTLE_CHECKPOINTS, ids unchanged (castleSaveContract.test.ts):
          // storykeeper-castle:entrance, :story-hall, :gallery, :tower, :library
          checkpoints: [{ id, courseId: 'storykeeper-castle', position: { x, y: 0, z }, yaw, label, halfSize: 1.2 }],
          goals: [],
          alreadyReached: [],
        },
      },
    ],
    allowEnginePlatforms: false, // castle pads stay on the live platform system until GE-076
  },
}
```

| Host wiring | Source | Rule |
|---|---|---|
| `api.resume([WorldState.last_checkpoint_id])` | the saved checkpoint | a returning child resumes where they saved, silently; an unknown id falls back to the entrance (today's behaviour) |
| `api.setSignals(world:<changeKey>)` | `listAllWorldChanges` | same convention as `signalPlatforms`; no castle checkpoint is gated today |
| `CourseCheckpointReached` | forwarded by the bridge | the existing "You found {checkpoint}." toast and `saveCheckpoint` call keep working |

Not bridged, and why: the archways have no locks (they stay colliders); the secret-passage seal is gated on a *discovery*, not a world change, so it has no signal and stays a gated collider; the Writing Room door and the harbor exit are interactions; the pads stay live (`allowEnginePlatforms: false`).

### 8.2 Gameplay claims (v1) the castle will emit

The castle's events map onto `lai.gameplay-event` v1. `castleScoringSources.ts` is replaced by this mapping, so there is no second vocabulary:

| Castle fact (server record) | v1 claim |
|---|---|
| Room first entered (`castle-room:<id>`) | `exploration.area.entered` `{ areaId: <room id> }` |
| Tapestry nook, chamber star, mouse door | `exploration.discovery.found` `{ discoveryId }` |
| Castle adventure step answered (Adventure Engine) | `learning.answer.submitted` `{ learningRef: ADVENTURE_STEP {stepId}, choiceId }` (a pad answer is the same claim; wrong answers are claimed too, Django grades) |
| Talk to Quill, Orion, Ember | `npc.interaction.completed` `{ npcId, interactionId }` |
| Great Storybook quests | `quest.step.completed`, `quest.completed` |
| Adventure finished | `adventure.completed` |
| Storybook whole (edition 1 or 2) | `realm.milestone.reached` `{ milestoneId: GREAT_STORYBOOK_RESTORED(_V2) }` |
| Chamber ledge view | none: a view is not a claim (falls, hops and views never are) |

Keepsakes stay server reward rules; a pickup is not a castle mechanic. Support level, correctness and band are never in a claim (Django holds them).

### 8.3 Reconciliation plan from the trial merge

| File | Conflict | Resolution |
|---|---|---|
| `runtime/sceneLayout.ts` | the castle's configurable `wallHeight` (SC-R11) against the engine's `boundary: true` | keep both: `rectToBox(rect, RECT_MIN_Y, wallHeight)` and `boundary: true` |
| `runtime/createLocationEngine.ts` | the castle's `assetsSettled` against the engine's collision debug overlay | keep both blocks (independent) |
| `content-export/contentExport.test.ts` | both sides added content | base plus both: quests 14, items 41, sets 3, reward rules 34, NPCs 8, discoveries 8, checkpoints 31 (confirmed by regenerating) |
| `content/exported/manifest.json`, `tests/golden/director-content.json` | generated | regenerate (`content:export`, `golden:generate`); checks pass |
| `docs/DECISIONS.md` | registry rows 056 to 063; duplicate ADR bodies | engine rows; one body each (this branch's bodies, which cite ADR-063, with the engine's 063 status line); `adr:check` passes |
| `docs/IMPLEMENTATION_STATUS.md` | misaligned hunks | this branch's file plus the engine-only sections, minus the old "ADR-055" copy of the jump-controller section |

Castle-side work the footprint (ADR-060, `e50fd17f`, radius 0.37 m) makes necessary. All of it is castle content or castle tests; none is an engine defect:

1. **Observatory star stone `s1`** (6.75, 7.45, 0.8 m) is 0.35 m from the tower checkpoint (7.5, 7.5) and overlaps the arrival through `arch-tower` (6.0, 7.5). The tower checkpoint, door arrival, accessible tour and guide fail. **Done before the merge:** no other spot in the tower fits, so `s1` is dropped (flavour only), and the pad clearance rule is now 0.45 m from every safe spot, checkpoint and door arrival.
2. **Costume racks** stand at z −9.2 (was −8.5), an owner-QA fix in `e50fd17f`. Keep it, and re-baseline `castleOptimisation.test.ts` and `storykeeperCastleWallGeometry.test.ts`.
3. **`castleMovementAudit.engine.test.ts`**: the wall sweep needs a longer per-test budget with the footprint, and the animation check must accept the gait the footprint allows (`SPRINT` was not reached in the Story Hall run). Then re-check every room against the body, which closes section 3.3 item 1.
4. **`CastleTaleCompanion.npc.test.tsx`** quest flow timed out at 5 s under load; look at it with the same method as GE-D9 before changing it.

Trial evidence (merged tree, not committed): typecheck clean; island-map/three, great-storybook, content-export and discovery suites 182 files, 2337 passed and 11 failed, all 11 listed above.

## 9. GE-072 status (2026-11-19)

Development Complete for the engine-adoption stage the bridge contract allows today. Not merged, not owner accepted.

| Checklist item (migration matrix section 4) | State | Evidence |
|---|---|---|
| Merge `core/gameengine` at the published SHA, no rebase | Done: `fc5c71cf` (baseline) at `09adcc15`, then `cbe43a8e` (companion hooks) at `15fef5db` | Conflicts as in section 8.3 |
| Imports move from the shims to `@lai/game-engine` | Done | `castleEngineImports.test.ts` fails if a castle file imports a shim |
| A location definition declares capability requests | Done: `runtime/locations/storykeeperCastle.location.ts` | Parity test: no adapter issue; locomotion, jump (0.9 m, optional, no double jump), camera (cap 2.95 m, collision on), avatar resolve exactly as the manifest; content compatibility check passes |
| `engine:validate` | Passes (no exported castle scene; the castle is a TypeScript manifest, checked by the location test) | |
| Gameplay claims | Done for answers, adventure completion and rooms | `castleGameplayClaims.test.tsx`: claims validate with the engine validator; wrong answers claimed (server grades); failed submits and absent context claim nothing; no grade, support level, band or score |
| Existing realm tests unchanged | Yes, except four reviewed adjustments (below) | Broad focused Vitest 245 files, 3102 passed |
| No child progress, content, page id or objective changed | Yes | `castleSaveContract.test.ts` unchanged and passing |

Reviewed adjustments caused by the shared movement stack's body (ADR-060), all castle-side:
1. The first Observatory star stone is dropped (section 8.3 item 1); pad clearance uses the body.
2. The costume-rack move (`e50fd17f`) is a named exception to two collider baselines.
3. The movement audit tests the body against solids (mutation-checked) and sprints on a clear corridor run.
4. Two heavy suites get explicit time budgets (GE-D9 pattern); the pre-merge commit timed out the same way.

Not done, and why:
- **Bridge checkpoints (`engineBridge`, section 8.1).** The castle's five checkpoints, spawn and saves stay on the live runtime for now. The bridge adds nothing a child would notice yet, and the engine's open gap "the live controller's fall recovery does not know bridge checkpoints" (integration baseline) means moving them now would split recovery. The config is ready in section 8.1; the move is one commit once that gap closes.
- **`exploration.discovery.found` and `npc.interaction.completed`.** Castle discoveries (the nook, the chamber finds) and NPC talks are recorded by the shared host (`RECORD_DISCOVERY` actions, the NPC Manager host), not by castle code, so the claim belongs in the host for every location. Requested from the engine lead.
- **`quest.*` and `realm.milestone.reached`.** The Great Storybook quests and edition milestones are written by Django on step completion; the client learns them only from a later world-state read. Claiming them would restate a stale read; the ledger reads those rows directly.

### SC-JMP-20 acceptance evidence (unit level)

| Area | Tests |
|---|---|
| Movement in every room (walk, run, sprint, optional jump) | `castleMovementAudit.engine.test.ts` (12) |
| Collisions with the body, wall penetration, out-of-bounds recovery | same, mutation-checked; `playerFootprint.engine.test.ts` (castle walls and doors) |
| Room transitions and doors | same; `castleNavigationRegression.test.ts` |
| Indoor camera | same (third-person, every room); `thirdPerson.engine.test.ts` |
| Age-band movement and accessibility | `castleEngineProfile.test.ts` (16); `castleHudEquivalence.test.tsx`; `castleSproutNoAim.test.ts` |
| Learning activities and pads | `castlePlatformAnswers.test.ts`, `usePadAnswers.test.tsx`, `castlePlatforms.test.ts` |
| Save compatibility | `castleSaveContract.test.ts` (7) |
| Engine parity | `storykeeperCastle.location.test.ts` (6), `castleEngineImports.test.ts` (2), `castleGameplayClaims.test.tsx` (7) |

Owner acceptance (SC-R12-01, browser and devices) is still required and is not claimed here.
