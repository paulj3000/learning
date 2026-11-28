"""How an image asset is drawn: roles, rules and the runtime block (LAI-ENV-02; contract
`env-assets/1`, `docs/ENVIRONMENT_ASSETS.md` sections 3 and 5).

`ImageProfile` rows are staff-authored in Django Admin, one default per image asset and an
optional override per version, exactly like collision profiles. This module holds the rules
(`profile_problems`, used by `ImageProfile.clean` and the admin form) and the runtime-independent
`render` block the resolver sends (`render_block`). Nothing here names a Three.js class: units are
metres, degrees and 0 to 1 fractions, so a later Unity adapter reads the same answer.

Image profiles never produce collision. Sprites, decals, particles, backdrops and skies are
decorative; the resolver attaches collision to models only.
"""

from __future__ import annotations

from django.core.exceptions import ValidationError

SCHEMA = "env-assets/1"

# --- Choices (also the model's TextChoices values) ----------------------------------------------

SURFACE = "SURFACE"
MATERIAL_MAP = "MATERIAL_MAP"
SPRITE = "SPRITE"
DECAL = "DECAL"
PARTICLE = "PARTICLE"
BACKDROP = "BACKDROP"
SKY = "SKY"
PICTURE = "PICTURE"

ROLE_LABELS = {
    SURFACE: "Surface texture (tiling colour: sand, grass, stone, wood...)",
    MATERIAL_MAP: "Material map (data: normal, roughness, metalness, occlusion...)",
    SPRITE: "Sprite (shell, starfish, plant, flower, butterfly, small scenery)",
    DECAL: "Decal (footprint, treasure X, rune, road marking, crack, moss)",
    PARTICLE: "Particle image (fire, smoke, snow, rain, dust, magic)",
    BACKDROP: "Backdrop (distant island, mountains, cloud card)",
    SKY: "Sky (panorama or cube map)",
    PICTURE: "Picture (flat art, island or place picture)",
}

#: Which roles each image kind may take.
KIND_ROLES = {
    "texture": {SURFACE, MATERIAL_MAP, SKY, BACKDROP},
    "sprite": {SPRITE, DECAL, PARTICLE, BACKDROP},
    "image": {PICTURE, BACKDROP, SKY},
}

SRGB = "SRGB"
LINEAR = "LINEAR"

DATA_CHANNELS = ("NORMAL", "ROUGHNESS", "METALNESS", "OCCLUSION", "ORM", "OPACITY", "HEIGHT")
ALPHA_MODES = ("OPAQUE", "MASK", "BLEND")
WRAPS = ("REPEAT", "MIRROR", "CLAMP")
PLACEMENTS = ("GROUND", "UPRIGHT", "BILLBOARD", "BILLBOARD_Y")
BLENDINGS = ("NORMAL", "ADDITIVE")
SKY_LAYOUTS = ("EQUIRECTANGULAR", "CUBE_STRIP", "CUBE_GRID")

#: Width : height of each sky layout, and how many faces across and down.
SKY_SHAPES = {
    "EQUIRECTANGULAR": (2.0, None),
    "CUBE_STRIP": (6.0, (6, 1)),
    "CUBE_GRID": (1.5, (3, 2)),
}
ASPECT_TOLERANCE = 0.01

TILING_ROLES = {SURFACE, MATERIAL_MAP}
SIZED_ROLES = {SPRITE, DECAL, PARTICLE, BACKDROP}
ANCHORED_ROLES = {SPRITE, BACKDROP}
SHEET_ROLES = {SPRITE, PARTICLE, DECAL}
OPACITY_ROLES = {DECAL, PARTICLE, BACKDROP}

MAX_REPEAT = 1000.0
MIN_REPEAT = 0.01
MAX_SHEET_FRAMES = 1024


def default_colour_space(role: str) -> str:
    return LINEAR if role == MATERIAL_MAP else SRGB


def _dimensions(version) -> tuple[int, int] | None:
    metadata = getattr(version, "metadata", None) or {}
    width, height = metadata.get("width"), metadata.get("height")
    if isinstance(width, int) and isinstance(height, int) and width > 0 and height > 0:
        return width, height
    return None


def _has_alpha(version):
    """True, False, or None when the version predates alpha being recorded."""
    value = (getattr(version, "metadata", None) or {}).get("hasAlpha")
    return value if isinstance(value, bool) else None


def profile_version(profile):
    """The version a profile is judged against: its own, else the asset's default."""
    if profile.version_id:
        return profile.version
    asset = profile.asset if profile.asset_id else None
    return asset.default_version if asset is not None and asset.default_version_id else None


