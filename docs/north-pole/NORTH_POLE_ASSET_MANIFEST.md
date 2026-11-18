# North Pole: asset manifest (NP-004, NP-021, NP-050)

Status 2026-11-18. **Every North Pole asset is a stand-in until uploaded.** No model, image or
texture has been delivered, and nothing binary is committed. The Area is playable without them:
each placement names a stable asset id, and until a version of that id is published the client
draws the labelled stand-in shape listed below (`stand-in:<entity>`), never the developer magenta
box.

Source of truth: `lai/apps/regions/north_pole_assets.py` (`ASSETS`, 46 definitions: 11 character,
23 prop, 7 collectible, 4 kit-piece, 1 texture). This document mirrors it; when the two disagree,
the Python list wins and this file is corrected. Tests:
`lai/apps/regions/tests/test_north_pole_assets.py`. Audio is not here: the sound inventory is
`docs/north-pole/NORTH_POLE_AUDIO_INVENTORY.md` (design section 8).

## Conventions that apply to every model

- **Format:** glTF 2.0 binary, `.glb`, self-contained (textures embedded as `bufferView`
  images). A `.gltf` is accepted only if every buffer and texture is a `data:` URI; external URIs,
  Draco and meshopt compression are refused (`docs/ASSET_LIBRARY.md` 21.2,
  `docs/THREE_WORLD_ASSET_CONVENTIONS.md` "Uploaded models"). Under 2 MB per file is the target
  (Firepeak art direction); the hard limit is 50 MB (`LAI_ASSET_MAX_UPLOAD_BYTES`).
- **Units and axes:** 1 unit = 1 metre, +Y up, right-handed glTF axes; the front of a character
  or vehicle faces +Z. Convert at export, never at placement.
- **Origin and pivot:** ground-pivoted. The origin is at the centre of the base, the model spans
  `y` from 0 to its height, and the root transform is identity (scale baked into the vertices).
  Flat pieces (`ground-tile-snow`, platforms) sit with their walkable top as described in the
  table: platforms span `y` 0 to their thickness; the ground tile lies at `y = 0`.
- **Dimensions:** the "W x H x D" column is the expected bounding box (X, Y, Z) in metres. The
  stand-in and the layout colliders are sized to it, so a model should fit inside it; a model
  that is much larger can poke through the collider the layout already authored.
- **Collision:** visual mesh and collision stay decoupled. The column below is the default
  `CollisionProfile` staff enter in **Django Admin > Assets > Collision profiles** once the model
  exists (`docs/ASSET_COLLISION_PROFILES.md`); sizes left empty come from the version's measured
  bounds. Gates, zone walls and required ledges are layout colliders owned by the Area scene, not
  by these profiles. Pickups never block.
- **Animations:**
  - Characters list NPC runtime states from `apps.npcs.vocabulary.ANIMATION_STATES`. The GLB
    should name its clips with the standard clip vocabulary (`Idle`, `Walk`, `Talk`, `Wave`,
    `Point`, `Celebrate`, `Run`, `Jump`; `apps/assets/validation.py` `CLIP_VOCABULARY`), and
    the NPC Manager model variant's `animation_map` maps a state to a clip only when the names
    differ. Missing states fall back (`ANIMATION_FALLBACKS`), ending at `idle`.
  - Props list clip names from the same vocabulary (`Idle`, `Activate`, `Open`).
  - Clips are TRS or skinned; exporter default take names (`mixamo.com`, `Action.001`) are
    flagged by validation and must be renamed. No combat, fall-over or scary clips.
  - The seed does **not** declare `clips` on the definitions: a declared clip makes validation
    refuse any version without it. An administrator may declare them after the first upload.
- **Materials:** low-poly, consistent with the Kenney/Quaternius-style kits already in use; one
  material per model where possible (instanced scenery must be one material); metallic-roughness
  PBR or flat vertex colours; textures power-of-two, at most the size listed; emissive for lights
  and the Star (`KHR_materials_emissive_strength` is supported); no transmission or refraction
  (tablets); no text baked into textures (signs and labels are drawn by the game and localised).
