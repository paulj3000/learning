# Three.js Engine Conversion (Migration B)

Status: **Accepted direction (ADR-020), plan only.** No application code was changed to
produce this document. Decision: `docs/DECISIONS.md` ADR-020. Task detail:
`docs/DJANGO_MIGRATION_ROADMAP.md` Phases 20 to 23. Tracker: `tasks/TASK_TRACKER.md`.

Evidence labels: **[repo]** read from files in this repository during this review.
**[not verified]** could not be established from code and is assigned to LAI-2001 or
LAI-2002 to establish. Nothing here comes from running the app on a device.

## 1. What changed and why this document exists

Phase 0 (`docs/DJANGO_MIGRATION_ASSESSMENT.md`) recommended keeping both rendering engines and
deferring a `game/` package. The owner has superseded that: **Three.js is the only gameplay
renderer** and Phaser is retired once every Phaser world has a verified Three.js replacement.
React stays for menus, HUD, dashboards, and admin. See ADR-020.

Two migrations now run in coordination, never inside the same task:

- **Migration A, backend:** Amplify to Django/DRF/PostgreSQL (ADR-019, still Proposed).
- **Migration B, engine:** Phaser/2D gameplay to one Three.js engine (ADR-020, Accepted).

## 2. Inventory of Phaser experiences

### 2.1 Count correction

Phase 0 said "seven Phaser world views". The repository has **eight** [repo]: eight
`LocationScene` subclasses in `src/features/island-map/scenes/` and eight `*WorldView.tsx`
files that import `phaser` (plus `PhaserGameContainer.tsx` and `LocationScene.ts`, ten
`phaser` importers in all). The eight are Welcome Harbor, Pirate Builder Bay, Wonderwild
Forest, Storykeeper Castle, Dragon's Sanctuary, Fossil Ridge Camp, Castle Writing Room, and
Bolt's Workshop. The Phase 0 figure of seven was an undercount; this document treats all
eight as in scope. `phaser` is declared once, in `package.json` (`^4.2.1`).

### 2.2 One shared 2D engine

All eight worlds are thin configurations of one class, `scenes/LocationScene.ts` (668 lines)
[repo]. Each subclass only supplies a `LocationSceneConfig`: interactions, zone rectangles,
NPC definitions, decor, tile grid, colliding tiles, tile overrides, spawn point, world size.

| Concern | Existing Phaser behaviour [repo] |
|---|---|
| World | 30 x 20 tile grid at 32 px (960 x 640), shared constants in `tilemap.ts`; ground drawn from a canvas-generated tileset of flat colours |
| Movement | Arrow keys and WASD; tap or click on the ground sets a `touchTarget` the avatar walks to; speed 220 px/s |
| Camera | Follows the avatar; lerp 0.15, or 1 (no smoothing) under `prefers-reduced-motion` |
| Collision and physics | Phaser Arcade physics; circular avatar body (radius 16) against the ground layer's colliding tiles; world bounds. No other physics |
| Interactions | Zone rectangles fire `APPROACH` interactions on overlap; `TAP` interactions come from tappable sprites. Actions: `START_ADVENTURE`, `NAVIGATE`, `SHOW_MESSAGE`, `TALK_TO`, `DISCOVER` |
| World change | `tileOverrides`: once a `changeKey` is recorded, one tile id is swapped for another across the grid; decor can be gated by `requiredChangeKey` |
| NPCs | Data-driven follower framework (`npcs.ts`); only Welcome Harbor supplies NPC definitions (Chatty). The other seven pass `npcs: []` |
| Ambient | Decor sway, water shimmer; both skipped under reduced motion |
| Avatar | Drawn from `avatarKey` via `avatarAppearance.ts` (body and accent colours, one accessory shape) |
| Assets | **None loaded.** No `load.image`, spritesheet, atlas, or audio call exists in `scenes/`. Everything is drawn procedurally |
| Event boundary | Scene emits only through `WorldEventBus` (`worldEvents.ts`); it never touches React, adventures, or AI |

Because assets are procedural, "existing assets" to reuse are the **data** (grids, zones,
decor lists, interaction tables, palettes), not art.

### 2.3 Per-world inventory

