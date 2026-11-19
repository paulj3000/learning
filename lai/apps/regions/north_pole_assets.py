"""North Pole asset definitions (NP-004, NP-021, NP-050): pure data, no Django queries.

The single list of every model and image the North Pole Village Area names. The Wave 3 seed
(`north_pole_seed.py`) creates one `ContentAsset` per entry with `content_asset_defaults`
(origin DJANGO, no version, create-only), so each placement has a stable asset id from day one
and the client draws the entry's stand-in shape until an administrator uploads and publishes a
file. `docs/north-pole/NORTH_POLE_ASSET_MANIFEST.md` is the human-readable manifest of this list
(use, dimensions, collision, clips, materials, licence, upload steps).

Vocabularies:
- `kind` / `category`: `apps.catalog.models.ASSET_KINDS` and `KIND_CATEGORIES`.
- `collision`: `apps.assets.models.CollisionShape` / `CollisionBehavior`; what staff enter as the
  asset's default `CollisionProfile` once a model exists. `None` only for non-model kinds.
- `animations`: characters list runtime states from `apps.npcs.vocabulary.ANIMATION_STATES` (the
  NPC Manager model variant maps each state to a clip); props list clip names from
  `apps.assets.validation.CLIP_VOCABULARY`. The seed does NOT declare them as `clips` on the
  definition, because validation then refuses any version missing one (ASSET_LIBRARY 21.4).
- `stand_in_shape`: the closed stand-in vocabulary of the region-play client
  (`regionPlayConfig.ts`), including the North Pole shapes of design section 9. `None` only for
  the ground tile (drawn by the FLAT_PLANE ground) and for images.

Elves: the seven elf ids are separate definitions (each NPC model variant names its own
character asset, and there is no per-variant recolouring of uploaded models), but they are meant
to be exported from ONE shared base rig (`ELF_BASE_RIG`) with per-elf outfit colours and
accessories, so every elf has the same skeleton, proportions and clip names.
"""

from __future__ import annotations

from dataclasses import dataclass

REGION_TAG = "north-pole-village"
REALM_TAG = "north-pole"
PLACEHOLDER_STATUS = "stand-in until uploaded"
ELF_BASE_RIG = "north-pole-elf-base"  # authoring source only; never a ContentAsset row
GLB = "glTF 2.0 binary (.glb)"
IMAGE = "PNG or WebP (power-of-two, tiling)"

#: The region-play client's stand-in shapes (Firepeak engine shapes plus North Pole's).
STAND_IN_SHAPES = (
    "BOX",
    "TENT",
    "TELESCOPE",
    "PIPE",
    "PEDESTAL",
    "CRYSTAL",
    "PORTAL",
    "STONE",
    "VALVE",
    "MARKER",
    "FIGURE",
    "TREE",
    "LOG",
    "GEAR",
    "SWITCH",
    "ROCK",
    "ARCH",
    "PINE",
    "STAR",
    "GIFT",
    "SNOWMAN",
    "CANE",
    "LANTERN",
    "HOUSE",
    "DOME",
    "SLEIGH",
    "ANIMAL",
    "SIGN",
)


@dataclass(frozen=True)
class Collision:
    """The default `CollisionProfile` staff author once a model exists (sizes from the bounds
    unless `radius` is given)."""

    shape: str
    behavior: str
    radius: float | None = None
    notes: str = ""


@dataclass(frozen=True)
class NorthPoleAsset:
    asset_id: str
    kind: str
    category: str
    display_name: str
    intended_use: str
    model_format: str
    dimensions_m: tuple[float, float, float] | None  # (width X, height Y, depth Z); None: image
    collision: Collision | None
    animations: tuple[str, ...]
    materials: str
    stand_in_shape: str | None
    triangle_budget: int | None  # None for images
    placeholder_status: str = PLACEHOLDER_STATUS
    extra_tags: tuple[str, ...] = ()