- **Calm visuals:** nothing flashes or strobes (lights glow steadily); reduced motion is handled
  by the game, so clips must still read well when played slowly.

## Elves: one base rig, seven definitions

`north-pole-elf-jingle`, `-tinker`, `-peppermint`, `-frosty`, `-noel`, `-ginger` and `-polaris`
are separate `ContentAsset` definitions because each NPC Manager model variant names its own
character asset and the runtime has no per-variant recolouring of uploaded models. They should be
exported from **one shared base rig** (authoring name `north-pole-elf-base`, never an asset row)
with the same skeleton, proportions (about 1.2 m tall) and clip names, differing only in outfit
colours and one accessory each. Uploading the same `.glb` to several elf ids is allowed while the
variants are being made; each id is then replaced by its own version later.

NPC id to model asset (design section 7; `NPC_MODEL_ASSETS` in the Python list):

| NPC id | Character asset |
|---|---|
| `santa-claus` | `north-pole-santa` |
| `mrs-claus` | `north-pole-mrs-claus` |
| `jingle`, `tinker`, `peppermint`, `frosty`, `noel`, `ginger`, `polaris` | `north-pole-elf-<npc>` |
| `snowball` | `north-pole-reindeer-calf` |

## Assets: use, dimensions and stand-in

Placeholder status for every row: **stand-in until uploaded**.