Interaction counts are `id:` entries in each `*_INTERACTIONS` table in `worldObjects.ts`.

| # | World (route under `/island/:childId/world/`) | Interactions | Educational objective source | World change | Unlock | Existing tests [repo] | Existing 3D |
|---|---|---|---|---|---|---|---|
| 1 | Welcome Harbor (`""` index) | 12 (adventure start, 6 location links, NPC, 2 objects, 2 discoveries) | Hub; starts "Repair the Moonlight Bridge" | `BRIDGE_REPAIRED` swaps bridge tiles | Always | `IslandWorldView.test`, `tilemap/zones/decor/npcs.test`, `worldObjects.test`, `worldEvents.test` | **Yes**: `three/welcomeHarborScene.ts` (450 lines), `welcomeHarborRegion.ts`, route `welcome-harbor-3d` |
| 2 | Pirate Builder Bay (`pirate-builder-bay`) | 8 | Measurement and bridge repair, adventure `repair-the-moonlight-bridge` (counting, measurement, sorting, reading instructions per CLAUDE.md section 5) | `BRIDGE_REPAIRED` | Always | `PirateBuilderBayWorldView.test`, tilemap/zones/decor tests | **Yes**: `three/pirateBuilderBayScene.ts` (384), `pirateBuilderBayRegion.ts`, route `pirate-builder-bay-3d`; it is the Phase 33 golden path |
| 3 | Wonderwild Forest (`wonderwild-forest`) | 10 | Observation and evidence reasoning, adventure `buzz-and-the-waggle-dance` | `WAGGLE_DANCE_DISCOVERED` blooms the whole floor | Always | `WonderwildForestWorldView.test`, tilemap/zones/decor tests | None |
| 4 | Storykeeper Castle (`storykeeper-castle`) | 11 | Comprehension, sequencing, vocabulary, adventure `the-storykeepers-tale` | `FIRST_STORY_TOLD` | Always | `StorykeeperCastleWorldView.test`, tilemap/zones/decor tests | **Data only**: `three/storykeeperCastleRegion.ts` (674), `castleChoiceBindings.ts`, asset kit (SC-0, SC-1 done). No scene yet (SC-2 onward) |
| 5 | Dragon's Sanctuary (`dragons-sanctuary`) | 3 (NPC, object, exit) | Locations table lists Empathy, Observation; no adventure is started here | none | `DRAGON_OF_EMBER_MOUNTAIN_COMPLETE` | `DragonsSanctuaryWorldView.test`, tilemap/zones tests | None |
| 6 | Fossil Ridge Camp (`fossil-ridge-camp`) | 3 | Observation, Reasoning (locations table); none started here | none | `DINOSAUR_EXPEDITION_COMPLETE` | `FossilRidgeCampWorldView.test`, tilemap/zones tests | None |
| 7 | Castle Writing Room (`castle-writing-room`) | 3 | Curiosity, Creative writing (locations table); none started here | none | `THE_CASTLES_SECRET_DOOR_COMPLETE` | `CastleWritingRoomWorldView.test`, tilemap/zones tests | None. **Overlaps SC-9** (see section 6) |
| 8 | Bolt's Workshop (`bolts-workshop`) | 3 | Problem-solving, Empathy (locations table); none started here | none | `ROBOT_RESCUE_COMPLETE` | `BoltsWorkshopWorldView.test`, tilemap/zones tests | None |

Also present, not Phaser: the Three.js sandbox (`three/sandboxScene.ts`, 207 lines, route
`three-sandbox`) and non-world card routes (`WelcomeHarbor`, `IslandLocationPage`,
`WorldHubPage`, `TravelDeck`). Creature Care Cove and Lantern Tide Pools appear in
`island/locations.ts` as a second world; no Phaser view for them exists [repo].

**Not verified (LAI-2001 must settle):** the exact adventure templates reachable from worlds
5 to 8 through their parent locations; how NPC interactions in worlds 2, 4, 5, 8 are
rendered given `npcs: []`; every reward and achievement ID those worlds can grant; and
whether any adventure is reachable **only** through a Phaser world (the card routes suggest
not, but that is unconfirmed). Do not infer progression rules from this table.

### 2.4 Phaser coupling that removal must handle

