# Game Engine Core: known defects and risks

- **Status:** Proposed
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-060, ADR-070 (Reserved, collision)
- **Related tickets:** GE-001, GE-090
- **Canonical sources:** test runs recorded in [implementation-status.md](implementation-status.md); Treasure Rush engine handoff `docs/engine/TREASURE_RUSH_ENGINE_HANDOFF.md` on `feature/treasure-rush-palm-trees` @ `6818f74b` (sections 6.4, 7.2, 8)

## 1. Defects

| Id | Defect | Severity | State |
|---|---|---|---|
| GE-D2 | `removeCollider` on an authored id leaves the box in the jumpable set and in solids (`runtime/createLocationEngine.ts` lines 620 to 625 on the baseline) | Medium | Open in the live runtime. Engine `PhysicsProvider.removeCollider` removes from every list (GE-021); the live copy is fixed or replaced in GE-070 |
| GE-D3 | Colliders added by extensions have no id, so they cannot be removed | Medium | Open in the live runtime. `ColliderSpec.id` is required in the engine contract |
| GE-D4 | Extension `isBlocked` is a point-in-box test (no footprint, no height); `teleportPlayer` skips collision | Medium | Open in the live runtime. Engine queries go through the controller footprint (GE-020, GE-021) |
| GE-D5 | The view calls handle members optionally (`setSprintMode?.`, `signalPlatforms?.`) | Low | Engine contracts make capabilities explicit; GE-070 makes the handle members required |
| GE-D6 | Camera occlusion uses colliders, not meshes | Low (by design today) | Kept: collision raycast through `PhysicsProvider` (GE-031); mesh occlusion would be a new decision |
| GE-D7 | `docs/PLAYER_MOVEMENT_AND_JUMPING.md` lines 164 to 175 are stale ("no running", "point in x/z") | Low (docs) | Open; corrected when the movement stack merges (owner of that doc) |
| GE-D8 | Content leaked into engine code: `ASSET_FOOTPRINTS` (treasure-chest, wonder-stone-*), `SANDBOX_NPC_ID` `pirate-pip`, `ADVENTURE_COMPLETE_CHANGE_KEYS` (npc-manager `triggers.ts`) | Low | Open; moved into content or SDK definitions during GE-070 and GE-075. `game/src` is guarded by the no-location-branching test |
| GE-D1 | One island-map test that scans the asset catalogue failed once in a full `src/features/island-map/three/` run and passed on rerun (baseline `5b300e30`, before any engine change) | Low (flaky test, not product) | Open; observed, not investigated |

## 2. Risks

| Id | Risk | Mitigation |
|---|---|---|
| GE-R1 | `core/gameengine` contains the unmerged movement stack (PR #26 to #36). If those PRs change before merging, this branch must merge them again | Merge order O4 in [decisions.md](decisions.md); merge, never rebase |
| GE-R2 | Rename conflicts if a realm branch later edits a moved module | No realm branch edits them today (measured 2026-11-18); realm leads agreed to request changes from the engine lead |
| GE-R3 | Temporary duplication: engine components port platform math, and atmosphere will be ported | Each port carries a source note; GE-076 removes the legacy copy after migration |
| GE-R4 | `createLocationEngine` keeps growing on realm branches while the engine runtime exists beside it | Adopt the runtime piece by piece per migration; move it in GE-076 |
| GE-R5 | Scoring economy (XP, coins) conflicts with the mandatory scoring standard | Owner decision O5; engine claims stay neutral facts |
| GE-R6 | Performance targets (ADR-020) are unmeasured | Diagnostics and renderer stats exist; the measurement harness is LAI-2105 |
| GE-R7 | WebGL, visual and touch behaviour are not covered by unit tests | Owner QA and browser checks at merge readiness (GE-090) |
| GE-R8 | `DECISIONS.md` merge resolution (E9) may differ from how the movement owner resolves PR #26 | Owner decision O3; the branch follows the owner's choice |

## 3. Design limits found in the workstreams

| Id | Limit | Follow-up |
|---|---|---|
| GE-L1 | Against an external force the child makes net progress at 60% of walk speed or better, not at exactly walk speed (force cap `0.4 x walkSpeed x rate`) | Confirm with owner QA in Firepeak steam and North Pole wind |
| GE-L2 | The content validator flags any key matching `timer`, `countdown`, `deadline`, `time_limit` and similar; a legitimate field named like that is a false positive | Rename the field; the rule exists for ADR-053 |
| GE-L3 | The content validator assumes scene field names (`platforming.platforms[]`, `platforming.checkpoints[].platformId`, `jumpChallenges[]`, `colliders[]`, `gates[]`) | Confirm against `platformSpec.ts` in GE-070 |
| GE-L4 | SDK walk speed bounds (0.5 to 6 m/s) and per-band difficulty ceilings are engineering choices, not from a standard | Owner or pedagogy review (decision O7 area) |
| GE-L5 | Difficulty profile fields (gap, height, consecutive jumps, moving speed) are authoring values; nothing checks scene geometry against them yet | Planned validator rule |
| GE-L6 | A non-replay chest emits `exploration.discovery.found` (no chest claim type in v1) | Additive claim type if scoring needs it |
| GE-L7 | Platforms default to `route: REQUIRED`, so moving and falling platforms must be marked OPTIONAL explicitly or validation fails | Intended (jumping standard); documented for authors |
| GE-L8 | GameHost pauses on window blur, including clicks into devtools or an iframe | As specified |
| GE-L9 | `renderer.info` gauges, the WebGL path and production-build route stripping are untested in unit tests | Merge readiness (GE-090) |

## 4. Behaviour to keep (from the Treasure Rush handoff)

- A world snapshot refresh mid-visit never rebuilds the engine (`5b9cf019`, Pirate's Leap riddle
  bridge).
- `signalPlatforms('world:<key>')` stays available to hosts.
- The handoff's section 8 guard tests are the behaviour baseline for GE-070. Its recorded
  baseline is Vitest 2,895 passed by path and pytest 1,060 passed on PostgreSQL.