| Asset id | Kind / category | Display name | Intended use | W x H x D (m) | Stand-in |
|---|---|---|---|---|---|
| `north-pole-santa` | character / npc | Santa Claus | NPC santa-claus (placement np-santa) at Santa's Landing; quest giver, finale. | 0.9 x 1.85 x 0.7 | FIGURE |
| `north-pole-mrs-claus` | character / npc | Mrs. Claus | NPC mrs-claus (placement np-mrs-claus) in the gingerbread village; teacher. | 0.7 x 1.7 x 0.6 | FIGURE |
| `north-pole-elf-jingle` | character / npc | Jingle | NPC jingle (np-jingle, np-jingle-mountain): the guide at the landing and the mountain base. | 0.6 x 1.2 x 0.5 | FIGURE |
| `north-pole-elf-tinker` | character / npc | Tinker | NPC tinker (np-tinker) in Santa's Workshop. | 0.6 x 1.2 x 0.5 | FIGURE |
| `north-pole-elf-peppermint` | character / npc | Peppermint | NPC peppermint (np-peppermint) in the Candy Cane Forest. | 0.6 x 1.2 x 0.5 | FIGURE |
| `north-pole-elf-frosty` | character / npc | Frosty | NPC frosty (np-frosty), the elf ice-skating guide at the Frozen Lake. An elf, never a snowman. | 0.6 x 1.2 x 0.5 | FIGURE |
| `north-pole-elf-noel` | character / npc | Noel | NPC noel (np-noel) at the Reindeer Stables. | 0.6 x 1.2 x 0.5 | FIGURE |
| `north-pole-elf-ginger` | character / npc | Ginger | NPC ginger (np-ginger) in the Gingerbread Village. | 0.6 x 1.2 x 0.5 | FIGURE |
| `north-pole-elf-polaris` | character / npc | Polaris | NPC polaris (np-polaris) in the North Pole Observatory. | 0.6 x 1.2 x 0.5 | FIGURE |
| `north-pole-reindeer` | character / creature | Reindeer | Ambient reindeer at the stables and the sleigh team in the finale. | 0.8 x 1.9 x 2 | ANIMAL |
| `north-pole-reindeer-calf` | character / creature | Reindeer calf (Snowball) | Snowball (NPC snowball, placement np-snowball): lost in Pine Hollow, then follows the child home (FOLLOW). | 0.5 x 1.1 x 1.2 | ANIMAL |
| `north-pole-snowman` | prop / scenery | Snowman | Decorative snowmen along the North Road and in the village. Generic three-ball snowman, no film likeness. | 1 x 1.8 x 1 | SNOWMAN |
| `north-pole-christmas-tree` | prop / scenery | Christmas tree | The decorated village tree (the restored Star sits on top in the finale). | 3 x 6 x 3 | PINE |
| `north-pole-snowy-pine` | prop / scenery | Snowy pine | Forest and Pine Hollow trees; instanced many times. | 2 x 4.5 x 2 | PINE |
| `north-pole-candy-cane` | collectible / collectible | Candy cane | Candy cane pickups np-candy-cane-1..5 in the Candy Cane Forest. | 0.3 x 0.6 x 0.1 | CANE |
| `north-pole-candy-cane-tall` | prop / scenery | Giant candy cane | Giant candy canes lining Peppermint's trail in the Candy Cane Forest. | 0.6 x 3 x 1.2 | CANE |
| `north-pole-gingerbread-house` | prop / building | Gingerbread house | Houses of the Gingerbread Village; one rooftop holds the gingerbread fragment. | 6 x 5 x 6 | HOUSE |
| `north-pole-workshop` | prop / building | Santa's Workshop | The workshop building in the santas-workshop zone. | 14 x 8 x 12 | HOUSE |
| `north-pole-workshop-machine` | prop / equipment | Toy workshop machine | Tinker's broken toy machine, restored by the workshop puzzle. | 3 x 2.5 x 2 | GEAR |
| `north-pole-toy-train` | prop / vehicle | Toy train | Toy train on the workshop floor (decoration and conveyor route). | 2.4 x 1 x 0.8 | BOX |
| `north-pole-toy-blocks` | prop / prop | Toy blocks | Stacked wooden blocks and crates on the workshop shelf route. | 0.6 x 0.6 x 0.6 | BOX |
| `north-pole-present` | prop / prop | Wrapped present | Wrapped gifts in the workshop and around the village tree. | 0.6 x 0.6 x 0.6 | GIFT |
| `north-pole-sleigh` | prop / vehicle | Santa's sleigh | The sleigh at Santa's Landing (lift-off in the finale) and the observatory return sled (np-observatory-sled). | 2 x 1.6 x 3.6 | SLEIGH |
| `north-pole-ice-platform` | prop / scenery | Ice platform | Ice floes and the ice bridge pieces at the Frozen Lake. | 2 x 0.4 x 2 | BOX |
| `north-pole-snow-platform` | prop / scenery | Snow platform | Snow ledges on the jump tutorial and Snowflake Mountain terraces. | 2 x 0.5 x 2 | BOX |
| `north-pole-cookie-platform` | prop / scenery | Cookie platform | Cookie steps up to the gingerbread rooftop. | 1.6 x 0.3 x 1.6 | BOX |
| `north-pole-peppermint-platform` | prop / scenery | Peppermint platform | Peppermint stepping stones in the Candy Cane Forest. | 1.6 x 0.3 x 1.6 | BOX |
| `north-pole-bridge` | kit-piece / scenery | Snow bridge | Walkable bridges built by the arithmetic unlocks (required routes). | 3 x 0.4 x 8 | BOX |
| `north-pole-lantern` | prop / scenery | Lantern post | Lantern posts along the North Road and paths. | 0.4 x 2.2 x 0.4 | LANTERN |
| `north-pole-ornament` | collectible / collectible | Ornament | Hidden ornament pickups np-ornament-1..5 (village and North Road). | 0.3 x 0.35 x 0.3 | MARKER |
| `north-pole-star-fragment` | collectible / collectible | Star fragment | The seven Christmas Star fragments np-fragment-<zone>. | 0.4 x 0.4 x 0.15 | STAR |
| `north-pole-christmas-star` | prop / scenery | Christmas Star | The restored Star shown when NORTH_POLE_STAR_RESTORED exists (observatory and village tree top). | 1.6 x 1.6 x 0.4 | STAR |
| `north-pole-observatory` | prop / building | North Pole Observatory | Polaris's domed observatory in the north-pole-observatory zone. | 12 x 10 x 12 | DOME |
| `north-pole-telescope` | prop / equipment | Observatory telescope | Polaris's telescope (star observation puzzle). | 1 x 2 x 2.2 | TELESCOPE |
| `north-pole-snowflake` | collectible / collectible | Snowflake | Snowflake pickups np-snowflake-01..10 (jump routes and the mountain). | 0.5 x 0.5 x 0.1 | CRYSTAL |
| `north-pole-golden-bell` | collectible / collectible | Golden bell | Post-story golden bell pickups np-golden-bell-1..3 in the ice cave. | 0.3 x 0.35 x 0.3 | MARKER |
| `north-pole-gingerbread-cookie` | collectible / collectible | Gingerbread cookie | Gingerbread cookie pickups np-cookie-1..3. | 0.3 x 0.35 x 0.06 | MARKER |
| `north-pole-snowball-collar` | collectible / collectible | Snowball's collar | Snowball's collar pickup np-snowball-collar in Pine Hollow. | 0.3 x 0.1 x 0.3 | MARKER |
| `north-pole-cottage` | prop / building | Snowy cottage | Elf cottages in Christmas Village. | 6 x 5 x 6 | HOUSE |
| `north-pole-stable` | prop / building | Reindeer stable | The reindeer stable (Snowball rests here after coming home). | 10 x 5 x 8 | HOUSE |
| `north-pole-signpost` | prop / scenery | Signpost | Direction signs at zone gates and on the North Road. | 0.8 x 2 x 0.2 | SIGN |
| `north-pole-snowbank` | kit-piece / scenery | Snowbank | Zone walls and gate snowdrifts (2.5 m or taller, not jumpable). | 4 x 2.5 x 1.5 | ROCK |
| `north-pole-ice-formation` | kit-piece / scenery | Ice formation | Ice crystals at the Frozen Lake, the mountain and the ice cave. | 1.5 x 2.5 x 1.5 | CRYSTAL |
| `north-pole-christmas-lights` | prop / scenery | String of lights | Strings of coloured lights on buildings and the landing. | 4 x 0.3 x 0.1 | LANTERN |
| `ground-tile-snow` | kit-piece / scenery | Snow ground tile | groundAssetId of north-pole-village: the TILED_GROUND repeats it every 4 m. | 4 x 0 x 4 | none |
| `north-pole-snow-texture` | texture / texture | Snow texture | Seamless snow texture for authoring the ground tile and snowy surfaces. No runtime consumer reads a texture asset for the Area yet. | n/a (image) | none |