- Ten files import `phaser`. Deleting them is mechanical; the risk is shared files.
- `three/PirateBuilderBayWorldView.tsx`, `WelcomeHarborWorldView.tsx` and
  `ThreeSandboxWorldView.tsx` import `../IslandWorldView.module.css`. That stylesheet must be
  moved to a neutral name **before** `IslandWorldView.tsx` is deleted.
- The 3D views import `../worldObjects` (shared interaction tables), `../DiscoveryAction`,
  `../NpcConversation`, `../useExplorableWorld`. These are shared and survive.
- The 3D code does **not** import the 2D `tilemap`, `*Zones`, or `*Decor` modules [repo], so
  those, their tests, `gridGeometry.ts`, `worldEvents.ts`, `npcs.ts`, `decor.ts`, and
  `avatarAppearance.ts` become deletion candidates only after LAI-2001 confirms no 3D or React
  consumer remains. `avatarAppearance.ts` may still be needed by a 3D avatar.
- `lib/motionPreference.ts` is shared with Canvas 2D portraits; keep it.
- `scripts/generate-world-assets.ts` and several comments mention Phaser; check at removal.

## 3. Existing Three.js capabilities available for reuse

All paths under `src/features/island-map/three/` [repo]. "Reuse" means candidate, to be
confirmed by LAI-2002.

| Capability | Where | Assessment |
|---|---|---|
| Scene lifecycle | `ThreeGameContainer.tsx` (mount once, dispose handle, `instanceKey` rebuild); `sceneKit.ts` `createSceneBootstrap` | Reusable as the seed of the engine lifecycle. Each region's scene file is still bespoke |
| First-person movement | `firstPersonController.ts` (116 lines): acceleration, deceleration, pitch clamp, axis-separated AABB collision, no scene or renderer dependency | Reusable as is. Pure and unit-tested |
| Camera and look | `pointerControls.ts`: pointer-lock, touch look and move | Reusable. Only a first-person profile exists |
| Physics | AABB `Box3` colliders only. No gravity, jumping, rigid bodies, or physics library | **Gap** versus the owner's "physics" line. Decide in LAI-2003 whether AABB suffices |
| Interactions | `APPROACH_RANGE_METERS` 2.5, `RAYCAST_RANGE_METERS` 4, raycast reticle; `sandboxTriggers.ts`, `npcApproachBridge.ts` | Reusable |
| Engine event contract | `worldEngineEvents.ts` typed bus with semantic IDs (`regionId`, `zoneId`, `entityId`, `interactionId`, `worldStateKey`) | Reusable; this is the engine's public output surface |
| Model loading and assets | `assets/assetLoader.ts` (cache, instancing, LOD), `gltfAssembler.ts`, `manifest.ts`, `primitives.ts`, `animationVocabulary.ts`; conventions in `docs/THREE_WORLD_ASSET_CONVENTIONS.md` | Reusable. Assets are generated procedurally by `scripts/generate-world-assets.ts` |
| Animation | Clip vocabulary and glTF animation channels exist; `AnimationMixer` use in scenes is **[not verified]** | LAI-2002 |
| Region definitions | `welcomeHarborRegion.ts`, `pirateBuilderBayRegion.ts`, `storykeeperCastleRegion.ts`: data with colliders, zones, checkpoints, spawns | Seed of a shared `WorldDefinition`. Today each is a hand-written TS module with its own shape [not verified] |
| Checkpoints | `features/discovery/checkpoints` imported by scenes and regions | Engine-to-feature import that extraction must invert |
| HUD | `WorldHud.tsx` (React overlay) | Stays in React |
| Environmental effects, world transitions | Not found as shared systems. Navigation between worlds is by React route (`NAVIGATE` action) | **Gap.** LAI-2003 decides in-engine transitions versus route changes |
| Tests | 15 test files in `three/` plus 5 in `three/assets/` | Strong base for parity tests |

## 4. Proposed unified engine architecture

Boundaries only. Directories are created when the first real file needs them, not up front.

```text
Learning Adventure Island
  react/   menus, HUD, dashboards, admin, route shells; talks to Django via react/src/api
  game/    reusable Three.js engine package; no React, no Django, no AWS SDK imports
  lai/     Django + DRF: islands, adventures, quests, inventory, progression, admin
```