# Shared collision profiles.
NPC_BODY = Collision(
    "CAPSULE", "SOLID", 0.3, "A body, not the arms: the child can walk up to talk."
)
SMALL_NPC_BODY = Collision("CAPSULE", "SOLID", 0.25, "Elf body; height from the bounds.")
PICKUP = Collision("NONE", "DECORATIVE", notes="A pickup trigger, never a blocker.")
BUILDING = Collision(
    "COMPOUND", "SOLID", notes="One box per wall; the doorway and entrance step stay open."
)
PLATFORM = Collision(
    "BOX",
    "JUMPABLE",
    notes="The platform runtime or layout collider owns the real collider; this matches it.",
)
DECOR = Collision("NONE", "DECORATIVE")

CHARACTER_CLIPS = ("idle", "walk", "talk", "wave", "point", "celebrate")
ELF_MATERIALS = (
    "Shared elf base rig and UV layout; one 512 px atlas or flat vertex colours; outfit colour "
    "set per elf; no emissive."
)


def _model(
    asset_id, kind, category, name, use, dims, collision, shape, budget, materials, *,
    animations=(), tags=(),
):  # fmt: skip
    return NorthPoleAsset(
        asset_id=asset_id,
        kind=kind,
        category=category,
        display_name=name,
        intended_use=use,
        model_format=GLB,
        dimensions_m=dims,
        collision=collision,
        animations=tuple(animations),
        materials=materials,
        stand_in_shape=shape,
        triangle_budget=budget,
        extra_tags=tuple(tags),
    )


def _elf(npc: str, name: str, use: str, outfit: str) -> NorthPoleAsset:
    return _model(
        f"north-pole-elf-{npc}",
        "character",
        "npc",
        name,
        use,
        (0.6, 1.2, 0.5),
        SMALL_NPC_BODY,
        "FIGURE",
        8000,
        f"{ELF_MATERIALS} {outfit}",
        animations=CHARACTER_CLIPS,
        tags=("elf",),
    )