Notes:
- `ground-tile-snow` is a **model** (kind `kit-piece`), not an image: the region's
  `groundAssetId` is drawn as `TILED_GROUND`, which repeats a model every 4 m
  (`react/src/features/region-play/regionManifest.ts`), like `ground-tile` and
  `ground-tile-stone`. An image asset there would not load. Until it is published the Area's
  `FLAT_PLANE` scenery in snow white is the ground.
- `north-pole-snow-texture` (kind `texture`) is an authoring texture with no runtime consumer
  yet; it exists so the source image is versioned beside the tile that embeds it.
- `north-pole-candy-cane-tall`, `north-pole-gingerbread-cookie` and `north-pole-snowball-collar`
  are additions to the requested list: the forest's giant canes, the cookie pickups and the collar
  pickup (design section 5) need asset ids of their own.

## Collision, animation, materials and triangle budgets

| Asset id | Collision profile (shape / behaviour) | Animations wanted | Materials and textures | Triangle budget |
|---|---|---|---|---|
| `north-pole-santa` | CAPSULE / SOLID, radius 0.3. A body, not the arms: the child can walk up to talk. | `idle`, `walk`, `talk`, `wave`, `point`, `celebrate` | Folklore figure in a red coat with white trim; original design, no brand likeness; one 1024 px atlas or vertex colours. | 10,000 |
| `north-pole-mrs-claus` | CAPSULE / SOLID, radius 0.3. A body, not the arms: the child can walk up to talk. | `idle`, `walk`, `talk`, `wave`, `point`, `celebrate` | Original design (apron, shawl); one 1024 px atlas or vertex colours. | 10,000 |
| `north-pole-elf-jingle` | CAPSULE / SOLID, radius 0.25. Elf body; height from the bounds. | `idle`, `walk`, `talk`, `wave`, `point`, `celebrate` | Shared elf base rig and UV layout; one 512 px atlas or flat vertex colours; outfit colour set per elf; no emissive. Green tunic, bell on the hat. | 8,000 |
| `north-pole-elf-tinker` | CAPSULE / SOLID, radius 0.25. Elf body; height from the bounds. | `idle`, `walk`, `talk`, `wave`, `point`, `celebrate` | Shared elf base rig and UV layout; one 512 px atlas or flat vertex colours; outfit colour set per elf; no emissive. Work apron and goggles. | 8,000 |
| `north-pole-elf-peppermint` | CAPSULE / SOLID, radius 0.25. Elf body; height from the bounds. | `idle`, `walk`, `talk`, `wave`, `point`, `celebrate` | Shared elf base rig and UV layout; one 512 px atlas or flat vertex colours; outfit colour set per elf; no emissive. Red and white striped scarf. | 8,000 |
| `north-pole-elf-frosty` | CAPSULE / SOLID, radius 0.25. Elf body; height from the bounds. | `idle`, `walk`, `talk`, `wave`, `point`, `celebrate` | Shared elf base rig and UV layout; one 512 px atlas or flat vertex colours; outfit colour set per elf; no emissive. Pale blue jumper and skates. | 8,000 |
| `north-pole-elf-noel` | CAPSULE / SOLID, radius 0.25. Elf body; height from the bounds. | `idle`, `walk`, `talk`, `wave`, `point`, `celebrate` | Shared elf base rig and UV layout; one 512 px atlas or flat vertex colours; outfit colour set per elf; no emissive. Brown coat, feed bucket accessory. | 8,000 |
| `north-pole-elf-ginger` | CAPSULE / SOLID, radius 0.25. Elf body; height from the bounds. | `idle`, `walk`, `talk`, `wave`, `point`, `celebrate` | Shared elf base rig and UV layout; one 512 px atlas or flat vertex colours; outfit colour set per elf; no emissive. Orange apron, wooden spoon accessory. | 8,000 |
| `north-pole-elf-polaris` | CAPSULE / SOLID, radius 0.25. Elf body; height from the bounds. | `idle`, `walk`, `talk`, `wave`, `point`, `celebrate` | Shared elf base rig and UV layout; one 512 px atlas or flat vertex colours; outfit colour set per elf; no emissive. Navy cloak with star pattern. | 8,000 |
| `north-pole-reindeer` | BOX / SOLID. Box around body and legs. | `idle`, `walk`, `run`, `talk`, `celebrate` | Natural brown and cream fur, antlers; realistic-cartoon; no glowing or red nose (no third-party character); one 1024 px atlas or vertex colours. | 8,000 |
| `north-pole-reindeer-calf` | NONE / DECORATIVE. A follower must never block or trap the child. | `idle`, `walk`, `run`, `talk`, `celebrate`, `jump` | Same palette and style as the adult reindeer, small nubs for antlers, collar socket; no red nose. | 6,000 |
| `north-pole-snowman` | CYLINDER / SOLID, radius 0.45 | none | White snow with soft blue shading, coal and carrot details; vertex colours. | 2,000 |
| `north-pole-christmas-tree` | CYLINDER / SOLID, radius 1. Lower branches block. | none | Dark green needles, baubles and lights as emissive materials (KHR_materials_emissive_strength allowed); one atlas. | 4,000 |
| `north-pole-snowy-pine` | CYLINDER / SOLID, radius 0.3. Trunk only. | none | Green needles with white snow caps; vertex colours; one material for instancing. | 1,200 |
| `north-pole-candy-cane` | NONE / DECORATIVE. A pickup trigger, never a blocker. | none | Red and white stripes; vertex colours or a 256 px texture. | 600 |
| `north-pole-candy-cane-tall` | CYLINDER / SOLID, radius 0.25. The upright stem only. | none | Red and white stripes; vertex colours or a 256 px texture. | 800 |
| `north-pole-gingerbread-house` | COMPOUND / SOLID. One box per wall; the doorway and entrance step stay open. | none | Biscuit brown walls, white icing trim, sweets; one 1024 px atlas. | 6,000 |
| `north-pole-workshop` | COMPOUND / SOLID. One box per wall; the doorway and entrance step stay open. | none | Red timber and snowy roof, warm window glow (emissive); one 2048 px atlas at most. | 12,000 |
| `north-pole-workshop-machine` | BOX / SOLID | `Idle`, `Activate` | Painted metal and wood, brass gears; gears as separate nodes so Activate can turn them. | 4,000 |
| `north-pole-toy-train` | BOX / JUMPABLE | `Activate` | Bright primary colours; vertex colours. | 2,500 |
| `north-pole-toy-blocks` | BOX / JUMPABLE | none | Painted wood with letters or numbers; one 256 px texture or vertex colours. | 300 |
| `north-pole-present` | BOX / JUMPABLE | `Open` | Coloured paper and ribbon; vertex colours; colour variants by placement are not supported, so one neutral-red design. | 400 |
| `north-pole-sleigh` | BOX / SOLID | `Idle`, `Activate` | Red lacquer with gold trim; one 1024 px atlas. | 6,000 |
| `north-pole-ice-platform` | BOX / JUMPABLE. The platform runtime or layout collider owns the real collider; this matches it. | none | Pale translucent-looking blue (opaque material, no transmission); vertex colours. | 300 |
| `north-pole-snow-platform` | BOX / JUMPABLE. The platform runtime or layout collider owns the real collider; this matches it. | none | White snow top, grey rock sides; vertex colours. | 300 |
| `north-pole-cookie-platform` | BOX / JUMPABLE. The platform runtime or layout collider owns the real collider; this matches it. | none | Round biscuit with icing edge; vertex colours. | 400 |
| `north-pole-peppermint-platform` | BOX / JUMPABLE. The platform runtime or layout collider owns the real collider; this matches it. | none | Round red and white swirl; vertex colours or a 256 px texture. | 400 |
| `north-pole-bridge` | BOX / WALKABLE. Required path: kept clear. | none | Wooden planks with snow and rope rails; one 512 px texture or vertex colours. | 1,500 |
| `north-pole-lantern` | CYLINDER / SOLID, radius 0.12. The post only. | none | Black iron post, warm emissive glass; vertex colours. | 800 |
| `north-pole-ornament` | NONE / DECORATIVE. A pickup trigger, never a blocker. | none | Shiny bauble (metallic-roughness), one colour; vertex colours. | 600 |
| `north-pole-star-fragment` | NONE / DECORATIVE. A pickup trigger, never a blocker. | none | Gold, emissive glow; vertex colours. | 600 |
| `north-pole-christmas-star` | NONE / DECORATIVE | `Idle`, `Activate` | Gold with strong emissive glow; one material. | 1,200 |
| `north-pole-observatory` | COMPOUND / SOLID. One box per wall; the doorway and entrance step stay open. | none | White stone, copper dome with an opening slit; one 2048 px atlas at most. | 12,000 |
| `north-pole-telescope` | BOX / SOLID | `Activate` | Brass and navy paint; tube as a separate node so Activate can tilt it. | 3,000 |
| `north-pole-snowflake` | NONE / DECORATIVE. A pickup trigger, never a blocker. | none | White-blue, light emissive; vertex colours. | 500 |
| `north-pole-golden-bell` | NONE / DECORATIVE. A pickup trigger, never a blocker. | none | Polished gold (metallic-roughness) with a red bow; vertex colours. | 600 |
| `north-pole-gingerbread-cookie` | NONE / DECORATIVE. A pickup trigger, never a blocker. | none | Biscuit brown with white icing; vertex colours. | 400 |
| `north-pole-snowball-collar` | NONE / DECORATIVE. A pickup trigger, never a blocker. | none | Red leather with a small bell; vertex colours. | 400 |
| `north-pole-cottage` | COMPOUND / SOLID. One box per wall; the doorway and entrance step stay open. | none | Timber walls, snowy roof, warm windows (emissive); one 1024 px atlas. | 6,000 |
| `north-pole-stable` | COMPOUND / SOLID. One box per wall; the doorway and entrance step stay open. | none | Wooden barn with hay, open front; one 1024 px atlas. | 8,000 |
| `north-pole-signpost` | CYLINDER / SOLID, radius 0.1. The post only. | none | Painted wood with blank boards (labels are drawn by the game, never baked in text). | 500 |
| `north-pole-snowbank` | BOX / SOLID. Layout colliders own walls and gates; this matches them. | none | White snow with blue shading; vertex colours; tiles side by side without seams. | 800 |
| `north-pole-ice-formation` | BOX / AUTO | none | Pale blue, faint emissive; opaque (no transmission). | 1,000 |
| `north-pole-christmas-lights` | NONE / DECORATIVE | none | Emissive bulbs in several colours; no flashing animation (calm, photosensitivity). | 600 |
| `ground-tile-snow` | NONE / DECORATIVE | none | Flat 4 x 4 m tile at y = 0, snow white with a subtle tiling 512 px texture; edges tile seamlessly. | 200 |
| `north-pole-snow-texture` | none (not a model) | none | 1024 x 1024 px, seamless, sRGB colour; no baked lighting. | n/a |