Candidate `game/src` areas, each earning its directory from existing code:

| Area | Seeded from | Notes |
|---|---|---|
| `core/` | `sceneKit.ts`, `ThreeGameContainer` handle contract, `worldEngineEvents.ts` | Lifecycle (create, start, pause, dispose), event bus, frame loop |
| `worlds/` | `*Region.ts` | One validated `WorldDefinition` schema loaded from data. New islands and adventures are data, not code |
| `player/`, `controls/`, `camera/` | `firstPersonController.ts`, `pointerControls.ts` | Input profiles (section 4.2) |
| `interactions/` | `sandboxTriggers.ts`, `npcApproachBridge.ts`, raycast | Zones, targets, prompts |
| `assets/` | `three/assets/*` | Loader, manifest, LOD |
| `animation/`, `effects/`, `characters/` | new, as the first converted world needs them | Do not create empty |
| `quests/`, `collectibles/` | new only if needed | Likely thin: the engine **emits** events; quest and reward rules stay in the platform layer |
| `networking/` | none | See risk R6. Not built |

### 4.1 Rules the engine keeps (carried from ADR-007/008)

- The engine never validates answers, awards progress, decides mastery, or calls AI. It emits
  typed events and renders state it is given.
- Durable state uses semantic IDs, never Three.js UUIDs or raw camera transforms.
- The engine imports nothing from `features/*/api`, `lib/data-client`, `aws-amplify`, or a
  Django client. A boundary test (LAI-0203 now, LAI-2101 after extraction) enforces this.
- Feature data the engine needs (for example checkpoints) is **passed in** through the
  `WorldDefinition`, not imported.

### 4.2 Input and camera strategy

The owner's mandate removes Phaser as the fallback for the youngest band. ADR-008 left
Sprouts (ages 3 to 4) on the card hub **and the Phaser view** because the Sprouts
first-person playtest has not run (`docs/PILOT_READINESS.md` section 5). So the engine must
ship more than a first-person profile:

| Profile | For | Controls |
|---|---|---|
| First-person | Pathfinders, Explorers (existing) | Keyboard and mouse pointer-lock; touch look and move |
| Guided third-person or fixed-camera, tap-to-move | Sprouts, and anyone for whom look controls are hard | Tap or click a destination; no free look; large targets; reduced-motion safe. Replaces the Phaser tap-to-move behaviour |
| HUD equivalents | All | Every learning step reachable from the React HUD, as `docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` SC-11 already requires |

Keyboard-only and screen-reader reachability of every interaction stays a hard requirement.
Mobile strategy: touch is first-class on tablets (CLAUDE.md "tablet-first"). Gamepad is not
required and is not planned.

### 4.3 Content architecture

Hierarchy: Island, then Adventure (Quests, Challenges, Rewards), as in the owner's brief. An
Island is a `WorldDefinition` bundle plus catalog rows; an Adventure is catalog content
loaded by the engine. Adding either must not require new AWS infrastructure, new React
routes, or a new renderer. Today routes are hand-written per world in `AppRoutes.tsx`; the
target is one parameterised world route driven by the catalog. LAI-2103 delivers this.

### 4.4 Performance budgets (proposed, to be validated)

No budget exists today (`docs/WHITE_PAPER.md` lists "detailed performance budgets" as pending).
These are **proposed targets**, not measurements. LAI-2002 captures the current baseline and
LAI-2105 turns them into automated checks; LAI-2302 validates on real hardware. The target
device list is an open question (section 8).

| Metric | Proposed target | Rationale |
|---|---|---|
| Frame rate | 30 fps sustained minimum, 60 fps goal, on the target tablet/Chromebook | Tablet-first |
| Draw calls per frame | 150 or fewer in the densest room | SC-11 already profiles this; instancing exists |
| Time to first walkable frame | 4 s or less on the target device, after the route chunk loads | Short sessions for ages 3 to 8 |
| Per-world download | 5 MB or less compressed, lazy-loaded per world | Existing routes are lazy-loaded |
| Memory | No growth across 5 enter/exit cycles (dispose correctness) | Matches `ThreeGameContainer` dispose contract |

