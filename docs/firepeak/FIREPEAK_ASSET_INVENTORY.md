# Heart of Firepeak: 3D asset inventory (FPV-16)

Status 2026-11-18: **every model below is Missing.** No binary is committed and none was
downloaded. The adventure is fully playable on fallbacks: each placed asset id draws a labelled
procedural stand-in (`effects.standIns`, shapes in `regionPlayConfig.ts STAND_IN_SHAPES`) until a
version is published, and platforms, lava, steam, gates and cave walls are procedural geometry.

Asset rows are declared by `seed_firepeak_heart` as `catalog.ContentAsset` (origin DJANGO, no
version, tag `firepeak-heart`; `lai/apps/regions/firepeak_heart_layout.py ASSET_DEFS`). The NPC
Manager variants (`seed_npc_firepeak`) use the same character ids, so one upload serves both.

## Common requirements

| Requirement | Value |
|---|---|
| Format | GLB (glTF 2.0 binary), Y-up, metres, origin at the base centre, facing +Z |
| Style | Low-poly, stylised, warm volcanic palette; consistent with the Kenney-style kit already in use |
| Budget | <= 2 MB and <= 10,000 triangles per prop; characters <= 15,000; backdrop <= 20,000 |
| Materials | One material per model where possible; PBR metallic-roughness; emissive for glow (crystals, lava rims, lamp) |
| LOD | Not required (single LOD); the backdrop may ship a lower LOD as a separate version later |
| Collision | Assets carry no physics; collision is authored in the scene (colliders, platforms) or by an Asset Manager collision profile (`docs/ASSET_COLLISION_PROFILES.md`). Recommended profile per row below |
| Animation | Clip names from `docs/THREE_WORLD_ASSET_CONVENTIONS.md` (Idle, Walk, Talk, Wave, Point, Celebrate, ReactHappy, ReactConcerned, Open, Close, Activate) |
| Licence | Owner-supplied; CC0 or a licence recorded in `docs/ASSET_LICENCES.md` with author and source before publication |

## Placed models

| Asset id | Purpose | Scale (w x h x d m) | Collision profile | Animation | Material notes | Fallback (stand-in) |
|---|---|---|---|---|---|---|
| `firepeak-volcano-main` | Backdrop mountain (reused from The Volcano Awakens) | ~60 x 34 x 60 | NONE | none | dark basalt, glowing crater | cone with crater (existing) |
| `firepeak-flint` | Flint, explorer guide | 0.6 x 1.7 x 0.5 | none (NPC) | Idle, Walk, Talk, Wave, Point, Celebrate | explorer clothing, hat | FIGURE |
| `firepeak-kindle` | Kindle, fire spirit | 0.5 x 0.9 x 0.5 | none (NPC) | Idle (float), Talk, Celebrate, ReactHappy | emissive orange, soft | FIGURE |
| `firepeak-professor-basalt` | Professor Basalt, scientist | 0.6 x 1.7 x 0.5 | none (NPC) | Idle, Talk, Point, Celebrate | field coat, goggles | FIGURE |
| `firepeak-cinder` | Cinder, forge keeper | 0.7 x 1.6 x 0.6 | none (NPC) | Idle, Talk, Activate, Celebrate | leather apron, copper | FIGURE |
| `firepeak-ignis` | Ignis, gentle guardian | 1.2 x 2.4 x 1.0 | none (NPC) | Idle, Talk, Wave, Celebrate | stone and warm gold | FIGURE |
| `firepeak-ember-shard` | Collectible ember shard | 0.3 x 0.5 x 0.3 | NONE | none (spin is code) | emissive amber | CRYSTAL |
| `firepeak-heart-crystal` | The Heart of Firepeak | 0.8 x 1.4 x 0.8 | NONE | optional Activate (glow up) | emissive, dim to bright by code | CRYSTAL |
| `firepeak-crystal-pedestal` | Ancient crystal pedestal (reused) | 1.2 x 1.0 x 1.2 | BOX | none | carved stone, gold inlay | PEDESTAL |
| `firepeak-map-sign` | Explorer's map board | 2.0 x 2.0 x 0.3 | BOX | none | wood, painted map | MARKER |
| `firepeak-sign` | Wooden signs | 0.8 x 1.4 x 0.2 | BOX | none | wood | MARKER |
| `firepeak-campfire` | Landing landmark | 1.2 x 0.8 x 1.2 | CYLINDER | optional flicker | wood, emissive embers | BOX |
| `firepeak-tree` | Emberwood trees | 2.5 x 6 x 2.5 | CYLINDER (trunk) | optional sway | dark bark, red-orange leaves | TREE |
| `firepeak-log` | Fallen logs (jumpable) | 3.0 x 0.45 x 0.7 | BOX, jumpable (authored) | none | charred bark | LOG |
| `firepeak-rock` | Volcanic rocks / basalt formations | 1.5 x 1.2 x 1.5 | BOX | none | basalt, columnar facets | ROCK |
| `firepeak-stream` | Little forest stream | 2 x 0.05 x 10 | WALKABLE | optional UV scroll | water | BOX |
| `firepeak-ember-crystal` | Pattern crystals (Emberwood) | 0.5 x 0.9 x 0.5 | NONE | none | emissive, carries a symbol decal | CRYSTAL |
| `firepeak-count-card` | Counting cards | 0.8 x 1.0 x 0.1 | NONE | none | parchment | BOX |
| `firepeak-lava-stone` | Numbered stepping stones (answers) | 1.0 x 0.4 x 1.0 | NONE (platforms carry collision) | none | basalt with number plate | STONE |
| `firepeak-path-marker` | Path choice markers | 0.5 x 1.2 x 0.5 | NONE | none | painted post | MARKER |
| `firepeak-shape-stone` | Shape stones (caverns) | 0.9 x 1.0 x 0.9 | NONE | none | carved stone, shape relief | STONE |
| `firepeak-cave-crystal` | Glowing cavern crystals | 1.0 x 2.0 x 1.0 | BOX | none | emissive blue and purple | CRYSTAL |
| `firepeak-forge-switch` | Forge switches (sequence items) | 0.6 x 1.2 x 0.6 | BOX | Activate | copper, gold, symbol plate | SWITCH |
| `firepeak-gear` | Ancient gears | 2.0 x 2.0 x 0.4 | NONE (out of reach) | spin is code | gold and bronze | GEAR |
| `firepeak-circuit-lamp` | Forge lamp (circuit goal) | 0.6 x 1.6 x 0.6 | BOX | optional Activate | emissive bulb | CRYSTAL |
| `firepeak-rock-sample` | Rock samples (summit science) | 0.6 x 0.5 x 0.6 | NONE | none | basalt, pumice, obsidian looks | ROCK |
| `firepeak-story-stone` | Island-story stones | 0.9 x 1.1 x 0.3 | NONE | none | carved stone, picture relief | STONE |
| `firepeak-arch` | Zone gateway arches, cave entrance, exit landmarks | 4 x 4 x 1 | COMPOUND (two pillars) | none | stone, ruins | ARCH |
| `firepeak-return-portal` | Return to the Landing | 2 x 3 x 0.5 | NONE | optional idle shimmer | emissive gold | PORTAL |