## Licence requirements (every asset)

Every file must be one of:
- **CC0** (preferred; no attribution surface needed), for example Kenney or Quaternius kits
  already used by the project (`docs/ASSET_SOURCING.md`);
- **owner-commissioned** original work, with a written assignment or licence to the owner that
  allows modification and redistribution inside the app;
- **licensed with redistribution rights** (for example a paid kit whose licence allows shipping
  the model inside an app). CC-BY needs an attribution surface built in the same change and the
  owner's acceptance first (as for `feather`).

Before upload, add a row to `docs/ASSET_LICENCES.md` ("Models served from the asset library")
with the asset id, source, author, licence, retrieval date, attribution owed and any
modification. Never:
- trademarked or film characters or likenesses: no red-nosed reindeer, no glowing nose, no film
  or TV snowman likeness, no branded Santa (soft drink or retailer styling), no named
  third-party elves;
- religious symbols (the celebration is secular, ADR-080 NP-D7);
- AI-generated models or textures whose terms do not grant redistribution;
- files ripped from games or marketplaces that forbid redistribution.

## How to upload a model (no code change, no deploy)

Prerequisites: the North Pole seed has created the definitions (origin DJANGO, no version, tag
`north-pole-village`), and you are in the **Asset editor** group to upload and the **Asset
publisher** group to publish (`manage.py ensure_asset_roles`; a superuser assigns people under
Users). The admin path is `DJANGO_ADMIN_URL_PATH` (default `/admin/`).