Numbers are starting points for the owner to confirm, not facts about current performance.

## 5. Conversion matrix

"Reuse" lists what carries over. "New 3D work" is what has no counterpart today. Gameplay
rules, educational objectives, progression, and content are preserved; only the renderer
changes. Phaser for a world is deleted only in LAI-2304, after its row is verified.

| World | Reuse | New 3D work | Parity checks (LAI-2301) | Task |
|---|---|---|---|---|
| Welcome Harbor | Interaction table; adventure start; location links; Chatty; `welcomeHarborScene/Region`; existing `welcome-harbor-3d` route | Make 3D the default route; confirm all 12 interactions and `BRIDGE_REPAIRED` appear in 3D; Sprouts profile | Every interaction id reachable; 3 `NAVIGATE` links work; bridge visibly repaired after the change key | LAI-2201 |
| Pirate Builder Bay | `pirateBuilderBayScene/Region`; 8 interactions; Phase 33 slice | Same default-route switch; audit against the 2D table | 8 interactions; adventure start; bridge geometry change; exit to Harbor | LAI-2202 |
| Wonderwild Forest | Interaction table (10); adventure `buzz-and-the-waggle-dance`; zone and decor positions as layout hints; palette | Whole region: terrain, pond collision, beehive, cave, glow moss, night clearing, butterfly; floor-bloom state variant for `WAGGLE_DANCE_DISCOVERED` | 10 interactions; bloom after change key; pond blocks movement | LAI-2203 |
| Storykeeper Castle | Interaction table (11); `storykeeperCastleRegion.ts`; SC-0, SC-1 | Delivered by SC-2 to SC-11 in `docs/STORYKEEPER_CASTLE_3D_ROADMAP.md`; LAI-2204 is the **gate**, not a duplicate plan | 11 interactions mapped to castle rooms; `FIRST_STORY_TOLD` visible | LAI-2204 |
| Dragon's Sanctuary | Interaction table (3); unlock key; layout hints | Small cave region, dragon and egg models, calm ambient animation | 3 interactions; locked until the unlock key; exit | LAI-2205 |
| Fossil Ridge Camp | Interaction table (3); unlock key | Small camp region, assembled skeleton, dig tools | same pattern | LAI-2206 |
| Castle Writing Room | Interaction table (3); unlock key | Reconcile with SC-9 first (section 6); then a small round room | same pattern | LAI-2207 |
| Bolt's Workshop | Interaction table (3); unlock key; `bolt` NPC | Small workshop region, Bolt model with roll animation | same pattern | LAI-2208 |

Suggested order after the engine is extracted: the four 3-interaction worlds first (they
prove the shared lifecycle and `WorldDefinition` loading with almost no new rules), then
Wonderwild Forest, with Welcome Harbor, Pirate Builder Bay, and the Castle running their own
tracks. This is a recommendation; the order is not a dependency except where the roadmap
says so.

## 6. Known conflicts to resolve

1. **Castle Writing Room versus SC-9.** The Storykeeper Castle roadmap's SC-9 builds "the
   pattern lock and the writing room" inside the first-person castle. The 2D Castle Writing
   Room is a separate world unlocked by `THE_CASTLES_SECRET_DOOR_COMPLETE`. They may be the
   same destination. LAI-2207 must decide (merge into SC-9, or keep as a separate world) and
   record it before any work.
2. **ADR-008 Sprouts fallback.** ADR-008 and `docs/ROADMAP.md` Phase 32 name the Phaser view
   as Sprouts' primary route until the playtest passes. ADR-020 removes that fallback; the
   replacement is the guided Three.js profile (section 4.2). Until LAI-2303 clears it,
   Sprouts' primary route stays the card hub (React, not a playable environment) **and** the
   Phaser view, which therefore cannot be deleted before then.
3. **Phase 33 wording.** `docs/ROADMAP.md` Phase 33 says Phaser retires after the Pirate Bay
   slice only. ADR-020 widens that to all eight worlds.

## 7. Risks and compatibility concerns

