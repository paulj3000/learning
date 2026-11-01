# Treasure Rush: Asset Requirements (Treasure Cove)

**Compiled 2026-11-01 for TR-13** (`docs/TREASURE_RUSH_ROADMAP.md` section 17). Lists what
Treasure Cove's four-zone layout uses today, what it draws as placeholders, and what an artist
needs to deliver to replace each one. Nothing here blocks gameplay work: every missing model has
a placeholder that renders, collides and animates where it should.

Conventions are those of `docs/THREE_WORLD_ASSET_CONVENTIONS.md`: 1 unit = 1 metre, +Y up,
ground-pivoted (origin at the base centre), facing +Z, glTF 2.0 as `.glb` or self-contained
`.gltf`. Collision is never in the model; it is a rectangle in the layout.

## 1. How a placeholder gets replaced

The cove's layout lives in `lai/apps/regions/treasure_cove_layout.py` and reaches the client as
`WorldRegion.scene["layout"]`. The client accepts only asset ids the bundled catalogue
(`react/src/features/island-map/three/assets/manifest.ts`) knows (ADR-030); Django's Asset
Manager then decides which published version a child gets.

**A new version of an existing id** (a better `shipwreck`, a finished `treasure-chest`): upload
and publish it in Django Admin (`docs/ASSET_MANAGER.md` 19.2). No code change, no deploy.

**A new asset id** (`palm-tree`, `pirate-tent`, ...), in this order:

1. Add the id to the bundled catalogue (`manifest.ts`) with its `kind`, clip names, and a
   bundled file under `react/public/models/` (the generated placeholder or the delivered file).
2. `npm run content:export`, then `manage.py load_content` so Django has the `ContentAsset`.
3. Upload, validate and publish the delivered file in Django Admin (`docs/ASSET_MANAGER.md`
   19.2). Validation refuses a version that drops a declared clip.
4. In `treasure_cove_layout.py`, replace the `procedural` entries for that shape with a `MODEL`
   or `CLUSTER` entry naming the id, bump `LAYOUT_VERSION`, and rerun
   `python -m apps.regions.treasure_cove_layout` (the snapshot the frontend tests load).
5. `manage.py seed_treasure_rush` applies the new layout to an existing region (it refreshes
   only the layout, bounds and the old default spawn facing).

## 2. Existing assets the cove uses

All bundled and resolvable today; measured bounds are width x height x depth in metres.