def profile_problems(profile) -> tuple[dict[str, list[str]], list[str]]:
    """Every problem with `profile` (field -> messages) and advisory warnings. Never writes."""
    errors: dict[str, list[str]] = {}
    warnings: list[str] = []

    def error(field: str, message: str) -> None:
        errors.setdefault(field, []).append(message)

    asset = profile.asset if profile.asset_id else None
    role = profile.role
    if asset is not None:
        allowed = KIND_ROLES.get(asset.kind)
        if allowed is None:
            error(
                "asset",
                f"A {asset.kind} asset is not an image; image profiles are for "
                "texture, sprite and image assets.",
            )
        elif role not in allowed:
            error(
                "role",
                f"A {asset.kind} asset cannot have the role {role}. Choose one of: "
                f"{', '.join(sorted(allowed))}.",
            )
        if profile.version_id and profile.version.asset_id != asset.pk:
            error("version", "This version belongs to another asset.")

    expected_space = default_colour_space(role)
    if profile.colour_space != expected_space:
        if role == MATERIAL_MAP:
            error(
                "colour_space",
                "A material map holds data (normals, roughness...), so it is "
                "linear. Sampling it as sRGB would distort the values.",
            )
        else:
            error(
                "colour_space",
                "Colour images are sRGB. Use the Material map role for non-colour data.",
            )
    if role == MATERIAL_MAP and not profile.data_channel:
        error("data_channel", "Choose what the map holds (normal, roughness, ORM...).")
    if role != MATERIAL_MAP and profile.data_channel:
        error("data_channel", "Only a material map has a data channel.")
    # LAI 04 amendment A1 (2026-11-28): Three.js expects OpenGL tangent-space normals.
    convention = getattr(profile, "normal_convention", "")
    if role == MATERIAL_MAP and profile.data_channel == "NORMAL":
        if convention == "DIRECTX":
            error(
                "normal_convention",
                "DirectX normal maps are not accepted: flip the green "
                "channel to make it OpenGL (+Y up) and upload it again.",
            )
        elif convention != "OPENGL":
            error("normal_convention", "Confirm that this normal map is OpenGL (+Y up).")
    elif convention:
        error("normal_convention", "Only a normal map has a normal convention.")

    version = profile_version(profile)
    if profile.alpha_mode in ("MASK", "BLEND"):
        alpha = _has_alpha(version) if version is not None else None
        if alpha is False:
            error(
                "alpha_mode",
                "This image has no alpha channel, so it cannot be cut out or "
                "blended. Export it with transparency, or choose Opaque.",
            )
        elif alpha is None and version is not None:
            warnings.append(
                "The version was uploaded before transparency was recorded; check "
                "that the image really has an alpha channel."
            )
    if profile.alpha_cutoff is not None and not 0 <= profile.alpha_cutoff <= 1:
        error("alpha_cutoff", "The cutoff is between 0 and 1.")

    for name in ("repeat_u", "repeat_v"):
        value = getattr(profile, name)
        if value is not None and not MIN_REPEAT <= value <= MAX_REPEAT:
            error(name, f"Repeats are between {MIN_REPEAT} and {MAX_REPEAT:g}.")
    for name in ("metres_per_repeat", "world_width_m", "world_height_m", "decal_depth_m"):
        value = getattr(profile, name)
        if value is not None and value <= 0:
            error(name, "Sizes are positive, in metres.")
    for name in ("anchor_x", "anchor_y", "opacity"):
        value = getattr(profile, name)
        if value is not None and not 0 <= value <= 1:
            error(name, "This is a fraction from 0 to 1.")
    if profile.rotation_degrees is not None and not 0 <= profile.rotation_degrees < 360:
        error("rotation_degrees", "Rotation is from 0 to 359 degrees.")

    if role in SIZED_ROLES and profile.world_width_m is None and profile.world_height_m is None:
        error(
            "world_width_m",
            "Give the default world width or height (the other comes from "
            "the image's proportions).",
        )
    if role == SPRITE or role == BACKDROP:
        if not profile.placement:
            error(
                "placement", "Choose how it stands: on the ground, upright, or facing the camera."
            )
    elif profile.placement:
        error("placement", "Only sprites and backdrops have a placement.")
    if role == SKY:
        if not profile.sky_layout:
            error("sky_layout", "Choose the sky layout.")
        elif version is not None:
            _check_sky(profile.sky_layout, _dimensions(version), error)
    elif profile.sky_layout:
        error("sky_layout", "Only a sky has a layout.")
    if role == PARTICLE:
        if not profile.blending:
            error("blending", "Choose normal or additive blending.")
    elif profile.blending:
        error("blending", "Only particle images have a blending mode.")

    _check_sheet(profile, role, version, error)
    return errors, warnings


def _check_sky(layout: str, size, error) -> None:
    if size is None:
        return
    width, height = size
    ratio, faces = SKY_SHAPES[layout]
    if abs(width / height - ratio) > ratio * ASPECT_TOLERANCE:
        error(
            "sky_layout",
            f"A {layout.lower().replace('_', ' ')} sky is {ratio:g}:1; this "
            f"image is {width} x {height}.",
        )
        return
    if faces is not None:
        across, down = faces
        if width % across or height % down or width // across != height // down:
            error(
                "sky_layout",
                f"The {across} x {down} faces of this image are not square "
                f"whole pixels ({width} x {height}).",
            )