# fmt: off
ASSETS: tuple[NorthPoleAsset, ...] = (
    # --- Characters ------------------------------------------------------------------------
    _model(
        "north-pole-santa", "character", "npc", "Santa Claus",
        "NPC santa-claus (placement np-santa) at Santa's Landing; quest giver, finale.",
        (0.9, 1.85, 0.7), NPC_BODY, "FIGURE", 10000,
        "Folklore figure in a red coat with white trim; original design, no brand likeness; "
        "one 1024 px atlas or vertex colours.",
        animations=CHARACTER_CLIPS,
    ),
    _model(
        "north-pole-mrs-claus", "character", "npc", "Mrs. Claus",
        "NPC mrs-claus (placement np-mrs-claus) in the gingerbread village; teacher.",
        (0.7, 1.7, 0.6), NPC_BODY, "FIGURE", 10000,
        "Original design (apron, shawl); one 1024 px atlas or vertex colours.",
        animations=CHARACTER_CLIPS,
    ),
    _elf("jingle", "Jingle", "NPC jingle (np-jingle, np-jingle-mountain): the guide at the "
         "landing and the mountain base.", "Green tunic, bell on the hat."),
    _elf("tinker", "Tinker", "NPC tinker (np-tinker) in Santa's Workshop.",
         "Work apron and goggles."),
    _elf("peppermint", "Peppermint", "NPC peppermint (np-peppermint) in the Candy Cane Forest.",
         "Red and white striped scarf."),
    _elf("frosty", "Frosty", "NPC frosty (np-frosty), the elf ice-skating guide at the Frozen "
         "Lake. An elf, never a snowman.", "Pale blue jumper and skates."),
    _elf("noel", "Noel", "NPC noel (np-noel) at the Reindeer Stables.",
         "Brown coat, feed bucket accessory."),
    _elf("ginger", "Ginger", "NPC ginger (np-ginger) in the Gingerbread Village.",
         "Orange apron, wooden spoon accessory."),
    _elf("polaris", "Polaris", "NPC polaris (np-polaris) in the North Pole Observatory.",
         "Navy cloak with star pattern."),
    _model(
        "north-pole-reindeer", "character", "creature", "Reindeer",
        "Ambient reindeer at the stables and the sleigh team in the finale.",
        (0.8, 1.9, 2.0), Collision("BOX", "SOLID", notes="Box around body and legs."),
        "ANIMAL", 8000,
        "Natural brown and cream fur, antlers; realistic-cartoon; no glowing or red nose "
        "(no third-party character); one 1024 px atlas or vertex colours.",
        animations=("idle", "walk", "run", "talk", "celebrate"),
    ),
    _model(
        "north-pole-reindeer-calf", "character", "creature", "Reindeer calf (Snowball)",
        "Snowball (NPC snowball, placement np-snowball): lost in Pine Hollow, then follows the "
        "child home (FOLLOW).",
        (0.5, 1.1, 1.2),
        Collision("NONE", "DECORATIVE", notes="A follower must never block or trap the child."),
        "ANIMAL", 6000,
        "Same palette and style as the adult reindeer, small nubs for antlers, collar socket; "
        "no red nose.",
        animations=("idle", "walk", "run", "talk", "celebrate", "jump"),
    ),
    # --- Scenery and props -----------------------------------------------------------------
    _model(
        "north-pole-snowman", "prop", "scenery", "Snowman",
        "Decorative snowmen along the North Road and in the village. Generic three-ball "
        "snowman, no film likeness.",
        (1.0, 1.8, 1.0), Collision("CYLINDER", "SOLID", 0.45), "SNOWMAN", 2000,
        "White snow with soft blue shading, coal and carrot details; vertex colours.",
    ),
    _model(
        "north-pole-christmas-tree", "prop", "scenery", "Christmas tree",
        "The decorated village tree (the restored Star sits on top in the finale).",
        (3.0, 6.0, 3.0), Collision("CYLINDER", "SOLID", 1.0, "Lower branches block."), "PINE",
        4000,
        "Dark green needles, baubles and lights as emissive materials (KHR_materials_emissive_"
        "strength allowed); one atlas.",
    ),
    _model(
        "north-pole-snowy-pine", "prop", "scenery", "Snowy pine",
        "Forest and Pine Hollow trees; instanced many times.",
        (2.0, 4.5, 2.0), Collision("CYLINDER", "SOLID", 0.3, "Trunk only."), "PINE", 1200,
        "Green needles with white snow caps; vertex colours; one material for instancing.",
    ),
    _model(
        "north-pole-candy-cane", "collectible", "collectible", "Candy cane",
        "Candy cane pickups np-candy-cane-1..5 in the Candy Cane Forest.",
        (0.3, 0.6, 0.1), PICKUP, "CANE", 600,
        "Red and white stripes; vertex colours or a 256 px texture.",
    ),
    _model(
        "north-pole-candy-cane-tall", "prop", "scenery", "Giant candy cane",
        "Giant candy canes lining Peppermint's trail in the Candy Cane Forest.",
        (0.6, 3.0, 1.2), Collision("CYLINDER", "SOLID", 0.25, "The upright stem only."), "CANE",
        800, "Red and white stripes; vertex colours or a 256 px texture.",
    ),
    _model(
        "north-pole-gingerbread-house", "prop", "building", "Gingerbread house",
        "Houses of the Gingerbread Village; one rooftop holds the gingerbread fragment.",
        (6.0, 5.0, 6.0), BUILDING, "HOUSE", 6000,
        "Biscuit brown walls, white icing trim, sweets; one 1024 px atlas.",
    ),
    _model(
        "north-pole-workshop", "prop", "building", "Santa's Workshop",
        "The workshop building in the santas-workshop zone.",
        (14.0, 8.0, 12.0), BUILDING, "HOUSE", 12000,
        "Red timber and snowy roof, warm window glow (emissive); one 2048 px atlas at most.",
    ),
    _model(
        "north-pole-workshop-machine", "prop", "equipment", "Toy workshop machine",
        "Tinker's broken toy machine, restored by the workshop puzzle.",
        (3.0, 2.5, 2.0), Collision("BOX", "SOLID"), "GEAR", 4000,
        "Painted metal and wood, brass gears; gears as separate nodes so Activate can turn them.",
        animations=("Idle", "Activate"),
    ),
    _model(
        "north-pole-toy-train", "prop", "vehicle", "Toy train",
        "Toy train on the workshop floor (decoration and conveyor route).",
        (2.4, 1.0, 0.8), Collision("BOX", "JUMPABLE"), "BOX", 2500,
        "Bright primary colours; vertex colours.",
        animations=("Activate",),
    ),
    _model(
        "north-pole-toy-blocks", "prop", "prop", "Toy blocks",
        "Stacked wooden blocks and crates on the workshop shelf route.",
        (0.6, 0.6, 0.6), Collision("BOX", "JUMPABLE"), "BOX", 300,
        "Painted wood with letters or numbers; one 256 px texture or vertex colours.",
    ),
    _model(
        "north-pole-present", "prop", "prop", "Wrapped present",
        "Wrapped gifts in the workshop and around the village tree.",
        (0.6, 0.6, 0.6), Collision("BOX", "JUMPABLE"), "GIFT", 400,
        "Coloured paper and ribbon; vertex colours; colour variants by placement are not "
        "supported, so one neutral-red design.",
        animations=("Open",),
    ),
    _model(
        "north-pole-sleigh", "prop", "vehicle", "Santa's sleigh",
        "The sleigh at Santa's Landing (lift-off in the finale) and the observatory return sled "
        "(np-observatory-sled).",
        (2.0, 1.6, 3.6), Collision("BOX", "SOLID"), "SLEIGH", 6000,
        "Red lacquer with gold trim; one 1024 px atlas.",
        animations=("Idle", "Activate"),
    ),
    _model(
        "north-pole-ice-platform", "prop", "scenery", "Ice platform",
        "Ice floes and the ice bridge pieces at the Frozen Lake.",
        (2.0, 0.4, 2.0), PLATFORM, "BOX", 300,
        "Pale translucent-looking blue (opaque material, no transmission); vertex colours.",
        tags=("platform",),
    ),
    _model(
        "north-pole-snow-platform", "prop", "scenery", "Snow platform",
        "Snow ledges on the jump tutorial and Snowflake Mountain terraces.",
        (2.0, 0.5, 2.0), PLATFORM, "BOX", 300,
        "White snow top, grey rock sides; vertex colours.",
        tags=("platform",),
    ),
    _model(
        "north-pole-cookie-platform", "prop", "scenery", "Cookie platform",
        "Cookie steps up to the gingerbread rooftop.",
        (1.6, 0.3, 1.6), PLATFORM, "BOX", 400,
        "Round biscuit with icing edge; vertex colours.",
        tags=("platform",),
    ),
    _model(
        "north-pole-peppermint-platform", "prop", "scenery", "Peppermint platform",
        "Peppermint stepping stones in the Candy Cane Forest.",
        (1.6, 0.3, 1.6), PLATFORM, "BOX", 400,
        "Round red and white swirl; vertex colours or a 256 px texture.",
        tags=("platform",),
    ),
    _model(
        "north-pole-bridge", "kit-piece", "scenery", "Snow bridge",
        "Walkable bridges built by the arithmetic unlocks (required routes).",
        (3.0, 0.4, 8.0), Collision("BOX", "WALKABLE", notes="Required path: kept clear."),
        "BOX", 1500,
        "Wooden planks with snow and rope rails; one 512 px texture or vertex colours.",
    ),
    _model(
        "north-pole-lantern", "prop", "scenery", "Lantern post",
        "Lantern posts along the North Road and paths.",
        (0.4, 2.2, 0.4), Collision("CYLINDER", "SOLID", 0.12, "The post only."), "LANTERN", 800,
        "Black iron post, warm emissive glass; vertex colours.",
    ),
    _model(
        "north-pole-ornament", "collectible", "collectible", "Ornament",
        "Hidden ornament pickups np-ornament-1..5 (village and North Road).",
        (0.3, 0.35, 0.3), PICKUP, "MARKER", 600,
        "Shiny bauble (metallic-roughness), one colour; vertex colours.",
    ),
    _model(
        "north-pole-star-fragment", "collectible", "collectible", "Star fragment",
        "The seven Christmas Star fragments np-fragment-<zone>.",
        (0.4, 0.4, 0.15), PICKUP, "STAR", 600,
        "Gold, emissive glow; vertex colours.",
    ),
    _model(
        "north-pole-christmas-star", "prop", "scenery", "Christmas Star",
        "The restored Star shown when NORTH_POLE_STAR_RESTORED exists (observatory and village "
        "tree top).",
        (1.6, 1.6, 0.4), DECOR, "STAR", 1200,
        "Gold with strong emissive glow; one material.",
        animations=("Idle", "Activate"),
    ),
    _model(
        "north-pole-observatory", "prop", "building", "North Pole Observatory",
        "Polaris's domed observatory in the north-pole-observatory zone.",
        (12.0, 10.0, 12.0), BUILDING, "DOME", 12000,
        "White stone, copper dome with an opening slit; one 2048 px atlas at most.",
    ),
    _model(
        "north-pole-fragment-socket", "prop", "equipment", "Star fragment socket",
        "The seven sockets np-socket-<zone> of the Star mechanism in the observatory.",
        (0.8, 1.0, 0.8), Collision("BOX", "SOLID"), "PEDESTAL", 1200,
        "Silver and night blue; an emissive inset that lights when its fragment is set.",
        animations=("Activate",),
    ),
    _model(
        "north-pole-sleigh-bell", "prop", "equipment", "Santa's sleigh bell",
        "The bell np-sleigh-bell the child rings to start the Christmas Eve celebration.",
        (0.6, 0.8, 0.6), Collision("CYLINDER", "SOLID", 0.3), "LANTERN", 1200,
        "Polished gold bell on a red wooden post; vertex colours.",
        animations=("Activate",),
    ),
    _model(
        "north-pole-telescope", "prop", "equipment", "Observatory telescope",
        "Polaris's telescope (star observation puzzle).",
        (1.0, 2.0, 2.2), Collision("BOX", "SOLID"), "TELESCOPE", 3000,
        "Brass and navy paint; tube as a separate node so Activate can tilt it.",
        animations=("Activate",),
    ),
    _model(
        "north-pole-snowflake", "collectible", "collectible", "Snowflake",
        "Snowflake pickups np-snowflake-01..10 (jump routes and the mountain).",
        (0.5, 0.5, 0.1), PICKUP, "CRYSTAL", 500,
        "White-blue, light emissive; vertex colours.",
    ),
    _model(
        "north-pole-golden-bell", "collectible", "collectible", "Golden bell",
        "Post-story golden bell pickups np-golden-bell-1..3 in the ice cave.",
        (0.3, 0.35, 0.3), PICKUP, "MARKER", 600,
        "Polished gold (metallic-roughness) with a red bow; vertex colours.",
    ),
    _model(
        "north-pole-gingerbread-cookie", "collectible", "collectible", "Gingerbread cookie",
        "Gingerbread cookie pickups np-cookie-1..3.",
        (0.3, 0.35, 0.06), PICKUP, "MARKER", 400,
        "Biscuit brown with white icing; vertex colours.",
    ),
    _model(
        "north-pole-snowball-collar", "collectible", "collectible", "Snowball's collar",
        "Snowball's collar pickup np-snowball-collar in Pine Hollow.",
        (0.3, 0.1, 0.3), PICKUP, "MARKER", 400,
        "Red leather with a small bell; vertex colours.",
    ),
    _model(
        "north-pole-cottage", "prop", "building", "Snowy cottage",
        "Elf cottages in Christmas Village.",
        (6.0, 5.0, 6.0), BUILDING, "HOUSE", 6000,
        "Timber walls, snowy roof, warm windows (emissive); one 1024 px atlas.",
    ),
    _model(
        "north-pole-stable", "prop", "building", "Reindeer stable",
        "The reindeer stable (Snowball rests here after coming home).",
        (10.0, 5.0, 8.0), BUILDING, "HOUSE", 8000,
        "Wooden barn with hay, open front; one 1024 px atlas.",
    ),
    _model(
        "north-pole-signpost", "prop", "scenery", "Signpost",
        "Direction signs at zone gates and on the North Road.",
        (0.8, 2.0, 0.2), Collision("CYLINDER", "SOLID", 0.1, "The post only."), "SIGN", 500,
        "Painted wood with blank boards (labels are drawn by the game, never baked in text).",
    ),
    _model(
        "north-pole-snowbank", "kit-piece", "scenery", "Snowbank",
        "Zone walls and gate snowdrifts (2.5 m or taller, not jumpable).",
        (4.0, 2.5, 1.5),
        Collision("BOX", "SOLID", notes="Layout colliders own walls and gates; this matches them."),
        "ROCK", 800,
        "White snow with blue shading; vertex colours; tiles side by side without seams.",
    ),
    _model(
        "north-pole-ice-formation", "kit-piece", "scenery", "Ice formation",
        "Ice crystals at the Frozen Lake, the mountain and the ice cave.",
        (1.5, 2.5, 1.5), Collision("BOX", "AUTO"), "CRYSTAL", 1000,
        "Pale blue, faint emissive; opaque (no transmission).",
    ),
    _model(
        "north-pole-christmas-lights", "prop", "scenery", "String of lights",
        "Strings of coloured lights on buildings and the landing.",
        (4.0, 0.3, 0.1), DECOR, "LANTERN", 600,
        "Emissive bulbs in several colours; no flashing animation (calm, photosensitivity).",
    ),
    _model(
        "ground-tile-snow", "kit-piece", "scenery", "Snow ground tile",
        "groundAssetId of north-pole-village: the TILED_GROUND repeats it every 4 m.",
        (4.0, 0.0, 4.0), DECOR, None, 200,
        "Flat 4 x 4 m tile at y = 0, snow white with a subtle tiling 512 px texture; edges tile "
        "seamlessly.",
    ),
    NorthPoleAsset(
        asset_id="north-pole-snow-texture",
        kind="texture",
        category="texture",
        display_name="Snow texture",
        intended_use=(
            "Seamless snow texture for authoring the ground tile and snowy surfaces. No runtime "
            "consumer reads a texture asset for the Area yet."
        ),
        model_format=IMAGE,
        dimensions_m=None,
        collision=None,
        animations=(),
        materials="1024 x 1024 px, seamless, sRGB colour; no baked lighting.",
        stand_in_shape=None,
        triangle_budget=None,
    ),
)
# fmt: on