1. Check the file against this manifest: `.glb`, metres, +Y up, ground pivot, identity root,
   clip names from the vocabulary, inside the dimensions and triangle budget, licence row added.
2. **Asset library > Asset versions > Add** (the upload form). Pick the definition by its id
   (for example `north-pole-snowman`), choose the `.glb`, upload. Validation runs at once: a
   failing file is refused with its findings and nothing is stored; a passing file becomes the
   next version, `VALIDATED`, invisible to children.
3. Storage is whatever the environment already configures (`LAI_ASSET_STORAGE`): local disk
   (`lai/.asset-storage/`) in development, the private S3 bucket (`LAI_ASSET_BUCKET`) in AWS. No
   step here touches AWS by hand.
4. Optional: open the version's **Preview** to see the model in 3D, with **Show collision**.
5. Select the version, action **Publish selected versions**. The first published version of a
   definition becomes its default; for a later one, select it alone and run **Make the selected
   version the default**.
6. **Assets > Collision profiles > Add**: pick the asset and enter the shape and behaviour from
   the table above (sizes empty unless a radius is listed). Check "What the game uses".
7. Characters only: in the NPC Manager, the character's model variant already names the asset;
   add `animation_map` entries only for clips that do not use the standard names.
8. The bootstrap's `catalog.assets[].deliverable` becomes true for that id, and the **child's next
   visit** to North Pole Village loads the model in place of the stand-in. No React build, no
   deploy, no seed re-run.