def _check_sheet(profile, role: str, version, error) -> None:
    columns, rows = profile.sheet_columns or 1, profile.sheet_rows or 1
    is_sheet = columns > 1 or rows > 1
    if not is_sheet:
        if profile.frame_count not in (None, 1):
            error("frame_count", "A single image has one frame; set columns and rows for a sheet.")
        return
    if role not in SHEET_ROLES:
        error("sheet_columns", "Only sprites, decals and particles can be sprite sheets.")
        return
    frames = profile.frame_count or columns * rows
    if frames < 1 or frames > columns * rows or frames > MAX_SHEET_FRAMES:
        error("frame_count", f"A {columns} x {rows} sheet holds 1 to {columns * rows} frames.")
    if profile.frames_per_second is not None and not 0 < profile.frames_per_second <= 60:
        error("frames_per_second", "Frames per second is above 0 and at most 60.")
    size = _dimensions(version) if version is not None else None
    if size is not None and (size[0] % columns or size[1] % rows):
        error(
            "sheet_columns",
            f"The image ({size[0]} x {size[1]}) does not divide into "
            f"{columns} x {rows} whole-pixel frames.",
        )


def clean_profile(profile) -> list[str]:
    """Raise `ValidationError` with every problem; return the warnings."""
    errors, warnings = profile_problems(profile)
    if errors:
        raise ValidationError(errors)
    return warnings


# --- Runtime block (resolver) -------------------------------------------------------------------


def _frame_size(profile, size):
    columns, rows = profile.sheet_columns or 1, profile.sheet_rows or 1
    if size is None:
        return None, None
    return size[0] // columns, size[1] // rows


def _world_size(profile, size):
    """Default world width and height in metres; a missing one follows the frame's aspect."""
    width, height = profile.world_width_m, profile.world_height_m
    frame_w, frame_h = _frame_size(profile, size)
    if frame_w and frame_h:
        if width is None and height is not None:
            width = height * frame_w / frame_h
        elif height is None and width is not None:
            height = width * frame_h / frame_w
    return width, height


def render_block(profile, version) -> dict:
    """The `render` block of an image entry (contract `env-assets/1`, section 5)."""
    role = profile.role
    size = _dimensions(version)
    block: dict = {
        "schema": SCHEMA,
        "role": role,
        "colourSpace": profile.colour_space.lower(),
        "dataChannel": profile.data_channel or None,
        # A1: always OPENGL for a normal map (the only convention accepted); null otherwise.
        "normalConvention": profile.normal_convention or None,
        "alphaMode": profile.alpha_mode,
        "alphaCutoff": profile.alpha_cutoff if profile.alpha_cutoff is not None else 0.5,
        "sampling": None,
        "sprite": None,
        "decal": None,
        "sheet": None,
        "sky": None,
        "particle": None,
    }
    if role in TILING_ROLES:
        block["sampling"] = {
            "wrap": profile.wrap or "REPEAT",
            "seamless": bool(profile.seamless),
            "metresPerRepeat": profile.metres_per_repeat,
            "repeat": [profile.repeat_u or 1.0, profile.repeat_v or 1.0],
            "rotationDegrees": profile.rotation_degrees or 0,
        }
    width, height = _world_size(profile, size)
    if role in ANCHORED_ROLES:
        block["sprite"] = {
            "widthM": width,
            "heightM": height,
            "anchor": [
                profile.anchor_x if profile.anchor_x is not None else 0.5,
                profile.anchor_y if profile.anchor_y is not None else 1.0,
            ],
            "placement": profile.placement,
        }
    if role == DECAL:
        block["decal"] = {
            "widthM": width,
            "heightM": height,
            "depthM": profile.decal_depth_m if profile.decal_depth_m is not None else 0.25,
            "opacity": profile.opacity if profile.opacity is not None else 1.0,
            "rotationDegrees": profile.rotation_degrees or 0,
        }
    if role == PARTICLE:
        block["particle"] = {
            "blending": profile.blending,
            "opacity": profile.opacity if profile.opacity is not None else 1.0,
            "widthM": width,
            "heightM": height,
        }
    if role == BACKDROP and profile.opacity is not None:
        block["sprite"]["opacity"] = profile.opacity
    columns, rows = profile.sheet_columns or 1, profile.sheet_rows or 1
    if columns > 1 or rows > 1:
        frame_w, frame_h = _frame_size(profile, size)
        block["sheet"] = {
            "columns": columns,
            "rows": rows,
            "frameCount": profile.frame_count or columns * rows,
            "framesPerSecond": profile.frames_per_second,
            "loop": bool(profile.loop),
            "frameWidth": frame_w,
            "frameHeight": frame_h,
        }
    if role == SKY:
        ratio, faces = SKY_SHAPES[profile.sky_layout]
        face = size[0] // faces[0] if (size is not None and faces is not None) else None
        block["sky"] = {"layout": profile.sky_layout, "faceSize": face}
    return block


def profile_for(asset, version):
    """The profile that applies to `version` of `asset`: its own row, else the asset default.

    Uses the prefetched `image_profiles` when present (the resolver prefetches them)."""
    rows = list(asset.image_profiles.all())
    if version is not None:
        for row in rows:
            if row.version_id == version.pk:
                return row
    for row in rows:
        if row.version_id is None:
            return row
    return None