#: NPC id (design section 7) -> character asset id for its NPC Manager model variant.
NPC_MODEL_ASSETS: dict[str, str] = {
    "santa-claus": "north-pole-santa",
    "mrs-claus": "north-pole-mrs-claus",
    "jingle": "north-pole-elf-jingle",
    "tinker": "north-pole-elf-tinker",
    "peppermint": "north-pole-elf-peppermint",
    "frosty": "north-pole-elf-frosty",
    "noel": "north-pole-elf-noel",
    "ginger": "north-pole-elf-ginger",
    "polaris": "north-pole-elf-polaris",
    "snowball": "north-pole-reindeer-calf",
}

ASSETS_BY_ID: dict[str, NorthPoleAsset] = {asset.asset_id: asset for asset in ASSETS}


def content_asset_defaults(asset: NorthPoleAsset) -> dict:
    """The `ContentAsset` field values the seed passes to `get_or_create` (with `asset_id`)."""
    from apps.catalog.models import AssetOrigin

    if asset.stand_in_shape:
        placeholder = f"the game draws a {asset.stand_in_shape} stand-in"
    else:
        placeholder = "the game draws its built-in placeholder"
    return {
        "asset_id": asset.asset_id,
        "kind": asset.kind,
        "origin": AssetOrigin.DJANGO,
        "category": asset.category,
        "display_name": asset.display_name,
        "description": (
            f"North Pole Village. {asset.intended_use} Not delivered yet; {placeholder} until "
            "a version is published."
        )[:1000],
        "tags": [REGION_TAG, REALM_TAG, *asset.extra_tags],
    }