| Asset id | File | Size | Where in the cove | Count |
|---|---|---|---|---|
| `ground-tile` | `ground-tile.gltf` | 4 x 0 x 4 | Grass under the whole cove | tiled |
| `ground-tile-stone` | `ground-tile-stone.gltf` | 4 x 0 x 4 | Ruins floor | tiled |
| `path` | `path.gltf` | 1.5 x 0 x 1.5 | Paths between the landing, beach and ruins | about 60 |
| `path-forest` | `path-forest.gltf` | 1.5 x 0 x 1.5 | Grove paths | about 30 |
| `bridge-plank` | `bridge-plank.gltf` | 0.9 x 0.15 x 3 | Dock deck, drift planks, the X in the sand, broken bridge | 17 |
| `mooring-post` | `mooring-post.gltf` | 0.4 x 1.6 x 0.4 | Dock posts, beach pier stubs | 7 |
| `crate` | `crate.gltf` | 0.8 cube | Landing stack, beach cargo | 11 |
| `barrel` | `barrel.gltf` | 0.65 x 0.9 x 0.68 | Landing, beach (three lying on their side) | 12 |
| `rope-coil` | `rope-coil.gltf` | 0.58 x 0.14 x 0.58 | Landing, beach | 4 |
| `log-fallen` | `log-fallen.gltf` | 0.47 x 0.46 x 2.2 | Campfire seats, grove | 4 |
| `signpost` | `signpost.gltf` | 0.5 x 1.2 x 0.1 | Waymarkers at the landing exits (plus the seeded bridge signpost) | 3 |
| `shipwreck` | `shipwreck.gltf` | 6.4 x 6 x 2.6, placed at 1.5x | Shipwreck Beach centrepiece | 1 |
| `rock` | `kenney-rock-small.glb` | 0.3 x 0.31 x 0.4, placed at 2 to 4.5x | Grove boulders, shore rocks, ruins rubble | 17 |
| `foliage-tree` | `foliage-tree.gltf` | 1.8 x 2.6 x 1.8 | Grove tree line, jungle beyond the west edge (scatter) | 7 plus scatter |
| `foliage-bush` | `foliage-bush.gltf` | 0.5 x 0.32 x 0.41, placed at 2.6 to 3x | The hiding place's ring, grove | 13 |
| `fern` | `fern.gltf` | 1.05 x 0.4 x 0.99 | Grove | 10 |
| `flower-cluster` | `flower-cluster.gltf` | 0.52 x 0.35 x 0.6 | The flower trail to the hidden chest, grove | 14 |
| `archway` | `archway.gltf` | 2.6 x 3 x 0.6, placed at 1.55 x 1.25 | Ruins entrance | 1 |
| `standing-stone` | `standing-stone.gltf` | 0.5 x 1.4 x 0.4 | Three rune stones round the pedestal (TR-16's puzzle) | 3 |
| `butterfly` | `butterfly.gltf` | 0.47 x 0.24 x 0.29 | Ambient movers at the hiding place and the grove path | 2 |
| `treasure-chest` | `treasure-chest.gltf` (clip `Open`) | 0.6 x 0.42 x 0.4 | The seeded chest (TR-14 adds three more) | 1 |
| `npc-pip` | `npc-pip.gltf` (clips `Idle`, `Talk`, `Wave`) | 0.61 x 1.24 x 0.56 | Pip at the landing | 1 |

## 3. Placeholders drawn from primitives, and what replaces them

Drawn by `extensions/regionPlay/proceduralScenery.ts` from the layout's `procedural` entries.
All animate with the scene and hold still under reduced motion.

| Placeholder | Where (count) | Proposed asset id | File | Kind | Clips | Target size (m) | Placement notes |
|---|---|---|---|---|---|---|---|
| `PALM`: trunk, seven fronds, coconuts; sways (instanced) | Grove 19, beach 7, Lookout Point 2 | `palm-tree` | `palm-tree.glb` | kit-piece | `Sway` (optional loop; without it the game sways the whole tree) | 2.5 x 4.5 to 6 x 2.5 | Ground pivot at the trunk base; a slight lean is welcome. A low-detail `palm-tree-lod1` lets the jungle and far palms stay cheap. Instanced, so one mesh and one material is ideal |
| `TENT`: four-sided canvas cone, door flap, pole | Landing camp (1) | `pirate-tent` | `pirate-tent.glb` | prop | none | 3.6 x 2.8 x 3.6 | Door faces +Z. Collider in the layout covers 3.2 x 3.2 |
| `CAMPFIRE`: stone ring, crossed logs, two flame cones; flickers | Landing camp (1) | `campfire` | `campfire.glb` | prop | `Flicker` (loop) | 1.4 x 1 x 1.4 | Lit by a point light in the layout. Flames may be an emissive mesh; no particles needed |
| `TORCH`: pole, iron bowl, flame; flickers | Landing exits 6, ruins archway 2, final chest 2 | `torch-post` | `torch-post.glb` | kit-piece | `Flicker` (loop) | 0.35 x 2 x 0.35 | Ten in the cove, so keep it light (under 500 triangles) |
| `FLAG`: pole and waving cloth | Landing (1, black, 5 m), Lookout Point (1, gold, 7 m) | `pirate-flag` | `pirate-flag.glb` | prop | `Wave` (loop) | 1.8 x 5 to 7 x 0.2 | Cloth flies toward +X from the pole. A gold variant (`pirate-flag-gold`) marks Lookout Point, the goal across the channel |
| `ROWBOAT`: hull, floor, bench, oar; bobs | End of the dock (1) | `rowboat` | `rowboat.glb` | prop | `Bob` (optional loop) | 1.3 x 0.6 x 3.2 | The boat the child arrived in. Sits on the shallows (y 0) |
| `PILLAR`: stone column, capital on tall ones | Ring of eight round the pedestal | `ruin-pillar` and `ruin-pillar-broken` | `ruin-pillar.glb`, `ruin-pillar-broken.glb` | kit-piece | none | 1 x 3.2 x 1 and 1 x 1.4 x 1 | Collider 0.9 x 0.9 each |
| `PEDESTAL`: stepped stone, floating gem that pulses and turns | Ruins centre (1) | `treasure-pedestal` | `treasure-pedestal.glb` | prop | `Glow` (loop) | 2 x 2.1 x 2 | TR-16's puzzle focus. Keep the gem a separate node so the puzzle can light it |
| `GATE`: two stone posts, lintel, iron bars | Ruins south wall (1) | `ruins-gate` | `ruins-gate.glb` | prop | `Open` (once, bars rise; TR-17) | 5.4 x 3.8 x 0.8 | Opening 4 m wide on the ruins' south wall. TR-17 opens it; until then the bars are a named node (`region-play:gate-bars`) |

## 4. Simpler stand-ins also in use

| Stand-in | Where | Wanted |
|---|---|---|
| Solid stone-coloured boxes (`BOX` scenery) | Ruins walls, 15 pieces from 0.9 to 3 m high | `ruin-wall` kit pieces, solid on both sides (the existing `wall-stone` is a single plane): a 2 m straight, a broken end, a corner |
| Flat colour planes (`FLAT_PLANE`) | Sea, shallows, sand, the landing yard, the grove floor, the channel, the dais | `ground-tile-sand` and a shallow-water tile; the sea can stay a plane |
| Gold cone (`interaction-assist:focus-marker`, TR-12) | Over whatever has focus | A small animated arrow or sparkle |
| Gold octahedron (`region-play:beacon:*`, TR-12) | Over each closed chest | A glowing star or shimmer |
| White cones (ambient movers) | Two gull loops | `seagull` (prop, clip `Fly`, about 0.6 m wingspan) |
| Built box chest (TR-8) | Any chest whose model fails | Already covered by `treasure-chest` |

## 5. Needed for the next tasks

| Task | Asset id | Kind | Clips | Size (m) | Note |
|---|---|---|---|---|---|
| TR-14 | `treasure-chest` variants (`-hidden`, `-locked`, `-golden`) | prop | `Open` | as `treasure-chest`, golden 1.2x | The four encounters should look different; the golden one is the finale |
| TR-15 | `treasure-key` | collectible | `Idle` (spin, optional) | 0.3 x 0.15 x 0.05, floats at 0.6 | Found on the X in the sand at (31, 0) |
| TR-17 | `bridge-plank-repaired` | kit-piece | none | exists | Lays the bridge over the channel |
| TR-18 | `npc-pip` new clips | character | `Cheer`, `Point` (plus the existing `Idle`, `Talk`, `Wave`) | as now | Reaction on a found treasure; pointing for hints |

## 6. Publishing checklist (per delivered file)

1. glTF 2.0, `.glb` preferred, self-contained (embedded buffers and textures).
2. Metre scale, +Y up, ground pivot, facing +Z; no transforms left on the root node.
3. Clip names exactly as listed above (case-sensitive); the catalogue declares them.
4. Budget: under 5,000 triangles for a prop, under 1,000 for anything placed more than five
   times; one material where possible (palms and torches are instanced or repeated).
5. A CC0 or owned licence, recorded in `docs/ASSET_LICENCES.md`.
6. Upload, preview, publish and make default in Django Admin (`docs/ASSET_MANAGER.md` 19.2).