## Requested categories that are procedural (no model needed)

| Category | How it is drawn now | Optional future asset |
|---|---|---|
| Lava surface and river | animated shader plane (`effects.lava`, frozen under reduced motion) | a texture, never required |
| Steam vents | particle plume (<= 48) or still column under reduced motion | `firepeak-steam-vent` rim model |
| Wooden and stone bridges, stepping stones, platforms | platform boxes (`scene.platforming.platforms`, `assetId` supported by the platform runtime) | `firepeak-bridge-wood`, `firepeak-bridge-stone`, `firepeak-platform-basalt` (set `assetId` on the platform in the seed) |
| Cave walls and entrances | colliders with wall meshes, `firepeak-arch` stand-ins at entrances | `firepeak-cave-wall` kit piece |
| Ancient pillars and ruins | gate wall segments, `firepeak-arch` | `firepeak-ancient-pillar`, `firepeak-ruin` |
| Forge machinery | gears, switches, lamp, glow light | `firepeak-forge-machine` |
| Checkpoint markers | engine checkpoint markers | `firepeak-checkpoint-marker` |
| Treasure chests | not used: rewards come from puzzles and shards | existing `treasure-chest` if a chest is added later |

## Uploading and assigning a production model

1. Record the licence (author, source, licence) in `docs/ASSET_LICENCES.md`.
2. Django Admin, Asset Manager: open the Content asset with the id above (it already exists after
   `seed_firepeak_heart`), upload the GLB as a new version, and fix any validation problems shown.
3. Optionally attach a collision profile (column above).
4. A publisher publishes the version and makes it the default.
5. The child's next visit loads it instead of the stand-in; no code change. For characters, then run
   `manage.py seed_npc_firepeak --promote` and publish an NPC release (`docs/firepeak/FIREPEAK_NPCS.md`).
6. To give a platform a model, add `"assetId"` to that platform in `firepeak_heart_layout.py`, bump
   `firepeakHeartVersion`, and re-run `seed_firepeak_heart` (the version gate upgrades the scene).