Rollback: select an earlier version and run **Roll back**; retiring the default needs a
replacement (`docs/ASSET_LIBRARY.md` 21.4). `manage.py asset_storage_audit` lists stored files
with no row and rows whose file is missing.

**Import commands.** `manage.py import_assets --from-bundled` imports only export-origin
definitions with a bundled file under `react/public`, and the Treasure Rush pack commands
(`import_treasure_rush_environment`, `import_treasure_rush_palm_trees`) only their own declared
packs. None of them covers these Django-origin definitions, so Django Admin is the upload path. A
North Pole pack command, if wanted, would declare files and SHA-256 in
`apps/assets/model_packs.py` like the Treasure Rush packs; it is not built.

## How placeholders work

- The seed creates each definition with **no version**, so the asset resolver answers
  `unavailable` for it and the bootstrap marks it not deliverable.
- Every placement and stand-in in the Area scene names an entity and a shape from the closed
  stand-in vocabulary (`STAND_IN_SHAPES`: the Firepeak shapes plus `PINE`, `STAR`, `GIFT`,
  `SNOWMAN`, `CANE`, `LANTERN`, `HOUSE`, `DOME`, `SLEIGH`, `ANIMAL`, `SIGN`, design section 9).
  The client draws that shape, coloured and labelled, at the placement's position and scale.
