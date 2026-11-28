# Phaser retirement audit and Phase 2 plan

- **Status:** Proposed (audit and plan; nothing is removed by it)
- **Owner:** Project owner
- **Last reviewed:** 2026-11-27
- **Related ADRs:** ADR-007 (retirement mandated), ADR-008 (Sprouts fallback), ADR-020 (Accepted), ADR-029 (Accepted), ADR-032 (Accepted), ADR-033 (Accepted)
- **Related tickets:** Trello #18 (Three.js Engine / Phaser Retirement), #27 (LAI-2001 to 2305 audit), #214 (GE-001), #227 (GE-076), #168 (SC-R10-01/02), #169 (SC-R10-03), #128 (LAI-JMP-01b); LAI-2001 to LAI-2305
- **Canonical sources:** [THREEJS_ENGINE_CONVERSION](../../THREEJS_ENGINE_CONVERSION.md) (plan of record, partly stale, see section 9), [legacy-retirement-plan.md](legacy-retirement-plan.md) (engine shims, GE-076), [storykeeper_castle_phaser_retirement.md](../../regions/storykeeper_castle_phaser_retirement.md) (castle gate C1 to C5)

Baseline: `main` `41ee7320` (2026-11-27). The MVP integration candidate
`integration/20261126-mvp-playability` @ `ad8a917e` (PRs #104 to #111) was read only; rows it
changes are marked **[MVP]**. Method: static reading of routes, views, scenes, manifests,
interaction tables and tests, with every claim below checked against code; no browser, device or
Playwright run. Guarded by `react/src/test/phaserRetirement.test.ts` (section 8).

## 1. Migration completion: 35% (17 of 48 gates; 27% at the first audit)

**Method.** Each of the eight historical Phaser worlds must pass six gates before its Phaser code
may go. A gate counts only when the repository shows it (code or a passing test), never by
intent. The percentage is gates met over 48.

| Gate | Met when |
|---|---|
| G1 Replacement | A registered Three.js manifest renders the world (`SOURCE_LOCATION_MANIFESTS` or a Django Area) |
| G2 Content parity | Every Phaser interaction id, action, gate and world-state change exists in 3D, or a recorded decision consolidates it |
| G3 Parity test | An automated test asserts G2 against the **Phaser** table (not against a deleted 3D view) |
| G4 Default route | 3D is the first route for every band, or the Phaser route is unreachable |
| G5 Sprouts gate | LAI-2303 (human playtest, APPROVAL) passed for this world |
| G6 Retired | Owner authorized removal and the Phaser view, scene and route are gone |

| # | World | G1 | G2 | G3 | G4 | G5 | G6 | Met |
|---|---|---|---|---|---|---|---|---|
| 1 | Welcome Harbor | yes | **no (0 of 12 ids)** | yes (`phaserParity`, gaps listed) | no | no | no | 2 |
| 2 | Pirate Builder Bay | yes | yes | yes (`phaserParity`) | no | no | no | 3 |
| 3 | Wonderwild Forest | yes | yes | yes (`phaserParity`) | no (Sprouts: Phaser only) | no | no | 3 |
| 4 | Storykeeper Castle | yes | yes | yes (`castleRebootContracts` C-1) | no **[MVP: yes except Sprouts]** | no | no | 3 |
| 5 | Dragon's Sanctuary | yes | **no (egg, exit, unlock guard)** | yes (`phaserParity`, gaps listed) | yes (route redirects) | no | no | 3 |
| 6 | Fossil Ridge Camp | **no** | no | no | no | no | no | 0 |
| 7 | Castle Writing Room | yes | yes (3D adds 2) | yes (`castleWritingRoomParity`) | no (test pins Phaser default) | no | no | 3 |
| 8 | Bolt's Workshop | **no** | no | no | no | no | no | 0 |
| | **Total** | 6 | 4 | 6 | 1 | 0 | 0 | **17 / 48** |

G3 rose from 2 to 6 when `react/src/test/phaserParity.test.ts` (LAI-2301R) landed: it checks
all six converted worlds against their Phaser tables and world changes, with the remaining gaps
listed by ticket. Two cruder figures, for comparison: Phaser routes retired 1 of 8 (12.5%, Dragon's Sanctuary);
Phaser code removed 0 of about 3,770 lines (0%). G5 and G6 are owner and human gates, so no
engineering work alone passes 75%.

## 2. Remaining Phaser runtime dependencies

| Kind | Where | Notes |
|---|---|---|
| Package | `package.json:67` and `react/package.json:39` `phaser ^4.2.1`; `package-lock.json` `node_modules/phaser` 4.2.1 | `game/package.json` has none (guarded). Removal is LAI-2304 (APPROVAL) |
| Direct importers (10) | `IM/{IslandWorldView, PirateBuilderBay, WonderwildForest, StorykeeperCastle, DragonsSanctuary, FossilRidgeCamp, CastleWritingRoom, BoltsWorkshop}WorldView.tsx`, `IM/PhaserGameContainer.tsx`, `IM/scenes/LocationScene.ts` | `IM` = `react/src/features/island-map`. Exactly this set, guarded |
| Scenes | `IM/scenes/*Scene.ts` (8 subclasses of `LocationScene`) | Movement (arrows/WASD, tap-to-walk), Arcade physics, camera follow, tile overrides, NPC follower |
| Phaser-only data | `IM/tilemap.ts`, `*Tilemap.ts`, `zones.ts`, `*Zones.ts`, `decor.ts`, `*Decor.ts`, `gridGeometry.ts`, `npcs.ts`, `worldEvents.ts` (event bus), `PhaserGameContainer.module.css` | No Three.js importer (guarded). Deleted with the last world |
| Routes mounting Phaser (7) | `AppRoutes.tsx`: `/island/:childId/world` (harbor), `/world/pirate-builder-bay`, `/wonderwild-forest`, `/storykeeper-castle`, `/fossil-ridge-camp`, `/castle-writing-room`, `/bolts-workshop` | `/world/dragons-sanctuary` already redirects to 3D. Route pages `routes/*WorldPage.tsx` (7) |
| Entry links into Phaser | `routes/WelcomeHarbor.tsx:170` (all bands); `routes/IslandLocationPage.tsx` walk links for the bay, forest, castle, fossil camp, writing room, workshop | [MVP] castle link becomes Sprouts-first / "from above instead" |
| **3D exits into Phaser** | Every `NAVIGATE 'world'` (WO:446, 596, 774, 873, 916, 1039) renders `/island/:id/world` = Phaser harbor (`three/runtime/WorldActionPanel.tsx:84-88`); the 3D Writing Room exits to Phaser `world/storykeeper-castle` (WO:963) | A child leaving any 3D world lands in Phaser. Pinned by `pirateBuilderBayParity.test.tsx:304` |
| **Progression only Phaser grants** | Discovery `harbor-tide-pool` (moon-shell; starts quest `the-quiet-places`, the only source of `singing-shell`) and discovery `harbor-keepers-door` (rainbow-shell, world change `HARBOR_KEEPERS_DOOR_OPENED`), both now also claimable in the 3D harbor (LAI-2201, same `DiscoveryAction` write and claim); Bolt NPC `metBolt` flag (Phaser only), stage 1 of quest `sort-the-workshop` (`quests/content/islandQuests.ts:377`) | Retiring the workshop before replacement would strand `metBolt` and its quest stage (the harbor discoveries are now in 3D). No **adventure** is Phaser-only: every template starts from `IslandLocationPage` |
| Shared stylesheet | `IM/IslandWorldView.module.css` imported by 8 Three.js modules (`ThreeLocationWorldView`, `WorldActionPanel`, `ThreeSandboxWorldView`, castleTale x4, adaptive entrance) | Risk R7. [MVP] edits its `:fullscreen` rules for `WorldStage`. Rename after MVP merges |
| Shared modules that survive | `worldObjects.ts` (interaction tables, single source; also exported to Django by `content-export/build.ts`), `DiscoveryAction`, `NpcConversation`, `useExplorableWorld.ts`, `avatarAppearance.ts` (`three/playerAvatar.ts`), `tideTrial.ts` | Keep. `WELCOME_HARBOR_INTERACTIONS` must stay exported after the Phaser harbor goes |
| Orphan | `DragonsSanctuaryWorldView.tsx` and `DragonsSanctuaryScene.ts`: no route mounts them (only their own test) | Deletion candidate at LAI-2304; not removed (owner authorization) |
| Tests | 36 `IM/*.test.*` files cover Phaser views, tilemaps, zones, decor, NPCs, events | Deleted with their modules |
| E2E | `react/e2e/acceptance/p0-navigation.spec.ts:199` clicks "Try exploring the castle (new!)" and expects `/world/storykeeper-castle` for a PATHFINDER child | **[MVP] that link is Sprouts-only after #106**: the spec will likely fail at merge readiness (handoff to LAI 05 and LAI 02, section 6) |
| Build and docs | `scripts/generate-world-assets.ts:1242` (comment only); `engineBoundary.ts` and `game/src/boundary.test.ts` (deny rules, keep); about 30 docs mention Phaser | Docs corrected at LAI-2305 |

Engine-side legacy (not Phaser) is tracked separately in
[legacy-retirement-plan.md](legacy-retirement-plan.md) section 5: items 3 to 9 open (live
`platformSystem`, `atmosphere`, `playerAvatar`/`playerAnimation`, `WorldEngineEventBus`,
`createLocationEngine` runtime swap).

## 3. Eight-world parity matrix

Common to every 3D world (generic runtime, `createLocationEngine`): third-person camera by
default with first-person option; walk, run, sprint; jumping on by default (no shipped Area
disables it); fall below ground recovers to the latest checkpoint or last safe ground; reduced
motion passed through; touch joystick, on-screen Jump and two-finger look; keyboard; the
"Interact with what you're looking at" button, the "Things to do" list and the card-page link
are the HUD equivalents ([MVP] the list moves into `GameplayMenus`, one tap deeper). Common to
every Phaser world: top-down follow camera, arrows/WASD and tap-to-walk, Arcade circle against
tile colliders, no jumping, no checkpoints, reduced motion for camera lerp and sway.

| | Welcome Harbor | Pirate Builder Bay | Wonderwild Forest | Storykeeper Castle |
|---|---|---|---|---|
| Phaser | `IslandWorldView`, `WelcomeHarborScene`; WO:184-330, 12 ids | `PirateBuilderBayWorldView`; WO:348-445, 8 ids | `WonderwildForestWorldView`; WO:473-595, 10 ids | `StorykeeperCastleWorldView`; WO:621-830, 15 ids |
| Three.js | `manifests/welcomeHarbor.ts`, `/explore/welcome-harbor` | `manifests/pirateBuilderBay.ts` (imports the Phaser table) | `manifests/wonderwildForest.ts` (imports the table; no `.location.ts`) | `manifests/storykeeperCastle.ts` + trophy, observatory, chamber tables |
| Entry / exit | Card hub links both (all bands). Every 3D and Phaser exit lands on the Phaser harbor | Phaser "Try walking" and 3D "early preview" (all bands). 3D exit to Phaser harbor | Non-Sprouts: 3D first, Phaser "from above". **Sprouts: Phaser only** | Both, 3D labelled preview. [MVP] non-Sprouts 3D "Enter the castle", Sprouts Phaser first |
| Adventures | `repair-the-moonlight-bridge` start (also on card page) | `repair-the-moonlight-bridge`, `three-planks` (Sprout), `tide-gate` (Explorer) | `buzz-and-the-waggle-dance` (Pathfinder) | `the-storykeepers-tale`; [MVP] `quills-picture-story` Sprout, Explorer Secret Door inside |
| NPCs | Phaser Chatty follower; 3D Pip plus a stationary Chatty prop (LAI-2201) | Pip | Buzz, Chatty | Quill and supporting NPCs (NPC Manager) |
| Discoveries / rewards | `harbor-tide-pool`, `harbor-keepers-door`: Phaser and 3D (LAI-2201) | none unique | waggle-dance discovery | castle finds, trophies |
| World state | `BRIDGE_REPAIRED` tiles; 3D: broken stubs and fallen plank, or the repaired deck (LAI-2201) | `BRIDGE_REPAIRED` scenery requirement | `WAGGLE_DANCE_DISCOVERED` bloom variant | `FIRST_STORY_TOLD` and room states |
| Jumping | default on, nothing jumpable authored | jumpable crates; bridge recovery tested | default on, nothing authored | per-band: Sprout flat markers, pads for others; non-jump route |
| Collision / recovery | canal, open sea and the broken bridge gap (gated on `BRIDGE_REPAIRED`); checkpoints | colliders, bridge checkpoints, `bridgeFallRecovery.engine.test.ts` | default | five engine checkpoints; castle checkpoints not yet on `gameplay.checkpoints` (GE-076 item 4) |
| Camera | default | default | default | indoor profile, wall-height tests |
| Accessibility / touch | HUD list; touch | same | same; Sprout refusal for adventure | `noReticleBands: ['SPROUT']`, HUD equivalence test |
| Sprouts | no guided profile | no guided profile | no 3D route offered | flat route; playtest C3 open |
| Parity tests | `welcomeHarborParity` (vs deleted 3D view, not Phaser) | `pirateBuilderBayParity` (vs deleted 3D view) | `wonderwildForestParity` (vs deleted 3D view) | `castleRebootContracts` C-1, `storykeeperCastleParity` |
| Missing | Exits still land on Phaser routes (GE-077); Chatty is a still prop, not the Phaser follower; placeholder-quality scenery until LAI 07 models | Phaser-table parity test | Sprouts 3D route (WF-10); parity test | C2 visual, C3 Sprouts, C4 devices, C5 owner |
| Other agents | none recorded | LAI 01 (Pip, unconfirmed) | none recorded | LAI 02 |
| Readiness | Ready pending default route (GE-077), Sprouts, owner (LAI-2201 built, not owner accepted) | Ready pending default route, G3, Sprouts, owner | Ready pending WF-10, G3, owner | Ready pending C2 to C5 |

| | Dragon's Sanctuary | Fossil Ridge Camp | Castle Writing Room | Bolt's Workshop |
|---|---|---|---|---|
| Phaser | `DragonsSanctuaryWorldView` (**orphaned**), WO 3 ids | `FossilRidgeCampWorldView`; WO:884-915, 3 ids | `CastleWritingRoomWorldView`; WO:931-962, 3 ids | `BoltsWorkshopWorldView`; WO:1010-1040, 3 ids |
| Three.js | `manifests/dragonsSanctuary.ts` (own table) | **none** | `manifests/castleWritingRoom.ts` (Phaser table + 2) | **none** |
| Entry / exit | Card page, 3D only; Phaser URL redirects. No exit zone (card link instead) | Phaser walk link; Phaser harbor `fossil-ridge-path` | Both (all bands). 3D exit to **Phaser castle** | Phaser walk link; Phaser harbor `bolts-workshop-path` |
| Unlock | `DRAGON_OF_EMBER_MOUNTAIN_COMPLETE` in Phaser; **3D manifest has no `entryRequirements`** | `DINOSAUR_EXPEDITION_COMPLETE` | `THE_CASTLES_SECRET_DOOR_COMPLETE` (card) | `ROBOT_RESCUE_COMPLETE` |
| Adventures | none here | none at this slug (dinosaur arcs at `fossil-ridge`) | write-your-story (`/locations/castle-writing-room/write`) | none here |
| NPCs | Ember (re-id'd `dragons-sanctuary:talk-to-ember`) | message only | Quill (3D only) | **Bolt (`metBolt`, quest stage)** |
| World state | 3D adds rune, scale, `FORGE_LIT` | none | none | none |
| Jumping / recovery / camera | defaults | n/a | optional steps, flat for Sprouts | n/a |
| Parity tests | `dragonsSanctuaryParity` (vs deleted 3D view) | none | `castleWritingRoomParity` (vs Phaser) | none |
| Missing | `dragons-sanctuary-egg`, harbor exit, unlock guard | the whole region (LAI-2206) | 3D exit target; default route | the whole region (LAI-2208) |
| Other agents | none recorded | LAI 07 (assets) | LAI 02 | LAI 07 (Bolt model, roll animation); NPC Manager owner |
| Readiness | Phaser unreachable; gaps then owner | **Not ready** | Ready pending castle gate | **Not ready** (gates a quest) |

## 4. Shared engine capability gaps (`@lai/game-engine`)

Live play still runs through `createLocationEngine`, which takes only movement, camera and input
from the engine. `createStandardEngine` has no production consumer; engine gameplay reaches realms
only through the bridge (`react/src/features/game-engine/bridge/engineBridge.ts`).
`/animation`, `/character` and `/environment` have no React importer.

| Area | State | Gap | Severity |
|---|---|---|---|
| Walk, run, sprint | Gaits, hold/toggle sprint, touch radii | SDK age-band walk speeds (2.2/2.8/3.2) unused live and disagree with the 4 m/s controller default | Medium |
| Jumping, platforming | Coyote 120 ms, buffer 150 ms, validator rejects jump-only routes | No per-child jump assist (needs owner proposal and ADR per the jumping and accessibility standards); age-band assist only in SDK profiles; GE-L5 geometry-versus-difficulty check absent | Medium-High |
| Swimming, climbing | `SWIMMING`/`CLIMBING` states, water and ladder volumes | No content uses them; no swim/climb clips live | Low |
| Character animation | Engine state machine, blending, root motion | Live game uses `three/playerAnimation.ts`/`playerAvatar.ts` (GE-076 item 7) | Medium |
| Camera, input profiles | First/third person, collision rig, gamepad | **No Sprouts guided tap-to-move profile** (GE-035 deferred to LAI-2104); `guidedSteering` is inert; no input-profile type; no remapping | **High (blocks LAI-2303)** |
| Collision, clearance | GE-L16 clearance, step height, slopes | AABB only; turntable collider unrotated; live terrain `groundHeightAt` (GE-L14) | Low-Medium |
| Checkpoints, recovery | `CheckpointsService`, hazards | GE-L13 fixed here (section 8); castle checkpoints not on engine | Low |
| NPC interactions | `NpcManagerPort` and a fake | No engine NPC component (proximity, facing); behaviour stays in React NPC Manager | Medium |
| Puzzle interactions | SEQUENCE, ALL_HELD, SOCKETS; neutral `learning.answer.submitted` | Three kinds only; engine never grades (correct) | Low |
| Event contracts | `lai.gameplay-event` v1, 17 types, vectors | No v1-to-v2 policy; `ENGINE_API_VERSION` still `0.1.0` after Engine 1.0 acceptance | Low |
| Realm and Adventure SDK | `defineLocation`, `defineRealm`, `defineAdventure`, validator | Location definitions are validated data, not run (runtime swap); GE-L12 fixed here | High (structural) |
| Performance diagnostics | fps and frame stats, renderer gauges | No repeatable FPS and draw-call harness or budget evaluation (LAI-2105, GE-R6) | Medium |
| Mobile rendering | `QualityTier` for particles | DPR caps and `chooseRenderQuality` live in React; two tier vocabularies | Medium |
| Accessibility, reduced motion | Honoured in 12 engine modules; telegraph at least 1.5 s | No remap, no one-switch, no jump assist; parked live reduced-motion edits (`park/sc-final-d-20261118`) not adopted | Medium-High |

Jumping: every shipped Area has jumping on (default), and required routes are validated
non-jump. "All adventures introduce jumping" is therefore met by default for Three.js worlds; the
age-band accommodation (assist, pads versus markers) exists only in the castle
(`CASTLE_MOVEMENT_BY_BAND`). LAI-JMP-01b's per-world jumping decision applies at each conversion.

## 5. Trello reconciliation

| Card | Relevant | Update |
|---|---|---|
| #18 Three.js Engine / Phaser Retirement | Yes (umbrella) | This audit, 27% measure, sequence |
| #27 LAI-2001 to 2305 audit | Yes; LAI-2001 and 2002 delivered by sections 2 to 4 (Development Complete) | Child cards linked |
| #214 GE-001 | Yes | GE-L12, GE-L13 fixed |
| #227 GE-076 | Yes; items 3 to 9 open | Unchanged; cross-link |
| #168 SC-R10-01/02 | Done (Development Complete) | Writing Room exit still targets the Phaser castle |
| #169 SC-R10-03 | Blocked (correctly) | Gate C1 to C5 confirmed |
| #128 LAI-JMP-01b | Yes, at each conversion | Fossil Ridge and Bolt's still Phaser-only |
| #217 GE-030 to 035 | Sprouts guided profile not built | Becomes LAI-2104S (new) |

`tasks/TASK_TRACKER.md` reconciled 2026-11-27 (owner instruction): LAI-2101 done as GE-002;
LAI-2102 done as GE-020 to GE-034 and GE-S1 (the live location runtime is GE-076, not a pure
module); LAI-2103 in progress (GE-003, GE-050 to GE-056 and GE-075 built; the runtime swap is
not done). Each entry names its commits.

## 6. New tasks, owners and handoffs

| Id | Task | Agent | Priority | Depends on | Acceptance and tests |
|---|---|---|---|---|---|
| LAI-2301R | Phaser-table parity for every world: id, action, requirements and world changes, gaps listed by ticket | LAI 04 | P1 | none | **Built** (`phaserParity.test.ts`, 20 tests) |
| LAI-2202 | Pirate Builder Bay: 3D as the default route, Pip, jumping decision, Sprouts route | **LAI 01** (owner, 2026-11-27) | P1 | MVP merged, GE-077 | Default route switch; `phaserParity` stays green |
| LAI-2203 | Wonderwild Forest: Sprouts 3D route (WF-10), 3D default for every band | **LAI 03** (owner, 2026-11-27) | P1 | MVP merged, LAI-2104S, LAI-2303 | Sprouts reach the 3D forest; `phaserParity` stays green |
| LAI-2201 | Welcome Harbor 3D hub parity: the 12 harbor interactions, `BRIDGE_REPAIRED` state, both Phaser-only discoveries | **LAI 04** (owner, 2026-11-27) | P0 for retirement | MVP merged | All 12 ids in 3D; discoveries claimable in 3D; parity test vs `WELCOME_HARBOR_INTERACTIONS` | **Done on `feature/LAI-2201-welcome-harbor-hub` (Development Complete, not merged, not owner accepted):** all 12 ids in `manifests/welcomeHarbor.ts` (imports the Phaser table), repaired-bridge variant, both discoveries claim through `DiscoveryAction`; `GAPS` and `STATE_GAPS` for the harbor removed.
| GE-077 | 3D exits stay in Three.js: `NAVIGATE 'world'` and the Writing Room exit target the 3D hub/castle | **LAI 04** (owner, 2026-11-27); LAI 02 reviews castle | P0 for retirement | LAI-2201 | Exit hrefs; parity tests updated; Phaser routes unchanged |
| LAI-2205 | Dragon's Sanctuary gaps: egg interaction, exit, `entryRequirements` unlock guard | **LAI 04** (owner, 2026-11-27) | P1 | none (but touches manifests: after MVP) | Direct URL refused before unlock; ids present |
| LAI-2206 | Fossil Ridge Camp Three.js region (3 interactions, unlock) | **LAI 03** (owner, 2026-11-27); LAI 07 assets | P2 | LAI-2201 hub link | Manifest, parity test, jumping decision (LAI-JMP-01b) |
| LAI-2208 | Bolt's Workshop Three.js region with Bolt (`metBolt`, quest stage) | **No owner yet**; stays in Backlog until MVP acceptance (owner, 2026-11-27); LAI 07 assets; NPC Manager owner | P1 (quest) | LAI-2201, MVP acceptance | Bolt talk sets `metBolt` in 3D; quest stage 1 reachable |
| LAI-2104S | Sprouts guided profile in the engine: tap-to-move, assisted camera, no free look, large targets | LAI 04 | P0 for retirement | owner decision O6 (options in section 10). **Not started**; groundwork `movementSpecForProfile` built | Controller tests; profile applied by age band; no realm edits |
| LAI-2303 | Sprouts playtest (human, APPROVAL) | Owner | P0 | LAI-2104S, 2201, 2202 | Owner record |
| R7 | Rename `IslandWorldView.module.css` to a neutral name | LAI 04 | P2 | MVP merged (it edits that file) | Imports updated; ratchet list emptied |
| LAI-2304 | Remove Phaser (APPROVAL) | LAI 04, LAI 05 integrates | after all | every world G1 to G5 | Ratchet inventory empty; package gone |

Handoffs:

- **LAI 01 (Treasure Rush, Pirate Builder Bay owner):** LAI-2202. After the MVP round: make the
  3D bay the default route for every band (Phaser kept as a secondary link until LAI-2304), keep
  `phaserParity` green (the bay already matches its Phaser table), record the jumping decision
  (LAI-JMP-01b), and give Sprouts a route (after LAI-2104S). Pip's harbor placement in LAI-2201 is
  reviewed by you.
- **LAI 02 (Storykeeper):** castle gate C2 to C5; the 3D Writing Room exit to the Phaser castle
  (GE-077 changes it; review); `p0-navigation.spec.ts:199` breaks with #106's Sprouts-only link
  (update the spec in #106 or a follow-up).
- **LAI 03 (Firepeak, North Pole; Wonderwild Forest and Fossil Ridge Camp owner):** LAI-2203
  (forest: Sprouts 3D route per WF-10, then 3D default for every band; it matches its Phaser
  table today) and LAI-2206 (Fossil Ridge Camp region: 3 interactions, unlock guard, exit to the
  3D hub; LAI 07 assets). Both wait for the MVP round; LAI-2206 also waits for LAI-2201. Engine:
  GE-L13 changes recovery only for out-of-order marks; the bridge result is unchanged. #114 moves
  `engineApi` in the Heart and North Pole definitions to `>=0.1.0 <1.0.0` (one line each).
- **LAI 05 (Integration):** the e2e break above at merge readiness; this branch touches no MVP
  file; integrate after the MVP cycle.
- **LAI 06 (Scoring):** none of this changes grading. Note that the two harbor discoveries and
  `metBolt` must keep emitting the same claims after LAI-2201 and LAI-2208.
- **LAI 07 (Asset Library):** models for Fossil Ridge and Bolt's Workshop (skeleton, dig tools,
  Bolt with roll animation); Welcome Harbor hub objects for the 12 interactions.

## 7. Now versus after MVP acceptance

**Safe now** (touch no file the MVP candidate changes; owner, 2026-11-27): this audit and its
ratchet tests; engine defects in `game/src` (GE-L12, GE-L13 done); LAI-2301R (done); Sprouts
groundwork that does not depend on O6 (`movementSpecForProfile`, done); Trello and docs.
LAI-2104S itself waits for the owner's O6 choice.

**Wait for MVP acceptance:** anything in `IslandLocationPage.tsx`, `ThreeLocationWorldView.tsx`,
`WorldStage`, `GameplayMenus`, `IslandWorldView.module.css`, the `*Parity.test.tsx` files or
region play (all edited by the candidate): LAI-2201, GE-077, LAI-2205, the R7 rename, route
default switches.

## 8. Development on this branch

| Change | Files | Evidence |
|---|---|---|
| Phaser retirement ratchet | `react/src/test/phaserRetirement.test.ts` | 8 tests pass; removing one inventory entry fails 2 (mutation check) |
| GE-L12: dispose during setup rejects | `game/src/engine/standardEngine.ts`, `stabilization/resourceDisposal.test.ts` | Test fails without the fix, passes with it |
| GE-L13: recovery never moves backwards within a course | `game/src/components/checkpoints.ts`, `stabilization/checkpointState.test.ts` (3 tests) | game 707 passed; React `features/game-engine` (bridge) 134 passed; typecheck clean |
| LAI-2301R: Phaser-table parity | `react/src/test/phaserParity.test.ts` | 20 tests pass; listing a covered interaction as a gap fails (shrink-only check) |
| Sprouts groundwork: `movementSpecForProfile` | `game/src/sdk/profiles.ts`, `sdk/profiles.test.ts` (7 tests) | game 714 passed; game tsc clean. Not wired to any location |
| Tracker reconciliation | `tasks/TASK_TRACKER.md` LAI-2101 to 2103 | Section 5 |
| LAI-2201: Welcome Harbor 3D hub parity | `manifests/welcomeHarbor.ts`, `manifests/welcomeHarborHub.test.ts`, `manifests/welcomeHarborHub.engine.test.ts`, `runtime/welcomeHarborDiscoveries.test.tsx`, `react/src/test/phaserParity.test.ts` | Harbor gaps and `BRIDGE_REPAIRED` state gap removed; counts in `docs/IMPLEMENTATION_STATUS.md`; not owner accepted |

## 9. Recommended sequence

1. (now) Audit, ratchet, engine fixes; LAI-2104S Sprouts profile in the engine; LAI-2301R.
2. (after MVP merge) R7 rename; LAI-2201 harbor hub parity; GE-077 exits into 3D; LAI-2205.
3. Default-route switch per world (bay, forest, castle, writing room), one PR each, Phaser kept
   reachable as the fallback link.
4. LAI-2208 Bolt's Workshop, LAI-2206 Fossil Ridge (assets from LAI 07).
5. LAI-2105 performance harness; LAI-2302 devices (APPROVAL).
6. LAI-2303 Sprouts playtest (owner).
7. LAI-2304 per-world removal behind the ratchet, owner authorization per world; the package
   last; LAI-2305 verification and doc corrections (including `THREEJS_ENGINE_CONVERSION.md`
   sections 2.3 and 3, which predate the generic runtime).

## 10. O6: Sprouts guided tap-to-move, options for the owner

Status: **awaiting the owner's choice**. LAI-2104S does not start until one is picked. Common to
all three: no free look; an assisted third-person camera that turns behind the child; large
interaction targets with a confirm button (no aiming); reduced motion honoured; the existing
joystick and keyboard stay available. Sprouts difficulty is unchanged (`sdk/profiles.ts`:
jump routes optional only, one jump at most in a row, no moving or vanishing platforms, a
checkpoint after every jump). Estimates are engine engineering only, rough, and exclude playtest.

| | A. Tap to walk straight | B. Tap to walk with a path (recommended) | C. Tap the next stepping stone |
|---|---|---|---|
| How the child moves | Taps the ground or an object. The avatar walks in a straight line toward it and stops at the first wall. An object tap walks to approach range and offers its action | Taps the ground or an object. The engine finds a walkable path around walls and props and the avatar follows it. A tap on an unreachable spot goes to the nearest reachable one | Glowing markers placed by the realm author. The child taps the next one (or a big "next" arrow) and the avatar walks the authored segment |
| Hazards | The walk stops before a hazard area or a drop (edge probe); a fall still uses today's recovery | Hazard areas and drops are never on a path; a fall still uses today's recovery | Authors place markers away from hazards; the validator rejects a marker segment that crosses one |
| Jumps | Never jumps on its own. The Jump button still hops in place | Never jumps on its own; paths use walking links only. The Jump button still hops in place | An optional "jump stone" plays a short assisted hop along a link the author marked safe (owner choice: on or off) |
| Non-jump route rule | Not guaranteed by the controller: if the accessible route bends, the child must tap several times. The validator still proves the route exists | **Met by construction**: the path search only uses walkable links, so any goal reachable without jumping is one tap away | Met if the authored graph includes the non-jump route; a validator check proves every required objective is reachable on walking segments |
| Cost | Small: about 1 week. Steering, edge and hazard probe, tap snapping (a port of the runtime's `nearestStandableSpot` into `game/src`), camera | Medium-large: about 3 weeks. A walkable grid built from the Area's colliders, platforms and hazard areas, path search, smoothing, the same camera. Engine-only, unit-testable; no realm authoring | Engine small (about 1 week), content large: markers authored in every Area by every realm owner (8 or more Areas), plus validator rules |
| Risk | Frustration where routes bend (the harbor, the castle) | Grid build time on large Areas (bounded by cell size); terrain heights need `groundHeightAt` (GE-L14) | Predictable but least free; authoring drift as Areas change |

**Recommendation: B.** It is the closest to what Sprouts have in Phaser today (tap anywhere to
walk there), it meets the non-jump route rule by construction rather than by authoring, and it
stays inside the engine with no per-realm work. Build it in two steps: B1 static colliders and
hazard areas (enough for the harbor, bay, forest and castle), then B2 terrain height once a host
provides `groundHeightAt`. A is a reasonable fallback if time matters more than the bent-route
cases; C suits the castle's room-to-room flow but costs every realm owner authoring time.