| ID | Risk | Mitigation |
|---|---|---|
| R1 | Eight worlds, five with no 3D counterpart, plus Castle's SC-2 to SC-11. This is the largest piece of work in the programme and it is art-dependent | One world per task; shared engine first; no world starts before LAI-2103 |
| R2 | Sprouts accessibility unproven for first-person; Phaser was the fallback | Guided profile (4.2); Phaser stays until LAI-2303 passes; human playtest cannot be replaced by tests |
| R3 | Performance on low-end tablets is unmeasured; Three.js can be heavier than 2D tilemaps | Baseline in LAI-2002; budgets in LAI-2105; real-device pass in LAI-2302 |
| R4 | `game/` extraction touches many import paths; engine imports feature data | Do extraction after LAI-0201 (once), move files without behaviour change, invert the checkpoint import, keep tests green per step |
| R5 | `game/` outside `react/` needs a build story (workspace or path alias) and a place for the `three` dependency | LAI-2003 decides and records it; any new tooling is a recorded decision, not a silent dependency |
| R6 | Owner's diagram says "multiplayer-ready sessions". Today co-op is two children sharing adventure state, not shared 3D presence (assessment section 9). Real-time shared worlds would conflict with CLAUDE.md section 12 unless approved | `networking/` is **not** built. The engine only keeps state serialisable and ID-keyed. Any shared-space feature needs its own approved ADR |
| R7 | Shared CSS and components used by both stacks (`IslandWorldView.module.css`) | Relocate before deletion (section 2.4) |
| R8 | Content drift while the same gameplay exists twice | Interaction tables stay single-source in `worldObjects.ts`; both renderers read them; no new Phaser features (ADR-020) |
| R9 | Python port of rules (Migration A) and engine extraction (Migration B) both move `src/` | Sequence: LAI-0201 first, then game extraction; never in one task (section 9) |
| R10 | Art cost: stylised 3D characters and props for five new worlds | Procedural asset generator and kit conventions exist; third-party kit decision stays deferred per the Castle roadmap |
| R11 | Physics expectation: only AABB exists | LAI-2003 states explicitly whether AABB is sufficient; adding a physics library is a recorded decision |

## 8. Open questions for the owner

1. Target devices for budgets (specific tablet and Chromebook models)?
2. Is the guided third-person profile acceptable as Sprouts' in-engine mode, and is the React
   card hub acceptable as the non-graphical navigator (it is conventional UI, not a game
   environment)?
3. Castle Writing Room: merge into SC-9 or keep as its own world?
4. Do the four small worlds need new educational content, or are they reward showcases only
   (current code suggests the latter)?
5. Confirm there is no intent for real-time shared 3D presence (R6).

## 9. Dependencies and parallelism

```text
Track A (backend)              Track B (engine)
LAI-0101 decisions             LAI-2001 inventory (docs)   LAI-2002 capability (docs)
   |                              \_______ LAI-2003 architecture ______/
LAI-0201 move to react/ ----------------> LAI-2101 game/ skeleton + boundary
   |                                          |
LAI-0204 Django skeleton                  LAI-2102 extract modules
   |                                          |
Phases 3-6 ...                            LAI-2103 lifecycle + world loading
                                              |
                                          LAI-2104 controls + interactions
                                              |
                                          LAI-2105 perf harness
                                              |
                                          LAI-2201..2208 one world each
                                              |
                                          LAI-2301 parity, 2302 perf, 2303 Sprouts
                                              |
                                          LAI-2304 remove Phaser, 2305 verify
```

- **Independent now (docs only):** LAI-2001, 2002, 2003. They need neither ADR-019 nor `react/`.
- **Shared prerequisite:** LAI-0201. Both tracks move `src/`; doing it once first avoids
  moving engine files twice. LAI-2101 onward depends on it.
- **Independent of each other after LAI-0201:** Track A Phases 2 to 8 do not touch engine
  code; Track B Phases 21 to 23 do not touch Django. They meet only at Phase 5, where React
  API modules change (`react/src/api`) while world views consume them, and at LAI-1301 when
  Amplify leaves the frontend.
- **Not to be combined:** no task changes both a backend domain and a world conversion. A
  world conversion task must not change data access; it keeps calling the same `api.ts`
  modules, whichever backend they point at.
- **Working app throughout:** the 2D route for a world stays live until that world's parity
  tests and visual validation pass, and until LAI-2304.