- Gameplay never depends on the model: colliders, gates, pickups, puzzles and NPC interactions
  come from the Area scene and Django, so a stand-in world is complete and winnable.
- Once a version is published and made default, the next visit loads the model instead; the
  stand-in disappears with no code or data change. Retiring the version brings the stand-in back.
- Missing audio is silent, separately (design section 8).

## Owner sourcing checklist

- [ ] Choose a source per group: characters (Santa, Mrs. Claus, seven elves from one rig,
      reindeer and calf), buildings (workshop, observatory, cottage, stable, gingerbread house),
      scenery and props, platforms and bridge, collectibles, ground tile.
- [ ] Prefer a CC0 kit; otherwise commission, or license with redistribution rights.
- [ ] Confirm no trademarked likeness (no red-nosed reindeer, no film snowman, no branded Santa)
      and no religious symbols.
- [ ] Record every file in `docs/ASSET_LICENCES.md` before upload (source, author, licence,
      date, attribution, modifications).
- [ ] Export each as a self-contained `.glb`: metres, +Y up, ground pivot, identity root, within
      the dimensions and triangle budget above, embedded textures, no Draco or meshopt.
- [ ] Characters: clips named `Idle`, `Walk`, `Talk` at least (plus `Wave`, `Point`,
      `Celebrate`; reindeer `Run`, calf `Jump`); no combat or scary clips.
- [ ] Props with motion: separate nodes for moving parts (machine gears, telescope tube) and an
      `Activate` clip; the present's `Open`.
- [ ] Upload, preview, publish and make default in Django Admin; add the collision profile.
- [ ] Play North Pole Village on a tablet and check scale against the child avatar, that no model
      blocks a required walking route, and that lights do not flash.
- [ ] Tell the developers which ids are live so the status here can be updated per asset.
